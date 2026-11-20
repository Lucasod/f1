import { test, expect } from '@playwright/test';
import {
  ADMIN_EMAIL,
  API_BASE_URL,
  getConsumerRegistrationData,
  loginAsAdminViaApi,
  apiFetch,
} from './fixtures';

test.describe('LC-25: Admin Dashboard API', () => {
  const ADMIN_PASSWORD = process.env.TEST_USER_PASSWORD;

  test('admin metrics endpoint', async ({ page }) => {
    test.skip(
      !ADMIN_PASSWORD,
      'TEST_USER_PASSWORD is not configured in this shell; the admin seed credential ' +
        'lives in the Docker backend .env and cannot be read here. Skipping admin-login-dependent assertion.'
    );

    // Log in as Admin via API (POST /api/v1/auth/login) using the seeded admin@example.com account
    const admin = await loginAsAdminViaApi(page);
    expect(admin.accessToken).not.toBeNull();
    expect(admin.person?.roles).toContain('ADMIN');

    const token = admin.accessToken!;

    // Access admin metrics via API (GET /api/v1/admin/metrics)
    const resp = await apiFetch(page, 'GET', '/api/v1/admin/metrics', undefined, token);
    expect(resp.status()).toBe(200);

    // Verify metrics data: orders, vendors, products counts
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
      `[LC-25] Admin metrics for ${ADMIN_EMAIL}: orders=${data.orders}, vendors=${data.vendors}, products=${data.products}`
    );
  });

  test('consumer cannot access admin metrics', async ({ page }) => {
    // Register a consumer via the public API (role is forced to CONSUMER).
    const consumerData = { ...getConsumerRegistrationData(), password: process.env.TEST_USER_PASSWORD };
    const registerResp = await page.request.post(`${API_BASE_URL}/api/v1/auth/register`, {
      data: consumerData,
    });
    expect(registerResp.status()).toBe(201);

    // Log in as the consumer.
    const loginResp = await page.request.post(`${API_BASE_URL}/api/v1/auth/login`, {
      headers: { 'Content-Type': 'application/json' },
      data: { email: consumerData.email, password: consumerData.password },
    });
    expect(loginResp.status()).toBe(200);
    const loginData = await loginResp.json();
    const token = loginData.tokens.accessToken;
    expect(token).toBeTruthy();

    // Consumer must not access the admin metrics endpoint.
    const resp = await apiFetch(page, 'GET', '/api/v1/admin/metrics', undefined, token);
    expect(resp.status()).toBe(403);
  });
});
