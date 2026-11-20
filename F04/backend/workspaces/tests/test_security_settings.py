"""Security settings tests for MP-F04-018A.

Verifies that DEBUG, SESSION_COOKIE_SECURE and CSRF_COOKIE_SECURE are
read from environment variables with development-safe defaults.
"""

import importlib
import os

from django.conf import settings
from django.test import TestCase

import conf.settings as settings_module


def _reload_settings():
    """Reload conf.settings and reconfigure django.conf.settings from env."""
    importlib.reload(settings_module)
    settings._setup()
    return settings


class SecuritySettingsTestCase(TestCase):
    """Test suite for environment-configurable security settings."""

    def setUp(self):
        self._orig_env = dict(os.environ)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._orig_env)

    def test_debug_defaults_to_true(self):
        """DEBUG defaults to True when DEBUG env var is not set."""
        os.environ.pop("DEBUG", None)
        _reload_settings()
        self.assertTrue(settings.DEBUG)

    def test_debug_can_be_set_to_false(self):
        """DEBUG can be set to False via the DEBUG environment variable."""
        os.environ["DEBUG"] = "False"
        _reload_settings()
        self.assertFalse(settings.DEBUG)

    def test_session_cookie_secure_defaults_to_false(self):
        """SESSION_COOKIE_SECURE defaults to False when not set."""
        os.environ.pop("SESSION_COOKIE_SECURE", None)
        _reload_settings()
        self.assertFalse(settings.SESSION_COOKIE_SECURE)

    def test_session_cookie_secure_can_be_set_to_true(self):
        """SESSION_COOKIE_SECURE can be set to True via env var."""
        os.environ["SESSION_COOKIE_SECURE"] = "True"
        _reload_settings()
        self.assertTrue(settings.SESSION_COOKIE_SECURE)

    def test_csrf_cookie_secure_defaults_to_false(self):
        """CSRF_COOKIE_SECURE defaults to False when not set."""
        os.environ.pop("CSRF_COOKIE_SECURE", None)
        _reload_settings()
        self.assertFalse(settings.CSRF_COOKIE_SECURE)

    def test_csrf_cookie_secure_can_be_set_to_true(self):
        """CSRF_COOKIE_SECURE can be set to True via env var."""
        os.environ["CSRF_COOKIE_SECURE"] = "True"
        _reload_settings()
        self.assertTrue(settings.CSRF_COOKIE_SECURE)

    def test_allowed_hosts_defaults_include_testserver(self):
        """ALLOWED_HOSTS defaults include localhost, 127.0.0.1, and testserver."""
        os.environ.pop("DJANGO_ALLOWED_HOSTS", None)
        _reload_settings()
        self.assertIn("localhost", settings.ALLOWED_HOSTS)
        self.assertIn("127.0.0.1", settings.ALLOWED_HOSTS)
        self.assertIn("testserver", settings.ALLOWED_HOSTS)

    def test_allowed_hosts_can_be_overridden_via_env(self):
        """ALLOWED_HOSTS can be overridden via DJANGO_ALLOWED_HOSTS env var."""
        os.environ["DJANGO_ALLOWED_HOSTS"] = '["example.com", "api.example.com"]'
        _reload_settings()
        self.assertEqual(settings.ALLOWED_HOSTS, ["example.com", "api.example.com"])

    def test_allowed_hosts_not_wildcard(self):
        """ALLOWED_HOSTS never defaults to wildcard ["*"]."""
        os.environ.pop("DJANGO_ALLOWED_HOSTS", None)
        _reload_settings()
        self.assertNotEqual(settings.ALLOWED_HOSTS, ["*"])
