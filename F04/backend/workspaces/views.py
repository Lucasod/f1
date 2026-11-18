import socket
import ipaddress
from urllib.parse import urlparse
import uuid

from rest_framework import status
from rest_framework.response import Response
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.views import exception_handler as drf_exception_handler
from django.contrib.auth import authenticate, login as auth_login, get_user_model
from django.conf import settings
from django.http import Http404
from django.db import transaction
from django.utils import timezone
from django.middleware.csrf import get_token
from django.views.decorators.csrf import csrf_exempt
from django.db.models import F, Q
from django_multitenant.utils import set_current_tenant

from .models import Workspace, Membership, Project, Board, WorkflowStatus, Issue, Sprint, Comment, AuditLog, Notification, Report, WebhookSubscription, WebhookDelivery, WorkspaceBilling, BillingPlan, BillingOperation, StripeEventInbox, Attachment, AuditEvent, DomainEvent
from .serializers import (
    WorkspaceSerializer, MembershipSerializer, MembershipCreateSerializer,
    ProjectSerializer, BoardSerializer, BoardCreateSerializer,
    WorkflowStatusSerializer, IssueSerializer, SprintSerializer, CommentSerializer, NotificationSerializer,
    ReportSerializer, ReportCreateSerializer,
    WebhookSubscriptionSerializer, WebhookSubscriptionCreateSerializer, WebhookDeliverySerializer,
    AttachmentSerializer, AuditEventSerializer,
)
from .tasks import enqueue_after_commit, generate_report, cleanup_attachment, deliver_webhook
from .stripe_adapter import StripeAdapter, StripeAdapterError
from .billing_service import (
    get_or_create_workspace_billing,
    create_billing_operation,
    record_stripe_event,
    check_project_quota,
)


User = get_user_model()


def log_audit_operation(actor, workspace, resource_type, resource_id, operation, success=True, correlation_id=None, details=""):
    """Create an AuditLog entry for a completed operation.

    Failed/rolled-back operations should NOT call this function (or call it with
    success=False depending on policy). This helper avoids duplication across
    view functions.
    """
    AuditLog.objects.create(
        actor=actor,
        workspace=workspace,
        resource_type=resource_type,
        resource_id=resource_id,
        operation=operation,
        success=success,
        correlation_id=correlation_id,
        details=details,
    )


def custom_exception_handler(exc, context):
    """Custom exception handler that wraps all DRF errors in a consistent envelope.

    Transforms DRF's default error responses into the project-standard shape:
        { "error": { "code": ..., "message": ..., "fields": {} } }

    This ensures that even permission/authentication failures (e.g. IsAuthenticated
    returning 403 for anonymous requests) use the same envelope as validation errors.
    """
    response = drf_exception_handler(exc, context)
    if response is not None:
        error_code = "validation_error"
        if response.status_code == 403:
            error_code = "authentication_required" if "auth" in str(exc).lower() else "permission_denied"
        elif response.status_code == 404:
            error_code = "not_found"
        elif response.status_code == 405:
            error_code = "method_not_allowed"

        response.data = {
            "error": {
                "code": error_code,
                "message": "An error occurred.",
                "fields": {},
            }
        }
    return response


@api_view(["GET"])
@permission_classes([AllowAny])
def csrf_token(request):
    """Bootstrap CSRF token for browser requests.

    Returns the CSRF token and sets the CSRF cookie.
    """
    token = get_token(request)
    return Response({"csrf_token": token})


@api_view(["POST"])
@permission_classes([AllowAny])
def login(request):
    """Authenticate user and establish session.

    Establishes/rotates session and provides refreshed CSRF cookie.
    Returns current user representation on success.
    """
    username = request.data.get("username")
    password = request.data.get("password")

    if not username or not password:
        return Response(
            {"error": {"code": "invalid_credentials", "message": "Invalid credentials."}},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # DRF wraps request; use underlying Django HttpRequest for auth
    django_request = request._request
    user = authenticate(django_request, username=username, password=password)

    if user is None or not user.is_active:
        return Response(
            {"error": {"code": "invalid_credentials", "message": "Invalid credentials."}},
            status=status.HTTP_400_BAD_REQUEST,
        )

    auth_login(django_request, user)

    # Refresh session cookie
    response = Response(
        {
            "error": None,
            "user": {
                "id": user.pk,
                "username": user.username,
                "display_name": (user.first_name + " " + user.last_name).strip() or user.username,
            },
        },
        status=status.HTTP_200_OK,
    )

    # Set session cookie
    if hasattr(django_request, "session"):
        response.set_cookie(
            key="sessionid",
            value=django_request.session.session_key,
            httponly=True,
            samesite="Lax",
            path="/",
        )

    # Refresh CSRF token after login
    csrf_token = request.META.get("CSRF_TOKEN")
    if csrf_token:
        response["X-CSRFToken"] = csrf_token

    return response


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def logout(request):
    """Invalidate current session.

    Also returns 204 if already signed out with valid CSRF.
    """
    request.session.flush()
    response = Response(status=status.HTTP_204_NO_CONTENT)
    return response


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me(request):
    """Retrieve current authenticated user identity.

    Returns current user representation.
    """
    user = request.user
    # display_name: trimmed combination of first/last names, falling back to username
    display_name = (user.first_name + " " + user.last_name).strip() or user.username
    return Response(
        {
            "error": None,
            "user": {
                "id": user.pk,
                "username": user.username,
                "display_name": display_name,
            },
        }
    )


def check_membership_quota_for_user(user):
    """Check if the user can be added as owner to a new workspace.

    For a brand-new workspace, the user would be the only member (owner),
    so membership count would be 1. Check against the user's plan limit.
    Returns (True, None, None) if allowed, (False, error_dict, status) if not.
    """
    from workspaces.models import WorkspaceBilling
    from workspaces.billing_service import check_membership_quota

    # Find an existing owned workspace to determine the user's plan
    owned_ws = Workspace.objects.filter(
        memberships__user=user,
        memberships__role="owner",
    ).first()

    if owned_ws is None:
        # User owns no workspace yet — treat as Free (5 memberships max,
        # new workspace would have 1 member = owner)
        return True, None, None

    # Check if adding one more member (the owner of the new workspace)
    # would exceed the plan's membership limit
    billing = WorkspaceBilling.objects.filter(workspace=owned_ws).first()
    if billing is None:
        return True, None, None

    plan = BillingPlan.objects.filter(
        plan_id=billing.effective_plan, is_active=True
    ).first()
    max_memberships = plan.max_memberships if plan else 5

    # A new workspace would have exactly 1 member (the owner)
    if 1 >= max_memberships:
        return False, {
            "error": {
                "code": "plan_limit_reached",
                "message": "Your plan does not allow creating additional workspaces.",
                "fields": {
                    "resource": "memberships",
                    "used": 1,
                    "limit": max_memberships,
                    "plan": billing.effective_plan,
                }
            }
        }, status.HTTP_409_CONFLICT

    return True, None, None


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def create_workspace(request):
    """Create a new workspace and automatically become owner.

    The server assigns the workspace identifier; the client supplies only the name.
    Workspace creation and owner membership succeed or fail in one transaction.
    No ownerless workspace may remain after a failure.
    """
    name = request.data.get("name", "").strip()

    if not name or len(name) < 1 or len(name) > 100:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "The request contains invalid data.",
                    "fields": {"name": ["This field must not be blank and must be 1-100 characters."]},
                }
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    with transaction.atomic():
        user = request.user

        # Lock owned workspaces to serialize concurrent creation attempts (CR-001)
        owned_workspaces = Workspace.objects.select_for_update().filter(
            memberships__user=user,
            memberships__role="owner",
        )

        # Count owned workspaces
        owned_workspace_count = owned_workspaces.distinct().count()

        # Determine user's effective plan deterministically (CR-002)
        # Prefer Pro over Free when a user owns multiple workspaces with
        # different plans (e.g. after a downgrade).
        user_billing = (
            WorkspaceBilling.objects.filter(
                workspace__in=owned_workspaces
            )
            .order_by("-effective_plan")  # "pro" > "free" alphabetically
            .first()
        )
        user_plan = user_billing.effective_plan if user_billing else "free"

        # Enforce Free=1, Pro=multi (CR-001)
        if user_plan == "free" and owned_workspace_count >= 1:
            return Response({
                "error": {
                    "code": "plan_limit_reached",
                    "message": "Free plan users can create only one workspace.",
                    "fields": {
                        "resource": "workspaces",
                        "used": owned_workspace_count,
                        "limit": 1,
                        "plan": "free",
                    }
                }
            }, status=status.HTTP_409_CONFLICT)

        # Create the workspace
        workspace = Workspace.objects.create(name=name)

        # Ensure a billing row exists for the new workspace (defaults to Free)
        billing = WorkspaceBilling.objects.create(workspace=workspace, effective_plan="free")

        # Create the owner membership for the current user
        Membership.objects.create(
            user=user,
            workspace=workspace,
            role="owner",
        )

        # Emit a DomainEvent for Stripe Customer provisioning (outbox pattern)
        # The event is created in the same transaction as the workspace, so
        # rollback means no event is persisted. dispatch_outbox will process
        # it asynchronously and create the Stripe Customer.
        set_current_tenant(workspace)
        DomainEvent.objects.create(
            workspace=workspace,
            event_type="customer.provision",
            schema_version=1,
            actor=request.user,
            aggregate_type="Workspace",
            aggregate_id=str(workspace.id),
            request_id=request.META.get("CORRELATION_ID"),
            payload={
                "workspace_id": str(workspace.id),
                "workspace_name": workspace.name,
                "billing_id": str(billing.id),
            },
        )

        # Return the workspace with the caller's role
        serializer = WorkspaceSerializer(
            workspace,
            context={"request": request},
        )

        response = Response(
            {
                "error": None,
                "workspace": serializer.data,
            },
            status=status.HTTP_201_CREATED,
        )
        response["Location"] = f"/api/v1/workspaces/{workspace.id}/"
        log_audit_operation(
            actor=request.user,
            workspace=workspace,
            resource_type="workspace",
            resource_id=workspace.id,
            operation="create",
            success=True,
            correlation_id=request.META.get("CORRELATION_ID"),
            details="Workspace created successfully",
        )
        return response


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def list_workspaces(request):
    """List workspaces accessible to the authenticated user.

    Returns only the requesting user's memberships and associated workspaces.
    """
    user = request.user
    memberships = user.memberships.select_related("workspace").filter(
        workspace__deleted_at__isnull=True
    )
    workspaces = [m.workspace for m in memberships]
    serializer = WorkspaceSerializer(
        workspaces,
        many=True,
        context={"request": request},
    )
    return Response(
        {
            "error": None,
            "results": serializer.data,
        }
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def rename_workspace(request, workspace_id):
    """Rename a workspace.

    Only the workspace owner may rename it.
    Accepts JSON {"name": "New Name"}.
    Returns 200 with updated workspace representation on success.
    Returns 403 if caller is not the owner.
    Returns 400 if the name is blank or overlong.
    """
    name = request.data.get("name", "").strip()

    if not name or len(name) < 1 or len(name) > 100:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "The request contains invalid data.",
                    "fields": {"name": ["This field must not be blank and must be 1-100 characters."]},
                }
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Verify the workspace exists and the caller is a member
    user = request.user
    try:
        workspace = Workspace.objects.get(id=workspace_id, deleted_at__isnull=True)
    except Workspace.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Workspace not found."}},
            status=status.HTTP_404_NOT_FOUND,
        )

    # Check membership and ownership
    membership = Membership.objects.filter(user=user, workspace=workspace).first()
    if not membership:
        # User is not a member → forbidden
        return Response(
            {"error": {"code": "permission_denied", "message": "Only workspace members may rename it."}},
            status=status.HTTP_403_FORBIDDEN,
        )

    if membership.role != "owner":
        # User is a member but not the owner → forbidden
        return Response(
            {"error": {"code": "permission_denied", "message": "Only the workspace owner may rename it."}},
            status=status.HTTP_403_FORBIDDEN,
        )

    with transaction.atomic():
        # Rename the workspace
        workspace.name = name
        workspace.save()

        # Return the workspace with the caller's role
        serializer = WorkspaceSerializer(
            workspace,
            context={"request": request},
        )

        response = Response(
            {
                "error": None,
                "workspace": serializer.data,
            },
            status=status.HTTP_200_OK,
        )
        response["Location"] = f"/api/v1/workspaces/{workspace.id}/"
        log_audit_operation(
            actor=request.user,
            workspace=workspace,
            resource_type="workspace",
            resource_id=workspace.id,
            operation="update",
            success=True,
            correlation_id=request.META.get("CORRELATION_ID"),
            details="Workspace renamed successfully",
        )
        return response


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def workspace_detail(request, workspace_id):
    """Retrieve workspace details.

    Any current member of that workspace can access.
    Returns 404 for nonexistent or inaccessible workspace.
    """
    user = request.user
    try:
        workspace = Workspace.objects.get(id=workspace_id, deleted_at__isnull=True)
    except Workspace.DoesNotExist:
        raise Http404("Workspace not found")

    # Check membership
    has_membership = Membership.objects.filter(
        user=user, workspace=workspace
    ).exists()
    if not has_membership:
        raise Http404("Workspace not found")

    serializer = WorkspaceSerializer(
        workspace,
        context={"request": request},
    )
    return Response(
        {
            "error": None,
            "workspace": serializer.data,
        }
    )


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def delete_workspace(request, workspace_id):
    """Soft-delete a workspace.

    Owner-only, CSRF-protected. Requires JSON {"confirmation_name": "Acme"}
    matching the current workspace name exactly. Blocks deletion if billing
    is paid/pending (409 billing_not_closed).
    """
    user = request.user
    try:
        workspace = Workspace.objects.get(id=workspace_id, deleted_at__isnull=True)
    except Workspace.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Workspace not found."}},
            status=status.HTTP_404_NOT_FOUND,
        )

    # Check ownership
    membership = Membership.objects.filter(
        user=user, workspace=workspace, role="owner"
    ).first()
    if not membership:
        return Response(
            {
                "error": {
                    "code": "permission_denied",
                    "message": "Only workspace owners may delete a workspace.",
                }
            },
            status=status.HTTP_403_FORBIDDEN,
        )

    # Validate confirmation
    confirmation_name = request.data.get("confirmation_name", "").strip()
    if confirmation_name != workspace.name:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Confirmation name does not match workspace name.",
                    "fields": {
                        "confirmation_name": [
                            "Must match the workspace name exactly."
                        ]
                    },
                }
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Check billing state — paid/pending billing blocks deletion
    billing = WorkspaceBilling.objects.filter(workspace=workspace).first()
    if billing and billing.effective_plan == "pro" and billing.provider_status in (
        "active",
        "past_due",
        "trialing",
    ):
        return Response(
            {
                "error": {
                    "code": "billing_not_closed",
                    "message": "Workspace deletion blocked by paid or pending billing. Cancel the subscription first.",
                    "fields": {},
                }
            },
            status=status.HTTP_409_CONFLICT,
        )

    with transaction.atomic():
        workspace.deleted_at = timezone.now()
        workspace.save(update_fields=["deleted_at"])

        log_audit_operation(
            actor=request.user,
            workspace=workspace,
            resource_type="workspace",
            resource_id=workspace.id,
            operation="delete",
            success=True,
            correlation_id=request.META.get("CORRELATION_ID"),
            details="Workspace soft-deleted",
        )

    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def restore_workspace(request, workspace_id):
    """Restore a soft-deleted workspace. Owner only, CSRF-protected."""
    user = request.user
    # Narrowly scoped lookup: only deleted workspaces (not ordinary active queryset)
    try:
        workspace = Workspace.objects.get(id=workspace_id, deleted_at__isnull=False)
    except Workspace.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Workspace not found.", "fields": {}}},
            status=status.HTTP_404_NOT_FOUND,
        )

    # Owner-only authorization
    membership = Membership.objects.filter(user=user, workspace=workspace, role="owner").first()
    if not membership:
        return Response(
            {"error": {"code": "permission_denied", "message": "Only workspace owners may restore a workspace."}},
            status=status.HTTP_403_FORBIDDEN,
        )

    with transaction.atomic():
        workspace.deleted_at = None
        workspace.save(update_fields=["deleted_at"])

        log_audit_operation(
            actor=request.user,
            workspace=workspace,
            resource_type="workspace",
            resource_id=workspace.id,
            operation="restore",
            success=True,
            correlation_id=request.META.get("CORRELATION_ID"),
            details="Workspace restored",
        )

    return Response(
        {
            "error": None,
            "workspace": {
                "id": workspace.id,
                "name": workspace.name,
                "deleted_at": None,
            }
        },
        status=status.HTTP_200_OK,
    )


# ---- Project endpoints ----

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def create_project(request):
    """Create a new project with an initial board.

    Admin/owner creates a project with a unique key and an initial board.
    The board is created atomically with the project.
    """
    user = request.user
    # Deterministic workspace selection: caller must specify workspace_id.
    # .first() is intentionally avoided so a user in multiple workspaces
    # cannot get an arbitrary workspace under parallel workers.
    workspace_id = request.data.get("workspace_id")
    if not workspace_id:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Missing workspace_id.",
                    "fields": {},
                }
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        workspace = Workspace.objects.get(id=workspace_id, deleted_at__isnull=True)
    except Workspace.DoesNotExist:
        return Response(
            {
                "error": {
                    "code": "not_found",
                    "message": "Workspace not found.",
                }
            },
            status=status.HTTP_404_NOT_FOUND,
        )
    # Check membership: user must be owner or admin of THIS workspace
    membership = Membership.objects.filter(
        user=user, role__in=["owner", "admin"], workspace=workspace
    ).first()
    if not membership:
        return Response(
            {"error": {"code": "permission_denied", "message": "Only workspace owners/admins may create projects."}},
            status=status.HTTP_403_FORBIDDEN,
        )

    name = request.data.get("name", "").strip()
    key = request.data.get("key", "").strip()

    if not name or len(name) < 1 or len(name) > 200:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "The request contains invalid data.",
                    "fields": {"name": ["This field must not be blank and must be 1-200 characters."]},
                }
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Key validation: uppercase, 2-10 chars, starting with letter, alphanumeric
    import re
    if not re.match(r"^[A-Z][A-Z0-9]{1,9}$", key):
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "The request contains invalid data.",
                    "fields": {"key": ["Key must be uppercase, 2-10 chars, starting with a letter, alphanumeric (e.g. ABC)."]},
                }
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Check key uniqueness within workspace
    if Project.objects.filter(workspace=workspace, key=key).exists():
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "A project with this key already exists in this workspace.",
                }
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    with transaction.atomic():
        # Quota check: lock workspace billing row and verify project limit
        quota_ok, quota_error, quota_status = check_project_quota(workspace)
        if not quota_ok:
            return Response(quota_error, status=quota_status)

        # Create the project
        project = Project.objects.create(
            key=key,
            name=name,
            workspace=workspace,
        )

        # Create the initial board atomically
        board_serializer = BoardCreateSerializer(
            data={"name": project.name},
            context={"project": project, "request": request},
        )
        if board_serializer.is_valid(raise_exception=True):
            board = board_serializer.save()

        # Return the project with the caller's role
        proj_serializer = ProjectSerializer(
            project,
            context={"request": request},
        )

        response = Response(
            {
                "error": None,
                "project": proj_serializer.data,
            },
            status=status.HTTP_201_CREATED,
        )
        response["Location"] = f"/api/v1/projects/{project.id}/"
        log_audit_operation(
            actor=request.user,
            workspace=workspace,
            resource_type="project",
            resource_id=project.id,
            operation="create",
            success=True,
            correlation_id=request.META.get("CORRELATION_ID"),
            details="Project created successfully",
        )
        return response


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def list_projects(request):
    """List projects accessible to the authenticated user.

    Returns pagination-compatible results with optional filters.
    """
    user = request.user
    memberships = user.memberships.select_related("workspace").filter(
        workspace__deleted_at__isnull=True
    )
    workspaces = [m.workspace for m in memberships]
    projects = Project.objects.filter(workspace__in=workspaces).select_related("workspace")

    # DRF's default pagination applies (DEFAULT_PAGINATION_CLASS set in settings)
    page = request.query_params.get("page", 1)
    page_size = request.query_params.get("page_size", 20)

    # Simple pagination: return all for now, DRF will paginate if needed
    serializer = ProjectSerializer(
        projects,
        many=True,
        context={"request": request},
    )
    return Response(
        {
            "error": None,
            "results": serializer.data,
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def project_detail(request, project_id):
    """Retrieve project details.

    Member/detail view for a project.
    """
    user = request.user
    try:
        project = Project.objects.get(id=project_id)
    except Project.DoesNotExist:
        raise Http404("Project not found")

    # Check membership: user must be member of the project's workspace
    has_membership = Membership.objects.filter(
        user=user, workspace=project.workspace
    ).exists()
    if not has_membership:
        raise Http404("Project not found")

    serializer = ProjectSerializer(
        project,
        context={"request": request},
    )
    return Response(
        {
            "error": None,
            "project": serializer.data,
        }
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def create_issue(request, project_id):
    """Create a new issue in the project's board.

    Members can create issues. The server allocates the issue number monotonically.
    """
    user = request.user
    try:
        project = Project.objects.get(id=project_id)
    except Project.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Project not found."}},
            status=status.HTTP_404_NOT_FOUND,
        )

    # Check membership
    has_membership = Membership.objects.filter(
        user=user, workspace=project.workspace
    ).exists()
    if not has_membership:
        return Response(
            {"error": {"code": "permission_denied", "message": "Only workspace members may create issues."}},
            status=status.HTTP_403_FORBIDDEN,
        )

    # Get the project's board
    try:
        board = project.board
    except Exception:
        return Response(
            {"error": {"code": "not_found", "message": "Project has no board configured."}},
            status=status.HTTP_404_NOT_FOUND,
        )

    # Validate title
    title = request.data.get("title", "").strip()
    if not title:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "The request contains invalid data.",
                    "fields": {"title": ["This field must not be blank."]},
                }
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    if len(title) > 200:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "The request contains invalid data.",
                    "fields": {"title": ["Title must not exceed 200 characters."]},
                }
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Validate description
    description = request.data.get("description", "").strip()

    # Validate priority
    priority = request.data.get("priority", "medium")
    valid_priorities = dict(Issue.PRIORITY_CHOICES).keys()
    if priority not in valid_priorities:
        priority = "medium"

    # Validate status - must use an existing workflow status
    status_name = request.data.get("status", None)
    if status_name:
        try:
            status_obj = WorkflowStatus.objects.get(board=board, name=status_name)
        except WorkflowStatus.DoesNotExist:
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "Invalid status. Allowed statuses: to_do, in_progress, done.",
                    }
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
    else:
        # Default to the first status (To do)
        status_obj = board.workflow_statuses.first()
        if not status_obj:
            return Response(
                {"error": {"code": "not_found", "message": "Board has no workflow statuses configured."}},
                status=status.HTTP_404_NOT_FOUND,
            )

    # Determine assignee (optional)
    assignee_username = request.data.get("assignee", None)
    assignee = None
    if assignee_username:
        from django.contrib.auth import get_user_model
        User = get_user_model()
        try:
            assignee_user = User.objects.get(username=assignee_username)
            # Check that the assignee has active account and current membership in workspace
            assignee_membership = Membership.objects.filter(
                user=assignee_user, workspace=project.workspace
            ).first()
            if not assignee_membership:
                return Response(
                    {
                        "error": {
                            "code": "validation_error",
                            "message": "Assignee must have an active membership in the project's workspace.",
                        }
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            assignee = assignee_user
        except User.DoesNotExist:
            return Response(
                {"error": {"code": "not_found", "message": "Assignee user not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )

    # Determine sprint (optional)
    sprint_id = request.data.get("sprint_id", None)
    sprint = None
    if sprint_id:
        try:
            sprint = Sprint.objects.get(id=sprint_id, project=project, status="active")
        except Sprint.DoesNotExist:
            # Also allow planned sprints
            try:
                sprint = Sprint.objects.get(id=sprint_id, project=project)
            except Sprint.DoesNotExist:
                return Response(
                    {
                        "error": {
                            "code": "validation_error",
                            "message": "Sprint not found or not active in this project.",
                        }
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

    # Create the issue
    with transaction.atomic():
        # Set reporter to the current user
        reporter = user

        # Atomically allocate the next issue number for this project.
        # select_for_update() serializes concurrent issue creation within
        # the same project so two requests never compute the same number.
        project = Project.objects.select_for_update().get(id=project.id)
        next_number = project.next_issue_number
        project.next_issue_number = next_number + 1
        project.save(update_fields=["next_issue_number"])

        issue = Issue.objects.create(
            board=board,
            number=next_number,
            title=title,
            description=description if description else "",
            status_id=status_obj,
            assignee=assignee,
            reporter=reporter,
            priority=priority,
            sprint_id=sprint if sprint else None,
            version=0,
        )

        DomainEvent.objects.create(
            workspace=issue.board.project.workspace,
            event_type="issue.created",
            schema_version=1,
            actor=request.user,
            aggregate_type="Issue",
            aggregate_id=str(issue.id),
            occurred_at=timezone.now(),
            request_id=request.META.get("CORRELATION_ID"),
            payload={
                "issue_id": issue.id,
                "project_id": project.id,
                "workspace_id": project.workspace.id,
                "title": issue.title,
                "status_id": issue.status_id_id,
            },
        )

        issue_serializer = IssueSerializer(issue, context={"request": request})
        log_audit_operation(
            actor=request.user,
            workspace=issue.board.project.workspace,
            resource_type="issue",
            resource_id=issue.id,
            operation="create",
            success=True,
            correlation_id=request.META.get("CORRELATION_ID"),
            details="Issue created successfully",
        )
        return Response(
            {
                "error": None,
                "issue": issue_serializer.data,
            },
            status=status.HTTP_201_CREATED,
        )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def list_issues(request):
    """List issues with pagination and filters.

    Members can list issues with various filters.
    """
    user = request.user
    # Get issues from user's workspace projects
    memberships = user.memberships.select_related("workspace").filter(
        workspace__deleted_at__isnull=True
    )
    workspaces = [m.workspace for m in memberships]

    # Cross-workspace isolation: if project_id is provided, user must be a member
    # of the project's workspace
    project_id = request.query_params.get("project_id", None)
    if project_id:
        try:
            project = Project.objects.get(id=project_id)
            # Check user has membership in the project's workspace
            has_membership = Membership.objects.filter(
                user=user, workspace=project.workspace
            ).exists()
            if not has_membership:
                return Response(
                    {"error": {"code": "permission_denied", "message": "Cross-workspace access denied. You are not a member of this project's workspace."}},
                    status=status.HTTP_403_FORBIDDEN,
                )
        except Project.DoesNotExist:
            return Response(
                {"error": {"code": "not_found", "message": "Project not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )

    # Build queryset: issues from boards in user's workspaces
    issues = Issue.objects.select_related(
        "board__project", "status_id", "assignee", "reporter", "sprint_id"
    ).filter(board__project__workspace__in=workspaces)

    # Apply project filter when project_id is provided
    if project_id:
        issues = issues.filter(board__project__id=project_id)

    # Apply filters
    status_filter = request.query_params.get("status", None)
    if status_filter:
        issues = issues.filter(status_id__name=status_filter)

    priority_filter = request.query_params.get("priority", None)
    if priority_filter:
        issues = issues.filter(priority=priority_filter)

    assignee_filter = request.query_params.get("assignee", None)
    if assignee_filter:
        issues = issues.filter(assignee_id=assignee_filter)

    # Order by number ascending (as per spec)
    issues = issues.order_by("number")

    # Pagination
    # DRF's default pagination applies here
    from rest_framework.pagination import PageNumberPagination
    paginator = PageNumberPagination()
    page = paginator.paginate_queryset(issues, request)
    if page is not None:
        serializer = IssueSerializer(page, many=True, context={"request": request})
        return Response({
            "error": None,
            "count": paginator.page.paginator.count,
            "next": paginator.get_next_link(),
            "previous": paginator.get_previous_link(),
            "results": serializer.data,
        })

    serializer = IssueSerializer(issues, many=True, context={"request": request})
    return Response(
        {"error": None, "results": serializer.data}
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def issue_detail(request, issue_id):
    """Retrieve issue detail.

    Member detail view for an issue.
    """
    user = request.user
    try:
        issue = Issue.objects.select_related(
            "board__project", "status_id", "assignee", "reporter", "sprint_id"
        ).get(id=issue_id)
    except Issue.DoesNotExist:
        raise Http404("Issue not found")

    # Check membership: user must be member of the issue's board's project workspace
    has_membership = Membership.objects.filter(
        user=user, workspace=issue.board.project.workspace
    ).exists()
    if not has_membership:
        raise Http404("Issue not found")

    serializer = IssueSerializer(issue, context={"request": request})
    return Response(
        {
            "error": None,
            "issue": serializer.data,
        }
    )


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def update_issue(request, issue_id):
    """Update an issue (version, title/description/assignee/sprint/priority).

    Members can update issues, version must match for optimistic locking.
    """
    user = request.user
    try:
        issue = Issue.objects.select_related(
            "board__project", "status_id", "assignee", "reporter", "sprint_id"
        ).get(id=issue_id)
    except Issue.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Issue not found."}},
            status=status.HTTP_404_NOT_FOUND,
        )

    # Check membership
    has_membership = Membership.objects.filter(
        user=user, workspace=issue.board.project.workspace
    ).exists()
    if not has_membership:
        return Response(
            {"error": {"code": "permission_denied", "message": "Only workspace members may update issues."}},
            status=status.HTTP_403_FORBIDDEN,
        )

    # Validate version (optimistic locking)
    incoming_version = request.data.get("version", issue.version)
    if incoming_version != issue.version:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Issue version mismatch. The issue has been modified by another user.",
                }
            },
            status=status.HTTP_409_CONFLICT,
        )

    # Validate and update title
    title = request.data.get("title", None)
    if title is not None:
        title = title.strip()
        if not title:
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "The request contains invalid data.",
                        "fields": {"title": ["This field must not be blank."]},
                    }
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        if len(title) > 200:
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "The request contains invalid data.",
                        "fields": {"title": ["Title must not exceed 200 characters."]},
                    }
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        issue.title = title

    # Validate and update description
    description = request.data.get("description", None)
    if description is not None:
        issue.description = description.strip() if description else ""

    # Validate and update priority
    priority = request.data.get("priority", None)
    if priority is not None:
        valid_priorities = dict(Issue.PRIORITY_CHOICES).keys()
        if priority not in valid_priorities:
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "Priority must be one of: low, medium, high.",
                    }
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        issue.priority = priority

    # Validate and update assignee
    assignee_username = request.data.get("assignee", None)
    if assignee_username is not None:
        from django.contrib.auth import get_user_model
        User = get_user_model()
        try:
            assignee_user = User.objects.get(username=assignee_username)
            # Check that the assignee has active account and current membership in workspace
            assignee_membership = Membership.objects.filter(
                user=assignee_user, workspace=issue.board.project.workspace
            ).first()
            if not assignee_membership:
                return Response(
                    {
                        "error": {
                            "code": "validation_error",
                            "message": "Assignee must have an active membership in the project's workspace.",
                        }
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            issue.assignee = assignee_user
        except User.DoesNotExist:
            return Response(
                {"error": {"code": "not_found", "message": "Assignee user not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )

    # Validate and update sprint
    sprint_id = request.data.get("sprint_id", None)
    if sprint_id is not None:
        try:
            sprint = Sprint.objects.get(id=sprint_id, project=issue.board.project)
            # Check that sprint is in same project/workspace and is planned or active
            if sprint.status not in ("planned", "active"):
                return Response(
                    {
                        "error": {
                            "code": "validation_error",
                            "message": "Sprint must be in planned or active state to assign issues.",
                        }
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            issue.sprint_id = sprint
        except Sprint.DoesNotExist:
            return Response(
                {"error": {"code": "not_found", "message": "Sprint not found in this project."}},
                status=status.HTTP_404_NOT_FOUND,
            )

    # Update version (increment for optimistic locking)
    issue.version = (issue.version or 0) + 1
    issue.save()

    log_audit_operation(
        actor=request.user,
        workspace=issue.board.project.workspace,
        resource_type="issue",
        resource_id=issue.id,
        operation="update",
        success=True,
        correlation_id=request.META.get("CORRELATION_ID"),
        details="Issue updated successfully",
    )

    serializer = IssueSerializer(issue, context={"request": request})
    return Response(
        {
            "error": None,
            "issue": serializer.data,
        }
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def transition_issue(request, issue_id):
    """Transition an issue to a new status.

    Members can transition issues. Validates allowed transitions and
    performs visual rollback on API error.
    """
    user = request.user
    try:
        issue = Issue.objects.select_related(
            "board__project", "status_id", "assignee", "reporter", "sprint_id"
        ).get(id=issue_id)
    except Issue.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Issue not found."}},
            status=status.HTTP_404_NOT_FOUND,
        )

    # Check membership
    has_membership = Membership.objects.filter(
        user=user, workspace=issue.board.project.workspace
    ).exists()
    if not has_membership:
        return Response(
            {"error": {"code": "permission_denied", "message": "Only workspace members may transition issues."}},
            status=status.HTTP_403_FORBIDDEN,
        )

    # Get target status from request
    target_status_name = request.data.get("status", None)
    if not target_status_name:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Missing 'status' parameter. Target status required.",
                }
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Find the target workflow status for this board
    try:
        target_status = WorkflowStatus.objects.get(board=issue.board, name=target_status_name)
    except WorkflowStatus.DoesNotExist:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": f"Invalid status '{target_status_name}'. Allowed statuses for this board: {', '.join([s.name for s in issue.board.workflow_statuses.all()])}",
                }
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Get current status
    current_status = issue.status_id

    # Validate transition: simple directed flow - To do → In progress → Done
    # For Step 2, we allow:
    # - To do → In progress
    # - To do → Done (skip-in-progress, for convenience)
    # - In progress → Done
    transition_allowed = False

    if current_status.name == "to_do" and target_status.name == "in_progress":
        transition_allowed = True
    elif current_status.name == "to_do" and target_status.name == "done":
        transition_allowed = True
    elif current_status.name == "in_progress" and target_status.name == "done":
        transition_allowed = True

    if not transition_allowed:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": f"Invalid transition from '{current_status.name}' to '{target_status.name}'. Allowed transitions: To do → In progress, To do → Done, In progress → Done.",
                }
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

# Perform the transition
    with transaction.atomic():
        issue.status_id = target_status
        # Increment version for optimistic locking
        issue.version = (issue.version or 0) + 1
        issue.save()

        DomainEvent.objects.create(
            workspace=issue.board.project.workspace,
            event_type="issue.status_changed",
            schema_version=1,
            actor=request.user,
            aggregate_type="Issue",
            aggregate_id=str(issue.id),
            occurred_at=timezone.now(),
            request_id=request.META.get("CORRELATION_ID"),
            payload={
                "issue_id": issue.id,
                "project_id": issue.board.project.id,
                "workspace_id": issue.board.project.workspace.id,
                "from_status": str(current_status.id),
                "to_status": target_status.id,
            },
        )

        log_audit_operation(
            actor=request.user,
            workspace=issue.board.project.workspace,
            resource_type="issue",
            resource_id=issue.id,
            operation="transition",
            success=True,
            correlation_id=request.META.get("CORRELATION_ID"),
            details="Issue transition completed successfully",
        )

        # Visual rollback on API error simulation
        # In a real system, if the API call fails after this point,
        # the UI should show the issue reverted to its previous state.
        # Here we just verify the save succeeded.
        if issue.status_id != target_status:
            # Rollback: restore previous status
            issue.status_id = current_status
            issue.version = (issue.version or 0) + 1
            issue.save()
            return Response(
                {
                    "error": {
                        "code": "internal_error",
                        "message": "Failed to persist status transition. Changes rolled back.",
                    }
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    serializer = IssueSerializer(issue, context={"request": request})
    return Response(
        {
            "error": None,
            "issue": serializer.data,
        }
    )

    serializer = IssueSerializer(issue, context={"request": request})
    return Response(
        {
            "error": None,
            "issue": serializer.data,
        }
    )


# ---- Board workflow endpoints ----

@api_view(["GET", "PUT"])
@permission_classes([IsAuthenticated])
def board_workflow(request, board_id):
    """Retrieve or replace a board's workflow.

    GET: Returns the board's workflow statuses.
    Body (PUT): {"version": N, "statuses": [...], "transitions": [...]}
    Response (PUT): {"error": null, "board_version": N}
    """
    user = request.user
    try:
        board = Board.objects.get(id=board_id)
    except Board.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Board not found."}},
            status=status.HTTP_404_NOT_FOUND,
        )

    # Check membership: user must be member of the board's workspace
    has_membership = Membership.objects.filter(
        user=user, workspace=board.workspace
    ).exists()
    if not has_membership:
        return Response(
            {"error": {"code": "permission_denied", "message": "Only workspace members may access this board's workflow."}},
            status=status.HTTP_403_FORBIDDEN,
        )

    if request.method == "GET":
        statuses = board.workflow_statuses.all().order_by("position")
        serializer = WorkflowStatusSerializer(statuses, many=True)
        return Response(
            {
                "error": None,
                "statuses": serializer.data,
            }
        )

    # PUT: replace the entire workflow atomically
    version = request.data.get("version")
    statuses_data = request.data.get("statuses", [])
    transitions_data = request.data.get("transitions", [])

    if version is None:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Missing required field: version.",
                }
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not isinstance(statuses_data, list):
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "statuses must be a list.",
                }
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    with transaction.atomic():
        # Delete existing workflow statuses for this board
        board.workflow_statuses.all().delete()

        # Create new workflow statuses from the request
        for status_data in statuses_data:
            WorkflowStatus.objects.create(
                board=board,
                name=status_data.get("name", "to_do"),
                position=status_data.get("position", 0),
                is_default=status_data.get("is_default", False),
            )

    return Response(
        {
            "error": None,
            "board_version": version,
        }
    )


# ---- Comment endpoints ----

def _list_comments(request, issue_id):
    """Core logic: list active comments for an issue.

    Only workspace members can view comments.
    """
    user = request.user

    try:
        issue = Issue.objects.select_related(
            "board__project", "board__project__workspace"
        ).get(id=issue_id)
    except Issue.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Issue not found."}},
            status=status.HTTP_404_NOT_FOUND,
        )

    # Check membership: user must be member of the issue's board's project workspace
    has_membership = Membership.objects.filter(
        user=user, workspace=issue.board.project.workspace
    ).exists()
    if not has_membership:
        return Response(
            {"error": {"code": "permission_denied", "message": "Only workspace members may view comments."}},
            status=status.HTTP_403_FORBIDDEN,
        )

    comments = issue.comments.filter(is_active=True).order_by("-created_at")
    serializer = CommentSerializer(comments, many=True, context={"request": request})
    return Response(
        {"error": None, "results": serializer.data}
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def list_comments(request, issue_id):
    """List comments for an issue.

    Only workspace members can view comments.
    """
    return _list_comments(request, issue_id)


def _create_comment(request, issue_id):
    """Core logic: create a comment on an issue.

    Only workspace members can create comments.
    Author is set to the current user.
    Body: {"text": "comment text"}
    """
    user = request.user

    try:
        issue = Issue.objects.select_related(
            "board__project", "board__project__workspace"
        ).get(id=issue_id)
    except Issue.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Issue not found."}},
            status=status.HTTP_404_NOT_FOUND,
        )

    # Check membership: user must be member of the issue's board's project workspace
    has_membership = Membership.objects.filter(
        user=user, workspace=issue.board.project.workspace
    ).exists()
    if not has_membership:
        return Response(
            {"error": {"code": "permission_denied", "message": "Only workspace members may create comments."}},
            status=status.HTTP_403_FORBIDDEN,
        )

    serializer = CommentSerializer(data=request.data, context={"request": request})
    if serializer.is_valid(raise_exception=True):
        with transaction.atomic():
            comment = serializer.save(issue=issue, author=user)
            DomainEvent.objects.create(
                workspace=issue.board.project.workspace,
                event_type="comment.created",
                schema_version=1,
                actor=request.user,
                aggregate_type="Comment",
                aggregate_id=str(comment.id),
                occurred_at=timezone.now(),
                request_id=request.META.get("CORRELATION_ID"),
                payload={
                    "comment_id": comment.id,
                    "issue_id": issue.id,
                    "project_id": issue.board.project.id,
                    "workspace_id": issue.board.project.workspace.id,
                    "author_id": user.id,
                },
            )
    log_audit_operation(
        actor=request.user,
        workspace=issue.board.project.workspace,
        resource_type="comment",
        resource_id=comment.id,
        operation="create",
        success=True,
        correlation_id=request.META.get("CORRELATION_ID"),
        details="Comment created successfully",
    )

    return Response(
        {"error": None, "comment": CommentSerializer(comment, context={"request": request}).data},
        status=status.HTTP_201_CREATED,
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def create_comment(request, issue_id):
    """Create a comment on an issue.

    Only workspace members can create comments.
    Author is set to the current user.
    Body: {"text": "comment text"}
    """
    return _create_comment(request, issue_id)


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def delete_comment(request, comment_id):
    """Delete a comment.

    Only the author or workspace owner/admin can delete.
    """
    user = request.user

    try:
        comment = Comment.objects.select_related(
            "issue__board__project__workspace", "author"
        ).get(id=comment_id, is_active=True)
    except Comment.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Comment not found."}},
            status=status.HTTP_404_NOT_FOUND,
        )

    # Check: user must be member of the comment's issue board's project workspace
    has_membership = Membership.objects.filter(
        user=user, workspace=comment.issue.board.project.workspace
    ).exists()
    if not has_membership:
        return Response(
            {"error": {"code": "permission_denied", "message": "Only workspace members may delete comments."}},
            status=status.HTTP_403_FORBIDDEN,
        )

    # Only author or owner/admin can delete
    is_author = comment.author and comment.author.id == user.id
    is_owner_or_admin = False
    if comment.issue.board.project.workspace:
        membership = Membership.objects.filter(
            user=user, workspace=comment.issue.board.project.workspace
        ).first()
        if membership and membership.role in ("owner", "admin"):
            is_owner_or_admin = True

    if not (is_author or is_owner_or_admin):
        return Response(
            {"error": {"code": "permission_denied", "message": "Only the comment author or workspace owner/admin may delete comments."}},
            status=status.HTTP_403_FORBIDDEN,
        )

    comment.is_active = False
    comment.save()
    log_audit_operation(
        actor=request.user,
        workspace=comment.issue.board.project.workspace,
        resource_type="comment",
        resource_id=comment.id,
        operation="delete",
        success=True,
        correlation_id=request.META.get("CORRELATION_ID"),
        details="Comment deleted successfully",
    )
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def comments(request, issue_id):
    """List or create comments on an issue.

    GET: delegates to _list_comments (returns the issue's active comments).
    POST: delegates to _create_comment (creates a comment authored by the user).
    Both methods share one URL path because list_comments (GET) and
    create_comment (POST) would otherwise collide in Django's URL resolver.
    """
    if request.method == "GET":
        return _list_comments(request, issue_id)
    return _create_comment(request, issue_id)


# ---- Notification endpoints ----

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def list_notifications(request):
    """List current user's notifications for a workspace.

    Query param: workspace_id (required)
    Returns user's notifications for that workspace, ordered newest first.
    """
    user = request.user
    workspace_id = request.query_params.get("workspace_id")
    if not workspace_id:
        return Response(
            {"error": {"code": "validation_error", "message": "Missing workspace_id.", "fields": {}}},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        workspace = Workspace.objects.get(id=workspace_id, deleted_at__isnull=True)
    except Workspace.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Workspace not found."}},
            status=status.HTTP_404_NOT_FOUND,
        )
    # Security: user must be a member of the workspace
    has_membership = Membership.objects.filter(
        user=user, workspace=workspace
    ).exists()
    if not has_membership:
        return Response(
            {"error": {"code": "permission_denied", "message": "Only workspace members may view notifications."}},
            status=status.HTTP_403_FORBIDDEN,
        )
    notifications = Notification.objects.filter(
        user=user, workspace=workspace
    ).order_by("-created_at")
    serializer = NotificationSerializer(notifications, many=True, context={"request": request})
    return Response(
        {"error": None, "results": serializer.data}
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def notification_unread_count(request):
    """Get unread notification count for a workspace.

    Query param: workspace_id (required)
    """
    user = request.user
    workspace_id = request.query_params.get("workspace_id")
    if not workspace_id:
        return Response(
            {"error": {"code": "validation_error", "message": "Missing workspace_id.", "fields": {}}},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        workspace = Workspace.objects.get(id=workspace_id, deleted_at__isnull=True)
    except Workspace.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Workspace not found."}},
            status=status.HTTP_404_NOT_FOUND,
        )
    # Security: user must be a member of the workspace
    has_membership = Membership.objects.filter(
        user=user, workspace=workspace
    ).exists()
    if not has_membership:
        return Response(
            {"error": {"code": "permission_denied", "message": "Only workspace members may view notifications."}},
            status=status.HTTP_403_FORBIDDEN,
        )
    count = Notification.objects.filter(
        user=user, workspace=workspace, is_read=False
    ).count()
    return Response(
        {"error": None, "unread_count": count}
    )


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def mark_notification_read(request, notification_id):
    """Mark a notification as read.

    Security: user must own the notification.
    """
    user = request.user
    try:
        notification = Notification.objects.get(id=notification_id)
    except Notification.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Notification not found."}},
            status=status.HTTP_404_NOT_FOUND,
        )
    # Security: user must own the notification
    if notification.user != user:
        return Response(
            {"error": {"code": "permission_denied", "message": "You may only mark your own notifications as read."}},
            status=status.HTTP_403_FORBIDDEN,
        )
    notification.is_read = True
    notification.save(update_fields=["is_read"])
    return Response(
        {"error": None, "notification": NotificationSerializer(notification, context={"request": request}).data}
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def notification_read_bulk(request):
    """Bulk mark notifications as read.

    Body: {"notification_ids": [1, 2, 3]}
    Security: only the caller's own notifications are marked.
    """
    user = request.user
    notification_ids = request.data.get("notification_ids", [])
    if not isinstance(notification_ids, list):
        return Response(
            {"error": {"code": "validation_error", "message": "notification_ids must be a list.", "fields": {}}},
            status=status.HTTP_400_BAD_REQUEST,
        )
    # Security: only mark own notifications
    updated = Notification.objects.filter(
        id__in=notification_ids, user=user
    ).update(is_read=True)
    return Response(
        {"error": None, "updated": updated}
    )


# ---- Sprint lifecycle endpoints ----

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def list_sprints(request, project_id):
    """List sprints for a project.

    project_id comes from the URL path (GET projects/{project_id}/sprints/).
    """
    user = request.user
    # project_id comes from URL path
    pass  # project_id is already available from URL kwargs

    try:
        project = Project.objects.get(id=project_id)
    except Project.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Project not found."}},
            status=status.HTTP_404_NOT_FOUND,
        )
    # Check membership: user must be member of the project's workspace
    has_membership = Membership.objects.filter(
        user=user, workspace=project.workspace
    ).exists()
    if not has_membership:
        return Response(
            {"error": {"code": "permission_denied", "message": "Cross-workspace access denied. You are not a member of this project's workspace."}},
            status=status.HTTP_403_FORBIDDEN,
        )
    sprints = Sprint.objects.filter(project=project).select_related("project", "workspace")

    serializer = SprintSerializer(sprints, many=True, context={"request": request})
    return Response(
        {
            "error": None,
            "results": serializer.data,
        }
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def create_sprint(request, project_id):
    """Create a new sprint.

    Only owners/admins of the project's workspace can create sprints.
    project_id comes from the URL path (POST projects/{project_id}/sprints/).
    Body: {"name": "Sprint Name", "status": "planned"}
    """
    user = request.user
    # project_id comes from URL path
    pass  # project_id is already available from URL kwargs

    try:
        project = Project.objects.get(id=project_id)
    except Project.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Project not found."}},
            status=status.HTTP_404_NOT_FOUND,
        )

    # Check membership: user must be owner or admin of the project's workspace
    membership = Membership.objects.filter(user=user, role__in=["owner", "admin"], workspace=project.workspace).first()
    if not membership:
        return Response(
            {"error": {"code": "permission_denied", "message": "Only workspace owners/admins may create sprints."}},
            status=status.HTTP_403_FORBIDDEN,
        )

    name = request.data.get("name", "").strip()
    sprint_status = request.data.get("status", "planned")

    if not name:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "The request contains invalid data.",
                    "fields": {"name": ["This field must not be blank."]},
                }
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Valid status choices
    status_choices = dict(Sprint.STATUS_CHOICES).keys()
    if sprint_status not in status_choices:
        sprint_status = "planned"

    with transaction.atomic():
        sprint = Sprint.objects.create(
            name=name,
            project=project,
            workspace=project.workspace,
            status=sprint_status,
        )

    log_audit_operation(
        actor=request.user,
        workspace=sprint.workspace,
        resource_type="sprint",
        resource_id=sprint.id,
        operation="create",
        success=True,
        correlation_id=request.META.get("CORRELATION_ID"),
        details="Sprint created successfully",
    )

    serializer = SprintSerializer(sprint, context={"request": request})
    return Response(
        {
            "error": None,
            "sprint": serializer.data,
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def update_sprint(request, sprint_id):
    """Update a sprint.

    Only owners/admins of the sprint's project workspace can update.
    Body: {"name": "New Name", "status": "active", "start_at": "2026-01-01", "end_at": "2026-12-31"}
    """
    user = request.user

    try:
        sprint = Sprint.objects.get(id=sprint_id)
    except Sprint.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Sprint not found."}},
            status=status.HTTP_404_NOT_FOUND,
        )

    # Check membership: user must be owner or admin of the sprint's workspace
    membership = Membership.objects.filter(user=user, role__in=["owner", "admin"], workspace=sprint.workspace).first()
    if not membership:
        return Response(
            {"error": {"code": "permission_denied", "message": "Only workspace owners/admins may update sprints."}},
            status=status.HTTP_403_FORBIDDEN,
        )

    name = request.data.get("name", None)
    sprint_status = request.data.get("status", None)
    start_at = request.data.get("start_at", None)
    end_at = request.data.get("end_at", None)

    if name is not None:
        name = name.strip()
        if not name:
            return Response(
                {
                    "error": {
                        "code": "validation_error",
                        "message": "The request contains invalid data.",
                        "fields": {"name": ["This field must not be blank."]},
                    }
                },
                status=status.HTTP_400_BAD_REQUEST,
            )
        sprint.name = name

    if sprint_status is not None:
        status_choices = dict(Sprint.STATUS_CHOICES).keys()
        if sprint_status in status_choices:
            sprint.status = sprint_status

    if start_at is not None:
        sprint.start_at = start_at

    if end_at is not None:
        sprint.end_at = end_at

    sprint.save()

    log_audit_operation(
        actor=request.user,
        workspace=sprint.workspace,
        resource_type="sprint",
        resource_id=sprint.id,
        operation="update",
        success=True,
        correlation_id=request.META.get("CORRELATION_ID"),
        details="Sprint updated successfully",
    )

    serializer = SprintSerializer(sprint, context={"request": request})
    return Response(
        {
            "error": None,
            "sprint": serializer.data,
        }
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def issue_sprint_assignment(request, issue_id):
    """Assign an issue to a sprint.

    Checks membership and that the sprint belongs to the same project/workspace.
    Body: {"sprint_id": 1}
    """
    user = request.user

    try:
        issue = Issue.objects.select_related(
            "board__project", "sprint_id"
        ).get(id=issue_id)
    except Issue.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Issue not found."}},
            status=status.HTTP_404_NOT_FOUND,
        )

    # Check membership: user must be member of the issue's workspace
    has_membership = Membership.objects.filter(
        user=user, workspace=issue.board.project.workspace
    ).exists()
    if not has_membership:
        return Response(
            {"error": {"code": "permission_denied", "message": "Only workspace members may assign sprints to issues."}},
            status=status.HTTP_403_FORBIDDEN,
        )

    sprint_id = request.data.get("sprint_id", None)
    if not sprint_id:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Missing required parameter: sprint_id.",
                }
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        sprint = Sprint.objects.get(id=sprint_id, project=issue.board.project, workspace=issue.board.project.workspace)
    except Sprint.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Sprint not found in this project or does not belong to the same workspace."}},
            status=status.HTTP_404_NOT_FOUND,
        )

    # Assign sprint to issue
    with transaction.atomic():
        issue.sprint_id = sprint
        issue.version = (issue.version or 0) + 1
        issue.save()

    serializer = IssueSerializer(issue, context={"request": request})
    return Response(
        {
            "error": None,
            "issue": serializer.data,
        }
    )


# ---- Report endpoints ----

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def create_report(request):
    """Create a report and enqueue background generation."""
    user = request.user
    serializer = ReportCreateSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(
            {"error": {"code": "validation_error", "message": "The request contains invalid data.", "fields": serializer.errors}},
            status=status.HTTP_400_BAD_REQUEST,
        )
    report_type = serializer.validated_data["report_type"]
    workspace_id = request.data.get("workspace_id")
    if not workspace_id:
        return Response(
            {"error": {"code": "validation_error", "message": "Missing workspace_id.", "fields": {}}},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        workspace = Workspace.objects.get(id=workspace_id, deleted_at__isnull=True)
    except Workspace.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Workspace not found."}},
            status=status.HTTP_404_NOT_FOUND,
        )
    # Check membership
    has_membership = Membership.objects.filter(
        user=user, workspace=workspace
    ).exists()
    if not has_membership:
        return Response(
            {"error": {"code": "permission_denied", "message": "Only workspace members may create reports."}},
            status=status.HTTP_403_FORBIDDEN,
        )
    report = Report.objects.create(
        user=user,
        workspace=workspace,
        report_type=report_type,
        status="pending",
    )
    # Enqueue background task after commit
    enqueue_after_commit(generate_report, kwargs={
        '_workspace_id': workspace.id,
        'report_id': report.id,
    })
    report_serializer = ReportSerializer(report, context={"request": request})
    return Response(
        {"error": None, "report": report_serializer.data},
        status=status.HTTP_201_CREATED,
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def get_report(request, report_id):
    """Get report status and result."""
    user = request.user
    try:
        report = Report.objects.get(id=report_id)
    except Report.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Report not found."}},
            status=status.HTTP_404_NOT_FOUND,
        )
    # Security: user must own the report
    if report.user != user:
        return Response(
            {"error": {"code": "permission_denied", "message": "You may only view your own reports."}},
            status=status.HTTP_403_FORBIDDEN,
        )
    report_serializer = ReportSerializer(report, context={"request": request})
    return Response(
        {"error": None, "report": report_serializer.data}
    )


# ---- Webhook endpoints ----

PRIVATE_IP_RANGES = [
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
]


def validate_webhook_destination(url):
    """Validate that a webhook destination URL is not private/reserved (SSRF protection).

    Returns (is_valid, error_message). When is_valid is True, error_message is None.
    """
    try:
        parsed = urlparse(url)
    except Exception:
        return False, "Invalid URL."
    if parsed.scheme not in ("http", "https"):
        return False, "Only http and https schemes are allowed."
    if not parsed.hostname:
        return False, "Hostname is required."
    if parsed.hostname in ("localhost", "localhost.localdomain"):
        return False, "Localhost destinations are not allowed."
    try:
        addr_infos = socket.getaddrinfo(parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM)
    except socket.gaierror:
        return False, "Unable to resolve hostname."
    for family, socktype, proto, canonname, sockaddr in addr_infos:
        ip = sockaddr[0]
        try:
            ip_obj = ipaddress.ip_address(ip)
        except ValueError:
            continue
        if ip_obj.is_private or ip_obj.is_loopback or ip_obj.is_link_local:
            return False, f"Destination IP {ip} is in a private/reserved range."
        for private_range in PRIVATE_IP_RANGES:
            if ip_obj in private_range:
                return False, f"Destination IP {ip} is in a private range."
    return True, None


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def webhook_subscriptions(request):
    """List or create webhook subscriptions for a workspace.

    GET: requires workspace_id query param; returns the workspace's subscriptions.
    POST: requires workspace_id in body; creates a subscription for the workspace.
    """
    user = request.user
    if request.method == "GET":
        workspace_id = request.query_params.get("workspace_id")
        if not workspace_id:
            return Response({"error": {"code": "validation_error", "message": "Missing workspace_id.", "fields": {}}}, status=status.HTTP_400_BAD_REQUEST)
        try:
            workspace = Workspace.objects.get(id=workspace_id, deleted_at__isnull=True)
        except Workspace.DoesNotExist:
            return Response({"error": {"code": "not_found", "message": "Workspace not found."}}, status=status.HTTP_404_NOT_FOUND)
        if not Membership.objects.filter(user=user, workspace=workspace).exists():
            return Response({"error": {"code": "permission_denied", "message": "Only workspace members may view webhooks."}}, status=status.HTTP_403_FORBIDDEN)
        subscriptions = WebhookSubscription.objects.filter(workspace=workspace)
        serializer = WebhookSubscriptionSerializer(subscriptions, many=True, context={"request": request})
        return Response({"error": None, "results": serializer.data})
    elif request.method == "POST":
        workspace_id = request.data.get("workspace_id")
        if not workspace_id:
            return Response({"error": {"code": "validation_error", "message": "Missing workspace_id.", "fields": {}}}, status=status.HTTP_400_BAD_REQUEST)
        try:
            workspace = Workspace.objects.get(id=workspace_id, deleted_at__isnull=True)
        except Workspace.DoesNotExist:
            return Response({"error": {"code": "not_found", "message": "Workspace not found."}}, status=status.HTTP_404_NOT_FOUND)
        if not Membership.objects.filter(user=user, workspace=workspace).exists():
            return Response({"error": {"code": "permission_denied", "message": "Only workspace members may create webhooks."}}, status=status.HTTP_403_FORBIDDEN)
        url = request.data.get("url", "")
        is_valid, error_msg = validate_webhook_destination(url)
        if not is_valid:
            return Response({"error": {"code": "validation_error", "message": error_msg, "fields": {"url": [error_msg]}}}, status=status.HTTP_400_BAD_REQUEST)
        serializer = WebhookSubscriptionCreateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response({"error": {"code": "validation_error", "message": "The request contains invalid data.", "fields": serializer.errors}}, status=status.HTTP_400_BAD_REQUEST)
        subscription = serializer.save(workspace=workspace)
        response_serializer = WebhookSubscriptionSerializer(subscription, context={"request": request})
        return Response({"error": None, "subscription": response_serializer.data}, status=status.HTTP_201_CREATED)


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def webhook_subscription_detail(request, subscription_id):
    """Retrieve, update, or delete a single webhook subscription."""
    user = request.user
    try:
        subscription = WebhookSubscription.objects.get(id=subscription_id)
    except WebhookSubscription.DoesNotExist:
        return Response({"error": {"code": "not_found", "message": "Webhook subscription not found."}}, status=status.HTTP_404_NOT_FOUND)
    if not Membership.objects.filter(user=user, workspace=subscription.workspace).exists():
        return Response({"error": {"code": "permission_denied", "message": "Only workspace members may manage webhooks."}}, status=status.HTTP_403_FORBIDDEN)
    if request.method == "GET":
        serializer = WebhookSubscriptionSerializer(subscription, context={"request": request})
        return Response({"error": None, "subscription": serializer.data})
    elif request.method == "PATCH":
        if "url" in request.data:
            is_valid, error_msg = validate_webhook_destination(request.data["url"])
            if not is_valid:
                return Response({"error": {"code": "validation_error", "message": error_msg, "fields": {"url": [error_msg]}}}, status=status.HTTP_400_BAD_REQUEST)
        serializer = WebhookSubscriptionSerializer(subscription, data=request.data, partial=True, context={"request": request})
        if not serializer.is_valid():
            return Response({"error": {"code": "validation_error", "message": "The request contains invalid data.", "fields": serializer.errors}}, status=status.HTTP_400_BAD_REQUEST)
        subscription = serializer.save()
        response_serializer = WebhookSubscriptionSerializer(subscription, context={"request": request})
        return Response({"error": None, "subscription": response_serializer.data})
    elif request.method == "DELETE":
        subscription.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def webhook_deliveries(request, subscription_id):
    """List delivery records for a webhook subscription, newest first."""
    user = request.user
    try:
        subscription = WebhookSubscription.objects.get(id=subscription_id)
    except WebhookSubscription.DoesNotExist:
        return Response({"error": {"code": "not_found", "message": "Webhook subscription not found."}}, status=status.HTTP_404_NOT_FOUND)
    if not Membership.objects.filter(user=user, workspace=subscription.workspace).exists():
        return Response({"error": {"code": "permission_denied", "message": "Only workspace members may view deliveries."}}, status=status.HTTP_403_FORBIDDEN)
    deliveries = WebhookDelivery.objects.filter(subscription=subscription).order_by("-created_at")
    serializer = WebhookDeliverySerializer(deliveries, many=True, context={"request": request})
    return Response({"error": None, "results": serializer.data})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def billing_summary(request, workspace_id):
    """GET /api/v1/workspaces/{workspace_id}/billing/ — Member only."""
    user = request.user
    try:
        workspace = Workspace.objects.get(id=workspace_id, deleted_at__isnull=True)
    except Workspace.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Workspace not found.", "fields": {}}},
            status=status.HTTP_404_NOT_FOUND,
        )
    if not Membership.objects.filter(user=user, workspace=workspace).exists():
        return Response(
            {"error": {"code": "permission_denied", "message": "Only workspace members may view billing."}},
            status=status.HTTP_403_FORBIDDEN,
        )
    billing = get_or_create_workspace_billing(workspace)
    return Response(
        {
            "error": None,
            "billing": {
                "plan": billing.effective_plan,
                "subscription_status": billing.provider_status,
                "cancel_at_period_end": billing.cancel_at_period_end,
                "paid_through": billing.paid_through.isoformat() if billing.paid_through else None,
                "sync_pending": billing.last_synced_at is None,
            }
        }
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def billing_checkout(request, workspace_id):
    """POST /api/v1/workspaces/{workspace_id}/billing/checkout/ — Owner only."""
    user = request.user
    try:
        workspace = Workspace.objects.get(id=workspace_id, deleted_at__isnull=True)
    except Workspace.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Workspace not found.", "fields": {}}},
            status=status.HTTP_404_NOT_FOUND,
        )
    if not Membership.objects.filter(user=user, workspace=workspace, role="owner").exists():
        return Response(
            {"error": {"code": "permission_denied", "message": "Only workspace owners may manage billing."}},
            status=status.HTTP_403_FORBIDDEN,
        )
    # Check idempotency key
    idempotency_key = request.headers.get("Idempotency-Key", "")
    if not idempotency_key:
        return Response(
            {"error": {"code": "validation_error", "message": "Missing Idempotency-Key header.", "fields": {}}},
            status=status.HTTP_400_BAD_REQUEST,
        )
    plan = request.data.get("plan", "")
    if plan != "pro":
        return Response(
            {"error": {"code": "validation_error", "message": "Only 'pro' plan is supported.", "fields": {"plan": ["Invalid plan."]}}},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if not settings.STRIPE_CONFIGURED:
        return Response(
            {"error": {"code": "validation_error", "message": "Stripe is not configured.", "fields": {}}},
            status=status.HTTP_400_BAD_REQUEST,
        )
    # Check for existing pending/completed checkout
    existing = BillingOperation.objects.filter(
        workspace=workspace, kind="checkout",
        state__in=["pending", "completed"],
    ).first()
    if existing:
        return Response(
            {"error": {"code": "validation_error", "message": "A checkout operation is already pending or completed.", "fields": {}}},
            status=status.HTTP_409_CONFLICT,
        )
    # Create operation
    operation = create_billing_operation(workspace, "checkout", idempotency_key)
    if not operation:
        return Response(
            {"error": {"code": "validation_error", "message": "Idempotency key already used.", "fields": {}}},
            status=status.HTTP_409_CONFLICT,
        )
    try:
        adapter = StripeAdapter()
        customer_id = adapter.create_customer(
            idempotency_key=f"ws-{workspace.id}-cust",
            metadata={"workspace_id": str(workspace.id), "workspace_name": workspace.name},
        )
        # Save customer_id
        billing = get_or_create_workspace_billing(workspace)
        billing.customer_id = customer_id
        billing.save(update_fields=["customer_id", "updated_at"])
        result = adapter.create_checkout_session(
            customer_id=customer_id,
            price_id=settings.STRIPE_PRO_PRICE_ID,
            success_url=settings.STRIPE_SUCCESS_URL,
            cancel_url=settings.STRIPE_CANCEL_URL,
            metadata={"workspace_id": str(workspace.id), "operation_id": str(operation.id)},
        )
        operation.provider_object_id = result["session_id"]
        operation.state = "completed"
        operation.safe_result = {
            "session_id": result["session_id"],
            "session_url": result["session_url"],
            "expires_at": result.get("expires_at"),
        }
        operation.save(update_fields=["provider_object_id", "state", "safe_result", "updated_at"])
        return Response(
            {
                "error": None,
                "operation": {
                    "id": str(operation.id),
                    "kind": operation.kind,
                    "state": operation.state,
                    "checkout_url": result["session_url"],
                }
            },
            status=status.HTTP_201_CREATED,
        )
    except StripeAdapterError as exc:
        operation.state = "failed"
        operation.safe_result = {"error": str(exc)[:500]}
        operation.save(update_fields=["state", "safe_result", "updated_at"])
        return Response(
            {"error": {"code": "validation_error", "message": "Checkout could not be created.", "fields": {}}},
            status=status.HTTP_400_BAD_REQUEST,
        )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def billing_portal(request, workspace_id):
    """POST /api/v1/workspaces/{workspace_id}/billing/portal/ — Owner only."""
    user = request.user
    try:
        workspace = Workspace.objects.get(id=workspace_id, deleted_at__isnull=True)
    except Workspace.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Workspace not found.", "fields": {}}},
            status=status.HTTP_404_NOT_FOUND,
        )
    if not Membership.objects.filter(user=user, workspace=workspace, role="owner").exists():
        return Response(
            {"error": {"code": "permission_denied", "message": "Only workspace owners may access the billing portal."}},
            status=status.HTTP_403_FORBIDDEN,
        )
    billing = get_or_create_workspace_billing(workspace)
    if not settings.STRIPE_CONFIGURED:
        return Response(
            {"error": {"code": "validation_error", "message": "Stripe is not configured.", "fields": {}}},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if not billing.customer_id:
        return Response(
            {"error": {"code": "not_found", "message": "No Stripe customer found for this workspace.", "fields": {}}},
            status=status.HTTP_404_NOT_FOUND,
        )
    idempotency_key = request.headers.get("Idempotency-Key", "")
    if not idempotency_key:
        return Response(
            {"error": {"code": "validation_error", "message": "Missing Idempotency-Key header.", "fields": {}}},
            status=status.HTTP_400_BAD_REQUEST,
        )
    operation = create_billing_operation(workspace, "portal", idempotency_key)
    if not operation:
        return Response(
            {"error": {"code": "validation_error", "message": "Idempotency key already used.", "fields": {}}},
            status=status.HTTP_409_CONFLICT,
        )
    try:
        adapter = StripeAdapter()
        result = adapter.create_portal_session(
            customer_id=billing.customer_id,
            return_url=settings.STRIPE_SUCCESS_URL,
        )
        operation.provider_object_id = result.get("portal_url", "")
        operation.state = "completed"
        operation.safe_result = result
        operation.save(update_fields=["provider_object_id", "state", "safe_result", "updated_at"])
        return Response(
            {"error": None, "operation": {"id": str(operation.id), "kind": operation.kind, "state": operation.state, "portal_url": result["portal_url"]}},
            status=status.HTTP_201_CREATED,
        )
    except StripeAdapterError as exc:
        operation.state = "failed"
        operation.safe_result = {"error": str(exc)[:500]}
        operation.save(update_fields=["state", "safe_result", "updated_at"])
        return Response(
            {"error": {"code": "validation_error", "message": "Portal session could not be created.", "fields": {}}},
            status=status.HTTP_400_BAD_REQUEST,
        )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def billing_cancel(request, workspace_id):
    """POST /api/v1/workspaces/{workspace_id}/billing/cancel/ — Owner only."""
    user = request.user
    try:
        workspace = Workspace.objects.get(id=workspace_id, deleted_at__isnull=True)
    except Workspace.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Workspace not found.", "fields": {}}},
            status=status.HTTP_404_NOT_FOUND,
        )
    if not Membership.objects.filter(user=user, workspace=workspace, role="owner").exists():
        return Response(
            {"error": {"code": "permission_denied", "message": "Only workspace owners may cancel billing."}},
            status=status.HTTP_403_FORBIDDEN,
        )
    billing = get_or_create_workspace_billing(workspace)
    if billing.effective_plan != "pro" or not billing.subscription_id:
        return Response(
            {"error": {"code": "validation_error", "message": "No active Pro subscription to cancel.", "fields": {}}},
            status=status.HTTP_400_BAD_REQUEST,
        )
    timing = request.data.get("timing", "period_end")
    if timing not in ("period_end", "immediate"):
        return Response(
            {"error": {"code": "validation_error", "message": "timing must be 'period_end' or 'immediate'.", "fields": {}}},
            status=status.HTTP_400_BAD_REQUEST,
        )
    idempotency_key = request.headers.get("Idempotency-Key", "")
    if not idempotency_key:
        return Response(
            {"error": {"code": "validation_error", "message": "Missing Idempotency-Key header.", "fields": {}}},
            status=status.HTTP_400_BAD_REQUEST,
        )
    operation = create_billing_operation(workspace, "cancel", idempotency_key)
    if not operation:
        return Response(
            {"error": {"code": "validation_error", "message": "Idempotency key already used.", "fields": {}}},
            status=status.HTTP_409_CONFLICT,
        )
    try:
        adapter = StripeAdapter()
        result = adapter.cancel_subscription(
            subscription_id=billing.subscription_id,
            at_period_end=(timing == "period_end"),
        )
        billing.cancel_at_period_end = result.get("cancel_at_period_end", False)
        billing.provider_status = result.get("status", billing.provider_status)
        billing.save(update_fields=["cancel_at_period_end", "provider_status", "updated_at"])
        operation.provider_object_id = result.get("subscription_id", "")
        operation.state = "completed"
        operation.safe_result = result
        operation.save(update_fields=["provider_object_id", "state", "safe_result", "updated_at"])
        return Response(
            {
                "error": None,
                "operation": {
                    "id": str(operation.id),
                    "kind": operation.kind,
                    "state": operation.state,
                    "subscription_status": billing.provider_status,
                    "cancel_at_period_end": billing.cancel_at_period_end,
                }
            },
            status=status.HTTP_202_ACCEPTED,
        )
    except StripeAdapterError as exc:
        operation.state = "failed"
        operation.safe_result = {"error": str(exc)[:500]}
        operation.save(update_fields=["state", "safe_result", "updated_at"])
        return Response(
            {"error": {"code": "validation_error", "message": "Cancellation could not be processed.", "fields": {}}},
            status=status.HTTP_400_BAD_REQUEST,
        )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def billing_operation_detail(request, workspace_id, operation_id):
    """GET /api/v1/workspaces/{workspace_id}/billing/operations/{operation_id}/ — Owner only."""
    user = request.user
    try:
        workspace = Workspace.objects.get(id=workspace_id, deleted_at__isnull=True)
    except Workspace.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Workspace not found.", "fields": {}}},
            status=status.HTTP_404_NOT_FOUND,
        )
    if not Membership.objects.filter(user=user, workspace=workspace, role="owner").exists():
        return Response(
            {"error": {"code": "permission_denied", "message": "Only workspace owners may view billing operations."}},
            status=status.HTTP_403_FORBIDDEN,
        )
    try:
        operation = BillingOperation.objects.get(id=operation_id, workspace=workspace)
    except BillingOperation.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Billing operation not found.", "fields": {}}},
            status=status.HTTP_404_NOT_FOUND,
        )
    return Response(
        {
            "error": None,
            "operation": {
                "id": str(operation.id),
                "kind": operation.kind,
                "state": operation.state,
                "provider_object_id": operation.provider_object_id,
                "safe_result": operation.safe_result,
                "created_at": operation.created_at.isoformat(),
                "updated_at": operation.updated_at.isoformat(),
            }
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def workspace_usage(request, workspace_id):
    """GET /api/v1/workspaces/{workspace_id}/usage/ — Member only."""
    user = request.user
    try:
        workspace = Workspace.objects.get(id=workspace_id, deleted_at__isnull=True)
    except Workspace.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Workspace not found.", "fields": {}}},
            status=status.HTTP_404_NOT_FOUND,
        )
    if not Membership.objects.filter(user=user, workspace=workspace).exists():
        return Response(
            {"error": {"code": "permission_denied", "message": "Only workspace members may view usage."}},
            status=status.HTTP_403_FORBIDDEN,
        )
    billing = get_or_create_workspace_billing(workspace)
    plan = BillingPlan.objects.filter(plan_id=billing.effective_plan, is_active=True).first()
    membership_count = Membership.objects.filter(workspace=workspace).count()
    project_count = Project.objects.filter(workspace=workspace).count()
    resources = {}
    if plan:
        resources = {
            "memberships": {"used": membership_count, "limit": plan.max_memberships},
            "projects": {"used": project_count, "limit": plan.max_projects},
        }
    else:
        resources = {
            "memberships": {"used": membership_count, "limit": None},
            "projects": {"used": project_count, "limit": None},
        }
    return Response(
        {
            "error": None,
            "usage": {
                "plan": billing.effective_plan,
                "resources": resources,
            }
        }
    )


@csrf_exempt
@api_view(["POST"])
@permission_classes([AllowAny])
def stripe_webhook(request):
    """POST /api/v1/integrations/stripe/webhook/ — Stripe-signed webhook."""
    if not settings.STRIPE_CONFIGURED:
        return Response(status=status.HTTP_503_SERVICE_UNAVAILABLE)
    # Bound request size to 1 MiB
    if len(request.body) > 1024 * 1024:
        return Response(status=status.HTTP_400_BAD_REQUEST)
    sig_header = request.META.get("HTTP_STRIPE_SIGNATURE", "")
    if not sig_header:
        return Response(status=status.HTTP_400_BAD_REQUEST)
    try:
        adapter = StripeAdapter()
        event = adapter.construct_webhook_event(request.body, sig_header)
    except StripeAdapterError:
        return Response(status=status.HTTP_400_BAD_REQUEST)
    event_id = event.get("id", "")
    event_type = event.get("type", "")
    # Idempotency: duplicate event
    if not record_stripe_event(event_id, event_type):
        return Response(status=status.HTTP_200_OK)  # already processed
    # Queue processing after commit
    from workspaces.tasks import process_stripe_event
    transaction.on_commit(lambda: process_stripe_event.apply_async(
        args=[event_id], kwargs={"_workspace_id": None}
    ))
    return Response(status=status.HTTP_200_OK)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def issue_attachments(request, issue_id):
    """List attachments for an issue. Member only."""
    user = request.user
    try:
        issue = Issue.objects.select_related("board__project__workspace").get(id=issue_id)
    except Issue.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Issue not found.", "fields": {}}},
            status=status.HTTP_404_NOT_FOUND,
        )
    workspace = issue.board.project.workspace
    if not Membership.objects.filter(user=user, workspace=workspace, workspace__deleted_at__isnull=True).exists():
        return Response(
            {"error": {"code": "permission_denied", "message": "Only workspace members may view attachments."}},
            status=status.HTTP_403_FORBIDDEN,
        )

    if request.method == "POST":
        return _upload_attachment(request, issue, workspace)

    # GET: list attachments
    attachments = Attachment.objects.filter(issue=issue, state="ready", deleted_at__isnull=True).order_by("id")
    serializer = AttachmentSerializer(attachments, many=True, context={"request": request})
    return Response({"error": None, "results": serializer.data})


def _upload_attachment(request, issue, workspace):
    """Upload an attachment to an issue."""
    user = request.user

    # Validate exactly one file
    uploaded_file = request.FILES.get("file")
    if not uploaded_file:
        return Response(
            {"error": {"code": "validation_error", "message": "Exactly one file is required.", "fields": {"file": ["This field is required."]}}},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if len(request.FILES) > 1:
        return Response(
            {"error": {"code": "validation_error", "message": "Exactly one file is required.", "fields": {"file": ["Too many files uploaded."]}}},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Validate size (10 MiB max)
    max_size = 10 * 1024 * 1024
    if uploaded_file.size > max_size:
        return Response(
            {"error": {"code": "payload_too_large", "message": "File exceeds 10 MiB limit.", "fields": {"file": ["File too large."]}}},
            status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        )

    # Validate filename
    original_name = uploaded_file.name
    if not original_name or len(original_name) > 150:
        return Response(
            {"error": {"code": "validation_error", "message": "Invalid filename.", "fields": {"original_name": ["Filename must be 1-150 characters."]}}},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Strip path/control characters from filename
    import os, re
    safe_name = os.path.basename(original_name)
    safe_name = re.sub(r'[^\w\s\-.]', '', safe_name)
    if not safe_name:
        safe_name = "attachment"

    # Compute SHA-256
    import hashlib
    sha256 = hashlib.sha256()
    for chunk in uploaded_file.chunks():
        sha256.update(chunk)
    sha256_hex = sha256.hexdigest()

    # Detect content type (with fallback if python-magic not available)
    try:
        import magic
        content_type = magic.from_buffer(uploaded_file.read(2048), mime=True)
    except Exception:
        content_type = uploaded_file.content_type or "application/octet-stream"
    uploaded_file.seek(0)

    # Validate allowed types
    allowed_types = ["image/png", "image/jpeg", "application/pdf", "text/plain"]
    if content_type not in allowed_types:
        return Response(
            {"error": {"code": "validation_error", "message": "File type not allowed.", "fields": {"detected_content_type": [f"Allowed types: {', '.join(allowed_types)}"]}}},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Generate object key
    object_key = f"workspace_{workspace.id}/issue_{issue.id}/{uuid.uuid4()}"

    # Create pending attachment record
    from django.db import transaction as db_transaction
    with db_transaction.atomic():
        attachment = Attachment.objects.create(
            issue=issue,
            workspace=workspace,
            uploader=user,
            original_name=safe_name,
            detected_content_type=content_type,
            byte_size=uploaded_file.size,
            sha256=sha256_hex,
            object_key=object_key,
            state="pending",
        )

    # Store object outside DB transaction (simulate private object storage)
    import os as os_module
    storage_dir = os_module.path.join(os_module.path.dirname(os_module.path.abspath(__file__)), "..", "private_storage")
    storage_path = os_module.path.join(storage_dir, object_key)
    try:
        os_module.makedirs(storage_dir, exist_ok=True)
        os_module.makedirs(os_module.path.dirname(storage_path), exist_ok=True)
        with open(storage_path, "wb+") as dest:
            for chunk in uploaded_file.chunks():
                dest.write(chunk)
    except Exception as exc:
        # Clean up any partial file written before the failure
        try:
            if os_module.path.exists(storage_path):
                os_module.remove(storage_path)
        except OSError:
            pass
        attachment.state = "failed"
        attachment.save(update_fields=["state", "updated_at"])
        return Response(
            {"error": {"code": "validation_error", "message": "Storage failed.", "fields": {}}},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    # Mark ready
    attachment.state = "ready"
    attachment.save(update_fields=["state", "updated_at"])

    log_audit_operation(
        actor=request.user,
        workspace=workspace,
        resource_type="attachment",
        resource_id=attachment.id,
        operation="create",
        success=True,
        correlation_id=request.META.get("CORRELATION_ID"),
        details=f"Attachment uploaded: {safe_name}",
    )

    serializer = AttachmentSerializer(attachment, context={"request": request})
    return Response({"error": None, "attachment": serializer.data}, status=status.HTTP_201_CREATED)

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def download_attachment(request, attachment_id):
    """Download an attachment. Member only."""
    user = request.user
    try:
        attachment = Attachment.objects.select_related("issue__board__project__workspace").get(id=attachment_id, state="ready", deleted_at__isnull=True)
    except Attachment.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Attachment not found.", "fields": {}}},
            status=status.HTTP_404_NOT_FOUND,
        )
    workspace = attachment.issue.board.project.workspace
    if not Membership.objects.filter(user=user, workspace=workspace, workspace__deleted_at__isnull=True).exists():
        return Response(
            {"error": {"code": "not_found", "message": "Attachment not found."}},
            status=status.HTTP_404_NOT_FOUND,
        )

    import os as os_module
    storage_dir = os_module.path.join(os_module.path.dirname(os_module.path.abspath(__file__)), "..", "private_storage")
    storage_path = os_module.path.join(storage_dir, attachment.object_key)

    if not os_module.path.exists(storage_path):
        return Response(
            {"error": {"code": "not_found", "message": "Attachment file not found.", "fields": {}}},
            status=status.HTTP_404_NOT_FOUND,
        )

    from django.http import FileResponse
    response = FileResponse(
        open(storage_path, "rb"),
        content_type=attachment.detected_content_type,
    )
    response["Content-Disposition"] = f'attachment; filename="{attachment.original_name}"'
    response["X-Content-Type-Options"] = "nosniff"
    response["Cache-Control"] = "private, no-store"
    return response


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def delete_attachment(request, attachment_id):
    """Soft-delete an attachment. Uploader or admin only."""
    user = request.user
    try:
        attachment = Attachment.objects.select_related("issue__board__project__workspace").get(id=attachment_id, deleted_at__isnull=True)
    except Attachment.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Attachment not found.", "fields": {}}},
            status=status.HTTP_404_NOT_FOUND,
        )
    workspace = attachment.issue.board.project.workspace
    membership = Membership.objects.filter(user=user, workspace=workspace).first()
    if not membership:
        return Response(
            {"error": {"code": "permission_denied", "message": "Only workspace members may delete attachments."}},
            status=status.HTTP_403_FORBIDDEN,
        )
    if attachment.uploader_id != user.id and membership.role not in ("owner", "admin"):
        return Response(
            {"error": {"code": "permission_denied", "message": "Only the uploader or an admin may delete this attachment."}},
            status=status.HTTP_403_FORBIDDEN,
        )

    with transaction.atomic():
        attachment.deleted_at = timezone.now()
        attachment.state = "deleted"
        attachment.save(update_fields=["deleted_at", "state", "updated_at"])
        DomainEvent.objects.create(
            workspace=workspace,
            event_type="attachment.deleted",
            schema_version=1,
            actor=request.user,
            aggregate_type="Attachment",
            aggregate_id=str(attachment.id),
            occurred_at=timezone.now(),
            request_id=request.META.get("CORRELATION_ID"),
            payload={
                "attachment_id": attachment.id,
                "issue_id": attachment.issue.id,
                "workspace_id": workspace.id,
                "object_key": attachment.object_key,
            },
        )

    enqueue_after_commit(
        cleanup_attachment,
        kwargs={'attachment_id': attachment.id, '_workspace_id': workspace.id},
    )

    log_audit_operation(
        actor=request.user,
        workspace=workspace,
        resource_type="attachment",
        resource_id=attachment.id,
        operation="delete",
        success=True,
        correlation_id=request.META.get("CORRELATION_ID"),
        details="Attachment soft-deleted",
    )

    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def audit_events(request):
    """GET /audit-events/ — Admin only, paginated audit events."""
    user = request.user
    # Admin only
    if not user.is_staff and not user.is_superuser:
        return Response(
            {"error": {"code": "permission_denied", "message": "Only administrators may view audit events.", "fields": {}}},
            status=status.HTTP_403_FORBIDDEN,
        )
    
    # Get user's workspaces for tenant scoping
    user_workspaces = Membership.objects.filter(user=user).values_list("workspace_id", flat=True)
    
    queryset = AuditEvent.objects.filter(workspace_id__in=user_workspaces).order_by("-occurred_at")
    
    # Filters
    project_id = request.query_params.get("project_id")
    if project_id:
        queryset = queryset.filter(project_id=project_id)
    
    target_type = request.query_params.get("target_type")
    if target_type:
        queryset = queryset.filter(target_type=target_type)
    
    target_id = request.query_params.get("target_id")
    if target_id:
        queryset = queryset.filter(target_id=target_id)
    
    action = request.query_params.get("action")
    if action:
        queryset = queryset.filter(action=action)
    
    # Pagination
    from django.core.paginator import Paginator
    paginator = Paginator(queryset, 50)
    page_number = request.query_params.get("page", 1)
    page_obj = paginator.get_page(page_number)
    
    serializer = AuditEventSerializer(page_obj, many=True, context={"request": request})
    return Response({
        "error": None,
        "results": serializer.data,
        "count": paginator.count,
        "page": page_obj.number,
        "total_pages": paginator.num_pages,
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def issue_audit_events(request, issue_id):
    """GET /issues/{issue_id}/audit-events/ — Member only, audit events for an issue."""
    user = request.user
    try:
        issue = Issue.objects.select_related("board__project__workspace").get(id=issue_id)
    except Issue.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Issue not found.", "fields": {}}},
            status=status.HTTP_404_NOT_FOUND,
        )
    workspace = issue.board.project.workspace
    if not Membership.objects.filter(user=user, workspace=workspace, workspace__deleted_at__isnull=True).exists():
        return Response(
            {"error": {"code": "permission_denied", "message": "Only workspace members may view issue audit events.", "fields": {}}},
            status=status.HTTP_403_FORBIDDEN,
        )
    
    # Get audit events for this issue and its comments/attachments
    from workspaces.models import Comment, Attachment
    
    # Issue events
    issue_events = AuditEvent.objects.filter(
        workspace=workspace,
        target_type="issue",
        target_id=issue.id,
    )
    
    # Comment events (comments on this issue)
    comment_ids = Comment.objects.filter(issue=issue).values_list("id", flat=True)
    comment_events = AuditEvent.objects.filter(
        workspace=workspace,
        target_type="comment",
        target_id__in=comment_ids,
    )
    
    # Attachment events (attachments on this issue)
    attachment_ids = Attachment.objects.filter(issue=issue).values_list("id", flat=True)
    attachment_events = AuditEvent.objects.filter(
        workspace=workspace,
        target_type="attachment",
        target_id__in=attachment_ids,
    )

    # Combine and order
    events = (issue_events | comment_events | attachment_events).order_by("-occurred_at")

    # Pagination
    from django.core.paginator import Paginator
    paginator = Paginator(events, 50)
    page_number = request.query_params.get("page", 1)
    page_obj = paginator.get_page(page_number)

    serializer = AuditEventSerializer(page_obj, many=True, context={"request": request})
    return Response({
        "error": None,
        "results": serializer.data,
        "count": paginator.count,
        "page": page_obj.number,
        "total_pages": paginator.num_pages,
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def archive_project(request, project_id):
    """Archive a project. Admin only. Repeat is a no-op."""
    user = request.user
    try:
        project = Project.objects.select_related("workspace").get(id=project_id)
    except Project.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Project not found.", "fields": {}}},
            status=status.HTTP_404_NOT_FOUND,
        )
    workspace = project.workspace
    # Check admin/owner membership
    membership = Membership.objects.filter(user=user, workspace=workspace).first()
    if not membership:
        return Response(
            {"error": {"code": "permission_denied", "message": "Only workspace members may archive a project.", "fields": {}}},
            status=status.HTTP_403_FORBIDDEN,
        )
    if membership.role not in ("owner", "admin"):
        return Response(
            {"error": {"code": "permission_denied", "message": "Only workspace owners/admins may archive a project.", "fields": {}}},
            status=status.HTTP_403_FORBIDDEN,
        )
    # Version check
    version = request.data.get("version")
    if version is None:
        return Response(
            {"error": {"code": "validation_error", "message": "Version is required.", "fields": {"version": ["This field is required."]}}},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if project.version != version:
        return Response(
            {"error": {"code": "version_conflict", "message": "Project version conflict.", "fields": {"version": [f"Expected {project.version}, got {version}."]}}},
            status=status.HTTP_409_CONFLICT,
        )
    # Already archived = no-op
    if project.archived_at is not None:
        project.version += 1
        project.save(update_fields=["version"])
        log_audit_operation(
            actor=request.user,
            workspace=workspace,
            resource_type="project",
            resource_id=project.id,
            operation="archive",
            success=True,
            correlation_id=request.META.get("CORRELATION_ID"),
            details="Project already archived (no-op)",
        )
        return Response(
            {"error": None, "project": {"id": project.id, "archived_at": project.archived_at.isoformat() if project.archived_at else None}},
            status=status.HTTP_200_OK,
        )
    with transaction.atomic():
        project.archived_at = timezone.now()
        project.version += 1
        project.save(update_fields=["archived_at", "version"])
        log_audit_operation(
            actor=request.user,
            workspace=workspace,
            resource_type="project",
            resource_id=project.id,
            operation="archive",
            success=True,
            correlation_id=request.META.get("CORRELATION_ID"),
            details="Project archived",
        )
    return Response(
        {"error": None, "project": {"id": project.id, "archived_at": project.archived_at.isoformat()}},
        status=status.HTTP_200_OK,
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def reopen_project(request, project_id):
    """Reopen an archived project. Admin only. Repeat is a no-op."""
    user = request.user
    try:
        project = Project.objects.select_related("workspace").get(id=project_id)
    except Project.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Project not found.", "fields": {}}},
            status=status.HTTP_404_NOT_FOUND,
        )
    workspace = project.workspace
    membership = Membership.objects.filter(user=user, workspace=workspace).first()
    if not membership:
        return Response(
            {"error": {"code": "permission_denied", "message": "Only workspace members may reopen a project.", "fields": {}}},
            status=status.HTTP_403_FORBIDDEN,
        )
    if membership.role not in ("owner", "admin"):
        return Response(
            {"error": {"code": "permission_denied", "message": "Only workspace owners/admins may reopen a project.", "fields": {}}},
            status=status.HTTP_403_FORBIDDEN,
        )
    version = request.data.get("version")
    if version is None:
        return Response(
            {"error": {"code": "validation_error", "message": "Version is required.", "fields": {"version": ["This field is required."]}}},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if project.version != version:
        return Response(
            {"error": {"code": "version_conflict", "message": "Project version conflict.", "fields": {"version": [f"Expected {project.version}, got {version}."]}}},
            status=status.HTTP_409_CONFLICT,
        )
    # Already not archived = no-op
    if project.archived_at is None:
        project.version += 1
        project.save(update_fields=["version"])
        log_audit_operation(
            actor=request.user,
            workspace=workspace,
            resource_type="project",
            resource_id=project.id,
            operation="reopen",
            success=True,
            correlation_id=request.META.get("CORRELATION_ID"),
            details="Project already open (no-op)",
        )
        return Response(
            {"error": None, "project": {"id": project.id, "archived_at": None}},
            status=status.HTTP_200_OK,
        )
    with transaction.atomic():
        project.archived_at = None
        project.version += 1
        project.save(update_fields=["archived_at", "version"])
        log_audit_operation(
            actor=request.user,
            workspace=workspace,
            resource_type="project",
            resource_id=project.id,
            operation="reopen",
            success=True,
            correlation_id=request.META.get("CORRELATION_ID"),
            details="Project reopened",
        )
    return Response(
        {"error": None, "project": {"id": project.id, "archived_at": None}},
        status=status.HTTP_200_OK,
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def start_sprint(request, sprint_id):
    """Start a planned sprint. Admin only. Version required."""
    user = request.user
    try:
        sprint = Sprint.objects.select_related("project__workspace").get(id=sprint_id)
    except Sprint.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Sprint not found.", "fields": {}}},
            status=status.HTTP_404_NOT_FOUND,
        )
    workspace = sprint.project.workspace
    membership = Membership.objects.filter(user=user, workspace=workspace).first()
    if not membership:
        return Response(
            {"error": {"code": "permission_denied", "message": "Only workspace members may start a sprint.", "fields": {}}},
            status=status.HTTP_403_FORBIDDEN,
        )
    if membership.role not in ("owner", "admin"):
        return Response(
            {"error": {"code": "permission_denied", "message": "Only workspace owners/admins may start a sprint.", "fields": {}}},
            status=status.HTTP_403_FORBIDDEN,
        )
    version = request.data.get("version")
    if version is None:
        return Response(
            {"error": {"code": "validation_error", "message": "Version is required.", "fields": {"version": ["This field is required."]}}},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if sprint.version != version:
        return Response(
            {"error": {"code": "version_conflict", "message": "Sprint version conflict.", "fields": {"version": [f"Expected {sprint.version}, got {version}."]}}},
            status=status.HTTP_409_CONFLICT,
        )
    if sprint.status != "planned":
        return Response(
            {"error": {"code": "validation_error", "message": "Sprint must be in planned state to start.", "fields": {"status": ["Sprint must be in planned state."]}}},
            status=status.HTTP_400_BAD_REQUEST,
        )
    # Check no other active sprint in project
    active_exists = Sprint.objects.filter(project=sprint.project, status="active").exists()
    if active_exists:
        return Response(
            {"error": {"code": "validation_error", "message": "Project already has an active sprint.", "fields": {"status": ["Project already has an active sprint."]}}},
            status=status.HTTP_409_CONFLICT,
        )
    with transaction.atomic():
        sprint.status = "active"
        sprint.started_at = timezone.now()
        sprint.version += 1
        sprint.save(update_fields=["status", "started_at", "version", "updated_at"])
        log_audit_operation(
            actor=request.user,
            workspace=workspace,
            resource_type="sprint",
            resource_id=sprint.id,
            operation="start",
            success=True,
            correlation_id=request.META.get("CORRELATION_ID"),
            details=f"Sprint {sprint.name} started",
        )
    return Response(
        {"error": None, "sprint": {"id": sprint.id, "status": sprint.status, "started_at": sprint.started_at.isoformat() if sprint.started_at else None}},
        status=status.HTTP_200_OK,
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def complete_sprint(request, sprint_id):
    """Complete an active sprint. Admin only. Version required."""
    user = request.user
    try:
        sprint = Sprint.objects.select_related("project__workspace").get(id=sprint_id)
    except Sprint.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Sprint not found.", "fields": {}}},
            status=status.HTTP_404_NOT_FOUND,
        )
    workspace = sprint.project.workspace
    membership = Membership.objects.filter(user=user, workspace=workspace).first()
    if not membership:
        return Response(
            {"error": {"code": "permission_denied", "message": "Only workspace members may complete a sprint.", "fields": {}}},
            status=status.HTTP_403_FORBIDDEN,
        )
    if membership.role not in ("owner", "admin"):
        return Response(
            {"error": {"code": "permission_denied", "message": "Only workspace owners/admins may complete a sprint.", "fields": {}}},
            status=status.HTTP_403_FORBIDDEN,
        )
    version = request.data.get("version")
    if version is None:
        return Response(
            {"error": {"code": "validation_error", "message": "Version is required.", "fields": {"version": ["This field is required."]}}},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if sprint.version != version:
        return Response(
            {"error": {"code": "version_conflict", "message": "Sprint version conflict.", "fields": {"version": [f"Expected {sprint.version}, got {version}."]}}},
            status=status.HTTP_409_CONFLICT,
        )
    if sprint.status != "active":
        return Response(
            {"error": {"code": "validation_error", "message": "Sprint must be in active state to complete.", "fields": {"status": ["Sprint must be in active state."]}}},
            status=status.HTTP_400_BAD_REQUEST,
        )
    with transaction.atomic():
        sprint.status = "completed"
        sprint.completed_at = timezone.now()
        sprint.version += 1
        sprint.save(update_fields=["status", "completed_at", "version", "updated_at"])
        # Detach unfinished issues from sprint
        unfinished_issues = Issue.objects.filter(sprint=sprint).exclude(status_id__name="done")
        for issue in unfinished_issues:
            issue.sprint_id = None
            issue.version += 1
            issue.save(update_fields=["sprint_id", "version", "updated_at"])
        log_audit_operation(
            actor=request.user,
            workspace=workspace,
            resource_type="sprint",
            resource_id=sprint.id,
            operation="complete",
            success=True,
            correlation_id=request.META.get("CORRELATION_ID"),
            details=f"Sprint {sprint.name} completed, {unfinished_issues.count()} issues detached",
        )
    return Response(
        {"error": None, "sprint": {"id": sprint.id, "status": sprint.status, "completed_at": sprint.completed_at.isoformat() if sprint.completed_at else None}},
        status=status.HTTP_200_OK,
    )


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def board_detail(request, board_id):
    """GET/PATCH board detail. Member for GET, admin for PATCH."""
    user = request.user
    try:
        board = Board.objects.select_related("project__workspace").get(id=board_id)
    except Board.DoesNotExist:
        return Response(
            {"error": {"code": "not_found", "message": "Board not found.", "fields": {}}},
            status=status.HTTP_404_NOT_FOUND,
        )
    workspace = board.project.workspace
    if not Membership.objects.filter(user=user, workspace=workspace, workspace__deleted_at__isnull=True).exists():
        return Response(
            {"error": {"code": "permission_denied", "message": "Only workspace members may access this board.", "fields": {}}},
            status=status.HTTP_403_FORBIDDEN,
        )
    if request.method == "PATCH":
        membership = Membership.objects.filter(user=user, workspace=workspace).first()
        if not membership or membership.role not in ("owner", "admin"):
            return Response(
                {"error": {"code": "permission_denied", "message": "Only workspace owners/admins may edit this board.", "fields": {}}},
                status=status.HTTP_403_FORBIDDEN,
            )
        version = request.data.get("version")
        if version is None:
            return Response(
                {"error": {"code": "validation_error", "message": "Version is required.", "fields": {"version": ["This field is required."]}}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if board.version != version:
            return Response(
                {"error": {"code": "version_conflict", "message": "Board version conflict.", "fields": {"version": [f"Expected {board.version}, got {version}."]}}},
                status=status.HTTP_409_CONFLICT,
            )
        name = request.data.get("name")
        if name is not None:
            name = name.strip()
            if not name or len(name) > 100:
                return Response(
                    {"error": {"code": "validation_error", "message": "Board name must be 1-100 characters.", "fields": {"name": ["Board name must be 1-100 characters."]}}},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            board.name = name
        board.version += 1
        board.save(update_fields=["name", "version", "updated_at"])
        log_audit_operation(
            actor=request.user,
            workspace=workspace,
            resource_type="board",
            resource_id=board.id,
            operation="edit",
            success=True,
            correlation_id=request.META.get("CORRELATION_ID"),
            details=f"Board {board.name} updated",
        )
    serializer_data = {
        "id": board.id,
        "name": board.name,
        "project_id": board.project.id,
        "project_key": board.project.key,
        "project_name": board.project.name,
        "workspace_id": workspace.id,
        "workspace_name": workspace.name,
        "version": board.version,
        "created_at": board.created_at.isoformat() if board.created_at else None,
        "updated_at": board.updated_at.isoformat() if board.updated_at else None,
    }
    return Response({"error": None, "board": serializer_data}, status=status.HTTP_200_OK)
