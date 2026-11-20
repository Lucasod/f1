import { test } from '@playwright/test';
import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';

const root = process.cwd();
const API_BASE = 'http://127.0.0.1:8000/api/v1';
const UI_BASE = 'http://127.0.0.1:8765';

const owner = 'issue_edit_dbg2_' + randomUUID().replace(/-/g, '').slice(-8);
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

test.describe('Debug2', () => {
  test.beforeAll(() => {
    django(setup, [owner], password);
  });

  test('debug click methods', async ({ page, request }) => {
    const csrfResp = await request.get(API_BASE + '/auth/csrf/');
    const csrfBody = await csrfResp.json();
    let csrfToken = csrfBody.csrf_token;
    const loginResp = await request.post(API_BASE + '/auth/login/', {
      data: { username: owner, password },
      headers: { 'X-CSRFToken': csrfToken, 'Content-Type': 'application/json' },
    });
    const loginSetHeader = loginResp.headers()['set-cookie'] || '';
    const sessionMatch = loginSetHeader.match(/sessionid=([^;]+)/);
    if (sessionMatch) {
      const sessionId = sessionMatch[1];
      await page.context().addCookies([{ name: 'sessionid', value: sessionId, domain: '127.0.0.1', path: '/' }]);
    }
    const freshCsrfResp = await request.get(API_BASE + '/auth/csrf/');
    const freshCsrfBody = await freshCsrfResp.json();
    csrfToken = freshCsrfBody.csrf_token;
    const workspaceResp = await request.post(API_BASE + '/workspaces/create/', {
      data: { name: 'Dbg2 Workspace' },
      headers: { 'X-CSRFToken': csrfToken, 'Content-Type': 'application/json' },
    });
    const workspaceId = (await workspaceResp.json()).workspace.id;
    const projectResp = await request.post(API_BASE + '/projects/create/', {
      data: { name: 'Dbg2 Project', key: 'DB2', workspace_id: workspaceId },
      headers: { 'X-CSRFToken': csrfToken, 'Content-Type': 'application/json' },
    });
    const projectId = (await projectResp.json()).project.id;
    const issueResp = await request.post(API_BASE + `/projects/${projectId}/issues/`, {
      data: { title: 'Dbg2 issue title' },
      headers: { 'X-CSRFToken': csrfToken, 'Content-Type': 'application/json' },
    });
    const issueBody = await issueResp.json();
    const issueNumber = issueBody.issue.number;

    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await page.goto(UI_BASE + `/workspaces/${workspaceId}/projects/${projectId}/board`);
    await page.waitForSelector('.board-column', { state: 'visible' });
    await page.waitForTimeout(1000);
    const toDoColumn = page.locator('.board-column').filter({ hasText: 'To do' });
    const issueCard = toDoColumn.locator('.issue-card').filter({ hasText: '#' + issueNumber });
    await issueCard.waitFor({ state: 'visible' });

    // Test 1: native evaluate click on the edit button, then synchronously check DOM
    const modalOpened = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return 'no-el';
      (el as HTMLElement).click();
      return !!document.querySelector('.issue-edit-modal__overlay');
    }, '.issue-card__edit');
    console.log('after evaluate click, modal in DOM synchronously=', modalOpened);
    await page.waitForTimeout(500);
    console.log('after evaluate click, modal count=', await page.locator('.issue-edit-modal__overlay').count());

    await page.getByRole("dialog", { name: "Edit issue" }).getByRole("button", { name: "Close" }).click();

    // Test 2: click "+ Create issue" (non-draggable button) to confirm page.click works generally
    const createBtn = page.getByRole('button', { name: '+ Create issue' });
    console.log('createBtn visible=', await createBtn.isVisible());
    await createBtn.click();
    console.log('after createBtn click, page errors=', pageErrors);
    await page.waitForTimeout(500);
  });
});
