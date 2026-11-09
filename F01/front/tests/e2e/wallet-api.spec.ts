import { test, expect } from '@playwright/test';
import {
  registerUser,
  getAuthToken,
  apiFetch,
  API_BASE_URL,
  generateUniqueEmail,
  getVendorRegistrationData,
} from './fixtures';

test.describe('LC-22: Wallet API', () => {
  test('wallet balance returns 0 for vendor (MP-28)', async ({ page }) => {
    const email = generateUniqueEmail('vendor');
    await registerUser(page, getVendorRegistrationData(email));
    const token = await getAuthToken(page);

    const resp = await apiFetch(page, 'GET', '/api/v1/wallet/balance', undefined, token);
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.balance).toBe(0);
    expect(data.ownerId).toBeDefined();
  });

  test('wallet transactions list for vendor', async ({ page }) => {
    const email = generateUniqueEmail('vendor');
    await registerUser(page, getVendorRegistrationData(email));
    const token = await getAuthToken(page);

    const resp = await apiFetch(page, 'GET', '/api/v1/wallet/transactions', undefined, token);
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.transactions).toEqual([]);
  });

  test('wallet reconcile for vendor', async ({ page }) => {
    const email = generateUniqueEmail('vendor');
    await registerUser(page, getVendorRegistrationData(email));
    const token = await getAuthToken(page);

    const resp = await apiFetch(page, 'GET', '/api/v1/wallet/reconcile', undefined, token);
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.materialized).toBe(0);
    expect(data.computed).toBe(0);
    expect(data.ok).toBe(true);
  });

  test('consumer cannot access wallet endpoints (vendor only)', async ({ page }) => {
    const email = generateUniqueEmail('consumer');
    await registerUser(page, { ...getConsumerRegistrationData(email), role: 'CONSUMER' as const });
    const token = await getAuthToken(page);

    const resp = await apiFetch(page, 'GET', '/api/v1/wallet/balance', undefined, token);
    expect(resp.status).toBe(403);
  });
});
