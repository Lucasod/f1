# FS-01 Marketplace Backend

## Overview

Node.js/Express/TypeScript backend for the FS-01 Marketplace. Provides REST APIs for authentication, vendor onboarding, and person management with JWT-based auth, MongoDB persistence, Redis caching, and Elasticsearch search integration.

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
│   │   ├── vendor.service.ts
│   │   ├── vendor.routes.ts # /api/v1/vendor endpoints
│   │   ├── vendor.domain.ts
│   │   └── *.test.ts
│   └── person/              # Person domain (consumer/vendor/admin)
│       ├── person.domain.ts
│       └── *.test.ts
└── tests/
    └── health.test.ts       # Health endpoint test
```

---

## Key Technologies

| Category | Technology |
|----------|------------|
| Runtime | Node.js 22+, TypeScript 5.6 |
| Framework | Express 4.21 |
| Database | MongoDB 6.9 (native driver) |
| Cache | Redis 7 (ioredis) |
| Search | Elasticsearch 8.15 |
| Auth | JWT (jsonwebtoken), bcryptjs |
| Validation | Zod 3.23 |
| Security | Helmet, CORS |
| Testing | Vitest 2.1, Supertest 7 |
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
```

---

## Environment Variables

Defined in `src/config/index.ts`. All have development defaults; **required in production**.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `NODE_ENV` | `development` | Environment mode |
| `MONGO_URI` | `mongodb://localhost:27017/fs01_marketplace` | MongoDB connection string |
| `MONGO_DB_NAME` | `fs01_marketplace` | Database name |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `ELASTICSEARCH_URL` | `http://localhost:9200` | Elasticsearch URL |
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