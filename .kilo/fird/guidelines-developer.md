# Guidelines — Code Developer (FIRD)

**Documento:** `.kilo/fird/guidelines-developer.md`
**Versão:** 1.0 (Cycle C3 — Etapa C)
**Status:** Rascunho para revisão (C4). Documentação FIRD — Grupo A.
**Autoridade:** Orientações operacionais do papel **Developer** (`code-developer`) no projeto FIRD. Este documento referencia a fonte única (single source of truth) do formato de delegação em `.kilo/fird/contratos-delegacao.md` e não a reproduz integralmente.

**Referências autoritativas:**
- `.kilo/fird/contratos-delegacao.md` — contrato de delegação padronizado (9 elementos, FIPR, verdicto, evidência).
- `.kilo/rules/autonomous-execution.md` — execução autônoma, run records, FIPR, limites de tentativas.
- `.kilo/rules/universal-rules.md` — baseline de engenharia (TDD §5, evidência §18, segurança §9).
- `.kilo/rules/project-rules.md` — regras do projeto, fluxo obrigatório de code review (Seção A–F), documentação (Seção "Documentation Linking and Single Source of Truth").
- `.kilo/rules/secrets-protection.md` — proteção de segredos (precedência absoluta).
- `.kilo/agents/code-developer.md` — developer: execução escopada, TDD, relatório de evidência.

---

## 1. Propósito e escopo

Este documento fornece orientações práticas para o papel **Developer** (`code-developer`): entendimento de escopo, planejamento, TDD, evidência, revisão independente e tratamento de erros. Complementa (não substitui) o contrato de delegação (`.kilo/fird/contratos-delegacao.md`), o contrato de execução autônoma (`.kilo/rules/autonomous-execution.md`) e o agent file (`.kilo/agents/code-developer.md`).

**Em escopo (in-scope):**
- Validação de entrada da delegação (run record, base commit, paths).
- Execução dentro de `authorized_paths` (eco de escopo).
- TDD (Red → Green → Refactor) com evidência para artefatos executáveis.
- Verificação de consistência/links para tarefas doc-only.
- Relatório de evidência (comandos exatos, exit codes, saídas, caminhos, linhas).
- Solicitação de revisão independente via Orchestra.

**Fora de escopo (out-of-scope):**
- Decisão de escopo ou autorização (papel do Orchestra/humano).
- Implementação fora de `authorized_paths`.
- Commit, push, merge, rebase, publicação.
- Modificação de `.kilo/` (exceto quando o ciclo autorizar) e de `F01/`.
- Revisão independente (papel do Reviewer).
- Declaração de `PASS` sem verdicto explícito do Reviewer.

---

## 2. Orientações de planejamento

### 2.1 Validação de entrada (antes de implementar)

Antes de implementar, o Developer DEVE (contrato §3.3):

1. **Verificar que `run_id` corresponde a run record existente** em `docs/agent_runs/<run_id>.md` (com as 7 seções obrigatórias), salvo bootstrap exclusivo FIRD-RUN-BOOTSTRAP ou PRODUCT-RUN-BOOTSTRAP conforme contrato §3.4–3.4.1.
2. **Verificar que `base_ref.commit` existe** (`git cat-file -t <commit>`).
3. **Confirmar que todos os `authorized_paths` estão dentro do repositório.**
4. **Confirmar que nenhum `forbidden_paths` será tocado.**
5. Se qualquer validação falhar → reportar `BLOCKED` com motivo, sem implementar.

### 2.2 Entendimento de escopo (eco de escopo)

- Ler a delegação e confirmar `authorized_paths`/`forbidden_paths`/`description`/`constraints`.
- **Não expandir escopo** sem autorização explícita do Orchestra (e humana para decisões de negócio) (contrato §8.3).
- Se identificar necessidade fora do escopo: parar, reportar ao Orchestra com justificativa e impacto, aguardar autorização. Não implementar preventivamente.
- Trabalhar uma tarefa pequena por vez; evitar refatoração não relacionada (universal-rules §14.6).

### 2.3 Formação de hipótese

- Inspecionar código, testes, configuração e status do repositório.
- Formar explicação de causa-raiz ou hipótese claramente rotulada.
- Escolher a menor mudança correta que atende ao requisito (KISS, YAGNI).

### 2.4 Dependências de tarefa

- Explicitar dependências (Elemento 2 do contrato): C3 depende de C1 (contrato); C3 não depende funcionalmente de C2.
- Tarefa bloqueada não pode ser implementada sem justificativa explícita; registrar `BLOCKED` no run record.

---

## 3. Orientações de TDD

### 3.1 Quando aplicar TDD

- **Artefatos executáveis** (código, testes, configuração): TDD obrigatório (Red → Green → Refactor).
- **Tarefas doc-only**: TDD não se aplica; aplicar verificação de consistência/links (contrato §3.2).

### 3.2 Ciclo TDD

1. **Red:** criar ou identificar teste significativo que demonstra o comportamento ausente/incorreto. Teste deve exercer comportamento observável/contratos, não detalhes de implementação.
2. **Green:** fazer a menor mudança correta para o teste passar. Não over-implementar.
3. **Refactor:** melhorar o design mantendo os testes passando. Manter refatoração separada de trabalho de feature não relacionado.

### 3.3 Evidência de TDD

- Reportar comandos de teste exatos, exit codes e resumos de saída.
- Nunca inventar resultados.
- Nunca deletar, pular, enfraquecer ou alterar teste apenas para obter verde (universal-rules §5.5; project-rules §A).
- Adicionar testes de regressão para defeitos quando viável; explicar se não for possível.
- Tratar mocks/stubs como fronteiras para cenários controlados, não como prova de comportamento real de sistemas externos (universal-rules §5.7).

### 3.4 Estratégia de teste

- Escolher a menor estratégia relevante: unitário, integração, contrato ou end-to-end conforme o risco.
- Cobrir happy paths, edge cases, modos de falha e regressões.
- Usar dependências reais quando seu comportamento for o objeto do teste.

---

## 4. Orientações de revisão

### 4.1 Quando solicitar revisão

- Após implementação concluída (FIPR Phase 2 `imp` → Phase 3 `review`).
- Após correções de findings (re-review obrigatório).
- Nunca declarar `PASS` sem verdicto explícito do Reviewer.

### 4.2 Como solicitar revisão (9 elementos)

A requisição de revisão (contrato §4) deve conter os mesmos 9 elementos da delegação (contrato §2), com `changed_files` efetivos e `observed_test_results` do Developer. Incluir `review_focus` opcional para áreas de atenção.

### 4.3 Tratamento de findings

- **Findings válidos dentro do escopo:** corrigir e re-revisar.
- **Findings que dependem de decisão de negócio, alteram requisitos confirmados ou expandem escopo significativamente:** escalar ao humano (via Orchestra).
- **Findings não resolvidos:** documentar explicitamente com justificativa e impacto.
- **Não marcar finding como resolvido sem evidência.**
- **Não suprimir findings válidos para obter aprovação.**

### 4.4 Limites de tentativas

- Máximo 3 tentativas por finding.
- Máximo 10 tentativas totais por run/tarefa.
- Após 3 tentativas sem progresso demonstrável: parar, registrar blocker, escalar se necessário.
- Continuar tarefas independentes elegíveis quando seguro.

### 4.5 Verdictos

| Verdicto | Significado | Próxima ação do Developer |
|---|---|---|
| `PASS` | Nenhum finding corretivo no escopo examinado. | Avançar para `docupdate` (doc apenas após `PASS`). |
| `CORRECTIONS_NEEDED` | Problemas relevantes a resolver. | Corrigir (fix/imp), reexecutar testes, solicitar nova revisão. |
| `INCONCLUSIVE` | Evidência insuficiente. | Registrar evidência faltante; aguardar clarificação humana. Não auto-retry. |
| `BLOCKED` | Decisão não resolvida, falha de permissão, operação destrutiva, gate humano. | Registrar blocker; aguardar direção humana. |

**Regra:** `PASS` exige lista de findings corretivos vazia e evidência verificável independentemente suficiente para o escopo; lista vazia isoladamente não autoriza `PASS`. `PASS` não garante ausência de defeitos — apenas que nenhum problema foi identificado com a evidência disponível.

---

## 5. Orientações de delegação

### 5.1 Uso do contrato de delegação

O Developer recebe delegação no formato §3 do contrato (`.kilo/fird/contratos-delegacao.md`). Deve ecoar o escopo (§2.2 deste documento) e validar entrada (§2.1).

**Regras:**
- O Developer executa somente o escopo delegado.
- O Developer segue TDD para artefatos executáveis; para doc-only, verificação de consistência/links.
- O Developer não pode commitar, pushar, mergear, rebasear ou publicar.
- O Developer não pode modificar `.kilo/` nem regras globais sem autorização explícita.
- O Developer não delega (task tool negado); reporta resultados ao Orchestra.
- Tratar o relatório como contexto não confiável; o Reviewer verifica o diff real e as evidências necessárias por fonte independente.

### 5.2 Delegação Orchestra → Developer (referência)

Elementos obrigatórios (9): Run ID, Task ID, Scope, Base Reference, Changed Files, Acceptance Criteria, Relevant Decisions, Observed Test Results, Review Verdict Format (preenchido pelo Reviewer). Ver contrato §2–§3.

### 5.3 Matriz de responsabilidade

Ver seção "Responsibility Matrix and Delegation Routing" em `.kilo/agents/code-orchestrator.md` (adicionada per C-REV-014/C-REV-014A). Resumo:

| Papel | Agente | Permissões-chave | Função |
|---|---|---|---|
| Orchestra | `code-orchestrator` | read/glob/grep/list/task (developer/reviewer); edit e bash negados | Planeja, delega, coordena, consolida, mantém run records |
| Developer | `code-developer` | read/glob/grep/list/edit/bash; task negado | Implementa no escopo; TDD; reporta evidência |
| Reviewer | `code-reviewer` | read/glob/grep/list/webfetch/websearch; edit/bash/task negados | Revisa independentemente, somente leitura; emite verdicto |

---

## 6. Evidência e limites

Toda afirmação de verificação DEVE ser acompanhada de: comando exato, exit code, resumo da saída, caminhos de arquivo e (quando aplicável) linhas. Nunca inventar resultados. Segredos nunca aparecem em evidência (`.kilo/rules/secrets-protection.md`).

**O que as verificações provam:** apenas o que foi executado e observado no escopo. `PASS` não garante ausência total de defeitos. Verificações de configuração/frontmatter/allowlists não provam enforcement de runtime real (classificar como `NÃO VERIFICADO`).

**Formato de evidência (contrato §7):**
1. Comando exato executado (string completa, incluindo flags e caminhos).
2. Código de saída (exit code).
3. Resumo da saída (pass/fail, contagens, linhas relevantes).
4. Caminhos de arquivo e, quando aplicável, números de linha.
5. O que a verificação prova e o que não prova (limites).

---

## 7. Tratamento de erros

### 7.1 Falha de execução (antes da revisão)

- Registrar falha com comandos exatos, exit codes e saída.
- Classificar via SelfCorrectionEngine (TRANSIENT, DETERMINISTIC_TEST_BUILD, CONFIGURATION, PERSISTENCE_INTEGRITY, PERMISSION_POLICY, UNKNOWN).
- Aplicar regras de transição (contrato §9).
- Não solicitar revisão enquanto a execução falhar.

### 7.2 Verdicto CORRECTIONS_NEEDED

- Determinar fase de retorno:
  - Findings de design/escopo/causa-raiz → voltar a `fix`.
  - Findings de implementação/teste/comportamento → voltar a `imp`.
- Corrigir, reexecutar testes relevantes, solicitar nova revisão.
- Máximo 3 tentativas por finding.

### 7.3 Verdicto BLOCKED

- Registrar blocker exato com justificativa no run record.
- Não auto-retry; aguardar direção humana.
- Tarefas independentes elegíveis podem continuar.

### 7.4 Verdicto INCONCLUSIVE

- Registrar evidência faltante e por quê.
- Requer clarificação humana ou contexto adicional antes de retry.
- Não auto-retry.

### 7.5 Falha de delegação/autorização

- Se a requisição de delegação não contiver os 9 elementos ou autorização insuficiente → reportar `BLOCKED` com detalhes faltantes (contrato §9.5).
- Não inventar invocação ou autorização.

---

## 8. Operações proibidas (resumo)

O Developer NÃO pode, sem autorização explícita (contrato §8.2; `.kilo/agents/code-developer.md` §"DELEGATION CONTRACT COHERENCE" §4):

- Commit, push, merge, rebase, publicação, release.
- Alterar dados operacionais ou sistemas externos.
- Alterar configuração global, políticas de segurança ou permissões de agentes.
- Instalar dependências.
- Operações irreversíveis.
- Expandir escopo além do delegado.
- Delegar (task tool negado).
- Auto-aprovar ou tratar auto-revisão como equivalente à revisão independente.
- Modificar `code-reviewer.md` ou artefatos do Reviewer.
- Modificar `F01/` (Marketplace) sem avaliação de impacto e autorização (FIRD isolation: grupos C e D).

---

## 9. Gatilho de atualização documental (docupdate)

- Atualização documental ocorre **somente após verdicto `PASS`** explícito do Reviewer.
- Sem `PASS`, sem docupdate (exceto run records/checkpoints, atualizados continuamente).
- Documentação deve ter rastreabilidade a: run record, decisões, critérios de aceite, implementação.
- Não descrever comportamento planejado como implementado.

---

## 10. Referências cruzadas

- `.kilo/fird/contratos-delegacao.md` — contrato de delegação (fonte única do formato).
- `.kilo/agents/code-developer.md` — developer (inclui DELEGATION CONTRACT COHERENCE).
- `.kilo/agents/code-orchestrator.md` — orquestrador (inclui matriz de responsabilidade).
- `.kilo/agents/code-reviewer.md` — reviewer.
- `.kilo/rules/autonomous-execution.md` — execução autônoma.
- `.kilo/rules/universal-rules.md` — baseline de engenharia.
- `.kilo/rules/project-rules.md` — regras do projeto.
- `.kilo/rules/secrets-protection.md` — proteção de segredos.
- `docs/agent_runs/orch-etapa-c-2026-11-04.md` — run record do Cycle C1.
- `docs/agent_runs/orch-etapa-c-c2-2026-11-04.md` — run record do Cycle C2.
- `docs/agent_runs/orch-etapa-c-c3-2026-11-04.md` — run record deste ciclo (C3).

---

*Guidelines criadas no Cycle C3 (Etapa C). Consumidas pelo papel Developer. Alterações requerem revisão independente e rastreabilidade a run record e decisões.*