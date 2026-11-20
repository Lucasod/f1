/**
 * Column.tsx
 *
 * A single workflow column on the board. Uses a dnd-kit SortableContext so
 * issues can be dragged within the column and dropped into other columns.
 * Renders each issue as an IssueCard.
 */

import { useDroppable } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import type { Issue } from "../../types/index";
import { IssueCard } from "./IssueCard";

interface ColumnProps {
  column: { key: string; name: string; issues: Issue[] };
  projectId: number;
  onIssueUpdated?: (updatedIssue: Issue) => void;
}

export function Column({ column, projectId, onIssueUpdated }: ColumnProps) {
  const { setNodeRef } = useDroppable({ id: column.key });
  return (
    <section className="board-column" aria-label={column.name}>
      <div className="board-column__header">
        <h3 className="board-column__title">{column.name}</h3>
        <span className="board-column__count">{column.issues.length}</span>
      </div>
      <div className="board-column__body" ref={setNodeRef} style={{ minHeight: 80 }}>
        <SortableContext
          items={column.issues.map((issue) => String(issue.id))}
        >
          {column.issues.map((issue) => (
            <IssueCard
              key={issue.id}
              issue={issue}
              projectId={projectId}
              columnKey={column.key}
              onIssueUpdated={onIssueUpdated}
            />
          ))}
        </SortableContext>
      </div>
    </section>
  );
}