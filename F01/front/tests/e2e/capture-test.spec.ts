import { test, expect } from '@playwright/test';

test.describe('MP-F01-003 — Page Capture and Role Verification', () => {
  test('Task 2: Capture additional pages', async ({ page }) => {
    // ==========================================
    // Task 2: Capture additional pages
    // ==========================================

    // 1. Header as Visitor (no auth)
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    console.log('\n=== 1. Header as Visitor (no auth) ===');
    console.log('   URL:', page.url());
    console.log('   Title:', await page.title());
    await page.screenshot({ path: `/tmp/kilo/visitor-header.png`, fullPage: true });

    // 2. Header as Consumer (login)
    await page.click('text=Login');
    await page.waitForLoadState('networkidle');
    await page.fill('input[id="email"]', 'consumer@example.com');
    await page.fill('input[id="password"]', 'SecurePass123!');
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');
    console.log('=== 2. Header as Consumer (login) ===');
    console.log('   URL:', page.url());
    console.log('   Title:', await page.title());
    await page.screenshot({ path: `/tmp/kilo/consumer-header.png`, fullPage: true });

    // 3. Header as Vendor (login)
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.click('text=Login');
    await page.waitForLoadState('networkidle');
    await page.fill('input[id="email"]', 'vendor@example.com');
    await page.fill('input[id="password"]', 'SecurePass123!');
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');
    console.log('=== 3. Header as Vendor (login) ===');
    console.log('   URL:', page.url());
    console.log('   Title:', await page.title());
    await page.screenshot({ path: `/tmp/kilo/vendor-header.png`, fullPage: true });

    // 4. Header as Consumer + Vendor (dual role)
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    console.log('=== 4. Header as Consumer + Vendor (dual role) ===');
    console.log('   URL:', page.url());
    console.log('   Title:', await page.title());
    await page.screenshot({ path: `/tmp/kilo/dual-role-header.png`, fullPage: true });

    // ==========================================
    // Role-based navigation verification
    // ==========================================

    // 5. Verify role-based menu items
    // First, login as consumer
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.click('text=Login');
    await page.waitForLoadState('networkidle');
    await page.fill('input[id="email"]', 'consumer@example.com');
    await page.fill('input[id="password"]', 'SecurePass123!');
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');
    console.log('=== 5. Consumer menu items ===');
    const consumerMenu = page.locator('text=Consumer');
    console.log('   Consumer menu visible:', await consumerMenu.isVisible());

    // Login as vendor
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.click('text=Login');
    await page.waitForLoadState('networkidle');
    await page.fill('input[id="email"]', 'vendor@example.com');
    await page.fill('input[id="password"]', 'SecurePass123!');
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');
    console.log('=== 6. Vendor menu items ===');
    const vendorMenu = page.locator('text=Vendor');
    console.log('   Vendor menu visible:', await vendorMenu.isVisible());

    // Login as admin
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.click('text=Login');
    await page.waitForLoadState('networkidle');
    await page.fill('input[id="email"]', 'admin@example.com');
    await page.fill('input[id="password"]', 'SecurePass123!');
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');
    console.log('=== 7. Admin menu items ===');
    const adminMenu = page.locator('text=Admin');
    console.log('   Admin menu visible:', await adminMenu.isVisible());

    // Dual role - check both menus
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.click('text=Login');
    await page.waitForLoadState('networkidle');
    await page.fill('input[id="email"]', 'consumer@example.com');  // dual-role user
    await page.fill('input[id="password"]', 'SecurePass123!');
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');
    console.log('=== 8. Dual role (both menus) ===');
    const bothMenus = await page.locator('text=Consumer, text=Vendor').count();
    console.log('   Both menus visible count:', bothMenus);

    // 9. Admin isolated from operational features
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.click('text=Login');
    await page.waitForLoadState('networkidle');
    await page.fill('input[id="email"]', 'admin@example.com');
    await page.fill('input[id="password"]', 'SecurePass123!');
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');
    console.log('=== 9. Admin isolated from operational features ===');
    const accessDenied = page.locator('text=Access Denied');
    console.log('   Access Denied visible on consumer routes:', await page.goto('/orders').then(() => accessDenied.isVisible()).catch(() => false));

    // Continue capturing remaining pages
    await page.goto('/cart');
    await page.waitForLoadState('networkidle');
    console.log('=== 10. Cart page ===');
    console.log('   URL:', page.url());
    await page.screenshot({ path: `/tmp/kilo/cart-page.png`, fullPage: true });

    await page.goto('/orders');
    await page.waitForLoadState('networkidle');
    console.log('=== 11. Orders page (Consumer: My Purchases) ===');
    console.log('   URL:', page.url());
    await page.screenshot({ path: `/tmp/kilo/orders-page.png`, fullPage: true });

    await page.goto('/wallet');
    await page.waitForLoadState('networkidle');
    console.log('=== 12. Wallet page ===');
    console.log('   URL:', page.url());
    await page.screenshot({ path: `/tmp/kilo/wallet-page.png`, fullPage: true });

    // Product detail page
    await page.goto('/products');
    await page.waitForLoadState('networkidle');
    const firstProduct = page.locator(' [role="listitem"], .product-card, product').first();
    const productHref = await firstProduct.locator('a').first().getAttribute('href');
    await page.goto(`http://localhost:5173${productHref}`);
    await page.waitForLoadState('networkidle');
    console.log('=== 13. Product detail page ===');
    console.log('   URL:', page.url());
    console.log('   Title:', await page.title());
    await page.screenshot({ path: `/tmp/kilo/product-detail.png`, fullPage: true });

    // Catalog page with filters
    await page.goto('/products?filter=available');
    await page.waitForLoadState('networkidle');
    console.log('=== 14. Catalog page with filters ===');
    console.log('   URL:', page.url());
    await page.screenshot({ path: `/tmp/kilo/catalog-filters.png`, fullPage: true });

    // Mobile view
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.waitForLoadState('networkidle');
    console.log('=== 15. Mobile/responsive view ===');
    console.log('   URL:', page.url());
    console.log('   Title:', await page.title());
    await page.screenshot({ path: `/tmp/kilo/mobile-view.png`, fullPage: true });

    console.log('\n=== ALL CAPTURES COMPLETE ===');
  });
});
