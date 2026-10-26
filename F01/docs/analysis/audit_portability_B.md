# AUDITORIA B — Relatório de Portabilidade do Marketplace FS-01

**Data:** 2026-10-26  
**Escopo:** Identificar caminhos absolutos, dependências da raiz, e requisitos para execução independente/portável

---

## 1. Resumo Executivo

O projeto **não possui caminhos absolutos hardcoded** em código executável (TS/TSX/JSON/YAML/SH). Os únicos caminhos absolutos encontrados estão em documentação histórica (`F01/docs/mp_log.md`) e não afetam a execução.

**Principais riscos de portabilidade:**
1. **Nomes de volumes/redes genéricos** nos 3 docker-compose.yml (risco de colisão)
2. **VITE_API_URL hardcoded para localhost** no compose do front
3. **Build context diferentes** entre root compose e composes isolados
4. **Ausência de rede compartilhada `f01_network`** nos composes isolados
5. **Frontend standalone não sobe sem backend** (dependência de API)

---

## 2. Tabela de Riscos

| ID | Arquivo | Linha | Risco | Impacto | Mitigação Sugerida |
|----|---------|-------|-------|---------|-------------------|
| **PRT-001** | `docker-compose.yml` (root) | 72-75 | Volumes genéricos: `mongo_data`, `redis_data`, `elasticsearch_data` | **ALTO** | Prefixar com `f01_` (ex: `f01_mongo_data`) |
| **PRT-002** | `back/docker-compose.yml` | 53-56 | Volumes genéricos: `mongo_data`, `redis_data`, `elasticsearch_data` | **ALTO** | Prefixar com `f01_` |
| **PRT-003** | `front/docker-compose.yml` | 21 | `volumes: {}` vazio — ok, mas sem rede definida | **MÉDIO** | Adicionar `networks: { f01_network: { external: true } }` |
| **PRT-004** | `docker-compose.yml` (root) | 6 | `build.context: ./back` — depende da estrutura root | **MÉDIO** | Ajustar para `context: ../back` quando movido para `F01/` |
| **PRT-005** | `docker-compose.yml` (root) | 28 | `build.context: ./front` — depende da estrutura root | **MÉDIO** | Ajustar para `context: ../front` quando movido para `F01/` |
| **PRT-006** | `back/docker-compose.yml` | 6 | `build.context: .` — correto para execução isolada | **BAIXO** | Manter; validar que funciona de `F01/back/` |
| **PRT-007** | `front/docker-compose.yml` | 6 | `build.context: .` — correto para execução isolada | **BAIXO** | Manter; validar que funciona de `F01/front/` |
| **PRT-008** | `front/docker-compose.yml` | 12 | `VITE_API_URL=http://localhost:3000` — hardcoded localhost | **ALTO** | Usar variável de ambiente `${VITE_API_URL:-http://backend:3000}` ou serviço Docker `backend` |
| **PRT-009** | `docker-compose.yml` (root) | 34 | `VITE_API_URL=http://localhost:3000` — mesmo problema | **ALTO** | Mudar para `http://backend:3000` (nome do serviço) |
| **PRT-010** | `back/docker-compose.yml` | 12-15 | `MONGO_URI`, `REDIS_URL`, `ELASTICSEARCH_URL` usam nomes de serviço locais | **BAIXO** | OK para execução isolada; validar conectividade |
| **PRT-011** | `back/src/config/index.ts` | 41-44 | Defaults `localhost` para dev; produção exige env vars | **MÉDIO** | Documentar que produção **requer** env vars explícitas |
| **PRT-012** | `back/src/index.ts` | 25-27 | CORS permite `true` (wildcard) em dev se `CORS_ORIGIN` vazio | **BAIXO** | Comportamento intencional para dev; produção bloqueia wildcard |
| **PRT-013** | `front/vite.config.ts` | 9 | Alias `@` resolve para `./src` — relativo, OK | **BAIXO** | Nenhuma ação necessária |
| **PRT-014** | `back/Dockerfile` | 9 | `COPY dist ./dist` — requer `npm run build` antes | **MÉDIO** | Documentar que build local é pré-requisito; ou usar multi-stage |
| **PRT-015** | `front/Dockerfile` | 9 | `COPY . .` — copia tudo, incluindo node_modules se não ignorado | **MÉDIO** | Adicionar `.dockerignore` no front |
| **PRT-016** | `front/Dockerfile` | 13 | `CMD ["npm", "run", "dev", "--", "--host"]` — modo dev, não produção | **MÉDIO** | Criar `Dockerfile.prod` com `vite build` + `preview` |
| **PRT-017** | `docker-compose.yml` (root) | 22-24, 37-43 | Volumes bind-mount `./back/src:/app/src` — hardcoded paths | **MÉDIO** | Ajustar paths relativos na movimentação para `F01/` |
| **PRT-018** | `back/docker-compose.yml` | 23-24 | Volumes bind-mount `./src:/app/src` — relativo, OK | **BAIXO** | Nenhuma ação necessária |
| **PRT-019** | `front/docker-compose.yml` | 14-19 | Volumes bind-mount relativos — OK | **BAIXO** | Nenhuma ação necessária |
| **PRT-020** | `F01/docs/mp_log.md` | 9, 46-51, etc. | Caminhos absolutos em logs históricos | **BAIXO** | Não afeta execução; apenas documentação |
| **PRT-021** | `kilo.jsonc` | 47-52 | MCP MongoDB usa placeholders `{{...}}` — requer config externa | **BAIXO** | Não afeta execução da aplicação; apenas tooling Kilo |

---

## 3. Análise Detalhada por Categoria

### 3.1 Caminhos Absolutos
**Resultado:** ✅ **LIMPO** — Nenhum caminho absoluto `/home/workstation/source/f1/` em código executável.  
**Evidência:** `grep -r "/home/workstation/source/f1/"` retorna apenas ocorrências em `F01/docs/mp_log.md` (logs históricos).

### 3.2 Dockerfiles

| Aspecto | `back/Dockerfile` | `front/Dockerfile` |
|---------|-------------------|-------------------|
| **Base Image** | `node:22-alpine` ✅ | `node:22-alpine` ✅ |
| **WORKDIR** | `/app` ✅ | `/app` ✅ |
| **COPY package.json** | Separado (cache layer) ✅ | Separado ✅ |
| **Install** | `npm ci --only=production` ✅ | `npm ci` (inclui dev) ⚠️ |
| **COPY Source** | `COPY dist ./dist` (requer build prévio) ⚠️ | `COPY . .` (copia tudo) ⚠️ |
| **EXPOSE** | 3000 ✅ | 5173 ✅ |
| **CMD** | `node dist/index.js` (produção) ✅ | `npm run dev -- --host` (dev) ⚠️ |
| **.dockerignore** | Não verificado | **Ausente** ❌ |

**Riscos:**
- Backend: Requer `npm run build` local antes do `docker build` (não é multi-stage)
- Frontend: Copia `node_modules` e arquivos desnecessários sem `.dockerignore`; roda em modo dev

### 3.3 Docker Compose (3 arquivos)

#### 3.3.1 Root: `/home/workstation/source/f1/docker-compose.yml`
- **Serviços:** backend, frontend, mongo, redis, elasticsearch
- **Rede:** Implícita (default) — **sem nome explícito**
- **Volumes:** `mongo_data`, `redis_data`, `elasticsearch_data` (genéricos) — **PRT-001**
- **Build Context:** `./back` e `./front` — quebram se movidos para `F01/`
- **Portas:** 3000, 5173, 27017, 6379, 9200 expostas no host
- **VITE_API_URL:** `http://localhost:3000` — **PRT-009** (deveria ser `http://backend:3000`)
- **Volumes Bind:** `./back/src:/app/src`, `./front/src:/app/src` — paths relativos ao root

#### 3.3.2 Back: `/home/workstation/source/f1/back/docker-compose.yml`
- **Serviços:** backend, mongo, redis, elasticsearch
- **Rede:** Implícita (default) — **sem `f01_network`**
- **Volumes:** Genéricos — **PRT-002**
- **Build Context:** `.` (correto para execução isolada em `F01/back/`)
- **Variáveis:** Todas usam nomes de serviço Docker (`mongo`, `redis`, `elasticsearch`) ✅
- **Portas:** Expostas no host (conflito se rodar junto com root compose)

#### 3.3.3 Front: `/home/workstation/source/f1/front/docker-compose.yml`
- **Serviços:** frontend apenas
- **Rede:** Nenhuma definida — **PRT-003** (não consegue acessar backend por nome de serviço)
- **Volumes:** `volumes: {}` vazio ✅
- **Build Context:** `.` (correto para execução isolada em `F01/front/`)
- **VITE_API_URL:** `http://localhost:3000` — **PRT-008** (não resolve em container isolado)
- **Sem dependência de backend** — frontend sobe, mas API calls falham

### 3.4 Variáveis de Ambiente

| Variável | Backend (config/index.ts) | Frontend (vite/env) | Compose Root | Compose Back | Compose Front |
|----------|---------------------------|---------------------|--------------|--------------|---------------|
| `MONGO_URI` | Default `localhost:27017` | N/A | `mongodb://mongo:27017/...` ✅ | `mongodb://mongo:27017/...` ✅ | N/A |
| `REDIS_URL` | Default `localhost:6379` | N/A | `redis://redis:6379` ✅ | `redis://redis:6379` ✅ | N/A |
| `ELASTICSEARCH_URL` | Default `localhost:9200` | N/A | `http://elasticsearch:9200` ✅ | `http://elasticsearch:9200` ✅ | N/A |
| `JWT_SECRET` | Default `dev-secret...` | N/A | `dev-secret...` ⚠️ | `dev-secret...` ⚠️ | N/A |
| `CORS_ORIGIN` | **Obrigatório em prod** | N/A | Não definido ⚠️ | Não definido ⚠️ | N/A |
| `VITE_API_URL` | N/A | Usado em `auth.ts` via fetch relativo | `http://localhost:3000` ❌ | N/A | `http://localhost:3000` ❌ |
| `PORT` | Default 3000 | N/A | 3000 | 3000 | N/A |
| `COMMISSION_PCT` | Default 10 | N/A | Não definido | Não definido | N/A |

**Arquivos `.env*`:** Não existem no projeto (confirmado via `glob`).

### 3.5 Scripts e package.json

#### Backend (`back/package.json`)
```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run"
  }
}
```
- **TypeScript:** `tsconfig.json` com `outDir: ./dist`, `rootDir: ./src` ✅
- **Testes:** Vitest com coverage ✅
- **Imports:** Usa `import` ES modules (package.json não tem `"type": "module"`, mas tsconfig usa `NodeNext`) ✅

#### Frontend (`front/package.json`)
```json
{
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:e2e": "playwright test"
  }
}
```
- **TypeScript:** `tsconfig.json` + `tsconfig.node.json` (referências) ✅
- **Vite:** `vite.config.ts` com alias `@` → `./src` ✅
- **Testes:** Vitest (unit) + Playwright (e2e) ✅
- **Proxy Vite:** **Não configurado** — frontend usa fetch relativo `/api/v1/*` (espera same-origin ou proxy)

### 3.6 Dependências Front ↔ Back

**API Calls (front/src/shared/api/auth.ts:62, 71, 80):**
```typescript
fetch('/api/v1/auth/register', ...)
fetch('/api/v1/auth/login', ...)
fetch('/api/v1/auth/refresh', ...)
```
- **Paths relativos** `/api/v1/*` — exigem:
  1. **Same-origin** (frontend servido pelo backend) OU
  2. **Proxy Vite** configurado para `http://localhost:3000` OU
  3. **CORS** configurado no backend para aceitar origem do frontend

**CORS Backend (back/src/index.ts:25-27):**
```typescript
app.use(cors({
  origin: config.corsOrigins.length > 0 ? config.corsOrigins : true,
  credentials: true
}));
```
- **Dev:** Se `CORS_ORIGIN` vazio → `origin: true` (permite qualquer origem) ✅
- **Prod:** Exige `CORS_ORIGIN` explícito, sem wildcard ✅

**Vite Proxy:** **Ausente** em `vite.config.ts` — em dev local, frontend (5173) chama `/api/v1/*` que vai para 5173 (frontend), não para 3000 (backend). **Quebra em dev local sem proxy.**

### 3.7 Execução Independente

| Compose | Sobe Sozinho? | Infra Incluída? | Acessa Backend? | Observações |
|---------|---------------|-----------------|-----------------|-------------|
| **Root** | ✅ Sim | ✅ Sim (mongo, redis, es) | N/A (inclui ambos) | Funciona, mas volumes genéricos |
| **Back** | ✅ Sim | ✅ Sim (mongo, redis, es) | N/A | Funciona isolado em `F01/back/` |
| **Front** | ✅ Sim (container sobe) | ❌ Não | ❌ **Não** — `VITE_API_URL=localhost:3000` não resolve | Precisa de `f01_network` externa + backend rodando |

**Conclusão:** Frontend **não é verdadeiramente standalone** — requer backend acessível via rede Docker.

### 3.8 Nomes de Volumes/Redes — Risco de Colisão

| Compose | Volumes | Redes |
|---------|---------|-------|
| Root | `mongo_data`, `redis_data`, `elasticsearch_data` | Default (implícita) |
| Back | `mongo_data`, `redis_data`, `elasticsearch_data` | Default (implícita) |
| Front | (nenhum) | (nenhuma) |

**Risco:** Se rodar root + back simultaneamente → **conflito de nomes de volumes** (Docker cria volumes com mesmo nome no mesmo projeto).  
**Mitigação:** Prefixar todos com `f01_` e definir `networks: { f01_network: { external: true } }` em todos.

### 3.9 Links Markdown Internos (F01/docs/)

**Resultado:** ✅ **Apenas anchors internos** — `grep -r "\](" F01/docs/ --include="*.md"` retorna apenas links de âncora (ex: `[Introduction](#1-introduction)`).
**Nenhum link relativo/absoluto para arquivos .md** que quebraria ao mover `docs/` ou reestruturar.

---

## 4. Lista de Correções Preparatórias (Pré-Movimentação para F01/)

### Obrigatórias (Bloqueiam Portabilidade)

| # | Ação | Arquivos Afetados |
|---|------|-------------------|
| **PREP-001** | Prefixar todos os volumes com `f01_` nos 3 docker-compose.yml | `docker-compose.yml`, `back/docker-compose.yml` |
| **PREP-002** | Definir rede explícita `f01_network` (external: true) nos 3 composes | `docker-compose.yml`, `back/docker-compose.yml`, `front/docker-compose.yml` |
| **PREP-003** | Corrigir `VITE_API_URL` para usar nome do serviço Docker (`backend:3000`) | `docker-compose.yml:34`, `front/docker-compose.yml:12` |
| **PREP-004** | Ajustar `build.context` no root compose para `../back` e `../front` | `docker-compose.yml:6`, `docker-compose.yml:28` |
| **PREP-005** | Adicionar `.dockerignore` no frontend | `front/.dockerignore` (novo) |
| **PREP-006** | Criar `Dockerfile.prod` no frontend (build + preview) | `front/Dockerfile.prod` (novo) |
| **PREP-007** | Configurar proxy Vite para `/api` → `http://backend:3000` | `front/vite.config.ts` |

### Recomendadas (Melhoram Robustez)

| # | Ação | Arquivos Afetados |
|---|------|-------------------|
| **PREP-008** | Backend: Converter Dockerfile para multi-stage (build + runtime) | `back/Dockerfile` |
| **PREP-009** | Documentar variáveis de ambiente obrigatórias em `.env.example` | `back/.env.example`, `front/.env.example` (novos) |
| **PREP-010** | Adicionar healthchecks nos serviços Docker | Todos os docker-compose.yml |
| **PREP-011** | Validar que `back/docker-compose.yml` funciona de `F01/back/` | Teste manual |
| **PREP-012** | Validar que `front/docker-compose.yml` funciona de `F01/front/` com backend na rede | Teste manual |

---

## 5. Checklist de Verificação de Execução Independente

### Backend Isolado (`cd F01/back && docker compose up`)
- [ ] Container `backend` sobe e responde em `http://localhost:3000/health`
- [ ] Container `mongo` acessível em `mongodb://mongo:27017`
- [ ] Container `redis` acessível em `redis://redis:6379`
- [ ] Container `elasticsearch` acessível em `http://elasticsearch:9200`
- [ ] Variáveis de ambiente lidas corretamente (sem defaults de localhost em prod)
- [ ] Volumes `f01_mongo_data`, `f01_redis_data`, `f01_elasticsearch_data` criados
- [ ] Rede `f01_network` usada (externa)
- [ ] Porta 3000 exposta no host sem conflito

### Frontend Isolado (`cd F01/front && docker compose up`)
- [ ] Container `frontend` sobe e responde em `http://localhost:5173`
- [ ] **Falha esperada:** API calls para `/api/v1/*` retornam 404 (sem backend)
- [ ] Com backend rodando na mesma rede `f01_network`: API calls funcionam via `http://backend:3000/api/v1/*`
- [ ] Vite proxy (se configurado) encaminha `/api` para `backend:3000`
- [ ] Volume `f01_network` externa conectada

### Compose Root (`cd F01 && docker compose up` — após movimento)
- [ ] Todos os 5 serviços sobem
- [ ] Frontend acessa backend via `http://backend:3000` (não localhost)
- [ ] Volumes prefixados `f01_*` criados sem conflito
- [ ] Rede `f01_network` criada/usada
- [ ] Portas 3000, 5173, 27017, 6379, 9200 acessíveis no host

### Testes Automatizados
- [ ] `cd F01/back && npm run build && npm test` — passa
- [ ] `cd F01/front && npm run build && npm test` — passa
- [ ] `cd F01/front && npm run test:e2e` — passa (requer backend rodando)

---

## 6. Evidências de Comandos Executados

```bash
# 1. Caminhos absolutos
grep -r "/home/workstation/source/f1/" --include="*.ts" --include="*.tsx" --include="*.json" --include="*.yml" --include="*.yaml" --include="*.md" --include="*.sh"
# Resultado: Apenas F01/docs/mp_log.md (logs históricos)

# 2. Dockerfiles
cat back/Dockerfile
cat front/Dockerfile

# 3. Docker Compose (3 arquivos)
cat docker-compose.yml
cat back/docker-compose.yml
cat front/docker-compose.yml

# 4. Variáveis de ambiente
glob **/.env*  # Resultado: nenhum arquivo
cat back/src/config/index.ts

# 5. Scripts e package.json
cat back/package.json
cat front/package.json
cat back/tsconfig.json
cat front/tsconfig.json
cat front/vite.config.ts

# 6. Dependências front↔back
cat front/src/shared/api/auth.ts
grep -r "cors\|CORS" back/src --include="*.ts"
grep -r "/api/v1" back/src --include="*.ts"

# 7. Links Markdown
grep -r "\](" F01/docs/ --include="*.md"
# Resultado: Apenas anchors internos (#section)
```

---

## 7. Conclusão

O código **já é amplamente portável** (sem caminhos absolutos, paths relativos corretos). Os principais bloqueios para execução independente verdadeira são:

1. **Volumes/redes genéricos** → Colisão garantida ao rodar múltiplos composes
2. **Frontend não standalone** → `VITE_API_URL=localhost` quebra em container isolado
3. **Root compose paths** → Quebram ao mover para `F01/`
4. **Falta proxy Vite** → Dev local quebra sem configuração manual

**Próximo passo recomendado:** Aplicar correções **PREP-001 a PREP-007** antes da movimentação F01, validar com checklist da Seção 5, então proceder com a movimentação de `back/` e `front/` para `F01/`.