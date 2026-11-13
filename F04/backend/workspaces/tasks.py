from celery import shared_task, Task
from django.conf import settings
from django.db import transaction
from django_multitenant.utils import set_current_tenant as set_tenant, unset_current_tenant as clear_tenant
from workspaces.models import WebhookSubscription, WebhookDelivery


class TenantAwareTask(Task):
    """Base class for tenant-aware Celery tasks.

    Every tenant-scoped task must:
    1. Receive a validated workspace identifier
    2. Resolve and validate the workspace explicitly
    3. Establish the correct tenant context
    4. Query only authorized tenant data
    5. Clear tenant context after execution (including failure paths)
    """
    abstract = True
    acks_late = True
    reject_on_worker_lost = True

    def __call__(self, *args, **kwargs):
        workspace_id = kwargs.pop('_workspace_id', None)
        workspace = None
        if workspace_id:
            from workspaces.models import Workspace
            try:
                workspace = Workspace.objects.get(id=workspace_id)
                set_tenant(workspace)
            except Workspace.DoesNotExist:
                pass
        # Pass workspace_id to the task function (it was popped above)
        kwargs['workspace_id'] = workspace_id
        try:
            return super().__call__(*args, **kwargs)
        finally:
            clear_tenant()


def enqueue_after_commit(task, *args, kwargs=None, **task_kwargs):
    """Enqueue a Celery task after the current database transaction commits."""
    if kwargs is not None:
        task_kwargs = kwargs
    # TenantAwareTask.__call__ pops _workspace_id and maps it to workspace_id,
    # but apply_async() runs check_arguments() before __call__, validating
    # against the task signature (workspace_id). Map _workspace_id -> workspace_id
    # so the signature check passes.
    if '_workspace_id' in task_kwargs:
        task_kwargs['workspace_id'] = task_kwargs.pop('_workspace_id')
    def _enqueue():
        task.apply_async(args=args, kwargs=task_kwargs)
    transaction.on_commit(_enqueue)


@shared_task(base=TenantAwareTask, bind=True)
def ping_task(self, workspace_id=None):
    """Test task verifying Celery execution and tenant context."""
    from workspaces.models import Workspace
    workspace = None
    if workspace_id:
        workspace = Workspace.objects.get(id=workspace_id)
    return {
        'task_id': self.request.id,
        'workspace_id': workspace_id,
        'workspace_name': workspace.name if workspace else None,
    }

# Ensure apply_async() runs eagerly without a broker in environments where
# CELERY_TASK_ALWAYS_EAGER is enabled (e.g. tests). The default Celery app does
# not automatically pick up Django CELERY_* settings unless conf.celery is imported.
ping_task.app.conf.task_always_eager = settings.CELERY_TASK_ALWAYS_EAGER


@shared_task(base=TenantAwareTask, bind=True)
def generate_notification(self, user_id, workspace_id, notification_type, entity_type=None, entity_id=None, payload=None):
    """Create a notification for a user in a workspace (tenant-aware)."""
    from django.contrib.auth import get_user_model
    User = get_user_model()
    from workspaces.models import Workspace, Notification
    try:
        user = User.objects.get(id=user_id)
        workspace = Workspace.objects.get(id=workspace_id)
    except (User.DoesNotExist, Workspace.DoesNotExist):
        return {"error": "user or workspace not found"}
    notification = Notification.objects.create(
        user=user,
        workspace=workspace,
        notification_type=notification_type,
        entity_type=entity_type or "",
        entity_id=entity_id,
        payload=payload or {},
    )
    return {
        "notification_id": notification.id,
        "user_id": user.id,
        "workspace_id": workspace.id,
        "notification_type": notification_type,
    }


@shared_task(base=TenantAwareTask, bind=True)
def generate_report(self, report_id, workspace_id=None):
    """Generate a report in the background (tenant-aware).

    The TenantAwareTask base establishes the tenant context from `_workspace_id`
    before this task body runs, so all queries below are scoped to the report's
    workspace. `workspace_id` is accepted (injected by TenantAwareTask) and kept
    for parity with the other tenant-aware tasks in this module.
    """
    from django.utils import timezone
    from workspaces.models import Report
    try:
        report = Report.objects.get(id=report_id)
    except Report.DoesNotExist:
        return {"error": "report not found"}

    workspace = report.workspace
    user = report.user
    report_type = report.report_type

    try:
        if report_type == "issues_by_status":
            result = _generate_issues_by_status(workspace)
        elif report_type == "issues_by_assignee":
            result = _generate_issues_by_assignee(workspace)
        elif report_type == "sprint_completion":
            result = _generate_sprint_completion(workspace)
        elif report_type == "project_progress":
            result = _generate_project_progress(workspace)
        else:
            result = {"error": f"Unknown report type: {report_type}"}

        report.status = "completed"
        report.result = result
        report.completed_at = timezone.now()
        report.save(update_fields=["status", "result", "completed_at"])
        return {"report_id": report.id, "status": "completed"}
    except Exception as exc:
        report.status = "failed"
        report.error = str(exc)
        report.completed_at = timezone.now()
        report.save(update_fields=["status", "error", "completed_at"])
        raise


def _generate_issues_by_status(workspace):
    from workspaces.models import Issue
    issues = Issue.objects.filter(board__project__workspace=workspace)
    result = {}
    for issue in issues:
        status = issue.status_id.name
        result[status] = result.get(status, 0) + 1
    return result


def _generate_issues_by_assignee(workspace):
    from workspaces.models import Issue
    issues = Issue.objects.filter(board__project__workspace=workspace, assignee__isnull=False)
    result = {}
    for issue in issues:
        assignee = issue.assignee.username
        result[assignee] = result.get(assignee, 0) + 1
    return result


def _generate_sprint_completion(workspace):
    from workspaces.models import Sprint
    sprints = Sprint.objects.filter(workspace=workspace)
    result = []
    for sprint in sprints:
        result.append({
            "id": sprint.id,
            "name": sprint.name,
            "status": sprint.status,
            "project": sprint.project.key,
        })
    return result


def _generate_project_progress(workspace):
    from workspaces.models import Project, Issue
    projects = Project.objects.filter(workspace=workspace)
    result = []
    for project in projects:
        issues = Issue.objects.filter(board__project=project)
        total = issues.count()
        done = issues.filter(status_id__name="done").count()
        result.append({
            "id": project.id,
            "key": project.key,
            "name": project.name,
            "total_issues": total,
            "done_issues": done,
            "completion_pct": round((done / total * 100) if total > 0 else 0, 2),
        })
    return result


import hashlib
import hmac
import json
import uuid
from datetime import timedelta
from django.utils import timezone
import requests


def enqueue_webhook_delivery(subscription, event_type, event_id, payload):
    """Create a delivery record and enqueue it after transaction commit."""
    delivery = WebhookDelivery.objects.create(
        subscription=subscription,
        event_type=event_type,
        event_id=event_id,
        delivery_id=str(uuid.uuid4()),
        status="pending",
        request_payload=payload,
    )
    enqueue_after_commit(deliver_webhook, kwargs={'delivery_id': delivery.id, '_workspace_id': subscription.workspace.id})
    return delivery


@shared_task(base=TenantAwareTask, bind=True)
def deliver_webhook(self, delivery_id):
    """Deliver a webhook with HMAC signing, SSRF protection, and bounded retries."""
    try:
        delivery = WebhookDelivery.objects.get(id=delivery_id)
    except WebhookDelivery.DoesNotExist:
        return {"error": "delivery not found"}

    subscription = delivery.subscription

    if not subscription.is_enabled:
        delivery.status = "failed"
        delivery.error_message = "Subscription disabled"
        delivery.save(update_fields=["status", "error_message", "updated_at"])
        return {"status": "failed", "reason": "subscription_disabled"}

    delivery.attempt += 1
    delivery.save(update_fields=["attempt", "updated_at"])

    # Build payload
    payload = {
        "event_id": delivery.event_id,
        "event_type": delivery.event_type,
        "delivery_id": delivery.delivery_id,
        "timestamp": timezone.now().isoformat(),
        "data": delivery.request_payload,
    }

    # HMAC signature
    secret = subscription.signing_secret.encode("utf-8")
    payload_bytes = json.dumps(payload, sort_keys=True).encode("utf-8")
    signature = hmac.new(secret, payload_bytes, hashlib.sha256).hexdigest()

    headers = {
        "Content-Type": "application/json",
        "X-Webhook-Signature": f"sha256={signature}",
        "X-Webhook-Delivery": delivery.delivery_id,
        "X-Webhook-Event": delivery.event_type,
    }

    from workspaces.views import validate_webhook_destination  # lazy: avoid circular import (views imports tasks)

    try:
        # SSRF: re-validate destination at delivery time
        is_valid, error_msg = validate_webhook_destination(subscription.url)
        if not is_valid:
            delivery.status = "failed"
            delivery.error_message = f"SSRF: {error_msg}"
            delivery.save(update_fields=["status", "error_message", "updated_at"])
            return {"status": "failed", "reason": "ssrf"}

        # Deliver with no redirects, TLS verification
        response = requests.post(
            subscription.url,
            json=payload,
            headers=headers,
            timeout=10,
            allow_redirects=False,
            verify=True,
        )

        delivery.response_status = response.status_code
        delivery.response_body = response.text[:2000]
        delivery.updated_at = timezone.now()

        if response.status_code < 400:
            delivery.status = "delivered"
        else:
            delivery.status = "failed"
            delivery.error_message = f"HTTP {response.status_code}"

        delivery.save(update_fields=["status", "response_status", "response_body", "error_message", "updated_at"])
        return {"status": delivery.status}

    except requests.exceptions.RequestException as exc:
        delivery.error_message = str(exc)[:500]
        delivery.updated_at = timezone.now()

        if delivery.attempt >= delivery.max_attempts:
            delivery.status = "max_retries"
        else:
            delivery.status = "pending"
            delay = min(60 * (2 ** (delivery.attempt - 1)), 3600)
            delivery.next_attempt_at = timezone.now() + timedelta(seconds=delay)

        delivery.save(update_fields=["status", "error_message", "updated_at", "next_attempt_at"])

        if delivery.status == "pending":
            deliver_webhook.apply_async(args=[delivery.id], kwargs={'_workspace_id': delivery.subscription.workspace.id}, countdown=delay)

        return {"status": delivery.status, "error": str(exc)[:100]}
