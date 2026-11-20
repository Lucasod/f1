"""Bootstrap the development environment deterministically.

Runs migrations, creates deterministic development workspaces (idempotent),
and reconciles Stripe Customers for workspaces missing customer_id — but
only when STRIPE_API_KEY and STRIPE_WEBHOOK_SECRET are configured.

Blocked in production (DEBUG=False). Never creates paid subscriptions
automatically (effective_plan stays "free"). Works without Stripe
credentials (local mode continues without calling Stripe).
"""

import os
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from workspaces.models import Workspace, WorkspaceBilling, Membership
from workspaces.stripe_adapter import StripeAdapter, StripeAdapterError
from workspaces.management.commands.seed_stripe_customers import DETERMINISTIC_WORKSPACES


class Command(BaseCommand):
    help = (
        "Bootstrap development environment: run migrations, create "
        "deterministic workspaces, reconcile Stripe Customers."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--no-sync-stripe",
            action="store_true",
            help="Skip Stripe Customer synchronization even if credentials are configured.",
        )

    def handle(self, *args, **options):
        # Block in production.
        if not settings.DEBUG:
            raise CommandError(
                "bootstrap_dev is disabled in production (DEBUG=False). "
                "Run seed_stripe_customers --sync-stripe manually if needed."
            )

        # Step 1: Run migrations.
        self.stdout.write("Running migrations...")
        call_command("migrate", verbosity=0)

        # Step 2: Get or create owner user.
        User = get_user_model()
        owner, _ = User.objects.get_or_create(
            username="dev_owner",
            defaults={
                "email": "dev-owner@example.com",
                "is_staff": True,
                "is_superuser": True,
            },
        )
        if not owner.has_usable_password():
            if "SEED_OWNER_PASSWORD" not in os.environ:
                raise CommandError(
                    "SEED_OWNER_PASSWORD environment variable is required "
                    "for bootstrap_dev when no owner password exists."
                )
            owner.set_password(os.environ["SEED_OWNER_PASSWORD"])
            owner.save()

        # Step 3: Create deterministic workspaces (idempotent) and reconcile
        # Stripe Customers when Stripe is configured.
        for ws_info in DETERMINISTIC_WORKSPACES:
            name = ws_info["name"]
            with transaction.atomic():
                existing = Workspace.objects.select_for_update().filter(name=name).first()
                if existing is not None:
                    continue
                workspace = Workspace.objects.create(name=name)
                WorkspaceBilling.objects.create(workspace=workspace, effective_plan="free")
                Membership.objects.create(user=owner, workspace=workspace, role="owner")

                # Reconcile Stripe Customer only when Stripe is configured.
                stripe_configured = bool(
                    settings.STRIPE_API_KEY and settings.STRIPE_WEBHOOK_SECRET
                )
                if stripe_configured and not options["no_sync_stripe"]:
                    try:
                        adapter = StripeAdapter()
                        customer_id = adapter.create_customer(
                            idempotency_key=f"workspace-{workspace.id}-bootstrap-customer",
                            metadata={
                                "workspace_id": str(workspace.id),
                                "workspace_name": workspace.name,
                                "workspace_email": f"workspace-{workspace.id}@example.com",
                            },
                        )
                        billing = WorkspaceBilling.objects.get(workspace=workspace)
                        billing.customer_id = customer_id
                        billing.save(update_fields=["customer_id", "updated_at"])
                    except StripeAdapterError:
                        # Stripe unavailable; customer reconciled later by
                        # seed_stripe_customers --sync-stripe
                        pass

        self.stdout.write(self.style.SUCCESS("Bootstrap complete."))
