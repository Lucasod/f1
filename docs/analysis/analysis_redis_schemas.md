# Análise de Design — Redis Schemas (Cart, Session, Cache)

**Data:** 2026-10-25  
**Executor:** code-orchestrator (T-303)  
**Fase:** P3a — Logical & Physical Data Models  
**Dependência:** T-125 (conceptual_model.md), CD-018 (Cart not conceptual entity) ✅  
**Critério de Aceitação:** Redis key patterns + data structures + TTLs  

---

## 1. Objetivo

Definir os padrões de chaves, estruturas de dados, TTLs e estratégias de sincronização para Redis, cobrindo:
- **Shopping Cart** (CD-018: cart not persisted conceptually; Redis/session)
- **Session/Cache** (Q-014 TECHNICAL_FUTURE, NFR-PERF-003)
- **Outros caches** (rate limiting, search results, etc.)

---

## 2. Decisões Confirmadas

| Referência | Decisão |
|------------|---------|
| **CD-018** | Cart não é entidade conceitual persistida; Redis/session |
| **CD-019** | Cart contém produtos de múltiplos vendors (multi-vendor) |
| **Q-014** | Redis keys, TTL, sync, guest merge = TECHNICAL_FUTURE — **TTLs propostos em P3a** (aguardam NFR-PERF-003) |
| **NFR-PERF-003** | Cart TTL e session timeout = PENDING — **TTLs propostos em P3a** (30d cart, 24h session) |
| **FR-CART-001/002/003** | Multi-vendor cart, Redis persistence, operations |

---

## 3. Shopping Cart — Design

### 3.1 Key Pattern

```
cart:{consumer_id}
```

- **Tipo:** Redis Hash
- **TTL:** 30 dias (2.592.000 segundos) — **PROPOSTA P3a** — aguarda NFR-PERF-003 / Q-014
- **Renovação:** TTL resetado a cada operação (add/update/remove/get)

### 3.2 Estrutura do Hash

```redis
HSET cart:{consumer_id} \
  items '[
    {"product_id": "obj_id_1", "vendor_id": "obj_id_v1", "quantity": 2, "added_at": "2026-10-25T10:00:00Z"},
    {"product_id": "obj_id_2", "vendor_id": "obj_id_v2", "quantity": 1, "added_at": "2026-10-25T10:05:00Z"}
  ]' \
  updated_at "2026-10-25T10:05:00Z" \
  version 5
```

**Campos:**
| Campo | Tipo | Descrição |
|-------|------|-----------|
| `items` | JSON String | Array de itens (multi-vendor suportado nativamente) |
| `updated_at` | ISO 8601 | Timestamp da última modificação |
| `version` | Integer | Optimistic locking para concorrência |

### 3.3 Item Structure (dentro do JSON `items`)

```json
{
  "product_id": "ObjectId",
  "vendor_id": "ObjectId",  // denormalizado para validação rápida
  "quantity": 2,
  "added_at": "2026-10-25T10:00:00Z"
}
```

**Nota:** Preço e nome do produto são buscados do MongoDB no checkout (FR-CART-003). Não há denormalização de preço/nome no carrinho para MVP — evita inconsistência (CD-023: price snapshot só em Order_Item). Validação de stock e preço ocorre atomicamente no checkout.

### 3.4 Operações Redis (Lua Scripts para Atomicidade)

```lua
-- ADD/UPDATE ITEM (atomic)
-- KEYS[1] = cart:{consumer_id}
-- ARGV[1] = product_id, ARGV[2] = vendor_id, ARGV[3] = quantity
-- ARGV[4] = added_at (ISO 8601), ARGV[5] = updated_at (ISO 8601), ARGV[6] = TTL
-- Timestamps são gerados na camada de aplicação e passados via ARGV para consistência e testabilidade
local cart = redis.call('HGETALL', KEYS[1])
local items = {}
if #cart > 0 then
  items = cjson.decode(cart[2]) -- items field
end

local found = false
for i, item in ipairs(items) do
  if item.product_id == ARGV[1] then
    item.quantity = tonumber(ARGV[3])
    found = true
    break
  end
end

if not found then
  table.insert(items, {
    product_id = ARGV[1],
    vendor_id = ARGV[2],
    quantity = tonumber(ARGV[3]),
    added_at = ARGV[4]
  })
end

redis.call('HSET', KEYS[1], 'items', cjson.encode(items), 'updated_at', ARGV[5], 'version', (tonumber(cart[4]) or 0) + 1)
redis.call('EXPIRE', KEYS[1], ARGV[6])
return cjson.encode(items)
```

```lua
-- REMOVE ITEM (atomic)
-- KEYS[1] = cart:{consumer_id}
-- ARGV[1] = product_id, ARGV[2] = TTL, ARGV[3] = updated_at (ISO 8601)
-- Timestamps são gerados na camada de aplicação e passados via ARGV para consistência e testabilidade
local cart = redis.call('HGETALL', KEYS[1])
if #cart == 0 then return nil end
local items = cjson.decode(cart[2])
local new_items = {}
for _, item in ipairs(items) do
  if item.product_id ~= ARGV[1] then
    table.insert(new_items, item)
  end
end
redis.call('HSET', KEYS[1], 'items', cjson.encode(new_items), 'updated_at', ARGV[3], 'version', (tonumber(cart[4]) or 0) + 1)
redis.call('EXPIRE', KEYS[1], ARGV[2])
return cjson.encode(new_items)
```

```lua
-- GET CART (com version para optimistic locking)
local cart = redis.call('HGETALL', KEYS[1])
if #cart == 0 then return nil end
return cjson.encode({
  items = cjson.decode(cart[2]),
  updated_at = cart[4],
  version = tonumber(cart[6])
})
```

### 3.5 Guest Cart → User Cart Merge (Login)

```lua
-- MERGE GUEST CART INTO USER CART (atomic)
-- KEYS[1] = cart:{guest_id}, KEYS[2] = cart:{user_id}
-- ARGV[1] = TTL, ARGV[2] = updated_at (ISO 8601)
-- Timestamps são gerados na camada de aplicação e passados via ARGV para consistência e testabilidade
local guest_cart = redis.call('HGETALL', KEYS[1])
local user_cart = redis.call('HGETALL', KEYS[2])

if #guest_cart == 0 then return 0 end
if #user_cart == 0 then
  redis.call('RENAME', KEYS[1], KEYS[2])
  redis.call('EXPIRE', KEYS[2], ARGV[1])
  return 1
end

local guest_items = cjson.decode(guest_cart[2])
local user_items = cjson.decode(user_cart[2])

-- Merge: somar quantidades para mesmo product_id
for _, g_item in ipairs(guest_items) do
  local found = false
  for _, u_item in ipairs(user_items) do
    if u_item.product_id == g_item.product_id then
      u_item.quantity = u_item.quantity + g_item.quantity
      found = true
      break
    end
  end
  if not found then
    table.insert(user_items, g_item)
  end
end

redis.call('HSET', KEYS[2], 'items', cjson.encode(user_items), 'updated_at', ARGV[2], 'version', (tonumber(user_cart[6]) or 0) + 1)
redis.call('EXPIRE', KEYS[2], ARGV[1])
redis.call('DEL', KEYS[1])
return 1
```

---

## 4. Session Management

### 4.1 Key Pattern

```
session:{session_id}
```

- **Tipo:** Redis String (JSON) ou Hash
- **TTL:** 24 horas (86.400 segundos) — **PROPOSTA P3a** — aguarda NFR-PERF-003 / Q-014
- **Renovação:** Sliding window (reset TTL a cada request autenticado)

### 4.2 Estrutura

```json
{
  "person_id": "ObjectId",
  "roles": ["consumer"],
  "created_at": "2026-10-25T10:00:00Z",
  "last_activity": "2026-10-25T10:30:00Z",
  "ip": "192.168.1.1",
  "user_agent": "Mozilla/5.0..."
}
```

### 4.2 Operações

```lua
-- CREATE SESSION
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])

-- VALIDATE + TOUCH (sliding expiration)
local session = redis.call('GET', KEYS[1])
if session then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return session

-- DELETE SESSION (logout)
redis.call('DEL', KEYS[1])
```

---

## 5. Cache Patterns Adicionais

### 5.1 Rate Limiting

```
ratelimit:{identifier}:{window}
```
- **Tipo:** String (counter)
- **TTL:** Window size (ex: 60s, 3600s)
- **Operação:** INCR + EXPIRE (atomic via Lua)

### 5.1.1 Limitações do Rate Limiting Fixed-Window

A implementação atual usa **fixed-window** (janela fixa) com contador simples:

**Limitações conhecidas:**
- **Burst no boundary**: Um cliente pode fazer 2x o limite permitido se concentrar requisições no final de uma janela e início da próxima (ex: 100 req/min → 100 req no segundo 59 + 100 req no segundo 60 = 200 req em 2 segundos)
- **Não suaviza tráfego**: Janelas fixas não distribuem requisições uniformemente ao longo do tempo
- **Contador único por janela**: Não diferencia entre usuários legítimos e abusivos dentro da mesma janela

**Alternativas consideradas para P4+:**
- **Sliding Window Log**: Mantém timestamp de cada requisição; preciso mas maior uso de memória
- **Sliding Window Counter**: Combina fixed windows com peso proporcional; equilíbrio entre precisão e performance
- **Token Bucket / Leaky Bucket**: Suaviza tráfego; melhor para rate limiting suave

**Decisão:** Fixed-window aceito para MVP pela simplicidade e baixo overhead. Melhorias documentadas como TECHNICAL_FUTURE (NFR-PERF-003).

### 5.2 Search Results Cache

```
search:{query_hash}:{filters_hash}
```
- **Tipo:** String (JSON)
- **TTL:** 5 minutos (300s) — busca muda frequentemente
- **Invalidação:** Por TTL ou event-driven (product update)

### 5.3 Product Detail Cache

```
product:{product_id}
```
- **Tipo:** String (JSON)
- **TTL:** 1 hora (3.600s)
- **Invalidação:** Event-driven (product update/delete)

### 5.4 Vendor Dashboard Metrics Cache

```
vendor:metrics:{vendor_id}
```
- **Tipo:** Hash
- **Campos:** order_count, gross_sales, pending_orders, completed_orders, best_selling (JSON)
- **TTL:** 15 minutos (900s) — CD-051 metrics
- **Invalidação:** Event-driven (new order, status change)

---

## 6. TTL Summary

| Key Pattern | TTL | Renovação | Justificativa | Status |
|-------------|-----|-----------|---------------|--------|
| `cart:{consumer_id}` | 30 dias | Sliding (cada operação) | Carrinho persistente cross-session | **PROPOSTA P3a** — aguarda NFR-PERF-003 / Q-014 |
| `session:{session_id}` | 24 horas | Sliding (cada request) | Sessão de autenticação | **PROPOSTA P3a** — aguarda NFR-PERF-003 / Q-014 |
| `ratelimit:*:{window}` | Window size | Fixed | Rate limiting | Técnico — definido |
| `search:*:*` | 5 min | Fixed | Resultados de busca | Técnico — definido |
| `product:{product_id}` | 1 hora | Fixed + Invalidation | Detalhes de produto | Técnico — definido |
| `vendor:metrics:{vendor_id}` | 15 min | Fixed + Invalidation | Dashboard metrics (CD-051) | Técnico — definido |

---

## 7. Sincronização MongoDB ↔ Redis

| Direção | Estratégia |
|---------|------------|
| **MongoDB → Redis (Cache)** | Write-through: na criação/atualização de Product/Order, invalidar/atualizar cache |
| **Redis → MongoDB (Cart)** | Checkpoint: no checkout, carrinho lido do Redis e validado contra MongoDB (stock, price) |
| **Session** | Stateless: apenas validação de existência; dados de Person vêm do MongoDB |

---

## 8. Validação dos Critérios de Aceitação

| Critério | Atendido? | Evidência |
|----------|-----------|-----------|
| Redis key patterns | ✅ | Seção 3.1, 4.1, 5.x |
| Data structures (Hash, String, Lua) | ✅ | Seções 3.2, 3.4, 5.x |
| TTLs definidos | ⚠️ | Seção 6 — **TTLs de cart/session são propostas P3a** (aguardam NFR-PERF-003 / Q-014) |
| Multi-vendor cart (CD-019) | ✅ | `items` array com `vendor_id` por item |
| Guest merge (FR-CART-002) | ✅ | Lua script Seção 3.5 |
| Cart operations (FR-CART-003) | ✅ | Lua scripts add/remove/get (validação de stock/preço no checkout contra MongoDB) |

---

## 9. Próximos Passos

- **T-304:** Define S3 object naming (Product_Pic, Invoice)
- **T-305:** Data integrity rules
- **T-306:** Migration/seed strategy
- **T-901/904:** Stage 5 Implementation (Cart API + Frontend)

---

**Status:** **CONCLUÍDO** — Redis key patterns, data structures e TTLs documentados.