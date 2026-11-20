# MP-F01 — Frente A: Elasticsearch — Relatório de Investigação e Validação

**Repositório:** /home/workstation/source/f1/F01  
**Branch:** feature/closing-initial-implementation  
**HEAD:** cb00c50  
**Data:** 2026-11-20  
**Tipo:** Apenas diagnóstico (leitura). Nenhum arquivo de produção modificado.

---

## 1. Configuração do Elasticsearch

### Arquivos e localizações

| Arquivo | Função |
|---------|--------|
| `back/src/modules/search/elasticsearch-product-index.ts` | Classe `ElasticsearchProductIndex`: índice, busca, reindex, remoção |
| `back/src/modules/search/elasticsearch-product-writer.ts` | Escritor de baixo nível (`put`, `putVersioned`, `delete`) via bulk NDJSON |
| `back/src/modules/search/product-search-sync.ts` | Sincronização durável MongoDB → Elasticsearch (`ProductSearchSync`) |
| `back/src/modules/search/elasticsearch-product-index.test.ts` | Testes unitários (mocked) do índice |
| `back/src/modules/search/elasticsearch-product-writer.test.ts` | Testes unitários (mocked) do writer |
| `back/src/modules/search/product-search-sync.test.ts` | Testes unitários do sync |
| `back/src/modules/search/elasticsearch-rebuild.test.ts` | Testes de rebuild |
| `back/src/integration/elasticsearch.integration.test.ts` | Testes de integração contra ES real |
| `back/src/config/index.ts` | Configuração: `elasticsearchUrl` (linha 78) |
| `back/src/shared/database/mongo.client.ts` | Cliente MongoDB (não configura ES) |
| `back/src/index.ts` | Fiação do ES na inicialização da aplicação (linhas 77-79, 117-118, 324-328) |
| `back/docker-compose.yml` | Serviço Elasticsearch no compose (linhas 48-57) |
| `docker-compose.validation.yml` (raiz) | Serviço ES no compose de validação (linhas 62-71) |

### Configurações encontradas

- **URL base (dev):** `http://localhost:9200` (`back/src/config/index.ts` linha 78)
- **URL base (docker):** `http://elasticsearch:9200` (`back/docker-compose.yml` linha 17)
- **Dependência ES client:** NENHUMA em `back/package.json`. Não há `@elastic/elasticsearch`. O código usa `fetch` nativo contra a API REST do Elasticsearch.
- **Versão da imagem:** `docker.elastic.co/elasticsearch/elasticsearch:8.15.0`
- **Índice físico:** `products_v1`
- **Alias:** `products` (aponta para `products_v1`)
- **Shards:** 1 primário, 0 réplicas
- **Endpoint de busca:** `products/_search` (POST)
- **Endpoint de escrita:** `products/_bulk?require_alias=true` (POST, content-type `application/x-ndjson`)
- **Mappings:** `product_id` (keyword), `vendor_id` (keyword), `category_id` (keyword), `category_path` (keyword), `name` (text + keyword subfield), `description` (text), `price` (double), `quantity` (integer), `in_stock` (boolean), `status` (keyword), `images` (keyword), `created_at` (date), `updated_at` (date), `search_revision` (long)
- **Analisadores:** `product_analyzer` e `product_search_analyzer` (custom, tokenizer `standard`, filtros `lowercase`, `asciifolding`, `portuguese` stemmer)

---

## 2. Disponibilidade do serviço

O serviço Elasticsearch **está rodando**:

- Container: `back-elasticsearch-1` (imagem `docker.elastic.co/elasticsearch/elasticsearch:8.15.0`)
- Porta mapeada: `0.0.0.0:9200->9200/tcp`
- Status: Up (6 horas)
- Responde em `http://localhost:9200/` (versão 8.15.0 confirmada via curl)

**Porém, o cluster está com status RED:**

- `number_of_nodes`: 1, `number_of_data_nodes`: 1
- `active_primary_shards`: 2, `active_shards`: 2
- `unassigned_shards`: 3
- `active_shards_percent_as_number`: 40.0

O índice `products_v1` tem seu shard primário **não alocado** (`unassigned`, estado `INDEX_CREATED`).

**Causa da alocação falhar (do `_cluster/allocation/explain`):**

```
decider: disk_threshold
decision: NO
explanation: "the node is above the high watermark cluster setting
[cluster.routing.allocation.disk.watermark.high=90%], having less than
the minimum required [73.7gb] free space, actual free: [20.1gb],
actual used: [97.2%]"
```

O nó do Elasticsearch está com **97.2% do disco utilizado**, acima do high watermark de 90%. O Elasticsearch recusa alocar shards primários a nós acima desse limiar. Isso impede qualquer operação de escrita no índice `products_v1`.

Há também um `docker-compose.validation.yml` na raiz com serviço ES na porta 9201, mas não está ativo no momento.

---

## 3. Os 3 testes que falharam

Arquivo: `back/src/integration/elasticsearch.integration.test.ts`  
Comando executado: `npx vitest run src/integration/elasticsearch.integration.test.ts`  
Resultado: **5 testes, 2 passou, 3 falhou** (duração ~40s)

### Teste 1 — `indexes and searches a product` (linha 50)

```
Error: ELASTICSEARCH_WRITE_FAILED
  ❯ ElasticsearchProductWriter.write src/modules/search/elasticsearch-product-writer.ts:82:11
  ❯ ElasticsearchProductWriter.put src/modules/search/elasticsearch-product-writer.ts:19:5
  ❯ ElasticsearchProductIndex.indexProduct src/modules/search/elasticsearch-product-index.ts:141:5
  ❯ src/integration/elasticsearch.integration.test.ts:52:5
```

### Teste 2 — `filters by status and vendor` (linha 59)

Mesmo stack trace e erro `ELASTICSEARCH_WRITE_FAILED`, falha em `indexProduct` (linha 62 do teste).

### Teste 3 — `sorts by price ascending` (linha 74)

Mesmo stack trace e erro `ELASTICSEARCH_WRITE_FAILED`, falha em `indexProduct` (linha 77 do teste).

### Testes que passaram (para contraste)

- `creates the products alias` (linha 45) — passa: `GET _alias/products` retorna 200 (o alias já existe).
- `keeps delete unavailable com erro explícito` (linha 86) — passa: `writer.delete()` lança `ELASTICSEARCH_DELETE_UNAVAILABLE` sem fazer qualquer requisição de rede.

---

## 4. Causa raiz de cada falha

| Teste | Tipo de falha | Causa raiz |
|-------|--------------|------------|
| `indexes and searches a product` | **Infraestrutura** | Escrita bulk no índice `products_v1` falha porque o shard primário está `unassigned` (índice RED). O nó está acima do high watermark de disco (97.2% > 90%). O writer lança `ELASTICSEARCH_WRITE_FAILED`. |
| `filters by status and vendor` | **Infraestrutura** | Mesmo motivo: `indexProduct` → `writer.put` → `writer.write` falha ao escrever no bulk. |
| `sorts by price ascending` | **Infraestrutura** | Mesmo motivo: `indexProduct` → `writer.put` → `writer.write` falha ao escrever no bulk. |

**Não é falha de conexão:** o ES responde (o teste do alias passa, `ensureIndex` funciona).
**Não é falha de código:** os testes unitários com mock (vitest) passam; a lógica do writer está correta, o problema é o destino (ES indisponível para escrita).
**Não é falha de configuração de mapping/endpoint:** o mapping existe e está correto; o alias `products` existe e aponta para `products_v1`. O problema é a alocação de shard por falta de disco.

---

## 5. Configuração de índices e mappings

O índice `products_v1` foi criado com as seguintes configurações (observadas via `_settings` e `_mapping` no ES rodando):

**Settings:**
```json
{
  "number_of_shards": "1",
  "number_of_replicas": "0",
  "analysis": {
    "filter": { "portuguese": { "type": "stemmer", "language": "portuguese" } },
    "analyzer": {
      "product_analyzer": { "type": "custom", "tokenizer": "standard", "filter": ["lowercase", "asciifolding", "portuguese"] },
      "product_search_analyzer": { "type": "custom", "tokenizer": "standard", "filter": ["lowercase", "asciifolding", "portuguese"] }
    }
  },
  "routing": { "allocation": { "include": { "_tier_preference": "data_content" } } }
}
```

**Mappings:** `product_id` (keyword), `vendor_id` (keyword), `category_id` (keyword), `category_path` (keyword), `name` (text com `product_analyzer` + subfield `keyword`), `description` (text com `product_analyzer`), `price` (double), `quantity` (integer), `in_stock` (boolean), `status` (keyword), `images` (keyword), `created_at` (date), `updated_at` (date), `search_revision` (long).

O alias `products` está ativo e aponta para `products_v1`.

---

## 6. Sincronização MongoDB ↔ Elasticsearch

A sincronização é implementada via **projection durável com revision fencing**, não via CDC ou change streams:

### Componentes

1. **`back/src/modules/product/product.mongo.repository.ts`** — `MongoProductRepository`:
   - Campos extras no documento do produto: `searchRevision` (number), `searchPending` (boolean), `searchRetryAt` (Date), `searchAttempts` (number).
   - `save()`: define `searchRevision: 1`, `searchPending: true`, `searchRetryAt: new Date(0)`, `searchAttempts: 0` no `$setOnInsert`.
   - `update()` / `rebrandSeedProduct()` / `repairSeedImage()` / `decrementStock()` / `incrementStock()`: fazem `$inc: { searchRevision: 1 }` e definem `...pendingSearchIntent()` (`searchPending: true`, `searchRetryAt: new Date(0)`, `searchAttempts: 0`).
   - `readPendingSearchSnapshots(limit, now, afterId)`: lê documentos com `searchPending: true` e `searchRetryAt <= now`, ordenado por `searchRetryAt`/`_id`, com `timeoutMS=5000`.
   - `enqueueSearch(id)`: CAS para inicializar/reenfileirar; nunca sobrescreve revisão existente.
   - `acknowledgeSearch(id, revision)`: define `searchPending: false` apenas se `searchRevision` e `searchPending` conferem.
   - `retrySearch(id, revision, attempts, at, expectedRetryAt)`: incrementa `searchAttempts` (máx 30) e define novo `searchRetryAt` com backoff exponencial.

2. **`back/src/modules/search/product-search-sync.ts`** — `ProductSearchSync`:
   - `publish(id)`: enfileira snapshot, então `deliver()` síncrono (usado por `indexProduct` quando `sync` está presente).
   - `tick()`: lê lotes de pendentes e entrega cada um.
   - `deliver(snapshot)`: chama `ensureIndex()`, depois `writer.putVersioned(id, document, revision)` (versionamento com script Painless e `search_revision`), depois `acknowledgeSearch(id, revision)`. Em caso de falha, agenda `retrySearch` com backoff (`1000 * 2^min(attempts, 6)`, limitado a 60s).
   - `start()` / `stop()`: loop autônomo com `setTimeout` e `AbortController`.

3. **`back/src/modules/search/elasticsearch-product-writer.ts`** — `putVersioned()`:
   - Usa bulk NDJSON com action `update`, script Painless que aplica o documento apenas se `ctx._source.search_revision < params.revision`, caso contrário `ctx.op = 'noop'`.
   - Parâmetro `require_alias=true` na URL.
   - `delete()` sempre lança `ELASTICSEARCH_DELETE_UNAVAILABLE`.

4. **`back/src/index.ts`** (linhas 324-328): fiação na inicialização:
   ```typescript
   const searchReader = new ElasticsearchProductIndex(config.elasticsearchUrl);
   searchSync = new ProductSearchSync(mongoProducts, new ElasticsearchProductWriter(config.elasticsearchUrl),
     () => searchReader.ensureIndex());
   searchIndex = new ElasticsearchProductIndex(config.elasticsearchUrl, fetch, searchSync);
   searchSync.start();
   ```

### Fluxo de gravação

Quando um produto é salvo/atualizado no MongoDB → `searchRevision` incrementa e `searchPending=true` → `ProductSearchSync.tick()` (ou `publish()`) lê o snapshot → `putVersioned` escreve no Elasticsearch com revision fencing → `acknowledgeSearch` marca como entregue → se falhar, `retrySearch` agenda nova tentativa com backoff.

---

## 7. Fallback MongoDB

### Quando MongoDB falha (inicialização da aplicação)

`back/src/index.ts` linhas 424-457: se `connectToMongo()` falhar em modo development, a aplicação faz fallback para `InMemory*` repositories para todas as entidades. Nesse caminho:

- `searchIndex = undefined` (linha 454) — o índice de busca é **desabilitado** no fallback.
- Comentário no código: "Search falls back to the in-memory repository here."

### Quando Elasticsearch está indisponível (em runtime)

Não há fallback automático de Elasticsearch para MongoDB na camada de busca:

- `ElasticsearchProductIndex.search()` (linha 205-285): chama `ensureIndex()` e depois `fetch` para `products/_search`. Se `fetch` falhar ou a resposta não for ok, lança `ELASTICSEARCH_SEARCH_FAILED`. Não há fallback para MongoDB.
- `MongoProductRepository.findAll()` (linhas 167-213): oferece busca textual nativa no MongoDB via regex (`$or` sobre `name` e `description`) com filtros de status, vendorId e sort. Este é o caminho de busca que não depende do ES, usado diretamente pelos serviços/repositories quando não se passa pelo `ElasticsearchProductIndex`.

---

## 8. Limitações encontradas

1. **Erros de escrita são silenciados:** `ElasticsearchProductWriter.write()` e `putVersioned()` possuem blocos `catch` vazios que não propagam o erro original do transporte/ES (apenas lançam o genérico `ELASTICSEARCH_WRITE_FAILED`). Isso dificulta o diagnóstico da causa real da falha de escrita.

2. **Não há retry na escrita direta (`indexProduct`):** apenas o `ProductSearchSync` tem retry com backoff. Chamadas diretas a `indexProduct` que falham não são retryadas.

3. **`delete` indisponível:** `ElasticsearchProductWriter.delete()` sempre lança `ELASTICSEARCH_DELETE_UNAVAILABLE` sem tentativa de rede. Remoção de produtos do índice não é suportada.

4. **Índice `products_v1` em status RED:** devido ao disco do nó acima do high watermark (97.2% > 90%), escrita e leitura no índice podem falhar ou travar. O cluster tem apenas 1 nó, sem réplicas, sem redundância.

5. **Não há Elasticsearch client library:** o código depende exclusivamente de `fetch` nativo e da API REST do ES, sem abstração de cliente oficial, sem pool de conexões, sem retry nativo de transporte.

6. **O `require_alias=true` na escrita bulk:** pode amplificar falhas quando o alias não está resolúvel ou o índice de destino não está alocado.

7. **Fallback de busca limitado:** quando ES está indisponível, `ElasticsearchProductIndex.search()` lança erro; não há desvio automático para `MongoProductRepository.findAll()`.

---

## Evidências de execução

- Comando: `npx vitest run src/integration/elasticsearch.integration.test.ts` (diretório `back/`)
- Resultado: 3 falhos (`ELASTICSEARCH_WRITE_FAILED`), 2 passos, 5 total, ~40s
- Comando: `curl http://localhost:9200/` → ES 8.15.0 respondendo
- Comando: `curl http://localhost:9200/_cluster/health` → status `red`, `unassigned_shards: 3`
- Comando: `curl http://localhost:9200/_cluster/allocation/explain` → `disk_threshold`, decisão `NO`, disco em 97.2%
- Comando: `curl http://localhost:9200/_cat/indices?v` → `products_v1` com status `red`
- Comando: `docker ps -a` → container `back-elasticsearch-1` Up, porta 9200 mapeada

---

**Conclusão:** As 3 falhas de teste de integração são causadas por uma condição de infraestrutura (disco do nó Elasticsearch acima do high watermark, impedindo alocação do shard primário do índice `products_v1`), resultando em `ELASTICSEARCH_WRITE_FAILED` em todas as operações de escrita bulk. Não há defeito de código nos módulos de busca; o código funciona corretamente quando o ES está saudável (confirmado pelos testes unitários com mock e pelos 2 testes de integração que não escrevem no índice).