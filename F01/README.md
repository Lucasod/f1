# FS-01 | Multi-Vendor E-Commerce Marketplace

Consumers browse and buy products from multiple vendors through a single storefront. Vendors manage listings and fulfillment, and administrators oversee marketplace operations.

| Area | Implementation |
| --- | --- |
| Shopping | Catalog, search, cart, coupons, checkout, order tracking, and reviews after delivery |
| Vendor operations | Onboarding, product listings, and order fulfillment |
| Payments | Stripe Checkout and Connect integration, vendor transfers, commission records, and PDF invoices |
| Application stack | React, Vite, and TypeScript in [front/](front/). Node.js, Express, and TypeScript in [back/](back/) |
| Platform services | MongoDB for persistence, Redis for carts, and Elasticsearch for search when configured |

## Prerequisites

- Docker with Compose for the container quick start.
- Node.js 22 and npm for host builds, seed commands, and tests.
- Available ports `3000`, `5173`, `27017`, `6379`, and `9200` for the default Compose configuration.

Run the top-level commands below from the `F01/` directory, unless a command changes directories explicitly.

## Configure and start

Create `back/.env` from the [example](back/.env.example) if you have no local configuration yet. Set a local `TEST_USER_PASSWORD` for the demo accounts. Keep real credentials in your local environment or secret store.

```bash
test -f back/.env || cp back/.env.example back/.env
# Edit back/.env before starting.
docker compose up -d --build
docker compose ps
curl --fail --silent --show-error http://localhost:3000/health
```

Open [the storefront](http://localhost:5173). The API is available on port `3000`. Use `docker compose logs -f backend frontend` to follow startup logs. If a dependency is still starting, check its Compose logs and retry the health check.

The backend seeds demo data when running in development with MongoDB. To run the seed explicitly after MongoDB is ready:

```bash
docker compose exec backend npm run seed
```

Use `docker compose down` to stop the services while retaining their named volumes.

### Run the applications directly with npm

Use this setup if you want hot reload for both applications. Start the infrastructure from `F01/`:

```bash
docker compose up -d mongo redis elasticsearch
```

In two separate terminals opened at `F01/`:

```bash
cd back
npm ci
npm run dev
```

```bash
cd front
npm ci
npm run dev
```

For host execution, point service URLs in `back/.env` to the published localhost ports. Set `MONGO_URI=mongodb://localhost:27017/fs01_marketplace?replicaSet=fs01&directConnection=true` when using Compose MongoDB from the host. The default frontend proxy sends `/api` requests to `http://localhost:3000`.

## Build

```bash
(cd back && npm ci && npm run build)
(cd front && npm ci && npm run build)
```

The API build writes to `back/dist/` and can be started with `(cd back && npm start)` once the backing services are running. The frontend build writes to `front/dist/`. To preview it locally with the API running, use `(cd front && npm run preview)`.

## Run tests

Install both applications' dependencies first. The backend suite needs permission to bind local HTTP sockets. Service-backed tests need access to their configured local dependencies, including Redis. Use a development or test database for seeded runs.

```bash
# Backend suite
(cd back && npm test)

# Focused payment tests
(cd back && npx vitest run src/modules/order/payment.service.test.ts)

# Frontend unit tests
(cd front && npx vitest run)
```

### Backend — Testes de Integração (MongoDB)

O teste `src/scripts/seed.connect.mongo.test.ts` valida o fluxo de seed do Stripe Connect contra um MongoDB de testes. Requer a variável `F01_CONNECT_TEST_URI`.

```bash
# Executar apenas o teste de integração seed-connect
export F01_CONNECT_TEST_URI="mongodb://127.0.0.1:27017/f01_seed_connect_test?directConnection=true"
(cd back && npm run test:integration)

# Executar suíte completa (unitária + integração)
export F01_CONNECT_TEST_URI="mongodb://127.0.0.1:27017/f01_seed_connect_test?directConnection=true"
(cd back && npm run test:all)
```

**PASS vs SKIP vs BLOCKED:**
- `PASS`: todos os testes executados e aprovados (exit code 0)
- `SKIP`: teste pulado porque `F01_CONNECT_TEST_URI` não está definida (apenas em execução direta via vitest; `test:integration` e `test:all` não permitem skip silencioso)
- `BLOCKED`: `test:integration` ou `test:all` falham porque a variável obrigatória não está configurada

**Proteção contra banco de produção:** O teste cria bancos com prefixo `fs01_connect_seed_test_` e nunca modifica coleções de bancos não destinados a testes. Nunca defina `F01_CONNECT_TEST_URI` apontando para um banco de produção ou desenvolvimento com dados reais.

For browser tests, keep the API and storefront running on ports `3000` and `5173`. Seed the database as above and make the same local `TEST_USER_PASSWORD` available in the shell running Playwright. The direct Playwright command works from any checkout location.

```bash
cd front
npx playwright install chromium
npx playwright test --workers=1
npx playwright show-report
```

## Stripe and verification status

Use Stripe test-mode credentials and configured test connected accounts to exercise Checkout and Connect. The webhook endpoint is `/api/v1/webhooks/stripe`. See the [backend configuration reference](back/README.md) for environment details.

The quick start is for local storefront and API development. Financial acceptance remains blocked on runtime wiring and transaction verification. Compose initializes a single-node MongoDB replica set for local transaction testing. Check the [financial closure report](docs/agent_runs/MP-F01-financial-closure.md) for the remaining verification gaps.

## Architecture and references

- [Architecture diagram](../docs/architecture-overview.svg)
- [Backend architecture](docs/architecture/backend.md) and [conceptual data model](docs/conceptual_model.md)
- [OpenAPI specification](docs/api/openapi.yaml)
- [Frontend reference](front/README.md)
- [Test audit](docs/analysis/TEST-AUDIT-REPORT.md) and [financial closure report](docs/agent_runs/MP-F01-financial-closure.md)
