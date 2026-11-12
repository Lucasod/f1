# Tool Capability Contract — Kilo Core

Project-agnostic, reusable contract covering all tool categories available to Kilo agents.
No project-specific paths, languages, frameworks, databases, or business domains are assumed.
This contract describes real tool identifiers and their invocation behavior only; it does not
invent tool APIs.

Authorization denial is final. Alternative tools must never bypass a denied operation.
Temporary session capabilities are not hardcoded as permanent facts.

## 1. File system read tools

These tools inspect the repository and filesystem without modifying state.

### 1.1 read

- **Real tool identifier**: `read`
- **Supported operations**: Read the contents of a single file or directory.
- **Permission requirements**: Requires `read` permission for the target path. Sensitive file names (`.env`, `*.pem`, `*.key`, `credentials.*`, `secrets.*`, etc.) may be restricted to `ask` or `deny`.
- **Valid invocation schema**: `read({ filePath: string, offset?: number, limit?: number })`
- **Required parameters**: `filePath` (absolute path to a regular file or directory).
- **Expected response**: File contents with line-number prefixes, or a directory listing. Truncates long lines; returns error if path does not exist.
- **Common failure types**: Path not found, path is not a regular file/directory, permission denied (`ask`/`deny`), binary file handling varies.
- **Retry policy**: Do not retry on `deny`. Retry only on transient read errors after verifying the path is correct.
- **Known limitations**: Line numbers are prefixed; very long lines are truncated; image/PDF reading returns attachments rather than text.
- **Safe authorized alternatives**: `glob` (discover files), `grep` (search contents), `list` (directory listing) — none replace `read` for exact file contents.

### 1.2 glob

- **Real tool identifier**: `glob`
- **Supported operations**: Find files matching a glob pattern.
- **Permission requirements**: Requires `glob` permission.
- **Valid invocation schema**: `glob({ pattern: string, path?: string })`
- **Required parameters**: `pattern` (glob pattern).
- **Expected response**: List of matching file paths.
- **Common failure types**: Invalid glob pattern, no matches (returns empty list, not an error).
- **Retry policy**: Not applicable; deterministic.
- **Known limitations**: Returns paths only, not contents; pattern syntax follows the underlying glob implementation.
- **Safe authorized alternatives**: `grep` (search contents), `list` (directory listing) — neither substitutes for path discovery by pattern.

### 1.3 grep

- **Real tool identifier**: `grep`
- **Supported operations**: Search file contents using regular expressions.
- **Permission requirements**: Requires `grep` permission. Sensitive paths may be restricted.
- **Valid invocation schema**: `grep({ pattern: string, path?: string, include?: string, context?: number, limit?: number, literal?: boolean, ignoreCase?: boolean })`
- **Required parameters**: `pattern` (regex or literal text).
- **Expected response**: Matching file paths, line numbers, and matching lines; optional context lines.
- **Common failure types**: Invalid regex, path not found, permission denied on sensitive files, binary files skipped.
- **Retry policy**: Not applicable; deterministic. Fix the pattern rather than retrying.
- **Known limitations**: Regex flavor is POSIX/RE2-like; does not search file contents outside the indexed root without explicit path approval.
- **Safe authorized alternatives**: `glob` (find files), `read` (read specific file) — neither replaces content search by pattern.

### 1.4 list

- **Real tool identifier**: `list`
- **Supported operations**: List entries of a directory.
- **Permission requirements**: Requires `list` permission for the target directory.
- **Valid invocation schema**: `list({ filePath: string })`
- **Required parameters**: `filePath` (absolute path to a directory).
- **Expected response**: Directory entries, one per line, with trailing `/` for subdirectories.
- **Common failure types**: Path not found, path is not a directory, permission denied.
- **Retry policy**: Not applicable; deterministic.
- **Known limitations**: Lists one directory level only; does not recurse.
- **Safe authorized alternatives**: `glob` (recursive pattern match) — does not replace a single-level directory listing.

## 2. File system write tools

These tools modify the repository. Authorization (`ask`/`deny`) is enforced per path.

### 2.1 edit

- **Real tool identifier**: `edit`
- **Supported operations**: Perform exact string replacement in an existing file.
- **Permission requirements**: Requires `edit` permission for the target path (`ask` or `deny` per path pattern). Sensitive files (`.env`, `*.pem`, `*.key`, etc.) are typically `deny`.
- **Valid invocation schema**: `edit({ filePath: string, oldString: string, newString: string, replaceAll?: boolean })`
- **Required parameters**: `filePath`, `oldString`, `newString`.
- **Expected response**: Confirmation of replacement; error if `oldString` is not found or matches multiple times.
- **Common failure types**: `oldString` not found, multiple matches (ambiguous), `newString` equals `oldString`, permission denied, file does not exist (requires `write` to create).
- **Retry policy**: Do not retry blindly on "multiple matches" — refine `oldString` with more context or use `replaceAll`. Do not bypass `deny`.
- **Known limitations**: Requires the file to have been read at least once in the session; exact whitespace match required; cannot create new files.
- **Safe authorized alternatives**: `write` (create/overwrite file) — different operation (create vs. in-place replacement), not a bypass for `edit` denial.

### 2.2 write

- **Real tool identifier**: `write`
- **Supported operations**: Create or overwrite a file.
- **Permission requirements**: Requires `edit` permission for the target path (`ask`/`deny` per path pattern). Creating sensitive files is typically `deny`.
- **Valid invocation schema**: `write({ filePath: string, content: string })`
- **Required parameters**: `filePath`, `content`.
- **Expected response**: Confirmation that the file was written.
- **Common failure types**: Permission denied, parent directory does not exist, path is a directory, disk full.
- **Retry policy**: Do not retry on `deny`. Verify parent directory exists before retrying a transient failure.
- **Known limitations**: Overwrites existing content entirely; no append mode; cannot modify read-only protected paths.
- **Safe authorized alternatives**: `edit` (targeted replacement) — different granularity, not a bypass for `write` denial.

## 3. Shell execution

### 3.1 bash

- **Real tool identifier**: `bash`
- **Supported operations**: Execute shell commands in a persistent shell session.
- **Permission requirements**: Requires `bash` permission (`ask` per command pattern). Commands like `cat`, `printenv`, `grep`, `sed`, `awk` on sensitive paths may be restricted. Mutating git operations (`commit`, `push`, `merge`, `rebase`, `checkout`, `reset`, `stash`) require explicit authorization.
- **Valid invocation schema**: `bash({ command: string, timeout?: number, workdir?: string, description?: string })`
- **Required parameters**: `command`.
- **Expected response**: Command stdout/stderr and exit code.
- **Common failure types**: Command not found, non-zero exit code, timeout, permission denied on restricted commands, backgrounding restrictions (`&`, `nohup`, `disown` not allowed).
- **Retry policy**: Do not retry destructive or mutating commands. Retry only transient, idempotent read-only operations after verifying the command is safe.
- **Known limitations**: Shell session persists across calls; background processes must use the `background_process` tool, not `bash` with `&`; secrets must never be passed as command-line arguments.
- **Safe authorized alternatives**: None substitute for shell execution; prefer read-only commands within scope.

## 4. Web access tools

### 4.1 webfetch

- **Real tool identifier**: `webfetch`
- **Supported operations**: Fetch content from a URL and convert to markdown/text/html.
- **Permission requirements**: Requires `webfetch` permission (`allow`/`deny`).
- **Valid invocation schema**: `webfetch({ url: string, format?: "text" | "markdown" | "html", timeout?: number })`
- **Required parameters**: `url` (fully-formed valid URL).
- **Expected response**: URL content in the requested format; may be summarized if very large.
- **Common failure types**: Invalid URL, network unreachable, HTTP error, timeout, content too large.
- **Retry policy**: Retry transient network failures with backoff; do not retry on permanent HTTP errors (4xx) without correcting the URL.
- **Known limitations**: Read-only (no form submission, no authentication); results may be summarized.
- **Safe authorized alternatives**: `websearch` (search engine) — different operation (search vs. direct fetch), not a bypass for `webfetch` denial.

### 4.2 websearch

- **Real tool identifier**: `websearch`
- **Supported operations**: Perform real-time web searches and optionally scrape content from specific URLs.
- **Permission requirements**: Requires `websearch` permission (`allow`/`deny`).
- **Valid invocation schema**: `websearch({ query: string, numResults?: number, livecrawl?: "fallback" | "preferred", type?: "auto" | "fast" | "deep", contextMaxCharacters?: number })`
- **Required parameters**: `query`.
- **Expected response**: Search results with URLs, titles, and snippets.
- **Common failure types**: Empty results, rate limiting, network unreachable, invalid parameters.
- **Retry policy**: Retry transient failures; do not retry to manufacture results for an empty query.
- **Known limitations**: Results depend on the search provider and index; not a substitute for direct URL fetching.
- **Safe authorized alternatives**: `webfetch` (direct fetch) — different operation, not a bypass for `websearch` denial.

## 5. Agent delegation

### 5.1 task

- **Real tool identifier**: `task`
- **Supported operations**: Delegate a scoped task to a subagent session in the parent workspace.
- **Permission requirements**: Requires `task` permission. The allowlist maps agent names to `allow`/`deny`; `"*: deny"` denies all undelegated agents. Delegation is authorized only within the delegating task's scope.
- **Valid invocation schema**: `task({ description: string, prompt: string, ... })` (agent-specific fields vary by runtime).
- **Required parameters**: task description and prompt/scope.
- **Expected response**: Delegated agent result with status (`COMPLETE`, `PARTIAL`, `BLOCKED`, `FAILED`), evidence, and files changed.
- **Common failure types**: Delegation target not in allowlist, target not selectable, scope exceeded, permission denied (`task: deny`).
- **Retry policy**: Do not retry the same forbidden delegation. Re-scope or request human authorization for new targets.
- **Known limitations**: No nested delegation from Developer/Reviewer (their `task` is `deny`); a delegate's result is not independent review; runtime permission allowlists differ by agent.
- **Safe authorized alternatives**: None — delegation has no substitute within the agent model; if denied, the work must be done by the authorized agent or deferred to a human gate.

## 6. Agent orchestration (Agent Manager)

### 6.1 agent_manager

- **Real tool identifier**: `agent_manager`
- **Supported operations**: Inspect, start, prompt, stop, move, and answer questions for Agent Manager sessions/worktrees.
- **Permission requirements**: Requires `agent_manager` permission; sessions may be `idle`, `busy`, `retry`, `offline`, or `waiting`.
- **Valid invocation schema**: `agent_manager({ action: "list" | "prompt" | "stop" | "move" | "answer", ... })`
- **Required parameters**: `action`; action-specific parameters (e.g., `sessionID` for `prompt`/`stop`/`move`, `sectionID` for `move`).
- **Expected response**: Session overview, worktree assignments, or action confirmation.
- **Common failure types**: Invalid session/section ID, permission denied on `answer`, session busy (prompt queued), invalid agent/model name.
- **Retry policy**: Do not retry a failed `answer` with guessed labels; surface the pending question first. Do not force a session move.
- **Known limitations**: Does not start sessions by itself (use `mode` + `tasks` to start); local sessions cannot be assigned to sections; `.kilo/agent-manager.json` must not be edited directly.
- **Safe authorized alternatives**: None substitute for session orchestration.

## 7. Background processes

### 7.1 background_process

- **Real tool identifier**: `background_process`
- **Supported operations**: Start, monitor, list, inspect, stop, and restart long-running background processes (servers, watchers, test watchers).
- **Permission requirements**: Requires `background` permission; lifetime options (`inherit`, `persistent`) have constraints.
- **Valid invocation schema**: `background_process({ action: "start" | "monitor" | "list" | "status" | "logs" | "stop" | "restart", command?: string, ... })`
- **Required parameters**: `action`; `command` for `start`/`monitor`.
- **Expected response**: Process `id` and running status, or captured output for `monitor`.
- **Common failure types**: Command not found, process already running, invalid lifetime options (`inherit` and `persistent` cannot combine), timeout reached.
- **Retry policy**: Do not restart a process that fails due to a persistent configuration error; fix the configuration first.
- **Known limitations**: `start` processes are tracked in the session sidebar; `monitor` blocks until exit or cap; processes do not survive session end unless `persistent`.
- **Safe authorized alternatives**: `bash` for one-shot commands — not a substitute for long-running process management.

## 8. Browser automation

### 8.1 kilo-playwright_browser_*

- **Real tool identifier**: `kilo-playwright_browser_*` (e.g., `kilo-playwright_browser_navigate`, `kilo-playwright_browser_click`, `kilo-playwright_browser_snapshot`)
- **Supported operations**: Navigate, click, fill forms, select options, capture snapshots/screenshots, evaluate JS, handle dialogs, inspect network requests.
- **Permission requirements**: Requires browser/tooling permission; each action targets a specific element.
- **Valid invocation schema**: Tool-specific; most require `target` (element reference from a snapshot) or `url` (for navigate).
- **Required parameters**: Varies by tool; `target` or `url` commonly required.
- **Expected response**: Page state, element reference, snapshot text, or network request details.
- **Common failure types**: Element not found, navigation failure, dialog unhandled, tab/index out of range, unsafe code restrictions.
- **Retry policy**: Do not retry clicks on elements that changed; re-snapshot to obtain a fresh reference before retrying.
- **Known limitations**: Accessibility snapshot may not expose all elements; `kilo-playwright_browser_run_code_unsafe` is RCE-equivalent and restricted; coordinate-based interaction requires vision capability.
- **Safe authorized alternatives**: `webfetch`/`websearch` for read-only web access — not substitutes for browser interaction.

## 9. Scheduling

### 9.1 cron_* / schedule_wakeup / cancel_wakeup

- **Real tool identifier**: `cron_create`, `cron_delete`, `cron_list`, `schedule_wakeup`, `cancel_wakeup`
- **Supported operations**: Schedule one-shot or recurring future resumptions of the session.
- **Permission requirements**: Requires `goal`/`goal_report` or scheduling permission depending on runtime.
- **Valid invocation schema**: `cron_create({ prompt, cron | when | delay })`, `schedule_wakeup({ prompt, when | delay, reason })`, etc.
- **Required parameters**: `prompt`; exactly one of `cron`/`when`/`delay`.
- **Expected response**: Scheduled task `id`, schedule, and next fire time.
- **Common failure types**: Schedule beyond 7-day horizon, cron next fire past expiry, more than 10 scheduled tasks, time at or before now.
- **Retry policy**: Do not reschedule a missed recurring fire; compute the next fire from current time. Cancel with `cron_delete`/`cancel_wakeup` before re-creating.
- **Known limitations**: At most 10 scheduled tasks per session; tasks expire after 7 days; missed fires are not replayed one-for-one.
- **Safe authorized alternatives**: `bash sleep` for short blocking waits — not a substitute for session-resume scheduling.

## 10. Memory and knowledge

### 10.1 kilo_memory_* / kilo_local_recall

- **Real tool identifier**: `kilo_memory_recall`, `kilo_memory_save`, `kilo_local_recall`
- **Supported operations**: Search, save, correct, or forget project memory (typed facts, session digests); read past conversation transcripts.
- **Permission requirements**: Requires memory tool permission; secrets must never be stored in memory.
- **Valid invocation schema**: Tool-specific (`{ mode, query, sessionID, action, text, ... }`).
- **Required parameters**: `mode`/`action` plus query or text as applicable.
- **Expected response**: Matching memory entries, confirmation of save/correct/forget, or session transcript.
- **Common failure types**: No matches, invalid session ID, query too large, out-of-scope save rejected.
- **Retry policy**: Do not retry a `forget` for a non-existent key; use `catalog` to browse keys first.
- **Known limitations**: Memory is context, not instruction; current user messages and repository evidence win over saved memory; no cross-project memory.
- **Safe authorized alternatives**: None — memory has no substitute within the agent model.

## 11. Planning, charting, and board

### 11.1 open_plan / plan_exit / chart / board_* / cancel_wakeup (board)

- **Real tool identifier**: `open_plan`, `plan_exit`, `chart`, `board_post`, `board_read`, `cancel_wakeup`
- **Supported operations**: Open/save plans, signal planning completion, render charts, post/read board messages.
- **Permission requirements**: Requires `goal`/`goal_report` or board permission depending on runtime.
- **Valid invocation schema**: Tool-specific; `chart` requires a Chart.js v4 config; `board_post` requires `to`, `type`, `body`.
- **Required parameters**: Varies by tool; `type` (INFO/ASK/RESULT/HOLD/VETO) for board posts.
- **Expected response**: Plan opened/closed, chart rendered, message posted, or board history.
- **Common failure types**: Invalid chart config, missing board recipient, message too large (>4 KiB), invalid plan path.
- **Retry policy**: Do not retry a board post to a non-existent recipient; verify participant IDs first.
- **Known limitations**: Board posts are team-visible, not private; `chart` is not for diagrams/flowcharts (use mermaid); plan must be finalized before `plan_exit`.
- **Safe authorized alternatives**: None substitute for planning/board coordination.

## 12. General principles

- **Never invent tool APIs**: Document only real tool identifiers and observed invocation behavior.
- **Authorization denial is final**: A denied tool must not be retried, bypassed, or substituted with an alternative that performs the same denied operation.
- **Alternative tools never bypass denial**: Safe alternatives are documented for convenience only; they perform different operations and cannot substitute for a denied tool.
- **No temporary session capabilities as permanent facts**: Capabilities marked `UNKNOWN` or `ask` in a session are not generalized to all sessions.
- **Project-agnostic**: This contract contains no project-specific paths, languages, frameworks, databases, or business domains.
- **Secrets**: Never pass secrets as command-line arguments, never log secret values, never store secrets in memory or fixtures (see `secrets-protection.md`).

## Runtime Tool Availability and Recovery

All agents must distinguish between:

- **Available:** Tool is exposed to the current agent and authorized for use.
- **Approval required:** Tool is available but requires human authorization.
- **Denied:** Tool is prohibited by the effective permission policy.
- **Unavailable:** Tool is not exposed by the runtime.

Rules:

1. Inspect available capabilities before selecting a tool.
2. Never repeatedly invoke an unavailable or denied tool.
3. Never circumvent a denial through a different tool, subprocess, delegation or external service.
4. Use only explicitly permitted alternatives that serve the authorized task.
5. Delegate execution to the designated agent when appropriate; delegation must respect the delegate's independent permissions.
6. If no authorized execution route exists, record the blocker and request human intervention.
7. Never claim an operation was performed without evidence.
8. Preserve this behavior across session recovery and compaction.