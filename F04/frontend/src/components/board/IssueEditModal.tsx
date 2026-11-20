/**
 * IssueEditModal.tsx
 *
 * Modal dialog for editing an issue's title, description, and priority.
 * Submits via PATCH /api/v1/issues/{id}/update/ with optimistic locking (version).
 */

import { useState } from "react";
import { updateIssue } from "../../api/issues";
import type { Issue, IssuePriority } from "../../types/index";

interface IssueEditModalProps {
  issue: Issue;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updatedIssue: Issue) => void;
}

const PRIORITY_OPTIONS: Array<{ value: IssuePriority; label: string }> = [
  { value: "low", label: "Baixa" },
  { value: "medium", label: "Média" },
  { value: "high", label: "Alta" },
];

export function IssueEditModal({ issue, isOpen, onClose, onSave }: IssueEditModalProps) {
  const [title, setTitle] = useState(issue.title);
  const [description, setDescription] = useState(issue.description ?? "");
  const [priority, setPriority] = useState(issue.priority);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const updated = await updateIssue(issue.id, issue.version, {
        title,
        description,
        priority,
      });
      setSaving(false);
      onSave(updated);
    } catch (err: any) {
      setSaving(false);
      setError(err.message ?? "Failed to update issue");
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="issue-edit-modal__overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Edit issue"
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="issue-edit-modal__panel">
        <div className="issue-edit-modal__header">
          <h2 className="issue-edit-modal__title">Edit Issue #{issue.number}</h2>
          <button
            type="button"
            className="issue-edit-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="issue-edit-modal__form">
          <div className="issue-edit-modal__field">
            <label htmlFor="issue-title" className="issue-edit-modal__label">
              Title
            </label>
            <input
              id="issue-title"
              name="title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={200}
              className="issue-edit-modal__input"
              autoFocus
            />
          </div>

          <div className="issue-edit-modal__field">
            <label htmlFor="issue-description" className="issue-edit-modal__label">
              Description
            </label>
            <textarea
              id="issue-description"
              name="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="issue-edit-modal__textarea"
            />
          </div>

          <div className="issue-edit-modal__field">
            <label htmlFor="issue-priority" className="issue-edit-modal__label">
              Priority
            </label>
            <select
              id="issue-priority"
              name="priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as IssuePriority)}
              className="issue-edit-modal__select"
            >
              {PRIORITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <div className="issue-edit-modal__error" role="alert">
              {error}
            </div>
          )}

          <div className="issue-edit-modal__actions">
            <button type="button" className="issue-edit-modal__btn issue-edit-modal__btn--cancel" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="issue-edit-modal__btn issue-edit-modal__btn--save"
              disabled={saving}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
