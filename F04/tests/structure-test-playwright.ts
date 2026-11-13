import { test, expect } from '@playwright/test';
import { getValidCredentials, getInvalidCredentials } from './test-credentials';

const BASE_URL = 'http://127.0.0.1:8000/api/v1';

const VALID_CREDENTIALS = getValidCredentials();

const INVALID_CREDENTIALS = getInvalidCredentials();

test.describe('Authentication E2E', () => {
  test.beforeAll(async ({ request }, testInfo) => {
    const csrfResp = await request.get(BASE_URL + '/auth/csrf/');
    const csrfBody = await csrfResp.json();
    testInfo.csrfToken = csrfBody.csrf_token;
  });

  test('login valid - session active', async ({ request }, testInfo) => {
    const csrfToken = testInfo.csrfToken;
    // Login first to establish session
    await request.post(BASE_URL + '/auth/login/', {
      data: VALID_CREDENTIALS,
      headers: {
        'X-CSRFToken': csrfToken as string,
        'Content-Type': 'application/json',
      },
    });
    const freshCsrfResponse = await request.get(BASE_URL + '/auth/csrf/');
    const freshCsrfBody = await freshCsrfResponse.json();
    const freshCsrfToken = freshCsrfBody.csrf_token;
    const response = await request.get(BASE_URL + '/auth/me/', {
      headers: { 'X-CSRFToken': freshCsrfToken as string },
    });
    expect(response.status()).toBe(200);
  });

  test('login invalid - invalid credentials rejected', async ({ request }, testInfo) => {
    const csrfToken = testInfo.csrfToken;
    const response = await request.post(BASE_URL + '/auth/login/', {
      data: INVALID_CREDENTIALS,
      headers: {
        'X-CSRFToken': csrfToken as string,
        'Content-Type': 'application/json',
      },
    });
    expect(response.status()).toBe(400);
  });

  test('logout - POST /api/v1/auth/logout/ with active session', async ({ request }, testInfo) => {
    const csrfToken = testInfo.csrfToken;
    // Login first to establish session
    await request.post(BASE_URL + '/auth/login/', {
      data: VALID_CREDENTIALS,
      headers: {
        'X-CSRFToken': csrfToken as string,
        'Content-Type': 'application/json',
      },
    });
    const freshCsrfResponse = await request.get(BASE_URL + '/auth/csrf/');
    const freshCsrfBody = await freshCsrfResponse.json();
    const freshCsrfToken = freshCsrfBody.csrf_token;
    const response = await request.post(BASE_URL + '/auth/logout/', {
      headers: { 'X-CSRFToken': freshCsrfToken as string },
    });
    expect(response.status()).toBe(204);
  });

  test('me authenticated - GET /api/v1/auth/me/ with valid session', async ({ request }, testInfo) => {
    const csrfToken = testInfo.csrfToken;
    // Login first to establish session
    await request.post(BASE_URL + '/auth/login/', {
      data: VALID_CREDENTIALS,
      headers: {
        'X-CSRFToken': csrfToken as string,
        'Content-Type': 'application/json',
      },
    });
    const freshCsrfResponse = await request.get(BASE_URL + '/auth/csrf/');
    const freshCsrfBody = await freshCsrfResponse.json();
    const freshCsrfToken = freshCsrfBody.csrf_token;
    const response = await request.get(BASE_URL + '/auth/me/', {
      headers: { 'X-CSRFToken': freshCsrfToken as string },
    });
    expect(response.status()).toBe(200);
  });

  test('me anonymous - GET /api/v1/auth/me/ without authentication', async ({ request }) => {
    const response = await request.get(BASE_URL + '/auth/me/');
    expect([401, 403]).toContain(response.status());
  });

  test('CSRF token - GET /api/v1/auth/csrf/', async ({ request }) => {
    const response = await request.get(BASE_URL + '/auth/csrf/');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('csrf_token');
  });
});
