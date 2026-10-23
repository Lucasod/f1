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

**Status after MP-06:** 65 conceptual decisions confirmed (CD-001..CD-065). 28 questions reclassified: 12 RESOLVED (Q-005, Q-006, Q-007, Q-008, Q-010, Q-013, Q-019, Q-020, Q-021, Q-027, Q-028), 6 PARTIALLY_RESOLVED (Q-003, Q-004, Q-009, Q-011, Q-012, Q-016), 6 PENDING (Q-001, Q-002, Q-014, Q-015, Q-017, Q-018), 3 TECHNICAL_FUTURE (Q-001, Q-022, Q-023, Q-024), 1 OUT_OF_SCOPE (Q-025). Q-029 is PARTIALLY_RESOLVED.

**Remaining conceptual work:** Resolve 6 PENDING + 6 PARTIALLY_RESOLVED (business rule gaps).

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
| T-115 | Resolve Q-015 Elasticsearch strategy | CD-049: ES confirmed as search engine; MongoDB source of truth; indexes rebuildable; Atlas Search prohibited. Need mapping, analyzers, sync mechanism | T-106b, T-108 | Index mapping + sync mechanism approved | ⏳ pending |
| T-116 | **COVERED** Coupon targeting and stacking rules | CD-050 confirmed: Inclusion/exclusion rules (category descendants, exclusions override). Stacking prohibited (max 1 coupon/vendor/purchase); no priority; consumer selects coupon per vendor. Mixed-cart discount = PENDING (T-902) | T-007 | — | ✅ covered_by_decision |
| T-117 | Resolve Q-017 Review moderation/display | CD-017 confirmed verified purchase. Need moderation policy, vendor response, badge, aggregation | T-107 | Moderation policy + display rules approved | ⏳ pending |
| T-118 | **COVERED** Invoice scope | CD-035..CD-038 confirmed: commercial receipt (not NF-e), historical values, no rewrite on refund, minimal attributes. Generation/storage = TECHNICAL_FUTURE (T-304, T-1103) | T-007 | — | ✅ covered_by_decision |
| T-119 | **COVERED** Vendor dashboard metrics | CD-051 confirmed: Vendor-scoped only (order count, gross sales pre-commission, pending/completed orders, best-selling products); cross-vendor access prohibited; gross sales labeled pre-commission | T-007 | — | ✅ covered_by_decision |
| T-120 | **COVERED** Marketplace scope | Single marketplace confirmed (Q-020); multi-tenancy out of scope | T-007 | — | ✅ covered_by_decision |
| T-121 | **COVERED** Historical records and deletion policy | CD-052 confirmed: inactivation for referenced entities; hard-delete when safe; order snapshots preserve product name/price/quantity/vendor; Order/transaction history retained; LGPD workstream out of scope | T-007 | — | ✅ covered_by_decision |
| T-122 | Resolve Q-026 Transaction currency | CD-054: English interface confirmed; currency unresolved; FX service prohibited without decision; provider/currency validation retained | T-007 | Currency scope decision | ⏳ pending |
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
| T-203 | Define acceptance criteria per FR | Testable conditions for each story | T-201 | AC documented per FR | ⏳ pending |
| T-204 | Responsible review requirements | Sign-off on FR/NFR/AC | T-201..T-203 | Explicit approval | ⏳ pending |

---

## Phase 3: Logical & Physical Data Models (P3a)

**Note:** Several tasks previously in P1 are now TECHNICAL_FUTURE and move here.

| ID | Task | Description | Dependencies | Completion Criteria | Status |
|----|------|-------------|--------------|---------------------|--------|
| T-301 | Design MongoDB collections | Map concepts → collections, embedding vs refs (CD-005: deferred from conceptual) | T-125 | Collection schemas with indexes | ⏳ pending |
| T-302 | Design Elasticsearch mappings | Index settings, analyzers, mappings | T-115, T-301 | ES index definitions | ⏳ pending |
| T-303 | Design Redis schemas | Cart, session, cache keys, TTLs (Q-014 TECHNICAL_FUTURE) | T-125 | Redis key patterns + data structures | ⏳ pending |
| T-304 | Define S3 object naming | Product images, invoices, uploads (Q-018 TECHNICAL_FUTURE) | T-118 | Naming convention + folder structure | ⏳ pending |
| T-305 | Data integrity rules | Unique constraints, referential integrity, validation | T-301 | Rules documented per collection | ⏳ pending |
| T-306 | Migration/seed strategy | Initial data, versioning approach | T-301 | Migration plan documented | ⏳ pending |

---

## Phase 4: API Specification (P3b)

| ID | Task | Description | Dependencies | Completion Criteria | Status |
|----|------|-------------|--------------|---------------------|--------|
| T-401 | Choose API style | REST/GraphQL/tRPC decision (Q-022 TECHNICAL_FUTURE) | T-204 | Decision recorded | ⏳ pending |
| T-402 | Define API endpoints | Resource-oriented or operation-oriented | T-401, T-201 | Endpoint list with methods, paths | ⏳ pending |
| T-403 | Specify request/response schemas | DTOs, validation, error formats | T-402, T-301 | OpenAPI/GraphQL schema files | ⏳ pending |
| T-404 | Define auth & RBAC on endpoints | JWT claims, permission checks (CD-004, CD-010) | T-103, T-402 | Auth matrix per endpoint | ⏳ pending |
| T-405 | API versioning & deprecation policy | URL vs header, lifecycle | T-401 | Policy documented | ⏳ pending |

---

## Phase 5: Technical Architecture (P3c)

| ID | Task | Description | Dependencies | Completion Criteria | Status |
|----|------|-------------|--------------|---------------------|--------|
| T-501 | Backend architecture | Layered/clean/hexagonal, module boundaries | T-301, T-402 | Architecture diagram + module map | ⏳ pending |
| T-502 | Frontend architecture | Component structure, state, routing (Q-023 TECHNICAL_FUTURE) | T-401 | Architecture diagram + folder structure | ⏳ pending |
| T-503 | Infrastructure architecture | AWS services, networking, secrets, monitoring | T-401, T-501 | Infrastructure diagram + IaC plan | ⏳ pending |
| T-504 | CI/CD pipeline design | Build, test, deploy stages per env | T-503 | Pipeline diagram + tool choices | ⏳ pending |
| T-505 | Observability design | Logging, metrics, tracing, alerting | T-503 | Observability stack decided | ⏳ pending |
| T-506 | Security hardening plan | TLS, headers, rate limits, secrets | T-503 | Security checklist | ⏳ pending |

---

## Phase 6: Implementation — Stage 2: Auth & RBAC (P4a)

| ID | Task | Description | Dependencies | Completion Criteria | Status |
|----|------|-------------|--------------|---------------------|--------|
| T-601 | Backend: User registration/login | JWT issue/refresh, password hash (CD-010) | T-403, T-501 | API works, tests pass | ⏳ pending |
| T-602 | Backend: Role guards & permission middleware | Protect routes per permission matrix (CD-004: Admin only; Consumer/Vendor separate) | T-601, T-103 | All endpoints guarded | ⏳ pending |
| T-603 | Frontend: Auth pages & context | Login, register, protected routes | T-502, T-601 | Auth flow works E2E | ⏳ pending |
| T-604 | Frontend: Role-based UI rendering | Hide/show per permissions (Admin vs Consumer vs Vendor) | T-603 | UI respects roles | ⏳ pending |

---

## Phase 7: Implementation — Stage 3: Vendor, Product, Images (P4b)

| ID | Task | Description | Dependencies | Completion Criteria | Status |
|----|------|-------------|--------------|---------------------|--------|
| T-701 | Backend: Vendor onboarding API | Registration, approval workflow (T-105) | T-105, T-602 | API + status machine works | ⏳ pending |
| T-702 | Backend: Product CRUD API | Create, read, update, delete, list (CD-013: Quantity; T-106b: variants) | T-106b, T-107, T-602 | API + validation works | ⏳ pending |
| T-703 | Backend: Image upload to S3 | Presigned URLs, multipart, validation (T-304) | T-304, T-602 | Upload works, CDN served | ⏳ pending |
| T-704 | Frontend: Vendor dashboard | Onboarding form, product management | T-502, T-701, T-702 | Dashboard functional | ⏳ pending |
| T-705 | Frontend: Product catalog (consumer) | Browse, search, filter, sort (CD-013 display ordering) | T-502, T-702 | Catalog works | ⏳ pending |

---

## Phase 8: Implementation — Stage 4: Elasticsearch Search (P4c)

| ID | Task | Description | Dependencies | Completion Criteria | Status |
|----|--------|-------------|--------------|---------------------|--------|
| T-801 | Backend: ES index sync | Real-time or batch sync from MongoDB (T-115) | T-302, T-702 | Search index current | ⏳ pending |
| T-802 | Backend: Search API | Query DSL, facets, pagination, sorting (T-115) | T-302, T-403 | API returns ranked results | ⏳ pending |
| T-803 | Frontend: Search UI | Autocomplete, filters, sort, results grid | T-502, T-802 | Search UX complete | ⏳ pending |

---

## Phase 9: Implementation — Stage 5: Cart, Checkout, Orders (P4d)

| ID | Task | Description | Dependencies | Completion Criteria | Status |
|----|------|-------------|--------------|---------------------|--------|
| T-901 | Backend: Cart API (Redis) | Add, update, remove, get, merge guest (T-303) | T-303, T-602 | Cart persists across sessions | ⏳ pending |
| T-902 | Backend: Checkout API | Create Order + Order_Vendor_Groups, validate stock (CD-021, CD-013) | T-109, T-106b, T-901 | Atomic order creation | ⏳ pending |
| T-903 | Backend: Order lifecycle API | Status transitions, vendor group mgmt (T-109) | T-109, T-602 | State machine enforced | ⏳ pending |
| T-904 | Frontend: Cart page | Quantity edit, remove, summary | T-502, T-901 | Cart UX complete | ⏳ pending |
| T-905 | Frontend: Checkout flow | Address, shipping, payment selection | T-502, T-902 | Checkout completes | ⏳ pending |
| T-906 | Frontend: Order history & tracking | Consumer + vendor views | T-502, T-903 | Tracking works | ⏳ pending |

---

## Phase 10: Implementation — Stage 6: Payments & Commissions (P4e)

| ID | Task | Description | Dependencies | Completion Criteria | Status |
|----|------|-------------|--------------|---------------------|--------|
| T-1001 | Backend: Payment integration | Provider SDK, webhook handling, idempotency (T-111) | T-111, T-112, T-602 | Test payments succeed | ⏳ pending |
| T-1002 | Backend: Split payment / commission calc | Per Order_Vendor_Group, wallet credits (CD-029, T-110) | T-110, T-112, T-1001 | Commissions accurate | ⏳ pending |
| T-1003 | Backend: Vendor payout flow | Manual/automatic, min threshold, records | T-110, T-1002 | Payouts processed | ⏳ pending |
| T-1004 | Backend: Refund API | Initiate, approve, process, commission reversal (T-113) | T-113, T-1002 | Refunds work E2E | ⏳ pending |
| T-1005 | Frontend: Payment UI | Provider checkout, success/failure handling | T-502, T-1001 | Payment UX complete | ⏳ pending |
| T-1006 | Frontend: Vendor wallet & payouts | Balance, transactions, payout request | T-502, T-1003 | Vendor sees earnings | ⏳ pending |

---

## Phase 11: Implementation — Stage 7: Reviews, Coupons, Invoices, Admin (P4f)

| ID | Task | Description | Dependencies | Completion Criteria | Status |
|----|------|-------------|--------------|---------------------|--------|
| T-1101 | Backend: Review API | Create (verified purchase CD-017), moderate, list (T-117) | T-117, T-903 | Reviews on products | ⏳ pending |
| T-1102 | Backend: Coupon API | CRUD, validation, application at checkout (T-116) | T-116, T-902 | Coupons work | ⏳ pending |
| T-1103 | Backend: PDF invoice generation | Template, trigger, S3 storage, link on Order (CD-035..CD-038, T-304) | T-118, T-304 | Invoices generated | ⏳ pending |
| T-1104 | Backend: Admin dashboard API | Aggregations, metrics, vendor/user mgmt (T-119) | T-119, T-602 | Admin data available | ⏳ pending |
| T-1105 | Frontend: Review UI | Write, read, rate, photos | T-502, T-1101 | Reviews visible | ⏳ pending |
| T-1106 | Frontend: Coupon UI | Apply at checkout, vendor create | T-502, T-1102 | Coupon flow works | ⏳ pending |
| T-1107 | Frontend: Admin dashboard | Charts, tables, actions | T-502, T-1104 | Dashboard functional | ⏳ pending |

---

## Phase 12: Testing, Deploy, Demo, Presentation (P5)

| ID | Task | Description | Dependencies | Completion Criteria | Status |
|----|------|-------------|--------------|---------------------|--------|
| T-1201 | Integration test suite | API contract, cross-service flows | T-601..T-1107 | CI passes | ⏳ pending |
| T-1202 | E2E test suite | Critical user journeys | T-601..T-1107 | Playwright/Cypress passes | ⏳ pending |
| T-1203 | Performance/load test | Search, checkout, payment latency | T-802, T-902, T-1001 | Metrics meet NFR | ⏳ pending |
| T-1204 | Deploy frontend (prod) | Separate deploy per Stage 7 | T-504, T-502 | Live URL accessible | ⏳ pending |
| T-1205 | Deploy backend (prod) | Separate deploy per Stage 7 | T-504, T-501 | API live, healthy | ⏳ pending |
| T-1206 | Record/create demo | Functional walkthrough | T-1204, T-1205 | Video or live demo ready | ⏳ pending |
| T-1207 | Prepare final presentation | 10-min slides + talking points | All prior | Presentation file ready | ⏳ pending |
| T-1208 | Write individual reflection | Learning & contribution document | All prior | Reflection submitted | ⏳ pending |
| T-1209 | Final repo cleanup | README, setup instructions, commit hygiene | All prior | Repo meets deliverable std | ⏳ pending |

---

## Dependency Graph Summary (Updated Post MP-02)

```
P0 (T-001..T-007) 
    → P1 (T-103..T-125)  [10 tasks covered by decisions; 24 remaining]
        → P2 (T-201..T-204) 
            → P3a (T-301..T-306) 
            → P3b (T-401..T-405) 
            → P3c (T-501..T-506)
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
- Technical decisions (MongoDB, Redis, ES, S3, API style, frontend state, deploy, testing) correctly placed in P3a/P3b/P3c
- Vendor onboarding (T-105) covered — Stage 3 unblocked
- Product variants (T-106b) resolved: no variants in MVP
- State machines (T-109) resolved: minimal states defined
- Payment provider (T-111) and split flow (T-112) covered — unblocks Stage 6
- T-103/T-104 (Auth, Address) covered — unblocks Stage 2 (Auth) and Stage 5 (Checkout)

---

## Timeline Risk Assessment (19/11/2026 Deadline — 14 Days from 19/10/2026)

| Risk | Impact | Mitigation |
|------|--------|------------|
| 6 PENDING + 6 PARTIALLY_RESOLVED business decisions in P1 | High — each needs responsible approval | Batch related questions per MP; prioritize critical path (T-115, T-116, T-117) |
| Elasticsearch strategy (T-115) open | Blocks Stage 4 | Define mapping/sync in MP-07 |
| Coupon/Review/Invoice (T-116/117/118) open | Blocks Stage 7 | Batch in MP-07/08 |

**Recommended MP Sequence (Condensed):**
1. **MP-04:** ~~Core identity & admin auth~~ (DONE — T-103, T-104 covered)
2. **MP-05:** ~~Product variants (T-106b), Order/Payment/Vendor_Group state machines (T-109)~~ (DONE — CD-062, CD-063)
3. **MP-06:** ~~Payment provider integration (T-111), Split payment flow (T-112)~~ (DONE — CD-064, CD-065)
4. **MP-07:** Elasticsearch strategy (T-115), Coupon targeting/stacking (T-116), Review moderation (T-117), Stripe Connect test mode validation
5. **MP-08:** Currency (T-122), Invoice generation (T-118), Conceptual model finalization (T-125, T-126)
6. **MP-09+:** Requirements, data models, API, architecture, implementation...

---

## Immediate Next Action

**MP-07:** Elasticsearch strategy (T-115), Coupon targeting/stacking (T-116), Review moderation (T-117), Stripe Connect test mode validation — unblocks Stage 4 (Search), Stage 7 (Coupons/Reviews), and validates Stage 6 (Payments).