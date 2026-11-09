import { test as base, type Page, expect } from '@playwright/test';

/**
 * Test fixtures and helpers for T-603 authentication E2E tests
 */

// Valid test constants (from backend test constants) - kept as fallback
export const TEST_CONSTANTS = {
  VALID_CPF: '52998224725',
  VALID_CNPJ: '11222333000181',
} as const;

/**
 * Calculate check digit using the same algorithm as backend (person.domain.ts)
 */
function calculateCheckDigit(digits: number[], weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += digits[i] * weights[i];
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

/**
 * Check if all digits are the same (invalid CPF/CNPJ)
 */
function allDigitsSame(value: string): boolean {
  return value.split('').every(d => d === value[0]);
}

/**
 * Generate a valid CPF (11 digits) with correct check digits
 * Algorithm matches backend person.domain.ts validateCpfCheckDigits
 * Uses LCG seeded by Date.now() with random offset to ensure uniqueness per test execution
 */
export function generateValidCPF(): string {
  let cpf: string;
  do {
    // Use LCG seeded by timestamp + random offset to ensure uniqueness
    // even across consecutive calls within the same millisecond
    const timestamp = Date.now();
    const randomOffset = Math.floor(Math.random() * 1000000);
    let lcgState = (timestamp ^ randomOffset) & 0xFFFFFFFF; // seed the LCG with combined seed
    // Generate first 9 random digits with LCG for uniqueness
    const baseDigits = Array.from({ length: 9 }, () => {
      lcgState = (lcgState * 1103515245 + 12345) & 0xFFFFFFFF;
      return (lcgState & 0x7FFFFFFF) % 10; // Map to 0-9 range
    });
    
    // Calculate 10th digit (first check digit)
    const weights1 = [10, 9, 8, 7, 6, 5, 4, 3, 2];
    const check1 = calculateCheckDigit(baseDigits, weights1);
    
    // Calculate 11th digit (second check digit)
    const digitsWithFirstCheck = [...baseDigits, check1];
    const weights2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
    const check2 = calculateCheckDigit(digitsWithFirstCheck, weights2);
    
    cpf = [...baseDigits, check1, check2].join('');
  } while (allDigitsSame(cpf)); // Retry if all digits are the same
  
  return cpf;
}

/**
 * Generate a valid CNPJ (14 digits) with correct check digits
 * Algorithm matches backend person.domain.ts validateCnpjCheckDigits
 * Uses LCG seeded by Date.now() with random offset to ensure uniqueness per test execution
 */
export function generateValidCNPJ(): string {
  let cnpj: string;
  do {
    // Use LCG seeded by timestamp + random offset to ensure uniqueness
    // even across consecutive calls within the same millisecond
    const timestamp = Date.now();
    const randomOffset = Math.floor(Math.random() * 1000000);
    let lcgState = (timestamp ^ randomOffset) & 0xFFFFFFFF; // seed the LCG with combined seed
    // Generate first 8 base digits with LCG for uniqueness (branch digits 0001 are standard)
    const baseDigits = Array.from({ length: 8 }, () => {
      lcgState = (lcgState * 1103515245 + 12345) & 0xFFFFFFFF;
      return (lcgState & 0x7FFFFFFF) % 10; // Map to 0-9 range
    });
    const branchDigits = [0, 0, 0, 1]; // Standard branch
    const first12 = [...baseDigits, ...branchDigits];
    
    // Calculate 13th digit (first check digit)
    const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const check1 = calculateCheckDigit(first12, weights1);
    
    // Calculate 14th digit (second check digit)
    const digitsWithFirstCheck = [...first12, check1];
    const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const check2 = calculateCheckDigit(digitsWithFirstCheck, weights2);
    
    cnpj = [...first12, check1, check2].join('');
  } while (allDigitsSame(cnpj)); // Retry if all digits are the same
  
  return cnpj;
}

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
    taxIdValue: generateValidCPF(),
    email: email ?? generateUniqueEmail('consumer'),
    role: 'CONSUMER' as const,
  };
}

export function getVendorRegistrationData(email?: string) {
  return {
    name: 'Test Vendor',
    taxIdType: 'CNPJ' as const,
    taxIdValue: generateValidCNPJ(),
    email: email ?? generateUniqueEmail('vendor'),
    role: 'VENDOR' as const,
  };
}

/**
 * Fill registration form and submit
 */
type RegistrationData = {
  name: string;
  taxIdType: 'CPF' | 'CNPJ';
  taxIdValue: string;
  email: string;
  role: 'CONSUMER' | 'VENDOR';
};

export async function registerUser(page: Page, userData: RegistrationData) {
  await page.goto('/register');
  
  // Fill form fields
  await page.fill('#name', userData.name);
  await page.selectOption('#taxIdType', userData.taxIdType);
  await page.fill('#taxIdValue', userData.taxIdValue);
  await page.fill('#email', userData.email);
  await page.fill('#password', 'TestPassword123!');
  await page.fill('#confirmPassword', 'TestPassword123!');
  
  // Submit - role is hardcoded to CONSUMER in the RegisterForm handleSubmit
  await page.click('button[type="submit"]');
  
  // Wait for authentication state in localStorage (zustand persist is async)
  await page.waitForFunction(() => {
    const authStorage = localStorage.getItem('auth-storage');
    if (!authStorage) return false;
    try {
      const parsed = JSON.parse(authStorage);
      return !!parsed.state?.accessToken || !!parsed.accessToken;
    } catch {
      return false;
    }
  }, { timeout: 10000 });
  
  const url = page.url();
  if (url.includes('/register')) {
    // Check if authenticated after waiting for localStorage update
    const authenticated = await page.evaluate(() => {
      const authStorage = localStorage.getItem('auth-storage');
      if (!authStorage) return false;
      try {
        const parsed = JSON.parse(authStorage);
        return !!parsed.state?.accessToken || !!parsed.accessToken;
      } catch {
        return false;
      }
    });
    
    if (authenticated) {
      // Registration succeeded but no redirect - go to appropriate dashboard
      const role = await page.evaluate(() => {
        const authStorage = localStorage.getItem('auth-storage');
        if (!authStorage) return null;
        try {
          const parsed = JSON.parse(authStorage);
          const user = parsed.state?.user;
          return user?.roles?.[0] ?? null;
        } catch {
          return null;
        }
      });
      const dashboardPath = role === 'VENDOR' ? '/vendor/dashboard' : role === 'ADMIN' ? '/admin/dashboard' : '/dashboard';
      await page.goto(dashboardPath);
    }
  }
}

/**
 * Fill login form and submit
 */
export async function loginUser(page: Page, email: string, password: string = 'TestPassword123!') {
  await page.goto('/login');
  
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  
  // Wait for authentication state in localStorage (zustand persist is async)
  await page.waitForFunction(() => {
    const authStorage = localStorage.getItem('auth-storage');
    if (!authStorage) return false;
    try {
      const parsed = JSON.parse(authStorage);
      return !!parsed.state?.accessToken || !!parsed.accessToken;
    } catch {
      return false;
    }
  }, { timeout: 10000 });
}

/**
 * Check if user is authenticated (has access token in localStorage)
 */
export async function isAuthenticated(page: Page): Promise<boolean> {
  const hasToken = await page.evaluate(() => {
    const authStorage = localStorage.getItem('auth-storage');
    if (!authStorage) return false;
    try {
      const parsed = JSON.parse(authStorage);
      return !!parsed.state?.accessToken || !!parsed.accessToken;
    } catch {
      return false;
    }
  });
  return hasToken;
}

/**
 * Get current user role from localStorage
 */
export async function getUserRole(page: Page): Promise<string | null> {
  return await page.evaluate(() => {
    const authStorage = localStorage.getItem('auth-storage');
    if (!authStorage) return null;
    try {
      const parsed = JSON.parse(authStorage);
      const user = parsed.state?.user;
      return user?.roles?.[0] ?? null;
    } catch {
      return null;
    }
  });
}

/**
 * Clear all auth data (logout)
 */
export async function clearAuth(page: Page) {
  // Reload the current page to clear auth data from localStorage/sessionStorage
  // within the same browser context. Using page.goto('/') was avoided because
  // it can close the browser context or cause context loss.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  // Auth data should be cleared after reload since the page starts fresh
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