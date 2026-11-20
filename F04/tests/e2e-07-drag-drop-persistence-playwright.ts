import { test, expect } from '@playwright/test';
import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';

const root = process.cwd();
const base = 'http://127.0.0.1:8000/api/v1';

// Unique owner per run so repeated runs do not collide on the free-plan
// single-workspace limit.
const owner = 'dnd_' + randomUUID().replace(/-/g, '').slice(0, 12);
const outsider = 'dnd_other_' + randomUUID().replace(/-/g, '').slice(0, 12);
const password = process.env.SECRET_TEST_PASS || randomUUID();

function django(code: string, args: string[], input?: string) {
  execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'backend', 'python', '-c', code, ...args],
    { cwd: root, input, stdio: ['pipe', 'pipe', 'pipe'] }
  );
}

const setup = `import os,sys
os.environ.setdefault('DJANGO_SETTINGS_MODULE','conf.settings')
import django
django.setup()
from django.contrib.auth import get_user_model
from django.db import transaction
U=get_user_model()
password=sys.stdin.read()
with transaction.atomic():
 for n in sys.argv[1:]: U.objects.create_user(username=n,password=password)`;

const cleanup = `import os,sys
os.environ.setdefault('DJANGO_SETTINGS_MODULE','conf.settings')
import django
django.setup()
from django.contrib.auth import get_user_model
from workspaces.models import Workspace
U=get_user_model()
for n in sys.argv[1:]:
 u=U.objects.filter(username=n).first()
 if u:
  for w in Workspace.objects.filter(memberships__user=u,memberships__role='owner').distinct(): w.delete()
  u.delete()`;

async function login(ctx: any, user: string) {
  let response = await ctx.get(base + '/auth/csrf/');
  let token = (await response.json()).csrf_token;
  response = await ctx.post(base + '/auth/login/', {
    data: { username: user, password },
    headers: { 'X-CSRFToken': token },
  });
  expect(response.status()).toBe(200);
  token = (await (await ctx.get(base + '/auth/csrf/')).json()).csrf_token;
  return token;
}

async function createWorkspace(request: any, csrfToken: string, name: string) {
  return request.post(base + '/workspaces/create/', {
    data: { name },
    headers: {
      'X-CSRFToken': csrfToken,
      'Content-Type': 'application/json',
    },
  });
}

async function createProject(
  request: any,
  csrfToken: string,
  name: string,
  key: string,
  workspaceId: string | number
) {
  return request.post(base + '/projects/create/', {
    data: { name, key, workspace_id: workspaceId },
    headers: {
      'X-CSRFToken': csrfToken,
      'Content-Type': 'application/json',
    },
  });
}

async function createIssue(
  request: any,
  csrfToken: string,
  projectId: string | number,
  title: string
) {
  return request.post(base + `/projects/${projectId}/issues/`, {
    data: { title },
    headers: {
      'X-CSRFToken': csrfToken,
      'Content-Type': 'application/json',
    },
  });
}

async function deleteUserWorkspaces(username: string) {
  execFileSync(
    'bash',
    ['-c', `POSTGRES_PORT=5433 DJANGO_SETTINGS_MODULE=conf.settings PYTHONPATH=backend python3 << "PYEOF"
import os
import django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "conf.settings")
django.setup()
from django.contrib.auth import get_user_model
from workspaces.models import Workspace
User = get_user_model()
user = User.objects.filter(username="${username}").first()
if user:
  for ws in Workspace.objects.filter(memberships__user=user, memberships__role="owner").distinct():
    ws.delete()
PYEOF`]
  );
}

test.describe('Drag-and-Drop Persistence E2E', () => {
  test.beforeAll(() => {
    // Provision TWO test users via Django ORM before any login attempts.
    django(setup, [owner, outsider], password);
  });

  test('transitions issue statuses and persists across reload (drag-and-drop equivalent)', async ({ request }) => {
    const csrfToken = await login(request, owner);

    // Clear any workspaces left from a prior run (free plan allows one).
    await deleteUserWorkspaces(owner);

    // Create workspace -> project -> issue via API
    const workspaceResp = await createWorkspace(
      request,
      csrfToken,
      'DragDrop Test Workspace'
    );
    expect(workspaceResp.status()).toBe(201);
    const workspaceId = (await workspaceResp.json()).workspace.id;

    const projectResp = await createProject(
      request,
      csrfToken,
      'DragDrop Project',
      'DDP',
      workspaceId
    );
    expect(projectResp.status()).toBe(201);
    const projectId = (await projectResp.json()).project.id;

    const issueResp = await createIssue(
      request,
      csrfToken,
      projectId,
      'Drag and drop persistence issue'
    );
    expect(issueResp.status()).toBe(201);
    const issueId = (await issueResp.json()).issue.id;

    const currentIssue = async () => {
      const resp = await request.get(base + `/issues/?project_id=${projectId}`, {
        headers: { 'X-CSRFToken': csrfToken, 'Content-Type': 'application/json' },
      });
      expect(resp.status()).toBe(200);
      const body = await resp.json();
      const list = body.results || body;
      return list.find((item: any) => item.id === issueId);
    };

    // Issue starts in "to_do"
    let issue = await currentIssue();
    expect(issue).toBeDefined();
    expect(issue.status).toBe('to_do');

    // Transition to "in_progress": HTTP 200 + status persisted
    const inProgressResp = await request.post(
      base + `/issues/${issueId}/transitions/`,
      {
        data: { status: 'in_progress' },
        headers: {
          'X-CSRFToken': csrfToken,
          'Content-Type': 'application/json',
        },
      }
    );
    expect(inProgressResp.status()).toBe(200);
    issue = await currentIssue();
    expect(issue).toBeDefined();
    expect(issue.status).toBe('in_progress');

    // Transition to "done": HTTP 200 + status persisted
    const doneResp = await request.post(base + `/issues/${issueId}/transitions/`, {
      data: { status: 'done' },
      headers: {
        'X-CSRFToken': csrfToken,
        'Content-Type': 'application/json',
      },
    });
    expect(doneResp.status()).toBe(200);
    issue = await currentIssue();
    expect(issue).toBeDefined();
    expect(issue.status).toBe('done');

    // Attempt "done -> to_do": must be rejected with 400 (terminal state)
    const backResp = await request.post(base + `/issues/${issueId}/transitions/`, {
      data: { status: 'to_do' },
      headers: {
        'X-CSRFToken': csrfToken,
        'Content-Type': 'application/json',
      },
    });
    expect(backResp.status()).toBe(400);

    // Status is still "done" (terminal state preserved)
    issue = await currentIssue();
    expect(issue).toBeDefined();
    expect(issue.status).toBe('done');

    // Cleanup: hard-delete workspaces owned by this user via Django ORM
    await deleteUserWorkspaces(owner);
  });

  test('outsider cannot transition owner issue (tenant isolation)', async ({ request }) => {
    // Log in as owner (user 1).
    const ownerCsrf = await login(request, owner);

    // Clear any workspaces left from a prior run (free plan allows one).
    await deleteUserWorkspaces(owner);

    // Create workspace -> project -> issue via API as owner.
    const workspaceResp = await createWorkspace(
      request,
      ownerCsrf,
      'DragDrop Isolation Workspace'
    );
    expect(workspaceResp.status()).toBe(201);
    const workspaceId = (await workspaceResp.json()).workspace.id;

    const projectResp = await createProject(
      request,
      ownerCsrf,
      'DragDrop Project',
      'DDI',
      workspaceId
    );
    expect(projectResp.status()).toBe(201);
    const projectId = (await projectResp.json()).project.id;

    const issueResp = await createIssue(
      request,
      ownerCsrf,
      projectId,
      'Cross-user transition issue'
    );
    expect(issueResp.status()).toBe(201);
    const issueId = (await issueResp.json()).issue.id;

    // Issue starts in "to_do"
    const issueListResp = await request.get(base + `/issues/?project_id=${projectId}`, {
      headers: { 'X-CSRFToken': ownerCsrf, 'Content-Type': 'application/json' },
    });
    expect(issueListResp.status()).toBe(200);
    const issueListBody = await issueListResp.json();
    const issueList = issueListBody.results || issueListBody;
    const issue = issueList.find((item: any) => item.id === issueId);
    expect(issue).toBeDefined();
    expect(issue.status).toBe('to_do');

    // Log in as outsider (user 2) via API.
    const outsiderCsrf = await login(request, outsider);

    // Outsider attempts to transition owner's issue to "in_progress": must be rejected with 403 (tenant isolation).
    const transitionResp = await request.post(base + `/issues/${issueId}/transitions/`, {
      data: { status: 'in_progress' },
      headers: {
        'X-CSRFToken': outsiderCsrf,
        'Content-Type': 'application/json',
      },
    });
    expect(transitionResp.status()).toBe(403);

    // Cleanup: hard-delete workspaces owned by both users via Django ORM.
    await deleteUserWorkspaces(owner);
    await deleteUserWorkspaces(outsider);
  });
});
