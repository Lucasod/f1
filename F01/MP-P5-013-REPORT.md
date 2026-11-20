# MP-F01-P5-013 Execution Report — Phase F (Visual Coherence) + Phase G (Vendor Dashboard Data Reconciliation)

**Run ID:** mp-f01-p5-013-2026-11-19
**Branch:** feature/closing-initial-implementation
**Base commit:** dc7835a
**Backend:** http://localhost:3000 (running, healthy)
**Frontend:** http://localhost:5173 (running, healthy)
**MongoDB:** mongodb://localhost:27017/fs01_marketplace (running)
**Constraints honored:** No commits/pushes, no Stripe live payments, no secrets printed, no F04/.kilo modifications, no DB deletion/indexes, no manual status forcing outside documented test-data flow.

---

## Phase F — Visual Coherence Results

**Test file:** `front/tests/e2e/phase-f-visual-coherence.spec.ts` (new, not committed)
**Command:** `npx playwright test tests/e2e/phase-f-visual-coherence.spec.ts --project=chromium --reporter=list`
**Result: 27/27 PASS** across desktop (1440x900), tablet (768x1024), mobile (390x844)

| Check | Result | Details |
|-------|--------|---------|
| Consistent navigation structure | PASS | All 7 pages (Catalog, Cart, Consumer Dashboard, Order History, Vendor Dashboard, Vendor Sales Orders, Admin Dashboard) render the same `nav[role="navigation"]` with "FS-01 Marketplace" brand at all 3 viewports |
| Consistent monetary formatting | PASS | BRL format `R$ X,XX` verified on Consumer Dashboard and Vendor Dashboard |
| Consistent date formatting | PASS | pt-BR date format rendered |
| Chart 404 detection | PASS | No chart-related or API 404s on Vendor Dashboard (Sales Over Time, Revenue by Period, Platform Commissions, Financial Transactions by Type charts load without 404) |
| Consumer chart removals | PASS | `Spending Over Time` chart text count = 0 on ConsumerDashboard; `Order History — Distribution of your orders by status` chart text count = 0 |
| Order history still present | PASS | ConsumerDashboard orders list still renders |
| Order Details accessible | PASS | Order History page renders with links to order details |
| Accessible labels / keyboard | PASS | Checkout page renders navigation and fieldset form controls |
| No console errors | PASS | Zero console.error messages across all page/viewport tests |

### Phase F Defects (code-level, observed during file review)

1. **Inconsistent currency locale across pages** — `OrderDetailPage.tsx:26` and `OrderHistoryPage.tsx:16` use `new Intl.NumberFormat('en-US', { style: 'currency', currency: 'BRL' })` (comment incorrectly says USD), while `ConsumerDashboard.tsx:16` and `VendorDashboard.tsx:41` use `new Intl.NumberFormat('pt-BR', ...)`, and `CheckoutPage.tsx:28` uses `en-US`. This produces inconsistent `R$ X,XX` vs `R$ X.XX` rendering across pages.

2. **VendorDashboard.tsx hardcodes "Unavailable" for Received and Pending Distribution** (lines 382-383) — the frontend does not wire up `receivedInStripe` and `pendingDistribution` from `/api/v1/financial/vendor-dashboard`, displaying "Unavailable" regardless of actual API values. This prevents visual verification of these metrics from the UI.

---

## Phase G — Vendor Dashboard Data Reconciliation

### Test Data Created (documented flow)
1. Consumer `consumer@example.com` logged in, added SHYPHONE 15 Pro (R$ 9999.00) from Tech Store (vendor `vendor-00cjp4oa`) to cart, checked out
2. Admin `admin@example.com` set order `1795084443622-k6092vq14` to `paid`
3. Vendor `techstore@example.com` viewed dashboard

### Order State (MongoDB)
- Order status: `paid`, financialStatus: `paid`
- Vendor group: vendorId=`vendor-00cjp4oa`, subtotal=`9999`, vendorNet=`8999.1`, transferId=`null`
- Payment: status=`pending`, capturedAt=`null` (NOT captured — MockCheckoutProvider in dev mode)
- Transfers: `0` for this vendor

### Required API Calls (vendor authenticated) — all returned 200
| Endpoint | Status |
|----------|--------|
| GET /api/v1/financial/vendor-dashboard | 200 |
| GET /api/v1/vendor/orders | 200 (2 vendor groups) |
| GET /api/v1/wallet/balance | 200 (balance: 0) |
| GET /api/v1/wallet/transactions | 200 (empty) |
| GET /api/v1/transfer/ | 404 (route returns "Not found" for vendor — no transfers exist) |

### Reconciliation Table

| Metric | Dashboard Value | MongoDB Value (task formula) | Match? |
|--------|----------------|------------------------------|--------|
| Gross Sales | 0 | 9999.00 | **NO** |
| Net Expected | 0 | 8999.10 | **NO** |
| Received In Stripe | 0 | 0 | **YES** |
| Pending Distribution | 0 | 8999.10 | **NO** |

### Root Cause Analysis (3 of 4 metrics mismatch)

**Root cause:** `VendorFinancialDashboardService.getVendorDashboard()` (`back/src/modules/financial/financial.dashboard.service.ts:103-122`) computes `grossSales` and `netExpectedAmount` **only from orders with a CAPTURED payment**. In development mode, `MockCheckoutProvider` does not auto-capture payments after checkout, and the payment capture endpoint (`POST /payments/:id/capture`, `payment.routes.ts:115`) returns `403 PROVIDER_CONFIRMATION_REQUIRED` because it requires verified Stripe webhook confirmation. Thus a `paid` order without a captured payment yields `0` on the dashboard.

**Secondary formula mismatch (Pending Distribution):**
- Dashboard formula (service.ts:150-158): Sum of non-COMPLETED transfer amounts (transfer-based)
- Task formula: Sum of `vendorGroups[].vendorNet` for orders NOT `delivered` AND NOT `cancelled` (order-based)

These are fundamentally different computations, so `pendingDistribution` cannot match without aligning the formulas.

**Vendor Journey corroboration:** `vendor-journey.spec.ts` Step 6 confirmed `grossSales=0, netExpected=0` despite a fully delivered order — same root cause (payment not captured in dev/test mode without webhook delivery).

---

## Evidence Files

- Phase F test: `front/tests/e2e/phase-f-visual-coherence.spec.ts` (27/27 passed)
- Playwright test results: `front/test-results/` (HTML reporter + traces on retry)
- Vendor dashboard API test: `front/tests/e2e/vendor-dashboard-api.spec.ts` (2/2 passed)
- Vendor journey test: `front/tests/e2e/vendor-journey.spec.ts` (1/1 passed, confirms grossSales=0/netExpected=0)

### Screenshot/trace files
Traces are captured on first retry only (`trace: 'on-first-retry'` in playwright config). Since no tests failed, no trace files were generated. Screenshots were not explicitly captured.

### Chart 404s observed
None. All four vendor dashboard charts (Sales Over Time, Revenue by Period, Platform Commissions, Financial Transactions by Type) loaded without API 404s.

### Orders by Status count vs listing divergence
No divergence found — the Vendor Dashboard "Orders by Status" pie chart and the vendor orders listing both derive from `orderApi.getVendorOrderGroups()`, returning the same 2 vendor groups for Tech Store.

---

## Git State

- Branch: `feature/closing-initial-implementation` (ahead of origin by 4 commits)
- No commits or pushes made (per constraints)
- Modified files (pre-existing, not from this session): back/ and front/ source files, docs/mp_log.md, docs/task_list.md
- New file created (not committed): `front/tests/e2e/phase-f-visual-coherence.spec.ts`
- New file created (not committed): `MP-P5-013-PLAN.md`
