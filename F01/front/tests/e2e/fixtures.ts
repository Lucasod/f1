import { test as base, type Page, expect } from '@playwright/test';

/**
 * Test fixtures and helpers for T-603 authentication E2E tests
 */

// Valid test constants (from backend test constants)
export const TEST_CONSTANTS = {
  VALID_CPF: '52998224725',
  VALID_CNPJ: '11222333000181',
  DEFAULT_PASSWORD: 'SecurePass123!',
} as const;

/**
 * Generate unique email for each test to avoid conflicts
 */
export function generateUniqueEmail(role: 'consumer' | 'vendor' | 'admin'): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `test.${role}.${timestamp}.${random}@example.com`;
}

/**
 * Generate test user data for registration
 */
export function getConsumerRegistrationData(email?: string) {
  return {
    name: 'Test Consumer',
    taxIdType: 'CPF' as const,
    taxIdValue: TEST_CONSTANTS.VALID_CPF,
    email: email ?? generateUniqueEmail('consumer'),
    password: TEST_CONSTANTS.DEFAULT_PASSWORD,
    confirmPassword: TEST_CONSTANTS.DEFAULT_PASSWORD,
    role: 'CONSUMER' as const,
  };
}

export function getVendorRegistrationData(email?: string) {
  return {
    name: 'Test Vendor',
    taxIdType: 'CNPJ' as const,
    taxIdValue: TEST_CONSTANTS.VALID_CNPJ,
    email: email ?? generateUniqueEmail('vendor'),
    password: TEST_CONSTANTS.DEFAULT_PASSWORD,
    confirmPassword: TEST_CONSTANTS.DEFAULT_PASSWORD,
    role: 'VENDOR' as const,
  };
}

/**
 * Fill registration form and submit
 */
export async function registerUser(page: Page, userData: ReturnType<typeof getConsumerRegistrationData> | ReturnType<typeof getVendorRegistrationData>) {
  await page.goto('/register');
  await page.waitForLoadState('networkidle');
  
  // Fill form fields
  await page.fill('#name', userData.name);
  await page.selectOption('#taxIdType', userData.taxIdType);
  await page.fill('#taxIdValue', userData.taxIdValue);
  await page.fill('#email', userData.email);
  await page.fill('#password', userData.password);
  await page.fill('#confirmPassword', userData.confirmPassword);
  await page.selectOption('#role', userData.role);
  
  // Submit
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle');
}

/**
 * Fill login form and submit
 */
export async function loginUser(page: Page, email: string, password: string = TEST_CONSTANTS.DEFAULT_PASSWORD) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle');
}

/**
 * Check if user is authenticated (has access token in localStorage)
 */
export async function isAuthenticated(page: Page): Promise<boolean> {
  const hasToken = await page.evaluate(() => {
    return !!localStorage.getItem('accessToken');
  });
  return hasToken;
}

/**
 * Get current user role from localStorage
 */
export async function getUserRole(page: Page): Promise<string | null> {
  return await page.evaluate(() => {
    const userStr = localStorage.getItem('user');
    if (!userStr) return null;
    try {
      const user = JSON.parse(userStr);
      return user.roles?.[0] ?? null;
    } catch {
      return null;
    }
  });
}

/**
 * Clear all auth data (logout)
 */
export async function clearAuth(page: Page) {
  // Navigate to home first to ensure we have a valid page context
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}

/**
 * Navigate to a path and wait for load
 */
export async function gotoAndWait(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
}

/**
 * Check if page shows access denied message
 */
export async function expectAccessDenied(page: Page) {
  await expect(page.locator('h1:has-text("Access Denied")')).toBeVisible();
  await expect(page.locator('text=You don\'t have permission to access this page')).toBeVisible();
}

/**
 * Check if redirected to login
 */
export async function expectRedirectedToLogin(page: Page) {
  await expect(page).toHaveURL(/\/login/);
}

// Extended test type with fixtures
type AuthFixtures = {
  consumerEmail: string;
  vendorEmail: string;
};

export const test = base.extend<AuthFixtures>({
  consumerEmail: [generateUniqueEmail('consumer'), { option: true }],
  vendorEmail: [generateUniqueEmail('vendor'), { option: true }],
});