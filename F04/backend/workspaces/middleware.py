from django_multitenant.utils import set_current_tenant, unset_current_tenant as clear_tenant
from workspaces.models import Workspace, Project, Issue, Board, Sprint, Comment, Attachment


class TenantContextMiddleware:
    """Establish django-multitenant tenant context per-request based on URL kwargs.

    Tenant context is established in process_view() (after URL resolution sets
    request.resolver_match) and cleared in __call__'s finally block (after
    response, including exception paths).
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        try:
            response = self.get_response(request)
            return response
        finally:
            clear_tenant()

    def process_view(self, request, view_func, view_args, view_kwargs):
        workspace = self._resolve_workspace(request)
        if workspace:
            set_current_tenant(workspace)
        return None

    def _resolve_workspace(self, request):
        resolver = getattr(request, "resolver_match", None)
        if not resolver:
            return None
        kwargs = resolver.kwargs

        workspace_id = kwargs.get("workspace_id")
        if workspace_id:
            try:
                return Workspace.objects.get(id=workspace_id)
            except Workspace.DoesNotExist:
                return None

        project_id = kwargs.get("project_id")
        if project_id:
            try:
                return Project.objects.get(id=project_id).workspace
            except Project.DoesNotExist:
                return None

        issue_id = kwargs.get("issue_id")
        if issue_id:
            try:
                return Issue.objects.select_related("board__project__workspace").get(id=issue_id).board.project.workspace
            except Issue.DoesNotExist:
                return None

        board_id = kwargs.get("board_id")
        if board_id:
            try:
                return Board.objects.select_related("project__workspace").get(id=board_id).project.workspace
            except Board.DoesNotExist:
                return None

        sprint_id = kwargs.get("sprint_id")
        if sprint_id:
            try:
                return Sprint.objects.select_related("project__workspace").get(id=sprint_id).project.workspace
            except Sprint.DoesNotExist:
                return None

        comment_id = kwargs.get("comment_id")
        if comment_id:
            try:
                return Comment.objects.select_related("issue__board__project__workspace").get(id=comment_id).issue.board.project.workspace
            except Comment.DoesNotExist:
                return None

        attachment_id = kwargs.get("attachment_id")
        if attachment_id:
            try:
                return Attachment.objects.select_related("issue__board__project__workspace").get(id=attachment_id).issue.board.project.workspace
            except Attachment.DoesNotExist:
                return None

        return None
