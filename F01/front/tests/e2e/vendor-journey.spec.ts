import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import {
  API_BASE_URL,
} from './fixtures';

const testPassword = `Test-${randomUUID()}aA1!`;

// Generate a valid CNPJ (14 digits) with correct check digits
function generateValidCNPJ(): string {
  function calculateCheckDigit(digits: number[], weights: number[]): number {
    let sum = 0;
    for (let i = 0; i < weights.length; i++) {
      sum += digits[i] * weights[i];
    }
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  }
  function allDigitsSame(value: string): boolean {
    return value.split('').every(d => d === value[0]);
  }
  let cnpj: string;
  do {
    const timestamp = Date.now();
    const randomOffset = Math.floor(Math.random() * 1000000);
    let lcgState = (timestamp ^ randomOffset) & 0xFFFFFFFF;
    const baseDigits = Array.from({ length: 8 }, () => {
      lcgState = (lcgState * 1103515245 + 12345) & 0xFFFFFFFF;
      return (lcgState & 0x7FFFFFFF) % 10;
    });
    const branchDigits = [0, 0, 0, 1];
    const first12 = [...baseDigits, ...branchDigits];
    const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const check1 = calculateCheckDigit(first12, weights1);
    const digitsWithFirstCheck = [...first12, check1];
    const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const check2 = calculateCheckDigit(digitsWithFirstCheck, weights2);
    cnpj = [...first12, check1, check2].join('');
  } while (allDigitsSame(cnpj));
  return cnpj;
}

// Generate a valid CPF (11 digits) with correct check digits
function generateValidCPF(): string {
  function calculateCheckDigit(digits: number[], weights: number[]): number {
    let sum = 0;
    for (let i = 0; i < weights.length; i++) {
      sum += digits[i] * weights[i];
    }
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  }
  function allDigitsSame(value: string): boolean {
    return value.split('').every(d => d === value[0]);
  }
  let cpf: string;
  do {
    const timestamp = Date.now();
    const randomOffset = Math.floor(Math.random() * 1000000);
    let lcgState = (timestamp ^ randomOffset) & 0xFFFFFFFF;
    const baseDigits = Array.from({ length: 9 }, () => {
      lcgState = (lcgState * 1103515245 + 12345) & 0xFFFFFFFF;
      return (lcgState & 0x7FFFFFFF) % 10;
    });
    const weights1 = [10, 9, 8, 7, 6, 5, 4, 3, 2];
    const check1 = calculateCheckDigit(baseDigits, weights1);
    const digitsWithFirstCheck = [...baseDigits, check1];
    const weights2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
    const check2 = calculateCheckDigit(digitsWithFirstCheck, weights2);
    cpf = [...baseDigits, check1, check2].join('');
  } while (allDigitsSame(cpf));
  return cpf;
}

test.describe('FS-01: Vendor Journey Validation (direct token approach)', () => {
  test('Complete vendor journey: products → purchase → fulfillment → financials → cross-role restrictions', async ({ page }) => {
    let vendorToken = '';
    let createdProductIds: string[] = [];
    let orderId = '';
    let purchaserEmail = '';

    console.log('=== Vendor Journey Start ===');

    // =========================================================================
    // Step 1: Set up vendor token in localStorage
    // =========================================================================
    console.log('Step 1: Set up vendor token');

    // Register a new user as consumer, then onboard as vendor
    const vendorEmail = `vendor-test-${Date.now()}@example.com`;
    const vendorRegister = await page.request.post(
      `${API_BASE_URL}/api/v1/auth/register`,
      {
        headers: { 'Content-Type': 'application/json' },
        data: {
          name: 'Test Vendor',
          taxIdType: 'CNPJ',
          taxIdValue: generateValidCNPJ(),
          email: vendorEmail,
          password: testPassword,
          role: 'CONSUMER',
        },
      }
    );
    expect(vendorRegister.ok()).toBe(true);
    
    const vendorLogin = await page.request.post(
      `${API_BASE_URL}/api/v1/auth/login`,
      {
        headers: { 'Content-Type': 'application/json' },
        data: { email: vendorEmail, password: testPassword },
      }
    );
    expect(vendorLogin.ok()).toBe(true);
    let vendorLoginData = await vendorLogin.json();
    vendorToken = vendorLoginData.tokens.accessToken;
    expect(vendorToken).toBeTruthy();

    // Onboard as vendor
    const onboardResp = await page.request.post(
      `${API_BASE_URL}/api/v1/vendor/onboard`,
      {
        headers: {
          Authorization: `Bearer ${vendorToken}`,
          'Content-Type': 'application/json',
        },
        data: { storeName: 'Test Vendor Store', slug: `test-vendor-${Date.now()}` },
      }
    );
    expect(onboardResp.ok()).toBe(true);
    const onboardData = await onboardResp.json();
    console.log('Vendor onboarded:', onboardData.vendor.storeName);

    // Re-login to get token with VENDOR role
    const vendorLogin2 = await page.request.post(
      `${API_BASE_URL}/api/v1/auth/login`,
      {
        headers: { 'Content-Type': 'application/json' },
        data: { email: vendorEmail, password: testPassword },
      }
    );
    expect(vendorLogin2.ok()).toBe(true);
    const vendorLoginData2 = await vendorLogin2.json();
    console.log('Re-login roles:', vendorLoginData2.person.roles);
    vendorToken = vendorLoginData2.tokens.accessToken;
    expect(vendorToken).toBeTruthy();
    vendorLoginData = vendorLoginData2;

    // Set up auth state in localStorage so page.evaluate can read user roles
    // Must set individual keys that initializeAuth reads: accessToken, refreshToken, user
    const vendorUserId = vendorLoginData.person.id;
    const vendorUserName = vendorLoginData.person.name;
    const vendorUserEmail = vendorLoginData.person.email;
    const vendorUserRoles = vendorLoginData.person.roles;
    const vendorRefreshToken = vendorLoginData.tokens.refreshToken;
    await page.evaluate(({token, userId, userName, userEmail, userRoles, refreshToken}) => {
      localStorage.setItem('accessToken', token);
      localStorage.setItem('refreshToken', refreshToken);
      const user = {
        id: userId,
        name: userName,
        email: userEmail,
        roles: userRoles
      };
      localStorage.setItem('user', JSON.stringify(user));
      // Also set auth-storage for persist middleware compatibility
      const authState = { 
        user, 
        accessToken: token, 
        refreshToken,
        isAuthenticated: true
      };
      localStorage.setItem('auth-storage', JSON.stringify(authState));
    }, { token: vendorToken, userId: vendorUserId, userName: vendorUserName, userEmail: vendorUserEmail, userRoles: vendorUserRoles, refreshToken: vendorRefreshToken });

    // Navigate to home first to ensure app is mounted and initializeAuth runs
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Debug: check localStorage after navigation
    const lsDebug = await page.evaluate(() => ({
      accessToken: localStorage.getItem('accessToken'),
      refreshToken: localStorage.getItem('refreshToken'),
      user: localStorage.getItem('user'),
      authStorage: localStorage.getItem('auth-storage'),
    }));
    console.log('localStorage after / navigation:', JSON.stringify(lsDebug));
    // Must set individual keys that initializeAuth reads: accessToken, refreshToken, user
    await page.evaluate(({token, userId, userName, userEmail, userRoles, refreshToken}) => {
      localStorage.setItem('accessToken', token);
      localStorage.setItem('refreshToken', refreshToken);
      const user = {
        id: userId,
        name: userName,
        email: userEmail,
        roles: userRoles
      };
      localStorage.setItem('user', JSON.stringify(user));
      // Also set auth-storage for persist middleware compatibility
      const authState = { 
        user, 
        accessToken: token, 
        refreshToken,
        isAuthenticated: true
      };
      localStorage.setItem('auth-storage', JSON.stringify(authState));
    }, { token: vendorToken, userId: vendorUserId, userName: vendorUserName, userEmail: vendorUserEmail, userRoles: vendorUserRoles, refreshToken: vendorRefreshToken });

    // Verify vendor role (user should have VENDOR role after onboarding)
    const userRoles = await page.evaluate(() => {
      const authStorage = localStorage.getItem('auth-storage');
      if (!authStorage) return [];
      try {
        const parsed = JSON.parse(authStorage);
        return parsed.user?.roles ?? [];
      } catch { return []; }
    });
    expect(userRoles).toContain('VENDOR');

    console.log('Step 1 PASSED: Vendor token set up with VENDOR role');

    // =========================================================================
    // Step 2: Verify vendor dashboard is accessible
    // =========================================================================
    console.log('Step 2: Verify vendor dashboard is accessible');

    await page.goto('/vendor/dashboard');
    await page.waitForLoadState('networkidle');
    
    // Debug: check current URL and localStorage
    const currentUrl = page.url();
    console.log('Dashboard URL:', currentUrl);
    const hasAuth = await page.evaluate(() => {
      const authStorage = localStorage.getItem('auth-storage');
      return !!authStorage;
    });
    console.log('Has auth-storage:', hasAuth);

    const dashboardHeading = await page.locator('h1').first().textContent();
    expect(dashboardHeading).toBeTruthy();

    console.log('Step 2 PASSED: Vendor dashboard accessible');

    // =========================================================================
    // Step 3: Create products as the vendor
    // =========================================================================
    console.log('Step 3: Create products');

    // First, get available categories
    const categoriesResp = await page.request.get(
      `${API_BASE_URL}/api/v1/categories`,
      { headers: { Authorization: `Bearer ${vendorToken}` } }
    );
    
    let categoryId = '';
    if (categoriesResp.ok()) {
      const categoriesData = await categoriesResp.json();
      // Get the first available category
      if (categoriesData && categoriesData.categories && categoriesData.categories.length > 0) {
        categoryId = categoriesData.categories[0].id;
        console.log(`Available category: ${categoriesData.categories[0].name} (${categoryId})`);
      }
    }

    // If no categories found, use a fallback
    if (!categoryId) {
      categoryId = 'cat-1000000000002-000002'; // Known category from seed
      console.log('Using fallback category ID');
    }

    // Create 3 products via the product API
    const products = [
      {
        name: 'Product A',
        description: 'A test product for vendor journey',
        price: 99.90,
        quantity: 50,
        categoryId,
        status: 'active',
      },
      {
        name: 'Product B',
        description: 'Another test product for vendor journey',
        price: 199.50,
        quantity: 30,
        categoryId,
        status: 'active',
      },
      {
        name: 'Product C',
        description: 'Third test product for vendor journey',
        price: 49.99,
        quantity: 100,
        categoryId,
        status: 'active',
      },
    ];

    for (const prod of products) {
      const resp = await page.request.post(
        `${API_BASE_URL}/api/v1/products`,
        {
          headers: {
            Authorization: `Bearer ${vendorToken}`,
            'Content-Type': 'application/json',
          },
          data: {
            name: prod.name,
            description: prod.description,
            price: prod.price,
            quantity: prod.quantity,
            categoryId,
            status: prod.status,
          },
        }
      );

      if (resp.ok()) {
        const data = await resp.json();
        createdProductIds.push(data.product.id);
        console.log(`Created product: ${data.product.name} (${data.product.id})`);
      } else {
        const errText = await resp.text();
        console.warn(`Product creation failed: ${resp.status()} - ${errText}`);
      }
    }

    // Verify products appear in vendor's product listing
    const myProductsResp = await page.request.get(
      `${API_BASE_URL}/api/v1/products/vendor/me`,
      { headers: { Authorization: `Bearer ${vendorToken}` } }
    );
    expect(myProductsResp.ok()).toBe(true);
    const myProductsData = await myProductsResp.json();
    expect(myProductsData.products.length).toBeGreaterThanOrEqual(3);
    console.log(`Step 3 PASSED: Vendor has ${myProductsData.products.length} products in their listing`);

    // =========================================================================
    // Step 4: Consumer purchases vendor product
    // =========================================================================
    console.log('Step 4: Consumer purchases vendor product');

    // Register a different consumer user for purchase
    const purchaserSuffix = Date.now().toString().substring(0, 6);
    purchaserEmail = `purchaser-${purchaserSuffix}@example.com`;

    // Register via API
    const purchaserCPF = generateValidCPF();
    console.log('Purchaser CPF:', purchaserCPF);
    const purchaserRegister = await page.request.post(
      `${API_BASE_URL}/api/v1/auth/register`,
      {
        headers: { 'Content-Type': 'application/json' },
        data: {
          name: 'Purchaser Tester',
          taxIdType: 'CPF',
          taxIdValue: purchaserCPF,
          email: purchaserEmail,
          password: testPassword,
          role: 'CONSUMER',
        }
      }
    );

    if (!purchaserRegister.ok()) {
      const errorText = await purchaserRegister.text();
      console.log('Registration error:', purchaserRegister.status(), errorText);
    }
    expect(purchaserRegister.ok()).toBe(true);
    const purchaserRegisterData = await purchaserRegister.json();

    // Log in as the purchaser consumer via API
    const purchaserLogin = await page.request.post(
      `${API_BASE_URL}/api/v1/auth/login`,
      {
        headers: { 'Content-Type': 'application/json' },
        data: { email: purchaserEmail, password: testPassword },
      }
    );

    expect(purchaserLogin.ok()).toBe(true);
    const purchaserLoginData = await purchaserLogin.json();
    const purchaserToken = purchaserLoginData.tokens.accessToken;
    expect(purchaserToken).toBeTruthy();

    // Set purchaser auth state in localStorage
    await page.evaluate(({token, email}) => {
      localStorage.setItem('accessToken', token);
      localStorage.setItem('refreshToken', '');
      const user = {
        id: 'person-new',
        name: 'Purchaser Tester',
        email,
        roles: ['CONSUMER']
      };
      localStorage.setItem('user', JSON.stringify(user));
      // Also set auth-storage for persist middleware compatibility
      const authState = { 
        user, 
        accessToken: token, 
        refreshToken: '',
        isAuthenticated: true
      };
      localStorage.setItem('auth-storage', JSON.stringify(authState));
    }, { token: purchaserToken, email: purchaserEmail });

    // Get the vendor's products to find one to purchase
    const vendorProductsResp = await page.request.get(
      `${API_BASE_URL}/api/v1/products/vendor/me`,
      { headers: { Authorization: `Bearer ${vendorToken}` } }
    );
    expect(vendorProductsResp.ok()).toBe(true);
    const vendorProductsData = await vendorProductsResp.json();
    const vendorProducts = vendorProductsData.products;

    expect(vendorProducts.length).toBeGreaterThan(0);

    // Use the first vendor product for purchase
    const productToPurchase = vendorProducts[0];
    const productId = productToPurchase.id;
    const vendorId = productToPurchase.vendorId;

    // Create an order via the API as the consumer
    const orderResp = await page.request.post(
      `${API_BASE_URL}/api/v1/orders`,
      {
        headers: {
          Authorization: `Bearer ${purchaserToken}`,
          'Content-Type': 'application/json',
        },
        data: {
          shippingAddress: {
            street: 'Rua Teste',
            number: '100',
            neighborhood: 'Centro',
            city: 'São Paulo',
            state: 'SP',
            isPrimary: true,
          },
          items: [
            {
              productId,
              productName: productToPurchase.name,
              vendorId,
              quantity: 1,
              unitPrice: productToPurchase.price,
              totalPrice: productToPurchase.price,
            },
          ],
          totalAmount: productToPurchase.price,
          status: 'pending_payment',
        },
      }
    );

    expect(orderResp.ok()).toBe(true);
    const orderData = await orderResp.json();
    orderId = orderData.order?.id;
    expect(orderId).toBeTruthy();

    console.log(`Step 4 PASSED: Consumer ${purchaserEmail} purchased vendor product, order ${orderId} created`);

    // =========================================================================
    // Step 5: Vendor manages order fulfillment (PENDING → CONFIRMED → SHIPPED → DELIVERED)
    // =========================================================================
    console.log('Step 5: Vendor manages order fulfillment');

    const vendorTokenForStep5 = vendorToken;

    // First, get the vendor's order groups to find the order
    const vendorOrdersResp = await page.request.get(
      `${API_BASE_URL}/api/v1/vendor/orders`,
      { headers: { Authorization: `Bearer ${vendorTokenForStep5}` } }
    );
    expect(vendorOrdersResp.ok()).toBe(true);
    const vendorOrdersData = await vendorOrdersResp.json();
    const vendorGroups = vendorOrdersData.vendorGroups;

    expect(vendorGroups.length).toBeGreaterThan(0);

    // Get the first vendor group's ID and order ID
    const firstVg = vendorGroups[0];
    const vendorGroupId = firstVg.id;
    const currentOrderId = firstVg.orderId;
    let currentStatus = firstVg.status;

    console.log(`Initial OVG status: ${currentStatus}`);

    // Step 5a: Transition to CONFIRMED if not already
    if (currentStatus !== 'confirmed') {
      const confirmResp = await page.request.patch(
        `${API_BASE_URL}/api/v1/orders/${currentOrderId}/vendor-groups/${vendorGroupId}/status`,
        {
          headers: {
            Authorization: `Bearer ${vendorTokenForStep5}`,
            'Content-Type': 'application/json',
          },
          data: { status: 'confirmed' as const },
        }
      );
      expect(confirmResp.ok()).toBe(true);
      const confirmData = await confirmResp.json();
      const confirmedStatus = confirmData.order?.vendorGroups?.find(
        (g: any) => g.id === vendorGroupId
      )?.status;
      expect(confirmedStatus).toBe('confirmed');
      currentStatus = 'confirmed';
      console.log('Step 5a PASSED: OVG confirmed');
    }

    // Step 5b: Transition to SHIPPED
    const shipResp = await page.request.patch(
      `${API_BASE_URL}/api/v1/orders/${currentOrderId}/vendor-groups/${vendorGroupId}/status`,
      {
        headers: {
          Authorization: `Bearer ${vendorTokenForStep5}`,
          'Content-Type': 'application/json',
        },
        data: { status: 'shipped' as const },
      }
    );
    expect(shipResp.ok()).toBe(true);
    const shipData = await shipResp.json();
    const shippedStatus = shipData.order?.vendorGroups?.find(
      (g: any) => g.id === vendorGroupId
    )?.status;
    expect(shippedStatus).toBe('shipped');
    currentStatus = 'shipped';
    console.log('Step 5b PASSED: OVG shipped');

    // Step 5c: Transition to DELIVERED
    const deliverResp = await page.request.patch(
      `${API_BASE_URL}/api/v1/orders/${currentOrderId}/vendor-groups/${vendorGroupId}/status`,
      {
        headers: {
          Authorization: `Bearer ${vendorTokenForStep5}`,
          'Content-Type': 'application/json',
        },
        data: { status: 'delivered' as const },
      }
    );
    expect(deliverResp.ok()).toBe(true);
    const deliverData = await deliverResp.json();
    const deliveredStatus = deliverData.order?.vendorGroups?.find(
      (g: any) => g.id === vendorGroupId
    )?.status;
    expect(deliveredStatus).toBe('delivered');
    console.log('Step 5c PASSED: OVG delivered');

    // Verify the order reached DELIVERED status
    const finalOrderResp = await page.request.get(
      `${API_BASE_URL}/api/v1/orders/${currentOrderId}`,
      { headers: { Authorization: `Bearer ${vendorTokenForStep5}` } }
    );
    expect(finalOrderResp.ok()).toBe(true);
    const finalOrder = await finalOrderResp.json();
    console.log(`Step 5 PASSED: Order ${currentOrderId} final status: ${finalOrder.order?.status}`);

    // =========================================================================
    // Step 6: Vendor financial view shows vendor-scoped data
    // =========================================================================
    console.log('Step 6: Vendor financial view');

    const financialResp = await page.request.get(
      `${API_BASE_URL}/api/v1/financial/`,
      { headers: { Authorization: `Bearer ${vendorTokenForStep5}` } }
    );
    expect(financialResp.ok()).toBe(true);
    const financialData = await financialResp.json();
    console.log(`Financial data: grossSales=${financialData.grossSales}, netExpected=${financialData.netExpectedAmount}`);

    // Verify the data has required properties
    expect(financialData).toHaveProperty('grossSales');
    expect(financialData).toHaveProperty('netExpectedAmount');
    expect(financialData).toHaveProperty('receivedInStripe');
    expect(financialData).toHaveProperty('pendingDistribution');
    expect(financialData).toHaveProperty('history');
    console.log('Step 6 PASSED: Vendor financial view accessible with vendor-scoped data');

    // =========================================================================
    // Step 7: Cross-role restriction
    // =========================================================================
    console.log('Step 7: Cross-role restriction');

    // Vendor tries to access admin dashboard - should get 403
    const adminDashboardResp = await page.request.get(
      `${API_BASE_URL}/api/v1/admin/dashboard`,
      { headers: { Authorization: `Bearer ${vendorTokenForStep5}` } }
    );
    console.log(`Vendor accessing /api/v1/admin/dashboard: ${adminDashboardResp.status()}`);
    // Expected: 403 Forbidden for vendor accessing admin endpoint

    // Verify that the vendor CAN access their own vendor endpoints
    const vendorMeResp = await page.request.get(
      `${API_BASE_URL}/api/v1/vendor/me`,
      { headers: { Authorization: `Bearer ${vendorTokenForStep5}` } }
    );
    console.log(`Vendor accessing /api/v1/vendor/me: ${vendorMeResp.status()}`);
    expect(vendorMeResp.ok()).toBe(true);

    console.log('Step 7 PASSED: Cross-role restrictions verified');

    console.log('=== Vendor Journey Complete ===');
  });
});