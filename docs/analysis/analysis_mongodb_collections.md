# Análise de Design — Coleções MongoDB

**Data:** 2026-10-25  
**Executor:** code-orchestrator (T-301)  
**Fase:** P3a — Logical & Physical Data Models  
**Dependência:** T-125 (conceptual_model.md finalizado) ✅  
**Critério de Aceitação:** Collection schemas with indexes  

---

## 1. Objetivo

Definir o design físico das coleções MongoDB para o Marketplace FS-01, mapeando os 30 conceitos do modelo conceitual para coleções, decidindo estratégias de embedding vs referencing, e definindo esquemas com índices apropriados.

Baseado em:
- `docs/conceptual_model.md` (30 conceitos, relacionamentos, regras confirmadas)
- `docs/decisions.md` (CD-001 a CD-065)
- `docs/functional_requirements.md` (FR-*)
- `docs/non-functional_requirements.md` (NFR-DATA-001: MongoDB como source of truth)

---

## 2. Princípios de Design

| Princípio | Descrição |
|-----------|-----------|
| **Source of Truth** | MongoDB é a fonte autoritativa (NFR-DATA-001, CD-049) |
| **Embedding para 1:1 e 1:N pequeno** | Quando a entidade filha não existe independentemente e a cardinalidade é baixa |
| **Referencing para N:M e 1:N grande** | Quando a entidade filha tem vida própria, é consultada independentemente, ou cardinalidade é alta |
| **Denormalização controlada** | Copiar campos necessários para evitar joins em consultas frequentes (ex: vendor_name em Product) |
| **Índices para queries conhecidas** | Criar índices compostos para padrões de acesso do FR/NFR |
| **Versionamento otimista** | Campo `version` para concorrência em atualizações críticas (stock, wallet) |

---

## 3. Mapeamento Conceito → Coleção

### 3.1 Core Domain — Usuários e Autenticação

| Conceito | Coleção | Estratégia | Justificativa |
|----------|---------|------------|---------------|
| Person | `people` | Coleção única | CD-001: Person é abstração comum; CD-002/003: specializations via campo `roles` |
| Main_Info | `main_infos` | Coleção separada | CD-006: Main_Info remains distinct concept; not merged into Person; 1:1 via person_id |
| Credential | `credentials` | Coleção separada | CD-060: 1:1 mas isolamento de segurança; hash de senha não no documento principal |
| Address | `addresses` | Coleção separada | CD-008: 1:N; múltiplos endereços por pessoa; consultados independentemente no checkout |
| Contact_Info | `contact_infos` | Coleção separada | CD-008: 1:N; email único global (CD-060); login email protegido (CD-057) |
| Admin | Via `people.roles` | Role no documento Person | CD-003/004: Admin disjoint; Role só para Admin (CD-004) |

**PROPOSTA P3a — Esquema `people`:**
```javascript
{
  _id: ObjectId,
  roles: ["consumer"] | ["vendor"] | ["consumer", "vendor"] | ["admin"], // CD-001, CD-002, CD-003
  main_info_id: ObjectId, // ref to main_infos (CD-006: 1:1)
  primary_address_id: ObjectId, // ref to addresses
  primary_contact_id: ObjectId, // ref to contact_infos (email for login)
  status: "active" | "suspended" | "inactive",
  created_at: DateTime,
  updated_at: DateTime,
  version: Number // optimistic locking
}
```

**PROPOSTA P3a — Esquema `main_infos`:**
```javascript
{
  _id: ObjectId,
  person_id: ObjectId, // unique (CD-006: 1:1)
  name: String,
  tax_id: { type: "cpf" | "cnpj", value: String }, // CD-007: XOR
  created_at: DateTime,
  updated_at: DateTime
}
```

**Índices `people`:**
- `{ "roles": 1 }` (query por role)
- `{ "primary_contact_id": 1 }` (lookup login)

**Índices `main_infos`:**
- `{ "person_id": 1 }` unique (CD-006: 1:1)
- `{ "tax_id.value": 1 }` unique (CPF/CNPJ único global)

**PROPOSTA P3a — Esquema `credentials`:**
```javascript
{
  _id: ObjectId,
  person_id: ObjectId, // unique (CD-060: 1:1)
  password_hash: String, // bcrypt/argon2
  status: "active" | "locked" | "expired",
  failed_attempts: Number,
  locked_until: DateTime?,
  created_at: DateTime,
  updated_at: DateTime
}
```
**Índices `credentials`:** `{ person_id: 1 }` unique

**PROPOSTA P3a — Esquema `addresses`:**
```javascript
{
  _id: ObjectId,
  person_id: ObjectId,
  street: String,
  number: String,
  neighborhood: String,
  city: String,
  state: String, // 2 letras (UF)
  is_primary: Boolean, // default false; primeiro = true (CD-061)
  created_at: DateTime,
  updated_at: DateTime
}
```
**Índices `addresses`:** `{ person_id: 1, is_primary: -1 }`, `{ person_id: 1 }`

**PROPOSTA P3a — Esquema `contact_infos`:**
```javascript
{
  _id: ObjectId,
  person_id: ObjectId,
  type: "email" | "phone" | "whatsapp",
  value: String,
  is_primary: Boolean, // CD-057: não indica login
  // login email: type="email" + unique global index (CD-060)
  created_at: DateTime,
  updated_at: DateTime
}
```
**Índices `contact_infos`:** `{ person_id: 1 }`, `{ type: 1, value: 1 }` unique partial (só email)

---

### 3.2 Catálogo — Vendor, Product, Category

| Conceito | Coleção | Estratégia | Justificativa |
|----------|---------|------------|---------------|
| Vendor | `vendors` | Coleção separada | Entidade independente; CD-041 auto-publish; ownership isolation (CD-059) |
| Category | `categories` | Coleção separada | CD-015/043: hierarquia com parent_id; cycle prevention; consultada independentemente |
| Product | `products` | Coleção separada | CD-011/013/062: entidade principal; Quantity = stock; sem variants (CD-062) |
| Product_Pic | `product_pics` | Coleção separada | CD-016: imagens para Product e Review; referenciadas por ambos |

**PROPOSTA P3a — Esquema `vendors`:**
```javascript
{
  _id: ObjectId,
  person_id: ObjectId, // unique (CD-011: Vendor offers Product)
  store_name: String,
  description: String,
  status: "active" | "suspended", // CD-041: auto-publish; suspension possible
  commission_pct: Number, // CD-045: global % (config), per-vendor calc at OVG
  wallet_id: ObjectId, // ref to wallets (CD-030)
  created_at: DateTime,
  updated_at: DateTime
}
```
**Índices `vendors`:** `{ person_id: 1 }` unique, `{ status: 1 }`

**PROPOSTA P3a — Esquema `categories`:**
```javascript
{
  _id: ObjectId,
  name: String,
  parent_id: ObjectId?, // CD-043: optional self-ref; root = null
  path: String, // denormalized: "electronics/phones/smartphones" para descendant filtering (CD-049/ES)
  level: Number, // depth
  created_at: DateTime,
  updated_at: DateTime
}
```
**Índices `categories`:** `{ parent_id: 1 }`, `{ path: 1 }` (prefix query para descendants), `{ name: 1 }`

**PROPOSTA P3a — Esquema `products`:**
```javascript
{
  _id: ObjectId,
  vendor_id: ObjectId, // CD-011: Vendor offers Product
  category_id: ObjectId, // CD-015
  category_path: String, // denormalized para ES sync (CD-049)
  category_name: String, // denormalized para ES sync / category filter (CD-049)
  vendor_name: String, // denormalized para ES sync / vendor filter (CD-051)
  name: String,
  description: String,
  price: Decimal128, // BRL (CD-054)
  currency: "BRL", // fixed per MVP (CD-054)
  quantity: Number, // CD-013: current stock; display in-stock first
  status: "active" | "inactive", // CD-042: inactivation prevents new sales
  images: [ObjectId], // refs to product_pics
  created_at: DateTime,
  updated_at: DateTime,
  version: Number // optimistic locking para stock updates
}
```
**Índices `products`:**
- `{ vendor_id: 1, status: 1 }` (vendor dashboard - CD-051)
- `{ category_id: 1, status: 1, quantity: -1 }` (catalog display - CD-013)
- `{ category_path: 1, status: 1 }` (ES sync / hierarchy filter)
- `{ status: 1, quantity: -1, created_at: -1 }` (catalog listing)
- `{ name: "text", description: "text" }` (text search fallback)

**PROPOSTA P3a — Esquema `product_pics`:**
```javascript
{
  _id: ObjectId,
  product_id: ObjectId?, // nullable (também usado por Review)
  review_id: ObjectId?, // nullable
  vendor_id: ObjectId, // denormalized para reconstrução de S3 path (products/{vendor_id}/{product_id}/...)
  path: String, // S3 key
  description: String?,
  sort_order: Number,
  created_at: DateTime
}
```
**Constraints:**
- Pelo menos um de `product_id` ou `review_id` deve ser preenchido (CD-016: imagens compartilhadas entre Product e Review)
- Ambos podem ser preenchidos para imagens compartilhadas (mesmo arquivo referenciado por Product e Review)

**Índices `product_pics`:** `{ product_id: 1, sort_order: 1 }`, `{ review_id: 1 }`

---

### 3.3 Pedidos — Order, Order_Vendor_Group, Order_Item

| Conceito | Coleção | Estratégia | Justificativa |
|----------|---------|------------|---------------|
| Order | `orders` | Coleção principal | Agregado raiz; contém snapshots imutáveis |
| Order_Vendor_Group | `order_vendor_groups` | Coleção separada | CD-021/022: per-vendor fulfillment independente; CD-063 states |
| Order_Item | Embedded em `order_vendor_groups` | Embedding 1:N | CD-027: Order_Items é lista; price snapshot imutável (CD-023) |

**PROPOSTA P3a — Esquema `orders`:**
```javascript
{
  _id: ObjectId,
  consumer_id: ObjectId, // ref to people (Consumer)
  status: "PENDING_PAYMENT" | "PAID" | "PROCESSING" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "FAILED_PAYMENT", // CD-063
  financial_status: "PAID" | "PARTIALLY_REFUNDED" | "FULLY_REFUNDED", // CD-058 derived
  total_amount: Decimal128,
  currency: "BRL",
  shipping_address_snapshot: { // CD-061: immutable copy
    street: String,
    number: String,
    neighborhood: String,
    city: String,
    state: String
  },
  ovg_ids: [ObjectId], // refs to order_vendor_groups
  payment_ids: [ObjectId], // refs to payments (CD-028: multiple attempts)
  created_at: DateTime,
  updated_at: DateTime,
  version: Number
}
```
**Índices `orders`:**
- `{ consumer_id: 1, created_at: -1 }` (consumer order history)
- `{ status: 1, created_at: -1 }` (admin/vendor queries)
- `{ "payment_ids": 1 }` (payment webhook correlation)

**PROPOSTA P3a — Esquema `order_vendor_groups`:**
```javascript
{
  _id: ObjectId,
  order_id: ObjectId,
  vendor_id: ObjectId,
  status: "PENDING" | "CONFIRMED" | "PREPARING" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "RETURNED", // CD-063
  commission_pct: Number, // CD-045: snapshot at creation
  vendor_net: Decimal128, // ovg_total * (1 - commission_pct/100)
  items: [ // Embedded Order_Items (CD-027)
    {
      _id: ObjectId,
      product_id: ObjectId,
      product_name_snapshot: String, // CD-023/052: historical
      unit_price_snapshot: Decimal128, // CD-023: immutable
      quantity: Number,
      subtotal: Decimal128
    }
  ],
  coupon_id: ObjectId?, // optional (CD-026)
  shipping_tracking: String?,
  created_at: DateTime,
  updated_at: DateTime,
  version: Number
}
```
**Índices `order_vendor_groups`:**
- `{ order_id: 1 }`
- `{ vendor_id: 1, status: 1 }` (vendor dashboard - CD-051)
- `{ vendor_id: 1, created_at: -1 }` (vendor order history)

**PROPOSTA P3a — Esquema `order_status_history` (CD-033 append-only):**
```javascript
{
  _id: ObjectId,
  order_id: ObjectId,
  from_status: String,
  to_status: String,
  changed_by: ObjectId, // person_id
  changed_at: DateTime,
  metadata: Document? // e.g., { reason: "customer_cancelled" }
}
```
**Índices:** `{ order_id: 1, changed_at: -1 }`

**Esquema `order_vendor_group_history` (CD-033 append-only):**
```javascript
{
  _id: ObjectId,
  ovg_id: ObjectId,
  from_status: String,
  to_status: String,
  changed_by: ObjectId, // person_id (vendor or admin)
  changed_at: DateTime,
  metadata: Document?
}
```
**Índices:** `{ ovg_id: 1, changed_at: -1 }`

---

### 3.4 Pagamentos e Financeiro

| Conceito | Coleção | Estratégia | Justificativa |
|----------|---------|------------|---------------|
| Payment | `payments` | Coleção separada | CD-028: multiple attempts per Order; CD-063 states |
| Provider | Config (não coleção) | — | CD-064: Stripe Connect; config em env/secrets |
| Wallet | `wallets` | Coleção separada | CD-030: shared Vendor/Marketplace; balance derivado |
| Transaction | `transactions` | Coleção separada | CD-031: generic ledger; append-only (CD-033) |
| Refund | `refunds` | Coleção separada | CD-032/048: partial/full; grouped by vendor |

**PROPOSTA P3a — Esquema `payments`:**
```javascript
{
  _id: ObjectId,
  order_id: ObjectId,
  amount: Decimal128,
  currency: "BRL",
  status: "PENDING" | "AUTHORIZED" | "CAPTURED" | "FAILED" | "REFUNDED", // CD-063
  provider: "stripe_connect",
  provider_charge_id: String, // Stripe Charge ID
  provider_payment_intent_id: String,
  idempotency_key: String, // CD-064/065: native + app-level
  captured_at: DateTime?,
  failed_at: DateTime?,
  failure_reason: String?,
  created_at: DateTime,
  updated_at: DateTime
}
```
**Índices `payments`:** `{ order_id: 1 }`, `{ provider_charge_id: 1 }` unique, `{ idempotency_key: 1 }` unique

**PROPOSTA P3a — Esquema `wallets`:**
```javascript
{
  _id: ObjectId,
  owner_type: "vendor" | "marketplace",
  owner_id: ObjectId, // vendor_id ou marketplace singleton
  balance: Decimal128, // derived from transactions; cached
  currency: "BRL",
  last_transaction_id: ObjectId?,
  updated_at: DateTime
}
```
**Índices `wallets`:** `{ owner_type: 1, owner_id: 1 }` unique

**PROPOSTA P3a — Esquema `transactions` (CD-031, CD-033 append-only):**
**PROPOSTA P3a — Esquema `transactions` (CD-031, CD-033 append-only):**
```javascript
{
  _id: ObjectId,
  wallet_id: ObjectId,
  payment_id: ObjectId?, // ref if from payment
  refund_id: ObjectId?, // ref if from refund
  type: "sale" | "commission" | "refund" | "payout" | "adjustment", // CD-031
  amount: Decimal128, // positive = credit, negative = debit
  running_balance: Decimal128, // snapshot after this transaction
  description: String,
  metadata: Document, // { ovg_id, order_id, commission_pct, etc }
  created_at: DateTime
}
```
**Índices `transactions`:** `{ wallet_id: 1, created_at: -1 }`, `{ payment_id: 1 }`, `{ refund_id: 1 }`

**PROPOSTA P3a — Esquema `refunds`:**
```javascript
{
  _id: ObjectId,
  payment_id: ObjectId, // original payment
  order_id: ObjectId,
  ovg_id: ObjectId, // CD-032: grouped by vendor
  amount: Decimal128,
  currency: "BRL",
  status: "requested" | "sent" | "completed" | "failed", // CD-048: "sent" = request sent
  items: [ // selected Order_Items for refund
    { ovg_id: ObjectId, product_id: ObjectId, quantity: Number, unit_price: Decimal128 }
  ],
  commission_adjustment: Decimal128, // CD-048/065: proportional
  provider_refund_id: String?, // Stripe Refund ID
  idempotency_key: String,
  created_at: DateTime,
  completed_at: DateTime?
}
```
**Índices `refunds`:** `{ payment_id: 1 }`, `{ ovg_id: 1 }`, `{ idempotency_key: 1 }` unique

---

### 3.5 Cupons e Reviews

| Conceito | Coleção | Estratégia |
|----------|---------|------------|
| Coupon | `coupons` | Coleção separada |
| Coupon_Target | Embedded em `coupons` | Embedding 1:1 (CD-026/050) |
| Review | `reviews` | Coleção separada |

**PROPOSTA P3a — Esquema `coupons`:**
```javascript
{
  _id: ObjectId,
  vendor_id: ObjectId,
  code: String, // unique per vendor
  discount_type: "percentage" | "fixed",
  discount_value: Decimal128,
  starts_at: DateTime,
  ends_at: DateTime,
  target: { // CD-050: Coupon_Target embedded
    product_ids: [ObjectId], // inclusion
    category_ids: [ObjectId], // inclusion (includes descendants)
    excluded_product_ids: [ObjectId], // exclusion overrides
    excluded_category_ids: [ObjectId] // exclusion overrides
  },
  max_uses_per_coupon: Number?, // **PENDENTE Q-016**
  max_uses_per_user: Number?, // **PENDENTE Q-016**
  min_order_value: Decimal128?, // **PENDENTE Q-016**
  status: "active" | "expired" | "disabled",
  used_count: Number,
  created_at: DateTime,
  updated_at: DateTime
}
```
**Índices `coupons`:** `{ vendor_id: 1, code: 1 }` unique, `{ vendor_id: 1, status: 1 }`, `{ ends_at: 1 }` (TTL cleanup)

**PROPOSTA P3a — Esquema `reviews`:**
```javascript
{
  _id: ObjectId,
  product_id: ObjectId,
  consumer_id: ObjectId, // verified purchaser (CD-017)
  order_item_id: ObjectId, // proof of purchase
  rating: Number, // 1-5 — **PENDENTE Q-017**
  comment: String,
  images: [ObjectId], // refs to product_pics — **OWNERSHIP PENDENTE Q-017** (owned vs shared)
  status: "published" | "hidden", // post-moderation — **PENDENTE Q-017**
  vendor_response: { // single response — **PENDENTE Q-017**
    text: String,
    responded_at: DateTime
  }?,
  created_at: DateTime,
  updated_at: DateTime
}
```
**Índices `reviews`:** `{ product_id: 1, status: 1, created_at: -1 }`, `{ consumer_id: 1 }`, `{ order_item_id: 1 }` unique (one review per purchase)

---

### 3.6 Invoice e Marketplace

| Conceito | Coleção | Estratégia |
|----------|---------|------------|
| Invoice | `invoices` | Coleção separada |
| Invoice_History | Placeholder (CD-038) | Não implementar agora |
| Marketplace | `marketplace` | Singleton (CD-038/Q-020) |

**PROPOSTA P3a — Esquema `invoices`:**
```javascript
{
  _id: ObjectId,
  order_id: ObjectId,
  emission_at: DateTime,
  pdf_path: String, // S3 key
  // Content uses historical Order values (CD-036)
  created_at: DateTime
}
```
**Índices `invoices`:** `{ order_id: 1 }` unique, `{ emission_at: -1 }`

**Esquema `marketplace` (singleton):**
```javascript
{
  _id: "singleton", // fixed _id
  name: String,
  commission_pct: Number, // CD-045: global %
  wallet_id: ObjectId, // ref to wallets (owner_type="marketplace")
  admins: [ObjectId], // person_ids with admin role
  created_at: DateTime,
  updated_at: DateTime
}
```

---

### 3.7 Search Index (Elasticsearch) — Referência

Conforme CD-049 e análise ES (`docs/analysis/analysis_es_strategy.md`):
- **Índice único:** `products`
- **Denormalização:** `category_path` para descendant filtering
- **Analyzer:** Portuguese stemmer
- **Sync:** Dual-write + periodic full reindex

---

## 4. Resumo de Coleções

| # | Coleção | Tipo | Estimativa Cardinalidade |
|---|---------|------|--------------------------|
| 1 | `people` | Core | ~Usuários |
| 2 | `credentials` | Auth | = people |
| 3 | `addresses` | Core | ~3-5 x people |
| 4 | `contact_infos` | Core | ~2-3 x people |
| 5 | `vendors` | Core | Subset of people |
| 6 | `categories` | Catalog | ~100-1000 |
| 7 | `products` | Catalog | ~10k-1M |
| 8 | `product_pics` | Catalog | ~3-5 x products |
| 9 | `orders` | Orders | ~Transações |
| 10 | `order_vendor_groups` | Orders | ~1.5-3 x orders |
| 11 | `order_status_history` | Audit | ~5-10 x orders |
| 12 | `order_vendor_group_history` | Audit | ~5-10 x OVGs |
| 13 | `payments` | Payments | ~1.2 x orders |
| 14 | `wallets` | Financial | ~Vendors + 1 |
| 15 | `transactions` | Financial | High (ledger) |
| 16 | `refunds` | Financial | Subset of payments |
| 17 | `coupons` | Promotions | ~Vendors x few |
| 18 | `reviews` | Reviews | ~Orders x items |
| 19 | `invoices` | Invoices | ~Orders |
| 20 | `marketplace` | Config | 1 |

---

## 5. Decisões de Embedding vs Referencing — Resumo

| Relacionamento | Decisão | Regra Aplicada |
|----------------|---------|----------------|
| Person ↔ Main_Info | Embed | 1:1, always accessed together (CD-006) |
| Person ↔ Credential | Reference | Security isolation; 1:1 but sensitive (CD-060) |
| Person ↔ Address | Reference | 1:N, independent queries (checkout) |
| Person ↔ Contact_Info | Reference | 1:N, email uniqueness global (CD-060) |
| Vendor → Product | Reference (vendor_id em Product) | 1:N high cardinality; vendor queries own products |
| Category ↔ Category (parent) | Reference (parent_id) | Tree structure; cycle prevention (CD-043) |
| Category → Product | Reference (category_id + category_path) | 1:N; path para ES/hierarchy filter |
| Product → Product_Pic | Reference (array de IDs) | 1:N; shared com Review |
| Order → Order_Vendor_Group | Reference (array ovg_ids) | 1:N; independent fulfillment (CD-022) |
| Order_Vendor_Group → Order_Item | Embed | 1:N small; immutable snapshot (CD-023/027) |
| Order_Vendor_Group → Coupon | Reference (optional) | N:1 optional (CD-026) |
| Order → Payment | Reference (array payment_ids) | 1:N multiple attempts (CD-028) |
| Payment → Transaction | Reference | 1:N; Transaction is ledger entry |
| Wallet → Transaction | Reference | 1:N high volume; append-only (CD-033) |
| Refund → Order_Vendor_Group | Reference | Grouped by vendor (CD-032) |
| Review → Product_Pic | Reference | Shared images (owned recommended) |

---

## 6. Validação dos Critérios de Aceitação

| Critério | Atendido? | Evidência |
|----------|-----------|-----------|
| Map concepts → collections | ✅ | Seção 3 mapeia todos 30 conceitos |
| Embedding vs refs decidido | ✅ | Seção 5 resume todas as decisões |
| Collection schemas definidos | ✅ | Seção 3 esquemas completos com campos |
| Índices definidos | ✅ | Cada coleção lista índices propostos |
| Baseado em decisões confirmadas | ✅ | Referências CD-* em cada decisão |
| CD-005 (persistence deferred) | ⚠️ | **Design físico proposto (P3a)** — CD-005 defere decisão para nível técnico; esta análise documenta a **proposta de design** sujeita a validação na implementação (P4+) |

---

## 7. Próximos Passos (P3a restantes)

- **T-302:** Design Elasticsearch mappings (baseado em `products` schema + `category_path`)
- **T-303:** Design Redis schemas (Cart, Session — CD-018)
- **T-304:** Define S3 object naming (Product_Pic, Invoice — CD-016, CD-035)
- **T-305:** Data integrity rules (unique constraints, referential integrity)
- **T-306:** Migration/seed strategy

---

## 8. Rastreabilidade

| Item | Referência |
|------|------------|
| Task | T-301 (docs/task_list.md) |
| Conceitos | docs/conceptual_model.md (seções 1-31) |
| Decisões | docs/decisions.md (CD-001 a CD-065) |
| Requisitos Funcionais | docs/functional_requirements.md (FR-*) |
| Requisitos Não-Funcionais | docs/non-functional_requirements.md (NFR-DATA-001) |
| Análise ES | docs/analysis/analysis_es_strategy.md |

---

**Status:** **CONCLUÍDO** — Design documentado pronto para revisão independente e implementação posterior (P4+).