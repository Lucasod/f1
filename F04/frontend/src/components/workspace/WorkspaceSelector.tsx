/**
 * WorkspaceSelector.tsx
 *
 * Persistent header dropdown for selecting the current workspace. Reads from
 * useWorkspace and updates both local state and localStorage selection.
 */

import { useWorkspace } from "../../hooks/useWorkspace";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import type { Workspace } from "../../types/index";

export function WorkspaceSelector() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    workspaces,
    currentWorkspace,
    selectWorkspace,
    loading,
  } = useWorkspace();

  if (loading && workspaces.length === 0) {
    return <span className="workspace-selector__placeholder">…</span>;
  }

  if (workspaces.length === 0) {
    return (
      <span className="workspace-selector__placeholder">
        No workspace selected
      </span>
    );
  }

  const routeId = Number(matchPath("/workspaces/:workspaceId/*", location.pathname)?.params.workspaceId);
  const selectedId = workspaces.some((workspace) => workspace.id === routeId) ? routeId : currentWorkspace?.id ?? "";

  const handleChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const id = Number(event.target.value);
    if (!isNaN(id)) {
      await selectWorkspace(id);
      const ws = workspaces.find((w) => w.id === id);
      if (ws) {
        navigate(`/workspaces/${ws.id}/projects`, { replace: true });
      }
    }
  };

  return (
    <div className="workspace-selector">
      <label
        htmlFor="workspace-selector"
        className="workspace-selector__label"
      >
        Workspace:
      </label>
      <select
        id="workspace-selector"
        className="workspace-selector__select"
        value={selectedId}
        onChange={handleChange}
        aria-label="Select workspace"
      >
        {workspaces.map((workspace: Workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name}
            {" · "}
            <span style={{ textTransform: "capitalize" }}>
              {workspace.role}
            </span>
          </option>
        ))}
      </select>
    </div>
  );
}
