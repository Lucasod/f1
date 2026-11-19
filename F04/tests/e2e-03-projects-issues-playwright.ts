/// <reference types="playwright/test" />
import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';

const BASE_URL = 'http://127.0.0.1:8000/api/v1';

// Credentials from .env: SECRET_TEST_PASS=testpass123
const VALID_CREDENTIALS = {
  username: 'alice',
  password: process.env.SECRET_TEST_PASS || 'testpass123',
};

test.describe('Projects, Boards & Issues E2E', () => {
  test.beforeAll(async ({ request }, testInfo) => {
    // --- Step 1: Fetch initial CSRF token only ---
    const csrfResponse = await request.get(BASE_URL + '/auth/csrf/');
    const csrfBody = await csrfResponse.json();
    testInfo.csrfToken = csrfBody.csrf_token;
  });

  test('1. Create Project - POST /api/v1/projects/ with valid name and key', async ({ request }, testInfo) => {
    // --- Step 2: Login with initial CSRF token ---
    await request.post(BASE_URL + '/auth/login/', {
      data: VALID_CREDENTIALS,
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': testInfo.csrfToken,
      },
    });

    // --- Step 3: Fetch FRESH CSRF token after login ---
    const freshCsrfResponse = await request.get(BASE_URL + '/auth/csrf/');
    const freshCsrfBody = await freshCsrfResponse.json();
    const freshCsrfToken = freshCsrfBody.csrf_token;

    // Create a workspace first (project creation requires workspace membership)
    // Free plan allows only ONE workspace; hard-delete any Alice owns from a prior run
    await deleteUserWorkspaces('alice');
    const workspaceResp = await createWorkspace(request, freshCsrfToken, 'Test workspace for project');
    const workspaceBody = await workspaceResp.json();
    const workspaceId = workspaceBody.workspace.id;

    // Create project with valid name and key
    const resp = await createProject(request, freshCsrfToken, 'Acme Project', 'ABC', workspaceId);

    // Assert status code 201
    expect(resp.status()).toBe(201);

    // Assert response structure
    const body = await resp.json();
    expect(body).toHaveProperty('error', null);
    expect(body).toHaveProperty('project');
    expect(body.project).toHaveProperty('name', 'Acme Project');
    expect(body.project).toHaveProperty('key', 'ABC');
    expect(body.project).toHaveProperty('id');
    expect(body.project).toHaveProperty('workspace_name');
  });

  test('2. List Projects - GET /api/v1/projects/', async ({ request }, testInfo) => {
    // --- Step 2: Login with initial CSRF token ---
    await request.post(BASE_URL + '/auth/login/', {
      data: VALID_CREDENTIALS,
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': testInfo.csrfToken,
      },
    });

    // --- Step 3: Fetch FRESH CSRF token after login ---
    const freshCsrfResponse = await request.get(BASE_URL + '/auth/csrf/');
    const freshCsrfBody = await freshCsrfResponse.json();
    const freshCsrfToken = freshCsrfBody.csrf_token;

    // Create workspace and project first
    // Free plan allows only ONE workspace; hard-delete any Alice owns from a prior run
    await deleteUserWorkspaces('alice');
    const workspaceResp = await createWorkspace(request, freshCsrfToken, 'Test workspace for listing');
    const workspaceBody = await workspaceResp.json();
    const workspaceId = workspaceBody.workspace.id;
    await createProject(request, freshCsrfToken, 'Listed Project', 'XYZ', workspaceId);

    // List projects
    const resp = await listProjects(request, freshCsrfToken);

    // Assert status code 200
    expect(resp.status()).toBe(200);

    // Assert response structure
    const body = await resp.json();
    expect(body).toHaveProperty('error', null);
    expect(body).toHaveProperty('results');
    expect(Array.isArray(body.results)).toBe(true);
    // Should see at least the project we just created
    const projectNames = body.results.map((p: any) => p.name);
    expect(projectNames).toContain('Listed Project');
  });

  test('3. Create Issue - POST /api/v1/projects/{id}/issues/ with valid data', async ({ request }, testInfo) => {
    // --- Step 2: Login with initial CSRF token ---
    await request.post(BASE_URL + '/auth/login/', {
      data: VALID_CREDENTIALS,
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': testInfo.csrfToken,
      },
    });

    // --- Step 3: Fetch FRESH CSRF token after login ---
    const freshCsrfResponse = await request.get(BASE_URL + '/auth/csrf/');
    const freshCsrfBody = await freshCsrfResponse.json();
    const freshCsrfToken = freshCsrfBody.csrf_token;

    // Create workspace and project
    // Free plan allows only ONE workspace; hard-delete any Alice owns from a prior run
    await deleteUserWorkspaces('alice');
    const workspaceResp = await createWorkspace(request, freshCsrfToken, 'Test workspace for issue');
    const workspaceBody = await workspaceResp.json();
    const workspaceId = workspaceBody.workspace.id;
    const createProjectResp = await createProject(request, freshCsrfToken, 'Issue Test Project', 'ITP', workspaceId);
    expect(createProjectResp.status()).toBe(201);
    const projectBody = await createProjectResp.json();
    const projectId = projectBody.project.id;

    // Create issue with valid data
    const resp = await createIssue(request, freshCsrfToken, projectId, 'New test issue');

    // Assert status code 201
    expect(resp.status()).toBe(201);

    // Assert response structure
    const body = await resp.json();
    expect(body).toHaveProperty('error', null);
    expect(body).toHaveProperty('issue');
    expect(body.issue).toHaveProperty('title', 'New test issue');
    expect(body.issue).toHaveProperty('status');
    expect(body.issue).toHaveProperty('priority');
    expect(body.issue).toHaveProperty('id');
    expect(body.issue).toHaveProperty('number');
    expect(body.issue).toHaveProperty('board_name');
    expect(body.issue).toHaveProperty('board_key');
  });

  test('4. List Issues - GET /api/v1/issues/', async ({ request }, testInfo) => {
    // --- Step 2: Login with initial CSRF token ---
    await request.post(BASE_URL + '/auth/login/', {
      data: VALID_CREDENTIALS,
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': testInfo.csrfToken,
      },
    });

    // --- Step 3: Fetch FRESH CSRF token after login ---
    const freshCsrfResponse = await request.get(BASE_URL + '/auth/csrf/');
    const freshCsrfBody = await freshCsrfResponse.json();
    const freshCsrfToken = freshCsrfBody.csrf_token;

    // Create workspace, project, and issue
    // Free plan allows only ONE workspace; hard-delete any Alice owns from a prior run
    await deleteUserWorkspaces('alice');
    const workspaceResp = await createWorkspace(request, freshCsrfToken, 'Test workspace for issue listing');
    const workspaceBody = await workspaceResp.json();
    const workspaceId = workspaceBody.workspace.id;
    const createProjectResp = await createProject(request, freshCsrfToken, 'Issue List Project', 'ILP', workspaceId);
    expect(createProjectResp.status()).toBe(201);
    const projectBody = await createProjectResp.json();
    const projectId = projectBody.project.id;

    const ts4 = Date.now().toString();
    const title1 = `List Issue ${ts4} one`;
    const title2 = `List Issue ${ts4} two`;

    const createIssue1 = await createIssue(request, freshCsrfToken, projectId, title1);
    expect(createIssue1.status()).toBe(201);
    const createIssue2 = await createIssue(request, freshCsrfToken, projectId, title2);
    expect(createIssue2.status()).toBe(201);

    // List issues
    const resp = await listIssues(request, freshCsrfToken, projectId);

    // Assert status code 200
    expect(resp.status()).toBe(200);

    // Assert response structure
    const body = await resp.json();
    expect(body).toHaveProperty('error', null);
    expect(body).toHaveProperty('results');
    expect(Array.isArray(body.results)).toBe(true);
    // Should see at least the two issues we created
    const issueTitles = body.results.map((i: any) => i.title);
    expect(issueTitles).toContain(title1);
    expect(issueTitles).toContain(title2);
  });

  test('5. List Issues Filter by Status - GET /api/v1/issues/?status=in_progress', async ({ request }, testInfo) => {
    // --- Step 2: Login with initial CSRF token ---
    await request.post(BASE_URL + '/auth/login/', {
      data: VALID_CREDENTIALS,
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': testInfo.csrfToken,
      },
    });

    // --- Step 3: Fetch FRESH CSRF token after login ---
    const freshCsrfResponse = await request.get(BASE_URL + '/auth/csrf/');
    const freshCsrfBody = await freshCsrfResponse.json();
    const freshCsrfToken = freshCsrfBody.csrf_token;

    // Create workspace, project, and issue
    // Free plan allows only ONE workspace; hard-delete any Alice owns from a prior run
    await deleteUserWorkspaces('alice');
    const workspaceResp = await createWorkspace(request, freshCsrfToken, 'Test workspace for status filter');
    const workspaceBody = await workspaceResp.json();
    const workspaceId = workspaceBody.workspace.id;
    const createProjectResp = await createProject(request, freshCsrfToken, 'Status Filter Project', 'SFP', workspaceId);
    expect(createProjectResp.status()).toBe(201);
    const projectBody = await createProjectResp.json();
    const projectId = projectBody.project.id;

    // Create issue with valid data
    const issueResp = await createIssue(request, freshCsrfToken, projectId, 'Issue for status filter');
    const issueBody = await issueResp.json();
    const issueId = issueBody.issue.id;

    // Transition issue to in_progress status
    await request.post(BASE_URL + '/issues/' + issueId + '/transitions/', {
      data: { status: 'in_progress' },
      headers: {
        'X-CSRFToken': freshCsrfToken,
        'Content-Type': 'application/json',
      },
    });

    // List issues filtered by status=in_progress
    const resp = await listIssues(request, freshCsrfToken, projectId, 'in_progress');

    // Assert status code 200
    expect(resp.status()).toBe(200);

    // Assert response structure
    const body = await resp.json();
    expect(body).toHaveProperty('error', null);
    expect(body).toHaveProperty('results');
    expect(Array.isArray(body.results)).toBe(true);
    // Should see at least the issue with in_progress status
    const issueTitles = body.results.map((i: any) => i.title);
    expect(issueTitles).toContain('Issue for status filter');
  });

  test('6. List Issues Filter by Priority - GET /api/v1/issues/?priority=high', async ({ request }, testInfo) => {
    // --- Step 2: Login with initial CSRF token ---
    await request.post(BASE_URL + '/auth/login/', {
      data: VALID_CREDENTIALS,
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': testInfo.csrfToken,
      },
    });

    // --- Step 3: Fetch FRESH CSRF token after login ---
    const freshCsrfResponse = await request.get(BASE_URL + '/auth/csrf/');
    const freshCsrfBody = await freshCsrfResponse.json();
    const freshCsrfToken = freshCsrfBody.csrf_token;

    // Create workspace, project, and issue
    // Free plan allows only ONE workspace; hard-delete any Alice owns from a prior run
    await deleteUserWorkspaces('alice');
    const workspaceResp = await createWorkspace(request, freshCsrfToken, 'Test workspace for priority filter');
    const workspaceBody = await workspaceResp.json();
    const workspaceId = workspaceBody.workspace.id;
    const createProjectResp = await createProject(request, freshCsrfToken, 'Priority Filter Project', 'PFP', workspaceId);
    expect(createProjectResp.status()).toBe(201);
    const projectBody = await createProjectResp.json();
    const projectId = projectBody.project.id;

    // Create issue with high priority
    await createIssue(request, freshCsrfToken, projectId, 'High priority issue', 'high');

    // List issues filtered by priority=high
    const resp = await listIssues(request, freshCsrfToken, projectId, undefined, 'high');

    // Assert status code 200
    expect(resp.status()).toBe(200);

    // Assert response structure
    const body = await resp.json();
    expect(body).toHaveProperty('error', null);
    expect(body).toHaveProperty('results');
    expect(Array.isArray(body.results)).toBe(true);
    // Should see at least the issue with high priority
    const issueTitles = body.results.map((i: any) => i.title);
    expect(issueTitles).toContain('High priority issue');
  });

  test('7. Issue Detail - GET /api/v1/issues/{id}/', async ({ request }, testInfo) => {
    // --- Step 2: Login with initial CSRF token ---
    await request.post(BASE_URL + '/auth/login/', {
      data: VALID_CREDENTIALS,
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': testInfo.csrfToken,
      },
    });

    // --- Step 3: Fetch FRESH CSRF token after login ---
    const freshCsrfResponse = await request.get(BASE_URL + '/auth/csrf/');
    const freshCsrfBody = await freshCsrfResponse.json();
    const freshCsrfToken = freshCsrfBody.csrf_token;

    // Create workspace, project, and issue
    // Free plan allows only ONE workspace; hard-delete any Alice owns from a prior run
    await deleteUserWorkspaces('alice');
    const workspaceResp = await createWorkspace(request, freshCsrfToken, 'Test workspace for issue detail');
    const workspaceBody = await workspaceResp.json();
    const workspaceId = workspaceBody.workspace.id;
    const createProjectResp = await createProject(request, freshCsrfToken, 'Issue Detail Project', 'IDP', workspaceId);
    expect(createProjectResp.status()).toBe(201);
    const projectBody = await createProjectResp.json();
    const projectId = projectBody.project.id;

    const createIssueResp = await createIssue(request, freshCsrfToken, projectId, 'Detail test issue');
    expect(createIssueResp.status()).toBe(201);
    const issueBody = await createIssueResp.json();
    const issueId = issueBody.issue.id;

    // Get issue detail
    const resp = await issueDetail(request, freshCsrfToken, issueId);

    // Assert status code 200
    expect(resp.status()).toBe(200);

    // Assert response structure
    const body = await resp.json();
    expect(body).toHaveProperty('error', null);
    expect(body).toHaveProperty('issue');
    expect(body.issue).toHaveProperty('id', issueId);
    expect(body.issue).toHaveProperty('title', 'Detail test issue');
    expect(body.issue).toHaveProperty('status');
    expect(body.issue).toHaveProperty('priority');
    expect(body.issue).toHaveProperty('number');
    expect(body.issue).toHaveProperty('board_name');
    expect(body.issue).toHaveProperty('board_key');
  });

  test('8. Update Issue - PATCH /api/v1/issues/{id}/update/ with valid data', async ({ request }, testInfo) => {
    // --- Step 2: Login with initial CSRF token ---
    await request.post(BASE_URL + '/auth/login/', {
      data: VALID_CREDENTIALS,
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': testInfo.csrfToken,
      },
    });

    // --- Step 3: Fetch FRESH CSRF token after login ---
    const freshCsrfResponse = await request.get(BASE_URL + '/auth/csrf/');
    const freshCsrfBody = await freshCsrfResponse.json();
    const freshCsrfToken = freshCsrfBody.csrf_token;

    // Create workspace, project, and issue
    // Free plan allows only ONE workspace; hard-delete any Alice owns from a prior run
    await deleteUserWorkspaces('alice');
    const workspaceResp = await createWorkspace(request, freshCsrfToken, 'Test workspace for issue update');
    const workspaceBody = await workspaceResp.json();
    const workspaceId = workspaceBody.workspace.id;
    const createProjectResp = await createProject(request, freshCsrfToken, 'Issue Update Project', 'IUP', workspaceId);
    expect(createProjectResp.status()).toBe(201);
    const projectBody = await createProjectResp.json();
    const projectId = projectBody.project.id;

    const createIssueResp = await createIssue(request, freshCsrfToken, projectId, 'Updatable issue');
    expect(createIssueResp.status()).toBe(201);
    const issueBody = await createIssueResp.json();
    const issueId = issueBody.issue.id;
    const currentVersion = issueBody.issue.version;

    // Update issue with valid data
    const resp = await updateIssue(request, freshCsrfToken, issueId, currentVersion, { title: 'Updated issue title' });

    // Assert status code 200
    expect(resp.status()).toBe(200);

    // Assert response structure
    const body = await resp.json();
    expect(body).toHaveProperty('error', null);
    expect(body).toHaveProperty('issue');
    expect(body.issue).toHaveProperty('title', 'Updated issue title');
    expect(body.issue).toHaveProperty('version', currentVersion + 1);
  });
});

// Helper functions shared across tests
async function createWorkspace(request, csrfToken, name = 'Test Workspace') {
  const resp = await request.post(BASE_URL + '/workspaces/create/', {
    data: { name },
    headers: {
      'X-CSRFToken': csrfToken as string,
      'Content-Type': 'application/json',
    },
  });
  return resp;
}

async function listWorkspaces(request, csrfToken) {
  const resp = await request.get(BASE_URL + '/workspaces/', {
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
    'DB_ENGINE=django.db.backends.postgresql POSTGRES_DB=f04 POSTGRES_USER=f04 POSTGRES_PASSWORD=ww3Nn^kOp3zRc1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5433 DJANGO_SETTINGS_MODULE=conf.settings PYTHONPATH=backend python3 << "PYEOF"\nimport os\nimport django\nos.environ.setdefault("DJANGO_SETTINGS_MODULE", "conf.settings")\ndjango.setup()\nfrom django.contrib.auth import get_user_model\nfrom workspaces.models import Workspace\nUser = get_user_model()\nuser = User.objects.filter(username="' + username + '").first()\nif user:\n  for ws in Workspace.objects.filter(memberships__user=user, memberships__role="owner").distinct():\n    ws.delete()\nPYEOF'
  );
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

async function listProjects(request, csrfToken) {
  const resp = await request.get(BASE_URL + '/projects/', {
    headers: {
      'X-CSRFToken': csrfToken as string,
      'Content-Type': 'application/json',
    },
  });
  return resp;
}

async function createIssue(request, csrfToken, projectId, title, priority?) {
  const data: Record<string, any> = { title };
  if (priority) data.priority = priority;
  const resp = await request.post(BASE_URL + '/projects/' + projectId + '/issues/', {
    data,
    headers: {
      'X-CSRFToken': csrfToken as string,
      'Content-Type': 'application/json',
    },
  });
  return resp;
}

async function listIssues(request, csrfToken, projectId?, status?, priority?) {
  const params: Record<string, string> = {};
  if (projectId !== undefined) params.project_id = String(projectId);
  if (status) params.status = status;
  if (priority) params.priority = priority;
  const resp = await request.get(BASE_URL + '/issues/', {
    params,
    headers: {
      'X-CSRFToken': csrfToken as string,
      'Content-Type': 'application/json',
    },
  });
  return resp;
}

async function issueDetail(request, csrfToken, issueId) {
  const resp = await request.get(BASE_URL + '/issues/' + issueId + '/', {
    headers: {
      'X-CSRFToken': csrfToken as string,
      'Content-Type': 'application/json',
    },
  });
  return resp;
}

async function updateIssue(request, csrfToken, issueId, version, data) {
  const payload = { ...data, version };
  const resp = await request.patch(BASE_URL + '/issues/' + issueId + '/update/', {
    data: payload,
    headers: {
      'X-CSRFToken': csrfToken as string,
      'Content-Type': 'application/json',
    },
  });
  return resp;
}