# Backend Architecture - FS-01 Marketplace

## Architecture Style
Layered/Clean Architecture with clear module boundaries. Domain-driven design principles.

> **Implementation status:** This document distinguishes the current runtime from planned architecture. The repository is not yet a complete implementation of every domain module listed in the requirements.

## Current Runtime Modules
| Module | Responsibility | Current status |
|--------|----------------|----------------|
| `auth` | Registration, login, JWT issue/refresh and credentials | Implemented |
| `person` | Person, contacts, addresses, profile operations | Implemented |
| `vendor` | Vendor onboarding and vendor profile operations | Implemented |
| `product` | Product/category APIs, stock, local image storage | Implemented |
| `cart` | Redis-backed authenticated and guest carts, stock checks, login merge | Implemented |
| `checkout` | Authenticated checkout and order creation | Implemented with payment/inventory completion limitations |
| `order` | Order and vendor-group lifecycle, consumer/vendor access | Implemented; see task status and tests |
| `payment` | Internal payment entity lifecycle and orchestration | Stripe SDK, Checkout and webhook paths exist; transfer orchestration and recovery remain incomplete |
| `review` | Verified-purchase review creation, local image upload, public listing, Admin moderation | MongoDB review records; image files use temporary local storage |

## Cross-cutting Concerns
- Validation: Zod where applicable, plus module-level validation
- Auth middleware: JWT verification and role extraction
- Authz middleware: Ownership checks (CD-059) and role guards
- Provider idempotency is used in some paths; webhook recovery and cross-service idempotency remain incomplete

## Data Flow
Request → Middleware → Controller → Service → Repository → MongoDB/Redis/ES

## Technology Stack
Current backend runtime: Node.js/TypeScript, Express 4, MongoDB Node.js driver, ioredis, Zod, Vitest and Supertest.

The MongoDB startup path wires persistent repositories for orders, payments, wallets, payouts and other modules, as well as Elasticsearch synchronization and Stripe webhook handling. A development fallback uses in-memory implementations when MongoDB is unavailable. Product and review image storage uses S3 when configured and otherwise local storage. Code wiring alone does not prove provider access or complete financial reconciliation; consult the current run record.

The development seed CLI writes through MongoDB repositories. Application startup seeds catalog data only when the catalog is empty, but reconciles the development Admin and Consumer accounts independently of catalog contents.

## Remaining integration work
- Reliable webhook recovery after partial capture and cart reconciliation.
- Stripe Connect transfer orchestration and provider-confirmed payout semantics.
- Atomic wallet and ledger updates under the deployed MongoDB topology.
- CloudFront CDN delivery, if required.
