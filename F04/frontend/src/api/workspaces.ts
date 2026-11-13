/**
 * Workspace API functions.
 * Wraps GET /workspaces/, POST /workspaces/create/, GET /workspaces/{id}/.
 *
 * Response shapes (from the live backend):
 *   GET /workspaces/        -> { error, results: [Workspace] }
 *   POST /workspaces/create/ -> { error, workspace: Workspace }
 *   GET /workspaces/{id}/   -> { error, workspace: Workspace }
 */

import { request } from "./client";
import type { Workspace } from "../types/index";

/** GET /workspaces/ - list of workspaces the user is a member of. */
export async function listWorkspaces(): Promise<Workspace[]> {
  const data = await request<{ results: Workspace[] }>("/workspaces/");
  return data?.results ?? [];
}

/**
 * POST /workspaces/create/ - create a new workspace.
 * Body: { name }. Returns the created workspace with the caller's role.
 */
export async function createWorkspace(name: string): Promise<Workspace> {
  const data = await request<{ workspace: Workspace }>("/workspaces/create/", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  return data.workspace;
}

/** GET /workspaces/{id}/ - workspace detail (404 if not a member). */
export async function getWorkspace(id: string | number): Promise<Workspace> {
  const data = await request<{ workspace: Workspace }>(`/workspaces/${id}/`);
  return data.workspace;
}
