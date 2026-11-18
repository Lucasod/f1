import { test, expect } from '@playwright/test';
import {
  ADMIN_EMAIL,
  API_BASE_URL,
  getConsumerRegistrationData,
  loginAsAdminViaApi,
  apiFetch,
} from './fixtures';

/**
 * LC-32: Admin Dashboard Metrics — Golden Path Step 32 ("Admin checks aggregate metrics").
 *
 * Covers:
 *   - Admin logs in via API (POST /api/v1/auth/login) using the seeded
 *     admin@example.com account (password from TEST_USER_PASSWORD).
 *   - Admin reads aggregate metrics via API (GET /api/v1/admin/metrics) -> 200.
 *   - Metrics payload contains orders, vendors, products counts.
 *   - Consumer and Vendor are denied (403) on the admin metrics endpoint.
 *   - Admin is denied (403) on consumer-only and vendor-only endpoints.
 *
 * NOTE: The admin-login-dependent tests are skipped when TEST_USER_PASSWORD is
 * not configured in the running shell. The credential lives in the Docker
 * backend's .env (not readable here), so admin login cannot be exercised in
 * this environment without it.
 */

test.describe('LC-32: Admin Dashboard Metrics (Golden Path Step 32)', () => {
  const ADMIN_PASSWORD = process.env.TEST_USER_PASSWORD;

  // ------------------------------------------------------------------
  // Admin access to aggregate metrics
  // ------------------------------------------------------------------

  test('admin can access metrics endpoint (200)', async ({ page }) => {
    test.skip(
      !ADMIN_PASSWORD,
      'TEST_USER_PASSWORD is not configured in this shell; the admin seed credential ' +
        'lives in the Docker backend .env and cannot be read here. Skipping admin-login-dependent assertion.'
    );

    // 1. Log in as Admin via API (POST /api/v1/auth/login)
    const admin = await loginAsAdminViaApi(page);
    expect(admin.accessToken).not.toBeNull();
    expect(admin.person?.roles).toContain('ADMIN');

    const token = admin.accessToken!;

    // 2. Access admin metrics via API (GET /api/v1/admin/metrics)
    const resp = await apiFetch(page, 'GET', '/api/v1/admin/metrics', undefined, token);
    expect(resp.status()).toBe(200);

    // 3. Verify metrics data: orders, vendors, products counts
    const data = await resp.json();
    expect(data).toHaveProperty('orders');
    expect(data).toHaveProperty('vendors');
    expect(data).toHaveProperty('products');
    expect(typeof data.orders).toBe('number');
    expect(typeof data.vendors).toBe('number');
    expect(typeof data.products).toBe('number');
    expect(data.orders).toBeGreaterThanOrEqual(0);
    expect(data.vendors).toBeGreaterThanOrEqual(0);
    expect(data.products).toBeGreaterThanOrEqual(0);

    console.log(
      `[Step 32] Admin metrics for ${ADMIN_EMAIL}: orders=${data.orders}, vendors=${data.vendors}, products=${data.products}`
    );
  });

  // ------------------------------------------------------------------
  // Admin-only access: consumer / vendor get 403
  // ------------------------------------------------------------------

  test('consumer gets 403 on admin metrics', async ({ page }) => {
    // Register a consumer via the public API (role is forced to CONSUMER).
    const consumerData = { ...getConsumerRegistrationData(), password: process.env.TEST_USER_PASSWORD };
    const registerResp = await page.request.post(`${API_BASE_URL}/api/v1/auth/register`, {
      data: consumerData,
    });
    expect(registerResp.status()).toBe(201);

    // Log in as the consumer.
    const loginResp = await page.request.post(`${API_BASE_URL}/api/v1/auth/login`, {
      headers: { 'Content-Type': 'application/json' },
      data: { email: consumerData.email, password: process.env.TEST_USER_PASSWORD },
    });
    expect(loginResp.status()).toBe(200);
    const loginData = await loginResp.json();
    const token = loginData.tokens.accessToken;
    expect(token).toBeTruthy();

    // Consumer must not access the admin metrics endpoint.
    const resp = await apiFetch(page, 'GET', '/api/v1/admin/metrics', undefined, token);
    expect(resp.status()).toBe(403);
  });

  test('vendor gets 403 on admin metrics', async ({ page }) => {
    // Register a consumer, then onboard as a vendor so the account holds the
    // VENDOR role (public registration cannot grant ADMIN or VENDOR directly).
    const consumerData = { ...getConsumerRegistrationData(), password: process.env.TEST_USER_PASSWORD };
    const registerResp = await page.request.post(`${API_BASE_URL}/api/v1/auth/register`, {
      data: consumerData,
    });
    expect(registerResp.status()).toBe(201);

    const loginResp = await page.request.post(`${API_BASE_URL}/api/v1/auth/login`, {
      headers: { 'Content-Type': 'application/json' },
      data: { email: consumerData.email, password: process.env.TEST_USER_PASSWORD },
    });
    expect(loginResp.status()).toBe(200);
    const loginData = await loginResp.json();
    const token = loginData.tokens.accessToken;

    const slug = `vendor-store-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const onboardResp = await page.request.post(`${API_BASE_URL}/api/v1/vendor/onboard`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: { storeName: 'E2E Vendor Store', slug },
    });
    expect(onboardResp.status()).toBe(201);

    // A vendor (non-admin) must not access the admin metrics endpoint.
    const resp = await apiFetch(page, 'GET', '/api/v1/admin/metrics', undefined, token);
    expect(resp.status()).toBe(403);
  });

  // ------------------------------------------------------------------
  // Admin cannot access consumer-only / vendor-only endpoints
  // ------------------------------------------------------------------

  test('admin cannot access consumer-only endpoint', async ({ page }) => {
    test.skip(
      !ADMIN_PASSWORD,
      'TEST_USER_PASSWORD is not configured in this shell; skipping admin-login-dependent assertion.'
    );

    const admin = await loginAsAdminViaApi(page);
    expect(admin.accessToken).not.toBeNull();

    // GET /api/v1/orders/summary is requireConsumer (CONSUMER only) -> admin gets 403.
    const resp = await apiFetch(
      page,
      'GET',
      '/api/v1/orders/summary',
      undefined,
      admin.accessToken
    );
    expect(resp.status()).toBe(403);
  });

  test('admin cannot access vendor-only endpoint', async ({ page }) => {
    test.skip(
      !ADMIN_PASSWORD,
      'TEST_USER_PASSWORD is not configured in this shell; skipping admin-login-dependent assertion.'
    );

    const admin = await loginAsAdminViaApi(page);
    expect(admin.accessToken).not.toBeNull();

    // GET /api/v1/vendor/orders is requireVendor -> admin gets 403.
    const resp = await apiFetch(
      page,
      'GET',
      '/api/v1/vendor/orders',
      undefined,
      admin.accessToken
    );
    expect(resp.status()).toBe(403);
  });
});
