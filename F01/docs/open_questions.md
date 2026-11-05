# Open Questions & Pending Decisions — FS-01 Marketplace

## Format
Each entry: **ID** — What needs definition | Why it matters | Dependencies | Known alternatives | Resolution criteria | **State**

## State Legend
- **RESOLVED** — Business rule fully defined
- **PARTIALLY_RESOLVED** — Part defined; remainder specified
- **PENDING** — Awaits business decision
- **TECHNICAL_FUTURE** — Conceptual rule defined; implementation choice deferred
- **VALIDATE_REQUIREMENT** — Verify if statement actually requires this
- **OUT_OF_SCOPE** — Explicitly excluded from project scope by user decision

---

## Q-001: Person Entity Concreteness
**What:** Is `Person` a concrete persistable entity (single collection) or abstract base with separate collections per role?  
**Why:** Determines MongoDB schema design, query patterns, and inheritance strategy  
**Dependencies:** CD-001, CD-002, CD-003, CD-005  
**Alternatives:**  
- Single `users` collection with `role` field + optional role-specific subdocuments  
- Separate `consumers`, `vendors`, `admins` collections with shared `people` base  
- Embedded role documents in single collection  
**Resolution:** Explicit decision recorded in decisions.md with justification  
**State:** **TECHNICAL_FUTURE** — Conceptual decision confirmed (CD-001..CD-004): Person is common abstraction; Consumer/Vendor simultaneous; Admin exclusive; Role only for Admin. Persistence strategy (CD-005) explicitly deferred.

---

## Q-002: CPF/CNPJ Validation & Mutual Exclusivity
**What:** Validation rules for CPF (individual) vs CNPJ (company); can a Person have both?  
**Why:** Brazilian tax compliance; vendor may be individual (CPF) or company (CNPJ); consumer always CPF  
**Dependencies:** CD-006, CD-007  
**Alternatives:**  
- Mutually exclusive: Consumer=CPF only, Vendor=CPF or CNPJ (not both)  
- Both allowed, validated per role at use time  
- Separate fields `cpf` and `cnpj` with conditional required  
**Resolution:** Decision with validation rules documented  
**State:** **PARTIALLY_RESOLVED** — Mutual exclusivity confirmed (CD-007: exactly one of CPF or CNPJ, never both). Technical validation rules (format, check digits, conditional required per role) remain TECHNICAL_FUTURE.

---

## Q-003: Role & Permission Model Completeness
**What:** Are two permission levels (Read, Read/Write) sufficient? Resource-level permissions needed? What is the Consumer/Vendor permission model?  
**Why:** Admin dashboard, vendor self-service, consumer features need different access granularity  
**Dependencies:** CD-004, CD-010, CD-039, CD-059  
**Alternatives:**  
- Extend PermissionENUM to per-resource actions (product:create, order:read, etc.)  
- Policy-based (Casbin/OPA) instead of enum  
- Keep simple enum, add resource scoping via middleware  
**Resolution:** Approved permission matrix covering all planned features  
**State:** **PARTIALLY_RESOLVED** — Scope confirmed (CD-004: Role only for Admin; Consumer/Vendor authorization separate). Ownership isolation confirmed (CD-039: Admin manages platform, Vendor manages own store/products/orders, Consumer manages own account/cart/orders). **Consumer/Vendor authorization model confirmed (CD-059): ownership-based isolation, no generic RBAC.** Admin permission matrix sufficiency needs evaluation against requirements; 2-level PermissionENUM retained for MVP (not confirmed as sufficient).

---

## Q-004: Address & Contact Completeness
**What:** Address fields, contact fields, cardinality, and checkout address semantics  
**Why:** Checkout needs shipping/billing selection; notifications need verified primary contact; historical orders must preserve purchase-time data  
**Dependencies:** CD-008, CD-040, CD-057, CD-061, Stage 3 (vendor registration), Stage 5 (checkout)  
**Alternatives:**  
- Add fields to existing entities  
- Separate ShippingAddress/BillingAddress value objects  
- Embed in Order/Order_Vendor_Group as snapshots  
**Resolution:** Complete attribute list with validation rules per entity  
**State:** **PARTIALLY_RESOLVED** — Address fields confirmed (CD-040: Street, Number, Neighborhood, City, State — NO CEP, country, complement, address type). Contact fields confirmed (CD-040: Type, Value, Is_Primary — NO Verified). Cardinality confirmed: Person 1:N Address, Person 1:N Contact_Info (CD-008). Login email handling confirmed: email in Contact_Info.Value with Type=email; Is_Primary is primary contact, not login indicator; login contact protected from deletion while used for auth (CD-057). **Checkout address snapshot semantics confirmed (CD-061): primary address default at checkout, Consumer may choose any registered address, immutable snapshot copied to Order using CD-040 fields, subsequent Address changes do not affect existing Orders.** Email uniqueness constraint for login and identification of which Contact_Info is used for login resolved (CD-060). Allowed contact types and validation rules for `Contact_Info.Value` (e.g., phone, WhatsApp, email) remain PENDING.

---

## Q-005: Vendor Onboarding & Approval Workflow
**What:** How does a Person become a Vendor? What are the status states and abuse handling?  
**Why:** Stage 3 requires vendor registration; trust/safety requires abuse handling  
**Dependencies:** CD-001, CD-002, CD-007, CD-041, Stage 2 (auth), Stage 3 (vendor CRUD)  
**Alternatives:**  
- Auto-approve on registration (MVP), suspension for abuse later  
- KYC integration (document upload, manual review)  
- Pending → Active → Suspended state machine  
**Resolution:** State diagram + required fields/document checklist approved  
**State:** **RESOLVED** — Auto-publish confirmed (CD-041: Vendors may publish immediately after registration; no prior Admin approval required; suspension for abuse remains possible).

---

## Q-006: Product Inventory & Variants
**What:** Stock quantity, reservation, variants/SKUs (size, color), backorder policy  
**Why:** Stage 3 (product CRUD), Stage 5 (checkout stock validation), concurrency control  
**Dependencies:** CD-013, CD-014, CD-062  
**Alternatives:**  
- Simple `stock_quantity` on Product (no variants)  
- Product + Variant (SKU) with separate stock  
- Inventory service with reservation (optimistic locking)  
**Resolution:** Inventory model decided; concurrency strategy documented  
**State:** **PARTIALLY_RESOLVED** — Product.Quantity confirmed as current stock (CD-013); display ordering by stock confirmed. No separate Inventory entity (CD-014). **Variants excluded from MVP (CD-062): each product variation is a separate Product.** Reservations, backorder, concurrency control remain PENDING (TECHNICAL_FUTURE).

---

## Q-007: Product Status Lifecycle
**What:** Product states (draft, active, inactive, archived, pending_review) and transitions; hard deletion rules  
**Why:** Vendor manages catalog; admin moderation; search index sync; historical records must be preserved  
**Dependencies:** CD-015, CD-042, Stage 3, Stage 4 (Elasticsearch sync)  
**Alternatives:**  
- Simple active/inactive  
- Draft → Pending Review → Active → Archived  
- Admin can force any transition  
**Resolution:** State machine diagram approved  
**State:** **RESOLVED** — Inactivation confirmed (CD-042: Products can be inactivated to prevent new sales while retaining historical records; hard deletion permitted only when safe and historical references not compromised).

---

## Q-008: Category Hierarchy Limits
**What:** Max depth, required vs optional, attribute inheritance, filter specs per category  
**Why:** Stage 4 (faceted search/filtering), Product creation UX  
**Dependencies:** CD-015, CD-043  
**Alternatives:**  
- Flat categories (depth 1) for MVP  
- Unlimited depth with path enumeration  
- Fixed 3-level (Department → Category → Subcategory)  
**Resolution:** Depth limit and filter attribute strategy approved  
**State:** **RESOLVED** — Hierarchy rules confirmed (CD-043: Optional self-reference via parent_id; root = no parent; many children, at most one parent; multilevel supported; cycle prevention required). Depth not limited conceptually. Filter specs and attribute inheritance remain PENDING.

---

## Q-009: Order Status State Machine
**What:** Complete status values and allowed transitions for Order, Payment, and Order_Vendor_Group (fulfillment)  
**Why:** Stage 5 (order lifecycle), Stage 6 (payment → fulfillment), Stage 7 (refunds)  
**Dependencies:** CD-021, CD-022, CD-025, CD-044, CD-058, CD-063  
**Alternatives:**  
- Order: pending → paid → processing → shipped → delivered / cancelled → refunded  
- Vendor Group: pending → confirmed → preparing → shipped → delivered / cancelled → refunded  
- Event-sourced vs state-field  
**Resolution:** Three independent state machines (Order + Payment + Vendor Group) with transitions approved  
**State:** **PARTIALLY_RESOLVED** — Structure confirmed (CD-044: Overall Order status, Payment status, and fulfillment status are separate concerns. Each Vendor's portion fulfilled independently. Payment confirmation permits Vendor processing. Financial distribution separate from Order lifecycle. Order may exist before Payment. Failed/abandoned payment does not erase Order). **Aggregate financial status dimension confirmed (CD-058): mutually exclusive precedence FULLY_REFUNDED → PARTIALLY_REFUNDED → PAID, derived from Order_Vendor_Group refund states. Separate from lifecycle state machine.** **Minimal states and transitions for all three machines confirmed (CD-063): Order (7 states), Payment (5 states), Order_Vendor_Group (7 states). Cross-machine consistency rules defined. CANCELLED and VOIDED are unconfirmed proposals for lifecycle, not attributed to CD-024/CD-028. VOIDED not used in MVP. Retry logic, timeouts, webhook correlation remain TECHNICAL_FUTURE.**

---

## Q-010: Commission Calculation Rules
**What:** Fixed %? Tiered by volume? Per-category? Per-vendor negotiation? Platform fee + payment gateway fee split?  
**Why:** Stage 6 (payments & commissions), Wallet/Transaction accuracy, Vendor payouts  
**Dependencies:** CD-029, CD-030, CD-031, CD-045  
**Alternatives:**  
- Single global % (e.g., 10%) for MVP  
- Per-vendor configurable %  
- Category-based % matrix  
- Tiered: volume brackets  
**Resolution:** Commission rule specification with examples approved  
**State:** **RESOLVED** — Global commission percentage confirmed (CD-045: One configurable global commission percentage applies to all Vendors; calculated per Vendor and deducted before remittance; refunds require commission adjustments; Vendor-specific and category-specific rates not in scope; OCP applied pragmatically).

---

## Q-011: Payment Provider Selection
**What:** Payment provider integration details; provider abstraction; fallback strategy; Stripe Connect test mode validation  
**Why:** Stage 6 implementation; affects API, webhooks, split payment flow, payouts  
**Dependencies:** Stage 6, Wallet/Transaction model, compliance (Brazil), CD-064  
**Alternatives:**  
- Stripe Connect (Separate Charges and Transfers) — **confirmed for MVP**
- Provider abstraction layer for future changes
**Resolution:** Provider integration verified with test credentials; abstraction layer implemented  
**State:** **PARTIALLY_RESOLVED** — **Stripe Connect with Separate Charges and Transfers confirmed (CD-064)**. Razorpay discarded (Route INR-only, RBI blockers). **Exact Stripe fees, onboarding flow, and test mode validation documented in `F01/docs/analysis/analysis_stripe_validation.md`.** Provider flow mechanics confirmed via Stripe documentation. Test mode validation items (commission accuracy, webhook sequence, transfer reversal, idempotency) require execution with test credentials.

---

## Q-012: Split Payment Flow Design
**What:** Precise split-payment, transfer, and payout flow given provider constraints; webhook correlation; idempotency; async payment handling  
**Why:** UX, compliance, fee structure, implementation complexity, Stripe Connect test mode validation  
**Dependencies:** CD-064, CD-065, CD-047, CD-021, CD-028, CD-030, CD-031  
**Alternatives:**  
- Single charge + provider transfers (Stripe Connect Separate Charges and Transfers) — **confirmed for MVP**
- Single charge + manual/vendor-initiated payouts (if provider lacks split)  
- Platform collects all, batch payouts later (escrow model)
**Resolution:** Flow diagram with provider-specific steps approved  
**State:** **PARTIALLY_RESOLVED** — **Separate Charges and Transfers flow confirmed (CD-065)**: single Charge per Order, one Transfer per OVG, commission per CD-045, manual Transfer reversal on refunds. Payment confirmation (charge.succeeded) triggers Order PAID and OVG PENDING; Vendor fulfillment starts on Vendor confirmation (not Transfer completion). **Exact fees, onboarding, webhook correlation, idempotency, and async payment handling documented in `F01/docs/analysis/analysis_stripe_validation.md`.** Detailed flow mechanics confirmed via Stripe documentation (docs.stripe.com/connect/separate-charges-and-transfers). Test mode elements (idempotency, webhook sequence, transfer reversal) require execution with test credentials.

---

## Q-013: Refund & Dispute Flow
**What:** Who initiates (consumer, vendor, admin)? Full vs partial? Automatic on cancellation? Approval workflow? Provider interaction and ledger adjustments  
**Why:** Stage 6-7, Refund entity design, Transaction_History/Refund_History  
**Dependencies:** CD-025, CD-029, CD-032, CD-048  
**Alternatives:**  
- Consumer requests → Vendor approves → Admin mediates disputes  
- Automatic full refund on cancellation before shipping  
- Partial refund for returns with restocking fee  
**Resolution:** End-to-end refund flow with states and actors approved  
**State:** **RESOLVED** — Refund policy confirmed (CD-048: Partial and full refunds by item/quantity supported. Payment/refund states independent of Order status. Marketplace initiates customer refunds through provider using original payment. No internal customer wallet. Internal financial adjustments to marketplace and Vendor ledgers including negative Vendor balances/debt. Provider cannot be assumed to always debit/recover from Vendor. `sent` state = request sent, not money returned. Original receipt and history preserved. Idempotency prevents duplicates. Commission recalculated/adjustted consistently with refunds).

---

## Q-014: Cart Model & Redis Strategy
**What:** Cart structure (per-consumer, persistent vs session), Redis keys/TTL, sync with DB, guest cart merge  
**Why:** Stage 5 explicit requirement (Redis for cart + session cache)  
**Dependencies:** CD-018, CD-019, Stage 2 (auth), Stage 5 (checkout)  
**Alternatives:** 
- Redis hash per user: `cart:{userId}` with TTL 30d
- Separate `cart_items` in MongoDB + Redis cache
- Guest cart in localStorage → merge on login
**Resolution:** Redis strategy analyzed and documented: hash per authenticated consumer, isolated anonymous guest cart IDs, multi-vendor items, atomic operations, and guest-to-consumer merge. The current cart implementation uses a configurable 30-day TTL as the existing P3a proposal/default. Cart/session TTL approval remains pending NFR-PERF-003.  
**State:** **PARTIALLY_RESOLVED** — The pending TTL decision does not block implementing or testing the cart contract using the current configurable proposal. Do not describe 30 days as an approved business decision. Session timeout and final cart retention remain unapproved.

---

## Q-015: Elasticsearch Index & Search Strategy
**What:** Index mapping, analyzers, filter facets, sorting fields, sync strategy (real-time vs batch)  
**Why:** Stage 4 explicit requirement  
**Dependencies:** CD-011, CD-015, CD-017, CD-049  
**Alternatives:**  
- Single `products` index with denormalized vendor/category paths (recommended)  
- Separate indices per entity type  
- MongoDB Atlas Search instead of separate Elasticsearch (prohibited by CD-049)  
**Resolution:** Index mapping + sync mechanism + query DSL examples approved  
**State:** **PARTIALLY_RESOLVED** — ES confirmed as search engine (CD-049). **Conceptual scope resolved:** Single `products` index with denormalized `category_path` for descendant filtering; Portuguese stemmer analyzer; dual-write sync + periodic full reindex for rebuildability. Mapping, analyzers, synchronization mechanisms remain TECHNICAL_FUTURE for implementation phase (T-302, T-801, T-802). See `F01/docs/analysis/analysis_es_strategy.md` for detailed analysis.

---

## Q-016: Coupon Inclusion/Exclusion & Stacking Rules
**What:** Inclusion/exclusion lists targeting products/categories; category descendant behavior; exclusion precedence; mixed-cart discount calculation; coupon stacking and priority  
**Why:** Stage 7 (coupons), Order_Vendor_Group has single Coupon ref  
**Dependencies:** CD-026, CD-027, CD-050  
**Alternatives:**  
- One coupon per vendor group (current diagram)  
- Multiple with stacking rules (category first, then cart total)  
- Platform-wide + vendor-specific, non-stacking  
**Resolution:** Coupon application algorithm with precedence rules approved  
**State:** **PARTIALLY_RESOLVED** — Inclusion/exclusion rules confirmed (CD-050: Inclusion lists target products/categories; including category includes descendants; exclusion lists target products/categories; excluding category excludes descendants; exclusions override inclusions). **Coupon stacking and priority rules resolved (CD-050/MP-07E): no stacking (max one coupon per vendor per purchase); no automatic priority; consumer selects eligible coupon per vendor.** Mixed-cart discount calculation remains PENDING.

---

## Q-017: Review Moderation & Display
**What:** Pre-moderation vs post-moderation? Vendor response? Verified purchase badge? Rating aggregation method? Review eligibility state? Review images?  
**Why:** Stage 7 (reviews), Product rating display, trust signals  
**Dependencies:** CD-017, CD-023  
**Alternatives:**  
- Post-moderation (publish immediately, admin can hide) — recommended  
- Pre-moderation (admin approves before publish)  
- Verified purchase state: PAID vs DELIVERED vs CONFIRMED  
- Vendor response: single response / none / threaded  
- Badge: explicit "Verified Purchase" indicator / none (implicit)  
- Aggregation: simple mean / Bayesian / time-weighted  
- Images: owned (user-uploaded) / shared (product images) / both  
**Resolution:** All seven decisions approved (MP-08)  
**State:** **RESOLVED** — Verified purchase requirement confirmed (CD-017). **All seven decisions resolved (MP-08):** (1) Moderation policy → **Post-moderation** (CD-067); (2) Vendor response → **Not permitted** (CD-068); (3) Verified purchase badge → **Not displayed** (CD-069); (4) Rating scale → **1-5 stars** (CD-070); (5) Aggregation method → **Simple arithmetic mean** (CD-070); (6) Verified purchase qualifying state → **DELIVERED** (CD-072); (7) Review images → **Owned images permitted** (CD-071). See `F01/docs/analysis/analysis_review_moderation.md` for detailed analysis and recommendations.

---

## Q-018: PDF Invoice Generation
**What:** Template design, generation timing (on payment? on delivery?), storage (S3? DB?), regulatory requirements (NF-e Brazil?)  
**Why:** Stage 7 deliverable  
**Dependencies:** CD-035, CD-036, CD-037, CD-038  
**Alternatives:**  
- Simple PDF receipt (non-fiscal) for MVP  
- NF-e integration via provider (complex)  
- Generate on-demand, store in S3, link in Order  
**Resolution:**  
- Scope: **RESOLVED** — Commercial receipt (PDF), not NF-e (CD-035)  
- Generation trigger: **DEFERRED** — On-demand for MVP; automation (on payment/delivery/scheduled) post-MVP  
- Storage: **RESOLVED** — S3 Standard-IA with naming convention (analysis_s3_naming.md Section 6)  
- Glacier transition (90 days): **PENDING HUMAN DECISION** — applies to invoice retention only; does not block product-image storage.
- Object Lock/WORM (10 years): **PENDING HUMAN DECISION** — applies to invoice retention only; does not block product-image storage.
- Generation trigger automation: **PENDING HUMAN DECISION** — blocks only automated invoice generation; on-demand generation is the MVP behavior.
- NF-e: **EXCLUDED** per CD-035  
**State:** **PARTIALLY_RESOLVED** — Scope confirmed (CD-035: commercial receipt, not NF-e). Uses historical Order values (CD-036). Partial refund doesn't rewrite invoice (CD-037). Invoice has Order+Emission_At; Invoice_History empty intentionally (CD-038). MVP generation is on-demand with S3 Standard-IA storage. Glacier/WORM decisions affect invoice retention only; trigger automation remains deferred. These decisions do not block unrelated review, coupon, or admin-dashboard work.

---

## Q-019: Vendor Dashboard Metrics
**What:** Vendor-scoped metrics: order count, gross sales before commission, pending/completed orders, best-selling products; data isolation  
**Why:** Stage 7 deliverable  
**Dependencies:** CD-021, CD-028, CD-030, CD-051  
**Alternatives:**  
- Pre-aggregated MongoDB views + simple charts  
- Separate analytics DB (ClickHouse, TimescaleDB)  
- Real-time via Redis counters + periodic rollup  
**Resolution:** Metric definitions + data source + refresh cadence approved  
**State:** **RESOLVED** — Vendor dashboard scope confirmed (CD-051: Dashboard for Vendor only, not platform-wide Admin analytics. Metrics: order count, gross sales before commission, pending/completed orders, best-selling products. Vendors must not access other Vendors' data. Net payouts later. Gross sales labeled clearly as before marketplace commission).

---

## Q-020: Marketplace Scope — Single Instance Confirmed
**What:** Confirmation that the project represents a single marketplace (not multi-tenant SaaS)  
**Why:** Affects data isolation, Wallet design, Admin scoping, deployment  
**Dependencies:** CD-030, CD-038  
**Alternatives:**  
- Single marketplace (confirmed)  
- Multi-tenant with `marketplace_id` on all entities (explicitly out of scope)  
**Resolution:** Single marketplace scope confirmed by user decision  
**State:** **RESOLVED** — User confirmed: "O marketplace deste projeto será único. O requisito de multitenancy pertence a outro projeto e não deve ser importado para este."

---

## Q-021: Historical Records and Deletion Policy
**What:** Inactivation for referenced entities; hard delete when safe; order snapshot attributes; LGPD workstream scope  
**Why:** Data retention, referential integrity, audit requirements  
**Dependencies:** CD-033, CD-052  
**Alternatives:**  
- `deleted_at` timestamp on all entities  
- Archive collections with TTL  
- Hard delete only for non-referenced entities  
**Resolution:** Policy per entity type documented  
**State:** **RESOLVED** — Deletion policy confirmed (CD-052: Inactivate records referenced by historical transactions; hard-delete only when safe; order snapshots must preserve purchase-time product name, price, quantity, Vendor identity; retain Order and transaction history; dedicated LGPD workstream out of scope — does not remove ordinary security requirements).

---

## Q-022: API Design Style
**What:** REST (OpenAPI), GraphQL, tRPC, or hybrid? Versioning strategy?  
**Why:** Stage 1 deliverable (API list), frontend-backend contract  
**Dependencies:** Frontend tech (React), Stage 2-7 implementation  
**Alternatives:**  
- REST with OpenAPI 3.0 spec (traditional, cacheable)  
- GraphQL (flexible for dashboard)  
- tRPC (end-to-end type safety)  
- REST for public, GraphQL for admin  
**Resolution:** API style + spec tooling + versioning policy approved  
**State:** **RESOLVED** — REST with OpenAPI 3.0 confirmed; URL path versioning (/api/v1/...); JSON request/response; RFC 7807 Problem Details for errors. OpenAPI spec to be created in T-402.

---

## Q-023: Frontend State Management
**What:** React Query/TanStack Query, Redux Toolkit, Context + hooks, Zustand? Server state vs client state?  
**Why:** Stage 2-7 frontend implementation consistency  
**Dependencies:** API style, auth flow, cart (Redis sync)  
**Alternatives:** 
- TanStack Query for server state + Context for auth/cart
- Redux Toolkit for all state
- Zustand for client + React Query for server
**Resolution:** Frontend state management decision confirmed: TanStack Query (v5) for server state + Zustand (v5) for client state + React Router (v7) for URL state. Decision recorded as CD-074 in decisions.md.  
**State:** **PARTIALLY_RESOLVED** — Architecture decision formalized (CD-074); TanStack Query (React Query) not yet installed in F01/front package.json; implementation deferred to P4.

---

## Q-024: Deployment Architecture
**What:** Separate frontend/backend deploy (per Stage 7)? Container vs serverless? CI/CD? Environments (dev/staging/prod)?  
**Why:** Stage 7 deliverable, operational readiness  
**Dependencies:** All stages, infrastructure decisions  
**Alternatives:**  
- Vercel (frontend) + Railway/Render/AWS (backend)  
- Docker Compose on single VM (dev) → Kubernetes (prod)  
- Serverless functions (Vercel/Netlify + AWS Lambda)  
**Resolution:** Deployment target + CI/CD pipeline + environment strategy approved  
**State:** **TECHNICAL_FUTURE** — Stage 7 deliverable; implementation choice deferred.

---

## Q-025: LGPD / Data Privacy Compliance (OUT OF SCOPE)
**What:** Data subject rights (access, deletion, portability), consent management, data processing records, DPO  
**Why:** Brazilian law compliance; affects all personal data entities  
**Dependencies:** CD-006, CD-008, CD-033  
**Alternatives:**  
- Implement deletion/anonymization endpoints per entity  
- Consent flags per processing purpose  
- Data export (JSON) on request  
**Resolution:** Explicitly out of scope for this internship per user decision  
**State:** **OUT_OF_SCOPE** — User confirmed: "Não desenvolver uma frente de trabalho sobre LGPD neste estágio." CD-033 (histories append-only) supports audit but full LGPD compliance not required.

---

## Q-026: Currency & Localization
**What:** Transaction currency; interface language confirmed as English; no FX service without confirmed requirement  
**Why:** Payment, Price, Wallet, Transaction all involve money  
**Dependencies:** CD-013, CD-030, CD-031, CD-054  
**Alternatives:**  
- BRL only, English interface (MVP)  
- Multi-currency with exchange rate service  
- i18n framework from start  
**Resolution:** Currency decided as BRL for MVP scope. English interface confirmed (CD-054). Do not add a currency conversion or FX service without a confirmed requirement. Preserve the payment-provider/currency compatibility validation required by Q-011 and Q-012 (Stripe Connect supports BRL in Brazil).  
**State:** **RESOLVED** — Transaction currency defined as BRL for MVP. English interface confirmed (CD-054). Stripe Connect Separate Charges and Transfers confirmed with BRL currency (CD-064). No FX service or multi-currency in MVP.

---

## Q-027: Notification & Event System
**What:** MVP uses manual Refresh/Update button; automatic notifications, push, WebSockets, event-driven infrastructure deferred  
**Why:** Order status changes, payment events, review notifications, admin alerts  
**Dependencies:** CD-022, CD-025, CD-017, CD-055  
**Alternatives:**  
- Direct email calls in services (simple)  
- Event bus (RabbitMQ, Kafka, Redis Streams) + notification workers  
- Third-party (SendGrid, OneSignal) with webhook callbacks  
**Resolution:** Event catalog + delivery channels + retry policy approved  
**State:** **RESOLVED** — Manual refresh MVP confirmed (CD-055: The MVP uses a manual Refresh/Update button. Automatic notifications, push notifications, WebSockets, and event-driven notification infrastructure are not required for the MVP. They may be considered later if time permits).

---

## Q-028: Testing Strategy & Coverage Targets
**What:** Three-layer TDD with Vitest (unit), Supertest (API/integration), Playwright (E2E); payment test scenarios  
**Why:** Deliverable: "test results and metrics"  
**Dependencies:** All implementation stages, CD-056  
**Alternatives:**  
- Unit (services) + Integration (API) + E2E (critical paths)  
- Focus on integration over unit for domain logic  
- Contract tests for payment provider  
**Resolution:** Test pyramid definition + tools + CI integration approved  
**State:** **RESOLVED** — Testing strategy confirmed (CD-056: Three testing layers all using TDD: 1. Unit tests: Vitest. 2. API/integration tests: Supertest. 3. End-to-end complete flows: Playwright. Apply RED → GREEN → REFACTOR at all three layers. Do not confuse the three testing layers with the three TDD cycle steps. Detailed configuration, CI integration, and coverage targets remain technical decisions. Do not invent a minimum coverage percentage. Payment tests must use provider test mode and cover success, failure, repeated events, idempotency, and prevention of duplicate financial operations where applicable).

---

## Q-029: Credential, Login Email, and Authentication Integrity
**What:** Credential cardinality, login email uniqueness, login contact identification, and credential management rules  
**Why:** Credential is now a confirmed concept (CD-057) associated with Person; login uses email from Contact_Info; integrity rules needed for authentication flow  
**Dependencies:** CD-008, CD-009, CD-040, CD-057, CD-060, Q-004, Stage 2 (auth)  
**Alternatives:**  
- Credential 1:1 with Person (single credential per person)  
- Credential 1:N with Person (multiple credentials: password, MFA, recovery)  
- Email uniqueness: global vs per-marketplace (single marketplace confirmed)  
- Login contact identification: implicit via email lookup vs explicit flag  
**Resolution:** Pendências catalogadas: cardinalidade de Credential (1:1 ou 1:N), unicidade do e-mail de login, identificação inequívoca da Person via e-mail, e regras de gestão de credencial. Nenhuma tem resolução de negócio confirmada.  
**State:** **PARTIALLY_RESOLVED** — Credential concept confirmed (CD-057). **Credential cardinality resolved (CD-060): 1:1 (single credential per Person). Email uniqueness for login resolved (CD-060): globally unique. Login contact identification remains implicit via email lookup (CD-057 step 2), no `Is_Login` flag added. Credential status values, MFA support, recovery/reset flow remain TECHNICAL_FUTURE. Policy for changing/removing login email while protecting auth integrity not defined.

---

## Q-030: Order Comment Rules — editing, moderation, quantity per order
**What:** The Consumer may submit exactly one comment per order when the order status is `delivered`. After submission, the comment becomes immutable (cannot be edited, replaced, or a new comment sent for the same order). Moderation rules are deferred to a future decision.
**Why:** T-1108 (Backend Order Comment API) depends on this decision. Decision recorded per MP-AFIRDD-A-02-DECISION-01 (user approval).
**Dependencies:** T-1108
**Alternatives:**
- Editable vs immutable after submission
- Post-moderation vs pre-moderation vs none
- One comment per order vs multiple
**Resolution:** One comment per order, immutable after submission. Moderation deferred to future decision. T-1108 may proceed with these rules.
**State:** **PARTIALLY_RESOLVED** — One comment per order, immutable after submission. Moderation deferred to future decision. T-1108 may proceed with these rules. Moderation rules remain deferred (separate from Q-031).

---

## Q-031: T-1110 Eligible-Order-Flow Design Decision
**What:** Consumer may submit a Product Review only when the associated order has reached `DELIVERED`. The review must be associated with a product included in that delivered order. The backend must validate order ownership and delivery status. Reviews must remain linked to verified purchases. Product Reviews must be submitted through the Orders flow, not through a direct submission form on the Product Detail page.
**Why:** User approved decision per MP-AFIRDD-A-02-DECISION-02. Governing reference: CD-072 (verified purchase qualifying state = DELIVERED).
**Dependencies:** T-1101, CD-072 (verified purchase qualifying state = DELIVERED)
**Alternatives:**
- Reviews only eligible after order status `DELIVERED` (decided)
- Reviews eligible after order status `PAID` or `CONFIRMED`
- Reviews eligible for any completed order regardless of status
- Maintain direct product-page submission with no order-flow restriction
**Resolution:** Eligibility: Product Reviews only eligible after order status `DELIVERED` (per CD-072). Reviews submitted via Orders flow, not direct product page submission. Backend validates order ownership and delivery status. Reviews linked to verified purchases. Design decision recorded per MP-AFIRDD-A-02-DECISION-02 (user approval).
**State:** **RESOLVED** — Eligibility: Product Reviews only eligible after order status `DELIVERED` (per CD-072). Reviews submitted via Orders flow, not direct product page submission. Backend validates order ownership and delivery status. Reviews linked to verified purchases. Design decision recorded per MP-AFIRDD-A-02-DECISION-02 (user approval).
