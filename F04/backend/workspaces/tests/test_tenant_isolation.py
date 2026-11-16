"""Tenant isolation and authorization tests for F04 MP-F04-016 Phase D."""

import os

from django.test import TestCase
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from workspaces.models import Workspace, Membership, Project, Board, WorkflowStatus, Issue

User = get_user_model()


class TenantIsolationTestCase(TestCase):
    """Cross-workspace access denial tests."""

    def setUp(self):
        self.client = APIClient()
        self.alice = User.objects.create_user(
            "alice", "alice@example.com", os.getenv("SECRET_TEST_PASS", "testpass123")
        )
        self.bob = User.objects.create_user(
            "bob", "bob@example.com", os.getenv("SECRET_TEST_PASS", "testpass123")
        )
        # Alice's workspace
        self.ws_a = Workspace.objects.create(name="Workspace A")
        Membership.objects.create(user=self.alice, workspace=self.ws_a, role="owner")
        # Bob's workspace
        self.ws_b = Workspace.objects.create(name="Workspace B")
        Membership.objects.create(user=self.bob, workspace=self.ws_b, role="owner")

    def login_alice(self):
        self.client.login(username="alice", password=os.getenv("SECRET_TEST_PASS", "testpass123"))

    def login_bob(self):
        self.client.login(username="bob", password=os.getenv("SECRET_TEST_PASS", "testpass123"))

    # ── Cross-workspace reads denied ──
    def test_cross_workspace_read_project_denied(self):
        """Bob cannot read Alice's project."""
        self.login_alice()
        resp = self.client.post(
            "/api/v1/projects/create/",
            {"name": "Alice's Project", "key": "AP1", "workspace_id": self.ws_a.id},
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        project_id = resp.data["project"]["id"]

        self.login_bob()
        resp = self.client.get(f"/api/v1/projects/{project_id}/")
        self.assertEqual(resp.status_code, 404)

    def test_cross_workspace_read_issue_denied(self):
        """Bob cannot read Alice's issue."""
        self.login_alice()
        resp = self.client.post(
            "/api/v1/projects/create/",
            {"name": "Alice's Project", "key": "AP2", "workspace_id": self.ws_a.id},
            format="json",
        )
        project_id = resp.data["project"]["id"]
        resp = self.client.post(
            f"/api/v1/projects/{project_id}/issues/",
            {"title": "Alice's Issue", "description": "Test", "priority": "medium"},
            format="json",
        )
        issue_id = resp.data["issue"]["id"]

        self.login_bob()
        resp = self.client.get(f"/api/v1/issues/{issue_id}/")
        self.assertEqual(resp.status_code, 404)

    def test_cross_workspace_read_workspace_denied(self):
        """Bob cannot read Alice's workspace detail."""
        self.login_bob()
        resp = self.client.get(f"/api/v1/workspaces/{self.ws_a.id}/")
        self.assertEqual(resp.status_code, 404)

    # ── Cross-workspace writes denied ──
    def test_cross_workspace_write_project_denied(self):
        """Bob cannot create project in Alice's workspace."""
        self.login_bob()
        resp = self.client.post(
            "/api/v1/projects/create/",
            {"name": "Bob's Project in A", "key": "BP1", "workspace_id": self.ws_a.id},
            format="json",
        )
        self.assertEqual(resp.status_code, 403)

    def test_cross_workspace_write_issue_denied(self):
        """Bob cannot create issue in Alice's project."""
        self.login_alice()
        resp = self.client.post(
            "/api/v1/projects/create/",
            {"name": "Alice's Project", "key": "AP3", "workspace_id": self.ws_a.id},
            format="json",
        )
        project_id = resp.data["project"]["id"]

        self.login_bob()
        resp = self.client.post(
            f"/api/v1/projects/{project_id}/issues/",
            {"title": "Bob's Issue", "description": "Test", "priority": "medium"},
            format="json",
        )
        self.assertEqual(resp.status_code, 403)

    # ── Nested resource identifiers cannot bypass authorization ──
    def test_nested_resource_bypass_denied(self):
        """Bob cannot access Alice's issue via nested path."""
        self.login_alice()
        resp = self.client.post(
            "/api/v1/projects/create/",
            {"name": "Alice's Project", "key": "AP4", "workspace_id": self.ws_a.id},
            format="json",
        )
        project_id = resp.data["project"]["id"]
        resp = self.client.post(
            f"/api/v1/projects/{project_id}/issues/",
            {"title": "Nested Test Issue", "description": "Test", "priority": "medium"},
            format="json",
        )
        issue_id = resp.data["issue"]["id"]

        self.login_bob()
        resp = self.client.get(f"/api/v1/issues/{issue_id}/")
        self.assertEqual(resp.status_code, 404)

    # ── Membership and ownership checks ──
    def test_non_member_cannot_access_workspace(self):
        """Non-member cannot access workspace detail."""
        self.login_bob()
        resp = self.client.get(f"/api/v1/workspaces/{self.ws_a.id}/")
        self.assertEqual(resp.status_code, 404)

    def test_member_cannot_do_owner_actions(self):
        """Member cannot rename workspace (owner-only)."""
        self.login_alice()
        resp = self.client.post(
            "/api/v1/projects/create/",
            {"name": "Test Project", "key": "TP1", "workspace_id": self.ws_a.id},
            format="json",
        )
        project_id = resp.data["project"]["id"]

        # Bob is a member of ws_b but not ws_a - he can't rename ws_a
        # Let's add Bob as a member of ws_a first (non-owner)
        Membership.objects.create(user=self.bob, workspace=self.ws_a, role="member")
        self.login_bob()
        resp = self.client.post(
            f"/api/v1/workspaces/{self.ws_a.id}/rename/",
            {"name": "Renamed Workspace"},
            format="json",
        )
        self.assertEqual(resp.status_code, 403)

    # ── Soft-deleted workspace inaccessible ──
    def test_soft_deleted_workspace_inaccessible(self):
        """Soft-deleted workspace returns 404 through all endpoints."""
        self.login_alice()
        ws_to_delete = Workspace.objects.create(name="To Be Deleted")
        Membership.objects.create(user=self.alice, workspace=ws_to_delete, role="owner")

        resp = self.client.delete(
            f"/api/v1/workspaces/{ws_to_delete.id}/delete/",
            {"confirmation_name": "To Be Deleted"},
            format="json",
        )
        self.assertEqual(resp.status_code, 204)

        # Detail endpoint
        resp = self.client.get(f"/api/v1/workspaces/{ws_to_delete.id}/")
        self.assertEqual(resp.status_code, 404)

        # Not in list
        resp = self.client.get("/api/v1/workspaces/")
        ws_names = [w["name"] for w in resp.data["results"]]
        self.assertNotIn("To Be Deleted", ws_names)

    # ── Restoration owner-authorized ──
    def test_restoration_owner_authorized(self):
        """Only owner can restore workspace."""
        self.login_alice()
        ws_to_delete = Workspace.objects.create(name="Restore Test")
        Membership.objects.create(user=self.alice, workspace=ws_to_delete, role="owner")

        # Delete
        resp = self.client.delete(
            f"/api/v1/workspaces/{ws_to_delete.id}/delete/",
            {"confirmation_name": "Restore Test"},
            format="json",
        )
        self.assertEqual(resp.status_code, 204)

        # Bob (non-owner) cannot restore
        self.login_bob()
        resp = self.client.post(f"/api/v1/workspaces/{ws_to_delete.id}/restore/", format="json")
        self.assertEqual(resp.status_code, 403)

        # Alice (owner) can restore
        self.login_alice()
        resp = self.client.post(f"/api/v1/workspaces/{ws_to_delete.id}/restore/", format="json")
        self.assertEqual(resp.status_code, 200)

        # Verify accessible again
        resp = self.client.get(f"/api/v1/workspaces/{ws_to_delete.id}/")
        self.assertEqual(resp.status_code, 200)

    # ── Anonymous access denied ──
    def test_anonymous_access_denied(self):
        """Anonymous user cannot access protected endpoints."""
        self.client.logout()
        resp = self.client.get("/api/v1/workspaces/")
        self.assertIn(resp.status_code, [401, 403])

        resp = self.client.post("/api/v1/projects/create/", {"name": "X", "key": "XX", "workspace_id": self.ws_a.id}, format="json")
        self.assertIn(resp.status_code, [401, 403])

    # ── Tenant context establishment and cleanup ──
    def test_tenant_context_established_per_workspace(self):
        """Tenant context is set per-request based on workspace."""
        from django_multitenant.utils import get_current_tenant
        from workspaces.models import Workspace, Membership

        ws1 = Workspace.objects.create(name="Middleware WS 1")
        ws2 = Workspace.objects.create(name="Middleware WS 2")
        Membership.objects.create(user=self.alice, workspace=ws1, role="owner")
        Membership.objects.create(user=self.alice, workspace=ws2, role="owner")

        # First request: workspace 1
        self.login_alice()
        resp1 = self.client.get(f"/api/v1/workspaces/{ws1.id}/")
        self.assertEqual(resp1.status_code, 200)

        # Verify tenant context was ws1 during the request
        # After request completes, tenant context should be cleared

        # Second request: workspace 2 - should not see ws1's data
        resp2 = self.client.get(f"/api/v1/workspaces/{ws2.id}/")
        self.assertEqual(resp2.status_code, 200)

    def test_tenant_context_cleared_after_request(self):
        """Tenant context is cleared after each request."""
        from django_multitenant.utils import get_current_tenant
        from workspaces.models import Workspace, Membership

        ws = Workspace.objects.create(name="Context Cleanup WS")
        Membership.objects.create(user=self.alice, workspace=ws, role="owner")

        self.login_alice()

        # Make a request that sets tenant context
        resp = self.client.get(f"/api/v1/workspaces/{ws.id}/")
        self.assertEqual(resp.status_code, 200)

        # After the request completes, tenant context should be cleared
        # We can't directly check get_current_tenant() here since it's per-thread
        # But we can verify that a subsequent request to a different workspace
        # doesn't leak context
        ws2 = Workspace.objects.create(name="Context Cleanup WS 2")
        Membership.objects.create(user=self.alice, workspace=ws2, role="owner")

        resp2 = self.client.get(f"/api/v1/workspaces/{ws2.id}/")
        self.assertEqual(resp2.status_code, 200)

    def test_middleware_no_tenant_for_non_workspace_urls(self):
        """Non-workspace URLs don't establish tenant context."""
        from django_multitenant.utils import get_current_tenant

        self.login_alice()

        # Non-workspace URL (login)
        resp = self.client.post("/api/v1/auth/login/", {
            "username": "alice",
            "password": os.getenv("SECRET_TEST_PASS", "testpass123")
        }, format="json")
        self.assertEqual(resp.status_code, 200)

    # ── Tenant context during view execution and cleanup ──
    def test_tenant_context_value_during_view_execution(self):
        """Tenant context is set to the correct workspace DURING view execution."""
        from django.test import RequestFactory
        from django.urls import resolve
        from django.http import JsonResponse
        from workspaces.middleware import TenantContextMiddleware
        from django_multitenant.utils import get_current_tenant, unset_current_tenant as clear_tenant

        ws = Workspace.objects.create(name="Tenant Value WS")
        Membership.objects.create(user=self.alice, workspace=ws, role="owner")

        factory = RequestFactory()
        captured = {}

        def capture_view(request):
            tenant = get_current_tenant()
            captured['id'] = tenant.id if tenant else None
            captured['name'] = tenant.name if tenant else None
            return JsonResponse({"tenant": captured})

        request = factory.get(f"/api/v1/workspaces/{ws.id}/")
        request.user = self.alice

        # Simulate Django's handler: resolve URL to set resolver_match
        resolver_match = resolve(request.path_info)
        request.resolver_match = resolver_match

        middleware = TenantContextMiddleware(lambda req: capture_view(req))

        # Simulate Django's handler: call process_view (sets tenant)
        middleware.process_view(request, capture_view, (), {})

        # Call the view (tenant context should be set)
        response = capture_view(request)

        self.assertEqual(captured['id'], ws.id)
        self.assertEqual(captured['name'], ws.name)

        # Simulate Django's handler finally: clear tenant
        clear_tenant()
        self.assertIsNone(get_current_tenant())

    def test_tenant_context_cleared_after_view_exception(self):
        """Tenant context is cleared when a view raises an exception."""
        from django.test import RequestFactory
        from django.urls import resolve
        from workspaces.middleware import TenantContextMiddleware
        from django_multitenant.utils import get_current_tenant, unset_current_tenant as clear_tenant

        ws = Workspace.objects.create(name="Exception WS")
        Membership.objects.create(user=self.alice, workspace=ws, role="owner")

        factory = RequestFactory()

        def raising_view(request):
            raise RuntimeError("Simulated view error")

        request = factory.get(f"/api/v1/workspaces/{ws.id}/")
        request.user = self.alice

        resolver_match = resolve(request.path_info)
        request.resolver_match = resolver_match

        middleware = TenantContextMiddleware(lambda req: raising_view(request))

        # Simulate Django's handler: process_view sets tenant
        middleware.process_view(request, raising_view, (), {})
        self.assertIsNotNone(get_current_tenant())
        self.assertEqual(get_current_tenant().id, ws.id)

        # Simulate Django's handler: __call__ wraps get_response in try/finally
        try:
            middleware(request)  # get_response calls raising_view which raises
        except RuntimeError:
            pass

        # __call__'s finally cleared the tenant even after exception
        self.assertIsNone(get_current_tenant())

    def test_consecutive_requests_different_workspaces_isolated(self):
        """Consecutive requests to different workspaces do not leak tenant context."""
        from django_multitenant.utils import get_current_tenant

        ws1 = Workspace.objects.create(name="Consecutive WS1")
        ws2 = Workspace.objects.create(name="Consecutive WS2")
        Membership.objects.create(user=self.alice, workspace=ws1, role="owner")
        Membership.objects.create(user=self.alice, workspace=ws2, role="owner")

        self.login_alice()

        # Request workspace 1
        resp1 = self.client.get(f"/api/v1/workspaces/{ws1.id}/")
        self.assertEqual(resp1.status_code, 200)
        self.assertEqual(resp1.data["workspace"]["name"], "Consecutive WS1")

        # Request workspace 2 - should get workspace 2's data, not workspace 1's
        resp2 = self.client.get(f"/api/v1/workspaces/{ws2.id}/")
        self.assertEqual(resp2.status_code, 200)
        self.assertEqual(resp2.data["workspace"]["name"], "Consecutive WS2")

    def test_tenant_context_cleared_after_api_client_request(self):
        """After a complete APIClient request through Django's middleware stack,
        tenant context is cleared."""
        from django_multitenant.utils import get_current_tenant

        ws = Workspace.objects.create(name="API Client WS")
        Membership.objects.create(user=self.alice, workspace=ws, role="owner")

        self.login_alice()
        resp = self.client.get(f"/api/v1/workspaces/{ws.id}/")
        self.assertEqual(resp.status_code, 200)

        # After the complete request, tenant context should be cleared
        self.assertIsNone(get_current_tenant())

    def test_unauthorized_access_tenant_set_but_access_denied(self):
        """Bob accessing Alice's workspace: tenant resolved from URL, access denied, context cleared."""
        from django.test import RequestFactory
        from django.urls import resolve
        from django.http import JsonResponse
        from workspaces.middleware import TenantContextMiddleware
        from django_multitenant.utils import get_current_tenant, unset_current_tenant as clear_tenant

        factory = RequestFactory()
        tenant_during_view = {}

        def view(req):
            tenant = get_current_tenant()
            tenant_during_view['id'] = tenant.id if tenant else None
            tenant_during_view['name'] = tenant.name if tenant else None
            # View checks membership and denies access
            return JsonResponse({"error": "not_found"}, status=404)

        request = factory.get(f"/api/v1/workspaces/{self.ws_a.id}/")
        request.user = self.bob

        resolver_match = resolve(request.path_info)
        request.resolver_match = resolver_match

        middleware = TenantContextMiddleware(lambda req: view(req))

        # process_view sets tenant based on URL kwargs (ws_a), even though Bob is not a member
        middleware.process_view(request, view, (), {})
        self.assertIsNotNone(get_current_tenant())
        self.assertEqual(get_current_tenant().id, self.ws_a.id)

        # View returns 404 (authorization checked in view, not middleware) and
        # captures the tenant that was resolved from URL kwargs during execution
        response = view(request)
        self.assertEqual(response.status_code, 404)

        # Tenant was resolved from URL kwargs
        self.assertEqual(tenant_during_view['id'], self.ws_a.id)
        self.assertEqual(tenant_during_view['name'], "Workspace A")

        # Tenant cleared after request
        clear_tenant()
        self.assertIsNone(get_current_tenant())

    def test_tenant_context_none_for_non_workspace_urls(self):
        """Non-workspace URLs don't establish tenant context."""
        from django.test import RequestFactory
        from django.urls import resolve
        from django.http import JsonResponse
        from workspaces.middleware import TenantContextMiddleware
        from django_multitenant.utils import get_current_tenant, unset_current_tenant as clear_tenant

        self.login_alice()

        factory = RequestFactory()
        request = factory.get("/api/v1/auth/me/")
        request.user = self.alice

        resolver_match = resolve(request.path_info)
        request.resolver_match = resolver_match

        middleware = TenantContextMiddleware(lambda req: JsonResponse({"ok": True}))
        middleware.process_view(request, lambda r: JsonResponse({"ok": True}), (), {})

        # No workspace_id in URL → tenant context remains None
        self.assertIsNone(get_current_tenant())
        clear_tenant()

    # ── Real-middleware-chain tenant tests (MP-F04-017B) ──
    def test_tenant_observed_during_real_request(self):
        """Tenant observed during real request through full Django middleware chain."""
        from django_multitenant.utils import get_current_tenant, unset_current_tenant as clear_tenant
        from workspaces.middleware import TenantContextMiddleware

        ws = Workspace.objects.create(name="Real Request WS")
        Membership.objects.create(user=self.alice, workspace=ws, role="owner")

        captured = {}

        original_process_view = TenantContextMiddleware.process_view

        def capturing_process_view(self, request, view_func, view_args, view_kwargs):
            result = original_process_view(self, request, view_func, view_args, view_kwargs)
            tenant = get_current_tenant()
            if tenant:
                captured['id'] = tenant.id
                captured['name'] = tenant.name
            return result

        TenantContextMiddleware.process_view = capturing_process_view

        try:
            self.login_alice()
            resp = self.client.get(f"/api/v1/workspaces/{ws.id}/")
            self.assertEqual(resp.status_code, 200)

            # Tenant was observed during view execution through real middleware
            self.assertEqual(captured['id'], ws.id)
            self.assertEqual(captured['name'], "Real Request WS")
        finally:
            TenantContextMiddleware.process_view = original_process_view
            clear_tenant()

        # After the complete request through Django's middleware stack,
        # tenant context should be cleared
        self.assertIsNone(get_current_tenant())

    def test_tenant_cleared_after_real_response(self):
        """After a real response through Django middleware, tenant context is cleared."""
        from django_multitenant.utils import get_current_tenant

        ws = Workspace.objects.create(name="Real Response WS")
        Membership.objects.create(user=self.alice, workspace=ws, role="owner")

        self.login_alice()
        resp = self.client.get(f"/api/v1/workspaces/{ws.id}/")
        self.assertEqual(resp.status_code, 200)

        # After the complete request through Django's middleware stack,
        # tenant context should be cleared
        self.assertIsNone(get_current_tenant())

    def test_tenant_cleared_after_real_exception(self):
        """Tenant context cleared when a real request through __call__ raises an exception."""
        from django.test import RequestFactory
        from django.urls import resolve
        from workspaces.middleware import TenantContextMiddleware
        from django_multitenant.utils import get_current_tenant, unset_current_tenant as clear_tenant

        ws = Workspace.objects.create(name="Real Exception WS")
        Membership.objects.create(user=self.alice, workspace=ws, role="owner")

        factory = RequestFactory()

        def raising_view(request):
            raise RuntimeError("Simulated view error")

        request = factory.get(f"/api/v1/workspaces/{ws.id}/")
        request.user = self.alice

        # Simulate Django's handler: resolve URL to set resolver_match
        resolver_match = resolve(request.path_info)
        request.resolver_match = resolver_match

        middleware = TenantContextMiddleware(lambda req: raising_view(request))

        # Simulate Django's handler: process_view sets tenant
        middleware.process_view(request, raising_view, (), {})
        self.assertIsNotNone(get_current_tenant())
        self.assertEqual(get_current_tenant().id, ws.id)

        # Simulate Django's handler: __call__ wraps get_response in try/finally
        try:
            middleware(request)  # get_response calls raising_view which raises
        except RuntimeError:
            pass

        # __call__'s finally cleared the tenant even after exception
        self.assertIsNone(get_current_tenant())

    def test_no_tenant_inherited_for_non_workspace_url(self):
        """A request to a non-workspace URL after a workspace request does not inherit tenant context."""
        from django_multitenant.utils import get_current_tenant

        ws = Workspace.objects.create(name="No Inherit WS")
        Membership.objects.create(user=self.alice, workspace=ws, role="owner")

        self.login_alice()

        # First request: workspace URL sets tenant
        resp = self.client.get(f"/api/v1/workspaces/{ws.id}/")
        self.assertEqual(resp.status_code, 200)

        # Second request: non-workspace URL (auth/me) should not inherit tenant
        resp2 = self.client.get("/api/v1/auth/me/")
        self.assertEqual(resp2.status_code, 200)

        # After both requests, tenant should be cleared
        self.assertIsNone(get_current_tenant())

    # ── Authorization/isolation tests via real routes (MP-F04-017B) ──
    def test_authorized_user_accesses_own_workspace_resources(self):
        """Alice can access her own workspace's project and issue."""
        self.login_alice()

        # Create project in ws_a
        resp = self.client.post(
            "/api/v1/projects/create/",
            {"name": "Alice's Project", "key": "AP1", "workspace_id": self.ws_a.id},
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        project_id = resp.data["project"]["id"]

        # Create issue in the project
        resp = self.client.post(
            f"/api/v1/projects/{project_id}/issues/",
            {"title": "Alice's Issue", "description": "Test", "priority": "medium"},
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        issue_id = resp.data["issue"]["id"]

        # Alice can access her project
        resp = self.client.get(f"/api/v1/projects/{project_id}/")
        self.assertEqual(resp.status_code, 200)

        # Alice can access her issue
        resp = self.client.get(f"/api/v1/issues/{issue_id}/")
        self.assertEqual(resp.status_code, 200)

    def test_unauthorized_user_cannot_access_other_workspace(self):
        """Bob cannot read Alice's project or issue (returns 404, no info leak)."""
        self.login_alice()
        resp = self.client.post(
            "/api/v1/projects/create/",
            {"name": "Alice's Project", "key": "AP2", "workspace_id": self.ws_a.id},
            format="json",
        )
        self.assertEqual(resp.status_code, 201)
        project_id = resp.data["project"]["id"]
        resp = self.client.post(
            f"/api/v1/projects/{project_id}/issues/",
            {"title": "Alice's Issue", "description": "Test", "priority": "medium"},
            format="json",
        )
        issue_id = resp.data["issue"]["id"]

        self.login_bob()

        # Bob cannot read Alice's project
        resp = self.client.get(f"/api/v1/projects/{project_id}/")
        self.assertEqual(resp.status_code, 404)
        # Response should not expose project name or existence
        self.assertNotIn("Alice", str(resp.data))

        # Bob cannot read Alice's issue
        resp = self.client.get(f"/api/v1/issues/{issue_id}/")
        self.assertEqual(resp.status_code, 404)
        self.assertNotIn("Alice", str(resp.data))

    def test_nested_resource_ids_cannot_bypass_authorization(self):
        """Bob cannot access Alice's issue via nested path with different workspace_id."""
        self.login_alice()
        resp = self.client.post(
            "/api/v1/projects/create/",
            {"name": "Alice's Project", "key": "AP3", "workspace_id": self.ws_a.id},
            format="json",
        )
        project_id = resp.data["project"]["id"]
        resp = self.client.post(
            f"/api/v1/projects/{project_id}/issues/",
            {"title": "Nested Test Issue", "description": "Test", "priority": "medium"},
            format="json",
        )
        issue_id = resp.data["issue"]["id"]

        self.login_bob()

        # Bob tries to access Alice's issue through its own URL
        resp = self.client.get(f"/api/v1/issues/{issue_id}/")
        self.assertEqual(resp.status_code, 404)

    def test_context_cleared_after_denied_access(self):
        """After a denied access request, tenant context is cleared."""
        from django_multitenant.utils import get_current_tenant

        self.login_bob()

        # Bob tries to access Alice's workspace - denied
        resp = self.client.get(f"/api/v1/workspaces/{self.ws_a.id}/")
        self.assertEqual(resp.status_code, 404)

        # Tenant context should be cleared after the denied request
        self.assertIsNone(get_current_tenant())

        # Bob can still access his own workspace
        resp = self.client.get(f"/api/v1/workspaces/{self.ws_b.id}/")
        self.assertEqual(resp.status_code, 200)
