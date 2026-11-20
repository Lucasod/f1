/**
 * IssueCreateModal.tsx
 *
 * Modal dialog for creating a new issue. Fields: title, description, priority,
 * and status (chosen from the board's workflow statuses). Calls
 * POST /projects/{projectId}/issues/ and notifies the parent on success.
 */

import { useState } from "react";
import { createIssue } from "../../api/issues";
import type { IssuePriority } from "../../types/index";

interface StatusOption {
  key: string;
  name: string;
}

interface IssueCreateModalProps {
  projectId: number;
  isOpen: boolean;
  onClose: () => void;
  onSave?: () => void;
  statuses: StatusOption[];
}

export function IssueCreateModal({
  projectId,
  isOpen,
  onClose,
  onSave,
  statuses,
}: IssueCreateModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<IssuePriority>("medium");
  const [status, setStatus] = useState<string>(
    statuses.length ? statuses[0].key : ""
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (!title.trim()) {
      setError("Issue title is required.");
      return;
    }
    if (!status) {
      setError("Please select a status.");
      return;
    }

    setLoading(true);
    try {
      await createIssue(projectId, {
        title: title.trim(),
        description,
        priority,
        status,
      });
      setTitle("");
      setDescription("");
      setPriority("medium");
      setStatus(statuses.length ? statuses[0].key : "");
      if (onSave) onSave();
      onClose();
    } catch (err: any) {
      setError(err?.message ?? "Failed to create issue.");
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="issue-create-title">
      <div className="modal" aria-hidden={!isOpen}>
        <h2 id="issue-create-title" className="modal__title">Create issue</h2>
        {error && <div className="modal__error" role="alert">{error}</div>}
        <form onSubmit={handleSubmit} noValidate>
          <div className="modal__field">
            <label htmlFor="issue-create-title">Title</label>
            <input
              id="issue-create-title"
              name="title"
              type="text"
              autoComplete="off"
              autoFocus
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={loading}
            />
          </div>
          <div className="modal__field">
            <label htmlFor="issue-create-description">Description</label>
            <textarea
              id="issue-create-description"
              name="description"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={loading}
              placeholder="Describe the issue…"
            />
          </div>
          <div className="modal__field modal__field--row">
            <div className="modal__subfield">
              <label htmlFor="issue-create-priority">Priority</label>
              <select
                id="issue-create-priority"
                name="priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as IssuePriority)}
                disabled={loading}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div className="modal__subfield">
              <label htmlFor="issue-create-status">Status</label>
              <select
                id="issue-create-status"
                name="status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                disabled={loading}
              >
                {statuses.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
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
              disabled={loading || !title.trim() || !status}
            >
              {loading ? "Creating…" : "Create issue"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
