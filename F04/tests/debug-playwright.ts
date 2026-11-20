import { test, expect } from '@playwright/test';
import { getValidCredentials } from './test-credentials';

const BASE_URL = 'http://127.0.0.1:8000/api/v1';

test('debug cookies', async ({ request }) => {
    // Fetch CSRF token
    const csrfResponse = await request.get(BASE_URL + '/auth/csrf/');
    const csrfBody = await csrfResponse.json();
    
    // Login
    const loginResp = await request.post(BASE_URL + '/auth/login/', {
      data: { username: 'alice', password: getValidCredentials().password },
      headers: {
        'X-CSRFToken': csrfBody.csrf_token as string,
        'Content-Type': 'application/json',
      },
    });
    console.log('Login status:', loginResp.status());
    
    // Create workspace
    const createW = await request.post(BASE_URL + '/workspaces/create/', {
      data: { name: 'Sprint Test Workspace' },
      headers: {
        'X-CSRFToken': csrfBody.csrf_token as string,
        'Content-Type': 'application/json',
      },
    });
    console.log('Create workspace status:', createW.status());
    console.log('Create workspace body:', await createW.text());
});

test('debug2', async ({ request }) => {});
