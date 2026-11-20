"""Tests for webhook delivery recovery (ASYNC-01 durability requirement)."""

import os
import unittest
from datetime import timedelta
from django.test import TestCase, TransactionTestCase
from django.utils import timezone
from django.db import connection, transaction
from django_multitenant.utils import set_current_tenant, unset_current_tenant
from workspaces.models import WebhookDelivery, WebhookSubscription, Workspace, DomainEvent, Membership
from workspaces.tasks import recover_webhook_deliveries, dispatch_outbox
from django.contrib.auth import get_user_model

User = get_user_model()


class WebhookRecoveryTestCase(TestCase):
    """Tests for recover_webhook_deliveries task."""

    def setUp(self):
        self.user = User.objects.create_user("recovery_user", "recovery@example.com", os.environ["SECRET_TEST_PASS"])
        self.workspace = Workspace.objects.create(name="Recovery Workspace", tenant_id=4)
        Membership.objects.create(user=self.user, workspace=self.workspace, role="owner")
        set_current_tenant(self.workspace)

        self.subscription = WebhookSubscription.objects.create(
            workspace=self.workspace,
            url="https://example.com/webhook",
            events=["issue.created"],
            is_enabled=True,
            signing_secret=os.environ["WEBHOOK_SIGNING_SECRET"],
        )

    def tearDown(self):
        unset_current_tenant()

    def test_recover_webhook_deliveries_empty_queue(self):
        """No stranded deliveries: returns empty status."""
        result = recover_webhook_deliveries(_workspace_id=self.workspace.id)
        self.assertEqual(result, {"status": "empty", "recovered": 0})

    def test_recover_webhook_deliveries_recovers_stranded(self):
        """Stranded pending deliveries with next_attempt_at <= now are recovered."""
        now = timezone.now()
        delivery = WebhookDelivery.objects.create(
            subscription=self.subscription,
            event_type="issue.created",
            event_id="evt-1",
            delivery_id="dlv-1",
            status="pending",
            request_payload={"issue_id": 1},
            next_attempt_at=now - timedelta(seconds=10),  # In the past
        )

        result = recover_webhook_deliveries(_workspace_id=self.workspace.id)

        self.assertEqual(result["status"], "recovered")
        self.assertEqual(result["recovered"], 1)
        delivery.refresh_from_db()
        self.assertEqual(delivery.status, "pending")
        self.assertIsNotNone(delivery.next_attempt_at)

    def test_recover_webhook_deliveries_not_yet_due(self):
        """Deliveries with next_attempt_at in the future are NOT recovered."""
        future = timezone.now() + timedelta(hours=1)
        delivery = WebhookDelivery.objects.create(
            subscription=self.subscription,
            event_type="issue.created",
            event_id="evt-2",
            delivery_id="dlv-2",
            status="pending",
            request_payload={"issue_id": 2},
            next_attempt_at=future,
        )

        result = recover_webhook_deliveries(_workspace_id=self.workspace.id)

        self.assertEqual(result["status"], "empty")
        self.assertEqual(result["recovered"], 0)
        delivery.refresh_from_db()
        self.assertEqual(delivery.status, "pending")

    def test_recover_webhook_deliveries_idempotent(self):
        """Second recovery run doesn't double-enqueue already-recovered deliveries."""
        now = timezone.now()
        delivery = WebhookDelivery.objects.create(
            subscription=self.subscription,
            event_type="issue.created",
            event_id="evt-3",
            delivery_id="dlv-3",
            status="pending",
            request_payload={"issue_id": 3},
            next_attempt_at=now - timedelta(seconds=10),
        )

        # First recovery
        result1 = recover_webhook_deliveries(_workspace_id=self.workspace.id)
        self.assertEqual(result1["recovered"], 1)

        # Second recovery - same delivery should not be recovered again
        # because the first recovery enqueued deliver_webhook which would have
        # changed the status, OR because select_for_update prevents concurrent
        # re-processing
        result2 = recover_webhook_deliveries(_workspace_id=self.workspace.id)
        self.assertEqual(result2["recovered"], 0)

    def test_recover_webhook_deliveries_different_workspace_isolation(self):
        """Deliveries from workspace A are not recovered by task for workspace B."""
        ws_b = Workspace.objects.create(name="Workspace B", tenant_id=5)
        Membership.objects.create(user=self.user, workspace=ws_b, role="owner")

        now = timezone.now()
        delivery = WebhookDelivery.objects.create(
            subscription=self.subscription,
            event_type="issue.created",
            event_id="evt-4",
            delivery_id="dlv-4",
            status="pending",
            request_payload={"issue_id": 4},
            next_attempt_at=now - timedelta(seconds=10),
        )

        # Task called for workspace B - should not recover ws_a's delivery
        result = recover_webhook_deliveries(_workspace_id=ws_b.id)
        self.assertEqual(result["recovered"], 0)
        delivery.refresh_from_db()
        self.assertEqual(delivery.status, "pending")


@unittest.skipIf(connection.vendor == 'sqlite', "SELECT FOR UPDATE not supported on SQLite; concurrency test requires PostgreSQL")
class WebhookRecoveryConcurrencyTestCase(TransactionTestCase):
    """Concurrent recovery of the same stranded delivery must happen once."""

    def setUp(self):
        self.user = User.objects.create_user("conc_recovery_user", "conc_recovery@example.com", os.environ["SECRET_TEST_PASS"])
        self.workspace = Workspace.objects.create(name="Conc Recovery Workspace", tenant_id=6)
        Membership.objects.create(user=self.user, workspace=self.workspace, role="owner")
        set_current_tenant(self.workspace)

        self.subscription = WebhookSubscription.objects.create(
            workspace=self.workspace,
            url="https://example.com/webhook",
            events=["issue.created"],
            is_enabled=True,
            signing_secret=os.environ["WEBHOOK_SIGNING_SECRET"],
        )

    def tearDown(self):
        unset_current_tenant()

    def test_two_recovery_workers_one_delivery(self):
        """Two concurrent recover_webhook_deliveries on same stranded delivery: only one recovers."""
        import threading
        now = timezone.now()
        delivery = WebhookDelivery.objects.create(
            subscription=self.subscription,
            event_type="issue.created",
            event_id="evt-conc",
            delivery_id="dlv-conc",
            status="pending",
            request_payload={"issue_id": 1},
            next_attempt_at=now - timedelta(seconds=10),
        )

        results = {}
        errors = {}

        def recoverer(name):
            try:
                result = recover_webhook_deliveries(_workspace_id=self.workspace.id)
                results[name] = result.get("recovered", 0)
            except Exception as exc:
                errors[name] = str(exc)

        t1 = threading.Thread(target=recoverer, args=("worker1",))
        t2 = threading.Thread(target=recoverer, args=("worker2",))
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        self.assertEqual(errors, {})
        total_recovered = sum(r for r in results.values() if isinstance(r, int))
        self.assertEqual(total_recovered, 1, f"Expected 1 recovery, got results: {results}")

        delivery.refresh_from_db()
        # The delivery was claimed by exactly one worker (next_attempt_at advanced)
        # Its status may be "pending" (if deliver_webhook hasn't run yet) or
        # "failed" (if deliver_webhook ran and the webhook server is unreachable).
        # Either way, exactly one recovery happened — that's what concurrency protection guarantees.
        self.assertIsNotNone(delivery.next_attempt_at)
        self.assertTrue(delivery.next_attempt_at > timezone.now() - timedelta(seconds=30))
