# Implementation Plan — MP-F04-009: React Frontend for FS-04 Marketplace

## 1. Directory Structure under `frontend/`

Create the following directory layout under `frontend/`. All paths are relative to `/home/workstation/source/f1/F04/frontend/`.

```
frontend/
├─ src/
│  ├─ components/
│  │  ├─ auth/
│  │  │  ├─ LoginForm.tsx        # Login form with username/password
│  │  │  └─ LogoutButton.tsx      # Logout button (visible when authenticated)
│  │  ├─ workspace/
│  │  │  ├─ WorkspaceList.tsx    # List of accessible workspaces
│  │  │  ├─ WorkspaceSelector.tsx# Dropdown/selector for current workspace
│  │  │  └─ WorkspaceCreateModal.tsx # Modal for creating a new workspace
│  │  ├─ project/
│  │  │  ├─ ProjectList.tsx      # List of projects in current workspace
│  │  │  ├─ ProjectCreateModal.tsx# Modal for creating a new project
│  │  │  └─ BoardGate.tsx        # Protected route / gate to board view
│  │  ├─ board/
│  │  │  ├─ BoardPage.tsx        # Main board view with columns and issues
│  │  │  ├─ Column.tsx           # Workflow column (To do, In progress, Done)
│  │  │  ├─ IssueCard.tsx         # Issue card with drag handle
│  │  │  ├─ IssueCreateModal.tsx  # Modal for creating a new issue
│  │  │  └─ WorkflowConfigModal.tsx # Modal for configuring workflow statuses
│  │  └─ shared/
│  │     ├─ LoadingSpinner.tsx   # Spinner for loading state
│  │     ├─ EmptyState.tsx        # Message when no data is available
│  │     └─ ErrorBoundary.tsx    # Global error handling boundary
│  │
│  ├─ hooks/
│  │  ├─ useAuth.ts              # Authentication state & session management
│  │  ├─ useWorkspace.ts          # Workspace selection & context
│  │  └─ useIssues.ts            # Issue fetch/create/update logic
│  │
│  ├─ stores/
│  │  └─ rootStore.ts            # Global state (Jotai or React Context)
│  │
│  ├─ api/
│  │  ├─ client.ts                # API client with CSRF/bootstrap logic
│  │  ├─ auth.ts                  # Login/logout/me endpoints
│  │  ├─ workspaces.ts            # Workspace CRUD endpoints
│  │  ├─ projects.ts              # Project CRUD + board endpoints
│  │  └─ issues.ts                # Issue CRUD + transition endpoints
│  │
│  ├─ types/
│  │  ├─ index.ts                  # Shared TypeScript types (User, Workspace, Project, Issue, etc.)
│  │  ├─ auth.ts                    # Auth-related types
│  │  ├─ workspace.ts              # Workspace-related types
│  │  ├─ project.ts                # Project-related types
│  │  └─ issue.ts                  # Issue-related types
│  │
│  └─ index.tsx                   # React entry point, Router setup
│
├─ public/
│  └─ favicon.ico
│
├─ .env.example                   # Example env vars (no real secrets)
└─ package.json                   # Will be updated with React dependencies
```

> **Note:** Directories are created "just-in-time" as components are added. The structure above is the full planned layout; the code-delegate system will create files as needed.

---

## 2. Key React Components Needed

| Component | Purpose | Key Props/State |
|-----------|---------|-----------------|
| `LoginForm.tsx` | Form for username/password login. On submit: bootstrap CSRF, POST login, store session CSRF. | `username`, `password`, `loading`, `error` |
| `LogoutButton.tsx` | Visible when user is authenticated. On click: POST /logout, clear local state, redirect to login. | `onLogout` callback |
| `WorkspaceList.tsx` | Fetch `/workspaces/` and display indexable cards. Shows workspace name + user's role. | `workspaces[]`, `onSelect`, `onCreate` |
| `WorkspaceSelector.tsx` | Persistent selector (header dropdown) for the current workspace. Reads from `useWorkspace` store. | `onChange` |
| `WorkspaceCreateModal.tsx` | Modal with input field, calls `POST /workspaces/create/`. On success: refresh workspace list. | `name` input, `onSave` |
| `ProjectList.tsx` | Fetch `/projects/` for current workspace. Displays project name/key + board status. | `projects[]`, `onCreate` |
| `ProjectCreateModal.tsx` | Modal with name + key fields, calls `POST /projects/create/`. Validates key format `^[A-Z][A-Z0-9]{1,9}$`. | `name`, `key`, `onSave` |
| `BoardPage.tsx` | Main view showing the board with columns and issue cards. Protected — requires workspace selection + membership. | `workspaceId`, `board`, `columns[]`, `issues[]` |
| `Column.tsx` | Draggable container for issues in a workflow status (To do / In progress / Done). Uses drag-and-drop library. | `title` (status name), `issues[]`, `onIssueMove` |
| `IssueCard.tsx` | Individual issue card with title, description snippet, status badge, assignee badge. Has drag handle for movement. | `issue`, `onDragStart`, `onDragEnd` |
| `IssueCreateModal.tsx` | Modal with title + description + priority + status selector. Calls `POST /projects/{id}/issues/`. | `title`, `description`, `priority`, `statusName`, `onSave` |
| `WorkflowConfigModal.tsx` | Modal for owners/admins to reorder/add workflow statuses per board. Calls `PATCH /issues/{id}/transitions/` logic area. | Current statuses, `onSave` |
| `LoadingSpinner.tsx` | Simple spinner component for async states. | `visible` |
| `EmptyState.tsx` | Text + illustration for when workspace/project/issue list is empty. | `message` |
| `ErrorBoundary.tsx` | React.ErrorBoundary to catch JS errors and display fallback UI with "Retry" button. | `hasError`, `error`, `errorInfo` |
| `useAuth.ts` | Hook: checks `GET /auth/me()`, handles session expiry, stores user in context. | `user`, `isAuthenticated`, `login`, `logout` |
| `useWorkspace.ts` | Hook: selects workspace, persists selection in localStorage/sessionStorage, re-fetches workspace-scoped data on change. | `workspaceId`, `role`, `onSelect`, `onLeave` |
| `useIssues.ts` | Hook: fetches `/issues/` with filters (project_id, status, priority), handles create/update/transition mutations. | `issues`, `loading`, `createIssue`, `updateIssue`, `transitionIssue` |
| `rootStore.ts` | Optional Jotai/Redux store if global state needed beyond hooks. | — |
| `api/client.ts** | Centralized API client with `withCredentials: true`, automatic CSRF token extraction from cookies, and `X-CSRFToken` header injection for unsafe requests. | — |
| `api/auth.ts` | Wrapper: `GET /auth/csrf/` (bootstrap), `POST /auth/login/`, `POST /auth/logout/`, `GET /auth/me/`. | — |
| `api/workspaces.ts` | Wrappers: `GET /workspaces/`, `POST /workspaces/create/`, `GET /workspaces/{id}/`. | — |
| `api/projects.ts` | Wrappers: `POST /projects/create/`, `GET /projects/`, `GET /projects/{id}/`, `PATCH /projects/{id}/`. | — |
| `api/issues.ts` | Wrappers: `GET /issues/`, `POST /projects/{id}/issues/`, `PATCH /issues/{id}/update/`, `POST /issues/{id}/transitions/`. | — |
| `types/index.ts` | Shared TypeScript interfaces matching API representations (User, Workspace, Project, Board, Issue, WorkflowStatus, Membership). | — |
| `types/auth.ts` | `interface User { id: number; username: string; display_name: string }` | — |
| `types/workspace.ts` | `interface Workspace { id: number; name: string; role: 'owner' | 'admin' | 'member' }` | — |
| `types/project.ts` | `interface Project { id: number; key: string; name: string; board: Board }` | — |
| `types/issue.ts` | `interface Issue { id: number; number: number; title: string; description?: string; status: WorkflowStatus; priority: 'low' | 'medium' | 'high'; assignee?: User; sprint?: Sprint }` | — |

---

## 3. Integration Points with Django REST API

### 3.1 Authentication & CSRF

| Action | Endpoint | Method | Frontend Flow |
|--------|----------|--------|----------------|
| Bootstrap CSRF | `GET /api/v1/auth/csrf/` | GET | On app startup and before every unsafe request session. Extract `csrf_token` from response body. Set it as a local variable and also set it as an HTTP-only cookie placeholder (the server sets the real cookie via Django session). |
| Login | `POST /api/v1/auth/login/` | POST | 1. Fetch CSRF token from `/auth/csrf/`. 2. POST `{username, password}` with `X-CSRFToken` header. 3. On 200: session cookie (`sessionid`) is set by Django; store the returned CSRF token for subsequent requests (it rotates after login). 4. Redirect to workspace selector or board page. |
| Logout | `POST /api/v1/auth/logout/` | POST | POST with `X-CSRFToken` header (or rely on session cookie + CSRF). On 204: clear user state, redirect to login. |
| Get current user | `GET /api/v1/auth/me/` | GET | Include session cookies (`withCredentials: true`). On 200: update user state in auth store/h context. On 401/403: clear user state, redirect to login. |
| Refresh CSRF after login | The server rotates the CSRF token after login. The `login` view sets `X-CSRFToken` response header. The frontend should capture this header on the login response and use the new token for subsequent requests. | — | In `api/client.ts`: extract `X-CSRFToken` from login response and use it for the next unsafe request. |

### 3.2 Workspace Endpoints

| Action | Endpoint | Method | Notes |
|--------|----------|--------|-------|
| List workspaces | `GET /api/v1/workspaces/` | GET | Paginated: `{"count", "next", "previous", "results": [...]}`. Only returns workspaces where user has membership. |
| Create workspace | `POST /api/v1/workspaces/create/` | POST | Body: `{"name": "Acme"}`. On 201: server returns workspace + caller's role. Refresh workspace list. |
| Workspace detail | `GET /api/v1/workspaces/{workspace_id}/` | GET | Returns 404 if user is not a member. The response includes the caller's role in that workspace. |
| Rename workspace | `POST /api/v1/workspaces/{workspace_id}/rename/` | POST | Body: `{"name": "New Name"}`. Only owner can rename. Returns 403 for non-owners. |

### 3.3 Project Endpoints

| Action | Endpoint | Method | Notes |
|--------|----------|--------|-------|
| Create project | `POST /api/v1/projects/create/` | POST | Body: `{"name": "Acme Project", "key": "ABC"}`. Key must match `^[A-Z][A-Z0-9]{1,9}$`. Only owners/admins of the current workspace can create. Board is created atomically. |
| List projects | `GET /api/v1/projects/` | GET | Paginated. Filters to projects in user's workspaces. |
| Project detail | `GET /api/v1/projects/{project_id}/` | GET | Returns 404 if user is not a member of the project's workspace. |

### 3.4 Issue Endpoints (Step 2 — MP-F04-009)

| Action | Endpoint | Method | Notes |
|--------|----------|--------|-------|
| Create issue | `POST /api/v1/projects/{project_id}/issues/` | POST | Body: `{"title": "Issue title", "description": "...", "priority": "medium", "status": "to_do"}`. Status must be an existing `WorkflowStatus` name for the board. On 201: returns issue representation with `number`, `board_name`, `board_key`. |
| List issues | `GET /api/v1/issues/` | GET | Query params: `project_id`, `status`, `priority`. Paginated. Filters enforce workspace isolation. |
| Update issue | `PATCH /api/v1/issues/{issue_id}/update/` | PATCH | Body: `{ "title": "...", "description": "...", "priority": "medium", "assignee": "bob", "sprint_id": 1, "version": 0 }`. Version must match for optimistic locking. Returns 409 on version mismatch. |
| Transition issue | `POST /api/v1/issues/{issue_id}/transitions/` | POST | Body: `{ "status": "in_progress" }`. Validates directed transition flow: To do → In progress → Done. Also allows To do → Done (skip-in-progress). Returns 400 for invalid transitions. |

### 3.5 API Client Design (`api/client.ts`)

The API client must handle:

1. **Session cookies**: All requests use `withCredentials: true` (as configured in `playwright.config.ts`). The browser will automatically send `sessionid` cookie on same-origin requests.
2. **CSRF token injection**: 
   - On first request or after login, fetch `GET /auth/csrf/` to get the token.
   - Store the token in memory.
   - For `POST`, `PATCH`, `PUT`, `DELETE` requests: set `headers: { 'X-CSRFToken': csrfToken }`.
   - After login, the server returns a new CSRF token in the `X-CSRFToken` response header. The client must update its stored token from this header.
3. **Error handling**: All errors follow the envelope `{ error: { code, message, fields } }`. The client should parse this and surface user-friendly messages.
4. **Base URL**: `http://127.0.0.1:8000/api/v1` (or the `baseURL` from Playwright config `http://127.0.0.1:8000`).
5. **Tenant context**: The `workspace_id` is never sent as a body field or header. It is derived from the current workspace selection in the React store/hooks. The backend revalidates membership on every request.

---

## 4. State Management Approach

### Recommended: React Context + Custom Hooks (lightweight, no Redux overhead)

Given the project's scope and the KISS principle, use **React Context** for global state rather than introducing Redux or Jotai unless strictly necessary. The state needed is:

1. **Auth state**: `isAuthenticated`, `user` (from `GET /auth/me/`), `csrfToken`
2. **Workspace state**: `currentWorkspaceId`, `currentWorkspaceRole`, `workspaces[]` list
3. **Board state**: `currentProject`, `columns[]` (workflow columns), `issues[]` per column

### State Flow

```
┌─────────────────────┐
│ React Context API   │
│ (AuthContext)       │
│  - user             │
│  - isAuthenticated │
│  - csrfToken        │
└─────────────┬───────┘
              │
┌─────────────▼───────┐
│ useAuth() hook      │
│  - login(username)  │
│  - logout()         │
│  - me() → GET /me/  │
└─────────────┬───────┘
              │
┌─────────────▼───────┐
│ useWorkspace() hook │
│  - setWorkspace(id) │
│  - fetchWorkspaces()│
└─────────────┬───────┘
              │
┌─────────────▼───────┐
│ useIssues() hook    │
│  - fetchIssues()    │
│  - createIssue()    │
│  - transitionIssue()│
└─────────────┬───────┘
              │
       UI Components
```

### Per-component local state

- Form inputs (`LoginForm`, `IssueCreateModal`, etc.) use React `useState` for their local fields.
- Drag-and-drop state (drag image, ghost element) is managed by the drag-and-drop library.

### Why not Redux/Jotai?

- The app has a small, focused set of state domains (auth, workspace, board).
- Context + hooks provides the same testability and debuggability without the boilerplate.
- If the app grows significantly, a transition to Jotai or Redux can be done incrementally.

---

## 5. Drag-and-Drop Library Recommendation

### **dnd-kit** (recommended)

**Why dnd-kit:**

1. **Accessibility first** — built with ARIA support, keyboard navigation, and screen reader support out of the box.
2. **No deprecated `mouseCapture`** — uses modern Pointer Events and avoids the pitfalls of `react-beautiful-dnd` (which is unmaintained).
3. **Framework agnostic** — works with React, Vue, Solid, or vanilla JS. No `DragDropContext` from React DOM buggy versions.
4. **Performance** — minimal re-renders; only the dragging element and its container are updated.
5. **Modern ecosystem** — actively maintained, works with React 18/19 and TypeScript.
6. **No inline styles required** — you provide your own CSS, which fits the project's Clean Code principles.

**Alternative (not recommended):** `react-beautiful-dnd` — unmaintained, requires inline style transformations, known accessibility issues, and conflicts with modern React versions.

### Basic dnd-kit setup for IssueBoard

```tsx
import {
  useRefs,
  useSensors,
  useSortable,
  useDraggable,
} from '@dnd-kit/core';
import { useSortable as useArraySortable } from '@dnd-kit/sortable';

const Column = ({ issues, onIssueMove }: { issues: Issue[]; onIssueMove: (issueId: number) => void }) => {
  const ref = useRefs();

  const sortable = useSortable(issueId, {
    id: issueId,
    data: { columnId: column.id },
  });

  return (
    <div className="column" ref={ref} {...sortable}>
      {issues.map((issue) => (
        <IssueCard key={issue.id} issue={issue} sortable={sortable} />
      ))}
    </div>
  );
};
```

### Drag-and-drop flow for issue movement

1. **User drags an IssueCard** from one column to another.
2. **`dnd-kit`** tracks the drag start, movement, and drop position.
3. **On drop**: Send a `PATCH /api/v1/issues/{issue_id}/update/` request with:
   - `status`: the new column's status name (To do / In progress / Done)
   - `version`: the issue's current version (for optimistic locking)
4. **On success**: Update local state (`useIssues` hook refetches issues) and re-order the columns locally for instant visual feedback.
5. **On failure**: Visually roll back the issue to its original column/position (as per FR-07 acceptance criteria: "visual rollback on API error").

### Accessible keyboard interaction (dnd-kit)

- Each `IssueCard` gets `role="button"` with `tabIndex={0}`.
- `ArrowKeys` can reorder issues within a column using the `useSortable` `axis` constraint.
- Escape key cancels the drag operation.
- `aria-grabbed` attribute is set on the card during drag.

---

## 6. Test Coverage Strategy

### 6.1 Unit Tests (Jest + React Testing Library)

| Area | Test Focus | Example |
|------|------------|---------|
| Auth | Login form submits with valid credentials, stores user, redirects. | `render(<LoginForm />); fireEvent.submit; expect(user).toBeInTheDocument()` |
| Auth | Logout clears session, redirects to login. | `await userEvent.click(logoutBtn); expect(navigate).toHavePath('/login')` |
| Workspace | WorkspaceCreateModal creates workspace via API mock. | `render(<WorkspaceCreateModal />); await userEvent.type(nameInput, "Acme"); await userEvent.click(saveBtn);` |
| Board | IssueCard renders correctly with issue data. | `render(<IssueCard issue={issueMock} />); expect(ByTitle('Issue title')).toBeInTheDocument()` |
| Board | Column displays issues in correct order. | `expect(column.querySelectorAll('.issue-card')).toHaveLength(3);` |

### 6.2 Integration Tests (Playwright E2E)

The existing Playwright tests at `/home/workstation/source/f1/F04/tests/` cover the backend API flows. The frontend implementation should integrate as follows:

| Test File | Frontend Integration |
|-----------|---------------------|
| `e2e-01-authentication-playwright.ts` | Validates `/auth/csrf/`, `/auth/login/`, `/auth/logout/`, `/auth/me/`. The frontend `LoginForm` and `LogoutButton` must work with these same endpoints. |
| `e2e-02-workspace-isolation-playwright.ts` | Validates workspace creation, listing, and isolation. The frontend `WorkspaceList`, `WorkspaceSelector`, and `WorkspaceCreateModal` must produce the same API calls. |
| `e2e-03-projects-issues-playwright.ts` | Validates project creation, issue creation, listing, status filtering, transitions. The frontend `ProjectCreateModal`, `IssueCreateModal`, `BoardPage`, and `Column`/`IssueCard` must issue the same POST/PATCH requests. |
| `e2e-04-configurable-workflows-playwright.ts` | Will test workflow config and transitions (Step 3). |
| `e2e-05-sprint-lifecycle-playwright.ts` | Will test sprints (Step 3). |
| `e2e-06-comments-playwright.ts` | Will test comments (Step 3). |

**Frontend E2E test additions** (to be created alongside the frontend code):

1. `e2e-07-frontend-flow-playwright.ts` — Primary flow: Sign in → Select/create workspace → Open project → View board → Create/move issue. This test will:
   - Start from sign-in flow (using the same credentials as the other E2E tests).
   - Select a workspace from the selector.
   - Create a project (or select existing).
   - View the board page.
   - Create an issue via the IssueCreateModal.
   - Move the issue between columns using drag-and-drop.
   - Verify persistence (issue appears in new column after reload).

2. `e2e-08-workspace-isolation-frontend-playwright.ts` — Verifies that a user cannot access workspace-scoped data without proper membership, matching `e2e-02-workspace-isolation-playwright.ts`.

### 6.3 Test Commands

```bash
# Unit tests (if Vitest/Jest configured)
npm test          # runs vitest or jest

# E2E tests (existing)
npx playwright test   # runs all existing E2E tests

# E2E with UI mode
npx playwright test --ui
```

### 6.4 Coverage Minimum

- **FR-01** (auth): Unit test login form + integration test via Playwright `e2e-01-authentication-playwright.ts`.
- **FR-02** (workspace creation): Unit test `WorkspaceCreateModal` + integration via `e2e-02-workspace-isolation-playwright.ts` + new `e2e-07-frontend-flow-playwright.ts`.
- **FR-07** (issue creation + drag-and-drop): Unit tests for `IssueCreateModal` + integration via `e2e-03-projects-issues-playwright.ts` + new `e2e-07-frontend-flow-playwright.ts`.
- **NFR-12** (usability/accessibility): Manual review + Playwright `a11y` checks (`await expect(page).toHaveAccessibleRole(...)`).

---

## 7. Integration with Existing Playwright E2E Tests

### 7.1 Shared Conventions

The existing Playwright tests already establish these patterns:

- **BASE_URL**: `http://127.0.0.1:8000/api/v1`
- **Credentials**: `username: 'alice'`, `password: process.env.SECRET_TEST_PASS || 'testpass123'`
- **CSRF**: Fetch `GET /auth/csrf/` first, then use the returned `csrf_token` in `X-CSRFToken` header.
- **Session**: Login establishes a Django session cookie (`sessionid`). Subsequent requests use `withCredentials: true` (configured in `playwright.config.ts`).
- **Fresh CSRF after login**: Always fetch a new CSRF token after login because the token rotates.

### 7.2 Frontend-Specific Test Additions

**New file: `e2e-07-frontend-flow-playwright.ts`**

```ts
/// <reference types="playwright/test" />
import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:8000/api/v1';
const VALID_CREDENTIALS = {
  username: 'alice',
  password: process.env.SECRET_TEST_PASS || 'testpass123',
};

test('Primary flow: sign in → workspace → project → board → create/move issue', async ({ page, request }) => {
  // 1. Bootstrap CSRF
  const csrfResp = await request.get(BASE_URL + '/auth/csrf/');
  const csrfBody = await csrfResp.json();
  let csrfToken = csrfBody.csrf_token;

  // 2. Login
  await page.goto('/login');  // Frontend login page
  await request.post(BASE_URL + '/auth/login/', {
    data: VALID_CREDENTIALS,
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': csrfToken,
    },
  });

  // 3. Fetch fresh CSRF after login
  const freshCsrf = await request.get(BASE_URL + '/auth/csrf/');
  const freshCsrfBody = await freshCsrf.json();
  csrfToken = freshCsrfBody.csrf_token;

  // 4. Select/create workspace
  // (The frontend will have a workspace selector; this test verifies the flow)
  await request.post(BASE_URL + '/workspaces/create/', {
    data: { name: 'E2E Test Workspace' },
    headers: { 'X-CSRFToken': csrfToken, 'Content-Type': 'application/json' },
  });

  // 5. List workspaces and select the newly created one
  const workspacesResp = await request.get(BASE_URL + '/workspaces/', {
    headers: { 'X-CSRFToken': csrfToken, 'Content-Type': 'application/json' },
  });
  const workspaceBody = await workspacesResp.json();
  const workspaceId = workspaceBody.results[0].id;

  // 6. Create a project
  await request.post(BASE_URL + '/projects/create/', {
    data: { name: 'E2E Test Project', key: 'ETP' },
    headers: { 'X-CSRFToken': csrfToken, 'Content-Type': 'application/json' },
  });

  // 7. View the board page (frontend navigation)
  await page.goto(`/board/${workspaceId}/projects/1`);  // Assuming routing

  // 8. Create an issue
  await request.post(BASE_URL + '/projects/1/issues/', {
    data: { title: 'E2E test issue', description: 'Created by E2E test', priority: 'medium', status: 'to_do' },
    headers: { 'X-CSRFToken': csrfToken, 'Content-Type': 'application/json' },
  });

  // 9. List issues and verify the new issue appears
  const issuesResp = await request.get(BASE_URL + '/issues/', {
    headers: { 'X-CSRFToken': csrfToken, 'Content-Type': 'application/json' },
  });
  const issuesBody = await issuesResp.json();
  expect(issuesBody.results.some((i: any) => i.title === 'E2E test issue')).toBe(true);

  // 10. Move issue between columns using drag-and-drop (Playwright)
  //    - Click and drag the issue card
  //    - Drop it in the "In progress" column
  //    - Verify the issue now appears in the In progress column after reload
});
```

**New file: `e2e-08-workspace-isolation-frontend-playwright.ts`**

This test verifies that the frontend correctly enforces workspace isolation, mirroring `e2e-02-workspace-isolation-playwright.ts`. It should:
- Sign in as user A.
- Create workspace A.
- Sign in as user B (or switch session).
- Verify user B cannot see workspace A's data.

### 7.3 Test Isolation

The frontend must **not** duplicate backend isolation logic — it must rely on the backend to enforce permissions. The frontend's role is to:
- Show/hide UI elements based on the user's role (from `GET /auth/me/` and workspace detail).
- Not trust client-supplied `workspace_id` values.
- Always revalidate workspace access before performing scoped actions (the backend already does this, but the frontend should not bypass it).

### 7.4 Running the Tests

All existing Playwright tests should continue to pass without modification. The new frontend tests (`e2e-07-*`, `e2e-08-*`) are additive and should be run as part of the CI pipeline. The command:

```bash
npx playwright test
```

will run all tests including the new ones once they are added.

---

## Summary Checklist for Code-Delegate

| # | Item | Status |
|---|------|--------|
| 1 | Create directory structure under `frontend/src/` | To be done |
| 2 | Create API client (`api/client.ts`, `api/auth.ts`, etc.) | To be done |
| 3 | Create TypeScript types (`types/index.ts`, `types/auth.ts`, etc.) | To be done |
| 4 | Create auth components (`LoginForm`, `LogoutButton`, `useAuth` hook) | To be done |
| 5 | Create workspace components (`WorkspaceList`, `WorkspaceSelector`, `WorkspaceCreateModal`, `useWorkspace` hook) | To be done |
| 6 | Create project components (`ProjectList`, `ProjectCreateModal`) | To be done |
| 7 | Create board components (`BoardPage`, `Column`, `IssueCard`, `IssueCreateModal`, `WorkflowConfigModal`) | To be done |
| 8 | Create shared components (`LoadingSpinner`, `EmptyState`, `ErrorBoundary`) | To be done |
| 9 | Implement drag-and-drop with `dnd-kit` for issue movement | To be done |
| 10 | Update `package.json` with React, `dnd-kit`, and testing dependencies | To be done |
| 11 | Add new Playwright E2E tests (`e2e-07-*`, `e2e-08-*`) | To be done |
| 12 | Verify all existing E2E tests still pass | To be done |

This plan provides a complete specification for the code-delegate system to implement the React frontend for MP-F04-009 (Step 2: Projects, boards, issues, persistent drag-and-drop). Each component, API integration, and test strategy is defined to ensure consistency with the existing backend contract and the broader FS-04 project requirements.