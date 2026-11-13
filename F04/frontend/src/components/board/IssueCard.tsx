/**
 * IssueCard.tsx
 *
 * Individual issue card on the board. Draggable via @dnd-kit (useDraggable +
 * useSortable). Keyboard-accessible: role="button", tabIndex={0}, and the
 * KeyboardSensor enables arrow-key reordering.
 */

import {
  useDraggable,
} from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import type { Issue } from "../../types/index";

interface IssueCardProps {
  issue: Issue;
  projectId: number;
  columnKey: string;
}

export function IssueCard({ issue, projectId, columnKey }: IssueCardProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: String(issue.id),
    data: { columnKey, projectId },
  });
  const {
    attributes: sortableAttributes,
    listeners: sortableListeners,
    setNodeRef: setSortableNodeRef,
    transform: sortableTransform,
  } = useSortable({
    id: String(issue.id),
    data: { columnKey },
  });

  const combinedRef = (node: HTMLElement | null) => {
    setNodeRef(node);
    setSortableNodeRef(node);
  };

  const style = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
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
      ref={combinedRef}
      className="issue-card"
      style={{
        ...style,
        ...sortableStyle,
      }}
      {...attributes}
      {...sortableAttributes}
      {...listeners}
      {...sortableListeners}
      role="button"
      tabIndex={0}
      aria-grabbable="true"
      aria-label={`Issue ${issue.number}: ${issue.title}`}
    >
      <div className="issue-card__drag-handle" aria-hidden="true">
        ⠇
      </div>
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
    </div>
  );
}
