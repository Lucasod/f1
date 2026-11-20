/**
 * WorkspaceDeleteModal.tsx
 *
 * Modal dialog for deleting a workspace. Requires typing the workspace name
 * to confirm, then calls DELETE /workspaces/{id}/delete/. Accessible controls:
 * dialog role, labelled heading, required confirmation input, error alert.
 */

import React, { useState } from "react";
import { useWorkspace } from "../../hooks/useWorkspace";
import { deleteWorkspace } from "../../api/billing";

interface WorkspaceDeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceName: string;
  onDeleted: () => void;
}

export function WorkspaceDeleteModal({
  isOpen,
  onClose,
  workspaceName,
  onDeleted,
}: WorkspaceDeleteModalProps) {
  const [confirmationName, setConfirmationName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { currentWorkspaceId } = useWorkspace();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentWorkspaceId) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteWorkspace(currentWorkspaceId, workspaceName);
      onDeleted();
    } catch (err: any) {
      setError(err?.message ?? "Failed to delete workspace");
    } finally {
      setDeleting(false);
    }
  };

  const canSubmit = confirmationName === workspaceName;

  if (!isOpen) return null;

  return (
    <div className="modal modal--delete" role="dialog" aria-modal="true" aria-labelledby="delete-modal-title">
      <div className="modal__overlay" onClick={onClose} />
      <div className="modal__panel">
        <h2 id="delete-modal-title">Delete Workspace</h2>
        <p className="modal__warning">
          Deleting "{workspaceName}" will make it inaccessible to all members. Billing must be canceled first. Records will remain stored — this is not permanent erasure.
        </p>
        <form onSubmit={handleSubmit} noValidate>
          <div className="modal__field">
            <label htmlFor="confirmation-name">Type the workspace name to confirm:</label>
            <input
              id="confirmation-name"
              type="text"
              value={confirmationName}
              onChange={(e) => setConfirmationName(e.target.value)}
              required
              aria-required="true"
            />
          </div>
          {error && <div className="modal__error" role="alert">{error}</div>}
          <div className="modal__actions">
            <button type="button" onClick={onClose} className="modal__btn modal__btn--cancel">
              Cancel
            </button>
            <button
              type="submit"
              disabled={deleting || !canSubmit}
              className="modal__btn modal__btn--delete"
            >
              {deleting ? "Deleting…" : "Delete Workspace"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
