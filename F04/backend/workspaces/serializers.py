from rest_framework import serializers
from .models import Workspace, Membership, Project, Board, WorkflowStatus, Issue, Sprint, Comment


class WorkspaceSerializer(serializers.ModelSerializer):
    """Serializer for workspace representation."""

    role = serializers.SerializerMethodField()

    class Meta:
        model = Workspace
        fields = ["id", "name", "role", "created_at"]

    def get_role(self, obj):
        """Return the caller's role in this workspace."""
        user = self.context["request"].user
        membership = Membership.objects.filter(user=user, workspace=obj).first()
        return membership.role if membership else None


class MembershipSerializer(serializers.ModelSerializer):
    """Serializer for membership summary (list item)."""

    user = serializers.ReadOnlyField(source="user.username")

    class Meta:
        model = Membership
        fields = ["id", "user", "role", "created_at"]


class MembershipCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating a membership (admin/owner adding user)."""

    username = serializers.CharField(
        help_text="Exact case-sensitive username of the target user"
    )

    class Meta:
        model = Membership
        fields = ["username", "role"]

    def validate_username(self, value):
        """Validate that the username exists and is active."""
        from django.contrib.auth import get_user_model
        User = get_user_model()
        try:
            user = User.objects.get(username=value)
            if not user.is_active:
                raise serializers.ValidationError(
                    "User account is inactive."
                )
        except User.DoesNotExist:
            raise serializers.ValidationError(
                "User with that username does not exist."
            )
        return value

    def validate_role(self, value):
        """Validate that the role is one of the allowed ROLE_CHOICES."""
        valid_roles = dict(self.Meta.model.ROLE_CHOICES).keys()
        if value not in valid_roles:
            raise serializers.ValidationError(
                "Role must be one of: owner, admin, member."
            )
        return value


class ProjectSerializer(serializers.ModelSerializer):
    """Serializer for project representation."""

    workspace_name = serializers.ReadOnlyField(source="workspace.name")
    board_exists = serializers.SerializerMethodField()
    board_id = serializers.SerializerMethodField()
    board = serializers.SerializerMethodField()
    role = serializers.SerializerMethodField()

    class Meta:
        model = Project
        fields = [
            "id", "key", "name", "description", "workspace_name",
            "membership_limit", "project_limit_per_plan",
            "next_issue_number", "board_exists", "board_id", "board", "role", "created_at",
        ]
        read_only_fields = ["id", "key", "workspace_name", "board_exists", "board_id", "board", "created_at", "role"]

    def get_board_exists(self, obj):
        """Check if the project has an initial board."""
        return hasattr(obj, 'board')

    def get_board_id(self, obj):
        """Return the ID of the project's board, if any."""
        return obj.board.id if hasattr(obj, 'board') else None

    def get_board(self, obj):
        """Return a minimal board representation with id, if any."""
        if hasattr(obj, 'board'):
            return {"id": obj.board.id}
        return None

    def get_role(self, obj):
        """Return the caller's role in this project's workspace."""
        user = self.context["request"].user
        membership = obj.workspace.memberships.filter(user=user).first()
        return membership.role if membership else None


class BoardSerializer(serializers.ModelSerializer):
    """Serializer for board representation."""

    project_name = serializers.ReadOnlyField(source="project.name")
    project_key = serializers.ReadOnlyField(source="project.key")
    workspace_name = serializers.ReadOnlyField(source="workspace.name")
    statuses = serializers.SerializerMethodField()

    class Meta:
        model = Board
        fields = [
            "id", "name", "project_name", "project_key",
            "workspace_name", "statuses", "created_at",
        ]
        read_only_fields = ["id", "project_name", "project_key", "workspace_name", "statuses", "created_at"]

    def get_statuses(self, obj):
        """Return the workflow statuses for this board."""
        statuses = obj.workflow_statuses.all()
        return [
            {"name": s.name, "position": s.position, "is_default": s.is_default}
            for s in statuses
        ]


class BoardCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating a board as part of project creation."""

    class Meta:
        model = Board
        fields = ["name"]

    def create(self, validated_data):
        project = self.context["project"]
        name = validated_data.get("name", project.name)
        workspace = project.workspace
        board = Board.objects.create(
            project=project,
            name=name,
            workspace=workspace,
        )
        # Create default workflow statuses: To do, In progress, Done
        for i, (key, label) in enumerate([
            ("to_do", "To do"),
            ("in_progress", "In progress"),
            ("done", "Done"),
        ], start=1):
            WorkflowStatus.objects.create(
                board=board,
                name=key,
                position=i,
                is_default=(i == 1),  # First status is default
            )
        return board

    def update(self, instance, validated_data):
        name = validated_data.get("name", instance.name)
        instance.name = name
        instance.save()
        return instance


class WorkflowStatusSerializer(serializers.ModelSerializer):
    """Serializer for workflow status representation."""

    class Meta:
        model = WorkflowStatus
        fields = ["id", "name", "position", "is_default"]


class IssueSerializer(serializers.ModelSerializer):
    """Serializer for issue representation."""

    board_name = serializers.ReadOnlyField(source="board.name")
    board_key = serializers.ReadOnlyField(source="board.project.key")
    assignee_username = serializers.ReadOnlyField(source="assignee.username", allow_null=True)
    reporter_username = serializers.ReadOnlyField(source="reporter.username", allow_null=True)
    sprint_name = serializers.ReadOnlyField(source="sprint_id.name", allow_null=True)
    status = serializers.ReadOnlyField(source="status_id.name")

    class Meta:
        model = Issue
        fields = [
            "id", "number", "title", "description", "status",
            "priority", "assignee_username", "reporter_username",
            "sprint_name", "board_name", "board_key", "version",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "number", "board_name", "board_key",
            "reporter_username", "status",
            "created_at", "updated_at",
        ]

    def validate_priority(self, value):
        valid = dict(self.Meta.model.PRIORITY_CHOICES).keys()
        if value not in valid:
            raise serializers.ValidationError("Priority must be one of: low, medium, high.")
        return value

    def validate_title(self, value):
        if not value or len(value.strip()) < 1:
            raise serializers.ValidationError("Title must not be blank.")
        if len(value) > 200:
            raise serializers.ValidationError("Title must not exceed 200 characters.")
        return value.strip()


class SprintSerializer(serializers.ModelSerializer):
    """Serializer for sprint representation."""

    project_name = serializers.ReadOnlyField(source="project.name")
    project_key = serializers.ReadOnlyField(source="project.key")
    project_id = serializers.ReadOnlyField(source="project.id")

    class Meta:
        model = Sprint
        fields = [
            "id", "name", "project_name", "project_key", "project_id",
            "status", "start_date", "end_date", "created_at",
        ]
        read_only_fields = ["id", "project_name", "project_key", "project_id", "created_at"]


class CommentSerializer(serializers.ModelSerializer):
    """Serializer for comment representation."""

    author_username = serializers.ReadOnlyField(source="author.username", allow_null=True)

    class Meta:
        model = Comment
        fields = [
            "id", "issue", "author", "author_username", "text",
            "created_at", "is_active",
        ]
        read_only_fields = ["id", "issue", "author", "author_username", "created_at"]