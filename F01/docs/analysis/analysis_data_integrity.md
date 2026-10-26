# Análise de Design — Data Integrity Rules

**Data:** 2026-10-25  
**Executor:** code-orchestrator (T-305)  
**Fase:** P3a — Logical & Physical Data Models  
**Dependência:** T-301 (MongoDB collections) ✅  
**Critério de Aceitação:** Rules documented per collection  

---

## 1. Objetivo

Documentar as regras de integridade de dados para cada coleção MongoDB, incluindo:
- Unique constraints
- Referential integrity (validação de FKs)
- Validation rules (schema validation)
- Atomic operations patterns
- Optimistic locking

Baseado em `F01/docs/analysis/analysis_mongodb_collections.md` (T-301).

---

## 2. Princípios Gerais

| Princípio | Implementação |
|-----------|---------------|
| **MongoDB Schema Validation** | `$jsonSchema` validator em cada coleção (MongoDB 3.6+) |
| **Referential Integrity** | Validação em aplicação (não FK nativa); soft deletes + checks |
| **Unique Constraints** | Índices únicos + validação pré-insert |
| **Atomic Operations** | `findOneAndUpdate` com `$inc`, `$set`, `arrayFilters`; transações multi-document para cross-collection |
| **Optimistic Locking** | Campo `version` (integer) em documentos mutáveis; `findOneAndUpdate` com `version` match |

---

## 3. Regras por Coleção

### 3.1 `people`

**Schema Validation:**
```json
{
  "$jsonSchema": {
    "bsonType": "object",
    "required": ["roles", "main_info", "status", "created_at", "updated_at", "version"],
    "properties": {
      "roles": {
        "bsonType": "array",
        "items": { "enum": ["consumer", "vendor", "admin"] },
        "minItems": 1,
        "maxItems": 3
      },
      "main_info": {
        "bsonType": "object",
        "required": ["name", "tax_id"],
        "properties": {
          "name": { "bsonType": "string", "minLength": 2 },
          "tax_id": {
            "bsonType": "object",
            "required": ["type", "value"],
            "properties": {
              "type": { "enum": ["cpf", "cnpj"] },
              "value": { "bsonType": "string", "pattern": "^[0-9]{11}$|^[0-9]{14}$" }
            }
          }
        }
      },
      "status": { "enum": ["active", "suspended", "inactive"] },
      "version": { "bsonType": "int", "minimum": 1 }
    }
  }
}
```

**Unique Constraints:**
- `main_info.tax_id.value` — unique (CPF/CNPJ único global)
- `primary_contact_id` — unique (um contato primário por pessoa, CD-061)

**Referential Integrity:**
- `primary_address_id` → `addresses._id` (validar existência)
- `primary_contact_id` → `contact_infos._id` (validar existência; type=email)
- `credentials.person_id` → `people._id` (1:1)

**Validation Rules:**
- CD-002: `roles` pode conter `consumer` + `vendor` simultaneamente
- CD-003: `roles` NÃO pode conter `admin` + `consumer`/`vendor`
- CD-007: `tax_id.type` + `value` validado (CPF 11 dígitos, CNPJ 14 dígitos, check digits)

---

### 3.2 `credentials`

**Schema Validation:**
```json
{
  "$jsonSchema": {
    "bsonType": "object",
    "required": ["person_id", "password_hash", "status", "created_at", "updated_at"],
    "properties": {
      "person_id": { "bsonType": "objectId" },
      "password_hash": { "bsonType": "string", "minLength": 60 }, // bcrypt
      "status": { "enum": ["active", "locked", "expired"] },
      "failed_attempts": { "bsonType": "int", "minimum": 0 },
      "locked_until": { "bsonType": ["date", "null"] }
    }
  }
}
```

**Unique Constraints:**
- `person_id` — unique (CD-060: 1:1)

**Referential Integrity:**
- `person_id` → `people._id` (cascade: se Person deletado, Credential deletado)

---

### 3.3 `addresses`

**Schema Validation:**
```json
{
  "$jsonSchema": {
    "bsonType": "object",
    "required": ["person_id", "street", "number", "neighborhood", "city", "state", "is_primary", "created_at", "updated_at"],
    "properties": {
      "person_id": { "bsonType": "objectId" },
      "street": { "bsonType": "string", "minLength": 1 },
      "number": { "bsonType": "string", "minLength": 1 },
      "neighborhood": { "bsonType": "string", "minLength": 1 },
      "city": { "bsonType": "string", "minLength": 1 },
      "state": { "bsonType": "string", "pattern": "^[A-Z]{2}$" }, // UF 2 letras
      "is_primary": { "bsonType": "bool" }
    }
  }
}
```

**Unique Constraints:**
- Partial index: `{ person_id: 1, is_primary: 1 }` unique onde `is_primary: true` (um endereço primário por pessoa)

**Referential Integrity:**
- `person_id` → `people._id` (cascade: se Person deletado, Addresses deletados)

---

### 3.4 `contact_infos`

**Schema Validation:**
```json
{
  "$jsonSchema": {
    "bsonType": "object",
    "required": ["person_id", "type", "value", "is_primary", "created_at", "updated_at"],
    "properties": {
      "person_id": { "bsonType": "objectId" },
      "type": { "enum": ["email", "phone", "whatsapp"] },
      "value": { "bsonType": "string", "minLength": 1 },
      "is_primary": { "bsonType": "bool" }
    }
  }
}
```

**Unique Constraints:**
- Partial index: `{ type: 1, value: 1 }` unique onde `type: "email"` (CD-060: login email único global)
- Partial index: `{ person_id: 1, is_primary: 1 }` unique onde `is_primary: true` por pessoa

**Referential Integrity:**
- `person_id` → `people._id` (cascade)
- `people.primary_contact_id` → `contact_infos._id` (validar existência)

**Validation Rules:**
- Email format validation (regex)
- Phone/WhatsApp: Brazilian format (DDD + número)

---

### 3.5 `vendors`

**Schema Validation:**
```json
{
  "$jsonSchema": {
    "bsonType": "object",
    "required": ["person_id", "store_name", "status", "commission_pct", "wallet_id", "created_at", "updated_at"],
    "properties": {
      "person_id": { "bsonType": "objectId" },
      "store_name": { "bsonType": "string", "minLength": 2 },
      "status": { "enum": ["active", "suspended"] },
      "commission_pct": { "bsonType": "double", "minimum": 0, "maximum": 100 },
      "wallet_id": { "bsonType": "objectId" }
    }
  }
}
```

**Unique Constraints:**
- `person_id` — unique (CD-011)

**Referential Integrity:**
- `person_id` → `people._id` (role vendor deve existir)
- `wallet_id` → `wallets._id` (owner_type=vendor)

---

### 3.6 `categories`

**Schema Validation:**
```json
{
  "$jsonSchema": {
    "bsonType": "object",
    "required": ["name", "path", "level", "created_at", "updated_at"],
    "properties": {
      "name": { "bsonType": "string", "minLength": 1 },
      "parent_id": { "bsonType": ["objectId", "null"] },
      "path": { "bsonType": "string", "pattern": "^([a-z0-9-]+/)*[a-z0-9-]+$" },
      "level": { "bsonType": "int", "minimum": 0 }
    }
  }
}
```

**Unique Constraints:**
- `{ parent_id: 1, name: 1 }` unique (nome único entre irmãos)

**Referential Integrity:**
- `parent_id` → `categories._id` (self-ref; cycle prevention obrigatório)
- Validação: `level` = parent.level + 1 (se parent_id existe)

**Cycle Prevention (aplicação):**
```javascript
async function validateNoCycle(categoryId, newParentId) {
  let current = newParentId;
  while (current) {
    if (current.equals(categoryId)) throw new Error('Cycle detected');
    const parent = await categories.findOne({ _id: current }, { projection: { parent_id: 1 } });
    current = parent?.parent_id;
  }
}
```

---

### 3.7 `products`

**Schema Validation:**
```json
{
  "$jsonSchema": {
    "bsonType": "object",
    "required": ["vendor_id", "category_id", "category_path", "name", "price", "currency", "quantity", "status", "created_at", "updated_at", "version"],
    "properties": {
      "vendor_id": { "bsonType": "objectId" },
      "category_id": { "bsonType": "objectId" },
      "category_path": { "bsonType": "string" },
      "name": { "bsonType": "string", "minLength": 1 },
      "price": { "bsonType": "decimal" },
      "currency": { "enum": ["BRL"] },
      "quantity": { "bsonType": "int", "minimum": 0 },
      "status": { "enum": ["active", "inactive"] },
      "images": { "bsonType": "array", "items": { "bsonType": "objectId" } },
      "version": { "bsonType": "int", "minimum": 1 }
    }
  }
}
```

**Unique Constraints:**
- Nenhum (produtos podem ter mesmo nome em vendors diferentes)

**Referential Integrity:**
- `vendor_id` → `vendors._id` (vendor deve ser active)
- `category_id` → `categories._id`
- `images[]` → `product_pics._id`

**Validation Rules:**
- CD-013: `quantity` >= 0; display ordena `quantity > 0` primeiro
- CD-042: `status: inactive` impede novo sales (validar no checkout)
- CD-062: Sem variants (cada variação = Product separado)

**Optimistic Locking:**
- `version` incrementado a cada update
- `findOneAndUpdate({ _id, version }, { $inc: { version: 1 }, $set: {...} })`

---

### 3.8 `product_pics`

**Schema Validation:**
```json
{
  "$jsonSchema": {
    "bsonType": "object",
    "required": ["path", "sort_order", "created_at"],
    "properties": {
      "product_id": { "bsonType": ["objectId", "null"] },
      "review_id": { "bsonType": ["objectId", "null"] },
      "path": { "bsonType": "string" },
      "sort_order": { "bsonType": "int", "minimum": 0 }
    }
  }
}
```

**Constraints:**
- Pelo menos um de `product_id` ou `review_id` deve ser preenchido (CD-016: imagens compartilhadas entre Product e Review)
- Ambos podem ser preenchidos para imagens compartilhadas (mesmo arquivo referenciado por Product e Review)

---

### 3.9 `orders`

**Schema Validation:**
```json
{
  "$jsonSchema": {
    "bsonType": "object",
    "required": ["consumer_id", "status", "financial_status", "total_amount", "currency", "shipping_address_snapshot", "ovg_ids", "payment_ids", "created_at", "updated_at", "version"],
    "properties": {
      "consumer_id": { "bsonType": "objectId" },
      "status": { "enum": ["PENDING_PAYMENT", "PAID", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED", "FAILED_PAYMENT"] },
      "financial_status": { "enum": ["PAID", "PARTIALLY_REFUNDED", "FULLY_REFUNDED"] },
      "total_amount": { "bsonType": "decimal" },
      "currency": { "enum": ["BRL"] },
      "shipping_address_snapshot": {
        "bsonType": "object",
        "required": ["street", "number", "neighborhood", "city", "state"],
        "properties": {
          "street": { "bsonType": "string" },
          "number": { "bsonType": "string" },
          "neighborhood": { "bsonType": "string" },
          "city": { "bsonType": "string" },
          "state": { "bsonType": "string", "pattern": "^[A-Z]{2}$" }
        }
      },
      "ovg_ids": { "bsonType": "array", "items": { "bsonType": "objectId" } },
      "payment_ids": { "bsonType": "array", "items": { "bsonType": "objectId" } },
      "version": { "bsonType": "int", "minimum": 1 }
    }
  }
}
```

**Referential Integrity:**
- `consumer_id` → `people._id` (role consumer)
- `ovg_ids[]` → `order_vendor_groups._id`
- `payment_ids[]` → `payments._id`
- `shipping_address_snapshot` — imutável (snapshot CD-061)

**Cross-Machine Consistency (CD-063):**
- `PENDING_PAYMENT` → pelo menos um Payment `PENDING`/`AUTHORIZED`
- `PAID` → exatamente um Payment `CAPTURED`
- `PROCESSING` → pelo menos um OVG `CONFIRMED`
- `SHIPPED` → todos OVGs `SHIPPED`
- `DELIVERED` → todos OVGs `DELIVERED`

---

### 3.10 `order_vendor_groups`

**Schema Validation:**
```json
{
  "$jsonSchema": {
    "bsonType": "object",
    "required": ["order_id", "vendor_id", "status", "commission_pct", "vendor_net", "items", "created_at", "updated_at", "version"],
    "properties": {
      "order_id": { "bsonType": "objectId" },
      "vendor_id": { "bsonType": "objectId" },
      "status": { "enum": ["PENDING", "CONFIRMED", "PREPARING", "SHIPPED", "DELIVERED", "CANCELLED", "RETURNED"] },
      "commission_pct": { "bsonType": "double", "minimum": 0, "maximum": 100 },
      "vendor_net": { "bsonType": "decimal" },
      "items": {
        "bsonType": "array",
        "items": {
          "bsonType": "object",
          "required": ["_id", "product_id", "product_name_snapshot", "unit_price_snapshot", "quantity", "subtotal"],
          "properties": {
            "_id": { "bsonType": "objectId" },
            "product_id": { "bsonType": "objectId" },
            "product_name_snapshot": { "bsonType": "string" },
            "unit_price_snapshot": { "bsonType": "decimal" },
            "quantity": { "bsonType": "int", "minimum": 1 },
            "subtotal": { "bsonType": "decimal" }
          }
        }
      },
      "coupon_id": { "bsonType": ["objectId", "null"] },
      "version": { "bsonType": "int", "minimum": 1 }
    }
  }
}
```

**Referential Integrity:**
- `order_id` → `orders._id`
- `vendor_id` → `vendors._id` (active)
- `items[].product_id` → `products._id`
- `coupon_id` → `coupons._id` (se presente)

**Validation Rules:**
- `vendor_net` = sum(items.subtotal) * (1 - commission_pct/100)
- Items embedded: imutáveis após criação (price snapshot CD-023)

---

### 3.11 `payments`

**Schema Validation:**
```json
{
  "$jsonSchema": {
    "bsonType": "object",
    "required": ["order_id", "amount", "currency", "status", "provider", "provider_payment_intent_id", "idempotency_key", "created_at", "updated_at"],
    "properties": {
      "order_id": { "bsonType": "objectId" },
      "amount": { "bsonType": "decimal" },
      "currency": { "enum": ["BRL"] },
      "status": { "enum": ["PENDING", "AUTHORIZED", "CAPTURED", "FAILED", "REFUNDED"] },
      "provider": { "enum": ["stripe_connect"] },
      "provider_charge_id": { "bsonType": ["string", "null"] },
      "provider_payment_intent_id": { "bsonType": "string" },
      "idempotency_key": { "bsonType": "string" },
      "captured_at": { "bsonType": ["date", "null"] },
      "failed_at": { "bsonType": ["date", "null"] }
    }
  }
}
```

**Unique Constraints:**
- `provider_charge_id` — unique (Stripe Charge ID)
- `idempotency_key` — unique (CD-064/065)

**Referential Integrity:**
- `order_id` → `orders._id`

---

### 3.12 `wallets`

**Schema Validation:**
```json
{
  "$jsonSchema": {
    "bsonType": "object",
    "required": ["owner_type", "owner_id", "balance", "currency", "updated_at"],
    "properties": {
      "owner_type": { "enum": ["vendor", "marketplace"] },
      "owner_id": { "bsonType": "objectId" },
      "balance": { "bsonType": "decimal" },
      "currency": { "enum": ["BRL"] }
    }
  }
}
```

**Unique Constraints:**
- `{ owner_type: 1, owner_id: 1 }` unique

**Referential Integrity:**
- `owner_type: vendor` + `owner_id` → `vendors._id`
- `owner_type: marketplace` + `owner_id` → `marketplace._id` (singleton)

---

### 3.13 `transactions` (append-only CD-033)

**Schema Validation:**
```json
{
  "$jsonSchema": {
    "bsonType": "object",
    "required": ["wallet_id", "type", "amount", "running_balance", "description", "metadata", "created_at"],
    "properties": {
      "wallet_id": { "bsonType": "objectId" },
      "payment_id": { "bsonType": ["objectId", "null"] },
      "refund_id": { "bsonType": ["objectId", "null"] },
      "type": { "enum": ["sale", "commission", "refund", "payout", "adjustment"] },
      "amount": { "bsonType": "decimal" },
      "running_balance": { "bsonType": "decimal" },
      "metadata": { "bsonType": "object" }
    }
  }
}
```

**Constraints:**
- **Append-only**: Nunca update/delete (CD-033)
- `running_balance` = previous + amount
- Exatamente um de `payment_id` ou `refund_id` (xor)

---

### 3.14 `refunds`

**Schema Validation:**
```json
{
  "$jsonSchema": {
    "bsonType": "object",
    "required": ["payment_id", "order_id", "ovg_id", "amount", "currency", "status", "items", "commission_adjustment", "idempotency_key", "created_at"],
    "properties": {
      "payment_id": { "bsonType": "objectId" },
      "order_id": { "bsonType": "objectId" },
      "ovg_id": { "bsonType": "objectId" },
      "amount": { "bsonType": "decimal" },
      "currency": { "enum": ["BRL"] },
      "status": { "enum": ["requested", "sent", "completed", "failed"] },
      "items": {
        "bsonType": "array",
        "items": {
          "bsonType": "object",
          "required": ["ovg_id", "product_id", "quantity", "unit_price"],
          "properties": {
            "ovg_id": { "bsonType": "objectId" },
            "product_id": { "bsonType": "objectId" },
            "quantity": { "bsonType": "int", "minimum": 1 },
            "unit_price": { "bsonType": "decimal" }
          }
        }
      },
      "commission_adjustment": { "bsonType": "decimal" },
      "idempotency_key": { "bsonType": "string" }
    }
  }
}
```

**Unique Constraints:**
- `idempotency_key` — unique

**Referential Integrity:**
- `payment_id` → `payments._id` (status CAPTURED)
- `order_id` → `orders._id`
- `ovg_id` → `order_vendor_groups._id`
- `items[].product_id` → `products._id`

---

### 3.15 `coupons`

**Schema Validation:**
```json
{
  "$jsonSchema": {
    "bsonType": "object",
    "required": ["vendor_id", "code", "discount_type", "discount_value", "starts_at", "ends_at", "target", "status", "created_at", "updated_at"],
    "properties": {
      "vendor_id": { "bsonType": "objectId" },
      "code": { "bsonType": "string", "pattern": "^[A-Z0-9]{4,20}$" },
      "discount_type": { "enum": ["percentage", "fixed"] },
      "discount_value": { "bsonType": "decimal", "minimum": 0 },
      "target": {
        "bsonType": "object",
        "properties": {
          "product_ids": { "bsonType": "array", "items": { "bsonType": "objectId" } },
          "category_ids": { "bsonType": "array", "items": { "bsonType": "objectId" } },
          "excluded_product_ids": { "bsonType": "array", "items": { "bsonType": "objectId" } },
          "excluded_category_ids": { "bsonType": "array", "items": { "bsonType": "objectId" } }
        }
      },
      "status": { "enum": ["active", "expired", "disabled"] }
    }
  }
}
```

**Unique Constraints:**
- `{ vendor_id: 1, code: 1 }` unique

**Validation Rules (CD-050):**
- **Decidido (CD-050/MP-07E):**
  - Inclusion: category inclui descendants
  - Exclusion: override inclusion
  - No stacking: max 1 coupon per vendor per purchase (validado no checkout)
- **Pendente (Q-016 / FR-PEND-004):**
  - Mixed eligible/ineligible cart discount calculation formula
  - Usage limits (per coupon, per user, total) — `max_uses_per_coupon`, `max_uses_per_user`
  - Minimum order value — `min_order_value`
  - Platform-wide coupons vs vendor-only

---

### 3.16 `reviews`

**Schema Validation:**
```json
{
  "$jsonSchema": {
    "bsonType": "object",
    "required": ["product_id", "consumer_id", "order_item_id", "rating", "status", "created_at", "updated_at"],
    "properties": {
      "product_id": { "bsonType": "objectId" },
      "consumer_id": { "bsonType": "objectId" },
      "order_item_id": { "bsonType": "objectId" },
      "rating": { "bsonType": "int", "minimum": 1, "maximum": 5 }, // Q-017: 1-5 stars
      "comment": { "bsonType": "string" },
      "images": { "bsonType": "array", "items": { "bsonType": "objectId" } }, // refs product_pics
      "status": { "enum": ["published", "hidden"] }, // post-moderation (Q-017)
      "vendor_response": {
        "bsonType": "object",
        "properties": {
          "text": { "bsonType": "string" },
          "responded_at": { "bsonType": "date" }
        }
      }
    }
  }
}
```

**Unique Constraints:**
- `order_item_id` — unique (one review per purchase, CD-017)

**Referential Integrity:**
- `product_id` → `products._id`
- `consumer_id` → `people._id` (role consumer)
- `order_item_id` → `order_vendor_groups.items._id` (validar verified purchase)
- `images[]` → `product_pics._id`

---

### 3.17 `invoices`

**Schema Validation:**
```json
{
  "$jsonSchema": {
    "bsonType": "object",
    "required": ["order_id", "emission_at", "pdf_path", "created_at"],
    "properties": {
      "order_id": { "bsonType": "objectId" },
      "emission_at": { "bsonType": "date" },
      "pdf_path": { "bsonType": "string" }
    }
  }
}
```

**Unique Constraints:**
- `order_id` — unique (um invoice por order)

**Referential Integrity:**
- `order_id` → `orders._id` (status DELIVERED ou PAID, conforme trigger Q-018)

---

### 3.18 `marketplace` (singleton)

**Schema Validation:**
```json
{
  "$jsonSchema": {
    "bsonType": "object",
    "required": ["_id", "name", "commission_pct", "wallet_id", "admins", "created_at", "updated_at"],
    "properties": {
      "_id": { "const": "singleton" },
      "name": { "bsonType": "string" },
      "commission_pct": { "bsonType": "double", "minimum": 0, "maximum": 100 },
      "wallet_id": { "bsonType": "objectId" },
      "admins": { "bsonType": "array", "items": { "bsonType": "objectId" } }
    }
  }
}
```

---

## 4. Atomic Operations Patterns

### 4.1 Stock Decrement (Checkout) — Optimistic Locking
```javascript
async function decrementStock(productId, quantity, expectedVersion) {
  const result = await products.findOneAndUpdate(
    { _id: productId, version: expectedVersion, quantity: { $gte: quantity } },
    { $inc: { quantity: -quantity, version: 1 } },
    { returnDocument: 'after' }
  );
  if (!result) throw new Error('Insufficient stock or version conflict');
  return result;
}
```

### 4.2 Wallet Balance Update (Transaction) — Transação
```javascript
async function recordTransaction(walletId, type, amount, metadata) {
  const session = await mongo.startSession();
  try {
    await session.withTransaction(async () => {
      const wallet = await wallets.findOneAndUpdate(
        { _id: walletId },
        { $inc: { balance: amount } },
        { session, returnDocument: 'after' }
      );
      const runningBalance = wallet.balance;
      
      await transactions.insertOne({
        wallet_id: walletId,
        type,
        amount,
        running_balance: runningBalance,
        metadata,
        created_at: new Date()
      }, { session });
    });
  } finally {
    await session.endSession();
  }
}
```

### 4.3 Order Creation (Multi-collection) — Transação
```javascript
async function createOrder(cartData) {
  const session = await mongo.startSession();
  try {
    const result = await session.withTransaction(async () => {
      // 1. Create Order_Vendor_Groups
      const ovgs = await orderVendorGroups.insertMany(ovgDocs, { session });
      // 2. Create Order with ovg_ids
      const order = await orders.insertOne(orderDoc, { session });
      // 3. Create PaymentIntent (Stripe) - external, compensating if fails
      return { order, ovgs };
    });
    
    // 4. Clear Redis cart AFTER successful MongoDB transaction commit
    // Redis is not part of MongoDB transaction — cannot be rolled back
    // If Redis del fails, cart will be cleared on next login via merge logic (idempotent)
    try {
      await redis.del(`cart:${consumerId}`);
    } catch (redisError) {
      // Log error but don't fail the order creation
      // Cart will be cleared on next login via guest→user merge logic
      logger.warn('Failed to clear Redis cart after order creation', { 
        consumerId, 
        error: redisError.message 
      });
    }
    
    return result;
  } finally {
    await session.endSession();
  }
}
```

---

### 4.4 Cart Cleanup — Compensation Pattern

---

## 5. Cross-Store Integrity Rules

Além da integridade intra-MongoDB, o sistema requer validação de consistência entre stores:

| Store Pair | Regra | Implementação |
|------------|-------|---------------|
| **MongoDB ↔ Elasticsearch** | Dual-write sync: todo create/update/delete em `products` → index ES | Write-through no serviço Product; job diário full reindex com alias swap (Seção 5.2 `analysis_es_mappings.md`); reconciliation job semanal comparando contagens MongoDB vs ES |
| **MongoDB ↔ Redis (Cart)** | Checkout valida: `cart.items[].quantity` ≤ `products.quantity` e `products.status = 'active'` | Lua script atômico no checkout lê cart Redis + valida contra MongoDB (Seção 7 `analysis_redis_schemas.md`) |
| **MongoDB ↔ Redis (Cache)** | Invalidação de `product:{product_id}` e `vendor:metrics:{vendor_id}` em updates | Write-through: Product/Order update → `DEL` keys Redis (Seção 7 `analysis_redis_schemas.md`) |
| **MongoDB ↔ S3** | Referência `product_pics.path` e `invoices.pdf_path` existem no S3 | Validação no upload (object exists); cleanup job diário para órfãos (Seção 8 `analysis_s3_naming.md`) |
| **MongoDB ↔ S3 (Delete)** | Delete product → delete imagens S3 associadas | Compensating transaction: Product delete → list product_pics → S3 DeleteObjects |

### 5.1 Financial Operations — Compensation/Saga Patterns

Operações financeiras envolvem MongoDB + Stripe Connect (externo) e requerem padrões explícitos de compensação para garantir consistência eventual com boundaries definidos:

| Fluxo | Stores Envolvidas | Padrão de Compensação | Boundary de Consistência |
|-------|-------------------|----------------------|--------------------------|
| **Payment Capture** (charge.succeeded) | MongoDB (orders, payments, ovgs, wallets, transactions) + Stripe | **Saga Orchestrated**:<br>1. MongoDB TX: Order=PAID, Payment=CAPTURED, OVGs=PENDING, Wallet+Transaction (sale)<br>2. Stripe Transfer creation (async, application-level idempotency_key)<br>3. Se Transfer falha → compensation: Order=PAID (mantém), cria job de retry Transfer + alerta<br>4. Reconciliação diária: pagamentos CAPTURED sem Transfer correspondente | **Strong consistency** dentro do MongoDB TX; **Eventual (max 24h)** para Transfer |
| **Transfer Completion** (transfer.paid) | MongoDB (wallets, transactions, ovgs) + Stripe | **Event-driven**: webhook `transfer.paid` → MongoDB TX: Wallet+Transaction (payout), OVG=CONFIRMED (se vendor confirmou) | **Eventual (max 1h)** após webhook |
| **Refund** (customer) | MongoDB (orders, payments, refunds, wallets, transactions, ovgs) + Stripe | **Saga Orchestrated**:<br>1. Stripe Refund creation (idempotency_key)<br>2. MongoDB TX: Refund=REQUESTED, Payment=REFUNDED (se total), Order financial_status=PARTIALLY_REFUNDED/FULLY_REFUNDED, Wallet+Transaction (refund + commission adjustment)<br>3. Stripe Transfer reversal (manual, CD-065 regra 9)<br>4. Se reversal falha → job de retry + alerta financeiro | **Strong consistency** MongoDB TX; **Eventual (max 48h)** para Transfer reversal |
| **Product Stock Decrement** (checkout) | MongoDB (products, order_vendor_groups, orders) + Redis (cart) | **MongoDB TX + Redis compensation**:<br>1. MongoDB TX: stock decrement (optimistic locking), OVG creation, Order creation<br>2. Redis cart clear (FORA da TX, após commit)<br>3. Se Redis falha → job de cleanup no próximo login (merge logic) | **Strong consistency** MongoDB; **Eventual (next login)** Redis |

### 5.2 Reconciliation & Drift Detection

| Check | Frequência | Ação em Drift |
|-------|------------|---------------|
| MongoDB products count vs ES docs count | Diário (job reindex) | Reindex completo com alias swap |
| Payment CAPTURED sem Transfer > 24h | Diário | Alerta + job retry Transfer |
| Refund REQUESTED sem Transfer reversal > 48h | Diário | Alerta financeiro + retry manual |
| MongoDB stock vs Redis cart quantities | No checkout (validado) | Checkout bloqueia se inconsistente |

**Nota:** Não há transações distribuídas atômicas entre stores. A consistência financeira usa **saga orchestrated** com compensação explícita e reconciliation jobs. Disponibilidade (AP) priorizada para operações não-financeiras (ES sync, cache); operações financeiras usam **strong consistency no MongoDB + eventual com compensação definida** para Stripe/S3, alinhado com NFR-AVAIL-001 e CD-063/064/065.

---

## 6. Resumo de Constraints por Coleção

| Coleção | Unique Constraints | Referential Integrity | Optimistic Locking |
|---------|-------------------|----------------------|-------------------|
| people | tax_id.value, primary_contact_id | addresses, contact_infos, credentials | ✅ version |
| credentials | person_id | people | — |
| addresses | (person_id, is_primary) partial | people | — |
| contact_infos | (type, value) partial email, (person_id, is_primary) partial | people | — |
| vendors | person_id | people, wallets | — |
| categories | (parent_id, name) | self (parent_id) | — |
| products | — | vendors, categories, product_pics | ✅ version |
| product_pics | — | products xor reviews | — |
| orders | — | people, ovgs, payments | ✅ version |
| order_vendor_groups | — | orders, vendors, products, coupons | ✅ version |
| payments | provider_charge_id, idempotency_key | orders | — |
| wallets | (owner_type, owner_id) | vendors/marketplace | — |
| transactions | — | wallets, payments/refunds | — (append-only) |
| refunds | idempotency_key | payments, orders, ovgs | — |
| coupons | (vendor_id, code) | vendors | — |
| reviews | order_item_id | products, people, ovg.items, product_pics | — |
| invoices | order_id | orders | — |
| marketplace | _id singleton | wallets, people (admins) | — |

---

## 6. Validação dos Critérios de Aceitação

| Critério | Atendido? | Evidência |
|----------|-----------|-----------|
| Unique constraints por coleção | ✅ | Seção 3 + 5 |
| Referential integrity | ✅ | Seção 3 + 5 |
| Validation rules (schema) | ✅ | Seção 3 ($jsonSchema) |
| Atomic operations | ✅ | Seção 4 |
| Optimistic locking | ✅ | Seção 4 + version fields |
| Cross-store integrity | ✅ | Seção 5 |

---

## 7. Próximos Passos

- **T-306:** Migration/seed strategy
- **T-301..306 → P3b/P3c/P4a:** Implementation

---

**Status:** **CONCLUÍDO** — Data integrity rules documentadas por coleção.