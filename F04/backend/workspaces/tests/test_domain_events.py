"""DomainEvent outbox integration tests for MP-F04-018D.

Verifies that real business operations (issue create, issue transition,
comment create, attachment delete) persist DomainEvent records through the
API, exercising the outbox pattern end-to-end.
"""

import os

from django.test import TestCase
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from workspaces.models import (
    Workspace, Membership, Project, Board, WorkflowStatus, Issue,
    Attachment, DomainEvent,
)

User = get_user_model()


class DomainEventOutboxTestCase(TestCase):
    """DomainEvent records are created for real business operations."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            "alice", "alice@example.com",
            os.environ["SECRET_TEST_PASS"],
        )
        self.client.login(
            username="alice", password=os.environ["SECRET_TEST_PASS"]
        )

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
            {"title": "DomainEvent test issue"},
            format="json",
        )
        self.assertEqual(issue_resp.status_code, 201)
        self.issue_id = issue_resp.data["issue"]["id"]

    def _domain_events_for_issue(self):
        return DomainEvent.objects.filter(
            aggregate_type="Issue", aggregate_id=str(self.issue_id)
        ).order_by("occurred_at")

    def test_create_issue_persists_domain_event(self):
        """Creating an issue via API persists an issue.created DomainEvent."""
        events = self._domain_events_for_issue()
        self.assertEqual(events.count(), 1)
        event = events.first()
        self.assertEqual(event.event_type, "issue.created")
        self.assertEqual(event.schema_version, 1)
        self.assertEqual(event.actor, self.user)
        self.assertEqual(event.workspace_id, self.workspace_id)
        self.assertEqual(event.payload["issue_id"], self.issue_id)
        self.assertEqual(event.payload["project_id"], self.project_id)
        self.assertEqual(event.payload["title"], "DomainEvent test issue")

    def test_transition_issue_persists_domain_event(self):
        """Transitioning an issue via API persists an issue.status_changed DomainEvent."""
        from_status = Issue.objects.get(id=self.issue_id).status_id

        # Find an in_progress status on the board
        board = from_status.board
        in_progress = WorkflowStatus.objects.get(board=board, name="in_progress")

        response = self.client.post(
            f"/api/v1/issues/{self.issue_id}/transitions/",
            {"status": "in_progress"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)

        events = self._domain_events_for_issue()
        status_changed = events.filter(event_type="issue.status_changed")
        self.assertEqual(status_changed.count(), 1)
        event = status_changed.first()
        self.assertEqual(event.event_type, "issue.status_changed")
        self.assertEqual(event.actor, self.user)
        self.assertEqual(event.workspace_id, self.workspace_id)
        self.assertEqual(event.payload["from_status"], str(from_status.id))
        self.assertEqual(event.payload["to_status"], in_progress.id)

    def test_create_comment_persists_domain_event(self):
        """Creating a comment via API persists a comment.created DomainEvent."""
        response = self.client.post(
            f"/api/v1/issues/{self.issue_id}/comments/",
            {"text": "Looks good to me."},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        comment_id = response.data["comment"]["id"]

        comment_event = DomainEvent.objects.filter(
            aggregate_type="Comment",
            aggregate_id=str(comment_id),
            event_type="comment.created",
        )
        self.assertEqual(comment_event.count(), 1)
        event = comment_event.first()
        self.assertEqual(event.actor, self.user)
        self.assertEqual(event.workspace_id, self.workspace_id)
        self.assertEqual(event.payload["comment_id"], comment_id)
        self.assertEqual(event.payload["issue_id"], self.issue_id)
        self.assertEqual(event.payload["author_id"], self.user.id)

    def test_delete_attachment_persists_domain_event(self):
        """Deleting an attachment via API persists an attachment.deleted DomainEvent."""
        import hashlib

        from django.core.files.uploadedfile import SimpleUploadedFile

        content = b"attachment domain event test"
        upload_resp = self.client.post(
            f"/api/v1/issues/{self.issue_id}/attachments/",
            {"file": SimpleUploadedFile("event_test.txt", content, content_type="text/plain")},
            format="multipart",
        )
        self.assertEqual(upload_resp.status_code, 201)
        attachment_id = upload_resp.data["attachment"]["id"]

        delete_resp = self.client.delete(
            f"/api/v1/attachments/{attachment_id}/", format="json"
        )
        self.assertEqual(delete_resp.status_code, 204)

        attachment_event = DomainEvent.objects.filter(
            aggregate_type="Attachment",
            aggregate_id=str(attachment_id),
            event_type="attachment.deleted",
        )
        self.assertEqual(attachment_event.count(), 1)
        event = attachment_event.first()
        self.assertEqual(event.actor, self.user)
        self.assertEqual(event.workspace_id, self.workspace_id)
        self.assertEqual(event.payload["attachment_id"], attachment_id)
        self.assertEqual(event.payload["issue_id"], self.issue_id)
