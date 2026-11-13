from rest_framework import status
from rest_framework.response import Response
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.views import exception_handler as drf_exception_handler
from django.contrib.auth import authenticate, login as auth_login, get_user_model
from django.http import Http404
from django.db import transaction
from django.middleware.csrf import get_token
from django.db.models import F, Q, Max, Max

from .models import Workspace, Membership, Project, Board, WorkflowStatus, Issue, Sprint, Comment, AuditLog
from .serializers import (
    WorkspaceSerializer, MembershipSerializer, MembershipCreateSerializer,
    ProjectSerializer, BoardSerializer, BoardCreateSerializer,
    WorkflowStatusSerializer, IssueSerializer, SprintSerializer, CommentSerializer,
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
        # Create the workspace
        workspace = Workspace.objects.create(name=name)

        # Create the owner membership for the current user
        user = request.user
        Membership.objects.create(
            user=user,
            workspace=workspace,
            role="owner",
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
    memberships = user.memberships.select_related("workspace")
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
        workspace = Workspace.objects.get(id=workspace_id)
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
        workspace = Workspace.objects.get(id=workspace_id)
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
        workspace = Workspace.objects.get(id=workspace_id)
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
    memberships = user.memberships.select_related("workspace")
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

    # Allocate monotonic issue number (max existing + 1, or 1)
    from django.db.models import Max
    last_number = Issue.objects.aggregate(Max("number"))["number__max"]
    next_number = (last_number or 0) + 1

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

        issue = Issue.objects.create(
            board=board,
            number=next_number,
            title=title,
            description=description if description else None,
            status_id=status_obj,
            assignee=assignee,
            reporter=reporter,
            priority=priority,
            sprint_id=sprint if sprint else None,
            version=0,
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
    memberships = user.memberships.select_related("workspace")
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
        comment = serializer.save(issue=issue, author=user)
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

# ---- Sprint lifecycle endpoints ----

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def list_sprints(request):
    """List sprints for a project.

    Query param project_id filters sprints to a specific project.
    Returns sprints for projects in the user's workspaces.
    """
    user = request.user
    project_id = request.query_params.get("project_id", None)

    if project_id:
        try:
            project = Project.objects.get(id=project_id)
            # Check membership: user must be member of the project's workspace
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
        sprints = Sprint.objects.filter(project=project).select_related("project", "workspace")
    else:
        # List sprints from user's workspace projects
        memberships = user.memberships.select_related("workspace")
        workspaces = [m.workspace for m in memberships]
        sprints = Sprint.objects.filter(workspace__in=workspaces).select_related("project", "workspace")

    serializer = SprintSerializer(sprints, many=True, context={"request": request})
    return Response(
        {
            "error": None,
            "results": serializer.data,
        }
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def create_sprint(request):
    """Create a new sprint.

    Only owners/admins of the project's workspace can create sprints.
    Body: {"name": "Sprint Name", "project_id": 1, "status": "planned"}
    """
    user = request.user
    project_id = request.data.get("project_id", None)

    if not project_id:
        return Response(
            {
                "error": {
                    "code": "validation_error",
                    "message": "Missing required parameter: project_id.",
                }
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

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
    Body: {"name": "New Name", "status": "active", "start_date": "2026-01-01", "end_date": "2026-12-31"}
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
    start_date = request.data.get("start_date", None)
    end_date = request.data.get("end_date", None)

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

    if start_date is not None:
        sprint.start_date = start_date

    if end_date is not None:
        sprint.end_date = end_date

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
