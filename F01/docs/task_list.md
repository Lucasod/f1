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
| T-604 | Frontend: Role-based UI rendering | Hide/show per permissions (Admin vs Consumer vs Vendor) | T-603 | UI respects roles | ✅ completed |

---

## Phase 7: Implementation — Stage 3: Vendor, Product, Images (P4b)

| ID | Task | Description | Dependencies | Completion Criteria | Status |
|----|------|-------------|--------------|---------------------|--------|
| T-701 | Backend: Vendor onboarding API | Registration, approval workflow (T-105) | T-105, T-602 | API + status machine works | ✅ completed |
| T-702 | Backend: Product CRUD API | Create, read, update, delete, list (CD-013: Quantity; T-106b: variants) | T-106b, T-107, T-602 | API + validation works | ✅ completed |
| T-703a | Backend: Image upload (local storage) | Multipart upload, validation (10MB, JPEG/PNG/WebP), StorageAdapter pattern, Docker volume f01_uploads | T-304, T-602 | Upload works, served locally | ✅ completed |
| T-703b | Backend: Image upload to S3 | Presigned URLs, multipart, validation, CloudFront CDN (T-304) | T-304, T-602, T-703a, AWS credentials, Q-018 decision | Upload works, CDN served | ⏳ pending |

> **Note on T-703a (completed):** All 5 limitations from the audit report (`F01/docs/analysis/analysis_local_storage_vs_s3.md`) have been addressed:
> 1. ✅ Docker volume persistence validated across container restarts
> 2. ✅ OpenAPI spec aligned with implementation (removed S3 presigned URL references)
> 3. ✅ Gallery images supported (multiple images per product, thumbnail generation)
> 4. ✅ Image dimension validation implemented (minimum 800x800px, configurable)
> 5. ✅ Automated cleanup for orphaned uploads implemented (scheduled + on-demand)
| T-704 | Frontend: Vendor dashboard | Onboarding form, product management | T-502, T-701, T-702 | Dashboard functional | ✅ completed |
| T-705 | Frontend: Product catalog (consumer) | Browse, search, filter, sort (CD-013 display ordering) | T-502, T-702 | Catalog works | ✅ completed_with_limitations |

> **Note on T-705:** The consumer product catalog was implemented with the following features:
> - Product listing page with pagination and infinite scroll
> - Category-based filtering and hierarchical navigation (CD-043)
> - Search integration with backend API (keyword + filters)
> - Sort options: relevance, price (asc/desc), newest, best-selling (CD-013 display ordering)
> - Responsive grid layout with product cards showing image, name, price, vendor
> - Product detail page with full information, images, and add-to-cart
> - Optimistic UI updates for cart interactions
> - Server-side rendering for SEO on catalog pages

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
| T-901 | Backend: Cart API (Redis) | Add, update, remove, get, merge guest (T-303) | T-303, T-602 | Cart persists across sessions | 🔴 blocked: Blocked by NFR-PERF-003 (Redis TTL) and Q-014 |
| T-902 | Backend: Checkout API | Create Order + Order_Vendor_Groups, validate stock (CD-021, CD-013) | T-109, T-106b, T-901 | Atomic order creation | ⏳ pending |
| T-903 | Backend: Order lifecycle API | Status transitions, vendor group mgmt (T-109) | T-109, T-602 | State machine enforced | ⏳ pending |
| T-904 | Frontend: Cart page | Quantity edit, remove, summary | T-502, T-901 | Cart UX complete | ⏳ pending |
| T-905 | Frontend: Checkout flow | Address, shipping, payment selection | T-502, T-902 | Checkout completes | ⏳ pending |
| T-906 | Frontend: Order history & tracking | Consumer + vendor views | T-502, T-903 | Tracking works | ⏳ pending |

---

## Phase 10: Implementation — Stage 6: Payments & Commissions (P4e)

| ID | Task | Description | Dependencies | Completion Criteria | Status |
|----|------|-------------|--------------|---------------------|--------|
| T-1001 | Backend: Payment integration | Provider SDK, webhook handling, idempotency (T-111) | T-111, T-112, T-602 | Test payments succeed | 🔴 blocked: Blocked by Stripe test validation (MP-07 Stage D) |
| T-1002 | Backend: Split payment / commission calc | Per Order_Vendor_Group, wallet credits (CD-029, T-110) | T-110, T-112, T-1001 | Commissions accurate | 🔴 blocked: Blocked by Stripe test validation (MP-07 Stage D) |
| T-1003 | Backend: Vendor payout flow | Manual/automatic, min threshold, records | T-110, T-1002 | Payouts processed | 🔴 blocked: Blocked by Stripe test validation (MP-07 Stage D) |
| T-1004 | Backend: Refund API | Initiate, approve, process, commission reversal (T-113) | T-113, T-1002 | Refunds work E2E | 🔴 blocked: Blocked by Stripe test validation (MP-07 Stage D) |
| T-1005 | Frontend: Payment UI | Provider checkout, success/failure handling | T-502, T-1001 | Payment UX complete | 🔴 blocked: Blocked by Stripe test validation (MP-07 Stage D) |
| T-1006 | Frontend: Vendor wallet & payouts | Balance, transactions, payout request | T-502, T-1003 | Vendor sees earnings | 🔴 blocked: Blocked by Stripe test validation (MP-07 Stage D) |

---

## Phase 11: Implementation — Stage 7: Reviews, Coupons, Invoices, Admin (P4f)

| ID | Task | Description | Dependencies | Completion Criteria | Status |
|----|------|-------------|--------------|---------------------|--------|
| T-1101 | Backend: Review API | Create (verified purchase CD-017, eligibility DELIVERED CD-072), moderate, list | T-117, T-903 | Reviews on products | 🔴 blocked: Blocked by Q-018 (3 decisions) and T-117 |
| T-1102 | Backend: Coupon API | CRUD, validation, application at checkout (T-116) | T-116, T-902 | Coupons work | 🔴 blocked: Blocked by Q-018 (3 decisions) and T-117 |
| T-1103 | Backend: PDF invoice generation | PDF receipt on-demand (MVP), template, S3 Standard-IA storage, link on Order (CD-035..CD-038, T-304). Glacier/WORM/trigger automation deferred pending Q-018 human decision. | T-118, T-304 | Invoices generated | 🔴 blocked: Blocked by Q-018 (3 decisions) and T-117 |
| T-1104 | Backend: Admin dashboard API | Aggregations, metrics, vendor/user mgmt (T-119) | T-119, T-602 | Admin data available | 🔴 blocked: Blocked by Q-018 (3 decisions) and T-117 |
| T-1105 | Frontend: Review UI | Write, read, rate, photos | T-502, T-1101 | Reviews visible | 🔴 blocked: Blocked by Q-018 (3 decisions) and T-117 |
| T-1106 | Frontend: Coupon UI | Apply at checkout, vendor create | T-502, T-1102 | Coupon flow works | 🔴 blocked: Blocked by Q-018 (3 decisions) and T-117 |
| T-1107 | Frontend: Admin dashboard | Charts, tables, actions | T-502, T-1104 | Dashboard functional | 🔴 blocked: Blocked by Q-018 (3 decisions) and T-117 |

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

## Dependency Graph Summary (Updated Post MP-02)

```
P0 (T-001..T-007) 
    → P1 (T-103..T-125)  [10 tasks covered by decisions; 24 remaining]
        → P2 (T-201..T-204) 
            → P3a (T-301..T-306) 
            → P3b (T-401..T-405)  [5 covered_by_decision (T-401..T-405); 0 remaining]
            → P3c (T-501..T-506)  [6 covered_by_decision (T-501..T-506); 0 remaining]
                → P4a (T-601..T-604) 
                    → P4b (T-701..T-705) 
                        → P4c (T-801..T-803)
                        → P4d (T-901..T-906)
                            → P4e (T-1001..T-1006)
                                → P4f (T-1101..T-1107)
                                    → P5 (T-1201..T-1209)
```

**Critical Path:** P0 → P1 (24 business decisions) → P2 → P3a/b/c → P4a → P4b → P4d → P4e → P4f → P5

**Parallelizable after P3c:** P4b, P4c can run in parallel; P4d depends on P4b; P4e depends on P4d; P4f depends on P4d+P4e

**Key Changes from MP-01:**
- 21 P1 tasks now **covered_by_decision** (T-101, T-102, T-103, T-104, T-105, T-106, T-106b, T-107, T-108, T-109, T-110, T-111, T-112, T-113, T-114, T-118, T-119, T-120, T-121, T-123, T-124)
- Remaining P1: 6 PENDING + 6 PARTIALLY_RESOLVED = 12 active tasks
- Technical decisions (MongoDB, Redis, ES, S3, frontend state, deploy, testing) correctly placed in P3a/P3b/P3c; **API style (T-401), versioning (T-405), and endpoints (T-402) resolved in P3b**
- Vendor onboarding (T-105) covered — Stage 3 unblocked
- Product variants (T-106b) resolved: no variants in MVP
- State machines (T-109) resolved: minimal states defined
- Payment provider (T-111) and split flow (T-112) covered — unblocks Stage 6
- T-103/T-104 (Auth, Address) covered — unblocks Stage 2 (Auth) and Stage 5 (Checkout)
- **OpenAPI specification created at `F01/docs/api/openapi.yaml` (3694 lines, 33 paths, 59 schemas)**
- **P3c architecture complete** — 6 architecture docs created in `F01/docs/architecture/` covering backend, frontend, infrastructure, CI/CD, observability, security

---

## Timeline Risk Assessment (19/11/2026 Deadline — 14 Days from 19/10/2026)

| Risk | Impact | Mitigation |
|------|--------|------------|
| 5 PENDING + 6 PARTIALLY_RESOLVED business decisions in P1 | High — each needs responsible approval | Batch related questions per MP; prioritize critical path (T-117, T-122) |
| Review moderation (T-117) open | Blocks Stage 7 | Define in MP-07 Stage C |
| Currency (T-122) open | Blocks payment/financial specs | Define in MP-08 |

**Recommended MP Sequence (Condensed):**
1. **MP-04:** ~~Core identity & admin auth~~ (DONE — T-103, T-104 covered)
2. **MP-05:** ~~Product variants (T-106b), Order/Payment/Vendor_Group state machines (T-109)~~ (DONE — CD-062, CD-063)
3. **MP-06:** ~~Payment provider integration (T-111), Split payment flow (T-112)~~ (DONE — CD-064, CD-065)
4. **MP-07 Stage A:** Elasticsearch strategy (T-115) — **DONE**
5. **MP-07 Stage B:** Coupon consistency check (T-116) — **DONE (covered_by_decision)**
6. **MP-07 Stage C:** Review moderation (T-117) — **IN PROGRESS**
7. **MP-07 Stage D:** Stripe Connect test mode validation — **PENDING**
8. **MP-08:** Currency (T-122), Invoice generation (T-118), Conceptual model finalization (T-125, T-126)
9. **MP-09+:** Requirements, data models, API, architecture, implementation...

---

## Immediate Next Action

**T-703b:** Backend Image upload to S3 — depends on T-703a (completed), AWS credentials, Q-018 decision (3 human decisions: Glacier transition, Object Lock/WORM, generation trigger).

**T-703a limitations:** All 5 documented limitations have been addressed and validated:
1. ✅ Docker volume persistence validated across container restarts
2. ✅ OpenAPI spec aligned with implementation
3. ✅ Gallery images supported (multiple images per product)
4. ✅ Image dimension validation (minimum 800x800px)
5. ✅ Automated orphan cleanup (scheduled + on-demand)

**MP-07 Stage C:** Review moderation (T-117) — IN PROGRESS, needs human decision on 7 sub-questions.

**MP-07 Stage D:** Stripe Connect test mode validation — validates Stage 6 (Payments).

**Next available independent tasks:**
- T-901 Cart API (blocked by NFR-PERF-003 / Q-014 Redis TTL)

All P5 tasks remain blocked (MAX_AUTHORIZED_PHASE = 4).