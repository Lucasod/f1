import os
from celery import Celery

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'conf.settings')

app = Celery('conf')
app.config_from_object('django.conf:settings', namespace='CELERY')
app.autodiscover_tasks()

app.conf.beat_schedule = {
    'dispatch-outbox-every-60-seconds': {
        'task': 'workspaces.tasks.dispatch_outbox',
        'schedule': 60.0,
        'args': (),
        'kwargs': {},
    },
    'recover-webhook-deliveries-every-60-seconds': {
        'task': 'workspaces.tasks.recover_webhook_deliveries',
        'schedule': 60.0,
        'args': (),
        'kwargs': {},
    },
}
