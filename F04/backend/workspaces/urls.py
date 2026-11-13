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
    path("issues/<int:issue_id>/update/", views.update_issue, name="update_issue"),
    path("issues/<int:issue_id>/transitions/", views.transition_issue, name="transition_issue"),
    # Comment endpoints
    path("issues/<int:issue_id>/comments/", views.comments, name="comments"),
    path("comments/<int:comment_id>/", views.delete_comment, name="delete_comment"),
    # Notification endpoints
    path("notifications/", views.list_notifications, name="list_notifications"),
    path("notifications/unread_count/", views.notification_unread_count, name="notification_unread_count"),
    path("notifications/<int:notification_id>/read/", views.mark_notification_read, name="mark_notification_read"),
    path("notifications/read_bulk/", views.notification_read_bulk, name="notification_read_bulk"),
    # Board endpoints
    path("boards/<int:board_id>/workflow/", views.board_workflow, name="board_workflow"),
    # Sprint lifecycle endpoints
    path("sprints/", views.list_sprints, name="list_sprints"),
    path("sprints/create/", views.create_sprint, name="create_sprint"),
    path("sprints/<int:sprint_id>/", views.update_sprint, name="update_sprint"),
    path("issues/<int:issue_id>/assign-sprint/", views.issue_sprint_assignment, name="issue_sprint_assignment"),
    # Report endpoints
    path("reports/", views.create_report, name="create_report"),
    path("reports/<int:report_id>/", views.get_report, name="get_report"),
    path("webhooks/", views.webhook_subscriptions, name="webhook_subscriptions"),
    path("webhooks/<int:subscription_id>/", views.webhook_subscription_detail, name="webhook_subscription_detail"),
    path("webhooks/<int:subscription_id>/deliveries/", views.webhook_deliveries, name="webhook_deliveries"),
]