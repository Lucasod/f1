# Project-Specific Rules — FS-01 Marketplace

## Technical Naming Language

All technical identifiers MUST use English. This includes variables, functions, classes, interfaces, types, methods, modules, domain model names, database fields and collection names, API routes and payload fields, test names, and other identifiers used by the software.

Domain concepts in code MUST use consistent English terminology.

Documentation, explanations, comments, commit messages, and user-facing text MAY use Portuguese unless a separate project requirement says otherwise.

Follow established framework and library conventions when naming identifiers.

## Documentation Linking and Single Source of Truth

- **Every document must have a clearly defined responsibility.** Avoid unnecessary duplication of information across documentation files.
- **Maintain a single source of truth** for each decision, requirement, rule, or technical specification. Other documents must reference the authoritative source instead of reproducing its full content.
- Use stable, existing IDs to link related decisions, open questions, tasks, conceptual models, and execution logs whenever applicable.
- Maintain relative links between Markdown documents and other linkable project artifacts whenever supported.
- The `F01/README.md` should serve as the documentation entry point, providing a concise project overview and links to relevant documents.
- `decisions.md` is the authoritative record of approved decisions, including their rationale and any relevant constraints.
- `open_questions.md` tracks only unresolved questions, including partially resolved questions with their remaining subquestions, and technical decisions deferred for future work when they still require attention.
- Fully resolved questions should be removed from `open_questions.md` only after verifying that their confirmed decisions are recorded in `decisions.md` and that no unresolved subquestions remain.
- Preserve traceability by recording the original question ID in `decisions.md` when a decision resolves that question, and reference existing decision IDs from `open_questions.md` for any remaining unresolved subquestions.
- Do not remove unresolved portions of a partially resolved question or discard unique context, constraints, or rationale needed to understand the remaining work.
- `task_list.md` tracks work items and should reference the decisions, requirements, and acceptance criteria relevant to each task.
- `mp_log.md` records execution history, outcomes, evidence, and references to the tasks and decisions involved.
- Conceptual diagrams should reference relevant decision IDs when practical and supported by the diagram format.
- Do not invent, arbitrarily renumber, or silently change existing IDs. Verify that referenced IDs exist and point to the correct records.
- Before removing duplicated content, identify the authoritative source and preserve any unique information, constraints, rationale, or operational instructions.
- Avoid excessive cross-referencing that makes documentation harder to navigate. References should improve traceability and clarity.
- When duplicated information must remain for operational safety or to provide sufficient context for an agent, keep the minimum necessary summary and reference the authoritative source.
- After documentation changes, validate relative links, referenced IDs, status consistency, and contradictions across affected documents.
- Preserve existing user changes. Do not perform unrelated edits, destructive operations, or Git commits without explicit authorization.
- Documentation changes must reflect confirmed decisions and verified project evidence. Do not present assumptions or unresolved questions as approved decisions.

## Mandatory Code Review Flow

### Scope

This flow applies to all tasks that modify code, tests, configurations, Docker files, or other executable artifacts. Documentation-only changes follow a consistency and traceability review (Section E below).

### A. Mandatory Independent Review

For tasks that alter executable artifacts:

1. The Dev implements the task within the confirmed scope.
2. The Dev runs relevant tests and validations, inspects the full diff, and gathers evidence.
3. The Dev explicitly requests an independent review from the Code Reviewer agent.
4. The Code Reviewer compares the changes against requirements, acceptance criteria, confirmed decisions, scope, and tests.
5. The Dev corrects valid findings within scope.
6. The Dev submits corrections and new evidence for re-review.
7. The cycle repeats until the review is approved or a blocker requires human intervention.

The Dev's self-review does not substitute the independent review.

### B. Code Reviewer Responsibilities

The Code Reviewer agent (configured in `F01.kilo/agents/code-reviewer.md`) must:

- Inspect the actual diff, not rely solely on the Dev's summary.
- Consult pertinent requirements and acceptance criteria.
- Verify correctness, security, error handling, tests, and potential regressions.
- Confirm TDD usage where applicable, without accepting RED/GREEN claims without evidence.
- Identify findings with severity, file, location, evidence, and impact.
- Distinguish proven defects from optional suggestions.
- Verify tests actually cover required behaviors.
- Confirm corrections in a subsequent review.
- Issue an explicit verdict supported by available evidence.

The Code Reviewer must not alter business requirements, invent scope, or approve a change merely because tests passed.

### C. Handling of Findings

- Valid findings within scope must be corrected and re-reviewed.
- Findings that depend on business decisions, alter confirmed requirements, or significantly expand scope must be escalated to the human owner.
- Unresolved findings must remain explicitly documented with justification and impact.
- Do not mark a finding as resolved without evidence.
- Do not suppress valid findings to obtain approval.

### D. Review Report Requirements

The review report must contain, at minimum:

- Task and acceptance criteria reviewed.
- Files and diffs examined.
- Findings by severity with evidence.
- Tests and commands executed with actual results.
- Verified corrections.
- Pending findings with justifications.
- Final verdict: approved, rejected, or blocked.
- Review limitations.

Never declare a review approved without the Code Reviewer's explicit verdict evidence.

### E. Documentation and Non-Code Changes

Documentation-only changes must receive a consistency, traceability, and confirmed-decision adherence review.

Use the Code Reviewer for changes to requirements, acceptance criteria, decisions, architecture, or documentation that directly affects system behavior. Do not require an artificial code review when there is no code to review; apply the appropriate review modality.

### F. Environment Limitations

If the Dev cannot invoke the Code Reviewer automatically:

- Do not invent an invocation.
- Do not claim the agent was executed.
- Do not treat self-review as equivalent.
- Inform the available mechanism and the limitation.
- Indicate how the handoff should be performed in the project's real environment.

Do not alter permissions, tools, or global configuration without confirmed necessity and proper authorization.
## Secrets Protection

Mandatory secrets-protection rules are defined in `F01.kilo/rules/secrets-protection.md`. That file is the authoritative source and takes precedence over diagnostic, debugging, audit, test, command, and delegation instructions.
