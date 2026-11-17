from django.conf import settings
from django.db import models
from django_multitenant.mixins import TenantModelMixin
from django.contrib.auth import get_user_model
from django.core.validators import RegexValidator
import uuid

User = get_user_model()


class Workspace(TenantModelMixin, models.Model):
    """A workspace (company) isolation boundary."""

    class TenantMeta:
        tenant_field_name = "tenant_id"

    tenant_id = models.PositiveBigIntegerField("tenant id", null=True, blank=True, help_text="Tenant identifier for multi-tenant isolation")

    name = models.CharField("name", max_length=100)

    created_at = models.DateTimeField("created at", auto_now_add=True)

    deleted_at = models.DateTimeField("deleted at", null=True, blank=True)

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
    version = models.IntegerField(
        "version",
        default=1,
        help_text="Optimistic locking version for archive/reopen operations",
    )
    archived_at = models.DateTimeField(
        "archived at",
        null=True,
        blank=True,
        help_text="Set/cleared only by archive/reopen commands",
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

    version = models.IntegerField(
        "version",
        default=1,
        help_text="Optimistic locking version for board metadata updates",
    )

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


class WorkflowTransition(TenantModelMixin, models.Model):
    """A directed workflow transition between two statuses on a board."""

    class TenantMeta:
        tenant_field_name = "tenant_id"

    tenant_id = models.PositiveBigIntegerField(
        "tenant id", null=True, blank=True, help_text="Tenant identifier for multi-tenant isolation"
    )

    board = models.ForeignKey(
        Board,
        on_delete=models.CASCADE,
        verbose_name="board",
        related_name="workflow_transitions",
    )
    from_status_id = models.ForeignKey(
        WorkflowStatus,
        on_delete=models.CASCADE,
        verbose_name="from status",
        related_name="outgoing_transitions",
    )
    to_status_id = models.ForeignKey(
        WorkflowStatus,
        on_delete=models.CASCADE,
        verbose_name="to status",
        related_name="incoming_transitions",
    )

    class Meta:
        ordering = ["id"]
        verbose_name = "workflow transition"
        verbose_name_plural = "workflow transitions"
        constraints = [
            models.UniqueConstraint(
                fields=["board", "from_status_id", "to_status_id"],
                name="unique_workflow_transition_per_board",
            ),
        ]

    def __str__(self):
        return f"{self.board.project.key} {self.from_status_id.name} → {self.to_status_id.name}"


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
    start_at = models.DateTimeField("start at", null=True, blank=True, help_text="Planned start date/time (UTC)")
    end_at = models.DateTimeField("end at", null=True, blank=True, help_text="Planned end date/time (UTC)")
    started_at = models.DateTimeField("started at", null=True, blank=True, help_text="Server set when sprint starts; null when planned")
    completed_at = models.DateTimeField("completed at", null=True, blank=True, help_text="Server set when sprint completes; null when planned/active")
    created_at = models.DateTimeField("created at", auto_now_add=True)
    version = models.IntegerField("version", default=1, help_text="Optimistic locking version")

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


class BillingPlan(TenantModelMixin, models.Model):
    """Application-owned plan catalog (Free/Pro). Not Stripe-configured."""

    class TenantMeta:
        tenant_field_name = "tenant_id"

    tenant_id = models.PositiveBigIntegerField("tenant id", null=True, blank=True)

    PLAN_CHOICES = [
        ("free", "Free"),
        ("pro", "Pro"),
    ]

    plan_id = models.CharField("plan id", max_length=20, choices=PLAN_CHOICES, unique=True)
    name = models.CharField("name", max_length=50)
    description = models.TextField("description", blank=True, default="")
    stripe_price_id = models.CharField("Stripe price id", max_length=200, blank=True, default="")
    max_memberships = models.PositiveIntegerField("max memberships")
    max_projects = models.PositiveIntegerField("max projects")
    price_cents = models.PositiveIntegerField("price in cents", default=0)
    currency = models.CharField("currency", max_length=3, default="usd")
    interval = models.CharField("billing interval", max_length=20, default="month")
    is_active = models.BooleanField("active", default=True)
    created_at = models.DateTimeField("created at", auto_now_add=True)
    updated_at = models.DateTimeField("updated at", auto_now=True)

    class Meta:
        ordering = ["plan_id"]
        verbose_name = "billing plan"
        verbose_name_plural = "billing plans"

    def __str__(self):
        return f"{self.name} ({self.plan_id})"


class WorkspaceBilling(TenantModelMixin, models.Model):
    """Billing state for a workspace. One-to-one with Workspace."""

    class TenantMeta:
        tenant_field_name = "tenant_id"

    tenant_id = models.PositiveBigIntegerField("tenant id", null=True, blank=True)

    workspace = models.OneToOneField(
        Workspace,
        on_delete=models.CASCADE,
        verbose_name="workspace",
        related_name="billing",
    )
    customer_id = models.CharField("Stripe customer id", max_length=200, blank=True, null=True, unique=True, default=None)
    subscription_id = models.CharField("Stripe subscription id", max_length=200, blank=True, null=True, unique=True, default=None)
    provider_status = models.CharField("provider status", max_length=50, blank=True, default="")
    effective_plan = models.CharField("effective plan", max_length=20, choices=[("free", "Free"), ("pro", "Pro")], default="free")
    cancel_at_period_end = models.BooleanField("cancel at period end", default=False)
    paid_through = models.DateTimeField("paid through", null=True, blank=True)
    last_synced_at = models.DateTimeField("last synced at", null=True, blank=True)
    created_at = models.DateTimeField("created at", auto_now_add=True)
    updated_at = models.DateTimeField("updated at", auto_now=True)

    class Meta:
        verbose_name = "workspace billing"
        verbose_name_plural = "workspace billing"

    def __str__(self):
        return f"Billing for {self.workspace.name} ({self.effective_plan})"


class BillingOperation(models.Model):
    """Durable record of a billing operation (checkout, cancel, portal)."""

    class TenantMeta:
        tenant_field_name = "tenant_id"

    tenant_id = models.PositiveBigIntegerField("tenant id", null=True, blank=True)

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        Workspace,
        on_delete=models.CASCADE,
        verbose_name="workspace",
        related_name="billing_operations",
    )
    kind = models.CharField("operation kind", max_length=20, choices=[("checkout", "Checkout"), ("cancel", "Cancel"), ("portal", "Portal")])
    idempotency_key = models.CharField("idempotency key", max_length=200)
    state = models.CharField(
        "state",
        max_length=20,
        choices=[("pending", "Pending"), ("completed", "Completed"), ("failed", "Failed"), ("unknown", "Unknown")],
        default="pending",
    )
    provider_object_id = models.CharField("provider object id", max_length=200, blank=True, default="")
    safe_result = models.JSONField("safe result", default=dict, blank=True)
    created_at = models.DateTimeField("created at", auto_now_add=True)
    updated_at = models.DateTimeField("updated at", auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "kind", "idempotency_key"],
                name="unique_billing_operation_per_workspace_kind_key",
            ),
        ]
        verbose_name = "billing operation"
        verbose_name_plural = "billing operations"

    def __str__(self):
        return f"{self.kind} {self.id} ({self.state})"


class StripeEventInbox(TenantModelMixin, models.Model):
    """Durable inbox for Stripe webhook events (idempotent processing)."""

    class TenantMeta:
        tenant_field_name = "tenant_id"

    tenant_id = models.PositiveBigIntegerField("tenant id", null=True, blank=True)

    event_id = models.CharField("provider event id", max_length=200, unique=True)
    event_type = models.CharField("event type", max_length=100)
    received_at = models.DateTimeField("received at", auto_now_add=True)
    provider_object_id = models.CharField("provider object id", max_length=200, blank=True, default="")
    resolved_workspace_id = models.PositiveBigIntegerField("resolved workspace id", null=True, blank=True)
    state = models.CharField(
        "state",
        max_length=20,
        choices=[("pending", "Pending"), ("processed", "Processed"), ("failed", "Failed")],
        default="pending",
    )
    attempts = models.PositiveIntegerField("attempts", default=0)
    next_attempt_at = models.DateTimeField("next attempt at", null=True, blank=True)
    error_code = models.CharField("error code", max_length=100, blank=True, default="")

    class Meta:
        ordering = ["-received_at"]
        verbose_name = "Stripe event inbox"
        verbose_name_plural = "Stripe event inboxes"

    def __str__(self):
        return f"Stripe event {self.event_id} ({self.event_type})"


class Attachment(TenantModelMixin, models.Model):
    """An attachment on an issue, stored in private object storage."""

    class TenantMeta:
        tenant_field_name = "tenant_id"

    tenant_id = models.PositiveBigIntegerField(
        "tenant id",
        null=True,
        blank=True,
        help_text="Tenant identifier for multi-tenant isolation",
    )
    workspace = models.ForeignKey(
        Workspace,
        on_delete=models.CASCADE,
        verbose_name="workspace",
        related_name="workspace_attachments",
    )
    issue = models.ForeignKey(
        Issue,
        on_delete=models.CASCADE,
        verbose_name="issue",
        related_name="attachments",
    )
    uploader = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="uploader",
        related_name="uploads",
    )
    original_name = models.CharField(
        "original name",
        max_length=150,
        help_text="Display-only filename, stripped of path/control characters, 1-150 characters",
    )
    detected_content_type = models.CharField(
        "detected content type",
        max_length=100,
        help_text="MIME type detected from file content inspection",
    )
    byte_size = models.PositiveBigIntegerField(
        "byte size",
        help_text="File size in bytes (1-10,485,760 = 10 MiB)",
    )
    sha256 = models.CharField(
        "sha256",
        max_length=64,
        help_text="SHA-256 hex digest of file content",
    )
    object_key = models.CharField(
        "object key",
        max_length=200,
        unique=True,
        help_text="Random UUID object key under a workspace prefix, never derived from supplied filename, never in public responses",
    )
    STATE_CHOICES = [
        ("pending", "Pending"),
        ("ready", "Ready"),
        ("failed", "Failed"),
        ("deleted", "Deleted"),
    ]
    state = models.CharField(
        "state",
        max_length=20,
        choices=STATE_CHOICES,
        default="pending",
    )
    deleted_at = models.DateTimeField("deleted at", null=True, blank=True)
    created_at = models.DateTimeField("created at", auto_now_add=True)
    updated_at = models.DateTimeField("updated at", auto_now=True)
    version = models.IntegerField(
        "version", default=1, help_text="Optimistic locking version"
    )

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "attachment"
        verbose_name_plural = "attachments"
        indexes = [
            models.Index(fields=["workspace", "issue", "state", "id"]),
        ]

    def __str__(self):
        return f"Attachment {self.original_name} on #{self.issue.number}"


class AuditEvent(TenantModelMixin, models.Model):
    """Append-only audit event record. Immutable through application APIs."""

    class TenantMeta:
        tenant_field_name = "tenant_id"

    tenant_id = models.PositiveBigIntegerField("tenant id", null=True, blank=True, help_text="Tenant identifier for multi-tenant isolation")

    workspace = models.ForeignKey(
        Workspace,
        on_delete=models.CASCADE,
        verbose_name="workspace",
        related_name="audit_events",
    )
    actor = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="actor",
        related_name="audit_events",
    )
    actor_kind = models.CharField(
        "actor kind",
        max_length=20,
        choices=[("user", "User"), ("system", "System"), ("stripe", "Stripe")],
        default="user",
    )
    action = models.CharField("action", max_length=100, help_text="Stable action code (e.g., workspace.create, issue.transition)")
    target_type = models.CharField("target type", max_length=50, help_text="Type of the target resource (e.g., workspace, project, issue)")
    target_id = models.PositiveBigIntegerField("target id", help_text="ID of the target resource")
    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        verbose_name="project",
        related_name="audit_events",
    )
    request_id = models.CharField("request id", max_length=100, blank=True, default="", help_text="Correlation ID for the originating request")
    changes = models.JSONField("changes", default=dict, blank=True, help_text="Allowlisted before/after scalar values and relationship IDs")
    event_id = models.UUIDField("event id", unique=True, default=uuid.uuid4, editable=False, help_text="Unique event identifier")
    occurred_at = models.DateTimeField("occurred at", auto_now_add=True)

    class Meta:
        ordering = ["-occurred_at"]
        verbose_name = "audit event"
        verbose_name_plural = "audit events"
        indexes = [
            models.Index(fields=["workspace", "occurred_at", "id"]),
            models.Index(fields=["workspace", "project", "occurred_at", "id"]),
        ]

    def __str__(self):
        return f"AuditEvent {self.action} on {self.target_type}#{self.target_id}"


class DomainEvent(TenantModelMixin, models.Model):
    """Durable domain event for outbox pattern.

    Business services write DomainEvent in the same transaction as the change.
    dispatch_outbox reads pending events and fans out to Notification /
    WebhookDelivery records, then marks the event as dispatched.
    """

    class TenantMeta:
        tenant_field_name = "tenant_id"

    tenant_id = models.PositiveBigIntegerField("tenant id", null=True, blank=True, help_text="Tenant identifier for multi-tenant isolation")

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        "Workspace", on_delete=models.CASCADE, related_name="domain_events"
    )
    event_type = models.CharField(max_length=100)
    schema_version = models.PositiveSmallIntegerField(default=1)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="domain_events",
    )
    aggregate_type = models.CharField(max_length=100)
    aggregate_id = models.CharField(max_length=100)
    occurred_at = models.DateTimeField(auto_now_add=True)
    request_id = models.CharField(max_length=100, null=True, blank=True)
    payload = models.JSONField(
        default=dict,
        help_text="Allowlisted scalar IDs/changes only. No file bytes, credentials, comment bodies, or issue descriptions.",
    )
    dispatched_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(
                fields=["dispatched_at", "occurred_at"],
                name="domain_event_pending_dispatch",
                condition=models.Q(dispatched_at__isnull=True),
            ),
        ]
        ordering = ["occurred_at"]

    def __str__(self):
        return f"{self.event_type} ({self.aggregate_type}/{self.aggregate_id})"