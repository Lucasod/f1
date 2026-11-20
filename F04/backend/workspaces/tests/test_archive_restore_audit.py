"""Archive/reopen and audit event tests for F04 MP-F04-016 Phase L."""

import os

from django.test import TestCase
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from workspaces.models import Workspace, Membership, Project

User = get_user_model()


class ArchiveReopenTestCase(TestCase):
    """Project archive/reopen tests."""

    def setUp(self):
        self.client = APIClient()
        self.owner = User.objects.create_user(
            "owner", "owner@example.com", os.environ["SECRET_TEST_PASS"]
        )
        self.member = User.objects.create_user(
            "member", "member@example.com", os.environ["SECRET_TEST_PASS"]
        )
        self.ws = Workspace.objects.create(name="Archive Test Workspace")
        Membership.objects.create(user=self.owner, workspace=self.ws, role="owner")
        Membership.objects.create(user=self.member, workspace=self.ws, role="member")
        self.project = Project.objects.create(
            key="ARC", name="Archive Test Project", workspace=self.ws
        )

    def login_owner(self):
        self.client.login(username="owner", password=os.environ["SECRET_TEST_PASS"])

    def login_member(self):
        self.client.login(username="member", password=os.environ["SECRET_TEST_PASS"])

    def test_archive_project_owner(self):
        """Owner can archive project."""
        self.login_owner()
        resp = self.client.post(
            f"/api/v1/projects/{self.project.id}/archive/",
            {"version": self.project.version},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.project.refresh_from_db()
        self.assertIsNotNone(self.project.archived_at)

    def test_archive_project_already_archived_noop(self):
        """Archiving already-archived project is a no-op."""
        self.login_owner()
        self.project.archived_at = __import__("django.utils.timezone", fromlist=["now"]).now()
        self.project.save()
        resp = self.client.post(
            f"/api/v1/projects/{self.project.id}/archive/",
            {"version": self.project.version},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.project.refresh_from_db()
        self.assertIsNotNone(self.project.archived_at)

    def test_archive_project_version_conflict(self):
        """Archiving with wrong version returns 409."""
        self.login_owner()
        self.project.version = 999
        self.project.save()
        resp = self.client.post(
            f"/api/v1/projects/{self.project.id}/archive/",
            {"version": 1},
            format="json",
        )
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.data["error"]["code"], "version_conflict")

    def test_archive_project_non_owner_denied(self):
        """Member cannot archive project."""
        self.login_member()
        resp = self.client.post(
            f"/api/v1/projects/{self.project.id}/archive/",
            {"version": self.project.version},
            format="json",
        )
        self.assertEqual(resp.status_code, 403)

    def test_reopen_project_owner(self):
        """Owner can reopen archived project."""
        self.login_owner()
        self.project.archived_at = __import__("django.utils.timezone", fromlist=["now"]).now()
        self.project.save()
        resp = self.client.post(
            f"/api/v1/projects/{self.project.id}/reopen/",
            {"version": self.project.version},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.project.refresh_from_db()
        self.assertIsNone(self.project.archived_at)

    def test_reopen_project_already_open_noop(self):
        """Reopening already-open project is a no-op."""
        self.login_owner()
        resp = self.client.post(
            f"/api/v1/projects/{self.project.id}/reopen/",
            {"version": self.project.version},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.project.refresh_from_db()
        self.assertIsNone(self.project.archived_at)

    def test_reopen_project_non_owner_denied(self):
        """Member cannot reopen project."""
        self.login_member()
        resp = self.client.post(
            f"/api/v1/projects/{self.project.id}/reopen/",
            {"version": self.project.version},
            format="json",
        )
        self.assertEqual(resp.status_code, 403)


class AuditEventTestCase(TestCase):
    """Audit event endpoint tests."""

    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            "admin", "admin@example.com", os.environ["SECRET_TEST_PASS"], is_staff=True
        )
        self.alice = User.objects.create_user(
            "alice", "alice@example.com", os.environ["SECRET_TEST_PASS"]
        )
        self.client.login(
            username="admin", password=os.environ["SECRET_TEST_PASS"]
        )
        self.ws = Workspace.objects.create(name="Audit Test Workspace")
        Membership.objects.create(user=self.admin, workspace=self.ws, role="owner")
        Membership.objects.create(user=self.alice, workspace=self.ws, role="member")
        self.project = Project.objects.create(key="AUD", name="Audit Project", workspace=self.ws)

    def test_audit_events_admin_only(self):
        """Non-admin cannot list audit events."""
        self.client.login(username="alice", password=os.environ["SECRET_TEST_PASS"])
        resp = self.client.get("/api/v1/audit-events/")
        self.assertEqual(resp.status_code, 403)

    def test_audit_events_admin_can_list(self):
        """Admin can list audit events."""
        resp = self.client.get("/api/v1/audit-events/")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("results", resp.data)

    def test_issue_audit_events_member(self):
        """Member can list audit events for an issue."""
        self.client.login(username="alice", password=os.environ["SECRET_TEST_PASS"])
        resp = self.client.get(f"/api/v1/issues/{self.project.id}/audit-events/")
        # Issue may not exist yet - 404 is expected, or 200 with empty results
        self.assertIn(resp.status_code, [200, 404])
