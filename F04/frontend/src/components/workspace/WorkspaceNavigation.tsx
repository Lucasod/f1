import { useEffect, useState } from "react";
import { matchPath, NavLink, Navigate, useLocation, useParams } from "react-router-dom";
import { listProjects } from "../../api/projects";
import { useWorkspace } from "../../hooks/useWorkspace";
import type { Project } from "../../types/index";
import { LogoutButton } from "../auth/LogoutButton";
import { WorkspaceSelector } from "./WorkspaceSelector";

function useWorkspaceProjects(workspaceId: number | null, refresh?: string) {
  const [result, setResult] = useState<{
    workspaceId: number;
    projects: Project[];
    failed: boolean;
  } | null>(null);

  useEffect(() => {
    if (workspaceId === null) return;
    let active = true;
    listProjects().then(
      (projects) => { if (active) setResult({ workspaceId, projects: projects.filter((project) => project.workspace_id === workspaceId), failed: false }); },
      () => { if (active) setResult({ workspaceId, projects: [], failed: true }); },
    );
    return () => { active = false; };
  }, [workspaceId, refresh]);

  return result?.workspaceId === workspaceId ? result : null;
}

export function WorkspaceLanding() {
  const { workspaces, currentWorkspace, loading } = useWorkspace();
  const { workspaceId } = useParams();
  const workspace = workspaces.find((item) => item.id === Number(workspaceId)) ?? currentWorkspace ?? workspaces[0];
  const result = useWorkspaceProjects(workspace?.id ?? null);
  if (loading || (workspace && !result)) return <p className="page" role="status">Loading workspace…</p>;
  if (!workspace) return <Navigate to="/workspaces/manage" replace />;
  const projectsPath = `/workspaces/${workspace.id}/projects`;
  const project = result?.projects.find((item) => item.board_exists);
  return <Navigate to={project ? `${projectsPath}/${project.id}/board` : projectsPath} replace />;
}

export function WorkspaceNavigation() {
  const { workspaces, currentWorkspace, loading } = useWorkspace();
  const location = useLocation();
  const routeWorkspaceId = Number(matchPath("/workspaces/:workspaceId/*", location.pathname)?.params.workspaceId);
  const workspace = workspaces.find((item) => item.id === routeWorkspaceId) ?? currentWorkspace ?? workspaces[0];
  const projectsPath = workspace ? `/workspaces/${workspace.id}/projects` : null;
  const result = useWorkspaceProjects(loading ? null : (workspace?.id ?? null), location.key);
  const workspacePath = workspace ? `/workspaces/${workspace.id}` : null;

  return (
    <aside className="workspace-sidebar">
      <NavLink to="/workspaces" className="top-bar__brand">ProjectBoard</NavLink>
      <nav aria-label="Workspace navigation">
        <WorkspaceSelector />
        {projectsPath && (
          <div className="workspace-sidebar__group">
            <h2>Boards</h2>
            {result?.projects.map((project) => (
              <NavLink key={project.id} to={`${projectsPath}/${project.id}/board`}>
                <span className="workspace-sidebar__key" aria-hidden="true">{project.key}</span>
                <span>{project.name}</span>
              </NavLink>
            ))}
            {result?.failed && <p>Could not load boards.</p>}
            {result && !result.failed && result.projects.length === 0 && <p>No boards yet.</p>}
            <NavLink to={projectsPath} end>Manage projects</NavLink>
          </div>
        )}
        {workspacePath && (
          <div className="workspace-sidebar__group">
            <h2>Workspace</h2>
            <NavLink to={`${workspacePath}/notifications`}>Notifications</NavLink>
            <NavLink to={`${workspacePath}/reports`}>Reports</NavLink>
            <NavLink to={`${workspacePath}/webhooks`}>Webhooks</NavLink>
            <NavLink to={`${workspacePath}/billing`}>Billing</NavLink>
          </div>
        )}
        <NavLink to="/workspaces/manage">Manage workspaces</NavLink>
      </nav>
      <LogoutButton />
    </aside>
  );
}
