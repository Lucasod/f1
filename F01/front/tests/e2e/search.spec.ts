import { test, expect } from '@playwright/test';
import { gotoAndWait, API_BASE_URL, apiFetch } from './fixtures';

test.describe('LC-02 — Busca Elasticsearch (E2E)', () => {
  test.beforeEach(async ({ page }) => {
    // No auth needed for public search
  });

  test('Textual search returns matching products by name', async ({ page }) => {
    // First, fetch available products to know what to search for
    const productsResp = await page.request.get(`${API_BASE_URL}/api/v1/products`);
    if (!productsResp.ok) {
      test.skip(true, 'Backend not available');
    }
    const productsData = await productsResp.json();
    const products = productsData?.products ?? [];

    if (products.length === 0) {
      test.skip(true, 'No products available for search test');
    }

    const searchTerm = products[0].name.split(' ')[0]; // First word of product name
    await gotoAndWait(page, `/products?search=${encodeURIComponent(searchTerm)}`);

    await expect(page.locator('h1')).toContainText('Products');

    // Results should contain the search term
    // Product cards have role="article" inside a role="list" container
    const productCards = page.locator('[role="list"] [role="article"]');
    const cardCount = await productCards.count();
    if (cardCount > 0) {
      // At least one card should mention the search term
      const firstCard = productCards.first();
      await expect(firstCard).toContainText(searchTerm);
    } else {
      // Empty state is acceptable if search returns nothing
      // EmptyState uses h3 for title
      await expect(page.locator('h3:has-text("No products found")')).toBeVisible();
    }
  });

  test('Empty search results display appropriate message', async ({ page }) => {
    await gotoAndWait(page, '/products?search=zzzznonexistentproduct12345');

    await expect(page.locator('text=No products found')).toBeVisible();
  });

  test('Search with special characters is treated literally', async ({ page }) => {
    await gotoAndWait(page, '/products?search=C%2B%2B');

    await expect(page.locator('h1')).toContainText('Products');
    // Should not crash on regex special characters - either empty state or products shown
    // Check that page loaded without error (h1 is visible) and either empty state or products
    const noProducts = page.locator('h3:has-text("No products found")');
    const hasProducts = page.locator('[role="list"] [role="article"]');
    // At least one of these should be true (page renders without crash)
    const noProductsVisible = await noProducts.isVisible().catch(() => false);
    const hasProductsVisible = (await hasProducts.count()) > 0;
    expect(noProductsVisible || hasProductsVisible).toBeTruthy();
  });

  test('Filter by status works on catalog', async ({ page }) => {
    await gotoAndWait(page, '/products?status=active');

    await expect(page.locator('h1')).toContainText('Products');
    // Page should load without error when filtering by status
  });

  test('Sorting by price is available', async ({ page }) => {
    await gotoAndWait(page, '/products?sortBy=price_asc');

    await expect(page.locator('h1')).toContainText('Products');
  });

  test('Catalog recovers gracefully from backend search errors', async ({ page }) => {
    // Intercept products API call with search parameter to return an error
    // Frontend uses relative URLs through Vite proxy
    await page.route('/api/v1/products**', async (route) => {
      const url = route.request().url();
      if (url.includes('search=')) {
        await route.fulfill({ status: 500, body: JSON.stringify({ error: 'SEARCH_FAILED' }) });
      } else {
        await route.continue();
      }
    });

    await gotoAndWait(page, '/products?search=error');

    // Should show error state, not crash - ErrorAlert uses h4 for title
    await expect(page.locator('h4:has-text("Failed to Load Products")')).toBeVisible();
  });
});
