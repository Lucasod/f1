/**
 * WorkspaceList.tsx
 *
 * Lists the user's accessible workspaces as cards. Each card can be selected
 * to open that workspace's projects. Provides an "Add workspace" action.
 */

import { useNavigate } from "react-router-dom";
import { useWorkspace } from "../../hooks/useWorkspace";
import { EmptyState } from "../shared/EmptyState";
import { LoadingSpinner } from "../shared/LoadingSpinner";
import type { Workspace } from "../../types/index";

interface WorkspaceListProps {
  onCreate?: () => void;
}

export function WorkspaceList({ onCreate }: WorkspaceListProps = {}) {
  const navigate = useNavigate();
  const {
    workspaces,
    currentWorkspace,
    loading,
    selectWorkspace,
  } = useWorkspace();
  const handleSelect = async (workspace: Workspace) => {
    await selectWorkspace(workspace.id);
    navigate(`/workspaces/${workspace.id}/projects`, { replace: true });
  };

  if (loading && workspaces.length === 0) {
    return <LoadingSpinner label="Loading workspaces…" />;
  }

  if (workspaces.length === 0) {
    return (
      <div className="workspace-list">
        <EmptyState
          title="No workspaces yet"
          message="Create a workspace to get started."
          actionLabel="Create workspace"
          onAction={onCreate}
          icon="🏢"
        />
      </div>
    );
  }

  return (
    <div className="workspace-list">
      <h2 className="workspace-list__title">Workspaces</h2>
      <ul className="workspace-list__list" role="list">
        {workspaces.map((workspace) => {
          const isCurrent = currentWorkspace?.id === workspace.id;
          return (
            <li key={workspace.id} className="workspace-list__item">
              <button
                className={`workspace-list__card${isCurrent ? " workspace-list__card--current" : ""}`}
                onClick={() => handleSelect(workspace)}
                type="button"
                aria-pressed={isCurrent}
              >
                <span className="workspace-list__name">{workspace.name}</span>
                <span className="workspace-list__role">
                  {workspace.role.charAt(0).toUpperCase() +
                    workspace.role.slice(1)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="workspace-list__actions">
        <button className="workspace-list__add" onClick={onCreate} type="button">+ Create workspace</button>
      </div>
    </div>
  );
}
