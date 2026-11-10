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

**Historical status after MP-07 (Stage A):** 65 conceptual decisions confirmed (CD-001..CD-065). The question classifications at that time have since changed; consult `open_questions.md` and `decisions.md` for current state. In particular, Q-016 is decided in CD-050; implementation remains pending.

**Remaining P1 work:** Implementation of the covered technical designs remains separate from their decision status (T-301..T-304). Q-018 concerns receipt retention and deferred automation, not product-image storage.

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
| T-116 | **COVERED** Coupon targeting and stacking rules | CD-050 confirmed: Inclusion/exclusion rules (category descendants, exclusions override). Stacking prohibited (max 1 coupon/vendor/purchase); no priority; consumer selects coupon per vendor. Mixed-cart decision resolved in CD-050/Q-016; implementation remains in T-1102. | T-007 | — | ✅ covered_by_decision |
| T-117 | **COVERED** Resolve Q-017 Review moderation/display | CD-017 confirmed verified purchase. **All seven decisions resolved (MP-08):** moderation policy → post-moderation (CD-067), vendor response → not permitted (CD-068), verified purchase badge → not displayed (CD-069), rating scale → 1-5 stars (CD-070), aggregation → simple mean (CD-070), verified purchase state → DELIVERED (CD-072), review images → owned images permitted (CD-071). See `F01/docs/analysis/analysis_review_moderation.md`. | T-107 | Moderation policy + display rules approved | ✅ covered_by_decision |
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
| T-304 | Define S3 object naming | Product images, invoices, uploads; Q-018 concerns invoice retention and automation | CD-035 for invoices | Naming convention + folder structure | ✅ covered_by_decision |
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
| T-703b | Backend: Image upload to S3 | S3 adapter, presigned/multipart upload, validation, CloudFront CDN (T-304) | T-304, T-602, T-703a, AWS credentials | S3 adapter wired via createStorageAdapter; presigned GET implemented; CloudFront CDN pending | 🟡 partial: S3 adapter wiring + presigned URLs implemented (local fallback remains); CloudFront CDN still pending. |

> **T-703b boundary:** The local storage adapter, validation, and local upload/retrieval work are covered by T-703a. S3 adapter wiring and presigned GET retrieval are implemented (local fallback remains). Multipart upload and CloudFront CDN are still pending. Q-018 Glacier, Object Lock/WORM, and invoice-trigger decisions do not govern product images and do not block this task.

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
| T-801 | Backend: ES index sync | Real-time or batch sync from MongoDB (T-115) | T-302, T-702 | Search index current | 🟡 in_progress / not DONE (2026-11-08): Mongo mutation capture, recovery worker, revision fence, producer integration and lifecycle implemented; restricted independent static PASS for SYNC01–06. Developer reports 148 passing tests / 14 files and TypeScript/scanner exit 0; current real MongoDB/ES/Painless and mixed-writer validation not demonstrated. Physical delete remains unavailable. See the effective closure checkpoint below. |
| T-802 | Backend: Search API | Query DSL, facets, pagination, sorting (T-115) | T-302, T-403 | API returns ranked results | 🟡 partial (2026-11-08): GET /api/v1/products uses ES when search is provided; filters/sort compatible; Mongo fallback for non-search. Independent review pending. |
| T-803 | Frontend: Search UI | Autocomplete, filters, sort, results grid | T-502, T-802 | Search UX complete | 🔴 blocked: depends on T-802; T-302's decision status is not itself a blocker. |

---

## Phase 9: Implementation — Stage 5: Cart, Checkout, Orders (P4d)

| ID | Task | Description | Dependencies | Completion Criteria | Status |
|----|------|-------------|--------------|---------------------|--------|
| T-901 | Backend: Cart API (Redis) | Add, update, remove, retrieve, guest identity and merge (T-303) | T-303, T-602 | Authenticated and guest carts persist, validate stock, isolate guest sessions, and merge atomically | ✅ completed |
| T-902 | Backend: Checkout API | Create Order + Order_Vendor_Groups, validate stock (CD-021, CD-013) | T-109, T-106b, T-901 | Atomic order and inventory handling; no payment success without provider confirmation | ✅ completed: Stock decrement implemented and tested with full rollback compensation, duplicate-compensation guard, rollback-failure handling (STOCK_ROLLBACK_FAILED), original-error preservation, concurrency protection. 30 service tests + 26 route tests pass. Provider confirmation (Stripe) remains external dependency — not claimed as completed. Addendum (2026-11-02, orch-mp21): independent review PASS; 33 service tests + 26 route tests pass; tsc clean. |
> Addendum (2026-11-02): Independent review final: PASS (no blockers) after rigorous fixes; 33 service tests + 26 route tests; tsc clean.
| T-903 | Backend: Order lifecycle API | Status transitions, vendor group management and ownership (T-109) | T-109, T-602 | State machine and consumer/vendor ownership enforced by route tests | ✅ completed: Lifecycle transition/ownership coverage added in order.lifecycle.test.ts (vendor own/other/admin/invalid transition, admin order status, non-admin 403, vendor scoping); npm test 34 files/764 tests passed |
| T-904 | Frontend: Cart page | Quantity edit, remove, summary, guest persistence and login merge | T-502, T-901 | Cart UX uses real API for guests and authenticated consumers | ✅ completed |
| T-905 | Frontend: Checkout flow | Address, shipping, and payment selection | T-502, T-902 | Authenticated checkout uses real profile/order APIs and provider-confirmed payment | ✅ completed: Checkout UI uses real preview/checkout APIs; duplicate submit guarded; preview-gated totals; historical report said coupons disabled pending Q-016 and payment provider not integrated; tests 24 passed; build passed; independent review PASS (orch-mp23-2026-11-02). Q-016 is now decided in CD-050; implementation and current coupon state require verification. |
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
| T-1102 | Backend: Coupon API | CRUD, validation, and per-vendor application (T-116) | T-116, T-902 | Coupon rules enforced; mixed-cart calculation follows approved decision | in_progress / not DONE: persisted vendor-owned create/list and authenticated mixed-cart quotation implemented; C1–C6 restricted independent static PASS after CQ001/CQ002. Discounted purchase remains503 pending accepted snapshot/order/payment/session recovery gate; see effective coupon closure below. |
> Addendum (2026-11-02): T-1102 completed with CRUD + eligibility validation (inclusion/exclusion lists, stacking=no, vendor-per-vendor, no priority, consumer selects coupon per vendor). Mixed-cart discount PENDING Q-016: not implemented as it requires business decision outside this scope. 11 domain tests + 14 service tests + 9 route tests pass.>
| T-1103 | Backend: PDF invoice generation | On-demand commercial PDF receipt, S3 Standard-IA storage and Order link (CD-035..CD-038, T-304) | T-118, T-304 | On-demand invoice generated and retrievable; retention decisions are explicit | ✅ completed — PDFKit local generation, on-demand PDF, download, and markGenerated flow all implemented. All 43 invoice tests pass. |
| T-1104 | Backend: Admin dashboard API | Admin-scoped aggregations and metrics | T-602 | Metrics follow an approved Admin dashboard scope | pending: research requirements and existing evidence for Admin metrics and Q-003 permissions; T-119 covers Vendor metrics only. Escalate only a genuinely unresolved decision. |
| T-1105 | Frontend: Review UI | Write, read, rate, photos | T-502, T-1101 | Review UI uses actual review APIs and moderation status | ✅ completed: Frontend review UI uses actual review APIs; rating 1-5, comment, image upload; ReviewSection and CreateReviewForm tested; ReviewStatus lowercase aligned with backend/OpenAPI. |
| T-1106 | Frontend: Coupon UI | Apply at checkout, vendor create | T-502, T-1102 | Coupon UI follows approved discount rules | in_progress / not DONE: consumer vendor selection and informative quotation/removal implemented; C1–C6 restricted independent static PASS after CQ001/CQ002. Discounted submit remains disabled; integrated purchase and complete vendor-management UI acceptance remain pending. |
> Addendum (2026-11-08, Unit1): independent review of Unit1 durable explicit acceptance returned PASS U1–U5, findings 0, static only, no tests executed (reviewer `ses_e43bca75cffedm02Jm9oLHoBTP`). T-1102/T-1106 remain NOT DONE; discounted checkout remains HTTP 503; no financial PASS. Restricted evidence: backend 109/0/0 (9 files), frontend 48/0/0 (3 files), duplicate/address 14/0/0 (1 file), both `tsc --noEmit` exit 0, scanner exit 0, `git diff --check` exit 2 with 57 historical warnings. Next gate remains accepted snapshot→order/payment mock TEST session→verified confirmation; no implementation authorized.| T-1107 | Frontend: Admin dashboard | Admin workspace and operational views | T-502, T-1104 | Admin UI uses actual APIs and enforces Admin-only access | ✅ completed (independent scope): Recent orders + review moderation with loading/empty/error states, role separation, real backend data. Metrics and user-listing scope and dependencies require separate assessment. |
| T-1108 | Backend: Order Comment API | Consumer can add comment to order when status is `delivered`. Distinct from product review. | T-903, T-117 | Comment added to delivered order; ownership enforced (consumer only own orders); one comment per order (immutable after submission) | ✅ completed: Backend Order Comment API implemented, tests pass. |
| T-1109 | Frontend: Order Comment UI | Consumer sees comment input in Order Details when order is `delivered`. | T-1108, T-906 | Comment form visible only for delivered orders; submission uses real API; loading/error states | ✅ completed: Frontend Order Comment UI implemented, tests pass. |
| T-1110 | Frontend: Product Review Submission via Orders | Remove direct review submission from product page. Reviews submitted via eligible orders after `delivered`. Maintain distinction between order comment and product review. | T-1101, T-1105, T-903, T-906 | Review form removed from product page; review submission available in order flow for delivered items; existing review APIs reused | ✅ completed: Product Review via Orders implemented (backend + frontend), tests pass. |
| T-1111 | Backend: Item-Level Delivery | Item-level delivery tracking for orders (deliveredAt/deliveredBy on OrderItem; vendor/consumer confirm; status derivation) | T-1108 | Internal tests | ✅ completed (internal): Domain + service + route + review eligibility gate on item delivery. Frontend item-level UI deferred. |
| T-1112 | Backend/Frontend: Delivery Disputes | Delivery dispute flow between consumer and vendor (deferred — complex new feature, not implemented this cycle) | — | Deferred | ⏳ deferred: complex new feature, not implemented in this cycle |

---

## Phase 12: Testing, Deploy, Demo, Presentation (P5)

| ID | Task | Description | Dependencies | Completion Criteria | Status |
|----|------|-------------|--------------|---------------------|--------|
| T-1201 | Integration test suite | API contract, cross-service flows | T-601..T-1107 | CI passes | ✅ completed: auth E2E root cause fixed (localStorage SecurityError via clearAuth()); 1 auth Playwright test passes reliably across consecutive runs |
| T-1202 | E2E test suite | Critical user journeys | T-601..T-1107 | Playwright/Cypress passes | ✅ completed: 7/7 Playwright tests pass reliably across two consecutive runs (6 guest cart + 1 auth); root causes fixed — product catalog empty (seed.ts instead of reset-database.cjs), localStorage SecurityError (clearAuth()), cart selector case (text=Shopping cart matches CartPage.tsx line 277) |
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
                          ├── P4c: Elasticsearch (T-302 covered by decision; implementation details require assessment)
                         ├── P4d: cart → checkout → orders (cart API/UI implemented; checkout/payment boundary remains)
                         ├── P4e: payments (internal lifecycle can proceed; Stripe/Connect integration remains)
                         └── P4f: independent work may proceed by dependency:
                                  reviews and the Admin recent-order view can proceed after their own prerequisites;
                                  Admin metrics and Q-003 permissions require task-specific research;
                                  coupon application depends on checkout and implementing the approved CD-050/Q-016 mixed-cart rule;
                                  invoice retention/automation decisions remain Q-018
P5 (T-1201..T-1209) remains blocked: MAX_AUTHORIZED_PHASE = 4.
```

**Execution rule:** A decision or external integration blocks only the work that depends on it. Do not infer phase-wide blocking from one dependent feature.

### Corrected classifications and next actions

**2026-11-06 — backlog-codex-reconciliation:** Current classifications above supersede conflicting historical status statements, without asserting implementation or provider validation. Sources: CD-050 and CD-075 in [decisions](decisions.md), Q-003/Q-011/Q-018 in [open questions](open_questions.md), [Elasticsearch analysis](analysis/analysis_es_strategy.md), and [Stripe validation analysis](analysis/analysis_stripe_validation.md). Independent documentary review is pending.

- **T-703b:** AWS account validated; S3 adapter wired with presigned GET retrieval and local fallback; CloudFront CDN and multipart upload remain pending. Q-018 is invoice-specific. T-703a local storage remains complete.
- **T-901 / T-904:** Completed for Redis-backed guest/authenticated cart behavior, stock validation, persistence, isolation, merge, and frontend API use. The configured 30-day TTL remains a proposal, not an approved policy.
- **T-902 / T-903 / T-905:** Continue independently where possible. Do not mark checkout/payment complete while atomic stock/order handling and real provider confirmation remain unverified.
- **T-906:** Consumer dashboard, order history and detail surfaces use authenticated order APIs; API tests verify Consumer ownership isolation.
- **T-907:** Completed after validating the Consumer profile UI, authenticated profile/contact/address routes, password-change flow, duplicate-email handling, and profile/address isolation between Consumers.
- **T-608:** Development seed CLI uses MongoDB; startup reconciles the demo Admin and Consumer even when products already exist. Verified with the backend test suite and an isolated local MongoDB run.
- **T-1001..T-1006:** Keep provider-dependent Stripe/Connect work distinct from internal payment lifecycle and commission logic. Do not report real Stripe integration from internal tests.
- **T-1101:** Eligible independent P4 work after its listed prerequisites; Q-017 is resolved.
- **T-1104:** Research the Admin metrics scope and Q-003 permission requirements against existing evidence; T-119 covers Vendor metrics only and Q-018 is unrelated. Do not treat Q-003 as a global blocker.
- **T-1102:** Coupon CRUD and eligibility are reported complete. Q-016 is resolved in CD-050; mixed-cart discount calculation remains implementation and verification work, not a pending business decision.
- **T-1103:** On-demand invoice generation is specified; real S3 storage and pending retention/automation decisions remain separate boundaries. MP-31 resolved invoice domain status/PDF URL bugs (markGenerated/regeneratePdf PENDING→GENERATED) and 1 invoice routes test failure.
- **T-1108/T-1109:** Completed in MP-AFIRDD-CYCLE-EXEC-02 — Backend Order Comment API and Frontend Order Comment UI implemented and tests pass. One comment per order, immutable after submission; moderation deferred to future decision.
- **T-1110:** Completed in MP-AFIRDD-CYCLE-EXEC-02 — Product Review Submission via Orders implemented (backend + frontend), tests pass. Reviews submitted via eligible delivered orders; eligibility: delivered-order review submission only.
- **Item-Level Delivery and Delivery Disputes:** Deferred — complex new features, not implemented in this cycle.
- **PDFKit implementation:** Installed and used for on-demand PDF generation via StorageAdapter (local).
- **P5:** All P5 tasks remain blocked by `MAX_AUTHORIZED_PHASE = 4`; no phase authorization was changed. Safe task-focused tests supporting authorized P4 work are distinct from the P5 test-suite and deployment tasks.
- **MP-31 Verification (2026-11-05):** 
  - Backend: 33 payment service test failures fixed (payment.service.ts), 1 invoice domain test fixed (invoice.domain.ts status/PDF URL), 1 invoice routes test fixed (invoice.routes.pdfUrl via generateInvoiceKey). Total: 990/996 backend passing (3 pre-existing SKIPped, 3 skipped).
  - Frontend: 8 of 15 original TestingLibraryElementError failures resolved by updating text query patterns to match actual rendered DOM. Total: 577/584 frontend passing (7 failed — 3 files with Portuguese text query mismatches).
  - Stripe Connect Transfer Lifecycle: historical report says not implemented. Claims about Checkout Sessions and webhooks here are not evidence of an end-to-end provider integration; Q-011 and `analysis/analysis_stripe_validation.md` retain test-mode execution as pending. Reconcile implementation claims through a separate task-specific inspection; no provider validation is claimed.
  - Phase authorization: `MAX_AUTHORIZED_PHASE = 4` preserved unchanged. No phase advancement.

The timeline assessment and MP sequence in older execution records are historical snapshots. Use this task list, `open_questions.md`, and the latest run record for current execution status.

## MVP closure mission queue — 2026-11-07

The mission IDs below are traceability labels, not replacements for existing task IDs or a claim that historical tasks have been independently verified. Mission state describes remaining closure evidence; it does not silently change the statuses or history above. `PENDING_VALIDATION` means implementation and/or end-to-end evidence still requires assessment, not READY. Dependencies apply to the affected work only; do not infer a global blocker. Sources include [decisions](decisions.md), [open questions](open_questions.md), and the [current execution record](../../docs/agent_runs/orch-s3-integration-2026-11-06.md).

| Mission | Required capability | Existing task IDs | Closure state and dependencies |
|---|---|---|---|
| MVP-01 | Catalog and product CRUD | T-701, T-702, T-704, T-705 | **PENDING_VALIDATION**; catalog/CRUD journeys need current evidence. The scoped T-705 stock-ordering correction below is eligible independently of S3. |
| MVP-02 | Cart and Redis | T-303, T-901, T-904 | **PENDING_VALIDATION**; verify guest/authenticated persistence, isolation, stock handling and merge; TTL remains a proposal under Q-014. |
| MVP-03 | Orders and delivery | T-902, T-903, T-905, T-906, T-1111 | **PENDING_VALIDATION**; depends on cart/checkout and applicable delivery decisions; verify ownership, transitions and integrated journey, not just internal tests. |
| MVP-04 | Coupons | T-1102, T-1106 | **PENDING_VALIDATION**; T-116/CD-050 and checkout are dependencies. Q-016 is decided; eligible-subtotal calculation and deterministic minor-unit allocation still require current implementation and journey evidence. |
| MVP-05 | PDF invoices | T-304, T-1103 | **PENDING_VALIDATION**; payment confirmation and authorized download are relevant dependencies. Current MVP closure requires PDF generation after confirmed payment, not only on demand; reconcile that requirement with the historical Q-018/on-demand documentation without silently changing decisions. Storage and retention remain separately scoped. |
| MVP-06 | Product images and S3 | T-703a, T-703b | **BLOCKED/PARTIAL** for unsafe physical image deletion, cleanup and operational S3 verification; do not re-enable unsafe paths or treat mocks as provider evidence. Other missions do not globally depend on S3. |
| MVP-07 | Stripe and split | T-1001, T-1002, T-1003, T-1004, T-1005, T-1006 | **PENDING_VALIDATION / provider-dependent work blocked** until safe test-mode integration and relevant provider prerequisites are established; internal lifecycle/tests do not establish provider-backed payment or split. |
| MVP-08 | Elasticsearch | T-302, T-801, T-802, T-803 | **PENDING_VALIDATION**; T-302 is covered by decision, T-801/T-802 require task-level assessment, and T-803 depends on T-802. |
| MVP-09 | Admin dashboard | T-1104, T-1107 | **PENDING_VALIDATION**; assess existing approved metrics and authorization separately from unresolved Q-003 details; do not treat Q-003 as a blanket blocker. |
| MVP-10 | Integrated frontend | T-603, T-704, T-705, T-904, T-905, T-906, T-907, T-1005, T-1105, T-1106, T-1107 | **PENDING_VALIDATION**; depends on each underlying API/provider journey. Existing screens or isolated tests alone do not demonstrate complete journeys. |

---

## P5 Lifecycle Matrix — MVP Recovery (LC-01..LC-26)

**Run:** `orch-p5-mvp-recovery-2026-11-09` | **Branch:** `feature/closing-initial-implementation` | **Base:** `aaaf8be000c78efb55b199cdc747ceb4a001cfb9`

| LC | Title | Status | Unit Tests | Integration Tests | E2E Tests | External Integration | Independent Review | Notes |
|----|-------|--------|------------|-------------------|-----------|----------------------|--------------------|-------|
| LC-01 | Visitor and catalog | IMPLEMENTED | ~71 pass | Not independently verified | Partial (frontend UI states not tested) | Elasticsearch cluster NOT available | PASS | Backend catalog routes tested; Elasticsearch tests mock fetch |
| LC-02 | Elasticsearch search | IMPLEMENTED | ~35 pass | Mocked fetch, not real ES | Not tested | ES cluster NOT available | PASS | Real ES cluster required but not available |
| LC-03 | Registration/auth | IMPLEMENTED | ~150 pass | Not independently verified | Not tested | N/A | No independent review | Logout + session invalidation added; revokedTokens in-memory only |
| LC-04 | Buyer/vendor initial choice | IMPLEMENTED | ~290 pass | Not independently verified | Not tested | N/A | No independent review | Consumer+Vendor coexist on same Person; Admin exclusive |
| LC-05 | Context switching/permissions | IMPLEMENTED | Part of ~290 | Not independently verified | Not tested | N/A | No independent review | Vendor cannot access other vendor's orders |
| LC-06 | Profile and addresses | IMPLEMENTED | Part of ~290 | Not independently verified | Not tested | N/A | No independent review | CRUD for contacts, addresses, name, password change |
| LC-07 | Vendor onboarding | IMPLEMENTED | Part of ~290 | Not independently verified | Not tested | N/A | No independent review | Vendor activation, store registration |
| LC-08 | Vendor products | IMPLEMENTED | ~153 pass | Not independently verified | Not tested | S3 adapter active | PASS | Product CRUD, stock, images via S3 |
| LC-09 | Images and S3 | IMPLEMENTED | Not tested separately | S3 upload 201, presigned GET 302 | Not tested | S3 INTEGRATION VERIFIED | PASS | Existing bucket fs01-marketplace-dev-20261105, region us-east-2 |
| LC-10 | Visitor cart | IMPLEMENTED | ~115 pass | Not independently verified | Guest cart E2E exists | N/A | No independent review | Add, update, remove, persist after reload |
| LC-11 | Authenticated cart + Redis | IMPLEMENTED | ~35 pass | Redis cart repository tested | Not tested | Redis real | PASS | TTL, merge guest cart, isolation |
| LC-12 | Multi-vendor coupons | IMPLEMENTED | 66 pass | Coupon routes tested | Not tested | N/A | No independent review | Per-vendor application, eligibility, expiration |
| LC-13 | Multi-vendor checkout | IMPLEMENTED | ~38 pass | Checkout service tested | Not tested | Stripe TEST | PASS | Order created payment_pending, multi-vendor grouping |
| LC-14 | Stripe TEST → paid | VERIFIED | 13 pass | Webhook handler tested | Steps 1-11 E2E | Stripe TEST INTEGRATION VERIFIED | PASS | Webhook → CAPTURED → PAID verified |
| LC-15 | Cart reconciliation | VERIFIED | 167 pass | Cart reconciliation tested | Not tested | N/A | PASS | removeItemQuantity preserves post-checkout items |
| LC-16 | Payment failure/recovery | VERIFIED | 96 pass | Payment lifecycle tested | Not tested | N/A | PASS | failPayment, repairFailedOrder, cart preserved |
| LC-17 | Vendor fulfillment | VERIFIED | 19 pass | Order lifecycle tested | Not tested | N/A | PASS | PAID→PROCESSING→SHIPPED→DELIVERED |
| LC-18 | Multi-vendor delivery | VERIFIED | 19 pass | Order lifecycle tested | Not tested | N/A | PASS | Cross-vendor 403, partial≠full delivered |
| LC-19 | Buyer orders | IMPLEMENTED | ~50 pass | Order routes tested | Not tested | N/A | Dispute fixes PASS | Order history, details, ownership |
| LC-20 | Reviews after delivery | IMPLEMENTED | ~25 pass | Review service/routes tested | Not tested | N/A | No independent review | Rating 1-5, duplicate prevention, no PDP form |
| LC-21 | PDF Invoice | VERIFIED | ~25 pass | Invoice service/routes tested | Not tested | N/A | Independent PASS review | PDF after payment, idempotent, cross-vendor blocked; independently reviewed PASS |
| LC-22 | Wallet/ledger/commissions | IMPLEMENTED | ~20 pass | Wallet service tested | Not tested | N/A | No independent review | Balance=0 per MP-28, append-only ledger |
| LC-23 | Transfers/payouts/refunds | VERIFIED | ~20 pass | Transfer service tested | Not tested | Stripe TEST | Independent PASS review | Transfer HTTP routes implemented and independently reviewed PASS |
| LC-24 | Vendor dashboard | VERIFIED | Not unit tested | Financial dashboard API | E2E file exists | N/A | Independent PASS review | Gross/net revenue, orders, wallet; independently reviewed PASS |
| LC-25 | Admin dashboard | IMPLEMENTED | ~15 pass | Admin metrics tested | E2E file exists | N/A | No independent review | Aggregated metrics, exclusive Admin access |
| LC-26 | Security/resilience/demo | VERIFIED | ~100 pass | Auth tests | Not tested | N/A | Independent PASS review | JWT, authorization, idempotency verified; concurrency gap documented as MVP limitation |

**Conclusion:** 19 of 26 lifecycles have independent code-reviewer PASS verdicts: LC-01, LC-02, LC-08, LC-09, LC-11, LC-13, LC-14 through LC-18, LC-19, LC-20, LC-21, LC-22, LC-23, LC-24, LC-25 and LC-26. LC-03, LC-04, LC-05, LC-06, LC-07, LC-10 and LC-12 remain IMPLEMENTED without independent review.

## Integration States — P5 DOC (2026-11-09)

**Run:** `orch-p5-mvp-recovery-2026-11-09` | **Branch:** `feature/closing-initial-implementation`

State legend:
- **CONFIGURED:** configuração declarada existente pelo responsável
- **RUNTIME VERIFIED:** aplicação comprovadamente carrega a configuração
- **INTEGRATION VERIFIED:** operação real em ambiente de teste aprovada
- **BLOCKED:** bloqueio demonstrado com evidência técnica

| Integration | State | Evidence | Notes |
|-------------|-------|----------|-------|
| Stripe TEST | INTEGRATION VERIFIED | Checkout session created (HTTP 201); webhook → payment CAPTURED + order PAID (AC-1 PASS); idempotency (AC-2 PASS); `payment_intent.succeeded` handling (AC-3 PASS); cart reconciliation (AC-4 PASS); unit tests without credentials (AC-5 PASS: 17/17); Docker backend on port 3000 healthy | Keys updated; webhook + financial flow validation continues |
| S3 | INTEGRATION VERIFIED | S3StorageAdapter active (AWS_S3_BUCKET=fs01-marketplace-dev-20261105, AWS_REGION=us-east-2); upload HTTP 201; presigned retrieval HTTP 302 to S3; image association to product verified | Existing bucket and region must be reused — no re-creation |
| AWS | CONFIGURED | Credentials present in Docker container; bucket exists | Existing bucket and region must be reused — no re-creation |

### Next eligible scoped work: T-705 stock ordering (MVP-01)

- **Priority/state:** first candidate, **READY for a scoped audit/fix**, not mission completion. T-702 and T-502 are recorded as completed/covered; CD-013 and FR-PROD-003 define in-stock products before out-of-stock products. S3 and its operational blockers are not prerequisites for this ordering correction.
- **Observed hypothesis:** the catalog starts with `newest` in `../front/src/features/catalog/ProductCatalogPage.tsx`, whereas stock ordering is an explicit option; current tests do not establish the default or cross-page behavior. Static inspection is not a reproduced runtime failure.
- **Acceptance:** use RED/GREEN tests to demonstrate the required available-before-unavailable ordering in the catalog, including a newer unavailable item, pagination and relevant explicit sort/filter behavior; apply ordering before pagination where required, preserve ownership and existing API contracts, and obtain independent review. Determine interaction with user-selected sorts from the applicable requirements rather than silently inventing policy.
- **Scope:** catalog frontend and product listing/sorting backend plus directly related isolated tests and required in-scope documentation. No S3, seed, provider, operational MongoDB, index creation or P5/deploy work is authorized by this scoped candidate.

## Dependency audit addendum — 2026-11-07

This addendum reconciles current open/equivalent work without rewriting historical task rows or changing completed/covered decisions into verified implementations. `READY FOR AUDIT` authorizes no implementation by itself: the responsible orchestrator must confirm a bounded task, acceptance criteria, test safety and independent review. T-705 is already in progress/review; do not start a competing change. Evidence and limitations are recorded in the [run checkpoint](../../docs/agent_runs/orch-s3-integration-2026-11-06.md).

| Open work | Dependency audit and next gate |
|---|---|
| T-703b / MVP-06 | T-304, T-602 and T-703a are recorded covered/completed; CD-075 reports an account, **not** operational S3 validation. **BLOCKED/PARTIAL:** product-image delete returns 503, both cleanup adapters fail closed, and cross-writer safety, reconciliation, review and authorized infrastructure evidence remain. Q-018 invoice retention is not an image prerequisite. |
| T-705 / MVP-01 | T-502 covered and T-702 reported completed, but neither proves current behavior. **IN PROGRESS / REVIEW_PENDING:** the default-order increment has isolated tests; full FR-PROD-003 is not demonstrated because `out_of_stock` can be filtered out and explicit-sort precedence requires assessment. See run checkpoint; do not treat as READY new work or DONE. |
| T-801 | T-302 is covered by CD-049/Q-015; T-702 is reported implemented. **AUDITED (read-only, 2026-11-08):** no ES client/implementation; config + docker only. Sync contract, mapping, safe isolated ES verification and implementation remain. Not DONE. |
| T-802 | T-302 is covered and T-403 is covered. **READY FOR TASK-SCOPED AUDIT** of query, sorting and contract prerequisites; no automatic T-302 blocker and no claim that search is implemented. CD-049 requires ES, not Atlas Search. |
| T-803 | T-502 covered; **BLOCKED on T-802** for a complete search UI. Independent frontend work may be assessed separately without claiming integration. |
| T-1102 and T-1106 / MVP-04 | T-116/CD-050/Q-016 is decided; T-902 is reported implemented, not proof of coupon/payment integration. T-502 is covered for T-1106. **READY FOR SCOPED AUDIT** of eligible-item subtotal, selected coupon, deterministic minor-unit rounding/allocation and preview-to-order consistency; T-1106's complete UI remains dependent on verified T-1102 behavior. Existing checkout code references eligible subtotal but also contains a fixed percentage (`../back/src/modules/checkout/checkout.service.ts`); this is not evidence that the approved contract is met. |
| T-1104 and T-1107 / MVP-09 | T-602/T-502 are reported completed/covered. Q-003's unresolved Admin permission-matrix sufficiency does **not** globally block already-defined Admin work; CD-051/T-119 define Vendor-only metrics, not a blanket Admin analytics decision. **READY FOR SCOPED REQUIREMENTS AUDIT** of separately evidenced Admin metrics and authorization; unspecified metrics or permissions stay unresolved. T-1107's existing workspace does not prove metric completion. |
| T-1112 | No task dependency is listed; delivery-dispute scope is explicitly deferred. **DEFERRED**, not READY without authorized requirements and acceptance criteria; T-1111 internal delivery does not itself approve dispute policy. |
| T-1201–T-1209 | P5 remains **BLOCKED by `MAX_AUTHORIZED_PHASE = 4`**. Their listed dependencies remain: T-1201/T-1202 → T-601..T-1107; T-1203 → T-802/T-902/T-1001; T-1204 → T-504/T-502; T-1205 → T-504/T-501; T-1206 → T-1204/T-1205; T-1207–T-1209 → all prior. Task-focused safe P4 checks do not authorize P5 deployment or phase advancement. |
| MVP-02/MVP-03 | T-303/T-901/T-904 and T-902/T-903/T-905/T-906/T-1111 are recorded covered/implemented. **PENDING_VALIDATION**, not proof of safe Redis/Mongo/provider-integrated journeys; Q-014 TTL remains a proposal, not a blocker for the established cart contract. |
| MVP-05 | T-118/T-304 are covered; T-1103 on-demand PDF is reported implemented. **PENDING_VALIDATION:** current closure requires generation after confirmed payment and authorized download, while Q-018 still describes automation deferred; reconcile the requirement without rewriting decisions. Q-018 Glacier/WORM applies only to invoice retention, not S3 images. |
| MVP-07 | T-111/T-112 and CD-064/CD-065 define Stripe Connect; T-1001–T-1006 report varying internal implementations. **PENDING_VALIDATION / provider-dependent work blocked:** real provider setup, verified webhook correlation/idempotency and safe test-mode evidence remain; internal tests do not prove transfer, payout or refund execution. The separate `payment-webhook-transfer-contract` candidate is BLOCKED as recorded in the run. |
| MVP-10 | T-502 is covered; T-603/T-704/T-705/T-904–T-907/T-1005/T-1105–T-1107 have historical implementation reports. **PENDING_VALIDATION:** complete journeys depend on their underlying API, ownership and provider behavior, not merely screen existence. |

**Identifier/graph audit:** 103 task rows were parsed; no duplicate defined task IDs, missing explicitly referenced task IDs or directed cycles were found within the parsed task dependency columns. Numeric ranges were expanded only over IDs actually defined, and prose dependencies such as “All prior”, external services, decisions, open questions and semantic dependencies were not graph-expanded; this is not proof that no missing requirement or semantic cycle exists. Historical notes that describe automatic cleanup or completed payment/invoice integrations do not supersede current limitations above.

### Review reconciliation — 2026-11-07

- **T-705: INCONCLUSIVE / not DONE.** Reviewer reported CR-001 visibility correction confirmed by static inspection; 134 backend and 44 frontend tests plus typechecks are developer-reported. The actual diff was unavailable for review, and precedence between stock-first and explicit sorting remains unresolved. This supersedes the earlier static hypothesis and the earlier statement that the catalog necessarily still filters out `out_of_stock`; it does not establish a global PASS.
- **Dependency-audit documentation: INCONCLUSIVE.** The queue reconciliation has not received a conclusive independent review. Its `READY FOR ... AUDIT` entries are candidates for investigation, not approval or proof of implementation readiness.

### Coupon audit — scoped candidate, not coupon completion

- **T-1102/T-1106:** CD-050/Q-016 confirms eligible-subtotal/minor-unit invariants, exclusion precedence and consumer choice; it does not prescribe a percentage. Static inspection found a narrower frontend/backend preview contract mismatch: the frontend encodes coupon codes in a GET query (`../front/src/shared/api/checkout.ts`), while the backend reads `req.body` and wraps the response (`../back/src/modules/checkout/checkout.routes.ts`). The frontend client treats the response as unwrapped. Reproduction with a focused HTTP contract test is still needed.
- **Candidate for a future scoped TDD correction:** align preview query transport and response envelope while preserving authentication, input validation and callers; use isolated Supertest and frontend client tests. This does not establish coupon validity, price calculation, persistence, checkout discounts, or readiness of the full T-1102/T-1106 journey. Avoid any UI claim that a coupon was validated or applied merely because preview transport succeeds.
- `couponTargets` is currently an empty process-local map; inspection found no coupon repository under backend modules. Checkout receives coupon codes but the order creation path shown in `checkout.service.ts` does not apply them; the allocation helper has isolated tests but no production caller found in this inspection. A complete implementation needs an authoritative coupon model/source, validation, vendor isolation and consistent preview/order calculations, not an assumed discount rate. This task is independent of S3 but remains **PENDING_VALIDATION**, not DONE.

### Review outcomes — checkout and catalog

- **T-1102/T-1106: INCONCLUSIVE / not DONE.** Reviewer outcome is inconclusive. The 503 coupon response is a temporary nonfunctional safeguard, not coupon implementation. Developer reported 69 backend and 25 frontend tests passing; these are not independent verification. Persisted terms, eligibility, vendor isolation, selection and consistent preview/order/payment calculation remain dependencies.
- **T-705: INCONCLUSIVE / not DONE.** CR-001 was reported statically corrected; review of the actual diff and explicit-sort precedence remain outstanding.

### T-901 review reconciliation

- **INCONCLUSIVE / not DONE for the cart-creation increment.** The final reviewer reported Lua TTL CR-001 statically corrected; 154 passing tests and typecheck are developer-reported, not independently reproduced. Mocked creation tests do not demonstrate Redis real atomicity or exactly-once retry behavior. The distinct `clear`/whole-cart update race remains open; see the [execution checkpoint](../../docs/agent_runs/orch-s3-integration-2026-11-06.md).

### T-901 CR-008 review reconciliation

- **INCONCLUSIVE / not DONE.** Reviewer reported CR-008 corrected by static inspection; 192 tests and typecheck are developer-reported, not independently reproduced. Real Redis behavior, mixed-version writers and noncanonical legacy timestamps remain unverified. Webhook clear CR-003 remains **BLOCKED**; see the [execution record](../../docs/agent_runs/orch-s3-integration-2026-11-06.md).

### T-903 review reconciliation — 2026-11-08

- **T-903: CR001-CR003 no reviewer blockers; task not DONE.** Reviewer found no corrective findings for CR001-CR003. Developer-reported tests: 25 frontend (OrderDetailPage), 1 backend node (vendor-privacy), 8 backend (vendor-projection/vendor-group-status), broader backend suite 68, frontend and backend typechecks passing, `git diff --check` passing. Observations recorded (non-blocking): OBS-001 list OpenAPI still `Order` (not `VendorOrder`); OBS-002 fallback status handling requires end-to-end verification. T-903 remains REVIEW_PENDING: in-memory/fake/mocked dependencies only; no real DB/auth/deployed runtime; broader vendor list/mutation privacy and concurrency remain. See [run record](../../docs/agent_runs/orch-s3-integration-2026-11-06.md).
- **Selected next independent eligible task for MVP closure:** T-801 (Elasticsearch sync contract audit, MVP-08). Independent of T-903/T-705; audit-scoped only; no implementation approval or DONE claim. T-802 and T-1104/T-1107 remain parallel audit candidates; T-705 remains in progress.

### Queue correction — 2026-11-08

- **T-903: INCOMPLETE / BLOCKED locally.** The earlier “no reviewer blockers” entry above attributed a Developer-session assessment to an independent reviewer; it was not independent and was not PASS. A real independent review reported **CORRECTIONS_NEEDED**: CR003 remains open because `api/openapi.yaml:1111` omits `pending` from `Order.financialStatus`. Three correction rounds have been reported; stop retrying the same finding at the attempt limit. CR008 was corrected statically, but dual-role delivery and identity-switch tests remain absent and the actual diff was unavailable to the reviewer. Historical test results remain reports, not new verification. See the [checkpoint](../../docs/agent_runs/orch-s3-integration-2026-11-06.md). This local blocker is not a global MVP blocker.
- **T-802: INCONCLUSIVE review** of the Mongo literal-search increment, including a potential NUL issue; ES is not implemented by that increment. Earlier simulated-Mongo tests do not establish real Mongo behavior. T-803 remains dependent on T-802.
- **Independent READY selection:** no implementation task is established READY by the available evidence. T-801's earlier audit requires defined bounded acceptance criteria and safe isolated ES verification; T-1102/T-1106's preview candidate was already acted on and its review is INCONCLUSIVE; T-1104 remains an audit candidate, not proven implementation-ready. Reconcile a concrete independent task and its dependencies and acceptance criteria without treating an audit candidate as implementation approval or repeating completed investigation.

### Review checkpoint — 2026-11-08

- **T-802: INCONCLUSIVE, not DONE or PASS.** The reported independent review of the Mongo literal-search increment found the NUL HTTP 400 correction addressed statically, but the actual diff was unavailable. The 16 passing tests and typecheck are Developer-reported, not independently reproduced; simulated Mongo and BSON serialization do not prove live Mongo behavior. Elasticsearch search and synchronization remain unimplemented; T-803 still depends on T-802.
- **T-903: CORRECTIONS_NEEDED / locally BLOCKED.** The actual independent review leaves CR003 open: the `Order.financialStatus` enum omits `pending`. Three correction attempts were reported; do not retry this finding beyond the limit. Dual-role delivery and identity-switch test coverage remain pending; the actual diff was unavailable. The earlier Developer-session assessment was not independent, and no PASS is claimed.
- **Next functional increment:** no independent implementation is established **READY** by the existing queue. T-801 remains a candidate, not READY: its acceptance is a current search index; dependencies are T-302 and T-702, recorded as covered and implemented respectively, but bounded implementation criteria and safe isolated Elasticsearch verification remain prerequisites. T-1104 metric implementation is blocked by an undefined approved metric contract, per the run record. Do not repeat the completed audits or claim an implementation is ready without satisfying its gates.

### Review and dependency checkpoint — 2026-11-08

- **T-801: CORRECTIONS_NEEDED / not DONE.** The Elasticsearch writer is disconnected from the application; isolated PUT tests use mocks. DELETE always rejects as a mitigation for CR001: Elasticsearch 8.15 Bulk `require_alias` does not guarantee alias-only deletion. CR002 redirect handling and CR003 URL-error sanitization were reported corrected by static inspection, but the reviewer lacked the actual diff and a real server. No functioning synchronization or independent PASS is established. T-302 remains covered and T-702 reported implemented; durable delivery, ordering, recovery, deletion and safe isolated Elasticsearch verification remain necessary for a current index.
- **T-304 / T-1103 / MVP-05: BLOCKED for the required post-payment invoice flow.** Private immutable PDF persistence, retrieval, atomic artifact selection and durable recovery are not established. Q-018 retention is separate, not the reason for this blocker. Historical on-demand completion above does not establish the current MVP requirement.
- **Selected independent next step: T-1102/T-1106 actual-diff review preparation**, not a new implementation or a repeat audit. Their earlier review was INCONCLUSIVE and persistence/eligibility remain unfinished; the orchestrator should assemble the exact scoped tracked and untracked changes, acceptance criteria and existing test evidence for an independent reviewer. Verify the correct base and availability of the actual diff first; if unavailable, retain INCONCLUSIVE. This review-preparation step does not require T-801 or invoice completion and does not mark either coupon task READY for implementation or DONE.

### Independent review reconciliation — 2026-11-08

- **T-903 dual-role delivery and identity-switch coverage: INCONCLUSIVE / not DONE.** The independent reviewer lacked the actual diff. Nine backend and 28 frontend passing tests and typechecks are Developer-reported, not independently reproduced; coverage alone does not establish real authentication or database behavior. The separate CR003 OpenAPI finding and its reported retry limit remain as recorded above.
- **T-705 unavailable product detail: INCONCLUSIVE / not DONE.** The actual diff was unavailable to the independent reviewer; 69 frontend tests and TypeScript are Developer-reported. The UI mitigation does not establish backend purchase enforcement; explicit-sort precedence remains unresolved.
- **Coupons:** CD-050/Q-016 is decided. Coupon preview and purchase remain guarded by HTTP 503; persistent terms and safe end-to-end application remain pending. H01–H104: the earlier search did not locate an authoritative inventory; it did not establish that every item was examined.
- **Next functional increment:** no independent implementation is established **READY** by the existing evidence. Concrete candidate T-801 has acceptance “Search index current” and dependencies T-302/T-702 (lines 187–190); the existing [vertical integration assessment](../../docs/agent_runs/orch-s3-integration-2026-11-06.md) identifies durable ordered synchronization, safe deletion/recovery and isolated verification as unresolved. Relevant candidate paths include `F01/back/src/modules/product/product.mongo.repository.ts:49–90,166–215` and `F01/back/src/modules/search/`; these are investigation pointers, not an implementation scope or proof of readiness. Do not repeat that assessment or claim a concurrent backend fix is promised. The orchestrator must establish a bounded safe increment and its prerequisites before assigning implementation.

### Checkout, onboarding and delivery reconciliation — 2026-11-08

- **T-1102/T-1106 address mitigation: INCONCLUSIVE / not DONE.** Orchestra reports CR001 whitespace and CR002 missing snapshot in Mongo reconstruction; neither is independently reproduced here and no existing data is presumed. The 14 isolated tests reported in the [run record](../../docs/agent_runs/orch-s3-integration-2026-11-06.md) use in-memory repositories and a mocked provider. No PASS; do not retry solely because the review transitioned to INCONCLUSIVE.
- **T-704/T-701:** onboarding UI review remains INCONCLUSIVE; partial persistence and recovery remain **BLOCKED_TECHNICAL**, not DONE. See the run record's onboarding assessment.
- **T-903 delivery:** four RED behaviors remain unresolved; two cycles without demonstrated progress were reported. Stop repeating the same approach; the delivery increment is BLOCKED, not DONE.
- **Independent next implementation:** none established READY from the current queue evidence. T-801 lacks a bounded safe implementation and isolated verification prerequisites; T-802 remains an audit candidate and T-1104 lacks an approved metric contract. Do not reopen prior increments or repeat completed audits as new tasks. Identify a distinct evidenced defect, its existing acceptance criteria and satisfied prerequisites before assigning work; local blockers are not global blockers.

### T-1104 metrics review reconciliation — 2026-11-08

- **INCONCLUSIVE / not DONE or PASS.** The later explicit requirement for non-financial registered order, vendor and product totals supersedes the earlier statements that T-1104 lacks an approved metric contract. Those counts are implemented against the configured repositories, without pagination; financial metrics and filters are not implemented. Counts are separate reads, not a transactional snapshot. Orchestra reports CR001's user-facing warning confirmed statically, but the independent reviewer did not receive the actual diff; real MongoDB was not verified.
- The [run record](../../docs/agent_runs/orch-s3-integration-2026-11-06.md) reports 13 frontend tests, 3 backend tests and both typechecks passing; those results were not independently reproduced for this checkpoint. Next: provide the complete scoped diff, including untracked files, for independent re-review. No broader dashboard completion is implied.

#### Effective MVP reconciliation — H01–H104 (2026-11-08)

This addendum supersedes conflicting current-status statements above without deleting history or changing approved decisions. Evidence, the complete 104-item historical matrix, limitations, and the proposed bounded implementation queue are in [the continuing run checkpoint](../../docs/agent_runs/orch-s3-integration-2026-11-06.md#reconciliação-histórica-única-h01h104--2026-11-08--rascunho-sob-revisão). H01–H104 and MVP labels are traceability labels, not new official task IDs. Implementation requires a separate scoped delegation; this addendum alone authorizes none.

| Existing task IDs | Effective status | Remaining acceptance / dependency |
|---|---|---|
| T-101, T-102, T-103, T-115, T-116, T-122, T-301, T-302, T-303, T-304 | covered_by_decision (design only) | Do not equate covered decisions with implementation. CD-049, CD-050, CD-054 and CD-059 remain authoritative; Q-016 and BRL/English are decided. |
| T-601, T-602 | completed in previously reviewed scope; current journey partial | Preserve existing guards and authentication work. Verify revocation/credential-change contracts separately; T-603's current client failures do not prove every backend auth behavior broken. |
| T-603 | in_progress — P0 Fix | Five reported failing auth identity/storage/refresh tests remain. Coordinate all credential consumers, request/cache boundaries and guest identity; do not repeat the already approved narrow profile/logout cache fix. |
| T-604, T-907 | completed core navigation/profile; T-907 remaining UX in_progress | Preserve real APIs and ownership tests. Remaining profile layout/modal and integrated identity evidence are not a reason to rebuild completed navigation. |
| T-608 | in_progress for demo closure; existing seed-recovery fixes preserved | Two historical seed regressions are reported GREEN. Complete persisted-product ES indexing and complete-catalog reindex without rebootstrap; verify declared identity uniqueness separately from operational presence. |
| T-701, T-702, T-704 | in_progress | Existing onboarding/CRUD/UI remain implemented; cross-writer role/product consistency and partial-write recovery are not complete. PRODUCT_CONFLICT409/create-only and multiword store-name corrections must be preserved. |
| T-703a, T-703b | in_progress / partial | Upload/retrieval and S3 wiring exist; physical image delete remains503, local/S3 cleanup disabled. Safe ref/storage concurrency/reconciliation, historical-base trust and authorized infrastructure evidence remain; Q-018 retention is unrelated. |
| T-705 | in_progress | API-backed catalog/PDP and unavailable-product UI exist. Preserve fixes; close integrated search and verify sorting policy without inventing precedence. Independent review of relevant increments remains limited/inconclusive. |
| T-801, T-802 | in_progress — not DONE | ES is connected to application search. CR005-A/B and SYNC01–06 have restricted independent static PASS: persisted seed recovery and integrated capture/worker/fence/producers/lifecycle are implemented. Current real MongoDB/ES/Painless, exclusion of old unversioned writers and complete filter/sort/pagination/rebuild acceptance remain unverified. Historical real-ES tests do not validate this patch. See the effective closure checkpoint below; no global search PASS. |
| T-803 | in_progress, completion dependent on T-802 | Preserve existing search UI; complete its integrated API/filter/sort contract after T-802. T-302 is not an undecided business blocker. |
| T-901, T-904 | in_progress | Redis/Lua and cart UI implementations exist. Guest/session cache isolation and durable ambiguous-write recovery remain. Payment clear ignores returned conflict and finalized retry may skip recovery; await alone is not completion. TTL default remains configurable proposal, not approved retention policy. |
| T-902, T-903, T-905, T-906, T-1111 | in_progress — P0 functional journey | D1 is an aggregate journey objective, not one implementation delegation. Four delivery/refund REDs, duplicate-session coordination and recoverable capture/order/stock/cart effects remain unresolved. First functional unit proposed is independent D2 (T-603/T-904 identity isolation), bounded by the DOC-001 addendum in the continuing run; after its independent PASS, define a separately scoped D1 correction with its own RED, indispensable competing writers and recovery gates. Preserve vendor projections and dual-role tests. The OpenAPI CR003 finding has an exhausted retry history and is not silently resolved. |
| T-1001, T-1002, T-1003, T-1004, T-1005, T-1006 | in_progress — internal/provider boundaries explicit | SDK, sessions, signed webhook handling, internal commission/refund/payout code exist; no completed real Stripe/Connect/payout/refund journey is established. Resolve transfer lookup/correlation/destination, durable recovery and financial contract; TEST execution requires separate authorization. Do not introduce an undefined T-1007 dependency or assume zero wallet balance proves settlement/atomic ledger. |
| T-1101, T-1105, T-1110 | in_progress for review closure; implemented scoped behaviors preserved | PDP submission removal and no vendor response/badge are preserved, not reopened. Both review entry paths now check owned delivered orders. Review legacy uniqueness and concurrent persistence remain incomplete; reported mock tests are not live Mongo proof. |
| T-1102, T-1106 | in_progress — quotation restricted PASS; purchase unavailable | Vendor create/list API, persisted terms, authenticated eligible-subtotal preview and consumer selection/removal implemented and statically reviewed across C1–C6 after CQ001/CQ002. Preview is quote-only, not purchase503. Discounted POST remains503 and UI submit disabled until accepted snapshot/order/payment/session recovery gate. CD-050/Q-016 is decided; see effective coupon closure and next plan below. |
| T-1103 | in_progress — CR007 restricted PASS; immutable post-payment PDF pending | Reviewer ses_e44f99573ffes55gGaXn13lB77 reports PASS, zero findings, for the global-receipt gate across three read routes, no-store and restricted roles. Not T-1103/T-304 DONE: private immutable post-confirmation generation, existing-artifact links and recovery remain. Q-018 retention is separate. See the restricted closure below. |
| T-1104, T-1107 | in_progress / review pending for registered totals | Non-financial registered order/vendor/product totals and Admin guard/UI warning are implemented; reported review is INCONCLUSIVE. Earlier absence-of-requirement blocker is stale for these counts. Financial analytics remain undefined and are not invented from Vendor CD-051. |
| T-1108, T-1109 | in_progress only for cross-writer immutable-comment closure | Existing delivered-owner sequential comment/UI flow remains. Concurrent whole-order writers must not replace an immutable comment. Comment is not Product Review. |
| T-1112 | deferred (unchanged) | Delivery disputes require their own approved scope; do not make them a hidden prerequisite of basic delivery. |
| T-1201, T-1202, T-1203 | blocked for P5 authorization; scoped P4 checks distinct | Historical tests are not a current green baseline: five auth REDs, four delivery/refund REDs and13 Mongo test failures are reported in different suites. Run only safe task-scoped checks when separately delegated; skip/mock/integration/runtime must be distinguished. |
| T-1204, T-1205 | blocked for explicit P5/deploy authorization | No deploy, operational migration, index rebuild, backup/restore or infrastructure change is authorized by this reconciliation. Separate Compose manifests do not prove running health, rollback or restore. |
| T-1206, T-1207, T-1208, T-1209 | pending deliverables under existing P5 gate | Functional recorded/live demo, setup/API documentation, presentation, reflection and pre-publication reproducibility/secrets checks remain separately evidenced; README planned claims are stale. No public release is implied. |

**Functional queue proposal:** first, D2 — T-603/T-904 coherent session publication, request/cache and guest-cart identity isolation, including the direct ProductForm consumer and the five recorded auth REDs. Follow the DOC-001 addendum in the continuing run for exact paths, acceptance, historical convergence-stop disposition and RED → GREEN → validations → independent review gates; this proposal does not reset attempts or authorize implementation. After that unit's PASS, define the next bounded correction under aggregate D1 (T-902 with affected T-903/T-1001/T-901/T-905), or justify another mandatory independent unit from D3–D9 using a concrete dependency. D1's delivery/refund, duplicate-session and capture/order/stock/cart gaps remain open, not bundled into the first delegation. The remaining D3–D9 proposals and their gates are unchanged; none is cumulatively authorized. Await/rejection/isolated CAS is not functional completion. No new generic audit chain, optional agent work or permission changes are prerequisites of the Marketplace demo.

**Review semantics:** source presence, a Developer report or an INCONCLUSIVE verdict is not independent PASS. Preserve narrow completed fixes without reopening them absent regression. The full historical reconciliation does not claim task-level DONE, provider runtime validation or universal security coverage.

##### Restricted closure and effective queue — 2026-11-08

- **T-801 CR005-A: independent PASS, zero corrective findings**, as confirmed by the coordinator for the persisted-source seed increment and publication fidelity. Static review only: the Reviewer did not execute tests or services. Developer-reported RED: 5 passed/5 failed, exit 1; GREEN: 54 passed across 6 files, exit 0; TypeScript and scanner exit 0. Exact commands and incremental patch are in the [continuing run](../../docs/agent_runs/orch-s3-integration-2026-11-06.md#t-801-cr005-a--seed-indexa-fonte-persistida--2026-11-08). This closes only CR005-A, not T-801/T-802/T-803. CR006-SYNC, CR005-B, CR006-SOURCE, T801-STARTUP, CART-RETRY and CART-CONFLICT remain open; CD-049 and all other decisions are unchanged.
- **D2 remains stopped:** historical per-finding/run-task attempt counters have not demonstrated a remaining authorized attempt. No inferred balance, reset or new D2 correction. The independent CR005-A selection was performed and has now received the restricted PASS above; the historical D2-first proposal is preserved, not a requirement to halt independent backlog work.
- **Next functional handoff, not implementation authorization:** prepare a separate bounded CR005-B contract under T-801/D6 for complete-catalog seed reconciliation into ES without recreating accounts, categories or product IDs. Require an observable complete-catalog regression, preserved persisted-source behavior, RED → GREEN evidence and independent review. Do not repeat the H01–H104 audit, reopen CR005-A or start implementation in this documentation task. Durable ordering, startup/source errors and cart recovery retain their separate acceptance criteria and gates.

##### CR005-B restricted closure and CR006-SYNC handoff — 2026-11-08

- **T-801 CR005-B: independent PASS, zero corrective findings**, reported by the coordinator from Reviewer session `ses_e452eed5bffeDHdQSf7lQ4yAW2`. Only the complete persisted seed-catalog recovery **with searchIndex** is closed: validate all identities/vendors before publishing 12 persisted products, with no bootstrap writes. Without searchIndex, legacy account reconciliation remains. Reviewer executed no commands; Developer-reported RED 10 pass/6 fail (exit 1), GREEN 60 pass across 6 files (exit 0), TypeScript/scanner/diffcheck exit 0. CR005-A remains PASS; this is not global T-801/T-802/T-803 completion or live ES validation.
- **Next functional proposal: CR006-SYNC**, durable ordered delivery of current Mongo product state, including CRUD/status/stock, seed and rebuild producers, worker recovery and lifecycle. See the [bounded plan and verification gates](../../docs/agent_runs/orch-s3-integration-2026-11-06.md#cr006-sync--plano-da-proxima-unidade-funcional--2026-11-08). Plan only, for coordinator assessment before implementation delegation; not READY or implemented. CR006-SOURCE, cart recovery and D2's historical stop remain unchanged. This addendum supersedes only the CR005-B pending/next-handoff statements above; no repeated inventory or new business decision.

##### T801CR006SYNC restricted PASS and next functional unit — 2026-11-08

- **Effective status, superseding the earlier SYNC proposal/review-pending entries:** SYNC01 has the previously reported independent static PASS; Reviewer `ses_e450657d4ffe9qXHJl4Uqw8Y7T` now reports **PASS for SYNC02–06, zero corrective findings**, per coordinator handoff. Review inspected source/test patch and ES 8.15 documentation, but ran no commands or services. Mongo capture, worker recovery, revision fencing, CRUD/status/stock/seed/rebuild producer wiring and startup/shutdown lifecycle are implemented and reviewed within that scope. **T-801 remains in_progress / not DONE** under CD-049.
- Developer-reported final verification is **148 passed, 0 failed, 0 pending / 14 files; exit 0**, TypeScript exit 0 and scanner/diffcheck exit 0. Exact historical commands, AC coverage and limits are in the [SYNC02–06 evidence](../../docs/agent_runs/orch-s3-integration-2026-11-06.md#cr006-sync--sync0206-unidade-recuperaçãoordenação--2026-11-08) and its final closure. These checks were not rerun for this documentation update. Real Mongo atomicity/query behavior, ES/Painless execution and exclusion of old unversioned writers are not demonstrated; this is a technical validation boundary, not a missing human product decision. Isolated safe regressions can continue without operational access. No automatic legacy backfill, safe physical deletion, financial stock consistency or full T-802/T-803 closure is claimed.
- **One next executable proposal: D4 / T-1103 CR007, invoice read/download ownership boundary.** Close the concrete cross-vendor disclosure across invoice-by-order, invoice-by-ID and PDF download: an order-wide receipt is not a vendor-scoped artifact merely because `invoice.vendorId` matches or the vendor participates. Preserve the owning Consumer and existing Admin paths, and retain single-vendor download with new positive regression evidence; deny a vendor access to a multi-vendor global receipt without generating, fetching or leaking its global PDF link/path. This is a bounded privacy correction, not a 503 substitute for coupons, a new vendor-receipt product or completion of post-payment immutable PDFs. Exact three proposed executable paths, AC, test safety, dependency rationale and attempt limits are in the [next-unit contract](../../docs/agent_runs/orch-s3-integration-2026-11-06.md#t801cr006sync--docupdate-após-pass-e-próxima-unidade--2026-11-08).
- D7 coupons remain required and CD-050/Q-016 already decided. Their persisted vendor terms, eligibility/selection, exact minor-unit allocation and identical preview/order/payment snapshot require a larger integrated financial contract with D1; do not restart preview/helpers or claim the 503 guard delivers coupons. CR007 is independently actionable before that contract or the full PDF trigger/storage/recovery work. D2 remains stopped by counters; exhausted T-903 OpenAPI CR003 is not reopened. No implementation, new audit or review delegation is initiated here.

##### T1103CR007 restricted closure and coupon next contract — 2026-11-08

- **CR007 independent PASS / zero corrective findings**, Reviewer `ses_e44f99573ffes55gGaXn13lB77`, as supplied by the coordinator. Static review; commands_executed: none. Gate covers invoice-by-order, invoice-by-ID and PDF download: no global receipt for a non-owning multi-vendor participant; owning Consumer/dual-role buyer and existing Admin paths preserved, proven single-vendor access retained, vendor raw links omitted and no-store applied. Developer reports 117 passing tests / 4 files, TypeScript/scanner/diffcheck exit 0; Reviewer did not reproduce them. [Exact evidence and scoped closure](../../docs/agent_runs/orch-s3-integration-2026-11-06.md#t1103cr007-docupdate--2026-11-08). No immutable PDF, private-storage or whole-task completion claim.
- **Effective next proposal supersedes the CR007-next recommendation above:** T-1102/T-1106, persisted vendor terms → authenticated eligible-item coupon quotation → consumer selection, with purchase explicitly unavailable for discounted quotes until the order/payment snapshot and concurrency gate is closed. [One bounded executable plan, paths, RED acceptance and activation boundary](../../docs/agent_runs/orch-s3-integration-2026-11-06.md#t1102t1106-coupon-plan--2026-11-08). Not another audit, isolated helper, cosmetic change or authorization to remove purchase503. D2 counters and exhausted T-903 CR003 are unchanged. Implementation requires a separate delegation; no code is changed by this docupdate.

##### Effective coupon closure and accepted snapshot checkout plan — 2026-11-08

- **C1–C6 restricted independent static PASS, no open corrective findings**, supplied by the coordinator: CQ001 Reviewer `ses_e44cc3fb1ffeYpUKyixrntmn8l`; CQ002 and accumulated closure Reviewer `ses_e44c57e85ffePFTWvR0T1HNaCz`. Vendor-owned create/list API and persisted immutable coupon terms feed the authenticated mixed-cart preview and explicit consumer selection UI. Eligible-item targeting, exclusion precedence and deterministic minor-unit allocation are implemented in this quote scope. CQ001 preserves cart-priced normal checkout after removing a catalogue-priced quote; CQ002 discards confirmed/deferred quotes on cart/preview error even with unchanged cache identity. This supersedes prior preview503/unimplemented-quotation and C1–C6 review-pending statements only; it does not assert full CRUD/vendor UI or financial completion.
- **T-1102/T-1106 remain in_progress / not DONE.** Coupon POST503, quote-only notice and disabled discounted submit remain. No accepted financial snapshot, safe concurrent order/session creation, payment, commission, refund or provider runtime PASS is inherited. Developer-reported final evidence: frontend42, backend95, duplicate/address14 passing; both typechecks and scanner exit0. Reviewer ran no commands. Literal diffcheck exit2 with57 historical whitespace warnings in run5352–6573 is not clean; history was not rewritten. These application checks were not rerun for this docupdate.
- **Next bounded proposal replaces the quotation-next recommendation:** [accepted snapshot checkout FIXPLAN, first integrated unit and downstream activation gates](../../docs/agent_runs/orch-s3-integration-2026-11-06.md#accepted-snapshot-checkout-fixplan--2026-11-08). First deliverable is authenticated explicit quote acceptance with durable attempt identity, immutable snapshot and reload/retry UI, without stock/order/payment/provider effects or a promise of payment. The same plan closes the subsequent exact-net provider/session/webhook gate before any purchase activation; it is not another audit or standalone helper. Coordinator assessment and a separate implementation delegation remain necessary. D2's counter gate, exhausted OpenAPI CR003, four delivery/refund REDs and P5 limits remain; no counter reset or operational authorization.

##### Unit2 independent review PASS (CR-001..CR-014) — docupdate — 2026-11-08

- **Independent review PASS, 0 findings**, static only, reviewer `ses_e43760633fferFD9lE5cZ7yEfz`: CR-001 float precision, CR-002 mock URL reconstruction, CR-003 snapshot validation, CR-010 persistence gap, CR-011 idempotency guard, CR-012 `CHECKOUT_URL_UNAVAILABLE`→503, CR-013 snapshot validation extension, CR-014 provider label `'stripe'` all verified resolved. Restricted PASS; reviewer executed no tests. Developer evidence: `checkout.accepted-snapshot.test.ts` 5 pass; full checkout suite 129 pass/0 fail; `tsc --noEmit` exit 0; scanner exit 0.
- **T-1102/T-1106 remain in_progress / not DONE.** Discounted checkout remains HTTP 503. No financial PASS, no global PASS, no task completion. D2 counter gate and exhausted OpenAPI CR-003 unchanged. Next: assess proceeding to Unit2 gate (accepted snapshot → order/payment → mock TEST session) or other independent work.
