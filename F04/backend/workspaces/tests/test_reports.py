"""Report tests for F04 MP-F04-014 Step 4.

Covers the Report model, the create/get report API endpoints (tenant-scoped),
and the generate_report Celery task including per-report-type aggregation.
"""

import os

from django.test import TestCase
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from workspaces.models import (
    Workspace, Membership, Project, Board, WorkflowStatus, Issue, Report,
)
from workspaces.tasks import generate_report

User = get_user_model()


class ReportTestCase(TestCase):
    """Test suite for asynchronous report generation and endpoints."""

    def setUp(self):
        """Create users, workspace, memberships and an authenticated client."""
        self.client = APIClient()
        self.user = User.objects.create_user(
            "alice", "alice@example.com",
            os.environ["SECRET_TEST_PASS"],
        )
        self.client.login(
            username="alice",
            password=os.environ["SECRET_TEST_PASS"],
        )

        self.bob = User.objects.create_user(
            "bob", "bob@example.com",
            os.environ["SECRET_TEST_PASS"],
        )
        self.bob_client = APIClient()
        self.bob_client.login(
            username="bob",
            password=os.environ["SECRET_TEST_PASS"],
        )

        # Workspace where alice is a member (owner); bob is NOT a member.
        self.workspace = Workspace.objects.create(name="Acme")
        Membership.objects.create(user=self.user, workspace=self.workspace, role="owner")

    def _reports_url(self):
        return "/api/v1/reports/"

    def _report_url(self, report_id):
        return f"/api/v1/reports/{report_id}/"

    def test_create_report(self):
        """POST /api/v1/reports/ creates a report with pending status."""
        response = self.client.post(
            self._reports_url(),
            {"report_type": "issues_by_status", "workspace_id": self.workspace.id},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["error"], None)
        report = response.data["report"]
        self.assertEqual(report["report_type"], "issues_by_status")
        self.assertEqual(report["status"], "pending")
        self.assertIsNotNone(report["id"])
        self.assertIsNotNone(report["created_at"])
        # Persisted in the database
        db_report = Report.objects.get(id=report["id"])
        self.assertEqual(db_report.user, self.user)
        self.assertEqual(db_report.workspace, self.workspace)
        self.assertEqual(db_report.status, "pending")

    def test_create_report_requires_workspace_id(self):
        """POST /api/v1/reports/ without workspace_id returns 400."""
        response = self.client.post(
            self._reports_url(),
            {"report_type": "issues_by_status"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"]["code"], "validation_error")

    def test_create_report_workspace_scoped(self):
        """POST /api/v1/reports/ for a workspace the user is not a member of returns 403."""
        response = self.bob_client.post(
            self._reports_url(),
            {"report_type": "issues_by_status", "workspace_id": self.workspace.id},
            format="json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["error"]["code"], "permission_denied")

    def test_create_report_nonexistent_workspace(self):
        """POST /api/v1/reports/ for a nonexistent workspace returns 404."""
        response = self.client.post(
            self._reports_url(),
            {"report_type": "issues_by_status", "workspace_id": 999999},
            format="json",
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data["error"]["code"], "not_found")

    def test_get_report_own(self):
        """GET /api/v1/reports/{id}/ returns the caller's own report."""
        report = Report.objects.create(
            user=self.user,
            workspace=self.workspace,
            report_type="sprint_completion",
            status="pending",
        )
        response = self.client.get(self._report_url(report.id), format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["error"], None)
        self.assertEqual(response.data["report"]["id"], report.id)
        self.assertEqual(response.data["report"]["status"], "pending")

    def test_get_report_cross_user(self):
        """GET /api/v1/reports/{id}/ for another user's report returns 403."""
        report = Report.objects.create(
            user=self.user,
            workspace=self.workspace,
            report_type="sprint_completion",
            status="pending",
        )
        response = self.bob_client.get(self._report_url(report.id), format="json")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["error"]["code"], "permission_denied")

    def test_get_report_nonexistent(self):
        """GET /api/v1/reports/{id}/ for a nonexistent report returns 404."""
        response = self.client.get("/api/v1/reports/999999/", format="json")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data["error"]["code"], "not_found")

    def test_generate_report_task(self):
        """Celery task generate_report completes a pending report."""
        report = Report.objects.create(
            user=self.user,
            workspace=self.workspace,
            report_type="issues_by_status",
            status="pending",
        )
        result = generate_report.apply(
            args=(),
            kwargs={
                "_workspace_id": self.workspace.id,
                "report_id": report.id,
            },
        )
        self.assertIsNotNone(result.result)
        self.assertEqual(result.result["status"], "completed")
        self.assertEqual(result.result["report_id"], report.id)
        report.refresh_from_db()
        self.assertEqual(report.status, "completed")
        self.assertIsNotNone(report.completed_at)
        self.assertEqual(report.error, "")
        self.assertEqual(report.result, {})

    def test_report_issues_by_status(self):
        """Report issues_by_status aggregates issue counts per workflow status."""
        project = Project.objects.create(
            key="ABC", name="Acme Project", workspace=self.workspace,
        )
        board = Board.objects.create(
            project=project, name="Acme Board", workspace=self.workspace,
        )
        status_done = WorkflowStatus.objects.create(
            board=board, name="done", position=3,
        )
        status_todo = WorkflowStatus.objects.create(
            board=board, name="to_do", position=1,
        )
        status_progress = WorkflowStatus.objects.create(
            board=board, name="in_progress", position=2,
        )
        Issue.objects.create(
            board=board, number=1, title="Done issue one",
            status_id=status_done,
        )
        Issue.objects.create(
            board=board, number=2, title="Done issue two",
            status_id=status_done,
        )
        Issue.objects.create(
            board=board, number=3, title="Todo issue",
            status_id=status_todo,
        )
        Issue.objects.create(
            board=board, number=4, title="In progress issue",
            status_id=status_progress,
        )

        report = Report.objects.create(
            user=self.user,
            workspace=self.workspace,
            report_type="issues_by_status",
            status="pending",
        )
        generate_report.apply(
            args=(),
            kwargs={"_workspace_id": self.workspace.id, "report_id": report.id},
        )
        report.refresh_from_db()
        self.assertEqual(report.status, "completed")
        self.assertEqual(report.result, {"done": 2, "to_do": 1, "in_progress": 1})

    def test_report_issues_by_assignee(self):
        """Report issues_by_assignee aggregates issue counts per assignee."""
        project = Project.objects.create(
            key="XYZ", name="Xyz Project", workspace=self.workspace,
        )
        board = Board.objects.create(
            project=project, name="Xyz Board", workspace=self.workspace,
        )
        status_todo = WorkflowStatus.objects.create(
            board=board, name="to_do", position=1,
        )
        Issue.objects.create(
            board=board, number=1, title="Alice issue one",
            status_id=status_todo, assignee=self.user,
        )
        Issue.objects.create(
            board=board, number=2, title="Alice issue two",
            status_id=status_todo, assignee=self.user,
        )
        Issue.objects.create(
            board=board, number=3, title="Bob issue",
            status_id=status_todo, assignee=self.bob,
        )
        # Unassigned issue must be excluded from the aggregation.
        Issue.objects.create(
            board=board, number=4, title="Unassigned issue",
            status_id=status_todo,
        )

        report = Report.objects.create(
            user=self.user,
            workspace=self.workspace,
            report_type="issues_by_assignee",
            status="pending",
        )
        generate_report.apply(
            args=(),
            kwargs={"_workspace_id": self.workspace.id, "report_id": report.id},
        )
        report.refresh_from_db()
        self.assertEqual(report.status, "completed")
        self.assertEqual(report.result, {"alice": 2, "bob": 1})
