/// <reference types="playwright/test" />
import { test, expect } from "@playwright/test";
import { getValidCredentials, getInvalidCredentials } from "./test-credentials";

const BASE_URL = 'http://127.0.0.1:8000/api/v1';

const VALID_CREDENTIALS = getValidCredentials();

const INVALID_CREDENTIALS = getInvalidCredentials();

test.describe('Authentication E2E', () => {
  test('login valid - session active', async ({ request }) => {
    // Fetch CSRF token independently
    const csrfResponse = await request.get(BASE_URL + '/auth/csrf/');
    const csrfBody = await csrfResponse.json();
    const csrfToken = csrfBody.csrf_token;

    // Log in as alice via POST /auth/login/ with CSRF token
    await request.post(BASE_URL + '/auth/login/', {
      data: VALID_CREDENTIALS,
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': csrfToken,
      },
    });

    // Verify the session is active by calling me endpoint
    const response = await request.get(BASE_URL + '/auth/me/', {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('user');
    expect(body.error).toBeNull();
    expect(body.user).toHaveProperty('username', 'alice');
    expect(body.user).toHaveProperty('id');
  });

  test('login invalid - invalid credentials rejected', async ({ request }) => {
    // Test invalid credentials without workspace creation
    const response = await request.post(BASE_URL + '/auth/login/', {
      data: INVALID_CREDENTIALS,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    expect(response.status()).toBe(400);

    const body = await response.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toHaveProperty('code', 'invalid_credentials');
  });

  test('logout - POST /api/v1/auth/logout/ with active session', async ({ request }) => {
    // Fetch CSRF token independently
    const csrfResponse = await request.get(BASE_URL + '/auth/csrf/');
    const csrfBody = await csrfResponse.json();
    const csrfToken = csrfBody.csrf_token;

    // Log in as alice via POST /auth/login/ with CSRF token
    await request.post(BASE_URL + '/auth/login/', {
      data: VALID_CREDENTIALS,
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': csrfToken,
      },
    });

    // Fetch fresh CSRF token after login (token rotates on login)
    const logoutCsrfResponse = await request.get(BASE_URL + '/auth/csrf/');
    const logoutCsrfBody = await logoutCsrfResponse.json();
    const logoutCsrfToken = logoutCsrfBody.csrf_token;

    const response = await request.post(BASE_URL + '/auth/logout/', {
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': logoutCsrfToken,
      },
    });

    expect(response.status()).toBe(204);

    const body = await response.json().catch(() => ({}));
    expect(body).toEqual({});
  });

  test('me authenticated - GET /api/v1/auth/me/ with valid session', async ({ request }) => {
    // Fetch CSRF token independently
    const csrfResponse = await request.get(BASE_URL + '/auth/csrf/');
    const csrfBody = await csrfResponse.json();
    const csrfToken = csrfBody.csrf_token;

    // Log in as alice via POST /auth/login/ with CSRF token
    await request.post(BASE_URL + '/auth/login/', {
      data: VALID_CREDENTIALS,
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': csrfToken,
      },
    });

    const response = await request.get(BASE_URL + '/auth/me/', {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('user');
    expect(body.error).toBeNull();
    expect(body.user).toHaveProperty('username', 'alice');
    expect(body.user).toHaveProperty('id');
  });

  test('me anonymous - GET /api/v1/auth/me/ without authentication', async ({ request }) => {
    const response = await request.get(BASE_URL + '/auth/me/');

    expect([401, 403]).toContain(response.status());

    const body = await response.json();
    // Support both DRF {"detail": "..."} and custom {"error": {...}} response formats
    expect('error' in body || 'detail' in body).toBe(true);
  });

  test('CSRF token - GET /api/v1/auth/csrf/', async ({ request }) => {
    const response = await request.get(BASE_URL + '/auth/csrf/');

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('csrf_token');
  });
});