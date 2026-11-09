"""Workspace tests for F04 Step 1."""

import os

from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from workspaces.models import Workspace, Membership

User = get_user_model()


class WorkspaceTestCase(TestCase):
    """Test suite for workspace endpoints."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user("alice", "alice@example.com", os.getenv('SECRET_TEST_PASS', 'testpass123'))
        # Log in the client
        self.client.login(username="alice", password=os.getenv('SECRET_TEST_PASS', 'testpass123'))

    def test_create_workspace_valid(self):
        """POST /api/v1/workspaces/ with valid name creates workspace."""
        response = self.client.post(
            "/api/v1/workspaces/create/",
            {"name": "Acme"},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["workspace"]["name"], "Acme")
        self.assertEqual(response.data["workspace"]["role"], "owner")
        # Verify Location header
        self.assertIn("Location", response.headers)

    def test_create_workspace_blank_name(self):
        """POST /api/v1/workspaces/ with blank name fails."""
        response = self.client.post(
            "/api/v1/workspaces/create/",
            {"name": ""},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_create_workspace_whitespace_name(self):
        """POST /api/v1/workspaces/ with whitespace-only name fails."""
        response = self.client.post(
            "/api/v1/workspaces/create/",
            {"name": "   "},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_create_workspace_overlong_name(self):
        """POST /api/v1/workspaces/ with overlong name fails."""
        response = self.client.post(
            "/api/v1/workspaces/create/",
            {"name": "x" * 101},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_list_workspaces(self):
        """GET /api/v1/workspaces/ lists user's workspaces."""
        # Create a workspace first
        self.client.post("/api/v1/workspaces/create/", {"name": "Acme"}, format="json")
        # Create another workspace
        response = self.client.post(
            "/api/v1/workspaces/create/",
            {"name": "Stark Industries"},
            format="json",
        )
        self.assertEqual(response.status_code, 201)

        # List workspaces
        response = self.client.get("/api/v1/workspaces/", format="json")
        self.assertEqual(response.status_code, 200)
        self.assertGreaterEqual(len(response.data.get("results", [])), 2)

    def test_workspace_detail_accessible(self):
        """GET /api/v1/workspaces/{id}/ accessible to member."""
        create_resp = self.client.post(
            "/api/v1/workspaces/create/", {"name": "Acme"}, format="json"
        )
        workspace_id = create_resp.data["workspace"]["id"]

        response = self.client.get(
            f"/api/v1/workspaces/{workspace_id}/",
            format="json",
        )
        self.assertEqual(response.status_code, 200)

    def test_workspace_detail_inaccessible(self):
        """GET /api/v1/workspaces/{id}/ returns 404 for inaccessible workspace."""
        # Create another workspace as a different user
        other_user = User.objects.create_user("bob", "bob@example.com", os.getenv('SECRET_TEST_PASS', 'testpass123'))
        self.client.login(username="bob", password=os.getenv('SECRET_TEST_PASS', 'testpass123'))
        other_resp = self.client.post(
            "/api/v1/workspaces/create/",
            {"name": "Other"},
            format="json",
        )
        other_id = other_resp.data["workspace"]["id"]

        # Switch back to alice
        self.client.login(username="alice", password=os.getenv('SECRET_TEST_PASS', 'testpass123'))
        response = self.client.get(
            f"/api/v1/workspaces/{other_id}/",
            format="json",
        )
        # Should return 404 since alice is not a member of Other
        self.assertEqual(response.status_code, 404)

    def test_workspace_same_name_distinct(self):
        """Two workspaces with same name get distinct identifiers."""
        # This is implicitly tested by creating two workspaces
        # The server-generated IDs will be different
        resp1 = self.client.post(
            "/api/v1/workspaces/create/", {"name": "Acme"}, format="json"
        )
        resp2 = self.client.post(
            "/api/v1/workspaces/create/", {"name": "Acme"}, format="json"
        )
        self.assertEqual(resp1.status_code, 201)
        self.assertEqual(resp2.status_code, 201)
        self.assertNotEqual(
            resp1.data["workspace"]["id"], resp2.data["workspace"]["id"]
        )

    def test_workspace_rename_owner_success(self):
        """Owner renames workspace successfully."""
        # Create workspace first
        create_resp = self.client.post(
            "/api/v1/workspaces/create/", {"name": "Acme"}, format="json"
        )
        workspace_id = create_resp.data["workspace"]["id"]
        # Now rename as owner
        resp = self.client.post(
            f"/api/v1/workspaces/{workspace_id}/rename/",
            {"name": "New Name"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["workspace"]["name"], "New Name")
        self.assertEqual(resp.data["workspace"]["role"], "owner")

    def test_workspace_rename_non_owner_forbidden(self):
        """Non-owner attempting to rename gets 403."""
        # Create workspace as alice
        create_resp = self.client.post(
            "/api/v1/workspaces/create/", {"name": "Acme"}, format="json"
        )
        workspace_id = create_resp.data["workspace"]["id"]

        # Create another user and try to rename
        other_user = User.objects.create_user("bob", "bob@example.com", os.getenv('SECRET_TEST_PASS', 'testpass123'))
        self.client.login(username="bob", password=os.getenv('SECRET_TEST_PASS', 'testpass123'))
        response = self.client.post(
            f"/api/v1/workspaces/{workspace_id}/rename/",
            {"name": "Renamed"},
            format="json",
        )
        self.client.login(username="alice", password=os.getenv('SECRET_TEST_PASS', 'testpass123'))
        self.assertEqual(response.status_code, 403)

    def test_workspace_rename_invalid_name_fails(self):
        """Invalid/blank name fails with 400."""
        # Create workspace first
        create_resp = self.client.post(
            "/api/v1/workspaces/create/", {"name": "Acme"}, format="json"
        )
        workspace_id = create_resp.data["workspace"]["id"]
        # Try with blank name
        resp = self.client.post(
            f"/api/v1/workspaces/{workspace_id}/rename/",
            {"name": ""},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)

    def test_workspace_rename_overlong_name_fails(self):
        """Overlong name fails with 400."""
        # Create workspace first
        create_resp = self.client.post(
            "/api/v1/workspaces/create/", {"name": "Acme"}, format="json"
        )
        workspace_id = create_resp.data["workspace"]["id"]
        # Try with overlong name
        resp = self.client.post(
            f"/api/v1/workspaces/{workspace_id}/rename/",
            {"name": "x" * 101},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)