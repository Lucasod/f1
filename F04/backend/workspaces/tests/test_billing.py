"""Billing tests for F04 MP-F04-015.

Covers billing summary, usage, checkout, operation detail, and project quota
enforcement. Stripe is not configured by default (STRIPE_CONFIGURED=False), so
checkout calls that reach the Stripe guard return 400 unless overridden.
"""

import os

from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from workspaces.models import Workspace, Membership, BillingOperation
from workspaces.billing_service import check_project_quota

User = get_user_model()


class BillingTestCase(TestCase):
    """Test suite for billing endpoints and quota enforcement."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            "alice", "alice@example.com", os.environ["SECRET_TEST_PASS"]
        )
        self.client.login(
            username="alice", password=os.environ["SECRET_TEST_PASS"]
        )
        self.ws = Workspace.objects.create(name="Billing Test Workspace")
        Membership.objects.create(user=self.user, workspace=self.ws, role="owner")

    def _billing_summary(self):
        return self.client.get(
            f"/api/v1/workspaces/{self.ws.id}/billing/", format="json"
        )

    def _usage(self):
        return self.client.get(
            f"/api/v1/workspaces/{self.ws.id}/usage/", format="json"
        )

    def _checkout(self, idempotency_key, plan="pro"):
        return self.client.post(
            f"/api/v1/workspaces/{self.ws.id}/billing/checkout/",
            {"plan": plan},
            format="json",
            HTTP_Idempotency_Key=idempotency_key,
        )

    def _create_project(self, name, key):
        return self.client.post(
            "/api/v1/projects/create/",
            {"name": name, "key": key, "workspace_id": self.ws.id},
            format="json",
        )

    def test_billing_summary_free_workspace(self):
        """New workspace has Free plan in billing summary."""
        response = self._billing_summary()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["billing"]["plan"], "free")
        self.assertEqual(response.data["billing"]["subscription_status"], "")

    def test_billing_usage_endpoint(self):
        """Usage endpoint returns correct counts and limits for Free plan."""
        response = self._usage()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["usage"]["plan"], "free")
        resources = response.data["usage"]["resources"]
        self.assertEqual(resources["memberships"]["used"], 1)
        self.assertEqual(resources["memberships"]["limit"], 5)
        self.assertEqual(resources["projects"]["used"], 0)
        self.assertEqual(resources["projects"]["limit"], 2)

    def test_checkout_requires_owner(self):
        """Non-owner attempting checkout gets 403."""
        bob = User.objects.create_user(
            "bob", "bob@example.com", os.environ["SECRET_TEST_PASS"]
        )
        bob_client = APIClient()
        bob_client.login(
            username="bob", password=os.environ["SECRET_TEST_PASS"]
        )
        response = bob_client.post(
            f"/api/v1/workspaces/{self.ws.id}/billing/checkout/",
            {"plan": "pro"},
            format="json",
            HTTP_Idempotency_Key="checkout-bob",
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["error"]["code"], "permission_denied")

    def test_checkout_stripe_not_configured(self):
        """Checkout returns 400 when Stripe is not configured."""
        response = self._checkout("checkout-stripe-nocfg")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"]["code"], "validation_error")
        self.assertIn("Stripe", response.data["error"]["message"])

    def test_checkout_duplicate_operation(self):
        """Checkout returns 409 when a checkout is already pending."""
        BillingOperation.objects.create(
            workspace=self.ws,
            kind="checkout",
            idempotency_key="dup-checkout-key",
            state="pending",
        )
        with override_settings(STRIPE_CONFIGURED=True):
            response = self._checkout("dup-checkout-key")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["error"]["code"], "validation_error")

    def test_billing_operation_detail_owner_only(self):
        """Non-owner accessing billing operation detail gets 403."""
        operation = BillingOperation.objects.create(
            workspace=self.ws,
            kind="checkout",
            idempotency_key="op-detail-key",
            state="pending",
        )
        bob = User.objects.create_user(
            "bob2", "bob2@example.com", os.environ["SECRET_TEST_PASS"]
        )
        bob_client = APIClient()
        bob_client.login(
            username="bob2", password=os.environ["SECRET_TEST_PASS"]
        )
        response = bob_client.get(
            f"/api/v1/workspaces/{self.ws.id}/billing/operations/{operation.id}/",
            format="json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["error"]["code"], "permission_denied")

    def test_check_project_quota_at_limit(self):
        """check_project_quota returns 409 plan_limit_reached at Free plan limit."""
        self.assertEqual(self._create_project("Project One", "ABC").status_code, 201)
        self.assertEqual(self._create_project("Project Two", "DEF").status_code, 201)

        ok, error, status_code = check_project_quota(self.ws)
        self.assertFalse(ok)
        self.assertEqual(error["error"]["code"], "plan_limit_reached")
        self.assertEqual(status_code, 409)
        self.assertEqual(error["error"]["fields"]["used"], 2)
        self.assertEqual(error["error"]["fields"]["limit"], 2)

    def test_create_project_quota_enforcement(self):
        """Creating a project at the Free plan limit returns 409 via API."""
        self.assertEqual(self._create_project("Project One", "ABC").status_code, 201)
        self.assertEqual(self._create_project("Project Two", "DEF").status_code, 201)

        response = self._create_project("Project Three", "GHI")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["error"]["code"], "plan_limit_reached")
