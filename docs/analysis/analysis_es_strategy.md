# Elasticsearch Strategy Analysis — T-115 / Q-015

## Context

**Confirmed (CD-049):**
- Elasticsearch provides product search, filtering, and sorting
- MongoDB remains the source of truth
- Elasticsearch indexes must be rebuildable from authoritative data
- Atlas Search prohibited
- Mapping, analyzers, and synchronization mechanisms remain technical decisions (TECHNICAL_FUTURE)

**Dependencies (per Q-015):**
- CD-011: Vendor offers Product
- CD-015: Category admits parent/child hierarchy
- CD-017: Review only by verified purchaser
- CD-049: Elasticsearch Search Architecture

**Functional Requirements (from FR-SRCH-001, FR-SRCH-002):**
- Full-text product search with relevance ranking
- Filtering by category (including descendants per CD-043)
- Sorting by relevance, price, and other criteria
- Eventual consistency between MongoDB and Elasticsearch
- Index rebuildable from MongoDB

## Pending Technical Decisions

### 1. Index Structure

#### Option A: Single `products` Index (Recommended)
**Structure:** One index containing all searchable product documents with nested/vendor/category fields.

**Document Shape:**
```json
{
  "product_id": "uuid",
  "vendor_id": "uuid",
  "vendor_name": "string",
  "category_id": "uuid",
  "category_path": ["root_id", "child_id", "leaf_id"],
  "category_names": ["Electronics", "Phones", "Smartphones"],
  "name": "string",
  "description": "string",
  "price": "decimal",
  "currency": "string",
  "quantity": "integer",
  "in_stock": "boolean",
  "status": "active|inactive",
  "average_rating": "float",
  "review_count": "integer",
  "primary_image_url": "string",
  "created_at": "date",
  "updated_at": "date"
}
```

**Pros:**
- Single query for all search/filter/sort operations
- Simpler sync (one index to maintain)
- Better relevance scoring across all products
- Category descendant filtering via `category_path` array

**Cons:**
- Larger index size
- Vendor name denormalization requires updates when vendor changes name
- Category path updates when hierarchy changes

#### Option B: Separate Indices per Entity Type
**Structure:** `products`, `vendors`, `categories` indices with cross-index queries.

**Pros:**
- Smaller individual indices
- Independent update cycles

**Cons:**
- Complex cross-index queries for filtering/sorting
- Higher operational complexity
- Join-like operations at query time

#### Option C: Single Index with Nested Objects
**Structure:** Products with nested `vendor` and `category` objects.

**Pros:**
- Strong consistency for nested data

**Cons:**
- Nested queries are slower
- Reindexing entire document on any nested change
- Overkill for MVP requirements

**Recommendation:** **Option A (Single `products` index)** — aligns with MVP simplicity, CD-049 rebuildability, and functional requirements.

---

### 2. Analyzers

#### Portuguese/English Text Analysis
Since interface language is English (CD-054) but marketplace operates in Brazil:

**Option A: Standard Analyzer + Portuguese Stemmer**
- Uses `standard` tokenizer + `portuguese` stemmer + `lowercase` + `asciifolding`
- Handles Portuguese morphology (gender, number)
- Works for English queries too

**Option B: Multi-field with Language-specific Analyzers**
- `name.pt` with Portuguese analyzer
- `name.en` with English analyzer
- Query-time language detection

**Option C: ICU Analyzer + Custom Stopwords**
- Unicode-aware tokenization
- Custom stopword list for Portuguese/English

**Recommendation:** **Option A** — Single analyzer with Portuguese stemmer covers Brazil marketplace needs. English queries work adequately. Multi-field adds complexity without proven need.

#### Keyword/Exact Match Fields
- `vendor_id`, `category_id`, `category_path` → `keyword` type (exact filter)
- `status` → `keyword`
- `in_stock` → `boolean`
- `price` → `double` (for range queries and sorting)
- `average_rating` → `float` (for sorting)

#### Suggest/Autocomplete
- `name.suggest` → `completion` suggester for autocomplete
- Edge n-gram analyzer for partial matching fallback

---

### 3. Category Hierarchy Filtering

**Requirement (CD-043, FR-SRCH-002):** Filtering by parent category includes descendants.

**Implementation:** Store `category_path` as array of ancestor IDs (root → leaf) in each product document.

**Query:**
```json
{
  "term": { "category_path": "parent_category_id" }
}
```

**Maintenance:** On category hierarchy change, reindex affected products (batch job).

---

### 4. Synchronization Mechanism

#### Option A: Application-Level Sync (Dual Write) — Recommended for MVP
**Mechanism:** Backend service writes to MongoDB, then publishes to Elasticsearch in same transaction/flow.

**Implementation:**
- On Product create/update/delete → index/update/delete in ES
- Use idempotent operations (upsert by `product_id`)
- Async via message queue or direct call with retry
- Dead letter queue for failed syncs

**Pros:**
- Near real-time consistency
- Simple to implement and understand
- No additional infrastructure

**Cons:**
- Coupling between MongoDB write path and ES
- Write latency increases slightly
- Failure handling needed

#### Option B: Change Data Capture (CDC) — Debezium/MongoDB Streams
**Mechanism:** Capture MongoDB oplog/changes and propagate to ES.

**Pros:**
- Decoupled from application
- Captures all changes (including direct DB writes)
- No application code changes

**Cons:**
- Additional infrastructure (Kafka, Debezium connector)
- Operational complexity
- Overkill for MVP

#### Option C: Batch Reindex Job
**Mechanism:** Periodic full reindex from MongoDB to ES.

**Pros:**
- Simple, reliable
- Guarantees eventual consistency
- Handles drift correction

**Cons:**
- Not real-time (lag = batch interval)
- Resource intensive for large catalogs

**Recommendation:** **Hybrid: Option A (Dual Write) + Option C (Periodic Full Reindex)**
- Dual write for real-time updates (create/update/delete)
- Daily/weekly full reindex for drift correction and rebuildability (CD-049)
- Reindex job is the "rebuildable from authoritative data" mechanism

---

### 5. Search Relevance & Ranking

**Default Ranking Function:**
1. Text relevance score (BM25 on `name`, `description`)
2. Boost in-stock products (`in_stock: true` boost)
3. Boost by rating (`average_rating` factor)
4. Recency boost (`created_at` decay)

**Sorting Options (FR-SRCH-002):**
- Relevance (default)
- Price: ascending/descending
- Newest first
- Highest rated
- Best selling (requires sales data in index)

---

### 6. Index Settings

```json
{
  "settings": {
    "number_of_shards": 1,
    "number_of_replicas": 0,
    "analysis": {
      "analyzer": {
        "product_analyzer": {
          "tokenizer": "standard",
          "filter": ["lowercase", "asciifolding", "portuguese_stemmer"]
        },
        "autocomplete_analyzer": {
          "tokenizer": "edge_ngram_tokenizer",
          "filter": ["lowercase", "asciifolding"]
        }
      },
      "tokenizer": {
        "edge_ngram_tokenizer": {
          "type": "edge_ngram",
          "min_gram": 2,
          "max_gram": 15
        }
      },
      "filter": {
        "portuguese_stemmer": {
          "type": "stemmer",
          "language": "portuguese"
        }
      }
    }
  },
  "mappings": {
    "properties": {
      "product_id": { "type": "keyword" },
      "vendor_id": { "type": "keyword" },
      "vendor_name": { "type": "text", "analyzer": "product_analyzer" },
      "category_id": { "type": "keyword" },
      "category_path": { "type": "keyword" },
      "category_names": { "type": "text", "analyzer": "product_analyzer" },
      "name": {
        "type": "text",
        "analyzer": "product_analyzer",
        "fields": {
          "suggest": { "type": "completion", "analyzer": "autocomplete_analyzer" },
          "keyword": { "type": "keyword" }
        }
      },
      "description": { "type": "text", "analyzer": "product_analyzer" },
      "price": { "type": "double" },
      "currency": { "type": "keyword" },
      "quantity": { "type": "integer" },
      "in_stock": { "type": "boolean" },
      "status": { "type": "keyword" },
      "average_rating": { "type": "float" },
      "review_count": { "type": "integer" },
      "primary_image_url": { "type": "keyword" },
      "created_at": { "type": "date" },
      "updated_at": { "type": "date" }
    }
  }
}
```

---

### 7. Rebuildability (CD-049 Compliance)

**Reindex Procedure:**
1. Read all active products from MongoDB (with vendor/category lookups)
2. Transform to ES document format
3. Bulk index to new index (e.g., `products_v2`)
4. Alias swap (`products` → `products_v2`)
5. Delete old index

**Trigger:** Manual (admin action) or automated on schema change.

---

## Summary of Recommendations

| Decision Point | Recommendation | Rationale |
|----------------|----------------|-----------|
| Index Structure | Single `products` index | Simplicity, single query, rebuildability |
| Text Analyzer | Standard + Portuguese stemmer | Brazil marketplace, English compatible |
| Category Filtering | `category_path` keyword array | O(1) descendant filtering |
| Sync Mechanism | Dual write + periodic full reindex | Real-time + drift correction + rebuildability |
| Shards/Replicas | 1 shard, 0 replicas (dev) | MVP scale; adjust for prod |
| Autocomplete | Completion suggester + edge n-gram | Fast prefix matching |

---

## Decisions Requiring Business Approval

**None.** All recommendations are technical implementation choices within the boundaries set by CD-049. The conceptual decisions (what to index, what filters/sorts) are already confirmed.

## Technical Decisions Deferred to Implementation (TECHNICAL_FUTURE)

Per CD-049 and project rules, these remain for implementation phase (T-302, T-801, T-802):
- Exact shard/replica count for production
- Index lifecycle management (ILM)
- Monitoring/alerting for ES health
- Query DSL optimization
- Cache warming strategies

---

## Traceability

- **CD-049** — Elasticsearch Search Architecture (confirmed)
- **Q-015** — Elasticsearch Index & Search Strategy (PARTIALLY_RESOLVED)
- **FR-SRCH-001** — Product Search with Elasticsearch
- **FR-SRCH-002** — Search Filtering and Sorting
- **T-115** — Resolve Q-015 Elasticsearch strategy
- **T-302** — Design Elasticsearch mappings (P3a)
- **T-801** — Backend: ES index sync (P4c)
- **T-802** — Backend: Search API (P4c)