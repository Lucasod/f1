# Análise de Decisão — Armazenamento Local vs S3 para Imagens de Produtos (T-703)

## 1. Veredito

**Recomendação: APROVADA COM RESSALVAS** — Implementar armazenamento local persistente com volume Docker como solução intermediária, mantendo abstração para migração futura para S3. Não declarar T-703 integralmente concluída até validação do S3.

## 2. Estado Git

- Branch: `feature/closing-initial-implementation`
- HEAD: `c6bddfd` (`feat(api): implement product CRUD and fix E2E test reliability`)
- Working tree: clean (sem alterações não commitadas)
- Preservação confirmada: ✅ Nenhum arquivo modificado durante esta análise

## 3. Situação Atual

### 3.1 Implementação de Produtos
- **Entidade Product** (`F01/back/src/modules/product/product.domain.ts:78-231`): Campo `images: string[]` (linha 87) — array de strings (URLs/caminhos)
- **Serviço Product** (`product.service.ts`): Métodos `addImage()`, `removeImage()` manipulam array de strings
- **Rotas Product** (`product.routes.ts`): Aceita `images?: string[]` no create/update
- **Contrato OpenAPI** (`openapi.yaml:513-519`): `images` array de URIs, exemplo `["https://cdn.example.com/images/phone1.jpg"]`

### 3.2 Docker e Persistência
- **Backend Dockerfile** (`F01/back/Dockerfile`): Multi-stage, copia apenas `dist/`, sem volumes de dados
- **Backend compose** (`F01/back/docker-compose.yml:22-25`): Volumes para código fonte (`./src:/app/src`), não para dados persistentes
- **Root compose** (`F01/docker-compose.yml`): Volumes nomeados apenas para MongoDB, Redis, Elasticsearch
- **Nenhum volume** configurado para armazenamento de arquivos de aplicação

### 3.3 T-703 e Dependências
- **T-703**: "Backend: Image upload to S3 — Presigned URLs, multipart, validation (T-304)" — Status: `⏳ pending`
- **Dependências**: T-304 (S3 naming), T-602 (auth/authorization)
- **T-304**: `COVERED_BY_DECISION` — Análise S3 naming concluída (`analysis_s3_naming.md`)
- **FR-PROD-005**: "Product images array (S3 deferred per Q-018)" — S3 explicitamente deferido

## 4. Comparação das Três Alternativas

| Critério | Alternativa 1: Apenas Mock/Referências | Alternativa 2: Armazenamento Local + Volume | Alternativa 3: S3 Imediato |
|----------|----------------------------------------|---------------------------------------------|----------------------------|
| **Complexidade** | Baixa (apenas mock no frontend) | Média (upload, validação, servir arquivos, volume) | Alta (AWS creds, SDK, presigned URLs, IAM, CDN) |
| **Velocidade de entrega** | Mais rápida (sem backend de upload) | Média (1-2 dias) | Lenta (requer credenciais AWS, configuração) |
| **Persistência** | Nenhuma (dados perdidos ao reload) | ✅ Volume Docker persistente | ✅ S3 durável (99.999999999%) |
| **Segurança** | N/A | Validação local, path traversal, tipos MIME | Validação S3, IAM, presigned URLs, HTTPS |
| **Testes** | Fáceis de mockar | Testes isolados com volume temporário | Requer mock AWS ou credenciais de teste |
| **Impacto no escopo** | Não atende "upload funciona" | Atende upload/exibição; S3 deferido | Atende completo, mas bloqueado por credenciais |
| **Custo migração futura** | Alto (refatorar tudo) | Baixo (adapter pattern) | Zero (já é S3) |
| **Risco de produção** | Alto (não testado) | Médio (difere de prod) | Baixo (ambiente real) |
| **Requisito oficial** | ❌ "image upload to S3" | ⚠️ Parcial (local ≠ S3) | ✅ Completo |

## 5. Arquitetura Mínima Recomendada

### 5.1 Interface de Armazenamento (StorageAdapter)

```typescript
// F01/back/src/shared/storage/storage.interface.ts
export interface StorageAdapter {
  save(file: Buffer, key: string, contentType: string): Promise<{ url: string; key: string }>;
  delete(key: string): Promise<void>;
  getUrl(key: string): string;
  validateFile(buffer: Buffer, contentType: string): ValidationResult;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}
```

### 5.2 Implementações

1. **LocalStorageAdapter** — Salva em `./storage/uploads/` (volume `/app/storage`), serve via endpoint `/api/v1/uploads/:key`
2. **S3StorageAdapter** — Implementação futura usando AWS SDK v3

### 5.3 Injeção no ProductService

```typescript
// product.service.ts constructor
constructor(
  productRepo: ProductRepository,
  categoryRepo: CategoryRepository,
  vendorRepo: VendorRepository,
  private readonly storage: StorageAdapter
) {}
```

### 5.4 Configuração por Ambiente

```typescript
// config/index.ts
storage: {
  type: 'local' | 's3',
  local: { basePath: '/app/storage/uploads', publicUrl: '/api/v1/uploads' },
  s3: { bucket: string; region: string; cdnUrl?: string }
}
```

## 6. Estratégia de Persistência e Teste

### 6.1 Volume Docker
```yaml
# docker-compose.yml (backend service)
volumes:
  - f01_uploads:/app/storage/uploads

volumes:
  f01_uploads:
```

### 6.2 Isolamento de Testes
- Testes unitários: Mock do `StorageAdapter` (in-memory)
- Testes de integração: Volume temporário único por execução (`f01_uploads_test_<uuid>`)
- Cleanup automático no `beforeEach`/`afterEach`

### 6.3 Prova de Sobrevivência à Recriação
1. Subir containers: `docker compose up -d`
2. Upload imagem via API → retorna URL
3. Parar e remover containers: `docker compose down`
4. Subir novamente: `docker compose up -d`
5. Verificar se URL ainda serve a imagem
6. Verificar se `images[]` no MongoDB mantém referência correta

## 7. Segurança, Limitações e Riscos

### 7.1 Segurança (Implementação Local)
- **Validação**: Tamanho máx 10MB, MIME types permitidos (`image/jpeg`, `image/png`, `image/webp`)
- **Sanitização**: Nomes de arquivo → UUID + extensão original; prevenção path traversal
- **Autorização**: Apenas VENDOR (owner) ou ADMIN podem upload/remover; Consumer apenas visualiza
- **Exposição**: Endpoint `/api/v1/uploads/:key` com verificação de existência; sem listagem de diretório

### 7.2 Limitações do Armazenamento Local
- **Não é produção**: Single-instance, não escalável horizontalmente
- **Backup manual**: Volume Docker não tem snapshot automático
- **CDN ausente**: Latência maior para usuários distantes
- **Disco finito**: Monitoramento de espaço necessário

### 7.3 Riscos de Migração
- **URLs diferentes**: Local usa `/api/v1/uploads/{key}`, S3 usa `https://cdn.example.com/{key}`
- **Estratégia**: `images[]` armazena **chave lógica** (`{type}/{vendor_id}/{product_id}/{filename}`), não URL completa
- **Adapter.getUrl(key)** resolve a URL correta por ambiente

## 8. Impacto sobre T-703 e Tarefas Dependentes

| Item | Impacto |
|------|---------|
| **T-703** | Dividida em duas entregas: T-703a (Local) + T-703b (S3). Status atual: `⏳ pending` → T-703a `in_progress`, T-703b `pending` |
| **T-704 (Vendor Dashboard)** | Funciona com ambos (usa `images[]` do produto) |
| **T-705 (Product Catalog)** | Funciona com ambos (exibe URLs do `images[]`) |
| **T-801/802/803 (Search)** | Unaffected |
| **T-1103 (Invoices S3)** | Independente — usa bucket/pasta separados |
| **Decisões/Contratos** | `analysis_s3_naming.md` permanece válido para migração futura |

## 9. Plano Mínimo de Implementação (Ordenado)

1. **Criar interface `StorageAdapter`** em `F01/back/src/shared/storage/`
2. **Implementar `LocalStorageAdapter`** com validação, salvamento em disco, geração de chave
3. **Adicionar endpoint `POST /api/v1/products/:productId/images`** (multipart/form-data)
4. **Adicionar endpoint `DELETE /api/v1/products/:productId/images/:imageKey`**
5. **Adicionar endpoint `GET /api/v1/uploads/:key`** para servir arquivos
5. **Configurar volume `f01_uploads`** no `docker-compose.yml` (backend)
6. **Injetar adapter no `ProductService`** via configuração
7. **Testes unitários** do adapter (mock) e rotas (Supertest)
8. **Teste de integração** com volume Docker (persistência)
9. **Documentar** no `analysis_s3_naming.md` a chave lógica usada
10. **Atualizar T-703** no task_list: T-703a ✅, T-703b ⏳

## 10. Critérios de Aceitação Propostos

### T-703a: Armazenamento Local (Entregável Imediato)
- [ ] Upload de imagem via multipart retorna `{ key, url }`
- [ ] Validação: tamanho ≤ 10MB, MIME permitido, sanitização de nome
- [ ] Apenas VENDOR owner ou ADMIN podem upload/remover
- [ ] Imagem servida via `GET /api/v1/uploads/{key}` com Content-Type correto
- [ ] Referência salva em `Product.images[]` como **chave lógica** (ex: `products/{vendorId}/{productId}/main.jpg`)
- [ ] Volume Docker `f01_uploads` persiste arquivos após `docker compose down && up`
- [ ] Testes: 100% cobertura do adapter + rotas de upload/serve
- [ ] Build e testes de regressão passam (234+ backend, 64+ frontend)

### T-703b: Integração S3 (Entregável Futuro — Pendente Credenciais)
- [ ] Implementar `S3StorageAdapter` com AWS SDK v3
- [ ] Presigned URLs para upload direto do frontend (opcional)
- [ ] Configuração via variáveis de ambiente (bucket, region, credenciais)
- [ ] CloudFront CDN configurado
- [ ] Lifecycle rules (Glacier, Object Lock) — aguarda decisão Q-018
- [ ] Migração de chaves existentes: `adapter.migrateKeys(localKeys)` ou script único
- [ ] Validação E2E em ambiente de staging com bucket real

## 11. Arquivos que Precisarão Ser Alterados

| Arquivo | Justificativa |
|---------|---------------|
| `F01/back/src/shared/storage/storage.interface.ts` (novo) | Interface comum para adapters |
| `F01/back/src/shared/storage/local.adapter.ts` (novo) | Implementação local com validação |
| `F01/back/src/modules/product/product.service.ts` | Injeção de `StorageAdapter`; delegar `addImage/removeImage` |
| `F01/back/src/modules/product/product.routes.ts` | Novas rotas `POST/DELETE /products/:id/images`; `GET /uploads/:key` |
| `F01/back/src/config/index.ts` | Configuração `storage.type` e opções |
| `F01/back/docker-compose.yml` | Volume `f01_uploads:/app/storage/uploads` |
| `F01/back/src/index.ts` | Instanciar adapter conforme config e injetar no ProductService |
| `F01/back/src/modules/product/product.routes.test.ts` | Testes das novas rotas de upload/serve |
| `F01/docs/analysis/analysis_s3_naming.md` | Documentar chave lógica usada no armazenamento local |
| `F01/docs/task_list.md` | Dividir T-703 em T-703a (local) e T-703b (S3) |

## 12. Questões que Dependem de Decisão Humana

1. **Aprovação da estratégia**: Confirmar se armazenamento local intermediário é aceitável para o MVP
2. **Divisão de T-703**: Aceitar T-703a (local) como concluída e T-703b (S3) como pendente explícita?
3. **Chave lógica vs URL**: Confirmar que `images[]` armazenará chave lógica (`products/{vendorId}/{productId}/...`) e não URL completa
4. **Limite de upload**: 10MB por imagem é aceitável? (Padrão da análise S3)
5. **Tipos MIME**: Apenas JPEG/PNG/WebP? (Excluir HEIC, AVIF, etc.)
6. **Thumbnails**: Gerar no backend (sharp) ou deferir para S3/CDN?
6. **Credenciais AWS**: Quando estarão disponíveis para iniciar T-703b?
7. **Q-018 (Glacier/WORM/Trigger)**: Decisão necessária antes de T-703b e T-1103

---

**Status desta análise:** CONCLUÍDA — Aguardando decisão do responsável para autorizar implementação de T-703a.