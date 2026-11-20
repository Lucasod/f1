import { test, expect, request as apiRequest } from '@playwright/test';
import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';

const root = process.cwd();
const API_BASE = 'http://127.0.0.1:8000/api/v1';
const UI_BASE = process.env.F04_UI_BASE || 'http://127.0.0.1:8765';

const owner = 'issue_edit_' + randomUUID().replace(/-/g, '').slice(-8);
const outsider = 'issue_out_' + randomUUID().replace(/-/g, '').slice(-8);
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
 for n in sys.argv[1:]: U.objects.create_user(username=n,password=password)`;

test.describe('Issue Edit Modal E2E', () => {
  test.beforeAll(() => {
    // Provision test user via Django ORM before any login attempts
    django(setup, [owner, outsider], password);
  });

  test.afterAll(() => {
    const cleanup = `import os,sys
os.environ.setdefault('DJANGO_SETTINGS_MODULE','conf.settings')
import django
django.setup()
from django.contrib.auth import get_user_model
from workspaces.models import Workspace
for name in sys.argv[1:]:
 user=get_user_model().objects.filter(username=name).first()
 if user:
  for workspace in Workspace.objects.filter(memberships__user=user,memberships__role='owner').distinct(): workspace.delete()
  user.delete()`;
    django(cleanup, [owner, outsider]);
  });

  test('edit issue title via IssueEditModal and persist after reload', async ({ page, request }) => {
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
      data: { name: 'Issue Edit Workspace' },
      headers: {
        'X-CSRFToken': csrfToken,
        'Content-Type': 'application/json',
      },
    });
    expect(workspaceResp.status()).toBe(201);
    const workspaceId = (await workspaceResp.json()).workspace.id;

    // Step 6: Create project via API
    const projectResp = await request.post(API_BASE + '/projects/create/', {
      data: { name: 'Issue Edit Project', key: 'IEDT', workspace_id: workspaceId },
      headers: {
        'X-CSRFToken': csrfToken,
        'Content-Type': 'application/json',
      },
    });
    expect(projectResp.status()).toBe(201);
    const projectId = (await projectResp.json()).project.id;

    // Step 7: Create issue via API (starts in "to_do")
    const issueResp = await request.post(API_BASE + `/projects/${projectId}/issues/`, {
      data: { title: 'Original issue title' },
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

    // Step 10: Click the three-dots (⋮) button on the issue card to open IssueEditModal
    const editButtons = issueCard.locator('.issue-card__edit');
    const editButtonCount = await editButtons.count();
    console.log(`Edit button count: ${editButtonCount}`);

    if (editButtonCount === 0) {
      // Debug: list all buttons on the page
      const allButtons = page.locator('button');
      const allButtonCount = await allButtons.count();
      console.log(`Total button count: ${allButtonCount}`);
      for (let i = 0; i < Math.min(allButtonCount, 20); i++) {
        const btn = allButtons.nth(i);
        const btnText = await btn.textContent();
        console.log(`Button ${i}: text="${btnText}"`);
      }
    }

    const editButton = editButtons.first();
    await expect(editButton).toBeVisible();
    await editButton.click();

    // Debug: check if modal exists in DOM at all (even if not visible)
    const modalOverlay = page.locator('.issue-edit-modal__overlay');
    const modalCount = await modalOverlay.count();
    console.log(`Modal overlay count in DOM: ${modalCount}`);

    // Also check if any element with "issue-edit-modal" class exists
    const allModalElements = page.locator('[class*="issue-edit-modal"]');
    const allModalCount = await allModalElements.count();
    console.log(`Total elements with issue-edit-modal class: ${allModalCount}`);

    // Wait for modal to appear
    await modalOverlay.waitFor({ state: 'visible', timeout: 5000 });

    // Step 11: Edit the issue title
    const newTitle = 'Updated issue title via modal';
    await page.locator('#issue-title').fill(newTitle);
    await page.locator('#issue-description').fill('Updated description via modal');
    await page.locator('#issue-priority').selectOption('high');

    // Step 12: Click Save and wait for the update API response
    const saveButton = page.locator('.issue-edit-modal__btn--save');
    const updateResponsePromise = page.waitForResponse(API_BASE + `/issues/${issueId}/update/`);
    await saveButton.click();
    const updateResponse = await updateResponsePromise;
    expect(updateResponse.status()).toBe(200);

    // Step 13: Verify the issue title is updated in the UI
    await expect(issueCard.locator('.issue-card__title')).toContainText(newTitle);

    // Step 14: Reload the page and verify the title persists (PostgreSQL)
    await page.reload();
    await page.waitForSelector('.board-column', { state: 'visible' });
    const reloadedIssueCard = toDoColumn.locator('.issue-card').filter({ hasText: '#' + issueNumber });
    await expect(reloadedIssueCard).toBeVisible({ timeout: 5000 });
    await expect(reloadedIssueCard.locator('.issue-card__title')).toContainText(newTitle);
    await expect(reloadedIssueCard.locator('.issue-card__description')).toHaveText('Updated description via modal');
    await expect(reloadedIssueCard.locator('[data-priority]')).toHaveAttribute('data-priority', 'high');

    // Step 15: Test that the update API works correctly (PATCH with correct version)
    const detailResp = await request.get(API_BASE + `/issues/${issueId}/`, {
      headers: {
        'X-CSRFToken': csrfToken,
        'Content-Type': 'application/json',
      },
    });
    expect(detailResp.status()).toBe(200);
    const detailBody = await detailResp.json();
    expect(detailBody.issue.description).toBe('Updated description via modal');
    expect(detailBody.issue.priority).toBe('high');
    const currentVersion = detailBody.issue.version;

    const apiUpdateResp = await request.patch(API_BASE + `/issues/${issueId}/update/`, {
      data: { version: currentVersion, title: 'API-verified title' },
      headers: {
        'X-CSRFToken': csrfToken,
        'Content-Type': 'application/json',
      },
    });
    expect(apiUpdateResp.status()).toBe(200);
    const apiBody = await apiUpdateResp.json();
    expect(apiBody.error).toBeNull();
    expect(apiBody.issue.title).toBe('API-verified title');

    const staleResponse = await request.patch(API_BASE + `/issues/${issueId}/update/`, {
      data: { version: currentVersion, title: 'Stale write' },
      headers: { 'X-CSRFToken': csrfToken },
    });
    expect(staleResponse.status()).toBe(409);

    const billingResponse = await request.get(API_BASE + `/workspaces/${workspaceId}/billing/`);
    expect(billingResponse.status()).toBe(200);
    const billing = (await billingResponse.json()).billing;
    const usageResponse = await request.get(API_BASE + `/workspaces/${workspaceId}/usage/`);
    expect(usageResponse.status()).toBe(200);
    await page.goto(UI_BASE + `/workspaces/${workspaceId}/billing`);
    await expect(page.getByRole('heading', { name: 'Billing', exact: true })).toHaveCount(1);
    await expect(page.locator('.billing-page__plan')).toContainText(billing.plan, { ignoreCase: true });
    await expect(page.locator('.billing-page__usage')).toContainText('Memberships');
    await expect(page.getByText('Failed to fetch')).toHaveCount(0);

    const other = await apiRequest.newContext();
    try {
      const otherCsrf = (await (await other.get(API_BASE + '/auth/csrf/')).json()).csrf_token;
      const otherLogin = await other.post(API_BASE + '/auth/login/', {
        data: { username: outsider, password }, headers: { 'X-CSRFToken': otherCsrf },
      });
      expect(otherLogin.status()).toBe(200);
      const token = (await (await other.get(API_BASE + '/auth/csrf/')).json()).csrf_token;
      expect((await other.get(API_BASE + `/issues/${issueId}/`)).status()).toBe(404);
      expect((await other.patch(API_BASE + `/issues/${issueId}/update/`, {
        data: { version: currentVersion, title: 'Unauthorized' }, headers: { 'X-CSRFToken': token },
      })).status()).toBe(403);
    } finally {
      await other.dispose();
    }

  });
});
