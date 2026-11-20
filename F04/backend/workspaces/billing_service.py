"""Billing service layer for workspace billing operations.

Owns durable billing domain logic: workspace billing records, billing
operations (checkout/cancel/portal with idempotency keys), and the Stripe
event inbox used for idempotent webhook processing.
"""

from django.db import transaction
from django.db.models import Max
from rest_framework import status

from workspaces.models import WorkspaceBilling, BillingPlan, BillingOperation, StripeEventInbox, Project
from workspaces.stripe_adapter import StripeAdapter, StripeAdapterError


def get_or_create_workspace_billing(workspace):
    """Get or create WorkspaceBilling for a workspace (defaults to Free)."""
    billing, created = WorkspaceBilling.objects.get_or_create(
        workspace=workspace,
        defaults={"effective_plan": "free"},
    )
    return billing


def get_effective_plan(workspace):
    """Return the effective plan_id for a workspace."""
    billing = get_or_create_workspace_billing(workspace)
    return billing.effective_plan


def create_billing_operation(workspace, kind, idempotency_key):
    """Create a pending BillingOperation. Returns the operation or None if duplicate key."""
    try:
        operation = BillingOperation.objects.create(
            workspace=workspace,
            kind=kind,
            idempotency_key=idempotency_key,
            state="pending",
        )
        return operation
    except Exception:
        # Idempotency key conflict — return existing
        return BillingOperation.objects.filter(
            workspace=workspace, kind=kind, idempotency_key=idempotency_key
        ).first()


def record_stripe_event(event_id, event_type, provider_object_id="", resolved_workspace_id=None):
    """Record a Stripe event in the inbox. Returns True if new, False if duplicate."""
    try:
        _, created = StripeEventInbox.objects.get_or_create(
            event_id=event_id,
            defaults={
                "event_type": event_type,
                "provider_object_id": provider_object_id,
                "resolved_workspace_id": resolved_workspace_id,
                "state": "pending",
            },
        )
        return created
    except Exception:
        return False


def check_project_quota(workspace):
    """Atomically check if a project can be created in the workspace.

    Returns (True, None, None) if quota allows creation.
    Returns (False, error_dict, status_code) if quota is exceeded.

    Uses select_for_update() to serialize quota-consuming writes per workspace.
    The caller must create the project within the same transaction.
    """
    try:
        billing = WorkspaceBilling.objects.select_for_update().get(workspace=workspace)
    except WorkspaceBilling.DoesNotExist:
        # No billing record yet; create a default free-plan record with
        # workspace-scoped identifiers to avoid unique-constraint collisions
        # on customer_id / subscription_id.
        billing = WorkspaceBilling.objects.create(
            workspace=workspace,
            effective_plan="free",
            customer_id=f"cus_{workspace.id}",
            subscription_id=f"sub_{workspace.id}",
        )

    plan = BillingPlan.objects.filter(plan_id=billing.effective_plan, is_active=True).first()

    # Fall back to default Free plan limits when no BillingPlan record exists
    # (e.g. before migration 0018_seed_billing_plans is applied). This keeps
    # the quota check resilient instead of hard-failing with 400 plan_not_found.
    # Defaults match the Free plan seeded in 0018_seed_billing_plans:
    # max_memberships=5, max_projects=2.
    if plan is None:
        max_projects = 2
        max_memberships = 5
    else:
        max_projects = plan.max_projects
        max_memberships = plan.max_memberships

    project_count = Project.objects.filter(workspace=workspace).count()

    if project_count >= max_projects:
        return False, {
            "error": {
                "code": "plan_limit_reached",
                "message": "The workspace has reached its project limit.",
                "fields": {
                    "resource": "projects",
                    "used": project_count,
                    "limit": max_projects,
                    "plan": billing.effective_plan,
                }
            }
        }, status.HTTP_409_CONFLICT

    return True, None, None


def check_membership_quota(workspace):
    """Atomically check if a member can be added to the workspace.

    Returns (True, None, None) if quota allows.
    Returns (False, error_dict, status_code) if quota exceeded.

    Uses select_for_update() on WorkspaceBilling to serialize per-workspace.
    Caller must create membership within same transaction.
    """
    from workspaces.models import WorkspaceBilling, BillingPlan, Membership

    # Wrap the select_for_update() in an atomic block so this function is
    # self-contained: select_for_update() requires an active transaction on
    # PostgreSQL, but callers (e.g. TransactionTestCase tests) may not supply
    # one. Django nests atomics via savepoints, so callers already inside a
    # transaction keep the row lock held until their transaction commits.
    with transaction.atomic():
        try:
            billing = WorkspaceBilling.objects.select_for_update().get(workspace=workspace)
        except WorkspaceBilling.DoesNotExist:
            # No billing record yet; create a default free-plan record with
            # workspace-scoped identifiers to avoid unique-constraint collisions
            # on customer_id / subscription_id.
            billing = WorkspaceBilling.objects.create(
                workspace=workspace,
                effective_plan="free",
                customer_id=f"cus_{workspace.id}",
                subscription_id=f"sub_{workspace.id}",
            )

        plan = BillingPlan.objects.filter(plan_id=billing.effective_plan, is_active=True).first()

        if not plan:
            # Fall back to Free plan defaults when no BillingPlan row exists
            # (e.g., after TransactionTestCase truncates seeded data).
            plan_max_memberships = 5
        else:
            plan_max_memberships = plan.max_memberships

        membership_count = Membership.objects.filter(workspace=workspace).count()

        if membership_count >= plan_max_memberships:
            return False, {
                "error": {
                    "code": "plan_limit_reached",
                    "message": "The workspace has reached its membership limit.",
                    "fields": {
                        "resource": "memberships",
                        "used": membership_count,
                        "limit": plan_max_memberships,
                        "plan": billing.effective_plan,
                    }
                }
            }, status.HTTP_409_CONFLICT

        return True, None, None
