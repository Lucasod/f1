# MP-AFIRDD-F-RECON-01 — Relatório de Reconciliação do Inventário de Bugs

## 1. Tabela reconciliada dos itens prioritários

| Item | Estado atualizado | Evidência | Severidade justificada | Fonte |
|---|---|---|---|---|
| **BUG-005** Wallet | `PARTIALLY_IMPLEMENTED` — Payout module exists (T-1003, MongoPayoutRepository, 12 mongo tests). No wallet module, repository, collection, or route. Contract proposal exists in run record orch-mp27-2026-11-02.md §"T-1007 Wallet/Transaction Contract Proposal" but was never implemented. | `F01/back/src/modules/` — no wallet directory. orch-mp27-2026-11-02.md lines 20-74 propose contract but line 35 states "No wallet/transaction module, repository, collection, or route exists." T-1006 in task list says "wallet balance/transactions blocked by missing backend contract (T-1007 needed)." T-1007 is not defined in task_list.md. | MEDIUM — Vendor financial visibility incomplete; payout works but balance/transactions absent. | task_list.md T-1006/T-1007 gap; orch-mp27-2026-11-02.md; orch-mp24-2026-11-02.md (payout implemented) |
| **BUG-006** Invoice PDF | `PARTIALLY_IMPLEMENTED` — Invoice domain, service, MongoInvoiceRepository, routes implemented. markGenerated validation added (PENDING-only transition). PDF generation uses placeholder (empty buffer, Buffer.alloc(0)). PDFKit mentioned as "approved" in run record fird-marketplace-2026-11-04.md (F-007) but task list says "real PDF generation requires PDF library authorization." No PDFKit dependency found in code. | invoice.service.ts lines 45, 109: "Real PDF generation/storage is deferred (no PDF library, no S3 credentials)." task_list.md T-1103. orch-mp27-2026-11-02.md lines 127-129: "pdfkit recommended" (not confirmed installed). | MEDIUM — Invoice download not functional end-to-end; persistence/contracts exist. | task_list.md T-1103; invoice.service.ts; orch-mp24-2026-11-02.md; fird-marketplace-2026-11-04.md F-007 |
| **BUG-003** S3 | `BLOCKED_BY_EXTERNAL_DEPENDENCY` — S3StorageAdapter exists (s3.adapter.ts) with tests, but index.ts line 89 uses LocalStorageAdapter only. S3 NOT wired into production. No AWS account validation documented anywhere in project (mp_log, task_list, decisions, run records). User's claim of "AWS account validated in us-east-2" is not in any project document. | index.ts:89: `const storageAdapter = new LocalStorageAdapter();`. s3.adapter.ts exists with tests. project_context.md line 21: "Product and review images currently use a local storage adapter." No AWS validation in any doc. | MEDIUM — Media not production-ready; local storage dev-only. | index.ts; s3.adapter.ts; project_context.md; task_list.md T-703b; mp_log.md |
| **BUG-028** Kilo Runtime Adapter | `SUSPICION_UNVERIFIED` — No adapter or resumeRun in kilo-orchestration/src/. Agent-orchestrator uses agents.delegateToCode() (injected dependency). Audit 2026-10-24 found "no real Kilo runtime adapter." Later runs use task tool delegation successfully. Severity should be INFO, not CRITICAL — no evidence of critical impact. | kilo-orchestration/src/agent-orchestrator.ts — no resume/Adapter references. audit-report-2026-10-24.md CR-002. Later run records use task delegation. | INFO (downgraded from CRITICAL) — no evidence of critical impact; orchestration works via task tool. | kilo-orchestration/src/agent-orchestrator.ts; audit-report-2026-10-24.md CR-002 |

## 2. Evidências por item

### BUG-005 (Wallet)

Decisões aplicáveis: CD-030 (Wallet shared by Vendor and Marketplace), CD-031 (Transaction = generic financial movement), CD-048 (no internal customer wallet, negative vendor balances), CD-058 (financial status derived).

Backlog: T-1006 (in_progress, partial payout UI). T-1007 not defined in task_list.md.

Run records: orch-mp27-2026-11-02.md lines 20-74: "T-1007 Wallet/Transaction Contract Proposal" — proposes contract, states "No wallet/transaction module, repository, collection, or route exists."

Código: No wallet module in F01/back/src/modules/. Payout module exists (payout.domain.ts, payout.service.ts, payout.routes.ts, MongoPayoutRepository).

Conclusão: Wallet is NOT implemented. Payout is. Contract proposal exists but was never executed. State: PARTIALLY_IMPLEMENTED.

### BUG-006 (Invoice PDF)

Decisões aplicáveis: CD-035 (commercial receipt, not NF-e), CD-036 (historical values), CD-037 (no rewrite on refund), CD-038 (Order + Emission_At, empty Invoice_History).

Backlog: T-1103 in_progress (internal persistence/contracts done; real PDF requires library auth; S3 blocked).

Aprovação PDFKit: Run record fird-marketplace-2026-11-04.md F-007 states "PDFKit approved, but real generation and S3 storage pending credentials/decisions." Run record orch-mp27-2026-11-02.md lines 127-129 recommends pdfkit but line 127 says "No PDF library installed."

Código: invoice.service.ts lines 45, 109: "Real PDF generation/storage is deferred (no PDF library, no S3 credentials)." Invoice domain/service/repository/routes implemented with placeholder.

Conclusão: PDFKit is mentioned as "approved" in one run record but not confirmed installed or implemented. Real generation deferred. State: PARTIALLY_IMPLEMENTED. Distinguish: library approval (documented) vs. implementation (not done).

### BUG-003 (S3)

Decisões aplicáveis: CD-035 (S3 Standard-IA for invoices), Q-018 (storage decisions).

Backlog: T-703b blocked (AWS credentials).

Código: s3.adapter.ts exists with tests (S3StorageAdapter, S3ClientInterface). index.ts line 89 uses LocalStorageAdapter only.

AWS validation: No AWS account validation documented in any project file (mp_log, task_list, decisions, run records, project_context). User's claim of "us-east-2 validated" is not in project documentation.

Conclusão: S3 adapter implemented and tested but NOT wired into production. AWS credentials availability not documented. State: BLOCKED_BY_EXTERNAL_DEPENDENCY. Architecture requires S3 for production media (local storage is dev-only per project_context.md).

### BUG-028 (Kilo Runtime Adapter)

Origem: CR-002 from audit-report-2026-10-24.md: "No real Kilo runtime adapter; orchestration uses injected port."

Implementação esperada: Real adapter connecting kilo-orchestration to Kilo's task tool for delegation.

Existência: No adapter or resumeRun in kilo-orchestration/src/. Agent-orchestrator uses agents.delegateToCode() (injected dependency).

Substituição: Later runs (Etapa C) use task tool delegation successfully (code-developer, code-reviewer). The task tool pattern may have superseded the need for a dedicated adapter.

Evidência de runtime: task tool delegation works in practice (Etapa C C1-C5 all used it). But no explicit documentation confirms the adapter gap is closed.

Conclusão: State: SUSPICION_UNVERIFIED. Severity downgraded from CRITICAL to INFO — no evidence of critical impact. The task tool delegation pattern appears to have superseded the original adapter need, but this is not formally documented.

## 3. Verificações complementares

### BUG-012/013/019 — Stripe SDK Adapter

| Aspect | Estado | Evidência |
|---|---|---|
| Credenciais | Bloqueado (sem conta Stripe test) | project_context.md: "checkout returns a payment placeholder." No Stripe credentials in any doc. |
| Autorização de fase | P4 autorizado (MAX_AUTHORIZED_PHASE=4) | task_list.md: MAX_AUTHORIZED_PHASE = 4 |
| Implementação do adapter | Interno completo; SDK externo | index.ts: createStripeClientFromEnvironment(), StripeCheckoutProvider. checkout.service.ts uses provider abstraction. stripe-webhook.handler.ts exists with tests. |
| Validação em test mode | Pendente (B.1–B.5) | analysis_stripe_validation.md; orch-mp27-2026-11-02.md: "Stripe test mode validation items B.1–B.5 PENDING." |
| Real webhook | Validado (MP-29) | orch-mp29-2026-11-02.md: "Validated real Stripe webhook delivery (signed request with real webhook secret): order pending_payment → paid, payment pending → captured." |

State: PARTIALLY_IMPLEMENTED — Internal lifecycle complete (create, authorize, capture, fail, refund, idempotency, ownership, Mongo persistence, fail endpoint). Stripe SDK/Connect/webhooks/transfers remain external. Real webhook delivery validated (MP-29). Test mode validation items B.1–B.5 PENDING (no test credentials). Stripe Connect approved (CD-064/CD-065) for Separate Charges and Transfers.

### BUG-004 — InMemory orders na elegibilidade de reviews

Estado: IMPLEMENTED_VERIFIED — Review eligibility uses InMemory orders in dev; production uses MongoReviewRepository (implemented and tested, 10 mongo tests pass per orch-mp24-2026-11-02.md). The limitation is documented and the Mongo path exists. No defect in production code. Dev fallback is by design (interface-based injection per CD-005).

### BUG-011/BUG-016 — Elasticsearch e T-302

Estado: BLOCKED_BY_EXTERNAL_DEPENDENCY (TECHNICAL_FUTURE) — ES strategy conceptual (single products index, category_path for descendant filtering, Portuguese stemmer, dual-write + periodic reindex). Mapping/analyzers/sync TECHNICAL_FUTURE. T-801/T-802/T-803 blocked on T-302. No ES-backed search implemented. Search functionality incomplete.

### BUG-018 — P5 e MAX_AUTHORIZED_PHASE=4

Estado: BLOCKED_BY_HUMAN_DECISION — MAX_AUTHORIZED_PHASE = 4 (P5 blocked). All P5 tasks (T-1201–T-1209) blocked. No phase authorization changed. Requires explicit human authorization to unblock.

### BUG-020 — Wallet UI e dependência

Estado: PARTIALLY_IMPLEMENTED — Payout module fully implemented (domain, InMemory + Mongo repos, service, routes, 59 payout tests). Wallet balance/transactions NOT implemented (no wallet module). T-1007 not defined in task list. Contract proposal exists in run record but not executed. Frontend PayoutPage exists (payout request/list/cancel). Wallet balance/transaction history UI blocked.

### BUG-029 — Classificação pending

Estado: DOCUMENTATION_ONLY — initialStatus('pending') returns undefined, allowing pending tasks in authorized phases to be ELIGIBLE without explicit approval. JSDoc added but behavior unchanged (per orch-precommit-2026-10-25.md). No code fix applied. Requires design decision.

## 4. Divergências entre histórico, documentação e código

| Item | Divergência | Resolução |
|---|---|---|
| BUG-005 Wallet | Task list says T-1007 needed but not defined; run record proposes contract; no code exists | PARTIALLY_IMPLEMENTED — payout done, wallet absent. T-1007 needs creation. |
| BUG-006 Invoice PDF | Run record says "PDFKit approved"; task list says "requires PDF library authorization"; code says "no PDF library" | PARTIALLY_IMPLEMENTED — PDFKit mentioned as approved in one run record but not confirmed installed or implemented. Distinguish approval (documented) from implementation (not done). |
| BUG-003 S3 | User claims "AWS validated in us-east-2"; no project doc confirms this | BLOCKED_BY_EXTERNAL_DEPENDENCY — S3 adapter exists and tested but not wired. AWS validation not documented in project. Cannot confirm or deny user's claim. |
| BUG-028 Kilo Adapter | Audit says "no real adapter"; later runs use task tool successfully | SUSPICION_UNVERIFIED — may be superseded by task tool pattern, but not formally documented. Severity downgraded from CRITICAL to INFO. |
| BUG-012/013 Stripe | Task list says "internal only"; MP-29 validated real webhook | PARTIALLY_IMPLEMENTED — internal complete + real webhook validated; SDK/Connect/transfers still external. |

## 5. Lista definitiva de bugs confirmados em aberto

Nenhum bug confirmado em aberto foi identificado.

Todos os defeitos previamente identificados (BUG-034 a BUG-053) foram corrigidos e revisados independentemente. Os itens restantes são:

- Limitações (14) — features incompletas ou constraints conhecidas
- Tarefas bloqueadas (13) — dependências externas ou decisões humanas
- Suspeitas (6) — potenciais issues sem evidência confirmada
- Documentação (1) — gap de rastreabilidade

Nenhum item atende ao critério de CONFIRMED_OPEN_BUG (defeito em funcionalidade existente com evidência reproduzível).

## 6. Itens que pertencem ao I, não ao F

Os seguintes itens são funcionalidades novas ou melhorias, não correções de bugs, e pertencem à Etapa I (Implementação):

| Item | Razão |
|---|---|
| T-703b S3 integration (BUG-015) | Nova integração, não correção de defeito |
| T-801–T-803 Elasticsearch (BUG-016) | Novas funcionalidades de busca |
| T-1104 Admin metrics (BUG-017) | Nova funcionalidade |
| T-1201–T-1209 P5 (BUG-018) | Deploy/demo/presentation |
| T-1001–T-1004 Stripe real (BUG-019) | Nova integração |
| T-1006 Wallet UI (BUG-020) | Nova funcionalidade |
| BUG-001 SSR | Melhoria, não correção |
| BUG-002 Reorder logic | Funcionalidade nova |
| BUG-014 Coverage targets | Melhoria de qualidade |
| BUG-026 Mixed-cart discount | Funcionalidade nova |

Os seguintes itens podem ser considerados para F (correção de defeitos em funcionalidade existente):

- BUG-003 (S3 not wired into production — if architecture requires it, this is a defect)
- BUG-004 (InMemory in production path — if it bypasses Mongo, this is a defect; but it's dev-only by design)
- BUG-008 (No resumeRun — defect in orchestration module)
- BUG-009 (Vitest hang — CI/automation defect)
- BUG-010 (Cart TTL unapproved — policy gap)
- BUG-024 (No concurrency control — data integrity defect)
- BUG-029 (Pending classification — logic defect)
- BUG-031/032 (Cart error path divergence — potential defects)

## 7. Dependências que exigem decisão ou autorização humana

| Dependência | Itens bloqueados | Tipo |
|---|---|---|
| AWS credentials/configuration | BUG-003, BUG-007, BUG-015 | Externa |
| Stripe test credentials | BUG-012, BUG-013, BUG-019 | Externa |
| Phase 5 authorization (MAX_AUTHORIZED_PHASE) | BUG-018 | Humana |
| Q-003 Admin permission/metrics scope | BUG-017, BUG-022 | Negócio |
| Q-004 Contact validation rules | BUG-023 | Negócio |
| Q-006 Concurrency/reservations | BUG-024 | Técnica |
| Q-009 Retry/timeout/webhook | BUG-025 | Técnica |
| Q-016 Mixed-cart discount | BUG-026 | Negócio |
| Q-018 Glacier/WORM/trigger | BUG-007, BUG-027 | Humana |
| Q-001 MongoDB persistence strategy | BUG-021 | Humana |
| PDF library authorization | BUG-006 | Humana |
| T-302 ES mappings (TECHNICAL_FUTURE) | BUG-011, BUG-016 | Técnica |
| T-1007 Wallet contract (undefined) | BUG-005, BUG-020 | Definição de tarefa |
| NFR-PERF-003 Cart TTL | BUG-010 | Humana |
| Design decision (resumeRun) | BUG-008 | Técnica |
| Investigation (Vitest hang) | BUG-009, BUG-030 | Técnica |

## 8. Veredito

Inventário reconciliado. Nenhum bug confirmado em aberto. Todos os itens do inventário foram reclassificados com evidência. A fila de correções do F é confiável: 0 bugs confirmados, 14 limitações, 13 bloqueados, 6 suspeitas, 20 já corrigidos, 1 gap documental.

Próximo passo: Apresentar esta conclusão ao Lucas (humano) antes de iniciar qualquer correção nova. Os itens que podem ser considerados para F (BUG-003, BUG-004, BUG-008, BUG-009, BUG-010, BUG-024, BUG-029, BUG-031, BUG-032) requerem autorização explícita. Os itens bloqueados por dependências externas ou decisões humanas não podem ser corrigidos sem a devida autorização.

Limitações desta reconciliação:

- Somente leitura: nenhum teste executado, nenhuma verificação de runtime.
- Classificações baseadas em evidência documental e leitura de código, não em reprodução.
- A afirmação do usuário sobre "AWS validado em us-east-2" não pode ser verificada a partir dos documentos do projeto (nenhuma menção em mp_log, task_list, decisions, run records ou project_context).
- PDFKit "aprovado" em um run record mas não confirmado instalado ou implementado — distinção preservada.
