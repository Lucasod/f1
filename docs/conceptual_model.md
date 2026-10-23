# Conceptual Model — FS-01 Marketplace

## Source
Extracted from `docs/modeling/conceptual-model.drawio` (draw.io diagram).  
**Status:** Updated with MP-02 confirmed decisions. Subject to further review.  
**Note:** Diagram uses swimlane notation; relationships shown as edges. This document translates visual model to structured inventory, now incorporating confirmed business rules.

---

## Core Concepts Inventory (Updated)

### 1. Person (Base Abstraction)
**Responsibility:** Shared identity and contact information for all human actors  
**Attributes (via Main_Info):** Name, **exactly one of CPF or CNPJ (mutually exclusive)**  
**Relationships:**
- Has multiple Addresses (1:N)
- Has multiple Contact_Infos (1:N)
- Has Credential (1:1 or 1:N — cardinality not yet defined)
- Specialized by: Consumer, Vendor, Admin

**Confirmed Rules (MP-02):**
- Person is the common abstraction for Admin, Consumer, Vendor (CD-001)
- A Person may be Consumer and Vendor simultaneously (CD-002)
- A Person who is Admin cannot be Consumer or Vendor (CD-003)
- Persistence strategy (single vs multiple collections) is NOT decided at conceptual level (CD-005)
- **Admin manages platform; Vendor manages own store/products/orders; Consumer manages own account/cart/orders; strict ownership isolation required (CD-039)**
- **Credential represents the access credential and is associated with Person (CD-057)**

**Open Questions:**
- Password/hash, email verification, status (active/suspended) — TECHNICAL_FUTURE
- Main_Info 1:1 composition vs inline — kept as separate concept per diagram
- Admin permission matrix sufficiency — Q-003 PARTIALLY_RESOLVED
- Consumer/Vendor permission model — Q-003 PARTIALLY_RESOLVED
- Credential cardinality (1:1 or 1:N per Person) — Q-029 PENDING

---

### 2. Main_Info
**Responsibility:** Core identity attributes factored out of Person  
**Attributes:** Name, **CPF XOR CNPJ (exactly one, never both)**  
**Relationships:** 1:1 with Person (composition implied)  
**Confirmed Rules (MP-02):**
- CD-006: Person 1:1 Main_Info
- CD-007: Mutual exclusivity of CPF/CNPJ (diagram showing both is incomplete)

---

### 3. Address
**Responsibility:** Physical location for a Person  
**Attributes:** Person (ref), **Street, Number, Neighborhood, City, State**  
**Relationships:** N:1 → Person  
**Confirmed Rules (MP-02):**
- CD-008: Address related to Person (1:N confirmed)
- **CD-040: Fields confirmed as Street, Number, Neighborhood, City, State. CEP, country, complement, address type explicitly NOT included without new decision**

**Open Questions (Q-004 — PARTIALLY_RESOLVED):**
- Checkout address snapshot semantics — PENDING
- Validation rules for Brazilian addresses (CEP) — TECHNICAL_FUTURE

---

### 4. Contact_Info
**Responsibility:** Electronic contact for a Person  
**Attributes:** Person (ref), **Type, Value, Is_Primary**  
**Relationships:** N:1 → Person  
**Confirmed Rules (MP-02):**
- CD-008: Contact_Info related to Person (1:N confirmed)
- **CD-040: Fields confirmed as Type, Value, Is_Primary. Verified explicitly NOT included without new decision**
- **Login is performed by email. The email resides in Contact_Info.Value with Type = email. Is_Primary represents the primary contact for communication; it does NOT automatically indicate which email is used for login (CD-057)**
- **The Contact_Info record used for login (email) must not be deleted while it is required for authentication (CD-057)**
- **No Purpose, Is_Login, or similar attribute is added to Contact_Info solely to identify the login email (CD-057)**
- **Email is not duplicated in Person, Main_Info, or Credential (CD-057)**

**Open Questions (Q-004 — PARTIALLY_RESOLVED):**
- Allowed contact types and validation rules for `Contact_Info.Value` (e.g., phone, WhatsApp, email) — PENDING
- Checkout address snapshot semantics — PENDING
- Email uniqueness constraint (for login) — PENDING (Q-029)
- Identification of which Contact_Info is used for login — PENDING (Q-029)

---

### 5. Credential
**Responsibility:** Access credential for a Person (e.g., password hash)  
**Attributes:** Person (ref), Hashed_Password, Status, Created_At, Updated_At  
**Relationships:** Associated with Person (cardinality 1:1 or 1:N — not yet defined)  
**Confirmed Concept (MP-02):**
- **Credential represents the access credential and is associated with Person (CD-057)**
- **Credential does not store a second email and does not require a direct reference to Contact_Info (CD-057)**
- **Login/Authentication is not presumed to be a persisted entity solely because the authentication flow is represented conceptually (CD-009, CD-057)**

**Conceptual Authentication Flow (CD-057 — confirmed):**
1. Receive email and password provided by the user
2. Locate the Contact_Info matching the email (Type = email)
3. Find the Person associated with that Contact_Info
4. Locate the Credential associated with that Person
5. Verify the credential; authenticate access if valid

**Technical Details (Deferred — not conceptually decided):**
- Password hash algorithm and rotation policy
- Credential status values (active, locked, expired)
- Multi-factor authentication (MFA) credentials
- Credential recovery/reset flow

**Open Questions (Q-029 — PENDING):**
- Cardinality of Person to Credential (1:1 or 1:N)?

---

### 6. Consumer (Person Specialization)
**Responsibility:** Buyer role  
**Attributes:** Inherits Person  
**Relationships:** Places Orders (1:N)  
**Confirmed Rules (MP-02):**
- Can coexist with Vendor on same Person (CD-002)
- Disjoint from Admin (CD-003)

**Open Questions:**
- Consumer-specific attributes (preferences, wishlist) — not modeled

---

### 7. Vendor (Person Specialization)
**Responsibility:** Seller role — manages products, coupons, receives payouts  
**Attributes (via child):** Person (ref), **Product_List (list, not entity)**, **Coupon_List (list, not entity)**, **Wallet (1:1)**  
**Relationships:**
- Offers Products (1:N) — CD-011
- Owns Coupons (1:N) — CD-026
- Has Wallet (1:1) — CD-030
- Linked to Order_Vendor_Group (1:N)

**Confirmed Rules (MP-02):**
- CD-011: Vendor offers Product
- CD-012: No separate Catalog concept (catalog = vendor's products)
- CD-026: Coupon and Coupon_Target accepted; plural attributes are lists (CD-027)
- CD-030: Wallet shared concept with Marketplace
- Can coexist with Consumer on same Person (CD-002)
- Disjoint from Admin (CD-003)
- **CD-041: Auto-publish after registration; no prior Admin approval required; suspension for abuse possible**
- **CD-045: Commission from global percentage; calculated per Vendor at Order_Vendor_Group; commission adjustment on refund**

**Open Questions:**
- Company name, bank account for payouts, tax info — not modeled
- Suspension/abuse mechanism — Q-005 RESOLVED (auto-publish confirmed; suspension mechanism TECHNICAL_FUTURE)

---

### 8. Admin (Person Specialization)
**Responsibility:** Platform administration  
**Attributes:** Role (via Role swimlane)  
**Relationships:** N:1 → Role; linked to Marketplace (Admins list)  
**Confirmed Rules (MP-02):**
- CD-003: Disjoint from Consumer and Vendor
- CD-004: Role entity exists exclusively for Admin permissions
- Role does NOT determine if Person is Admin/Consumer/Vendor
- **CD-051: Vendor dashboard scope confirmed (order count, gross sales pre-commission, pending/completed orders, best-selling products); Admin dashboard scope NOT defined — only Vendor dashboard is confirmed**

**Open Questions:**
- Admin-specific attributes (department, permissions override) — not modeled
- Super-admin vs regular admin — Q-003 PARTIALLY_RESOLVED (scope defined, levels open)
- **Admin dashboard scope and metrics — not defined (only Vendor dashboard scope confirmed per CD-051)**

---

### 9. Role
**Responsibility:** Authorization role definition for Admin only  
**Attributes:** Description, PermissionENUM  
**Relationships:** 1:N → Admin; has PermissionENUM  
**Confirmed Rules (MP-02):**
- CD-004: Role only for Admin; Consumer/Vendor authorization separate

**Open Questions (Q-003 — PARTIALLY_RESOLVED):**
- Only two permission levels (Read, Read/Write)? Sufficiency for Admin needs evaluation
- Resource-level permissions for Admin?
- Consumer/Vendor authorization model not defined

---

### 10. PermissionENUM
**Responsibility:** Permission level enumeration for Admin roles  
**Values:** Read, Read/Write  
**Open Questions (Q-003 — PARTIALLY_RESOLVED):**
- Sufficient for Admin RBAC?
- Extensibility?

---

### 11. Category
**Responsibility:** Product categorization hierarchy  
**Attributes:** Name, Category (self-ref for parent)  
**Relationships:** Self-referencing (tree); 1:N → Product  
**Confirmed Rules (MP-02):**
- CD-015: Category admits parent/child hierarchy
- **CD-043: Optional self-reference via parent_id; root = no parent; many children, at most one parent; multilevel supported; cycle prevention required**

**Open Questions (Q-008 — RESOLVED):**
- Filter specs and attribute inheritance — PENDING

---

### 12. Product
**Responsibility:** Sellable item listed by a Vendor  
**Attributes:** Vendor (ref), Category (ref), Reviews, Description, Price, **Quantity (current stock)**, Product_Pic_List  
**Relationships:**
- N:1 → Vendor (CD-011)
- N:1 → Category (CD-015)
- 1:N → Review
- 1:N → Product_Pic
- Referenced by Order_Item (with historical price snapshot)

**Confirmed Rules (MP-02):**
- CD-011: Vendor offers Product
- CD-013: Product.Quantity = current stock; display: in-stock first, out-of-stock last
- CD-014: No separate Inventory entity
- CD-016: Images for Product (via Product_Pic)
- CD-023: Order_Item keeps historical unit price (Product.Price changes don't affect past orders)
- **CD-042: Products can be inactivated to prevent new sales while retaining historical records; hard deletion permitted only when safe and historical references not compromised**

**Open Questions:**
- Price type (decimal precision, currency) — Q-026 PARTIALLY_RESOLVED
- Variants/SKUs — Q-006 PARTIALLY_RESOLVED (not modeled)
- SEO fields (slug, meta) — not modeled
- Weight/dimensions for shipping — not modeled

---

### 13. Product_Pic
**Responsibility:** Product image asset  
**Attributes:** Product (ref), Pic_Product (ref?), Description, Pic_Path  
**Relationships:** N:1 → Product; also referenced by Review  
**Confirmed Rules (MP-02):**
- CD-016: Images for Product and Review

**Open Questions:**
- "Pic_Product" meaning unclear — possibly duplicate of Product ref (already has Product ref attribute)
- S3 key vs full URL in Pic_Path?
- Primary image designation?
- Order/sequence for gallery?
- **Relationship with Review: Review references Product_Pics (plural) but cardinality and ownership (shared vs owned images) not defined**

---

### 14. Review
**Responsibility:** Customer feedback on Product  
**Attributes:** Product (ref), Comment, Rating, Product_Pic_List  
**Relationships:** N:1 → Product; references Product_Pic  
**Confirmed Rules (MP-02):**
- CD-017: Review only by verified purchaser (must have purchased the product)
- CD-016: Images for Review (via Product_Pic)

**Open Questions (Q-017 — PARTIALLY_RESOLVED):**
- No explicit Consumer/Vendor author reference in diagram (implied via verified purchase)
- Rating scale (1-5?)
- Moderation status (pending/approved/rejected)?
- Vendor response?
- **Product_Pic_List attribute: plural form suggests list of images, but relationship to Product_Pic entity is ambiguous (single ref vs list of refs; shared vs owned images)**

---

### 15. Coupon
**Responsibility:** Vendor-issued discount code  
**Attributes:** Vendor (ref), Code, Discount_Type, Discount_Value, Starts_At, Ends_At  
**Relationships:** N:1 → Vendor; 1:1 → Coupon_Target; referenced by Order_Vendor_Group  
**Confirmed Rules (MP-02):**
- CD-026: Coupon and Coupon_Target accepted as concepts
- CD-027: Product_List and Category_List are lists, not separate entities
- **CD-050: Inclusion lists target products/categories; including category includes descendants; exclusion lists target products/categories; excluding category excludes descendants; exclusions override inclusions**

**Open Questions (Q-016 — PARTIALLY_RESOLVED):**
- Discount_Type values (percentage, fixed, free_shipping)?
- Usage limits (per coupon, per user, total)?
- Mixed eligible/ineligible cart contents discount calculation?
- Coupon stacking and priority rules?
- Minimum order value?
- Platform-wide coupons vs vendor-only?
- **Coupon vs Coupon_Target attribute ownership: only Coupon_Target (section 16) currently declares Product_List and Category_List; Coupon (section 15) no longer declares these attributes. The final attribute allocation between Coupon and Coupon_Target requires a business decision**

---

### 16. Coupon_Target
**Responsibility:** Defines which products/categories a coupon applies to  
**Attributes:** Coupon (ref), Product_List, Category_List  
**Relationships:** 1:1 → Coupon  
**Confirmed Rules (MP-02):**
- CD-026, CD-027: Target defines applicable products/categories as lists

**Open Questions (Q-016 — PENDING):**
- Product_List and Category_List as arrays of refs?
- "All products" vs specific selection semantics?
- **Coupon vs Coupon_Target attribute ownership: only Coupon_Target (section 16) currently declares Product_List and Category_List; Coupon (section 15) no longer declares these attributes. The final attribute allocation between Coupon and Coupon_Target requires a business decision**

---

### 17. Order
**Responsibility:** Customer purchase aggregating multi-vendor items  
**Attributes:** Consumer (ref), Status, Total, **Order_Vendor_Group_List**, Orders_Status_History, Payments  
**Relationships:**
- N:1 → Consumer
- 1:N → Order_Vendor_Group
- 1:N → Order_Status_History
- 1:N → Payment

**Confirmed Rules (MP-02):**
- CD-020: Checkout creates Order, initiates payment
- CD-021: Order = complete purchase; contains Order_Vendor_Groups
- CD-024: Order persists even if payment fails/abandoned; history preserved
- CD-025: Payment state and fulfillment state are distinct
- CD-033: Histories append-only (Order_Status_History)
- CD-036: Invoice uses historical Order values
- **CD-044: Overall Order status, Payment status, and fulfillment status are separate concerns; Order may exist before Payment; failed/abandoned payment does not erase Order; three independent state machines (Order, Payment, Order_Vendor_Group)**
- **CD-058: Aggregate financial status is a derived dimension separate from lifecycle state machine. Mutual exclusion precedence: (1) FULLY_REFUNDED — all Order_Vendor_Groups fully refunded; (2) PARTIALLY_REFUNDED — at least one group refunded (partial or full), not all fully refunded; (3) PAID — captured payment exists, no refunds initiated, lifecycle not terminal. CANCELLED/VOIDED are unconfirmed lifecycle proposals, not financial status values.**

**Open Questions (Q-009 — PARTIALLY_RESOLVED):**
- Status values for Order lifecycle? (pending, paid, processing, shipped, delivered, cancelled, refunded, failed_payment?)
- Total calculation (sum of vendor groups + shipping - discounts)?
- Shipping address snapshot?
- Guest checkout support?
- Reconcile existing terminology (placed, packed, shipped, delivered) with final state machines
- CANCELLED and VOIDED lifecycle statuses — unconfirmed proposals

---

### 18. Order_Vendor_Group
**Responsibility:** Per-vendor sub-order within an Order (enables split fulfillment/payment)  
**Attributes:** Vendor (ref), **Order_Items (list)**, Coupon (ref, optional), Status  
**Relationships:**
- N:1 → Order (implied)
- N:1 → Vendor
- N:1 → Coupon (optional)
- 1:N → Order_Item
- 1:N → Order_Vendor_Group_History

**Confirmed Rules (MP-02):**
- CD-021: Order_Vendor_Group = per-vendor portion
- CD-022: Vendor independently updates fulfillment state of their Order_Vendor_Group
- CD-025: Fulfillment state separate from payment state
- CD-026: Coupon applied at Order_Vendor_Group level
- CD-027: Order_Items is a list (not separate Order_Vendor_Items entity)
- CD-032: Refund groups items by vendor at Order_Vendor_Group level
- CD-033: Order_Vendor_Group_History append-only
- **CD-044: Each Vendor's portion fulfilled independently; payment confirmation permits Vendor processing; financial distribution separate from Order lifecycle**
- **CD-045: Commission calculated at this level from global percentage; commission adjustment on refund**

**Open Questions (Q-009 — PARTIALLY_RESOLVED; Q-013 — RESOLVED):**
- Status values for Order_Vendor_Group? (independent of Order status)
- Shipping tracking per group?
- Specific state machine transitions for fulfillment

---

### 19. Order_Item
**Responsibility:** Individual line item within a vendor group  
**Attributes:** Order_Vendor_Group (ref), Product (ref), **Price (historical snapshot)**, Quantity  
**Relationships:** N:1 → Order_Vendor_Group; N:1 → Product  
**Confirmed Rules (MP-02):**
- CD-023: Order_Item.Price = historical unit price at purchase (immutable snapshot)

**Open Questions (Q-006 — PARTIALLY_RESOLVED; Q-013 — PARTIALLY_RESOLVED):**
- Product variant/SKU reference? (not modeled)
- Return/refund quantity tracking? (CD-032: refund selects products/quantities)

---

> **Nota sobre conceitos `*_History`:** Todos os conceitos `*_History` abaixo estão **provisórios e em aberto** nesta fase de modelagem conceitual. A única regra confirmada é CD-033 (append-only). Atributos, relacionamentos, necessidade de persistência, eventos que originam registros e estrutura de `Changed_By` **não estão decididos** e serão definidos em fase posterior conforme necessidades reais. **Não existe regra confirmada que obrigue todo `*_History` a referenciar uma entidade homônima** — o modelo atual serve como rascunho para discussão, não como especificação definitiva.

---

### 20. Order_Status_History ⚠️ PROVISÓRIO
**Responsibility:** Audit trail for Order-level status changes  
**Attributes:** Order (ref), Status, Changed_At, Changed_By  
**Relationships:** N:1 → Order  
**Confirmed Rules (MP-02):**
- CD-033: Append-only, preserves records without overwrite

**Status:** **PROVISÓRIO** — Atributos, relacionamentos, necessidade de persistência, eventos de trigger e estrutura de `Changed_By` **não estão decididos**. CD-033 (append-only) é a única regra confirmada. Não há regra confirmada que obrigue referência a entidade homônima.

**Open Questions:**
- Changed_By references Person/Admin?
- Automatic vs manual transitions? (CD-034: states/transitions deferred)

---

### 21. Order_Vendor_Group_History ⚠️ PROVISÓRIO
**Responsibility:** Audit trail for Vendor Group-level status changes  
**Attributes:** Order_Vendor_Group (ref), Status, Changed_At, Changed_By  
**Relationships:** N:1 → Order_Vendor_Group  
**Confirmed Rules (MP-02):**
- CD-033: Append-only, preserves records without overwrite

**Status:** **PROVISÓRIO** — Atributos, relacionamentos, necessidade de persistência, eventos de trigger e estrutura de `Changed_By` **não estão decididos**. CD-033 (append-only) é a única regra confirmada. Não há regra confirmada que obrigue referência a entidade homônima.

**Open Questions:**
- Same as Order_Status_History

---

### 22. Payment
**Responsibility:** Payment transaction for an Order  
**Attributes:** Order (ref), Amount, Currency, Status, Provider, Changed_At, Changed_By  
**Relationships:** N:1 → Order; 1:N → Transaction; 1:N → Refund  
**Confirmed Rules (MP-02):**
- CD-024: Order can have multiple Payment attempts (including failed)
- CD-025: Payment state distinct from fulfillment state
- CD-028: Multiple Payment attempts preserved (Order.Payments is a list)
- CD-031: Transaction represents generic financial movement

**Open Questions (Q-011 PARTIALLY_RESOLVED; Q-012 PARTIALLY_RESOLVED):**
- Status values (pending, authorized, captured, failed, refunded)?
- Partial payment support?
- Idempotency key for provider integration?
- Webhook/event correlation?
- Provider selection (Stripe Connect vs Razorpay)?

---

### 23. Provider
**Responsibility:** Payment gateway identifier  
**Attributes:** (none shown in diagram)  
**Relationships:** Referenced by Payment  
**Open Questions (Q-011 — PARTIALLY_RESOLVED):**
- Stripe Connect vs Razorpay — single or both?
- Provider-specific config (account IDs, keys)?

---

### 24. Wallet
**Responsibility:** Holds balance and transaction history for Vendor or Marketplace  
**Attributes:** Transactions (list)  
**Relationships:** 1:1 → Vendor; 1:1 → Marketplace; 1:N → Transaction  
**Confirmed Rules (MP-02):**
- CD-030: Wallet shared concept by Vendor and Marketplace
- Balance derives from transactions; recalculated vs cached = TECHNICAL_FUTURE

**Open Questions (Q-010 — PARTIALLY_RESOLVED):**
- Currency support (single/multi)? — Q-026 PENDING
- Withdrawal/payout workflow?
- Minimum payout threshold?

---

### 25. Transaction
**Responsibility:** Individual ledger entry in a Wallet  
**Attributes:** Payment (ref), Amount, Type, Created_At, Description  
**Relationships:** N:1 → Wallet; N:1 → Payment  
**Confirmed Rules (MP-02):**
- CD-031: Transaction = generic financial movement record
- Type distinguishes: sale, commission, refund, payout, adjustment

**Open Questions:**
- Running balance per transaction?
- Reconciliation with provider reports?

---

### 26. Refund
**Responsibility:** Refund record linking payment, items, and amounts  
**Attributes:** Transactions (list), Payment (ref), **Order_Items (refers to Order_Item grouped by vendor via Order_Vendor_Group)**, Amount, Type, Created_At, Description  
**Relationships:** N:1 → Payment; references Order_Items (grouped by vendor)  
**Confirmed Rules (MP-02):**
- CD-032: Refund can be partial; consumer selects products/quantities; system groups by vendor; generates Transactions per vendor
- CD-025: Refund affects payment state, not fulfillment state directly
- CD-033: Refund_History append-only
- CD-027: Order_Vendor_Items in diagram refers to Order_Items list, not separate entity
- **CD-048: Partial and full refunds by item/quantity supported; marketplace initiates customer refunds through provider using original payment; no internal customer wallet; internal financial adjustments to marketplace and Vendor ledgers including negative Vendor balances/debt; provider cannot be assumed to always debit/recover from Vendor; `sent` state = request sent, not money returned; original receipt and history preserved; idempotency prevents duplicates; commission recalculated/adjustted consistently with refunds**

**Open Questions (Q-013 — RESOLVED):**
- Dispute mediation workflow details — TECHNICAL_FUTURE

---

### 27. Transaction_History ⚠️ PROVISÓRIO
**Responsibility:** Audit trail for Transaction changes  
**Attributes:** Transaction, Payment, Description, Amount, Type, Changed_At, Changed_By  
**Relationships:** References Transaction and Payment  
**Confirmed Rules (MP-02):**
- CD-033: Append-only

**Status:** **PROVISÓRIO** — Atributos, relacionamentos, necessidade de persistência, eventos de trigger e estrutura de `Changed_By` **não estão decididos**. CD-033 (append-only) é a única regra confirmada. Não há regra confirmada que obrigue referência a entidade homônima.

**Open Questions:**
- What changes trigger history (status, amount, description)?
- Separate from Transaction's own Created_At?

---

### 28. Refund_History ⚠️ PROVISÓRIO
**Responsibility:** Audit trail for Refund changes  
**Attributes:** Refund (ref), Transaction, Payment, Description, Amount, Type, Changed_At, Changed_By  
**Relationships:** References Refund, Transaction and Payment  
**Confirmed Rules (MP-02):**
- CD-033: Append-only

**Status:** **PROVISÓRIO** — Atributos, relacionamentos, necessidade de persistência, eventos de trigger e estrutura de `Changed_By` **não estão decididos**. CD-033 (append-only) é a única regra confirmada. A referência `Refund (ref)` foi adicionada recentemente, mas **não está confirmada como obrigatória** — sua necessidade será decidida posteriormente. Não há regra confirmada que obrigue todo `*_History` a referenciar entidade homônima.

**Open Questions:**
- Same as Transaction_History

---

### 29. Marketplace
**Responsibility:** Platform-level aggregate (single instance)  
**Attributes:** Name, Wallet (1:1), Admins (list)  
**Relationships:** 1:1 → Wallet; 1:N → Admin  
**Confirmed Rules (MP-02):**
- CD-030: Marketplace has Wallet (shared concept with Vendor)
- **CD-038/Q-020: Single marketplace confirmed; multi-tenancy explicitly out of scope**

**Open Questions:**
- Platform commission rate/fees configuration? (CD-045: global percentage from Vendor agreement)
- Multi-marketplace support (SaaS) — **OUT_OF_SCOPE** per user decision

---

### 30. Invoice (Commercial Receipt)
**Responsibility:** Commercial document/receipt in PDF (not Brazilian NF-e)  
**Attributes:** Order (ref), Emission_At  
**Relationships:** Related to Order; uses historical Order values  
**Confirmed Rules (MP-02):**
- CD-035: Invoice = commercial receipt, NOT fiscal NF-e
- CD-036: Uses historical Order values (not current catalog)
- CD-037: Partial refund does not rewrite original invoice
- CD-038: Invoice has Order + Emission_At; Invoice_History intentionally empty for now
- **CD-048: Original receipt and financial history preserved on refund**

**Open Questions (Q-018 — PARTIALLY_RESOLVED):**
- Generation trigger (on payment? on delivery? on-demand)?
- Template design?
- Storage (S3? DB?) — TECHNICAL_FUTURE
- Invoice_History scope — deferred

---

### 31. Invoice_History (Placeholder) ⚠️ PROVISÓRIO
**Responsibility:** Audit trail for Invoice changes — **placeholder only, intentionally empty**  
**Attributes:** (intentionally empty per MP-02)  
**Relationships:** —  
**Confirmed Rules (MP-02):**
- CD-038: Intentionally empty; not an error; details for later discussion

**Status:** **PROVISÓRIO** — Placeholder intencionalmente vazio (CD-038). Escopo, estrutura, necessidade de persistência e triggers **não decididos**. Detalhes para discussão posterior.

**Open Questions:**
- Scope and triggers to be defined when generation process is designed

---

## Relationship Summary (Updated)

| From | To | Cardinality | Notes |
|------|-----|-------------|-------|
| Person | Address | 1:N | CD-008 |
| Person | Contact_Info | 1:N | CD-008 |
| Person | Credential | 1:1 or 1:N | CD-057 (TBD) |
| Person | Consumer | 1:1 (specialization) | CD-001, CD-002 |
| Person | Vendor | 1:1 (specialization) | CD-001, CD-002 |
| Person | Admin | 1:1 (specialization) | CD-001, CD-003 (disjoint) |
| Admin | Role | N:1 | CD-004 (Admin only) |
| Role | PermissionENUM | 1:1 | Admin RBAC only |
| Vendor | Product | 1:N | CD-011 |
| Vendor | Coupon | 1:N | CD-026 |
| Vendor | Wallet | 1:1 | CD-030 |
| Vendor | Order_Vendor_Group | 1:N | CD-021 |
| Category | Category | 1:N (self) | CD-015 (parent-child) |
| Category | Product | 1:N | CD-015 |
| Product | Product_Pic | 1:N | CD-016 |
| Product | Review | 1:N | CD-016, CD-017 |
| Product | Order_Item | 1:N | CD-023 (price snapshot) |
| Consumer | Order | 1:N | CD-020 |
| Order | Order_Vendor_Group | 1:N | CD-021 |
| Order | Order_Status_History | 1:N | CD-033 |
| Order | Payment | 1:N | CD-028 (multiple attempts) |
| Order_Vendor_Group | Order_Item | 1:N | CD-021, CD-027 (list) |
| Order_Vendor_Group | Coupon | N:1 (optional) | CD-026 |
| Order_Vendor_Group | Order_Vendor_Group_History | 1:N | CD-033 |
| Order_Item | Product | N:1 | CD-023 (snapshot) |
| Payment | Transaction | 1:N | CD-031 |
| Payment | Refund | 1:N | CD-028 |
| Wallet | Transaction | 1:N | CD-030, CD-031 |
| Marketplace | Wallet | 1:1 | CD-030 |
| Marketplace | Admin | 1:N | CD-004 |
| Refund | Order_Vendor_Group | N:1 (grouped) | CD-032 |
| Invoice | Order | N:1 | CD-035, CD-036 |

---

## Concepts Missing from Diagram (per Official Requirements + MP-02)

| Concept | Required By | Status |
|---------|-------------|--------|
| Shopping Cart | Stage 5 | **CD-018: Not a persisted conceptual entity** (Redis/session only) |
| Cart Item | Stage 5 | Part of Cart (not separate concept) |
| Session/Cache | Stage 5 | Redis — TECHNICAL_FUTURE |
| PDF Invoice | Stage 7 | **Added as Invoice (CD-035..CD-038)** |
| Sales Metrics/Analytics | Stage 7 | Derived from Order/Payment/Vendor — Q-019 RESOLVED (Vendor dashboard scope) |
| Elasticsearch Index/Document | Stage 4 | TECHNICAL_FUTURE (CD-049: ES confirmed) |
| Image Upload Session | Stage 3 | TECHNICAL_FUTURE |
| Vendor Onboarding Request | Stage 3 | Q-005 RESOLVED (auto-publish confirmed) |
| Notification/Event | Cross-cutting | Q-027 RESOLVED (manual refresh MVP) |
| Audit Log (generic) | Cross-cutting | Covered by specific *_History entities (**provisórios**, exceto Invoice_History placeholder vazio per CD-038) |
| Credential | Stage 2 | **Added as Credential (CD-057)** |

---

## Diagram Quality Issues Noted (Updated)

1. **CONFLICT RESOLVED:** `Main_Info` shows both CPF and CNPJ — **CD-007 confirms mutual exclusivity** (exactly one). Diagram needs correction.
2. **Inconsistent naming:** `Product_Pic` vs `Product_Pics` (plural on Product), `Orders_Vendor_Products_History` vs `Order_Vendor_Group_History`
3. **Ambiguous attributes:** `Pic_Product` on Product_Pic, `Product_List`/`Coupons`/`Wallet` on Vendor shown as attributes not relationships — **CD-027 clarifies these are lists**
4. **Missing cardinality indicators** on most edges
5. **No value object vs entity distinction** (Address, Contact_Info, Money)
6. **No aggregate boundaries** marked (DDD)
7. **Provider** entity empty — placeholder only (Q-011)
8. **Order_Vendor_Items** referenced by Refund in diagram — **CD-027 clarifies: it's Order_Items list (grouped by vendor), not separate entity**
9. **Orders_Vendor_Products_History** on Order — unclear if same as Order_Vendor_Group_History
10. **Role** connected to Admin only in diagram but appears as general — **CD-004: Role only for Admin**

---

## Separation of Conceptual vs Technical (MP-02 Emphasis)

| Conceptual (This Model) | Technical / Future (Deferred) |
|-------------------------|-------------------------------|
| Person abstraction & specializations | MongoDB collection strategy (CD-005) |
| CPF XOR CNPJ rule | Validation implementation (format, check digits) |
| Role only for Admin | PermissionENUM sufficiency for Admin (Q-003) |
| Address/Contact_Info as concepts | Address: CEP, country, complement, address type — NOT decided | Contact_Info: Type, Value, Is_Primary confirmed (CD-040); Verified explicitly excluded (CD-040) |
| Authentication via email/password; Credential associated with Person | JWT details, token lifecycle, storage (CD-010) |
| Product.Quantity = stock | Reservation, variants, concurrency (Q-006) |
| Product inactivation | Hard-delete referential integrity check (CD-042) |
| Category hierarchy rules | Cycle prevention implementation (CD-043) |
| Cart in Redis/session | Redis keys, TTL, sync, guest merge (Q-014 TECHNICAL_FUTURE) |
| Order/Payment/Order_Vendor_Group three independent state machines | State machine values/transitions (CD-044, Q-009) |
| Payment state ≠ fulfillment state | Payment provider integration, split flow (CD-046, CD-047, Q-011, Q-012) |
| Commission from global percentage | Per-vendor calculation, refund adjustment (CD-045) |
| Wallet balance from transactions | Cached vs recalculated (CD-030) |
| Refund policy and financial adjustments | Dispute mediation workflow (CD-048) |
| Invoice = commercial receipt | Template, trigger, S3 storage (Q-018 TECHNICAL_FUTURE) |
| Histories append-only | Soft delete vs hard delete implementation (CD-052) |
| Vendor auto-publish onboarding | Suspension/abuse mechanism (CD-041) |
| Elasticsearch search engine | Mapping, analyzers, sync (CD-049) |
| Coupon inclusion/exclusion rules | Mixed-cart discount, stacking, priority (CD-050) |
| Vendor dashboard metrics scope | Implementation details (CD-051) |
| English interface language | Transaction currency, FX service (CD-054) |
| Manual refresh MVP | WebSocket/event bus (CD-055) |
| Three-layer TDD (Vitest/Supertest/Playwright) | CI integration, coverage targets (CD-056) |
| Login email contact protected from deletion while used for auth | Credential cardinality, hash algorithm, MFA, recovery (Q-029) |
| | API style, frontend state, deploy (Q-022..Q-024) |