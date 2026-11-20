# Capability Register — FS-01 Marketplace

Single source of truth for FS-01 capabilities. Each entry documents tool availability, authorized agents, permitted and prohibited operations, scope, security requirements, and verification methods.

---

| # | Tool ID | Nome real | Provedor | Disponibilidade | Agentes autorizados | Operações permitidas | Operações proibidas | Escopo | Permissões exigidas | Riscos de segurança | Exige aprovação humana | Método de verificação | Fallback autorizado |
|---|---------|-----------|----------|-----------------|---------------------|----------------------|---------------------|--------|---------------------|---------------------|------------------------|----------------------|---------------------|
| 1 | T-001 | Task delegation | Orchestration | AVAILABLE | code-orchestrator | Create, assign, track tasks | — | Project-wide task management | Read/write access to task records | Risk of scope creep if unauthorized tasks assigned | Yes — task creation outside authorized phase | Reviewer independent verdict | BLOCKED task if phase limit exceeded |
| 2 | T-002 | File edit | native edit | AVAILABLE | code-developer | Modify files within authorized_paths | Modify files outside authorized_paths | File-level changes within P4 scope | Read/write access to authorized file paths | Risk of unintended changes to production code | Yes — changes outside scope require human approval | Diff review against base ref | Read-only git inspection |
| 3 | T-003 | Code review | code-reviewer | AVAILABLE | code-reviewer | Inspect diff, verify tests, identify findings | Alter business requirements, invent scope | Independent review of all executable changes | Read access to diff and test results | Risk of missing subtle defects | Yes — all findings must be addressed | Compare against acceptance criteria | Self-review does not substitute independent review |
| 4 | T-004 | Secret scanning | scan-secrets.sh | AVAILABLE | code-developer | Scan staged or specified files for secrets | — | Repository secret hygiene | Read access to file system | False positives on unquoted identifiers (MP-31G); may miss obfuscated secrets | No — informational only; remediate if findings reported | Exit code 0 = clean, non-zero = findings | Manual review of scanner output |
| 5 | T-005 | Browser automation | Playwright | TEMPORARILY FAILED | — | E2E test execution | — | End-to-end test validation | — | Not available in current P4 scope; blocked by phase authorization | No — out of scope | Playwright test runner | Available upon P5 authorization |
| 6 | T-006 | Git operations | native git | AVAILABLE | code-orchestrator, code-developer (read-only) | Inspect ref, diff, index; read-only operations | Mutating operations (commit, push, merge, rebase) without explicit authorization | Repository inspection and diff generation | Read access to git repository | Risk of accidental history rewrite; force-push prohibited | Yes — mutating operations require explicit user authorization | Read-only git commands (cat-file, show, diff) | P4 scope limits to read-only git |
| 7 | T-007 | Test execution | native test | AVAILABLE | code-developer | Unit, integration, regression tests | Skip, weaken, or alter tests to get green run | Behavioral verification within authorized scope | Read/write access to test suite | Risk of false confidence if tests are weakened | Yes — deleting/skipping tests to achieve pass is prohibited | Run tests and report exact results; distinguish passed/failed/skipped | Re-add regression test for any defect fixed |
| 8 | T-008 | Configuration read | native read | AVAILABLE | code-developer | Read config files, .env (masked), environment variables | Print, expose, or hardcode real credential values | Project configuration inspection | Read access to configuration files | Risk of secret exposure if config values are leaked | No — read only; values must be masked | Verify variable name exists without value exposure | Use environment variable names only |
| 9 | T-009 | Documentation consistency | doc-review | AVAILABLE | code-developer, code-reviewer | Verify links, IDs, traceability, confirmed decisions | Invent, arbitrarily renumber, or silently change existing IDs | Documentation integrity and single source of truth | Read access to documentation files | Risk of doc-code divergence; contradictory docs | No — consistency check only | Link validation; ID reference verification | Reference decisions.md for authoritative decisions |
| 10 | T-010 | Memory recall | kilo_memory_recall | AVAILABLE | code-developer | Search typed memory, session digests, catalog entries | — | Project memory queries | Read access to memory files | Risk of accessing stale or corrupted memory entries | No — read-only memory queries | Query by topic/query term; verify against current repo state | Memory cache fallback |

---

## Availability Designations

- **AVAILABLE** — Tool is operational and accessible to the agent within its authorized scope
- **UNAVAILABLE** — Tool exists but is not accessible or functional for this agent type
- **UNAUTHORIZED** — Agent is explicitly prohibited from using this tool (scope violation of authorized_paths/forbidden_paths)
- **KNOWN** — Tool status has been determined (note: register uses "AVAILABLE"/"UNAVAILABLE", not "KNOWN")
- **TEMPORARILY FAILED** — Tool is experiencing transient issues; may become available later (e.g., T-005 Browser automation)
- **DISABLED BY POLICY** — Tool is restricted by security policy or compliance requirements; permanent restriction until policy change

## Security Requirements

- All tool operations must respect the `authorized_paths` and `forbidden_paths` defined in the delegation contract (`F01.kiro/fird/contratos-delegacao.md` §2).
- No agent may commit, push, merge, rebase, or publish without explicit user authorization (universal-rules §13.4).
- Secret values must never be hardcoded, printed, or exposed in reports, documentation, tests, or logs (F01.kilo/rules/secrets-protection.md).
- Independent review from code-reviewer is mandatory for all changes to executable artifacts (project-rules.md §A).
- Human approval is required for: task creation outside authorized phase, mutating git operations, and test modifications to achieve pass.

## Verification Methods

- **Exit code 0**: Tool execution completed successfully (clean scans, passing tests)
- **Exit code non-zero**: Tool found findings or operational failures (scanner failures, test failures)
- **Diff review**: Changeset compared against base reference and acceptance criteria
- **Independent verdict**: Code reviewer must issue explicit verdict (PASS, CORRECTIONS_NEEDED, INCONCLUSIVE, BLOCKED)
- **Memory query validation**: Results cross-checked against current repository state and decisions.md

## Fallback Authorized Fallbacks

- T-002: Read-only git inspection (`git cat-file`, `git show`, `git diff`) when file edit is restricted
- T-004: Manual review of scanner output when automated scan cannot run
- T-006: Read-only git commands when mutating operations are unauthorized
- T-007: Re-add regression test for any defect fixed; document rationale if test cannot be re-added
- T-008: Use environment variable names only; never print real values
- T-010: Query by topic/query term; verify against current repo state and decisions.md

---

*This register is the single source of truth for FS-01 capabilities. It is maintained under the project rules defined in F01.kilo/rules/project-rules.md and F01.kilo/fird/contratos-delegacao.md. Last updated: 2026-11-11.*