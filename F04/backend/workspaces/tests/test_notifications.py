"""Notification tests for F04 MP-F04-014 Step 4."""

import os

from django.test import TestCase
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from workspaces.models import Workspace, Membership, Notification
from workspaces.tasks import generate_notification

User = get_user_model()


class NotificationTestCase(TestCase):
    """Test suite for internal notification model and API endpoints."""

    def setUp(self):
        """Create users, workspaces, memberships and notifications."""
        self.client = APIClient()
        self.user = User.objects.create_user("alice", "alice@example.com", os.getenv('SECRET_TEST_PASS', 'testpass123'))
        self.client.login(username="alice", password=os.getenv('SECRET_TEST_PASS', 'testpass123'))

        self.bob = User.objects.create_user("bob", "bob@example.com", os.getenv('SECRET_TEST_PASS', 'testpass123'))
        self.bob_client = APIClient()
        self.bob_client.login(username="bob", password=os.getenv('SECRET_TEST_PASS', 'testpass123'))

        # Workspace where alice is a member (owner)
        self.workspace = Workspace.objects.create(name="Acme")
        Membership.objects.create(user=self.user, workspace=self.workspace, role="owner")

        # Separate workspace where bob is a member (used for workspace-scoping tests)
        self.other_workspace = Workspace.objects.create(name="Stark Industries")
        Membership.objects.create(user=self.bob, workspace=self.other_workspace, role="member")

        # Create notifications for alice in self.workspace
        self.n1 = Notification.objects.create(
            user=self.user,
            workspace=self.workspace,
            notification_type="issue_assigned",
            entity_type="issue",
            entity_id=1,
            payload={"issue_key": "ABC-1"},
            is_read=False,
        )
        self.n2 = Notification.objects.create(
            user=self.user,
            workspace=self.workspace,
            notification_type="comment_added",
            entity_type="comment",
            entity_id=5,
            payload={"issue_key": "ABC-2"},
            is_read=True,
        )
        # Notification for alice in the OTHER workspace (bob's workspace) - alice is NOT a member
        self.n_other_ws = Notification.objects.create(
            user=self.user,
            workspace=self.other_workspace,
            notification_type="issue_assigned",
            entity_type="issue",
            entity_id=99,
            payload={},
            is_read=False,
        )
        # Bob's own notification in his workspace
        self.n_bob = Notification.objects.create(
            user=self.bob,
            workspace=self.other_workspace,
            notification_type="issue_assigned",
            entity_type="issue",
            entity_id=7,
            payload={},
            is_read=False,
        )

    def test_create_notification(self):
        """Model: creating a Notification stores all fields correctly."""
        n = Notification.objects.create(
            user=self.user,
            workspace=self.workspace,
            notification_type="sprint_started",
            entity_type="sprint",
            entity_id=3,
            payload={"name": "Sprint 1"},
            is_read=False,
        )
        self.assertEqual(n.user, self.user)
        self.assertEqual(n.workspace, self.workspace)
        self.assertEqual(n.notification_type, "sprint_started")
        self.assertEqual(n.entity_type, "sprint")
        self.assertEqual(n.entity_id, 3)
        self.assertEqual(n.payload, {"name": "Sprint 1"})
        self.assertFalse(n.is_read)
        self.assertIsNotNone(n.created_at)
        self.assertEqual(str(n), f"Notification for {self.user.username}: sprint_started")

    def test_list_notifications(self):
        """GET /api/v1/notifications/?workspace_id= returns user's notifications."""
        response = self.client.get(
            f"/api/v1/notifications/?workspace_id={self.workspace.id}",
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["error"], None)
        results = response.data["results"]
        self.assertEqual(len(results), 2)
        ids = {item["id"] for item in results}
        self.assertEqual(ids, {self.n1.id, self.n2.id})
        # Ordered newest first
        self.assertEqual(results[0]["id"], self.n2.id)
        self.assertEqual(results[1]["id"], self.n1.id)

    def test_list_notifications_workspace_scoped(self):
        """GET /api/v1/notifications/ only returns the requesting user's notifications for the requested workspace."""
        # Bob lists notifications for his own workspace: only sees his own notification
        response = self.bob_client.get(
            f"/api/v1/notifications/?workspace_id={self.other_workspace.id}",
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["error"], None)
        results = response.data["results"]
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["id"], self.n_bob.id)
        # Alice is not a member of bob's workspace -> 403
        response = self.client.get(
            f"/api/v1/notifications/?workspace_id={self.other_workspace.id}",
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_list_notifications_requires_membership(self):
        """Non-member of a workspace cannot list its notifications (403)."""
        # bob is not a member of self.workspace
        response = self.bob_client.get(
            f"/api/v1/notifications/?workspace_id={self.workspace.id}",
            format="json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["error"]["code"], "permission_denied")

    def test_list_notifications_missing_workspace_id(self):
        """Missing workspace_id returns 400."""
        response = self.client.get("/api/v1/notifications/", format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"]["code"], "validation_error")

    def test_list_notifications_nonexistent_workspace(self):
        """Nonexistent workspace_id returns 404."""
        response = self.client.get(
            "/api/v1/notifications/?workspace_id=999999",
            format="json",
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data["error"]["code"], "not_found")

    def test_unread_count(self):
        """GET /api/v1/notifications/unread_count/ returns correct unread count."""
        response = self.client.get(
            f"/api/v1/notifications/unread_count/?workspace_id={self.workspace.id}",
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["error"], None)
        self.assertEqual(response.data["unread_count"], 1)

    def test_unread_count_workspace_scoped(self):
        """Unread count is scoped to the requested workspace."""
        # alice has an unread notification in other_workspace but is not a member -> 403
        response = self.client.get(
            f"/api/v1/notifications/unread_count/?workspace_id={self.other_workspace.id}",
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_mark_notification_read(self):
        """PATCH /api/v1/notifications/{id}/read/ marks a single notification as read."""
        response = self.client.patch(
            f"/api/v1/notifications/{self.n1.id}/read/",
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["error"], None)
        self.n1.refresh_from_db()
        self.assertTrue(self.n1.is_read)
        self.assertEqual(response.data["notification"]["is_read"], True)

    def test_mark_notification_read_wrong_user(self):
        """PATCH /api/v1/notifications/{id}/read/ for another user's notification returns 403."""
        response = self.client.patch(
            f"/api/v1/notifications/{self.n_bob.id}/read/",
            format="json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["error"]["code"], "permission_denied")
        self.n_bob.refresh_from_db()
        self.assertFalse(self.n_bob.is_read)

    def test_mark_notification_read_nonexistent(self):
        """PATCH /api/v1/notifications/{id}/read/ for nonexistent id returns 404."""
        response = self.client.patch(
            "/api/v1/notifications/999999/read/",
            format="json",
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data["error"]["code"], "not_found")

    def test_notification_read_bulk(self):
        """POST /api/v1/notifications/read_bulk/ marks multiple notifications as read."""
        response = self.client.post(
            "/api/v1/notifications/read_bulk/",
            {"notification_ids": [self.n1.id, self.n2.id]},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["error"], None)
        self.assertEqual(response.data["updated"], 2)
        self.n1.refresh_from_db()
        self.n2.refresh_from_db()
        self.assertTrue(self.n1.is_read)
        self.assertTrue(self.n2.is_read)

    def test_notification_read_bulk_only_own(self):
        """Bulk read only marks the caller's own notifications."""
        response = self.client.post(
            "/api/v1/notifications/read_bulk/",
            {"notification_ids": [self.n1.id, self.n_bob.id]},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        # Only n1 (alice's) should be updated; n_bob (bob's) should be skipped
        self.assertEqual(response.data["updated"], 1)
        self.n1.refresh_from_db()
        self.n_bob.refresh_from_db()
        self.assertTrue(self.n1.is_read)
        self.assertFalse(self.n_bob.is_read)

    def test_notification_read_bulk_invalid_payload(self):
        """POST /api/v1/notifications/read_bulk/ with non-list notification_ids returns 400."""
        response = self.client.post(
            "/api/v1/notifications/read_bulk/",
            {"notification_ids": "not-a-list"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"]["code"], "validation_error")

    def test_generate_notification_task(self):
        """Celery task generate_notification creates a notification."""
        result = generate_notification.apply(
            args=(),
            kwargs={
                "_workspace_id": self.workspace.id,
                "user_id": self.user.id,
                "workspace_id": self.workspace.id,
                "notification_type": "sprint_completed",
                "entity_type": "sprint",
                "entity_id": 10,
                "payload": {"sprint_name": "Sprint Alpha"},
            },
        )
        self.assertIsNotNone(result.result)
        self.assertEqual(result.result["notification_type"], "sprint_completed")
        self.assertEqual(result.result["user_id"], self.user.id)
        self.assertEqual(result.result["workspace_id"], self.workspace.id)
        # Verify the notification was actually created
        n = Notification.objects.get(id=result.result["notification_id"])
        self.assertEqual(n.user, self.user)
        self.assertEqual(n.workspace, self.workspace)
        self.assertEqual(n.notification_type, "sprint_completed")
        self.assertEqual(n.entity_type, "sprint")
        self.assertEqual(n.entity_id, 10)
        self.assertEqual(n.payload, {"sprint_name": "Sprint Alpha"})
        self.assertFalse(n.is_read)

    def test_generate_notification_task_missing_user(self):
        """Celery task with nonexistent user returns error."""
        result = generate_notification.apply(
            args=(),
            kwargs={
                "_workspace_id": self.workspace.id,
                "user_id": 999999,
                "workspace_id": self.workspace.id,
                "notification_type": "issue_assigned",
            },
        )
        self.assertIsNotNone(result.result)
        self.assertEqual(result.result["error"], "user or workspace not found")
