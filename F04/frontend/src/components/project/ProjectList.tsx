/**
 * ProjectList.tsx
 *
 * Lists the projects of the current workspace. Each project links to its
 * board. Project creation is handled by ProjectCreateModal.
 */

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspace } from "../../hooks/useWorkspace";
import { listProjects } from "../../api/projects";
import { EmptyState } from "../shared/EmptyState";
import { LoadingSpinner } from "../shared/LoadingSpinner";
import type { Project } from "../../types/index";

interface ProjectListProps {
  workspaceId?: number | null;
  onCreate?: () => void;
}

export function ProjectList({
  workspaceId = null,
  onCreate,
}: ProjectListProps = {}) {
  const navigate = useNavigate();
  const { workspaces } = useWorkspace();
  const currentWorkspace = workspaces.find((workspace) => workspace.id === workspaceId);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) {
      setProjects([]);
      return;
    }
    let mounted = true;
    setLoading(true);
    setError(null);
    listProjects()
      .then((data) => {
        if (!mounted) return;
        setProjects(Array.isArray(data) ? data.filter((project) => project.workspace_id === workspaceId) : []);
      })
      .catch((err: any) => {
        if (!mounted) return;
        setError(err?.message ?? "Failed to load projects");
        setProjects([]);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [workspaceId]);

  const handleOpenBoard = (project: Project) => {
    // workspaceId is known from the route / current workspace selection.
    const wsId = workspaceId;
    if (wsId == null) return;
    navigate(`/workspaces/${wsId}/projects/${project.id}/board`, {
      replace: true,
    });
  };

  return (
    <div className="project-list">
      <h2 className="project-list__title">
        {currentWorkspace ? `Projects — ${currentWorkspace.name}` : "Projects"}
      </h2>
      {!workspaceId ? (
        <EmptyState
          title="Select a workspace"
          message="Choose a workspace from the selector to see its projects."
          icon="🧭"
        />
      ) : loading ? (
        <LoadingSpinner label="Loading projects…" />
      ) : error ? (
        <div className="project-list__error" role="alert">{error}</div>
      ) : projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          message="Create a project to start tracking issues."
          actionLabel="Create project"
          onAction={() => onCreate?.()}
          icon="📁"
        />
      ) : (
        <>
        <button type="button" onClick={onCreate}>Create project</button>
        <ul className="project-list__list" role="list">
          {projects.map((project) => (
            <li key={project.id} className="project-list__item">
              <button
                className="project-list__card"
                onClick={() => handleOpenBoard(project)}
                type="button"
              >
                <span className="project-list__key">{project.key}</span>
                <span className="project-list__name">{project.name}</span>
              </button>
            </li>
          ))}
        </ul>
        </>
      )}
    </div>
  );
}
