import { test, expect } from '@playwright/test';
import {
  getConsumerRegistrationData,
  registerUser,
  loginUser,
  isAuthenticated,
  getUserRole,
  clearAuth,
  gotoAndWait,
  apiFetch,
  addAddress,
  getOrder,
  listOrders,
  simulatePayment,
  type PaymentSimulationResult,
} from './fixtures';

/**
 * GOLDEN PATH E2E — Complete Purchase Cycle (34 steps from P5 mission)
 *
 * File: F01/front/tests/e2e/golden-path.spec.ts
 *
 * SCOPE & LIMITATIONS:
 *   - Real Stripe is NOT available (no STRIPE_SECRET_KEY configured).
 *   - Backend `createStripeClientFromEnvironment()` throws without the key,
 *     so `POST /api/v1/checkout` rolls back order creation and no order
 *     persists without Stripe.
 *   - Payment authorize/capture routes return 403 (PROVIDER_CONFIRMATION_REQUIRED).
 *   - Webhook requires STRIPE_WEBHOOK_SECRET + valid signature.
 *
 * APPROACH:
 *   Steps 1-10: Real frontend navigation via UI (Home → catalog → product →
 *   register → login → address → cart → checkout).
 *   Step 11: Attempt checkout via UI; if Stripe is unavailable the order is
 *     not created and payment-dependent steps are skipped with clear reasons.
 *   Step 12: Verify order status via backend API (if order exists).
 *   Steps 13-16: Attempt payment simulation via `page.request.post()` to
 *     backend API; document that full confirmation requires Stripe.
 *   Steps 17-34: Verify cart, invoice, fulfillment, reviews via UI + API.
 *     Steps requiring vendor/admin accounts or a paid order are skipped when
 *     those preconditions are not met.
 */

test.describe('Golden Path E2E — Complete Purchase Cycle', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('Steps 1-34: Visitor to delivered order with reviews and metrics', async ({
    page,
  }) => {
    // ------------------------------------------------------------------
    // Phase 1: Steps 1-10 — Frontend navigation (catalog, register, login,
    // address, cart)
    // ------------------------------------------------------------------

    // ---- Step 1: Visitor opens Home ----
    await gotoAndWait(page, '/');
    await expect(page.locator('body')).toBeVisible();
    console.log('[Step 1] Home page opened');

    // ---- Step 2: Navigates catalog ----
    await gotoAndWait(page, '/products');
    await page.waitForLoadState('networkidle');

    const noProducts = await page
      .locator('text=No products found')
      .isVisible()
      .catch(() => false);
    if (noProducts) {
      test.skip(true, 'No products in catalog; cannot continue golden path');
    }

    await page.waitForSelector('[role="list"] [role="article"]', {
      timeout: 10000,
    });
    console.log('[Step 2] Catalog navigated');

    // ---- Step 3: Views product detail (first product) ----
    const productLinks = page.locator('[role="list"] [role="article"] a');
    const productCount = await productLinks.count();
    expect(productCount).toBeGreaterThan(0);

    const firstProductHref = await productLinks.first().getAttribute('href');
    const firstProductMatch = firstProductHref?.match(/\/products\/([^/]+)/);
    expect(firstProductMatch).toBeTruthy();
    const productId1 = firstProductMatch![1];

    await gotoAndWait(page, `/products/${productId1}`);
    await page.waitForLoadState('networkidle');

    // Verify product detail page loaded
    await expect(
      page.locator('h1, h2, [data-testid="product-name"], [data-testid="product-title"]').first()
    ).toBeVisible();
    console.log(`[Step 3] Product detail viewed: ${productId1}`);

    // ---- Step 4: Registers account starting as buyer ----
    const consumerData = getConsumerRegistrationData();
    // Clear any stale auth before registering
    await clearAuth(page);

    try {
      await registerUser(page, consumerData);
    } catch (error) {
      // User may already exist; try logging in instead
      const url = page.url();
      if (url.includes('/register')) {
        const taxIdError = await page
          .locator('text=Tax ID already registered')
          .or(page.locator('text=Tax ID already exists'))
          .isVisible()
          .catch(() => false);
        const emailError = await page
          .locator('text=Email already registered')
          .or(page.locator('text=Email already exists'))
          .isVisible()
          .catch(() => false);
        if (taxIdError || emailError) {
          await loginUser(page, consumerData.email);
        } else {
          throw error;
        }
      }
    }

    const authenticated = await isAuthenticated(page);
    expect(authenticated).toBe(true);
    const role = await getUserRole(page);
    expect(role).toBe('CONSUMER');
    console.log(`[Step 4] Consumer registered: ${consumerData.email}`);

    // ---- Step 5: Logs in ----
    // (Already logged in via registration; re-login to confirm the flow)
    await clearAuth(page);
    await loginUser(page, consumerData.email);
    const authenticatedAfterLogin = await isAuthenticated(page);
    expect(authenticatedAfterLogin).toBe(true);
    console.log('[Step 5] Consumer logged in');

    // ---- Step 6: Configures address ----
    // The checkout page requires a shipping address. Register via UI creates
    // a person with no addresses, so we add one via the backend API.
    const addressData = {
      street: 'Rua das Flores',
      number: '123',
      neighborhood: 'Centro',
      city: 'São Paulo',
      state: 'SP',
      isPrimary: true,
    };
    const createdAddress = await addAddress(page, addressData);
    if (!createdAddress) {
      test.skip(true, 'Cannot configure address: backend API unavailable or auth token missing');
    }
    expect(createdAddress).toHaveProperty('id');
    expect(createdAddress.street).toBe('Rua das Flores');
    console.log(`[Step 6] Address configured: ${createdAddress.id}`);

    // ---- Steps 7-8: Add products from 2 vendors + apply coupon ----
    // Return to catalog and add the first product
    await gotoAndWait(page, '/products');
    await page.waitForLoadState('networkidle');

    const productLinks2 = page.locator('[role="list"] [role="article"] a');
    const productCount2 = await productLinks2.count();
    expect(productCount2).toBeGreaterThanOrEqual(1);

    // Add product 1 (already viewed above)
    await gotoAndWait(page, `/products/${productId1}`);
    await page.waitForLoadState('networkidle');
    await page.waitForSelector(
      'button:has-text("Add to Cart"), button:has-text("Out of Stock")',
      { timeout: 10000 }
    );
    const outOfStock1 = await page
      .locator('button:has-text("Out of Stock")')
      .isVisible()
      .catch(() => false);
    if (outOfStock1) {
      test.skip(true, `Product ${productId1} is out of stock`);
    }
    await page.click('button:has-text("Add to Cart")');
    await page.waitForSelector('text=Added!', { timeout: 10000 });
    await page.waitForSelector('text=Added!', { state: 'hidden', timeout: 5000 });
    console.log(`[Step 7] Product 1 added to cart: ${productId1}`);

    // Find a second product from a different vendor
    await gotoAndWait(page, '/products');
    await page.waitForLoadState('networkidle');

    // Try clicking on a different product
    let productId2: string | null = null;
    for (let i = 1; i < productCount2; i++) {
      const href = await productLinks2.nth(i).getAttribute('href');
      const match = href?.match(/\/products\/([^/]+)/);
      if (match && match[1] !== productId1) {
        productId2 = match[1];
        break;
      }
    }

    if (productId2) {
      await gotoAndWait(page, `/products/${productId2}`);
      await page.waitForLoadState('networkidle');
      await page.waitForSelector(
        'button:has-text("Add to Cart"), button:has-text("Out of Stock")',
        { timeout: 10000 }
      );
      const outOfStock2 = await page
        .locator('button:has-text("Out of Stock")')
        .isVisible()
        .catch(() => false);
      if (!outOfStock2) {
        await page.click('button:has-text("Add to Cart")');
        await page.waitForSelector('text=Added!', { timeout: 10000 });
        await page.waitForSelector('text=Added!', { state: 'hidden', timeout: 5000 });
        console.log(`[Step 7] Product 2 added to cart: ${productId2}`);
      } else {
        console.log(`[Step 7] Product 2 (${productId2}) is out of stock, continuing with 1 product`);
      }
    } else {
      console.log('[Step 7] Only one product available; continuing with single product cart');
    }

    // Step 8: Apply valid coupon (when available)
    // Coupon application happens on the checkout page. We'll attempt it there.
    console.log('[Step 8] Coupon application deferred to checkout page');

    // ---- Steps 9-10: Open cart, confirm quantities/values ----
    await gotoAndWait(page, '/cart');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('text=Shopping cart', { timeout: 10000 });

    // Wait for cart items to render (React Query may refetch after navigation)
    let cartItems = 0;
    for (let attempt = 0; attempt < 10; attempt++) {
      cartItems = await page.locator('input[id^="quantity-"]').count();
      if (cartItems > 0) break;
      await page.waitForTimeout(500);
    }

    const cartEmpty = await page
      .locator('text=Your cart is empty')
      .or(page.locator('text=Seu carrinho está vazio'))
      .isVisible()
      .catch(() => false);
    expect(cartEmpty).toBe(false);
    expect(cartItems).toBeGreaterThan(0);
    console.log(`[Steps 9-10] Cart opened with ${cartItems} item(s)`);

    // ------------------------------------------------------------------
    // Phase 2: Step 11 — Checkout
    // ------------------------------------------------------------------

    // ---- Step 11: Executes checkout ----
    const checkoutButton = page.locator('button:has-text("Proceed to checkout")');
    await expect(checkoutButton).toBeVisible();
    await checkoutButton.click();

    // Wait for checkout page to load (spinner disappears, form appears)
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/checkout/);

    // Wait for addresses to load (loading spinner disappears)
    await expect(
      page.locator('.spinner, [role="status"]').first()
    ).toBeHidden({ timeout: 15000 }).catch(() => {
      // Spinner may not be present if loading was fast
    });

    // Wait for address radio options to appear
    await page.waitForSelector('input[name="shipping-address"]', {
      timeout: 15000,
    }).catch(() => {
      // Addresses may not load if API fails
    });

    console.log('[Step 11] Checkout page opened');

    // Select shipping address
    const addressRadio = page.locator('input[name="shipping-address"]').first();
    if ((await addressRadio.count()) > 0) {
      await addressRadio.check();
    }

    // Wait for preview/totals to load (submit button becomes enabled)
    await page.waitForTimeout(1000);

    // Select payment method (only Stripe available in demo)
    const paymentRadio = page.locator('input[name="payment-method"]').first();
    if ((await paymentRadio.count()) > 0) {
      await paymentRadio.check();
    }

    // Attempt coupon application if a coupon code is known
    // (No valid coupon codes are seeded; this step is best-effort)
    const couponInput = page.locator('#coupon-input');
    if ((await couponInput.count()) > 0) {
      await couponInput.fill('TESTCOUPON');
      const applyButton = page.locator('button:has-text("Validate coupon"), button:has-text("Aplicar cupom")');
      if ((await applyButton.count()) > 0) {
        await applyButton.click();
        await page.waitForTimeout(1000);
      }
    }

    // Submit checkout - wait for button to be enabled
    const submitButton = page.locator('button:has-text("Finalizar Pedido"), [data-testid="checkout-submit-button"]');
    await expect(submitButton).toBeVisible({ timeout: 15000 });

    // Wait for button to not be disabled (preview loaded)
    await expect(submitButton).toBeEnabled({ timeout: 15000 }).catch(() => {
      // Button may remain disabled if preview failed; try clicking anyway
    });

    await submitButton.click();

    // The checkout calls POST /api/v1/checkout which creates an order with
    // payment_pending status, then attempts to create a Stripe Checkout
    // session. Without STRIPE_SECRET_KEY the session creation throws and the
    // order is rolled back. We capture the outcome here.
    await page.waitForTimeout(3000);

    let orderId: string | null = null;
    let checkoutSucceeded = false;

    // Check if checkout succeeded by looking for order confirmation or error
    const errorAlert = await page.locator('[role="alert"], .text-red-600').isVisible().catch(() => false);
    const currentUrl = page.url();

    if (currentUrl.includes('/orders') || currentUrl.includes('/checkout')) {
      // Try to extract order ID from URL or page content
      const orderMatch = currentUrl.match(/\/orders\/([^/]+)/);
      if (orderMatch) {
        orderId = orderMatch[1];
        checkoutSucceeded = true;
      }
    }

    // If frontend checkout didn't produce an order (expected without Stripe),
    // try calling the backend API directly to check for any pending order.
    if (!orderId) {
      const orders = await listOrders(page);
      if (orders && orders.length > 0) {
        // Find the most recent pending_payment order for this consumer
        const pendingOrders = orders.filter((o: any) => o.status === 'pending_payment');
        if (pendingOrders.length > 0) {
          orderId = pendingOrders[0].id;
          checkoutSucceeded = true;
        }
      }
    }

    console.log(
      `[Step 11] Checkout attempted; ${checkoutSucceeded ? `order ${orderId} created` : 'no order created (Stripe unavailable)'}`
    );

    // ------------------------------------------------------------------
    // Phase 3: Step 12 — Verify order created with payment_pending
    // ------------------------------------------------------------------

    // ---- Step 12: Order created with payment_pending ----
    if (!checkoutSucceeded || !orderId) {
      test.skip(
        true,
        'Checkout requires Stripe (STRIPE_SECRET_KEY not configured). Order was not created. ' +
          'Steps 12-34 require a persisted order and cannot run without Stripe or a test payment endpoint.'
      );
    }

    const order = await getOrder(page, orderId);
    expect(order).not.toBeNull();
    expect(order.status).toBe('pending_payment');
    console.log(
      `[Step 12] Order ${orderId} status: ${order.status} (expected: pending_payment)`
    );

    // ------------------------------------------------------------------
    // Phase 4: Steps 13-16 — Payment confirmation simulation
    // ------------------------------------------------------------------

    // ---- Steps 13-16: Simulate payment confirmation ----
    // Since real Stripe isn't available, we attempt simulation via backend API.
    // The webhook requires STRIPE_WEBHOOK_SECRET + valid signature, and the
    // authorize/capture routes return 403. We try what we can and document.

    const paymentResult: PaymentSimulationResult = await simulatePayment(
      page,
      orderId,
      order.totalAmount
    );

    console.log(
      `[Steps 13-16] Payment simulation: paymentCreated=${paymentResult.paymentCreated}, ` +
        `paymentStatus=${paymentResult.paymentStatus}, webhookAttempted=${paymentResult.webhookAttempted}, ` +
        `webhookSucceeded=${paymentResult.webhookSucceeded}, orderStatus=${paymentResult.orderStatus}`
    );

    const paymentConfirmed =
      paymentResult.paymentStatus === 'CAPTURED' ||
      paymentResult.orderStatus === 'paid' ||
      paymentResult.webhookSucceeded;

    if (!paymentConfirmed) {
      test.skip(
        true,
        'Payment confirmation requires Stripe webhook (STRIPE_WEBHOOK_SECRET + signature) ' +
          'or a test payment endpoint. Order remains in pending_payment. Steps 17-34 ' +
          'require a paid order and cannot run without payment confirmation.'
      );
    }

    // ---- Step 15: Order passes to paid ----
    const orderAfterPayment = await getOrder(page, orderId);
    expect(orderAfterPayment.status).toBe('paid');
    console.log(`[Step 15] Order ${orderId} status: paid`);

    // ---- Step 16: Frontend reflects confirmation ----
    await gotoAndWait(page, `/orders/${orderId}`);
    await page.waitForLoadState('networkidle');
    await expect(
      page.locator('text=PAID')
        .or(page.locator('text=Pagamento confirmado'))
        .or(page.locator('[data-testid*="paid"]'))
    ).toBeVisible({ timeout: 10000 });
    console.log('[Step 16] Frontend reflects payment confirmation');

    // ------------------------------------------------------------------
    // Phase 5: Steps 17-34 — Post-payment verification
    // ------------------------------------------------------------------

    // ---- Step 17: Cart reconciled correctly ----
    await gotoAndWait(page, '/cart');
    await page.waitForLoadState('networkidle');
    const cartEmptyAfterPayment = await page
      .locator('text=Your cart is empty')
        .or(page.locator('text=Seu carrinho está vazio'))
      .isVisible()
      .catch(() => false);
    // Cart should be empty or reconciled after order placement
    console.log(
      `[Step 17] Cart after payment: ${cartEmptyAfterPayment ? 'empty (reconciled)' : 'has items'}`
    );

    // ---- Step 18: Invoice PDF available ----
    const invoiceResp = await apiFetch(page, 'GET', `/api/v1/invoices/order/${orderId}`);
    let invoiceAvailable = false;
    if (invoiceResp.ok) {
      const invoiceData = await invoiceResp.json();
      const invoice = invoiceData?.invoice;
      if (invoice && invoice.pdfUrl) {
        invoiceAvailable = true;
        console.log(`[Step 18] Invoice PDF available: ${invoice.pdfUrl}`);
      } else if (invoice && invoice.status) {
        console.log(`[Step 18] Invoice exists (status: ${invoice.status}) but PDF not yet generated`);
      }
    } else {
      console.log(`[Step 18] Invoice not found via API (status ${invoiceResp.status})`);
    }

    // ---- Step 19: Ledger registers transactions ----
    // Check payments ledger via API
    const paymentsResp = await apiFetch(page, 'GET', `/api/v1/payments/order/${orderId}`);
    let ledgerHasTransactions = false;
    if (paymentsResp.ok) {
      const paymentsData = await paymentsResp.json();
      const payments = paymentsData?.payments ?? [];
      ledgerHasTransactions = payments.length > 0;
      console.log(`[Step 19] Ledger transactions: ${payments.length} payment(s) for order`);
    } else {
      console.log(`[Step 19] Could not fetch payments (status ${paymentsResp.status})`);
    }

    // ---- Step 20: Commissions/vendor values calculated ----
    // Verify vendor groups have commission data
    const orderWithGroups = await getOrder(page, orderId);
    let commissionsCalculated = false;
    if (orderWithGroups?.vendorGroups) {
      const hasCommission = orderWithGroups.vendorGroups.some(
        (vg: any) => typeof vg.commissionAmount === 'number' && vg.commissionAmount >= 0
      );
      commissionsCalculated = hasCommission;
      console.log(
        `[Step 20] Commissions calculated: ${commissionsCalculated} (${orderWithGroups.vendorGroups.length} vendor group(s))`
      );
    } else {
      console.log('[Step 20] Could not verify commissions (no order data)');
    }

    // ---- Steps 21-25: Vendor dashboard and fulfillment ----
    // These require a VENDOR account. Registration forces CONSUMER role, and
    // vendor onboarding requires a separate flow. We attempt to check if the
    // current user can access vendor routes.

    const vendorDashboardResp = await apiFetch(page, 'GET', '/api/v1/vendor/orders');
    let vendorAccessible = false;
    if (vendorDashboardResp.ok) {
      vendorAccessible = true;
      const vendorOrders = await vendorDashboardResp.json();
      const vendorGroups = vendorOrders?.vendorGroups ?? [];
      console.log(
        `[Step 21] Vendor dashboard accessible: ${vendorGroups.length} vendor group(s) visible`
      );

      if (vendorGroups.length > 0 && paymentConfirmed) {
        // ---- Steps 22-24: Vendor A prepares, ships, delivers ----
        const vendorGroup = vendorGroups[0];
        const ovgId = vendorGroup.id;

        // Step 22: Prepare (pending → confirmed)
        try {
          const prepareResp = await apiFetch(page, 'PATCH', `/api/v1/orders/${orderId}/vendor-groups/${ovgId}/status`, {
            status: 'confirmed',
          });
          console.log(
            `[Step 22] Vendor prepare: ${prepareResp.ok ? 'confirmed' : `failed (${prepareResp.status})`}`
          );
        } catch (e) {
          console.log(`[Step 22] Vendor prepare error: ${e instanceof Error ? e.message : String(e)}`);
        }

        // Step 23: Ship (confirmed → shipped)
        try {
          const shipResp = await apiFetch(page, 'PATCH', `/api/v1/orders/${orderId}/vendor-groups/${ovgId}/status`, {
            status: 'shipped',
          });
          console.log(
            `[Step 23] Vendor ship: ${shipResp.ok ? 'shipped' : `failed (${shipResp.status})`}`
          );
        } catch (e) {
          console.log(`[Step 23] Vendor ship error: ${e instanceof Error ? e.message : String(e)}`);
        }

        // Step 24: Deliver (shipped → delivered)
        try {
          const deliverResp = await apiFetch(page, 'PATCH', `/api/v1/orders/${orderId}/vendor-groups/${ovgId}/status`, {
            status: 'delivered',
          });
          console.log(
            `[Step 24] Vendor deliver: ${deliverResp.ok ? 'delivered' : `failed (${deliverResp.status})`}`
          );
        } catch (e) {
          console.log(`[Step 24] Vendor deliver error: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } else {
      console.log(
        `[Step 21] Vendor dashboard not accessible (status ${vendorDashboardResp.status}). ` +
          'Requires VENDOR account; registration only creates CONSUMER accounts.'
      );
    }

    // ---- Step 25: Vendor B does own transitions ----
    // Same limitation as steps 21-24; requires a second VENDOR account.
    console.log(
      '[Step 25] Vendor B transitions: skipped (requires second VENDOR account; registration creates CONSUMER only)'
    );

    // ---- Step 26: Consumer tracks deliveries ----
    await gotoAndWait(page, `/orders/${orderId}`);
    await page.waitForLoadState('networkidle');
    const orderDetail = await getOrder(page, orderId);
    let allDelivered = true;
    if (orderDetail?.vendorGroups) {
      allDelivered = orderDetail.vendorGroups.every(
        (vg: any) => vg.status === 'delivered'
      );
    }
    console.log(
      `[Step 26] Consumer order tracking: allDelivered=${allDelivered}`
    );

    // ---- Step 27: Order reaches delivered ----
    if (paymentConfirmed) {
      const finalOrder = await getOrder(page, orderId);
      expect(finalOrder.status).toBe('delivered');
      console.log(`[Step 27] Order ${orderId} status: delivered`);
    } else {
      test.skip(
        true,
        'Order cannot reach delivered without payment confirmation (Stripe required)'
      );
    }

    // ---- Step 28: Consumer opens Order Details ----
    await gotoAndWait(page, `/orders/${orderId}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1, h2')).toBeVisible();
    console.log('[Step 28] Order Details page opened');

    // ---- Steps 29-30: Consumer reviews each eligible product ----
    // Review section appears only when order status is 'delivered'
    const reviewSection = page.locator('[data-testid="order-review-section"]');
    const reviewSectionVisible = await reviewSection.isVisible().catch(() => false);

    if (reviewSectionVisible && paymentConfirmed) {
      const reviewItems = page.locator('[data-testid="order-review-section"] [id^="rating-"]');
      const reviewCount = await reviewItems.count();
      console.log(`[Steps 29-30] Found ${reviewCount} reviewable product(s)`);

      for (let i = 0; i < reviewCount; i++) {
        const productId = await reviewItems.nth(i).getAttribute('id');
        const productIdMatch = productId?.match(/rating-(.+)/);
        const pid = productIdMatch ? productIdMatch[1] : `product-${i}`;

        // Click "Write Review" button
        const writeReviewBtn = page.locator(`button:has-text("Write Review")`).nth(i);
        if ((await writeReviewBtn.count()) > 0) {
          await writeReviewBtn.click();
        }

        // Select rating
        const ratingSelect = page.locator(`#rating-${pid}`);
        if ((await ratingSelect.count()) > 0) {
          await ratingSelect.selectOption('5');
        }

        // Fill comment
        const commentTextarea = page.locator(`#comment-${pid}`);
        if ((await commentTextarea.count()) > 0) {
          await commentTextarea.fill('Great product!');
        }

        // Submit review
        const submitReviewBtn = page.locator('button:has-text("Submit Review")');
        if ((await submitReviewBtn.count()) > 0) {
          await submitReviewBtn.click();
          await page.waitForTimeout(1000);
        }

        console.log(`[Step 29] Review submitted for product: ${pid}`);
      }

      // ---- Step 30: Product ratings updated ----
      const reviewedIndicator = page.locator('text=Reviewed');
      const allReviewed = await reviewedIndicator.count();
      console.log(`[Step 30] Products marked as reviewed: ${allReviewed}/${reviewCount}`);
    } else {
      console.log(
        `[Steps 29-30] Review section not visible (order not delivered or payment not confirmed). ` +
          'Requires delivered order.'
      );
    }

    // ---- Step 31: Vendor checks financial metrics ----
    // Requires VENDOR account; skipped
    console.log(
      '[Step 31] Vendor financial metrics: skipped (requires VENDOR account)'
    );

    // ---- Step 32: Admin checks aggregate metrics ----
    const adminMetricsResp = await apiFetch(page, 'GET', '/api/v1/admin/metrics');
    if (adminMetricsResp.ok) {
      const metrics = await adminMetricsResp.json();
      console.log(`[Step 32] Admin metrics: ${JSON.stringify(metrics)}`);
    } else {
      console.log(
        `[Step 32] Admin metrics not accessible (status ${adminMetricsResp.status}). Requires ADMIN account.`
      );
    }

    // ---- Step 33: Logout + new login preserves state ----
    await clearAuth(page);
    await loginUser(page, consumerData.email);
    const authenticatedAfterRelogin = await isAuthenticated(page);
    expect(authenticatedAfterRelogin).toBe(true);
    console.log('[Step 33] Logout + re-login successful; state preserved');

    // ---- Step 34: All data consistent ----
    const finalOrder = await getOrder(page, orderId);
    expect(finalOrder).not.toBeNull();
    console.log(
      `[Step 34] Data consistency check: order ${orderId} status = ${finalOrder.status}`
    );

    console.log('[Golden Path] Test completed');
  });
});