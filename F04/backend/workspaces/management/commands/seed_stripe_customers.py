"""Seed Stripe Customer IDs for workspaces with WorkspaceBilling rows.

Local-only mode (no --sync-stripe): lists workspaces that have a
WorkspaceBilling row but no Stripe customer_id, without calling Stripe.

--sync-stripe: creates/retrieves Stripe Customers via StripeAdapter for
workspaces missing customer_id. Requires STRIPE_API_KEY (and
STRIPE_WEBHOOK_SECRET) to be set in the environment.

--create-workspaces: creates deterministic development workspaces
(Dev Workspace, Prod Workspace) with a free WorkspaceBilling row and an
owner membership, then proceeds with the normal Stripe sync for any
workspace missing customer_id.

Idempotent: workspaces that already have customer_id are skipped, and the
adapter reuses an existing Stripe customer looked up by email, so running
twice does not create duplicates. Only Customer objects are created — never
subscriptions.
"""

import os
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from workspaces.models import Workspace, WorkspaceBilling, Membership
from workspaces.stripe_adapter import StripeAdapter


# Deterministic development workspaces created by --create-workspaces.
# metadata_key is the logical key used to identify the workspace (e.g. in
# Stripe metadata or auditing); Workspace has no metadata field, so it is
# reported in output only.
DETERMINISTIC_WORKSPACES = [
    {"name": "Dev Workspace", "metadata_key": "dev_workspace_1"},
    {"name": "Prod Workspace", "metadata_key": "dev_workspace_2"},
]


class Command(BaseCommand):
    help = "Seed Stripe Customer IDs for workspaces with WorkspaceBilling rows"

    def add_arguments(self, parser):
        parser.add_argument(
            "--sync-stripe",
            action="store_true",
            help="Actually create Stripe Customers via Stripe API (requires STRIPE_API_KEY)",
        )
        parser.add_argument(
            "--workspace-id",
            type=int,
            help="Limit to a specific workspace ID",
        )
        parser.add_argument(
            "--create-workspaces",
            action="store_true",
            help="Create deterministic development workspaces (Dev Workspace, "
            "Prod Workspace) with free billing and an owner membership, then "
            "proceed with the normal Stripe sync for any workspace missing "
            "a customer_id.",
        )

    def handle(self, *args, **options):
        create_workspaces = options["create_workspaces"]
        sync_stripe = options["sync_stripe"]
        workspace_id = options.get("workspace_id")

        # Check Stripe configuration. All Stripe config comes from env vars;
        # nothing is hardcoded.
        stripe_configured = bool(
            settings.STRIPE_API_KEY and settings.STRIPE_WEBHOOK_SECRET
        )

        if sync_stripe and not stripe_configured:
            raise CommandError(
                "--sync-stripe requires STRIPE_API_KEY and STRIPE_WEBHOOK_SECRET "
                "environment variables to be set."
            )

        # Step 1: Create deterministic development workspaces if requested.
        # This runs before the Stripe sync so freshly created workspaces are
        # included in the sync when --sync-stripe is also provided.
        if create_workspaces:
            self._create_deterministic_workspaces()

        # Step 2: Workspaces with a billing row but no Stripe customer_id.
        billing_qs = WorkspaceBilling.objects.select_related("workspace")
        if workspace_id:
            billing_qs = billing_qs.filter(workspace_id=workspace_id)

        billing_without_customer = billing_qs.filter(
            customer_id__isnull=True
        ) | billing_qs.filter(customer_id="")

        if not billing_without_customer.exists():
            self.stdout.write(
                self.style.SUCCESS(
                    "All workspaces with billing have Stripe Customer IDs."
                )
            )
            return

        self.stdout.write(
            f"Found {billing_without_customer.count()} workspace(s) without Stripe Customer ID."
        )

        if not sync_stripe:
            self.stdout.write(
                "Run with --sync-stripe to create Stripe Customers."
            )
            for wb in billing_without_customer:
                self.stdout.write(
                    f"  - Workspace {wb.workspace_id} ({wb.workspace.name})"
                )
            return

        # Sync with Stripe. Reuses StripeAdapter.create_customer; no direct
        # Stripe SDK calls in this command.
        adapter = StripeAdapter()
        created = 0
        failed = 0
        skipped = 0

        for wb in billing_without_customer:
            try:
                customer = adapter.create_customer(
                    idempotency_key=f"workspace-{wb.workspace.id}-seed-customer",
                    metadata={
                        "workspace_email": f"workspace-{wb.workspace.id}@example.com",
                        "workspace_id": str(wb.workspace.id),
                        "workspace_name": wb.workspace.name,
                    },
                )
                wb.customer_id = customer.id
                wb.save(update_fields=["customer_id", "updated_at"])
                created += 1
                self.stdout.write(
                    self.style.SUCCESS(
                        f"  - Created Stripe Customer {customer.id} for workspace {wb.workspace_id}"
                    )
                )
            except Exception as exc:
                failed += 1
                self.stdout.write(
                    self.style.ERROR(
                        f"  - Failed to create Stripe Customer for workspace {wb.workspace_id}: {exc}"
                    )
                )

        self.stdout.write(
            self.style.SUCCESS(
                f"\nDone: {created} created, {failed} failed, {skipped} skipped."
            )
        )

    def _get_owner_user(self):
        """Return an existing owner user, or create a deterministic one.

        Prefers an existing superuser, then any existing user, then creates
        a deterministic seed owner from the SEED_OWNER_PASSWORD env var.
        Never hardcodes a real credential.
        """
        User = get_user_model()
        user = User.objects.filter(is_superuser=True).first()
        if user is None:
            user = User.objects.first()
        if user is None:
            user = User.objects.create_user(
                "seed_owner",
                "seed_owner@example.com",
                os.environ["SEED_OWNER_PASSWORD"],
            )
        return user

    def _create_deterministic_workspaces(self):
        """Create deterministic dev workspaces idempotently.

        Each workspace gets a free WorkspaceBilling row and an owner
        membership for the seed owner user. Workspaces that already exist
        (exact name match) are skipped. select_for_update() within a
        transaction guards against concurrent runs both deciding to create.
        """
        owner = self._get_owner_user()
        created = 0
        skipped = 0

        for ws_info in DETERMINISTIC_WORKSPACES:
            name = ws_info["name"]
            metadata_key = ws_info["metadata_key"]

            with transaction.atomic():
                # Lock any existing row with this name so concurrent runs
                # cannot both decide to create. If none exists, create it.
                existing = (
                    Workspace.objects.select_for_update()
                    .filter(name=name)
                    .first()
                )
                if existing is not None:
                    self.stdout.write(
                        f"  - Skipped existing workspace: {name}"
                    )
                    skipped += 1
                    continue

                workspace = Workspace.objects.create(name=name)
                WorkspaceBilling.objects.create(
                    workspace=workspace, effective_plan="free"
                )
                Membership.objects.create(
                    user=owner, workspace=workspace, role="owner"
                )
                created += 1
                self.stdout.write(
                    self.style.SUCCESS(
                        f"  - Created workspace '{name}' "
                        f"(id={workspace.id}, metadata_key={metadata_key})"
                    )
                )

        self.stdout.write(
            f"\nDeterministic workspaces: {created} created, {skipped} skipped."
        )
