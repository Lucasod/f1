"""Stripe test-mode readiness tests for F04 MP-F04-015A.

Verifies missing-credentials behavior, webhook signature verification,
and contract compliance WITHOUT actual Stripe credentials.
"""

import os
import hmac
import hashlib
import time

from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from workspaces.models import Workspace, Membership, StripeEventInbox
from workspaces.stripe_adapter import StripeAdapter, StripeAdapterError

User = get_user_model()

# Synthetic test values only — never real credentials
TEST_WEBHOOK_KEY = "test-webhook-key-12345"
TEST_STRIPE_KEY = "sk_test_fake1234567890"
TEST_PRICE_ID = "price_test_fake123"


def make_stripe_signature(payload_bytes, secret, timestamp=None):
    """Generate a valid Stripe webhook signature header for testing."""
    if timestamp is None:
        timestamp = int(time.time())
    signed_payload = f"{timestamp}.{payload_bytes.decode('utf-8')}"
    signature = hmac.new(
        secret.encode("utf-8"),
        signed_payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"t={timestamp},v1={signature}"


class StripeReadinessTestCase(TestCase):
    """Stripe readiness tests — all run without real Stripe credentials."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            "alice", "alice@example.com", os.environ["SECRET_TEST_PASS"]
        )
        self.client.login(
            username="alice", password=os.environ["SECRET_TEST_PASS"]
        )
        self.ws = Workspace.objects.create(name="Stripe Readiness Workspace")
        Membership.objects.create(user=self.user, workspace=self.ws, role="owner")

    # ── Missing-credentials behavior ──────────────────────────

    def test_billing_summary_available_without_stripe(self):
        """Billing summary works when STRIPE is not configured."""
        response = self.client.get(
            f"/api/v1/workspaces/{self.ws.id}/billing/", format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["billing"]["plan"], "free")

    def test_workspace_usage_available_without_stripe(self):
        """Usage endpoint works when STRIPE is not configured."""
        response = self.client.get(
            f"/api/v1/workspaces/{self.ws.id}/usage/", format="json"
        )
        self.assertEqual(response.status_code, 200)

    def test_checkout_fails_safely_without_stripe(self):
        """Checkout returns 400 when STRIPE is not configured."""
        response = self.client.post(
            f"/api/v1/workspaces/{self.ws.id}/billing/checkout/",
            {"plan": "pro"},
            format="json",
            HTTP_Idempotency_Key="checkout-no-stripe",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"]["code"], "validation_error")
        self.assertIn("Stripe", response.data["error"]["message"])

    def test_portal_fails_safely_without_stripe(self):
        """Portal returns 400 when STRIPE is not configured."""
        response = self.client.post(
            f"/api/v1/workspaces/{self.ws.id}/billing/portal/",
            {},
            format="json",
            HTTP_Idempotency_Key="portal-no-stripe",
        )
        self.assertEqual(response.status_code, 400)

    def test_cancel_fails_safely_without_stripe(self):
        """Cancel returns 400 when STRIPE is not configured."""
        response = self.client.post(
            f"/api/v1/workspaces/{self.ws.id}/billing/cancel/",
            {"timing": "period_end"},
            format="json",
            HTTP_Idempotency_Key="cancel-no-stripe",
        )
        self.assertEqual(response.status_code, 400)

    def test_no_fake_provider_success_without_stripe(self):
        """No checkout returns 201 without STRIPE configured."""
        response = self.client.post(
            f"/api/v1/workspaces/{self.ws.id}/billing/checkout/",
            {"plan": "pro"},
            format="json",
            HTTP_Idempotency_Key="checkout-no-fake-success",
        )
        self.assertEqual(response.status_code, 400)

    # ── Stripe adapter contract ───────────────────────────────

    @override_settings(TEST_STRIPE_KEY="")
    def test_stripe_adapter_raises_without_api_key(self):
        """StripeAdapter() raises StripeAdapterError when no API key."""
        with self.assertRaises(StripeAdapterError):
            StripeAdapter()

    @override_settings(STRIPE_API_KEY=TEST_STRIPE_KEY)
    def test_construct_webhook_event_rejects_invalid_signature(self):
        """construct_webhook_event raises StripeAdapterError with bad signature."""
        with self.assertRaises(StripeAdapterError):
            adapter = StripeAdapter()
            adapter.construct_webhook_event(b'{"test": true}', "bad_sig", TEST_WEBHOOK_KEY)

    # ── Stripe webhook signature verification ─────────────────

    @override_settings(
        STRIPE_CONFIGURED=True,
        TEST_STRIPE_KEY=TEST_STRIPE_KEY,
        TEST_WEBHOOK_KEY=TEST_WEBHOOK_KEY,
        STRIPE_PRO_PRICE_ID=TEST_PRICE_ID,
    )
    def test_stripe_webhook_not_configured_returns_503(self):
        """Webhook returns 503 when STRIPE_CONFIGURED is False."""
        with override_settings(STRIPE_CONFIGURED=False):
            response = self.client.post(
                "/api/v1/integrations/stripe/webhook/",
                b'{"test": true}',
                content_type="application/json",
                HTTP_STRIPE_SIGNATURE="t=1234567890,v1=fakesig",
            )
            self.assertEqual(response.status_code, 503)

    @override_settings(
        STRIPE_CONFIGURED=True,
        TEST_STRIPE_KEY=TEST_STRIPE_KEY,
        TEST_WEBHOOK_KEY=TEST_WEBHOOK_KEY,
        STRIPE_PRO_PRICE_ID=TEST_PRICE_ID,
    )
    def test_stripe_webhook_missing_signature_returns_400(self):
        """Webhook returns 400 without Stripe-Signature header."""
        response = self.client.post(
            "/api/v1/integrations/stripe/webhook/",
            b'{"test": true}',
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    @override_settings(
        STRIPE_CONFIGURED=True,
        TEST_STRIPE_KEY=TEST_STRIPE_KEY,
        TEST_WEBHOOK_KEY=TEST_WEBHOOK_KEY,
        STRIPE_PRO_PRICE_ID=TEST_PRICE_ID,
    )
    def test_stripe_webhook_invalid_signature_returns_400(self):
        """Webhook returns 400 with invalid signature."""
        response = self.client.post(
            "/api/v1/integrations/stripe/webhook/",
            b'{"test": true}',
            content_type="application/json",
            HTTP_STRIPE_SIGNATURE="t=1234567890,v1=badsignature",
        )
        self.assertEqual(response.status_code, 400)

    @override_settings(
        STRIPE_CONFIGURED=True,
        STRIPE_API_KEY=TEST_STRIPE_KEY,
        STRIPE_WEBHOOK_SECRET=TEST_WEBHOOK_KEY,
        STRIPE_PRO_PRICE_ID=TEST_PRICE_ID,
    )
    def test_stripe_webhook_valid_signature_returns_200(self):
        """Webhook returns 200 with valid HMAC-SHA256 signature."""
        payload = b'{"id": "evt_test_valid", "object": "event", "type": "checkout.session.completed"}'
        sig_header = make_stripe_signature(payload, TEST_WEBHOOK_KEY)
        response = self.client.post(
            "/api/v1/integrations/stripe/webhook/",
            payload,
            content_type="application/json",
            HTTP_STRIPE_SIGNATURE=sig_header,
        )
        self.assertEqual(response.status_code, 200)

    @override_settings(
        STRIPE_CONFIGURED=True,
        STRIPE_API_KEY=TEST_STRIPE_KEY,
        STRIPE_WEBHOOK_SECRET=TEST_WEBHOOK_KEY,
        STRIPE_PRO_PRICE_ID=TEST_PRICE_ID,
    )
    def test_stripe_webhook_duplicate_event_returns_200(self):
        """Duplicate event_id returns 200 (idempotent processing)."""
        payload = b'{"id": "evt_test_dup", "object": "event", "type": "checkout.session.completed"}'
        sig_header = make_stripe_signature(payload, TEST_WEBHOOK_KEY)

        # First delivery
        resp1 = self.client.post(
            "/api/v1/integrations/stripe/webhook/",
            payload,
            content_type="application/json",
            HTTP_STRIPE_SIGNATURE=sig_header,
        )
        self.assertEqual(resp1.status_code, 200)

        # Second delivery (duplicate)
        resp2 = self.client.post(
            "/api/v1/integrations/stripe/webhook/",
            payload,
            content_type="application/json",
            HTTP_STRIPE_SIGNATURE=sig_header,
        )
        self.assertEqual(resp2.status_code, 200)

        # Inbox should have exactly one record
        self.assertEqual(
            StripeEventInbox.objects.filter(event_id="evt_test_dup").count(), 1
        )
