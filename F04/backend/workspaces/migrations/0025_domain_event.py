# DomainEvent model for the outbox reliability pattern.

import django.db.models.deletion
import django_multitenant.mixins
import uuid
from django.conf import settings
from django.db import migrations, models
import django.db.models


class Migration(migrations.Migration):

    dependencies = [
        ('workspaces', '0024_remove_sprint_end_date_remove_sprint_start_date_and_more'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='DomainEvent',
            fields=[
                ('tenant_id', models.PositiveBigIntegerField(blank=True, help_text='Tenant identifier for multi-tenant isolation', null=True, verbose_name='tenant id')),
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('event_type', models.CharField(max_length=100)),
                ('schema_version', models.PositiveSmallIntegerField(default=1)),
                ('aggregate_type', models.CharField(max_length=100)),
                ('aggregate_id', models.CharField(max_length=100)),
                ('occurred_at', models.DateTimeField(auto_now_add=True)),
                ('request_id', models.CharField(blank=True, max_length=100, null=True)),
                ('payload', models.JSONField(default=dict, help_text='Allowlisted scalar IDs/changes only. No file bytes, credentials, comment bodies, or issue descriptions.')),
                ('dispatched_at', models.DateTimeField(blank=True, null=True)),
                ('actor', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='domain_events', to=settings.AUTH_USER_MODEL)),
                ('workspace', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='domain_events', to='workspaces.workspace')),
            ],
            options={
                'verbose_name': 'domain event',
                'verbose_name_plural': 'domain events',
                'ordering': ['occurred_at'],
                'indexes': [models.Index(condition=django.db.models.Q(dispatched_at__isnull=True), fields=['dispatched_at', 'occurred_at'], name='domain_event_pending_dispatch')],
            },
            bases=(django_multitenant.mixins.TenantModelMixin, models.Model),
        ),
    ]
