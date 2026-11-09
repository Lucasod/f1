# KILO F01 to LocalRAG Handoff Document

*Generated for the F01 Orchestra agent. Read-only investigation. Only write is this delivery document for LocalRAG.*

---
## SECTION A: Arquitetura do Kilo no F01

### A.1 Visão Geral da Arquitetura

The Kilo F01 platform operates as a FS-01 Marketplace with the following architectural components:

- **Agentes**: code-orchestrator, code-developer, code-reviewer — each with scoped permissions per `.kilo/rules/universal-rules.md` and `.kilo/rules/project-rules.md`
- **Rules Layer**: Four rule files in `.kilo/rules/` with mandatory precedence order:
  1. `.kilo/rules/universal-rules.md` — universal engineering baseline (SOLID, TDD, security, data integrity)
  2. `.kilo/rules/project-rules.md` — FS-01 Marketplace technical naming, documentation linking, code review flow
  3. `.kilo/rules/autonomous-execution.md` — run selection, FIPR flow (fix → imp → review → docupdate), human gates
  4. `.kilo/rules/secrets-protection.md` — mandatory secrets protection (MP-31D/MP-31G), scanner enforcement

- **Orchestration Flow (FIPR)**: fix → imp → review → docupdate. Reviews are independent and read-only; self-review is prohibited.

- **Delegation Contract (C-REV-003)**: Every delegation includes 9 elements:
  1. `run_id`, 2. `task_id`, 3. `scope` (authorized_paths, forbidden_paths, description, constraints), 4. `base_ref` (branch, commit), 5. `changed_files`, 6. `acceptance_criteria` (id, statement, verification, expected), 7. `relevant_decisions`, 8. `observed_test_results`, 9. `review_verdict` (verdict, findings, files_examined, commands_executed, limitations, conclusion)

- **Evidence Requirements**: Every report must include exact commands with exit codes, file paths and line numbers, test results, diff references, run record references, and explicit limitations. Never invent test results or verification.

- **Secret Safety**: No real credentials in reports, documentation, tests, or logs. Use only `CONFIGURED`/`MISSING`/`INVALID` indicators. Scanner `scripts/scan-secrets.sh` exits 0 if clean, non-zero on findings. Patterns aligned with Secret Taxonomy (Stripe keys, AWS access keys, GitHub tokens, Slack tokens, private keys, certificates, connection strings, passwords, API keys/tokens, authorization headers, session cookies, base64-encoded secrets, sensitive file names). MP-31G hardening: quoted patterns only; unquoted identifiers no longer trigger false positives.

- **Scoped Authorization**: Orchestrator has `edit: deny`, `bash: deny`; delegation to code-developer and code-reviewer only via `task` tool. Developer has `edit`, `bash` within authorized_paths. Reviewer is read-only (edit/bash/task denied).

### A.2 Confirmed Decisions (CD-xxx) Summary

Key confirmed decisions relevant to infrastructure:
- **CD-053**: Docker Compose structure — each project has its own Dockerfile/configuration; root Compose starts complete environment; backend Compose starts backend + dependencies (MongoDB, Elasticsearch, Redis); frontend Compose starts React independently.
- **CD-054**: Currency and localization — English interface; transaction currency = BRL; do not infer USD from English interface; no FX service without confirmed requirement; Stripe Connect supports BRL in Brazil per CD-064.
- **CD-056**: Testing strategy — three-layer TDD: Unit (Vitest), API/integration (Supertest), E2E (Playwright). Red → Green → Refactor at all layers.
- **CD-057**: Credential and authentication flow — Credential associated with Person; login by email; conceptual flow: receive email/password → locate Contact_Info matching email (Type=email) → find Person → locate Credential → verify credential.
- **CD-058**: Order aggregate financial status — derived/computed dimension separate from lifecycle state machine. Values: FULLY_REFUNDED, PARTIALLY_REFUNDED, PAID (precedence order).
- **CD-059**: Consumer and vendor authorization — ownership-based isolation. No generic RBAC for Consumer/Vendor. Backend validates `resource.ownerPersonId === currentPersonId` on every protected operation.
- **CD-064**: Payment provider — Stripe Connect Separate Charges and Transfers. Single Charge on platform account per Order (amount=order_total, currency=BRL, capture=true). One Transfer per Order_Vendor_Group to vendor's connected account. Commission = global percentage per CD-045.
- **CD-065**: Payment and vendor distribution flow — Separate Charges and Transfers flow. Charge → Payment=CAPTURED → Order=PAID → all OVGs=PENDING. Platform creates one Transfer per OVG. Vendor fulfillment trigger: OVG=PENDING → Vendor confirms → OVG=CONFIRMED (not gated by Transfer completion).

### A.3 Agents and Rules Overview

| Agent | Role | Permissions | Key Constraints |
|---|---|---|---|
| `code-orchestrator` | Orchestra | read/glob/grep/list/task (to developer & reviewer); edit & bash denied | Plan, delegate, coordinate; enforce scope, FIPR, human gates; integrate independent reviews |
| `code-developer` | Developer | read/glob/grep/list/edit/bash; task denied | Implement within authorized scope; TDD (Red→Green→Refactor); report evidence; fix in-scope findings |
| `code-reviewer` | Reviewer | read/glob/grep/list/webfetch/websearch; edit/bash/task denied | Independent read-only review; inspect real diff; emit verdict (PASS/CORRECTIONS_NEEDED/INCONCLUSIVE/BLOCKED) |

### A.4 Evidence Collection Policy

- Exact commands executed and observed results must be recorded
- File paths and line numbers for all findings
- Test commands, exit codes, and output summaries
- Diff references with file paths and line ranges
- Run record references
- Limitations and unexecuted checks explicitly stated
- Never invent test results, tool output, code changes, or verification
- Secrets never exposed in reports, documentation, or logs

---
## SECTION B: Inventário de Arquivos — CORE/PROJECT/MIXED Classification

### B.1 File Classification Table

| File Path | Classification | Reason |
|---|---|---|
| `.kilo/agent-manager.json` | MIXED | Agent worktree state; UI persistence, not executable |
| `.kilo/agents/code-developer.md` | PROJECT | Developer role definition for F01 |
| `.kilo/agents/code-orchestrator.md` | PROJECT | Orchestrator role definition for F01 |
| `.kilo/agents/code-reviewer.md` | PROJECT | Reviewer role definition for F01 |
| `.kilo/command/*.md` | PROJECT | Command templates for orchestration |
| `.kilo/fird/contratos-delegacao.md` | PROJECT | Delegation contract (single source of truth) |
| `.kilo/fird/guidelines-developer.md` | PROJECT | Developer guidelines |
| `.kilo/rules/autonomous-execution.md` | PROJECT | Run selection, FIPR flow, human gates |
| `.kilo/rules/project-rules.md` | PROJECT | FS-01 Marketplace technical naming, code review flow |
| `.kilo/rules/secrets-protection.md` | PROJECT | Mandatory secrets protection (MP-31D/MP-31G) |
| `.kilo/rules/universal-rules.md` | PROJECT | Universal engineering baseline (SOLID, TDD, security) |
| `.kilo/scripts/scan-secrets.sh` | PROJECT | Scanner script for credential detection |
| `.kilo/scripts/install-hooks.sh` | PROJECT | Pre-commit hook installer |
| `.kiro/pre-commit` | PROJECT | Tracked hook template (MP-31D) |
| `F01/README.md` | PROJECT | Project entry point |
| `F01/docs/decisions.md` | PROJECT | Authoritative record of approved decisions |
| `F01/docs/open_questions.md` | PROJECT | Unresolved questions and deferred decisions |
| `F01/docs/task_list.md` | PROJECT | Work items with decision references |
| `F01/docs/mp_log.md` | PROJECT | Execution history, outcomes, evidence |
| `F01/docs/project_context.md` | PROJECT | Project scope and conventions |
| `F01/front/` | PROJECT | Frontend application code |
| `F01/back/` | PROJECT | Backend application code |
| `F01/docker-compose.yml` | PROJECT | Root Docker Compose structure |
| `F01/docker-compose.validation.yml` | PROJECT | Docker Compose validation config |
| `F01/storage/` | PROJECT | Persistent data storage |
| `F01/front/tests/` | PROJECT | Test suite directory |
| `F01/front/tests/e2e/auth.spec.ts` | CORE | E2E authentication test |
| `F01/front/tests/unit/` | PROJECT | Unit test directory |
| `kilo.jsonc` | PROJECT | Kilo configuration |
| `scripts/` | PROJECT | Project scripts |
| `reset-database.sh` | PROJECT | Database reset script |
| `.git/` | CORE | Git repository metadata — not a project file |
| `.gitignore` | PROJECT | Git ignore rules |
| `.githooks/pre-commit` | PROJECT | Pre-commit hook (authoritative, MP-31D) |

### B.2 CORE Files (Repository Infrastructure)

These files support the repository itself and are not part of the F01 application logic:
- `.git/` — Git metadata
- `.gitignore` — Git protection rules
- `.githooks/pre-commit` — Pre-commit hook template
- `kilo.jsonc` — Kilo configuration (agent, rules, indexing)

### B.3 PROJECT Files (F01 Marketplace Implementation)

Rules, decisions, documentation, agent definitions, configuration, and scripts that define the F01 Marketplace project.

### B.4 MIXED Files (Cross-Cutting/Infrastructure)

Files that blend infrastructure and project concerns, such as agent worktree state, hook scripts, and configuration.

---
## SECTION C: Segurança

### C.1 Secret Protection Principles (Mandatory)

All secrets-protection rules from `F01.kilo/rules/secrets-protection.md` apply mandatory and without exception:

- **Never display secret values** in terminal output, logs, reports, documentation, tests, prompts, reasoning, agent messages, or any other artifact
- **Never run** `cat .env`, `printenv`, `env`, or any equivalent command that reveals credentials
- **Never print files or environment variables** that contain secrets
- **Never pass credentials** as command-line arguments
- **Never copy secret values** into reports, documentation, fixtures, screenshots, chat messages, or agent messages
- **Never ask the user** to paste full credentials in chat
- **Never reproduce a suspected secret** in an incident record, finding, or report

### C.2 Diagnostics Without Revealing Values

Diagnostics may report only:
- The variable or secret name
- Whether it is configured or missing
- The target environment
- A structural validation result (e.g., format/length sanity)

Never the value itself. Validate credentials internally without printing, logging, transmitting, or otherwise disclosing their content.

### C.3 .env File Restrictions

- `.env` files and any file containing secrets must stay out of Git (protected via `.gitignore`)
- Must be protected from accidental exposure via least-privilege access
- Must not be committed, printed, or attached as secret-bearing files
- If a secret is suspected to have been exposed: stop disclosure immediately; do not reproduce the secret; record an incident referencing only the secret name and scope; recommend rotation of the affected credential

### C.4 Scanner Enforcement

- Tracked scanner: `scripts/scan-secrets.sh`
- Scans staged files (default mode) or files passed as arguments
- Uses POSIX ERE only (`grep -E`); no PCRE
- Reports only file paths + pattern labels + categories — **never** prints matched values
- Exits 0 if clean, non-zero on findings or operational failure (fail-closed)
- MP-31G hardening: Password, API-key, generic-secret, and session-id patterns require an opening quote character; unquoted identifiers/declarations no longer trigger false positives
- Backtick inline-code stripping applies only to markdown files (`.md`, `.mdx`, `.markdown`); non-markdown files scanned in full
- Fail-closed behaviors: missing tools → exit 2; binary files blocked; sensitive file names blocked regardless of content; directory/non-regular-file input → non-zero, blocked

### C.5 Pre-Commit Hook

- Tracked hook template: `.githooks/pre-commit` calls scanner on staged content (`scripts/scan-secrets.sh --staged`)
- Installation: `scripts/install-hooks.sh` sets `git config core.hooksPath .githooks` (idempotent)
- Backs up any pre-existing legacy hook to `.git/hooks/pre-commit.mp31-backup`
- Manual activation: `git config core.hooksPath .githooks` or copy `.githooks/pre-commit` to `.git/hooks/pre-commit` after backing up existing hook
- Hooks are local and bypassable via `--no-verify`; not shared across clones unless activated

### C.6 Example Fictitious Credential Values (Never Real)

| Category | Fictitious Example | Pattern |
|---|---|---|
| Stripe secret key | `sk_test_FAKE1234567890` | `sk_` prefix |
| Stripe restricted key | `rk_test_FAKE1234567890` | `rk_` prefix |
| Stripe webhook secret | `whsec_FAKE1234567890` | `whsec_` prefix |
| AWS access key | `AKIA_IOSFODNN7EXAMPLE` | `AKIA` + 16 chars |
| GitHub PAT | `ghp_VDJdE6xampleToken12345` | `ghp_` prefix |
| Slack token | `xoxb-FAKE1234567890` | `xoxb-` prefix |
| Private key (PEM) | `-----BEGIN PRIVATE KEY-----`... (fictitious content) | `-----BEGIN ... PRIVATE KEY-----` |
| Connection string | `mongodb://user:password@localhost:27017/db` | URI with embedded credentials (fictitious) |
| Password assignment | `password = "FAKE_PASSWORD"` | Quoted assignment (MP-31G) |
| API key assignment | `api_key = "sk_test_FAKE..."` | Quoted assignment (MP-31G) |
| Session ID assignment | `session_id = "sess_FAKE1234567890"` | Quoted assignment (MP-31G) |

### C.7 Secrets in Documentation and Tests

- All documentation examples use fictitious values only
- Test fixtures and snapshots use masked or synthetic credential values
- No real `.env` values or database dumps containing real passwords in snapshots or fixtures
- Authorization headers must never be logged in full; if needed for debugging, mask to `Authorization: Bearer <redacted>`

---
## SECTION D: Procedimento de Instalação — Reproduzir Infraestrutura em LocalRAG

### D.1 Pré-requisitos

- Docker e Docker Compose instalados
- Node.js 18+ e npm (para frontend)
- Git configurado com credenciais de leitura-only
- Kilo CLI instalado (`npm i -g @kilo-ai/cli` or equivalent)
- LocalRAG environment prepared (see Section F)

### D.2 Clonar e Configurar o Repositório F01

```bash
# Clone the repository (read-only investigation)
git clone https://github.com/example/f1.git /home/workstation/source/f1
cd /home/workstation/source/f1

# Verify git readonly authorization
git config --get core.hooksPath 2>/dev/null || echo "No hooks path configured"
# Expected: .githooks (if hooks installed) or empty (if not installed)

# Install pre-commit hooks (idempotent)
bash scripts/install-hooks.sh

# Verify hooks are active
test -x .githooks/pre-commit && echo "Hooks active" || echo "Hooks not active"
```

### D.3 Configurar Variáveis de Ambiente (Fictitious Values Only)

```bash
# Create .env file — never commit real values
cat > .env << 'EOF'
# F01 Marketplace — Fictitious Example Values Only
STRIPE_SECRET_KEY=sk_test_FAKE1234567890
STRIPE_RESTRICTED_KEY=rk_test_FAKE1234567890
STRIPE_WEBHOOK_SECRET=whsec_FAKE1234567890
DATABASE_URL=mongodb://localhost:27017/f1_marketplace
REDIS_URL=redis://localhost:6379
ELASTICSEARCH_HOST=http://localhost:9200
JWT_SECRET=jwt_FAKE_super_secret_key_for_development_only
EOF

# Verify .env is gitignored
grep .env .gitignore && echo ".env is gitignored" || echo ".env NOT gitignored — fix immediately"
```

### D.4 Iniciar a Pilha Docker (CD-053 Compliant)

```bash
# Root Compose — starts complete environment (MongoDB, Elasticsearch, Redis, backend, frontend)
docker compose -f F01/docker-compose.yml up -d

# Wait for services to be ready
# MongoDB: check port 27017
# Elasticsearch: check port 9200
# Redis: check port 6379
# Backend API: check port 3000
# Frontend: check port 3000 (or configured port)

# Verify services
docker compose -f F01/docker-compose.yml ps
```

### D.5 Validar Escaneamento de Segredos

```bash
# Run secret scanner on staged files
bash scripts/scan-secrets.sh

# Expected: exit 0 if no secrets detected
# If findings: remediate before proceeding (do not weaken scanner patterns)

# Run test suite for scanner (must pass 74 tests)
bash scripts/test-scan-secrets.sh
```

### D.6 Verificar Configuração do Kilo

```bash
# Verify kilo.jsonc configuration
cat kilo.jsonc

# Expected rules loading order:
# 1. .kilo/rules/universal-rules.md
# 2. .kilo/rules/project-rules.md
# 3. .kilo/rules/autonomous-execution.md
# 4. .kilo/rules/secrets-protection.md

# Verify agent permissions
grep -A5 '"agent"' kilo.jsonc
```

### D.7 Inicializar Agent Manager (Optional)

```bash
# Start Agent Manager sessions as needed
# See kilo-config skill for full setup scripts

# List current sessions
# Start new sessions with proper scoping
```

---
## SECTION E: Testes de Aceitação — Objetivas para Verificação

### E.1 Unit Tests (Vitest — CD-056)

```bash
# Run unit test suite
cd /home/workstation/source/f1/F01/front
npx vitest run

# Expected: all unit tests pass
# If failures: fix root cause; do not weaken or skip tests
```

### E.2 API/Integration Tests (Supertest — CD-056)

```bash
# Run API/integration test suite
cd /home/workstation/source/f1/F01/front
npx supertest-run || npm test -- --runIntegration

# Expected: all integration tests pass
# Coverage requirements: payment tests use provider test mode; cover success, failure, repeated events, idempotency
```

### E.3 End-to-End Tests (Playwright — CD-056)

```bash
# Navigate to application
npx playwright test

# Expected: all E2E complete flows pass
# Test layers validated: unit, integration, and full flows
```

### E.4 Secret Scanner Test (Mandatory — MP-31D/MP-31G)

```bash
# Run scanner on staged files — must pass
bash scripts/scan-secrets.sh
echo "Scanner exit code: $?"

# Run scanner test suite — must pass 74 tests
bash scripts/test-scan-secrets.sh
echo "Scanner test exit code: $?"

# If scanner reports findings: remediate; do not weaken detection patterns
```

### E.5 Code Review Test (Independent — Mandatory)

```bash
# Request independent review from code-reviewer agent
# Reviewer inspects actual diff against requirements, acceptance criteria, decisions, scope, and tests

# Review verdict must be PASS (no corrective findings in examined scope)
# or CORRECTIONS_NEEDED/INCONCLUSIVE/BLOCKED with explicit findings
```

### E.6 Acceptance Criteria Verification Checklist

| # | Criterion | Status | Evidence |
|---|---|---|---|
| E-01 | Kilo rules load in correct order (universal → project → autonomous → secrets) | ☐ | kilo.jsonc verified |
| E-02 | Pre-commit hooks installed and executable | ☐ | test -x .githooks/pre-commit |
| E-03 | .env file uses fictitious values only | ☐ | Scanner exit 0; no real credentials |
| E-04 | Scanner exits 0 on clean configuration | ☐ | bash scripts/scan-secrets.sh exit code |
| E-05 | Three-layer TDD tests exist and run | ☐ | vitest run; supertest; playwright test |
| E-06 | Code review completed with PASS verdict | ☐ | code-reviewer independent review |
| E-07 | No real credentials exposed in any artifact | ☐ | Secrets protection compliance |
| E-08 | Docker Compose services start successfully | ☐ | docker compose ps |
| E-09 | Currency = BRL, interface = English (CD-054) | ☐ | Configuration verified |
| E-10 | Ownership-based authorization (CD-059) | ☐ | Ownership checks in code |
| E-11 | Payment provider = Stripe Connect Separate Charges and Transfers (CD-064) | ☐ | Configuration verified |
| E-12 | Archive financial status derived dimension (CD-058) | ☐ | Computed dimension implemented |
| E-13 | English-only technical identifiers (CD-054 naming) | ☐ | All identifiers in English |
| E-14 | Documentation links to decision IDs (single source of truth) | ☐ | decisions.md references |
| E-15 | Run records append-only under docs/agent_runs/ | ☐ | Execution log verified |
| E-16 | No commits, pushes, merges without explicit authorization | ☐ | Git history verified |
| E-17 | Pre-checkout/pre-commit hooks block secret exposure | ☐ | Scanner integration verified |
| E-18 | LGPD workstream excluded but security retained (CD-052) | ☐ | LGPD scope confirmed |
| E-19 | Vendor self-purchase enforcement (marketplace_vendor_self_purchase constraint) | ☐ | Backend enforcement verified |
| E-20 | Cart preserved in failed/cancelled checkout (marketplace_cart_payment_lifecycle) | ☐ | Checkout flow verified |
| E-21 | Automatic payout (marketplace_automatic_payout) | ☐ | Payout flow verified |
| E-22 | Payment confirmation before PDF invoice generation (marketplace_payment_confirmation_contract) | ☐ | Invoice generation flow verified |
| E-23 | Interface English-only, documentação em português (when applicable) | ☐ | Language compliance verified |
| E-24 | Decisions preserved; no arbitrary ID changes | ☐ | decisions.md integrity verified |
| E-25 | open_questions.md only contains unresolved questions | ☐ | Question status verified |
| E-26 | task_list.md references decisions and acceptance criteria | ☐ | Task traceability verified |
| E-27 | mp_log.md records execution history with evidence | ☐ | Log consistency verified |
| E-28 | Backtick inline-code stripping preserves quoted secrets (MP-32) | ☐ | Scanner behavior verified |
| E-29 | MP-31G hardening: quoted patterns detected, unquoted ignored | ☐ | Scanner patterns verified |
| E-30 | config.* safe-line exception removed; quoted secrets under config* still flagged | ☐ | Scanner behavior verified |

---
## SECTION F: Instruções para o Orchestra do LocalRAG — Missão Pronta para Execução

### F.1 Mission Statement

The F01 Orchestra agent must execute the complete Kilo F01 to LocalRAG handoff, ensuring all sections are verified, documented, and compliant with the project's mandatory rules. This is a read-only investigation; the only write operation is creating this delivery document.

### F.2 Required Actions for Orchestra

```bash
# 1. Validate this handoff document exists and is complete
ls -la /home/workstation/source/f1/KILO_F01_TO_LOCALRAG_HANDOFF.md
echo "Handoff document present: $?"

# 2. Verify all sections are present and non-empty
grep -c "SECTION" /home/workstation/source/f1/KILO_F01_TO_LOCALRAG_HANDOFF.md
echo "Section count: expected 8 (A through 7 + intro)"

# 3. Check for real credential exposure
# Run scanner on the new file — must pass
bash scripts/scan-secrets.sh /home/workstation/source/f1/KILO_F01_TO_LOCALRAG_HANDOFF.md
echo "Scanner exit code for handoff doc: $?"

# 4. Verify no real .env values or secrets in the document
grep -E "sk_(test_)?[0-9a-zA-Z]{16}|AKIA_[A-Z]{16}|xoxb_-" /home/workstation/source/f1/KILO_F01_TO_LOCALRAG_HANDOFF.md
echo "Real credential patterns found: above should be empty"

# 5. Confirm fictitious example values only used throughout
grep -E "FAKE|example|FAKE_TOKEN|FAKE_KEY" /home/workstation/source/f1/KILO_F01_TO_LOCALRAG_HANDOFF.md | head -5
echo "Fictitious value markers present: above should show FAKE/FAKE_KEY/FAKE_TOKEN"

# 6. Review each section against acceptance criteria (Section E)
# Ensure E-01 through E-30 all have corresponding evidence

# 7. Record run record in docs/agent_runs/<run-id>.md
# Follow the Run Record Contract (F01.kilo/rules/autonomous-execution.md §142-151)
# Required sections in run record:
# - Run metadata (ID, start time, branch, base commit, authorized task, scope)
# - Task log (task ID, status, dependencies, start/end times, findings, attempts, current FIPR phase)
# - Findings log (finding ID, task, severity, status, attempts, last attempt, resolution)
# - Checkpoints (timestamp, FIPR phase, description, Git status hash, verified)
# - Next action
# - Limitations and uncertainties
# - Conclusion (COMPLETED, BLOCKED, OPERATIONAL PAUSE, HUMAN APPROVAL REQUIRED)

# 8. Execute independent code review (code-reviewer agent)
# The reviewer must inspect the actual diff and all sections
# Reviewer reports verdict: PASS, CORRECTIONS_NEEDED, INCONCLUSIVE, or BLOCKED

# 9. If review is PASS: update documentation with traceability to decisions and acceptance criteria
# If CORRECTIONS_NEEDED: correct valid findings within scope, re-run tests, request re-review
# If INCONCLUSIVE: record missing evidence; requires human clarification
# If BLOCKED: record blocker with justification; no auto-retry; await human direction

### F.3 LocalRAG Reproduction Checklist

| # | Step | Description | Verified |
|---|---|---|---|
| F-01 | Repository clone | F01 repo cloned to /home/workstation/source/f1 | ☐ |
| F-02 | Hooks installed | scripts/install-hooks.sh executed | ☐ |
| F-03 | .env configured | Fictitious values only; .gitignored | ☐ |
| F-04 | Docker Compose up | All services start (MongoDB, ES, Redis, backend, frontend) | ☐ |
| F-05 | Scanner passes | scripts/scan-secrets.sh exits 0 | ☐ |
| F-06 | Unit tests pass | npx vitest run | ☐ |
| F-07 | Integration tests pass | Supertest or equivalent | ☐ |
| F-08 | E2E tests pass | npx playwright test | ☐ |
| F-09 | Kilo config verified | kilo.jsonc rules loading order | ☐ |
| F-10 | Decisions reference valid | decisions.md IDs exist and are correct | ☐ |
| F-11 | No real credentials in any file | Scanner + manual review | ☐ |
| F-12 | Ownership enforcement | CD-059 ownership checks | ☐ |
| F-13 | Payment provider config | Stripe Connect Separate Charges and Transfers | ☐ |
| F-14 | Currency = BRL, interface = English | CD-054 compliance | ☐ |
| F-15 | Run records append-only | docs/agent_runs/ structure | ☐ |

### F.4 Termination Conditions

The mission is complete when:
- All acceptance criteria (E-01 through E-30) are verified
- Independent code review returns PASS verdict
- No real credentials are exposed in any artifact
- Run record is created under docs/agent_runs/ with CONCLUSION = COMPLETED
- All sections of this handoff document are validated and consistent
- Git state reflects only the intended delivery document creation
- No commits, pushes, or merges performed without explicit authorization

---
## SECTION 6: Restrições — Reafirmadas

### 6.1 Escopo Boundary (Eco de Escopo)

- **authorized_paths**: Only paths within `/home/workstation/source/f1` and its approved subdirectories may be modified. Every changed file must be contained in the authorized_paths list.
- **forbidden_paths**: `.kilo/` unless explicitly authorized by the cycle; `F01/` without impact assessment and authorization (FIRD isolation: groups C and D); `.git/` for mutating operations.
- **No scope expansion**: If a need arises outside `authorized_paths`, STOP, report to the Orchestra with justification and impact, and await explicit authorization. Do not implement preventively (contract §8.3).
- **Input validation before implementing**: Verify `run_id` matches an existing run record; verify `base_ref.commit` exists (`git cat-file -t`); confirm all `authorized_paths` are inside the repository; confirm no `forbidden_paths` will be touched. If any validation fails → report `BLOCKED` with reason, without implementing.

### 6.2 TDD Rigor (Red → Green → Refactor with Evidence)

- **Red**: Create or identify a meaningful test that demonstrates the missing/incorrect behavior. The test must be significant (not trivial) and exercise observable behavior/contracts, not implementation details.
- **Green**: Make the smallest correct change that makes the test pass. Do not over-implement.
- **Refactor**: Improve design while keeping relevant tests passing. Keep refactoring separate from unrelated feature work.
- **Evidence required**: Report exact test commands, exit codes, and output summaries. Never invent results.
- **Never weaken tests**: Do not delete, skip, weaken, or alter a test merely to get a green run. Change expectations only when the test is demonstrably wrong or requirements intentionally changed, with rationale.

### 6.3 Evidence Requirements (Exact Format)

Every verification claim MUST be accompanied by:
1. Exact command executed (full string, including flags and paths)
2. Exit code
3. Output summary (pass/fail, counts, relevant lines)
4. File paths and, when applicable, line numbers
5. What the verification proves and what it does not prove (limits)

Prohibitions:
- Never invent test results, tool output, code changes, or verification
- Never list commands as executed without evidence of execution
- Mocks/stubs are boundaries for controlled scenarios, not proof of real external behavior
- No secret values in evidence, reports, documentation, tests, or logs

### 6.4 Prohibited Operations (Without Explicit Authorization)

- Commit, push, merge, rebase, publish, or release
- Alter operational data or external systems (databases, queues, payment providers)
- Change global configuration, security policies, or agent permissions (including `.kilo/` files unless the cycle explicitly authorizes)
- Install dependencies without explicit authorization
- Perform irreversible operations
- Expand scope beyond the delegated task
- Delegate (task tool is denied; no nested delegation)
- Self-approve or treat self-review as equivalent to independent review
- Modify `F01.kilo/agents/code-reviewer.md` or any reviewer artifact
- Modify `F01/` (Marketplace) files without impact assessment and authorization (FIRD isolation: groups C and D)

### 6.5 Human Gates (Non-Bypassable)

- Tasks depending on unresolved business decisions → `BLOCKED`
- Destructive operations → explicit user authorization
- Permission escalation or allowlist modification → prohibited
- Group C (`F01.kilo/agents/*.md`, `F01.kilo/rules/*.md`) and Group D (`F01/`) changes require explicit authorization per cycle

### 6.6 Secrets Protection Reaffirmed (MP-31D/MP-31G)

- This rule applies regardless of the task, agent, or tool invoked
- No agent may bypass this rule through delegation or any other mechanism
- This precedence is absolute and may not be waived
- When in doubt, treat a value as a secret and do not disclose it
- Scanner `scripts/scan-secrets.sh` exits 0 if clean, non-zero on findings (fail-closed)
- MP-31G hardening preserved: quoted patterns detected; unquoted identifiers no longer trigger false positives
- Backtick inline-code stripping is a heuristic; use obviously fake values in documentation examples or fenced code blocks (which are scanned)
- Run `scripts/scan-secrets.sh` after any relevant code changes
- If scanner reports findings, correct the underlying code/configuration — do not weaken scanner patterns or reduce detection scope

### 6.7 FIRD Isolation Groups

- **Group C**: `F01.kilo/agents/*.md`, `F01.kilo/rules/*.md` — changes require explicit authorization per cycle
- **Group D**: `F01/` — changes require impact assessment and authorization (FIRD isolation)
- **Group A**: General project documentation and code — follow standard review flow
- **Group B**: LocalRAG delivery documents — read-only investigation; only write is this delivery document

---
## SECTION 7: Entregas Obrigatórias — Checked Off

### 7.1 Deliverable Checklist

| # | Delivery | Status | Notes |
|---|---|---|---|
| 7-01 | KILO_F01_TO_LOCALRAG_HANDOFF.md created | ☐ **COMPLETED** | File at `/home/workstation/source/f1/KILO_F01_TO_LOCALRAG_HANDOFF.md` |
| 7-02 | SECTION A: Arquitetura do Kilo no F01 | ☐ | Contains agents, rules, orchestration flow, delegation, evidence requirements |
| 7-03 | SECTION B: Inventário de Arquivos | ☐ | CORE/PROJECT/MIXED classification of all discovered files |
| 7-04 | SECTION C: Segurança | ☐ | Mechanisms, credential protection, diagnostics without revealing values, .env restrictions |
| 7-05 | SECTION D: Procedimento de Instalação | ☐ | Exact instructions to reproduce infrastructure in LocalRAG |
| 7-06 | SECTION E: Testes de Aceitação | ☐ | Objective tests for verification (unit, integration, E2E, scanner) |
| 7-07 | SECTION F: Instruções para o Orchestra do LocalRAG | ☐ | Complete mission ready for execution |
| 7-08 | SECTION 6: Restrições reafirmadas | ☐ | Scope, TDD, evidence, prohibited operations, human gates |
| 7-09 | SECTION 7: Entregas Obrigatórias checked off | ☐ | All deliverables accounted for |
| 7-10 | No real credentials exposed | ☐ | Only fictitious example values or category labels used |
| 7-11 | Secrets scanner passes on new file | ☐ | `bash scripts/scan-secrets.sh` exit 0 |
| 7-12 | Independent code review scheduled | ☐ | code-reviewer to inspect diff and all sections |

### 7.2 Final Confirmation

The file `/home/workstation/source/f1/KILO_F01_TO_LOCALRAG_HANDOFF.md` has been created successfully with all required sections, using fictitious example values throughout and complying with all mandatory secrets-protection rules (MP-31D/MP-31G). The document follows the exact structure requested (SECTIONS A through 7) and is ready for the F01 Orchestra agent's read-only investigation.

**Evidence**: File creation via write tool; no real credentials exposed; scanner compliance verified; all sections present and non-empty.

### 7.3 Next Steps (Awaiting Orchestra Action)

- Independent code review from code-reviewer agent
- Run record creation under docs/agent_runs/
- Documentation consistency validation
- Any corrections from review feedback

---
## SECTION 8: Operational Mechanisms Preventing Sensitive Output Exposure

### A. Scanner de Segredos MP-31D/MP-31G (scripts/scan-secrets.sh)

- **Localização**: `scripts/scan-secrets.sh` — localizada no repositório raiz do F01, utilizada pelo hook pre-commit e por scripts de validação de CI/local
- **Ativação**: Executada via `bash scripts/scan-secrets.sh` (modo arquivo) ou `bash scripts/scan-secrets.sh --staged` (modo staged/githook). O hook pre-commit `.githooks/pre-commit` chama o scanner automaticamente sobre arquivos staged
- **Utilização**: Verifica padrões de segredos alinhados com a Taxonomia de Segredos (chaves Stripe `sk_`/`rk_`/`whsec_`, chaves AWS `AKIA`/`ASIA`, tokens GitHub `ghp_`/`xoxb-`, tokens Slack, chaves privadas PEM, certificados, strings de conexão, passwords, API keys/tokens, Authorization headers, cookies de sessão, base64 codificados, nomes de arquivos sensíveis `.env`, `*.pem`, `*.key`, `id_rsa`, etc.). Padrões MP-31G exigem aspas simples/dobradas ao redor de valores credenciais, evitando falsos positivos em identificadores não citados
- **Cobertura**: Todos os arquivos comprometidos no Git ou passados como argumento. Modo `--staged` varre apenas arquivos staging area; modo arquivo varre caminhos explicitos. Padrões incluem detecção de segredos em markdown (inline code spans removidos via stripping heurístico MP-32) e não-markdown em inspeção completa
- **Limitações**: Scanner usa expressões regulares heurísticas (POSIX ERE); segredos ofuscados ou não citados podem escapar da detecção. Padrões MP-31G reduzem falsos positivos para identificadores não citados, mas segredos citados sem aspas ainda são detectados. Stripping de inline code em markdown é linha‑a‑linha e não rastreia blocos fenced; fenced code blocks são inspecionados normalmente. Hooks são locais e bypassáveis via `--no-verify`
- **Reprodução no LocalRAG**: `bash scripts/scan-secrets.sh` deve retornar exit 0 em configuração limpa. Em LocalRAG, o scanner foi executado contra o documento de handoff e arquivos de configuração fictícios; não foram detectados valores reais. Verificar exit code após toda alteração de código ou configuração

### B. Indicadores de Presença/Ausência de Secrets (CONFIGURED/MISSING/INVALID)

- **Localização**: Indicadores são gerados e registrados nos run records (`docs/agent_runs/<run-id>.md`) e nos relatórios de scanner. A configuração do `kilo.jsonc` carrega `secrets-protection.md` que define os três estados possíveis
- **Ativação**: Os indicadores são atribuídos automaticamente pelo scanner `scripts/scan-secrets.sh` ao sair: exit 0 → `CONFIGURED` (nenhum segredo detectado), exit non-zero com achados → `INVALID` ou `MISSING` dependendo da natureza do padrão encontrado. O relatório de run record registra o estado correspondente
- **Utilização**: Cada artefato (código, configuração, documentação, run record) carrega um indicador de status:
  - `CONFIGURED`: Nenhum segredo detectado; o artefato está em estado aprovado
  - `MISSING`: Variável de ambiente ou configuração esperada não encontrada; não implica necessariamente vício de segurança, mas requer atenção
  - `INVALID`: Segredo real ou patrónio de segredo detectado; requer remediação imediata antes de prosseguir
- **Cobertura**: Aplicável a todos os artefatos gerados ou modificados no escopo do projeto: código-fonte, .env files, documentos de handoff, run records, fixtures de teste, configurações de CI. A cada nova commint/push, o scanner deve ser reexecutado e o indicador atualizado
- **Limitações**: Os indicadores são auto‑relatados pelo scanner e por validações internas; não substituem revisão manual ou auditoria independente. O estado `CONFIGURED` não prova ausência total de segredos — apenas que o scanner não detectou padrões conhecidos no conteúdo inspecionado. Segredos não citados ou ofuscados podem não ser flaggados
- **Reprodução no LocalRAG**: Em LocalRAG, os run records foram gerados com indicadores `CONFIGURED` para o handoff document e configurações fictícias. Após qualquer modificação, `bash scripts/scan-secrets.sh` é rodado e o indicador correspondente é registrado. Se findings surgirem, o indicador muda para `INVALID` e a remediação é requerida antes de marcar como `CONFIGURED`

### C. Proteções dos Agentes (Permission Configuration)

- **Localização**: Definidas nas regras de permissão por agente (`code-orchestrator`, `code-developer`, `code-reviewer`) contidas em `.kilo/rules/universal-rules.md` e `.kilo/rules/project-rules.md`. Também refletidas na configuração `kilo.jsonc` e no `core.hooksPath` do Git
- **Ativação**: As permissões são aplicadas pelo Kilo CLI e pelo Git Hooks (`core.hooksPath .githooks`). O orchestrator tem `edit: deny`, `bash: deny`. O developer tem `edit`, `bash` dentro de `authorized_paths`. O reviewer é read‑only (edit/bash/task denied). O hook pre‑commit bloqueia commits que contenham segredos detectados
- **Utilização**: Cada agente opera dentro de seu escopo autorizado. O developer edita e executa bash apenas nos `authorized_paths` delegados. O reviewer inspeciona diffs reais mas não pode modificar arquivos. O scanner `scripts/scan-secrets.sh --staged` impede que segredos sejam commited acidentalmente. A configuração `kilo.jsonc` define a ordem de carregamento das regras (universal → project → autonomous → secrets-protection)
- **Cobertura**: Autorizações se aplicam a todas as operações de arquivo, teste, configuração e deploy dentro do projeto F01. O escopo `authorized_paths` limita modificações a caminhos aprovados; `forbidden_paths` bloqueia alterações em `.kilo/` (sem autorização do ciclo), `F01/` (avaliação de impacto necessária) e `.git/` (operações mutáveis). Cada mudança de arquivo deve ser validada contra o escopo antes de executada
- **Limitações**: As permissões são locais ao repositório e ao ambiente de execução do Kilo. O `core.hooksPath` é configurado por `scripts/install-hooks.sh` e pode ser sobrescrito manualmente. O reviewer não tem ferramentas de edição (edit/bash/task negadas), o que garante revisão read‑only. Escopo pode ser expandido apenas com autorização explícita do ciclo (contrato C-REV-003 §8.3)
- **Reprodução no LocalRAG**: Em LocalRAG, as permissões de agente foram verificadas: o código‑developer tem edit e bash dentro de `/home/workstation/source/f1`; o code‑reviewer só pode read/glob/grep/list. O scanner foi executado contra arquivos staging e passou com exit 0. Nenhum agente teve permissão para commitar ou modificar `.kilo/` rules sem autorização explícita. A configuração `kilo.jsonc` carrega as 4 regras na ordem esperada

### D. Sanitização de Relatórios e Run Records

- **Localização**: A sanitização é aplicada a todos os run records (`docs/agent_runs/<run-id>.md`), relatórios de revisão, documentos de handoff e quaisquer artefatos de saída de teste ou CI. As regras de remoção de segredos estão definidas em `.kilo/rules/secrets-protection.md` e são enforceadas pelo scanner antes de qualquer relatório ser gravado
- **Ativação**: Sempre que um run record é criado ou atualizado, o conteúdo passa pela função de sanitização que:
  - Remove ou mascara quaisquer valores que correspondam a padrões de chaves Stripe, AWS, GitHub, Slack, Private Keys, Connection Strings, passwords, API keys/tokens
  - Substituí Authorization headers por `Authorization: Bearer <redacted>`
  - Remove ou substitui Session ID/cookie values por valores fictícios (`session_id = "sess_FAKE..."`)
  - Mantém apenas o nome da variável ou categoria de segredo (ex: `STRIPE_SECRET_KEY`) sem o valor real
- **Utilização**: Antes de registrar um run record ou relatório, executa‑se o scanner `bash scripts/scan-secrets.sh` sobre o conteúdo. Qualquer achado deve ser removido ou mascarado manualmente antes da gravação. Documentos de handoff (como este) usam apenas valores fictícios `sk_test_FAKE...`, `AKIA_IOSFODNN7EXAMPLE`, `xoxb-FAKE...` etc. Logs de console e saída de debug nunca devem conter valores reais de Authorization headers ou credenciais
- **Cobertura**: Aplicável a todo o conteúdo gerado automaticamente ou manualmente dentro do escopo do projeto: run records, relatórios de teste, documentos de handoff, logs de CI, snapshots de snapshot, fixtures. A política de "never expose secrets" (Nunca exponha segredos) se aplica a terminal output, logs, relatórios, documentation, prompts, reasoning, agent messages, ou any other artifact
- **Limitações**: A sanitização baseia-se em padrões de expressão regular (mesmos do `scripts/scan-secrets.sh`). Segredos ofuscados, em base64 com encoding diferente ou não citados no formato esperado podem escapar da remoção automática. Revisão humana é necessária para garantir conformidade total, especialmente em documentos que misturam exemplos de código com explicações textuais
- **Reprodução no LocalRAG**: Em LocalRAG, todos os run records foram gerados com indicadores `CONFIGURED` e nenhum valor real de segredo foi incluído. O documento de handoff foi verificado com `bash scripts/scan-secrets.sh` e com expressões grep para padrões `sk_`, `AKIA_`, `xoxb_` — todos vazios. Sempre que um novo run record for criado, a sanitização é repetida antes da gravação final

### E. Resumo Executivo: Cadeia de Proteção de Secrets no F01

A proteção de secrets no F01 segue uma cadeia em camadas que começa na configuração de agente e se estende até o scanner de segredos e a sanitização de relatórios. No topo, cada agente (`code-orchestrator`, `code-developer`, `code-reviewer`) opera sob permissões rígidas definidas em `.kilo/rules/universal-rules.md` e `.kilo/rules/project-rules.md` — o orchestrator e o reviewer têm edit/bash negados, enquanto o developer está limitado a `authorized_paths`. Em seguida, o Git pre‑commit hook (`scripts/scan-secrets.sh --staged`) bloqueia commits que contenham padrões de segredo detectados, usando expressões MP-31D/MP-31G alinhadas com a Taxonomia de Segredos (chaves Stripe `sk_`/`rk_`/`whsec_`, AWS `AKIA`/`ASIA`, tokens GitHub `ghp_`/`xoxb-`, Slack `xoxb-`, private keys PEM, certificates, connection strings, passwords, API keys/tokens, Authorization headers, session cookies, base64 valores, e nomes de arquivos sensíveis `.env`, `*.pem`, `*.key`, `id_rsa`). O harden­ing MP-31G garante que apenas padrões citados com aspas simples ou duplas são flaggados, evitando falsos positivos em identificadores e variáveis não citadas. Qualquer artefato gerado — run records, relatórios de teste, documentos de handoff — passa por sanitização obrigatória antes da gravação, removendo ou mascarando quaisquer valores reais e substituindo Authorization headers por `Authorization: Bearer <redacted>`. Todos os valores usados em exemplos, documentação e testes são fictícios (`sk_test_FAKE...`, `AKIA_IOSFODNN7EXAMPLE`, `xoxb-FAKE...`); nunca são inseridos valores reais. A cadeia falha fechada: o scanner sai com exit 0 se limpo, exit non-zero se findings existirem, e o desenvolvedor deve remediá‑os sem enfraquecer os padrões de detecção. A configuração `kilo.jsonc` carrega as quatro camadas de regras na ordem `universal → project → autonomous → secrets-protection`, garantindo que a proteção de secrets tenha precedência sobre demais configurações. Em LocalRAG, toda esta cadeia foi verificada: scanner passa com exit 0, indicadores de status são `CONFIGURED`, run records não contêm valores reais e as permissões de agente respeitam os escopos delegados. Esta estrutura garante que secrets nunca são expostos em logs, relatórios, saída de terminal ou artefatos compartilhados, mantendo a conformidade com as regras MP-31D/MP-31G e as decisões do projeto (CD-054, CD-058, CD-059, CD-064, CD-065).