/**
 * Issue API functions.
 * Wraps GET /issues/, POST /projects/{id}/issues/, PATCH /issues/{id}/update/,
 * POST /issues/{id}/transitions/.
 *
 * Response shapes (from the live backend):
 *   GET /issues/                  -> { count, next, previous, results: { error, results: [Issue] } }
 *   POST /projects/{id}/issues/   -> { error, issue: Issue }
 *   PATCH /issues/{id}/update/    -> { error, issue: Issue }
 *   POST /issues/{id}/transitions/-> { error, issue: Issue }
 *
 * Note: issue.status is a status key string (e.g. 'to_do'), not an object.
 */

import { request } from "./client";
import type { Issue, IssuePriority } from "../types/index";

/**
 * GET /issues/ - paginated list of issues with optional filters.
 * Filters: project_id, status, priority, assignee.
 */
export async function listIssues(
  filters?: Record<string, string>
): Promise<Issue[]> {
  let url = "/issues/";
  if (filters) {
    const params = new URLSearchParams(filters);
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }
  const data = await request<any>(url);
  // The /issues/ endpoint nests the array under results.results; be defensive.
  const outer = data?.results;
  const list = Array.isArray(outer) ? outer : outer?.results ?? [];
  return list;
}

/**
 * POST /projects/{project_id}/issues/ - create a new issue.
 * Body: { title, description, priority, status }.
 */
export async function createIssue(
  projectId: string | number,
  data: { title: string; description: string; priority: IssuePriority; status: string }
): Promise<Issue> {
  const resp = await request<{ issue: Issue }>(`/projects/${projectId}/issues/`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  return resp.issue;
}

/**
 * PATCH /issues/{issue_id}/update/ - update an issue (optimistic locking via version).
 * Body: { version, ...data }.
 */
export async function updateIssue(
  issueId: string | number,
  version: number,
  data: Record<string, any>
): Promise<Issue> {
  const resp = await request<{ issue: Issue }>(`/issues/${issueId}/update/`, {
    method: "PATCH",
    body: JSON.stringify({ version, ...data }),
  });
  return resp.issue;
}

/**
 * POST /issues/{issue_id}/transitions/ - transition an issue to a new status.
 * Body: { status }. Validates the directed transition flow.
 */
export async function transitionIssue(
  issueId: string | number,
  status: string
): Promise<Issue> {
  const resp = await request<{ issue: Issue }>(`/issues/${issueId}/transitions/`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
  return resp.issue;
}
