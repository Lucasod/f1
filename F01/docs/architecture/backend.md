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
| `payment` | Internal payment entity lifecycle and orchestration | Internal only; no Stripe SDK, Connect, webhooks, or live provider adapter |
| `review` | Verified-purchase review creation, local image upload, public listing, Admin moderation | MongoDB review records; image files use temporary local storage |

## Cross-cutting Concerns
- Validation: Zod where applicable, plus module-level validation
- Auth middleware: JWT verification and role extraction
- Authz middleware: Ownership checks (CD-059) and role guards
- Payment lifecycle idempotency is internal; provider API idempotency remains unimplemented

## Data Flow
Request → Middleware → Controller → Service → Repository → MongoDB/Redis/ES

## Technology Stack
Current backend runtime: Node.js/TypeScript, Express 4, MongoDB Node.js driver, ioredis, Zod, Vitest and Supertest.

MongoDB repositories are present for Person, Vendor, Category, Product, and Review. The runtime currently initializes Order and Payment with in-memory repositories; do not describe those records as MongoDB-persistent. Review eligibility therefore depends on the in-memory delivered-order repository. Product and review images currently use the local storage adapter temporarily. Local storage and payment placeholders support development only; neither replaces or completes the planned S3 and Stripe integrations.

The development seed CLI writes through MongoDB repositories. Application startup seeds catalog data only when the catalog is empty, but reconciles the development Admin and Consumer accounts independently of catalog contents.

## Planned, Not Yet Implemented
- Elasticsearch indexing/search adapter and mapping-dependent search APIs
- Coupon, invoice, and wallet modules
- Stripe SDK/Connect adapter, webhook processing, provider transfers and refunds
- S3 adapter, presigned/multipart uploads, and CloudFront delivery