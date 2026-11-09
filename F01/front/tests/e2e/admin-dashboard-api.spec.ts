import { test, expect } from '@playwright/test';
import { apiFetch, API_BASE_URL, generateUniqueEmail } from './fixtures';

test.describe('LC-25: Admin Dashboard API', () => {
  test('admin metrics endpoint', async ({ page }) => {
    // Register admin directly via API
    const userPw = 'TestPassword123!';
    const registerResp = await page.request.post(`${API_BASE_URL}/api/v1/auth/register`, {
      data: {
        name: 'Admin E2E',
        taxIdType: 'CNPJ',
        taxIdValue: '11222333000262',
        email: generateUniqueEmail('admin'),
        password: userPw,
        role: 'ADMIN',
      },
    });
    expect(registerResp.status).toBe(201);
    const registerData = await registerResp.json();
    const token = registerData.tokens.accessToken;

    const resp = await apiFetch(page, 'GET', '/api/v1/admin/metrics', undefined, token);
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data).toHaveProperty('orders');
    expect(data).toHaveProperty('vendors');
    expect(data).toHaveProperty('products');
  });

  test('consumer cannot access admin metrics', async ({ page }) => {
    const email = generateUniqueEmail('consumer');
    const userPw = 'TestPassword123!';
    await page.request.post(`${API_BASE_URL}/api/v1/auth/register`, {
      data: {
        name: 'Consumer E2E',
        taxIdType: 'CPF',
        taxIdValue: '52998224725',
        email,
        password: userPw,
        role: 'CONSUMER',
      },
    });
    const loginResp = await page.request.post(`${API_BASE_URL}/api/v1/auth/login`, {
      data: { email, password: userPw },
    });
    expect(loginResp.status).toBe(200);
    const loginData = await loginResp.json();
    const token = loginData.tokens.accessToken;

    const resp = await apiFetch(page, 'GET', '/api/v1/admin/metrics', undefined, token);
    expect(resp.status).toBe(403);
  });
});
