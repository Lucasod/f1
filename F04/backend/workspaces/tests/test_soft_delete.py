"""Soft deletion tests for F04 MP-F04-015.

Covers workspace soft deletion: owner-only enforcement, confirmation
validation, billing_not_closed blocking, successful deletion, 404 after
deletion, list exclusion, and repeated deletion.
"""

import os

from django.test import TestCase
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from workspaces.models import Workspace, Membership, WorkspaceBilling

User = get_user_model()


class SoftDeleteTestCase(TestCase):
    """Test suite for workspace soft deletion."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            "alice", "alice@example.com", os.environ["SECRET_TEST_PASS"]
        )
        self.client.login(
            username="alice", password=os.environ["SECRET_TEST_PASS"]
        )
        self.ws = Workspace.objects.create(name="Soft Delete Workspace")
        Membership.objects.create(user=self.user, workspace=self.ws, role="owner")

    def _delete(self, confirmation_name=None):
        payload = {}
        if confirmation_name is not None:
            payload["confirmation_name"] = confirmation_name
        return self.client.delete(
            f"/api/v1/workspaces/{self.ws.id}/delete/",
            payload,
            format="json",
        )

    def test_delete_workspace_owner_only(self):
        """Non-owner attempting deletion gets 403."""
        bob = User.objects.create_user(
            "bob", "bob@example.com", os.environ["SECRET_TEST_PASS"]
        )
        bob_client = APIClient()
        bob_client.login(
            username="bob", password=os.environ["SECRET_TEST_PASS"]
        )
        response = bob_client.delete(
            f"/api/v1/workspaces/{self.ws.id}/delete/",
            {"confirmation_name": self.ws.name},
            format="json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["error"]["code"], "permission_denied")

    def test_delete_workspace_confirmation_required(self):
        """Missing or mismatched confirmation gets 400."""
        response = self._delete(confirmation_name=None)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"]["code"], "validation_error")

        response = self._delete(confirmation_name="Wrong Name")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"]["code"], "validation_error")

    def test_delete_workspace_billing_not_closed(self):
        """Pro workspace with active billing gets 409 billing_not_closed."""
        WorkspaceBilling.objects.create(
            workspace=self.ws,
            effective_plan="pro",
            provider_status="active",
        )
        response = self._delete(confirmation_name=self.ws.name)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["error"]["code"], "billing_not_closed")

    def test_delete_workspace_success(self):
        """Free workspace gets 204 and deleted_at is set."""
        response = self._delete(confirmation_name=self.ws.name)
        self.assertEqual(response.status_code, 204)
        self.ws.refresh_from_db()
        self.assertIsNotNone(self.ws.deleted_at)

    def test_deleted_workspace_404_after_deletion(self):
        """Deleted workspace is not found (404)."""
        self._delete(confirmation_name=self.ws.name)
        response = self.client.get(
            f"/api/v1/workspaces/{self.ws.id}/", format="json"
        )
        self.assertEqual(response.status_code, 404)

    def test_list_excludes_deleted_workspaces(self):
        """Deleted workspace is not included in the list."""
        self._delete(confirmation_name=self.ws.name)
        response = self.client.get("/api/v1/workspaces/", format="json")
        self.assertEqual(response.status_code, 200)
        ids = [workspace["id"] for workspace in response.data.get("results", [])]
        self.assertNotIn(self.ws.id, ids)

    def test_repeated_delete_returns_404(self):
        """Deleting an already-deleted workspace returns 404."""
        self._delete(confirmation_name=self.ws.name)
        response = self._delete(confirmation_name=self.ws.name)
        self.assertEqual(response.status_code, 404)
