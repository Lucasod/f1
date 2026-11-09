import { test, expect } from '@playwright/test';
import {
  registerUser,
  getAuthToken,
  apiFetch,
  API_BASE_URL,
  generateUniqueEmail,
  getConsumerRegistrationData,
} from './fixtures';

test.describe('LC-21: Invoice API', () => {
  test('invoice list is admin-only', async ({ page }) => {
    const email = generateUniqueEmail('consumer');
    await registerUser(page, getConsumerRegistrationData(email));
    const token = await getAuthToken(page);

    // Consumer trying to list invoices → 403 (admin only)
    const resp = await apiFetch(page, 'GET', '/api/v1/invoices', undefined, token);
    expect(resp.status).toBe(403);
  });

  test('invoice for non-existent order returns 404', async ({ page }) => {
    const email = generateUniqueEmail('consumer');
    await registerUser(page, getConsumerRegistrationData(email));
    const token = await getAuthToken(page);

    const resp = await apiFetch(page, 'GET', '/api/v1/invoices/order/non-existent-order', undefined, token);
    expect(resp.status).toBe(404);
  });

  test('invoice download for non-existent invoice returns 404', async ({ page }) => {
    const email = generateUniqueEmail('consumer');
    await registerUser(page, getConsumerRegistrationData(email));
    const token = await getAuthToken(page);

    const resp = await apiFetch(page, 'GET', '/api/v1/invoices/non-existent-invoice/download', undefined, token);
    expect(resp.status).toBe(404);
  });
});
