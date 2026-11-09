from django.db import models
from django.contrib.auth import get_user_model
from django.core.validators import RegexValidator

User = get_user_model()


class Workspace(models.Model):
    """A workspace (company) isolation boundary."""

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


class Project(models.Model):
    """A project within a workspace, with a unique uppercase key and one initial board."""

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


class Membership(models.Model):
    """User membership in a workspace with a role."""

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


class Board(models.Model):
    """A board within a project (one-to-one in MVP)."""

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


class WorkflowStatus(models.Model):
    """A status within a board's workflow, with directed transitions."""

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
    is_default = models.BooleanField("is default", default=True)

    class Meta:
        ordering = ["position", "name"]
        verbose_name = "workflow status"
        verbose_name_plural = "workflow statuses"
        unique_together = ("board", "name")

    def __str__(self):
        return f"{self.board.project.key}-{self.board.name}: {self.name}"


class Sprint(models.Model):
    """A sprint within a project workspace."""

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


class Issue(models.Model):
    """An issue within a board, with workflow transition support."""

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
        unique=True,
        help_text="Server-allocated monotonic positive bigint",
    )
    title = models.CharField("title", max_length=200)
    description = models.TextField(
        "description",
        max_length=10000,
        blank=True,
        default="",
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