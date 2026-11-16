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
    path("workspaces/<int:workspace_id>/delete/", views.delete_workspace, name="delete_workspace"),
    path("workspaces/<int:workspace_id>/restore/", views.restore_workspace, name="restore_workspace"),
    # Project endpoints
    path("projects/create/", views.create_project, name="create_project"),
    path("projects/", views.list_projects, name="list_projects"),
    path("projects/<int:project_id>/", views.project_detail, name="project_detail"),
    path("projects/<int:project_id>/issues/", views.create_issue, name="create_issue"),
    path("projects/<int:project_id>/archive/", views.archive_project, name="archive_project"),
    path("projects/<int:project_id>/reopen/", views.reopen_project, name="reopen_project"),
    path("projects/<int:project_id>/sprints/", views.list_sprints, name="list_sprints"),
    path("projects/<int:project_id>/sprints/create/", views.create_sprint, name="create_sprint"),
    path("sprints/<int:sprint_id>/start/", views.start_sprint, name="start_sprint"),
    path("sprints/<int:sprint_id>/complete/", views.complete_sprint, name="complete_sprint"),
    # Issue endpoints
    path("issues/", views.list_issues, name="list_issues"),
    path("issues/<int:issue_id>/", views.issue_detail, name="issue_detail"),
    path("issues/<int:issue_id>/update/", views.update_issue, name="update_issue"),
    path("issues/<int:issue_id>/transitions/", views.transition_issue, name="transition_issue"),
    # Attachment endpoints
    path("issues/<int:issue_id>/attachments/", views.issue_attachments, name="issue_attachments"),
    path("attachments/<int:attachment_id>/download/", views.download_attachment, name="download_attachment"),
    path("attachments/<int:attachment_id>/", views.delete_attachment, name="delete_attachment"),
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
    path("boards/<int:board_id>/", views.board_detail, name="board_detail"),
    # Sprint lifecycle endpoints
    path("sprints/<int:sprint_id>/", views.update_sprint, name="update_sprint"),
    path("issues/<int:issue_id>/assign-sprint/", views.issue_sprint_assignment, name="issue_sprint_assignment"),
    # Report endpoints
    path("reports/", views.create_report, name="create_report"),
    path("reports/<int:report_id>/", views.get_report, name="get_report"),
    path("webhooks/", views.webhook_subscriptions, name="webhook_subscriptions"),
    path("webhooks/<int:subscription_id>/", views.webhook_subscription_detail, name="webhook_subscription_detail"),
    path("webhooks/<int:subscription_id>/deliveries/", views.webhook_deliveries, name="webhook_deliveries"),
    path("integrations/stripe/webhook/", views.stripe_webhook, name="stripe_webhook"),
    path("workspaces/<int:workspace_id>/billing/", views.billing_summary, name="billing_summary"),
    path("workspaces/<int:workspace_id>/billing/checkout/", views.billing_checkout, name="billing_checkout"),
    path("workspaces/<int:workspace_id>/billing/portal/", views.billing_portal, name="billing_portal"),
    path("workspaces/<int:workspace_id>/billing/cancel/", views.billing_cancel, name="billing_cancel"),
    path("workspaces/<int:workspace_id>/billing/operations/<uuid:operation_id>/", views.billing_operation_detail, name="billing_operation_detail"),
    path("workspaces/<int:workspace_id>/usage/", views.workspace_usage, name="workspace_usage"),
    # Audit event endpoints
    path("audit-events/", views.audit_events, name="audit_events"),
    path("issues/<int:issue_id>/audit-events/", views.issue_audit_events, name="issue_audit_events"),
]