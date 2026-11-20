/**
 * Project API functions.
 * Wraps POST /projects/create/, GET /projects/, GET /projects/{id}/.
 *
 * Response shapes (from the live backend):
 *   POST /projects/create/ -> { error, project: Project }
 *   GET /projects/         -> { error, results: [Project] }
 *   GET /projects/{id}/    -> { error, project: Project }
 *
 * Note: the project payload does NOT include a nested board object or a
 * workspace id; it carries workspace_name and board_exists instead.
 */

import { request } from "./client";
import type { Project } from "../types/index";

/**
 * POST /projects/create/ - create a new project in the current workspace.
 * Body: { name, key }. Key must match ^[A-Z][A-Z0-9]{1,9}$.
 * Returns the created project.
 */
export async function createProject(name: string, key: string, workspaceId: number): Promise<Project> {
  const data = await request<{ project: Project }>("/projects/create/", {
    method: "POST",
    body: JSON.stringify({ name, key, workspace_id: workspaceId }),
  });
  return data.project;
}

/** GET /projects/ - list of projects in the user's workspaces. */
export async function listProjects(): Promise<Project[]> {
  const data = await request<{ results: Project[] }>("/projects/");
  return data?.results ?? [];
}

/** GET /projects/{id}/ - project detail (404 if not a member of its workspace). */
export async function getProject(id: string | number): Promise<Project> {
  const data = await request<{ project: Project }>(`/projects/${id}/`);
  return data.project;
}
