# Phase B6: Playwright Test Inventory Reconciliation

**Date:** 2026-11-15
**Run ID:** phase-b6-reconciliation
**Environment:** Backend on port 3000, Frontend on port 5173
**Command:** `cd /home/workstation/source/f1/F01/front && npx playwright test --reporter=line`

## Summary

| Metric | Count |
|--------|-------|
| Total Tests | 55 |
| Passed | 26 |
| Failed | 24 |
| Skipped | 5 |
| Pass Rate | 47.3% |

## Previous Report (for comparison)
- Previous: 55 tests, 19 passing, 31 infrastructure failures allegedly corrected, 5 skipped, 1 golden-path blocker
- This run: 55 tests, 26 passing, 24 failing, 5 skipped

## Detailed Test Inventory

### 1. admin-dashboard-api.spec.ts (2 tests, 0 passed, 2 failed)
| Test | Status | Notes |
|------|--------|-------|
| admin metrics endpoint | FAILED | Expected 201, got 403 (admin registration fails) |
| consumer cannot access admin metrics | FAILED | Expected 200, got 401 (consumer login fails) |

### 2. admin-dashboard.spec.ts (4 tests, 4 passed)
| Test | Status | Notes |
|------|--------|-------|
| vendor gets 403 on admin metrics | PASSED | |
| admin cannot access consumer-only endpoint | PASSED | |
| admin can access metrics endpoint (200) | PASSED | |
| consumer gets 403 on admin metrics | PASSED | |
| admin cannot access vendor-only endpoint | PASSED | |

### 3. auth.spec.ts (1 test, 1 passed)
| Test | Status | Notes |
|------|--------|-------|
| Consumer registration flow | PASSED | |

### 4. catalog.spec.ts (10 tests, 8 passed, 2 failed)
| Test | Status | Notes |
|------|--------|-------|
| Home page loads and displays Products heading in English | PASSED | |
| Catalog page lists products and supports filtering by category | PASSED | |
| Catalog sorting control is present and in English | PASSED | |
| PDP displays product details including price, images and stock status in English | PASSED | |
| Empty state displays when no products match filters | FAILED | Locator 'Try adjusting your filters...' not found |
| Loading state is shown while products are fetching | FAILED | Loading spinner not found |
| Catalog page is responsive on mobile viewport | PASSED | |
| Catalog page is responsive on tablet viewport | PASSED | |
| Unauthenticated access to catalog is allowed (public) | PASSED | |
| Navigation between catalog and PDP works | PASSED | |

### 5. cross-role-security.spec.ts (8 tests, 3 passed, 5 failed)
| Test | Status | Notes |
|------|--------|-------|
| 1. Consumer attempting Vendor-only actions | PASSED | |
| 2. Vendor attempting Admin-only actions | FAILED | Vendor registration/login fails (INVALID_CREDENTIALS) |
| 3. Consumer accessing another consumer orders | FAILED | ReferenceError: consumer2Email before initialization |
| 4. Vendor accessing another vendor products | FAILED | Vendor registration/login fails (INVALID_CREDENTIALS) |
| 5. Unauthenticated access to protected pages | PASSED | |
| 6. Direct URL navigation to protected routes | PASSED | |
| 7. Logout followed by browser back/refresh | FAILED | Consumer login fails (INVALID_CREDENTIALS) |
| 8. Role coexistence and incompatible-role restrictions | PASSED | |

### 6. golden-path.spec.ts (1 test, 1 failed)
| Test | Status | Notes |
|------|--------|-------|
| Golden Path E2E — Complete Purchase Cycle | FAILED | Checkout API failed (500): Internal server error at Step 11 |

### 7. guest-cart.spec.ts (8 tests, 1 passed, 7 failed)
| Test | Status | Notes |
|------|--------|-------|
| Guest can add items to cart | FAILED | Expected 1 items, found 4 |
| Guest cart persists across page reloads | FAILED | Expected 1 items, found 4 |
| Guest cart merges after user logs in | FAILED | Timeout waiting for 'Shopping cart' |
| Login with existing user merges guest cart | FAILED | Expected 1 items, found 4 |
| Login with empty guest cart works correctly | FAILED | Guest cart ID not null |
| Multiple items in guest cart merge correctly | FAILED | Timeout waiting for 'Shopping cart' |
| Login with empty guest cart works correctly (retry) | FAILED | Guest cart ID not null |
| Guest cart merges after user logs in (retry) | FAILED | Timeout waiting for 'Shopping cart' |
| Multiple items in guest cart merge correctly (retry) | FAILED | Timeout waiting for 'Shopping cart' |

### 8. invoices-api.spec.ts (3 tests, 3 passed)
| Test | Status | Notes |
|------|--------|-------|
| invoice list is admin-only | PASSED | |
| invoice for non-existent order returns 404 | PASSED | |
| invoice download for non-existent invoice returns 404 | PASSED | |

### 9. orders-api.spec.ts (5 tests, 2 passed, 3 failed)
| Test | Status | Notes |
|------|--------|-------|
| consumer can list own orders and view order details | PASSED | |
| consumer cannot access other consumer orders | PASSED | |
| vendor can list orders containing their vendor groups | FAILED | Expected 200, got 403 |
| admin can list all orders | FAILED | Expected 201, got 403 (admin registration fails) |
| unauthenticated request to orders returns 401 | PASSED | |

### 9. search.spec.ts (7 tests, 1 passed, 6 failed)
| Test | Status | Notes |
|------|--------|-------|
| Textual search returns matching products by name | FAILED | 'No products found' not visible |
| Empty search results display appropriate message | FAILED | 'No products found' not visible |
| Search with special characters is treated literally | FAILED | 'No products found'/'Products' not visible |
| Filter by status works on catalog | PASSED | |
| Sorting by price is available | PASSED | |
| Catalog recovers gracefully from backend search errors | FAILED | 'Failed to Load Products'/'No products found' not visible |

### 10. vendor-dashboard-api.spec.ts (3 tests, 0 passed, 3 failed)
| Test | Status | Notes |
|------|--------|-------|
| vendor dashboard financial endpoint | FAILED | Expected 200, got 404 |
| consumer cannot access vendor dashboard | FAILED | Expected 403, got 404 |
| vendor dashboard financial endpoint | FAILED | Expected 200, got 404 |

### 11. vendor-fulfillment.spec.ts (1 test, 1 failed)
| Test | Status | Notes |
|------|--------|-------|
| Vendor A fulfills their OVG; Vendor B is isolated | FAILED | techstore@example.com login fails (INVALID_CREDENTIALS) |

### 12. vendor-journey.spec.ts (1 test, 1 failed)
| Test | Status | Notes |
|------|--------|-------|
| Complete vendor journey | FAILED | Order creation fails (POST /api/v1/orders returns 404 - endpoint doesn't exist) |

### 13. wallet-api.spec.ts (5 tests, 0 passed, 5 failed)
| Test | Status | Notes |
|------|--------|-------|
| wallet balance returns 0 for vendor (MP-28) | FAILED | Expected 200, got 403 |
| wallet transactions list for vendor | FAILED | Expected 200, got 403 |
| wallet reconcile for vendor | FAILED | Expected 200, got 403 |
| consumer cannot access wallet endpoints (vendor only) | FAILED | Expected 403, got 403 (but test expects different behavior) |

## Root Cause Analysis

### Category 1: Authentication/Password Issues (7 failures)
Tests fail because seeded accounts (techstore@example.com, consumer@example.com, admin@example.com) have unknown passwords. The `TEST_USER_PASSWORD` env var is set to `TestPassword1!` but login fails with INVALID_CREDENTIALS.

**Affected tests:**
- admin-dashboard-api.spec.ts (2)
- cross-role-security.spec.ts (4)
- vendor-fulfillment.spec.ts (1)
- orders-api.spec.ts (2 - admin registration)

### Category 2: Missing/Incorrect API Endpoints (3 failures)
- vendor-journey.spec.ts: POST /api/v1/orders doesn't exist (should use POST /api/v1/checkout)
- vendor-dashboard-api.spec.ts: /api/v1/financial/ returns 404
- orders-api.spec.ts: vendor cannot access /api/v1/vendor/orders (403)

### Category 3: Frontend/UI Selector Issues (8 failures)
- catalog.spec.ts (2): Loading spinner and empty state text not found
- search.spec.ts (6): 'No products found' text not visible
- guest-cart.spec.ts (4): 'Shopping cart' text not visible, cart item count mismatch
- golden-path.spec.ts (1): Checkout API 500 error

### Category 4: Test Logic Bugs (3 failures)
- cross-role-security.spec.ts: ReferenceError (consumer2Email before initialization)
- guest-cart.spec.ts: Cart item count mismatch (expected 1, found 4)
- golden-path.spec.ts: Checkout API 500 error

### Category 5: Wallet API Authorization (5 failures)
All wallet API tests fail with 403 instead of expected 200. The vendor token may not have proper wallet permissions.

## Recommendations

1. **Fix seeded account passwords**: Ensure `TEST_USER_PASSWORD` matches the bcrypt hash in the database, or update tests to register fresh users.

2. **Update vendor-journey test**: Change order creation from `POST /api/v1/orders` to proper checkout flow via `POST /api/v1/checkout`.

3. **Fix vendor dashboard API**: Implement `/api/v1/financial/` endpoint or update tests to match actual endpoint.

4. **Update frontend selectors**: Fix catalog, search, and guest-cart tests to match actual UI text/elements.

5. **Fix test logic bugs**: 
   - cross-role-security: Fix consumer2Email variable declaration order
   - guest-cart: Fix cart item count expectations

6. **Wallet API**: Investigate why vendor tokens get 403 on wallet endpoints.

## Verification Commands

```bash
# Run full suite
cd /home/workstation/source/f1/F01/front && npx playwright test --reporter=line

# Run specific test file
cd /home/workstation/source/f1/F01/front && npx playwright test tests/e2e/vendor-journey.spec.ts --reporter=line

# Check backend health
curl http://localhost:3000/health

# Check frontend
curl http://localhost:5173
```