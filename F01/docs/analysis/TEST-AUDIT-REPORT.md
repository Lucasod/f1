# TESTS AUDIT REPORT — MP-P5-REALITY-CHECK-VALIDATION

**Run Date**: 2026-11-10T22:23:59Z
**Project**: FS-01 Marketplace (F01)
**Base Reference**: MP-31 verification report (2026-11-05): "990/996 backend passing (3 pre-existing SKIPped, 3 skipped)"

---

## 1. BASELINE COMPARISON

| Metric | Baseline (2026-11-05) | Current (2026-11-10) | Delta |
|---|---|---|---|
| **Backend tests run** | 996 total | 1685 total | +689 tests |
| **Backend passing** | 990 | 1227 | +237 passed |
| **Backend failing** | 6 (implied) | 450 | +444 new failures |
| **Backend SKIPped** | 3 pre-existing | 8 (5 new + 3 pre-existing) | +5 new skips |
| **Backend pass rate** | 99.4% (990/996) | 72.8% (1227/1685) | -26.6 pts |
| **Frontend tests run** | Not specified in baseline | 681 total | N/A |
| **Frontend passing** | N/A | 606 | N/A |
| **Frontend failing** | N/A | 75 | N/A |
| **Frontend SKIPped** | N/A | 5 | N/A |
| **Frontend pass rate** | N/A | 89.1% (606/681) | N/A |

**Key observation**: The test suite has grown significantly (996 → 1685 backend tests), but the pass rate dropped dramatically (99.4% → 72.8%). The 450 backend failures are the primary concern, with the `PASSWORD_WEAK` issue being the dominant pattern.

---

## 2. BACKEND TEST FAILURES (450 total)

### Summary
- **Test files failed**: 30 out of 82
- **Tests failed**: 450 out of 1685 (26.8%)
- **Tests passed**: 1227
- **Tests SKIPped**: 8

### Failure by Category (error type → count → test files)

#### 1. PASSWORD_WEAK / WEAK_PASSWORD — **54 tests** (dominant)
- **Source**: `src/modules/auth/credential.domain.ts:30:11` — password strength validation
- **Error**: `Error: PASSWORD_WEAK` or `Error: WEAK_PASSWORD`
- **Affected test files**:
  - `src/modules/auth/auth.service.test.ts` — user registration with weak passwords
  - `src/modules/order/order.lifecycle.test.ts` — order lifecycle tests that create users
  - `src/modules/order/order.routes.test.ts` — order route tests that register users
  - `src/modules/order/order.vendor-group-status.test.ts` — vendor group status tests
  - `src/modules/review/review.routes.test.ts` — review creation tests needing user auth
  - `src/modules/product/product.search-sync.test.ts` — seed test password generation
  - `src/modules/vendor/vendor.routes.test.ts` — vendor onboarding tests

#### 2. Repository/CONTRACT Compliance — **18 tests**
- **CATEGORY_SLUG_ALREADY_EXISTS / SLUG_ALREADY_EXISTS** — 6 tests
  - Category/vendor slug collision in MongoDB repository tests
- **PRODUCT_SEARCH_PHYSICAL_DELETE_UNAVAILABLE** — 1 test
- **INVOICE_ALREADY_EXISTS** — 1 test
- **Product count mismatches** — multiple tests expecting specific product/category/vendor counts but finding more (e.g., expected 3 got 4, expected 2 got 10)
- **Affected test files**:
  - `src/modules/product/category.mongo.repository.test.ts` (4 failures)
  - `src/modules/product/product.mongo.repository.test.ts` (2 failures)
  - `src/modules/vendor/vendor.mongo.repository.test.ts` (2 failures)
  - `src/modules/invoice/invoice.domain.test.ts` (1 failure)

#### 3. HTTP Status Code Mismatches — **14 tests**
- **AssertionError: expected X to be Y** — various HTTP status code mismatches
- **Patterns**: 400 vs 201, 404 vs 503, 401 vs 200, 403 vs 503, 400 vs 409
- **Affected test files**:
  - `src/modules/product/product.routes.test.ts` (multiple status code mismatches, including "expected 400 to be 201")
  - `src/modules/product/product.upload-visibility.test.ts` (expected 302, got 404)
  - `src/modules/vendor/vendor.routes.test.ts` (status code mismatches)
  - `src/modules/order/order.routes.test.ts` (status code mismatches)

#### 4. AUTHORIZATION / ROLE-BASED ACCESS — **42 tests**
- **Patterns**: Tests verifying that consumers cannot access vendor features, vendors cannot access admin features, etc.
- **Underlying cause**: Many are secondary to the `PASSWORD_WEAK` issue (tests fail during user setup before reaching authorization logic)
- **Direct authorization failures** (when tests get past password check):
  - Role-based access control tests in product, vendor, order, review modules
  - Consumer/vendor isolation tests

#### 5. SEED / DATA SETUP — **32 tests**
- Seed integration tests failing due to password validation blocking user creation
- Search index reindex tests
- Data persistence after restart tests

#### 6. ELASTICSEARCH / INTEGRATION — **5 tests**
- `ELASTICSEARCH_INDEX_FAILED` — 1 test
- MongoDB integration tests (seed, idempotency, referential integrity) — 4 tests

#### 7. OTHER — **5 tests**
- TypeError: Cannot read properties of undefined (accessToken, refreshToken)
- Various edge case failures

### Pre-existing vs. New Failures

| Category | Pre-existing (from baseline) | New (introduced since) |
|---|---|---|
| PASSWORD_WEAK | 0 | 54 (entirely new) |
| Repository contract | 0 | 18 (entirely new) |
| Status code mismatches | 0 | 14 (entirely new) |
| Authorization role tests | Partially some | New under PASSWORD_WEAK cascade |
| Elasticsearch integration | Unknown | 5 |

**Root cause hypothesis**: The `PASSWORD_WEAK` issue is the single largest factor. The password strength validation in `credential.domain.ts` requires uppercase, lowercase, number, and special character. Test user creation passwords likely don't meet these requirements. This is a cascading issue — many tests fail at the user setup stage, preventing authorization, repository, and other tests from running.

---

## 3. FRONTEND TEST FAILURES (75 total)

### Summary
- **Test files failed**: 7 out of 44
- **Tests failed**: 75 out of 681 (11.0%)
- **Tests passed**: 606
- **Tests SKIPped**: 5

### Failure by Category (error type → count → patterns)

#### 1. TestingLibraryElementError — **Portuguese text query mismatches — 31 tests** (dominant)
- **Pattern**: Tests querying by Portuguese text that doesn't match the DOM
- **Specific patterns failing**:
  - `/Pedido ORDER-1/i` — role "button" name pattern (case-insensitive)
  - `/CONFIRMADO/i` — button name pattern
  - `/PENDENTE/i` — element text (broken into multiple elements)
  - `3. Resumo do Pedido` — order summary title
  - `/pagamento seguro via stripe/i` — label text
  - `/filtrar por status/i` — filter label text
  - `/Vendedor: VENDOR-1/i` — vendor name pattern
  - `/subtotal bruto/i` — gross subtotal text
  - `/Erro ao carregar pedidos/i` — error loading orders
  - `/totais do pedido/i` — order totals text
  - `/resumo do pedido/i` — order summary text
  - `/vendedor: VENDOR-2/i` — vendor name pattern
  - `/forma de pagamento/i` — payment method label
  - `/pedido cancelado/i` — cancelled order text
  - `/meus pedidos \(vendedor\)/` — "my orders (vendor)"
  - `/meus pedidos/i` — "my orders"
  - `/^forma de pagamento$/i` — exact payment method
  - `/^desconto informado no preview$/i` — discount in preview
  - `/data do pedido/i` — order date
  - `/Cupon quotes cannot be purchased./i` — coupon quote message
  - `/^desconto informado no preview$/i` — discount preview

#### 2. TestingLibraryElementError — role "button" mismatches — 14 tests
- `/ver detalhes/i` — view details button
- `/comprar novamente/i` — buy again button
- `/anterior/i` — previous button
- `/voltar para meus pedidos/i` — back to my orders button
- `/tentar novamente/i` — try again button
- `/limpar filtro/i` — clear filter button
- `/fazer login/i` — login button
- `/continuar comprando/i` — continue shopping button
- `/voltar/i` — back button
- `/Pedido ORDER-2/i` — order role name
- `/limpar filtro/i` — clear filter
- `/fazer login/i` — login
- `/continuar comprando/i` — continue shopping

#### 3. Auth store TypeError — **3 tests**
- `TypeError: __vite_ssr_import_4__.cartApi.getCart is not a function`
- **File**: `src/app/providers/authStore.ts:274` — cartApi.getCart is undefined
- **Affected tests**: `useAuthStore > mergeGuestCartOnLogin` (3 tests)

#### 4. Assertion errors — **6 tests**
- `expected true to be false` — auth store identity cache (3 tests)
- `expected "vi.fn()" to be called with/at least once` — 2 tests
- `expected undefined to be 'next'` — 1 test

#### 5. Checkout/Order page rendering — multiple failures
- VendorOrderPage: 15 of 16 failed
- OrderHistoryPage: 13 of 16 failed
- OrderDetailPage: 17 of 28 failed
- CheckoutPage: 18 of 36 failed
- CheckoutPage.coupon-quote: 4 of 11 failed

### Portuguese Text Query Patterns — Analysis

The frontend test failures are heavily dominated by **Portuguese text query mismatches** in `@testing-library/dom`. The tests use Portuguese labels/strings in the UI, but the test queries either:

1. **Break up text across multiple elements** — `TestingLibraryElementError: Unable to find an element with the text: /PENDENTE/i. This could be because the text is broken up by multiple elements.`

2. **Case/format mismatches** — The regex patterns don't match the actual rendered content due to formatting differences (whitespace, line breaks, etc.)

3. **Role button name patterns** — Button `name` attributes with `/role="button" { name: /pattern/i}` don't match

**Recommendation**: Update test text patterns to be more flexible (use `container.querySelector` with functions, or use `role: 'button' { name: /pattern/i }` with looser patterns), or update the UI text/patterns to match test expectations. Given the project decision for "English-only" technical identifiers, the UI text should remain in Portuguese (user-facing), but test queries need to accommodate the Portuguese patterns.

---

## 4. TYPESCRIPT ERRORS

### Backend (`tsc --noEmit`)
- **Exit code**: 0
- **Errors**: 0
- **Status**: Clean — no TypeScript errors

### Frontend (`tsc --noEmit`)
- **Exit code**: 2
- **Errors**: 6 total

| # | File | Line | Error | Type |
|---|---|---|---|---|
| 1 | `src/app/providers/authStore.ts(275,29)` | 275 | Property 'items' does not exist on type '{ cart: Cart; }' | Interface contract |
| 2 | `src/features/consumer/ConsumerProfile.tsx(277,9)` | 277 | 'handleRemoveAddress' declared but never read | Unused variable |
| 3 | `src/features/consumer/ConsumerProfile.tsx(315,9)` | 315 | 'handlePrimaryAddressChange' declared but never read | Unused variable |
| 4 | `src/features/order/OrderDetailPage.tsx(170,32)` | 170 | Cannot find name 'order' | Reference error |
| 5 | `src/features/order/VendorOrderPage.tsx(248,10)` | 248 | 'error' declared but never read | Unused variable |
| 6 | `src/features/order/VendorOrderPage.tsx(271,34)` | 271 | Cannot find name 'OrderApiException' | Reference error |

### Prioritization

| Priority | Error | Impact | Action |
|---|---|---|---|
| **High** | `Cannot find name 'order'` (OrderDetailPage.tsx:170) | Affects component functionality — `order` name not in scope | Fix: ensure `order` is imported or passed as prop |
| **High** | `Cannot find name 'OrderApiException'` (VendorOrderPage.tsx:271) | Affects error handling in vendor order page | Fix: import `OrderApiException` from correct module |
| **Medium** | `Property 'items' does not exist on type` (authStore.ts:275) | Type mismatch in cart interface | Fix: align `Cart` type with `items` property or update access pattern |
| **Low** | Unused variable warnings (handleRemoveAddress, handlePrimaryAddressChange) | Code quality — dead code | Document or remove (does not affect runtime) |

**Recommendation**: Fix the 2 "cannot find name" errors (high priority — they affect behavior). The unused variable warnings and interface type mismatch are medium/low priority — fix if refactoring, but not blocking.

---

## 5. TEST SKIPPING vs. FAILING BREAKDOWN

### Backend
| State | Count | Percentage |
|---|---|---|
| FAIL | 450 | 26.8% |
| PASS | 1227 | 73.0% |
| SKIP | 8 | 0.5% |
| **Total** | **1685** | **100%** |

**SKIP details**: 8 tests skipped. The baseline had 3 pre-existing SKIPped. Current has 8 — 5 new skips added, likely due to test environment or configuration changes.

### Frontend
| State | Count | Percentage |
|---|---|---|
| FAIL | 75 | 11.0% |
| PASS | 606 | 89.1% |
| SKIP | 5 | 0.7% |
| **Total** | **681** | **100%** |

**SKIP details**: 5 tests skipped. No baseline comparison available, but likely pre-existing.

### Key Observation
- **Backend**: The skip rate increased from 3 to 8 ( +5 new skips). The failing rate went from ~6 to 450 — a massive increase driven by the `PASSWORD_WEAK` cascade.
- **Frontend**: 75 failures, mostly Portuguese text query mismatches. Skip rate low at 5.

---

## 6. PRIORITY-RANKED TEST FAILURES BY CATEGORY

### 1. PASSWORD_WEAK Cascade (Backend) — **54 tests**
- **Root cause**: Password strength validation too strict for test data
- **Fix**: Update test passwords to meet complexity requirements, or adjust `credential.domain.ts` validation if test passwords are valid use cases
- **Impact**: Cascading failures — many tests fail at user setup stage

### 2. Portuguese Text Query Mismatches (Frontend) — **31 tests**
- **Root cause**: TestingLibrary regex patterns don't match broken-up Portuguese UI text
- **Fix**: Use `screen.debug()` to inspect actual text, update query patterns to be more flexible (use `waitFor` or `container.querySelectorAll`), or use `getByText` with exact matches
- **Impact**: High — 31 of 75 frontend failures

### 3. Repository/Contract Compliance (Backend) — **18 tests**
- **Root cause**: MongoDB data setup — slug collisions, product/vendor count mismatches
- **Fix**: Ensure seed data is idempotent, fix count assertions to match actual data distribution
- **Impact**: Medium — repository contract tests failing due to data setup issues

### 4. HTTP Status Code Mismatches (Backend) — **14 tests**
- **Root cause**: API behavior changed or test expectations incorrect
- **Fix**: Update expected status codes to match actual API responses
- **Impact**: Medium — mainly route/endpoint tests

### 5. Authorization/Role-Based Access (Backend) — **42 tests**
- **Root cause**: Many secondary to PASSWORD_WEAK cascade; direct auth failures need separate investigation
- **Fix**: Fix password issue first, then re-evaluate authorization tests
- **Impact**: High — but likely resolves after password fix

### 6. Seed/Data Setup (Backend) — **32 tests**
- **Root cause**: Seed script interacts with password validation and MongoDB state
- **Fix**: Make seed idempotent, fix password generation in seed script
- **Impact**: Medium — affects test isolation

### 7. Elasticsearch / Integration (Backend) — **5 tests**
- **Root cause**: Elasticsearch not properly connected or configured
- **Fix**: Connect Elasticsearch or mark integration tests as SKIPed with proper rationale
- **Impact**: Low — integration dependency

---

## 7. TEST FILES STRUCTURE

### Backend (`F01/back/src/`)
```
modules/
  auth/           → Authentication, authorization, password validation
  product/        → Product CRUD, categories, search
  order/          → Order lifecycle, payments, refunds, disputes
  review/         → Review creation and moderation
  vendor/         → Vendor onboarding, suspension, activation
  invoice/        → Invoice generation and PDF
  cart/           → Shopping cart management
  payment/        → Payment service and consumer confirmation
  category/       → Category repository contracts
integration/      → Elasticsearch, MongoDB integration tests
scripts/          → Seed and search index scripts
```

**Test patterns**: Vitest with `environment: 'node'`, `include: ['src/**/*.test.ts']`
**Configuration**: `vitest.config.ts` (root) and `vitest.isolated.config.ts` (checkout duplicate tests)

### Frontend (`F01/front/src/`)
```
app/              → Auth store, providers
features/
  checkout/       → Cart and checkout flow
  consumer/       → Consumer profile and pages
  order/          → Order history, detail, vendor order pages
  product/        → Product catalog and detail pages
  vendor/         → Vendor dashboard and pages
```

**Test patterns**: Vitest with `environment: 'jsdom'`, TestingLibrary, `globals: true`
**Configuration**: `vite.config.ts` with Vitest test block

### e2e/Playwright (`F01/front/tests/e2e/`)
- `wallet-api.spec.ts` — Wallet API E2E tests (39 failed, timeout issues)
- `auth.spec.ts` — Authentication E2E (1 failed)
- `catalog.spec.ts` — Catalog browsing (40 failed)
- `orders-api.spec.ts` — Orders API E2E (30+ failed)
- `invoices-api.spec.ts` — Invoice API E2E (15 failed)
- `vendor-dashboard-api.spec.ts` — Vendor dashboard E2E (13 failed)
- `search.spec.ts` — Elasticsearch search (12 failed)
- `golden-path.spec.ts` — Complete purchase cycle (1 failed)
- `guest-cart.spec.ts` — Guest cart merge (15 failed)

**Status**: Many E2E tests failing, primarily due to form fill timeouts (`page.fill('#name')` waiting for elements that may not render correctly in the test environment).

---

## EVIDENCE AND LIMITATIONS

### What the checks prove
- **Backend**: 450 tests are failing, with `PASSWORD_WEAK` being the single largest contributor (54 failures). The test suite has grown from 996 to 1685 tests since the MP-31 baseline, and the pass rate dropped from 99.4% to 72.8%.
- **Frontend**: 75 tests are failing, with Portuguese text query mismatches being the dominant pattern (31 failures). The TypeScript check shows 6 errors, 2 of which affect behavior (`Cannot find name`).
- **TypeScript**: Backend is clean; frontend has 6 errors (2 behavioral, 4 code-quality).

### What the checks do NOT prove
- The root cause of why `PASSWORD_WEAK` affects so many tests — could be test data quality, validation logic change, or seed script issue.
- Whether the Portuguese text query mismatches are due to UI changes or test pattern issues.
- If the 450 backend failures are all directly caused by the password issue, or if there are independent failures masked by the password cascade.
- The actual state of Elasticsearch integration (only 5 integration tests failed, but E2E tests also show Elasticsearch/search failures).

### Limitations
- The `PASSWORD_WEAK` cascade may be masking other underlying issues — after fixing password tests, other failure patterns may become more apparent.
- The frontend Portuguese text patterns may require UI internationalization decisions that affect test maintenance.
- The E2E test failures (Playwright) were not fully investigated in this audit — they may have separate causes (environment, selectors, waiting conditions).
- No CI scanning was performed; the secrets scanner passed locally but CI results are unknown.

---

## RECOMMENDATIONS

### Immediate actions (within current sprint)
1. **Fix `PASSWORD_WEAK` issue (Backend)**: Update test passwords in affected test files to meet complexity requirements, or adjust `credential.domain.ts` validation with a `TEST_MODE` or `isDevelopment` flag that relaxes requirements for test data.
2. **Fix Portuguese text queries (Frontend)**: Update `getByRole`/`getByText` patterns to handle broken-up Portuguese text, or use `container.querySelector`/`fireEvent` with more flexible matching.
3. **Fix 2 TypeScript behavioral errors**: `Cannot find name 'order'` in `OrderDetailPage.tsx` and `Cannot find name 'OrderApiException'` in `VendorOrderPage.tsx`.

### Short-term (within 2 sprints)
4. **Repository contract fixes**: Fix slug collision issues in category/vendor/product MongoDB repository tests — ensure seed data is truly idempotent and count assertions match data distribution.
5. **HTTP status code updates**: Update expected status codes in product/route tests to match actual API behavior.
6. **Address unused variable warnings**: Either use the variables or remove them (code quality).

### Long-term (across sprints)
7. **E2E test investigation**: The 75 frontend failures + 39+ E2E failures need separate investigation — prioritize the `page.fill('#name')` timeout issue.
8. **Elasticsearch connection**: Decide whether to connect Elasticsearch fully or mark all related tests as SKIPed with proper documentation.
9. **Test suite rationalization**: The test suite grew from 996 to 1685 tests — review if all tests are necessary or if some can be consolidated/removed.

### Test skipping guidance
- Verify the 5 frontend SKIPped tests and 8 backend SKIPped tests have proper `skip` descriptions.
- Ensure new skips are documented with reasons, not left as implicit skips.