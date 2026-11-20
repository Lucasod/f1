/**
 * Shared TypeScript types matching the Django REST API representations.
 *
 * Domain concepts use consistent English terminology (project rule).
 * Field names match the backend API payloads (snake_case).
 */

/** Authenticated user returned by GET /auth/me/ */
export interface User {
  id: number;
  username: string;
  display_name: string;
}

/** Membership of a user in a workspace */
export interface Membership {
  id: number;
  user: number;
  workspace: number;
  role: 'owner' | 'admin' | 'member';
}

/** A workspace (company isolation boundary) */
export interface Workspace {
  id: number;
  name: string;
  role: 'owner' | 'admin' | 'member';
  created_at?: string;
}

/** A workflow status / board column */
export interface WorkflowStatus {
  id: number;
  name: string;
  key: string; // e.g. 'to_do', 'in_progress', 'done'
  position: number;
}

/** A board belonging to a project */
export interface Board {
  id: number;
  name: string;
  key: string;
  project: number;
  workspace: number;
  workflow_statuses: WorkflowStatus[];
}

/** A project belonging to a workspace */
export interface Project {
  id: number;
  key: string;
  name: string;
  description?: string;
  // Populated by backend ProjectSerializer (serializers.py lines 71-72): workspace_name and board_exists
  // are derived/read-only fields not present in create/update payloads.
  workspace_id: number;
  workspace_name?: string;
  board_exists?: boolean;
  role?: string;
  created_at: string;
}

/** An issue on a board */
export interface Issue {
  id: number;
  number: number;
  title: string;
  // Omitted in list summaries per domain-api.md line 136; present only in detail responses.
  description?: string;
  priority: IssuePriority;
  status: string; // status key, e.g. 'to_do' / 'in_progress' / 'done'
  assignee_username?: string;
  reporter_username?: string;
  board_name?: string;
  board_key?: string;
  version: number;
  created_at: string;
  updated_at: string;
}

/** An issue priority. */
export type IssuePriority = 'low' | 'medium' | 'high';

/** Error envelope returned by the API: { error: { code, message, fields } } */
export interface ApiError {
  code: string;
  message: string;
  fields: Record<string, string>;
}

/** Paginated list envelope */
export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}
