import { test, expect } from '@playwright/test';

test('Product image validation', async ({ page }) => {
  // Home page
  await page.goto('http://localhost:5173/');
  await page.waitForLoadState('networkidle');
  
  // Check product images
  const productImages = page.locator('img[src*="/api/v1/uploads/products"]');
  const count = await productImages.count();
  console.log('Product images found on home:', count);
  
  for (let i = 0; i < count; i++) {
    const img = productImages.nth(i);
    const src = await img.getAttribute('src');
    const isVisible = await img.isVisible();
    console.log('Home image ' + i + ': src=' + src + ', visible=' + isVisible);
  }
  
  // Catalog page
  await page.goto('http://localhost:5173/products');
  await page.waitForLoadState('networkidle');
  
  const catalogImages = page.locator('img[src="/api/v1/uploads/products"]');
  const catalogCount = await catalogImages.count();
  console.log('Product images found on catalog:', catalogCount);
  
  for (let i = 0; i < catalogCount; i++) {
    const img = catalogImages.nth(i);
    const src = await img.getAttribute('src');
    const isVisible = await img.isVisible();
    console.log('Catalog image ' + i + ': src=' + src + ', visible=' + isVisible);
  }
  
  // PDP for first product
  const firstLink = page.locator('a[href*="/products/"]').first();
  await firstLink.click();
  await page.waitForLoadState('networkidle');
  
  const pdpImages = page.locator('img[src="/api/v1/uploads/products"]');
  const pdpCount = await pdpImages.count();
  console.log('Product detail page images:', pdpCount);
  
  for (let i = 0; i < pdpCount; i++) {
    const img = pdpImages.nth(i);
    const src = await img.getAttribute('src');
    const isVisible = await img.isVisible();
    console.log('PDP image ' + i + ': src=' + src + ', visible=' + isVisible);
  }
  
  await page.close();
});
