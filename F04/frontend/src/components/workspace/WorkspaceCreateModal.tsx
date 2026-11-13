/**
 * WorkspaceCreateModal.tsx
 *
 * Modal dialog for creating a new workspace. Calls POST /workspaces/create/,
 * then refreshes the workspace list and selects the new workspace.
 */

import { useState } from "react";
import { useWorkspace } from "../../hooks/useWorkspace";
import type { Workspace } from "../../types/index";

interface WorkspaceCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave?: (workspace: Workspace) => void;
}

export function WorkspaceCreateModal({
  isOpen,
  onClose,
  onSave,
}: WorkspaceCreateModalProps) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { createWorkspace } = useWorkspace();

  if (!isOpen) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (!name.trim()) {
      setError("Workspace name is required.");
      return;
    }
    setLoading(true);
    try {
      const ws = await createWorkspace(name.trim());
      setName("");
      setLoading(false);
      if (onSave) onSave(ws);
      onClose();
    } catch (err: any) {
      setError(err?.message ?? "Failed to create workspace.");
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="workspace-create-title">
      <div className="modal" aria-hidden={!isOpen}>
        <h2 id="workspace-create-title" className="modal__title">
          Create workspace
        </h2>
        {error && (
          <div className="modal__error" role="alert">{error}</div>
        )}
        <form onSubmit={handleSubmit} noValidate>
          <div className="modal__field">
            <label htmlFor="workspace-create-name">Workspace name</label>
            <input
              id="workspace-create-name"
              name="name"
              type="text"
              autoComplete="off"
              autoFocus
              maxLength={100}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={loading}
              placeholder="e.g. Acme Corporation"
            />
            <p className="modal__hint">
              The name is trimmed and limited to 100 characters.
            </p>
          </div>
          <div className="modal__actions">
            <button
              type="button"
              className="modal__button modal__button--cancel"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="modal__button modal__button--save"
              disabled={loading || !name.trim()}
            >
              {loading ? "Creating…" : "Create workspace"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
