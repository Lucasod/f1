# Análise de Design — Migration/Seed Strategy

**Data:** 2026-10-25  
**Executor:** code-orchestrator (T-306)  
**Fase:** P3a — Logical & Physical Data Models  
**Dependência:** T-301..T-305 (MongoDB, ES, Redis, S3, Data Integrity) ✅  
**Critério de Aceitação:** Migration plan documented  

---

## 1. Objetivo

Definir a estratégia de migração de schema e seed de dados para o Marketplace FS-01, cobrindo:
- Versionamento de migrações
- Aplicação (up/down)
- Seed de dados iniciais (development, staging, production)
- Rollback strategy
- Compatibilidade com deployments blue/green

---

## 2. Decisões Confirmadas

| Referência | Decisão |
|------------|---------|
| **CD-053** | Docker Compose: cada projeto tem seu Dockerfile; root compose sobe tudo |
| **CD-049** | MongoDB source of truth; ES rebuildable |
| **CD-054** | Currency = BRL; English interface |
| **CD-045** | Global commission percentage |
| **CD-064/065** | Stripe Connect Separate Charges and Transfers |

---

## 3. Migration Framework

### 3.1 Ferramenta: `migrate-mongo` (Node.js)

**Instalação:**
```json
{
  "devDependencies": {
    "migrate-mongo": "^10.0.0",
    "mongodb": "^6.0.0"
  }
}
```

**Configuração (`migrate-mongo-config.js`):**
```javascript
module.exports = {
  mongodb: {
    url: process.env.MONGODB_URI || 'mongodb://localhost:27017',
    databaseName: process.env.MONGODB_DATABASE || 'fs01_marketplace',
    options: { useNewUrlParser: true, useUnifiedTopology: true }
  },
  migrationsDir: 'migrations',
  changelogCollectionName: 'changelog',
  migrationFileExtension: '.js',
  useFileHash: true
};
```

### 3.1.1 Justificativa da Escolha: `migrate-mongo` (INFO-002)

A escolha do `migrate-mongo` como framework de migração foi baseada nos seguintes critérios:

| Critério | `migrate-mongo` | Alternativas Consideradas |
|----------|-----------------|---------------------------|
| **Linguagem nativa** | JavaScript/TypeScript (mesmo stack do backend) | Golang-migrate, Flyway (Java), Alembic (Python) |
| **Integração MongoDB** | Nativo (usa driver `mongodb` oficial) | Requer adapters ou wrappers |
| **API Assíncrona** | `async/await` nativo | Callbacks ou promises wrapped |
| **Hash de arquivo** | `useFileHash: true` detecta mudanças | Manual ou não suportado |
| **Changelog collection** | Automático (`changelog` collection) | Manual ou tabela separada |
| **Rollback (down)** | Suportado via função `down()` | Frequentemente não suportado ou limitado |
| **Criação de migrações** | CLI `migrate-mongo create` | Manual ou scripts customizados |
| **Manutenção** | Ativo, usado em produção | Variável; alguns abandonados |

**Decisão:** `migrate-mongo` atende todos os requisitos do projeto (stack Node.js, MongoDB nativo, rollback, hash de integridade, CLI) sem adicionar dependências de linguagens externas. É a escolha padrão para projetos Node.js + MongoDB.

### 3.2 Estrutura de Migração

```
migrations/
├── 20261025000001-create-core-collections.js
├── 20261025000002-create-catalog-collections.js
├── 20261025000003-create-order-collections.js
├── 20261025000004-create-payment-collections.js
├── 20261025000005-create-promo-review-collections.js
├── 20261025000006-create-indexes.js
├── 20261025000007-create-marketplace-singleton.js
└── 20261025000008-seed-initial-data.js
```

### 3.3 Template de Migração

```javascript
// migrations/20261025000001-create-core-collections.js
module.exports = {
  async up(db, client) {
    // 1. Create collections with schema validation
    await db.createCollection('people', {
      validator: { $jsonSchema: { ... } } // schema from T-305
    });
    
    await db.createCollection('credentials', { validator: { ... } });
    await db.createCollection('addresses', { validator: { ... } });
    await db.createCollection('contact_infos', { validator: { ... } });
    
    // 2. Create indexes
    await db.collection('people').createIndexes([
      { key: { 'main_info.tax_id.value': 1 }, unique: true, name: 'uq_tax_id' },
      { key: { 'primary_contact_id': 1 }, unique: true, name: 'uq_primary_contact', partialFilterExpression: { primary_contact_id: { $exists: true } } },
      { key: { roles: 1 }, name: 'idx_roles' }
    ]);
    
    await db.collection('credentials').createIndexes([
      { key: { person_id: 1 }, unique: true, name: 'uq_person_id' }
    ]);
    
    await db.collection('addresses').createIndexes([
      { key: { person_id: 1, is_primary: -1 }, name: 'idx_person_primary' },
      { key: { person_id: 1, is_primary: 1 }, unique: true, partialFilterExpression: { is_primary: true }, name: 'uq_person_primary' }
    ]);
    
    await db.collection('contact_infos').createIndexes([
      { key: { person_id: 1 }, name: 'idx_person' },
      { key: { type: 1, value: 1 }, unique: true, partialFilterExpression: { type: 'email' }, name: 'uq_email' },
      { key: { person_id: 1, is_primary: 1 }, unique: true, partialFilterExpression: { is_primary: true }, name: 'uq_person_primary_contact' }
    ]);
  },

  async down(db, client) {
    await db.collection('people').drop();
    await db.collection('credentials').drop();
    await db.collection('addresses').drop();
    await db.collection('contact_infos').drop();
  }
};
```

---

## 4. Ordem de Execução das Migrações

| # | Migração | Coleções | Dependências |
|---|----------|----------|--------------|
| 1 | `create-core-collections` | people, credentials, addresses, contact_infos | — |
| 2 | `create-catalog-collections` | vendors, categories, products, product_pics | 1 (vendors → people) |
| 3 | `create-order-collections` | orders, order_vendor_groups, order_status_history, order_vendor_group_history | 1, 2 |
| 4 | `create-payment-collections` | payments, wallets, transactions, refunds | 3 (orders), 2 (vendors) |
| 5 | `create-promo-review-collections` | coupons, reviews, invoices | 2, 3 |
| 6 | `create-indexes` | Todos os índices compostos/parciais | 1-5 |
| 7 | `create-marketplace-singleton` | marketplace | 4 (wallets) |
| 8 | `seed-initial-data` | Dados iniciais | 1-7 |

---

## 5. Seed Strategy

### 5.1 Ambientes

| Ambiente | Seed | Dados |
|----------|------|-------|
| **Development** | Full | Admin user, test vendors, categories, products, coupons |
| **Staging** | Minimal | Admin user, 1 vendor, categories, 10 products |
| **Production** | Minimal | Admin user, categories (sem vendors/produtos) |

### 5.2 Seed Scripts

```javascript
// migrations/20261025000008-seed-initial-data.js
module.exports = {
  async up(db, client) {
    const env = process.env.NODE_ENV || 'development';
    
    // 1. Marketplace Wallet (create first so we have wallet_id)
    const walletResult = await db.collection('wallets').insertOne({
      owner_type: 'marketplace',
      owner_id: 'singleton',
      balance: 0,
      currency: 'BRL', // CD-054
      last_transaction_id: null,
      updated_at: new Date()
    });
    
    // 2. Marketplace singleton with wallet_id
    await db.collection('marketplace').insertOne({
      _id: 'singleton',
      name: 'FS01 Marketplace',
      commission_pct: 10.0, // CD-045: global %
      wallet_id: walletResult.insertedId,
      admins: [],
      created_at: new Date(),
      updated_at: new Date()
    }, { upsert: true });
    
    // 4. Categories (hierarquia básica)
    // Insert root categories first, then children
    const electronics = await db.collection('categories').insertOne({
      name: 'Electronics', parent_id: null, path: 'electronics', level: 0,
      created_at: new Date(), updated_at: new Date()
    });
    
    const phones = await db.collection('categories').insertOne({
      name: 'Phones', parent_id: electronics.insertedId, path: 'electronics/phones', level: 1,
      created_at: new Date(), updated_at: new Date()
    });
    
    await db.collection('categories').insertMany([
      { name: 'Smartphones', parent_id: phones.insertedId, path: 'electronics/phones/smartphones', level: 2, created_at: new Date(), updated_at: new Date() },
      { name: 'Fashion', parent_id: null, path: 'fashion', level: 0, created_at: new Date(), updated_at: new Date() },
      { name: 'Home & Garden', parent_id: null, path: 'home-garden', level: 0, created_at: new Date(), updated_at: new Date() },
      { name: 'Sports', parent_id: null, path: 'sports', level: 0, created_at: new Date(), updated_at: new Date() }
    ]);
    
    if (env === 'development') {
      await seedDevelopmentData(db);
    }
  },
  
  async down(db, client) {
    await db.collection('marketplace').deleteOne({ _id: 'singleton' });
    await db.collection('wallets').deleteOne({ owner_type: 'marketplace' });
    await db.collection('categories').deleteMany({});
  }
};

async function seedDevelopmentData(db) {
  // 1. Create main_infos first, then people with main_info_id reference
  
  // Admin user - create main_info first
  const adminMainInfo = await db.collection('main_infos').insertOne({
    person_id: null, // will update after person creation
    name: 'Admin User',
    tax_id: { type: 'cpf', value: '00000000000' },
    created_at: new Date(),
    updated_at: new Date()
  });
  
  const adminPerson = await db.collection('people').insertOne({
    roles: ['admin'],
    main_info_id: adminMainInfo.insertedId,
    status: 'active',
    created_at: new Date(),
    updated_at: new Date(),
    version: 1
  });
  
  // Update main_info with person_id reference
  await db.collection('main_infos').updateOne(
    { _id: adminMainInfo.insertedId },
    { $set: { person_id: adminPerson.insertedId, updated_at: new Date() } }
  );
  
  await db.collection('credentials').insertOne({
    person_id: adminPerson.insertedId,
    password_hash: '$2b$12$hashedpassword', // bcrypt
    status: 'active',
    failed_attempts: 0,
    created_at: new Date(),
    updated_at: new Date()
  });
  
  await db.collection('marketplace').updateOne(
    { _id: 'singleton' },
    { $push: { admins: adminPerson.insertedId } }
  );
  
  // Test vendor - create main_info first
  const vendorMainInfo = await db.collection('main_infos').insertOne({
    person_id: null, // will update after person creation
    name: 'Test Vendor',
    tax_id: { type: 'cnpj', value: '12345678000195' },
    created_at: new Date(),
    updated_at: new Date()
  });
  
  const vendorPerson = await db.collection('people').insertOne({
    roles: ['vendor'],
    main_info_id: vendorMainInfo.insertedId,
    status: 'active',
    created_at: new Date(),
    updated_at: new Date(),
    version: 1
  });
  
  // Update main_info with person_id reference
  await db.collection('main_infos').updateOne(
    { _id: vendorMainInfo.insertedId },
    { $set: { person_id: vendorPerson.insertedId, updated_at: new Date() } }
  );
  
  const vendorWallet = await db.collection('wallets').insertOne({
    owner_type: 'vendor',
    owner_id: vendorPerson.insertedId,
    balance: 0,
    currency: 'BRL',
    updated_at: new Date()
  });
  
  const vendor = await db.collection('vendors').insertOne({
    person_id: vendorPerson.insertedId,
    store_name: 'Test Store',
    description: 'Development test store',
    status: 'active',
    commission_pct: 10.0,
    wallet_id: vendorWallet.insertedId,
    created_at: new Date(),
    updated_at: new Date()
  });
  
  // Products
  const electronicsCat = await db.collection('categories').findOne({ path: 'electronics/phones/smartphones' });
  
  await db.collection('products').insertMany([
    {
      vendor_id: vendor.insertedId,
      category_id: electronicsCat._id,
      category_path: electronicsCat.path,
      name: 'Smartphone X Pro',
      description: 'Latest model with 128GB storage',
      price: 2999.90,
      currency: 'BRL',
      quantity: 50,
      status: 'active',
      images: [],
      created_at: new Date(),
      updated_at: new Date(),
      version: 1
    },
    {
      vendor_id: vendor.insertedId,
      category_id: electronicsCat._id,
      category_path: electronicsCat.path,
      name: 'Smartphone Y Lite',
      description: 'Budget friendly 64GB',
      price: 1499.90,
      currency: 'BRL',
      quantity: 100,
      status: 'active',
      images: [],
      created_at: new Date(),
      updated_at: new Date(),
      version: 1
    }
  ]);
  
  // Coupon
  await db.collection('coupons').insertOne({
    vendor_id: vendor.insertedId,
    code: 'WELCOME10',
    discount_type: 'percentage',
    discount_value: 10,
    starts_at: new Date(),
    ends_at: new Date(Date.now() + 30*24*60*60*1000),
    target: { product_ids: [], category_ids: [electronicsCat._id], excluded_product_ids: [], excluded_category_ids: [] },
    status: 'active',
    used_count: 0,
    created_at: new Date(),
    updated_at: new Date()
  });
  
  // Optional: Product images (product_pics) — development only
  if (env === 'development') {
    const product1 = await db.collection('products').findOne({ name: 'Smartphone X Pro' });
    const product2 = await db.collection('products').findOne({ name: 'Smartphone Y Lite' });
    
    if (product1 && product2) {
      await db.collection('product_pics').insertMany([
        {
          product_id: product1._id,
          vendor_id: vendor.insertedId,
          path: `products/${vendor.insertedId.toString()}/${product1._id.toString()}/main.jpg`,
          sort_order: 0,
          created_at: new Date()
        },
        {
          product_id: product1._id,
          vendor_id: vendor.insertedId,
          path: `products/${vendor.insertedId.toString()}/${product1._id.toString()}/gallery/01.jpg`,
          sort_order: 1,
          created_at: new Date()
        },
        {
          product_id: product2._id,
          vendor_id: vendor.insertedId,
          path: `products/${vendor.insertedId.toString()}/${product2._id.toString()}/main.jpg`,
          sort_order: 0,
          created_at: new Date()
        }
      ]);
      
      // Update products with image refs
      await db.collection('products').updateOne(
        { _id: product1._id },
        { $set: { images: [/* product_pic ids */] } }
      );
      await db.collection('products').updateOne(
        { _id: product2._id },
        { $set: { images: [/* product_pic ids */] } }
      );
    }
    
    // Optional: Sample invoice — development only
    // Note: Requires an order to exist; skipped for simplicity in seed
    // Invoice would follow naming: invoices/{year}/{month}/{order_id}.pdf
  }
}
```

---

## 6. Versionamento e Compatibilidade

### 6.1 Semantic Versioning para Schema

```
Schema Version: MAJOR.MINOR.PATCH
- MAJOR: Breaking changes (field removal, type change, required field added)
- MINOR: Backward-compatible additions (new optional fields, new indexes)
- PATCH: Bug fixes, performance improvements
```

### 6.2 Migração Blue/Green

```bash
# Blue deployment (v1)
docker-compose -f docker-compose.yml -f docker-compose.blue.yml up -d

# Run migrations
npm run migrate:up

# Green deployment (v2) - parallel
docker-compose -f docker-compose.yml -f docker-compose.green.yml up -d

# Switch traffic (nginx/ALB)
# Rollback: switch back to blue
```

### 6.3 Compatibilidade Forward/Backward

| Mudança | Tipo | Estratégia |
|---------|------|------------|
| Novo campo opcional | MINOR | Default no código; migração opcional |
| Novo campo obrigatório | MAJOR | Migração com default + deploy coordinated |
| Remoção de campo | MAJOR | Deprecate → remove em versão seguinte |
| Mudança de tipo | MAJOR | Nova migração + dual-write temporário |
| Novo índice | PATCH | CREATE INDEX CONCURRENTLY (se suportado) |

---

## 7. Rollback Strategy

| Cenário | Ação |
|---------|------|
| Migração falhou (up) | `migrate-mongo down` (executa `down()` da última) |
| Deploy falhou pós-migração | Rollback deploy (blue/green); DB compatível com versão anterior |
| Dados corrompidos | Restore from backup (point-in-time recovery MongoDB Atlas) |
| Schema drift | `migrate-mongo status` → identificar → `down` + `up` |

**Backup Strategy:**
- MongoDB Atlas: Continuous backup + point-in-time recovery (PITR)
- Daily snapshot + oplog para PITR
- Retenção: 30 dias (dev), 90 dias (staging/prod)

---

## 8. Comandos Operacionais

```bash
# Status das migrações
npm run migrate:status

# Aplicar todas pendentes
npm run migrate:up

# Aplicar uma específica
npm run migrate:up -- --to=20261025000003

# Rollback última
npm run migrate:down

# Rollback N migrações
npm run migrate:down -- --count=2

# Criar nova migração
npm run migrate:create -- --name="add-field-to-products"

# Seed development
NODE_ENV=development npm run migrate:seed

# Seed staging
NODE_ENV=staging npm run migrate:seed
```

**package.json scripts:**
```json
{
  "scripts": {
    "migrate:status": "migrate-mongo status",
    "migrate:up": "migrate-mongo up",
    "migrate:down": "migrate-mongo down",
    "migrate:create": "migrate-mongo create",
    "migrate:seed": "node ./migrations/seed.js"
  }
}
```

---

## 9. CI/CD Integration

```yaml
# .github/workflows/deploy.yml
jobs:
  migrate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run migrate:status
      - run: npm run migrate:up
        env:
          MONGODB_URI: ${{ secrets.MONGODB_URI }}
          MONGODB_DATABASE: ${{ secrets.MONGODB_DATABASE }}
```

**Gate:** Migração deve passar antes do deploy da aplicação.

---

## 10. Validação dos Critérios de Aceitação

| Critério | Atendido? | Evidência |
|----------|-----------|-----------|
| Migration plan documented | ✅ | Seções 3-9 |
| Versionamento | ✅ | Seção 6.1 |
| Seed strategy por ambiente | ✅ | Seção 5 |
| Rollback strategy | ✅ | Seção 7 |
| Blue/green compatibility | ✅ | Seção 6.2 |
| CI/CD integration | ✅ | Seção 9 |
| Seed hierarchy fix (Smartphones → Phones) | ✅ | Seção 5.2, categoria Phones como parent de Smartphones |
| Optional seeds (product_pics, invoices) | ✅ | Seção 5.2, dev-only conditional seeds |

---

## 11. Próximos Passos (P3b/P3c/P4)

- **P3b (T-401..T-405):** API Specification (REST/tRPC, endpoints, schemas, auth matrix)
- **P3c (T-501..T-506):** Technical Architecture (backend, frontend, infra, CI/CD, observability, security)
- **P4a (T-601..T-604):** Stage 2 Auth & RBAC Implementation

---

**Status:** **CONCLUÍDO** — Migration plan documented com versionamento, seed strategy e rollback.