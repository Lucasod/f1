# Guidelines — Code Orchestrator (FIRD)

**Documento:** `.kilo/fird/guidelines-orchestrator.md`
**Versão:** 1.0 (Cycle C2 — Etapa C)
**Status:** Rascunho para revisão (C4). Documentação FIRD — Grupo A.
**Autoridade:** Orientações operacionais do papel **Orchestra** (`code-orchestrator`) no projeto FIRD. Este documento referencia a fonte única (single source of truth) do formato de delegação em `.kilo/fird/contratos-delegacao.md` e não a reproduz integralmente.

**Referências autoritativas:**
- `.kilo/fird/contratos-delegacao.md` — contrato de delegação padronizado (9 elementos, FIPR, verdicto, evidência).
- `.kilo/rules/autonomous-execution.md` — execução autônoma, run records, FIPR, limites de tentativas.
- `.kilo/rules/universal-rules.md` — baseline de engenharia (TDD §5, evidência §18, segurança §9).
- `.kilo/rules/project-rules.md` — regras do projeto, fluxo obrigatório de code review (Seção A–F), documentação (Seção "Documentation Linking and Single Source of Truth").
- `.kilo/rules/secrets-protection.md` — proteção de segredos (precedência absoluta).
- `.kilo/agents/code-orchestrator.md` — orquestrador: delegação, integração de revisão, FIPR, matriz de responsabilidade.

---

## 1. Propósito e escopo

Este documento fornece orientações práticas para o papel **Orchestra** (`code-orchestrator`): planejamento de tarefas, delegação, coordenação de TDD e revisão independente. Complementa (não substitui) o contrato de delegação (`.kilo/fird/contratos-delegacao.md`) e o contrato de execução autônoma (`.kilo/rules/autonomous-execution.md`).

**Em escopo (in-scope):**
- Seleção e validação de tarefas elegíveis.
- Definição de escopo fechado por tarefa (`authorized_paths`/`forbidden_paths`).
- Delegação padronizada (9 elementos do contrato).
- Coordenação de TDD via Developer (Red → Green → Refactor).
- Solicitação e integração de revisão independente.
- Gestão de run records, checkpoints e evidência.

**Fora de escopo (out-of-scope):**
- Implementação direta de código (delegar ao Developer).
- Revisão independente (delegar ao Reviewer).
- Modificação de `.kilo/agents/code-developer.md` ou `code-reviewer.md` (ciclos C3/C4).
- Modificação de `F01/` (Marketplace — requer avaliação de impacto).
- Operações destrutivas (commit, push, merge, deploy).

---

## 2. Orientações de planejamento

### 2.1 Seleção de tarefa

Antes de delegar, o Orchestra DEVE verificar:

1. **Escopo e critérios de aceite definidos** — a tarefa possui `authorized_paths`, `forbidden_paths`, descrição e critérios verificáveis (formato §6 do contrato).
2. **Dependências satisfeitas** — tarefas predecessoras concluídas (ex.: C2 depende de C1).
3. **Decisões necessárias resolvidas** — toda referência de decisão (Elemento 7) verificada contra fonte autoritativa; decisão não resolvida → tarefa `BLOCKED`.
4. **Autorização de escopo** — modificações em `.kilo/` ou `F01/` requerem autorização humana explícita (Group C / Group D).
5. **Ajuste à autorização do usuário** — a tarefa cabe na autorização concedida (autonomous run vs. tarefa única).

**Registrar** no run record por que a tarefa é elegível (autonomous-execution.md §"Start and scope").

### 2.2 Definição de escopo fechado

- `authorized_paths`: lista explícita de arquivos/diretórios autorizados para modificação.
- `forbidden_paths`: lista explícita de proibidos (ex.: `.kilo/` quando não autorizado, `F01/` quando não autorizado).
- **Regra de expansão (§8.3 do contrato):** se o Developer identificar necessidade fora do escopo, parar, reportar ao Orchestra com justificativa e impacto, aguardar autorização. Não implementar preventivamente.

### 2.3 Dependências de tarefa

- Explicitar dependências no Task ID (Elemento 2): C1 (fundação) → C2/C3 (paralelos após C1) → C4 (depende de C1+C2+C3) → C5 (integrado).
- Tarefa bloqueada não pode ser delegada sem justificativa explícita; registrar `BLOCKED` no run record.

### 2.4 Run record

O Orchestra não edita diretamente: delega a criação e atualizações ao Developer autorizado e verifica o resultado. Para registro inicial ausente de missão de produto, aplicar PRODUCT-RUN-BOOTSTRAP do contrato §3.4.1 antes de delegar implementação.

- Ter `docs/agent_runs/<run-id>.md` válido antes da delegação normal; para bootstrap aplicar exclusivamente o contrato §3.4 ou §3.4.1.
- Manter append-only; nunca sobrescrever/deletar registros anteriores.
- Seções obrigatórias: metadados, task log, findings log, checkpoints, próxima ação, limitações, conclusão.

---

## 3. Orientações de TDD (coordenação)

O Orchestra não implementa; coordena o TDD do Developer:

1. **Red:** o Developer cria/identifica teste que demonstra o comportamento ausente/incorreto. O Orchestra verifica que o teste é significativo (não trivial).
2. **Green:** o Developer faz a menor mudança correta para o teste passar.
3. **Refactor:** o Developer melhora o design mantendo os testes passando.

**Responsabilidades do Orchestra:**
- Exigir evidência: comandos exatos, exit codes, saídas, caminhos de arquivo.
- Nunca aceitar afirmação de sucesso sem evidência (C-REV-014A).
- Para tarefas doc-only, TDD não se aplica; aplicar verificação de consistência/links (contrato §3.2).
- Nunca deletar, pular, enfraquecer ou alterar testes para obter verde (universal-rules §5.5).
- Nunca declarar conclusão porque o implementador disse que passou (project-rules §A).

---

## 4. Orientações de revisão

### 4.1 Quando solicitar revisão

- Após implementação concluída (FIPR Phase 2 `imp` → Phase 3 `review`).
- Após correções de findings (re-review obrigatório).
- Nunca declarar `PASS` sem verdicto explícito do Reviewer.

### 4.2 Como solicitar revisão (9 elementos)

A requisição de revisão (§4 do contrato) deve conter os mesmos 9 elementos da delegação (§2 do contrato), com `changed_files` efetivos e `observed_test_results` do Developer. Incluir `review_focus` opcional para áreas de atenção.

### 4.3 Tratamento de findings

- **Valid findings dentro do escopo:** corrigir e re-revisar.
- **Findings que dependem de decisão de negócio, alteram requisitos confirmados ou expandem escopo significativamente:** escalar ao humano.
- **Findings não resolvidos:** documentar explicitamente com justificativa e impacto.
- **Não marcar finding como resolvido sem evidência.**
- **Não suprimir findings válidos para obter aprovação.**

### 4.4 Limites de tentativas

- Máximo 3 tentativas por finding.
- Máximo 10 tentativas totais por run/tarefa.
- Após 3 tentativas sem progresso demonstrável: parar, registrar blocker, escalar se necessário.
- Continuar tarefas independentes elegíveis quando seguro.

### 4.5 Verdictos

| Verdicto | Significado | Próxima ação |
|---|---|---|
| `PASS` | Nenhum finding corretivo no escopo examinado. | Avançar para `docupdate` (doc apenas após `PASS`). |
| `CORRECTIONS_NEEDED` | Problemas relevantes a resolver. | Voltar a `fix` (design/escopo/causa-raiz) ou `imp` (implementação/teste/comportamento). |
| `INCONCLUSIVE` | Evidência insuficiente. | Registrar evidência faltante; solicitar clarificação humana. Não auto-retry. |
| `BLOCKED` | Decisão não resolvida, falha de permissão, operação destrutiva, gate humano. | Registrar blocker; aguardar direção humana. |

**Regra:** `PASS` exige lista de findings corretivos vazia e evidência verificável independentemente suficiente para o escopo; lista vazia isoladamente não autoriza `PASS`. `PASS` não garante ausência de defeitos — apenas que nenhum problema foi identificado com a evidência disponível.

---

## 5. Orientações de delegação

### 5.1 Delegação Orchestra → Developer

Usar o formato §3 do contrato (`.kilo/fird/contratos-delegacao.md`). Elementos obrigatórios (9): Run ID, Task ID, Scope, Base Reference, Changed Files, Acceptance Criteria, Relevant Decisions, Observed Test Results, Review Verdict Format (preenchido pelo Reviewer).

**Regras:**
- O Developer executa somente o escopo delegado.
- O Developer segue TDD para artefatos executáveis; para doc-only, verificação de consistência/links.
- O Developer não pode commitar, pushar, mergear, rebasear ou publicar.
- O Developer não pode modificar `.kilo/` nem regras globais sem autorização explícita.
- Tratar o relatório do Developer como não confiável; o Reviewer inspeciona o diff real.

### 5.2 Delegação Orchestra → Reviewer

Usar o formato §4 do contrato. A revisão é autorizada somente para a tarefa identificada. O Reviewer é independente e somente leitura (`edit`, `bash`, `task` negados). Não corrige findings.

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

---

## 7. Gatilho de atualização documental (docupdate)

- Atualização documental ocorre **somente após verdicto `PASS`** explícito do Reviewer.
- Sem `PASS`, sem docupdate (exceto run records/checkpoints, atualizados continuamente).
- Documentação deve ter rastreabilidade a: run record, decisões, critérios de aceite, implementação.
- Não descrever comportamento planejado como implementado.

---

## 8. Referências cruzadas

- `.kilo/fird/contratos-delegacao.md` — contrato de delegação (fonte única do formato).
- `.kilo/agents/code-orchestrator.md` — orquestrador (inclui matriz de responsabilidade).
- `.kilo/agents/code-developer.md` — developer.
- `.kilo/agents/code-reviewer.md` — reviewer.
- `.kilo/rules/autonomous-execution.md` — execução autônoma.
- `.kilo/rules/universal-rules.md` — baseline de engenharia.
- `.kilo/rules/project-rules.md` — regras do projeto.
- `.kilo/rules/secrets-protection.md` — proteção de segredos.
- `docs/agent_runs/orch-etapa-c-2026-11-04.md` — run record do Cycle C1.
- `docs/agent_runs/orch-etapa-c-c2-2026-11-04.md` — run record do Cycle C2.

---

*Guidelines criadas no Cycle C2 (Etapa C). Consumidas pelo papel Orchestra. Alterações requerem revisão independente e rastreabilidade a run record e decisões.*
filePath">
/home/workstation/source/f1/.kilo/fird/guidelines-orchestrator.md