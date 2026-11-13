/// <reference types="playwright/test" />
import { test, expect } from '@playwright/test';

// Base URL for the Django API
const BASE_URL = 'http://127.0.0.1:8000/api/v1';

// Credentials from .env: SECRET_TEST_PASS=testpass123
const VALID_CREDENTIALS = {
  username: 'alice',
  password: process.env.SECRET_TEST_PASS || 'testpass123',
};

// Helper functions shared across tests
// Each helper adds CSRF headers using the token from test.info()

async function loginAsAlice(request, csrfToken) {
  const resp = await request.post(BASE_URL + '/auth/login/', {
    data: VALID_CREDENTIALS,
    headers: { 'X-CSRFToken': csrfToken, 'Content-Type': 'application/json' },
  });
  expect(resp.status()).toBe(200);
  return resp;
}

async function createWorkspace(request, name = 'Workflow Test Workspace', csrfToken) {
  const resp = await request.post(BASE_URL + '/workspaces/create/', {
    data: { name },
    headers: { 'X-CSRFToken': csrfToken, 'Content-Type': 'application/json' },
  });
  return resp;
}

async function createProject(request, name, key, csrfToken, workspaceId) {
  const resp = await request.post(BASE_URL + '/projects/create/', {
    data: { name, key, workspace_id: workspaceId },
    headers: { 'X-CSRFToken': csrfToken, 'Content-Type': 'application/json' },
  });
  return resp;
}

async function getBoardWorkflow(request, boardId, csrfToken) {
  const resp = await request.get(BASE_URL + '/boards/' + boardId + '/workflow/', {
    headers: { 'X-CSRFToken': csrfToken, 'Content-Type': 'application/json' },
  });
  return resp;
}

async function updateBoardWorkflow(request, boardId, version, statuses, transitions, csrfToken) {
  const resp = await request.put(BASE_URL + '/boards/' + boardId + '/workflow/', {
    data: { version, statuses, transitions },
    headers: { 'X-CSRFToken': csrfToken, 'Content-Type': 'application/json' },
  });
  return resp;
}

async function createIssue(request, projectId, title, status?, csrfToken) {
  const data = { title };
  if (status) data.status = status;
  const resp = await request.post(BASE_URL + '/projects/' + projectId + '/issues/', {
    data,
    headers: { 'X-CSRFToken': csrfToken, 'Content-Type': 'application/json' },
  });
  return resp;
}

async function transitionIssue(request, issueId, status, csrfToken) {
  const resp = await request.post(BASE_URL + '/issues/' + issueId + '/transitions/', {
    data: { status },
    headers: { 'X-CSRFToken': csrfToken, 'Content-Type': 'application/json' },
  });
  return resp;
}

// ---------------------------------------------------------------------------
// Test suite: Configurable Workflows E2E
// ---------------------------------------------------------------------------

test.describe('Configurable Workflows E2E', () => {
  let workspaceId: number | null = null;
  let projectId: number | null = null;
  let boardId: number | null = null;
  let issueId: number | null = null;

  // ── beforeAll: set up initial CSRF token only ──────
  test.beforeAll(async ({ request }, testInfo) => {
    // Fetch CSRF token from GET /api/v1/auth/csrf/
    const csrfResp = await request.get(BASE_URL + '/auth/csrf/');
    const csrfBody = await csrfResp.json();
    testInfo.csrfToken = csrfBody.csrf_token;
  });

  // ── Test 1: List WorkflowStatuses - GET /api/v1/boards/{board_id}/workflow/ ──────
  test('1. List WorkflowStatuses - GET /api/v1/boards/{board_id}/workflow/ returns statuses', async ({ request }, testInfo) => {
    // Step 1: Log in with the initial CSRF token
    const csrfToken = testInfo.csrfToken;
    await loginAsAlice(request, csrfToken);

    // Step 2: Fetch a FRESH CSRF token from GET /auth/csrf/ after login
    const freshCsrfResponse = await request.get(BASE_URL + '/auth/csrf/');
    const freshCsrfBody = await freshCsrfResponse.json();
    const freshCsrfToken = freshCsrfBody.csrf_token;

    // Step 3: Use the fresh CSRF token for all subsequent API calls
    // --- Create Workspace as alice ---
    await createWorkspace(request, 'Workflow Test Workspace', freshCsrfToken);
    const createW = await createWorkspace(request, 'Workflow Test Workspace', freshCsrfToken);
    expect(createW.status()).toBe(201);
    const bodyW = await createW.json();
    workspaceId = bodyW.workspace.id;

    // --- Create Project as alice (this creates a board with default workflow) ---
    const createP = await createProject(request, 'Workflow Test Project', 'WTP', freshCsrfToken, workspaceId);
    expect(createP.status()).toBe(201);
    const bodyP = await createP.json();
    projectId = bodyP.project.id;
    boardId = bodyP.project.board.id;

    // --- List WorkflowStatuses ---
    const resp = await getBoardWorkflow(request, boardId, freshCsrfToken);
    expect(resp.status()).toBe(200);

    const body = await resp.json();
    expect(body).toHaveProperty('error', null);
    expect(body).toHaveProperty('statuses');
    expect(Array.isArray(body.statuses)).toBe(true);

    // Should have at least the default statuses: to_do, in_progress, done
    const statusNames = body.statuses.map((s) => s.name);
    expect(statusNames).toContain('to_do');
    expect(statusNames).toContain('in_progress');
    expect(statusNames).toContain('done');
  });

  // ── Test 2: Check allowed transitions ──────
  test('2. Check allowed transitions - verify transition rules', async ({ request }, testInfo) => {
    // Step 1: Log in with the initial CSRF token
    const csrfToken = testInfo.csrfToken;
    await loginAsAlice(request, csrfToken);

    // Step 2: Fetch a FRESH CSRF token from GET /auth/csrf/ after login
    const freshCsrfResponse = await request.get(BASE_URL + '/auth/csrf/');
    const freshCsrfBody = await freshCsrfResponse.json();
    const freshCsrfToken = freshCsrfBody.csrf_token;

    // Step 3: Use the fresh CSRF token for all subsequent API calls
    // First create an issue in the default 'to_do' status
    const createIssueResp = await createIssue(request, projectId, 'Transition test issue', undefined, freshCsrfToken);
    expect(createIssueResp.status()).toBe(201);
    const createIssueBody = await createIssueResp.json();
    issueId = createIssueBody.issue.id;

    // List workflow statuses to know available statuses
    const workflowResp = await getBoardWorkflow(request, boardId, freshCsrfToken);
    expect(workflowResp.status()).toBe(200);
    const workflowBody = await workflowResp.json();
    const statusNames = workflowBody.statuses.map((s) => s.name);

    // Test valid transition: To do → In progress
    const transitionToInProgress = await transitionIssue(request, issueId, 'in_progress', freshCsrfToken);
    expect(transitionToInProgress.status()).toBe(200);

    // Verify the issue status changed
    const transitionBody = await transitionToInProgress.json();
    expect(transitionBody).toHaveProperty('error', null);

    // Test another valid transition: To do → Done (skip-in-progress)
    const createIssue2Resp = await createIssue(request, projectId, 'Skip transition test issue', undefined, freshCsrfToken);
    expect(createIssue2Resp.status()).toBe(201);
    const createIssue2Body = await createIssue2Resp.json();
    const issueId2 = createIssue2Body.issue.id;

    const transitionToDone = await transitionIssue(request, issueId2, 'done', freshCsrfToken);
    expect(transitionToDone.status()).toBe(200);
    const transitionToDoneBody = await transitionToDone.json();
    expect(transitionToDoneBody).toHaveProperty('error', null);
  });

  // ── Test 3: Create/Configure Workflow ──────
  test('3. Create/Configure Workflow - update board workflow with custom statuses and transitions', async ({ request }, testInfo) => {
    // Step 1: Log in with the initial CSRF token
    const csrfToken = testInfo.csrfToken;
    await loginAsAlice(request, csrfToken);

    // Step 2: Fetch a FRESH CSRF token from GET /auth/csrf/ after login
    const freshCsrfResponse = await request.get(BASE_URL + '/auth/csrf/');
    const freshCsrfBody = await freshCsrfResponse.json();
    const freshCsrfToken = freshCsrfBody.csrf_token;

    // Step 3: Use the fresh CSRF token for all subsequent API calls
    // Get current workflow statuses
    const workflowResp = await getBoardWorkflow(request, boardId, freshCsrfToken);
    expect(workflowResp.status()).toBe(200);
    const workflowBody = await workflowResp.json();

    // Define custom statuses and transitions
    const customStatuses = [
      { ref: 'todo', name: 'to_do', category: 'todo', position: 0 },
      { ref: 'in_progress', name: 'in_progress', category: 'in_progress', position: 1 },
      { ref: 'review', name: 'review', category: 'in_progress', position: 2 },
      { ref: 'done', name: 'done', category: 'done', position: 3 },
    ];

    const customTransitions = [
      { from: 'todo', to: 'in_progress' },
      { from: 'in_progress', to: 'todo' },
      { from: 'in_progress', to: 'review' },
      { from: 'review', to: 'in_progress' },
      { from: 'review', to: 'done' },
      { from: 'todo', to: 'done' },
    ];

    // Get current version from the workflow
    const currentVersion = workflowBody.version || 1;

    // Update the board workflow with custom configuration
    const updateResp = await updateBoardWorkflow(request, boardId, currentVersion, customStatuses, customTransitions, freshCsrfToken);
    expect(updateResp.status()).toBe(200);

    const updateBody = await updateResp.json();
    expect(updateBody).toHaveProperty('error', null);
    expect(updateBody).toHaveProperty('board_version');

    // Verify the new statuses are configured
    const getUpdatedWorkflowResp = await getBoardWorkflow(request, boardId, freshCsrfToken);
    expect(getUpdatedWorkflowResp.status()).toBe(200);
    const getUpdatedBody = await getUpdatedWorkflowResp.json();
    const updatedStatusNames = getUpdatedBody.statuses.map((s) => s.name);
    expect(updatedStatusNames).toContain('to_do');
    expect(updatedStatusNames).toContain('in_progress');
    expect(updatedStatusNames).toContain('review');
    expect(updatedStatusNames).toContain('done');
  });

  // ── Test 4: Test transition issues between statuses ──────
  test('4. Test transition issues between statuses - valid and invalid transitions', async ({ request }, testInfo) => {
    // Step 1: Log in with the initial CSRF token
    const csrfToken = testInfo.csrfToken;
    await loginAsAlice(request, csrfToken);

    // Step 2: Fetch a FRESH CSRF token from GET /auth/csrf/ after login
    const freshCsrfResponse = await request.get(BASE_URL + '/auth/csrf/');
    const freshCsrfBody = await freshCsrfResponse.json();
    const freshCsrfToken = freshCsrfBody.csrf_token;

    // Step 3: Use the fresh CSRF token for all subsequent API calls
    // Create a new issue (will start in default 'to_do' status via project creation)
    const createIssueResp = await createIssue(request, projectId, 'Transition issue for testing', undefined, freshCsrfToken);
    expect(createIssueResp.status()).toBe(201);
    const createIssueBody = await createIssueResp.json();
    const testIssueId = createIssueBody.issue.id;

    // Get current workflow to know available statuses
    const workflowResp = await getBoardWorkflow(request, boardId, freshCsrfToken);
    expect(workflowResp.status()).toBe(200);
    const workflowBody = await workflowResp.json();
    const statusNames = workflowBody.statuses.map((s) => s.name);

    // ---- Valid transitions ----

    // 1. To do → In progress (allowed)
    const t1 = await transitionIssue(request, testIssueId, 'in_progress', freshCsrfToken);
    expect(t1.status()).toBe(200);
    const t1Body = await t1.json();
    expect(t1Body).toHaveProperty('error', null);

    // 2. In progress → Done (allowed)
    const t2 = await transitionIssue(request, testIssueId, 'done', freshCsrfToken);
    expect(t2.status()).toBe(200);
    const t2Body = await t2.json();
    expect(t2Body).toHaveProperty('error', null);

    // 3. To do → Done (allowed, skip-in-progress)
    // First reset the issue to to_do by creating a new one
    const createIssueResp3 = await createIssue(request, projectId, 'To-do to done test issue', undefined, freshCsrfToken);
    expect(createIssueResp3.status()).toBe(201);
    const createIssueBody3 = await createIssueResp3.json();
    const testIssueId3 = createIssueBody3.issue.id;

    const t3 = await transitionIssue(request, testIssueId3, 'done', freshCsrfToken);
    expect(t3.status()).toBe(200);
    const t3Body = await t3.json();
    expect(t3Body).toHaveProperty('error', null);

    // ---- Invalid transitions ----

    // 4. In progress → To do should be invalid (not in the allowed set for Step 2)
    const createIssueResp4 = await createIssue(request, projectId, 'Invalid reverse transition test', undefined, freshCsrfToken);
    expect(createIssueResp4.status()).toBe(201);
    const createIssueBody4 = await createIssueResp4.json();
    const testIssueId4 = createIssueBody4.issue.id;

    // Transition to In progress first
    await transitionIssue(request, testIssueId4, 'In progress', freshCsrfToken);

    // Now try to transition back to To do - should fail
    const invalidTransition = await transitionIssue(request, testIssueId4, 'to_do', freshCsrfToken);
    expect(invalidTransition.status()).toBe(400);

    const invalidBody = await invalidTransition.json();
    expect(invalidBody).toHaveProperty('error');
    // The error should mention that the transition is not allowed
    expect(invalidBody.error).toHaveProperty('code', 'validation_error');

    // 5. Try transitioning to a non-existent status
    const invalidStatusTransition = await transitionIssue(request, testIssueId, 'nonexistent_status', freshCsrfToken);
    expect(invalidStatusTransition.status()).toBe(400);

    const invalidStatusBody = await invalidStatusTransition.json();
    expect(invalidStatusBody).toHaveProperty('error');
    expect(invalidStatusBody.error).toHaveProperty('code', 'validation_error');
  });
});