"""WSGI entry point for the F04 backend."""
import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "conf.settings")

application = get_wsgi_application()
