# FS-01 Marketplace Backend

## Overview

Node.js/Express/TypeScript backend for the FS-01 Marketplace. Provides REST APIs for authentication, marketplace resources, and account management with JWT-based auth, MongoDB persistence for configured domains, and Redis-backed carts. Product and review images, orders, and payments are local/in-memory during development; this is temporary and does not replace the planned S3 and Stripe integrations.

---

## Project Structure

```
src/
├── index.ts                 # Application entry point
├── config/
│   ├── index.ts             # Environment configuration & validation
│   └── config.test.ts       # Config tests
├── modules/
│   ├── auth/                # Authentication module
│   │   ├── auth.service.ts  # Core auth logic (register, login, refresh)
│   │   ├── auth.middleware.ts # JWT verification & role guards
│   │   ├── auth.routes.ts   # /api/v1/auth endpoints
│   │   ├── credential.domain.ts # Password hashing/validation
│   │   └── *.test.ts        # Unit & integration tests
│   ├── vendor/              # Vendor onboarding & management
│   ├── person/              # Person domain (consumer/vendor/admin)
│   ├── cart/                # Authenticated and guest Redis carts
│   ├── checkout/            # Authenticated checkout
│   ├── order/               # Order/payment lifecycle (in-memory in current runtime)
│   ├── product/             # Catalog and local product image storage
│   └── review/              # MongoDB reviews and locally stored owned images
└── shared/
    ├── database/            # MongoDB connection and indexes
    ├── storage/             # StorageAdapter and local implementation
    └── tests/               # API and integration test suites
```

---

## Key Technologies

| Category | Technology |
|----------|------------|
| Runtime | Node.js 22+, TypeScript 5.6 |
| Framework | Express 4.21 |
| Database | MongoDB 6.9 (native driver) |
| Cache | Redis 7 (ioredis) |
| Search | Elasticsearch planned; search adapter is not yet connected |
| Auth | JWT (jsonwebtoken), bcryptjs |
| Validation | Module-level validation; Zod is not used by all routes |
| Security | Helmet, CORS |
| Testing | Vitest 4, Supertest 7 |
| Dev Tooling | tsx (watch), ESLint-ready |

---

## Available Scripts

```bash
npm run dev          # Start dev server with hot reload (tsx watch)
npm run build        # Compile TypeScript to dist/
npm run start        # Run production build (node dist/index.js)
npm run test         # Run all tests once (vitest run)
npm run test:watch   # Watch mode for tests
npm run test:coverage # Run tests with coverage report
npm run seed         # Seed development demo data
```

The development seed creates three vendors, one consumer, one admin, categories, and products. Demo account credentials are `consumer@example.com` / `SecurePass123!` and `admin@example.com` / `SecurePass123!`. The admin is created only through the trusted seed path; public registration must not grant the ADMIN role.

When seeding in production with `SEED_FORCE=true`, set deployment-managed passwords for every seeded account:
`SEED_VENDOR_TECH_STORE_PASSWORD`, `SEED_VENDOR_FASHION_HUB_PASSWORD`,
`SEED_VENDOR_BOOK_WORLD_PASSWORD`, `SEED_CONSUMER_PASSWORD`, and `SEED_ADMIN_PASSWORD`.
The seed validates all required secrets before writing data and fails rather than using development credentials if any is missing.

---

## Local Development Integrations

- Product and review images use the local `StorageAdapter`; image API paths and object-key conventions are compatible with a future storage adapter. No AWS/S3 request is made.
- Checkout returns a placeholder client secret for local flow testing. It does not authorize or capture a real payment. No Stripe SDK, Connect account, webhook, transfer, or provider refund is configured.
- The runtime uses MongoDB repositories for people, vendors, categories, products, and reviews. Orders and payments are in-memory and reset on process restart.
- Elasticsearch is planned but is not connected.

These are temporary development boundaries. Configure and validate the actual providers when the project reaches their integration requirement; do not treat local behavior as provider integration completion.

## Environment Variables

Defined in `src/config/index.ts`. All have development defaults; **required in production**.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `NODE_ENV` | `development` | Environment mode |
| `MONGO_URI` | `mongodb://localhost:27017/fs01_marketplace` | MongoDB connection string |
| `MONGO_DB_NAME` | `fs01_marketplace` | Database name |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `ELASTICSEARCH_URL` | `http://localhost:9200` | Reserved for future Elasticsearch integration |
| `JWT_SECRET` | `dev-secret-change-in-production` | JWT signing secret |
| `JWT_EXPIRES_IN` | `24h` | Access token TTL |
| `CORS_ORIGIN` | (empty) | Comma-separated allowed origins |
| `COMMISSION_PCT` | `10` | Platform commission % |

**Production validation** (`validateConfig()`): throws if any required var uses its dev default.

---

## Docker Usage

```bash
# From F01/back/
docker compose up --build   # Start all services (backend, mongo, redis, elasticsearch)
docker compose down         # Stop and remove containers
docker compose down -v      # Also remove volumes (data loss)
```

Services exposed on host:
- Backend: `http://localhost:3000`
- MongoDB: `localhost:27017`
- Redis: `localhost:6379`
- Elasticsearch: `http://localhost:9200`

Volumes use `f01_` prefix for isolation (`f01_mongo_data`, `f01_redis_data`, `f01_elasticsearch_data`).

---

## API Endpoints Overview

Base path: `/api/v1`

### Health
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Service health check |

### Auth (`/auth`)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/register` | No | Register new person (consumer/vendor/admin) |
| `POST` | `/login` | No | Login, returns access + refresh tokens |
| `POST` | `/refresh` | No | Refresh access token using refresh token |

**Register body:** `{ name, taxIdType: "CPF"|"CNPJ", taxIdValue, email, password, role: "CONSUMER"|"VENDOR"|"ADMIN" }`

**Login body:** `{ email, password }`

**Refresh body:** `{ refreshToken }`

### Vendor (`/vendor`) — Requires JWT (Bearer token)
| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| `POST` | `/onboard` | CONSUMER, VENDOR | Create vendor profile for authenticated user |
| `GET` | `/me` | Any authenticated | Get own vendor profile |
| `PATCH` | `/me` | Owner only | Update store name |

**Onboard body:** `{ storeName, slug }` — slug: lowercase, numbers, hyphens only.

---

## Testing Approach

- **Framework:** Vitest (fast, Vite-native)
- **HTTP Testing:** Supertest (tests Express app directly)
- **Structure:** Unit tests alongside source (`*.test.ts`), integration tests in `src/tests/`
- **Coverage:** `npm run test:coverage` (v8 provider)
- **Run all:** `npm run test`

### Example Test Command
```bash
npm run test -- --reporter=verbose
```

---

## Development Notes

- **In-memory repos** used currently (`InMemoryPersonRepository`, `InMemoryVendorRepository`); MongoDB repositories planned for P4.
- **Roles:** `CONSUMER`, `VENDOR`, `ADMIN` (see `PersonRole` enum)
- **Auth middleware:** `authMiddleware(authService)` attaches `req.user` (JWT payload); `requireRole(...)` guards routes.
- **Error handling:** Centralized in `index.ts` (404 + 500); route-level handles known domain errors.
- **Commission:** Configured via `COMMISSION_PCT` env; applied in `VendorService`.

---

## Next Steps (Planned)

- MongoDB repository implementations (replace in-memory)
- Product/catalog module
- Order/payment flow
- Elasticsearch integration for search
- Redis session/cart caching
- CI/CD pipeline