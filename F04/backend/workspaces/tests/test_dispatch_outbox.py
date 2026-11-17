"""Tests for the dispatch_outbox Celery task and DomainEvent model (ASYNC-01).

Requirement: "Rollback publishes nothing; a broker outage after commit is
recovered by outbox scan."

The dispatch_outbox task scans pending DomainEvents, fans out to Notification
and WebhookDelivery records, then marks each event as dispatched only after
fan-out records are durable.
"""

import os

from django.test import TestCase
from django.contrib.auth import get_user_model
from django.utils import timezone

from workspaces.models import (
    DomainEvent,
    Membership,
    Notification,
    WebhookDelivery,
    WebhookSubscription,
    Workspace,
)
from workspaces.tasks import dispatch_outbox

User = get_user_model()


class DomainEventModelTestCase(TestCase):
    """Tests for the DomainEvent model."""

    def setUp(self):
        self.user = User.objects.create_user(
            "alice", "alice@example.com", os.environ["SECRET_TEST_PASS"]
        )
        self.workspace = Workspace.objects.create(
            name="Acme", tenant_id=1
        )
        Membership.objects.create(
            user=self.user, workspace=self.workspace, role="owner"
        )

    def test_create_domain_event(self):
        """A DomainEvent can be created with required fields and defaults."""
        event = DomainEvent.objects.create(
            workspace=self.workspace,
            tenant_id=self.workspace.tenant_id,
            event_type="issue.created",
            aggregate_type="Issue",
            aggregate_id="42",
            actor=self.user,
            request_id="req-123",
            payload={"issue_id": 42, "project_id": 7},
        )
        self.assertIsNotNone(event.id)
        self.assertEqual(event.event_type, "issue.created")
        self.assertEqual(event.schema_version, 1)
        self.assertEqual(event.actor, self.user)
        self.assertEqual(event.aggregate_type, "Issue")
        self.assertEqual(event.aggregate_id, "42")
        self.assertEqual(event.request_id, "req-123")
        self.assertEqual(event.payload, {"issue_id": 42, "project_id": 7})
        self.assertIsNone(event.dispatched_at)
        self.assertIsNotNone(event.occurred_at)

    def test_domain_event_defaults(self):
        """Default schema_version is 1 and dispatched_at is nullable."""
        event = DomainEvent.objects.create(
            workspace=self.workspace,
            tenant_id=self.workspace.tenant_id,
            event_type="comment.created",
            aggregate_type="Comment",
            aggregate_id="9",
        )
        self.assertEqual(event.schema_version, 1)
        self.assertIsNone(event.dispatched_at)


class DispatchOutboxTestCase(TestCase):
    """Tests for the dispatch_outbox task."""

    def setUp(self):
        self.user = User.objects.create_user(
            "alice", "alice@example.com", os.environ["SECRET_TEST_PASS"]
        )
        self.workspace = Workspace.objects.create(
            name="Acme", tenant_id=1
        )
        Membership.objects.create(
            user=self.user, workspace=self.workspace, role="owner"
        )
        # A second member to verify fan-out to multiple users
        self.user2 = User.objects.create_user(
            "bob", "bob@example.com", os.environ["SECRET_TEST_PASS"]
        )
        Membership.objects.create(
            user=self.user2, workspace=self.workspace, role="member"
        )
        # Enabled webhook subscription
        self.subscription = WebhookSubscription.objects.create(
            workspace=self.workspace,
            tenant_id=self.workspace.tenant_id,
            url="https://example.com/hooks",
            events=["issue.created"],
            is_enabled=True,
            signing_secret=os.environ["WEBHOOK_SIGNING_SECRET"],
        )

    def _make_event(self, event_type, aggregate_type="Issue", aggregate_id="1", payload=None):
        return DomainEvent.objects.create(
            workspace=self.workspace,
            tenant_id=self.workspace.tenant_id,
            event_type=event_type,
            aggregate_type=aggregate_type,
            aggregate_id=aggregate_id,
            actor=self.user,
            request_id="req-test",
            payload=payload or {"issue_id": 1},
        )

    def test_dispatch_outbox_empty_queue(self):
        """An empty queue returns empty status with zero dispatched."""
        result = dispatch_outbox(_workspace_id=self.workspace.id)
        self.assertEqual(result, {"status": "empty", "dispatched": 0})
        self.assertEqual(DomainEvent.objects.count(), 0)

    def test_dispatch_outbox_dispatches_pending_events(self):
        """Pending DomainEvents are fanned out and marked dispatched."""
        event = self._make_event("issue.created", "Issue", "42", {"issue_id": 42})

        result = dispatch_outbox(_workspace_id=self.workspace.id)

        self.assertEqual(result, {"status": "dispatched", "dispatched": 1})
        event.refresh_from_db()
        self.assertIsNotNone(event.dispatched_at)

        # Notification created for each workspace member
        notifications = Notification.objects.filter(workspace=self.workspace)
        self.assertEqual(notifications.count(), 2)
        self.assertTrue(
            notifications.filter(user=self.user, notification_type="issue.created").exists()
        )
        self.assertTrue(
            notifications.filter(user=self.user2, notification_type="issue.created").exists()
        )

        # WebhookDelivery created for the enabled subscription
        delivery = WebhookDelivery.objects.filter(
            subscription=self.subscription, event_type="issue.created"
        )
        self.assertEqual(delivery.count(), 1)
        self.assertEqual(delivery.first().status, "pending")

    def test_dispatch_outbox_marks_dispatched_after_fan_out(self):
        """An event is marked dispatched only after fan-out records exist."""
        event = self._make_event("issue.status_changed", "Issue", "7", {"issue_id": 7})

        dispatch_outbox(_workspace_id=self.workspace.id)

        event.refresh_from_db()
        self.assertIsNotNone(event.dispatched_at)
        # Fan-out records must exist before/at dispatch time
        self.assertTrue(
            Notification.objects.filter(
                workspace=self.workspace, notification_type="issue.status_changed"
            ).exists()
        )
        self.assertTrue(
            WebhookDelivery.objects.filter(
                subscription=self.subscription, event_type="issue.status_changed"
            ).exists()
        )

    def test_dispatch_outbox_only_fan_out_subscribed_event_types(self):
        """Notifications are only created for the allow-listed event types."""
        non_notif_event = self._make_event("project.created", "Project", "1")
        notif_event = self._make_event("issue.created", "Issue", "2")

        dispatch_outbox(_workspace_id=self.workspace.id)

        # Non-notification event: no notifications, but webhook delivery still created
        # issue.created fans out to 2 members => 2 notifications
        self.assertEqual(
            Notification.objects.filter(workspace=self.workspace).count(),
            2,  # only the issue.created event, one per member
        )
        self.assertTrue(
            WebhookDelivery.objects.filter(
                subscription=self.subscription, event_type="project.created"
            ).exists()
        )
        self.assertTrue(
            WebhookDelivery.objects.filter(
                subscription=self.subscription, event_type="issue.created"
            ).exists()
        )
        # Both events marked dispatched
        non_notif_event.refresh_from_db()
        notif_event.refresh_from_db()
        self.assertIsNotNone(non_notif_event.dispatched_at)
        self.assertIsNotNone(notif_event.dispatched_at)

    def test_dispatch_outbox_idempotent_no_duplicate_fan_out(self):
        """Re-dispatching does not duplicate fan-out records (event already dispatched)."""
        event = self._make_event("comment.created", "Comment", "5")

        dispatch_outbox(_workspace_id=self.workspace.id)
        initial_notifications = Notification.objects.filter(workspace=self.workspace).count()
        initial_deliveries = WebhookDelivery.objects.filter(
            subscription=self.subscription
        ).count()

        # Second run: event already dispatched, should not be re-processed
        result = dispatch_outbox(_workspace_id=self.workspace.id)
        self.assertEqual(result, {"status": "empty", "dispatched": 0})

        self.assertEqual(
            Notification.objects.filter(workspace=self.workspace).count(),
            initial_notifications,
        )
        self.assertEqual(
            WebhookDelivery.objects.filter(subscription=self.subscription).count(),
            initial_deliveries,
        )
        event.refresh_from_db()
        self.assertIsNotNone(event.dispatched_at)

    def test_dispatch_outbox_disabled_webhook_not_delivered(self):
        """Disabled webhook subscriptions do not get a delivery record."""
        disabled = WebhookSubscription.objects.create(
            workspace=self.workspace,
            tenant_id=self.workspace.tenant_id,
            url="https://disabled.example.com/hooks",
            events=["issue.created"],
            is_enabled=False,
            signing_secret=os.environ["WEBHOOK_SIGNING_SECRET"],
        )
        self._make_event("issue.created", "Issue", "3")

        dispatch_outbox(_workspace_id=self.workspace.id)

        self.assertEqual(
            WebhookDelivery.objects.filter(subscription=disabled).count(), 0
        )
        self.assertEqual(
            WebhookDelivery.objects.filter(subscription=self.subscription).count(), 1
        )

    def test_dispatch_outbox_processes_batch(self):
        """Multiple pending events are processed in one batch."""
        for i in range(3):
            self._make_event("issue.created", "Issue", str(10 + i), {"issue_id": 10 + i})

        result = dispatch_outbox(_workspace_id=self.workspace.id)

        self.assertEqual(result, {"status": "dispatched", "dispatched": 3})
        self.assertEqual(
            DomainEvent.objects.filter(dispatched_at__isnull=True).count(), 0
        )
        self.assertEqual(
            Notification.objects.filter(workspace=self.workspace).count(), 6
        )  # 3 events × 2 members
        self.assertEqual(WebhookDelivery.objects.count(), 3)
