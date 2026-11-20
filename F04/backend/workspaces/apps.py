from django.apps import AppConfig
from django.db.models.base import Model


class WorkspacesConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "workspaces"
    verbose_name = "Workspaces"

    def ready(self):
        import sys as _sys
        # Django 6.1 compatibility shim for django-multitenant.
        #
        # Two places leak `tenant_id` into Django core methods that do not
        # accept it in Django 6.1:
        #
        # 1. TenantModelMixin.save() forwards **kwargs to super().save(). A
        #    direct model.save(tenant_id=...) call would reach Model.save(),
        #    whose keyword-only signature is
        #    (force_insert, force_update, using, update_fields) and rejects
        #    any unexpected kwarg such as tenant_id.
        #
        # 2. TenantModelMixin._do_update() reassigns
        #    kwargs = get_tenant_filters(self.__class__)  # {'tenant_id': <id>}
        #    and forwards **kwargs to super()._do_update(). Django 6.1's
        #    Model._do_update() signature is
        #    (base_qs, using, pk_val, values, update_fields, forced_update,
        #    returning_fields) and rejects tenant_id. (The tenant filter is
        #    already applied to base_qs via base_qs.filter(**kwargs) before the
        #    reassignment, so dropping tenant_id from the forwarded kwargs is
        #    safe and does not weaken isolation.)
        #
        # Strip tenant_id from both entry points so it never reaches Django
        # core, while self.tenant_id on the model instance (set by
        # django-multitenant via set_object_tenant) is still honoured for
        # tenant filtering.
        _original_save = Model.save

        def _patched_save(self, *args, **kwargs):
            kwargs.pop("tenant_id", None)
            return _original_save(self, *args, **kwargs)

        Model.save = _patched_save

        _original_do_update = Model._do_update

        def _patched_do_update(
            self, base_qs, using, pk_val, values, update_fields,
            forced_update, returning_fields, *args, **kwargs
        ):
            kwargs.pop("tenant_id", None)
            # Also strip tenant_id from values list (list of (field, model,
            # value) tuples) to prevent it from being passed as a kwarg to
            # the database backend.
            values[:] = [
                (f, m, v)
                for f, m, v in values
                if f.name != "tenant_id" and f.attname != "tenant_id"
            ]
            return _original_do_update(
                self, base_qs, using, pk_val, values, update_fields,
                forced_update, returning_fields,
                *args, **kwargs,
            )

        Model._do_update = _patched_do_update

        from django_multitenant.mixins import TenantModelMixin

        _original_tmt_do_update = TenantModelMixin._do_update

        def _patched_tmt_do_update(
            self, base_qs, using, pk_val, values, update_fields,
            forced_update, returning_fields, *args, **kwargs
        ):
            kwargs.pop("tenant_id", None)
            # Also strip tenant_id from values list (list of (field, model,
            # value) tuples) to prevent it from being passed as a kwarg to
            # the database backend.
            values[:] = [
                (f, m, v)
                for f, m, v in values
                if f.name != "tenant_id" and f.attname != "tenant_id"
            ]
            # Use Model._do_update directly (Django 5.x/6.x signature accepts
            # returning_fields) rather than TenantModelMixin._do_update which
            # does not accept this parameter. Call _original_do_update
            # (the original Model._do_update captured at line 45) without
            # passing *args/**kwargs to avoid signature mismatch issues
            # when the method is invoked through the patched TenantModelMixin
            # entry point.
            return _original_do_update(
                self, base_qs, using, pk_val, values, update_fields,
                forced_update, returning_fields,
            )

        TenantModelMixin._do_update = _patched_tmt_do_update

        # Bootstrap is handled by the bootstrap_dev management command,
        # not by AppConfig.ready(). See bootstrap_dev command for details.

    def _is_bootstrap_skipped(self):
        """Return True when startup bootstrap must not run.

        Skipped under pytest (test DB setup is explicit) and for
        management commands that do not boot a live server, so the
        bootstrap never seeds the dev/test database implicitly.
        """
        import sys

        if "pytest" in sys.modules or "pytest" in sys.argv:
            return True
        skip_commands = {
            "migrate", "makemigrations", "test", "shell", "collectstatic",
            "check", "dumpdata", "loaddata",
        }
        return bool(set(sys.argv) & skip_commands)

    def _bootstrap_seed_workspaces(self):
        """Create deterministic workspaces and reconcile Stripe customers.

        Idempotent: existing workspaces (exact name match) are skipped.
        Concurrency-safe: select_for_update() inside a transaction guards
        against concurrent runs both deciding to create.
        Local mode: Stripe sync only runs when STRIPE_API_KEY and
        STRIPE_WEBHOOK_SECRET are configured; otherwise workspaces are
        created with free billing and no customer_id.
        Never creates subscriptions: only Customer objects are created.
        """
        if self._is_bootstrap_skipped():
            return

        from workspaces.management.commands.seed_stripe_customers import (
            DETERMINISTIC_WORKSPACES,
        )
        from workspaces.models import Workspace, WorkspaceBilling, Membership
        from django.contrib.auth import get_user_model
        from django.conf import settings
        from django.db import transaction, OperationalError

        try:
            User = get_user_model()
            owner = (
                User.objects.filter(is_superuser=True).first()
                or User.objects.first()
            )
        except OperationalError:
            # Database not ready yet (e.g. before the first migrate). Skip
            # and retry on the next startup.
            return

        if owner is None:
            # No users yet; do not auto-create one on startup.
            return

        for ws_info in DETERMINISTIC_WORKSPACES:
            name = ws_info["name"]
            with transaction.atomic():
                existing = (
                    Workspace.objects.select_for_update()
                    .filter(name=name)
                    .first()
                )
                if existing is not None:
                    continue
                workspace = Workspace.objects.create(name=name)
                billing = WorkspaceBilling.objects.create(
                    workspace=workspace, effective_plan="free"
                )
                Membership.objects.create(
                    user=owner, workspace=workspace, role="owner"
                )

                # Reconcile a Stripe Customer only when Stripe is configured.
                # Without credentials this is a no-op (local mode).
                if settings.STRIPE_API_KEY and settings.STRIPE_WEBHOOK_SECRET:
                    from workspaces.stripe_adapter import StripeAdapter

                    try:
                        adapter = StripeAdapter()
                        customer_id = adapter.create_customer(
                            idempotency_key=(
                                f"workspace-{workspace.id}-bootstrap-customer"
                            ),
                            metadata={
                                "workspace_id": str(workspace.id),
                                "workspace_name": workspace.name,
                                "workspace_email": (
                                    f"workspace-{workspace.id}@example.com"
                                ),
                            },
                        )
                        billing.customer_id = customer_id
                        billing.save(update_fields=["customer_id", "updated_at"])
                    except Exception:
                        # Stripe unavailable; customer reconciled later by
                        # the seed_stripe_customers management command.
                        pass