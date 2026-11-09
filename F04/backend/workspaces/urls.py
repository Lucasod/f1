from django.urls import path

from . import views

app_name = "workspaces"

urlpatterns = [
    # Authentication endpoints
    path("auth/csrf/", views.csrf_token, name="csrf_token"),
    path("auth/login/", views.login, name="login"),
    path("auth/logout/", views.logout, name="logout"),
    path("auth/me/", views.me, name="me"),
    # Workspace endpoints
    path("workspaces/", views.list_workspaces, name="list_workspaces"),
    path("workspaces/create/", views.create_workspace, name="create_workspace"),
    path("workspaces/<int:workspace_id>/", views.workspace_detail, name="workspace_detail"),
    path("workspaces/<int:workspace_id>/rename/", views.rename_workspace, name="rename_workspace"),
    # Project endpoints
    path("projects/create/", views.create_project, name="create_project"),
    path("projects/", views.list_projects, name="list_projects"),
    path("projects/<int:project_id>/", views.project_detail, name="project_detail"),
    path("projects/<int:project_id>/issues/", views.create_issue, name="create_issue"),
    # Issue endpoints
    path("issues/", views.list_issues, name="list_issues"),
    path("issues/<int:issue_id>/", views.issue_detail, name="issue_detail"),
    path("issues/<int:issue_id>/", views.update_issue, name="update_issue"),
    path("issues/<int:issue_id>/transitions/", views.transition_issue, name="transition_issue"),
]