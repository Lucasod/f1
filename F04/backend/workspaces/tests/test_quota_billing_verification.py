"""Quota and billing verification tests for F04 MP-F04-016 Phase E."""

import os

import unittest
from django.db import connection

from django.test import TestCase, TransactionTestCase
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from django.db import transaction
from workspaces.models import (
    Workspace, Membership, Project, BillingPlan, WorkspaceBilling,
    StripeEventInbox,
)
from workspaces.billing_service import check_membership_quota, check_project_quota

User = get_user_model()


class QuotaVerificationTestCase(TestCase):
    """Quota enforcement verification."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            "alice", "alice@example.com", os.getenv("SECRET_TEST_PASS", "testpass123")
        )
        self.client.login(
            username="alice", password=os.getenv("SECRET_TEST_PASS", "testpass123")
        )
        self.ws = Workspace.objects.create(name="Quota Test Workspace")
        Membership.objects.create(user=self.user, workspace=self.ws, role="owner")

    def test_free_plan_membership_limit(self):
        """Free plan: 5 memberships max."""
        # Create 4 more members (total 5 = owner + 4)
        for i in range(4):
            u = User.objects.create_user(f"member{i}", f"m{i}@example.com", "testpass123")
            Membership.objects.create(user=u, workspace=self.ws, role="member")

        ok, error, status_code = check_membership_quota(self.ws)
        self.assertFalse(ok)
        self.assertEqual(error["error"]["code"], "plan_limit_reached")
        self.assertEqual(error["error"]["fields"]["limit"], 5)

    def test_free_plan_project_limit(self):
        """Free plan: 2 projects max."""
        # Create 2 projects
        for i in range(2):
            Project.objects.create(key=f"P{i}", name=f"Project {i}", workspace=self.ws)

        ok, error, status_code = check_project_quota(self.ws)
        self.assertFalse(ok)
        self.assertEqual(error["error"]["code"], "plan_limit_reached")
        self.assertEqual(error["error"]["fields"]["limit"], 2)

    def test_pro_plan_membership_limit(self):
        """Pro plan: 25 memberships max."""
        billing = WorkspaceBilling.objects.create(
            workspace=self.ws,
            effective_plan="pro",
        )
        plan, _ = BillingPlan.objects.get_or_create(
            plan_id="pro", defaults={"name": "Pro", "max_memberships": 25, "max_projects": 20, "price_cents": 1900, "currency": "usd", "interval": "month", "is_active": True},
        )

        # Create 24 more members (total 25 = owner + 24)
        for i in range(24):
            u = User.objects.create_user(f"pmember{i}", f"pm{i}@example.com", "testpass123")
            Membership.objects.create(user=u, workspace=self.ws, role="member")

        ok, error, status_code = check_membership_quota(self.ws)
        self.assertFalse(ok)
        self.assertEqual(error["error"]["fields"]["limit"], 25)

    def test_pro_plan_project_limit(self):
        """Pro plan: 20 projects max."""
        billing = WorkspaceBilling.objects.create(
            workspace=self.ws,
            effective_plan="pro",
        )
        plan, _ = BillingPlan.objects.get_or_create(
            plan_id="pro", defaults={"name": "Pro", "max_memberships": 25, "max_projects": 20, "price_cents": 1900, "currency": "usd", "interval": "month", "is_active": True},
        )

        # Create 20 projects
        for i in range(20):
            Project.objects.create(key=f"PP{i}", name=f"Pro Project {i}", workspace=self.ws)

        ok, error, status_code = check_project_quota(self.ws)
        self.assertFalse(ok)
        self.assertEqual(error["error"]["fields"]["limit"], 20)

    def test_downgrade_preserves_existing_resources(self):
        """Downgrade from Pro to Free doesn't delete existing over-quota resources."""
        # Set up Pro plan with many resources
        billing = WorkspaceBilling.objects.create(
            workspace=self.ws,
            effective_plan="pro",
        )
        plan, _ = BillingPlan.objects.get_or_create(
            plan_id="pro", defaults={"name": "Pro", "max_memberships": 25, "max_projects": 20, "price_cents": 1900, "currency": "usd", "interval": "month", "is_active": True},
        )

        # Create 10 members (within Pro limit of 25)
        for i in range(9):
            u = User.objects.create_user(f"dmember{i}", f"dm{i}@example.com", "testpass123")
            Membership.objects.create(user=u, workspace=self.ws, role="member")

        # Create 15 projects (within Pro limit of 20)
        for i in range(15):
            Project.objects.create(key=f"DP{i}", name=f"Downgrade Project {i}", workspace=self.ws)

        # Now downgrade to Free (limit: 5 memberships, 2 projects)
        billing.effective_plan = "free"
        billing.save(update_fields=["effective_plan"])

        # Existing resources should NOT be deleted
        member_count = Membership.objects.filter(workspace=self.ws).count()
        self.assertEqual(member_count, 10)

        project_count = Project.objects.filter(workspace=self.ws).count()
        self.assertEqual(project_count, 15)

        # But new resource creation should be blocked
        ok, error, status_code = check_membership_quota(self.ws)
        self.assertFalse(ok)

        ok, error, status_code = check_project_quota(self.ws)
        self.assertFalse(ok)


class ConcurrencyQuotaTestCase(TransactionTestCase):
    """Concurrency tests for quota enforcement."""

    def setUp(self):
        self.ws = Workspace.objects.create(name="Concurrent Quota Workspace")
        self.owner = User.objects.create_user(
            "owner", "owner@example.com", "testpass123"
        )
        Membership.objects.create(user=self.owner, workspace=self.ws, role="owner")

    @unittest.skipIf(connection.vendor == 'sqlite', "Concurrency test requires PostgreSQL for select_for_update()")
    def test_concurrent_membership_creation_one_slot(self):
        """Two simultaneous membership creations with one slot available."""
        import threading
        results = {}
        errors = {}

        def create_member(tag, username, email):
            try:
                with transaction.atomic():
                    from workspaces.billing_service import check_membership_quota
                    ok, error, _ = check_membership_quota(self.ws)
                    if not ok:
                        errors[tag] = error
                        return
                    u = User.objects.create_user(username, email, "testpass123")
                    Membership.objects.create(user=u, workspace=self.ws, role="member")
                    results[tag] = "success"
            except Exception as exc:
                errors[tag] = str(exc)

        # Create 3 more members (total 4 = owner + 3). One slot remains (limit 5).
        for i in range(3):
            u = User.objects.create_user(f"existing{i}", f"e{i}@example.com", "testpass123")
            Membership.objects.create(user=u, workspace=self.ws, role="member")

        # Two concurrent requests, only one slot available
        t1 = threading.Thread(target=create_member, args=("first", "race1", "race1@example.com"))
        t2 = threading.Thread(target=create_member, args=("second", "race2", "race2@example.com"))

        t1.start()
        t2.start()
        t1.join()
        t2.join()

        # Exactly one should succeed
        self.assertEqual(len(results), 1)
        self.assertEqual(len(errors), 1)
        count = Membership.objects.filter(workspace=self.ws).count()
        self.assertEqual(count, 5)

    @unittest.skipIf(connection.vendor == 'sqlite', "Concurrency test requires PostgreSQL for select_for_update()")
    def test_concurrent_project_creation_one_slot(self):
        """Two simultaneous project creations with one slot available."""
        import threading
        results = {}
        errors = {}

        def create_project(tag, key, name):
            try:
                with transaction.atomic():
                    from workspaces.billing_service import check_project_quota
                    ok, error, _ = check_project_quota(self.ws)
                    if not ok:
                        errors[tag] = error
                        return
                    p = Project.objects.create(key=key, name=name, workspace=self.ws)
                    results[tag] = "success"
            except Exception as exc:
                errors[tag] = str(exc)

        # Create 1 project (limit 2). One slot remains.
        Project.objects.create(key="P1", name="Project 1", workspace=self.ws)

        t1 = threading.Thread(target=create_project, args=("first", "P2", "Project 2"))
        t2 = threading.Thread(target=create_project, args=("second", "P3", "Project 3"))

        t1.start()
        t2.start()
        t1.join()
        t2.join()

        self.assertEqual(len(results), 1)
        self.assertEqual(len(errors), 1)
        count = Project.objects.filter(workspace=self.ws).count()
        self.assertEqual(count, 2)


class StripeReadinessVerificationTestCase(TestCase):
    """Stripe readiness verification without credentials."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            "alice", "alice@example.com", os.getenv("SECRET_TEST_PASS", "testpass123")
        )
        self.client.login(
            username="alice", password=os.getenv("SECRET_TEST_PASS", "testpass123")
        )
        self.ws = Workspace.objects.create(name="Stripe Readiness Workspace")
        Membership.objects.create(user=self.user, workspace=self.ws, role="owner")

    def test_checkout_fails_safely_without_stripe(self):
        """Checkout returns 400 when STRIPE not configured."""
        resp = self.client.post(
            f"/api/v1/workspaces/{self.ws.id}/billing/checkout/",
            {"plan": "pro"},
            format="json",
            HTTP_Idempotency_Key="checkout-readiness",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data["error"]["code"], "validation_error")
        self.assertIn("Stripe", resp.data["error"]["message"])

    def test_portal_fails_safely_without_stripe(self):
        """Portal returns 400 when STRIPE not configured."""
        resp = self.client.post(
            f"/api/v1/workspaces/{self.ws.id}/billing/portal/",
            {},
            format="json",
            HTTP_Idempotency_Key="portal-readiness",
        )
        self.assertEqual(resp.status_code, 400)

    def test_webhook_not_configured_returns_503(self):
        """Webhook returns 503 when STRIPE not configured."""
        resp = self.client.post(
            "/api/v1/integrations/stripe/webhook/",
            b'{"test": true}',
            content_type="application/json",
            HTTP_STRIPE_SIGNATURE="t=1234567890,v1=fakesig",
        )
        self.assertEqual(resp.status_code, 503)

    def test_webhook_missing_signature_returns_400(self):
        """Webhook returns 400 without Stripe-Signature header."""
        from django.test import override_settings
        with override_settings(STRIPE_CONFIGURED=True, TEST_STRIPE_KEY="test-stripe-key-12345", TEST_WEBHOOK_KEY="test-webhook-key-12345", STRIPE_PRO_PRICE_ID="price_test_fake"):
            resp = self.client.post(
                "/api/v1/integrations/stripe/webhook/",
                b'{"test": true}',
                content_type="application/json",
            )
            self.assertEqual(resp.status_code, 400)

    def test_webhook_invalid_signature_returns_400(self):
        """Webhook returns 400 with invalid signature."""
        from django.test import override_settings
        with override_settings(STRIPE_CONFIGURED=True, TEST_STRIPE_KEY="test-stripe-key-12345", TEST_WEBHOOK_KEY="test-webhook-key-12345", STRIPE_PRO_PRICE_ID="price_test_fake"):
            resp = self.client.post(
                "/api/v1/integrations/stripe/webhook/",
                b'{"test": true}',
                content_type="application/json",
                HTTP_STRIPE_SIGNATURE="t=1234567890,v1=badsignature",
            )
            self.assertEqual(resp.status_code, 400)
