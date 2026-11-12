# MP-34R2 — MongoDB Configuration and Test Files Report

**Scope:** `/home/workstation/source/f1` — Find MongoDB client creation code, config values, test files, and config/index.ts MongoDB name configuration.

---

## 1. MongoDB Client Creation Code

**File:** `F01/back/src/shared/database/mongo.client.ts`

```typescript
import { MongoClient, Db } from 'mongodb';
import { config } from '../../config';

let mongoClient: MongoClient | null = null;
let db: Db | null = null;

export async function connectToMongo(): Promise<Db> {
  if (db) {
    return db;
  }

  mongoClient = new MongoClient(config.mongoUri);  // <-- MongoClient creation
  await mongoClient.connect();                      // <-- MongoClient.connect()
  db = mongoClient.db(config.mongoDbName);        // <-- Uses config.mongoDbName

  console.log(`Connected to MongoDB: ${config.mongoDbName}`);

  return db;
}
```

**Pattern:** `new MongoClient(uri)` — all MongoDB connections use the standard MongoDB Node.js driver `MongoClient`. No `MongoMemoryServer` was found anywhere in the codebase.

**Test file client creation pattern** (e.g., `F01/back/src/modules/order/payment.mongo.repository.test.ts`):

```typescript
client = new MongoClient(TEST_MONGO_URI);  // line 37
await client.connect();                     // line 38
db = client.db(TEST_DB_NAME);               // line 39
```

**Test file integration creation** (e.g., `F01/back/src/integration/mongodb.integration.test.ts`):

```typescript
client = new MongoClient(TEST_MONGO_URI);  // line 67
await client.connect();                     // line 68
db = client.db(TEST_DB_NAME);               // line 69
```

**No `MongoMemoryServer` usage** was found in any `.ts`, `.js`, or `.json` file in the repository.

---

## 2. Config Values: `TEST_DB_NAME` and `MONGO_DB_NAME`

### `MONGO_DB_NAME` — Configuration

**File:** `F01/back/src/config/index.ts` line 76

```typescript
mongoDbName: process.env.MONGO_DB_NAME || 'fs01_marketplace',
```

- **Default:** `'fs01_marketplace'`
- **Override:** `process.env.MONGO_DB_NAME`
- **Validated in `validateConfig()`** (lines 92–105): in production, checks that `mongoUri` is set to a production value (does not strictly validate `mongoDbName` has a production value beyond the default).

### `TEST_DB_NAME` — Test Constants

Multiple test files define their own `TEST_DB_NAME` constant:

| File | `TEST_DB_NAME` Value |
|---|---|
| `F01/back/src/modules/vendor/vendor.mongo.repository.test.ts` | `'fs01_marketplace_test'` |
| `F01/back/src/modules/product/product.mongo.repository.test.ts` | `'fs01_marketplace_test'` |
| `F01/back/src/modules/invoice/invoice.mongo.repository.test.ts` | `'fs01_marketplace_test'` |
| `F01/back/src/modules/person/person.mongo.repository.test.ts` | `'fs01_marketplace_test'` |
| `F01/back/src/modules/product/category.mongo.repository.test.ts` | `'fs01_marketplace_test'` |
| `F01/back/src/modules/order/order.mongo.repository.test.ts` | `'fs01_marketplace_test'` |
| `F01/back/src/modules/order/payment.mongo.repository.test.ts` | `'fs01_marketplace_test'` |
| `F01/back/src/modules/payout/payout.mongo.repository.test.ts` | `'fs01_marketplace_test'` |
| `F01/back/src/integration/mongodb.integration.test.ts` | `'fs01_marketplace_integration_test'` |

Note: The test files use hardcoded `TEST_DB_NAME` constants rather than reading from `process.env.TEST_DB_NAME`. The integration test uses a distinct name `'fs01_marketplace_integration_test'`.

---

## 3. Test Files Matching `**/mongo*.test.*` in `F01/back/src/modules/`

Found **9 test files** matching the pattern:

| File Path | Description |
|---|---|
| `F01/back/src/modules/vendor/vendor.mongo.repository.test.ts` | Vendor MongoDB repository contract tests |
| `F01/back/src/modules/product/product.mongo.repository.test.ts` | Product MongoDB repository contract tests |
| `F01/back/src/modules/product/category.mongo.repository.test.ts` | Category MongoDB repository contract tests |
| `F01/back/src/modules/invoice/invoice.mongo.repository.test.ts` | Invoice MongoDB repository contract tests |
| `F01/back/src/modules/person/person.mongo.repository.test.ts` | Person MongoDB repository contract tests |
| `F01/back/src/modules/order/order.mongo.repository.test.ts` | Order MongoDB repository contract tests |
| `F01/back/src/modules/order/payment.mongo.repository.test.ts` | Payment MongoDB repository contract tests |
| `F01/back/src/modules/payout/payout.mongo.repository.test.ts` | Payout MongoDB repository contract tests |
| `F01/back/src/modules/review/review.mongo.repository.test.ts` | Review MongoDB repository contract tests |

All 9 follow the same pattern:
- Define `const TEST_MONGO_URI = process.env.TEST_MONGO_URI || 'mongodb://localhost:27017'`
- Define `const TEST_DB_NAME = 'fs01_marketplace_test'` (integration test uses `'fs01_marketplace_integration_test'`)
- Use `client = new MongoClient(TEST_MONGO_URI)` and `db = client.db(TEST_DB_NAME)`

---

## 4. `config/index.ts` — MongoDB Name Configuration Lines

**File:** `F01/back/src/config/index.ts`, lines 72–89 (the `config` export object)

```typescript
export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  mongoUri: validateRequiredInProduction(process.env.MONGO_URI, 'MONGO_URI') || 'mongodb://localhost:27017/fs01_marketplace',
  mongoDbName: process.env.MONGO_DB_NAME || 'fs01_marketplace',   // <-- Line 76
  redisUrl: validateRequiredInProduction(process.env.REDIS_URL, 'REDIS_URL') || 'redis://localhost:6379',
  elasticsearchUrl: validateRequiredInProduction(process.env.ELASTICSEARCH_URL, 'ELASTICSEARCH_URL') || 'http://localhost:9200',
  jwtSecret: validateRequiredInProduction(process.env.JWT_SECRET, 'JWT_SECRET') || 'dev-secret-change-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
  corsOrigins,
  isProduction: isProduction(),
  enableStartupCleanup: getEnableStartupCleanup(),
  commissionPct: parseFloat(process.env.COMMISSION_PCT || '10'),
  frontendUrl: process.env.FRONTEND_URL?.trim() || 'http://localhost:5173',
  stripePaymentMethodConfiguration: process.env.STRIPE_PAYMENT_METHOD_CONFIGURATION?.trim() || '',
  get storageRoot() { return getStorageRoot(); },
  get storagePublicUrlBase() { return getPublicUrlBase(); },
};
```

**Line 76** is the MongoDB name configuration:
- `mongoDbName: process.env.MONGO_DB_NAME || 'fs01_marketplace'`
- Falls back to `'fs01_marketplace'` when `MONGO_DB_NAME` is not set
- This value is used in `mongo.client.ts` line 14: `db = mongoClient.db(config.mongoDbName)`

---

## Summary of Findings

| Item | Key Finding |
|---|---|
| **MongoDB client creation** | `new MongoClient(uri)` in `mongo.client.ts:12` and in all test files. No `MongoMemoryServer` found. |
| **`MONGO_DB_NAME` config** | `F01/back/src/config/index.ts:76` — `process.env.MONGO_DB_NAME || 'fs01_marketplace'` |
| **`TEST_DB_NAME` in tests** | 8 test files use `'fs01_marketplace_test'`; integration test uses `'fs01_marketplace_integration_test'` |
| **Test files (mongo pattern)** | 9 files in `F01/back/src/modules/*/mongo.repository.test.ts` |
| **config/index.ts MongoDB line** | Line 76: `mongoDbName: process.env.MONGO_DB_NAME || 'fs01_marketplace'` |

---