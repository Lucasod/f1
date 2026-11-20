/**
 * ProjectCreateModal.tsx
 *
 * Modal dialog for creating a new project. Fields: name and key.
 * Key must match ^[A-Z][A-Z0-9]{1,9}$ (validated client-side before submit).
 * Calls POST /projects/create/ and notifies the parent on success.
 */

import { useState } from "react";
import { createProject } from "../../api/projects";
import type { Project } from "../../types/index";

const KEY_REGEX = /^[A-Z][A-Z0-9]{1,9}$/;

interface ProjectCreateModalProps {
  workspaceId: number | null;
  isOpen: boolean;
  onClose: () => void;
  onSave?: (project: Project) => void;
}

export function ProjectCreateModal({
  workspaceId,
  isOpen,
  onClose,
  onSave,
}: ProjectCreateModalProps) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [keyError, setKeyError] = useState("");

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setKeyError("");

    if (!name.trim()) {
      setError("Project name is required.");
      return;
    }
    const trimmedKey = key.trim().toUpperCase();
    if (!KEY_REGEX.test(trimmedKey)) {
      setKeyError(
        "Key must start with a letter and contain 1–10 uppercase alphanumeric characters (e.g. ABC)."
      );
      return;
    }
    if (!workspaceId) {
      setError("No workspace selected.");
      return;
    }

    setLoading(true);
    try {
      const project = await createProject(name.trim(), trimmedKey, workspaceId);
      setName("");
      setKey("");
      setLoading(false);
      if (onSave) onSave(project);
      onClose();
    } catch (err: any) {
      setError(err?.message ?? "Failed to create project.");
      // Surface field-level errors when returned by the API.
      if (err?.fields && err.fields.key) {
        setKeyError(err.fields.key);
      }
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="project-create-title">
      <div className="modal" aria-hidden={!isOpen}>
        <h2 id="project-create-title" className="modal__title">
          Create project
        </h2>
        {error && (
          <div className="modal__error" role="alert">{error}</div>
        )}
        <form onSubmit={handleSubmit} noValidate>
          <div className="modal__field">
            <label htmlFor="project-create-name">Project name</label>
            <input
              id="project-create-name"
              name="name"
              type="text"
              autoComplete="off"
              autoFocus
              required
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={loading}
              placeholder="e.g. Acme Website Redesign"
            />
          </div>
          <div className="modal__field">
            <label htmlFor="project-create-key">Project key</label>
            <input
              id="project-create-key"
              name="key"
              type="text"
              autoComplete="off"
              maxLength={10}
              required
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase())}
              disabled={loading}
              placeholder="e.g. AWR"
            />
            {keyError && (
              <p className="modal__hint modal__hint--error">{keyError}</p>
            )}
            <p className="modal__hint">
              Uppercase letters and digits, starting with a letter (1–10 chars).
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
              disabled={loading || !name.trim() || !KEY_REGEX.test(key.trim())}
            >
              {loading ? "Creating…" : "Create project"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
