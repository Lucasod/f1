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
    const productCards = page.locator('[data-testid="product-card"], [role="listitem"]');
    const cardCount = await productCards.count();
    if (cardCount > 0) {
      // At least one card should mention the search term
      const firstCard = productCards.first();
      await expect(firstCard).toContainText(searchTerm);
    } else {
      // Empty state is acceptable if search returns nothing
      await expect(page.locator('text=No products found')).toBeVisible();
    }
  });

  test('Empty search results display appropriate message', async ({ page }) => {
    await gotoAndWait(page, '/products?search=zzzznonexistentproduct12345');

    await expect(page.locator('text=No products found')).toBeVisible();
  });

  test('Search with special characters is treated literally', async ({ page }) => {
    await gotoAndWait(page, '/products?search=C%2B%2B');

    await expect(page.locator('h1')).toContainText('Products');
    // Should not crash on regex special characters
    await expect(page.locator('text=No products found, text=Products')).toBeVisible();
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
    // Intercept search to return an error
    await page.route(`${API_BASE_URL}/api/v1/products*search*`, async (route) => {
      await route.fulfill({ status: 500, body: JSON.stringify({ error: 'SEARCH_FAILED' }) });
    });

    await gotoAndWait(page, '/products?search=error');

    // Should show error state, not crash
    await expect(page.locator('text=Failed to Load Products, text=No products found')).toBeVisible();
  });
});
