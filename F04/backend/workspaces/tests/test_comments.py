"""Comment tests for F04 issue comments."""

import os

from django.test import TestCase
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from workspaces.models import Workspace, Project, Board, Membership

User = get_user_model()


class CommentTestCase(TestCase):
    """Test suite for issue comment endpoints."""

    def setUp(self):
        """Create a fresh test client, workspace, project and issue."""
        self.client = APIClient()
        self.user = User.objects.create_user("alice", "alice@example.com", os.getenv('SECRET_TEST_PASS', 'testpass123'))
        self.client.login(username="alice", password=os.getenv('SECRET_TEST_PASS', 'testpass123'))
        self.bob = User.objects.create_user("bob", "bob@example.com", os.getenv('SECRET_TEST_PASS', 'testpass123'))
        self.bob_client = APIClient()
        self.bob_client.login(username="bob", password=os.getenv('SECRET_TEST_PASS', 'testpass123'))

        ws_resp = self.client.post(
            "/api/v1/workspaces/create/", {"name": "Acme"}, format="json"
        )
        self.assertEqual(ws_resp.status_code, 201)
        self.workspace_id = ws_resp.data["workspace"]["id"]

        proj_resp = self.client.post(
            "/api/v1/projects/create/",
            {"name": "Acme Project", "key": "ABC", "workspace_id": self.workspace_id},
            format="json",
        )
        self.assertEqual(proj_resp.status_code, 201)
        self.project_id = proj_resp.data["project"]["id"]

        issue_resp = self.client.post(
            f"/api/v1/projects/{self.project_id}/issues/",
            {"title": "Commentable Issue"},
            format="json",
        )
        self.assertEqual(issue_resp.status_code, 201)
        self.issue_id = issue_resp.data["issue"]["id"]

    def _comments_url(self, issue_id):
        return f"/api/v1/issues/{issue_id}/comments/"

    def _comment_url(self, comment_id):
        return f"/api/v1/comments/{comment_id}/"

    def test_list_comments_empty(self):
        """GET /api/v1/issues/{id}/comments/ returns empty results for issue with no comments."""
        response = self.client.get(self._comments_url(self.issue_id), format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["results"], [])

    def test_create_comment_valid(self):
        """POST /api/v1/issues/{id}/comments/ creates a comment and returns 201."""
        response = self.client.post(
            self._comments_url(self.issue_id),
            {"text": "Looks good to me."},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["comment"]["text"], "Looks good to me.")
        self.assertEqual(response.data["comment"]["author_username"], "alice")

    def test_create_comment_requires_text(self):
        """POST with blank text fails with 400."""
        response = self.client.post(
            self._comments_url(self.issue_id),
            {"text": ""},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_list_comments_after_create(self):
        """GET lists previously created comments."""
        self.client.post(
            self._comments_url(self.issue_id),
            {"text": "First comment"},
            format="json",
        )
        self.client.post(
            self._comments_url(self.issue_id),
            {"text": "Second comment"},
            format="json",
        )
        response = self.client.get(self._comments_url(self.issue_id), format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["results"]), 2)
        self.assertEqual(response.data["results"][0]["text"], "Second comment")

    def test_create_comment_requires_auth(self):
        """Comment creation requires authentication."""
        self.client.logout()
        self.client.session.flush()
        response = self.client.post(
            self._comments_url(self.issue_id),
            {"text": "Unauthenticated comment"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_delete_comment_by_author(self):
        """DELETE /api/v1/comments/{id}/ by the author returns 204."""
        create_resp = self.client.post(
            self._comments_url(self.issue_id),
            {"text": "To be deleted"},
            format="json",
        )
        self.assertEqual(create_resp.status_code, 201)
        comment_id = create_resp.data["comment"]["id"]

        response = self.client.delete(self._comment_url(comment_id), format="json")
        self.assertEqual(response.status_code, 204)

    def test_delete_comment_by_non_member(self):
        """DELETE by a user outside the workspace returns 403."""
        create_resp = self.client.post(
            self._comments_url(self.issue_id),
            {"text": "Protected comment"},
            format="json",
        )
        comment_id = create_resp.data["comment"]["id"]

        response = self.bob_client.delete(self._comment_url(comment_id), format="json")
        self.assertEqual(response.status_code, 403)

    def test_delete_nonexistent_comment(self):
        """DELETE of a nonexistent comment returns 404."""
        response = self.client.delete(self._comment_url(999999), format="json")
        self.assertEqual(response.status_code, 404)
