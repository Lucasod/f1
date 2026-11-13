/// <reference types="playwright/test" />
import { test, expect } from '@playwright/test';
import { getValidCredentials } from './test-credentials';

const BASE_URL = 'http://127.0.0.1:8000/api/v1';

test.beforeAll(async ({ request }) => {
  console.log('beforeAll: about to login');
  const csrfResponse = await request.get(BASE_URL + '/auth/csrf/');
  const csrfBody = await csrfResponse.json();
  console.log('beforeAll: csrf token', csrfBody.csrf_token);
  const loginResponse = await request.post(BASE_URL + '/auth/login/', {
    data: { username: 'alice', password: getValidCredentials().password },
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfBody.csrf_token },
  });
  console.log('beforeAll: login status', loginResponse.status());
  const meResponse = await request.get(BASE_URL + '/auth/me/', {
    headers: { 'Content-Type': 'application/json' },
  });
  console.log('beforeAll: me status', meResponse.status());
});

test('check session carries over', async ({ request }) => {
  console.log('test: about to call me');
  const meResponse = await request.get(BASE_URL + '/auth/me/', {
    headers: { 'Content-Type': 'application/json' },
  });
  console.log('test: me status', meResponse.status());
});
