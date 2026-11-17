"""Membership quota tests for F04 MP-F04-015A.

Covers atomic membership quota enforcement under concurrency.
"""

import threading
import os
import unittest

from django.db import connection
from django.test import TestCase, TransactionTestCase
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from django.db import transaction
from workspaces.models import Workspace, Membership, WorkspaceBilling
from workspaces.billing_service import check_membership_quota

User = get_user_model()


class MembershipQuotaTestCase(TestCase):
    """Membership quota enforcement tests."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            "alice", "alice@example.com", os.environ["SECRET_TEST_PASS"]
        )
        self.client.login(
            username="alice", password=os.environ["SECRET_TEST_PASS"]
        )
        self.ws = Workspace.objects.create(name="Quota Test Workspace")
        # Create owner membership (counts as 1)
        Membership.objects.create(user=self.user, workspace=self.ws, role="owner")

    def test_check_membership_quota_at_limit(self):
        """check_membership_quota returns 409 plan_limit_reached at Free plan limit (5)."""
        # Create 4 more members (total 5 = owner + 4 = Free limit)
        for i in range(4):
            u = User.objects.create_user(f"member{i}", f"m{i}@example.com", "testpass123")
            Membership.objects.create(user=u, workspace=self.ws, role="member")

        ok, error, status_code = check_membership_quota(self.ws)
        self.assertFalse(ok)
        self.assertEqual(error["error"]["code"], "plan_limit_reached")
        self.assertEqual(status_code, 409)
        self.assertEqual(error["error"]["fields"]["used"], 5)
        self.assertEqual(error["error"]["fields"]["limit"], 5)
        self.assertEqual(error["error"]["fields"]["plan"], "free")

    def test_check_membership_quota_under_limit(self):
        """check_membership_quota returns True when under Free plan limit."""
        # Create 3 more members (total 4 < 5)
        for i in range(3):
            u = User.objects.create_user(f"member{i}", f"m{i}@example.com", "testpass123")
            Membership.objects.create(user=u, workspace=self.ws, role="member")

        ok, error, status_code = check_membership_quota(self.ws)
        self.assertTrue(ok)
        self.assertIsNone(error)
        self.assertIsNone(status_code)


class ConcurrentMembershipQuotaTestCase(TransactionTestCase):
    """Concurrency tests for membership quota enforcement."""

    def setUp(self):
        self.ws = Workspace.objects.create(name="Concurrent Quota Workspace")
        self.owner = User.objects.create_user(
            "owner", "owner@example.com", "testpass123"
        )
        Membership.objects.create(user=self.owner, workspace=self.ws, role="owner")

    @unittest.skipIf(connection.vendor == 'sqlite', "Concurrency test requires PostgreSQL for select_for_update()")
    def test_concurrent_membership_creation_one_slot(self):
        """Two simultaneous membership creations with one slot available (Free: 5 total)."""
        # Create 3 more members (total 4 = owner + 3). One slot remains (limit 5).
        for i in range(3):
            u = User.objects.create_user(f"existing{i}", f"e{i}@example.com", "testpass123")
            Membership.objects.create(user=u, workspace=self.ws, role="member")

        results = {}
        errors = {}

        def create_member(tag, username, email):
            try:
                with transaction.atomic():
                    from workspaces.billing_service import check_membership_quota
                    ok, error, _ = check_membership_quota(self.ws)
                    if not ok:
                        errors[tag] = error
                        return
                    u = User.objects.create_user(username, email, "testpass123")
                    Membership.objects.create(user=u, workspace=self.ws, role="member")
                    results[tag] = "success"
            except Exception as exc:
                errors[tag] = str(exc)

        # Only ONE slot remains (limit 5, currently 4). Two concurrent requests.
        # Only one should succeed.
        t1 = threading.Thread(target=create_member, args=("first", "race1", "race1@example.com"))
        t2 = threading.Thread(target=create_member, args=("second", "race2", "race2@example.com"))

        t1.start()
        t2.start()
        t1.join()
        t2.join()

        # Exactly one should succeed
        self.assertEqual(len(results), 1)
        self.assertEqual(len(errors), 1)
        # Membership count should be exactly 5 (limit)
        count = Membership.objects.filter(workspace=self.ws).count()
        self.assertEqual(count, 5)

    @unittest.skipIf(connection.vendor == 'sqlite', "Concurrency test requires PostgreSQL for select_for_update()")
    def test_concurrent_membership_creation_different_workspaces(self):
        """Simultaneous operations in separate workspaces don't contend."""
        ws2 = Workspace.objects.create(name="Concurrent Quota Workspace 2")
        owner2 = User.objects.create_user(
            "owner2", "owner2@example.com", "testpass123"
        )
        Membership.objects.create(user=owner2, workspace=ws2, role="owner")

        results = {}
        errors = {}

        def create_in_ws(tag, ws, username, email):
            try:
                with transaction.atomic():
                    from workspaces.billing_service import check_membership_quota
                    ok, error, _ = check_membership_quota(ws)
                    if not ok:
                        errors[tag] = error
                        return
                    u = User.objects.create_user(username, email, "testpass123")
                    Membership.objects.create(user=u, workspace=ws, role="member")
                    results[tag] = "success"
            except Exception as exc:
                errors[tag] = str(exc)

        # Both workspaces have plenty of room (limit 5 each)
        t1 = threading.Thread(target=create_in_ws, args=("ws1", self.ws, "ws1user", "ws1@example.com"))
        t2 = threading.Thread(target=create_in_ws, args=("ws2", ws2, "ws2user", "ws2@example.com"))

        t1.start()
        t2.start()
        t1.join()
        t2.join()

        self.assertEqual(len(results), 2)
        self.assertEqual(len(errors), 0)

    def test_missing_billing_row_safe(self):
        """Workspace without WorkspaceBilling gets default Free limits."""
        WorkspaceBilling.objects.filter(workspace=self.ws).delete()

        ok, error, status_code = check_membership_quota(self.ws)
        self.assertTrue(ok)
        self.assertIsNone(error)
        self.assertIsNone(status_code)
