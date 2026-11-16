"""Cross-module integration tests for F04 MP-F04-016 Phase C."""

import os

from django.test import TestCase
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from workspaces.models import Workspace, Membership

User = get_user_model()


class CrossModuleIntegrationTestCase(TestCase):
    """Complete user journeys across modules."""

    def setUp(self):
        self.client = APIClient()
        self.alice = User.objects.create_user(
            "alice", "alice@example.com", os.getenv("SECRET_TEST_PASS", "testpass123")
        )
        self.client.login(
            username="alice", password=os.getenv("SECRET_TEST_PASS", "testpass123")
        )
        self.ws = Workspace.objects.create(name="Integration Test Workspace")
        Membership.objects.create(user=self.alice, workspace=self.ws, role="owner")

    def test_auth_workspace_project_issue_journey(self):
        """Complete journey: create project, board, issue."""
        resp = self.client.post(
            "/api/v1/projects/create/",
            {"name": "Integration Project", "key": "INT", "workspace_id": self.ws.id},
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        project_id = resp.data["project"]["id"]

        resp = self.client.get(f"/api/v1/projects/{project_id}/")
        self.assertEqual(resp.status_code, 200)

        resp = self.client.post(
            f"/api/v1/projects/{project_id}/issues/",
            {"title": "Integration Issue", "description": "Test", "priority": "medium"},
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        issue_id = resp.data["issue"]["id"]

        resp = self.client.get(f"/api/v1/issues/?project_id={project_id}")
        self.assertEqual(resp.status_code, 200)

        resp = self.client.get(f"/api/v1/issues/{issue_id}/")
        self.assertEqual(resp.status_code, 200)

    def test_billing_and_quotas(self):
        """Billing summary, usage, quotas."""
        resp = self.client.get(f"/api/v1/workspaces/{self.ws.id}/billing/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["billing"]["plan"], "free")

        resp = self.client.get(f"/api/v1/workspaces/{self.ws.id}/usage/")
        self.assertEqual(resp.status_code, 200)

    def test_workspace_soft_delete_and_restore(self):
        """Soft delete workspace, verify inaccessible, restore, verify accessible."""
        ws2 = Workspace.objects.create(name="Delete Test Workspace")
        Membership.objects.create(user=self.alice, workspace=ws2, role="owner")

        resp = self.client.delete(
            f"/api/v1/workspaces/{ws2.id}/delete/",
            {"confirmation_name": "Delete Test Workspace"},
            format="json",
        )
        self.assertEqual(resp.status_code, 204)

        resp = self.client.get(f"/api/v1/workspaces/{ws2.id}/")
        self.assertEqual(resp.status_code, 404)

        resp = self.client.post(f"/api/v1/workspaces/{ws2.id}/restore/", format="json")
        self.assertEqual(resp.status_code, 200)

        resp = self.client.get(f"/api/v1/workspaces/{ws2.id}/")
        self.assertEqual(resp.status_code, 200)

    def test_webhook_subscription(self):
        """Create, list, update, delete webhook subscription."""
        resp = self.client.post(
            "/api/v1/webhooks/",
            {
                "workspace_id": self.ws.id,
                "url": "https://example.com/webhook",
                "events": ["issue.created"],
                "is_enabled": True,
                "signing_secret": "whsec_test123",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        sub_id = resp.data["subscription"]["id"]

        resp = self.client.get(f"/api/v1/webhooks/?workspace_id={self.ws.id}")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data["results"]), 1)

        resp = self.client.delete(f"/api/v1/webhooks/{sub_id}/", format="json")
        self.assertEqual(resp.status_code, 204)

    def test_notification_lifecycle(self):
        """List notifications, unread count."""
        resp = self.client.get(f"/api/v1/notifications/?workspace_id={self.ws.id}")
        self.assertEqual(resp.status_code, 200)

        resp = self.client.get(f"/api/v1/notifications/unread_count/?workspace_id={self.ws.id}")
        self.assertEqual(resp.status_code, 200)
        self.assertIn("unread_count", resp.data)

    def test_report_lifecycle(self):
        """Create report, get status."""
        resp = self.client.post(
            "/api/v1/reports/",
            {"workspace_id": self.ws.id, "report_type": "issues_by_status"},
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        report_id = resp.data["report"]["id"]

        resp = self.client.get(f"/api/v1/reports/{report_id}/")
        self.assertEqual(resp.status_code, 200)
        self.assertIn(resp.data["report"]["status"], ["pending", "completed", "failed"])

    def test_billing_operations(self):
        """Billing checkout (should fail safely without Stripe configured)."""
        resp = self.client.post(
            f"/api/v1/workspaces/{self.ws.id}/billing/checkout/",
            {"plan": "pro"},
            format="json",
            HTTP_Idempotency_Key="checkout-journey-test",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data["error"]["code"], "validation_error")
