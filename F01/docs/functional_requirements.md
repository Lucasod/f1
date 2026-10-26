# Functional Requirements — FS-01 Multi-Vendor Marketplace

## Document Control

**Version:** 2.0 (T-201 — post MP-15 corrections)  
**Status:** Final — responsible review completed (T-204 ✅)  
**Created:** 2026-10-23  
**Updated:** 2026-10-23  
**Author:** MP-15 — T-201 correction and closure  

**Counting Convention:** This document contains 53 main functional requirements (FR-<DOMAIN>-<NNN> in Sections 3.1–3.17) and 6 pending requirements (FR-PEND-<NNN> in Section 4). The grand total is 59 unique requirement IDs. Each requirement has exactly one primary classification (Obrigatório, Derivado, or Pendente). The Appendix A table reflects this convention with a subtotal for main FRs and a separate line for Section 4 pending requirements.  

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Actors & Permissions](#2-actors--permissions)
3. [Functional Requirements by Domain](#3-functional-requirements-by-domain)
   - [3.1 Authentication](#31-authentication)
   - [3.2 User Management](#32-user-management)
   - [3.3 Vendor Management](#33-vendor-management)
   - [3.4 Product & Catalog](#34-product--catalog)
   - [3.5 Search](#35-search)
   - [3.6 Shopping Cart](#36-shopping-cart)
   - [3.7 Checkout & Orders](#37-checkout--orders)
   - [3.8 Payments & Commissions](#38-payments--commissions)
   - [3.9 Coupons & Promotions](#39-coupons--promotions)
   - [3.10 Reviews & Ratings](#310-reviews--ratings)
   - [3.11 Invoices](#311-invoices)
   - [3.12 Admin Dashboard](#312-admin-dashboard)
4. [Pending Requirements](#4-pending-requirements)
5. [Traceability Matrix](#5-traceability-matrix)
6. [Glossary](#6-glossary)

---

## 1. Introduction

### 1.1 Purpose

This document captures the functional requirements for the FS-01 Multi-Vendor E-Commerce Marketplace, a platform enabling multiple vendors to sell products through a unified marketplace with customers.

### 1.2 Scope

This document covers the Minimum Viable Product (MVP) functional requirements derived from:
- Official internship statement (Stages 1-7)
- Confirmed decisions (CD-001 through CD-065)
- Open questions with resolved aspects

Non-functional requirements are covered in the separate NFR document.

### 1.3 References

| Document | Purpose |
|----------|---------|
| `F01/docs/project_context.md` | Official requirements, deliverables, technologies |
| `F01/docs/decisions.md` | Source of truth for confirmed decisions |
| `F01/docs/open_questions.md` | Open questions and partial resolutions |
| `F01/docs/conceptual_model.md` | Domain concepts and relationships |
| `F01/docs/task_list.md` | Project roadmap and dependencies |

---

## 2. Actors & Permissions

### 2.1 Actors

| Actor | Description | Permissions |
|-------|-------------|-------------|
| **Admin** | Platform operator | Platform-wide management (RBAC via Role + PermissionENUM) |
| **Consumer** | Registered buyer | Own account, cart, orders, reviews |
| **Vendor** | Registered seller | Own store, products, coupons, order groups |
| **Person** | Common abstraction (Consumer + Vendor simultaneously possible) | - |

### 2.2 Permission Model

| Actor | Authorization Model | Reference |
|-------|---------------------|-----------|
| Admin | Role-based (Role + PermissionENUM: Read, Read/Write) | CD-004, CD-059 |
| Consumer | Ownership-based isolation | CD-059 |
| Vendor | Ownership-based isolation | CD-059 |

**Constraint:** A Person cannot be both Admin and Consumer/Vendor (CD-003).

---

## 3. Functional Requirements by Domain

### 3.1 Authentication

| ID | FR-AUTH-001 |
|----|-------------|

**Title:** User Authentication via Email and Password

**Description:** The system must authenticate users via email and password credentials. Authentication uses JWT tokens upon successful verification.

**Actors:** Consumer, Vendor, Admin

**Category:** Obrigatório

**Origin:** Stage 2 requirement; CD-009, CD-057

**Concepts:** Person, Credential, Contact_Info

**Acceptance Criteria:**
- **Given** a user provides valid email and password  
  **When** authentication is attempted  
  **Then** a JWT token is issued with claims identifying the Person

- **Given** a user provides invalid credentials  
  **When** authentication is attempted  
  **Then** an authentication error is returned

**Status:** Defined

**Dependencies:** None

---

| ID | FR-AUTH-002 |

**Title:** Credential Association with Person

**Description:** Each Person has exactly one Credential associated for authentication purposes.

**Actors:** Consumer, Vendor, Admin

**Category:** Obrigatório

**Origin:** CD-060

**Concepts:** Person, Credential

**Acceptance Criteria:**
- **Given** a Person exists  
  **When** checking credential count  
  **Then** exactly one Credential record exists for that Person

**Status:** Defined

**Dependencies:** FR-AUTH-001

---

| ID | FR-AUTH-003 |

**Title:** Login Email Uniqueness

**Description:** The email address used for login must be globally unique across the marketplace.

**Actors:** Consumer, Vendor, Admin

**Category:** Obrigatório

**Origin:** CD-060

**Concepts:** Contact_Info

**Acceptance Criteria:**
- **Given** a new user registration  
  **When** the login email is not previously registered  
  **Then** registration succeeds

- **Given** a registration attempt with existing email  
  **When** the email is already used as a login credential  
  **Then** registration fails with "email already in use" error

**Status:** Defined

**Dependencies:** FR-AUTH-001

---

### 3.2 User Management

| ID | FR-USER-001 |

**Title:** Personal Information with Tax ID Constraint

**Description:** Each Person must provide name and exactly one tax identification document — either CPF (individual) or CNPJ (company), never both.

**Actors:** Consumer, Vendor, Admin

**Category:** Obrigatório

**Origin:** CD-007

**Concepts:** Person, Main_Info

**Acceptance Criteria:**
- **Given** a Person registration  
  **When** both CPF and CNPJ are provided  
  **Then** validation fails with "mutually exclusive tax ID" error

- **Given** a Person registration  
  **When** neither CPF nor CNPJ is provided  
  **Then** validation fails with "tax ID required" error

**Status:** Defined

**Dependencies:** FR-AUTH-003

---

| ID | FR-USER-002 |

**Title:** Multiple Addresses per Person

**Description:** A Person may have multiple addresses stored. The first registered address becomes primary by default.

**Actors:** Consumer, Vendor

**Category:** Obrigatório

**Origin:** CD-008, CD-040, CD-061

**Concepts:** Person, Address

**Acceptance Criteria:**
- **Given** a Person registers their first address  
  **Then** that address is marked as primary

- **Given** a Person registers additional addresses  
  **When** no primary designation is specified  
  **Then** the new address is not primary

**Status:** Defined

**Dependencies:** FR-USER-001

---

| ID | FR-USER-003 |

**Title:** Multiple Contact Methods per Person

**Description:** A Person may have multiple contact information records (email, phone, WhatsApp). Each contact has a type, value, and primary flag.

**Actors:** Consumer, Vendor

**Category:** Obrigatório

**Origin:** CD-008

**Concepts:** Person, Contact_Info

**Acceptance Criteria:**
- **Given** a Person creates multiple contacts  
  **When** setting Is_Primary on one  
  **Then** only the designated contact has Is_Primary = true

**Status:** Defined

**Status:** Defined

**Dependencies:** None

**Note:** Allowed contact types and validation rules for Contact_Info.Value remain pending (Q-004 PARTIALLY_RESOLVED). This requirement covers confirmed fields and cardinality only.

**Dependencies:** None

---

| ID | FR-USER-004 |

**Title:** Login Contact Protection

**Description:** The Contact_Info record used for login (email with Type=email) must not be deleted while it is associated with a Person's authentication.

**Actors:** Consumer, Vendor

**Category:** Obrigatório

**Origin:** CD-057

**Concepts:** Contact_Info, Person

**Acceptance Criteria:**
- **Given** an email listed as login contact  
  **When** user attempts to delete that contact  
  **Then** deletion is rejected

**Status:** Defined

**Dependencies:** FR-AUTH-003

---

### 3.3 Vendor Management

| ID | FR-VEND-001 |

**Title:** Auto-Publish Vendor Onboarding

**Description:** Vendors may publish their products immediately after registration without prior Admin approval.

**Actors:** Vendor, Admin

**Category:** Obrigatório

**Origin:** CD-041

**Concepts:** Person, Vendor

**Acceptance Criteria:**
- **Given** a new Vendor completes registration  
  **When** all required fields are provided  
  **Then** Vendor status is Active and products may be created immediately

**Status:** Defined

**Dependencies:** FR-USER-001

---

| ID | FR-VEND-002 |

**Title:** Vendor Suspension Capability

**Description:** Admin may suspend a Vendor for policy violations. Suspended Vendors cannot sell products or fulfill orders.

**Actors:** Admin

**Category:** Derivado

**Justification:** Required for abuse control as CD-041 indicates suspension as a reactive mechanism. This requirement covers the suspension capability only; a full suspension state machine is deferred as TECHNICAL_FUTURE per D-020.

**Origin:** CD-041

**Concepts:** Vendor

**Acceptance Criteria:**
- **Given** a Vendor is suspended  
  **When** checking vendor status  
  **Then** status = Suspended and vendor cannot create/update products

**Status:** Defined

**Dependencies:** FR-VEND-001

---

| ID | FR-VEND-003 |

**Title:** Vendor Dashboard Metrics Scope

**Description:** The Vendor dashboard displays only vendor-scoped metrics: order count, gross sales (before commission), pending/completed orders, and best-selling products. Vendors must not access other Vendors' data.

**Actors:** Vendor

**Category:** Obrigatório

**Origin:** CD-051

**Concepts:** Order, Order_Vendor_Group, Transaction

**Acceptance Criteria:**
- **Given** a Vendor accesses their dashboard  
  **Then** metrics reflect only products/orders belonging to that Vendor

- **Given** a Vendor attempts to access another Vendor's data  
  **When** the request targets another Vendor's orders/products  
  **Then** the request is denied

**Status:** Defined

**Dependencies:** FR-ORDER-001

---

### 3.4 Product & Catalog

| ID | FR-PROD-001 |

**Title:** Product Creation by Vendor

**Description:** A Vendor offers Products with name, description, price, quantity (current stock), and category. Each product variation requires a separate Product entry.

**Actors:** Vendor

**Category:** Obrigatório

**Origin:** CD-011, CD-013, CD-062

**Concepts:** Vendor, Product, Category

**Acceptance Criteria:**
- **Given** a Vendor creates a product  
  **When** price, quantity, and category are provided  
  **Then** product is created and listed in vendor's catalog

- **Given** a product with Quantity = 0  
  **When** customers view the catalog  
  **Then** product appears after in-stock items

**Status:** Defined

**Dependencies:** FR-VEND-001

---

| ID | FR-PROD-002 |

**Title:** Product Inactivation

**Description:** Products can be inactivated to prevent new sales while retaining historical records and order references.

**Actors:** Vendor, Admin

**Category:** Obrigatório

**Origin:** CD-042

**Concepts:** Product

**Acceptance Criteria:**
- **Given** a product is inactivated  
  **When** a new order is created  
  **Then** the inactivated product cannot be added to cart

- **Given** a product is inactivated  
  **When** viewing existing orders with that product  
  **Then** the product remains visible with historical price

**Status:** Defined

**Dependencies:** FR-PROD-001

---

| ID | FR-PROD-003 |

**Title:** Product Quantity as Stock Indicator

**Description:** Product.Quantity represents current stock level. Products with quantity > 0 appear first in listings; out-of-stock products appear after.

**Actors:** Vendor, Consumer

**Category:** Obrigatório

**Origin:** CD-013

**Concepts:** Product

**Acceptance Criteria:**
- **Given** two products A (stock=10) and B (stock=0)  
  **When** viewing catalog  
  **Then** A appears before B

**Status:** Defined

**Dependencies:** FR-PROD-001

---

| ID | FR-PROD-004 |

**Title:** Category Hierarchy with Cycle Prevention

**Description:** Categories support parent/child hierarchy via optional parent_id. A category may have many children but at most one parent. Multilevel hierarchies are supported; cycle prevention is required at implementation.

**Actors:** Admin, Vendor

**Category:** Obrigatório

**Origin:** CD-043

**Concepts:** Category

**Acceptance Criteria:**
- **Given** a category creation with parent_id  
  **When** the parent_id would create a cycle  
  **Then** creation is rejected

- **Given** a root category (parent_id = null)  
  **Then** it has no parent

**Status:** Defined

**Dependencies:** None

---

| ID | FR-PROD-005 |

**Title:** Product Images

**Description:** Products may have multiple images stored. Images are associated via Product_Pic entity with path reference to storage (AWS S3).

**Actors:** Vendor

**Category:** Obrigatório

**Origin:** CD-016

**Concepts:** Product, Product_Pic

**Acceptance Criteria:**
- **Given** a Vendor uploads images for a product  
  **When** images are successfully stored  
  **Then** product listing shows thumbnail gallery

**Status:** Defined

**Status:** Defined

**Dependencies:** FR-PROD-001

**Note:** Image storage strategy (S3 path naming, thumbnail generation) is deferred as TECHNICAL_FUTURE per Q-018. This requirement covers product-image association only.

**Dependencies:** FR-PROD-001

---

| ID | FR-PROD-006 |

**Title:** No Product Variants in MVP

**Description:** Product variants (size, color) are not modeled as separate entities. Each distinct product variation is a separate Product with its own stock.

**Actors:** Vendor

**Category:** Obrigatório

**Origin:** CD-062

**Concepts:** Product

**Acceptance Criteria:**
- **Given** a "t-shirt" in red and blue  
  **When** vendor lists products  
  **Then** two separate Product entries exist (one for red, one for blue)

**Status:** Defined

**Dependencies:** FR-PROD-001

---

### 3.5 Search

| ID | FR-SRCH-001 |

**Title:** Product Search with Elasticsearch

**Description:** The system uses Elasticsearch for product search, filtering, and sorting. MongoDB remains the source of truth for product data.

**Actors:** Consumer

**Category:** Obrigatório

**Origin:** CD-049

**Concepts:** Product, Category

**Acceptance Criteria:**
- **Given** a search query is submitted  
  **When** matching products exist  
  **Then** relevant products are returned ranked by relevance

- **Given** a product is updated/deleted in MongoDB  
  **When** search is performed  
  **Then** Elasticsearch index is eventually consistent (rebuildable from MongoDB)

**Status:** Defined

**Dependencies:** FR-PROD-001

---

| ID | FR-SRCH-002 |

**Title:** Search Filtering and Sorting

**Description:** Search results support filtering by category (including descendants) and sorting by relevance, price, or other criteria.

**Actors:** Consumer

**Category:** Derivado

**Justification:** Required to allow consumers to filter products by category and sorting, completing the search flow initiated in FR-SRCH-001.

**Origin:** Stage 4 requirement

**Concepts:** Product, Category

**Acceptance Criteria:**
- **Given** categories are defined with hierarchy  
  **When** filtering by a parent category  
  **Then** products from child categories are included

- **Given** sorting options are available  
  **When** user selects a sort criterion  
  **Then** results are re-ordered accordingly

**Status:** Defined

**Dependencies:** FR-SRCH-001, FR-PROD-004

**Status:** Defined

**Dependencies:** FR-SRCH-001, FR-PROD-004

**Note:** Specific Elasticsearch mapping, analyzers, and synchronization mechanism are deferred as TECHNICAL_FUTURE per Q-015. This requirement covers confirmed filtering and sorting behaviors only.

---

### 3.6 Shopping Cart

| ID | FR-CART-001 |

**Title:** Multi-Vendor Cart

**Description:** The shopping cart may contain products from multiple vendors.

**Actors:** Consumer

**Category:** Obrigatório

**Origin:** CD-019

**Concepts:** Product

**Acceptance Criteria:**
- **Given** a consumer adds products from Vendor A and Vendor B  
  **When** viewing cart  
  **Then** products from both vendors are listed

**Status:** Defined

**Dependencies:** FR-PROD-001

---

| ID | FR-CART-002 |

**Title:** Cart Persistence in Redis

**Description:** The cart is stored in Redis as session state and does not need to be a persisted entity in the conceptual model.

**Actors:** Consumer

**Category:** Obrigatório

**Origin:** CD-018

**Concepts:** Cart

**Acceptance Criteria:**
- **Given** a consumer adds items to cart  
  **When** session is maintained  
  **Then** cart contents persist across page navigations

**Status:** Defined

**Dependencies:** FR-CART-001

**Note:** Redis keys, TTL, sync strategy are TECHNICAL_FUTURE (Q-014)

---

| ID | FR-CART-003 |

**Title:** Cart Operations

**Description:** Consumers may add, update quantity, and remove items from their cart.

**Actors:** Consumer

**Category:** Obrigatório

**Origin:** Stage 5 requirement

**Concepts:** Cart, Product

**Acceptance Criteria:**
- **Given** a cart contains an item  
  **When** consumer updates quantity  
  **Then** item quantity is updated

- **Given** a cart contains an item  
  **When** consumer removes the item  
  **Then** item is no longer in cart

- **Given** a cart contains an item  
  **When** quantity is set to 0  
  **Then** item is removed from cart

**Status:** Defined

**Dependencies:** FR-CART-001

---

### 3.7 Checkout & Orders

| ID | FR-ORDER-001 |

**Title:** Order Creation with Multi-Vendor Grouping

**Description:** At checkout, an Order is created containing Order_Vendor_Groups, one for each vendor with products in the cart. Each Order_Vendor_Group contains Order_Items.

**Actors:** Consumer

**Category:** Obrigatório

**Origin:** CD-020, CD-021

**Concepts:** Order, Order_Vendor_Group, Order_Item

**Acceptance Criteria:**
- **Given** a cart with products from Vendors A, B, C  
  **When** checkout is completed  
  **Then** one Order is created with three Order_Vendor_Groups (A, B, C)

**Status:** Defined

**Dependencies:** FR-CART-001, FR-PROD-001

---

| ID | FR-ORDER-002 |

**Title:** Checkout Address Snapshot

**Description:** At checkout, the Consumer may select a registered address. The chosen address fields (Street, Number, Neighborhood, City, State) are copied as an immutable snapshot to the Order. Subsequent changes to the Person's addresses do not affect existing Order snapshots.

**Actors:** Consumer

**Category:** Obrigatório

**Origin:** CD-061

**Concepts:** Order, Address

**Acceptance Criteria:**
- **Given** a consumer has multiple addresses  
  **When** completing checkout  
  **Then** the selected address is copied to the Order as a snapshot

- **Given** an Order exists with address snapshot  
  **When** the Person's address is updated  
  **Then** the Order's address snapshot remains unchanged

**Status:** Defined

**Dependencies:** FR-ORDER-001, FR-USER-002

---

| ID | FR-ORDER-003 |

**Title:** Order Persistence on Payment Failure

**Description:** An Order may continue to exist even when payment fails or is abandoned. Failed payment attempts are preserved for audit trail.

**Actors:** Consumer, Admin

**Category:** Obrigatório

**Origin:** CD-024

**Concepts:** Order, Payment

**Acceptance Criteria:**
- **Given** a payment attempt fails  
  **When** checking Order status  
  **Then** Order exists with status indicating failure and Payment record is preserved

**Status:** Defined

**Dependencies:** FR-ORDER-001

---

| ID | FR-ORDER-004 |

**Title:** Order Status State Machine

**Description:** Orders have an independent lifecycle state machine with states: PENDING_PAYMENT → PAID → PROCESSING → SHIPPED → DELIVERED. Terminal states: FAILED_PAYMENT (payment attempts exhausted). CANCELLED is an unconfirmed proposal for the lifecycle state machine (per CD-058, CD-063) and not yet approved for MVP.

**Actors:** Consumer, Vendor, Admin

**Category:** Obrigatório

**Origin:** CD-063

**Concepts:** Order

**Acceptance Criteria:**
- **Given** an Order is created  
  **Then** initial state is PENDING_PAYMENT

- **Given** payment is captured  
  **When** webhook confirms  
  **Then** Order state transitions to PAID

- **Given** all Order_Vendor_Groups are SHIPPED  
  **When** status check  
  **Then** Order state is SHIPPED

- **Given** no Order_Vendor_Group has SHIPPED/DELIVERED  
  **When** consumer requests cancellation  
  **Then** Order state transitions to CANCELLED (proposal — not yet confirmed)

**Status:** Defined

**Dependencies:** FR-ORDER-001

---

| ID | FR-ORDER-005 |

**Title:** Historical Order Item Pricing

**Description:** Order_Item maintains the historical unit price at time of purchase. Price changes to catalog products do not affect existing orders.

**Actors:** Consumer, Vendor

**Category:** Obrigatório

**Origin:** CD-023

**Concepts:** Order_Item, Product

**Acceptance Criteria:**
- **Given** an Order_Item is created  
  **When** checking Order_Item.Price  
  **Then** it contains the Product.Price at time of purchase

- **Given** a Product's price changes after an order  
  **When** viewing the order  
  **Then** the price in Order_Item is unchanged

**Status:** Defined

**Dependencies:** FR-ORDER-001

---

| ID | FR-ORDER-006 |

**Title:** Vendor-Independent Fulfillment Status

**Description:** Each Order_Vendor_Group has an independent fulfillment state machine: PENDING → CONFIRMED → PREPARING → SHIPPED → DELIVERED. Terminal states: RETURNED. CANCELLED is an unconfirmed proposal for the fulfillment state machine (per CD-058, CD-063) and not yet approved for MVP.

**Actors:** Vendor, Consumer

**Category:** Obrigatório

**Origin:** CD-063

**Concepts:** Order_Vendor_Group

**Acceptance Criteria:**
- **Given** an Order with multiple Order_Vendor_Groups  
  **When** Vendor A confirms their group  
  **Then** only Vendor A's Group transitions to CONFIRMED; other groups remain in PENDING

**Status:** Defined

**Dependencies:** FR-ORDER-001

---

| ID | FR-ORDER-007 |

**Title:** Aggregate Financial Status

**Description:** Order has an aggregate financial status derived from Order_Vendor_Group refund states: FULLY_REFUNDED (all groups refunded), PARTIALLY_REFUNDED (at least one refunded but not all), PAID (captured payment, no refunds, lifecycle not terminal).

**Actors:** Consumer, Vendor, Admin

**Category:** Obrigatório

**Origin:** CD-058

**Concepts:** Order, Order_Vendor_Group, Refund

**Acceptance Criteria:**
- **Given** all Order_Vendor_Groups are FULLY_REFUNDED  
  **When** checking Order financial status  
  **Then** status is FULLY_REFUNDED

- **Given** at least one Order_Vendor_Group has a refund  
  **When** not all groups are fully refunded  
  **Then** status is PARTIALLY_REFUNDED

- **Given** payment is captured and no refunds  
  **When** lifecycle not in terminal state  
  **Then** status is PAID

**Status:** Defined

**Dependencies:** FR-ORDER-001

---

### 3.8 Payments & Commissions

| ID | FR-PAY-001 |

**Title:** Payment Provider Integration (Stripe Connect)

**Description:** The system integrates with Stripe Connect using Separate Charges and Transfers. A single Charge is created on the platform account per Order. One Transfer is created per Order_Vendor_Group to the vendor's connected account.

**Actors:** Consumer, Vendor, Admin

**Category:** Obrigatório

**Origin:** CD-064

**Concepts:** Payment, Order, Order_Vendor_Group, Vendor, Wallet

**Acceptance Criteria:**
- **Given** checkout is completed  
  **When** payment is processed  
  **Then** a single Charge is created on platform account for order total

- **Given** a Charge is captured  
  **When** webhook confirms  
  **Then** Transfers are queued for each Order_Vendor_Group

**Status:** Defined

**Dependencies:** FR-ORDER-001, FR-VEND-001

**Note:** Transaction currency is not yet defined (Q-026 PARTIALLY_RESOLVED, FR-PEND-001). CD-064 references BRL for Stripe Connect configuration; final currency decision pending.

---

| ID | FR-PAY-002 |

**Title:** Commission Calculation

**Description:** Commission is calculated as a global percentage applied to each Order_Vendor_Group. The vendor receives the remaining amount (ovg_total × (1 - commission_pct/100)).

**Actors:** Vendor, Admin

**Category:** Obrigatório

**Origin:** CD-045

**Concepts:** Order_Vendor_Group, Transaction

**Acceptance Criteria:**
- **Given** an Order_Vendor_Group total is 100 currency units and commission is 10%  
  **When** payment is processed  
  **Then** vendor receives 90 currency units and platform retains 10 currency units (minus fees)

**Status:** Defined

**Dependencies:** FR-PAY-001

**Note:** Transaction currency is not yet defined (Q-026 PARTIALLY_RESOLVED, FR-PEND-001). Example uses generic currency units.

---

| ID | FR-PAY-003 |

**Title:** Payment State Machine

**Description:** Payment has independent state machine: PENDING → AUTHORIZED → CAPTURED. Terminal states: FAILED, REFUNDED.

**Actors:** Consumer, Admin

**Category:** Obrigatório

**Origin:** CD-063

**Concepts:** Payment

**Acceptance Criteria:**
- **Given** payment is initiated  
  **Then** Payment state is PENDING

- **Given** provider authorizes amount  
  **When** webhook confirms  
  **Then** Payment state is AUTHORIZED

- **Given** provider captures funds  
  **When** webhook confirms  
  **Then** Payment state is CAPTURED

**Status:** Defined

**Dependencies:** FR-PAY-001

---

| ID | FR-PAY-004 |

**Title:** Multiple Payment Attempts Preserved

**Description:** An Order can have multiple Payment attempts, including failed attempts which are preserved for audit.

**Actors:** Consumer, Admin

**Category:** Obrigatório

**Origin:** CD-028

**Concepts:** Payment, Order

**Acceptance Criteria:**
- **Given** a payment fails  
  **When** a retry is attempted  
  **Then** the failed Payment record is preserved in Order.Payments

**Status:** Defined

**Dependencies:** FR-PAY-003

---

| ID | FR-PAY-005 |

**Title:** Vendor Fulfillment Trigger on Confirmation

**Description:** Vendor fulfillment processing begins when the Vendor explicitly confirms their Order_Vendor_Group (OVG transitions from PENDING to CONFIRMED). This trigger is independent of and not gated by Transfer completion.

**Actors:** Vendor

**Category:** Obrigatório

**Origin:** CD-065 (rule 5)

**Concepts:** Order_Vendor_Group, Payment, Transfer

**Acceptance Criteria:**
- **Given** an Order is PAID (Charge captured)  
  **When** all OVGs are in PENDING state  
  **Then** Vendor may confirm their OVG to start fulfillment

- **Given** a Vendor confirms their OVG  
  **When** checking OVG state  
  **Then** OVG transitions to CONFIRMED regardless of Transfer status

**Status:** Defined

**Dependencies:** FR-PAY-001, FR-ORDER-006

---

| ID | FR-PAY-006 |

**Title:** Commission Adjustment on Refund

**Description:** When a refund is processed (partial or full), the platform recalculates and adjusts the commission consistently with the refunded amount. The commission adjustment corresponds to the proportion of the refunded Order_Vendor_Group total.

**Actors:** Admin, System

**Category:** Obrigatório

**Origin:** CD-048, CD-065 (rule 8)

**Concepts:** Refund, Order_Vendor_Group, Transaction, Wallet

**Acceptance Criteria:**
- **Given** a partial refund is processed for an Order_Vendor_Group  
  **When** refund is confirmed  
  **Then** commission is recalculated proportionally and adjusted in platform and Vendor ledgers

- **Given** a full refund is processed for an Order_Vendor_Group  
  **When** refund is confirmed  
  **Then** full commission for that OVG is reversed

**Status:** Defined

**Dependencies:** FR-REFUND-001, FR-PAY-002

---

| ID | FR-PAY-007 |

**Title:** Payment and Transfer Idempotency

**Description:** All payment and transfer operations use idempotency keys to prevent duplicate financial operations. PaymentIntent uses Stripe's native idempotency_key. Transfers use an application-level idempotency key (order_id:ovg_id:attempt) with pre-check.

**Actors:** System

**Category:** Obrigatório

**Origin:** CD-064, CD-065

**Concepts:** Payment, Transfer, Transaction

**Acceptance Criteria:**
- **Given** a PaymentIntent creation request with idempotency_key  
  **When** request is retried with same key  
  **Then** no duplicate Charge is created

- **Given** a Transfer creation request with application-level idempotency key  
  **When** request is retried with same key  
  **Then** no duplicate Transfer is created

**Status:** Defined

**Dependencies:** FR-PAY-001

---

| ID | FR-PAY-008 |

**Title:** Async Payment Handling (PIX/Boleto)

**Description:** For asynchronous payment methods (PIX, Boleto), the system waits for the `charge.succeeded` webhook before creating Transfers to vendors. The `source_transaction` parameter is not used for async payments.

**Actors:** Consumer, Vendor, System

**Category:** Obrigatório

**Origin:** CD-065 (rule 10)

**Concepts:** Payment, Charge, Transfer, Order_Vendor_Group

**Acceptance Criteria:**
- **Given** an async payment (PIX/Boleto) is initiated  
  **When** `charge.succeeded` webhook is received  
  **Then** Payment transitions to CAPTURED and Transfers are created for each OVG

- **Given** an async payment is pending  
  **When** checking Transfer status  
  **Then** no Transfers exist until charge succeeds

**Status:** Defined

**Dependencies:** FR-PAY-001, FR-PAY-003

### 3.9 Refunds & Financial Adjustments

| ID | FR-REFUND-001 |

**Title:** Partial and Full Refunds by Item Selection

**Description:** Refunds can be partial or full. Consumers select products and quantities to refund. The system groups items by vendor and generates corresponding financial adjustments.

**Actors:** Consumer, Vendor, Admin

**Category:** Obrigatório

**Origin:** CD-032, CD-048

**Concepts:** Refund, Order_Item, Order_Vendor_Group, Transaction

**Acceptance Criteria:**
- **Given** an Order contains items from Vendor A and B  
  **When** Consumer requests refund for specific items  
  **Then** refund generates Transactions grouped by vendor

**Status:** Defined

**Dependencies:** FR-ORDER-007

---

| ID | FR-REFUND-002 |

**Title:** Refund Processing via Provider

**Description:** The marketplace initiates customer refunds through the payment provider using the original payment method. Refund status "sent" means the request was sent to the provider, not necessarily that money was returned.

**Actors:** Consumer, Vendor, Admin

**Category:** Obrigatório

**Origin:** CD-048

**Concepts:** Refund, Payment

**Acceptance Criteria:**
- **Given** a valid refund request  
  **When** processed  
  **Then** refund is initiated via Stripe Connect API

**Status:** Defined

**Dependencies:** FR-REFUND-001

---

| ID | FR-REFUND-003 |

**Title:** Refund State Independent of Fulfillment

**Description:** Payment state and fulfillment state are distinct concepts. A refund does not automatically cancel or change the Order_Vendor_Group's fulfillment status.

**Actors:** Consumer, Vendor

**Category:** Obrigatório

**Origin:** CD-025

**Concepts:** Refund, Order_Vendor_Group, Payment

**Acceptance Criteria:**
- **Given** a refund is initiated  
  **When** checking Order_Vendor_Group status  
  **Then** fulfillment status remains unchanged unless manually updated

**Status:** Defined

**Dependencies:** FR-REFUND-001

---

### 3.10 Coupons & Promotions

| ID | FR-COUPON-001 |

**Title:** Vendor-Created Coupons

**Description:** A Vendor may create multiple different coupons.

**Actors:** Vendor

**Category:** Obrigatório

**Origin:** MP-07E rule 1

**Concepts:** Coupon, Vendor

**Acceptance Criteria:**
- **Given** a Vendor creates coupons  
  **When** checking coupon list  
  **Then** all created coupons are visible in vendor's coupon management

**Status:** Defined

**Dependencies:** FR-VEND-001

---

| ID | FR-COUPON-002 |

**Title:** Multi-Vendor Coupon Application

**Description:** A purchase may utilize coupons from different vendors.

**Actors:** Consumer

**Category:** Obrigatório

**Origin:** MP-07E rule 2

**Concepts:** Order, Order_Vendor_Group, Coupon

**Acceptance Criteria:**
- **Given** cart contains products from Vendor A and B  
  **When** checkout is completed  
  **Then** one eligible coupon from each vendor may be applied

**Status:** Defined

**Dependencies:** FR-COUPON-001

---

| ID | FR-COUPON-003 |

**Title:** Maximum One Coupon per Vendor

**Description:** No more than one coupon from each vendor can be applied to the same purchase. There is no automatic priority between coupons; the consumer selects which eligible coupon to use.

**Actors:** Consumer

**Category:** Obrigatório

**Origin:** MP-07E rules 3, 5, 6

**Concepts:** Order_Vendor_Group, Coupon

**Acceptance Criteria:**
- **Given** Vendor A has coupons CODE1 and CODE2  
  **When** checkout with products from Vendor A  
  **Then** consumer selects exactly one of CODE1 or CODE2

- **Given** cart contains products from Vendor A, B, C  
  **When** coupons are applied  
  **Then** at most one coupon from each vendor is applied

**Status:** Defined

**Dependencies:** FR-COUPON-002

---

| ID | FR-COUPON-004 |

**Title:** Coupon Targeting by Products and Categories

**Description:** Coupons target specific products and/or categories. Including a category includes its descendants; excluding a category excludes its descendants; exclusions override inclusions.

**Actors:** Vendor, Consumer

**Category:** Obrigatório

**Origin:** CD-050

**Concepts:** Coupon, Coupon_Target, Product, Category

**Acceptance Criteria:**
- **Given** a coupon targets Category X  
  **When** Category X has child Category Y  
  **Then** products in Y are eligible

- **Given** a coupon excludes Category X  
  **When** Category X has child Category Y  
  **Then** products in Y are ineligible

- **Given** a product is both included and excluded  
  **When** checking eligibility  
  **Then** exclusion takes precedence

**Status:** Defined

**Dependencies:** FR-PROD-001, FR-PROD-004

---

| ID | FR-COUPON-005 |

**Title:** Coupon Applicability per Order_Vendor_Group

**Description:** Coupons are applied at the Order_Vendor_Group level and only apply to products from that vendor.

**Actors:** Vendor, Consumer

**Category:** Derivado

**Justification:** Required to complete the coupon applicability flow defined in FR-COUPON-001 through FR-COUPON-004, formally linking coupons to the Order_Vendor_Group structure.

**Origin:** CD-026

**Concepts:** Order_Vendor_Group, Coupon

**Acceptance Criteria:**
- **Given** an Order_Vendor_Group has associated Coupon  
  **When** calculating Order_Vendor_Group total  
  **Then** coupon discount is applied to the group's items

**Status:** Defined

**Dependencies:** FR-COUPON-001, FR-ORDER-001

---

| ID | FR-COUPON-006 |

**Title:** Coupon Eligibility Validation

**Description:** At checkout, the system validates coupon eligibility based on validity period, target products/categories, and minimum order value (if defined).

**Actors:** Consumer

**Category:** Obrigatório

**Origin:** CD-026, CD-050

**Concepts:** Coupon

**Acceptance Criteria:**
- **Given** a coupon code is entered  
  **When** validity period is outside current date  
  **Then** coupon is rejected as expired

- **Given** a coupon targets specific products  
  **When** cart contains different products  
  **Then** coupon is rejected as not applicable

**Status:** Defined

**Status:** Defined

**Dependencies:** FR-COUPON-003

**Note:** Discount calculation formula for mixed eligible/ineligible cart contents remains pending (Q-016 PARTIALLY_RESOLVED, FR-PEND-004). This requirement covers eligibility validation only.

**Dependencies:** FR-COUPON-003

---

### 3.11 Reviews & Ratings

| ID | FR-RW-001 |

**Title:** Review Creation by Verified Purchaser

**Description:** A review can only be made by someone who purchased the product. The system must verify the purchase through the Order_Item.

**Actors:** Consumer

**Category:** Obrigatório

**Origin:** CD-017

**Concepts:** Review, Order_Item

**Acceptance Criteria:**
- **Given** a product is eligible for review  
  **When** consumer has a completed purchase (Order_Item with Order in DELIVERED state) for that product  
  **Then** review creation is allowed

- **Given** a consumer attempts to review without purchase  
  **When** review submission is attempted  
  **Then** submission is rejected

- **Given** a consumer has a purchase in PAID, PROCESSING, or SHIPPED state  
  **When** review submission is attempted  
  **Then** submission is rejected (must wait for DELIVERED)

**Status:** Defined

**Dependencies:** FR-ORDER-004

**Origin:** CD-017, CD-072

**Note:** CD-072 (MP-08) confirms DELIVERED as the qualifying state for review eligibility. This provides the highest confidence that the consumer has received and used the product. DELIVERED is a terminal fulfillment state per CD-063 (Order_Vendor_Group = DELIVERED → Order = DELIVERED).

---

### 3.12 Invoices

| ID | FR-INV-001 |

**Title:** Commercial Receipt (PDF) Generation

**Description:** Invoice represents a commercial document/receipt in PDF format, not a Brazilian fiscal invoice (NF-e). Invoice uses historical Order values.

**Actors:** Consumer, Vendor

**Category:** Obrigatório

**Origin:** CD-035, CD-036

**Concepts:** Invoice, Order

**Acceptance Criteria:**
- **Given** an Order reaches the invoice generation trigger (trigger pending per Q-018, FR-PEND-005)  
  **When** invoice is generated  
  **Then** it contains Order items, quantities, prices, and totals at time of purchase

**Status:** Defined

**Dependencies:** FR-ORDER-007

**Note:** Invoice generation trigger (on payment, on delivery, on-demand) is pending per Q-018 PARTIALLY_RESOLVED (FR-PEND-005). This requirement covers invoice content and scope only.

---

| ID | FR-INV-002 |

**Title:** Invoice Immutability on Partial Refund

**Description:** A partial refund does not rewrite the original invoice. Refunds generate separate documentation.

**Actors:** Consumer, Vendor

**Category:** Obrigatório

**Origin:** CD-037

**Concepts:** Invoice, Refund

**Acceptance Criteria:**
- **Given** a partial refund is processed  
  **When** viewing original invoice  
  **Then** invoice content is unchanged; separate refund document is created

**Status:** Defined

**Dependencies:** FR-INV-001

---

### 3.13 Admin Dashboard

| ID | FR-ADMIN-001 |

**Title:** Platform Management Capabilities

**Description:** Admin manages the platform through RBAC with roles and permissions defined by Role and PermissionENUM (Read, Read/Write).

**Actors:** Admin

**Category:** Obrigatório

**Origin:** CD-004

**Concepts:** Admin, Role, PermissionENUM

**Acceptance Criteria:**
- **Given** an Admin accesses a protected endpoint  
  **When** the endpoint requires a specific permission  
  **Then** access is granted only if Admin's Role includes that permission

**Status:** Defined

**Dependencies:** FR-AUTH-001

---

### 3.14 Notifications

| ID | FR-NOTIF-001 |

**Title:** Manual Refresh MVP

**Description:** The MVP uses a manual Refresh/Update button for users to get latest data. Automatic notifications, push, WebSockets, and event-driven notification infrastructure are not required for MVP.

**Actors:** Consumer, Vendor

**Category:** Obrigatório

**Origin:** CD-055

**Concepts:** Order, Order_Vendor_Group, Payment

**Acceptance Criteria:**
- **Given** a user is on any page  
  **When** clicking Refresh/Update button  
  **Then** latest status from backend is fetched and displayed

**Status:** Defined

**Dependencies:** None

---

### 3.15 Wallet & Transactions

| ID | FR-WALLET-001 |

**Title:** Vendor Wallet with Transaction History

**Description:** Each Vendor has a Wallet that tracks transaction history (sales, commissions, refunds, transfers). Balance derives from transactions.

**Actors:** Vendor, Admin

**Category:** Obrigatório

**Origin:** CD-030, CD-031

**Concepts:** Wallet, Transaction, Vendor

**Acceptance Criteria:**
- **Given** a payment is captured for a Vendor  
  **When** checking Wallet balance  
  **Then** Transaction record shows SALE and balance increases by vendor_net

- **Given** a refund is processed  
  **When** checking Wallet  
  **Then** Transaction record shows REFUND and balance decreases

**Status:** Defined

**Dependencies:** FR-PAY-001

---

| ID | FR-TRANS-001 |

**Title:** Transaction Types for Financial Ledger

**Description:** Transaction represents a generic record of financial movement with types: sale, commission, refund, payout, adjustment.

**Actors:** System

**Category:** Obrigatório

**Origin:** CD-031

**Concepts:** Transaction, Wallet

**Acceptance Criteria:**
- **Given** a transaction is created  
  **When** checking Transaction.Type  
  **Then** it is one of: sale, commission, refund, payout, adjustment

**Status:** Defined

**Dependencies:** FR-WALLET-001

---

### 3.16 Historical Records

| ID | FR-HIST-001 |

**Title:** Append-Only History Preservation

**Description:** All history records (*_History) must preserve previous records without overwriting the past. History entities are append-only.

**Actors:** System

**Category:** Obrigatório

**Origin:** CD-033

**Concepts:** Order_Status_History, Order_Vendor_Group_History

**Acceptance Criteria:**
- **Given** an order status changes  
  **When** status update is recorded  
  **Then** previous status remains in history; new entry is appended

**Status:** Defined

**Dependencies:** FR-ORDER-004

---

| ID | FR-HIST-002 |

**Title:** Order Data Snapshot Preservation

**Description:** Order snapshots must preserve purchase-time product name, price, quantity, and Vendor identity. Changes to catalog data after purchase do not affect historical order data.

**Actors:** Consumer, Vendor, Admin

**Category:** Obrigatório

**Origin:** CD-052

**Concepts:** Order, Order_Item, Order_Vendor_Group, Product

**Acceptance Criteria:**
- **Given** a Product's price changes after an Order is created  
  **When** viewing the Order  
  **Then** the Order_Item shows the original price

**Status:** Defined

**Dependencies:** FR-ORDER-005

---

### 3.17 Data Integrity

| ID | FR-DATA-001 |

**Title:** Email Protected During Registration Change

**Description:** When a Person changes their login email, the old email must be freed up for reuse, but the new email must pass uniqueness validation.

**Actors:** Consumer, Vendor

**Category:** Derivado

**Justification:** Required to complete the credential management flow defined in FR-AUTH-003, allowing login email changes.

**Origin:** CD-057, CD-060

**Concepts:** Contact_Info, Credential

**Acceptance Criteria:**
- **Given** a user changes their login email  
  **When** validation passes  
  **Then** the old email is available for new registration and new email is unique

**Status:** Defined

**Dependencies:** FR-AUTH-003

---

## 4. Pending Requirements

### 4.1 Currency Definition

| ID | FR-PEND-001 |

**Title:** Transaction Currency Definition

**Description:** The transaction currency for the marketplace has been defined as **BRL (Brazilian Real)** for the MVP scope. The interface language is confirmed as English (CD-054). Stripe Connect Separate Charges and Transfers supports BRL in Brazil (CD-064).

**Actors:** System

**Category:** Obrigatório

**Origin:** Q-026; CD-054, CD-064

**Concepts:** Price, Payment, Wallet, Transaction

**Affected Behavior:** All monetary values displayed and processed use BRL. Payment provider integration validated for BRL in Brazil.

**Decision Required:** None — currency defined as BRL.

**Status:** **Resolvido** (BRL definido para MVP)

---

### 4.2 Search Implementation Details

| ID | FR-PEND-002 |

**Title:** Elasticsearch Mapping and Synchronization

**Description:** Elasticsearch mapping, analyzers, and synchronization mechanisms have not been defined.

**Actors:** System

**Category:** Pendente

**Origin:** Q-015

**Concepts:** Product, Category

**Affected Behavior:** Search result quality, indexing performance, data consistency between MongoDB and Elasticsearch depends on mapping and sync strategy.

**Decision Required:** Define index mapping, analyzer strategy, and synchronization mechanism (real-time vs batch).

**Status:** Pendente

---

### 4.3 Review Moderation Policy

| ID | FR-PEND-003 |

**Title:** Review Moderation and Display Policy

**Description:** All seven review moderation/display decisions have been resolved (MP-08): (1) Moderation policy → Post-moderation (CD-067); (2) Vendor response → Not permitted (CD-068); (3) Verified purchase badge → Not displayed (CD-069); (4) Rating scale → 1-5 stars (CD-070); (5) Aggregation method → Simple arithmetic mean (CD-070); (6) Verified purchase qualifying state → DELIVERED (CD-072); (7) Review images → Owned images permitted (CD-071).

**Actors:** Consumer, Vendor, Admin

**Category:** **Resolvido**

**Origin:** Q-017, CD-067, CD-068, CD-069, CD-070, CD-071, CD-072

**Concepts:** Review

**Affected Behavior:** Review workflow (immediate publish, admin can hide/reject), no vendor response field, no verified purchase badge, 1-5 star rating with simple mean aggregation, review eligibility requires DELIVERED state, user-uploaded review images permitted.

**Decision Required:** None — all seven decisions approved in MP-08.

**Status:** **Resolvido**

---

### 4.4 Mixed Cart Discount Calculation

| ID | FR-PEND-004 |

**Title:** Discount Calculation for Mixed Eligible/Ineligible Cart Contents

**Description:** When a cart contains both products that are eligible for a coupon and products that are not, the discount calculation formula has not been defined.

**Actors:** Consumer

**Category:** Pendente

**Origin:** Q-016

**Concepts:** Coupon, Order_Vendor_Group

**Affected Behavior:** How discounts are applied when only some items in a vendor group qualify for a coupon.

**Decision Required:** Define whether discount applies only to eligible items, whether ineligible items block the coupon, or other formula.

**Status:** Pendente

---

### 4.5 Invoice Generation Trigger

| ID | FR-PEND-005 |

**Title:** Invoice Generation Timing and Storage

**Description:** The trigger for invoice generation (on payment, on delivery, on-demand), PDF template design, and storage location (S3 or DB) have not been decided.

**Actors:** Consumer, Vendor

**Category:** Pendente

**Origin:** Q-018 TECHNICAL_FUTURE

**Concepts:** Invoice, Order

**Affected Behavior:** When users can access invoices, storage costs, retrieval performance.

**Decision Required:** Define generation trigger, template design, storage strategy.

**Status:** Pendente

---

### 4.6 Transaction Currency

| ID | FR-PEND-006 |

**Title:** Transaction Currency for Wallet and Transactions

**Description:** The currency used for Wallet balances and Transaction amounts has been defined as **BRL (Brazilian Real)** for the MVP scope.

**Actors:** Vendor, System

**Category:** Obrigatório

**Origin:** Q-026; CD-054, CD-064

**Concepts:** Wallet, Transaction

**Affected Behavior:** All financial calculations and vendor payouts use BRL.

**Decision Required:** None — currency defined as BRL.

**Status:** **Resolvido** (BRL definido para MVP)

---

## 5. Traceability Matrix

| FR ID | Domain | Category | Source Decision | Open Question |
|-------|--------|----------|-----------------|---------------|
| FR-AUTH-001 | Authentication | Obrigatório | CD-009, CD-057 | Q-029 |
| FR-AUTH-002 | Authentication | Obrigatório | CD-060 | Q-029 |
| FR-AUTH-003 | Authentication | Obrigatório | CD-060 | Q-029 |
| FR-USER-001 | User Management | Obrigatório | CD-007 | Q-004 |
| FR-USER-002 | User Management | Obrigatório | CD-008, CD-040, CD-061 | Q-004 |
| FR-USER-003 | User Management | Obrigatório | CD-008 | Q-004 |
| FR-USER-004 | User Management | Obrigatório | CD-057 | Q-029 |
| FR-VEND-001 | Vendor Management | Obrigatório | CD-041 | - |
| FR-VEND-002 | Vendor Management | Derivado | CD-041 | - |
| FR-VEND-003 | Vendor Management | Obrigatório | CD-051 | - |
| FR-PROD-001 | Product | Obrigatório | CD-011, CD-013, CD-062 | - |
| FR-PROD-002 | Product | Obrigatório | CD-042 | Q-007 |
| FR-PROD-003 | Product | Obrigatório | CD-013 | - |
| FR-PROD-004 | Product | Obrigatório | CD-043 | Q-008 |
| FR-PROD-005 | Product | Obrigatório | CD-016 | Q-018 |
| FR-PROD-006 | Product | Obrigatório | CD-062 | Q-006 |
| FR-SRCH-001 | Search | Obrigatório | CD-049 | Q-015 |
| FR-SRCH-002 | Search | Derivado | Stage 4 | Q-015 |
| FR-CART-001 | Cart | Obrigatório | CD-019 | - |
| FR-CART-002 | Cart | Obrigatório | CD-018 | Q-014 |
| FR-CART-003 | Cart | Obrigatório | Stage 5 | - |
| FR-ORDER-001 | Orders | Obrigatório | CD-020, CD-021 | - |
| FR-ORDER-002 | Orders | Obrigatório | CD-061 | Q-004 |
| FR-ORDER-003 | Orders | Obrigatório | CD-024 | Q-011 |
| FR-ORDER-004 | Orders | Obrigatório | CD-063 | Q-009 |
| FR-ORDER-005 | Orders | Obrigatório | CD-023 | - |
| FR-ORDER-006 | Orders | Obrigatório | CD-063 | Q-009 |
| FR-ORDER-007 | Orders | Obrigatório | CD-058 | Q-009 |
| FR-PAY-001 | Payments | Obrigatório | CD-064 | Q-011 |
| FR-PAY-002 | Payments | Obrigatório | CD-045 | Q-010 |
| FR-PAY-003 | Payments | Obrigatório | CD-063 | - |
| FR-PAY-004 | Payments | Obrigatório | CD-028 | Q-011 |
| FR-PAY-005 | Payments | Obrigatório | CD-065 | - |
| FR-PAY-006 | Payments | Obrigatório | CD-048, CD-065 | Q-013 |
| FR-PAY-007 | Payments | Obrigatório | CD-064, CD-065 | - |
| FR-PAY-008 | Payments | Obrigatório | CD-065 | Q-011 |
| FR-REFUND-001 | Refunds | Obrigatório | CD-032, CD-048 | Q-013 |
| FR-REFUND-002 | Refunds | Obrigatório | CD-048 | Q-013 |
| FR-REFUND-003 | Refunds | Obrigatório | CD-025 | Q-009 |
| FR-COUPON-001 | Coupons | Obrigatório | MP-07E rule 1 | - |
| FR-COUPON-002 | Coupons | Obrigatório | MP-07E rule 2 | - |
| FR-COUPON-003 | Coupons | Obrigatório | MP-07E rules 3, 5, 6 | Q-016 |
| FR-COUPON-004 | Coupons | Obrigatório | CD-050 | Q-016 |
| FR-COUPON-005 | Coupons | Derivado | CD-026 | - |
| FR-COUPON-006 | Coupons | Obrigatório | CD-026, CD-050 | Q-016 |
| FR-RW-001 | Reviews | Obrigatório | CD-017, CD-072 | - |
| FR-INV-001 | Invoices | Obrigatório | CD-035, CD-036 | Q-018 |
| FR-INV-002 | Invoices | Obrigatório | CD-037 | Q-018 |
| FR-ADMIN-001 | Admin | Obrigatório | CD-004 | Q-003 |
| FR-NOTIF-001 | Notifications | Obrigatório | CD-055 | - |
| FR-WALLET-001 | Wallet | Obrigatório | CD-030, CD-031 | Q-026 |
| FR-TRANS-001 | Transactions | Obrigatório | CD-031 | - |
| FR-HIST-001 | History | Obrigatório | CD-033 | - |
| FR-HIST-002 | History | Obrigatório | CD-052 | Q-021 |
| FR-DATA-001 | Data | Derivado | CD-057, CD-060 | Q-029 |
| FR-PEND-001 | Currency | **Resolvido** | Q-026, CD-054, CD-064 | Q-026 |
| FR-PEND-002 | Search | Pendente | Q-015 | Q-015 |
| FR-PEND-003 | Reviews | **Resolvido** | Q-017, CD-067..CD-072 | - |
| FR-PEND-004 | Coupons | Pendente | Q-016 | Q-016 |
| FR-PEND-005 | Invoices | Pendente | Q-018 | Q-018 |
| FR-PEND-006 | Currency | **Resolvido** | Q-026, CD-054, CD-064 | Q-026 |

---

## 6. Glossary

| Term | Definition |
|------|------------|
| **Admin** | Platform operator with RBAC permissions; manages the marketplace but does not consume or sell as a Vendor |
| **Coupon** | Discount code issued by a Vendor with code, validity period, discount type/value, and target products/categories |
| **Credential** | Access credential (password hash) associated with a Person for authentication |
| **Customer** | General term for Consumer in the marketplace context |
| **Consumer** | Registered user who can place orders |
| **Contact_Info** | Electronic contact method for a Person (email, phone, WhatsApp) |
| **Order** | Complete purchase aggregating all Order_Vendor_Groups for multi-vendor orders |
| **Order_Item** | Individual line item within an Order_Vendor_Group; includes historical price snapshot |
| **Order_Vendor_Group** | Per-vendor portion of an Order; enables split fulfillment and payment |
| **Payment** | Payment transaction for an Order; independent state machine from fulfillment |
| **Payment_Method** | Stripe Connect payment processing via Separate Charges and Transfers |
| **Person** | Common abstraction for Admin, Consumer, and Vendor; holds identity and contact |
| **Product** | Sellable item offered by a Vendor; has price, quantity, category |
| **Product_Pic** | Image asset associated with a Product (or Review) |
| **Refund** | Request to return funds; may be partial; initiated by marketplace through provider |
| **Review** | Customer feedback on a Product; only by verified purchasers |
| **Role** | Authorization role for Admin (not used for Consumer/Vendor) |
| **Vendor** | Registered seller who can offer Products and manage their store |
| **Wallet** | Financial ledger for Vendor or Marketplace; balance derived from Transactions |
| **Transaction** | Generic ledger entry recording financial movement (sale, commission, refund, payout, adjustment) |

---

## Appendix A: Requirements Summary by Domain

| Domain | Total | Obrigatório | Derivado | Pendente |
|--------|-------|-------------|----------|----------|
| Authentication | 3 | 3 | 0 | 0 |
| User Management | 4 | 3 | 1 | 0 |
| Vendor Management | 3 | 2 | 1 | 0 |
| Product & Catalog | 6 | 6 | 0 | 0 |
| Search | 2 | 1 | 1 | 0 |
| Shopping Cart | 3 | 3 | 0 | 0 |
| Checkout & Orders | 7 | 7 | 0 | 0 |
| Payments & Commissions | 8 | 8 | 0 | 0 |
| Refunds | 3 | 3 | 0 | 0 |
| Coupons | 6 | 5 | 1 | 0 |
| Reviews | 1 | 1 | 0 | 0 |
| Invoices | 2 | 2 | 0 | 0 |
| Admin Dashboard | 1 | 1 | 0 | 0 |
| Notifications | 1 | 1 | 0 | 0 |
| Wallet & Transactions | 2 | 2 | 0 | 0 |
| Historical Records | 2 | 2 | 0 | 0 |
| Data Integrity | 1 | 0 | 1 | 0 |
| **Subtotal (Main FRs)** | **53** | **48** | **5** | **0** |
| **Pending Requirements (Section 4)** | **6** | **3** | **0** | **3** |
| **Grand Total** | **59** | **51** | **5** | **3** |

---

## Appendix B: Acceptance Criteria Summary

| FR ID | Given/When/Then Pattern |
|-------|------------------------|
| FR-AUTH-001 | Given valid credentials → When authenticate → Then JWT issued |
| FR-AUTH-001 | Given invalid credentials → When authenticate → Then error returned |
| FR-AUTH-002 | Given Person exists → When checking credentials → Then exactly one Credential |
| FR-AUTH-003 | Given email already used → When registering → Then rejected |
| FR-USER-001 | Given CPF and CNPJ provided → When registering → Then rejected |
| FR-ORDER-001 | Given cart with multi-vendor products → When checkout → Then Order with multiple OVGs |
| FR-PAY-001 | Given checkout completed → When payment processed → Then single Charge, multiple Transfers |
| FR-PAY-005 | Given Order is PAID → When Vendor confirms OVG → Then OVG transitions to CONFIRMED (independent of Transfer) |
| FR-PAY-006 | Given partial refund for OVG → When refund confirmed → Then commission adjusted proportionally |
| FR-PAY-007 | Given PaymentIntent with idempotency_key → When retried with same key → Then no duplicate Charge |
| FR-PAY-008 | Given async payment (PIX/Boleto) → When charge.succeeded webhook received → Then Transfers created |
| FR-COUPON-003 | Given Vendor has multiple coupons → When checkout → Then only one applied |
| FR-ORDER-004 | Given Order created → Then state PENDING_PAYMENT |
| FR-ORDER-004 | Given payment captured → Then state PAID |
| FR-ORDER-004 | Given all OVGs shipped → Then state SHIPPED |
| FR-ORDER-004 | Given no shipments → When cancelled → Then state CANCELLED (proposal) |
| FR-ORDER-007 | Given all OVGs refunded → Then financial status FULLY_REFUNDED |
| FR-ORDER-007 | Given partial refund → Then financial status PARTIALLY_REFUNDED |
| FR-ORDER-007 | Given captured payment, no refunds → Then status PAID |