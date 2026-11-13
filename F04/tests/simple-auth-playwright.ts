import { test, expect } from '@playwright/test';
import { getValidCredentials, getInvalidCredentials } from './test-credentials';

test('login valid - session active', async ({ request }) => {
  const csrfToken = 'dummy';

  // Log in first to establish a session before calling me
  await request.post('http://127.0.0.1:8000/api/v1/auth/login/', {
    data: { username: 'alice', password: getValidCredentials().password },
    headers: {
      'X-CSRFToken': csrfToken as string,
      'Content-Type': 'application/json',
    },
  });

  const response = await request.get('http://127.0.0.1:8000/api/v1/auth/me/', {
    headers: { 'X-CSRFToken': csrfToken as string },
  });
  expect(response.status()).toBe(200);
});

test('login invalid - invalid credentials rejected', async ({ request }) => {
  const csrfToken = 'dummy';
  const response = await request.post('http://127.0.0.1:8000/api/v1/auth/login/', {
    data: { username: 'alice', password: getInvalidCredentials().password },
    headers: {
      'X-CSRFToken': csrfToken as string,
      'Content-Type': 'application/json',
    },
  });
  expect(response.status()).toBe(400);
});
