"""Attachment tests for F04 MP-F04-016."""

import os
import hashlib
import io

from django.test import TestCase
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from unittest.mock import patch
from workspaces.models import Workspace, Membership, Project, Board, WorkflowStatus, Issue, Attachment

User = get_user_model()


class AttachmentTestCase(TestCase):
    """Attachment upload, list, download, delete tests."""

    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(
            "alice", "alice@example.com", os.environ["SECRET_TEST_PASS"]
        )
        self.client.login(
            username="alice", password=os.environ["SECRET_TEST_PASS"]
        )
        self.ws = Workspace.objects.create(name="Attachment Test Workspace")
        Membership.objects.create(user=self.user, workspace=self.ws, role="owner")
        self.project = Project.objects.create(
            key="ATT", name="Attachment Test Project", workspace=self.ws
        )
        self.board = Board.objects.create(
            project=self.project, workspace=self.ws, name="Test Board"
        )
        self.status = WorkflowStatus.objects.create(
            board=self.board, name="to_do", position=0, is_active=True
        )
        self.issue = Issue.objects.create(
            board=self.board,
            number=1,
            title="Test Issue",
            status_id=self.status,
            reporter=self.user,
        )

    def test_upload_attachment(self):
        """Upload a valid PNG attachment."""
        content = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde"
        sha256 = hashlib.sha256(content).hexdigest()
        
        response = self.client.post(
            f"/api/v1/issues/{self.issue.id}/attachments/",
            {"file": SimpleUploadedFile("test.png", content, content_type="image/png")},
            format="multipart",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["attachment"]["original_name"], "test.png")
        self.assertEqual(response.data["attachment"]["byte_size"], len(content))
        self.assertEqual(response.data["attachment"]["sha256"], sha256)
        self.assertEqual(response.data["attachment"]["state"], "ready")
        
        # Verify attachment exists in database
        att = Attachment.objects.get(id=response.data["attachment"]["id"])
        self.assertEqual(att.state, "ready")
        self.assertEqual(att.uploader, self.user)
        self.assertEqual(att.issue, self.issue)

    def test_upload_no_file(self):
        """Upload with no file returns 400."""
        response = self.client.post(
            f"/api/v1/issues/{self.issue.id}/attachments/",
            {},
            format="multipart",
        )
        self.assertEqual(response.status_code, 400)

    def test_upload_file_too_large(self):
        """Upload file larger than 10 MiB returns 413."""
        large_content = b"x" * (11 * 1024 * 1024)  # 11 MiB
        response = self.client.post(
            f"/api/v1/issues/{self.issue.id}/attachments/",
            {"file": io.BytesIO(large_content)},
            format="multipart",
        )
        self.assertEqual(response.status_code, 413)

    def test_list_attachments(self):
        """List attachments for an issue."""
        # Create an attachment first
        content = b"test attachment content"
        att = Attachment.objects.create(
            issue=self.issue,
            workspace=self.ws,
            uploader=self.user,
            original_name="test.txt",
            detected_content_type="text/plain",
            byte_size=len(content),
            sha256=hashlib.sha256(content).hexdigest(),
            object_key=f"workspace_{self.ws.id}/issue_{self.issue.id}/test-uuid",
            state="ready",
        )
        
        response = self.client.get(
            f"/api/v1/issues/{self.issue.id}/attachments/",
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["results"]), 1)
        self.assertEqual(response.data["results"][0]["original_name"], "test.txt")

    def test_download_attachment(self):
        """Download an attachment."""
        content = b"download test content"
        att = Attachment.objects.create(
            issue=self.issue,
            workspace=self.ws,
            uploader=self.user,
            original_name="download_test.txt",
            detected_content_type="text/plain",
            byte_size=len(content),
            sha256=hashlib.sha256(content).hexdigest(),
            object_key=f"workspace_{self.ws.id}/issue_{self.issue.id}/download-uuid",
            state="ready",
        )

        import os as os_module
        storage_dir = os_module.path.join(
            os_module.path.dirname(os_module.path.abspath(__file__)), "..", "..", "private_storage"
        )
        os_module.makedirs(storage_dir, exist_ok=True)
        storage_path = os_module.path.join(storage_dir, att.object_key)
        os_module.makedirs(os_module.path.dirname(storage_path), exist_ok=True)
        with open(storage_path, "wb") as f:
            f.write(content)

        response = self.client.get(
            f"/api/v1/attachments/{att.id}/download/",
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(b"".join(response.streaming_content), content)

    def test_delete_attachment(self):
        """Soft-delete an attachment (uploader only)."""
        att = Attachment.objects.create(
            issue=self.issue,
            workspace=self.ws,
            uploader=self.user,
            original_name="delete_test.txt",
            detected_content_type="text/plain",
            byte_size=15,
            sha256=hashlib.sha256(b"delete test").hexdigest(),
            object_key=f"workspace_{self.ws.id}/issue_{self.issue.id}/delete-uuid",
            state="ready",
        )
        
        response = self.client.delete(
            f"/api/v1/attachments/{att.id}/",
            format="json",
        )
        self.assertEqual(response.status_code, 204)
        
        att.refresh_from_db()
        self.assertIsNotNone(att.deleted_at)
        self.assertEqual(att.state, "deleted")

    def test_delete_attachment_non_uploader(self):
        """Non-uploader cannot delete attachment."""
        other_user = User.objects.create_user(
            "bob", "bob@example.com", "testpass123"
        )
        att = Attachment.objects.create(
            issue=self.issue,
            workspace=self.ws,
            uploader=self.user,
            original_name="bob_cannot_delete.txt",
            detected_content_type="text/plain",
            byte_size=15,
            sha256=hashlib.sha256(b"bob test").hexdigest(),
            object_key=f"workspace_{self.ws.id}/issue_{self.issue.id}/bob-uuid",
            state="ready",
        )
        
        self.client.login(username="bob", password=os.environ["SECRET_TEST_PASS"])
        response = self.client.delete(
            f"/api/v1/attachments/{att.id}/",
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_cross_tenant_attachment_access(self):
        """User from another workspace cannot access attachment."""
        other_user = User.objects.create_user(
            "carol", "carol@example.com", "testpass123"
        )
        other_ws = Workspace.objects.create(name="Carol's Workspace")
        Membership.objects.create(user=other_user, workspace=other_ws, role="owner")
        
        att = Attachment.objects.create(
            issue=self.issue,
            workspace=self.ws,
            uploader=self.user,
            original_name="cross_tenant.txt",
            detected_content_type="text/plain",
            byte_size=15,
            sha256=hashlib.sha256(b"carol test").hexdigest(),
            object_key=f"workspace_{self.ws.id}/issue_{self.issue.id}/carol-uuid",
            state="ready",
        )
        
        self.client.login(username="carol", password=os.environ["SECRET_TEST_PASS"])
        response = self.client.get(
            f"/api/v1/attachments/{att.id}/download/",
            format="json",
        )
        self.assertEqual(response.status_code, 404)

    def test_upload_attachment_storage_failure_and_recovery(self):
        """Upload fails gracefully when storage is unwritable, retry succeeds."""
        content = b"test attachment content"

        # First upload succeeds and creates the storage directory structure
        response1 = self.client.post(
            f"/api/v1/issues/{self.issue.id}/attachments/",
            {"file": SimpleUploadedFile("test1.png", content, content_type="image/png")},
            format="multipart",
        )
        self.assertEqual(response1.status_code, 201)

        # Simulate storage write failure
        with patch("builtins.open", side_effect=OSError()):
            response2 = self.client.post(
                f"/api/v1/issues/{self.issue.id}/attachments/",
                {"file": SimpleUploadedFile("test2.png", content, content_type="image/png")},
                format="multipart",
            )
            self.assertEqual(response2.status_code, 500)
            self.assertEqual(response2.data["error"]["code"], "validation_error")

            # Verify attachment was created with state="failed"
            att = Attachment.objects.filter(issue=self.issue, uploader=self.user).order_by("-id").first()
            self.assertIsNotNone(att)
            self.assertEqual(att.state, "failed")

        # Retry should succeed (patch is no longer active)
        response3 = self.client.post(
            f"/api/v1/issues/{self.issue.id}/attachments/",
            {"file": SimpleUploadedFile("test3.png", content, content_type="image/png")},
            format="multipart",
        )
        self.assertEqual(response3.status_code, 201)
        self.assertEqual(response3.data["attachment"]["state"], "ready")

    def test_attachment_tenant_context_set(self):
        """Attachment has tenant_id set when created through API with tenant context."""
        from django_multitenant.utils import set_current_tenant, unset_current_tenant as clear_tenant

        content = b"tenant context test"
        Workspace.objects.filter(id=self.ws.id).update(tenant_id=999)
        self.ws.refresh_from_db()
        set_current_tenant(self.ws)
        try:
            response = self.client.post(
                f"/api/v1/issues/{self.issue.id}/attachments/",
                {"file": SimpleUploadedFile("tenant_test.txt", content, content_type="text/plain")},
                format="multipart",
            )
            self.assertEqual(response.status_code, 201)

            att = Attachment.objects.get(id=response.data["attachment"]["id"])
            self.assertEqual(att.tenant_id, 999)
            self.assertIsNotNone(att.tenant_id)
        finally:
            clear_tenant()

    def test_project_tenant_context_set(self):
        """Project has tenant_id set when created through API with tenant context."""
        from django_multitenant.utils import set_current_tenant, unset_current_tenant as clear_tenant

        Workspace.objects.filter(id=self.ws.id).update(tenant_id=999)
        self.ws.refresh_from_db()
        set_current_tenant(self.ws)
        try:
            proj = Project.objects.create(
                key="TNT", name="Tenant Test Project", workspace=self.ws
            )
            self.assertEqual(proj.tenant_id, 999)
            self.assertIsNotNone(proj.tenant_id)
        finally:
            clear_tenant()

    def test_issue_tenant_context_set(self):
        """Issue has tenant_id set when created through API with tenant context."""
        from django_multitenant.utils import set_current_tenant, unset_current_tenant as clear_tenant

        Workspace.objects.filter(id=self.ws.id).update(tenant_id=999)
        self.ws.refresh_from_db()
        set_current_tenant(self.ws)
        try:
            issue = Issue.objects.create(
                board=self.board,
                number=2,
                title="Tenant Test Issue",
                status_id=self.status,
                reporter=self.user,
            )
            self.assertEqual(issue.tenant_id, 999)
            self.assertIsNotNone(issue.tenant_id)
        finally:
            clear_tenant()

    # ── Storage failure handling ──
    def test_upload_attachment_directory_creation_failure(self):
        """Upload fails gracefully when storage directory cannot be created."""
        import os as os_module

        content = b"directory failure test"

        storage_dir = os_module.path.join(
            os_module.path.dirname(os_module.path.abspath(__file__)), "..", "..", "private_storage"
        )

        # Simulate directory creation failure (chmod is unreliable as root in Docker)
        with patch.object(os_module, "makedirs", side_effect=OSError()):
            response = self.client.post(
                f"/api/v1/issues/{self.issue.id}/attachments/",
                {"file": SimpleUploadedFile("fail_dir.png", content, content_type="image/png")},
                format="multipart",
            )
            self.assertEqual(response.status_code, 500)
            self.assertEqual(response.data["error"]["code"], "validation_error")

            # Verify attachment was created with state="failed"
            att = Attachment.objects.filter(issue=self.issue, uploader=self.user).order_by("-id").first()
            self.assertIsNotNone(att)
            self.assertEqual(att.state, "failed")

            # Verify no internal paths exposed in error response
            self.assertNotIn("private_storage", str(response.data))
            self.assertNotIn("/home", str(response.data))

    def test_upload_attachment_file_write_failure(self):
        """Upload fails gracefully when file write fails after directory creation."""
        import os as os_module

        content = b"file write failure test"

        # First make a successful upload so the directory structure exists
        response1 = self.client.post(
            f"/api/v1/issues/{self.issue.id}/attachments/",
            {"file": SimpleUploadedFile("first.png", content, content_type="image/png")},
            format="multipart",
        )
        self.assertEqual(response1.status_code, 201)

        # Simulate file write failure (chmod is unreliable as root in Docker)
        with patch("builtins.open", side_effect=OSError()):
            response2 = self.client.post(
                f"/api/v1/issues/{self.issue.id}/attachments/",
                {"file": SimpleUploadedFile("fail_write.png", content, content_type="image/png")},
                format="multipart",
            )
            self.assertEqual(response2.status_code, 500)
            self.assertEqual(response2.data["error"]["code"], "validation_error")

            # Verify attachment was created with state="failed"
            att = Attachment.objects.filter(issue=self.issue, uploader=self.user).order_by("-id").first()
            self.assertIsNotNone(att)
            self.assertEqual(att.state, "failed")

            # Verify no internal paths exposed
            self.assertNotIn("private_storage", str(response2.data))
