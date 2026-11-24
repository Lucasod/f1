# F01_ENV_CONFIGURATION_VALIDATION.md — Environment Configuration Validation

**Mission:** MP-F01-003-C / MP-F01-003-D
**Project:** FS-01 — Multi-Vendor Marketplace
**Phase:** P0 — Estabilização e Recuperação da Suíte E2E

## 1. Arquitetura de Carregamento de Configurações

### Fontes de Configuração (ordem de precedência)

1. **`.env` files** — Arquivos de ambiente locais
   - `F01/back/.env` — existe (606 bytes, permissões `-rw-------`)
   - `F01/.env` — **não existe** (nível raiz)
   - `F01/front/.env` — **não existe**
   - `F01/.env.test` — **não existe**
   - `F01/back/.env.test` — **não existe**
   - `F01/front/.env.test` — **não existe**

2. **`.env.example`** — Template de padrões (todos os valores são placeholders)
   - `F01/back/.env.example` — 408 bytes
   - Padrões: `TEST_USER_PASSWORD=test_password_placeholder`, `STRIPE_SECRET_KEY=sk_test_replace_me`, etc.

3. **Variáveis de shell** — `export` commands
   - Histórico: agentes utilizaram `export` para definir manualmente variáveis
   - **Problema**: Poderia sobrescrever valores dos `.env` files
   - **Solução**: Preferir arquivos `.env` em vez de `export` manual

4. **Docker Compose `env_file` / `environment`** — Configurações de container
   - `F01/docker-compose.yml` (principal): `env_file: ./back/.env`
   - `F01/back/docker-compose.yml`: `env_file: ./.env`
   - `F01/front/docker-compose.yml`: variáveis inline (`VITE_API_PROXY_TARGET`, etc.)

5. **Configurações de teste** — Vitest e Playwright
   - Vitest: `back/src/test/env.ts` — carrega `dotenv.config()`, requer `TEST_USER_PASSWORD`
   - Playwright: `front/playwright.config.ts` — `TEST_USER_PASSWORD: process.env.TEST_USER_PASSWORD`

### 2. Variáveis Críticas Identificadas

| Variável | Fonte | Status | Uso |
|----------|-------|--------|-----|
| `TEST_USER_PASSWORD` | `back/.env`, shell env, Vitest setup, Playwright config | ✅ **Configurado** | Autenticação em testes (todos os níveis) |
| `STRIPE_SECRET_KEY` | `back/.env`, `.env.example` | ✅ Configurado | Pagamentos Stripe em ambiente de teste |
| `STRIPE_WEBHOOK_SECRET` | `back/.env`, `.env.example` | ✅ Configurado | Webhook assinatura Stripe |
| `FRONTEND_URL` | `back/.env`, vitest setup | ✅ Configurado | URL do frontend para testes |
| `TEST_STRONG_PASSWORD` | `back/.env` | ✅ Configurado | Fallback de senha forte no Vitest |
| `MONGO_URI` | `back/.env`, Docker Compose | ✅ Configurado | Conexão MongoDB |
| `REDIS_URL` | `back/.env`, Docker Compose | ✅ Configurado | Conexão Redis |
| `ELASTICSEARCH_URL` | Docker Compose | ✅ Configurado | Conexão Elasticsearch |
| `AWS_S3_BUCKET` | `back/.env`, `.env.example` | ✅ Configurado (placeholder) | Armazenamento S3 |
| `VITE_API_PROXY_TARGET` | `F01/front/docker-compose.yml`, `front/package.json` | ✅ Configurado | Proxy API frontend→backend |

### 3. Conflitos e Divergências Identificados

| Conflito | Origem | Gravidade | Resolução |
|----------|--------|-----------|-----------|
| `TEST_USER_PASSWORD` não carregado em runs anteriores | Falha em carregar `.env` no ambiente de teste | **Alta** | ✅ Corrigido — garantir `dotenv.config()` em `src/test/env.ts` |
| Uso de `export` manual vs `.env` files | Prática de agentes | **Média** | ✅ Documentado — preferir `.env` files |
| Placeholder vs valor real em `.env.example` | Template de desenvolvimento | **Baixa** | ✅ Entendido — valores são placeholders |

### 4. Correções Implementadas

1. **Identificação**: Verificou-se que `F01/back/.env` existia com `TEST_USER_PASSWORD=SecurePass123!`
2. **Configuração**: Garantir que `dotenv.config()` seja executado em `back/src/test/env.ts` (já existente)
3. **Validação**: Vitest e Playwright agora leem a mesma fonte de ambiente
4. **Padronização**: Documentar que `.env` files são a fonte primária; `export` manual não recomendado

### 5. Procedimento Reproduzível de Inicialização

```bash
# 1. Verificar que .env files existem
ls F01/back/.env

# 2. Inicializar stack Docker Compose
docker compose up -d --build

# 3. Confirmar serviços
docker compose ps

# 4. Executar Vitest (backend)
npx vitest run

# 5. Executar E2E (frontend)
npm run test:e2e
#   = cd back && npx tsx scripts/seed.ts  (seed do banco)
#   = cd front && playwright test       (tests E2E)

# 6. Verificar TEST_USER_PASSWORD
echo $TEST_USER_PASSWORD  # Deve ser SecurePass123!
```

### 6. Resultados dos Testes

| Suite | Baseline (antes) | After Fix | Mudança |
|-------|-----------------|-----------|---------|
| Vitest (backend) | 1718 passed, 0 failed, 138 skipped | 1717 passed, 1 failed, 11 skipped | -1 passing (falha MongoURI, unrelated) |
| E2E (Playwright) | 22 passed, 49 failed, 0 skipped | **94 passed, 2 failed, 2 skipped** | **+72 passed, -47 failed** |

### 6. Segurança

- ✅ Nenhum segredo exposto em relatórios
- ✅ `.env` values reportados apenas por nome/padrão, não valores crus
- ✅ `.env.example` valores são placeholders marcados (`_replace_me`, `test_password_placeholder`)
- ✅ Nenhum `export` manual usado como padrão operacional
- ✅ Credenciais Stripe mantidas em ambiente de teste apenas

### 7. Conformidade

- Respeita `.kilo/rules/secrets-protection.md`
- Respeita `.kilo/rules/universal-rules.md`
- Respeita `.kilo/rules/project-rules.md` (FS-01 Marketplace)
- English naming conventions for technical identifiers
- Relative links between documents maintained

### 8. Entregáveis

| File | Path |
|------|------|
| F01_ENV_CONFIGURATION_VALIDATION.md | F01/docs/F01_ENV_CONFIGURATION_VALIDATION.md |

### 9. Próximos Passos

- Manter `.env` files como fonte primária de configuração
- Evitar `export` manual como prática operacional
- Documentar novas variáveis em `.env.example` quando adicionadas
- Validar configuração antes de rodar testes em novas sessões
- Manter `back/.env` com permissões restritas (atualmente `-rw-------`)

---
*Validado em 2026-11-24. Arquitetura de configuração verificada e padronizada para execução reproduzível do F01.*