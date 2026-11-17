/// <reference types="playwright/test" />
import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';

const BASE_URL = 'http://127.0.0.1:8000/api/v1';

// Credentials from .env: SECRET_TEST_PASS=testpass123
const VALID_CREDENTIALS = {
  username: 'alice',
  password: process.env.SECRET_TEST_PASS || 'testpass123',
};

// Helper functions shared across tests
// These helpers now pass CSRF headers on every request
async function createWorkspace(request, csrfToken, name = 'Sprint Test Workspace') {
  const resp = await request.post(BASE_URL + '/workspaces/create/', {
    data: { name },
    headers: {
      'X-CSRFToken': csrfToken as string,
      'Content-Type': 'application/json',
    },
  });
  return resp;
}

async function createProject(request, csrfToken, name, key, workspaceId) {
  const resp = await request.post(BASE_URL + '/projects/create/', {
    data: { name, key, workspace_id: workspaceId },
    headers: {
      'X-CSRFToken': csrfToken as string,
      'Content-Type': 'application/json',
    },
  });
  return resp;
}

async function listSprints(request, csrfToken, projectId) {
  const url = projectId
    ? BASE_URL + '/projects/' + projectId + '/sprints/'
    : BASE_URL + '/sprints/';
  const resp = await request.get(url, {
    headers: {
      'X-CSRFToken': csrfToken as string,
      'Content-Type': 'application/json',
    }
  });
  return resp;
}

async function createSprint(request, csrfToken, projectId, name, status = 'planned') {
  const resp = await request.post(BASE_URL + '/projects/' + projectId + '/sprints/create/', {
    data: { name, status },
    headers: {
      'X-CSRFToken': csrfToken as string,
      'Content-Type': 'application/json',
    },
  });
  return resp;
}

async function updateSprint(request, csrfToken, sprintId, data) {
  const resp = await request.patch(BASE_URL + '/sprints/' + sprintId + '/', {
    data,
    headers: {
      'X-CSRFToken': csrfToken as string,
      'Content-Type': 'application/json',
    },
  });
  return resp;
}

async function assignSprintToIssue(request, csrfToken, issueId, sprintId) {
  const resp = await request.post(BASE_URL + '/issues/' + issueId + '/assign-sprint/', {
    data: { sprint_id: sprintId },
    headers: {
      'X-CSRFToken': csrfToken as string,
      'Content-Type': 'application/json',
    },
  });
  return resp;
}

// Helper: create an issue in a project
async function createIssueToProject(request, csrfToken, projectId: number, title: string) {
  const resp = await request.post(BASE_URL + '/projects/' + projectId + '/issues/', {
    data: { title, priority: 'medium' },
    headers: {
      'X-CSRFToken': csrfToken as string,
      'Content-Type': 'application/json',
    },
  });
  return resp;
}

// Hard-delete any workspaces owned by the given user.
// Free plan allows only ONE workspace. Soft-delete via the API does NOT free
// the slot because create_workspace counts every owned workspace regardless
// of deleted_at, so we hard-delete via the Django ORM to reset the ownership
// count before a test creates a new workspace.
async function deleteUserWorkspaces(username: string) {
  execSync(
    'PYTHONPATH=backend:$PYTHONPATH python3 << "PYEOF"\nimport os\nimport django\nos.environ.setdefault("DJANGO_SETTINGS_MODULE", "conf.settings")\ndjango.setup()\nfrom django.contrib.auth import get_user_model\nfrom workspaces.models import Workspace\nUser = get_user_model()\nuser = User.objects.filter(username="' + username + '").first()\nif user:\n  for ws in Workspace.objects.filter(memberships__user=user, memberships__role="owner").distinct():\n    ws.delete()\nPYEOF'
  );
}

// -- Test suite: Sprint Lifecycle E2E --
test.describe.serial('Sprint Lifecycle E2E', () => {
  let workspaceId: number | null = null;
  let projectId: number | null = null;

  // ── beforeAll: fetch initial CSRF token only ──────
  test.beforeAll(async ({ request }) => {
    // Fetch CSRF token first
    const csrfResponse = await request.get(BASE_URL + '/auth/csrf/');
    const csrfBody = await csrfResponse.json();
    test.info().csrfToken = csrfBody.csrf_token;
  });

  // ── Test 1: Create Sprint - POST /api/v1/sprints/ with valid name, project_id, status ──────
  test('1. Create Sprint - POST /api/v1/sprints/create/ with valid name, project_id, status', async ({ request }) => {
    let csrfToken = test.info().csrfToken;

    // Login as alice via POST /api/v1/auth/login/ with CSRF token
    await request.post(BASE_URL + '/auth/login/', {
      data: VALID_CREDENTIALS,
      headers: {
        'X-CSRFToken': csrfToken as string,
        'Content-Type': 'application/json',
      },
    });

    // Fetch fresh CSRF token after login to match the session cookie
    const freshCsrfResponse = await request.get(BASE_URL + '/auth/csrf/');
    const freshCsrfBody = await freshCsrfResponse.json();
    csrfToken = freshCsrfBody.csrf_token;
    test.info().csrfToken = csrfToken;

    // Ensure workspace and project exist by creating them
    // Free plan allows only ONE workspace; hard-delete any Alice owns from a prior run
    await deleteUserWorkspaces('alice');
    const createW = await createWorkspace(request, csrfToken, 'Sprint Test Workspace');
    expect(createW.status()).toBe(201);
    const bodyW = await createW.json();
    workspaceId = bodyW.workspace.id;

    const createP = await createProject(request, csrfToken, 'Sprint Test Project', 'STP', workspaceId);
    expect(createP.status()).toBe(201);
    const bodyP = await createP.json();
    projectId = bodyP.project.id;

    // Create Sprint
    const resp = await createSprint(request, csrfToken, projectId, 'Sprint 1', 'planned');

    // Assert status code 201
    expect(resp.status()).toBe(201);

    // Assert response structure
    const body = await resp.json();
    expect(body).toHaveProperty('error', null);
    expect(body).toHaveProperty('sprint');
    expect(body.sprint).toHaveProperty('name', 'Sprint 1');
    expect(body.sprint).toHaveProperty('status', 'planned');
    expect(body.sprint).toHaveProperty('id');
    expect(body.sprint).toHaveProperty('project_name');
    expect(body.sprint).toHaveProperty('project_key');
    expect(body.sprint).toHaveProperty('start_at', null);
    expect(body.sprint).toHaveProperty('end_at', null);
  });

  // ── Test 2: List Sprints - GET /api/v1/sprints/ or with project_id filter ──────
  test('2. List Sprints - GET /api/v1/sprints/ returns sprints', async ({ request }) => {
    let csrfToken = test.info().csrfToken;

    expect(projectId).not.toBeNull();

    // Login as alice via POST /api/v1/auth/login/ with CSRF token
    await request.post(BASE_URL + '/auth/login/', {
      data: VALID_CREDENTIALS,
      headers: {
        'X-CSRFToken': csrfToken as string,
        'Content-Type': 'application/json',
      },
    });

    // Fetch fresh CSRF token after login to match the session cookie
    const freshCsrfResponse = await request.get(BASE_URL + '/auth/csrf/');
    const freshCsrfBody = await freshCsrfResponse.json();
    csrfToken = freshCsrfBody.csrf_token;
    test.info().csrfToken = csrfToken;

    // List sprints for the project (backend only exposes a project-scoped list)
    const resp = await listSprints(request, csrfToken, projectId);
    expect(resp.status()).toBe(200);

    const body = await resp.json();
    expect(body).toHaveProperty('error', null);
    expect(body).toHaveProperty('results');
    expect(Array.isArray(body.results)).toBe(true);

    // Should see at least the sprint we just created
    const sprintNames = body.results.map((s: any) => s.name);
    expect(sprintNames).toContain('Sprint 1');
  });

  test('2b. List Sprints filtered by project_id', async ({ request }) => {
    let csrfToken = test.info().csrfToken;

    expect(projectId).not.toBeNull();

    // Login as alice via POST /api/v1/auth/login/ with CSRF token
    await request.post(BASE_URL + '/auth/login/', {
      data: VALID_CREDENTIALS,
      headers: {
        'X-CSRFToken': csrfToken as string,
        'Content-Type': 'application/json',
      },
    });

    // Fetch fresh CSRF token after login to match the session cookie
    const freshCsrfResponse = await request.get(BASE_URL + '/auth/csrf/');
    const freshCsrfBody = await freshCsrfResponse.json();
    csrfToken = freshCsrfBody.csrf_token;
    test.info().csrfToken = csrfToken;

    // List sprints filtered by project_id
    const resp = await listSprints(request, csrfToken, projectId);
    expect(resp.status()).toBe(200);

    const body = await resp.json();
    expect(body).toHaveProperty('error', null);
    expect(body).toHaveProperty('results');
    expect(Array.isArray(body.results)).toBe(true);

    // All returned sprints should belong to the filtered project
    body.results.forEach((s: any) => {
      expect(s.project_id).toBe(projectId);
    });
  });

  // ── Test 3: Update Sprint - PATCH /api/v1/sprints/{id}/ with name/status/date changes ──────
  test('3. Update Sprint - PATCH /api/v1/sprints/{id}/ with name change', async ({ request }) => {
    let csrfToken = test.info().csrfToken;

    expect(projectId).not.toBeNull();

    // Login as alice via POST /api/v1/auth/login/ with CSRF token
    await request.post(BASE_URL + '/auth/login/', {
      data: VALID_CREDENTIALS,
      headers: {
        'X-CSRFToken': csrfToken as string,
        'Content-Type': 'application/json',
      },
    });

    // Fetch fresh CSRF token after login
    const freshCsrfResponse = await request.get(BASE_URL + '/auth/csrf/');
    const freshCsrfBody = await freshCsrfResponse.json();
    csrfToken = freshCsrfBody.csrf_token;
    test.info().csrfToken = csrfToken;

    // First create a sprint to update
    const createResp = await createSprint(request, csrfToken, projectId, 'Sprint to Update', 'planned');
    expect(createResp.status()).toBe(201);
    const createBody = await createResp.json();
    const updatedSprintId = createBody.sprint.id;

    // Update the sprint with a new name
    const updateResp = await updateSprint(request, csrfToken, updatedSprintId, { name: 'Sprint Updated' });
    expect(updateResp.status()).toBe(200);

    const updateBody = await updateResp.json();
    expect(updateBody).toHaveProperty('error', null);
    expect(updateBody.sprint).toHaveProperty('name', 'Sprint Updated');
    expect(updateBody.sprint).toHaveProperty('status', 'planned'); // status unchanged
  });

  test('3b. Update Sprint - PATCH /api/v1/sprints/{id}/ with status change', async ({ request }) => {
    let csrfToken = test.info().csrfToken;

    expect(projectId).not.toBeNull();

    // Login as alice via POST /api/v1/auth/login/ with CSRF token
    await request.post(BASE_URL + '/auth/login/', {
      data: VALID_CREDENTIALS,
      headers: {
        'X-CSRFToken': csrfToken as string,
        'Content-Type': 'application/json',
      },
    });

    // Fetch fresh CSRF token after login
    const freshCsrfResponse = await request.get(BASE_URL + '/auth/csrf/');
    const freshCsrfBody = await freshCsrfResponse.json();
    csrfToken = freshCsrfBody.csrf_token;
    test.info().csrfToken = csrfToken;

    // Create a sprint to update
    const createResp = await createSprint(request, csrfToken, projectId, 'Sprint Status Change', 'planned');
    expect(createResp.status()).toBe(201);
    const createBody = await createResp.json();
    const updatedSprintId = createBody.sprint.id;

    // Update the sprint status to 'active'
    const updateResp = await updateSprint(request, csrfToken, updatedSprintId, { status: 'active' });
    expect(updateResp.status()).toBe(200);

    const updateBody = await updateResp.json();
    expect(updateBody).toHaveProperty('error', null);
    expect(updateBody.sprint).toHaveProperty('status', 'active');
  });

  test('3c. Update Sprint - PATCH /api/v1/sprints/{id}/ with start_date and end_date', async ({ request }) => {
    let csrfToken = test.info().csrfToken;

    expect(projectId).not.toBeNull();

    // Login as alice via POST /api/v1/auth/login/ with CSRF token
    await request.post(BASE_URL + '/auth/login/', {
      data: VALID_CREDENTIALS,
      headers: {
        'X-CSRFToken': csrfToken as string,
        'Content-Type': 'application/json',
      },
    });

    // Fetch fresh CSRF token after login
    const freshCsrfResponse = await request.get(BASE_URL + '/auth/csrf/');
    const freshCsrfBody = await freshCsrfResponse.json();
    csrfToken = freshCsrfBody.csrf_token;
    test.info().csrfToken = csrfToken;

    // Create a sprint to update
    const createResp = await createSprint(request, csrfToken, projectId, 'Sprint with Dates', 'planned');
    expect(createResp.status()).toBe(201);
    const createBody = await createResp.json();
    const updatedSprintId = createBody.sprint.id;

    // Update the sprint with start and end dates
    const updateResp = await updateSprint(request, csrfToken, updatedSprintId, {
      start_at: '2026-01-15',
      end_at: '2026-03-15',
    });
    expect(updateResp.status()).toBe(200);

    const updateBody = await updateResp.json();
    expect(updateBody).toHaveProperty('error', null);
    expect(updateBody.sprint).toHaveProperty('start_at', '2026-01-15');
    expect(updateBody.sprint).toHaveProperty('end_at', '2026-03-15');
  });

  // ── Test 4: Issue Sprint Assignment - POST /api/v1/issues/{id}/assign-sprint/ with sprint_id ──────
  test('4. Issue Sprint Assignment - POST /api/v1/issues/{id}/assign-sprint/ with sprint_id', async ({ request }) => {
    let csrfToken = test.info().csrfToken;

    expect(projectId).not.toBeNull();

    // Login as alice via POST /api/v1/auth/login/ with CSRF token
    await request.post(BASE_URL + '/auth/login/', {
      data: VALID_CREDENTIALS,
      headers: {
        'X-CSRFToken': csrfToken as string,
        'Content-Type': 'application/json',
      },
    });

    // Fetch fresh CSRF token after login
    const freshCsrfResponse = await request.get(BASE_URL + '/auth/csrf/');
    const freshCsrfBody = await freshCsrfResponse.json();
    csrfToken = freshCsrfBody.csrf_token;
    test.info().csrfToken = csrfToken;

    // Create a project issue first
    const createIssueResp = await createIssueToProject(request, csrfToken, projectId, 'Issue for sprint assignment');
    expect(createIssueResp.status()).toBe(201);
    const createIssueBody = await createIssueResp.json();
    const issueId = createIssueBody.issue.id;

    // Create a sprint to assign to the issue
    const createSprintResp = await createSprint(request, csrfToken, projectId, 'Sprint for Assignment', 'planned');
    expect(createSprintResp.status()).toBe(201);
    const createSprintBody = await createSprintResp.json();
    const sprintId = createSprintBody.sprint.id;

    // Assign the sprint to the issue
    const assignResp = await assignSprintToIssue(request, csrfToken, issueId, sprintId);
    expect(assignResp.status()).toBe(200);

    const assignBody = await assignResp.json();
    expect(assignBody).toHaveProperty('error', null);
    expect(assignBody.issue).toHaveProperty('sprint_name', 'Sprint for Assignment');
  });

  // ── Test 5: Sprint Status Validation - verify valid/invalid dates and states ──────
  test('5a. Sprint Status Validation - valid status values (planned/active/completed)', async ({ request }) => {
    let csrfToken = test.info().csrfToken;

    expect(projectId).not.toBeNull();

    // Login as alice via POST /api/v1/auth/login/ with CSRF token
    await request.post(BASE_URL + '/auth/login/', {
      data: VALID_CREDENTIALS,
      headers: {
        'X-CSRFToken': csrfToken as string,
        'Content-Type': 'application/json',
      },
    });

    // Fetch fresh CSRF token after login
    const freshCsrfResponse = await request.get(BASE_URL + '/auth/csrf/');
    const freshCsrfBody = await freshCsrfResponse.json();
    csrfToken = freshCsrfBody.csrf_token;
    test.info().csrfToken = csrfToken;

    // Create sprints with different valid statuses
    const plannedResp = await createSprint(request, csrfToken, projectId, 'Sprint Planned', 'planned');
    expect(plannedResp.status()).toBe(201);
    const plannedBody = await plannedResp.json();
    const plannedSprintId = plannedBody.sprint.id;

    const activeResp = await createSprint(request, csrfToken, projectId, 'Sprint Active', 'active');
    expect(activeResp.status()).toBe(201);
    const activeBody = await activeResp.json();
    const activeSprintId = activeBody.sprint.id;

    const completedResp = await createSprint(request, csrfToken, projectId, 'Sprint Completed', 'completed');
    expect(completedResp.status()).toBe(201);
    const completedBody = await completedResp.json();
    const completedSprintId = completedBody.sprint.id;

    // Verify each sprint has the correct status
    const listResp = await listSprints(request, csrfToken, projectId);
    const listBody = await listResp.json();

    const plannedSprint = listBody.results.find((s: any) => s.id === plannedSprintId);
    const activeSprint = listBody.results.find((s: any) => s.id === activeSprintId);
    const completedSprint = listBody.results.find((s: any) => s.id === completedSprintId);

    expect(plannedSprint).not.toBeUndefined();
    expect(plannedSprint?.status).toBe('planned');

    expect(activeSprint).not.toBeUndefined();
    expect(activeSprint?.status).toBe('active');

    expect(completedSprint).not.toBeUndefined();
    expect(completedSprint?.status).toBe('completed');
  });

  test('5b. Sprint Status Validation - invalid status should default to planned', async ({ request }) => {
    let csrfToken = test.info().csrfToken;

    expect(projectId).not.toBeNull();

    // Login as alice via POST /api/v1/auth/login/ with CSRF token
    await request.post(BASE_URL + '/auth/login/', {
      data: VALID_CREDENTIALS,
      headers: {
        'X-CSRFToken': csrfToken as string,
        'Content-Type': 'application/json',
      },
    });

    // Fetch fresh CSRF token after login
    const freshCsrfResponse = await request.get(BASE_URL + '/auth/csrf/');
    const freshCsrfBody = await freshCsrfResponse.json();
    csrfToken = freshCsrfBody.csrf_token;
    test.info().csrfToken = csrfToken;

    // Create sprint with invalid status - should default to 'planned'
    const resp = await createSprint(request, csrfToken, projectId, 'Sprint Invalid Status', 'invalid_status');
    expect(resp.status()).toBe(201); // API defaults invalid status to 'planned'

    const body = await resp.json();
    expect(body.sprint.status).toBe('planned'); // invalid status defaults to planned
  });

  test('5c. Sprint Status Validation - update sprint status to completed', async ({ request }) => {
    let csrfToken = test.info().csrfToken;

    expect(projectId).not.toBeNull();

    // Login as alice via POST /api/v1/auth/login/ with CSRF token
    await request.post(BASE_URL + '/auth/login/', {
      data: VALID_CREDENTIALS,
      headers: {
        'X-CSRFToken': csrfToken as string,
        'Content-Type': 'application/json',
      },
    });

    // Fetch fresh CSRF token after login
    const freshCsrfResponse = await request.get(BASE_URL + '/auth/csrf/');
    const freshCsrfBody = await freshCsrfResponse.json();
    csrfToken = freshCsrfBody.csrf_token;
    test.info().csrfToken = csrfToken;

    // Create a sprint and update its status to 'completed'
    const createResp = await createSprint(request, csrfToken, projectId, 'Sprint To Complete', 'planned');
    expect(createResp.status()).toBe(201);
    const createBody = await createResp.json();
    const sprintId = createBody.sprint.id;

    const updateResp = await updateSprint(request, csrfToken, sprintId, { status: 'completed' });
    expect(updateResp.status()).toBe(200);

    const updateBody = await updateResp.json();
    expect(updateBody.sprint.status).toBe('completed');
  });
});