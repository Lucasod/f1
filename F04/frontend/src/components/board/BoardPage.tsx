/**
 * BoardPage.tsx
 *
 * Main Kanban board view. Groups issues by workflow status (columns) and
 * supports drag-and-drop issue movement via @dnd-kit.
 *
 * On drop, the issue is transitioned via POST /issues/{id}/transitions/.
 * The move is applied optimistically and rolled back if the API rejects it.
 *
 * The backend exposes no dedicated workflow-statuses endpoint, so the board
 * uses the standard MVP columns (To do / In progress / Done) that match the
 * backend's initial WorkflowStatus values.
 */

import { useState, useEffect, useCallback } from "react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { resolveDropTarget } from "./resolveDropTarget";
import { useIssues } from "../../hooks/useIssues";
import { listIssues } from "../../api/issues";
import { Column } from "./Column";
import { IssueCreateModal } from "./IssueCreateModal";
import { EmptyState } from "../shared/EmptyState";
import { LoadingSpinner } from "../shared/LoadingSpinner";
import type { Issue } from "../../types/index";

/** Standard MVP workflow columns, matching the backend's initial statuses. */
const COLUMNS: Array<{ key: string; name: string }> = [
  { key: "to_do", name: "To do" },
  { key: "in_progress", name: "In progress" },
  { key: "done", name: "Done" },
];

interface BoardPageProps {
  projectId: number | null;
}

export function BoardPage({ projectId }: BoardPageProps) {
  const { issues, loading, transitionIssue } = useIssues();
  const [columns, setColumns] = useState<
    Array<{ key: string; name: string; issues: Issue[] }>
  >([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);

  const sensors = useSensors(
    { sensor: PointerSensor, options: {} },
    { sensor: KeyboardSensor, options: { coordinateGetter: sortableKeyboardCoordinates } }
  );

  // Group issues into columns whenever the issue list changes.
  const groupIssues = useCallback(
    (list: Issue[]) => {
      const byKey = new Map(
        COLUMNS.map((c) => [c.key, [] as Issue[]])
      );
      list.forEach((issue) => {
        const bucket = byKey.get(issue.status);
        if (bucket) bucket.push(issue);
      });
      setColumns((prev) =>
        prev.map((c) => ({ ...c, issues: byKey.get(c.key) ?? [] }))
      );
    },
    []
  );

  // Initialize the standard columns on mount.
  useEffect(() => {
    setColumns(
      COLUMNS.map((c) => ({ key: c.key, name: c.name, issues: [] as Issue[] }))
    );
  }, []);

  // Load issues for the project whenever the project or filters change.
  useEffect(() => {
    if (!projectId) {
      setColumns(
        COLUMNS.map((c) => ({ key: c.key, name: c.name, issues: [] as Issue[] }))
      );
      setBoardError(null);
      return;
    }
    let mounted = true;
    setBoardError(null);
    listIssues({ project_id: String(projectId) })
      .then((data) => {
        if (!mounted) return;
        groupIssues(data);
      })
      .catch((err: any) => {
        if (!mounted) return;
        setBoardError(err?.message ?? "Failed to load board");
      });
    return () => {
      mounted = false;
    };
  }, [projectId]);

  const handleIssueUpdated = useCallback((updatedIssue: Issue) => {
    setColumns((previous) => previous.map((column) => ({
      ...column,
      issues: column.issues.map((issue) => issue.id === updatedIssue.id ? updatedIssue : issue),
    })));
  }, []);

  // Re-group when issues arrive from fetchIssues (used after mutations).
  useEffect(() => {
    if (issues.length > 0) groupIssues(issues);
  }, [issues, groupIssues]);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over) return; // dropped outside a column -> no-op

      const activeId = active.id as string;
      const targetKey = resolveDropTarget(over.id, over.data.current?.columnKey, COLUMNS.map((column) => column.key));
      if (!targetKey) return;

      const sourceColumn = columns.find((c) =>
        c.issues.some((i) => String(i.id) === activeId)
      );
      const issue = sourceColumn?.issues.find((i) => String(i.id) === activeId);
      if (!issue || sourceColumn?.key === targetKey) return;

      // Optimistic move.
      setColumns((prev) =>
        prev.map((c) =>
          c.key === sourceColumn!.key
            ? {
                ...c,
                issues: c.issues.filter((i) => String(i.id) !== activeId),
              }
            : c.key === targetKey
              ? { ...c, issues: [...c.issues, issue] }
              : c
        )
      );

      try {
        const updated = await transitionIssue(issue.id, targetKey);
        if (!updated) throw new Error("Failed to move issue. Change reverted.");
        setColumns((previous) => previous.map((column) => ({
          ...column,
          issues: column.issues.map((item) => item.id === updated.id ? updated : item),
        })));
      } catch (err: any) {
        // Roll back the optimistic move.
        setColumns((prev) =>
          prev.map((c) => {
            if (c.key === sourceColumn!.key) {
              return {
                ...c,
                issues: [...c.issues, issue].sort((a, b) => a.number - b.number),
              };
            }
            if (c.key === targetKey) {
              return { ...c, issues: c.issues.filter((i) => String(i.id) !== activeId) };
            }
            return c;
          })
        );
        setBoardError(
          err?.message ?? "Failed to move issue. Change reverted."
        );
      }
    },
    [columns, projectId, transitionIssue, listIssues, groupIssues]
  );

  if (!projectId) {
    return (
      <div className="board-page">
        <EmptyState
          title="Select a project"
          message="Open a project from the project list to view its board."
          icon="🗂️"
        />
      </div>
    );
  }

  if (loading && columns.length === 0) {
    return <LoadingSpinner label="Loading board…" />;
  }


  const statuses = COLUMNS;

  return (
    <div className="board-page">
      {boardError && <div className="board-page__error" role="alert">{boardError}</div>}
      <div className="board-page__header">
        <h2 className="board-page__title">Board</h2>
        <button
          className="board-page__create"
          onClick={() => setCreateOpen(true)}
          type="button"
        >
          + Create issue
        </button>
      </div>

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="board-page__columns">
          {columns.map((column) => (
            <SortableContext
              key={column.key}
              items={column.issues.map((issue) => String(issue.id))}
            >
              <Column
                key={column.key}
                column={column}
                projectId={projectId!}
                onIssueUpdated={handleIssueUpdated}
              />
            </SortableContext>
          ))}
          {columns.length === 0 && (
            <EmptyState
              title="No workflow statuses"
              message="This board has no columns yet."
              icon="🚫"
            />
          )}
        </div>
      </DndContext>

      <IssueCreateModal
        projectId={projectId!}
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onSave={() => {
          setCreateOpen(false);
          if (projectId) {
            listIssues({ project_id: String(projectId) }).then(groupIssues);
          }
        }}
        statuses={statuses}
      />
    </div>
  );
}

export default BoardPage;