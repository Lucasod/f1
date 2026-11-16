"""Workspace restoration tests for F04 MP-F04-015A.

Covers workspace restore: owner-only enforcement, 404 for non-deleted
and already-restored workspaces, detail endpoint 404 before restore,
membership/project preservation, and anonymous access denial.
"""

import os

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from workspaces.models import Workspace, Membership, Project

User = get_user_model()


class RestoreWorkspaceTestCase(TestCase):
    """Test suite for workspace restoration."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            "alice", "alice@example.com", os.getenv("SECRET_TEST_PASS", "testpass123")
        )
        self.client.login(
            username="alice", password=os.getenv("SECRET_TEST_PASS", "testpass123")
        )
        self.ws = Workspace.objects.create(name="Restore Workspace")
        Membership.objects.create(user=self.user, workspace=self.ws, role="owner")

    def _soft_delete(self):
        self.ws.deleted_at = timezone.now()
        self.ws.save(update_fields=["deleted_at"])
        self.ws.refresh_from_db()

    def _restore(self, workspace_id=None):
        target = workspace_id or self.ws.id
        return self.client.post(
            f"/api/v1/workspaces/{target}/restore/",
            {},
            format="json",
        )

    def test_restore_workspace_owner_only(self):
        """Non-owner attempting restore gets 403."""
        self._soft_delete()
        bob = User.objects.create_user(
            "bob", "bob@example.com", os.getenv("SECRET_TEST_PASS", "testpass123")
        )
        bob_client = APIClient()
        bob_client.login(
            username="bob", password=os.getenv("SECRET_TEST_PASS", "testpass123")
        )
        response = bob_client.post(
            f"/api/v1/workspaces/{self.ws.id}/restore/",
            {},
            format="json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["error"]["code"], "permission_denied")

    def test_restore_workspace_success(self):
        """Owner restores deleted workspace, gets 200 and cleared deleted_at."""
        self._soft_delete()
        self.assertIsNotNone(self.ws.deleted_at)
        response = self._restore()
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.data["workspace"]["deleted_at"])
        self.ws.refresh_from_db()
        self.assertIsNone(self.ws.deleted_at)

    def test_restore_workspace_not_deleted(self):
        """Restoring a non-deleted workspace gets 404."""
        response = self._restore()
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data["error"]["code"], "not_found")

    def test_restore_repeated_is_idempotent(self):
        """Restoring an already-restored workspace gets 404."""
        self._soft_delete()
        self._restore()
        # Workspace is no longer in the deleted queryset -> 404
        response = self._restore()
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data["error"]["code"], "not_found")

    def test_deleted_workspace_inaccessible_before_restore(self):
        """Deleted workspace returns 404 on detail endpoint."""
        self._soft_delete()
        response = self.client.get(
            f"/api/v1/workspaces/{self.ws.id}/", format="json"
        )
        self.assertEqual(response.status_code, 404)

    def test_restore_preserves_memberships(self):
        """Memberships are preserved after restore."""
        self._soft_delete()
        self.assertEqual(Membership.objects.filter(workspace=self.ws).count(), 1)
        self._restore()
        self.assertEqual(
            Membership.objects.filter(workspace=self.ws, role="owner").count(), 1
        )

    def test_restore_preserves_projects(self):
        """Projects are preserved after restore."""
        Project.objects.create(
            key="PROJ",
            name="Preserved Project",
            workspace=self.ws,
        )
        self._soft_delete()
        self.assertEqual(Project.objects.filter(workspace=self.ws).count(), 1)
        self._restore()
        self.assertEqual(Project.objects.filter(workspace=self.ws).count(), 1)

    def test_anonymous_cannot_restore(self):
        """Unauthenticated restore attempt gets 401/403."""
        self._soft_delete()
        anon_client = APIClient()
        response = anon_client.post(
            f"/api/v1/workspaces/{self.ws.id}/restore/",
            {},
            format="json",
        )
        self.assertIn(response.status_code, (401, 403))
