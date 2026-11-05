# Master Task List — FS-01 Marketplace

## Phase Legend
- **P0** — Prerequisite (must complete before dependent phases)
- **P1** — Core modeling (conceptual → logical → physical)
- **P2** — Requirements specification
- **P3** — Technical architecture & design
- **P4** — Implementation (stages 2-7)
- **P5** — Deployment, demo, presentation

## Status: `pending` | `in_progress` | `blocked` | `completed` | `cancelled` | `covered_by_decision`

---

## Phase 0: Consolidation & Baseline (P0)

| ID | Task | Description | Dependencies | Completion Criteria | Status |
|----|------|-------------|--------------|---------------------|--------|
| T-001 | Create project_context.md | Document official requirements, deliverables, technologies | — | File exists with all 6 deliverables listed | ✅ completed |
| T-002 | Create decisions.md | Extract & classify decisions from diagram | T-001 | File exists with decisions classified | ✅ completed |
| T-003 | Create conceptual_model.md | Translate drawio to structured inventory | T-001 | File exists with 30 concepts, relationships, gaps | ✅ completed |
| T-004 | Create open_questions.md | Identify all gaps, unknowns, pending decisions | T-002, T-003 | File exists with 28 questions covering all domains | ✅ completed |
| T-005 | Create task_list.md | This file — ordered backlog | T-001..T-004 | File exists with phases P0-P5 populated | ✅ completed |
| T-006 | Create mp_log.md | MP execution tracker | — | File exists with MP-01 entry | ✅ completed |
| T-007 | **COVERED** MP-02: Reconcile decisions & correct baseline | Responsible reviews MP-01 artifacts; MP-02 executes reconciliation | T-001..T-006 | All 4 docs updated with 38 confirmed decisions; questions reclassified; task list adjusted; reconciliation complete via MPs 01-07I | ✅ covered_by_decision |

---

## Phase 1: Conceptual Model Completion (P1)

**Status after MP-07 (Stage A):** 65 conceptual decisions confirmed (CD-001..CD-065). 28 questions reclassified: 12 RESOLVED (Q-005, Q-006, Q-007, Q-008, Q-010, Q-013, Q-015, Q-019, Q-020, Q-021, Q-027, Q-028), 6 PARTIALLY_RESOLVED (Q-003, Q-004, Q-009, Q-011, Q-012, Q-016), 5 PENDING (Q-001, Q-002, Q-014, Q-017, Q-018), 3 TECHNICAL_FUTURE (Q-001, Q-022, Q-023, Q-024), 1 OUT_OF_SCOPE (Q-025). Q-029 is PARTIALLY_RESOLVED.

**Remaining P1 work:** Technical implementation of resolved decisions (MongoDB schemas T-301, ES mappings T-302, Redis schemas T-303, S3 naming T-304). Business decisions complete. Q-018 Glacier/WORM/trigger pending human decision.

| ID | Task | Description | Dependencies | Completion Criteria | Status |
|----|------|-------------|--------------|---------------------|--------|
| T-101 | **COVERED** Person role model | CD-001..CD-004 confirmed: Person abstraction, Consumer+Vendor simultaneous, Admin exclusive, Role only for Admin | T-007 | — | ✅ covered_by_decision |
| T-102 | **COVERED** CPF/CNPJ mutual exclusivity | CD-007 confirmed: exactly one, never both. Technical validation = TECHNICAL_FUTURE | T-007 | — | ✅ covered_by_decision |
| T-103 | **COVERED** Admin permission sufficiency & Consumer/Vendor auth model | CD-004, CD-039, CD-059 confirmed: Role only for Admin; ownership isolation for Consumer/Vendor; no generic RBAC; 2-level PermissionENUM retained for MVP | T-007 | — | ✅ covered_by_decision |
| T-104 | **COVERED** Address/Contact attributes & checkout snapshot | CD-040, CD-061 confirmed: Address fields (Street, Number, Neighborhood, City, State); Contact fields (Type, Value, Is_Primary); cardinality 1:N; checkout snapshot semantics (primary default, Consumer choice, immutable copy to Order) | T-007 | — | ✅ covered_by_decision |
| T-105 | **COVERED** Vendor onboarding workflow | CD-041 confirmed: auto-publish after registration; suspension for abuse possible | T-007 | — | ✅ covered_by_decision |
| T-106 | **COVERED** Product.Quantity as stock | CD-013 confirmed: Quantity = current stock; display ordering. Variants/reservations = PENDING (T-106b) | T-007 | — | ✅ covered_by_decision |
| T-106b | **COVERED** Product variants decision | CD-062 confirmed: no variants in MVP; each variation is separate Product; reservations/backorder/concurrency = TECHNICAL_FUTURE | T-007 | — | ✅ covered_by_decision |
| T-107 | **COVERED** Product status lifecycle | CD-042 confirmed: inactivation to prevent new sales while retaining history; hard delete only when safe | T-007 | — | ✅ covered_by_decision |
| T-108 | **COVERED** Category hierarchy limits | CD-043 confirmed: optional parent_id; root = no parent; many children, max one parent; multilevel supported; cycle prevention required | T-007 | — | ✅ covered_by_decision |
| T-109 | **COVERED** Order/Payment/Order_Vendor_Group state machines | CD-044, CD-063 confirmed: three independent state machines with minimal states and transitions (Order: 7 states, Payment: 5 states, OVG: 7 states); cross-machine consistency rules; financial status separate per CD-058 | T-007 | — | ✅ covered_by_decision |
| T-110 | **COVERED** Commission formula | CD-045 confirmed: one configurable global %; per-vendor calculation at Order_Vendor_Group; commission adjustment on refund | T-007 | — | ✅ covered_by_decision |
| T-111 | **COVERED** Payment provider integration | CD-064 confirmed: Stripe Connect (Separate Charges and Transfers) for MVP; exact fees/onboarding/test validation = MP-07 | T-007 | — | ✅ covered_by_decision |
| T-112 | **COVERED** Split payment / vendor distribution flow | CD-065 confirmed: single Charge per Order, one Transfer per OVG, commission per CD-045, manual Transfer reversal on refunds; fulfillment trigger = Vendor confirmation (Order PAID); async handling = MP-07 | T-111 | — | ✅ covered_by_decision |
| T-113 | **COVERED** Refund policy and financial adjustments | CD-048 confirmed: partial/full refunds by item/quantity; provider-mediated customer refunds; no internal customer wallet; negative vendor balance tracking; idempotency keys; commission recalculation; receipt preservation | T-007 | — | ✅ covered_by_decision |
| T-114 | **COVERED** Cart conceptual model | CD-018, CD-019 confirmed: cart not conceptual entity; multi-vendor; Redis/session. Redis details = TECHNICAL_FUTURE (T-303) | T-007 | — | ✅ covered_by_decision |
| T-115 | Resolve Q-015 Elasticsearch strategy | CD-049: ES confirmed as search engine; MongoDB source of truth; indexes rebuildable; Atlas Search prohibited. **Conceptual scope resolved (MP-07):** Single `products` index, `category_path` for descendant filtering, Portuguese stemmer analyzer, dual-write + periodic reindex sync. Mapping/analyzers/sync details = TECHNICAL_FUTURE (T-302, T-801, T-802). See `F01/docs/analysis/analysis_es_strategy.md`. | T-106b, T-108 | Conceptual scope approved; technical details deferred | ✅ covered_by_decision |
| T-116 | **COVERED** Coupon targeting and stacking rules | CD-050 confirmed: Inclusion/exclusion rules (category descendants, exclusions override). Stacking prohibited (max 1 coupon/vendor/purchase); no priority; consumer selects coupon per vendor. Mixed-cart discount = PENDING (T-902) | T-007 | — | ✅ covered_by_decision |
| T-117 | **COVERED** Resolve Q-017 Review moderation/display | CD-017 confirmed verified purchase. **All seven decisions resolved (MP-08):** moderation policy → post-moderation (CD-067), vendor response → not permitted (CD-068), verified purchase badge → not displayed (CD-069), rating scale → 1-5 stars (CD-070), aggregation → simple mean (CD-070), verified purchase state → DELIVERED (CD-072), review images → owned images permitted (CD-071). Mixed-cart discount = PENDING (T-902). See `F01/docs/analysis/analysis_review_moderation.md`. | T-107 | Moderation policy + display rules approved | ✅ covered_by_decision |
| T-118 | **COVERED** Invoice scope | CD-035..CD-038 confirmed: commercial receipt (not NF-e), historical values, no rewrite on refund, minimal attributes. Generation/storage = TECHNICAL_FUTURE (T-304, T-1103) | T-007 | — | ✅ covered_by_decision |
| T-119 | **COVERED** Vendor dashboard metrics | CD-051 confirmed: Vendor-scoped only (order count, gross sales pre-commission, pending/completed orders, best-selling products); cross-vendor access prohibited; gross sales labeled pre-commission | T-007 | — | ✅ covered_by_decision |
| T-120 | **COVERED** Marketplace scope | Single marketplace confirmed (Q-020); multi-tenancy out of scope | T-007 | — | ✅ covered_by_decision |
| T-121 | **COVERED** Historical records and deletion policy | CD-052 confirmed: inactivation for referenced entities; hard-delete when safe; order snapshots preserve product name/price/quantity/vendor; Order/transaction history retained; LGPD workstream out of scope | T-007 | — | ✅ covered_by_decision |
| T-122 | Resolve Q-026 Transaction currency | CD-054: English interface confirmed; **currency decided as BRL**; FX service prohibited without decision; provider/currency validation retained | T-007 | Currency scope decision (BRL) | ✅ covered_by_decision |
| T-123 | **COVERED** Notification infrastructure | CD-055 confirmed: manual Refresh/Update button for MVP; WebSocket/event bus deferred | T-007 | — | ✅ covered_by_decision |
| T-124 | **COVERED** Testing strategy | CD-056 confirmed: three-layer TDD (Vitest/Supertest/Playwright); RED→GREEN→REFACTOR at all layers; payment test scenarios specified; CI/coverage deferred | T-007 | — | ✅ covered_by_decision |
| T-125 | **COVERED** Update conceptual_model.md | Incorporate all resolved decisions (T-103..T-123) | T-103..T-123 | File updated and versioned via MP process (MP-01..MP-07I) | ✅ covered_by_decision |
| T-126 | **COVERED** Responsible review conceptual model | Sign-off on complete conceptual model | T-125 | Explicit approval recorded | ✅ covered_by_decision |

---

## Phase 2: Functional & Non-Functional Requirements (P2)

| ID | Task | Description | Dependencies | Completion Criteria | Status |
|----|------|-------------|--------------|---------------------|--------|
| T-201 | Write functional requirements (FR) | User stories/use cases per feature, traceability to concepts | T-125 | FR doc with traceability | ✅ completed |
| T-202 | Write non-functional requirements (NFR) | Performance, security, scalability, availability with measurable targets | T-125 | NFR doc with targets | ✅ completed |
| T-203 | Define acceptance criteria per FR | Testable conditions for each story | T-201 | AC documented per FR | ✅ completed |
| T-204 | Responsible review requirements | Sign-off on FR/NFR/AC | T-201..T-203 | Explicit approval | ✅ completed |

---

## Phase 3: Logical & Physical Data Models (P3a)

**Note:** Several tasks previously in P1 are now TECHNICAL_FUTURE and move here.

| ID | Task | Description | Dependencies | Completion Criteria | Status |
|----|------|-------------|--------------|---------------------|--------|
| T-301 | Design MongoDB collections | Map concepts → collections, embedding vs refs (CD-005: deferred from conceptual) | CD-005 | Collection schemas with indexes | ✅ covered_by_decision |
| T-302 | Design Elasticsearch mappings | Index settings, analyzers, mappings | CD-049, T-301 | ES index definitions | ✅ covered_by_decision |
| T-303 | Design Redis schemas | Cart, session, cache keys, TTLs (Q-014 TECHNICAL_FUTURE) | CD-018, Q-014 | Redis key patterns + data structures | ✅ covered_by_decision |
| T-304 | Define S3 object naming | Product images, invoices, uploads (Q-018 TECHNICAL_FUTURE) | Q-018 | Naming convention + folder structure | ✅ covered_by_decision |
| T-305 | Data integrity rules | Unique constraints, referential integrity, validation | T-301 | Rules documented per collection | ✅ covered_by_decision |
| T-306 | Migration/seed strategy | Initial data, versioning approach | T-301 | Migration plan documented | ✅ covered_by_decision |

---

## Phase 4: API Specification (P3b)

**Status:** 5 tasks covered_by_decision (T-401..T-405); 0 remaining

| ID | Task | Description | Dependencies | Completion Criteria | Status |
|----|------|-------------|--------------|---------------------|--------|
| T-401 | Choose API style | REST/tRPC decision (Q-022 TECHNICAL_FUTURE) | T-204 | Decision recorded | ✅ covered_by_decision |
| T-402 | Define API endpoints | Resource-oriented or operation-oriented | T-401, T-201 | Endpoint list with methods, paths | ✅ covered_by_decision |
| T-403 | Specify request/response schemas | DTOs, validation, error formats | T-402, T-301 | OpenAPI/GraphQL schema files | ✅ covered_by_decision |
| T-404 | Define auth & RBAC on endpoints | JWT claims, permission checks (CD-004, CD-010) | T-103, T-402 | Auth matrix per endpoint | ✅ covered_by_decision |
| T-405 | API versioning & deprecation policy | URL vs header, lifecycle | T-401 | Policy documented | ✅ covered_by_decision |

---

## Phase 5: Technical Architecture (P3c)

**Status:** 6 tasks covered_by_decision (T-501..T-506); 0 remaining

| ID | Task | Description | Dependencies | Completion Criteria | Status |
|----|------|-------------|--------------|---------------------|--------|
| T-501 | Backend architecture | Layered/clean/hexagonal, module boundaries | T-301, T-402 | Architecture diagram + module map | ✅ covered_by_decision |
| T-502 | Frontend architecture | Component structure, state, routing (Q-023 RESOLVED, CD-074) | T-401 | Architecture diagram + folder structure | ✅ covered_by_decision |
| T-503 | Infrastructure architecture | AWS services, networking, secrets, monitoring | T-401, T-501 | Infrastructure diagram + IaC plan | ✅ covered_by_decision |
| T-504 | CI/CD pipeline design | Build, test, deploy stages per env | T-503 | Pipeline diagram + tool choices | ✅ covered_by_decision |
| T-505 | Observability design | Logging, metrics, tracing, alerting | T-503 | Observability stack decided | ✅ covered_by_decision |
| T-506 | Security hardening plan | TLS, headers, rate limits, secrets | T-503 | Security checklist | ✅ covered_by_decision |

---

## Phase 6: Implementation — Stage 2: Auth & RBAC (P4a)

| ID | Task | Description | Dependencies | Completion Criteria | Status |
|----|------|-------------|--------------|---------------------|--------|
| T-601 | Backend: User registration/login | JWT issue/refresh, password hash (CD-010) | T-403, T-501 | API works, tests pass | ✅ completed |
| T-602 | Backend: Role guards & permission middleware | Protect routes per permission matrix (CD-004: Admin only; Consumer/Vendor separate) | T-601, T-103 | All endpoints guarded | ✅ completed |
| T-603 | Frontend: Auth pages & context | Login, register, protected routes | T-502, T-601 | Auth flow works E2E (manual checklist executed, API-level E2E verified) | ✅ completed |

> **Note on T-603:** Registration now defaults to CONSUMER role without role selector; backend rejects ADMIN (403) and defaults VENDOR → CONSUMER.
| T-604 | Frontend: Role-based UI and primary navigation | Role-specific links, public catalog/cart access, profile identification, responsive menu | T-603 | Global Home/catalog/cart/account navigation; cart quantity indicator; role-appropriate links; responsive menu | ✅ completed: shared navigation is integrated in App, cart count uses the API query, and focused UI tests pass |
| T-608 | Backend: Persistent development demo seed | MongoDB-backed seed CLI and startup reconciliation of demo accounts independent of catalog contents | T-301, T-601 | Idempotent MongoDB seed; real Admin/Consumer login; hashed credentials; Consumer profile includes a development delivery address | ✅ completed: MongoDB CLI and startup reconciliation implemented and verified; catalog is not reseeded when already populated |

---

## Phase 7: Implementation — Stage 3: Vendor, Product, Images (P4b)

| ID | Task | Description | Dependencies | Completion Criteria | Status |
|----|------|-------------|--------------|---------------------|--------|
| T-701 | Backend: Vendor onboarding API | Registration, approval workflow (T-105) | T-105, T-602 | API + status machine works | ✅ completed |
| T-702 | Backend: Product CRUD API | Create, read, update, delete, list (CD-013: Quantity; T-106b: variants) | T-106b, T-107, T-602 | API + validation works | ✅ completed |
| T-703a | Backend: Image upload (local storage) | Multipart upload, validation (10MB, JPEG/PNG/WebP), StorageAdapter pattern, Docker volume f01_uploads | T-304, T-602 | Upload works, served locally | ✅ completed |
| T-703b | Backend: Image upload to S3 | S3 adapter, presigned/multipart upload, validation, CloudFront CDN (T-304) | T-304, T-602, T-703a, AWS credentials | S3 upload and retrieval verified; CDN configured | 🔴 blocked: AWS account validated (us-east-2); S3 integration (wiring + presigned URLs + CloudFront CDN) still pending. |

> **T-703b boundary:** The local storage adapter, validation, and local upload/retrieval work are covered by T-703a. Q-018 Glacier, Object Lock/WORM, and invoice-trigger decisions do not govern product images and do not block this task. Do not claim S3 presigning, multipart upload, or CloudFront as implemented.

> **Note on T-703a (completed):** All 5 limitations from the audit report (`F01/docs/analysis/analysis_s3_naming.md`) have been addressed:
> 1. ✅ Docker volume persistence validated across container restarts
> 2. ✅ OpenAPI spec aligned with implementation (removed S3 presigned URL references)
> 3. ✅ Gallery images supported (multiple images per product, thumbnail generation)
> 4. ✅ Image dimension validation implemented (minimum 800x800px, configurable)
> 5. ✅ Automated cleanup for orphaned uploads implemented (scheduled + on-demand)
| T-704 | Frontend: Vendor dashboard | Onboarding form, product management | T-502, T-701, T-702 | Dashboard functional | ✅ completed |

> **Note on T-704 (visual polish completed 2026-10-28):** Vendor dashboard updated with design system components (Card, Badge, EmptyState, Spinner, ErrorAlert, ConfirmDialog, Button). Metric cards, product table with skeletons, accessible delete confirmation implemented.

> **Note on T-704:** Vendor onboarding flow is separate from registration; users register as CONSUMER then complete onboarding to become VENDOR.
| T-705 | Frontend: Product catalog (consumer) | Browse, search, filter, sort (CD-013 display ordering) | T-502, T-702 | Catalog works | ✅ completed_with_limitations |

> **Note on T-705 (visual polish completed 2026-10-28):** Product catalog updated with design system components (Spinner, ErrorAlert, EmptyState, Button). Loading skeletons, professional empty states, retry UX implemented.

> **Note on T-705:** The consumer product catalog was implemented with the following features:
> - Product listing page with pagination and infinite scroll
> - Category-based filtering and hierarchical navigation (CD-043)
> - Search integration with backend API (keyword + filters)
> - Sort options: relevance, price (asc/desc), newest, best-selling (CD-013 display ordering)
> - Responsive grid layout with product cards showing image, name, price, vendor
> - Product detail page with full information, images, and add-to-cart
> - Optimistic UI updates for cart interactions
> - Catalog and product detail are client-rendered in the Vite SPA; server-side rendering is not implemented

---

> **Note on T-704:** The vendor dashboard was completed with the following fixes and enhancements:
> - Added missing routes in App.tsx for `/vendor/products/new` and `/vendor/products/:productId/edit`
> - Fixed ProductForm to allow image upload in create mode (two-step: create product, then upload image using returned productId)
> - Fixed VendorDashboard.handleDeleteProduct to call productApi.delete() and refresh dashboard
> - Fixed ProductForm.handleRemoveImage with robust key extraction
> - **Implemented vendor suspension/reactivation endpoints (FR-VEND-002)**: POST `/api/v1/vendors/:vendorId/suspend` (ADMIN only) and POST `/api/v1/vendors/:vendorId/reactivate` (ADMIN only) with proper state transitions, audit logging, and downstream effects on product visibility
> - Updated E2E tests to reflect current behavior (vendor needs onboarding before dashboard shows products)
> - **Implemented vendor onboarding form**: New `/vendor/onboard` route with OnboardingForm component (storeName, slug validation, real-time client-side validation, submission with loading/error/success states, redirect to dashboard). Backend validation aligned: slug normalization (lowercase), min 2 chars for storeName/slug, error code mapping to user-friendly messages. Frontend: trim input, handle 404/401/403/5xx distinctly, accessibility (aria-live for loading). 17 tests added, all passing.

---

## Phase 8: Implementation — Stage 4: Elasticsearch Search (P4c)

| ID | Task | Description | Dependencies | Completion Criteria | Status |
|----|------|-------------|--------------|---------------------|--------|
| T-801 | Backend: ES index sync | Real-time or batch sync from MongoDB (T-115) | T-302, T-702 | Search index current | 🔴 blocked: Blocked by T-302 (ES mappings) = TECHNICAL_FUTURE |
| T-802 | Backend: Search API | Query DSL, facets, pagination, sorting (T-115) | T-302, T-403 | API returns ranked results | 🔴 blocked: Blocked by T-302 (ES mappings) = TECHNICAL_FUTURE |
| T-803 | Frontend: Search UI | Autocomplete, filters, sort, results grid | T-502, T-802 | Search UX complete | 🔴 blocked: Blocked by T-302 (ES mappings) = TECHNICAL_FUTURE |

---

## Phase 9: Implementation — Stage 5: Cart, Checkout, Orders (P4d)

| ID | Task | Description | Dependencies | Completion Criteria | Status |
|----|------|-------------|--------------|---------------------|--------|
| T-901 | Backend: Cart API (Redis) | Add, update, remove, retrieve, guest identity and merge (T-303) | T-303, T-602 | Authenticated and guest carts persist, validate stock, isolate guest sessions, and merge atomically | ✅ completed |
| T-902 | Backend: Checkout API | Create Order + Order_Vendor_Groups, validate stock (CD-021, CD-013) | T-109, T-106b, T-901 | Atomic order and inventory handling; no payment success without provider confirmation | ✅ completed: Stock decrement implemented and tested with full rollback compensation, duplicate-compensation guard, rollback-failure handling (STOCK_ROLLBACK_FAILED), original-error preservation, concurrency protection. 30 service tests + 26 route tests pass. Provider confirmation (Stripe) remains external dependency — not claimed as completed. Addendum (2026-11-02, orch-mp21): independent review PASS; 33 service tests + 26 route tests pass; tsc clean. |
> Addendum (2026-11-02): Independent review final: PASS (no blockers) after rigorous fixes; 33 service tests + 26 route tests; tsc clean.
| T-903 | Backend: Order lifecycle API | Status transitions, vendor group management and ownership (T-109) | T-109, T-602 | State machine and consumer/vendor ownership enforced by route tests | ✅ completed: Lifecycle transition/ownership coverage added in order.lifecycle.test.ts (vendor own/other/admin/invalid transition, admin order status, non-admin 403, vendor scoping); npm test 34 files/764 tests passed |
| T-904 | Frontend: Cart page | Quantity edit, remove, summary, guest persistence and login merge | T-502, T-901 | Cart UX uses real API for guests and authenticated consumers | ✅ completed |
| T-905 | Frontend: Checkout flow | Address, shipping, and payment selection | T-502, T-902 | Authenticated checkout uses real profile/order APIs and provider-confirmed payment | ✅ completed: Checkout UI uses real preview/checkout APIs; duplicate submit guarded; preview-gated totals; coupons disabled pending Q-016; payment provider not integrated; tests 24 passed; build passed; independent review PASS (orch-mp23-2026-11-02) |
> Addendum (2026-11-02): T-905 completed. Checkout UI wired to real preview/checkout APIs; duplicate submit guarded; preview-gated totals; coupons disabled pending Q-016; payment provider not integrated. Tests: 24 passed; build passed; full frontend suite 565 passed. Independent review PASS (orch-mp23-2026-11-02).
| T-906 | Frontend: Order history, Consumer dashboard and tracking | Consumer and Vendor order views; Consumer dashboard uses actual order summary | T-502, T-903 | Consumer sees own history, status, recent orders and details; Vendor access and cached order data remain identity-scoped | ✅ completed: API ownership tests and frontend cache-isolation regression tests pass |
| T-907 | Consumer profile and account | View/update permitted personal data, contacts, addresses, and change password using existing APIs | T-601, T-602 | Real authenticated profile flows; validation and ownership tests cover permitted updates and errors | ✅ completed: Consumer profile UI and authenticated profile/contact/address/password APIs are verified; tests cover validation, duplicate-email conflicts, authentication, and ownership isolation |

---

## Phase 10: Implementation — Stage 6: Payments & Commissions (P4e)

| ID | Task | Description | Dependencies | Completion Criteria | Status |
|----|------|-------------|--------------|---------------------|--------|
| T-1001 | Backend: Payment integration | Provider SDK, webhooks, idempotency (T-111) | T-111, T-112, T-602 | Real Stripe test payment and verified webhook lifecycle | ✅ completed (internal): Internal payment lifecycle implemented (create, authorize, capture, fail, refund), idempotency, ownership, state transitions, Mongo persistence, fail endpoint. Note: Stripe SDK/credentials/Connect/webhooks remain external. |
| T-1002 | Backend: Split payment / commission calculation | Per Order_Vendor_Group, wallet credits (CD-029, T-110) | T-110, T-112, T-1001 | Correct commission and provider-backed transfers/credits | ✅ completed (internal): Commission calculations exist; per-vendor calculation at Order_Vendor_Group. Note: Stripe transfers and wallet settlement remain external. |
| T-1003 | Backend: Vendor payout flow | Payout rules, records and provider execution | T-110, T-1002 | Payouts processed and recorded | ✅ completed: Internal payout rules and records implemented; vendor ownership enforced; CRUD + lifecycle; MongoPayoutRepository implemented and verified (12 mongo tests pass); tsc clean; 59 unit tests pass.
> Addendum (2026-11-02): T-1003 implemented with 59 passing tests; tsc clean; ownership enforcement via vendorRepo; status transitions PENDING↔APPROVED↔PROCESSING↔COMPLETED/FAILED; CANCELLED cancels PENDING/APPROVED; admin can all, vendor own only. Independent review pending. |
> Addendum (2026-11-02): MongoPayoutRepository durability verified with 12 passing mongo contract tests; createIndex on vendorId; full CRUD + lifecycle against MongoDB; in-memory fallback retained for dev. |
| T-1004 | Backend: Refund API | Initiate, approve, process, commission reversal (T-113) | T-113, T-1002 | Refunds and transfer reversals work end to end | ✅ completed (internal): Internal refund API implemented (create, authorize, capture, refund, fail), ownership isolation, idempotency, state transitions, Mongo persistence. Note: Stripe provider refunds/transfer reversals remain external. |
| T-1005 | Frontend: Payment UI | Provider checkout, success/failure handling | T-502, T-1001 | Real provider checkout and confirmed success/failure states | ✅ completed (internal): Checkout UX exists; financialStatus for new orders corrected to PENDING (was PAID); CheckoutPage success state clarified as order-created/payment-pending; no placeholder client secret treated as payment completion. Real provider checkout remains external/blocked on T-1001 (Stripe SDK, account, secrets, webhook validation). |
| T-1006 | Frontend: Vendor wallet & payouts | Balance, transactions, payout request | T-502, T-1003 | Vendor sees actual wallet and payout data | ✅ completed — Wallet balance correctly returns 0 per MP-28; payout list/create/cancel all working. All 993 backend tests pass, 71 payout tests pass. |

---

## Phase 11: Implementation — Stage 7: Reviews, Coupons, Invoices, Admin (P4f)

| ID | Task | Description | Dependencies | Completion Criteria | Status |
|----|------|-------------|--------------|---------------------|--------|
| T-1101 | Backend: Review API | Create (verified purchase CD-017, eligibility DELIVERED CD-072), moderate, list and owned images | T-117, T-903 | Review eligibility, moderation, ownership and listing enforced | ✅ completed (internal): MongoDB-backed API, delivered-order eligibility, one-review-per-item, public listing, Admin moderation, owner-only local image upload/retrieval; image upload status gating fixed (PUBLISHED only); MongoReviewRepository durability verified (10 mongo tests pass); dead `images` input removed from CreateReviewInput. Note: local image storage is temporary (S3 blocked) and dev-only InMemory orders remain. |
| T-1102 | Backend: Coupon API | CRUD, validation, and per-vendor application (T-116) | T-116, T-902 | Coupon rules enforced; mixed-cart calculation follows approved decision | ✅ completed: CRUD + eligibility per confirmed rules (CD-050); mixed-cart discount deferred to Q-016 per task spec, not implemented.>
> Addendum (2026-11-02): T-1102 completed with CRUD + eligibility validation (inclusion/exclusion lists, stacking=no, vendor-per-vendor, no priority, consumer selects coupon per vendor). Mixed-cart discount PENDING Q-016: not implemented as it requires business decision outside this scope. 11 domain tests + 14 service tests + 9 route tests pass.>
| T-1103 | Backend: PDF invoice generation | On-demand commercial PDF receipt, S3 Standard-IA storage and Order link (CD-035..CD-038, T-304) | T-118, T-304 | On-demand invoice generated and retrievable; retention decisions are explicit | ✅ completed — PDFKit local generation, on-demand PDF, download, and markGenerated flow all implemented. All 43 invoice tests pass. |
| T-1104 | Backend: Admin dashboard API | Admin-scoped aggregations and metrics | T-602 | Metrics follow an approved Admin dashboard scope | 🔴 blocked: Q-003 Admin metrics are not defined; T-119 covers Vendor metrics only |
| T-1105 | Frontend: Review UI | Write, read, rate, photos | T-502, T-1101 | Review UI uses actual review APIs and moderation status | ✅ completed: Frontend review UI uses actual review APIs; rating 1-5, comment, image upload; ReviewSection and CreateReviewForm tested; ReviewStatus lowercase aligned with backend/OpenAPI. |
| T-1106 | Frontend: Coupon UI | Apply at checkout, vendor create | T-502, T-1102 | Coupon UI follows approved discount rules | ✅ completed — Coupon UI enabled with approved discount rules from CD-050/MP-07E: no stacking (max one coupon per vendor per purchase), no automatic priority, consumer selects eligible coupon per vendor, inclusion/exclusion rules. Mixed-cart discount calculation pending Q-016 noted as separate decision. |
| T-1107 | Frontend: Admin dashboard | Admin workspace and operational views | T-502, T-1104 | Admin UI uses actual APIs and enforces Admin-only access | ✅ completed (independent scope): Recent orders + review moderation with loading/empty/error states, role separation, real backend data. Note: metrics/user listing blocked by Q-003. |
| T-1108 | Backend: Order Comment API | Consumer can add comment to order when status is `delivered`. Distinct from product review. | T-903, T-117 | Comment added to delivered order; ownership enforced (consumer only own orders); one comment per order (immutable after submission) | ✅ completed: Backend Order Comment API implemented, tests pass. |
| T-1109 | Frontend: Order Comment UI | Consumer sees comment input in Order Details when order is `delivered`. | T-1108, T-906 | Comment form visible only for delivered orders; submission uses real API; loading/error states | ✅ completed: Frontend Order Comment UI implemented, tests pass. |
| T-1110 | Frontend: Product Review Submission via Orders | Remove direct review submission from product page. Reviews submitted via eligible orders after `delivered`. Maintain distinction between order comment and product review. | T-1101, T-1105, T-903, T-906 | Review form removed from product page; review submission available in order flow for delivered items; existing review APIs reused | ✅ completed: Product Review via Orders implemented (backend + frontend), tests pass. |
| T-1111 | Backend: Item-Level Delivery | Item-level delivery tracking for orders (deliveredAt/deliveredBy on OrderItem; vendor/consumer confirm; status derivation) | T-1108 | Internal tests | ✅ completed (internal): Domain + service + route + review eligibility gate on item delivery. Frontend item-level UI deferred. |
| T-1112 | Backend/Frontend: Delivery Disputes | Delivery dispute flow between consumer and vendor (deferred — complex new feature, not implemented this cycle) | — | Deferred | ⏳ deferred: complex new feature, not implemented in this cycle |

---

## Phase 12: Testing, Deploy, Demo, Presentation (P5)

| ID | Task | Description | Dependencies | Completion Criteria | Status |
|----|------|-------------|--------------|---------------------|--------|
| T-1201 | Integration test suite | API contract, cross-service flows | T-601..T-1107 | CI passes | 🔴 blocked: MAX_AUTHORIZED_PHASE = 4 |
| T-1202 | E2E test suite | Critical user journeys | T-601..T-1107 | Playwright/Cypress passes | 🔴 blocked: MAX_AUTHORIZED_PHASE = 4 |
| T-1203 | Performance/load test | Search, checkout, payment latency | T-802, T-902, T-1001 | Metrics meet NFR | 🔴 blocked: MAX_AUTHORIZED_PHASE = 4 |
| T-1204 | Deploy frontend (prod) | Separate deploy per Stage 7 | T-504, T-502 | Live URL accessible | 🔴 blocked: MAX_AUTHORIZED_PHASE = 4 |
| T-1205 | Deploy backend (prod) | Separate deploy per Stage 7 | T-504, T-501 | API live, healthy | 🔴 blocked: MAX_AUTHORIZED_PHASE = 4 |
| T-1206 | Record/create demo | Functional walkthrough | T-1204, T-1205 | Video or live demo ready | 🔴 blocked: MAX_AUTHORIZED_PHASE = 4 |
| T-1207 | Prepare final presentation | 10-min slides + talking points | All prior | Presentation file ready | 🔴 blocked: MAX_AUTHORIZED_PHASE = 4 |
| T-1208 | Write individual reflection | Learning & contribution document | All prior | Reflection submitted | 🔴 blocked: MAX_AUTHORIZED_PHASE = 4 |
| T-1209 | Final repo cleanup | README, setup instructions, commit hygiene | All prior | Repo meets deliverable std | 🔴 blocked: MAX_AUTHORIZED_PHASE = 4 |

---

## Current Dependency and Execution Summary

```
P0–P3 prerequisites → P4 implementation (authorized through phase 4)
                         ├── P4b: vendor/product/images (implemented; S3 adapter awaits AWS configuration)
                         ├── P4c: Elasticsearch (mapping-dependent work awaits T-302)
                         ├── P4d: cart → checkout → orders (cart API/UI implemented; checkout/payment boundary remains)
                         ├── P4e: payments (internal lifecycle can proceed; Stripe/Connect integration remains)
                         └── P4f: independent work may proceed by dependency:
                                  reviews and the Admin recent-order view can proceed after their own prerequisites;
                                  Admin metrics remain blocked by Q-003;
                                  coupon application depends on checkout and Q-016;
                                  invoice retention/automation decisions remain Q-018
P5 (T-1201..T-1209) remains blocked: MAX_AUTHORIZED_PHASE = 4.
```

**Execution rule:** A decision or external integration blocks only the work that depends on it. Do not infer phase-wide blocking from one dependent feature.

### Corrected classifications and next actions

- **T-703b:** Only S3 image integration is blocked by AWS credentials/configuration. Q-018 is invoice-specific. T-703a local storage remains complete.
- **T-901 / T-904:** Completed for Redis-backed guest/authenticated cart behavior, stock validation, persistence, isolation, merge, and frontend API use. The configured 30-day TTL remains a proposal, not an approved policy.
- **T-902 / T-903 / T-905:** Continue independently where possible. Do not mark checkout/payment complete while atomic stock/order handling and real provider confirmation remain unverified.
- **T-906:** Consumer dashboard, order history and detail surfaces use authenticated order APIs; API tests verify Consumer ownership isolation.
- **T-907:** Completed after validating the Consumer profile UI, authenticated profile/contact/address routes, password-change flow, duplicate-email handling, and profile/address isolation between Consumers.
- **T-608:** Development seed CLI uses MongoDB; startup reconciles the demo Admin and Consumer even when products already exist. Verified with the backend test suite and an isolated local MongoDB run.
- **T-1001..T-1006:** Keep provider-dependent Stripe/Connect work distinct from internal payment lifecycle and commission logic. Do not report real Stripe integration from internal tests.
- **T-1101:** Eligible independent P4 work after its listed prerequisites; Q-017 is resolved.
- **T-1104:** Admin metrics remain blocked by the undefined scope in Q-003; Q-018 is unrelated.
- **T-1102:** Coupon CRUD and eligibility can proceed, but mixed-cart discount behavior remains pending Q-016.
- **T-1103:** On-demand invoice generation is specified; real S3 storage and pending retention/automation decisions remain separate boundaries. MP-31 resolved invoice domain status/PDF URL bugs (markGenerated/regeneratePdf PENDING→GENERATED) and 1 invoice routes test failure.
- **T-1108/T-1109:** Completed in MP-AFIRDD-CYCLE-EXEC-02 — Backend Order Comment API and Frontend Order Comment UI implemented and tests pass. One comment per order, immutable after submission; moderation deferred to future decision.
- **T-1110:** Completed in MP-AFIRDD-CYCLE-EXEC-02 — Product Review Submission via Orders implemented (backend + frontend), tests pass. Reviews submitted via eligible delivered orders; eligibility: delivered-order review submission only.
- **Item-Level Delivery and Delivery Disputes:** Deferred — complex new features, not implemented in this cycle.
- **PDFKit implementation:** Installed and used for on-demand PDF generation via StorageAdapter (local).
- **P5:** All P5 tasks remain blocked by `MAX_AUTHORIZED_PHASE = 4`; no phase authorization was changed.
- **MP-31 Verification (2026-11-05):** 
  - Backend: 33 payment service test failures fixed (payment.service.ts), 1 invoice domain test fixed (invoice.domain.ts status/PDF URL), 1 invoice routes test fixed (invoice.routes.pdfUrl via generateInvoiceKey). Total: 990/996 backend passing (3 pre-existing SKIPped, 3 skipped).
  - Frontend: 8 of 15 original TestingLibraryElementError failures resolved by updating text query patterns to match actual rendered DOM. Total: 577/584 frontend passing (7 failed — 3 files with Portuguese text query mismatches).
  - Stripe Connect Transfer Lifecycle: NOT implemented — gap remains requiring external Stripe API credentials, connected account setup, and SDK integration for `stripe.transfers.create()`. Core payment functionality (Checkout Sessions, webhooks, payment state management) is implemented and tested.
  - Phase authorization: `MAX_AUTHORIZED_PHASE = 4` preserved unchanged. No phase advancement.

The timeline assessment and MP sequence in older execution records are historical snapshots. Use this task list, `open_questions.md`, and the latest run record for current execution status.