# Análise de Design — S3 Object Naming (Product Images, Invoices, Uploads)

**Data:** 2026-10-25  
**Executor:** code-orchestrator (T-304)  
**Fase:** P3a — Logical & Physical Data Models  
**Dependência:** T-118 (Invoice scope), CD-016 (Images for Product/Review) ✅  
**Critério de Aceitação:** Naming convention + folder structure  

---

## 1. Objetivo

Definir a convenção de nomenclatura e estrutura de pastas para objetos no AWS S3, cobrindo:
- **Product Images** (CD-016: Product_Pic para Product e Review)
- **Invoices/Receipts** (CD-035..CD-038: commercial receipt PDF)
- **Uploads gerais** (vendor onboarding docs, etc.)

---

## 2. Decisões Confirmadas

| Referência | Decisão |
|------------|---------|
| **CD-016** | Images para Product e Review via Product_Pic |
| **CD-035** | Invoice = commercial receipt (PDF), NÃO NF-e |
| **CD-036** | Invoice usa valores históricos do Order |
| **CD-037** | Partial refund NÃO reescreve invoice original |
| **CD-038** | Invoice tem Order + Emission_At; Invoice_History placeholder |
| **CD-049** | ES indexes rebuildable from MongoDB (source of truth) |
| **CD-053** | Docker Compose: cada projeto tem seu Dockerfile; root compose sobe tudo |

---

## 3. Bucket Structure

**Nota:** Nomes de bucket S3 são globalmente únicos na AWS. Recomenda-se usar prefixo organizacional (`{org-prefix}`) para evitar colisão em contas compartilhadas ou multi-tenant.

```
{org-prefix}-fs01-marketplace-{env}/
├── products/
│   ├── {vendor_id}/
│   │   ├── {product_id}/
│   │   │   ├── main.{ext}           # Imagem principal
│   │   │   ├── gallery/{n}.{ext}    # Galeria (01, 02, 03...)
│   │   │   └── thumbnails/
│   │   │       ├── main.webp
│   │   │       └── gallery/{n}.webp
│   │   └── temp/                    # Uploads temporários (pre-validation)
├── reviews/
│   ├── {product_id}/
│   │   ├── {review_id}/
│   │   │   ├── {n}.{ext}            # Imagens do review (owned)
│   │   │   └── thumbnails/
├── invoices/
│   ├── {year}/
│   │   ├── {month}/
│   │   │   ├── {order_id}.pdf       # Invoice original
│   │   │   └── refunds/
│   │   │       ├── {refund_id}.pdf  # Documento de estorno (CD-037)
├── vendors/
│   ├── {vendor_id}/
│   │   ├── onboarding/              # Docs KYC (CPF/CNPJ, bank account)
│   │   └── logos/
└── temp/
    └── {upload_id}/                 # Uploads multipart temporários
```

**Variáveis:**
- `{org-prefix}` = prefixo organizacional (ex: `acme`, `mycompany`) para evitar colisão de nomes globalmente únicos no AWS S3. **Decisão de deployment** — não definida no código, definida na infraestrutura.
- `{env}` = `dev`, `staging`, `prod` (separação por ambiente via bucket ou prefixo)
- `{ext}` = extensão original (jpg, png, webp, pdf)
- IDs = MongoDB ObjectId (24 hex chars)

---

## 4. Product Images — Convenção

### 4.1 Padrão de Chave

```
products/{vendor_id}/{product_id}/main.{ext}
products/{vendor_id}/{product_id}/gallery/{sequence:02d}.{ext}
products/{vendor_id}/{product_id}/thumbnails/main.webp
products/{vendor_id}/{product_id}/thumbnails/gallery/{sequence:02d}.webp
```

### 4.2 Regras

| Regra | Descrição |
|-------|-----------|
| **Main image** | Obrigatória para product ativo; primeira upload = main |
| **Gallery** | Até 10 imagens; sequence 01-10 |
| **Thumbnails** | Gerados automaticamente (WebP, 300x300); prefix `thumbnails/` |
| **Formato** | Upload aceita jpg/png/webp; armazenado como original + WebP thumb |
| **Validação** | Max 10MB por imagem; dimensões mínimas 800x800 |
| **CDN** | CloudFront na frente; cache TTL 1 ano (imagens imutáveis) |

### 4.3 Metadata (S3 Object Tags)

```json
{
  "product_id": "ObjectId",
  "vendor_id": "ObjectId",
  "image_type": "main|gallery",
  "sequence": "01",
  "original_filename": "product_photo.jpg",
  "content_type": "image/jpeg",
  "size_bytes": 2456789,
  "uploaded_at": "2026-10-25T10:00:00Z",
  "uploaded_by": "vendor|admin"
}
```

---

## 5. Review Images — Convenção

### 5.1 Padrão de Chave

```
reviews/{product_id}/{review_id}/{sequence:02d}.{ext}
reviews/{product_id}/{review_id}/thumbnails/{sequence:02d}.webp
```

### 5.2 Regras

| Regra | Descrição |
|-------|-----------|
| **Ownership model** | **RESOLVIDO** (CD-071): owned images permitted per review; Q-017 RESOLVED |
| **Max por review** | 5 imagens |
| **Thumbnails** | WebP 200x200 |
| **Moderação** | Post-moderation (Q-017 PARTIALLY_RESOLVED): publish imediato, admin pode ocultar |

---

## 5.3 Nota sobre Q-017 (RESOLVIDO)

Q-017 foi resolvido em MP-08 com 7 sub-decisões confirmadas (CD-067..CD-072). Conforme CD-071: **owned images are permitted for reviews** — reviews may include user-uploaded images stored under `reviews/{product_id}/{review_id}/`. A estrutura de pastas já suporta este modelo. Product_Pic remains associated with Product (CD-016); Review images are separate entities owned by the review author.

---

## 6. Invoices — Convenção

### 6.1 Padrão de Chave

```
invoices/{year}/{month:02d}/{order_id}.pdf
invoices/{year}/{month:02d}/refunds/{refund_id}.pdf
```

### 6.2 Regras

| Regra | Descrição |
|-------|-----------|
| **CD-035** | Commercial receipt (PDF), não NF-e |
| **CD-036** | Usa valores históricos do Order (snapshot) |
| **CD-037** | Partial refund → documento separado (não reescreve original) |
| **CD-038** | Invoice tem Order + Emission_At |
| **Trigger** | Q-018 PARTIALLY_RESOLVED: on payment? on delivery? on-demand? (definir em P4f) |
| **Storage** | S3 Standard-IA (access infrequent); lifecycle → Glacier após 90 dias |
| **Imutabilidade** | Object Lock (WORM) para compliance; versioning habilitado |

### 6.3 Metadata (S3 Object Tags)

```json
{
  "order_id": "ObjectId",
  "document_type": "invoice|refund",
  "emission_at": "2026-10-25T10:00:00Z",
  "currency": "BRL",
  "total_amount": "999.90",
  "generated_by": "system",
  "pdf_version": "1.7"
}
```

---

## 7. Vendor Onboarding Documents

### 7.1 Padrão de Chave

```
vendors/{vendor_id}/onboarding/{doc_type}.{ext}
vendors/{vendor_id}/logos/{logo_type}.{ext}
```

**doc_type:** `cpf_cnpj`, `bank_account`, `kyc_selfie`, `contract_signed`
**logo_type:** `logo`, `banner`

---

## 8. Temporary Uploads (Multipart/Chunked)

### 8.1 Padrão de Chave

```
temp/{upload_id}/part-{part_number:05d}
```

### 8.2 Regras

| Regra | Descrição |
|-------|-----------|
| **Upload ID** | UUID v4 (gerado no início do upload) |
| **Multipart** | Partes de 5-100MB; S3 Multipart Upload API |
| **TTL** | 24 horas (Lifecycle Rule: delete incomplete multipart after 1 dia) |
| **Validação** | Após complete → move para destino final (products/, reviews/, etc.) |
| **Cleanup** | Lambda/Job diário limpa `temp/` órfãos > 24h |

---

## 9. Permissões e Segurança (IAM)

### 8.1 Políticas por Role

| Role | Permissões S3 |
|------|---------------|
| **Backend (API)** | `PutObject`, `GetObject`, `DeleteObject` em `products/`, `reviews/`, `invoices/`, `vendors/`, `temp/` |
| **Frontend (Presigned URLs)** | `PutObject` (temp/, products/{vendor_id}/), `GetObject` (produtos públicos) |
| **Admin** | Full access all prefixes |
| **CDN (CloudFront OAI)** | `GetObject` em `products/`, `reviews/`, `invoices/` |

### 8.2 Bucket Policy (Resumo)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontOAI",
      "Effect": "Allow",
      "Principal": { "CanonicalUser": "CLOUDFRONT_OAI_ID" },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::fs01-marketplace-{env}/products/*"
    },
    {
      "Sid": "DenyInsecureTransport",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": "arn:aws:s3:::fs01-marketplace-{env}/*",
      "Condition": { "Bool": { "aws:SecureTransport": "false" } }
    }
  ]
}
```

---

## 9. Lifecycle Rules

| Regra | Prefixo | Ação | Dias | Status |
|-------|---------|------|------|--------|
| Incomplete multipart cleanup | `temp/` | AbortMultipartUpload | 1 | MVP |
| Invoice archival | `invoices/` | Transition to Standard-IA | 30 | MVP |
| Invoice long-term | `invoices/` | Transition to Glacier | 90 | **DEFERRED** — aguarda decisão explícita de compliance/retention (Q-018) |
| Invoice compliance | `invoices/` | Expire (Object Lock retention) | 3650 (10 anos) | **DEFERRED** — aguarda decisão explícita de compliance/retention (Q-018) |
| Temp uploads | `temp/` | Expire | 1 | MVP |

---

## 9.1 Notas sobre Lifecycle/Compliance

As regras de Glacier (90 dias) e Object Lock/WORM (10 anos) são classificadas como **DEFERRED** (não TECHNICAL_FUTURE) pois:
- CD-038 define Invoice_History como placeholder intencionalmente vazio e **defere todos os detalhes de geração, persistência e history de invoices** para discussão posterior
- Q-018 (PARTIALLY_RESOLVED) lista: "Generation trigger (on payment? on delivery? on-demand)?" e "Storage (S3? DB?) — TECHNICAL_FUTURE" — **não há decisão sobre retenção longa ou WORM**
- NFR-DATA-* não especificam requisitos de retenção longa ou WORM
- **TECHNICAL_FUTURE** implica que está no roadmap técnico; **DEFERRED** indica que requer decisão de negócio explícita (Q-018) antes de qualquer implementação
- Podem ser adicionadas em P4+ **após decisão explícita** sobre requisitos de compliance/retention

---

## 10. Validação dos Critérios de Aceitação

| Critério | Atendido? | Evidência |
|----------|-----------|-----------|
| Naming convention | ✅ | Seções 4, 5, 6, 7 |
| Folder structure | ✅ | Seção 3 (tree view) |
| Product images (CD-016) | ✅ | Seção 4 |
| Invoices (CD-035..038) | ✅ | Seção 6 |
| Uploads temporários | ✅ | Seção 8 |
| Lifecycle MVP | ✅ | Seção 9 (apenas regras MVP) |
| Compliance/Glacier | ⚠️ | Seção 9.1 — **TECHNICAL_FUTURE** |
| Segurança (IAM, HTTPS) | ✅ | Seção 8 |
| Review images ownership | ✅ | Seção 5.3 — **RESOLVIDO (CD-071: owned images permitted)** |

---

## 11. Próximos Passos

- **T-305:** Data integrity rules (unique constraints, referential integrity)
- **T-306:** Migration/seed strategy
- **T-703/1103:** Stage 3/7 Implementation (Image upload, PDF generation)

---

**Status:** **CONCLUÍDO** — S3 naming convention e folder structure documentados.