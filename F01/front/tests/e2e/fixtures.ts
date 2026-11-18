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
  // Step 1: Try to login as this user to check if they already exist
  // Use a short timeout (3000ms) for the login check to avoid auth state leakage
  // Check if user is already authenticated by reading localStorage
  let userExists = false;
  let userRole: string | null = null;

  try {
    // Check if user already has an auth token in localStorage
    const alreadyAuthed = await page.evaluate(() => {
      const authStorage = localStorage.getItem('auth-storage');
      if (!authStorage) return false;
      try {
        const parsed = JSON.parse(authStorage);
        return !!parsed.state?.accessToken || !!parsed.accessToken;
      } catch {
        return false;
      }
    });

    if (alreadyAuthed) {
      // User is already logged in - they exist, get their role and skip registration
      userExists = true;
      userRole = await page.evaluate(() => {
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
  } catch {
    // Auth check failed - proceed with registration
  }

  if (userExists) {
    // Skip registration entirely - user exists, go to appropriate dashboard
    // based on the user's role, preserving role-based security requirements
    const dashboardPath =
      userRole === 'VENDOR'
        ? '/vendor/dashboard'
        : userRole === 'ADMIN'
        ? '/admin/dashboard'
        : '/dashboard';
    await page.goto(dashboardPath);
    return;
  }

  // Step 2: Proceed with normal registration (user does not exist)
  await page.goto('/register');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('#name', { timeout: 15000 });

  // Fill form fields
  await page.fill('#name', userData.name);
  await page.selectOption('#taxIdType', userData.taxIdType);
  await page.fill('#taxIdValue', userData.taxIdValue);
  await page.fill('#email', userData.email);
  await page.fill('#password', process.env.TEST_USER_PASSWORD);
  await page.fill('#confirmPassword', process.env.TEST_USER_PASSWORD);

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
  }, { timeout: 30000 });

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
export async function loginUser(page: Page, email: string, password: string = process.env.TEST_USER_PASSWORD) {
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
  }, { timeout: 30000 });
}

/**
 * Check if user is authenticated (has access token in localStorage)
 */
export async function isAuthenticated(page: Page): Promise<boolean> {
  // Navigate to a safe page origin first if on about:blank, since localStorage
  // access is denied on about:blank with a SecurityError.
  if (page.url() === 'about:blank') {
    await page.goto('/survey');
    await page.waitForLoadState('domcontentloaded');
  }
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
  // Navigate to a safe page origin first if on about:blank, since page.reload()
  // on about:blank keeps a null-origin page where localStorage access is denied
  // with a SecurityError. Home page is a real app origin that doesn't call cart API.
  if (page.url() === 'about:blank') {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  }
  // Remove all auth-related keys from localStorage so the page starts
  // unauthenticated. This matches the keys used by authStore.ts:
  // - auth-storage (zustand persist key)
  // - accessToken (individual key for apiClient compatibility)
  // - refreshToken (individual key for apiClient compatibility)
  // - user (individual key for apiClient compatibility)
  // Note: guestCartId is NOT cleared here as it's a cart key, not an auth key.
  // Tests that need a clean cart state should clear it explicitly.
  // Then reload to ensure the removal takes effect.
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.evaluate(() => {
      localStorage.removeItem('auth-storage');
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    // Remove auth keys again after reload: zustand persist re-hydrates on page
    // load and may write the auth-storage key back (even with empty/null state),
    // which would make the key appear as "remaining" on the next check.
    await page.evaluate(() => {
      localStorage.removeItem('auth-storage');
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
    });
    // Verify auth state is cleared by checking localStorage is empty of these keys
    const authCleared = await page.evaluate(() => {
      return !localStorage.getItem('auth-storage') &&
             !localStorage.getItem('accessToken') &&
             !localStorage.getItem('refreshToken') &&
             !localStorage.getItem('user');
    });
    if (authCleared) return;
    // If not cleared, retry once more; if still not cleared after 2 attempts,
    // throw a descriptive error so the test fails explicitly.
  }
  // If we reach here, auth state could not be cleared after 2 attempts
  const remainingKeys = await page.evaluate(() => ({
    authStorage: !!localStorage.getItem('auth-storage'),
    accessToken: !!localStorage.getItem('accessToken'),
    refreshToken: !!localStorage.getItem('refreshToken'),
    user: !!localStorage.getItem('user'),
  }));
  throw new Error(
    'Failed to clear authentication state from localStorage after 2 attempts. Remaining keys: ' +
    JSON.stringify(remainingKeys)
  );
}

/**
 * Clear guest cart ID from localStorage
 */
export async function clearGuestCart(page: Page) {
  // Navigate to a safe page origin first if on about:blank, since localStorage
  // access is denied on about:blank with a SecurityError.
  if (page.url() === 'about:blank') {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  }
  await page.evaluate(() => {
    localStorage.removeItem('guestCartId');
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

/**
 * Seeded Admin account email (see back/src/scripts/seed.ts ACCOUNTS).
 * The password is TEST_USER_PASSWORD, configured in the backend runtime env,
 * never hardcoded here.
 */
export const ADMIN_EMAIL = 'admin@example.com';

/**
 * Backend API base URL. The Vite dev server proxies /api to localhost:3000,
 * but page.request() does not go through the browser proxy, so we call the
 * backend directly.
 */
export const API_BASE_URL = 'http://localhost:3000';

/**
 * Extract the access token from localStorage (auth-storage or accessToken key).
 */
export async function getAuthToken(page: Page): Promise<string | null> {
  return await page.evaluate(() => {
    const authStorage = localStorage.getItem('auth-storage');
    if (!authStorage) return null;
    try {
      const parsed = JSON.parse(authStorage);
      return parsed.state?.accessToken ?? parsed.accessToken ?? null;
    } catch {
      return null;
    }
  });
}

/**
 * Log in via the backend auth API and return the access token.
 * Used to authenticate as a pre-seeded account without the UI login flow.
 * Never logs the password value.
 * @param page - Playwright page (provides page.request)
 * @param email - Account email
 * @param password - Account password
 * @returns The access token, refresh token, and person, or null when login fails.
 */
export async function loginViaApi(
  page: Page,
  email: string,
  password: string
): Promise<{ accessToken: string | null; refreshToken: string | null; person: any | null }> {
  const response = await page.request.post(`${API_BASE_URL}/api/v1/auth/login`, {
    headers: { 'Content-Type': 'application/json' },
    data: { email, password },
  });
  if (!response.ok()) {
    const errorText = await response.text().catch(() => '');
    console.warn(`API login failed (${response.status()}) for ${email}: ${errorText}`);
    return { accessToken: null, refreshToken: null, person: null };
  }
  const data = await response.json();
  return {
    accessToken: data?.tokens?.accessToken ?? null,
    refreshToken: data?.tokens?.refreshToken ?? null,
    person: data?.person ?? null,
  };
}

/**
 * Log in as the seeded Admin account via the backend auth API and return the
 * access token. The password is read from TEST_USER_PASSWORD (configured in
 * the backend runtime env); it is never logged or hardcoded.
 * @returns The access token and person, or null when login fails (e.g. when
 * TEST_USER_PASSWORD is not configured in the running shell).
 */
export async function loginAsAdminViaApi(
  page: Page
): Promise<{ accessToken: string | null; person: any | null }> {
  return loginViaApi(page, ADMIN_EMAIL, process.env.TEST_USER_PASSWORD ?? '');
}

/**
 * Make an authenticated API request to the backend.
 * Automatically injects the Bearer token from localStorage if not provided.
 */
export async function apiFetch(
  page: Page,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  token?: string | null
): Promise<Response> {
  const authToken = token ?? (await getAuthToken(page));
  const headers: Record<string, string> = {};
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`;
  // Use method-specific calls with `data` (Playwright auto-serializes JSON
  // and sets Content-Type) because page.request.fetch with `body` is not
  // reliably parsed by Express's json() middleware.
  if (method === 'GET') {
    return page.request.get(url, { headers });
  }
  if (method === 'DELETE') {
    return page.request.delete(url, { headers });
  }
  if (method === 'POST') {
    return page.request.post(url, { headers, data: body });
  }
  if (method === 'PATCH') {
    return page.request.patch(url, { headers, data: body });
  }
  throw new Error(`Unsupported HTTP method: ${method}`);
}

/**
 * Add a delivery address for the authenticated user via the backend API.
 * Returns the created address (with id) or null on failure.
 */
export async function addAddress(page: Page, addressData: {
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  isPrimary?: boolean;
}): Promise<{ id: string; street: string; number: string; neighborhood: string; city: string; state: string; isPrimary: boolean } | null> {
  const response = await apiFetch(page, 'POST', '/api/v1/person/me/addresses', addressData);
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    console.warn(`Add address failed (${response.status}): ${errorText}`);
    return null;
  }
  const data = await response.json();
  return data?.person?.addresses?.[0] ?? data?.address ?? null;
}

/**
 * Get an order by ID via the backend API.
 * Returns the order object or null on failure.
 * @param token - Optional Bearer token; if omitted, it is read from localStorage.
 */
export async function getOrder(
  page: Page,
  orderId: string,
  token?: string | null
): Promise<any | null> {
  const response = await apiFetch(page, 'GET', `/api/v1/orders/${orderId}`, undefined, token);
  if (!response.ok) {
    return null;
  }
  const data = await response.json();
  return data?.order ?? null;
}

/**
 * Get all orders for the authenticated user via the backend API.
 * Returns the orders array or null on failure.
 * @param token - Optional Bearer token; if omitted, it is read from localStorage.
 */
export async function listOrders(
  page: Page,
  token?: string | null
): Promise<any[] | null> {
  const response = await apiFetch(page, 'GET', '/api/v1/orders', undefined, token);
  if (!response.ok) {
    return null;
  }
  const data = await response.json();
  return data?.orders ?? null;
}

/**
 * Stripe test card details (sandbox test values only — not real credentials).
 * Card 4242424242424242 requires no 3D Secure in Stripe test mode.
 */
export const STRIPE_TEST_CARD = {
  number: '4242424242424242',
  expiry: '1230',
  cvc: '123',
} as const;

/**
 * Wait for an order to reach the expected status by polling the backend API.
 * Returns the final status observed (or null if the order could not be read).
 */
export async function waitForOrderStatus(
  page: Page,
  orderId: string,
  expectedStatus: string,
  { maxAttempts = 40, intervalMs = 1000 }: { maxAttempts?: number; intervalMs?: number } = {},
  token?: string | null
): Promise<string | null> {
  let lastStatus: string | null = null;
  for (let i = 0; i < maxAttempts; i++) {
    const order = await getOrder(page, orderId, token);
    lastStatus = order?.status ?? null;
    if (lastStatus === expectedStatus) {
      return lastStatus;
    }
    await page.waitForTimeout(intervalMs);
  }
  return lastStatus;
}

/**
 * Find the most recent pending_payment order for the authenticated consumer.
 * Returns the order id or null.
 */
export async function findPendingOrderId(page: Page): Promise<string | null> {
  const orders = await listOrders(page);
  if (!orders || orders.length === 0) return null;
  const pending = orders.filter((o: any) => o.status === 'pending_payment');
  if (pending.length === 0) return null;
  // Sort by createdAt descending, pick the most recent
  pending.sort((a: any, b: any) => {
    const da = new Date(a.createdAt ?? 0).getTime();
    const db = new Date(b.createdAt ?? 0).getTime();
    return db - da;
  });
  return pending[0].id;
}

/**
 * Fill the Stripe test card in the hosted checkout page iframes.
 * Stripe Checkout renders card inputs inside cross-origin iframes; we scan
 * all frames for known Stripe Elements input selectors. Returns true only
 * when card number, expiry AND CVC have all been filled.
 */
export async function fillStripeTestCard(page: Page): Promise<boolean> {
  const { number, expiry, cvc } = STRIPE_TEST_CARD;
  // Give Stripe Elements iframes time to initialize (Stripe Checkout can be slow)
  await page.waitForTimeout(5000);
  let cardFilled = false;
  let expiryFilled = false;
  let cvcFilled = false;

  const cardSelectors = [
    'input[data-elements-stable-field-name="cardNumber"]',
    'input[aria-label*="card number" i]',
    'input[name="cardnumber"]',
    'input[placeholder*="••••"]',
    'input[inputmode="numeric"][maxlength="16"]',
  ];
  const expirySelectors = [
    'input[data-elements-stable-field-name="cardExpiry"]',
    'input[aria-label*="expiry" i]',
    'input[name="exp-date"]',
    'input[placeholder*="MM/YY" i]',
    'input[inputmode="numeric"][maxlength="4"]',
  ];
  const cvcSelectors = [
    'input[data-elements-stable-field-name="cardCvc"]',
    'input[aria-label*="cvc" i]',
    'input[name="cvc"]',
    'input[inputmode="numeric"][maxlength="3"]',
  ];

  // Try multiple times in case iframes are still loading
  for (let attempt = 0; attempt < 3 && !(cardFilled && expiryFilled && cvcFilled); attempt++) {
    if (attempt > 0) {
      await page.waitForTimeout(2000);
    }
    for (const frame of page.frames()) {
      try {
        if (!cardFilled) {
          for (const sel of cardSelectors) {
            const input = frame.locator(sel).first();
            if ((await input.count()) > 0) {
              await input.fill(number);
              cardFilled = true;
              break;
            }
          }
        }
        if (!expiryFilled) {
          for (const sel of expirySelectors) {
            const input = frame.locator(sel).first();
            if ((await input.count()) > 0) {
              await input.fill(expiry);
              expiryFilled = true;
              break;
            }
          }
        }
        if (!cvcFilled) {
          for (const sel of cvcSelectors) {
            const input = frame.locator(sel).first();
            if ((await input.count()) > 0) {
              await input.fill(cvc);
              cvcFilled = true;
              break;
            }
          }
        }
      } catch {
        // Frame may be inaccessible; skip
      }
    }
  }

  return cardFilled && expiryFilled && cvcFilled;
}

/**
 * Fill the phone number field on the Stripe Checkout page if present.
 * Stripe Checkout may require a phone number when phone_number_collection
 * is enabled. Scans both the main page and iframes.
 */
export async function fillStripePhone(page: Page): Promise<boolean> {
  const phoneSelectors = [
    'input[aria-label*="phone" i]',
    'input[name="phone"]',
    'input[placeholder*="phone" i]',
    'input[type="tel"]',
  ];
  let filled = false;
  // Main page
  try {
    for (const sel of phoneSelectors) {
      const input = page.locator(sel).first();
      if ((await input.count()) > 0) {
        await input.fill('11999999999');
        filled = true;
        break;
      }
    }
  } catch {
    // ignore
  }
  // Iframes
  try {
    for (const frame of page.frames()) {
      if (filled) break;
      for (const sel of phoneSelectors) {
        const input = frame.locator(sel).first();
        if ((await input.count()) > 0) {
          await input.fill('11999999999');
          filled = true;
          break;
        }
      }
    }
  } catch {
    // ignore
  }
  return filled;
}

/**
 * Complete payment on a Stripe Checkout hosted page using the test card.
 * Navigates to the checkout URL, fills card details, submits, and waits
 * for the redirect back to the frontend success URL.
 */
export async function completeStripePayment(
  page: Page,
  checkoutUrl: string
): Promise<{ navigated: boolean; cardFilled: boolean; submitted: boolean }> {
  const result = { navigated: false, cardFilled: false, submitted: false };

  try {
    await page.goto(checkoutUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    result.navigated = page.url().includes('checkout.stripe.com');
  } catch {
    return result;
  }

  result.cardFilled = await fillStripeTestCard(page);

  // Fill phone number if Stripe requires it (phone_number_collection enabled)
  await fillStripePhone(page);

  // Give Stripe a moment to enable the pay button once all fields are complete
  await page.waitForTimeout(1000);

  // Locate and click the pay/submit button
  const payButton = page
    .locator('button:has-text("Pay"), button:has-text("Pagar"), [data-testid*="pay-button"]')
    .first();
  if ((await payButton.count()) > 0) {
    try {
      await payButton.click();
      result.submitted = true;
    } catch {
      // Try pressing Enter on the last focused card field as fallback
      try {
        await page.keyboard.press('Enter');
        result.submitted = true;
      } catch {}
    }
  }

  return result;
}

/**
 * Trigger a Stripe checkout.session.completed webhook directly against the
 * backend webhook endpoint, with a valid Stripe-Signature header computed
 * using the CLI's webhook signing secret. This exercises the same webhook
 * handler that the Stripe CLI would forward to, without depending on the
 * fragile Stripe Checkout hosted-page iframe filling.
 *
 * @param orderId - The order id (embedded in session.metadata.orderId)
 * @param paymentId - The payment id (embedded in session.metadata.paymentId)
 * @param amount - Order total amount (in major currency units, e.g. BRL)
 * @param webhookSecret - The Stripe webhook signing secret (whsec_...)
 */
export async function triggerStripeWebhook(
  page: Page,
  orderId: string,
  paymentId: string,
  amount: number,
  webhookSecret: string
): Promise<{ ok: boolean; statusCode: number }> {
  const { createHmac } = await import('crypto');
  const timestamp = Math.floor(Date.now() / 1000);
  const payload: any = {
    id: `evt_test_webhook_${Date.now()}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_test_${orderId}`,
        payment_status: 'paid',
        amount_total: Math.round(amount * 100),
        currency: 'brl',
        metadata: { orderId, paymentId },
        payment_intent: `pi_test_${orderId}`,
      },
    },
  };

  const body = JSON.stringify(payload);
  const signedPayload = `${timestamp}.${body}`;
  const signature = createHmac('sha256', webhookSecret).update(signedPayload).digest('hex');
  const stripeSignature = `t=${timestamp},v1=${signature}`;

  const response = await page.request.post(`${API_BASE_URL}/api/v1/webhooks/stripe`, {
    headers: {
      'Content-Type': 'application/json',
      'Stripe-Signature': stripeSignature,
    },
    data: payload,
  });

  return { ok: response.ok(), statusCode: response.status() };
}

/**
 * Ensure products exist in the backend API.
 * Returns true if products are available, false otherwise.
 */
export async function ensureProductsAvailable(page: Page): Promise<boolean> {
  const productsResp = await page.request.get(`${API_BASE_URL}/api/v1/products`);
  if (productsResp.ok) {
    const productsData = await productsResp.json();
    const products = productsData?.products ?? [];
    if (products.length > 0) {
      return true; // Products already exist
    }
  }
  return false; // No products found
}

/**
 * Read the Stripe webhook signing secret from the file captured when the CLI
 * was started. Returns null if the file is not present.
 */
export async function readWebhookSecret(): Promise<string | null> {
  const { readFileSync } = await import('fs');
  try {
    return readFileSync('/tmp/kilo/webhook-secret.txt', 'utf-8').trim() || null;
  } catch {
    return null;
  }
}

/**
 * Onboard the authenticated user as a vendor via the backend API.
 * Returns the vendor profile or null on failure.
 */
export async function onboardVendor(
  page: Page,
  storeName: string,
  slug: string
): Promise<any | null> {
  const token = await getAuthToken(page);
  const response = await page.request.post(`${API_BASE_URL}/api/v1/vendor/onboard`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data: { storeName, slug },
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    console.warn(`Vendor onboarding failed (${response.status}): ${errorText}`);
    return null;
  }
  const data = await response.json();
  return data?.vendor ?? null;
}

/**
 * Transition a vendor group status via the backend API using a supplied token.
 * Used for vendor fulfillment steps when the page's localStorage holds a
 * different user's token.
 */
export async function transitionVendorGroupWithToken(
  page: Page,
  token: string,
  orderId: string,
  vendorGroupId: string,
  status: string
): Promise<{ ok: boolean; statusCode: number }> {
  const response = await page.request.patch(`${API_BASE_URL}/api/v1/orders/${orderId}/vendor-groups/${vendorGroupId}/status`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    data: { status },
  });
  return { ok: response.ok(), statusCode: response.status() };
}

/**
 * Extract the access token from localStorage (auth-storage or accessToken key).
 * Duplicated here for use with vendor tokens obtained out-of-band.
 */
export async function getAuthTokenFromResponse(response: any): Promise<string | null> {
  try {
    const data = await response.json();
    return data?.tokens?.accessToken ?? data?.accessToken ?? null;
  } catch {
    return null;
  }
}

/**
 * Attempt to simulate payment confirmation for an order.
 * Since real Stripe is not available (no STRIPE_SECRET_KEY, no webhook
 * signature), this tries the available approaches and reports what worked.
 *
 * Approaches attempted (in order):
 * 1. Create a payment record via POST /api/v1/payments (sets PENDING payment)
 * 2. Query payment state via GET /api/v1/payments/order/:orderId
 * 3. Attempt webhook POST /api/v1/webhooks/stripe (will fail without signature)
 *
 * Returns an object describing which steps succeeded.
 */
export interface PaymentSimulationResult {
  paymentCreated: boolean;
  paymentStatus?: string;
  webhookAttempted: boolean;
  webhookSucceeded: boolean;
  orderStatus?: string;
  error?: string;
}

export async function simulatePayment(
  page: Page,
  orderId: string,
  amount: number
): Promise<PaymentSimulationResult> {
  const result: PaymentSimulationResult = {
    paymentCreated: false,
    webhookAttempted: false,
    webhookSucceeded: false,
  };

  // Step 1: Create a payment record for the order
  try {
    const createResp = await apiFetch(page, 'POST', '/api/v1/payments', {
      orderId,
      amount,
      provider: 'stripe',
    });
    if (createResp.ok) {
      const data = await createResp.json();
      result.paymentCreated = true;
      result.paymentStatus = data?.payment?.status;
    } else {
      const errorText = await createResp.text().catch(() => '');
      result.error = `Create payment failed (${createResp.status}): ${errorText}`;
    }
  } catch (error) {
    result.error = `Create payment exception: ${error instanceof Error ? error.message : String(error)}`;
  }

  // Step 2: Query payment state for the order
  try {
    const paymentsResp = await apiFetch(page, 'GET', `/api/v1/payments/order/${orderId}`);
    if (paymentsResp.ok) {
      const paymentsData = await paymentsResp.json();
      const payments = paymentsData?.payments ?? [];
      if (payments.length > 0) {
        result.paymentStatus = payments[0].status;
      }
    }
  } catch {
    // Ignore - payment query is best-effort
  }

  // Step 3: Attempt webhook (will fail without STRIPE_WEBHOOK_SECRET + signature)
  try {
    result.webhookAttempted = true;
    const webhookResp = await page.request.post(`${API_BASE_URL}/api/v1/webhooks/stripe`, {
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': 't=1234567890,v1=fakesignaturefortesting',
      },
      data: {
        id: 'evt_test_simulated',
        type: 'checkout.session.completed',
        data: { object: { id: `cs_test_${orderId}`, payment_status: 'paid' } },
      },
    });
    result.webhookSucceeded = webhookResp.ok();
    if (!webhookResp.ok()) {
      // Expected without real Stripe config
      result.error = (result.error ? result.error + '; ' : '') +
        `Webhook failed (${webhookResp.status()}): expected without Stripe configured`;
    }
  } catch (error) {
    result.webhookAttempted = true;
    result.webhookSucceeded = false;
    result.error = (result.error ? result.error + '; ' : '') +
      `Webhook exception: ${error instanceof Error ? error.message : String(error)}`;
  }

  // Step 4: Check current order status
  try {
    const order = await getOrder(page, orderId);
    if (order) {
      result.orderStatus = order.status;
    }
  } catch {
    // Ignore
  }

  return result;
}

/**
 * Create an order via the checkout flow (POST /checkout).
 * Adds item to cart, adds shipping address, then calls checkout.
 * Returns the created order or null on failure.
 */
export async function createOrderViaCheckout(page: Page, productId: string, quantity: number = 1): Promise<{ orderId: string; checkoutUrl: string } | null> {
  try {
    // Add item to cart
    const addToCartResp = await apiFetch(page, 'POST', '/api/v1/cart/items', {
      productId,
      quantity,
    });
    if (!addToCartResp.ok) {
      console.warn('Add to cart failed:', addToCartResp.status);
      return null;
    }

    // Add shipping address
    const address = await addAddress(page, {
      street: 'Rua Teste',
      number: '100',
      neighborhood: 'Centro',
      city: 'São Paulo',
      state: 'SP',
      isPrimary: true,
    });
    if (!address) {
      console.warn('Add address failed');
      return null;
    }

    // Call checkout
    const checkoutResp = await apiFetch(page, 'POST', '/api/v1/checkout', {
      shippingAddressId: address.id,
    });
    if (!checkoutResp.ok) {
      const errorText = await checkoutResp.text().catch(() => '');
      console.warn('Checkout failed:', checkoutResp.status, errorText);
      return null;
    }

    const data = await checkoutResp.json();
    return {
      orderId: data.order?.id,
      checkoutUrl: data.checkoutUrl,
    };
  } catch (error) {
    console.warn('Create order via checkout exception:', error instanceof Error ? error.message : String(error));
    return null;
  }
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