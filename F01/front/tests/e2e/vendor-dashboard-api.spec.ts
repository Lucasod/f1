import { test, expect } from '@playwright/test';
import {
  registerUser,
  getAuthToken,
  apiFetch,
  API_BASE_URL,
  generateUniqueEmail,
  getVendorRegistrationData,
  getConsumerRegistrationData,
  onboardVendor,
  loginViaApi,
} from './fixtures';

test.describe('LC-24: Vendor Dashboard API', () => {
  test('vendor dashboard financial endpoint', async ({ page }) => {
    const email = generateUniqueEmail('vendor');
    const password = process.env.TEST_USER_PASSWORD;
    await registerUser(page, { ...getVendorRegistrationData(email), password });
    await onboardVendor(page, 'Test Store', `test-store-${Date.now()}`);
    // Re-login to get token with VENDOR role
    const loginResult = await loginViaApi(page, email, password);
    expect(loginResult).not.toBeNull();
    const token = loginResult!.accessToken;

    const resp = await apiFetch(page, 'GET', '/api/v1/financial/vendor-dashboard', undefined, token);
    expect(resp.status()).toBe(200);
    const data = await resp.json();
    expect(data).toHaveProperty('grossSales');
    expect(data).toHaveProperty('netExpectedAmount');
    expect(data).toHaveProperty('receivedInStripe');
    expect(data).toHaveProperty('pendingDistribution');
    expect(data).toHaveProperty('bankPayout');
    expect(data).toHaveProperty('history');
  });

  test('consumer cannot access vendor dashboard', async ({ page }) => {
    const email = generateUniqueEmail('consumer');
    await registerUser(page, { ...getConsumerRegistrationData(email), role: 'CONSUMER' as const });
    const token = await getAuthToken(page);

    const resp = await apiFetch(page, 'GET', '/api/v1/financial/vendor-dashboard', undefined, token);
    expect(resp.status()).toBe(403);
  });
});
