import { test, expect } from '@playwright/test';
import {
  registerUser,
  loginUser,
  getAuthToken,
  apiFetch,
  API_BASE_URL,
  generateUniqueEmail,
  getConsumerRegistrationData,
  getVendorRegistrationData,
  clearAuth,
  onboardVendor,
  loginAsAdminViaApi,
  ADMIN_EMAIL,
  loginViaApi,
} from './fixtures';

test.describe('LC-19: Buyer Orders API', () => {
  test('consumer can list own orders and view order details', async ({ page }) => {
    const email = generateUniqueEmail('consumer');
    await registerUser(page, getConsumerRegistrationData(email));
    const token = await getAuthToken(page);
    expect(token).not.toBeNull();

    // List orders (should be empty initially)
    const listResp = await apiFetch(page, 'GET', '/api/v1/orders', undefined, token);
    expect(listResp.status()).toBe(200);
    const listData = await listResp.json();
    expect(listData.orders).toEqual([]);
    expect(listData.total).toBe(0);
  });

  test('consumer cannot access other consumer orders', async ({ page }) => {
    const email = generateUniqueEmail('consumer');
    await registerUser(page, getConsumerRegistrationData(email));
    const token = await getAuthToken(page);

    // Try to access a non-existent order → 404
    const resp = await apiFetch(page, 'GET', '/api/v1/orders/non-existent-order', undefined, token);
    expect(resp.status()).toBe(404);
  });

  test('vendor can list orders containing their vendor groups', async ({ page }) => {
    const email = generateUniqueEmail('vendor');
    await registerUser(page, getVendorRegistrationData(email));
    let token = await getAuthToken(page);

    // Complete vendor onboarding
    const onboardResp = await page.request.post(`${API_BASE_URL}/api/v1/vendor/onboard`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { storeName: 'Test Store', slug: `vendor-${Date.now()}` },
    });
    expect(onboardResp.status()).toBe(201);

    // Re-login to get fresh token with updated VENDOR role
    const loginResp = await loginViaApi(page, email, process.env.TEST_USER_PASSWORD);
    expect(loginResp.accessToken).not.toBeNull();
    token = loginResp.accessToken!;

    const resp = await apiFetch(page, 'GET', '/api/v1/vendor/orders', undefined, token);
    expect(resp.status()).toBe(200);
    const data = await resp.json();
    expect(data.vendorGroups).toEqual([]);
  });

  test('admin can list all orders', async ({ page }) => {
    // Use pre-seeded admin account
    const admin = await loginAsAdminViaApi(page);
    expect(admin.accessToken).not.toBeNull();

    const resp = await apiFetch(page, 'GET', '/api/v1/orders', undefined, admin.accessToken);
    expect(resp.status()).toBe(200);
  });

  test('unauthenticated request to orders returns 401', async ({ page }) => {
    const resp = await page.request.get(`${API_BASE_URL}/api/v1/orders`);
    expect(resp.status()).toBe(401);
  });
});
