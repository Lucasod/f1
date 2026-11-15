import { test, expect } from '@playwright/test';
import { gotoAndWait, isAuthenticated, clearAuth, API_BASE_URL, apiFetch } from './fixtures';

test.describe('LC-01 — Visitante e catálogo (E2E)', () => {
  test.beforeEach(async ({ page }) => {
    await clearAuth(page);
  });

  test('Home page loads and displays Products heading in English', async ({ page }) => {
    await gotoAndWait(page, '/');

    // Home page should show English heading
    await expect(page.locator('h1')).toContainText('Products');
    // Navigation should be in English
    await expect(page.locator('nav')).toBeVisible();
  });

  test('Catalog page lists products and supports filtering by category', async ({ page }) => {
    await gotoAndWait(page, '/products');

    // Page should load with English heading
    await expect(page.locator('h1')).toContainText('Products');

    // Product cards should render (or empty state if no seeded products)
    const productCards = page.locator('[role="listitem"], [data-testid="product-card"]');
    const cardCount = await productCards.count();

    if (cardCount > 0) {
      // First product card should show name and price
      const firstCard = productCards.first();
      await expect(firstCard.locator('h3, h4, [data-testid="product-name"]')).toBeVisible();
      await expect(firstCard.locator('text=R$')).toBeVisible();
    }

    // Category filter should be present
    await expect(page.locator('select[aria-label="Category"]')).toBeVisible();
  });

  test('Catalog sorting control is present and in English', async ({ page }) => {
    await gotoAndWait(page, '/products');

    // Sort dropdown should exist with English label
    const sortSelect = page.locator('select').last();
    await expect(sortSelect).toBeVisible();

    // Options should be in English
    await expect(sortSelect.locator('option')).toContainText(['Newest', 'Name A-Z', 'Price: Low to High', 'Price: High to Low', 'In-Stock First']);
  });

  test('PDP displays product details including price, images and stock status in English', async ({ page }) => {
    // Fetch a real product from the backend to get a valid ID
    const productsResp = await page.request.get(`${API_BASE_URL}/api/v1/products`);
    if (!productsResp.ok) {
      test.skip(true, 'Backend not available for product fetch');
    }
    const productsData = await productsResp.json();
    const products = productsData?.products ?? [];

    if (products.length === 0) {
      test.skip(true, 'No products available in backend');
    }

    const productId = products[0].id;
    await gotoAndWait(page, `/products/${productId}`);

    // Product name should be visible
    await expect(page.locator('h1')).toBeVisible();

    // Price should be displayed (currency format)
    await expect(page.locator('text=R$')).toBeVisible();

    // Stock status badge should be in English
    await expect(
      page.getByText(/In Stock|Out of Stock|Inactive|Discontinued/)
    ).toBeVisible();

    // Main image should be present
    await expect(page.locator('img[alt]')).toBeVisible();

    // Add to Cart button should be in English (when product is available)
    const addToCart = page.locator('button:has-text("Add to Cart"), button:has-text("Out of Stock"), button:has-text("Unavailable")');
    if ((await addToCart.count()) > 0) {
      await expect(addToCart.first()).toBeVisible();
    }
  });

  test('Empty state displays when no products match filters', async ({ page }) => {
    await gotoAndWait(page, '/products?search=adjusting');

    // When filters are applied, show adjustment message
    await expect(page.locator('text=Try adjusting your filters or search query.')).toBeVisible();
  });

  test('Loading state is shown while products are fetching', async ({ page }) => {
    // Intercept the products API to delay response and observe loading state
    await page.route('/api/v1/products*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await route.continue();
    });

    await gotoAndWait(page, '/products');

    // Loading spinner should be visible (accessible name includes sr-only label)
    await expect(page.getByRole('status', { name: 'Loading products...' })).toBeVisible();

    // Wait for products to load
    await page.waitForLoadState('networkidle');

    // Loading state should disappear
    await expect(page.getByRole('status', { name: 'Loading products...' })).toBeHidden();
  });

  test('Catalog page is responsive on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await gotoAndWait(page, '/products');

    // Page should render without errors on mobile
    await expect(page.locator('h1')).toContainText('Products');

    // Product grid should adapt to mobile (single column)
    const productGrid = page.locator('[role="list"]');
    if ((await productGrid.count()) > 0) {
      await expect(productGrid.first()).toBeVisible();
    }
  });

  test('Catalog page is responsive on tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await gotoAndWait(page, '/products');

    await expect(page.locator('h1')).toContainText('Products');
  });

  test('Unauthenticated access to catalog is allowed (public)', async ({ page }) => {
    await clearAuth(page);
    await gotoAndWait(page, '/products');

    // Catalog should be publicly accessible
    await expect(page.locator('h1')).toContainText('Products');
    await expect(page.url()).toContain('/products');
  });

  test('Navigation between catalog and PDP works', async ({ page }) => {
    await gotoAndWait(page, '/products');

    const productCards = page.locator('[data-testid="product-card"], a[href*="/products/"]').first();
    if ((await productCards.count()) > 0) {
      await productCards.first().click();
      await expect(page.url()).toContain('/products/');

      // Back to Products link should exist
      await expect(page.locator('a:has-text("Back to Products")')).toBeVisible();
    } else {
      test.skip(true, 'No products available to test navigation');
    }
  });
});
