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
- The `README.md` should serve as the documentation entry point, providing a concise project overview and links to relevant documents.
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