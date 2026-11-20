"""Tests for the seed_stripe_customers management command (MP-F04-019).

Covers local-only listing mode and --sync-stripe mode with a mocked
StripeAdapter. Stripe is never called in these tests.
"""

import os
from io import StringIO
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.core.management import call_command
from django.core.management.base import CommandError
from django.contrib.auth import get_user_model

from workspaces.models import Workspace, WorkspaceBilling, Membership

User = get_user_model()


class SeedStripeCustomersCommandTestCase(TestCase):
    """Test suite for the seed_stripe_customers management command."""

    def setUp(self):
        self.user = User.objects.create_user(
            "alice", "alice@example.com", os.environ["SECRET_TEST_PASS"]
        )
        self.ws = Workspace.objects.create(name="Seed Test Workspace")

    def _make_billing(self, workspace, customer_id=None):
        return WorkspaceBilling.objects.create(
            workspace=workspace,
            customer_id=customer_id,
            effective_plan="free",
        )

    def test_seed_stripe_customers_local_mode_no_billing_without_customer(self):
        """When no workspaces lack customer_id, reports success."""
        self._make_billing(self.ws, customer_id="cus_existing_1")

        out = StringIO()
        call_command("seed_stripe_customers", stdout=out)
        output = out.getvalue()

        self.assertIn(
            "All workspaces with billing have Stripe Customer IDs.", output
        )

    def test_seed_stripe_customers_local_mode_lists_missing(self):
        """When workspaces lack customer_id, lists them but doesn't create."""
        self._make_billing(self.ws, customer_id=None)

        out = StringIO()
        call_command("seed_stripe_customers", stdout=out)
        output = out.getvalue()

        self.assertIn(f"Workspace {self.ws.id}", output)
        self.assertIn(
            "Run with --sync-stripe to create Stripe Customers.", output
        )
        # No customer was created: customer_id must remain None.
        self.ws.refresh_from_db()
        billing = WorkspaceBilling.objects.get(workspace=self.ws)
        self.assertIsNone(billing.customer_id)

    @override_settings(STRIPE_API_KEY="fake", STRIPE_WEBHOOK_SECRET="fake")
    @patch(
        "workspaces.management.commands.seed_stripe_customers."
        "StripeAdapter.create_customer"
    )
    def test_seed_stripe_customers_sync_stripe_creates_customers(
        self, mock_create_customer
    ):
        """With --sync-stripe and mocked StripeAdapter, creates customers."""
        self._make_billing(self.ws, customer_id=None)

        mock_create_customer.return_value = "cus_new_123"

        out = StringIO()
        call_command(
            "seed_stripe_customers", sync_stripe=True, stdout=out
        )
        output = out.getvalue()

        mock_create_customer.assert_called_once()
        self.ws.refresh_from_db()
        billing = WorkspaceBilling.objects.get(workspace=self.ws)
        self.assertEqual(billing.customer_id, "cus_new_123")
        self.assertIn("cus_new_123", output)

    @override_settings(STRIPE_API_KEY="fake", STRIPE_WEBHOOK_SECRET="fake")
    @patch(
        "workspaces.management.commands.seed_stripe_customers."
        "StripeAdapter.create_customer"
    )
    def test_seed_stripe_customers_sync_stripe_skips_existing(
        self, mock_create_customer
    ):
        """Workspaces already having customer_id are not recreated."""
        ws_with_customer = Workspace.objects.create(name="With Customer")
        self._make_billing(ws_with_customer, customer_id="cus_existing_2")
        ws_without = Workspace.objects.create(name="Without Customer")
        self._make_billing(ws_without, customer_id=None)

        mock_create_customer.return_value = "cus_new_456"

        out = StringIO()
        call_command("seed_stripe_customers", sync_stripe=True, stdout=out)

        # Only the workspace without customer_id should be synced.
        mock_create_customer.assert_called_once()
        call_kwargs = mock_create_customer.call_args.kwargs
        self.assertIn(f"workspace-{ws_without.id}", call_kwargs["idempotency_key"])
        # The workspace that already had a customer_id is untouched.
        ws_with_customer.refresh_from_db()
        self.assertEqual(
            WorkspaceBilling.objects.get(workspace=ws_with_customer).customer_id,
            "cus_existing_2",
        )

    def test_seed_stripe_customers_sync_stripe_without_config(self):
        """Without STRIPE_API_KEY, raises CommandError."""
        self._make_billing(self.ws, customer_id=None)

        with self.assertRaises(CommandError):
            call_command("seed_stripe_customers", sync_stripe=True)

    @override_settings(STRIPE_API_KEY="fake", STRIPE_WEBHOOK_SECRET="fake")
    @patch(
        "workspaces.management.commands.seed_stripe_customers."
        "StripeAdapter.create_customer"
    )
    def test_seed_stripe_customers_sync_stripe_workspace_filter(
        self, mock_create_customer
    ):
        """--workspace-id limits to specific workspace."""
        ws1 = Workspace.objects.create(name="Workspace 1")
        ws2 = Workspace.objects.create(name="Workspace 2")
        self._make_billing(ws1, customer_id=None)
        self._make_billing(ws2, customer_id=None)

        mock_create_customer.return_value = "cus_filtered"

        out = StringIO()
        call_command(
            "seed_stripe_customers",
            sync_stripe=True,
            workspace_id=ws1.id,
            stdout=out,
        )

        mock_create_customer.assert_called_once()
        call_kwargs = mock_create_customer.call_args.kwargs
        self.assertIn(f"workspace-{ws1.id}", call_kwargs["idempotency_key"])
        # Only ws1 should have customer_id updated; ws2 untouched.
        ws1_billing = WorkspaceBilling.objects.get(workspace=ws1)
        ws2_billing = WorkspaceBilling.objects.get(workspace=ws2)
        self.assertEqual(ws1_billing.customer_id, "cus_filtered")
        self.assertIsNone(ws2_billing.customer_id)


class SeedStripeCustomersCreateWorkspacesTestCase(TestCase):
    """Tests for --create-workspaces deterministic workspace creation."""

    def setUp(self):
        self.user = User.objects.create_user(
            "creator", "creator@example.com", os.environ["SECRET_TEST_PASS"]
        )

    def _run_create_workspaces(self, **kwargs):
        out = StringIO()
        call_command(
            "seed_stripe_customers",
            create_workspaces=True,
            stdout=out,
            **kwargs,
        )
        return out.getvalue()

    def test_create_workspaces_creates_two_workspaces(self):
        """--create-workspaces creates Dev and Prod workspaces with free
        billing and an owner membership."""
        output = self._run_create_workspaces()

        self.assertIn("Created workspace 'Dev Workspace'", output)
        self.assertIn("Created workspace 'Prod Workspace'", output)
        self.assertIn(
            "Deterministic workspaces: 2 created, 0 skipped.", output
        )

        dev = Workspace.objects.get(name="Dev Workspace")
        prod = Workspace.objects.get(name="Prod Workspace")

        dev_billing = WorkspaceBilling.objects.get(workspace=dev)
        prod_billing = WorkspaceBilling.objects.get(workspace=prod)
        self.assertEqual(dev_billing.effective_plan, "free")
        self.assertEqual(prod_billing.effective_plan, "free")

        self.assertTrue(
            Membership.objects.filter(
                user=self.user, workspace=dev, role="owner"
            ).exists()
        )
        self.assertTrue(
            Membership.objects.filter(
                user=self.user, workspace=prod, role="owner"
            ).exists()
        )

    def test_create_workspaces_idempotent_second_run(self):
        """Running --create-workspaces twice creates no new workspaces."""
        first = self._run_create_workspaces()
        self.assertIn("Deterministic workspaces: 2 created, 0 skipped.", first)

        second = self._run_create_workspaces()
        self.assertIn(
            "Deterministic workspaces: 0 created, 2 skipped.", second
        )

        self.assertEqual(
            Workspace.objects.filter(
                name__in=["Dev Workspace", "Prod Workspace"]
            ).count(),
            2,
        )

    def test_create_workspaces_skips_existing_by_name(self):
        """A workspace with an existing exact name is skipped."""
        Workspace.objects.create(name="Dev Workspace")

        output = self._run_create_workspaces()

        self.assertIn("Skipped existing workspace: Dev Workspace", output)
        self.assertIn("Created workspace 'Prod Workspace'", output)
        self.assertEqual(Workspace.objects.filter(name="Dev Workspace").count(), 1)
        self.assertEqual(Workspace.objects.count(), 2)

    @override_settings(STRIPE_API_KEY="fake", STRIPE_WEBHOOK_SECRET="fake")
    @patch(
        "workspaces.management.commands.seed_stripe_customers."
        "StripeAdapter.create_customer"
    )
    def test_create_workspaces_sync_stripe_creates_customers(
        self, mock_create_customer
    ):
        """--create-workspaces with --sync-stripe creates Stripe customers
        for the newly created workspaces."""
        mock_create_customer.side_effect = ["cus_dev_1", "cus_prod_1"]

        output = self._run_create_workspaces(sync_stripe=True)

        self.assertEqual(mock_create_customer.call_count, 2)

        dev = Workspace.objects.get(name="Dev Workspace")
        prod = Workspace.objects.get(name="Prod Workspace")
        self.assertEqual(
            WorkspaceBilling.objects.get(workspace=dev).customer_id,
            "cus_dev_1",
        )
        self.assertEqual(
            WorkspaceBilling.objects.get(workspace=prod).customer_id,
            "cus_prod_1",
        )
