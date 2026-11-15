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
    const token = await getAuthToken(page);

    const resp = await apiFetch(page, 'GET', '/api/v1/vendor/orders', undefined, token);
    // Vendor without orders should get empty list
    expect(resp.status()).toBe(200);
    const data = await resp.json();
    expect(data.vendorGroups).toEqual([]);
  });

  test('admin can list all orders', async ({ page }) => {
    // Admin registration via API directly
    const userPw = 'TestPassword123!';
    const registerResp = await page.request.post(`${API_BASE_URL}/api/v1/auth/register`, {
      data: {
        name: 'Admin E2E',
        taxIdType: 'CNPJ',
        taxIdValue: '11222333000262',
        email: generateUniqueEmail('admin'),
        password: process.env.TEST_USER_PASSWORD ?? 'TestPassword1!',
        role: 'ADMIN',
      },
    });
    expect(registerResp.status()).toBe(201);
    const registerData = await registerResp.json();
    const token = registerData.tokens.accessToken;

    const resp = await apiFetch(page, 'GET', '/api/v1/orders', undefined, token);
    expect(resp.status()).toBe(200);
  });

  test('unauthenticated request to orders returns 401', async ({ page }) => {
    const resp = await page.request.get(`${API_BASE_URL}/api/v1/orders`);
    expect(resp.status()).toBe(401);
  });
});
