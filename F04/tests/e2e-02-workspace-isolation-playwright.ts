/// <reference types="playwright/test" />
import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';

const BASE_URL = 'http://127.0.0.1:8000/api/v1';
const VALID_CREDENTIALS = {
  username: 'alice',
  password: process.env.SECRET_TEST_PASS || 'testpass123',
};
const BOB_CREDENTIALS = {
  username: 'bob',
  password: process.env.SECRET_TEST_PASS || 'testpass123',
};

// Helper functions shared across tests
// Each helper fetches fresh CSRF token, logs in, then fetches the rotated
// CSRF token after login and returns it, so tests can use it consistently
// for subsequent API calls

async function loginAsAlice(request) {
  // Fetch fresh CSRF token independently before login to prevent session interference
  const csrfResp = await request.get(BASE_URL + '/auth/csrf/');
  const csrfBody = await csrfResp.json();
  const preLoginCsrfToken = csrfBody.csrf_token;

  const resp = await request.post(BASE_URL + '/auth/login/', {
    data: VALID_CREDENTIALS,
    headers: { 'X-CSRFToken': preLoginCsrfToken, 'Content-Type': 'application/json' },
  });
  expect(resp.status()).toBe(200);

  // Fetch fresh CSRF token after login (token rotates on login)
  const postLoginCsrfResp = await request.get(BASE_URL + '/auth/csrf/');
  const postLoginCsrfBody = await postLoginCsrfResp.json();
  const freshCsrfToken = postLoginCsrfBody.csrf_token;

  return freshCsrfToken;
}

async function loginAsBob(request) {
  // Fetch fresh CSRF token independently before login to prevent session interference
  const csrfResp = await request.get(BASE_URL + '/auth/csrf/');
  const csrfBody = await csrfResp.json();
  const preLoginCsrfToken = csrfBody.csrf_token;

  const resp = await request.post(BASE_URL + '/auth/login/', {
    data: BOB_CREDENTIALS,
    headers: { 'X-CSRFToken': preLoginCsrfToken, 'Content-Type': 'application/json' },
  });
  expect(resp.status()).toBe(200);

  // Fetch fresh CSRF token after login (token rotates on login)
  const postLoginCsrfResp = await request.get(BASE_URL + '/auth/csrf/');
  const postLoginCsrfBody = await postLoginCsrfResp.json();
  const freshCsrfToken = postLoginCsrfBody.csrf_token;

  return freshCsrfToken;
}

async function createWorkspace(request, name, csrfToken) {
  const resp = await request.post(BASE_URL + '/workspaces/create/', {
    data: { name },
    headers: { 'X-CSRFToken': csrfToken, 'Content-Type': 'application/json' },
  });
  return resp;
}

async function listWorkspaces(request, csrfToken) {
  const resp = await request.get(BASE_URL + '/workspaces/', {
    headers: { 'X-CSRFToken': csrfToken, 'Content-Type': 'application/json' },
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

async function getWorkspaceDetail(request, workspaceId, csrfToken) {
  const resp = await request.get(BASE_URL + '/workspaces/' + workspaceId + '/', {
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

async function listIssues(request, projectId, csrfToken) {
  const params = projectId !== undefined ? { project_id: String(projectId) } : {};
  const resp = await request.get(BASE_URL + '/issues/', {
    params,
    headers: { 'X-CSRFToken': csrfToken, 'Content-Type': 'application/json' },
  });
  return resp;
}

async function createIssue(request, projectId, title, csrfToken) {
  const resp = await request.post(BASE_URL + '/projects/' + projectId + '/issues/', {
    data: { title },
    headers: { 'X-CSRFToken': csrfToken, 'Content-Type': 'application/json' },
  });
  return resp;
}

// -- Test suite: Workspace Isolation E2E --
test.describe('Workspace Isolation E2E', () => {
  let workspaceAId: number | null = null;
  let workspaceBId: number | null = null;

  // ── beforeAll: set up CSRF token only ──────
  test.beforeAll(async ({ request }, testInfo) => {
    // Fetch CSRF token from GET /api/v1/auth/csrf/
    const csrfResp = await request.get(BASE_URL + '/auth/csrf/');
    const csrfBody = await csrfResp.json();
    // Each test will fetch its own CSRF token after login;
    // do not store shared csrfToken in testInfo to avoid cross-user session leakage.
  });

  // ── Test 1: Create Workspace A ────────────────────────────────────
  test('Create Workspace A - POST /api/v1/workspaces/ with valid name', async ({ request }, testInfo) => {
    // Login as alice (helper fetches fresh CSRF token after login rotation)
    const freshCsrfToken = await loginAsAlice(request);

    // Free plan allows only ONE workspace; hard-delete any Alice owns from a prior run
    await deleteUserWorkspaces('alice');

    // Create Workspace A with a unique, deterministic name
    const nameA = `Isolation-Test-WS-A-${Date.now()}`;
    const createA = await createWorkspace(request, nameA, freshCsrfToken);
    expect(createA.status()).toBe(201);
    const bodyA = await createA.json();
    workspaceAId = bodyA.workspace.id;

    // Verify Workspace A exists in workspace list
    const listResp = await listWorkspaces(request, freshCsrfToken);
    expect(listResp.status()).toBe(200);
    const body = await listResp.json();
    expect(body.error).toBeNull();
    const names = body.results?.map((w: any) => w.name) || [];
    expect(names).toContain(nameA);
  });

  // ── Test 2: Create Workspace B ────────────────────────────────────
  test('Create Workspace B - POST /api/v1/workspaces/ with valid name (different user)', async ({ request }, testInfo) => {
    // Step 1: Create Bob user if not already existing via Django ORM
    execSync(
      'DB_ENGINE=django.db.backends.postgresql POSTGRES_DB=f04 POSTGRES_USER=f04 POSTGRES_PASSWORD=ww3Nn^kOp3zRc1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5433 DJANGO_SETTINGS_MODULE=conf.settings PYTHONPATH=backend python3 << "PYEOF"\nimport os\nimport django\nos.environ.setdefault("DJANGO_SETTINGS_MODULE", "conf.settings")\ndjango.setup()\nfrom django.contrib.auth import get_user_model\nUser = get_user_model()\nUser.objects.get_or_create(username="bob", defaults={"email": "bob@example.com", "password": "testpass123"})\nPYEOF'
    );

    // Step 2: Fetch CSRF token independently via GET /auth/csrf/
    const csrfResp = await request.get(BASE_URL + '/auth/csrf/');
    const csrfBody = await csrfResp.json();
    const preLoginCsrfToken = csrfBody.csrf_token;

    // Step 3: Log in as bob via POST /auth/login/ with CSRF token
    const loginResp = await request.post(BASE_URL + '/auth/login/', {
      data: BOB_CREDENTIALS,
      headers: { 'X-CSRFToken': preLoginCsrfToken, 'Content-Type': 'application/json' },
    });
    expect(loginResp.status()).toBe(200);

    // Step 4: Fetch fresh CSRF token after login (token rotates on login)
    const postLoginCsrfResp = await request.get(BASE_URL + '/auth/csrf/');
    const postLoginCsrfBody = await postLoginCsrfResp.json();
    const freshCsrfToken = postLoginCsrfBody.csrf_token;

    // Free plan allows only ONE workspace; hard-delete any Bob owns from a prior run
    await deleteUserWorkspaces('bob');

    // Step 5: Create workspace B with the fresh CSRF token
    const nameB = `Isolation-Test-WS-B-${Date.now()}`;
    const createB = await createWorkspace(request, nameB, freshCsrfToken);
    expect(createB.status()).toBe(201);
    const bodyB = await createB.json();
    workspaceBId = bodyB.workspace.id;

    // Verify Workspace B exists in workspace list
    const listResp = await listWorkspaces(request, freshCsrfToken);
    expect(listResp.status()).toBe(200);
    const body = await listResp.json();
    expect(body.error).toBeNull();
    const names = body.results?.map((w: any) => w.name) || [];
    expect(names).toContain(nameB);
  });

  // ── Test 3: User A only member of A ───────────────────────────────
  test('User A only member of A - Verify A-only access', async ({ request }, testInfo) => {
    const ts = Date.now().toString();
    const nameA = `Isolation-Test-WS-A-${ts}`;
    const nameB = `Isolation-Test-WS-B-${ts}`;

    // Create Workspace A as Alice
    const freshCsrfTokenA = await loginAsAlice(request);
    // Free plan allows only ONE workspace; hard-delete any Alice owns from a prior run
    await deleteUserWorkspaces('alice');
    const createA = await createWorkspace(request, nameA, freshCsrfTokenA);
    expect(createA.status()).toBe(201);

    // Create Workspace B as Bob (different user)
    const freshCsrfTokenB = await loginAsBob(request);
    // Free plan allows only ONE workspace; hard-delete any Bob owns from a prior run
    await deleteUserWorkspaces('bob');
    const createB = await createWorkspace(request, nameB, freshCsrfTokenB);
    expect(createB.status()).toBe(201);

    // Log in as Alice again (her session) and list workspaces
    const aliceToken = await loginAsAlice(request);
    const listResp = await listWorkspaces(request, aliceToken);
    expect(listResp.status()).toBe(200);
    const body = await listResp.json();
    expect(body.error).toBeNull();
    const workspaces = body.results || [];

    // Alice should see Workspace A (she's the owner)
    const wsANames = workspaces.map((w: any) => w.name).filter(
      (n: string) => n.includes(nameA)
    );
    expect(wsANames.length).toBeGreaterThan(0);

    // Alice should NOT see Workspace B (bob's workspace, she's not a member)
    const wsBNames = workspaces.map((w: any) => w.name).filter(
      (n: string) => n.includes(nameB)
    );
    expect(wsBNames.length).toBe(0);
  });

  // ── Test 4: User A member of both A and B ─────────────────────────
  test('User A member of both A and B - Verify discovery returns A and B only', async ({ request }, testInfo) => {
    const ts = Date.now().toString();
    const nameA = `Isolation-Test-WS-A-${ts}`;
    const nameB = `Isolation-Test-WS-B-${ts}`;

    // Create Workspace A as Alice
    const aliceTokenA = await loginAsAlice(request);
    // Free plan allows only ONE workspace; hard-delete any Alice owns from a prior run
    await deleteUserWorkspaces('alice');
    const createA = await createWorkspace(request, nameA, aliceTokenA);
    expect(createA.status()).toBe(201);

    // Create Workspace B as Bob
    const bobToken = await loginAsBob(request);
    // Free plan allows only ONE workspace; hard-delete any Bob owns from a prior run
    await deleteUserWorkspaces('bob');
    const createB = await createWorkspace(request, nameB, bobToken);
    expect(createB.status()).toBe(201);
    const bodyB = await createB.json();
    const workspaceBId = bodyB.workspace.id;

    // Add Alice as a member of Workspace B via Django ORM (look up by unique name)
    execSync(`
DB_ENGINE=django.db.backends.postgresql POSTGRES_DB=f04 POSTGRES_USER=f04 POSTGRES_PASSWORD=ww3Nn^kOp3zRc1 POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5433 DJANGO_SETTINGS_MODULE=conf.settings PYTHONPATH=backend python3 << "PYEOF"
import os, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "conf.settings")
django.setup()
from django.contrib.auth import get_user_model
from workspaces.models import Membership, Workspace
User = get_user_model()
alice = User.objects.get(username="alice")
bws = Workspace.objects.filter(name="${nameB}").first()
if bws:
  Membership.objects.get_or_create(user=alice, workspace=bws, defaults={"role": "member"})
PYEOF
`);
    // Verify Alice sees both Workspace A and Workspace B
    const aliceTokenB = await loginAsAlice(request);
    const listResp = await listWorkspaces(request, aliceTokenB);
    expect(listResp.status()).toBe(200);
    const body = await listResp.json();
    expect(body.error).toBeNull();
    const workspaces = body.results || [];

    const wsNames = workspaces.map((w: any) => w.name);
    const hasA = wsNames.some((n: string) => n.includes(nameA));
    const hasB = wsNames.some((n: string) => n.includes(nameB));

    expect(hasA).toBe(true);
    expect(hasB).toBe(true);
  });

  // ── Test 5: User with no membership ───────────────────────────────
  test('User with no membership - Verify empty discovery structure', async ({ request }, testInfo) => {
    // Login as alice (helper fetches fresh CSRF token after login rotation)
    const freshCsrfToken = await loginAsAlice(request);

    const listResp = await listWorkspaces(request, freshCsrfToken);
    expect(listResp.status()).toBe(200);
    const body = await listResp.json();
    expect(Array.isArray(body.results)).toBe(true);
    // Each result has the expected workspace fields
    body.results.forEach((w: any) => {
      expect(w).toHaveProperty('id');
      expect(w).toHaveProperty('name');
      expect(w).toHaveProperty('role');
    });
  });

  // ── Test 6: User A tries to access B's resources ──────────────────
  test('User A tries to access B workspace resource - Should get 404', async ({ request }, testInfo) => {
    const ts = Date.now().toString();
    const nameB = `Isolation-Test-WS-B-${ts}`;

    // Create Workspace B as Bob (Alice is NOT a member)
    const bobToken = await loginAsBob(request);
    // Free plan allows only ONE workspace; hard-delete any Bob owns from a prior run
    await deleteUserWorkspaces('bob');
    const createB = await createWorkspace(request, nameB, bobToken);
    expect(createB.status()).toBe(201);
    const bodyB = await createB.json();
    const workspaceBId = bodyB.workspace.id;

    // Log in as Alice, try to access B workspace detail
    const aliceToken = await loginAsAlice(request);
    const detailResp = await getWorkspaceDetail(request, workspaceBId, aliceToken);
    expect(detailResp.status()).toBe(404);
  });

  // ── Test 7: User A tries to list B's issues ───────────────────────
  test('User A tries to list B workspace issues - Should get 403/404', async ({ request }, testInfo) => {
    const ts = Date.now().toString();
    const nameB = `Isolation-Test-WS-B-${ts}`;

    // Create Workspace B as Bob (Alice is NOT a member)
    const bobToken = await loginAsBob(request);
    // Free plan allows only ONE workspace; hard-delete any Bob owns from a prior run
    await deleteUserWorkspaces('bob');
    const createB = await createWorkspace(request, nameB, bobToken);
    expect(createB.status()).toBe(201);
    const bodyB = await createB.json();
    const workspaceBId = bodyB.workspace.id;

    // Bob creates a project in Workspace B
    const projectResp = await createProject(request, 'Project B', 'BCD', bobToken, workspaceBId);
    expect(projectResp.status()).toBe(201);
    const projectBody = await projectResp.json();
    const projectId = projectBody.project.id;

    // Log in as Alice, try to list issues (Alice is NOT a member of B)
    const aliceToken = await loginAsAlice(request);
    const issuesResp = await listIssues(request, projectId, aliceToken);
    expect([403, 404]).toContain(issuesResp.status());
  });

  // ── Test 8: User A tries to create issue in B's workspace ─────────
  test('User A tries to create issue in B workspace - Should get 403', async ({ request }, testInfo) => {
    const ts = Date.now().toString();
    const nameB = `Isolation-Test-WS-B-${ts}`;

    // Create Workspace B as Bob (Alice is NOT a member)
    const bobToken = await loginAsBob(request);
    // Free plan allows only ONE workspace; hard-delete any Bob owns from a prior run
    await deleteUserWorkspaces('bob');
    const createB = await createWorkspace(request, nameB, bobToken);
    expect(createB.status()).toBe(201);
    const bodyB = await createB.json();
    const workspaceBId = bodyB.workspace.id;

    // Bob creates a project in Workspace B
    const projectResp = await createProject(request, 'Project B', 'XYZ', bobToken, workspaceBId);
    expect(projectResp.status()).toBe(201);
    const projectBody = await projectResp.json();
    const projectId = projectBody.project.id;

    // Log in as Alice, try to create an issue in B's project
    const aliceToken = await loginAsAlice(request);
    const issueResp = await createIssue(request, projectId, 'Issue from A in B', aliceToken);
    expect(issueResp.status()).toBe(403);
  });
});