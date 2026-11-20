import { test, expect, request as apiRequest } from '@playwright/test';
import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';

const root = process.cwd();
const API_BASE = 'http://127.0.0.1:8000/api/v1';
const UI_BASE = process.env.F04_UI_BASE || 'http://127.0.0.1:8765';

const owner = 'dnd_real_' + randomUUID().replace(/-/g, '').slice(-8);
const password = process.env.SECRET_TEST_PASS || 'testpass123456';

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
 for n in sys.argv[1:2]: U.objects.create_user(username=n,password=password)`;

test.describe('Real Drag-and-Drop E2E', () => {
  test.beforeAll(() => {
    // Provision test user via Django ORM before any login attempts
    django(setup, [owner], password);
  });

  test('drag issue from To do to In progress and persist after reload', async ({ page, request }) => {
    // Step 1: Bootstrap CSRF via API
    const csrfResp = await request.get(API_BASE + '/auth/csrf/');
    const csrfBody = await csrfResp.json();
    let csrfToken = csrfBody.csrf_token;

    // Step 2: Log in via API (establishes session cookie in API context)
    const loginResp = await request.post(API_BASE + '/auth/login/', {
      data: { username: owner, password },
      headers: {
        'X-CSRFToken': csrfToken,
        'Content-Type': 'application/json',
      },
    });
    expect(loginResp.status()).toBe(200);

    // Step 3: Extract sessionid cookie from API response and inject into browser context
    const loginSetHeader = loginResp.headers()['set-cookie'] || '';
    const sessionMatch = loginSetHeader.match(/sessionid=([^;]+)/);
    if (sessionMatch) {
      const sessionId = sessionMatch[1];
      await page.context().addCookies([{
        name: 'sessionid',
        value: sessionId,
        domain: '127.0.0.1',
        path: '/',
      }]);
    }

    // Step 4: Get fresh CSRF token for subsequent API calls
    const freshCsrfResp = await request.get(API_BASE + '/auth/csrf/');
    const freshCsrfBody = await freshCsrfResp.json();
    csrfToken = freshCsrfBody.csrf_token;

    // Step 5: Create workspace via API (now authenticated)
    const workspaceResp = await request.post(API_BASE + '/workspaces/create/', {
      data: { name: 'Real DnD Workspace' },
      headers: {
        'X-CSRFToken': csrfToken,
        'Content-Type': 'application/json',
      },
    });
    expect(workspaceResp.status()).toBe(201);
    const workspaceId = (await workspaceResp.json()).workspace.id;

    // Step 6: Create project via API
    const projectResp = await request.post(API_BASE + '/projects/create/', {
      data: { name: 'Real DnD Project', key: 'RDND', workspace_id: workspaceId },
      headers: {
        'X-CSRFToken': csrfToken,
        'Content-Type': 'application/json',
      },
    });
    expect(projectResp.status()).toBe(201);
    const projectId = (await projectResp.json()).project.id;

    // Step 7: Create issue via API (starts in "to_do")
    const issueResp = await request.post(API_BASE + `/projects/${projectId}/issues/`, {
      data: { title: 'Real drag-drop issue' },
      headers: {
        'X-CSRFToken': csrfToken,
        'Content-Type': 'application/json',
      },
    });
    expect(issueResp.status()).toBe(201);
    const issueBody = await issueResp.json();
    const issueId = issueBody.issue.id;
    const issueNumber = issueBody.issue.number;

    // Step 8: Navigate to board via UI (browser has sessionid cookie)
    await page.goto(UI_BASE + `/workspaces/${workspaceId}/projects/${projectId}/board`);
    await page.waitForSelector('.board-column', { state: 'visible' });

    // Step 9: Find the issue card in "To do" column
    const toDoColumn = page.locator('.board-column').filter({ hasText: 'To do' });
    const issueCard = toDoColumn.locator('.issue-card').filter({ hasText: '#' + issueNumber });
    await issueCard.waitFor({ state: 'visible' });

    // Step 10: Drag issue card from "To do" to "In progress" using REAL mouse events
    const cardBox = await issueCard.boundingBox();
    const inProgressColumn = page.locator('.board-column').filter({ hasText: 'In progress' });
    const inProgressBody = inProgressColumn.locator('.board-column__body');
    const bodyBox = await inProgressBody.boundingBox();

    expect(cardBox).toBeTruthy();
    expect(bodyBox).toBeTruthy();

    // Mouse down on card center
    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
    await page.mouse.down();

    // Mouse move to target column body center
    await page.mouse.move(bodyBox.x + bodyBox.width / 2, bodyBox.y + bodyBox.height / 2);

    // Mouse up (drop)
    await page.mouse.up();

    // Step 11: Wait for transition API call to complete
    await page.waitForResponse(API_BASE + `/issues/${issueId}/transitions/`, { timeout: 10000 });

    // Step 12: Wait for UI to reflect the move
    await page.waitForTimeout(1000);

    // Step 13: Verify issue is now in "In progress" column
    const inProgressIssueCard = inProgressColumn.locator('.issue-card').filter({ hasText: '#' + issueNumber });
    await expect(inProgressIssueCard).toBeVisible({ timeout: 5000 });

    // Verify it's no longer in "To do"
    const toDoIssueCard = toDoColumn.locator('.issue-card').filter({ hasText: '#' + issueNumber });
    await expect(toDoIssueCard).toHaveCount(0);

    // Step 14: Reload the page
    await page.reload();
    await page.waitForSelector('.board-column', { state: 'visible' });

    // Step 15: Verify issue is still in "In progress" column after reload (PostgreSQL persistence)
    const reloadedInProgressIssue = inProgressColumn.locator('.issue-card').filter({ hasText: '#' + issueNumber });
    await expect(reloadedInProgressIssue).toBeVisible({ timeout: 5000 });

    // Step 16: Drag from "In progress" to "Done" using real mouse events
    const reloadedIssueCard = inProgressColumn.locator('.issue-card').filter({ hasText: '#' + issueNumber });
    const reloadedCardBox = await reloadedIssueCard.boundingBox();
    const doneColumn = page.locator('.board-column').filter({ hasText: 'Done' });
    const doneBody = doneColumn.locator('.board-column__body');
    const doneBox = await doneBody.boundingBox();

    await page.mouse.move(reloadedCardBox.x + reloadedCardBox.width / 2, reloadedCardBox.y + reloadedCardBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(doneBox.x + doneBox.width / 2, doneBox.y + doneBox.height / 2);
    await page.mouse.up();

    // Step 17: Wait for transition API call to complete
    await page.waitForResponse(API_BASE + `/issues/${issueId}/transitions/`, { timeout: 10000 });
    await page.waitForTimeout(1000);

    // Step 18: Verify issue is now in "Done" column
    const doneIssueCard = doneColumn.locator('.issue-card').filter({ hasText: '#' + issueNumber });
    await expect(doneIssueCard).toBeVisible({ timeout: 5000 });

    const stillInProgressIssue = inProgressColumn.locator('.issue-card').filter({ hasText: '#' + issueNumber });
    await expect(stillInProgressIssue).toHaveCount(0);

    // Step 19: Reload the page - "Done" is terminal, no reverse transition allowed
    await page.reload();
    await page.waitForSelector('.board-column', { state: 'visible' });

    const reloadedDoneIssue = doneColumn.locator('.issue-card').filter({ hasText: '#' + issueNumber });
    await expect(reloadedDoneIssue).toBeVisible({ timeout: 5000 });

    const afterReloadInProgressIssue = inProgressColumn.locator('.issue-card').filter({ hasText: '#' + issueNumber });
    await expect(afterReloadInProgressIssue).toHaveCount(0);

    // Step 20: Cleanup - delete user workspaces via Django ORM
    const cleanup = `import os,sys
os.environ.setdefault('DJANGO_SETTINGS_MODULE','conf.settings')
import django
django.setup()
from django.contrib.auth import get_user_model
from workspaces.models import Workspace
U=get_user_model()
user=U.objects.filter(username="${owner}").first()
if user:
 for w in Workspace.objects.filter(memberships__user=user,memberships__role='owner').distinct(): w.delete()
 user.delete()`;
    django(cleanup, []);
  });
});
