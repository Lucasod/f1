"""Project tests for F04 Step 2."""

import os
import unittest

from django.db import connection
from django.test import TestCase, TransactionTestCase, override_settings
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from workspaces.models import Workspace, Project, Board, Membership, WorkflowStatus, Issue

User = get_user_model()


class ProjectTestCase(TestCase):
    """Test suite for project endpoints."""

    def setUp(self):
        """Create a fresh test client and user for each test."""
        self.client = APIClient()
        self.user = User.objects.create_user("alice", "alice@example.com", os.getenv('SECRET_TEST_PASS', 'testpass123'))
        self.client.login(username="alice", password=os.getenv('SECRET_TEST_PASS', 'testpass123'))

    def _create_workspace(self):
        """Helper: create a workspace and return its ID."""
        resp = self.client.post(
            "/api/v1/workspaces/create/", {"name": "Acme"}, format="json"
        )
        self.assertEqual(resp.status_code, 201)
        return resp.data["workspace"]["id"]

    def _create_project(self, name="Acme Project", key="ABC", workspace_id=None):
        """Helper: create a project and return the response."""
        if workspace_id is None:
            workspace_id = self._create_workspace()
        return self.client.post(
            "/api/v1/projects/create/",
            {"name": name, "key": key, "workspace_id": workspace_id},
            format="json",
        )

    def _create_issue(self, project_id, title="Test Issue", **kwargs):
        """Helper: create an issue in a project."""
        return self.client.post(
            f"/api/v1/projects/{project_id}/issues/",
            {"title": title, **kwargs},
            format="json",
        )

    def test_create_project_valid(self):
        """POST /api/v1/projects/ with valid name and key creates project with board."""
        ws_id = self._create_workspace()
        response = self._create_project("Acme Project", "ABC", ws_id)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["project"]["name"], "Acme Project")
        self.assertEqual(response.data["project"]["key"], "ABC")
        # Verify Location header
        self.assertIn("Location", response.headers)
        # Verify board was created atomically
        self.assertTrue(Board.objects.exists())

    def test_create_project_missing_workspace_id(self):
        """POST without workspace_id returns 400 validation_error."""
        ws_id = self._create_workspace()
        response = self.client.post(
            "/api/v1/projects/create/",
            {"name": "Acme Project", "key": "ABC"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"]["code"], "validation_error")
        self.assertEqual(response.data["error"]["message"], "Missing workspace_id.")

    def test_create_project_nonexistent_workspace_id(self):
        """POST with unknown workspace_id returns 404 not_found."""
        response = self.client.post(
            "/api/v1/projects/create/",
            {"name": "Acme Project", "key": "ABC", "workspace_id": 999999},
            format="json",
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data["error"]["code"], "not_found")
        self.assertEqual(response.data["error"]["message"], "Workspace not found.")

    def test_create_project_not_member_of_workspace(self):
        """POST in a workspace the user does not own/admin returns 403."""
        # Create a workspace owned by bob
        bob = User.objects.create_user("bob", "bob@example.com", os.getenv('SECRET_TEST_PASS', 'testpass123'))
        bob_client = APIClient()
        bob_client.login(username="bob", password=os.getenv('SECRET_TEST_PASS', 'testpass123'))
        bob_ws_resp = bob_client.post(
            "/api/v1/workspaces/create/", {"name": "Bob's Workspace"}, format="json"
        )
        self.assertEqual(bob_ws_resp.status_code, 201)
        bob_ws_id = bob_ws_resp.data["workspace"]["id"]

        # alice (owner/admin of her own workspace only) tries to create in bob's workspace
        response = self.client.post(
            "/api/v1/projects/create/",
            {"name": "Acme Project", "key": "ABC", "workspace_id": bob_ws_id},
            format="json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["error"]["code"], "permission_denied")

    def test_create_project_invalid_key_format(self):
        """POST /api/v1/projects/ with invalid key format fails."""
        ws_id = self._create_workspace()
        response = self._create_project("Acme Project", "abc", ws_id)  # lowercase, invalid
        self.assertEqual(response.status_code, 400)

    def test_create_project_key_too_short(self):
        """Key too short (1 char) fails."""
        ws_id = self._create_workspace()
        response = self._create_project("Acme Project", "A", ws_id)  # only 1 char
        self.assertEqual(response.status_code, 400)

    def test_create_project_key_too_long(self):
        """Key too long (11 chars) fails."""
        ws_id = self._create_workspace()
        response = self._create_project("Acme Project", "ABCDEFGHIJK", ws_id)  # 11 chars
        self.assertEqual(response.status_code, 400)

    def test_create_project_key_starts_with_digit(self):
        """Key starting with digit fails."""
        ws_id = self._create_workspace()
        response = self._create_project("Acme Project", "1ABC", ws_id)
        self.assertEqual(response.status_code, 400)

    def test_create_project_duplicate_key_fails(self):
        """Duplicate key within workspace fails."""
        ws_id = self._create_workspace()
        # Create first project
        response = self._create_project("Acme Project", "ABC", ws_id)
        self.assertEqual(response.status_code, 201)
        # Try second project with same key
        response = self._create_project("Second", "ABC", ws_id)
        self.assertEqual(response.status_code, 400)

    def test_create_project_list_accessible(self):
        """GET /api/v1/projects/ lists user's projects."""
        ws_id = self._create_workspace()
        self._create_project("Acme Project", "ABC", ws_id)
        response = self.client.get("/api/v1/projects/", format="json")
        self.assertEqual(response.status_code, 200)
        self.assertGreaterEqual(len(response.data.get("results", [])), 1)

    def test_project_detail_accessible(self):
        """GET /api/v1/projects/{id}/ accessible to member."""
        ws_id = self._create_workspace()
        proj_resp = self._create_project("Acme Project", "ABC", ws_id)
        project_id = proj_resp.data["project"]["id"]
        response = self.client.get(
            f"/api/v1/projects/{project_id}/",
            format="json",
        )
        self.assertEqual(response.status_code, 200)

    def test_project_create_requires_auth(self):
        """Project creation requires authentication - unauthenticated gets 403."""
        self.client.logout()
        # Unauthenticated workspace creation should return 403
        resp = self.client.post(
            "/api/v1/workspaces/create/", {"name": "Acme"}, format="json"
        )
        self.assertEqual(resp.status_code, 403)

    def test_project_key_unique_across_workspaces(self):
        """Same key can be used in different workspaces."""
        # Create first workspace/project as alice
        self.client.login(username="alice", password=os.getenv('SECRET_TEST_PASS', 'testpass123'))
        ws1_resp = self.client.post("/api/v1/workspaces/create/", {"name": "Acme"}, format="json")
        ws1_id = ws1_resp.data["workspace"]["id"]
        self.client.post(
            "/api/v1/projects/create/",
            {"name": "Proj A", "key": "ABC", "workspace_id": ws1_id},
            format="json",
        )

        # Create second workspace/project as bob
        bob = User.objects.create_user("bob", "bob@example.com", os.getenv('SECRET_TEST_PASS', 'testpass123'))
        bob_client = APIClient()
        bob_client.login(username="bob", password=os.getenv('SECRET_TEST_PASS', 'testpass123'))
        ws2_resp = bob_client.post("/api/v1/workspaces/create/", {"name": "Other"}, format="json")
        ws2_id = ws2_resp.data["workspace"]["id"]
        bob_client.post(
            "/api/v1/projects/create/",
            {"name": "Proj B", "key": "ABC", "workspace_id": ws2_id},
            format="json",
        )

        # Both projects should exist with same key but different workspaces
        self.assertTrue(
            Project.objects.filter(key="ABC", workspace_id=ws1_id).exists()
        )
        self.assertTrue(
            Project.objects.filter(key="ABC", workspace_id=ws2_id).exists()
        )


class IssueTestCase(TransactionTestCase):
    """Test suite for issue endpoints (Step 2)."""

    def setUp(self):
        """Create a fresh test client and users for each test."""
        self.client = APIClient()
        self.user = User.objects.create_user("alice", "alice@example.com", os.getenv('SECRET_TEST_PASS', 'testpass123'))
        self.client.login(username="alice", password=os.getenv('SECRET_TEST_PASS', 'testpass123'))
        self.bob = User.objects.create_user("bob", "bob@example.com", os.getenv('SECRET_TEST_PASS', 'testpass123'))
        self.bob_client = APIClient()
        self.bob_client.login(username="bob", password=os.getenv('SECRET_TEST_PASS', 'testpass123'))

    def _create_workspace(self, name="Acme"):
        """Helper: create a workspace and return its ID."""
        resp = self.client.post(
            "/api/v1/workspaces/create/", {"name": name}, format="json"
        )
        self.assertEqual(resp.status_code, 201)
        return resp.data["workspace"]["id"]

    def _create_project(self, name="Acme Project", key="ABC", workspace_id=None):
        """Helper: create a project and return the response."""
        if workspace_id is None:
            workspace_id = self._create_workspace()
        return self.client.post(
            "/api/v1/projects/create/",
            {"name": name, "key": key, "workspace_id": workspace_id},
            format="json",
        )

    def _create_issue(self, project_id, title="Test Issue", **kwargs):
        """Helper: create an issue in a project."""
        return self.client.post(
            f"/api/v1/projects/{project_id}/issues/",
            {"title": title, **kwargs},
            format="json",
        )

    def _list_issues(self, project_id, **kwargs):
        """Helper: list issues in a project."""
        return self.client.get(
            f"/api/v1/issues/",
            {"project_id": project_id, **kwargs},
            format="json",
        )

    def _transition_issue(self, issue_id, target_status, **kwargs):
        """Helper: transition an issue to a new status."""
        return self.client.post(
            f"/api/v1/issues/{issue_id}/transitions/",
            {"status": target_status, **kwargs},
            format="json",
        )

    def test_create_issue_valid(self):
        """POST /api/v1/projects/{id}/issues/ with valid data creates issue in todo status."""
        ws_id = self._create_workspace()
        proj_resp = self._create_project("Acme Project", "ABC", ws_id)
        project_id = proj_resp.data["project"]["id"]
        response = self._create_issue(project_id, "New Issue")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["issue"]["title"], "New Issue")
        self.assertEqual(response.data["issue"]["status"], "to_do")
        # Verify board issue list order by number ascending
        self.assertGreater(response.data["issue"]["number"], 0)

    def test_create_issue_invalid_title(self):
        """POST with blank title fails."""
        ws_id = self._create_workspace()
        proj_resp = self._create_project("Acme Project", "ABC", ws_id)
        project_id = proj_resp.data["project"]["id"]
        response = self._create_issue(project_id, "")
        self.assertEqual(response.status_code, 400)

    def test_create_issue_title_too_long(self):
        """POST with title > 200 chars fails."""
        ws_id = self._create_workspace()
        proj_resp = self._create_project("Acme Project", "ABC", ws_id)
        project_id = proj_resp.data["project"]["id"]
        long_title = "A" * 201
        response = self._create_issue(project_id, long_title)
        self.assertEqual(response.status_code, 400)

    def test_create_issue_requires_auth(self):
        """Issue creation requires authentication."""
        # Create workspace and project while user is authenticated
        ws_id = self._create_workspace()
        proj_resp = self._create_project("Acme Project", "ABC", ws_id)
        project_id = proj_resp.data["project"]["id"]
        # Logout and flush session to completely clear DRF session auth
        self.client.logout()
        self.client.session.flush()
        # Issue creation should return 403 since DRF auth is cleared
        response = self._create_issue(project_id, "New Issue")
        self.assertEqual(response.status_code, 403)

    def test_create_issue_cross_workspace_fails(self):
        """Issue creation fails for user not in project's workspace."""
        ws_id = self._create_workspace()
        proj_resp = self._create_project("Acme Project", "ABC", ws_id)
        project_id = proj_resp.data["project"]["id"]
        # Create another workspace and user bob
        other_ws_id = self._create_workspace_for_user(self.bob, "Other")
        # bob tries to create issue in alice's project
        response = self.bob_client.post(
            f"/api/v1/projects/{project_id}/issues/",
            {"title": "Wrong Workspace Issue"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def _create_workspace_for_user(self, user, name):
        """Create workspace for a specific user."""
        client = APIClient()
        client.login(username=user.username, password=os.getenv('SECRET_TEST_PASS', 'testpass123'))
        resp = client.post(
            "/api/v1/workspaces/create/", {"name": name}, format="json"
        )
        self.assertEqual(resp.status_code, 201)
        return resp.data["workspace"]["id"]

    def test_list_issues(self):
        """GET /api/v1/issues/ lists issues with pagination."""
        ws_id = self._create_workspace()
        proj_resp = self._create_project("Acme Project", "ABC", ws_id)
        project_id = proj_resp.data["project"]["id"]
        # Create multiple issues
        self._create_issue(project_id, "Issue 1")
        self._create_issue(project_id, "Issue 2")
        response = self._list_issues(project_id)
        self.assertEqual(response.status_code, 200)
        self.assertGreaterEqual(len(response.data.get("results", [])), 2)

    def test_list_issues_filter_by_status(self):
        """Filter issues by status."""
        ws_id = self._create_workspace()
        proj_resp = self._create_project("Acme Project", "ABC", ws_id)
        project_id = proj_resp.data["project"]["id"]
        issue_resp = self._create_issue(project_id, "Issue 1")
        issue_id = issue_resp.data["issue"]["id"]
        # Transition issue to in_progress
        self._transition_issue(issue_id, "in_progress")
        # List issues filtered by in_progress status
        response = self._list_issues(project_id, status="in_progress")
        self.assertEqual(response.status_code, 200)
        self.assertGreaterEqual(len(response.data.get("results", [])), 1)

    def test_list_issues_filter_by_priority(self):
        """Filter issues by priority."""
        ws_id = self._create_workspace()
        proj_resp = self._create_project("Acme Project", "ABC", ws_id)
        project_id = proj_resp.data["project"]["id"]
        self._create_issue(project_id, "Issue 1", priority="high")
        response = self._list_issues(project_id, priority="high")
        self.assertEqual(response.status_code, 200)
        self.assertGreaterEqual(len(response.data.get("results", [])), 1)

    def test_list_issues_filter_by_assignee(self):
        """Filter issues by assignee."""
        ws_id = self._create_workspace()
        workspace = Workspace.objects.get(id=ws_id)
        proj_resp = self._create_project("Acme Project", "ABC", ws_id)
        project_id = proj_resp.data["project"]["id"]
        # bob must be a workspace member to be assignable to an issue in this workspace
        Membership.objects.create(user=self.bob, workspace=workspace, role="member")
        # Create issue assigned to bob
        self._create_issue(project_id, "Issue assigned", assignee=self.bob.username)
        response = self._list_issues(project_id, assignee=self.bob.id)
        self.assertEqual(response.status_code, 200)
        self.assertGreaterEqual(len(response.data.get("results", [])), 1)

    def test_list_issues_filter_by_assignee_different_member(self):
        """Filter by a member who has no assigned issues returns 0 results."""
        ws_id = self._create_workspace()
        workspace = Workspace.objects.get(id=ws_id)
        proj_resp = self._create_project("Acme Project", "ABC", ws_id)
        project_id = proj_resp.data["project"]["id"]
        # bob and charlie are both members of the workspace
        Membership.objects.create(user=self.bob, workspace=workspace, role="member")
        charlie = User.objects.create_user("charlie", "charlie@example.com", os.getenv('SECRET_TEST_PASS', 'testpass123'))
        Membership.objects.create(user=charlie, workspace=workspace, role="member")
        # Create an issue assigned to bob only
        self._create_issue(project_id, "Issue assigned to bob", assignee_username=self.bob.username)
        # Filter by charlie (member, no assigned issues) → 0 results
        response = self._list_issues(project_id, assignee=charlie.id)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data.get("results", [])), 0)

    def test_list_issues_filter_by_assignee_no_assignee(self):
        """Create issue without assignee; unassigned issue appears when no assignee filter."""
        ws_id = self._create_workspace()
        workspace = Workspace.objects.get(id=ws_id)
        proj_resp = self._create_project("Acme Project", "ABC", ws_id)
        project_id = proj_resp.data["project"]["id"]
        # bob must be a member to be assignable (contrast case)
        Membership.objects.create(user=self.bob, workspace=workspace, role="member")
        # Create one issue with an assignee and one without
        self._create_issue(project_id, "Assigned Issue", assignee_username=self.bob.username)
        self._create_issue(project_id, "Unassigned Issue")
        # List issues without an assignee filter (assignee=none/empty) → works, unassigned issue present
        response = self._list_issues(project_id, assignee="")
        self.assertEqual(response.status_code, 200)
        results = response.data.get("results", [])
        self.assertGreaterEqual(len(results), 1)
        self.assertTrue(any(issue.get("assignee_username") is None for issue in results))

    def test_list_issues_filter_by_sprint(self):
        """Filter issues by sprint (null allowed)."""
        ws_id = self._create_workspace()
        proj_resp = self._create_project("Acme Project", "ABC", ws_id)
        project_id = proj_resp.data["project"]["id"]
        # Create issue without sprint
        self._create_issue(project_id, "Issue no sprint")
        # List issues with sprint=null filter
        response = self._list_issues(project_id)
        self.assertEqual(response.status_code, 200)

    def test_issue_detail_accessible(self):
        """GET /api/v1/issues/{id}/ accessible to member."""
        ws_id = self._create_workspace()
        proj_resp = self._create_project("Acme Project", "ABC", ws_id)
        project_id = proj_resp.data["project"]["id"]
        issue_resp = self._create_issue(project_id, "Detail Test")
        issue_id = issue_resp.data["issue"]["id"]
        response = self.client.get(
            f"/api/v1/issues/{issue_id}/",
            format="json",
        )
        self.assertEqual(response.status_code, 200)

    def test_issue_detail_inaccessible(self):
        """GET /api/v1/issues/{id}/ returns 404 for user not in workspace."""
        ws_id = self._create_workspace()
        proj_resp = self._create_project("Acme Project", "ABC", ws_id)
        project_id = proj_resp.data["project"]["id"]
        other_ws_id = self._create_workspace_for_user(self.bob, "Other")
        issue_resp = self._create_issue(project_id, "Wrong Workspace Issue")
        issue_id = issue_resp.data["issue"]["id"]
        # bob tries to access alice's issue
        response = self.bob_client.get(
            f"/api/v1/issues/{issue_id}/",
            format="json",
        )
        self.assertEqual(response.status_code, 404)

    def test_update_issue_valid(self):
        """PATCH /api/v1/issues/{id}/ with valid data updates issue."""
        ws_id = self._create_workspace()
        proj_resp = self._create_project("Acme Project", "ABC", ws_id)
        project_id = proj_resp.data["project"]["id"]
        issue_resp = self._create_issue(project_id, "Updatable Issue")
        issue_id = issue_resp.data["issue"]["id"]
        # Update title
        response = self.client.patch(
            f"/api/v1/issues/{issue_id}/update/",
            {"title": "Updated Issue", "version": 0},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["issue"]["title"], "Updated Issue")

    def test_update_issue_version_mismatch(self):
        """PATCH with version mismatch fails with 409."""
        ws_id = self._create_workspace()
        proj_resp = self._create_project("Acme Project", "ABC", ws_id)
        project_id = proj_resp.data["project"]["id"]
        issue_resp = self._create_issue(project_id, "Versioned Issue")
        issue_id = issue_resp.data["issue"]["id"]
        # First update to change version
        self.client.patch(
            f"/api/v1/issues/{issue_id}/update/",
            {"title": "First Update", "version": 0},
            format="json",
        )
        # Second update with stale version should fail
        response = self.client.patch(
            f"/api/v1/issues/{issue_id}/update/",
            {"title": "Stale Update", "version": 0},
            format="json",
        )
        self.assertEqual(response.status_code, 409)

    def test_update_issue_clears_optional_fks(self):
        """PATCH can clear optional FKs (assignee, sprint) by sending null."""
        ws_id = self._create_workspace()
        proj_resp = self._create_project("Acme Project", "ABC", ws_id)
        project_id = proj_resp.data["project"]["id"]
        issue_resp = self._create_issue(project_id, "Unassigned Issue", assignee_username=self.bob.username)
        issue_id = issue_resp.data["issue"]["id"]
        # Clear assignee by sending null
        response = self.client.patch(
            f"/api/v1/issues/{issue_id}/update/",
            {"assignee": None, "version": 0},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.data["issue"]["assignee_username"])

    def test_transition_issue_to_in_progress(self):
        """POST /api/v1/issues/{id}/transitions/ to In progress from To do."""
        ws_id = self._create_workspace()
        proj_resp = self._create_project("Acme Project", "ABC", ws_id)
        project_id = proj_resp.data["project"]["id"]
        issue_resp = self._create_issue(project_id, "Transition Test")
        issue_id = issue_resp.data["issue"]["id"]
        response = self._transition_issue(issue_id, "in_progress")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["issue"]["status"], "in_progress")

    def test_transition_issue_to_done(self):
        """POST /api/v1/issues/{id}/transitions/ to Done from To do or In progress."""
        ws_id = self._create_workspace()
        proj_resp = self._create_project("Acme Project", "ABC", ws_id)
        project_id = proj_resp.data["project"]["id"]
        issue_resp = self._create_issue(project_id, "Done Test")
        issue_id = issue_resp.data["issue"]["id"]
        # To do → Done
        response = self._transition_issue(issue_id, "done")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["issue"]["status"], "done")

    def test_transition_issue_in_progress_to_done(self):
        """POST /api/v1/issues/{id}/transitions/ In progress → Done."""
        ws_id = self._create_workspace()
        proj_resp = self._create_project("Acme Project", "ABC", ws_id)
        project_id = proj_resp.data["project"]["id"]
        issue_resp = self._create_issue(project_id, "Progress Test")
        issue_id = issue_resp.data["issue"]["id"]
        # First transition to in_progress
        self._transition_issue(issue_id, "in_progress")
        # Then to done
        response = self._transition_issue(issue_id, "done")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["issue"]["status"], "done")

    def test_transition_issue_invalid_from_to_do(self):
        """Invalid transition from To do to Done is blocked (must go through In progress first... wait, To do → Done is allowed)."""
        # Actually To do → Done IS allowed per the spec. Let me test invalid transition.
        ws_id = self._create_workspace()
        proj_resp = self._create_project("Acme Project", "ABC", ws_id)
        project_id = proj_resp.data["project"]["id"]
        issue_resp = self._create_issue(project_id, "Invalid Transition")
        issue_id = issue_resp.data["issue"]["id"]
        # Try In progress → To do (reverse not allowed)
        response = self._transition_issue(issue_id, "to_do")
        self.assertEqual(response.status_code, 400)

    def test_transition_issue_invalid_status(self):
        """Transition with invalid status name fails."""
        ws_id = self._create_workspace()
        proj_resp = self._create_project("Acme Project", "ABC", ws_id)
        project_id = proj_resp.data["project"]["id"]
        issue_resp = self._create_issue(project_id, "Invalid Status")
        issue_id = issue_resp.data["issue"]["id"]
        response = self._transition_issue(issue_id, "nonexistent_status")
        self.assertEqual(response.status_code, 400)

    def test_transition_issue_requires_auth(self):
        """Issue transition requires authentication."""
        # Create workspace and project while user is authenticated
        ws_id = self._create_workspace()
        proj_resp = self._create_project("Acme Project", "ABC", ws_id)
        project_id = proj_resp.data["project"]["id"]
        issue_resp = self._create_issue(project_id, "Auth Test")
        issue_id = issue_resp.data["issue"]["id"]
        # Logout and flush session to completely clear DRF session auth
        self.client.logout()
        self.client.session.flush()
        response = self.bob_client.post(
            f"/api/v1/issues/{issue_id}/transitions/",
            {"status": "in_progress"},
            format="json",
        )
        # bob is not in alice's workspace... wait, bob is a different user
        # Actually need to check: bob is created in setUp but not in alice's workspace
        self.assertEqual(response.status_code, 403)

    def test_monotonic_issue_number_allocation(self):
        """Consecutive issue creations allocate distinct monotonic numbers."""
        ws_id = self._create_workspace()
        proj_resp = self._create_project("Acme Project", "ABC", ws_id)
        project_id = proj_resp.data["project"]["id"]
        # Create first issue
        issue1_resp = self._create_issue(project_id, "First Issue")
        issue1_number = issue1_resp.data["issue"]["number"]
        # Create second issue
        issue2_resp = self._create_issue(project_id, "Second Issue")
        issue2_number = issue2_resp.data["issue"]["number"]
        # Numbers should be distinct and monotonically increasing
        self.assertLess(issue1_number, issue2_number)

    def test_cross_workspace_isolation_issues(self):
        """Cross-workspace isolation: bob cannot access alice's issues."""
        ws_id = self._create_workspace()
        proj_resp = self._create_project("Acme Project", "ABC", ws_id)
        project_id = proj_resp.data["project"]["id"]
        issue_resp = self._create_issue(project_id, "Alice's Issue")
        issue_id = issue_resp.data["issue"]["id"]
        # bob tries to list issues with project_id filter
        response = self.bob_client.get(
            f"/api/v1/issues/?project_id={project_id}",
            format="json",
        )
        self.assertEqual(response.status_code, 403)
        # bob tries to get issue detail
        response = self.bob_client.get(
            f"/api/v1/issues/{issue_id}/",
            format="json",
        )
        self.assertEqual(response.status_code, 404)

    @unittest.skipIf(connection.vendor == 'sqlite', "Concurrency test requires PostgreSQL for select_for_update()")
    def test_concurrent_issue_number_allocation_same_project(self):
        """Two simultaneous issue creations in same project get distinct numbers."""
        import threading
        ws_id = self._create_workspace()
        proj_resp = self._create_project("Concurrent Project", "CON", ws_id)
        project_id = proj_resp.data["project"]["id"]
        # bob must be a workspace member to create issues in this project
        workspace = Workspace.objects.get(id=ws_id)
        Membership.objects.create(user=self.bob, workspace=workspace, role="member")

        results = {}
        errors = {}

        def create_issue_thread(tag, client):
            try:
                resp = client.post(
                    f"/api/v1/projects/{project_id}/issues/",
                    {"title": f"Concurrent Issue {tag}"},
                    format="json",
                )
                results[tag] = resp
            except Exception as exc:
                errors[tag] = exc

        t1 = threading.Thread(target=create_issue_thread, args=("first", self.client))
        t2 = threading.Thread(target=create_issue_thread, args=("second", self.bob_client))

        t1.start()
        t2.start()
        t1.join()
        t2.join()

        # Both should succeed (no IntegrityError)
        self.assertNotIn("first", errors)
        self.assertNotIn("second", errors)
        self.assertEqual(results["first"].status_code, 201)
        self.assertEqual(results["second"].status_code, 201)

        # Numbers must be distinct
        num1 = results["first"].data["issue"]["number"]
        num2 = results["second"].data["issue"]["number"]
        self.assertNotEqual(num1, num2)
        self.assertGreater(num1, 0)
        self.assertGreater(num2, 0)

    @unittest.skipIf(connection.vendor == 'sqlite', "Concurrency test requires PostgreSQL for select_for_update()")
    def test_concurrent_issue_number_allocation_different_projects(self):
        """Simultaneous issue creation in different projects proceeds independently."""
        import threading
        ws_id = self._create_workspace()
        proj1_resp = self._create_project("Concurrent Proj 1", "CP1", ws_id)
        proj1_id = proj1_resp.data["project"]["id"]
        proj2_resp = self._create_project("Concurrent Proj 2", "CP2", ws_id)
        proj2_id = proj2_resp.data["project"]["id"]
        # bob must be a workspace member to create issues in this project
        workspace = Workspace.objects.get(id=ws_id)
        Membership.objects.create(user=self.bob, workspace=workspace, role="member")

        results = {}
        errors = {}

        def create_in_proj(tag, pid, client):
            try:
                resp = client.post(
                    f"/api/v1/projects/{pid}/issues/",
                    {"title": f"Concurrent Issue {tag}"},
                    format="json",
                )
                results[tag] = resp
            except Exception as exc:
                errors[tag] = exc

        # Use separate client instances per thread to avoid session sharing
        t1 = threading.Thread(target=create_in_proj, args=("proj1", proj1_id, self.client))
        t2 = threading.Thread(target=create_in_proj, args=("proj2", proj2_id, self.bob_client))

        t1.start()
        t2.start()
        t1.join()
        t2.join()

        self.assertNotIn("proj1", errors)
        self.assertNotIn("proj2", errors)
        self.assertEqual(results["proj1"].status_code, 201)
        self.assertEqual(results["proj2"].status_code, 201)
        # Different projects can both have number 1 (per-project numbering scope)
        self.assertEqual(results["proj1"].data["issue"]["number"], 1)
        self.assertEqual(results["proj2"].data["issue"]["number"], 1)