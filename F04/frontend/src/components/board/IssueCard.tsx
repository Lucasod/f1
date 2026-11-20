/**
 * IssueCard.tsx
 *
 * Individual issue card on the board. Draggable via @dnd-kit (useDraggable +
 * useSortable). Keyboard-accessible: role="button", tabIndex={0}, and the
 * KeyboardSensor enables arrow-key reordering.
 */

import { useSortable } from "@dnd-kit/sortable";
import { useState } from "react";
import type { Issue } from "../../types/index";
import { IssueEditModal } from "./IssueEditModal";

interface IssueCardProps {
  issue: Issue;
  projectId: number;
  columnKey: string;
  onIssueUpdated?: (updatedIssue: Issue) => void;
}

export function IssueCard({ issue, columnKey, onIssueUpdated }: IssueCardProps) {
  const {
    attributes: sortableAttributes,
    listeners: sortableListeners,
    setNodeRef: setSortableNodeRef,
    transform: sortableTransform,
  } = useSortable({
    id: String(issue.id),
    data: { columnKey },
  });

  const [isEditOpen, setIsEditOpen] = useState(false);

  const handleEditOpen = () => setIsEditOpen(true);
  const handleEditClose = () => setIsEditOpen(false);
  const handleIssueUpdated = (updatedIssue: Issue) => {
    setIsEditOpen(false);
    onIssueUpdated?.(updatedIssue);
  };

  const sortableStyle = {
    transform: sortableTransform
      ? `translate3d(${sortableTransform.x}px, ${sortableTransform.y}px, 0)`
      : undefined,
  };

  const priorityLabel =
    issue.priority.charAt(0).toUpperCase() + issue.priority.slice(1);

  return (
    <div
      ref={setSortableNodeRef}
      className="issue-card"
      style={{
        ...sortableStyle,
      }}
      {...sortableAttributes}
      {...sortableListeners}
      role="button"
      tabIndex={0}
      aria-grabbable="true"
      aria-label={`Issue ${issue.number}: ${issue.title}`}
    >
      <div className="issue-card__drag-handle" aria-hidden="true">
        ⠇
      </div>
      <button
        type="button"
        className="issue-card__edit"
        style={{
          position: "absolute",
          top: "0.5rem",
          right: "0.5rem",
          display: "grid",
          placeItems: "center",
          width: "1.5rem",
          height: "1.5rem",
          background: "transparent",
          border: "none",
          color: "var(--muted)",
          cursor: "pointer",
          fontSize: "1.125rem",
          lineHeight: 1,
          padding: 0,
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        onClick={handleEditOpen}
        aria-label={`Edit issue ${issue.number}`}
      >
        ⋮
      </button>
      <div className="issue-card__content">
        <span className="issue-card__number">#{issue.number}</span>
        <h4 className="issue-card__title">{issue.title}</h4>
        {issue.description && (
          <p className="issue-card__description">
            {issue.description.slice(0, 120)}
            {issue.description.length > 120 ? "…" : null}
          </p>
        )}
        <div className="issue-card__meta">
          <span
            className={`issue-card__badge issue-card__badge--priority`}
            data-priority={issue.priority}
          >
            {priorityLabel}
          </span>
          <span className="issue-card__badge issue-card__badge--status">
          {issue.status.charAt(0).toUpperCase() + issue.status.slice(1).replace(/_/g, " ")}
        </span>
        </div>
      </div>
      {isEditOpen && <IssueEditModal
        issue={issue}
        isOpen={isEditOpen}
        onClose={handleEditClose}
        onSave={handleIssueUpdated}
      />}
    </div>
  );
}
