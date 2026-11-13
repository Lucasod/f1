/**
 * WorkspaceList.tsx
 *
 * Lists the user's accessible workspaces as cards. Each card can be selected
 * to open that workspace's projects. Provides an "Add workspace" action.
 */

import { useState } from "react";
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
    createWorkspace,
  } = useWorkspace();
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");

  const handleSelect = async (workspace: Workspace) => {
    await selectWorkspace(workspace.id);
    navigate(`/workspaces/${workspace.id}/projects`, { replace: true });
  };

  const handleCreateSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!createName.trim()) return;
    setCreating(true);
    try {
      const ws = await createWorkspace(createName.trim());
      setCreateName("");
      await selectWorkspace(ws.id);
      navigate(`/workspaces/${ws.id}/projects`, { replace: true });
      if (onCreate) onCreate();
    } catch {
      // Error surfaced by the hook/UI; keep modal open.
    } finally {
      setCreating(false);
    }
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
          onAction={() => {
            document
              .getElementById("workspace-create-name")
              ?.focus();
          }}
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
        <button
          className="workspace-list__add"
          onClick={() => {
            setCreating(true);
            setTimeout(() => {
              const el = document.getElementById("workspace-create-name");
              el?.focus();
            }, 50);
          }}
          type="button"
          aria-expanded={creating}
        >
          + Create workspace
        </button>
      </div>
      {creating && (
        <form
          className="workspace-list__create-form"
          onSubmit={handleCreateSubmit}
          noValidate
        >
          <input
            id="workspace-create-name"
            name="name"
            type="text"
            placeholder="Workspace name"
            autoFocus
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            required
            maxLength={100}
            disabled={creating}
          />
          <button
            type="submit"
            className="workspace-list__create-submit"
            disabled={creating || !createName.trim()}
          >
            {creating ? "Creating…" : "Create"}
          </button>
          <button
            type="button"
            className="workspace-list__create-cancel"
            onClick={() => setCreating(false)}
          >
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}
