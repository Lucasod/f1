"""Authentication tests for F04 Step 1."""

import os

from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model

User = get_user_model()


class AuthTestCase(TestCase):
    """Test suite for authentication endpoints."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user("alice", "alice@example.com", os.getenv('SECRET_TEST_PASS', 'testpass123'))
        self.user.display_name = "Alice"
        self.user.save()

    def test_csrf_bootstrap(self):
        """GET /api/v1/auth/csrf/ returns CSRF token."""
        response = self.client.get("/api/v1/auth/csrf/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("csrf_token", response.data)

    def test_login_valid_credentials(self):
        """POST /api/v1/auth/login/ with valid credentials returns user."""
        response = self.client.post(
            "/api/v1/auth/login/",
            {"username": "alice", "password": os.getenv('SECRET_TEST_PASS', 'testpass123')},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["user"]["username"], "alice")
        self.assertEqual(response.data["user"]["id"], self.user.pk)

    def test_login_invalid_credentials(self):
        """POST /api/v1/auth/login/ with invalid credentials returns 400."""
        response = self.client.post(
            "/api/v1/auth/login/",
            {"username": "alice", "password": "wrongpass"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"]["code"], "invalid_credentials")

    def test_login_inactive_account(self):
        """POST /api/v1/auth/login/ with inactive account returns 400."""
        inactive_user = User.objects.create_user("bob", "bob@example.com", os.getenv('SECRET_TEST_PASS', 'testpass123'))
        inactive_user.is_active = False
        inactive_user.save()

        response = self.client.post(
            "/api/v1/auth/login/",
            {"username": "bob", "password": os.getenv('SECRET_TEST_PASS', 'testpass123')},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["error"]["code"], "invalid_credentials")

    def test_me_authenticated(self):
        """GET /api/v1/auth/me/ with valid session returns user."""
        self.client.login(username="alice", password=os.getenv('SECRET_TEST_PASS', 'testpass123'))
        response = self.client.get("/api/v1/auth/me/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["user"]["username"], "alice")

    def test_me_anonymous(self):
        """GET /api/v1/auth/me/ without session returns 403."""
        response = self.client.get("/api/v1/auth/me/")
        self.assertEqual(response.status_code, 403)