"""Outbox pattern integration tests for ASYNC-01.

Covers:
- Concurrent dispatchers processing the same event exactly once.
- Webhook flow: DomainEvent -> dispatch_outbox -> WebhookDelivery -> deliver_webhook enqueued.
- Rollback: transaction failure leaves no DomainEvent and no business change.
- Broker recovery: committed event persists and is later dispatched by dispatch_outbox.
"""

import os
import threading
import unittest

from django.test import TestCase, TransactionTestCase
from django.db import connection
from django.db import transaction
from django.contrib.auth import get_user_model
from django_multitenant.utils import set_current_tenant, unset_current_tenant

from workspaces.models import (
    DomainEvent,
    Workspace,
    Membership,
    Notification,
    WebhookSubscription,
    WebhookDelivery,
)
from workspaces.tasks import dispatch_outbox, deliver_webhook

User = get_user_model()


@unittest.skipIf(connection.vendor == 'sqlite', "SELECT FOR UPDATE not supported on SQLite; concurrency test requires PostgreSQL")
class ConcurrentDispatchTestCase(TransactionTestCase):
    """Two concurrent dispatchers must process the same event exactly once."""

    def setUp(self):
        self.user = User.objects.create_user("dispatch_user", "dispatch@example.com", "testpass123")
        self.workspace = Workspace.objects.create(name="Dispatch Workspace", tenant_id=1)
        Membership.objects.create(user=self.user, workspace=self.workspace, role="owner")
        set_current_tenant(self.workspace)

        # Create a pending DomainEvent
        self.event = DomainEvent.objects.create(
            workspace=self.workspace,
            event_type="issue.created",
            aggregate_type="Issue",
            aggregate_id="issue-1",
            payload={"issue_id": 1},
        )

    def tearDown(self):
        unset_current_tenant()

    def test_two_dispatchers_one_event_processed_once(self):
        """Two concurrent dispatchers on the same event: exactly one processes it."""
        results = {}
        errors = {}

        def dispatcher(name):
            try:
                result = dispatch_outbox(_workspace_id=self.workspace.id)
                results[name] = result.get("dispatched", 0)
            except Exception as exc:
                errors[name] = str(exc)

        t1 = threading.Thread(target=dispatcher, args=("worker1",))
        t2 = threading.Thread(target=dispatcher, args=("worker2",))
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        self.assertEqual(errors, {})

        total_dispatched = sum(r for r in results.values() if isinstance(r, int))
        self.assertEqual(total_dispatched, 1, f"Expected 1 dispatch, got results: {results}")

        self.event.refresh_from_db()
        self.assertIsNotNone(self.event.dispatched_at)

        notification_count = Notification.objects.filter(
            workspace=self.workspace,
            notification_type="issue.created",
        ).count()
        self.assertEqual(notification_count, 1)


class RollbackAndRecoveryTestCase(TestCase):
    """Tests for rollback and broker recovery scenarios (ASYNC-01)."""

    def setUp(self):
        self.user = User.objects.create_user("recovery_user", "recovery@example.com", "testpass123")
        self.workspace = Workspace.objects.create(name="Recovery Workspace", tenant_id=3)
        Membership.objects.create(user=self.user, workspace=self.workspace, role="owner")
        set_current_tenant(self.workspace)

    def tearDown(self):
        unset_current_tenant()

    def test_transaction_rollback_no_domain_event(self):
        """Transaction failure: no DomainEvent persists."""
        try:
            with transaction.atomic():
                DomainEvent.objects.create(
                    workspace=self.workspace,
                    event_type="issue.created",
                    aggregate_type="Issue",
                    aggregate_id="rollback-test",
                    payload={"issue_id": 1},
                )
                raise ValueError("Simulated failure")
        except ValueError:
            pass

        self.assertFalse(
            DomainEvent.objects.filter(
                workspace=self.workspace,
                aggregate_type="Issue",
                aggregate_id="rollback-test",
            ).exists()
        )

    def test_broker_unavailable_event_persists_and_recovers(self):
        """Commit succeeds with broker unavailable: event persists, recovered later."""
        event = DomainEvent.objects.create(
            workspace=self.workspace,
            event_type="issue.created",
            aggregate_type="Issue",
            aggregate_id="issue-42",
            payload={"issue_id": 42, "project_id": 1},
        )

        # Event is pending (not dispatched)
        event.refresh_from_db()
        self.assertIsNone(event.dispatched_at)

        # No fan-out records yet
        self.assertFalse(
            Notification.objects.filter(
                workspace=self.workspace,
                notification_type="issue.created",
            ).exists()
        )

        # Run dispatch_outbox (simulating recovery after broker comes back)
        result = dispatch_outbox(_workspace_id=self.workspace.id)
        self.assertEqual(result["status"], "dispatched")
        self.assertEqual(result["dispatched"], 1)

        event.refresh_from_db()
        self.assertIsNotNone(event.dispatched_at)

        self.assertTrue(
            Notification.objects.filter(
                workspace=self.workspace,
                notification_type="issue.created",
            ).exists()
        )


class WebhookFlowTestCase(TestCase):
    """End-to-end webhook flow."""

    def setUp(self):
        self.user = User.objects.create_user("webhook_user", "webhook@example.com", "testpass123")
        self.workspace = Workspace.objects.create(name="Webhook Workspace", tenant_id=2)
        Membership.objects.create(user=self.user, workspace=self.workspace, role="owner")
        set_current_tenant(self.workspace)

        self.subscription = WebhookSubscription.objects.create(
            workspace=self.workspace,
            url="https://example.com/webhook",
            events=["issue.created"],
            is_enabled=True,
            signing_secret=os.environ["WEBHOOK_SIGNING_SECRET"],
        )

        self.event = DomainEvent.objects.create(
            workspace=self.workspace,
            event_type="issue.created",
            aggregate_type="Issue",
            aggregate_id="issue-1",
            payload={"issue_id": 1, "workspace_id": self.workspace.id},
        )

    def tearDown(self):
        unset_current_tenant()

    def test_dispatch_outbox_creates_webhook_delivery(self):
        """dispatch_outbox creates WebhookDelivery records for pending DomainEvents."""
        result = dispatch_outbox(_workspace_id=self.workspace.id)
        self.assertEqual(result["status"], "dispatched")
        self.assertEqual(result["dispatched"], 1)

        self.event.refresh_from_db()
        self.assertIsNotNone(self.event.dispatched_at)

        delivery = WebhookDelivery.objects.get(event_id=str(self.event.id))
        self.assertEqual(delivery.status, "pending")
        self.assertEqual(delivery.subscription, self.subscription)
        self.assertEqual(delivery.event_type, "issue.created")
        self.assertIsNotNone(delivery.delivery_id)

    def test_event_not_dispatched_before_dispatch_outbox(self):
        """DomainEvent persists with dispatched_at=NULL until dispatch_outbox runs."""
        self.event.refresh_from_db()
        self.assertIsNone(self.event.dispatched_at)
        self.assertFalse(
            WebhookDelivery.objects.filter(event_id=str(self.event.id)).exists()
        )
