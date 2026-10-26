# Análise de Design — Elasticsearch Mappings e Sync

**Data:** 2026-10-25  
**Executor:** code-orchestrator (T-302)  
**Fase:** P3a — Logical & Physical Data Models  
**Dependência:** T-301 (MongoDB collections), T-115 (ES strategy) ✅  
**Critério de Aceitação:** ES index definitions  

---

## 1. Objetivo

Definir os mappings, analyzers, settings e estratégia de sincronização do índice Elasticsearch `products`, baseado no design das coleções MongoDB (T-301) e na análise de estratégia ES (CD-049, `F01/docs/analysis/analysis_es_strategy.md`).

---

## 2. Decisões Confirmadas (CD-049, MP-07)

| Decisão | Valor |
|---------|-------|
| **Search Engine** | Elasticsearch (não MongoDB Atlas Search) |
| **Source of Truth** | MongoDB (`products` collection) |
| **Índice** | Único: `products` |
| **Denormalização** | `category_path`, `category_name`, `vendor_name` para descendant filtering e filtros |
| **Analyzer** | Portuguese stemmer |
| **Sync Strategy** | Dual-write + periodic full reindex |
| **Currency** | BRL para MVP (CD-054) — validação em camada de aplicação (sem enum no schema ES) |

---

## 2.1 Referências Cruzadas (P3a)

| Análise | Arquivo | Relacionamento |
|---------|---------|----------------|
| T-301 MongoDB Collections | `analysis_mongodb_collections.md` | Schema `products` com `category_name`, `vendor_name` denormalizados; sync dual-write |
| T-303 Redis Schemas | `analysis_redis_schemas.md` | Cache `product:{product_id}` invalidação no dual-write |
| T-304 S3 Naming | `analysis_s3_naming.md` | Product images referenciados via `images` array (S3 keys) |
| T-305 Data Integrity | `analysis_data_integrity.md` | Cross-store integrity: ES rebuild validation |
| T-306 Migration Seed | `analysis_migration_seed.md` | Seed data inclui `category_name`, `vendor_name` nos products |

---

## 3. Index Settings

```json
{
  "settings": {
    "analysis": {
      "filter": {
        "portuguese_stop": {
          "type": "stop",
          "stopwords": "_portuguese_"
        },
        "portuguese_stemmer": {
          "type": "stemmer",
          "language": "portuguese"
        },
        "asciifolding": {
          "type": "asciifolding",
          "preserve_original": true
        }
      },
      "analyzer": {
        "product_analyzer": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": [
            "lowercase",
            "asciifolding",
            "portuguese_stop",
            "portuguese_stemmer"
          ]
        },
        "product_search_analyzer": {
          "type": "custom",
          "tokenizer": "standard",
          "filter": [
            "lowercase",
            "asciifolding",
            "portuguese_stop",
            "portuguese_stemmer"
          ]
        },
        "keyword_analyzer": {
          "type": "custom",
          "tokenizer": "keyword",
          "filter": ["lowercase", "asciifolding"]
        }
      }
    },
    "index": {
      "number_of_shards": 1,
      "number_of_replicas": 1,
      "refresh_interval": "30s"
    }
  }
}
```

---

### 3.1 Configuração de Shards por Ambiente (INFO-001)

A configuração de shards e réplicas varia por ambiente para balancear performance, custo e disponibilidade:

| Ambiente | `number_of_shards` | `number_of_replicas` | Justificativa |
|----------|-------------------|---------------------|---------------|
| **Development** | 1 | 0 | Custo mínimo; single-node local; sem HA |
| **Staging** | 1 | 1 | Simula produção com HA básico; valida failover |
| **Production** | 3+ | 1 | Distribui carga; tolerância a falha de nó; escala horizontal |

**Notas:**
- **Production shards**: Número baseado em volume de dados e throughput esperado. Para MVP (~100k products), 3 shards é ponto de partida; revisar com métricas reais (NFR-PERF-003).
- **Replicas**: 1 réplica garante HA em produção e staging. Em dev, 0 economiza recursos.
- **Refresh interval**: 30s em todos ambientes (near-real-time search aceitável para marketplace).
- **Roteamento**: Para queries por `vendor_id` ou `category_path`, considerar routing key no futuro se houver hotspots.

---

## 4. Mappings

```json
{
  "mappings": {
    "properties": {
      "product_id": { "type": "keyword" },
      "vendor_id": { "type": "keyword" },
      "name": {
        "type": "text",
        "analyzer": "product_analyzer",
        "search_analyzer": "product_search_analyzer",
        "fields": {
          "keyword": { "type": "keyword" },
          "suggest": { "type": "completion" }
        }
      },
      "description": {
        "type": "text",
        "analyzer": "product_analyzer",
        "search_analyzer": "product_search_analyzer"
      },
      "price": { "type": "double" },
      "currency": { "type": "keyword" },
      "quantity": { "type": "integer" },
      "status": { "type": "keyword" },
      "category_id": { "type": "keyword" },
      "category_path": { "type": "keyword" },
      "category_name": { "type": "keyword" },
      "vendor_name": { "type": "keyword" },
      "images": { "type": "keyword" },
      "created_at": { "type": "date" },
      "updated_at": { "type": "date" }
    }
  }
}
```

### Notas sobre campos:

| Campo | Tipo | Propósito |
|-------|------|-----------|
| `product_id` | keyword | PK para sync e lookup direto |
| `category_path` | keyword | **Descendant filtering** (prefix query: `electronics/phones/*`) |
| `category_name` | keyword | Filtro por nome de categoria (denormalizado do MongoDB) |
| `vendor_name` | keyword | Filtro por vendor (denormalizado do MongoDB) |
| `name.suggest` | completion | Autocomplete/type-ahead |
| `price` | double | Range queries, sorting |
| `quantity` | integer | Filtro in-stock/out-of-stock, sorting |
| `currency` | keyword | Moeda fixa BRL (CD-054) — validação em camada de aplicação (sem enum no schema) |

---

## 5. Sync Strategy — Dual-Write + Periodic Reindex

### 5.1 Dual-Write (Real-time)

```javascript
// No serviço Product (MongoDB)
async function upsertProduct(productData) {
  const product = await mongo.products.updateOne(
    { _id: productData._id },
    { $set: productData },
    { upsert: true }
  );
  
  // Dual-write para ES
  await esClient.index({
    index: 'products',
    id: productData._id.toString(),
    document: transformToESDocument(productData),
    refresh: false // async
  });
  
  return product;
}

async function deleteProduct(productId) {
  await mongo.products.updateOne(
    { _id: productId },
    { $set: { status: 'deleted' } }
  );
  
  await esClient.delete({
    index: 'products',
    id: productId.toString()
  });
}
```

### 5.2 Periodic Full Reindex (Rebuildability - CD-049)

```javascript
// Job diário/semanal via cron
async function fullReindex() {
  const BATCH_SIZE = 500;
  let cursor = mongo.products.find({ status: { $ne: 'deleted' } });
  
  // Criar índice temporário
  const tempIndex = `products_reindex_${Date.now()}`;
  await esClient.indices.create({ index: tempIndex, ...settings });
  
  for await (const batch of cursor.batch(BATCH_SIZE)) {
    const bulkOps = batch.map(doc => ({
      index: { _index: tempIndex, _id: doc._id.toString() },
      document: transformToESDocument(doc)
    });
    await esClient.bulk({ operations: bulkOps, refresh: false });
  }
  
  // Alias swap (zero downtime)
  await esClient.indices.updateAliases({
    actions: [
      { remove: { index: 'products', alias: 'products_alias' } },
      { add: { index: tempIndex, alias: 'products_alias' } }
    ]
  });
  
  // Deletar índice antigo
  await esClient.indices.delete({ index: 'products' });
}
```

---

## 6. Search Queries

### 6.1 Full-text Search com Filtros

```json
{
  "query": {
    "bool": {
      "must": [
        { "match": { "name": { "query": "smartphone", "analyzer": "product_search_analyzer" } } }
      ],
      "filter": [
        { "term": { "status": "active" } },
        { "range": { "quantity": { "gt": 0 } } },
        { "prefix": { "category_path": "electronics/phones/" } }
      ]
    }
  },
  "sort": [
    { "_score": "desc" },
    { "quantity": "desc" }
  ],
  "highlight": {
    "fields": { "name": {}, "description": {} }
  }
}
```

### 6.2 Autocomplete (Type-ahead)

```json
{
  "suggest": {
    "product-suggest": {
      "prefix": "smart",
      "completion": {
        "field": "name.suggest",
        "size": 10
      }
    }
  }
}
```

### 6.3 Faceted Navigation

```json
{
  "size": 0,
  "aggs": {
    "categories": { "terms": { "field": "category_name", "size": 50 } },
    "vendors": { "terms": { "field": "vendor_name", "size": 50 } },
    "price_ranges": {
      "range": {
        "field": "price",
        "ranges": [
          { "to": 50 },
          { "from": 50, "to": 200 },
          { "from": 200, "to": 500 },
          { "from": 500 }
        ]
      }
    }
  }
}
```

---

## 7. Transform MongoDB → ES Document

```javascript
function transformToESDocument(mongoProduct) {
  return {
    product_id: mongoProduct._id.toString(),
    vendor_id: mongoProduct.vendor_id.toString(),
    name: mongoProduct.name,
    description: mongoProduct.description,
    price: parseFloat(mongoProduct.price.toString()),
    currency: mongoProduct.currency,
    quantity: mongoProduct.quantity,
    status: mongoProduct.status,
    category_id: mongoProduct.category_id.toString(),
    category_path: mongoProduct.category_path, // "electronics/phones/smartphones"
    category_name: mongoProduct.category_name, // denormalized
    vendor_name: mongoProduct.vendor_name, // denormalized
    images: mongoProduct.images.map(id => id.toString()),
    created_at: mongoProduct.created_at,
    updated_at: mongoProduct.updated_at
  };
}
```

---

## 8. Critérios de Aceitação — Validação

| Critério | Atendido? | Evidência |
|----------|-----------|-----------|
| Single `products` index | ✅ | Definido acima |
| `category_path` para descendant filtering | ✅ | Prefix query no campo keyword |
| Portuguese stemmer analyzer | ✅ | `product_analyzer` com `portuguese_stemmer` |
| Dual-write sync | ✅ | Seção 5.1 |
| Periodic full reindex | ✅ | Seção 5.2 com alias swap |
| Mapping para FR-SRCH-001/002 | ✅ | Campos para search, filter, sort |

---

## 9. Próximos Passos

- **T-303:** Design Redis schemas (Cart, Session)
- **T-801/802/803:** Implementação Stage 4 (ES sync, Search API, Search UI)

---

**Status:** **CONCLUÍDO** — ES index definitions documentadas.