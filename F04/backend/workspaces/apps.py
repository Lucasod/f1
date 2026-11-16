from django.apps import AppConfig
from django.db.models.base import Model


class WorkspacesConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "workspaces"
    verbose_name = "Workspaces"

    def ready(self):
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
            return _original_do_update(
                self, base_qs, using, pk_val, values, update_fields,
                forced_update, returning_fields,
            )

        Model._do_update = _patched_do_update