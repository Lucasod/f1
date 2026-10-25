# Backend Architecture - FS-01 Marketplace

## Architecture Style
Layered/Clean Architecture with clear module boundaries. Domain-driven design principles.

## Module Map
| Module | Responsibility | Key Decisions |
|--------|---------------|---------------|
| `auth` | JWT issue/refresh, password hash, credentials | CD-010, CD-057, CD-060 |
| `person` | Person, Address, ContactInfo, MainInfo CRUD | CD-001..CD-004, CD-006, CD-008, CD-040, CD-061 |
| `vendor` | Onboarding (auto-publish CD-041), dashboard, products, coupons, OVGs | CD-041, CD-045, CD-051 |
| `product` | CRUD, stock (Quantity=stock CD-013), no variants CD-062, images | CD-011, CD-013, CD-062 |
| `category` | Hierarchy (parent_id, path for descendants CD-043) | CD-015, CD-043 |
| `cart` | Redis-backed, multi-vendor CD-019, optimistic locking | CD-018, CD-019 |
| `checkout` | Order + OVGs creation, stock validation | CD-019, CD-021, CD-061 |
| `order` | 3 state machines (Order, Payment, OVG CD-063), financial status CD-058 | CD-044, CD-058, CD-063 |
| `payment` | Stripe Connect Separate Charges+Transfers CD-064/065, webhooks, refunds | CD-064, CD-065, CD-048 |
| `review` | Verified purchase CD-017, moderation | CD-017, Q-017 |
| `coupon` | Inclusion/exclusion CD-050, no stacking | CD-050 |
| `invoice` | Commercial receipt PDF, S3 storage | CD-035, CD-036, CD-037 |
| `wallet` | Vendor/Marketplace wallets, transactions | CD-030, CD-031 |
| `common` | Shared types, RFC 7807 errors, utilities | CD-066 |

## Cross-cutting Concerns
- Error handling: RFC 7807 Problem Details
- Validation: Zod/class-validator
- Logging: Structured JSON
- Auth middleware: JWT verification, role extraction
- Authz middleware: Ownership checks (CD-059), Admin permissions (CD-004)
- Idempotency: Payment/refund keys
- Domain events: For async operations (email, ES sync)

## Data Flow
Request → Middleware → Controller → Service → Repository → MongoDB/Redis/ES

## Technology Stack
Node.js/TypeScript, Fastify, Mongoose, Vitest/Supertest/Playwright