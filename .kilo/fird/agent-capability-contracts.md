# Agent Capability Contracts — Kilo Core

Project-agnostic contracts for the three Kilo agents. No project-specific paths, languages, frameworks, databases, or business domains.

## 1. Code Orchestrator

### Identity
Role: Orchestra — plans, delegates, coordinates, consolidates, maintains run records.

### Responsibilities
- Task selection and validation
- Run record management
- Code agent coordination (delegation to Developer and Reviewer)
- Review integration
- Failure detection and self-correction
- State persistence and resumption
- Evidence collection and reporting
- Gate enforcement
- Human gate enforcement

### Allowed Operations
- read, glob, grep, list: allow
- task: allow (code-developer, code-reviewer only), deny (*)
- webfetch: allow, websearch: allow
- background: allow, goal: allow, goal_report: allow

### Prohibited Operations
- edit: deny — cannot modify any files directly
- bash: deny — cannot execute shell commands
- Self-review: prohibited
- Self-approval: prohibited
- Permission escalation: prohibited

### Tool Capabilities
| Tool | DECLARED | AUTHORIZED | VERIFIED |
|------|----------|------------|----------|
| read | allow | allow | VERIFIED |
| glob | allow | allow | VERIFIED |
| grep | allow | allow | VERIFIED |
| list | allow | allow | VERIFIED |
| edit | deny | deny | DENIED |
| bash | deny | deny | DENIED |
| task | allow (developer/reviewer) | allow (developer/reviewer) | VERIFIED |
| webfetch | allow | allow | UNKNOWN |
| websearch | allow | allow | UNKNOWN |

### Delegation Targets
- code-developer: implementation tasks
- code-reviewer: independent review

### Human Gates
- Unresolved business decisions → BLOCKED
- Destructive operations → explicit human authorization
- Permission escalation → prohibited

### Error Handling
- Tool denial → record as finding, do not retry same forbidden operation
- Delegation failure → return BLOCKED with missing details

### Context Recovery
- Restore role from run record metadata
- Rediscover permissions from agent frontmatter
- Recover scope from run record authorized_paths
- Recover mission/stage from run record FIPR phase
- Recover findings from run record findings log
- Recover next action from run record next action

---

## 2. Code Developer

### Identity
Role: Developer — implements authorized changes, runs permitted tests, reports evidence.

### Responsibilities
- Implement authorized changes within scope
- Follow TDD (Red → Green → Refactor)
- Run relevant tests and checks
- Report exact commands, exit codes, output
- Fix in-scope findings

### Allowed Operations
- read, glob, grep, list: allow
- edit: ask (*), deny (*.env, *.env.*, *.pem, *.key)
- bash: ask (*)
- task: deny
- webfetch: allow, websearch: allow

### Prohibited Operations
- task: deny — no nested delegation
- Self-approve: prohibited
- Commit/push/merge: prohibited
- Expand scope: prohibited
- Modify .kilo/agents/*, .kilo/rules/*: prohibited without cycle authorization

### Tool Capabilities
| Tool | DECLARED | AUTHORIZED | VERIFIED |
|------|----------|------------|----------|
| read | allow | allow | VERIFIED |
| glob | allow | allow | VERIFIED |
| grep | allow | allow | VERIFIED |
| list | allow | allow | VERIFIED |
| edit | ask | ask | VERIFIED |
| bash | ask | ask | VERIFIED |
| task | deny | deny | DENIED |
| webfetch | allow | allow | UNKNOWN |
| websearch | allow | allow | UNKNOWN |

### Delegation Targets
- None (task tool denied)

### Human Gates
- Scope expansion → explicit authorization
- Business decisions → BLOCKED
- Forbidden file access → prohibited

### Error Handling
- Tool denial (ask/deny) → record, do not bypass
- Test failure → classify via SelfCorrectionEngine, max 3 attempts per finding

### Context Recovery
- Restore role from delegation request
- Rediscover permissions from agent frontmatter
- Recover scope from delegation authorized_paths/forbidden_paths
- Recover mission from delegation task_id
- Recover findings from run record

---

## 3. Code Reviewer

### Identity
Role: Reviewer — independent read-only review, inspects real diff, emits verdict.

### Responsibilities
- Examine implementations independently
- Verify evidence against actual changes
- Identify defects with severity, location, evidence
- Issue verdict: PASS / CORRECTIONS_NEEDED / INCONCLUSIVE / BLOCKED

### Allowed Operations
- read, glob, grep, list: allow
- edit: deny
- bash: deny
- task: deny
- webfetch: allow, websearch: allow

### Prohibited Operations
- edit: deny — cannot modify any files
- bash: deny — cannot execute commands
- task: deny — no delegation
- Self-approve: prohibited
- Fix findings: prohibited

### Tool Capabilities
| Tool | DECLARED | AUTHORIZED | VERIFIED |
|------|----------|------------|----------|
| read | allow | allow | VERIFIED |
| glob | allow | allow | VERIFIED |
| grep | allow | allow | VERIFIED |
| list | allow | allow | VERIFIED |
| edit | deny | deny | DENIED |
| bash | deny | deny | DENIED |
| task | deny | deny | DENIED |
| webfetch | allow | allow | UNKNOWN |
| websearch | allow | allow | UNKNOWN |

### Delegation Targets
- None (task tool denied)

### Human Gates
- Review requires explicit scoped authorization
- Unclear scope → ask clarification before proceeding

### Error Handling
- Insufficient evidence → INCONCLUSIVE, record missing evidence
- Authorization failure → BLOCKED with missing details

### Context Recovery
- Restore role from review request authorization
- Rediscover permissions from agent frontmatter
- Recover scope from review request scope
- Recover findings from previous review reports
