import { test, expect } from '@playwright/test';

test('billing follows the URL workspace and renders one heading', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('f04_workspace_id', '1'));
  const paths: string[] = [];
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    paths.push(path);
    let body: unknown;
    if (path.endsWith('/auth/me/')) body = { user: { id: 1, username: 'test' } };
    else if (path.endsWith('/workspaces/')) body = { results: [{ id: 1, name: 'First', role: 'owner' }, { id: 2, name: 'Second', role: 'owner' }] };
    else if (path.endsWith('/billing/')) body = { billing: { plan: 'pro', subscription_status: 'active', cancel_at_period_end: false, paid_through: null, sync_pending: false } };
    else if (path.endsWith('/usage/')) body = { usage: { plan: 'pro', resources: { memberships: { used: 1, limit: 5 }, projects: { used: 0, limit: 2 } } } };
    else body = {};
    await route.fulfill({ json: body, headers: { 'access-control-allow-origin': 'http://127.0.0.1:8765', 'access-control-allow-credentials': 'true' } });
  });
  await page.goto('http://127.0.0.1:8765/workspaces/2/billing');
  await expect(page.getByText('Status:', { exact: false })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Select workspace' })).toHaveValue('2');
  await expect(page.getByRole('heading', { name: 'Billing', exact: true })).toHaveCount(1);
  expect(paths).toContain('/api/v1/workspaces/2/billing/');
  expect(paths).toContain('/api/v1/workspaces/2/usage/');
  expect(paths).not.toContain('/api/v1/workspaces/1/billing/');
});

test('billing layout remains usable at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path.endsWith('/auth/me/')) body = { user: { id: 1, username: 'test' } };
    else if (path.endsWith('/workspaces/')) body = { results: [{ id: 2, name: 'Second', role: 'owner' }] };
    else if (path.endsWith('/billing/')) body = { billing: { plan: 'free', subscription_status: '', cancel_at_period_end: false, paid_through: null, sync_pending: true } };
    else if (path.endsWith('/usage/')) body = { usage: { plan: 'free', resources: { memberships: { used: 1, limit: 5 }, projects: { used: 0, limit: 2 } } } };
    await route.fulfill({ json: body, headers: { 'access-control-allow-origin': 'http://127.0.0.1:8765', 'access-control-allow-credentials': 'true' } });
  });
  await page.goto('http://127.0.0.1:8765/workspaces/2/billing');
  await expect(page.getByText('No subscription')).toBeVisible();
  await expect(page.locator('.billing-page__plan')).toHaveCSS('border-radius', '14px');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('projects are scoped to the workspace in the route', async ({ page }) => {
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path.endsWith('/auth/me/')) body = { user: { id: 1, username: 'test' } };
    else if (path.endsWith('/workspaces/')) body = { results: [{ id: 1, name: 'First', role: 'owner' }, { id: 2, name: 'Second', role: 'owner' }] };
    else if (path.endsWith('/projects/')) body = { results: [{ id: 11, workspace_id: 1, name: 'First project', key: 'ONE' }, { id: 22, workspace_id: 2, name: 'Second project', key: 'TWO' }] };
    await route.fulfill({ json: body, headers: { 'access-control-allow-origin': 'http://127.0.0.1:8765', 'access-control-allow-credentials': 'true' } });
  });
  await page.goto('http://127.0.0.1:8765/workspaces/2/projects');
  await expect(page.getByText('Second project')).toBeVisible();
  await expect(page.getByText('First project')).toHaveCount(0);
});

test('creating a project sends the route workspace', async ({ page }) => {
  let payload: any;
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path.endsWith('/auth/me/')) body = { user: { id: 1, username: 'test' } };
    else if (path.endsWith('/auth/csrf/')) body = { csrf_token: '' };
    else if (path.endsWith('/workspaces/')) body = { results: [{ id: 2, name: 'Second', role: 'owner' }] };
    else if (path.endsWith('/projects/create/')) { payload = route.request().postDataJSON(); body = { project: { id: 22, workspace_id: 2, name: 'New project', key: 'NEW' } }; }
    else if (path.endsWith('/projects/')) body = { results: [] };
    await route.fulfill({ json: body, headers: { 'access-control-allow-origin': 'http://127.0.0.1:8765', 'access-control-allow-credentials': 'true' } });
  });
  await page.goto('http://127.0.0.1:8765/workspaces/2/projects');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByLabel('Project name').fill('New project');
  await page.getByLabel('Project key').fill('NEW');
  await page.getByRole('dialog').getByRole('button', { name: 'Create project' }).click();
  await expect.poll(() => payload?.workspace_id).toBe(2);
});

test('reports use the workspace in the route', async ({ page }) => {
  let payload: any;
  await page.addInitScript(() => localStorage.setItem('f04_workspace_id', '1'));
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path.endsWith('/auth/me/')) body = { user: { id: 1, username: 'test' } };
    else if (path.endsWith('/auth/csrf/')) body = { csrf_token: '' };
    else if (path.endsWith('/workspaces/')) body = { results: [{ id: 1, name: 'First', role: 'owner' }, { id: 2, name: 'Second', role: 'owner' }] };
    else if (path.endsWith('/reports/')) { payload = route.request().postDataJSON(); body = { report: { id: 3, status: 'pending' } }; }
    await route.fulfill({ json: body, headers: { 'access-control-allow-origin': 'http://127.0.0.1:8765', 'access-control-allow-credentials': 'true' } });
  });
  await page.goto('http://127.0.0.1:8765/workspaces/2/reports');
  await page.getByRole('button', { name: 'Generate Report' }).click();
  await expect.poll(() => payload?.workspace_id).toBe(2);
});

test('workspace creation is available when the list is empty', async ({ page }) => {
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path.endsWith('/auth/me/')) body = { user: { id: 1, username: 'test' } };
    else if (path.endsWith('/workspaces/')) body = { results: [] };
    await route.fulfill({ json: body, headers: { 'access-control-allow-origin': 'http://127.0.0.1:8765', 'access-control-allow-credentials': 'true' } });
  });
  await page.goto('http://127.0.0.1:8765/workspaces');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByLabel('Workspace name')).toBeEditable();
});

test('project creation is available with existing projects', async ({ page }) => {
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path.endsWith('/auth/me/')) body = { user: { id: 1, username: 'test' } };
    else if (path.endsWith('/workspaces/')) body = { results: [{ id: 2, name: 'Second', role: 'owner' }] };
    else if (path.endsWith('/projects/')) body = { results: [{ id: 22, workspace_id: 2, name: 'Second project', key: 'TWO' }] };
    await route.fulfill({ json: body, headers: { 'access-control-allow-origin': 'http://127.0.0.1:8765', 'access-control-allow-credentials': 'true' } });
  });
  await page.goto('http://127.0.0.1:8765/workspaces/2/projects');
  await expect(page.getByText('Second project')).toBeVisible();
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByLabel('Project name')).toBeEditable();
});

test('late webhook response cannot replace the new workspace', async ({ page }) => {
  let release: (() => void) | undefined;
  let firstStarted = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url());
    let body: unknown = {};
    if (url.pathname.endsWith('/auth/me/')) body = { user: { id: 1, username: 'test' } };
    else if (url.pathname.endsWith('/workspaces/')) body = { results: [{ id: 1, name: 'First', role: 'owner' }, { id: 2, name: 'Second', role: 'owner' }] };
    else if (url.pathname.endsWith('/webhooks/')) {
      const id = url.searchParams.get('workspace_id');
      if (id === '1') { firstStarted = true; await gate; }
      body = [{ id: id === '1' ? 11 : 22, url: `https://${id === '1' ? 'old' : 'new'}.example.test`, events: [], is_enabled: true }];
    }
    await route.fulfill({ json: body, headers: { 'access-control-allow-origin': 'http://127.0.0.1:8765', 'access-control-allow-credentials': 'true' } }).catch(() => {});
  });
  await page.goto('http://127.0.0.1:8765/workspaces/1/webhooks');
  await expect.poll(() => firstStarted).toBe(true);
  await page.evaluate(() => { history.pushState({}, '', '/workspaces/2/webhooks'); dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page.getByText('https://new.example.test')).toBeVisible();
  const oldResponse = page.waitForResponse(response => response.url().includes('/webhooks/?workspace_id=1'));
  release?.();
  await oldResponse;
  await expect(page.getByText('https://old.example.test')).toHaveCount(0);
  await expect(page.getByText('https://new.example.test')).toBeVisible();
});
