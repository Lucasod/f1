# Compaction Recovery Contract — Kilo Core

Defines how agents recover role, permissions, scope, mission, findings, and next action after
context compaction. Project-agnostic; contains no project-specific paths, languages, frameworks,
databases, or business domains.

## 1. Purpose

After context compaction, an agent may lose its in-session understanding of its role, the task it
is executing, its authorized scope, open findings, delegation state, and required next action.
This contract defines a durable, deterministic recovery mechanism so the agent can resume safely
without re-deriving authorization from a possibly stale or compacted summary.

## 2. Persistent mechanism: run records

Recovery state is stored exclusively in run records under `docs/agent_runs/<run-id>.md`.

- Run records are **append-only**: never overwrite or delete an earlier run record.
- Create `docs/agent_runs/` only when a run starts.
- Each run record captures the full recovery state at checkpoints and on completion.
- On resume, the agent verifies the run record against Git status, the task list, and current
  files before relying on it; stale status is corrected with a dated addendum, never silently
  rewritten.

### 2.1 Required run record sections

Every run record must contain, at minimum:

| Section | Purpose |
|---------|---------|
| Run Metadata | Run ID, task ID, branch, base commit, delegator, FIPR phase, start/end time, authorized scope, forbidden paths |
| Task Log | Per-task status, dependencies, start/end, findings, attempts, FIPR phase |
| Permission Reconciliation | Declared vs. effective vs. verified permissions with evidence |
| Changes Applied | Files changed, purpose, CR/decision IDs |
| Baseline Testing | Commands, exit codes, results before modification |
| Post-Correction Testing | Commands, exit codes, results after modification |
| Checkpoints | Timestamped recovery points with FIPR phase and verification |
| Next Action | Required next action after resume |
| Limitations and Uncertainties | Checks not run, environmental limits, unknowns |
| Conclusion | Final status (COMPLETED / BLOCKED / OPERATIONAL PAUSE / HUMAN APPROVAL REQUIRED) |
| Independent Reviewer Findings and Verdict | Reviewer session, verdict, findings count, review date |

## 3. Recovery fields (what to restore)

After compaction, restore the following from the run record:

| Field | Source in run record |
|-------|----------------------|
| Current role | Delegation request / Run Metadata (delegator + agent) |
| Applicable rules | Run Metadata / Change notes referencing rule files |
| Actual tool permissions | Permission Reconciliation table (declared/effective/verified) |
| Authorized scope | Run Metadata `authorized_paths` |
| Forbidden paths | Run Metadata `forbidden_paths` |
| Current mission and stage | Run Metadata `FIPR phase` + Task Log |
| Open findings | Task Log / Limitations / Independent Reviewer Findings |
| Delegation state | Task Log (delegated tasks, statuses, attempt counts) |
| Test evidence | Baseline Testing / Post-Correction Testing (commands, exit codes, output) |
| Required next action | Run Metadata `Next Action` |

## 4. Recovery procedure

1. **Locate the run record**: Identify `run_id` from the delegation/resume request; read `docs/agent_runs/<run-id>.md`.
2. **Verify against current state**: Compare the run record's base commit and authorized paths with `git status`, `git log --oneline -10`, and the current filesystem. If they diverge, stop and record a `BLOCKED` with justification.
3. **Restore role**: Re-establish the agent's role from the delegation request or run record metadata.
4. **Rediscover permissions**: Re-read the agent frontmatter and `kilo.jsonc` declarations to confirm actual tool permissions (`read`, `edit`, `bash`, `task`, `webfetch`, `websearch`, etc.). Do not assume a compacted summary is accurate.
5. **Restore scope**: Re-establish `authorized_paths` and `forbidden_paths` from the run record; do not expand scope.
6. **Restore mission/stage**: Re-establish the current FIPR phase and task from the run record.
7. **Restore findings and delegation state**: Re-load open findings, attempt counts (max 3 per finding, max 10 per run/task), and delegation targets.
8. **Restore next action**: Adopt the `Next Action` from the run record as the required next step.
9. **Record the resume**: Add a checkpoint to the run record documenting the resume time, verification result, and restored state.

## 5. Security invariants

- **Never assume a compacted summary overrides security configuration**: The run record and the actual agent frontmatter/`kilo.jsonc` declarations are authoritative; a compacted summary is context only and must not be used to re-derive permissions or scope.
- **No new runtime hooks**: Recovery is achieved solely through run records; no hooks, middleware, or runtime instrumentation is introduced.
- **Authorization denial is final**: Recovered `deny` permissions remain denied; do not retry forbidden operations.
- **Scope is not expanded**: Recovered `authorized_paths`/`forbidden_paths` are restored exactly; no preventive or out-of-scope work.
- **Secrets protection**: Run records must never contain secret values, credentials, tokens, or connection strings (see `secrets-protection.md`).
- **No destructive operations**: Recovery is read-only inspection plus resumption of authorized work; no commits, pushes, merges, or operational writes.

## 6. Attempt and escalation limits

- Max 3 attempts per finding; max 10 total per run/task.
- After 3 attempts without demonstrable progress, stop, record a blocker, and escalate if needed.
- Unresolved business decisions → `BLOCKED`; do not auto-retry.
- `INCONCLUSIVE` → record missing evidence; requires human clarification; no auto-retry.

## 7. Status values

On completion or pause, the run record ends with exactly one of:

- `COMPLETED` — task finished, evidence recorded, review (if required) obtained.
- `BLOCKED` — task stopped by a blocker with justification; awaiting human direction or dependency resolution.
- `OPERATIONAL PAUSE` — intentional, time-bounded pause; resumable from the run record.
- `HUMAN APPROVAL REQUIRED` — task awaits explicit human authorization before proceeding.

Distinguish task-level blockers from a run-wide stop; state the exact next action.
