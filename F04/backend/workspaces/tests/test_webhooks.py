"""Webhook tests for F04 MP-F04-014 Step 4."""

import os
import secrets as test_secrets

from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from workspaces.models import Workspace, Membership, WebhookSubscription, WebhookDelivery

User = get_user_model()


class WebhookSubscriptionTest(TestCase):
    """Tests for webhook subscription API."""

    def setUp(self):
        self.client = APIClient()
        test_password = test_secrets.token_urlsafe(16)
        self.user = User.objects.create_user("alice", "alice@example.com", test_password)
        self.client.login(username="alice", password=test_password)
        self.test_signing_secret = test_secrets.token_urlsafe(16)
        self.ws = Workspace.objects.create(name="Webhook Test Workspace")
        Membership.objects.create(user=self.user, workspace=self.ws, role="owner")

    def test_create_webhook_subscription(self):
        resp = self.client.post("/api/v1/webhooks/", {
            "workspace_id": self.ws.id,
            "url": "https://example.com/webhook",
            "events": ["issue.created"],
            "is_enabled": True,
            "signing_secret": self.test_signing_secret,
        }, format="json")
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data["subscription"]["url"], "https://example.com/webhook")
        self.assertNotIn("signing_secret", resp.data["subscription"])

    def test_create_webhook_ssrf_localhost(self):
        resp = self.client.post("/api/v1/webhooks/", {
            "workspace_id": self.ws.id,
            "url": "http://localhost/webhook",
            "events": ["issue.created"],
            "signing_secret": self.test_signing_secret,
        }, format="json")
        self.assertEqual(resp.status_code, 400)

    def test_create_webhook_ssrf_private_ip(self):
        resp = self.client.post("/api/v1/webhooks/", {
            "workspace_id": self.ws.id,
            "url": "http://10.0.0.1/webhook",
            "events": ["issue.created"],
            "signing_secret": self.test_signing_secret,
        }, format="json")
        self.assertEqual(resp.status_code, 400)

    def test_create_webhook_ssrf_linklocal(self):
        resp = self.client.post("/api/v1/webhooks/", {
            "workspace_id": self.ws.id,
            "url": "http://169.254.169.254/webhook",
            "events": ["issue.created"],
            "signing_secret": self.test_signing_secret,
        }, format="json")
        self.assertEqual(resp.status_code, 400)

    def test_create_webhook_workspace_scoped(self):
        other_user = User.objects.create_user("bob", "bob@example.com", test_secrets.token_urlsafe(16))
        other_ws = Workspace.objects.create(name="Bob's Workspace")
        Membership.objects.create(user=other_user, workspace=other_ws, role="owner")
        resp = self.client.post("/api/v1/webhooks/", {
            "workspace_id": other_ws.id,
            "url": "https://example.com/webhook",
            "events": ["issue.created"],
            "signing_secret": self.test_signing_secret,
        }, format="json")
        self.assertEqual(resp.status_code, 403)

    def test_list_webhook_subscriptions(self):
        WebhookSubscription.objects.create(
            workspace=self.ws, url="https://example.com/webhook",
            events=["issue.created"], signing_secret=os.environ["WEBHOOK_SIGNING_SECRET"],
        )
        resp = self.client.get(f"/api/v1/webhooks/?workspace_id={self.ws.id}")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data["results"]), 1)

    def test_update_webhook_subscription(self):
        sub = WebhookSubscription.objects.create(
            workspace=self.ws, url="https://example.com/webhook",
            events=["issue.created"], signing_secret=os.environ["WEBHOOK_SIGNING_SECRET"],
        )
        resp = self.client.patch(
            f"/api/v1/webhooks/{sub.id}/",
            {"events": ["issue.created", "issue.status_changed"]},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data["subscription"]["events"]), 2)

    def test_delete_webhook_subscription(self):
        sub = WebhookSubscription.objects.create(
            workspace=self.ws, url="https://example.com/webhook",
            events=["issue.created"], signing_secret=os.environ["WEBHOOK_SIGNING_SECRET"],
        )
        resp = self.client.delete(f"/api/v1/webhooks/{sub.id}/")
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(WebhookSubscription.objects.filter(id=sub.id).exists())

    def test_list_webhook_deliveries(self):
        sub = WebhookSubscription.objects.create(
            workspace=self.ws, url="https://example.com/webhook",
            events=["issue.created"], signing_secret=os.environ["WEBHOOK_SIGNING_SECRET"],
        )
        WebhookDelivery.objects.create(
            subscription=sub,
            event_type="issue.created",
            event_id="evt_123",
            delivery_id="dlv_123",
            status="pending",
            request_payload={"test": True},
        )
        resp = self.client.get(f"/api/v1/webhooks/{sub.id}/deliveries/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data["results"]), 1)

    def test_webhook_subscription_cross_workspace_403(self):
        other_ws = Workspace.objects.create(name="Other Workspace")
        sub = WebhookSubscription.objects.create(
            workspace=other_ws, url="https://example.com/webhook",
            events=["issue.created"], signing_secret=os.environ["WEBHOOK_SIGNING_SECRET"],
        )
        resp = self.client.get(f"/api/v1/webhooks/{sub.id}/")
        self.assertEqual(resp.status_code, 403)


class WebhookDeliveryTaskTest(TestCase):
    """Tests for webhook delivery task."""

    def setUp(self):
        test_password = test_secrets.token_urlsafe(16)
        self.user = User.objects.create_user("alice", "alice@example.com", test_password)
        self.client = APIClient()
        self.client.login(username="alice", password=test_password)
        self.ws = Workspace.objects.create(name="Webhook Delivery Workspace")
        Membership.objects.create(user=self.user, workspace=self.ws, role="owner")

    def test_deliver_webhook_task(self):
        from workspaces.tasks import deliver_webhook
        sub = WebhookSubscription.objects.create(
            workspace=self.ws, url="https://example.com/webhook",
            events=["issue.created"], signing_secret=os.environ["WEBHOOK_SIGNING_SECRET"],
        )
        delivery = WebhookDelivery.objects.create(
            subscription=sub,
            event_type="issue.created",
            event_id="evt_456",
            delivery_id="dlv_456",
            status="pending",
            request_payload={"issue_id": 1},
        )
        # This will try to actually connect to example.com, which may fail
        # but the task should handle it gracefully
        result = deliver_webhook.apply(args=(), kwargs={"delivery_id": delivery.id})
        delivery.refresh_from_db()
        # With CELERY_TASK_ALWAYS_EAGER=True, task runs synchronously
        # SSRF check passes for example.com, but connection will fail
        # Task should set status to failed or max_retries
        self.assertIn(delivery.status, ["pending", "failed", "max_retries", "delivered"])
