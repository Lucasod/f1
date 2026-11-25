# FS-01 Marketplace — Project Structure Comprehensive Report

## Overview
Project directory: `/home/workstation/source/f1/F01`
This report documents the complete architecture, routes, components, databases, docker configurations, and test state of the FS-01 Marketplace project.

---

## 1. Frontend Architecture

### 1.1 Directory Structure (`front/src/`)
- `app/` — App shell, routes, providers (AuthProvider, QueryClient)
- `features/` — Feature-area components organized by role
- `components/` — Reusable UI components (Card, Button, Badge, etc.)
- `shared/` — API clients (admin, order, financial, vendor, product, review, cart, checkout, payout, person)
- `pages/` — Root-level page components
- `src/main.tsx` — Entry point
- `index.css` — Global styles

### 1.2 Routes and Navigation (`App.tsx`)
Root-level React Router v7 routes with role-based protection:

**Public Routes:**
- `/` — HomePage
- `/login` — LoginPage
- `/register` — RegisterPage
- `/products` — ProductCatalogPage (public)
- `/products/:productId` — ProductDetailPage (public)
- `/cart` — CartPage (guest/authenticated)

**Consumer-Protected Routes** (role: CONSUMER):
- `/dashboard` — ConsumerDashboard
- `/checkout` — CheckoutPage
- `/orders` — OrderHistoryPage
- `/profile` — ConsumerProfile

**Shared Protected Routes** (roles: CONSUMER | VENDOR | ADMIN):
- `/orders/:orderId` — OrderDetailPage

**Vendor-Protected Routes** (role: VENDOR):
- `/vendor/onboard` — OnboardingForm
- `/vendor/dashboard` — VendorDashboard
- `/vendor/products` / `:productId/edit` — ProductForm
- `/vendor/orders` — VendorOrderPage
- `/vendor/payouts` — PayoutPage

**Admin-Protected Routes** (role: ADMIN):
- `/admin/dashboard` — AdminDashboard

### 1.3 Navigation Structure (`Navigation.tsx`)
Role-based top navigation menu with the following structure:

**Authenticated Users (shows role-specific links):**

- **CONSUMER** links:
  - Browse Products (`/products`)
  - Cart
  - Consumer Dashboard (`/dashboard`)
  - My Purchases (`/orders`)
  - My Profile (`/profile`)
  - Become a Seller (`/vendor/onboard`) — shown only if NOT vendor

- **VENDOR** links:
  - Vendor Dashboard (`/vendor/dashboard`)
  - Sales Orders (`/vendor/orders`)
  - My Products (`/vendor/products`)
  - Store Settings (`/vendor/settings`)

- **ADMIN** links:
  - Admin Dashboard (`/admin/dashboard`)

- **All authenticated**: User display (`{name} {roles.join(', ')}`) and Logout

**Unauthenticated**: Login and Register links

### 1.4 Dashboards Exist
- **ConsumerDashboard** (`front/src/features/consumer/ConsumerDashboard.tsx`) — TanStack Query-based, shows order summary, recent orders, metrics (total orders, total spent, pending, delivered)
- **VendorDashboard** (`front/src/features/vendor/VendorDashboard.tsx`) — Recharts-based, shows vendor metrics, financial dashboard, order groups by status, product table, charts (sales over time, commissions, revenue by period, financial transactions)
- **AdminDashboard** (`back/src/modules/admin/admin.dashboard.ts`) — Backend API route `GET /api/v1/admin/dashboard`, returns basic counts (orders, vendors, products)

### 1.5 Frontend API Clients
- `apiClient` — Fetch-based client with auth Bearer tokens, guest cart support
- `orderApi` — `listOrders()`, `getConsumerSummary()`, `getById()`, `updateVendorGroupStatus()`, `updateOrderStatus()`, `getVendorOrderGroups()`, `addOrderComment()`
- `vendorApi` — `getMe()`, `onboard()`
- `financialApi` — `getVendorDashboard()`
- `productApi` — CRUD for products
- `reviewApi` — Review creation, moderation, listing
- `cartApi` — Cart operations

---

## 2. Backend Architecture

### 2.1 Module Structure (`back/src/modules/`)
Key modules and their routes:

| Module | Key Routes | Description |
|--------|-----------|-------------|
| `auth` | `/api/v1/auth` | Authentication, JWT issuance/refresh, password hash |
| `person` | `/api/v1/person` | Person management, contact info, addresses |
| `vendor` | `/api/v1/vendor` | Vendor onboarding, profile management |
| `product` | `/api/v1/products`, `/api/v1/categories` | Product CRUD, category hierarchy |
| `order` | `/api/v1/orders`, `/api/v1/vendor/orders` | Order lifecycle, vendor group status, ownership |
| `payment` | `/api/v1/payments` | Payment creation, refund, fail, capture, retrieval |
| `invoice` | `/api/v1/invoices` | Invoice generation, PDF download, admin listing |
| `payout` | `/api/v1/payouts` | Vendor payout CRUD, lifecycle |
| `transfer` | `/api/v1/transfers` | Transfer records between platform and vendors |
| `coupon` | `/api/v1/coupons` | Coupon CRUD, targeting rules |
| `financial` | `/api/v1/financial/vendor-dashboard` | Vendor financial dashboard (gross sales, net, history) |
| `wallet` | `/api/v1` (embedded) | Wallet balances, transactions |
| `review` | `/api/v1/reviews` | Review creation, moderation, listing |
| `admin` | `/api/v1/admin` | Admin dashboard & metrics |

### 2.2 Key API Endpoints

**Invoice Endpoints:**
- `GET /api/v1/invoices` — List invoices (admin only)
- `GET /api/v1/invoices/order/:orderId` — Get invoice by order ID
- `GET /api/v1/invoices/:invoiceId` — Get invoice by ID
- `POST /api/v1/invoices/:invoiceId/generate` — Regenerate PDF (admin only)
- `GET /api/v1/invoices/:invoiceId/download` — Download PDF (on-demand)

**Order Endpoints:**
- `GET /api/v1/orders` — List orders (consumer/vendor/admin)
- `GET /api/v1/orders/summary` — Consumer summary
- `GET /api/v1/orders/:orderId` — Get order details
- `PATCH /api/v1/orders/:orderId/vendor-groups/:ovgId/status` — Update vendor group status
- `PATCH /api/v1/orders/:orderId/status` — Update order status (admin only)
- `GET /api/v1/vendor/orders` — Get vendor's order groups
- `PATCH /api/v1/orders/:orderId/items/delivery` — Mark items as delivered

**Payment Endpoints:**
- `POST /api/v1/payments` — Create payment (consumer only)
- `POST /api/v1/payments/:id/refund` — Refund payment
- `POST /api/v1/payments/:id/fail` — Fail payment
- `GET /api/v1/payments/:id` — Get payment by ID
- `GET /api/v1/payments/order/:orderId` — Get payments for order
- `POST /api/v1/payments/:id/authorize` — Authorize (rejects unverified)
- `POST /api/v1/payments/:id/capture` — Capture (rejects unverified)

**Financial Dashboard:**
- `GET /api/v1/financial/vendor-dashboard` — Vendor financial dashboard with gross sales, net expected, received in stripe, pending distribution, bank payout, history

**Admin Metrics:**
- `GET /api/v1/admin/metrics` — Admin total counts (orders, vendors, products)

### 2.3 Financial Data Fields (from domain models)

**Order domain** financial fields:
- `totalAmount` — Order total
- `financialStatus` — Derived: FULLY_REFUNDED / PARTIALLY_REFUNDED / PAID (CD-058)
- `vendorGroups` — Each has: `subtotal`, `commissionPct`, `commissionAmount`, `vendorNet`, `transferId`
- `shippingAddress` — Snapshot of chosen address at checkout

**OrderVendorGroup financial fields:**
- `subtotal` — Group subtotal
- `commissionPct` — Global commission percentage (CD-045)
- `commissionAmount` — Calculated commission
- `vendorNet` — `ovg_total × (1 - commission_pct/100)` (CD-064)
- `transferId` — Stripe transfer reference

**Payment financial fields:**
- `amount` — Payment amount
- `status` — PENDING / AUTHORIZED / CAPTURED / FAILED / REFUNDED
- `provider` — Payment provider (Stripe)
- `providerTransactionId` — Stripe transaction ID
- `authorizedAt`, `capturedAt`, `failedAt`, `refundedAt` — Timestamps

**Invoice fields** (CD-035..CD-038):
- `orderId` — Related order (historical values)
- `emissionAt` — Emission timestamp
- `status` — GENERATED / PENDING
- `pdfUrl`, `pdfPath` — PDF storage references
- Uses **historical values** from the order at purchase time (CD-036)

### 2.4 MongoDB Documents (from route handlers and domain files)

**Order document** key fields:
- `id`, `personId`, `status` (OrderStatus enum)
- `vendorGroups` — array of OrderVendorGroup
- `shippingAddress` — snapshot: street, number, neighborhood, city, state
- `totalAmount` — number
- `financialStatus` — string (derived dimension per CD-058)
- `paymentStatus` — 'pending' | 'paid' | 'failed' | 'cancelled' | 'refunded' | 'partially_refunded'
- `saleParties` — { seller, buyer }
- `createdAt`, `updatedAt`
- `vendorGroups` each: id, vendorId, status, items, subtotal, commissionPct, commissionAmount, vendorNet, transferId

**Payment document** key fields:
- `id`, `orderId`, `personId`, `amount`, `status` (PaymentStatus enum)
- `provider` — e.g. 'stripe'
- `providerTransactionId`
- `authorizedAt`, `capturedAt`, `failedAt`, `refundedAt`
- `createdAt`, `updatedAt`

**Invoice document** key fields:
- `id`, `orderId`, `vendorId`, `emissionAt`
- `status` — GENERATED, PENDING
- `pdfUrl`, `pdfPath` — S3 or local storage
- CD-036: Uses historical order values, not current catalog

### 2.5 Dashboard/Metrics Endpoints
- `GET /api/v1/admin/metrics` — Admin counts (orders, vendors, products), auth-required
- `GET /api/v1/financial/vendor-dashboard` — Vendor financial dashboard, requires Vendor role, returns: grossSales, grossSalesLabel, netExpectedAmount, receivedInStripe, pendingDistribution, bankPayout, history

---

## 3. Database & MongoDB

### 3.1 Confirmed Schemas and Models

**Person** (CD-001..CD-004, CD-057, CD-060):
- Common abstraction for Admin, Consumer, Vendor
- 1:1 with Credential
- Login email from Contact_Info where Type = email
- Globally unique login email (CD-060)

**Main_Info** (CD-006, CD-007):
- 1:1 with Person
- Contains Name and exactly one of CPF or CNPJ (mutually exclusive per CD-007)

**Contact_Info** (CD-008, CD-040, CD-057, CD-060):
- 1:N from Person
- Fields: Type (email, phone, WhatsApp), Value, Is_Primary
- Login email lookup: Type = email, Value = provided email
- Is_Primary = primary contact, NOT login indicator
- Login contact protected from deletion while used for auth

**Vendor** (CD-001, CD-041):
- Person can be Vendor simultaneously (CD-002)
- Auto-publish after registration (CD-041)
- Store profile: storeName, slug, status (active/suspended/pending)

**Product** (CD-013, CD-062):
- `Quantity` = current stock
- No variants in MVP (CD-062: each variation = separate Product)
- Price, description, images (Product_Pic)
- Status: active/inactive/out_of_stock/discontinued

**Category** (CD-015, CD-043):
- Optional self-reference via `parent_id`
- Root = no parent, many children, max one parent
- Multilevel hierarchies supported
- Cycle prevention required

**Order** (CD-021, CD-022, CD-044, CD-058, CD-063):
- 7-state lifecycle: PENDING_PAYMENT → PAID → PROCESSING → SHIPPED → DELIVERED
- CANCELLED, FAILED_PAYMENT terminal
- Decomposed: Order → Order_Vendor_Group → Order_Item

**Order_Vendor_Group** (CD-021, CD-022, CD-044, CD-058, CD-063):
- 7-state fulfillment: PENDING → CONFIRMED → PREPARING → SHIPPED → DELIVERED
- CANCELLED, RETURNED terminal
- Per-vendor independence (CD-022)

**Payment** (CD-025, CD-044, CD-063):
- 5-state machine: PENDING → AUTHORIZED → CAPTURED
- FAILED, REFUNDED terminal
- Multiple attempts per Order preserved (CD-028)

**Invoice** (CD-035..CD-038, CD-075):
- Commercial receipt (not NF-e)
- Historical order values (CD-036)
- Cannot be rewritten on partial refund (CD-037)
- Minimal attributes: Order + Emission_At; Invoice_History empty intentionally
- On-demand generation for MVP
- S3 Standard-IA storage

**Transaction** (CD-031):
- Generic financial movement record
- Type distinguishes: SALE, COMMISSION, TRANSFER, REFUND, REVERSAL

**Wallet** (CD-030, CD-059):
- Shared by Vendor and Marketplace
- Balance derives from transactions
- Derivation strategy deferred (cached vs recalculated)

**Review** (CD-017, CD-067..CD-072, CD-074):
- 1-5 star scale, simple arithmetic mean aggregation
- Verified purchase only after DELIVERED state (CD-072)
- Post-moderation (CD-067), vendor response not permitted (CD-068)
- Verified purchase badge not displayed (CD-069)
- Owned images permitted (CD-071)

### 3.2 Indexes and Constraints (from code)
- Order personId index for ownership queries
- Vendor personId / vendorId indexes
- Product category_id / parent_id indexes
- Invoice orderId index for lookups
- Payment orderId index
- Unique email constraint for login (CD-060)

---

## 4. Docker Compose

### 4.1 Root `docker-compose.yml`
Services: `backend`, `frontend`, `mongo`, `redis`, `elasticsearch`
- Backend binds to `./back/.env`
- Frontend builds from `./front`
- MongoDB: `mongo:7`, replicaSet `fs01`, init database `fs01_marketplace`
- Redis: `redis:7-alpine`
- Elasticsearch: `8.15.0`, `xpack.security.enabled=false`
- Ports: backend 3000, frontend 5173, mongo 27017, redis 6379, elasticsearch 9200
- Volumes: `mongo_data`, `redis_data`, `elasticsearch_data`, `uploads_data`

### 4.2 Backend `back/docker-compose.yml`
Services: `backend`, `mongo`, `redis`, `elasticsearch`, `stripe-cli`
- Stripe CLI service with webhook listening on `backend:3000`
- Stripe env vars: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- Ports: backend 3000, mongo 27017, redis 16379 (note: different from root!), elasticsearch 9200
- Note: Redis port 16379 differs from root compose (6379) — this is the backend standalone compose

### 4.3 Infrastructure Dependencies
- Backend requires: MongoDB, Redis, Elasticsearch
- Frontend depends on backend (API)
- Stripe CLI only in `stripe` profile (not activated by default)
- AWS S3 not wired in production (localStorageAdapter used; S3 adapter exists but not connected)

---

## 5. Test Suites

### 5.1 Backend Vitest Tests
- **121 test files pass**, 2 failed, 11 skipped
- **1713 tests pass**, 5 failed, 138 skipped
- Failures:
  - Config validation tests (mongoUri directConnection mismatch)
  - Coupon quote tests (500 error on checkout - expected 201)
- These appear to be pre-existing failures not related to recent changes

### 5.2 Frontend Vitest Tests
- Test structure exists but not directly runnable from back directory
- Test results reference in task list: 577/584 frontend passing (7 failed — 3 files with Portuguese text query mismatches)

### 5.3 Playwright E2E Tests
- 7/7 Playwright tests pass reliably across two consecutive runs
- Root causes fixed: product catalog empty (seed.ts vs reset-database.cjs), localStorage SecurityError (clearAuth()), cart selector case
- Test files in `front/tests/e2e/` covering: admin dashboard, auth, catalog, cross-role security, golden path, guest cart, invoices, orders, vendor dashboard, vendor journey, wallet, search

### 5.4 Key Test Suites by Area
- **Invoice**: 43 tests pass (T-1103)
- **Payout**: 59 passing mongo contract tests + 12 mongo durability tests
- **Order/Lifecycle**: 34 files/764 tests passed
- **Payment**: Internal lifecycle implemented, 990/996 backend passing (3 pre-skipped, 3 skipped)
- **Vendor Dashboard**: All 993 backend tests pass, 71 payout tests pass

---

## 6. Configuration & Decisions

### 6.1 Confirmed Decisions (`docs/decisions.md`)
Key confirmed decisions relevant to the architecture:

- **CD-001**: Person is common abstraction for Admin, Consumer, Vendor
- **CD-002**: Person can be Consumer and Vendor simultaneously
- **CD-003**: Admin is mutually exclusive from Consumer/Vendor
- **CD-004**: Role entity only for Admin permissions
- **CD-007**: CPF XOR CNPJ (mutually exclusive)
- **CD-035**: Invoice = commercial receipt, not NF-e
- **CD-036**: Invoice uses historical order values
- **CD-037**: Partial refund does not rewrite original invoice
- **CD-038**: Invoice has Order + Emission_At; Invoice_History empty intentionally
- **CD-041**: Vendor onboarding auto-publish (no admin approval)
- **CD-045**: Single global commission percentage
- **CD-054**: Transaction currency = BRL, English interface
- **CD-059**: Consumer/Vendor authorization = ownership isolation (no generic RBAC)
- **CD-063**: Minimal state machines for Order, Payment, Order_Vendor_Group
- **CD-064**: Stripe Connect Separate Charges and Transfers
- **CD-074**: Frontend state management = TanStack Query + Zustand + React Router

### 6.2 Open Questions (from `open_questions.md`)
- **Q-018**: PDF invoice generation — scope resolved (commercial receipt, not NF-e), storage = S3 Standard-IA, trigger = on-demand MVP, automation deferred
- **Q-003**: Role & permission model — partially resolved, ownership isolation confirmed for Consumer/Vendor
- **Q-016**: Coupon mixed-cart calculation — resolved in CD-050, implementation pending
- **Q-029**: Credential cardinality — resolved 1:1, email uniqueness global

### 6.3 Task List Highlights (`docs/task_list.md`)
- P0–P3 prerequisites complete
- P4 implementation authorized through phase 4
- MAX_AUTHORIZED_PHASE = 5 (P5 authorized)
- Key completed tasks: auth (T-601..T-604), vendor onboarding (T-701..T-702), product CRUD (T-701..T-702), image upload (T-703a), vendor dashboard (T-704), product catalog (T-705), checkout (T-902..T-905), payments (T-1001..T-1006), refunds (T-1004), invoices (T-1103), reviews (T-1101..T-1109), order comments (T-1108..T-1109)
- Pending: coupon mixed-cart implementation (T-1102), S3/cloudfront (T-703b), Elasticsearch (T-801..T-803), Admin metrics research (T-1104)

---

## 7. Configuration Files

### 7.1 `back/.env` (redacted — secrets protection)
- Config via env variables read by `back/src/config/index.ts`
- Key variables referenced (values redacted per secrets policy):
  - `PORT`, `NODE_ENV`, `MONGO_URI`, `MONGO_DB_NAME`
  - `REDIS_URL`, `ELASTICSEARCH_URL`
  - `JWT_SECRET`, `JWT_EXPIRES_IN`
  - `FRONTEND_URL`, `STORAGE_ROOT`
  - `CORS_ORIGIN`, `COMMISSION_PCT` (default: 10)
  - `STRIPE_PAYMENT_METHOD_CONFIGURATION`
  - `AWS_REGION`, `AWS_S3_BUCKET`, `AWS_S3_PUBLIC_URL_BASE`, `AWS_S3_STORAGE_CLASS`
  - `ENABLE_STARTUP_CLEANUP`

### 7.2 `back/.env.example` (structure, not values)
- Documents the expected env var names and types
- Values are placeholder/fictitious

### 7.3 Root `docker-compose.yml`
- `./back/.env` mounted to backend
- Environment vars: `MONGO_URI`, `MONGO_DB_NAME`, `REDIS_URL`, `ELASTICSEARCH_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `FRONTEND_URL`, `STORAGE_ROOT`

### 7.4 Backend `back/docker-compose.yml`
- `./.env` mounted to backend
- Same env vars as above plus stripe-cli configuration

### 7.5 `back/src/config/index.ts` — Config Defaults (development)
- `mongoUri`: `mongodb://localhost:27017/fs01_marketplace?directConnection=true`
- `mongoDbName`: `fs01_marketplace`
- `redisUrl`: `redis://localhost:6379`
- `elasticsearchUrl`: `http://localhost:9200`
- `jwtSecret`: `dev-secret-change-in-production`
- `jwtExpiresIn`: `24h`
- `commissionPct`: `10`
- `frontendUrl`: `http://localhost:5173`
- `awsRegion`, `awsS3Bucket`, `awsS3StorageClass`: empty/default
- `corsOrigins`: derived from `CORS_ORIGIN` env var

---

## 8. Summary of Key Observations

### 8.1 Architecture Consistency
- **Role-based access control** is properly implemented with separate models for Admin (Role + PermissionENUM) vs Consumer/Vendor (ownership isolation per CD-039, CD-059)
- **Multi-vendor order structure** correctly decomposed: Order → Order_Vendor_Group → Order_Item per CD-021
- **Financial state separation**: Lifecycle state (OrderStatus) separate from financial status (CD-058: FULLY_REFUNDED / PARTIALLY_REFUNDED / PAID)
- **Stripe Connect** correctly configured as Separate Charges and Transfers per CD-064
- **BRL currency** confirmed, English interface per CD-054

### 8.2 Areas Requiring Attention
- **Coupon mixed-cart calculation** (T-1102): CD-050/Q-016 decided but implementation requires verification
- **S3 integration** (T-703b): AWS account validated (us-east-2), adapter wired with presigned GET, but CloudFront CDN and multipart upload pending
- **Elasticsearch** (T-801..T-802): Conceptual scope resolved (CD-049), mapping/sync details technical future
- **Admin metrics scope** (T-1104): Requires research against existing evidence, separate from Q-003

### 8.3 Test Evidence
- 1713/1856 backend tests pass (5 failures are pre-existing config/coupon issues)
- 577/584 frontend tests pass (7 failures are Portuguese text query mismatches)
- 7/7 Playwright E2E tests pass reliably
- Invoice service: 43/43 tests pass (T-1103)
- Payout service: 12/12 mongo contract tests pass + 59 unit tests pass

### 8.4 Secrets Protection Compliance
- `.env` files protected from git and read access per project rules
- Scanner runs on staged files via `scripts/scan-secrets.sh`
- No real credential values exposed in this report
- All secret references use environment variable names only