"""Workspace tests for F04 Step 1."""

import os

from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from workspaces.models import Workspace, Membership, WorkspaceBilling

User = get_user_model()


class WorkspaceTestCase(TestCase):
    """Test suite for workspace endpoints."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user("alice", "alice@example.com", os.environ["SECRET_TEST_PASS"])
        # Log in the client
        self.client.login(username="alice", password=os.environ["SECRET_TEST_PASS"])

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
        """GET /api/v1/workspaces/ lists only the caller's own workspaces."""
        # Alice creates her own workspace
        self.client.post("/api/v1/workspaces/create/", {"name": "Acme"}, format="json")

        # Bob (different user) creates his own workspace
        bob = User.objects.create_user("bob", "bob@example.com", os.environ["SECRET_TEST_PASS"])
        self.client.login(username="bob", password=os.environ["SECRET_TEST_PASS"])
        self.client.post("/api/v1/workspaces/create/", {"name": "Stark Industries"}, format="json")

        # Switch back to Alice and list — she should see only her own workspace
        self.client.login(username="alice", password=os.environ["SECRET_TEST_PASS"])
        response = self.client.get("/api/v1/workspaces/", format="json")
        self.assertEqual(response.status_code, 200)
        results = response.data.get("results", [])
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["name"], "Acme")

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
        other_user = User.objects.create_user("bob", "bob@example.com", os.environ["SECRET_TEST_PASS"])
        self.client.login(username="bob", password=os.environ["SECRET_TEST_PASS"])
        other_resp = self.client.post(
            "/api/v1/workspaces/create/",
            {"name": "Other"},
            format="json",
        )
        other_id = other_resp.data["workspace"]["id"]

        # Switch back to alice
        self.client.login(username="alice", password=os.environ["SECRET_TEST_PASS"])
        response = self.client.get(
            f"/api/v1/workspaces/{other_id}/",
            format="json",
        )
        # Should return 404 since alice is not a member of Other
        self.assertEqual(response.status_code, 404)

    def test_workspace_same_name_distinct(self):
        """Two different users can each create a workspace with the same name."""
        # Alice creates "Acme"
        resp1 = self.client.post(
            "/api/v1/workspaces/create/", {"name": "Acme"}, format="json"
        )
        self.assertEqual(resp1.status_code, 201)

        # Bob (different user) creates a workspace with the same name "Acme"
        bob = User.objects.create_user("bob", "bob@example.com", os.environ["SECRET_TEST_PASS"])
        self.client.login(username="bob", password=os.environ["SECRET_TEST_PASS"])
        resp2 = self.client.post(
            "/api/v1/workspaces/create/", {"name": "Acme"}, format="json"
        )
        self.client.login(username="alice", password=os.environ["SECRET_TEST_PASS"])
        self.assertEqual(resp2.status_code, 201)
        self.assertNotEqual(
            resp1.data["workspace"]["id"], resp2.data["workspace"]["id"]
        )

    def test_free_user_cannot_create_second_workspace(self):
        """Free user is blocked (409 plan_limit_reached) when creating a second workspace."""
        # First workspace succeeds
        resp1 = self.client.post(
            "/api/v1/workspaces/create/", {"name": "Free Workspace"}, format="json"
        )
        self.assertEqual(resp1.status_code, 201)

        # Second workspace is blocked by the Free=1 limit
        resp2 = self.client.post(
            "/api/v1/workspaces/create/", {"name": "Second Workspace"}, format="json"
        )
        self.assertEqual(resp2.status_code, 409)
        self.assertEqual(resp2.data["error"]["code"], "plan_limit_reached")
        self.assertEqual(resp2.data["error"]["fields"]["plan"], "free")
        self.assertEqual(resp2.data["error"]["fields"]["limit"], 1)

    def test_pro_user_can_create_multiple_workspaces(self):
        """Pro user can create multiple workspaces after upgrading to Pro."""
        # First workspace succeeds (free plan by default)
        resp1 = self.client.post(
            "/api/v1/workspaces/create/", {"name": "Pro Workspace 1"}, format="json"
        )
        self.assertEqual(resp1.status_code, 201)

        # Upgrade to Pro: set effective_plan on the workspace's billing record
        workspace = Workspace.objects.get(id=resp1.data["workspace"]["id"])
        billing = WorkspaceBilling.objects.get(workspace=workspace)
        billing.effective_plan = "pro"
        billing.save(update_fields=["effective_plan"])

        # Second workspace succeeds for a Pro user
        resp2 = self.client.post(
            "/api/v1/workspaces/create/", {"name": "Pro Workspace 2"}, format="json"
        )
        self.assertEqual(resp2.status_code, 201)
        self.assertNotEqual(
            resp1.data["workspace"]["id"], resp2.data["workspace"]["id"]
        )

    def test_member_of_pro_workspace_does_not_get_pro_privileges(self):
        """A mere member (not owner) of a Pro workspace does not get Pro
        creation privileges for their own workspaces."""
        # Alice creates a workspace and upgrades it to Pro
        resp1 = self.client.post(
            "/api/v1/workspaces/create/", {"name": "Alice's Pro Workspace"}, format="json"
        )
        self.assertEqual(resp1.status_code, 201)
        alice_ws_id = resp1.data["workspace"]["id"]
        alice_ws = Workspace.objects.get(id=alice_ws_id)
        # Upgrade Alice's workspace to Pro (billing row was auto-created as Free)
        billing = WorkspaceBilling.objects.get(workspace=alice_ws)
        billing.effective_plan = "pro"
        billing.save(update_fields=["effective_plan"])

        # Bob is added as a MEMBER (not owner) of Alice's Pro workspace
        bob = User.objects.create_user(
            "bob", "bob@example.com", os.environ["SECRET_TEST_PASS"]
        )
        Membership.objects.create(
            user=bob, workspace=alice_ws, role="member"
        )

        # Bob logs in and creates his own first workspace (succeeds)
        self.client.login(username="bob", password=os.environ["SECRET_TEST_PASS"])
        resp2 = self.client.post(
            "/api/v1/workspaces/create/", {"name": "Bob's Workspace 1"}, format="json"
        )
        self.assertEqual(resp2.status_code, 201)
        bob_ws_id = resp2.data["workspace"]["id"]
        self.assertNotEqual(alice_ws_id, bob_ws_id)

        # Bob tries to create a second workspace — must be blocked (409)
        # because Bob only owns free workspaces; membership in Alice's Pro
        # workspace does not confer Pro privileges to Bob.
        resp3 = self.client.post(
            "/api/v1/workspaces/create/", {"name": "Bob's Workspace 2"}, format="json"
        )
        self.assertEqual(resp3.status_code, 409)
        self.assertEqual(resp3.data["error"]["code"], "plan_limit_reached")
        self.assertEqual(resp3.data["error"]["fields"]["plan"], "free")
        self.assertEqual(resp3.data["error"]["fields"]["limit"], 1)

        # Switch back to alice
        self.client.login(username="alice", password=os.environ["SECRET_TEST_PASS"])

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
        other_user = User.objects.create_user("bob", "bob@example.com", os.environ["SECRET_TEST_PASS"])
        self.client.login(username="bob", password=os.environ["SECRET_TEST_PASS"])
        response = self.client.post(
            f"/api/v1/workspaces/{workspace_id}/rename/",
            {"name": "Renamed"},
            format="json",
        )
        self.client.login(username="alice", password=os.environ["SECRET_TEST_PASS"])
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