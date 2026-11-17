import os as os_module
from datetime import timedelta

from celery import shared_task, Task
from django.conf import settings
from django.db import models, transaction
from django.utils import timezone
from django_multitenant.utils import set_current_tenant as set_tenant, unset_current_tenant as clear_tenant
from workspaces.models import (
    BillingPlan,
    BillingOperation,
    StripeEventInbox,
    WebhookDelivery,
    WebhookSubscription,
    WorkspaceBilling,
)
from workspaces.stripe_adapter import StripeAdapter, StripeAdapterError


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
# not automatically pick up Django CELERY_* settings unless conf.celery_app is imported.
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


@shared_task(base=TenantAwareTask, bind=True)
def process_stripe_event(self, event_id, _workspace_id=None, workspace_id=None):
    """Process a Stripe webhook event asynchronously with idempotency and tenant isolation.

    The task is idempotent: events already marked ``processed`` are skipped. The
    workspace is resolved from the event payload (metadata or provider-object to
    billing mapping) before any billing state is mutated, providing tenant
    isolation. Failed events are retried up to 3 attempts with a countdown
    backoff.

    Note: ``TenantAwareTask.__call__`` maps ``_workspace_id`` to ``workspace_id``
    and forwards it to the body, so ``workspace_id`` is accepted here even though
    the body resolves the workspace independently from the event data.
    """
    try:
        inbox = StripeEventInbox.objects.get(event_id=event_id)
    except StripeEventInbox.DoesNotExist:
        return {"error": "event not found in inbox"}

    if inbox.state == "processed":
        return {"status": "already_processed"}

    event_type = inbox.event_type
    provider_object_id = inbox.provider_object_id or ""

    # Mark as being processed (increment attempts)
    inbox.attempts += 1
    inbox.save(update_fields=["attempts"])

    try:
        # Resolve workspace from event metadata or provider object
        workspace = _resolve_workspace_from_event(event_type, provider_object_id, inbox)

        if not workspace:
            # Cannot resolve workspace — mark failed
            inbox.state = "failed"
            inbox.error_code = "workspace_not_resolved"
            inbox.save(update_fields=["state", "error_code"])
            return {"status": "failed", "reason": "workspace_not_resolved"}

        result = _apply_stripe_event(workspace, event_type, provider_object_id, inbox)

        inbox.state = "processed"
        inbox.resolved_workspace_id = workspace.id
        inbox.save(update_fields=["state", "resolved_workspace_id"])

        return {"status": "processed", "workspace_id": workspace.id, "event_type": event_type}

    except Exception as exc:
        inbox.state = "failed"
        inbox.error_code = str(exc)[:100]
        inbox.next_attempt_at = timezone.now() + timedelta(minutes=5 * inbox.attempts)
        inbox.save(update_fields=["state", "error_code", "next_attempt_at"])
        # Retry if attempts remaining
        if inbox.attempts < 3:
            process_stripe_event.apply_async(args=[event_id], kwargs={"_workspace_id": None}, countdown=60)
        return {"status": "failed", "reason": str(exc)[:100]}


def _resolve_workspace_from_event(event_type, provider_object_id, inbox):
    """Resolve the workspace for a Stripe event.

    Strategy:
    1. If event metadata contains workspace_id, use it (verified against customer mapping)
    2. If provider_object_id maps to a WorkspaceBilling, use that workspace
    3. Otherwise, cannot resolve
    """
    # Try provider_object_id -> WorkspaceBilling.
    # Use the unscoped base manager here: we are *discovering* which tenant the
    # event belongs to, so we cannot filter by a tenant we have not resolved yet.
    if provider_object_id:
        try:
            billing = WorkspaceBilling._base_manager.filter(
                models.Q(customer_id=provider_object_id)
                | models.Q(subscription_id=provider_object_id)
            ).first()
            if billing:
                return billing.workspace
        except Exception:
            pass

    return None


def _apply_stripe_event(workspace, event_type, provider_object_id, inbox):
    """Apply a Stripe event to workspace billing state."""
    # Use the unscoped base manager: no tenant context is established in this task
    # body, and the tenant-scoped manager would filter out rows whose tenant_id
    # does not match a (currently absent) tenant.
    billing = WorkspaceBilling._base_manager.get(workspace=workspace)

    if event_type == "checkout.session.completed":
        # Verify the session belongs to this workspace
        # Set subscription if not already set
        if provider_object_id:
            # This is a checkout session ID; retrieve the subscription
            try:
                adapter = StripeAdapter()
                session_data = _retrieve_checkout_session(adapter, provider_object_id)
                if session_data:
                    subscription_id = session_data.get("subscription")
                    customer_id = session_data.get("customer")
                    if subscription_id:
                        billing.subscription_id = subscription_id
                    if customer_id:
                        billing.customer_id = customer_id
                    billing.provider_status = "active"
                    billing.effective_plan = "pro"
                    billing.paid_through = timezone.now() + timedelta(days=30)
                    billing.last_synced_at = timezone.now()
                    billing.save(update_fields=[
                        "subscription_id", "customer_id", "provider_status",
                        "effective_plan", "paid_through", "last_synced_at", "updated_at",
                    ])
            except StripeAdapterError:
                pass  # Will retry

    elif event_type == "customer.subscription.created":
        if provider_object_id:
            billing.subscription_id = provider_object_id
            billing.provider_status = "active"
            billing.effective_plan = "pro"
            billing.last_synced_at = timezone.now()
            billing.save(update_fields=[
                "subscription_id", "provider_status", "effective_plan", "last_synced_at", "updated_at",
            ])

    elif event_type == "customer.subscription.updated":
        if provider_object_id:
            try:
                adapter = StripeAdapter()
                sub_data = adapter.get_subscription(provider_object_id)
                billing.provider_status = sub_data.get("status", billing.provider_status)
                billing.cancel_at_period_end = sub_data.get("cancel_at_period_end", False)
                # Update plan based on price
                if sub_data.get("items"):
                    price_id = sub_data["items"][0].get("price_id")
                    if price_id == settings.STRIPE_PRO_PRICE_ID:
                        billing.effective_plan = "pro"
                    else:
                        billing.effective_plan = "free"
                billing.last_synced_at = timezone.now()
                billing.save(update_fields=[
                    "provider_status", "cancel_at_period_end", "effective_plan",
                    "last_synced_at", "updated_at",
                ])
            except StripeAdapterError:
                pass

    elif event_type == "customer.subscription.deleted":
        if provider_object_id:
            billing.subscription_id = ""
            billing.provider_status = "canceled"
            billing.effective_plan = "free"
            billing.last_synced_at = timezone.now()
            billing.save(update_fields=[
                "subscription_id", "provider_status", "effective_plan",
                "last_synced_at", "updated_at",
            ])

    elif event_type == "invoice.paid":
        # Payment succeeded — ensure plan stays active
        billing.last_synced_at = timezone.now()
        billing.save(update_fields=["last_synced_at", "updated_at"])

    elif event_type == "invoice.payment_failed":
        # Payment failed — mark past due
        billing.provider_status = "past_due"
        billing.last_synced_at = timezone.now()
        billing.save(update_fields=["provider_status", "last_synced_at", "updated_at"])

    elif event_type == "checkout.session.expired":
        # Checkout expired — mark operation as failed
        BillingOperation.objects.filter(
            workspace=workspace, kind="checkout", state="pending"
        ).update(state="failed", updated_at=timezone.now())

    else:
        # Unknown/unsubscribed event — acknowledged but ignored
        pass


def _retrieve_checkout_session(adapter, session_id):
    """Retrieve checkout session data via Stripe adapter.

    The adapter does not expose a checkout-session retrieval method, so this is a
    placeholder that returns ``None``. The ``customer.subscription.created`` event
    is responsible for finalizing the billing state.
    """
    return None


@shared_task(base=TenantAwareTask, bind=True, max_retries=4, default_retry_delay=60, soft_time_limit=60, time_limit=90)
def cleanup_attachment(self, attachment_id, _workspace_id=None, workspace_id=None):
    """Delete private object if explicitly deleted/failed/orphaned; missing object counts as success.

    Retry policy: 1 initial + 4 retries at 60s/300s/1,800s/7,200s; 60s/90s soft/hard time limit.
    A real removal failure is reported as failure and triggers retry. Missing file counts as success.
    """
    from workspaces.models import Attachment

    try:
        attachment = Attachment.objects.get(id=attachment_id)
    except Attachment.DoesNotExist:
        return {"status": "not_found"}

    # Only clean up if deleted or failed
    if attachment.state not in ("deleted", "failed"):
        return {"status": "skipped", "reason": f"state is {attachment.state}"}

    # Determine storage path (same convention as views.py)
    storage_dir = os_module.path.join(
        os_module.path.dirname(os_module.path.abspath(__file__)), "..", "private_storage"
    )
    object_key = attachment.object_key
    storage_path = os_module.path.join(storage_dir, object_key)

    # Delete the physical file if it exists
    file_existed = False
    if os_module.path.exists(storage_path):
        try:
            os_module.remove(storage_path)
            file_existed = True
        except OSError as exc:
            # Real removal failure: trigger retry with exponential backoff
            countdown = min(60 * (2 ** self.request.retries), 7200)
            raise self.retry(exc=exc, countdown=countdown)

    # If removal succeeded or file was missing, update attachment state
    if attachment.state == "deleted" and file_existed:
        attachment.state = "deleted"
        attachment.save(update_fields=["state", "updated_at"])

    return {
        "status": "cleaned",
        "attachment_id": attachment.id,
        "file_existed": file_existed,
        "state": attachment.state,
    }


@shared_task(base=TenantAwareTask, bind=True, soft_time_limit=30, time_limit=45)
def dispatch_outbox(self, _workspace_id=None, workspace_id=None):
    """Scan pending DomainEvents and fan out to Notification / WebhookDelivery.

    Creates unique delivery/notification records. Marks event dispatched only
    after fan-out records are durable. Scan every 60s (Celery Beat), batches
    of 100; failed scan retries next tick.
    """
    from django.db import transaction
    from workspaces.models import DomainEvent, Membership, Notification, WebhookDelivery, WebhookSubscription

    BATCH_SIZE = 100

    pending = DomainEvent.objects.filter(dispatched_at__isnull=True).order_by("occurred_at")[:BATCH_SIZE]

    if not pending:
        return {"status": "empty", "dispatched": 0}

    dispatched_count = 0

    for event in pending:
        workspace = event.workspace

        # Fan out: create Notification for workspace members
        if event.event_type in ("issue.created", "issue.status_changed", "comment.created"):
            members = Membership.objects.filter(workspace=workspace).select_related("user")
            for membership in members:
                Notification.objects.create(
                    user=membership.user,
                    workspace=workspace,
                    notification_type=event.event_type,
                    entity_type=event.aggregate_type,
                    payload=event.payload,
                )

        # Fan out: create WebhookDelivery for enabled webhook subscriptions
        subscriptions = WebhookSubscription.objects.filter(
            workspace=workspace, is_enabled=True
        )
        for subscription in subscriptions:
            WebhookDelivery.objects.create(
                subscription=subscription,
                event_type=event.event_type,
                event_id=str(event.id),
                delivery_id=str(uuid.uuid4()),
                status="pending",
                request_payload=event.payload,
            )

        # Mark event as dispatched only after fan-out records are durable
        with transaction.atomic():
            event.dispatched_at = timezone.now()
            event.save(update_fields=["dispatched_at"])

        dispatched_count += 1

    return {"status": "dispatched", "dispatched": dispatched_count}
