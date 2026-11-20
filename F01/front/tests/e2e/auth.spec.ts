import { test, expect } from '@playwright/test';
import {
  getConsumerRegistrationData,
  registerUser,
  isAuthenticated,
  getUserRole,
} from './fixtures';

test.describe('T-603 Authentication E2E', () => {
  test('Consumer registration flow', async ({ page }) => {
    const consumerData = getConsumerRegistrationData();
    
    await registerUser(page, consumerData);
    
    // After successful registration/login, should be authenticated and redirected
    await expect(page).not.toHaveURL(/\/register/);
    await expect(page).not.toHaveURL(/\/login/);
    
    // Verify authentication state
    const authenticated = await isAuthenticated(page);
    expect(authenticated).toBe(true);
    
    const role = await getUserRole(page);
    expect(role).toBe('CONSUMER');
  });
});