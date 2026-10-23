# Decisions Log — FS-01 Marketplace

## Decision Status Legend

- **Confirmed** — Explicitly approved by the responsible person (recorded in MP-02)
- **Inferred from diagram** — Present in conceptual-model.drawio but not explicitly confirmed
- **Pending confirmation** — Cannot be verified in available sources
- **Technical / Future (deferred impl)** — Conceptual rule defined; implementation choice deferred
- **Technical / Future (no conceptual rule)** — No conceptual rule defined at this level; purely physical/implementation concern

---

## Confirmed Conceptual Decisions (MP-02)

### CD-001: Person as Common Abstraction
**Status:** Confirmed (MP-02)  
**Subject:** User/role modeling approach  
**Decision:** `Person` is the common abstraction for `Admin`, `Consumer`, and `Vendor`  
**Justification:** Shared identity and contact information factored into base concept  
**Source:** MP-02 confirmed decisions #1  
**Consequences:** Role-specific behavior attached via specialization; not a persistence strategy

### CD-002: Person Can Be Consumer and Vendor Simultaneously
**Status:** Confirmed (MP-02)  
**Subject:** Role overlap  
**Decision:** A single `Person` may act as both `Consumer` and `Vendor` at the same time  
**Justification:** Real-world sellers also buy; avoids duplicate accounts  
**Source:** MP-02 confirmed decisions #2  
**Consequences:** No mutual exclusion between Consumer and Vendor specializations

### CD-003: Admin Is Mutually Exclusive
**Status:** Confirmed (MP-02)  
**Subject:** Role exclusivity  
**Decision:** A `Person` who is `Admin` cannot be `Consumer` or `Vendor`  
**Justification:** Separation of duties; platform operators distinct from marketplace participants  
**Source:** MP-02 confirmed decisions #3  
**Consequences:** Admin specialization disjoint from Consumer/Vendor

### CD-004: Role Entity Only for Admin Permissions
**Status:** Confirmed (MP-02)  
**Subject:** Authorization model scope  
**Decision:** `Role` exists exclusively to define permissions for `Admin`; it does not determine whether a Person is Admin, Consumer, or Vendor  
**Justification:** Consumer/Vendor are behavioral specializations of Person, not RBAC roles  
**Source:** MP-02 confirmed decisions #4  
**Consequences:** Role/PermissionENUM model applies only to Admin; Consumer/Vendor authorization handled differently

### CD-005: Persistence Strategy Deferred
**Status:** Technical / Future  
**Subject:** MongoDB collection design  
**Decision:** The choice between single collection, separate collections, embedded or referenced documents is not defined at the conceptual level  
**Justification:** Conceptual model ≠ physical schema; do not conflate  
**Source:** MP-02 confirmed decisions #5  
**Consequences:** D-014 remains Technical / Future

### CD-006: Person 1:1 Main_Info
**Status:** Confirmed (MP-02)  
**Subject:** Identity attribute grouping  
**Decision:** `Person` relates to `Main_Info` in a conceptual 1:1 relationship  
**Justification:** Core identity attributes (name, document) grouped separately  
**Source:** MP-02 confirmed decisions #6  
**Consequences:** Main_Info remains distinct concept; not merged into Person

### CD-007: CPF XOR CNPJ (Mutually Exclusive)
**Status:** Confirmed (MP-02)  
**Subject:** Identity document rule  
**Decision:** `Main_Info` contains `Name` and exactly one of `CPF` or `CNPJ` — one or the other, never both  
**Justification:** Brazilian tax identity: individual (CPF) or company (CNPJ), not both simultaneously  
**Source:** MP-02 confirmed decisions #7  
**Consequences:** Validation enforces mutual exclusivity; diagram showing both fields is incomplete/incorrect

### CD-008: Address and Contact_Info Related to Person
**Status:** Confirmed (MP-02)  
**Subject:** Contact/location modeling  
**Decision:** `Address` and `Contact_info` are concepts related to `Person`  
**Justification:** Multiple addresses/contacts per person; reuse across roles  
**Source:** MP-02 confirmed decisions #8; consistent with diagram inference D-004  
**Consequences:** 1:N from Person; specific attributes (type, primary, CEP) deferred

### CD-009: Authentication via Email/Password; Login Not Persisted Entity
**Status:** Confirmed (MP-02)  
**Subject:** Authentication modeling  
**Decision:** Access uses email and password; credentials may be represented conceptually but `Login` or `Authentication` are not presumed to be persisted entities  
**Justification:** Authentication is a process/service, not necessarily a domain entity  
**Source:** MP-02 confirmed decisions #9  
**Consequences:** No Login/Authentication entity in conceptual model

### CD-010: JWT + RBAC Required; Details Deferred
**Status:** Technical / Future  
**Subject:** Authentication/authorization implementation  
**Decision:** The internship statement requires JWT and role-based access control; implementation details, credential storage, and token lifecycle remain for the technical phase  
**Justification:** Separation of conceptual requirements from technical design  
**Source:** MP-02 confirmed decisions #10; consistent with official statement Stage 2  
**Consequences:** D-013 remains Technical / Future

### CD-011: Vendor Offers Product
**Status:** Confirmed (MP-02)  
**Subject:** Product ownership  
**Decision:** `Vendor` offers `Product`  
**Justification:** Core marketplace relationship  
**Source:** MP-02 confirmed decisions #11; consistent with diagram inference D-005  
**Consequences:** Product references Vendor (N:1)

### CD-012: No Separate Catalog Concept
**Status:** Confirmed (MP-02)  
**Subject:** Catalog modeling  
**Decision:** Do not create a separate `Catalog` concept for now; the catalog is understood as the list of products offered by vendors  
**Justification:** YAGNI — no additional behavior or attributes beyond product aggregation  
**Source:** MP-02 confirmed decisions #12  
**Consequences:** Catalog = derived view (Product where Vendor=X)

### CD-013: Product.Quantity = Current Stock
**Status:** Confirmed (MP-02)  
**Subject:** Inventory representation  
**Decision:** `Product.Quantity` represents the quantity in stock; in catalog display, products with quantity > 0 appear first; out-of-stock products appear after  
**Justification:** Simple stock indicator sufficient for MVP; display ordering by availability  
**Source:** MP-02 confirmed decisions #13  
**Consequences:** Quantity is a Product attribute; no separate Inventory entity

### CD-014: No Inventory Entity Without Business Need
**Status:** Confirmed (MP-02)  
**Subject:** Inventory separation  
**Decision:** Do not create an `Inventory` entity without a concrete business need justifying the separation  
**Justification:** YAGNI; Product.Quantity covers current requirement  
**Source:** MP-02 confirmed decisions #14  
**Consequences:** Reservation, variants, multi-location stock deferred

### CD-015: Category Admits Parent/Child Hierarchy
**Status:** Confirmed (MP-02)  
**Subject:** Category structure  
**Decision:** `Category` admits parent/child hierarchy  
**Justification:** Matches diagram self-reference; supports faceted navigation  
**Source:** MP-02 confirmed decisions #15; consistent with diagram inference D-005  
**Consequences:** Depth, required/optional, filter specs deferred (Q-008)

### CD-016: Images for Product and Review
**Status:** Confirmed (MP-02)  
**Subject:** Image association  
**Decision:** Images are provided for `Product` and `Review` in the current model  
**Justification:** Diagram shows Product_Pic linked to both Product and Review  
**Source:** MP-02 confirmed decisions #16; consistent with diagram  
**Consequences:** Product_Pic entity retained

### CD-017: Review Only by Verified Purchaser
**Status:** Confirmed (MP-02)  
**Subject:** Review authorization  
**Decision:** A review can only be made by someone who purchased the product  
**Justification:** Trust signal; prevents fake reviews  
**Source:** MP-02 confirmed decisions #17  
**Consequences:** Review creation requires link to completed Order_Item

### CD-018: Cart Not Persisted Conceptually
**Status:** Confirmed (MP-02)  
**Subject:** Cart modeling  
**Decision:** The cart may remain in session/Redis and does not need to be a persisted entity in the conceptual model  
**Justification:** Cart is ephemeral session state; Redis satisfies Stage 5 requirement  
**Source:** MP-02 confirmed decisions #18  
**Consequences:** No Cart/Cart_Item entities in conceptual model; Q-014 partially resolved

### CD-019: Cart Contains Multi-Vendor Products
**Status:** Confirmed (MP-02)  
**Subject:** Cart scope  
**Decision:** A cart can contain products from multiple vendors  
**Justification:** Unified shopping experience across vendors  
**Source:** MP-02 confirmed decisions #19  
**Consequences:** Checkout must split into Order_Vendor_Groups

### CD-020: Checkout Creates Order, Initiates Payment
**Status:** Confirmed (MP-02)  
**Subject:** Checkout flow  
**Decision:** At checkout, an `Order` is created and payment is initiated  
**Justification:** Order captures intent; payment follows  
**Source:** MP-02 confirmed decisions #20  
**Consequences:** Order exists before payment completion

### CD-021: Order / Order_Vendor_Group / Order_Item Decomposition
**Status:** Confirmed (MP-02)  
**Subject:** Multi-vendor order structure  
**Decision:** `Order` = complete purchase; `Order_Vendor_Group` = per-vendor portion; `Order_Item` = product + quantity within group  
**Justification:** Enables split fulfillment, per-vendor status, commission calculation  
**Source:** MP-02 confirmed decisions #21; consistent with diagram inference D-006  
**Consequences:** Three-level hierarchy confirmed

### CD-022: Vendor Updates Order_Vendor_Group Independently
**Status:** Confirmed (MP-02)  
**Subject:** Fulfillment autonomy  
**Decision:** Each vendor independently updates the fulfillment state of their `Order_Vendor_Group`  
**Justification:** Vendors manage their own shipping/fulfillment timeline  
**Source:** MP-02 confirmed decisions #22  
**Consequences:** Order_Vendor_Group.Status independent of Order.Status

### CD-023: Order_Item Keeps Historical Unit Price
**Status:** Confirmed (MP-02)  
**Subject:** Price snapshot  
**Decision:** `Order_Item` maintains the historical unit price of the purchase so future catalog changes do not modify past orders  
**Justification:** Audit integrity; price at time of purchase is immutable  
**Source:** MP-02 confirmed decisions #23  
**Consequences:** Order_Item.Price is a snapshot, not a reference to Product.Price

### CD-024: Order Persists Even If Payment Fails/Abandoned
**Status:** Confirmed (MP-02)  
**Subject:** Order lifecycle  
**Decision:** An `Order` can continue to exist even when payment fails or is abandoned; do not delete the history of attempts  
**Justification:** Audit trail; analytics; customer support context  
**Source:** MP-02 confirmed decisions #24  
**Consequences:** Order.Status includes failed/abandoned states; Payment attempts preserved. Payment flow details (retry logic, timeout, cancellation) remain open (Q-011, Q-012).

### CD-025: Payment State and Fulfillment State Are Distinct
**Status:** Confirmed (MP-02)  
**Subject:** State separation  
**Decision:** Payment state and fulfillment state are distinct concepts  
**Justification:** Payment can succeed while fulfillment pending; fulfillment can proceed while payment processing  
**Source:** MP-02 confirmed decisions #25  
**Consequences:** Two independent state machines (Order_Vendor_Group for fulfillment, Payment for payment)

### CD-026: Coupon and Coupon_Target Accepted as Concepts
**Status:** Confirmed (MP-02)  
**Subject:** Coupon modeling  
**Decision:** `Coupon` and `Coupon_Target` are accepted as concepts in the current model. Coupon has code, validity period, discount type and value, vendor, and applicable product/category lists  
**Justification:** Vendor-specific promotions with flexible targeting  
**Source:** MP-02 confirmed decisions #26; consistent with diagram inference D-010  
**Consequences:** Coupon applied at Order_Vendor_Group level

### CD-027: Plural Attributes Are Lists, Not Separate Concepts
**Status:** Confirmed (MP-02)  
**Subject:** List attribute interpretation  
**Decision:** Plural attributes such as `Product_List`, `Category_List`, and `Order_Vendor_Items` represent lists; they must not be automatically transformed into separate concepts  
**Justification:** Avoid over-modeling; lists are implementation details of the concept  
**Source:** MP-02 confirmed decisions #27  
**Consequences:** No Product_List, Category_List, Order_Vendor_Items entities

### CD-028: Multiple Payment Attempts Preserved
**Status:** Confirmed (MP-02)  
**Subject:** Payment retry modeling  
**Decision:** An `Order` can have multiple `Payment` attempts, including failed attempts which are preserved  
**Justification:** Audit trail; retry logic; customer support  
**Source:** MP-02 confirmed decisions #28  
**Consequences:** Payment.Status includes failed; Order.Payments is a list

### CD-029: Commission from Vendor-Marketplace Agreement
**Status:** Confirmed (MP-02)  
**Subject:** Commission modeling  
**Decision:** Commission derives from the agreement between `Vendor` and `Marketplace`; do not add a separate `Commission` concept without justifying a concrete need  
**Justification:** Commission is a calculated value (percentage of Order_Vendor_Group), not an independent entity  
**Source:** MP-02 confirmed decisions #29  
**Consequences:** Q-010 partially resolved (formula still open); no Commission entity

### CD-030: Wallet Shared by Vendor and Marketplace
**Status:** Confirmed (MP-02)  
**Subject:** Wallet concept  
**Decision:** `Wallet` is a concept shared by `Vendor` and `Marketplace`; balance derives from transactions; decide later whether recalculated or cached  
**Justification:** Both parties have financial ledgers; same concept, different instances  
**Source:** MP-02 confirmed decisions #30; consistent with diagram inference D-008/D-009  
**Consequences:** Balance derivation strategy deferred (Technical / Future)

### CD-031: Transaction = Generic Financial Movement
**Status:** Confirmed (MP-02)  
**Subject:** Transaction concept  
**Decision:** `Transaction` represents a generic record of financial movement  
**Justification:** Unified ledger entry for sales, commissions, refunds, payouts, adjustments  
**Source:** MP-02 confirmed decisions #31; consistent with diagram inference D-008  
**Consequences:** Transaction.Type distinguishes movement kinds

### CD-032: Partial Refund with Item Selection and Vendor Grouping
**Status:** Confirmed (MP-02)  
**Subject:** Refund modeling  
**Decision:** `Refund` can be partial; the consumer selects products and quantities to refund; the system groups items by vendor and generates corresponding transactions  
**Justification:** Granular returns; per-vendor financial settlement  
**Source:** MP-02 confirmed decisions #32  
**Consequences:** Refund references Order_Item/Order_Vendor_Group; generates Transactions per vendor

### CD-033: Histories Preserve Records (No Overwrite)
**Status:** Confirmed (MP-02)  
**Subject:** Audit trail principle  
**Decision:** Histories must preserve previous records without overwriting the past  
**Justification:** Immutable audit trail; regulatory compliance  
**Source:** MP-02 confirmed decisions #33; consistent with diagram history entities  
**Consequences:** All *_History entities are append-only

### CD-034: State Machines Deferred to Later Phase
**Status:** Technical / Future (deferred impl)  
**Subject:** State machine details  
**Decision:** Detailed states and transitions for Order, Order_Vendor_Group, Product, and Vendor will be defined in a later phase; current scope is conceptual structure only  
**Justification:** User explicitly confirmed deferral: "Os estados e as transições detalhadas ainda serão definidas"  
**Source:** MP-02 confirmed decisions #34  
**Consequences:** Q-007, Q-009 remain PENDING for state values/transitions; no state machine details in conceptual model

### CD-035: Invoice = Commercial Receipt (Not NF-e)
**Status:** Confirmed (MP-02)  
**Subject:** Invoice scope  
**Decision:** `Invoice` represents a commercial document/receipt in PDF, not a Brazilian fiscal invoice (NF-e)  
**Justification:** Stage 7 deliverable is PDF invoice; NF-e requires separate certification  
**Source:** MP-02 confirmed decisions #35  
**Consequences:** Q-018 partially resolved (scope defined; generation trigger/storage technical)

### CD-036: Invoice Uses Historical Order Values
**Status:** Confirmed (MP-02)  
**Subject:** Invoice data source  
**Decision:** Invoice is related to `Order` and must use the historical values of the order, not current catalog values  
**Justification:** Invoice reflects what was actually purchased at that time  
**Source:** MP-02 confirmed decisions #36  
**Consequences:** Invoice reads from Order/Order_Vendor_Group/Order_Item snapshots

### CD-037: Partial Refund Does Not Rewrite Original Invoice
**Status:** Confirmed (MP-02)  
**Subject:** Invoice immutability  
**Decision:** A partial refund does not rewrite the original invoice  
**Justification:** Invoice is a point-in-time record; refunds generate separate documents  
**Source:** MP-02 confirmed decisions #37  
**Consequences:** Original Invoice unchanged; refund documentation approach (credit notes, new invoices, etc.) remains open (Q-018 TECHNICAL_FUTURE).

### CD-038: Invoice Has Order + Emission_At; Invoice_History Empty for Now
**Status:** Confirmed (MP-02)  
**Subject:** Invoice attributes and history  
**Decision:** In the current diagram, `Invoice` contains `Order` and `Emission_At`; `Invoice_History` is intentionally empty at this moment. Do not automatically classify this as an error. Record the intent and leave generation, persistence, and history details for later discussion.  
**Justification:** Intentional minimal definition; history scope to be defined when generation process is designed  
**Source:** MP-02 confirmed decisions #38  
**Consequences:** Invoice_History retained as placeholder; details deferred

### CD-039: Ownership and Authorization Model
**Status:** Confirmed (MP-02)  
**Subject:** Ownership isolation and role responsibilities  
**Decision:** Admin manages the platform. Vendor manages their own store, products, and orders. Consumer manages their own account, cart, and orders. Strict ownership isolation is required between all roles.  
**Justification:** Clear separation of concerns; prevents cross-role data access  
**Source:** MP-02 confirmed decisions (Q-003)  
**Consequences:** Consumer/Vendor permission model must enforce ownership boundaries; Admin permission matrix still open

### CD-040: Address and Contact_Info Field Definitions
**Status:** Confirmed (MP-02)  
**Subject:** Address and contact attribute scope  
**Decision:** Address fields: `Street`, `Number`, `Neighborhood`, `City`, `State`. Do NOT add CEP, country, complement, or address type without a new decision. Contact fields: `Type`, `Value`, `Is_Primary`. Do NOT add `Verified` as an already-approved field. Historical order data must preserve the information needed to represent the original purchase. **Cardinality confirmed: Person 1:N Address, Person 1:N Contact_Info (CD-008). Checkout address snapshot semantics remain unresolved.**  
**Justification:** Explicit field scope prevents scope creep; historical preservation for audit  
**Source:** MP-02 confirmed decisions (Q-004)  
**Consequences:** CEP, country, complement, address type, and contact Verified are explicitly deferred; checkout address snapshot design open

### CD-041: Vendor Onboarding — Auto-Publish
**Status:** Confirmed (MP-02)  
**Subject:** Vendor registration and approval  
**Decision:** Vendors may publish immediately after registration. Prior Admin approval is not required. Suspension for abuse remains possible.  
**Justification:** Reduces friction for vendor onboarding; abuse handled reactively  
**Source:** MP-02 confirmed decisions (Q-005)  
**Consequences:** No approval workflow in MVP; suspension mechanism needed

### CD-042: Product Inactivation and Deletion
**Status:** Confirmed (MP-02)  
**Subject:** Product lifecycle — inactivation vs deletion  
**Decision:** Products can be inactivated to prevent new sales while retaining historical records. Hard deletion is permitted only when safe and when historical references are not compromised.  
**Justification:** Preserves order history and referential integrity; allows catalog management  
**Source:** MP-02 confirmed decisions (Q-007)  
**Consequences:** Inactive state added to Product; hard delete requires referential integrity check

### CD-043: Category Hierarchy Rules
**Status:** Confirmed (MP-02)  
**Subject:** Category self-reference and hierarchy constraints  
**Decision:** Category supports an optional self-reference through `parent_id`. A category without a parent is a root category. A category may have many children and at most one parent. Multilevel hierarchies are supported. Cycle prevention is an implementation requirement.  
**Justification:** Flexible categorization; prevents infinite recursion  
**Source:** MP-02 confirmed decisions (Q-008)  
**Consequences:** Cycle detection required in implementation; depth not limited conceptually

### CD-044: Order Lifecycle — Separate State Machines
**Status:** Confirmed (MP-02)  
**Subject:** Order, Payment, and Fulfillment state separation  
**Decision:** Overall Order status, Payment status, and shipping/fulfillment status are separate concerns. In a multi-vendor order, each Vendor's portion is fulfilled independently. Payment confirmation permits Vendors to begin processing. Financial distribution is separate from the Order lifecycle. An Order may exist before a Payment. Failed or abandoned payment does not erase the Order. Exact status values and transitions remain to be defined. Existing lifecycle terminology, including placed, packed, shipped, and delivered, must be reconciled without inventing a final state machine.  
**Justification:** Independent vendor operations; payment/fulfillment decoupling; audit preservation  
**Source:** MP-02 confirmed decisions (Q-009)  
**Consequences:** Three independent state machines (Order, Payment, Order_Vendor_Group); status value reconciliation needed

### CD-045: Commission — Global Percentage
**Status:** Confirmed (MP-02)  
**Subject:** Commission calculation and scope  
**Decision:** One configurable global commission percentage applies to all Vendors. Commission is calculated per Vendor and deducted before remittance. Refunds require corresponding commission adjustments. Vendor-specific and category-specific commission rates are not part of the confirmed scope. Apply OCP pragmatically; do not introduce unnecessary abstractions.  
**Justification:** Simplicity for MVP; configurability without over-engineering  
**Source:** MP-02 confirmed decisions (Q-010)  
**Consequences:** Single commission rate config; per-vendor calculation at Order_Vendor_Group; commission adjustment on refund

### CD-046: Payment Provider — Razorpay with Verification
**Status:** Confirmed (MP-02)  
**Subject:** Payment provider selection and constraints  
**Decision:** Razorpay was the initially selected provider. Use test mode during development. Keep a provider boundary that allows a future provider change. Do not claim that Razorpay supports the complete required payment and split-transfer flow until verified. USD and Razorpay Route compatibility remains a technical validation item. Available documentation indicates Route transfers are restricted to INR, although some Razorpay international payment products support USD. Verify the complete provider, currency, marketplace, and vendor-remittance requirements before finalizing the integration. Stripe Connect remains an alternative if necessary.  
**Justification:** Initial provider choice with explicit verification requirement; avoids vendor lock-in  
**Source:** MP-02 confirmed decisions (Q-011)  
**Consequences:** Provider abstraction required; Razorpay Route/USD validation blocker; Stripe Connect fallback

### CD-047: Payment and Vendor Distribution Flow
**Status:** Confirmed (MP-02)  
**Subject:** Payment confirmation and vendor remittance separation  
**Decision:** Customer payment is received and confirmed through the provider. A confirmed payment marks the Order as paid and allows Vendors to process their portions. Financial distribution to Vendors is separate from the Order lifecycle. The precise split-payment, transfer, and payout flow depends on verified provider compatibility. Do not represent Vendor remittance as automatically solved by selecting Razorpay.  
**Justification:** Decouples order fulfillment from financial settlement; provider-dependent implementation  
**Source:** MP-02 confirmed decisions (Q-012)  
**Consequences:** Payment confirmation triggers vendor processing; remittance flow pending provider verification

### CD-048: Refund Policy and Financial Adjustments
**Status:** Confirmed (MP-02)  
**Subject:** Refund scope, provider interaction, and ledger adjustments  
**Decision:** Support partial and full refunds, including refunds by item and quantity. Payment/refund states remain independent of the overall Order status. The marketplace initiates customer refunds through the payment provider using the original payment. Do not create an internal customer wallet for refunds. Internally track financial adjustments to the marketplace and Vendor ledgers, including negative Vendor balances or debt where applicable. Do not assume the provider can always debit or recover money from a Vendor. A `sent` refund state means the request was sent, not necessarily that the money was returned. Preserve the original commercial receipt and financial history. Use idempotency to prevent duplicate refunds and duplicate financial operations. Recalculate or adjust commission consistently with refunds.  
**Justification:** Provider-mediated refunds; internal ledger accuracy; audit preservation; idempotency for safety  
**Source:** MP-02 confirmed decisions (Q-013)  
**Consequences:** Refund via provider; negative vendor balance tracking; idempotency keys; commission recalculation; receipt preservation

### CD-049: Elasticsearch Search Architecture
**Status:** Confirmed (MP-02)  
**Subject:** Search implementation constraints  
**Decision:** Elasticsearch provides product search, filtering, and sorting. MongoDB remains the source of truth. Elasticsearch indexes must be rebuildable from authoritative data. Mapping, analyzers, and synchronization mechanisms remain technical decisions. Do not substitute MongoDB Atlas Search for Elasticsearch.  
**Justification:** Explicit technology choice; source-of-truth clarity; rebuildability for recovery  
**Source:** MP-02 confirmed decisions (Q-015)  
**Consequences:** ES sync mechanism required; Atlas Search prohibited; mapping/analyzer decisions deferred

### CD-050: Coupon Inclusion/Exclusion Rules
**Status:** Confirmed (MP-02)  
**Subject:** Coupon targeting semantics  
**Decision:** Inclusion lists can target products and categories. Including a category includes its descendants. Exclusion lists can target products and categories. Excluding a category excludes its descendants. Exclusions override inclusions. The discount calculation for mixed eligible/ineligible cart contents remains unresolved. Coupon stacking and priority rules remain unresolved.  
**Justification:** Clear targeting semantics; hierarchy awareness; exclusion precedence  
**Source:** MP-02 confirmed decisions (Q-016)  
**Consequences:** Category descendant inclusion/exclusion implemented; mixed-cart discount calculation open; stacking/priority open

### CD-051: Vendor Dashboard Scope
**Status:** Confirmed (MP-02)  
**Subject:** Vendor dashboard metrics and access control  
**Decision:** The dashboard is for the Vendor, not a platform-wide Admin analytics dashboard. Include basic own-store metrics: order count, gross sales before commission, pending/completed orders, and best-selling products. Vendors must not access other Vendors' data. Net payouts may be considered later. Label gross sales clearly as before marketplace commission.  
**Justification:** Vendor-centric view; data isolation; transparency on commission  
**Source:** MP-02 confirmed decisions (Q-019)  
**Consequences:** Vendor-scoped metrics only; gross sales labeled pre-commission; cross-vendor access prohibited

### CD-052: Historical Records and Deletion Policy
**Status:** Confirmed (MP-02)  
**Subject:** Soft delete, hard delete, and order snapshots  
**Decision:** Inactivate records that are referenced by historical transactions. Hard-delete only when safe. Order snapshots must preserve purchase-time product name, price, quantity, and Vendor identity as needed. Retain Order and transaction history. The dedicated LGPD workstream is out of scope; this does not remove ordinary security requirements.  
**Justification:** Referential integrity for historical data; snapshot fidelity; LGPD exclusion clarity  
**Source:** MP-02 confirmed decisions (Q-021)  
**Consequences:** Inactive state for referenced entities; order snapshot attributes defined; LGPD workstream excluded but security retained

### CD-053: Development Environment — Docker Compose Structure
**Status:** Confirmed (MP-02)  
**Subject:** Compose topology and deployment separation  
**Decision:** Each project has its own Dockerfile/configuration and can start independently. Root Docker Compose starts the complete environment. Backend Compose starts the backend and its required dependencies, including MongoDB, Elasticsearch, and Redis, unless an explicitly documented project arrangement separates them. Frontend Compose starts React independently. Frontend and backend are deployed separately as required by the assignment. Avoid port, network, and volume conflicts. Deployment provider and CI/CD details remain technical decisions.  
**Justification:** Independent service startup; clear dependency boundaries; deployment separation  
**Source:** MP-02 confirmed decisions (Q-024)  
**Consequences:** Three compose files (root, backend, frontend); backend owns infra dependencies; port/volume conflict avoidance

### CD-054: Currency and Localization — English Interface
**Status:** Confirmed (MP-02)  
**Subject:** Interface language and currency scope  
**Decision:** The interface language is English. The transaction currency is unresolved. Do not infer USD merely from the English interface. Do not add a currency conversion or FX service without a confirmed requirement. Preserve the payment-provider/currency compatibility validation required by Q-011 and Q-012.  
**Justification:** Explicit language decision; currency explicitly open; prevents assumptions  
**Source:** MP-02 confirmed decisions (Q-026)  
**Consequences:** English UI confirmed; currency open; FX service prohibited without decision; provider/currency validation retained

### CD-055: Notifications — Manual Refresh MVP
**Status:** Confirmed (MP-02)  
**Subject:** Notification infrastructure scope  
**Decision:** The MVP uses a manual Refresh/Update button. Automatic notifications, push notifications, WebSockets, and event-driven notification infrastructure are not required for the MVP. They may be considered later if time permits.  
**Justification:** MVP simplicity; deferral of real-time infrastructure  
**Source:** MP-02 confirmed decisions (Q-027)  
**Consequences:** No WebSocket/event bus in MVP; manual refresh UI; future enhancement possible

### CD-056: Testing Strategy — Three-Layer TDD
**Status:** Confirmed (MP-02)  
**Subject:** Testing tools, layers, and TDD application  
**Decision:** There are three testing layers, all using TDD: 1. Unit tests: Vitest. 2. API/integration tests: Supertest. 3. End-to-end complete flows: Playwright. Apply RED → GREEN → REFACTOR at all three layers. Do not confuse the three testing layers with the three TDD cycle steps. Detailed configuration, CI integration, and coverage targets remain technical decisions. Do not invent a minimum coverage percentage. Payment tests must use provider test mode and cover success, failure, repeated events, idempotency, and prevention of duplicate financial operations where applicable.  
**Justification:** Explicit tool choices; TDD at all layers; payment test rigor  
**Source:** MP-02 confirmed decisions (Q-028)  
**Consequences:** Vitest/Supertest/Playwright stack; TDD mandatory; payment test scenarios specified; coverage targets deferred

### CD-057: Credential and Authentication Flow
**Status:** Confirmed (MP-02)  
**Subject:** Access credential modeling and conceptual authentication flow  
**Decision:** `Credential` represents the access credential (e.g., password hash) and is associated with `Person`. Cardinality (1:1 or 1:N) is not yet defined. `Credential` does not store a second email and does not require a direct reference to `Contact_Info`. Login is performed by email; the email resides in `Contact_Info.Value` with `Type = email`. `Is_Primary` represents the primary contact for communication and does NOT automatically indicate which email is used for login. The `Contact_Info` record used for login must not be deleted while it is required for authentication. No `Purpose`, `Is_Login`, or similar attribute is added to `Contact_Info` solely to identify the login email. Email is not duplicated in `Person`, `Main_Info`, or `Credential`. The conceptual authentication flow is: (1) receive email and password; (2) locate `Contact_Info` matching the email (`Type = email`); (3) find the `Person` associated with that contact; (4) locate the `Credential` associated with that `Person`; (5) verify the credential and authenticate access if valid. `Login`/`Authentication` is not presumed to be a persisted entity solely because the authentication flow is represented conceptually.  
**Justification:** Separates authentication credentials from contact information; avoids email duplication; protects login contact from deletion; keeps conceptual flow explicit without mandating persistence strategy  
**Source:** MP-02 confirmed decisions (authentication approach)  
**Consequences:** Credential concept added; authentication flow documented; Credential cardinality deferred (Q-029); email uniqueness for login deferred (Q-029); login contact deletion protection established

### CD-058: Order Aggregate Financial Status — Derived Dimension with Mutual Exclusion
**Status:** Confirmed (MP-03 correction)  
**Subject:** Order financial status computation from Order_Vendor_Group refund states  
**Decision:** The `Order` aggregate financial status is a **derived/computed dimension** separate from the `Order` lifecycle state machine. It reflects the consolidated refund state across all `Order_Vendor_Group` instances. The status values and mutual exclusion precedence are:
1. **`FULLY_REFUNDED`** — ALL `Order_Vendor_Group` are in `FULLY_REFUNDED`
2. **`PARTIALLY_REFUNDED`** — At least one `Order_Vendor_Group` has a refund (partial or full), AND NOT all groups are `FULLY_REFUNDED`
3. **`PAID`** — A captured payment exists AND no refund has been initiated on any group AND the Order lifecycle has not advanced to a terminal state (e.g., delivered, cancelled)

These conditions are evaluated in precedence order (1 → 2 → 3), guaranteeing mutual exclusivity. `CANCELLED` and `VOIDED` remain unconfirmed proposals for the lifecycle state machine (not the financial status dimension) and are not attributed to CD-024 or CD-028.  
**Justification:** Resolves the overlap where PARTIALLY_REFUNDED and FULLY_REFUNDED could both be true when all groups are fully refunded; establishes clear separation between lifecycle state and financial aggregation  
**Source:** MP-03 final correction for T-004  
**Consequences:** Financial status is computed on-read or cached; two independent dimensions (lifecycle + financial); CANCELLED/VOIDED approval deferred to state machine definition (Q-009)

### CD-059: Consumer and Vendor Authorization — Ownership-Based Isolation
**Status:** Confirmed (MP-04)  
**Subject:** Authorization model for Consumer and Vendor roles  
**Decision:** Consumer and Vendor authorization is based exclusively on **ownership isolation** (CD-039). No generic RBAC framework is created for these roles in the MVP. Each protected operation validates that the requesting Person owns the target resource:
- **Consumer** may only access/manage their own account, cart, and orders.
- **Vendor** may only manage their own store, products, coupons, and Order_Vendor_Groups belonging to their store.
- Backend validates ownership on every protected operation (e.g., `resource.ownerPersonId === currentPersonId`).
- Cross-vendor data access is strictly prohibited.
- Admin remains subject to its own permission model (Role + PermissionENUM per CD-004).  
**Justification:** CD-039 mandates strict ownership isolation; a simple ownership check satisfies MVP requirements without speculative permission infrastructure; keeps Consumer/Vendor authorization separate from Admin RBAC per CD-004.  
**Source:** MP-04 consolidation for T-103/Q-003  
**Consequences:** Middleware-based ownership validation; no PermissionENUM for Consumer/Vendor; Admin dashboard permissions remain open (Q-003 partially resolved).

### CD-060: Credential Cardinality and Login Email Uniqueness
**Status:** Confirmed (MP-04)  
**Subject:** Credential–Person relationship and login email constraints  
**Decision:** 
- **Credential cardinality:** Each `Person` has exactly **one** `Credential` (1:1). A single password hash per person. MFA, recovery credentials, and multiple credentials per person are deferred (TECHNICAL_FUTURE).
- **Login email uniqueness:** The email used for login (Contact_Info with `Type = email`) is **globally unique** across the marketplace. The lookup flow in CD-057 (step 2: locate Contact_Info by email) assumes a single match.  
**Justification:** CD-057 confirms the authentication flow but deferred cardinality and uniqueness (Q-029). 1:1 is the simplest correct model for MVP; global uniqueness is required for the login flow to be deterministic; single marketplace (CD-020/Q-020) makes global = marketplace-wide.  
**Source:** MP-04 consolidation for Q-029  
**Consequences:** Credential cardinality resolved; email uniqueness resolved; MFA/recovery remain TECHNICAL_FUTURE; Contact_Info identification remains implicit via email lookup (CD-057 step 2); no `Is_Login` flag added.

### CD-061: Checkout Address Snapshot
**Status:** Confirmed (MP-04)  
**Subject:** Address preservation at order creation  
**Decision:** 
- A `Person` may have multiple `Address` records (1:N, CD-008). The first address registered becomes the primary by default; additional addresses do not automatically replace the primary.
- At checkout, the primary address is pre-selected; the Consumer may choose any of their registered addresses.
- If no address exists, the Consumer must register one before completing the purchase.
- Upon `Order` creation, the chosen address fields (`Street`, `Number`, `Neighborhood`, `City`, `State` per CD-040) are **copied as an immutable snapshot** into the Order.
- Subsequent changes to the Person's Address records **do not affect** existing Order snapshots.
- No new entity (ShippingAddress, BillingAddress) or additional fields are introduced.  
**Justification:** CD-040 explicitly requires historical order data preservation and leaves checkout snapshot semantics open. Snapshotting satisfies audit/historical requirements; reusing CD-040 fields avoids new entities; primary address default simplifies UX.  
**Source:** MP-04 consolidation for T-104/Q-004  
**Consequences:** Checkout snapshot semantics resolved; Address/Contact_Info field scope unchanged (CD-040); CEP, country, complement, address type remain deferred; Order now carries address snapshot (conceptual attribute).

### CD-062: Product Variants — Not in MVP
**Status:** Confirmed (MP-05)  
**Subject:** Product variant/SKU modeling  
**Decision:** The MVP **does not include product variants** as a separate entity or structure. Each distinct product variation (e.g., different color, size) is registered as an independent `Product` with its own `Price`, `Quantity` (stock), `Description`, and `Category`. There is no `ProductVariant` entity, no SKU hierarchy under a parent product, and no configurable attribute system.  
**Justification:** CD-013 confirms `Product.Quantity` = current stock; CD-014 confirms no separate Inventory entity. Adding variants would require new entities (Variant, SKU), reservation logic, and concurrency control — all deferred per Q-006. The MVP keeps one product = one stock unit.  
**Source:** MP-05 consolidation for T-106b/Q-006  
**Consequences:** Q-006 variant aspect RESOLVED (no variants). Reservations, backorder, and concurrency control remain PENDING (technical implementation). Product CRUD operates on flat product list.

### CD-063: Minimal State Machines — Order, Payment, Order_Vendor_Group
**Status:** Confirmed (MP-05)  
**Subject:** Minimal status values and transitions for the three independent state machines  
**Decision:** The following states and transitions are confirmed for MVP. Each machine is independent per CD-044. The aggregate financial status (CD-058) remains a derived dimension separate from lifecycle.

---

#### 1. Order Lifecycle State Machine
**States:** `PENDING_PAYMENT` → `PAID` → `PROCESSING` → `SHIPPED` → `DELIVERED`  
**Terminal states:** `CANCELLED` (allowed before `SHIPPED`), `FAILED_PAYMENT` (payment attempts exhausted)

| State | Meaning | Entry Event |
|-------|---------|-------------|
| `PENDING_PAYMENT` | Order created, awaiting payment | Checkout completed (CD-020) |
| `PAID` | Payment captured (at least one Payment = `CAPTURED`) | Payment webhook confirmed capture |
| `PROCESSING` | At least one Order_Vendor_Group = `CONFIRMED` | Vendor confirms their group |
| `SHIPPED` | All Order_Vendor_Groups = `SHIPPED` | All vendors mark shipped |
| `DELIVERED` | All Order_Vendor_Groups = `DELIVERED` | All vendors mark delivered |
| `CANCELLED` | Order cancelled before any group ships | Consumer/Admin request (allowed only if no group `SHIPPED`/`DELIVERED`) |
| `FAILED_PAYMENT` | All Payment attempts failed/expired | Payment provider final failure |

**Transitions:**  
`PENDING_PAYMENT` → `PAID` | `FAILED_PAYMENT`  
`PAID` → `PROCESSING` | `CANCELLED`  
`PROCESSING` → `SHIPPED`  
`SHIPPED` → `DELIVERED`  
`CANCELLED` / `FAILED_PAYMENT` / `DELIVERED` are terminal (no outgoing transitions)

---

#### 2. Payment State Machine
**States:** `PENDING` → `AUTHORIZED` → `CAPTURED`  
**Terminal states:** `FAILED`, `REFUNDED` (partial or full)

| State | Meaning | Entry Event |
|-------|---------|-------------|
| `PENDING` | Payment initiated, awaiting provider | Checkout / retry |
| `AUTHORIZED` | Provider authorized amount (not yet captured) | Provider webhook authorization |
| `CAPTURED` | Funds captured, money received | Provider webhook capture |
| `FAILED` | Provider declined or error | Provider webhook failure |
| `REFUNDED` | Refund processed (partial or full) | Refund confirmed by provider |

**Transitions:**  
`PENDING` → `AUTHORIZED` | `FAILED`  
`AUTHORIZED` → `CAPTURED` | `FAILED` (capture failed)  
`CAPTURED` → `REFUNDED`  
`FAILED` / `REFUNDED` are terminal

**Notes:** Multiple Payment attempts per Order preserved (CD-028). Only one Payment can be `CAPTURED` at a time for a given Order. `REFUNDED` maps to financial status via CD-058.

---

#### 3. Order_Vendor_Group (Fulfillment) State Machine
**States:** `PENDING` → `CONFIRMED` → `PREPARING` → `SHIPPED` → `DELIVERED`  
**Terminal states:** `CANCELLED` (vendor or admin), `RETURNED` (post-delivery return)

| State | Meaning | Entry Event |
|-------|---------|-------------|
| `PENDING` | Group created, awaiting vendor action | Order = `PAID` (CD-047) |
| `CONFIRMED` | Vendor accepted the order | Vendor confirms |
| `PREPARING` | Vendor preparing package | Vendor starts prep |
| `SHIPPED` | Package handed to carrier | Vendor marks shipped |
| `DELIVERED` | Package delivered to customer | Carrier confirmation / vendor marks delivered |
| `CANCELLED` | Vendor cancelled before `SHIPPED` | Vendor/Admin request |
| `RETURNED` | Customer returned after `DELIVERED` | Return processed (CD-032, CD-048) |

**Transitions:**  
`PENDING` → `CONFIRMED` | `CANCELLED`  
`CONFIRMED` → `PREPARING` | `CANCELLED`  
`PREPARING` → `SHIPPED` | `CANCELLED`  
`SHIPPED` → `DELIVERED` | `RETURNED`  
`DELIVERED` → `RETURNED`  
`CANCELLED` / `RETURNED` are terminal

---

#### Cross-Machine Consistency Rules
- **Order → Payment:** Order `PENDING_PAYMENT` requires at least one Payment `PENDING`/`AUTHORIZED`. Order `PAID` requires exactly one Payment `CAPTURED`.
- **Order → Order_Vendor_Group:** Order `PROCESSING` requires ≥1 OVG `CONFIRMED`. Order `SHIPPED` requires all OVG `SHIPPED`. Order `DELIVERED` requires all OVG `DELIVERED`.
- **Payment → Financial Status (CD-058):** Payment `CAPTURED` + no refunds → `PAID`. Any Refund `sent` → `PARTIALLY_REFUNDED` or `FULLY_REFUNDED` per CD-058 precedence.
- **Refunds:** Only allowed on `CAPTURED` payments (CD-048). Refund `sent` does not auto-cancel OVG (fulfillment independent per CD-025).
- **Cancellation:** Order `CANCELLED` only if no OVG `SHIPPED`/`DELIVERED`. OVG `CANCELLED` only before `SHIPPED`.
- **CANCELLED/VOIDED:** Remain unconfirmed proposals for lifecycle (per CD-058). `VOIDED` not used in MVP.

**Justification:** Minimal states cover all required MVP flows (checkout → payment → fulfillment → delivery, with cancellation and refund). Each machine has clear entry events. Separation of payment/fulfillment/order per CD-025/CD-044. CD-058 financial status kept separate. Failed payments preserved (CD-028). Partial/full refunds supported (CD-032, CD-048). Multi-vendor independence (CD-022, CD-044).

**Source:** MP-05 consolidation for T-109/Q-009  
**Consequences:** Three state machines defined with minimal states. Transitions documented for essential flows. Terminology reconciliation: `placed` = `PENDING_PAYMENT`, `packed` = `PREPARING`, `shipped`/`delivered` mapped. `CANCELLED` retained as lifecycle terminal; `VOIDED` not used. Remaining open: retry logic, timeout values, webhook correlation (TECHNICAL_FUTURE).

### CD-064: Payment Provider — Stripe Connect (Separate Charges and Transfers)
**Status:** Confirmed (MP-06-R4)  
**Subject:** Payment provider selection and split-flow for multi-vendor orders  
**Decision:** Stripe Connect using **Separate Charges and Transfers** charge type.  
- Single Charge on platform account per Order (amount = order_total, currency = BRL, capture = true)  
- One Transfer per Order_Vendor_Group to vendor's connected account  
- **Commission (CD-045)**: Global percentage applied per OVG; `vendor_net = ovg_total × (1 - commission_pct/100)`; platform retains commission as revenue  
- **Stripe fees**: Payment processing fee on Charge (platform operational cost); Transfer fees per pricing model (0.25% of payout volume if "You handle pricing"; included if "Stripe handles pricing") — **exact rate to be validated in test mode (MP-07)**  
- **Transfer execution**: `source_transaction = charge_id` queues transfer until charge funds settle (synchronous payments only); `transfer_group = order_id` for correlation  
- **Refunds (CD-048)**: Partial/full Refund on Charge + **manual Transfer reversal** per affected vendor (proportional); platform adjusts commission consistently  
- **Failed charge after Transfer created**: Platform must manually reverse Transfer (no auto-reversal)  
- **Idempotency**: PaymentIntent uses `idempotency_key`; Transfers use application-level key (`order_id:ovg_id:attempt`) + pre-check  
- **Async payments (PIX/Boleto)**: Wait `charge.succeeded` before creating Transfers; do not use `source_transaction`  
- Supports multi-vendor cart (CD-019), partial refunds (CD-048), cross-machine consistency (CD-063)  
- Brazil available; platform and vendors in same region (Brazil)  
**Justification:** Only Separate Charges and Transfers supports single payment → multiple vendors (Destination Charges limited to 1 connected account). Available in Brazil.  
**Source:** MP-06-R4 consolidation for T-111/Q-011

### CD-065: Payment and Vendor Distribution Flow — Separate Charges and Transfers
**Status:** Confirmed (MP-06-R4)  
**Subject:** Minimal split-payment flow for multi-vendor marketplace  
**Decision:** 
1. Checkout creates Order with OVGs → calculates per-vendor `vendor_net = ovg_total × (1 - commission_pct/100)` (CD-045)  
2. Creates single Charge on platform (amount = order_total, currency = BRL, capture = true)  
3. On `charge.succeeded` webhook: 
   - Payment = CAPTURED → Order = PAID (CD-063)  
   - Order = PAID → all OVGs = PENDING (CD-063 cross-machine rule)  
4. Platform creates one Transfer per OVG to vendor connected_account (background):  
   - `source_transaction = charge_id` (transfer queued until charge funds settle; synchronous payments only)  
   - `transfer_group = order_id` (correlation)  
   - Transfer amount = `vendor_net`  
5. **Vendor fulfillment trigger**: OVG = PENDING → Vendor confirms → OVG = CONFIRMED (CD-063). **Not gated by Transfer completion.**  
6. On `transfer.paid` webhook: optional notification to vendor; funds available in vendor Stripe balance  
7. **Financial breakdown per OVG**:  
   - Gross commission (revenue) = `ovg_total × commission_pct/100`  
   - Platform operational costs = Stripe payment fee + Transfer fees  
   - Platform net = Gross commission - operational costs  
   - Vendor receives `vendor_net` (commission already deducted; Transfer fees are platform cost)  
8. **Refunds (CD-048)**: Partial/full Refund on Charge + **manual Transfer reversal** per affected vendor (proportional). Platform adjusts commission consistently.  
9. **Failed charge after Transfer created**: Platform must manually reverse Transfer (no auto-reversal)  
10. Ledger: Transaction (CD-031) per SALE/COMMISSION/TRANSFER/REFUND/REVERSAL  
11. Financial status derived per CD-058 from Refunds + Transfer reversals  
**Justification:** Separate Charges and Transfers is the only Stripe charge type supporting 1 checkout → 1 payment → N vendors. Aligns with CD-021, CD-028, CD-031, CD-045, CD-047, CD-048, CD-058, CD-063.  
**Source:** MP-06-R4

## Diagram Inferences (Preserved as Inferred — Not Confirmed)

### D-001: Person as Base Entity for All Human Actors
**Status:** Inferred from diagram  
**Subject:** User/role modeling approach  
**Decision:** Single `Person` entity serves as base for `Consumer`, `Vendor`, and `Admin` roles  
**Justification (inferred):** Shared attributes factored into base entity; roles modeled as specializations  
**Source:** conceptual-model.drawio — Person swimlane with Main_Info, Addresses, Contacts_Info, Orders  
**Consequences:** Role-specific attributes attached via specialization  
**Note:** Largely superseded by CD-001..CD-004 but kept for traceability

### D-002: CPF and CNPJ Both on Main_Info
**Status:** Inferred from diagram (CONFLICTS WITH CD-007)  
**Subject:** Identity document modeling  
**Decision:** Both CPF and CNPJ stored on Person/Main_Info  
**Justification (inferred):** Vendors may be individuals or companies; Consumers are individuals  
**Source:** conceptual-model.drawio — Main_Info contains Name, CPF, CNPJ  
**Consequences:** Diagram shows both fields; CD-007 confirms mutual exclusivity — diagram needs correction

### D-003: Role-Based Access via Role + PermissionENUM
**Status:** Inferred from diagram (CONFLICTS WITH CD-004)  
**Subject:** Authorization model  
**Decision:** Separate `Role` entity with `Description` and `PermissionENUM`; `PermissionENUM` defines Read / Read-Write levels  
**Justification (inferred):** Fine-grained permissions per role; Admin linked to Role  
**Source:** conceptual-model.drawio — Role swimlane with PermissionENUM child  
**Consequences:** PermissionENUM limited to two levels; CD-004 clarifies Role only for Admin

### D-004: Address and Contact_Info as Separate Entities
**Status:** Inferred from diagram (CONFIRMED by CD-008)  
**Subject:** Contact/location data modeling  
**Decision:** `Address` and `Contact_info` as independent entities linked to Person  
**Justification (inferred):** Multiple addresses/contacts per person; reuse across roles  
**Source:** conceptual-model.drawio — Address and Contact_info swimlanes with Person reference  
**Consequences:** 1:N from Person; specific attributes deferred

### D-005: Product Linked to Vendor and Category
**Status:** Inferred from diagram (CONFIRMED by CD-011, CD-015)  
**Subject:** Product ownership and categorization  
**Decision:** `Product` references `Vendor` and `Category`; contains Reviews, Description, Price, Product_Pics  
**Justification (inferred):** Clear ownership; hierarchical categorization  
**Source:** conceptual-model.drawio — Product and Category swimlanes  
**Consequences:** Category hierarchy confirmed; depth deferred

### D-006: Order Decomposed into Order_Vendor_Group + Order_Item
**Status:** Inferred from diagram (CONFIRMED by CD-021)  
**Subject:** Multi-vendor order modeling  
**Decision:** `Order` → `Order_Vendor_Group` (per vendor) → `Order_Item`  
**Justification (inferred):** Split payments, per-vendor commission, per-vendor status  
**Source:** conceptual-model.drawio — Order, Order_Vendor_Group, Order_Item swimlanes  
**Consequences:** Three-level hierarchy confirmed

### D-007: Order Status History at Two Levels
**Status:** Inferred from diagram (CONFIRMED by CD-022, CD-033)  
**Subject:** Audit trail granularity  
**Decision:** Separate `Order_Status_History` and `Order_Vendor_Group_History`  
**Justification (inferred):** Track both overall order and per-vendor fulfillment  
**Source:** conceptual-model.drawio — Both history swimlanes  
**Consequences:** Both append-only; states/transitions deferred (CD-034)

### D-008: Payment, Wallet, Transaction, Refund as Distinct Entities
**Status:** Inferred from diagram (LARGELY CONFIRMED by CD-025, CD-028..CD-032)  
**Subject:** Financial domain modeling  
**Decision:** Separate entities for Payment, Wallet, Transaction, Refund  
**Justification (inferred):** Split payments, commission, payouts, refunds  
**Source:** conceptual-model.drawio — Payment, Wallet, Transaction, Refund swimlanes  
**Consequences:** Confirmed with clarifications (Wallet shared, Transaction generic, Refund partial with vendor grouping)

### D-009: Marketplace Entity with Wallet and Admins
**Status:** Inferred from diagram (CONFIRMED by CD-030)  
**Subject:** Platform-level entity  
**Decision:** `Marketplace` entity (Name, Wallet, Admins) exists as platform anchor  
**Justification (inferred):** Centralizes platform wallet for commissions; tracks platform admins  
**Source:** conceptual-model.drawio — Marketplace swimlane  
**Consequences:** Wallet shared concept (CD-030)

### D-010: Coupon with Vendor Ownership and Targeting Rules
**Status:** Inferred from diagram (CONFIRMED by CD-026)  
**Subject:** Coupon modeling  
**Decision:** `Coupon` owned by `Vendor`; `Coupon_Target` defines applicable products/categories  
**Justification (inferred):** Vendor-specific promotions; flexible targeting  
**Source:** conceptual-model.drawio — Coupon and Coupon_Target swimlanes  
**Consequences:** Applied at Order_Vendor_Group level; plural attributes are lists (CD-027)

### D-011: Review Linked to Product with Rating, Comment, Images
**Status:** Inferred from diagram (PARTIALLY CONFIRMED by CD-017)  
**Subject:** Review modeling  
**Decision:** `Review` references `Product`; contains Comment, Rating, Product_Pics  
**Justification (inferred):** Product-centric reviews; photo reviews  
**Source:** conceptual-model.drawio — Review swimlane  
**Consequences:** Verified purchase requirement added (CD-017); author link implicit

### D-012: Product_Pic as Separate Entity
**Status:** Inferred from diagram (CONFIRMED by CD-016)  
**Subject:** Product image modeling  
**Decision:** `Product_Pic` separate from Product; linked to Product and Review  
**Justification (inferred):** Reuse images; S3 path storage  
**Source:** conceptual-model.drawio — Product_Pic swimlane  
**Consequences:** Pic_Path suggests S3 key

---

## Technical / Future Decisions (Deferred to Implementation Phases)

| ID | Topic | Status | Notes |
|----|-------|--------|-------|
| D-013 | JWT vs session auth details | Technical / Future | CD-010: JWT+RBAC required; details deferred |
| D-014 | MongoDB collection design | Technical / Future | CD-005: Conceptual ≠ physical |
| D-015 | Elasticsearch index strategy | Technical / Future | CD-049: ES confirmed; mapping/analyzers/sync deferred |
| D-016 | Redis cache keys/TTL for cart/session | Technical / Future | CD-018: Cart in Redis; schema deferred |
| D-017 | Payment provider integration details | **Resolved (CD-064)** | CD-064: Stripe Connect (Separate Charges and Transfers) confirmed; exact fees, onboarding, test mode validation in MP-07 |
| D-018 | Commission calculation implementation | Technical / Future | CD-045: Global % confirmed; per-vendor calculation at Order_Vendor_Group; refund adjustment |
| D-019 | Order/Payment/Vendor_Group state machine values/transitions | Technical / Future | CD-044: Three independent state machines confirmed; exact values/transitions open; terminology reconciliation needed |
| D-020 | Vendor suspension/abuse mechanism | Technical / Future | CD-041: Auto-publish confirmed; suspension mechanism needed |
| D-021 | Soft delete vs hard delete implementation | Technical / Future | CD-052: Inactivation for referenced entities; hard-delete when safe; order snapshots defined |
| D-022 | Multi-tenancy scope | Out of scope | Q-020: Single marketplace confirmed; multi-tenancy belongs to another project |
| D-023 | API design style | Technical / Future | Stage 1 deliverable; not decided |
| D-024 | Frontend state management | Technical / Future | Stage 2+; not decided |
| D-025 | Checkout address snapshots | **Resolved (CD-061)** | CD-061: Snapshot semantics confirmed; uses CD-040 fields; immutable copy at Order creation |
| D-026 | Product inactivation state | Technical / Future | CD-042: Inactive state confirmed; hard-delete referential check needed |
| D-027 | Category cycle prevention | Technical / Future | CD-043: Hierarchy rules confirmed; cycle detection implementation required |
| D-028 | Coupon mixed-cart discount calculation | Technical / Future | CD-050: Inclusion/exclusion rules confirmed; mixed-cart discount open; stacking/priority open |
| D-029 | Vendor dashboard metrics implementation | Technical / Future | CD-051: Metrics scope confirmed; gross sales pre-commission labeling; cross-vendor access prohibited |
| D-030 | Transaction currency | Technical / Future | CD-054: English UI confirmed; currency unresolved; FX service prohibited without decision |
| D-031 | Notification infrastructure | Technical / Future | CD-055: Manual refresh MVP; WebSocket/event bus deferred |
| D-032 | Testing configuration, CI, coverage targets | Technical / Future | CD-056: Vitest/Supertest/Playwright confirmed; TDD mandatory; payment test scenarios specified; coverage targets deferred |
| D-033 | Password hash algorithm and rotation | Technical / Future | CD-057: Credential stores hash; algorithm/rotation deferred |
| D-034 | Credential status values and MFA | Technical / Future | CD-057: Credential status, MFA, recovery deferred |
| D-035 | Credential recovery/reset flow | Technical / Future | CD-057: Recovery/reset flow deferred |