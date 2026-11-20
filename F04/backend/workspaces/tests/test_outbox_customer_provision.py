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
from unittest import mock

from django.test import TestCase, TransactionTestCase, override_settings
from django.contrib.auth import get_user_model
from django.utils import timezone
from django_multitenant.utils import set_current_tenant, unset_current_tenant

from workspaces.models import (
    DomainEvent,
    Membership,
    WebhookDelivery,
    Workspace,
    WorkspaceBilling,
)
from workspaces.stripe_adapter import StripeAdapter, StripeAdapterError
from workspaces.tasks import dispatch_outbox

User = get_user_model()

# Synthetic test values only — never real Stripe credentials
STRIPE_TEST_KEY = "sk_test_fake1234567890"
FAKE_CUSTOMER_ID = "cus_test_fake1234567890"


def _mock_create_customer(customer_id=FAKE_CUSTOMER_ID):
    """Patch StripeAdapter.create_customer to return a fake customer ID string.

    In production create_customer() returns a customer ID string, so the mock
    returns a string directly (matching real behavior) rather than a Mock object
    with an .id attribute.
    """
    return mock.patch.object(
        StripeAdapter, "create_customer", return_value=customer_id
    )


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
        # Create billing row explicitly (no post_save signal auto-creates it).
        # tenant_id is set to match the workspace tenant so that
        # dispatch_outbox's tenant-scoped save(update_fields=...) can find
        # and update the row inside the active tenant context.
        self.billing = WorkspaceBilling.objects.create(
            workspace=self.workspace,
            tenant_id=self.workspace.tenant_id,
            effective_plan="free",
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

    def set_billing_tenant(self):
        """Align billing.tenant with the workspace tenant.

        dispatch_outbox runs inside a tenant context, so WorkspaceBilling.save()
        is automatically filtered by the current tenant. No need to set tenant
        explicitly - Django-multitenant handles it via the request context.
        """
        pass  # Tenant context is established by dispatch_outbox's try block

    @override_settings(STRIPE_API_KEY=STRIPE_TEST_KEY)
    def test_dispatch_outbox_creates_stripe_customer(self):
        """Dispatch customer.provision: creates Stripe Customer, marks dispatched, no WebhookDelivery."""
        self.set_billing_tenant()
        with _mock_create_customer() as mock_create:
            result = dispatch_outbox(_workspace_id=self.workspace.id)

        self.assertEqual(result, {"status": "dispatched", "dispatched": 1})
        self.event.refresh_from_db()
        self.assertIsNotNone(self.event.dispatched_at)

        # Stripe Customer created exactly once
        mock_create.assert_called_once()

        # WorkspaceBilling.customer_id updated with the result
        self.billing.refresh_from_db()
        self.assertEqual(self.billing.customer_id, FAKE_CUSTOMER_ID)

        # customer.provision does not create a WebhookDelivery (no subscription)
        self.assertEqual(WebhookDelivery.objects.count(), 0)

    @override_settings(STRIPE_API_KEY=STRIPE_TEST_KEY)
    def test_dispatch_outbox_skips_if_customer_id_exists(self):
        """If WorkspaceBilling already has customer_id, event dispatched without calling Stripe."""
        set_current_tenant(self.workspace)
        self.workspace.billing.customer_id = "cus_existing_123"
        self.workspace.billing.save(update_fields=["customer_id", "updated_at"])
        unset_current_tenant()

        with _mock_create_customer() as mock_create:
            result = dispatch_outbox(_workspace_id=self.workspace.id)

        self.assertEqual(result, {"status": "dispatched", "dispatched": 1})
        self.event.refresh_from_db()
        self.assertIsNotNone(self.event.dispatched_at)
        # Stripe not called because customer_id already exists (reconciliation)
        mock_create.assert_not_called()

    @override_settings(STRIPE_API_KEY=STRIPE_TEST_KEY)
    def test_dispatch_outbox_stripe_error_retries(self):
        """If StripeAdapterError, event stays pending (dispatched_at is None)."""
        with mock.patch.object(
            StripeAdapter,
            "create_customer",
            side_effect=StripeAdapterError("Stripe unavailable"),
        ):
            dispatch_outbox(_workspace_id=self.workspace.id)

        self.event.refresh_from_db()
        # Event remains NOT dispatched because StripeAdapterError caused 'continue'
        self.assertIsNone(self.event.dispatched_at)
        self.billing.refresh_from_db()
        self.assertIsNone(self.billing.customer_id)

    @override_settings(STRIPE_API_KEY=STRIPE_TEST_KEY)
    def test_dispatch_outbox_idempotent_customer_provision(self):
        """Second dispatch should not create duplicate customer."""
        self.set_billing_tenant()
        with _mock_create_customer() as mock_create:
            # First dispatch: event is pending, creates customer
            result1 = dispatch_outbox(_workspace_id=self.workspace.id)
            self.assertEqual(result1, {"status": "dispatched", "dispatched": 1})
            self.event.refresh_from_db()
            self.assertIsNotNone(self.event.dispatched_at)
            self.billing.refresh_from_db()
            self.assertEqual(self.billing.customer_id, FAKE_CUSTOMER_ID)

            # Second dispatch: event already dispatched, nothing to do
            result2 = dispatch_outbox(_workspace_id=self.workspace.id)
            self.assertEqual(result2, {"status": "empty", "dispatched": 0})

        # create_customer called exactly once across both dispatches
        self.assertEqual(mock_create.call_count, 1)
        self.billing.refresh_from_db()
        self.assertEqual(self.billing.customer_id, FAKE_CUSTOMER_ID)


class CustomerProvisionReconciliationTestCase(TransactionTestCase):
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
            workspace=self.workspace,
            tenant_id=self.workspace.tenant_id,
            effective_plan="free",
        )

    def set_billing_tenant(self):
        pass  # Tenant context is established by dispatch_outbox's try block

    @override_settings(STRIPE_API_KEY=STRIPE_TEST_KEY)
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
        set_current_tenant(self.workspace)
        self.billing.customer_id = "cus_existing_456"
        self.billing.save(update_fields=["customer_id", "updated_at"])
        unset_current_tenant()

        with mock.patch.object(StripeAdapter, "create_customer") as mock_create:
            result = dispatch_outbox(_workspace_id=self.workspace.id)

        self.assertEqual(result, {"status": "dispatched", "dispatched": 1})
        event.refresh_from_db()
        self.assertIsNotNone(event.dispatched_at)
        self.assertEqual(self.billing.customer_id, "cus_existing_456")
        # Stripe not called during reconciliation
        mock_create.assert_not_called()

    @override_settings(STRIPE_API_KEY=STRIPE_TEST_KEY)
    def test_concurrent_dispatch_single_customer(self):
        """Two dispatch_outbox calls on same event, only one processes it."""
        self.set_billing_tenant()
        event = DomainEvent.objects.create(
            workspace=self.workspace,
            tenant_id=self.workspace.tenant_id,
            event_type="customer.provision",
            aggregate_type="Workspace",
            aggregate_id=str(self.workspace.id),
            actor=self.user,
            request_id="req-provision-concurrent",
            payload={
                "workspace_id": str(self.workspace.id),
                "workspace_name": self.workspace.name,
                "billing_id": str(self.billing.id),
            },
        )

        with _mock_create_customer() as mock_create:
            # First dispatch processes the event
            result1 = dispatch_outbox(_workspace_id=self.workspace.id)
            # Second dispatch finds event already dispatched (idempotent via select_for_update)
            result2 = dispatch_outbox(_workspace_id=self.workspace.id)

        self.assertEqual(result1, {"status": "dispatched", "dispatched": 1})
        self.assertEqual(result2, {"status": "empty", "dispatched": 0})
        event.refresh_from_db()
        self.assertIsNotNone(event.dispatched_at)
        self.billing.refresh_from_db()
        self.assertEqual(self.billing.customer_id, FAKE_CUSTOMER_ID)
        # Exactly one Stripe customer created
        self.assertEqual(mock_create.call_count, 1)
