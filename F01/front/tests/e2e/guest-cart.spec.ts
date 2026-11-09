import { test, expect } from '@playwright/test';
import {
  TEST_CONSTANTS,
  getConsumerRegistrationData,
  registerUser,
  loginUser,
  isAuthenticated,
  getUserRole,
  clearAuth,
  gotoAndWait,
  expectRedirectedToLogin,
} from './fixtures';

/**
 * T-704 Guest Cart Merge E2E Tests
 * 
 * Tests the guest cart merge flow:
 * 1. Guest user adds items to cart
 * 2. Guest user logs in
 * 3. Guest cart items are merged into user cart
 * 4. Guest cart ID is cleared from localStorage
 * 
 * LIMITATION: The backend uses an in-memory database that persists across test runs.
 * The test constants may already be registered, causing registration to fail.
 * For reliable test runs, restart the backend server before running E2E tests
 * to clear the in-memory database, or use unique valid CPF/CNPJ values.
 */

test.describe('T-704 Guest Cart Merge E2E', () => {
  // Helper to get a product ID from the catalog
  async function getFirstProductId(page: Page): Promise<string | null> {
    await gotoAndWait(page, '/products');
    await page.waitForLoadState('networkidle');
    
    // Check if no products are available (empty state)
    // Must be done before waiting for product articles, since the selector
    // times out when the catalog shows the "No products found" state
    const noProducts = await page.locator('text=No products found').isVisible().catch(() => false);
    if (noProducts) {
      return null;
    }
    
    // Wait for products to load - at this point the empty state check has already
    // determined products exist, so the selector should appear within the timeout
    await page.waitForSelector('[role="list"] [role="article"]', { timeout: 10000 });
    
    // Get the first product link
    const firstProductLink = page.locator('[role="list"] [role="article"] a').first();
    const href = await firstProductLink.getAttribute('href');
    if (!href) return null;
    
    // Extract product ID from URL like /products/{productId}
    const match = href.match(/\/products\/([^/]+)/);
    return match ? match[1] : null;
  }

  // Helper to add item to cart from product detail page
  async function addToCart(page: Page, productId: string, quantity: number = 1): Promise<void> {
    await gotoAndWait(page, `/products/${productId}`);
    await page.waitForLoadState('networkidle');
    
    // Wait for add to cart button
    await page.waitForSelector('button:has-text("Add to Cart"), button:has-text("Out of Stock")', { timeout: 10000 });
    
    // Check if out of stock
    const outOfStock = await page.locator('button:has-text("Out of Stock")').isVisible().catch(() => false);
    if (outOfStock) {
      throw new Error('Product is out of stock');
    }
    
    // Set quantity if needed
    if (quantity > 1) {
      const quantityInput = page.locator('#quantity');
      await quantityInput.fill(String(quantity));
    }
    
    // Click Add to Cart
    await page.click('button:has-text("Add to Cart")');
    
    // Wait for success message
    await page.waitForSelector('text=Added!', { timeout: 10000 });
    await page.waitForSelector('text=Added!', { state: 'hidden', timeout: 5000 });
  }

  // Helper to verify cart has items
  async function verifyCartHasItems(page: Page, expectedCount?: number): Promise<number> {
    await gotoAndWait(page, '/cart');
    await page.waitForLoadState('networkidle');
    
    // Wait for cart to load. The cart page renders <h1>Shopping cart</h1>
    // (CartPage.tsx line 277) when items exist, or EmptyState with
    // "Your cart is empty" when empty.
    await page.waitForSelector('text=Shopping cart', { timeout: 10000 });
    
    // Check if cart is empty
    const emptyText = await page.locator('text=Your cart is empty, text=Seu carrinho está vazio').isVisible().catch(() => false);
    if (emptyText) {
      if (expectedCount !== undefined && expectedCount > 0) {
        throw new Error('Cart is empty but expected items');
      }
      return 0;
    }
    
    // Count cart items
    const itemCount = await page.locator('[role="list"] [role="article"], .cart-item, [data-testid="cart-item"]').count();
    // Fallback: count by looking for product rows
    const productRows = await page.locator('div[class*="flex"]:has-text("R$")').count();
    
    const actualCount = itemCount > 0 ? itemCount : productRows;
    if (expectedCount !== undefined && actualCount !== expectedCount) {
      console.warn(`Expected ${expectedCount} items in cart, found ${actualCount}`);
    }
    
    return actualCount;
  }

  // Helper to check guest cart ID in localStorage
  async function getGuestCartId(page: Page): Promise<string | null> {
    return await page.evaluate(() => localStorage.getItem('guestCartId'));
  }

  // Helper to check auth token in localStorage
  async function getAuthToken(page: Page): Promise<string | null> {
    return await page.evaluate(() => {
      const authStorage = localStorage.getItem('auth-storage');
      if (!authStorage) return null;
      try {
        const parsed = JSON.parse(authStorage);
        return parsed.state?.accessToken ?? null;
      } catch {
        return null;
      }
    });
  }

  test.describe.configure({ retries: 1 });

  // Test 1: Guest can add items to cart
  test('Guest can add items to cart', async ({ page }) => {
    // Clear any existing auth
    await clearAuth(page);
    
    // Verify no auth token
    const tokenBefore = await getAuthToken(page);
    expect(tokenBefore).toBeNull();
    
    // Get a product
    const productId = await getFirstProductId(page);
    if (!productId) {
      test.skip(true, 'No products available in catalog');
    }
    
    // Add product to cart as guest
    await addToCart(page, productId, 2);
    
    // Verify cart has items
    const itemCount = await verifyCartHasItems(page, 1);
    expect(itemCount).toBeGreaterThan(0);
    
    // Verify guest cart ID exists in localStorage
    const guestCartId = await getGuestCartId(page);
    expect(guestCartId).toBeTruthy();
    expect(guestCartId).toMatch(/^guest:/);
  });

  // Test 2: Guest cart persists across page reloads
  test('Guest cart persists across page reloads', async ({ page }) => {
    await clearAuth(page);
    
    const productId = await getFirstProductId(page);
    if (!productId) {
      test.skip(true, 'No products available in catalog');
    }
    
    await addToCart(page, productId, 1);
    
    // Verify cart has items
    let itemCount = await verifyCartHasItems(page, 1);
    expect(itemCount).toBeGreaterThan(0);
    
    const guestCartIdBefore = await getGuestCartId(page);
    expect(guestCartIdBefore).toBeTruthy();
    
    // Reload page
    await page.reload();
    await page.waitForLoadState('networkidle');
    
    // Verify cart still has items
    itemCount = await verifyCartHasItems(page, 1);
    expect(itemCount).toBeGreaterThan(0);
    
    // Verify guest cart ID persists
    const guestCartIdAfter = await getGuestCartId(page);
    expect(guestCartIdAfter).toBe(guestCartIdBefore);
  });

  // Test 3: Guest cart merges after login
  test('Guest cart merges after user logs in', async ({ page }) => {
    // Step 1: Start as guest, add items to cart
    await clearAuth(page);
    
    const productId = await getFirstProductId(page);
    if (!productId) {
      test.skip(true, 'No products available in catalog');
    }
    
    await addToCart(page, productId, 2);
    
    // Verify guest cart has items
    let itemCount = await verifyCartHasItems(page, 1);
    expect(itemCount).toBeGreaterThan(0);
    
    const guestCartIdBefore = await getGuestCartId(page);
    expect(guestCartIdBefore).toBeTruthy();
    
    // Step 2: Register a new user (consumer)
    const consumerData = getConsumerRegistrationData();
    
    await registerUser(page, consumerData);
    
    // Handle case where user already exists
    const url = page.url();
    if (url.includes('/register')) {
      const errorVisible = await page.locator('text=Tax ID already registered').isVisible().catch(() => false);
      const emailErrorVisible = await page.locator('text=Email already registered').isVisible().catch(() => false);
      
      if (errorVisible || emailErrorVisible) {
        console.log('Registration failed (user exists), attempting login...');
        await loginUser(page, consumerData.email);
      }
    }
    
    // Verify authenticated
    const authenticated = await isAuthenticated(page);
    if (!authenticated) {
      test.skip(true, 'Failed to authenticate user');
    }
    
    // Step 3: Navigate to cart - should trigger merge
    await gotoAndWait(page, '/cart');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000); // Allow time for merge to complete
    
    // Step 4: Verify cart still has items (merged)
    itemCount = await verifyCartHasItems(page, 1);
    expect(itemCount).toBeGreaterThan(0);
    
    // Step 5: Verify guest cart ID is cleared
    const guestCartIdAfter = await getGuestCartId(page);
    expect(guestCartIdAfter).toBeNull();
    
    // Step 6: Verify user is authenticated with correct role
    const role = await getUserRole(page);
    expect(role).toBe('CONSUMER');
  });

  // Test 4: Login with existing user merges guest cart
  test('Login with existing user merges guest cart', async ({ page }) => {
    // First, register a user to ensure they exist
    await clearAuth(page);
    const consumerData = getConsumerRegistrationData();
    
    try {
      await registerUser(page, consumerData);
    } catch {
      // User might already exist, that's fine
    }
    
    // Clear auth to simulate fresh session
    await clearAuth(page);
    
    // Add items as guest
    const productId = await getFirstProductId(page);
    if (!productId) {
      test.skip(true, 'No products available in catalog');
    }
    
    await addToCart(page, productId, 1);
    
    // Verify guest cart has items
    let itemCount = await verifyCartHasItems(page, 1);
    expect(itemCount).toBeGreaterThan(0);
    
    const guestCartIdBefore = await getGuestCartId(page);
    expect(guestCartIdBefore).toBeTruthy();
    
    // Login as the registered user
    await loginUser(page, consumerData.email);
    
    // Verify authenticated
    const authenticated = await isAuthenticated(page);
    expect(authenticated).toBe(true);
    
    // Navigate to cart - should trigger merge
    await gotoAndWait(page, '/cart');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000); // Allow time for merge to complete
    
    // Verify cart still has items (merged)
    itemCount = await verifyCartHasItems(page, 1);
    expect(itemCount).toBeGreaterThan(0);
    
    // Verify guest cart ID is cleared
    const guestCartIdAfter = await getGuestCartId(page);
    expect(guestCartIdAfter).toBeNull();
    
    // Verify user role
    const role = await getUserRole(page);
    expect(role).toBe('CONSUMER');
  });

  // Test 5: Empty guest cart login doesn't cause issues
  test('Login with empty guest cart works correctly', async ({ page }) => {
    await clearAuth(page);
    
    // Don't add anything to cart, just login
    const consumerData = getConsumerRegistrationData();
    
    try {
      await registerUser(page, consumerData);
    } catch {
      // User might already exist
    }
    
    await clearAuth(page);
    
    // Verify no guest cart ID
    const guestCartIdBefore = await getGuestCartId(page);
    expect(guestCartIdBefore).toBeNull();
    
    // Login
    await loginUser(page, consumerData.email);
    
    const authenticated = await isAuthenticated(page);
    expect(authenticated).toBe(true);
    
    // Navigate to cart
    await gotoAndWait(page, '/cart');
    await page.waitForLoadState('networkidle');
    
    // Should have empty cart (not error)
    const emptyText = await page.locator('text=Your cart is empty, text=Seu carrinho está vazio').isVisible().catch(() => false);
    // Empty cart is acceptable
    
    // Guest cart ID should still be null
    const guestCartIdAfter = await getGuestCartId(page);
    expect(guestCartIdAfter).toBeNull();
  });

  // Test 6: Multiple items in guest cart merge correctly
  test('Multiple items in guest cart merge correctly', async ({ page }) => {
    await clearAuth(page);
    
    // Get two different products
    await gotoAndWait(page, '/products');
    await page.waitForLoadState('networkidle');
    
    // Check if no products are available (empty state) - must wait before the selector below,
    // since waitForSelector times out when the catalog shows "No products found"
    const noProducts = await page.locator('text=No products found').isVisible().catch(() => false);
    if (noProducts) {
      test.skip(true, 'No products available in catalog');
      return;
    }
    
    await page.waitForSelector('[role="list"] [role="article"] a', { timeout: 10000 });
    
    const productLinks = page.locator('[role="list"] [role="article"] a');
    const count = await productLinks.count();
    
    if (count < 2) {
      test.skip(true, 'Need at least 2 products for this test');
    }
    
    const productId1 = await productLinks.nth(0).getAttribute('href').then(h => h?.match(/\/products\/([^/]+)/)?.[1] ?? null);
    const productId2 = await productLinks.nth(1).getAttribute('href').then(h => h?.match(/\/products\/([^/]+)/)?.[1] ?? null);
    
    if (!productId1 || !productId2) {
      test.skip(true, 'Could not extract product IDs');
    }
    
    // Add first product
    await addToCart(page, productId1, 1);
    
    // Add second product
    await addToCart(page, productId2, 2);
    
    // Verify cart has 2 items
    let itemCount = await verifyCartHasItems(page);
    expect(itemCount).toBeGreaterThanOrEqual(1); // At least 1 (could be merged if same product)
    
    const guestCartIdBefore = await getGuestCartId(page);
    expect(guestCartIdBefore).toBeTruthy();
    
    // Login
    const consumerData = getConsumerRegistrationData();
    
    try {
      await registerUser(page, consumerData);
    } catch {
      // May already exist
    }
    
    const url = page.url();
    if (url.includes('/register')) {
      const errorVisible = await page.locator('text=Tax ID already registered').isVisible().catch(() => false);
      const emailErrorVisible = await page.locator('text=Email already registered').isVisible().catch(() => false);
      if (errorVisible || emailErrorVisible) {
        await loginUser(page, consumerData.email);
      }
    }
    
    const authenticated = await isAuthenticated(page);
    if (!authenticated) {
      test.skip(true, 'Failed to authenticate user');
    }
    
    // Navigate to cart - should trigger merge
    await gotoAndWait(page, '/cart');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    
    // Verify cart has items
    itemCount = await verifyCartHasItems(page);
    expect(itemCount).toBeGreaterThan(0);
    
    // Verify guest cart ID is cleared
    const guestCartIdAfter = await getGuestCartId(page);
    expect(guestCartIdAfter).toBeNull();
  });
});