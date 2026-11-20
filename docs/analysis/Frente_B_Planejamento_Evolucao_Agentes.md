# Frente B: Planejamento de Evolução dos Agentes

## 1. Arquitetura Vigente

### 1.1 Code Orchestrator
The Code Orchestrator serves as the coordination layer for autonomous execution runs. Its responsibilities include:
- **Task selection & validation**: Reading the task list, identifying eligible tasks whose scope, dependencies, and acceptance criteria are defined, and verifying required decisions are resolved before execution.
- **Run record management**: Creating, updating, and persisting run records per the autonomous execution contract (`docs/agent_runs/<run-id>.md`), maintaining append-only history.
- **Code agent coordination**: Delegating implementation tasks to the `code-developer` agent via scoped `task` tool invocations, providing required context (run ID, task ID, scope, base reference, changed files, acceptance criteria, relevant decisions, observed test results).
- **Review integration**: Requesting independent reviews from the `code-reviewer` agent for completed implementation units, ensuring reviews are scoped to the authorized task and changes.
- **Failure detection & self-correction**: Monitoring execution for failures, classifying them per the self-correction contract, tracking attempts against limits (max 3 per finding), and invoking the self-correction engine when within authorized scope.
- **State persistence & resumption**: Maintaining run records with checkpoints, validating state on resume against Git status and task list, detecting divergences, and preventing re-execution of completed operations.
- **Evidence collection & reporting**: Ensuring all findings, corrections, test results, and decisions are recorded with verifiable evidence (commands, outputs, file paths, line numbers).
- **Gate enforcement**: Never declaring a task complete without passing relevant tests and checks, independent code-reviewer approval, updated documentation with traceability, and run record updated with evidence and next action.
- **Human gate enforcement**: Never bypassing human authorization gates. Tasks depending on unresolved business decisions remain `BLOCKED` with explicit justification.

**Permissions**: `read: allow`, `glob: allow`, `grep: allow`, `list: allow`, `edit: deny`, `bash: deny`, `background: allow`, `task: "*": deny, "code-developer": allow, "code-reviewer": allow`, `webfetch: deny`, `websearch: deny`.

**Key constraint**: "INVIOLABLE RULE: EXECUTION ONLY WITH SCOPED AUTHORIZATION" — cannot start autonomous run without explicit user request. Cannot execute bash, edit, or make direct file alterations. ALL implementation must be delegated to code-developer via task tool. Reviews must be delegated to code-reviewer — cannot perform self-review.

### 1.2 Code Developer
The Code Developer implements code changes within an authorized scope, follows TDD, runs tests, reports evidence, and does not decide scope or authorization.

**Permissions**: `read: allow`, `glob: allow`, `grep: allow`, `list: allow`, `edit: allow`, `bash: allow`, `task: deny`, `webfetch: deny`, `websearch: deny`.

**Key constraints**: Scoped execution only (only the task delegated by orchestrator), TDD discipline (Red → Green → Refactor), evidence-based reporting, no destructive/external operations. Cannot commit, push, merge, rebase, publish; alter operational data or external systems; change global configuration, security policies, or agent permissions.

### 1.3 Code Reviewer
The Code Reviewer evaluates code, identifies findings with severity/file/location/evidence/impact, distinguishes proven defects from optional suggestions, verifies tests actually cover required behaviors, confirms corrections in subsequent review, and issues an explicit verdict.

**Permissions**: `bash: deny`, `read: allow`, `glob: allow`, `grep: allow`, `edit: deny`, `list: allow`, `task: deny`, `webfetch: allow`, `websearch: allow`.

**Key constraints**: Independent reviewer, not an automatic git monitor, not a correction agent, does not have permanent authorization to review future changes. "FINAL RULE: YOU ARE AN ON-DEMAND CODE REVIEWER. YOU ARE NOT AN AUTOMATIC GIT MONITOR, NOT A CORRECTION AGENT, AND DO NOT HAVE PERMANENT AUTHORIZATION TO REVIEW FUTURE CHANGES."

## 2. Inconsistência Documental Identificada

The task explicitly mentions: "Identificar e incluir no planejamento a inconsistência documental de `autonomous-execution.md` que afirma que a allowlist de `permission.task` limita o agente Code a somente `code-reviewer`."

### Analysis of the inconsistency:

- **`.kilo/rules/autonomous-execution.md` line 29**: "the configured `permission.task` allowlist limits Code to the `code-reviewer` agent"
- **`kilo.jsonc`** (line 12-15): task allowlist `"*": "deny", "code-reviewer": "allow", "code-orchestrator": "allow"` — allows **both** code-orchestrator AND code-reviewer
- **`.kilo/agents/code-orchestrator.md`** (line 15-18): `task: "*": deny, "code-developer": allow, "code-reviewer": allow` — allows both code-developer and code-reviewer
- **`.kilo/agents/code-developer.md`** (line 14): `task: deny` — denies task delegation (no nested delegation)

**The inconsistency**: `autonomous-execution.md` incorrectly states the allowlist limits Code to ONLY `code-reviewer`, when in fact the configuration in `kilo.jsonc` allows both `code-orchestrator` and `code-reviewer`, and the orchestrator agent config allows both `code-developer` and `code-reviewer`. The "runtime permission enforcement" mentioned in `autonomous-execution.md` line 29 refers to the task tool's runtime behavior, but the actual allowlist configuration in `kilo.jsonc` is broader than claimed.

This inconsistency should be documented but not corrected (per Frente B constraint "Não modificar o contrato nesta etapa").

## 3. Pesquisa Técnica (descritiva — sem modificar fontes)

### 3.1 Arquitetura e delegação de agentes
Kilo Code employs a multi-agent architecture with explicit permission boundaries. The system uses a hierarchical delegation model where the `code-orchestrator` coordinates execution by delegating to specialized agents (`code-developer` for implementation, `code-reviewer` for independent review). Permission configuration is defined in `kilo.jsonc` at the top level and overridden per-agent in `.kilo/agents/*.md` files. The delegation mechanism uses the `task` tool with scoped allowlists that determine which agents can be invoked and what actions they can perform.

Available models and variants are resolved through model IDs and provider mappings. The system supports multiple model providers with different reasoning variants. Model resolution follows a preference hierarchy: current-turn provider preference, then Kilo Gateway fallback.

### 3.2 Permissões e menor privilégio
The permission model follows least-privilege principles. Each agent has a defined permission set that restricts its capabilities to the minimum required for its role. The `task` tool's runtime permission enforcement checks the allowlist configuration before delegating to sub-agents. Key permissions across agents:
- `code-orchestrator`: denies `edit` and `bash`, allows `task` delegation to `code-developer` and `code-reviewer`
- `code-developer`: allows `edit` and `bash` within authorized scope, denies `task` (no nested delegation)
- `code-reviewer`: denies `edit` and `bash`, allows `webfetch` and `websearch`

The system prohibits permission circumvention and explicit allowlist modification to pass tests or complete tasks.

### 3.3 Gerenciamento e compactação de contexto
Context management across agent handoffs involves preserving run records, task logs, findings, and checkpoints between orchestration phases. The system uses append-only Markdown execution records under `docs/agent_runs/<run-id>.md`. On resume, the same run ID is used and verified against Git status, task list, and current files. Stale status is corrected with dated addenda; history is not silently rewritten.

Context compression strategies aim to minimize retained information while preserving traceability between requirements, domain concepts, decisions, implementation, and tests. Unnecessary duplication is avoided, and single source of truth principles are maintained.

### 3.4 Skills e instruções sob demanda
Skills are loaded on demand when tasks match their descriptions. Each skill provides specialized instructions and resources for specific task types. Skills can be configured with modes (worktree, local), agents, models, providers, and variants. Skill loading injects instructions and workflow guidance into the current conversation without requiring manual configuration.

### 3.5 Planejamento e execução complexa
Complex execution follows a four-phase FIPR flow: fix → imp → review → docupdate. Each phase has defined goals, inputs, outputs, and verification criteria. Transitions between phases are governed by specific rules (e.g., PASS → docupdate only when code-reviewer returns explicit PASS verdict). Max 3 attempts per finding via SelfCorrectionEngine; after 3 attempts without demonstrable progress, the finding is blocked.

### 3.6 Recuperação de falhas
Failure recovery classifies failures via SelfCorrectionEngine into categories: `TRANSIENT`, `DETERMINISTIC_TEST_BUILD`, `CONFIGURATION`, `PERSISTENCE_INTEGRITY`, `PERMISSION_POLICY`, `UNKNOWN`. Track attempts per finding (max 3) and total attempts (max 10). Only authorize corrections within allowed paths. Block actions: `chmod`, `chown`, `git push`, `git commit`, `npm publish`, `docker push`.

### 3.7 Paralelização segura
Safe parallelization patterns depend on the agent architecture. Front compose tasks can be parallel when they use different Docker compose files; back compose tasks are sequential when they share the same file. Docker isolation uses separate compose files per service with prefixed volumes. Networks use implicit project networks (not `external: true`) to avoid breaking independent compose startup.

### 3.8 Testes e avaliação de agentes
TDD discipline: Red → Green → Refactor cycles. Tests should verify observable behavior, requirements, contracts, invariants, and important failure modes—not merely mirror implementation details. Regression tests should detect the original defect. Mocks and stubs are appropriate for external boundaries, failure simulation, and controlled scenarios but must not conceal the behavior the test claims to prove. Brittle tests coupled to internal structure should be investigated before declaring a task complete.

### 3.9 Segurança e prompt injection
Security is treated as a design concern throughout development. least privilege applies to users, services, credentials, agent tools, database roles, and infrastructure access. Authentication is separated from authorization. Server-side enforcement of authorization for protected actions and resources—UI visibility or client-supplied owner identifiers are not trusted as proof of permission. Inputs are validated according to their types, allowed values, format, size, trust boundary, and business constraints. Parameterized queries or equivalent safe query mechanisms are used; untrusted input is not concatenated into executable queries.

### 3.10 Revisão independente
Independent review is a mandatory gate. The code-reviewer agent is read-only (edit/bash/task denied) and reports findings without implementing corrections. The orchestrator cannot perform self-review under any circumstances. Self-approval of implementation is expressly prohibited. The autonomous execution contract requires an independent reviewer to issue the verdict. Reviewer is independent and read-only; it reports findings and ends; does not implement corrections.

### 3.11 TDD e validação em escala
TDD at scale follows Red → Green → Refactor. Unit, integration, contract, and end-to-end tests are chosen according to risk and behavior being verified. Real dependencies are used when their behavior is the subject of the test. Mocks and stubs are appropriate for external boundaries but must not conceal the behavior the test claims to prove. Test pass rates are a quality indicator but not proof of total correctness or security.

### 3.12 Differentiation of resource statuses
The research differentiates between:
- **Available**: Currently implemented and functional features/agents
- **Experimental**: Proposed or pilot features still under evaluation
- **Deprecated**: Previously implemented, now discouraged or removed
- **Proposed**: Architectural patterns or designs under consideration for future implementation

## 4. Análise dos Agentes

### 4.1 Code Orchestrator (detailed)
- **Responsibilities**: task selection & validation, run record management, code agent coordination, review integration, failure detection & self-correction, state persistence & resumption, evidence collection & reporting, gate enforcement, human gate enforcement
- **Permissions**: `read: allow`, `glob: allow`, `grep: allow`, `list: allow`, `edit: deny`, `bash: deny`, `background: allow`, `task: "*": deny code-developer, code-reviewer allow`, `webfetch: deny`, `websearch: deny`
- **Key constraint**: "INVIOLABLE RULE: EXECUTION ONLY WITH SCOPED AUTHORIZATION" — cannot start autonomous run without explicit user request. Cannot execute bash, edit, or make direct file alterations. ALL implementation must be delegated to code-developer via task tool. Reviews must be delegated to code-reviewer — cannot perform self-review. No permission circumvention allowed.

### 4.2 Code Developer (detailed)
- **Responsibilities**: implement the task as specified, follow TDD Red→Green→Refactor, run relevant tests, report exact commands/results, return implementation artifacts, do not decide scope/authorization
- **Permissions**: `read: allow`, `glob: allow`, `grep: allow`, `list: allow`, `edit: allow`, `bash: allow`, `task: deny`, `webfetch: deny`, `websearch: deny`
- **Key constraints**: scoped execution only (only the task delegated by orchestrator), TDD discipline, evidence-based reporting, no destructive/external operations. Cannot commit, push, merge, rebase, publish; alter operational data or external systems; change global configuration, security policies, or agent permissions.

### 4.3 Code Reviewer (detailed)
- **Responsibilities**: evaluate code, identify findings with severity/file/location/evidence/impact, distinguish proven defects from optional suggestions, verify tests actually cover required behaviors, confirm corrections in subsequent review, issue explicit verdict
- **Permissions**: `bash: deny`, `read: allow`, `glob: allow`, `grep: allow`, `edit: deny`, `list: allow`, `task: deny`, `webfetch: allow`, `websearch: allow`
- **Key constraints**: independent reviewer, not an automatic git monitor, not a correction agent, does not have permanent authorization to review future changes. "FINAL RULE: YOU ARE AN ON-DEMAND CODE REVIEWER. YOU ARE NOT AN AUTOMATIC GIT MONITOR, NOT A CORRECTION AGENT, AND DO NOT HAVE PERMANENT AUTHORIZATION TO REVIEW FUTURE CHANGES."

## 5. Arquitetura Conjunta

The joint architecture defines the complete agent coordination flow:

- **Orchestrator delegates to Developer and Reviewer**: The orchestrator initiates execution by delegating implementation to `code-developer` via `task` tool, then requests independent review from `code-reviewer` via `task` tool.
- **Developer implements, reports evidence**: The developer completes the delegated task, follows TDD, runs tests, and produces verifiable evidence (commands, outputs, file paths, diff).
- **Orchestrator coordinates, records run history**: The orchestrator maintains append-only run records, tracks FIPR phase transitions, and coordinates the overall execution flow.
- **Reviewer reviews independently**: The code-reviewer inspects actual changes (not just implementer's summary), issues a verdict (`PASS`, `CORRECTIONS_NEEDED`, `INCONCLUSIVE`, `BLOCKED`), and reports findings without implementing corrections.
- **Developer's self-review does not substitute independent review**: Even if developer tests pass, an independent review from code-reviewer is mandatory before advancing to docupdate.
- **Reviewer reports findings and ends**: After issuing verdict, the reviewer's activity ends. It waits for new instructions. The orchestrator verifies each finding, fixes confirmed in-scope defects, reruns relevant checks, and requests new review after material changes.
- **FIPR flow**: fix → imp → review → docupdate, with defined transition rules and gate enforcement at each phase.

## 6. Inconsistência Documental Específica

### Detailed analysis of the autonomous-execution.md inconsistency:

The document claims (line 29): "the configured `permission.task` allowlist limits Code to the `code-reviewer` agent"

**Reality**: 
- `kilo.jsonc` allows code-orchestrator AND code-reviewer (lines 14-15: `"code-reviewer": "allow", "code-orchestrator": "allow"`)
- The orchestrator agent config (`code-orchestrator.md`) allows both code-developer and code-reviewer
- The developer agent has `task: deny` (no nested delegation), but this is about nested task delegation, not the top-level allowlist

**The "runtime permission enforcement" mentioned in autonomous-execution.md line 29** refers to the task tool's runtime behavior, but the actual allowlist configuration in `kilo.jsonc` is broader than claimed by the documentation. The documentation states the allowlist limits Code to ONLY `code-reviewer`, but the configuration permits both `code-orchestrator` and `code-reviewer` at the top level, and `code-developer` and `code-reviewer` at the agent configuration level.

This inconsistency should be noted but not corrected (per Frente B constraint "Não modificar o contrato nesta etapa"). The documentation incorrectly summarizes the permission model, which could lead to agent misunderstandings about their actual scope.

## 7. Pesquisa Técnica (resumo)

### 7.1 Available models and variants
Model resolution supports multiple providers with different model IDs and reasoning variants. Available models are searched and matched leniently (case-insensitive, ignoring spacing/punctuation). Provider IDs constrain model resolution when explicit provider matching is needed. The system defaults to `nomic-embed-text` for file extension indexing.

### 7.2 Provider IDs and model resolution
Provider IDs force specific model-from-provider resolution. When omitted, Agent Manager resolves automatically, preferring the current-turn provider preference and falling back to Kilo Gateway. Qualified provider/model IDs can force specific provider-model combinations.

### 7.3 Skills and instructions on demand
Skills provide specialized instructions and resources for specific task types. They are loaded via the `skill` tool and can be configured with modes (worktree, local), agents, models, providers, and variants. Skill loading injects guidance without manual configuration.

### 7.4 Context management and compression
Context is managed across agent handoffs through append-only run records, task logs, findings, and checkpoints. Compression strategies minimize retained information while preserving traceability. Single source of truth principles maintain consistency between requirements, decisions, implementation, and tests.

### 7.5 Safe parallelization patterns
Parallel execution depends on compose file separation. Front tasks parallelize across different compose files; back tasks sequentialize when sharing files. Docker isolation uses separate compose files with prefixed volumes. Networks use implicit project networks (avoiding `external: true`).

### 7.6 Test evaluation frameworks
Test selection follows risk-based approach: unit, integration, contract, end-to-end. Real dependencies used when test subject is external behavior. Mocks/stubs appropriate for controlled scenarios. Test pass rates are quality indicators but not proof of total correctness.

### 7.7 Security considerations for agent architectures
Least privilege applied across agent tools and credentials. Authentication separated from authorization. Server-side enforcement of authorization. Input validation according to type, allowed values, format, size, trust boundary. Parameterized queries. Secure defaults and fail-closed behavior.

### 7.8 Independent review mechanisms
Mandatory independent review gate. Reviewer is read-only, reports findings without corrections. Orchestrator cannot self-review. Self-approval expressly prohibited. Contract requires independent reviewer verdict.

### 7.9 TDD validation at scale
Red → Green → Refactor cycles. Tests verify observable behavior and contracts. Regression tests detect original defects. Mocks/stubs appropriate for external boundaries only. Brittle tests investigated before task completion.

### 7.10 Differentiation summary
- **Available**: Implemented functional features
- **Experimental**: Pilot features under evaluation  
- **Deprecated**: Discouraged or removed features
- **Proposed**: Future architectural patterns under consideration

## 8. Recomendações P0–P3

### P0 — Confiabilidade e Segurança
- **Critical findings about permission model ambiguity**: The `autonomous-execution.md` documentation incorrectly states the `permission.task` allowlist limits Code to only `code-reviewer`, when `kilo.jsonc` actually allows both `code-orchestrator` and `code-reviewer`. This ambiguity could cause agents to misunderstand their scope.
- **Need for clear documentation of actual vs claimed allowlists**: Project documentation must accurately reflect the permission configuration to prevent scope overreach or underperformance.
- **Security concern**: If agents misunderstand their scope, they may overstep (attempt unauthorized actions) or underperform (not utilizing authorized capabilities). Clear, accurate documentation is a security boundary.
- **Recommendation**: Clarify the actual permission model in project documentation so all agents have accurate awareness of their delegated scope.

### P1 — Capacidade
- **Orchestrator delegation capacity limits**: Max 3 attempts per finding, max 10 total attempts across all findings. After 3 attempts without demonstrable progress, stop and escalate.
- **Developer scope enforcement mechanisms**: The `task: deny` on code-developer prevents nested delegation. Scope is enforced by the delegation request from orchestrator.
- **Reviewer authorization gate limitations**: Reviewer has no `edit` or `bash` permissions; cannot implement corrections. Can only report findings and issue verdict.
- **Recommendation**: Standardize delegation contracts with explicit scope definitions that map to the actual `kilo.jsonc` allowlist configuration, not the claimed scope in `autonomous-execution.md`.

### P2 — Eficiência
- **Context compression strategies across agent handoffs**: Append-only run records with checkpoints, verified Git status on resume, dated addenda for stale status. Avoid history rewriting.
- **Review cycle time optimization**: Independent review happens after developer completes implementation and reports evidence. Parallelization of independent tasks reduces overall execution time.
- **Background process management**: Background processes tracked and managed with `inherit`/`persistent` lifetime options. Processes visible and manageable from every session.
- **Recommendation**: Implement checkpoints and resumption protocols that allow mid-execution resume without rework.

### P3 — Evolução Futura
- **Proposal for standardized delegation contracts**: Explicit format for delegation requests (run ID, task ID, scope, base reference, changed files, acceptance criteria, decisions, test results) and review reports (findings by severity, evidence, tests executed, verdict).
- **Evaluation suite with real and adversarial scenarios**: Test scenarios covering permission boundary tests, scope expansion attempts, review evasion, and valid successful delegations.
- **Metrics for quality indicators**: Test pass rates, review verdict consistency, context retention across resume.
- **Recommendation**: Phase future improvements through MP (Milestone Progression) sequence, starting with documentation clarification (P0), then contract standardization (P1), then evaluation suite (P2), then metrics (P3).

## 9. Contratos Propostos

### 9.1 Delegation requests
Standardized format including:
- Run ID
- Task ID
- Scope (authorized agent(s), permitted actions)
- Base reference (commit, branch, file state)
- Changed files (anticipated or actual)
- Acceptance criteria
- Relevant decisions (references to decisions.md IDs)
- Observed test results (exit codes, output summaries)

### 9.2 Review reports
Standardized format including:
- Findings by severity (with file, line number, evidence)
- Tests executed (commands, exit codes, output)
- Verdict: `PASS`, `CORRECTIONS_NEEDED`, `INCONCLUSIVE`, `BLOCKED`
- Limitations and unexecuted checks explicitly stated
- Run record reference

### 9.3 Run record persistence
Append-only Markdown under `docs/agent_runs/<run-id>.md` with required sections:
- Run metadata (ID, start time, branch, base commit, authorized task, scope)
- Task log (task ID, status, dependencies, start/end times, findings, attempts, current FIPR phase)
- Findings log (finding ID, task, severity, status, attempts, last attempt, resolution)
- Checkpoints (timestamp, FIPR phase, description, Git status hash, verified)
- Next action
- Limitations and uncertainties
- Conclusion (`COMPLETED`, `BLOCKED`, `OPERATIONAL PAUSE`, `HUMAN APPROVAL REQUIRED`)

### 9.4 FIPR flow phases
- **fix**: Analyze and correct — root-cause hypothesis, scoped fix plan
- **imp**: Implement — following plan, Red → Green → Refactor
- **review**: Independent review — code-reviewer verdict
- **docupdate**: Update documentation only after PASS with traceability

## 10. Suíte de Avaliação (proposta)

### 10.1 Real scenarios
1. **Orchestrator delegates T-1007 → Developer implements → Reviewer reviews → verdict PASS**
2. **Orchestrator delegates C3 → Developer implements → Reviewer reviews → verdict PASS**
3. Stripe flow validation with sandbox isolation
4. Invoice generation MVP with PDF receipt on-demand

### 10.2 Adversarial scenarios
1. **Unscoped delegation attempt → BLOCKED by permission policy**: Agent attempts task without proper scope; permission policy blocks execution.
2. **Self-review attempt by Orchestrator → BLOCKED with justification**: Orchestrator cannot perform self-review; violation detected and blocked.
3. **3rd attempt without progress → CORRECTIONS_NEEDED with escalation**: After 3 failed attempts on same finding, system escalates with documented reason.
4. **Permission boundary test**: Agent attempts action outside its allowlist (e.g., developer trying `task` delegation); blocked at runtime.

### 10.3 Objective approval criteria
- `PASS`: Completed review found no corrective finding in examined scope
- `CORRECTIONS_NEEDED`: Review found findings requiring fixes; within attempt limits
- `INCONCLUSIVE`: Review cannot reach verdict due to missing evidence or ambiguous scope
- `BLOCKED`: Unresolved business decisions, permission failures, or destructive operation requirements

### 10.4 Quality indicators
- Test pass rates: Percentage of tests passing across execution
- Review verdict consistency: Consistency of verdicts across similar implementations
- Context retention across resume: Ability to resume run record without information loss
- Permission compliance rate: Percentage of agent actions within authorized scope

## 11. Plano de Implementação Futuro (etapas pequenas)

### Step 1: Clarify permission model documentation (P0)
- **Dependencies**: Requires human decision on whether to correct `autonomous-execution.md`
- **Risks**: If documentation is corrected without coordinating with all agent configurations, may create new inconsistencies
- **Acceptance criteria**: Documentation accurately reflects `kilo.jsonc` allowlist; all agent configs consistent with top-level configuration
- **Action**: Human decides whether to update `autonomous-execution.md` line 29; if corrected, update to reflect actual allowlist

### Step 2: Standardize delegation contract format (P1)
- **Dependencies**: Step 1 must complete first (or concurrently if human decides no correction needed)
- **Risks**: Inconsistent delegation formats across projects or within project
- **Acceptance criteria**: Standardized format for delegation requests and review reports documented and implemented
- **Action**: Document the proposed contracts in Section 9; integrate into agent workflow

### Step 3: Implement evaluation suite baseline (P1)
- **Dependencies**: Step 2 complete; human approval of proposed evaluation suite design
- **Risks**: Evaluation suite may not cover all agent interaction patterns
- **Acceptance criteria**: Suite includes real scenarios (T-1007, C3, Stripe) and adversarial scenarios (permission boundaries, scope expansion); objective approval criteria defined
- **Action**: Create evaluation suite with defined test scenarios and acceptance criteria

### Step 4: Add adversarial test scenarios (P2)
- **Dependencies**: Step 3 baseline complete
- **Risks**: Adversarial scenarios may reveal edge cases not covered in baseline
- **Acceptance criteria**: Suite includes all adversarial scenarios from Section 10.2; each scenario has defined expected outcome
- **Action**: Expand evaluation suite with adversarial test cases

### Step 5: Metrics and monitoring framework (P2)
- **Dependencies**: Step 4 complete; human approval of metrics design
- **Risks**: Metrics collection may impact performance or raise privacy concerns
- **Acceptance criteria**: Quality indicators (test pass rates, review verdict consistency, context retention) measurable and reported
- **Action**: Implement metrics collection and reporting framework

### Step 6: Future agent capability enhancements (P3)
- **Dependencies**: Steps 1-5 complete; human prioritization of enhancement requests
- **Risks**: Enhancements may introduce new permission or consistency issues
- **Acceptance criteria**: Future capabilities (e.g., expanded agent roles, new delegation patterns) documented and prioritized
- **Action**: Document future enhancement proposals for subsequent phases

## 12. Confirmação de que nenhuma alteração foi realizada na Frente B

This Frente B document was produced as a **read-only analysis**. No project files were modified, no permissions were changed, no configurations were altered, and no git operations were performed. The document is output solely as text in this response.

**Specifically verified**:
- No `edit` operations performed on any project files
- No `bash` commands that modify repository state
- No git add, commit, push, merge, rebase, or checkout operations
- No changes to `.kilo/rules/`, `kilo.jsonc`, `.kilo/agents/`, or any other project configuration
- No secrets were exposed or printed
- The inconsistency analysis was based on reading existing files only

## 13. Decisões que dependem de aprovação humana

The following decisions require human approval and are outside the scope of this read-only Frente B analysis:

1. **Clarification of the autonomous-execution.md inconsistency (should the doc be corrected?)**
   - The documentation incorrectly states the allowlist limits Code to ONLY `code-reviewer`, when `kilo.jsonc` allows `code-orchestrator` AND `code-reviewer`
   - Human decision needed: should `autonomous-execution.md` be corrected to reflect the actual allowlist? This is a documentation fix, not a permission change
   - If corrected, must ensure consistency across all agent configurations (`code-orchestrator.md`, `code-developer.md`)

2. **Any permission model changes**
   - Prohibited in this phase — no permission model changes may be made without explicit human authorization
   - The actual `kilo.jsonc` allowlist configuration is correct; only the documentation needs clarification (if at all)

3. **Evaluation suite design approval**
   - Human approval required for the proposed evaluation suite (Section 10)
   - Includes approval of test scenarios, expected outcomes, and quality indicators

4. **Future agent enhancement prioritization**
   - Human decision needed on which P1-P3 improvements to implement, in what order, and with what priorities
   - The roadmap (Section 11) is proposed but not approved until human prioritization

**Estado final esperado: PLANNING_COMPLETE — AWAITING_HUMAN_APPROVAL**

This Frente B document is complete and ready for human review. The document provides a comprehensive analysis of the agent architecture, identifies the documented inconsistency, proposes standardized contracts and evaluation suites, and outlines a multi-phase implementation roadmap — all without modifying any project files. Human approval is required for the documentation clarification decision and evaluation suite design before any implementation proceeds.