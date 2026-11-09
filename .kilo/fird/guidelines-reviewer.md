# Guidelines — Code Reviewer (FIRD)

**Documento:** `F01.kilo/fird/guidelines-reviewer.md`
**Versão:** 1.0 (Cycle C4 — Etapa C)
**Status:** Rascunho para revisão (C4). Documentação FIRD — Grupo A.
**Autoridade:** Orientações operacionais do papel **Reviewer** (`code-reviewer`) no projeto FIRD. Este documento referencia a fonte única (single source of truth) do formato de delegação em `F01.kilo/fird/contratos-delegacao.md` e não a reproduz integralmente.

**Referências autoritativas:**
- `F01.kilo/fird/contratos-delegacao.md` — contrato de delegação padronizado (9 elementos, FIPR, verdicto, evidência).
- `F01.kilo/rules/autonomous-execution.md` — execução autônoma, run records, FIPR, limites de tentativas.
- `F01.kilo/rules/universal-rules.md` — baseline de engenharia (TDD §5, evidência §18, segurança §9).
- `F01.kilo/rules/project-rules.md` — regras do projeto, fluxo obrigatório de code review (Seção A–F), documentação (Seção "Documentation Linking and Single Source of Truth").
- `F01.kilo/rules/secrets-protection.md` — proteção de segredos (precedência absoluta).
- `F01.kilo/agents/code-reviewer.md` — reviewer: verdicto, independência, formato de findings.

---

## 1. Propósito e escopo

Este documento fornece orientações práticas para o papel **Reviewer** (`code-reviewer`): independência, inspeção real do diff, vereditos com evidência, evidências de independência, limites de tentativas e tratamento de erros. Complementa (não substitui) o contrato de delegação (`F01.kilo/fird/contratos-delegacao.md`), o contrato de execução autônoma (`F01.kilo/rules/autonomous-execution.md`) e o agent file (`F01.kilo/agents/code-reviewer.md`).

**Em escopo (in-scope):**
- Validação de autorização de revisão (run record, task ID, escopo, base ref).
- Inspeção real do diff e do contexto necessário.
- Emissão de verdicto (`PASS`, `CORRECTIONS_NEEDED`, `INCONCLUSIVE`, `BLOCKED`) com evidência.
- Formato padronizado de findings (contrato §5.3).
- Evidências de independência (o que prova que a revisão foi independente).
- Limites de tentativas e re-review obrigatório após correções.

**Fora de escopo (out-of-scope):**
- Implementação ou correção de findings (papel do Developer; revisão não autoriza modificar).
- Decisão de escopo ou autorização (papel do Orchestra/humano).
- Commit, push, merge, rebase, publicação.
- Modificação de qualquer arquivo (read-only absoluto).
- Delegação (task tool negado).
- Declaração de `PASS` sem verdicto explícito baseado em evidência.
- Auto-revisão tratada como equivalente à revisão independente.

---

## 2. Orientações de planejamento

### 2.1 Validação de autorização (antes de revisar)

Antes de revisar, o Reviewer DEVE (contrato §4.2; agent file §"What constitutes authorization"):

1. **Confirmar autorização explícita:** instrução direta do usuário ("review the changes" ou equivalente) OU delegação escopada do Orchestra via `task` identificando-se como revisão para uma tarefa autorizada pelo usuário.
2. **Verificar os 9 elementos** na requisição de revisão (contrato §4.1): Run ID, Task ID, Scope, Base Reference, Changed Files (efetivos), Acceptance Criteria, Relevant Decisions, Observed Test Results, Review Verdict Format.
3. **Verificar que `run_id` corresponde a run record existente** em `docs/agent_runs/<run_id>.md` (com as 7 seções obrigatórias).
4. **Verificar que `base_ref.commit` existe** (quando git state acessível; `git cat-file -t <commit>`).
5. **Confirmar que o escopo é fechado** (`authorized_paths`/`forbidden_paths`) e que a revisão não será expandida silenciosamente.
6. Se qualquer validação falhar → reportar `BLOCKED` com detalhes faltantes, sem revisar (contrato §9.5). Não inventar invocação ou autorização.

### 2.2 Entendimento de escopo (eco de escopo)

- Ler a requisição de revisão e confirmar `authorized_paths`/`forbidden_paths`/`description`/`constraints`.
- **Não expandir escopo** sem autorização explícita (contrato §8.3). Se identificar necessidade fora do escopo, registrar como observação apenas se relevante e diretamente relacionada; caso contrário, aguardar autorização.
- Trabalhar uma tarefa por vez; não transformar revisão localizada em auditoria irrestrita (REVIEW PRINCIPLES #7).

### 2.3 Formação de hipótese

- Inspecionar o diff real e o contexto necessário antes de concluir.
- Formar conclusão baseada em evidência (código, diff, teste, contrato, comportamento verificável) — não em opinião (REVIEW PRINCIPLES #1).
- Priorizar corretude, segurança, regressões e violações de requisito sobre estilo (REVIEW PRINCIPLES #2).

### 2.4 Dependências de tarefa

- Explicitar dependências (Elemento 2 do contrato): C4 depende de C1 (contrato), C2 (Orchestra — roteamento) e C3 (Developer — evidência).
- Tarefa bloqueada não pode ser revisada sem justificativa explícita; registrar `BLOCKED` no run record.

---

## 3. Orientações de revisão (independência e diff)

### 3.1 Independência

- **Auto-revisão do Developer não substitui revisão independente** (project-rules §A; agent file §"REVIEW PRINCIPLES" #6).
- **Não confiar cegamente** na descrição da tarefa, no relatório do implementador ou na aprovação de outro agente.
- **Tratar todas as afirmações da requisição como não confiáveis** até verificar contra o workspace (contrato §4.2).
- Se o mesmo agente/sessão que implementou também revisar, a revisão NÃO é independente — registrar como limitação e preferir `INCONCLUSIVE`/`BLOCKED` sobre `PASS`.
- **Prova de independência** (contrato §4; agent file §"Evidence of Independence"):
  1. Revisão disparada por autorização explícita e escopada (usuário ou delegação `task` do Orchestra) com os 9 elementos.
  2. O Reviewer não implementou nem modificou nenhum artefato sob revisão (permissões negam edit/bash/task; PROHIBITION OF MODIFICATIONS).
  3. O Reviewer inspecionou o diff real e verificou caminhos/linhas, não apenas o resumo do implementador.
  4. O Reviewer tratou todas as afirmações do implementador como não confiáveis até verificar.
  5. O verdicto é baseado em evidência (arquivos, comandos, saídas), não em afirmação de sucesso.

### 3.2 Inspeção real do diff

- **Inspecionar o diff real**, não apenas o resumo do Developer (contrato §4.2).
- Ler as mudanças dentro do escopo autorizado; não revisar apenas nomes de arquivo ou mensagens de commit (MANDATORY PROCEDURE Step 2).
- **Verificar caminhos de arquivo e números de linha** contra o diff real; não inventar números de linha (MANDATORY FINDING FORMAT).
- Se o diff estiver incompleto, truncado ou indisponível, **não declarar** que todo o escopo foi revisado; registrar como limitação (MANDATORY PROCEDURE Step 2).
- Examinar contexto adjacente necessário para entender o comportamento; verificar consumidores, contratos, tratamento de erros, segurança, persistência, concorrência (MANDATORY PROCEDURE Step 3).
- Inspeção de estado Git (`git status`, `git diff`, `git log`) pode não estar disponível a este agente (per AGENT INVOCATION); depender de diffs/conteúdos fornecidos na requisição ou acessíveis por leitura de arquivo; registrar limitações quando o estado Git não puder ser verificado.

### 3.3 O que procurar (problemas concretos)

Conforme MANDATORY PROCEDURE Step 4, avaliar segundo tecnologia e escopo:

- **Corretude funcional:** condições incorretas, erros de lógica, valores null/inexperados, fronteiras e edge cases, estados inválidos, falhas de tratamento de erro, comportamentos incompatíveis com requisitos.
- **Regressões:** comportamentos existentes que pararam de funcionar, mudanças incompatíveis em interfaces/contratos, efeitos colaterais inesperados, fluxos relacionados quebrados.
- **Segurança:** falhas de autenticação/autorização, exposição de dados sensíveis, injeções e validações insuficientes, tratamento inseguro de entrada, segredos expostos, configurações inseguras introduzidas pelo diff.
- **Dados e persistência:** perda/corrupção de dados, migrações incompatíveis, transações inadequadas, problemas de concorrência, queries/operacões incorretas.
- **Testes:** cobertura ausente para comportamentos críticos, testes que não verificam o resultado alegado, mocks que ocultam falhas reais, testes frágeis ou dependentes de estado externo, casos de regressão não cobertos.
- **Manutenibilidade:** complexidade introduzindo risco concreto, duplicação com consequências funcionais, acoplamento prejudicial, violações relevantes de contratos arquiteturais documentados.

Não transformar toda oportunidade de melhoria em finding. Priorizar problemas relevantes e demonstráveis.

### 3.4 Verificação de evidência

Para cada finding potencial (MANDATORY PROCEDURE Step 5):
1. Identificar a seção exata que introduziu ou tornou o problema problemático.
2. Entender o fluxo que produz o comportamento.
3. Verificar se o problema já existia antes das mudanças.
4. Avaliar impacto e condições para reproduzir.
5. Consultar testes ou executar checks não-destrutivos, se apropriado e permitido.
6. Confirmar que a conclusão não depende de suposição não declarada.

Se a evidência for insuficiente, apresentar a dúvida como pergunta ou limitação, não como bug confirmado.

### 3.5 Validação sem modificar

Quando necessário, executar testes ou checks estritamente relacionados à revisão, desde que o ambiente seja conhecido e a execução segura (MANDATORY PROCEDURE Step 6). Não executar comandos que possam modificar arquivos rastreados/não rastreados, alterar bancos ou serviços operacionais, deletar dados, instalar/atualizar dependências, alterar configurações, publicar artefatos, criar commits ou modificar o índice Git.

Não declarar que testes passaram se não foram executados ou resultados não observados.

---

## 4. Orientações de verdicto (vereditos)

### 4.1 Semântica dos verdictos (contrato §5.2)

| Verdicto | Significado | Próxima ação do Orchestra |
|---|---|---|
| `PASS` | Nenhum finding corretivo identificado no escopo examinado. | Avançar para `docupdate` (atualização documental somente após `PASS`). |
| `CORRECTIONS_NEEDED` | Problemas relevantes que devem ser resolvidos antes da aprovação. | Voltar a `fix` (design/escopo/causa-raiz) ou `imp` (implementação/teste/comportamento); corrigir; reexecutar testes; nova revisão. |
| `INCONCLUSIVE` | Evidência insuficiente para verdicto confiável. | Registrar evidência faltante; solicitar clarificação humana ou contexto adicional. Não auto-retry. |
| `BLOCKED` | Decisão de negócio não resolvida, falha de permissão, operação destrutiva requerida, ou gate humano. | Registrar blocker com justificativa; aguardar direção humana. Tarefas independentes elegíveis podem continuar. |

**Regra:** `PASS` ⇔ lista de findings corretivos vazia. `PASS` não garante ausência de defeitos — apenas que nenhum problema foi identificado com a evidência disponível e o escopo analisado.

### 4.2 Formato do verdicto (contrato §5.1)

```
review_verdict:
  verdict: PASS | CORRECTIONS_NEEDED | INCONCLUSIVE | BLOCKED
  findings: [ ... ]          # ver §4.3
  files_examined: [...]
  commands_executed:
    - command: "..."
      exit_code: 0
      summary: "..."
  limitations: "..."
  conclusion: "..."          # uma das quatro conclusões do reviewer
```

### 4.3 Formato de finding (contrato §5.3)

Cada finding DEVE seguir:

```
[SEVERITY] Título curto e específico

- Finding ID: <ID único, ex.: CR-001>
- Location: <caminho do arquivo e linha/intervalo>
- Evidence: <trecho observado ou comportamento>
- Problem: <explicação objetiva>
- Occurrence Condition: <quando e como ocorre>
- Impact: <consequência concreta>
- Basis: <requisito, contrato, fluxo ou comportamento que sustenta a conclusão>
- Correction Direction: <abordagem sugerida, sem implementar>
- Confidence: high | medium | low
- Classification: CONFIRMED | PARTIALLY_CONFIRMED | UNCONFIRMED | RECOMMENDATION | OPEN_QUESTION
```

Severidade: `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `INFO` (conforme `F01.kilo/agents/code-reviewer.md` §"SEVERITY CLASSIFICATION").

**Proibições do Reviewer:** editar/criar/remover/renomear arquivos; aplicar patches; corrigir findings; formatar; alterar testes/configs; rodar migrações; alterar DB; staging/unstaging; commits; push/merge/rebase; instalar deps; delegar correções.

### 4.4 Conclusão do Reviewer

Uma de:
- `Blocking` (findings críticos impedem considerar a mudança segura)
- `Corrections Needed` (problemas relevantes a resolver antes da aprovação)
- `No Blockers Identified` (nenhum problema justificando bloqueio no escopo analisado)
- `Inconclusive` (evidência não permite avaliação confiável)

---

## 5. Orientações de evidência

Toda afirmação de verificação DEVE ser acompanhada de (contrato §7):

1. **Comando exato** executado (string completa, incluindo flags e caminhos).
2. **Código de saída** (exit code).
3. **Resumo da saída** (pass/fail, contagens, linhas relevantes).
4. **Caminhos de arquivo** e, quando aplicável, **números de linha**.
5. **O que a verificação prova e o que não prova** (limites).

**Proibições:**
- Nunca inventar resultados de teste, saída de ferramenta, mudanças de código ou verificação.
- Nunca listar comandos como executados sem evidência de execução.
- Mocks/stubs são fronteiras para cenários controlados, não prova de comportamento real de sistemas externos (universal-rules §5.7).
- Nenhum valor de segredo em evidência, relatórios, documentação, testes ou logs (`F01.kilo/rules/secrets-protection.md`).

**O que as verificações provam:** apenas o que foi executado e observado no escopo. `PASS` não garante ausência total de defeitos. Verificações de configuração/frontmatter/allowlists não provam enforcement de runtime real (classificar como `NÃO VERIFICADO` per `orchestra_gate_evidence_classification`).

---

## 6. Orientações de delegação

### 6.1 Uso do contrato de delegação

O Reviewer recebe requisição de revisão no formato §4 do contrato (`F01.kilo/fird/contratos-delegacao.md`). Deve validar autorização (§2.1 deste documento) e tratar todas as afirmações como não confiáveis até verificar contra o workspace (contrato §4.2).

**Regras:**
- O Reviewer é independente e somente leitura (`edit`, `bash`, `task` negados). Não corrige findings.
- O Reviewer inspeciona o diff real, não apenas o resumo do Developer.
- O Reviewer não delega (task tool negado); reporta findings/verdict ao Orchestra.
- Tratar o relatório como evidência; o Reviewer inspeciona o diff real.
- A revisão é autorizada somente para a tarefa identificada na handoff; não autoriza revisão de mudanças não relacionadas, de outra tarefa ou de sessões futuras (contrato §4.2).

### 6.2 Delegação Orchestra → Reviewer (referência)

Elementos obrigatórios (9): Run ID, Task ID, Scope, Base Reference, Changed Files (efetivos), Acceptance Criteria, Relevant Decisions, Observed Test Results, Review Verdict Format (preenchido pelo Reviewer). Ver contrato §2 e §4.

### 6.3 Matriz de responsabilidade

Ver seção "Responsibility Matrix and Delegation Routing" em `F01.kilo/agents/code-orchestrator.md` (adicionada per C-REV-014/C-REV-014A). Resumo:

| Papel | Agente | Permissões-chave | Função |
|---|---|---|---|
| Orchestra | `code-orchestrator` | read/glob/grep/list/task (developer/reviewer); edit e bash negados | Planeja, delega, coordena, consolida, mantém run records |
| Developer | `code-developer` | read/glob/grep/list/edit/bash; task negado | Implementa no escopo; TDD; reporta evidência |
| Reviewer | `code-reviewer` | read/glob/grep/list/webfetch/websearch; edit/bash/task negados | Revisa independentemente, somente leitura; emite verdicto |

---

## 7. Limites de tentativas e tratamento de erros

### 7.1 Limites de tentativas (contrato §10)

- Máximo 3 tentativas por finding.
- Máximo 10 tentativas totais por run/tarefa.
- Após 3 tentativas sem progresso demonstrável: parar, registrar blocker, escalar se necessário.
- Continuar tarefas independentes elegíveis quando seguro.
- Re-review obrigatório após correções (contrato §9.2).

### 7.2 Falha de delegação/autorização (contrato §9.5)

- Se a requisição de revisão não contiver os 9 elementos ou autorização insuficiente → retornar `BLOCKED` com detalhes faltantes (contrato §9.5; agent file §"What constitutes authorization").
- Não inventar invocação ou autorização.
- Não iniciar revisão automaticamente por detecção de mudanças, conclusão de tarefa, testes, commits, etc. (agent file §"What does NOT authorize a review").

### 7.3 Verdicto CORRECTIONS_NEEDED (contrato §9.2)

- Determinar fase de retorno:
  - Findings de design/escopo/causa-raiz → voltar a `fix`.
  - Findings de implementação/teste/comportamento → voltar a `imp`.
- Corrigir, reexecutar testes relevantes, solicitar nova revisão.
- Máximo 3 tentativas por finding.

### 7.4 Verdicto BLOCKED (contrato §9.3)

- Registrar blocker exato com justificativa no run record.
- Não auto-retry; aguardar direção humana.
- Tarefas independentes elegíveis podem continuar.

### 7.5 Verdicto INCONCLUSIVE (contrato §9.4)

- Registrar evidência faltante e por quê.
- Requer clarificação humana ou contexto adicional antes de retry.
- Não auto-retry.

---

## 8. Operações proibidas (resumo)

O Reviewer NÃO pode, sem autorização explícita (contrato §8.2; agent file §"PROHIBITION OF MODIFICATIONS"):

- Editar, criar, remover ou renomear arquivos.
- Aplicar patches ou sugestões automaticamente.
- Corrigir findings.
- Formatar ou reorganizar código.
- Alterar testes.
- Modificar configurações.
- Rodar migrações.
- Alterar bancos de dados.
- Staging ou unstaging.
- Criar, alterar ou deletar commits.
- Trocar branches para fazer mudanças.
- Push, merge, rebase ou cherry-pick.
- Instalar dependências ou rodar operações destrutivas.
- Delegar correções a outro agente (task tool negado).
- Iniciar revisão automaticamente sem autorização explícita.
- Tratar auto-revisão como equivalente à revisão independente.
- Declarar `PASS` sem evidência (C-REV-014A).

---

## 9. Gatilho de atualização documental (docupdate)

- Atualização documental ocorre **somente após verdicto `PASS`** explícito do Reviewer (contrato §11).
- Sem `PASS`, sem docupdate (exceto run records/checkpoints, atualizados continuamente).
- Documentação deve ter rastreabilidade a: run record, decisões, critérios de aceite, implementação.
- Não descrever comportamento planejado como implementado.
- Documentação deve refletir decisões confirmadas e evidência verificada (project-rules §"Documentation Linking and Single Source of Truth").

---

## 10. Referências cruzadas

- `F01.kilo/fird/contratos-delegacao.md` — contrato de delegação (fonte única do formato).
- `F01.kilo/agents/code-reviewer.md` — reviewer (inclui DELEGATION CONTRACT COHERENCE).
- `F01.kilo/agents/code-orchestrator.md` — orquestrador (inclui matriz de responsabilidade).
- `F01.kilo/agents/code-developer.md` — developer.
- `F01.kilo/rules/autonomous-execution.md` — execução autônoma.
- `F01.kilo/rules/universal-rules.md` — baseline de engenharia.
- `F01.kilo/rules/project-rules.md` — regras do projeto.
- `F01.kilo/rules/secrets-protection.md` — proteção de segredos.
- `docs/agent_runs/orch-etapa-c-2026-11-04.md` — run record do Cycle C1.
- `docs/agent_runs/orch-etapa-c-c2-2026-11-04.md` — run record do Cycle C2.
- `docs/agent_runs/orch-etapa-c-c3-2026-11-04.md` — run record do Cycle C3.
- `docs/agent_runs/orch-etapa-c-c4-2026-11-04.md` — run record deste ciclo (C4).

---

*Guidelines criadas no Cycle C4 (Etapa C). Consumidas pelo papel Reviewer. Alterações requerem revisão independente e rastreabilidade a run record e decisões.*
