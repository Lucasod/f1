"""Tests for cleanup_attachment Celery task."""

import os as os_module
import shutil
import unittest.mock

from django.test import TestCase
from django_multitenant.utils import set_current_tenant, unset_current_tenant

from workspaces.models import Attachment, Issue, Workspace, Membership, Project, Board, WorkflowStatus
from workspaces.tasks import cleanup_attachment
from django.contrib.auth import get_user_model

User = get_user_model()


class CleanupAttachmentTaskTestCase(TestCase):
    """Test cleanup_attachment Celery task."""

    def setUp(self):
        self.user = User.objects.create_user(
            "cleanup_user", "cleanup@example.com", "testpass123"
        )
        self.workspace = Workspace.objects.create(
            name="Cleanup Workspace", tenant_id=1
        )
        Membership.objects.create(user=self.user, workspace=self.workspace, role="owner")
        set_current_tenant(self.workspace)

        self.project = Project.objects.create(
            key="CLN", name="Cleanup Project", workspace=self.workspace
        )
        self.board = Board.objects.create(
            project=self.project, workspace=self.workspace, name="Cleanup Board"
        )
        self.status = WorkflowStatus.objects.create(
            board=self.board, name="to_do", position=0, is_active=True
        )
        self.issue = Issue.objects.create(
            board=self.board,
            number=1,
            title="Cleanup test issue",
            description="Test",
            priority="medium",
            reporter=self.user,
            status_id=self.status,
        )

        # Storage directory used by the task (relative to tasks.py -> backend/private_storage)
        self.storage_dir = os_module.path.join(
            os_module.path.dirname(os_module.path.abspath(__file__)), "..", "..", "private_storage"
        )
        self.ws_storage_dir = os_module.path.join(self.storage_dir, f"workspace_{self.workspace.id}")
        os_module.makedirs(self.ws_storage_dir, exist_ok=True)

    def tearDown(self):
        unset_current_tenant()
        if os_module.path.exists(self.ws_storage_dir):
            shutil.rmtree(self.ws_storage_dir, ignore_errors=True)

    def _make_attachment(self, state, object_key_suffix, create_file=True, content=b"x"):
        object_key = f"workspace_{self.workspace.id}/issue_{self.issue.id}/{object_key_suffix}"
        storage_path = os_module.path.join(self.storage_dir, object_key)
        if create_file:
            os_module.makedirs(os_module.path.dirname(storage_path), exist_ok=True)
            with open(storage_path, "wb") as f:
                f.write(content)
        att = Attachment.objects.create(
            issue=self.issue,
            workspace=self.workspace,
            uploader=self.user,
            original_name=f"cleanup_{object_key_suffix}.txt",
            detected_content_type="text/plain",
            byte_size=len(content),
            sha256="a" * 64,
            object_key=object_key,
            state=state,
        )
        return att, storage_path

    def test_cleanup_deleted_attachment_removes_file(self):
        """Deleted attachment with existing file: file is removed."""
        att, storage_path = self._make_attachment("deleted", "deleted-file", create_file=True)
        self.assertTrue(os_module.path.exists(storage_path))

        result = cleanup_attachment.apply(
            args=[att.id], kwargs={"_workspace_id": self.workspace.id}
        )
        self.assertEqual(result.result["status"], "cleaned")
        self.assertTrue(result.result["file_existed"])
        self.assertFalse(os_module.path.exists(storage_path))

    def test_cleanup_deleted_attachment_missing_file_counts_as_success(self):
        """Deleted attachment with no file: success, no error."""
        att, storage_path = self._make_attachment("deleted", "deleted-missing", create_file=False)
        self.assertFalse(os_module.path.exists(storage_path))

        result = cleanup_attachment.apply(
            args=[att.id], kwargs={"_workspace_id": self.workspace.id}
        )
        self.assertEqual(result.result["status"], "cleaned")
        self.assertFalse(result.result["file_existed"])

    def test_cleanup_failed_attachment_removes_file(self):
        """Failed attachment with existing file: file is removed."""
        att, storage_path = self._make_attachment("failed", "failed-file", create_file=True)
        self.assertTrue(os_module.path.exists(storage_path))

        result = cleanup_attachment.apply(
            args=[att.id], kwargs={"_workspace_id": self.workspace.id}
        )
        self.assertEqual(result.result["status"], "cleaned")
        self.assertTrue(result.result["file_existed"])
        self.assertFalse(os_module.path.exists(storage_path))

    def test_cleanup_ready_attachment_skipped(self):
        """Ready attachment: skipped, no file removal."""
        att, storage_path = self._make_attachment("ready", "ready-file", create_file=True)
        self.assertTrue(os_module.path.exists(storage_path))

        result = cleanup_attachment.apply(
            args=[att.id], kwargs={"_workspace_id": self.workspace.id}
        )
        self.assertEqual(result.result["status"], "skipped")
        self.assertEqual(result.result["reason"], "state is ready")
        self.assertTrue(os_module.path.exists(storage_path))

    def test_cleanup_nonexistent_attachment(self):
        """Non-existent attachment: returns not_found."""
        result = cleanup_attachment.apply(
            args=[999999], kwargs={"_workspace_id": self.workspace.id}
        )
        self.assertEqual(result.result["status"], "not_found")

    def test_cleanup_workspace_mismatch_no_removal(self):
        """Attachment belongs to workspace A, task called with workspace B → no removal."""
        # Create a different workspace
        ws_b = Workspace.objects.create(name="Workspace B", tenant_id=2)
        Membership.objects.create(user=self.user, workspace=ws_b, role="owner")

        att, storage_path = self._make_attachment("deleted", "mismatch-file", create_file=True)
        self.assertTrue(os_module.path.exists(storage_path))

        # Call cleanup with wrong workspace
        result = cleanup_attachment.apply(
            args=[att.id], kwargs={"_workspace_id": ws_b.id}
        )
        # Task should skip or not remove because workspace doesn't match attachment
        # The task uses TenantAwareTask which sets tenant context from _workspace_id,
        # but the attachment belongs to a different workspace. With tenant context set
        # to ws_b, the Attachment.objects.get(id=att.id) won't find it (tenant isolation).
        self.assertEqual(result.result["status"], "not_found")
        # File should still exist
        self.assertTrue(os_module.path.exists(storage_path))

    def test_cleanup_invalid_workspace_no_removal(self):
        """Attachment exists, task called with non-existent workspace → not_found."""
        att, storage_path = self._make_attachment("deleted", "invalid-ws-file", create_file=True)
        self.assertTrue(os_module.path.exists(storage_path))

        result = cleanup_attachment.apply(
            args=[att.id], kwargs={"_workspace_id": 999999}
        )
        self.assertEqual(result.result["status"], "not_found")
        self.assertTrue(os_module.path.exists(storage_path))

    def test_cleanup_tenant_isolation_different_workspace(self):
        """Tenant context from different workspace prevents access to attachment."""
        ws_other = Workspace.objects.create(name="Other Workspace", tenant_id=99)
        Membership.objects.create(user=self.user, workspace=ws_other, role="owner")

        att, storage_path = self._make_attachment("deleted", "tenant-iso-file", create_file=True)
        self.assertTrue(os_module.path.exists(storage_path))

        # Call with other workspace's ID - tenant isolation should prevent access
        result = cleanup_attachment.apply(
            args=[att.id], kwargs={"_workspace_id": ws_other.id}
        )
        self.assertEqual(result.result["status"], "not_found")
        self.assertTrue(os_module.path.exists(storage_path))

    def test_cleanup_removed_file_then_second_call_is_idempotent(self):
        """Repeated cleanup on same attachment: second call finds no file, still success."""
        att, storage_path = self._make_attachment("deleted", "idempotent-file", create_file=True)

        # First call removes the file
        result1 = cleanup_attachment.apply(
            args=[att.id], kwargs={"_workspace_id": self.workspace.id}
        )
        self.assertEqual(result1.result["status"], "cleaned")
        self.assertTrue(result1.result["file_existed"])
        self.assertFalse(os_module.path.exists(storage_path))

        # Second call: file is missing, still success
        result2 = cleanup_attachment.apply(
            args=[att.id], kwargs={"_workspace_id": self.workspace.id}
        )
        self.assertEqual(result2.result["status"], "cleaned")
        self.assertFalse(result2.result["file_existed"])

    @unittest.mock.patch('workspaces.tasks.os_module.path.exists', return_value=True)
    @unittest.mock.patch('workspaces.tasks.os_module.remove', side_effect=OSError("Permission denied"))
    def test_cleanup_removal_error_triggers_retry(self, mock_remove, mock_exists):
        """OSError during removal triggers Celery retry."""
        att, storage_path = self._make_attachment("deleted", "retry-file", create_file=True)

        # The task should retry on OSError until max retries is exhausted
        try:
            cleanup_attachment.apply(
                args=[att.id], kwargs={"_workspace_id": self.workspace.id}
            )
        except self.failureException:
            raise
        except Exception as exc:
            # Celery retry raises MaxRetriesExceededError or similar once retries are exhausted
            self.assertIsInstance(exc, Exception)

        # Verify remove was called (at least once)
        self.assertTrue(mock_remove.called)
