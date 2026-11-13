from django.db import models
from django_multitenant.mixins import TenantModelMixin
from django.contrib.auth import get_user_model
from django.core.validators import RegexValidator

User = get_user_model()


class Workspace(TenantModelMixin, models.Model):
    """A workspace (company) isolation boundary."""

    class TenantMeta:
        tenant_field_name = "tenant_id"

    tenant_id = models.PositiveBigIntegerField("tenant id", null=True, blank=True, help_text="Tenant identifier for multi-tenant isolation")

    name = models.CharField("name", max_length=100)

    created_at = models.DateTimeField("created at", auto_now_add=True)

    class Meta:
        ordering = ["id"]
        verbose_name = "workspace"
        verbose_name_plural = "workspaces"

    def __str__(self):
        return self.name

    @property
    def display_name(self):
        return self.name


class Project(TenantModelMixin, models.Model):
    """A project within a workspace, with a unique uppercase key and one initial board."""

    class TenantMeta:
        tenant_field_name = "tenant_id"

    tenant_id = models.PositiveBigIntegerField("tenant id", null=True, blank=True, help_text="Tenant identifier for multi-tenant isolation")

    KEY_VALIDATOR = RegexValidator(
        regex=r"^[A-Z][A-Z0-9]{1,9}$",
        message="Project key must be uppercase, 2-10 chars, starting with a letter, "
                "containing only letters and digits (e.g. ABC, XYZ1).",
    )

    key = models.CharField(
        "key",
        max_length=10,
        unique=False,
        validators=[KEY_VALIDATOR],
        help_text="Uppercase alphanumeric, 2-10 chars, unique per workspace",
    )
    name = models.CharField("name", max_length=200)
    description = models.TextField(
        "description",
        max_length=5000,
        blank=True,
        default="",
    )
    workspace = models.ForeignKey(
        Workspace,
        on_delete=models.CASCADE,
        verbose_name="workspace",
        related_name="projects",
    )
    membership_limit = models.IntegerField(
        "membership limit",
        default=0,
        help_text="0 means unlimited",
    )
    project_limit_per_plan = models.IntegerField(
        "project limit per plan",
        default=0,
        help_text="0 means unlimited; set per plan type (Free=2, Pro=20)",
    )
    next_issue_number = models.PositiveBigIntegerField(
        "next issue number",
        default=1,
        help_text="Monotonic counter for server-allocated issue numbers",
    )
    created_at = models.DateTimeField("created at", auto_now_add=True)

    class Meta:
        ordering = ["id"]
        verbose_name = "project"
        verbose_name_plural = "projects"
        unique_together = ("workspace", "key")

    def __str__(self):
        return f"{self.name} ({self.key})"

    @property
    def is_full(self):
        """Check if project has reached its membership limit."""
        if self.membership_limit == 0:
            return False
        count = self.memberships.count()
        return count >= self.membership_limit

    @property
    def project_count(self):
        """Count of projects in the same workspace."""
        return Project.objects.filter(workspace=self.workspace).count()

    def save(self, *args, **kwargs):
        """Normalize key to uppercase before saving."""
        self.key = self.key.upper()
        super().save(*args, **kwargs)


class Membership(TenantModelMixin, models.Model):
    """User membership in a workspace with a role."""

    class TenantMeta:
        tenant_field_name = "tenant_id"

    tenant_id = models.PositiveBigIntegerField("tenant id", null=True, blank=True, help_text="Tenant identifier for multi-tenant isolation")

    ROLE_CHOICES = [
        ("owner", "owner"),
        ("admin", "admin"),
        ("member", "member"),
    ]

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        verbose_name="user",
        related_name="memberships",
    )
    workspace = models.ForeignKey(
        Workspace,
        on_delete=models.CASCADE,
        verbose_name="workspace",
        related_name="memberships",
    )
    role = models.CharField("role", max_length=10, choices=ROLE_CHOICES, default="member")
    created_at = models.DateTimeField("created at", auto_now_add=True)

    class Meta:
        ordering = ["id"]
        unique_together = ("user", "workspace")
        verbose_name = "membership"
        verbose_name_plural = "memberships"

    def __str__(self):
        return f"{self.user.username} — {self.workspace.name} ({self.role})"

    @property
    def is_owner(self):
        return self.role == "owner"

    @property
    def is_admin(self):
        return self.role in ("owner", "admin")

    @property
    def is_member(self):
        return self.role == "member"


class Board(TenantModelMixin, models.Model):
    """A board within a project (one-to-one in MVP)."""

    class TenantMeta:
        tenant_field_name = "tenant_id"

    tenant_id = models.PositiveBigIntegerField("tenant id", null=True, blank=True, help_text="Tenant identifier for multi-tenant isolation")

    project = models.OneToOneField(
        Project,
        on_delete=models.CASCADE,
        verbose_name="project",
        related_name="board",
    )
    name = models.CharField("name", max_length=100)
    workspace = models.ForeignKey(
        Workspace,
        on_delete=models.CASCADE,
        verbose_name="workspace",
        related_name="boards",
    )
    created_at = models.DateTimeField("created at", auto_now_add=True)

    class Meta:
        ordering = ["id"]
        verbose_name = "board"
        verbose_name_plural = "boards"
        # At most 20 statuses per board (fixed validation bound)

    def __str__(self):
        return f"{self.project.name} board — {self.name}"

    @property
    def max_statuses_exceeded(self):
        """Check if board already has 20 statuses."""
        return self.workflow_statuses.count() >= 20


class WorkflowStatus(TenantModelMixin, models.Model):
    """A status within a board's workflow, with directed transitions."""

    class TenantMeta:
        tenant_field_name = "tenant_id"

    tenant_id = models.PositiveBigIntegerField("tenant id", null=True, blank=True, help_text="Tenant identifier for multi-tenant isolation")

    STATUS_CHOICES = [
        ("to_do", "To do"),
        ("in_progress", "In progress"),
        ("done", "Done"),
    ]

    board = models.ForeignKey(
        Board,
        on_delete=models.CASCADE,
        verbose_name="board",
        related_name="workflow_statuses",
    )
    name = models.CharField("name", max_length=20, choices=STATUS_CHOICES)
    position = models.IntegerField("position", default=0, help_text="Ordering within the board")
    is_active = models.BooleanField("is active", default=True, help_text="Indicates if this status is currently active for its board")
    is_default = models.BooleanField("is default", default=True)

    class Meta:
        ordering = ["position", "name"]
        verbose_name = "workflow status"
        verbose_name_plural = "workflow statuses"
        unique_together = ("board", "name")

    def __str__(self):
        return f"{self.board.project.key}-{self.board.name}: {self.name}"


class Sprint(TenantModelMixin, models.Model):
    """A sprint within a project workspace."""

    class TenantMeta:
        tenant_field_name = "tenant_id"

    tenant_id = models.PositiveBigIntegerField("tenant id", null=True, blank=True, help_text="Tenant identifier for multi-tenant isolation")

    STATUS_CHOICES = [
        ("planned", "Planned"),
        ("active", "Active"),
        ("completed", "Completed"),
    ]

    name = models.CharField("name", max_length=100)
    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        verbose_name="project",
        related_name="sprints",
    )
    workspace = models.ForeignKey(
        Workspace,
        on_delete=models.CASCADE,
        verbose_name="workspace",
        related_name="sprints",
    )
    status = models.CharField("status", max_length=20, choices=STATUS_CHOICES, default="planned")
    start_date = models.DateField("start date", null=True, blank=True)
    end_date = models.DateField("end date", null=True, blank=True)
    created_at = models.DateTimeField("created at", auto_now_add=True)

    class Meta:
        ordering = ["id"]
        verbose_name = "sprint"
        verbose_name_plural = "sprints"

    def __str__(self):
        return f"{self.project.key}-{self.name}"


class Issue(TenantModelMixin, models.Model):
    """An issue within a board, with workflow transition support."""

    class TenantMeta:
        tenant_field_name = "tenant_id"

    tenant_id = models.PositiveBigIntegerField("tenant id", null=True, blank=True, help_text="Tenant identifier for multi-tenant isolation")

    PRIORITY_CHOICES = [
        ("low", "low"),
        ("medium", "medium"),
        ("high", "high"),
    ]

    board = models.ForeignKey(
        Board,
        on_delete=models.CASCADE,
        verbose_name="board",
        related_name="issues",
    )
    number = models.PositiveBigIntegerField(
        "number",
        help_text="Server-allocated monotonic positive bigint, unique within its board",
    )
    title = models.CharField("title", max_length=200)
    description = models.TextField(
        "description",
        max_length=10000,
        blank=True,
        default="",
        null=True,
    )
    status_id = models.ForeignKey(
        WorkflowStatus,
        on_delete=models.CASCADE,
        verbose_name="status",
        related_name="issues",
    )
    assignee = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="assignee",
        related_name="assigned_issues",
    )
    reporter = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="reporter",
        related_name="reported_issues",
        editable=False,
    )
    sprint_id = models.ForeignKey(
        Sprint,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="sprint",
        related_name="issues",
    )
    priority = models.CharField(
        "priority",
        max_length=10,
        choices=PRIORITY_CHOICES,
        default="medium",
    )
    version = models.IntegerField(
        "version",
        default=0,
        help_text="Optimistic locking version for transition validation",
    )
    created_at = models.DateTimeField("created at", auto_now_add=True)
    updated_at = models.DateTimeField("updated at", auto_now=True)

    class Meta:
        ordering = ["number"]
        verbose_name = "issue"
        verbose_name_plural = "issues"
        unique_together = (("board", "number"),)

    def __str__(self):
        return f"#{self.number} {self.title} — {self.board.project.key}"


class AuditLog(TenantModelMixin, models.Model):
    """Audit log trail for all significant operations."""

    class TenantMeta:
        tenant_field_name = "tenant_id"

    tenant_id = models.PositiveBigIntegerField("tenant id", null=True, blank=True, help_text="Tenant identifier for multi-tenant isolation")

    actor = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="audit_logs",
    )
    workspace = models.ForeignKey(
        Workspace,
        on_delete=models.CASCADE,
        related_name="audit_logs",
    )
    RESOURCE_TYPE_CHOICES = [
        ("workspace", "Workspace"),
        ("project", "Project"),
        ("board", "Board"),
        ("issue", "Issue"),
        ("sprint", "Sprint"),
        ("comment", "Comment"),
    ]
    resource_type = models.CharField(
        "resource type",
        max_length=30,
        choices=RESOURCE_TYPE_CHOICES,
    )
    resource_id = models.PositiveBigIntegerField()
    OPERATION_CHOICES = [
        ("create", "Create"),
        ("update", "Update"),
        ("delete", "Delete"),
        ("transition", "Transition"),
    ]
    operation = models.CharField(
        "operation",
        max_length=30,
        choices=OPERATION_CHOICES,
    )
    timestamp = models.DateTimeField("timestamp", auto_now_add=True)
    correlation_id = models.CharField(
        "correlation id",
        max_length=36,
        null=True,
        blank=True,
        help_text="UUID for request tracing",
    )
    success = models.BooleanField("success", default=True)
    details = models.TextField("details", blank=True)

    class Meta:
        ordering = ["-timestamp"]
        verbose_name = "audit log"
        verbose_name_plural = "audit logs"


class Notification(TenantModelMixin, models.Model):
    """Internal notification for a workspace member."""

    class TenantMeta:
        tenant_field_name = "tenant_id"

    tenant_id = models.PositiveBigIntegerField("tenant id", null=True, blank=True)

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        verbose_name="user",
        related_name="notifications",
    )
    workspace = models.ForeignKey(
        Workspace,
        on_delete=models.CASCADE,
        verbose_name="workspace",
        related_name="notifications",
    )
    NOTIFICATION_TYPE_CHOICES = [
        ("issue_assigned", "Issue Assigned"),
        ("issue_status_changed", "Issue Status Changed"),
        ("comment_added", "Comment Added"),
        ("sprint_started", "Sprint Started"),
        ("sprint_completed", "Sprint Completed"),
    ]
    notification_type = models.CharField(
        "notification type",
        max_length=30,
        choices=NOTIFICATION_TYPE_CHOICES,
    )
    entity_type = models.CharField("entity type", max_length=30, blank=True)
    entity_id = models.PositiveBigIntegerField("entity id", null=True, blank=True)
    payload = models.JSONField("payload", default=dict, blank=True)
    is_read = models.BooleanField("is read", default=False)
    created_at = models.DateTimeField("created at", auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "notification"
        verbose_name_plural = "notifications"

    def __str__(self):
        return f"Notification for {self.user.username}: {self.notification_type}"


class Report(TenantModelMixin, models.Model):
    """Asynchronous background report for a workspace."""

    class TenantMeta:
        tenant_field_name = "tenant_id"

    tenant_id = models.PositiveBigIntegerField("tenant id", null=True, blank=True)

    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        verbose_name="user",
        related_name="reports",
    )
    workspace = models.ForeignKey(
        Workspace,
        on_delete=models.CASCADE,
        verbose_name="workspace",
        related_name="reports",
    )

    REPORT_TYPE_CHOICES = [
        ("issues_by_status", "Issues by Status"),
        ("issues_by_assignee", "Issues by Assignee"),
        ("sprint_completion", "Sprint Completion"),
        ("project_progress", "Project Progress"),
    ]

    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("completed", "Completed"),
        ("failed", "Failed"),
    ]

    report_type = models.CharField("report type", max_length=30, choices=REPORT_TYPE_CHOICES)
    status = models.CharField("status", max_length=20, choices=STATUS_CHOICES, default="pending")
    result = models.JSONField("result", default=dict, blank=True)
    error = models.TextField("error", blank=True)
    created_at = models.DateTimeField("created at", auto_now_add=True)
    completed_at = models.DateTimeField("completed at", null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "report"
        verbose_name_plural = "reports"

    def __str__(self):
        return f"Report {self.report_type} for {self.workspace.name} ({self.status})"


class Comment(TenantModelMixin, models.Model):
    """A comment on an issue."""

    class TenantMeta:
        tenant_field_name = "tenant_id"

    tenant_id = models.PositiveBigIntegerField("tenant id", null=True, blank=True, help_text="Tenant identifier for multi-tenant isolation")

    issue = models.ForeignKey(
        Issue,
        on_delete=models.CASCADE,
        verbose_name="issue",
        related_name="comments",
    )
    author = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="author",
    )
    text = models.TextField("text")
    created_at = models.DateTimeField("created at", auto_now_add=True)
    is_active = models.BooleanField("is active", default=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "comment"
        verbose_name_plural = "comments"

    def __str__(self):
        return f"Comment by {self.author} on #{self.issue.number}" if self.author else f"Comment on #{self.issue.number}"


class WebhookSubscription(TenantModelMixin, models.Model):
    """Tenant-scoped outgoing webhook subscription."""

    class TenantMeta:
        tenant_field_name = "tenant_id"

    tenant_id = models.PositiveBigIntegerField("tenant id", null=True, blank=True)

    workspace = models.ForeignKey(
        Workspace,
        on_delete=models.CASCADE,
        verbose_name="workspace",
        related_name="webhook_subscriptions",
    )
    url = models.URLField("destination URL", max_length=2000)
    events = models.JSONField("events", default=list)
    is_enabled = models.BooleanField("enabled", default=True)
    # NOTE: signing_secret is stored in plaintext at rest. In production,
    # encrypt at rest (e.g., Django field encryption or application-level
    # encryption before storage). The write_only serializer setting prevents
    # the secret from being returned in API responses, but database-level
    # encryption is required for production deployment.
    signing_secret = models.CharField("signing secret", max_length=255)
    created_at = models.DateTimeField("created at", auto_now_add=True)
    updated_at = models.DateTimeField("updated at", auto_now=True)

    class Meta:
        verbose_name = "webhook subscription"
        verbose_name_plural = "webhook subscriptions"

    def __str__(self):
        return f"Webhook {self.url} for {self.workspace.name}"


class WebhookDelivery(TenantModelMixin, models.Model):
    """Durable delivery record for outgoing webhooks."""

    class TenantMeta:
        tenant_field_name = "tenant_id"

    tenant_id = models.PositiveBigIntegerField("tenant id", null=True, blank=True)

    subscription = models.ForeignKey(
        WebhookSubscription,
        on_delete=models.CASCADE,
        verbose_name="subscription",
        related_name="deliveries",
    )
    event_type = models.CharField("event type", max_length=50)
    event_id = models.CharField("event id", max_length=100, blank=True)
    delivery_id = models.CharField("delivery id", max_length=100, unique=True)
    status = models.CharField(
        "status",
        max_length=20,
        default="pending",
        choices=[("pending", "Pending"), ("delivered", "Delivered"), ("failed", "Failed"), ("max_retries", "Max Retries")],
    )
    attempt = models.PositiveIntegerField("attempt", default=0)
    max_attempts = models.PositiveIntegerField("max attempts", default=3)
    request_payload = models.JSONField("request payload", default=dict, blank=True)
    response_status = models.PositiveIntegerField("response status", null=True, blank=True)
    response_body = models.TextField("response body", blank=True)
    error_message = models.TextField("error message", blank=True)
    created_at = models.DateTimeField("created at", auto_now_add=True)
    updated_at = models.DateTimeField("updated at", auto_now=True)
    next_attempt_at = models.DateTimeField("next attempt at", null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "webhook delivery"
        verbose_name_plural = "webhook deliveries"

    def __str__(self):
        return f"Delivery {self.delivery_id} for {self.event_type}"