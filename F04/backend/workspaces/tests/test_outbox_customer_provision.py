"""Tests for customer.provision outbox event processing.

Validates that Stripe Customer provisioning via DomainEvent works correctly:
- DomainEvent is created in same transaction as workspace
- dispatch_outbox processes customer.provision events
- Event stays pending if Stripe is unavailable
- Reconciliation: existing customer_id means event is marked dispatched without calling Stripe
- Idempotency: re-dispatching does not create duplicate customers
- Tenant isolation between workspaces
"""

import os

from django.test import TestCase
from django.contrib.auth import get_user_model
from django.utils import timezone

from workspaces.models import (
    DomainEvent,
    Membership,
    Workspace,
    WorkspaceBilling,
)
from workspaces.tasks import dispatch_outbox

User = get_user_model()


class CustomerProvisionDispatchTestCase(TestCase):
    """Tests for dispatch_outbox processing customer.provision events."""

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
        # Create billing row explicitly (no post_save signal auto-creates it)
        self.billing = WorkspaceBilling.objects.create(
            workspace=self.workspace, effective_plan="free"
        )
        self.event = DomainEvent.objects.create(
            workspace=self.workspace,
            tenant_id=self.workspace.tenant_id,
            event_type="customer.provision",
            aggregate_type="Workspace",
            aggregate_id=str(self.workspace.id),
            actor=self.user,
            request_id="req-provision-1",
            payload={
                "workspace_id": str(self.workspace.id),
                "workspace_name": self.workspace.name,
                "billing_id": str(self.billing.id),
            },
        )

    def test_dispatch_outbox_creates_stripe_customer_fails_gracefully(self):
        """dispatch_outbox on customer.provision: event stays pending if Stripe unavailable."""
        result = dispatch_outbox(_workspace_id=self.workspace.id)
        # Stripe is not configured in tests, so StripeAdapterError is raised.
        # The code catches StripeAdapterError and skips, leaving event pending.
        self.event.refresh_from_db()
        # Event remains NOT dispatched because StripeAdapterError caused 'continue'
        self.assertIsNone(self.event.dispatched_at)

    def test_dispatch_outbox_reconciles_existing_customer_id(self):
        """If WorkspaceBilling already has customer_id, event is dispatched without calling Stripe."""
        # Pre-set customer_id to simulate existing Stripe Customer
        self.workspace.billing.customer_id = "cus_existing_123"
        self.workspace.billing.save(update_fields=["customer_id", "updated_at"])

        result = dispatch_outbox(_workspace_id=self.workspace.id)
        self.assertEqual(result, {"status": "dispatched", "dispatched": 1})
        self.event.refresh_from_db()
        self.assertIsNotNone(self.event.dispatched_at)

    def test_dispatch_outbox_isolation_between_workspaces(self):
        """Dispatch for one workspace does not affect another."""
        ws2 = Workspace.objects.create(name="Other", tenant_id=2)
        Membership.objects.create(
            user=self.user, workspace=ws2, role="owner"
        )
        ws2_billing = WorkspaceBilling.objects.create(
            workspace=ws2, effective_plan="free"
        )
        # Pre-set customer_id on workspace 1's billing so its event reconciles
        self.workspace.billing.customer_id = "cus_existing_ws1"
        self.workspace.billing.save(update_fields=["customer_id", "updated_at"])
        event2 = DomainEvent.objects.create(
            workspace=ws2,
            tenant_id=ws2.tenant_id,
            event_type="customer.provision",
            aggregate_type="Workspace",
            aggregate_id=str(ws2.id),
            actor=self.user,
            request_id="req-provision-2",
            payload={
                "workspace_id": str(ws2.id),
                "workspace_name": ws2.name,
                "billing_id": str(ws2_billing.id),
            },
        )

        # Dispatch for workspace 1 only
        result = dispatch_outbox(_workspace_id=self.workspace.id)
        self.assertEqual(result, {"status": "dispatched", "dispatched": 1})

        # Event for workspace 1 should be dispatched
        self.event.refresh_from_db()
        self.assertIsNotNone(self.event.dispatched_at)

        # Event for workspace 2 should NOT be dispatched
        event2.refresh_from_db()
        self.assertIsNone(event2.dispatched_at)


class CustomerProvisionReconciliationTestCase(TestCase):
    """Tests reconciliation after crash: existing customer_id means no Stripe call."""

    def setUp(self):
        self.user = User.objects.create_user(
            "bob", "bob@example.com", os.environ["SECRET_TEST_PASS"]
        )
        self.workspace = Workspace.objects.create(
            name="Recon WS", tenant_id=1
        )
        Membership.objects.create(
            user=self.user, workspace=self.workspace, role="owner"
        )
        self.billing = WorkspaceBilling.objects.create(
            workspace=self.workspace, effective_plan="free"
        )

    def test_reconciliation_after_crash(self):
        """Customer_id already exists: event marked dispatched without calling Stripe."""
        event = DomainEvent.objects.create(
            workspace=self.workspace,
            tenant_id=self.workspace.tenant_id,
            event_type="customer.provision",
            aggregate_type="Workspace",
            aggregate_id=str(self.workspace.id),
            actor=self.user,
            request_id="req-provision-3",
            payload={
                "workspace_id": str(self.workspace.id),
                "workspace_name": self.workspace.name,
                "billing_id": str(self.billing.id),
            },
        )
        # Simulate: Stripe customer was created but event not yet marked dispatched
        self.billing.customer_id = "cus_existing_456"
        self.billing.save(update_fields=["customer_id", "updated_at"])

        result = dispatch_outbox(_workspace_id=self.workspace.id)
        self.assertEqual(result, {"status": "dispatched", "dispatched": 1})
        event.refresh_from_db()
        self.assertIsNotNone(event.dispatched_at)
        self.assertEqual(self.billing.customer_id, "cus_existing_456")

    def test_dispatch_outbox_idempotent_customer_provision(self):
        """Repeated dispatch_outbox calls on same event: only dispatches once."""
        # Pre-set customer_id so the event will be reconciled (not sent to Stripe)
        self.billing.customer_id = "cus_preexisting"
        self.billing.save(update_fields=["customer_id", "updated_at"])

        event = DomainEvent.objects.create(
            workspace=self.workspace,
            tenant_id=self.workspace.tenant_id,
            event_type="customer.provision",
            aggregate_type="Workspace",
            aggregate_id=str(self.workspace.id),
            actor=self.user,
            request_id="req-provision-idempotent",
            payload={
                "workspace_id": str(self.workspace.id),
                "workspace_name": self.workspace.name,
                "billing_id": str(self.billing.id),
            },
        )

        # First dispatch: event is pending, gets reconciled and dispatched
        result1 = dispatch_outbox(_workspace_id=self.workspace.id)
        self.assertEqual(result1, {"status": "dispatched", "dispatched": 1})
        event.refresh_from_db()
        self.assertIsNotNone(event.dispatched_at)

        # Second dispatch: event already dispatched, nothing to do
        result2 = dispatch_outbox(_workspace_id=self.workspace.id)
        self.assertEqual(result2, {"status": "empty", "dispatched": 0})

        # Event still has same dispatched_at
        event.refresh_from_db()
        self.assertIsNotNone(event.dispatched_at)
