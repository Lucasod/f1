# Domain model and REST API — MVP

Status: approved-scope design to implement, not running functionality. This document extends the [README](../README.md), its role matrix, error envelope, pagination, CSRF, and tenant policies. All paths below are relative to `/api/v1/workspaces/{workspace_id}/`. All reads require a current membership in an active workspace; writes additionally require valid CSRF. A resource outside that workspace returns the same `404 not_found` as a missing resource.

## Boundaries and conventions

Keep four domain responsibilities explicit: workspace/access, project planning, collaboration/history, and billing. Implement concrete use-case services, not a generic repository or service framework. HTTP adapters validate request shape; services coordinate authorization, domain rules, transactions, and persistence. This applies SRP; integrations depend on narrow adapters rather than leaking provider SDKs into domain rules (DIP).

- Every tenant-owned row has `id` (server-generated positive bigint), `workspace_id` (required FK), and `created_at` (UTC). Mutable business rows also have `updated_at` and `version` (positive integer, default 1).
- Reject unknown or read-only input fields. Set workspace, author, actor, counters, timestamps, and initial versions on the server. Never allow ownership/project changes through arbitrary partial updates.
- Required text is trimmed before length validation. Descriptions and comments are plain text, never trusted HTML. Optional descriptions default to an empty string.
- Database constraints cover FKs, required fields, enums, positive numbers, and local uniqueness. Ordinary independent FKs do not prove two parents share a workspace: services must resolve every supplied relationship in the authorized workspace/project/board. Test this explicitly, including PATCH requests. Use the library's tenant-aware relationships where supported; verify generated migrations rather than assuming composite isolation.
- Mutable PATCH and command requests carry the current `version`. Perform a conditional update/lock; stale input returns `409 version_conflict` without side effects. Success increments the version once. Initial representations include it. Concurrent movement must not silently overwrite another user's work.
- Lists use the README pagination contract. Default order is `id` ascending except board statuses (position), sprints (start_at then id), and audit history (created_at descending then id descending). Only documented filters are supported; reject unknown query parameters with `400 validation_error`.
- Acquire locks in a consistent order: workspace, project, board, sprint IDs ascending, issue IDs ascending. Workflow edits, issue transitions, and sprint commands serialize on their project row so state checks remain true until commit. Never hold those locks across provider HTTP calls or object-storage operations.
- Archived projects reject business writes with `409 project_archived`. Reads, audit access, and authorized billing/workspace operations remain available. Reopening a project is owner/admin-only. Archived projects still consume project quota.
- No hard-delete endpoints for projects, boards, issues, or sprints in the MVP. Use project archive and issue cancellation statuses. This avoids unplanned cascades and preserves history. Optional user references use `SET NULL` if an administrative account removal is later implemented; tenant business parent relationships use protection against hard deletion.

## Fields and constraints

### Project

| Field | Type/default | Constraints |
| --- | --- | --- |
| name | string | Required, 1–100 characters |
| key | string | Required; normalize to uppercase; pattern `[A-Z][A-Z0-9]{1,9}`; unique `(workspace_id, key)` |
| description | text, empty | Maximum 5,000 characters |
| archived_at | nullable UTC timestamp | Set/cleared only by archive/reopen commands |
| next_issue_number | bigint, 1 | Positive; internal; locked allocation counter |

Create the project, its board, default workflow, and audit event atomically. Enforce plan quota under workspace lock. The key is immutable; issue numbers are unique within the project and never reused, including after archive. Public issue keys are derived as `PROJECTKEY-number`, not used as authorization.

Indexes: unique workspace/key; workspace/id for listing. No additional index without a query that needs it.

### Board

| Field | Type/default | Constraints |
| --- | --- | --- |
| project_id | FK Project | Required; same workspace; one-to-one/unique project |
| name | string | Required, 1–100 characters; defaults to project name on creation |

There is exactly one board per project in this MVP. Board creation is part of project creation, not a second independent API. Board metadata can change, but its project/workspace cannot. Index workspace/project.

### WorkflowStatus and WorkflowTransition

| Entity/field | Type | Constraints |
| --- | --- | --- |
| Status.board_id | FK Board | Required, same workspace |
| Status.name | string | Trimmed, 1–50 characters; case-insensitive unique per board |
| Status.category | enum | `todo`, `in_progress`, `done`; required |
| Status.position | integer | Nonnegative; unique per board |
| Transition.board_id | FK Board | Required, same workspace |
| Transition.from_status_id / to_status_id | FK Status | Same board/workspace; different statuses; unique `(board_id, from_status_id, to_status_id)` |

A board must retain at least one `todo` and one `done` status. At most 20 statuses per board is a fixed validation bound, not a plan limit. Status position starts at 0 and is contiguous. The first `todo` by position is the default for new issues.

### Issue

| Field | Type/default | Constraints |
| --- | --- | --- |
| project_id / board_id | FKs | Required; board belongs to that project/workspace; immutable |
| number | bigint | Positive; server allocated; unique `(project_id, number)` |
| title | string | Required, 1–200 characters |
| description | text, empty | Maximum 10,000 characters |
| status_id | FK WorkflowStatus | Required; same board; changed only through transition command |
| assignee_id | nullable FK User | Must have an active account and current membership in the workspace when assigned |
| reporter_id | nullable FK User | Set to creator; read-only |
| sprint_id | nullable FK Sprint | Same project/workspace; target must be planned or active when assigning |
| priority | enum, `medium` | `low`, `medium`, `high` |

No user-controlled position field or within-column reordering in the MVP. Board issue lists order by `number` ascending. Removing a membership clears that user's issue assignments in the same workspace transaction; reporter/author history remains. Deactivating an account does not prevent reading historical references but blocks new assignments.

Indexes: unique project/number; workspace/board/status/id; workspace/project/sprint/id; workspace/assignee/id. Query filters: project_id, board_id, status_id, sprint_id (`null` allowed), assignee_id (`null` allowed); all ID filters are workspace-validated before querying.

### Sprint

| Field | Type/default | Constraints |
| --- | --- | --- |
| project_id | FK Project | Required, same workspace, immutable |
| name | string | Required, 1–100 characters; unique name not required |
| goal | text, empty | Maximum 2,000 characters |
| start_at / end_at | UTC timestamps | Required; `start_at < end_at` database check |
| state | enum, `planned` | `planned`, `active`, `completed` |
| started_at / completed_at | nullable timestamps | Server set by commands; planned: both null; active: started only; completed: both set |

Partial unique constraint on project where state is `active`: at most one active sprint. Multiple planned sprints are allowed. Sprint start/end are planning dates, not automatic state transitions; owners/admins explicitly start/complete sprints. Starting requires a planned sprint and no other active sprint, but does not require a nonempty sprint. No reopening or deletion of completed sprints in MVP.

## Workflow and transition rules

Default statuses: To do (`to_do`, position 0), In progress (`in_progress`, 1), Done (`done`, 2). Default directed transitions permit To do → In progress, In progress → To do, In progress → Done, Done → In progress.

- Owners/admins edit workflow configuration; any current member can move an issue along an allowed directed edge.
- Replacing a workflow sends the entire ordered status list and directed edge list, with the board version. Existing statuses retain their IDs; new statuses use request-local `ref` values. Edges refer to these refs. Return assigned IDs and the new board version. Every status item has a unique `ref`; refs live only within this request.
- Existing status category changes are rejected with `409 status_in_use` while issues use that status. Removing a used status is also rejected. Move affected issues first through permitted transitions. Rename/reorder is allowed without rewriting historical audit values.
- Reject empty configurations, duplicate/case-equivalent names, duplicate refs/edges/positions, self edges, cross-board IDs, missing endpoints, missing todo/done categories, and configurations where any todo/in-progress status has no directed path to a done status. Done statuses may be terminal.
- Apply workflow replacement atomically under the project lock. Handle reorder uniqueness without exposing temporary duplicates. No partial updates remain after validation/database failure.
- Moving to the current status is an idempotent no-op: verify access, return the current issue, and do not increment version, audit, or emit an event. For other moves, validate version and allowed edge; a missing edge returns `409 transition_not_allowed`.
- Direct PATCH of `status_id` is rejected. Transition updates, audit, and event/outbox creation commit together.
- An issue in a completed sprint cannot change status until a member explicitly removes it from that sprint or moves it to a planned/active sprint. Historical completion statistics come from the sprint-completion audit snapshot, not mutable issue state.

Example workflow replacement body:

```json
{
  "version": 1,
  "statuses": [
    {"ref": "todo", "id": 1, "name": "To do", "category": "todo", "position": 0},
    {"ref": "doing", "id": 2, "name": "In progress", "category": "in_progress", "position": 1},
    {"ref": "done", "id": 3, "name": "Done", "category": "done", "position": 2}
  ],
  "transitions": [
    {"from": "todo", "to": "doing"},
    {"from": "doing", "to": "todo"},
    {"from": "doing", "to": "done"},
    {"from": "done", "to": "doing"}
  ]
}
```

## Project, board, issue, and sprint endpoints

`Member` below includes admin/owner; `Admin` includes owner. List/detail representations return their fields above plus common IDs/timestamps/version; internal allocation counters are omitted. Issue responses also include derived `key`. Status/transition fields are returned inside workflow, not expanded on every issue. Create requests allow only the listed input; PATCH allows a nonempty subset plus required version.

| Method/path | Role | Input or filter | Success |
| --- | --- | --- | --- |
| GET `projects/` | Member | Pagination; `archived=true/false`, default false | 200 page of projects |
| POST `projects/` | Admin | name, key, optional description | 201 project; Location header; includes board_id |
| GET `projects/{project_id}/` | Member | — | 200 project with board_id |
| PATCH `projects/{project_id}/` | Admin | version; name/description | 200 updated project |
| POST `projects/{project_id}/archive/` | Admin | version | 200 project; repeat with current version is no-op |
| POST `projects/{project_id}/reopen/` | Admin | version | 200 project; repeat with current version is no-op |
| GET `boards/{board_id}/` | Member | — | 200 board; project_id |
| PATCH `boards/{board_id}/` | Admin | version; name | 200 board |
| GET `boards/{board_id}/workflow/` | Member | — | 200 board_version, ordered statuses and transitions |
| PUT `boards/{board_id}/workflow/` | Admin | version, statuses, transitions | 200 full workflow with IDs and board_version |
| GET `issues/` | Member | Pagination and documented filters | 200 issue page; descriptions omitted in list summaries |
| POST `projects/{project_id}/issues/` | Member | title; optional description, assignee_id, sprint_id, priority | 201 issue in default todo status; Location |
| GET `issues/{issue_id}/` | Member | — | 200 full issue |
| PATCH `issues/{issue_id}/` | Member | version; title/description/assignee_id/sprint_id/priority; null clears optional FKs | 200 issue |
| POST `issues/{issue_id}/transitions/` | Member | version, to_status_id | 200 issue |
| GET `projects/{project_id}/sprints/` | Member | Pagination; optional state | 200 sprint page |
| POST `projects/{project_id}/sprints/` | Admin | name, start_at, end_at; optional goal | 201 planned sprint; Location |
| GET `sprints/{sprint_id}/` | Member | — | 200 sprint |
| PATCH `sprints/{sprint_id}/` | Admin | version; name/goal/start_at/end_at | 200 sprint; dates editable only while planned |
| POST `sprints/{sprint_id}/start/` | Admin | version | 200 active sprint; repeat while active with current version is no-op |
| POST `sprints/{sprint_id}/complete/` | Admin | version | 200 completed sprint and completion_counts; repeat while completed with current version returns saved counts |

Sprint completion requires active state. Atomically detach unfinished issues (status category not done) into the backlog by clearing sprint_id and incrementing each changed issue version; keep done issues linked. Record counts/issue IDs in the completion audit snapshot and audit each changed association. No implicit next sprint. An issue may be assigned to an active sprint only if no completed-sprint lock rule is bypassed; membership alone suffices for issue assignment. Project archive is rejected while an active sprint exists (`409 active_sprint_exists`).

Additional conflicts: `project_key_exists`, `active_sprint_exists`, `sprint_state_conflict`, `status_in_use`, `transition_not_allowed`, `version_conflict`, `project_archived` (all 409). Format/invalid workflow/date/relationship input uses 400, except an inaccessible relationship returns generic 404. Unauthorized role uses 403. Project quota uses existing 409 plan_limit_reached. No hidden side effects on rejected operations.

## Comments

Comment fields: common id/workspace/timestamps/version, issue_id FK (required), author_id nullable User (server assigned), body (trimmed plain text, 1–5,000 chars), deleted_at nullable. Index workspace/issue/id. Comments cannot move between issues. Keep original author identity reference even after membership removal; never include email or other global profile data.

| Method/path | Access | Input/result |
| --- | --- | --- |
| GET `issues/{issue_id}/comments/` | Member | 200 page, id ascending; deleted comments excluded |
| POST `issues/{issue_id}/comments/` | Member | body → 201 comment and Location |
| PATCH `comments/{comment_id}/` | Current author only | version, body → 200 comment |
| DELETE `comments/{comment_id}/` | Current author or Admin | version in JSON → 204; soft-delete, no further edits; subsequent access 404 |

Comment responses include id, issue_id, author `{id, username, display_name}` or null, body, version, created_at, updated_at. Admins can remove but not rewrite another person's comment. Comment changes increment version and create audit metadata; do not copy comment text into audit logs or outgoing webhooks. Archived project blocks all comment writes.

## Attachments

Use private S3-compatible object storage, not a container filesystem or public media directory. Store metadata in PostgreSQL. Per-file limit is 10 MiB on both plans; no storage-based plan quota. Allowed types: PNG, JPEG, PDF, UTF-8 plain text. Block SVG, HTML, executable files, archives, and types that do not match inspected content. Filenames are display-only, stripped of path/control characters, 1–150 characters. Object keys are random UUIDs under a workspace prefix, never derived from supplied filenames.

Attachment fields: common id/workspace/timestamps/version, issue_id, uploader_id nullable, original_name, detected_content_type, byte_size (1–10,485,760), sha256 (64 hex), object_key (unique, never in public responses), state (`pending`, `ready`, `failed`, `deleted`), deleted_at nullable. Index workspace/issue/state/id. MIME/type/size validation must stream with a bounded request size and fixed read timeout. Reject mismatches with 400 and oversize with 413 payload_too_large. No malware-free guarantee: only synthetic demo files; production scanning remains a documented limitation.

| Method/path | Access | Input/result |
| --- | --- | --- |
| GET `issues/{issue_id}/attachments/` | Member | 200 page of ready attachment summaries |
| POST `issues/{issue_id}/attachments/` | Member | multipart form with exactly one `file`, CSRF header → 201 ready metadata after successful validation/storage |
| GET `attachments/{attachment_id}/download/` | Member | 200 authorized binary stream; attachment Content-Disposition, nosniff, Cache-Control private/no-store |
| DELETE `attachments/{attachment_id}/` | Uploader or Admin | version in JSON → 204 logical deletion; storage cleanup queued |

Summaries: id, issue_id, uploader user summary/null, original_name, detected_content_type, byte_size, sha256, version, created_at. Do not return bucket/key or a publicly reusable URL. Downloads revalidate active membership/workspace and proxy the private object, avoiding a presigned URL that survives membership revocation. Existing authorized in-flight streams cannot be retracted.

Upload flow: validate authorization/type/size; create a pending row; put the private object outside the DB transaction; lock/recheck workspace/project/access; mark ready with audit in a transaction. On failure mark failed and delete any uploaded object. Pending/failed rows are not visible as attachments. Clean abandoned uploads older than 24 hours; deletion blocks future downloads immediately even if object cleanup fails. A cleanup failure is retried and observable. Soft-deleted workspace records/files remain under the retention policy; orphan cleanup must not purge retained workspace attachments.

## Audit history

AuditEvent fields: id, workspace_id, occurred_at UTC, actor_id nullable, actor_kind (`user`, `system`, `stripe`), action (stable code), target_type, target_id, project_id nullable, request_id, changes JSON, event_id UUID unique. Rows are append-only through application APIs; ordinary runtime operations cannot update/delete them. Use a separate migration/admin database role for maintenance; no claim of cryptographic tamper resistance.

Actions cover workspace create/rename/delete, membership add/role-change/remove/leave, project create/edit/archive/reopen, board edit, workflow replace, issue create/edit/transition, sprint create/edit/start/complete, comment create/edit/delete, attachment ready/delete, subscription entitlement change, and webhook configuration changes. No event for reads or idempotent no-ops. Read-only history can be introduced in Step 3; mutation services must already record the earlier successful business changes, avoiding an incomplete retrospective history.

`changes` stores allowlisted before/after scalar values and relationship IDs; workflows include their bounded configuration snapshots; sprint completion includes counts and issue IDs. Do not store passwords, cookies, provider keys, attachment bytes, comment/description bodies, or webhook secrets. For text-body changes record `body_changed: true` rather than content. Actor labels resolve from retained identity where available, otherwise null. Index workspace/occurred_at/id and workspace/project/occurred_at/id.

GET `audit-events/`: Admin only, 200 paginated newest-first. Filters: project_id, target_type, target_id, action. Resource filters are authorized in the current workspace. GET `issues/{issue_id}/audit-events/`: Member, limited to that issue plus its comments/attachments, with the same safe schema. No POST/PATCH/DELETE endpoints. Response includes the fields above except workspace_id is implicit. Deleted workspace history is inaccessible through tenant APIs; records remain for the documented demo retention.

## Required domain/API tests

| ID | Acceptance test |
| --- | --- |
| DOM-01 | Project creation commits board/default workflow/audit atomically; duplicate keys and concurrent quota overrun are rejected |
| DOM-02 | Every relationship and filter rejects identifiers from a different workspace/project/board without leaking details |
| DOM-03 | Concurrent issue creation allocates distinct monotonic numbers; stale edits cannot overwrite committed changes |
| DOM-04 | Workflow replacement validates category/path/edge/name rules and rolls back entirely; in-use status changes/removal are blocked |
| DOM-05 | Authorized transitions commit issue/audit/outbox together; disallowed/stale transitions change nothing; same-status no-op emits nothing |
| DOM-06 | Concurrent sprint starts preserve one active sprint; invalid dates/states fail; completion atomically backlogs unfinished issues and saves counts |
| DOM-07 | Completed-sprint issue transitions are blocked until reassignment; archived projects block writes; archive requires no active sprint |
| DOM-08 | Comment author/admin permissions, soft deletion, length limits, and plain-text rendering follow the contract |
| DOM-09 | Attachments enforce content/size/authorization; storage failure and access revocation cannot expose pending/private files; cleanup is retryable |
| DOM-10 | Audit records match committed changes, exclude sensitive bodies, stay immutable through API, and enforce admin/issue-specific visibility |
| DOM-11 | Project list filters, board pagination, issue filters, page bounds, and query counts follow documented behavior without N+1 queries |
| DOM-12 | Every role/action is tested; membership removal clears assignments; all exceptions clear tenant context |

Unit-test domain rules first, then PostgreSQL/API integration and concurrency tests. Add browser tests for movement, keyboard alternative, reload persistence, and API-error rollback. These are planned tests, not results.
