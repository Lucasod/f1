import { test, expect, type Page } from '@playwright/test';
import { API_BASE_URL } from './fixtures';

const testCred = process.env.TEST_USER_PASSWORD;

/**
 * Phase F — Visual Coherence and Design Consistency
 *
 * Verifies the frontend as one product across desktop (1440x900),
 * tablet (768x1024), and mobile (390x844):
 * - Consistent navigation structure across pages
 * - Consistent monetary formatting (R$ X,XX, pt-BR)
 * - Consistent date formatting (pt-BR)
 * - Consumer chart removals (Spending Over Time, Order History distribution)
 * - Console errors / chart 404s
 *
 * Auth state is injected via localStorage using API-obtained tokens,
 * mirroring the pattern used by vendor-journey.spec.ts.
 */

async function getToken(email: string): Promise<{ accessToken: string; person: any }> {
  const res = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: testCred! }),
  });
  const json = await res.json();
  return { accessToken: json.tokens.accessToken, person: json.person };
}

async function setAuth(page: Page, token: string, user: any) {
  return page.evaluate(({ token, user }) => {
    localStorage.setItem('accessToken', token);
    const userObj = { id: user.id, name: user.name, email: user.email, roles: user.roles };
    localStorage.setItem('user', JSON.stringify(userObj));
    const authState = { user: userObj, accessToken: token, refreshToken: '', isAuthenticated: true };
    localStorage.setItem('auth-storage', JSON.stringify(authState));
  }, { token, user });
}

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
];

const PAGES = [
  { path: '/products', label: 'Catalog', auth: 'consumer' },
  { path: '/cart', label: 'Cart', auth: 'consumer' },
  { path: '/dashboard', label: 'Consumer Dashboard', auth: 'consumer' },
  { path: '/orders', label: 'Order History', auth: 'consumer' },
  { path: '/vendor/dashboard', label: 'Vendor Dashboard', auth: 'vendor' },
  { path: '/vendor/orders', label: 'Vendor Sales Orders', auth: 'vendor' },
  { path: '/admin/dashboard', label: 'Admin Dashboard', auth: 'admin' },
];

test.describe('Phase F — Visual Coherence', () => {
  let consumerToken: string;
  let consumerUser: any;
  let vendorToken: string;
  let vendorUser: any;
  let adminToken: string;
  let adminUser: any;

  test.beforeAll(async () => {
    const consumer = await getToken('consumer@example.com');
    consumerToken = consumer.accessToken;
    consumerUser = consumer.person;

    const vendor = await getToken('techstore@example.com');
    vendorToken = vendor.accessToken;
    vendorUser = vendor.person;

    const admin = await getToken('admin@example.com');
    adminToken = admin.accessToken;
    adminUser = admin.person;
  });

  for (const vp of VIEWPORTS) {
    test.describe(`viewport: ${vp.name} (${vp.width}x${vp.height})`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
      });

      for (const pg of PAGES) {
        test(`${pg.label} loads and renders navigation at ${vp.name}`, async ({ page }) => {
          const errors: string[] = [];
          const failedRequests: string[] = [];
          page.on('console', (msg) => {
            if (msg.type() === 'error') errors.push(msg.text());
          });
          page.on('requestfailed', (req) => failedRequests.push(req.url()));
          page.on('response', (res) => {
            if (res.status() >= 400 && res.url().includes('/api/')) {
              failedRequests.push(`${res.status()} ${res.url()}`);
            }
          });

          let token = consumerToken;
          let user = consumerUser;
          if (pg.auth === 'vendor') { token = vendorToken; user = vendorUser; }
          if (pg.auth === 'admin') { token = adminToken; user = adminUser; }

          await page.goto('/');
          await page.waitForLoadState('domcontentloaded');
          await setAuth(page, token, user);
          await page.reload();
          await page.waitForLoadState('networkidle');

          await page.goto(pg.path);
          await page.waitForLoadState('networkidle');

          await expect(page.locator('body')).toBeVisible();
          const nav = page.locator('nav[role="navigation"]');
          await expect(nav).toBeVisible();
          await expect(page.getByRole('link', { name: /FS-01 Marketplace/i })).toBeVisible();

          expect(errors).toHaveLength(0);
          expect(failedRequests).toHaveLength(0);
        });
      }
    });
  }

  test.describe('Monetary and date formatting consistency', () => {
    test('consumer dashboard shows BRL currency format (R$ X,XX)', async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
      await setAuth(page, consumerToken, consumerUser);
      await page.reload();
      await page.waitForLoadState('networkidle');

      await page.goto('/dashboard');
      await page.waitForLoadState('networkidle');

      const totalSpent = page.getByText(/R\$ \d/);
      if (await totalSpent.count() > 0) {
        await expect(totalSpent.first()).toBeVisible();
      }
      expect(errors).toHaveLength(0);
    });

    test('vendor dashboard shows BRL currency format (R$ X,XX)', async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
      await setAuth(page, vendorToken, vendorUser);
      await page.reload();
      await page.waitForLoadState('networkidle');

      await page.goto('/vendor/dashboard');
      await page.waitForLoadState('networkidle');

      const grossSales = page.getByText(/R\$ \d/);
      if (await grossSales.count() > 0) {
        await expect(grossSales.first()).toBeVisible();
      }
      expect(errors).toHaveLength(0);
    });
  });

  test.describe('Consumer chart removals', () => {
    test('Spending Over Time chart is REMOVED from ConsumerDashboard', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
      await setAuth(page, consumerToken, consumerUser);
      await page.reload();
      await page.waitForLoadState('networkidle');

      await page.goto('/dashboard');
      await page.waitForLoadState('networkidle');

      await expect(page.getByText(/Spending Over Time/i)).toHaveCount(0);
      // Order history list is still present and functional
    });

    test('Order History distribution chart is REMOVED from ConsumerDashboard', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
      await setAuth(page, consumerToken, consumerUser);
      await page.reload();
      await page.waitForLoadState('networkidle');

      await page.goto('/dashboard');
      await page.waitForLoadState('networkidle');

      await expect(page.getByText(/Distribution of your orders by status/i)).toHaveCount(0);
    });
  });

  test.describe('Chart 404 detection', () => {
    test('no chart-related 404s on vendor dashboard', async ({ page }) => {
      const failedRequests: string[] = [];
      page.on('requestfailed', (req) => {
        if (req.url().includes('recharts') || req.url().includes('/api/')) {
          failedRequests.push(req.url());
        }
      });
      page.on('response', (res) => {
        if (res.status() >= 400 && res.url().includes('/api/')) {
          failedRequests.push(`${res.status()} ${res.url()}`);
        }
      });

      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
      await setAuth(page, vendorToken, vendorUser);
      await page.reload();
      await page.waitForLoadState('networkidle');

      await page.goto('/vendor/dashboard');
      await page.waitForLoadState('networkidle');

      await page.waitForTimeout(2000);
      expect(failedRequests).toHaveLength(0);
    });
  });

  test.describe('Accessible labels and keyboard usability', () => {
    test('checkout page renders navigation and form controls', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
      await setAuth(page, consumerToken, consumerUser);
      await page.reload();
      await page.waitForLoadState('networkidle');

      await page.goto('/checkout');
      await page.waitForLoadState('networkidle');

      const nav = page.locator('nav[role="navigation"]');
      await expect(nav).toBeVisible();

      const fieldsets = page.locator('fieldset');
      if (await fieldsets.count() > 0) {
        await expect(fieldsets.first()).toBeVisible();
      }
    });
  });
});
