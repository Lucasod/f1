# FS-04 — Multi-Tenant SaaS Project Management Platform

A Jira-like product where each company has an isolated workspace with projects, boards, issues, sprints, and billing.

**Deadline:** November 19, 2026. **Estimated effort in the brief:** 14 days. Execution is organized into steps rather than daily allocations. Complete each step as soon as its acceptance criteria and checks pass, preserving time for final preparation.

## Current status and scope

### MP-F04-013 — Test Infrastructure Stabilization (completed)

MP-F04-013 completed all test-infrastructure stabilization work with full integration acceptance:
- Django: 67/67 PASS, including the assignee-filter fix and 2 regression tests.
- Playwright: 53/53 PASS, 0 skipped; serial workers for shared SQLite and per-test fixture isolation.
- 3 consecutive stable verification cycles.
- TypeScript/JavaScript: no build step configured (N/A).
- Secret scanner: clean (exit 0), zero credential disclosure; only synthetic test fixtures used (e.g. `testpass123`).

Integration acceptance: PASS. Reviewer verdict: PASS. Mission status: COMPLETE.

This README is the only project artifact. No application, dependencies, tests, or runtime environment have been created yet.

The first product milestone is an end-to-end flow: sign in, create a workspace, create a project, view a board, and create or move an issue. Its first implementation slice covers authentication, workspaces, and memberships. Cross-company data exposure is the primary risk; isolation and authorization must be tested before expanding functionality.

Required stack: Django REST Framework, React, PostgreSQL, Celery, Stripe Billing in test mode, Docker, and GitHub Actions. Django REST replaces the Rails/GraphQL-specific guidance; the architectural and engineering principles still apply.

Project documentation, code identifiers, API messages, and product interface text will be in English.

## Minimal architecture

A Django monolith exposing a REST API and a React frontend in the same repository. PostgreSQL is the source of truth. Redis will be added as the Celery broker when background jobs are implemented.

Write flow: **API/serializer → use-case service → domain rules → ORM/PostgreSQL**.

- Views handle HTTP, authentication, and permission enforcement. Serializers validate input shape.
- Services coordinate use cases and transactions. Reuse existing services before adding new ones.
- Domain rules preserve business invariants. Issue transitions and subscription limits belong outside views, serializers, callbacks, and Celery tasks.
- Simple reads use tenant-scoped querysets. Introduce query objects only when query complexity justifies them.
- Use the ORM directly for persistence initially. Do not introduce generic repositories, custom base classes, or empty layers.

This separation applies SRP (SOLID): HTTP handling, business rules, and persistence have separate responsibilities. Isolate Stripe and webhook delivery from domain rules when those integrations are introduced so tests can replace external dependencies (DIP).

Create directories only when used:

```text
backend/       Django, API, services, and tests
frontend/      React and primary user-flow tests
README.md      Planning, setup, and initial documentation
```

Add Docker and test CI with the first executable increment. Split documentation into additional files only when its size justifies it.

## Engineering principles

- **DDD:** use the product language consistently: workspace, membership, project, board, issue, sprint, and subscription. Keep business rules outside transport and background-task adapters. Introduce domain modules and value objects when concrete rules justify them.
- **Clean Code:** explicit names, small cohesive functions, clear responsibilities, consistent error handling, and composition over inheritance. Avoid hidden side effects and comments that repeat the code.
- **DRY:** maintain one implementation of each business rule, tenant-scoping mechanism, and shared transformation. Similar-looking code should be combined only when it represents the same responsibility.
- **KISS:** choose the simplest solution that preserves isolation, security, testability, and maintainability. Prefer the monolith, ORM, and standard Django capabilities. Justify each new abstraction.
- **YAGNI:** implement current requirements only. Do not add generic extension mechanisms or infrastructure for hypothetical features.
- **SOLID:** maintain single responsibilities (SRP), small contracts where needed (ISP), and separation from external dependencies (DIP). Apply OCP and LSP when actual extensions or substitutions exist. Explain SOLID-related decisions in implementation reviews.
- **TDD:** write or update tests first, observe the expected failure, implement the minimum, then refactor with green tests. Never change behavior without coverage.
- **Good practices:** explicit authorization, validated input, atomic transactions, database constraints, reversible migrations, and recorded dependency versions. Existing project conventions take priority over personal preference.

Review every change for domain boundaries, duplication, simplicity, SOLID, TDD, performance, security, and readability. Record improvements without automatically expanding scope.

## Tenant isolation and data model

**Decision:** use [django-multitenant](https://github.com/citusdata/django-multitenant), a shared schema, and a required `workspace_id` on tenant-owned entities. A workspace is the isolation and billing boundary. Users may belong to multiple workspaces through memberships. Verify Django, DRF, and library compatibility during setup and pin validated versions.

The library handles tenant scoping for supported queries. Authentication, membership checks, role permissions, and cross-workspace relationship validation remain application responsibilities. This applies SRP and avoids duplicating the tenant-filtering mechanism (DRY).

Establish tenant context only after validating access and always clear it, including on exceptions. Celery jobs must receive a workspace identifier and establish and clear their own context. Tenant-data operations without context must fail safely; guarantee this in the integration rather than assuming the library provides it. Workspace discovery and initial creation need narrowly defined flows outside tenant context, without enabling unrestricted business-data queries.

| Entity | Responsibility and relationships |
| --- | --- |
| User | Global identity and authentication through Django |
| Workspace | Company, name, and public identifier |
| Membership | User/workspace association with owner, admin, or member role; unique pair |
| Project | Belongs to a workspace; project key unique within that workspace |
| Board | Belongs to a project and workspace; initially one board per project |
| WorkflowStatus | Ordered board columns; initial values: To do, In progress, Done |
| Issue | Board and workspace; title, description, status, optional assignee, position |
| Sprint | Project and workspace; dates and state; optional association on issues |

Comments, attachments, audit events, subscriptions, and webhook destinations are introduced in their respective increments. Initial issue movement is between columns; manual ordering within a column is outside the first increment.

Resolve tenant-owned identifiers through authorized, workspace-scoped queries. Never trust a body-supplied `workspace_id` to grant access. Projects, boards, statuses, sprints, assignees, and issues must belong to the correct workspace, including on partial updates. Use database constraints where supported and explicit validation for cross-tenant relationships.

Index actual query patterns, starting with workspace filters and issues by board/status. Migrations must be reversible. Issue changes and their audit events must be atomic.

## Workspace and membership rules

These rules define the initial product contract. Member management is a follow-up slice; its invariants are specified now to avoid conflicting authorization behavior later.

### Workspace lifecycle

- An authenticated, active user can create a workspace. The server assigns its identifier; the client supplies only its name.
- A name is trimmed, required, and limited to 100 characters. Duplicate names are allowed because identifiers distinguish workspaces.
- Workspace creation and the creator's owner membership succeed or fail in one transaction. No ownerless workspace may remain after a failure.
- A user may belong to multiple workspaces and may have a different role in each.
- Workspace discovery returns only the requesting user's memberships and associated workspaces. A user without memberships receives an empty list and may create a workspace.
- Workspace selection is explicit in each workspace-scoped API route. The frontend keeps the current selection, but the backend revalidates membership on every request; a previous selection never grants access.
- Only owners can rename a workspace. Workspace deletion belongs to Step 5 and follows the soft-deletion and billing rules below.

### Membership and roles

- A membership references exactly one user and one workspace. The pair is unique at database level.
- Allowed roles are `owner`, `admin`, and `member`; arbitrary role strings are rejected.
- Every existing workspace must retain at least one owner. Multiple owners are allowed.
- Owners can add existing active users, assign any allowed role, change roles, and remove memberships, subject to the last-owner rule.
- Admins can add existing active users as members and remove members. They cannot create, change, or remove owner/admin memberships or change roles, including their own.
- Members cannot manage other memberships. Any user may leave a workspace unless doing so removes its last owner.
- Membership removal revokes workspace access on subsequent requests even if the user's login session remains valid.
- Checks and writes that can remove or demote owners must run atomically, serialized per workspace, so concurrent operations cannot remove all owners.
- No public user directory or email invitations are included initially. Adding an existing user must not return unrelated account details; the exact-username contract is defined in the existing-user membership policy below.

### Authorization and isolation

- Authentication establishes identity; membership establishes workspace access; role establishes allowed actions. Enforce all three independently of the frontend.
- Requests for a nonexistent or inaccessible workspace or tenant-owned resource return the same not-found response without exposing its name, members, or existence.
- An authenticated member attempting a forbidden action in an accessible workspace receives a forbidden response.
- Reject client attempts to set the creator, owner membership, or tenant through fields outside the endpoint's input contract.
- Tenant-scoped execution without a validated workspace context must stop before reading or writing tenant business data. Workspace discovery and atomic creation are explicit exceptions with restricted queries.
- Always clear tenant context after execution, including validation failures and unexpected exceptions. A subsequent request or job must not inherit a previous workspace.

### Permission matrix

| Action within an accessible workspace | Owner | Admin | Member |
| --- | --- | --- | --- |
| View workspace and membership list | Yes | Yes | Yes |
| Rename workspace | Yes | No | No |
| View projects, boards, and issues | Yes | Yes | Yes |
| Create/edit/move issues and comment | Yes | Yes | Yes |
| Manage projects, workflows, and sprints | Yes | Yes | No |
| Add/remove ordinary members | Yes | Yes | No |
| Assign/change roles or manage elevated memberships | Yes | No | No |
| Manage billing or request workspace deletion | Yes | No | No |
| Leave workspace | Unless last owner | Yes | Yes |

## Acceptance criteria

These are planned scenarios, not executed test results. Each business rule requires unit coverage and integration coverage where API, database, or concurrency behavior is involved.

| ID | Given / When | Expected outcome |
| --- | --- | --- |
| WS-01 | An active authenticated user creates a workspace with a valid name | Exactly one workspace and one owner membership are created atomically; the response includes the workspace and the caller's role |
| WS-02 | A user submits a blank, whitespace-only, or overlong name | Validation fails with no workspace or membership created |
| WS-03 | Owner membership creation fails | The workspace creation is rolled back |
| WS-04 | Two users create workspaces with the same name | Both succeed with distinct identifiers |
| WS-05 | A user belongs to workspaces A and B but not C | Workspace discovery returns A and B only, with the correct role in each |
| WS-06 | A user has no memberships | Discovery returns an empty list; workspace creation remains available |
| WS-07 | A user switches from A to B | Every B request checks B membership and returns only B data; an A identifier used within B is not found |
| WS-08 | A user requests another company's workspace or a nonexistent workspace | Both return the same not-found response without private metadata |
| WS-09 | An anonymous user calls a protected operation | Authentication is required and no tenant data is returned or changed |
| WS-10 | An owner renames a workspace, or an admin/member attempts the same | The owner succeeds; other roles are forbidden and the name remains unchanged |
| WS-11 | A creation request supplies unauthorized ownership or tenant fields | The request is rejected without creating records or granting privileges |
| MB-01 | The same user is added twice to one workspace | The second addition is rejected; exactly one membership remains |
| MB-02 | An invalid role is submitted | Validation fails and the membership remains unchanged |
| MB-03 | An owner assigns or changes a role | The change succeeds if at least one owner remains |
| MB-04 | An admin adds/removes a member or attempts to manage an elevated membership | Member operations succeed; elevated-role operations and self-promotion are forbidden |
| MB-05 | A member attempts to manage another membership | The operation is forbidden and no membership changes |
| MB-06 | The last owner tries to leave, is removed, or is demoted | The operation is rejected and an owner remains |
| MB-07 | One of two owners leaves or is demoted | The operation succeeds and the remaining owner retains access |
| MB-08 | Concurrent operations would remove or demote both remaining owners | At least one operation is rejected; the committed workspace still has an owner |
| MB-09 | A membership is removed while its user remains signed in | Subsequent requests to that workspace are not found; other authorized workspaces remain accessible |
| MB-10 | A membership from workspace A is targeted through workspace B | The membership is not found and no record changes |
| TN-01 | A tenant business operation runs without validated context | It fails before accessing tenant business data |
| TN-02 | A request succeeds, fails validation, or raises an exception | Tenant context is cleared in every case |
| TN-03 | Consecutive requests or jobs target different workspaces | No tenant context or data leaks between executions |

The first implementation slice covers WS-01 through WS-09, WS-11, and applicable membership constraints and tenant-context scenarios. Renaming, membership-management endpoints, and concurrency scenarios are delivered with the follow-up membership-management slice before those actions become available. Test Celery context handling when jobs are introduced.

## Functional requirements

Requirements describe intended behavior, not completed features. `Initial` means the first implementation slice; later steps follow the delivery sequence. Existing WS/MB/TN acceptance criteria remain the detailed contract for workspace and membership rules.

| ID | Requirement | Scope | Verification |
| --- | --- | --- | --- |
| FR-01 | Active users can sign in, retrieve their current identity, and sign out using server-side sessions | Initial | Correct/incorrect credentials, inactive account, session invalidation, and CSRF integration tests |
| FR-02 | An authenticated user can create a workspace and automatically become its owner in one transaction | Initial | WS-01–WS-04, WS-11 |
| FR-03 | Users can list only their own workspaces and access an explicitly selected workspace | Initial | WS-05–WS-09, TN-01–TN-03 |
| FR-04 | Workspace members can view a paginated membership list containing only that workspace's member summaries | Initial | Role matrix; cross-workspace access and response-field tests |
| FR-05 | Owners can rename workspaces; owners/admins can manage memberships according to the role matrix; users can leave without removing the last owner | Step 1 follow-up | WS-10, MB-01–MB-10, including concurrent owner changes |
| FR-06 | Owners/admins can manage projects with a workspace-unique key and one initial board per project | Step 2 | Role, uniqueness, relationship, and isolation tests |
| FR-07 | Members can create, view, update, and move issues between board columns using React drag-and-drop, with changes persisted through the API | Step 2 | Browser flow, invalid transition rejection, reload persistence, and visual rollback on failure |
| FR-08 | Owners/admins can configure an ordered workflow per board; issue movements must respect allowed transitions | Step 3 | Transition and permission tests; prevent removal of a status still used by issues |
| FR-09 | Owners/admins can create, start, and complete project sprints; issues can be assigned only to a sprint in the same project/workspace | Step 3 | Date/state validation, role matrix, and cross-project rejection tests |
| FR-10 | Members can add and read issue comments and upload/download authorized attachments | Step 3 | Input validation, attachment restrictions, and isolation tests |
| FR-11 | The system records an append-only audit history of successful workspace-scoped business changes, including actor, action, target, workspace, and timestamp | Step 3 | Successful changes and audit events commit together; rolled-back changes leave no successful-change event; no public update/delete audit endpoints |
| FR-12 | The system produces internal notifications and a workspace issue-count report through Celery | Step 4 | Jobs run after commit with explicit tenant context; report counts match committed data |
| FR-13 | Owners/admins can configure outgoing webhooks for issue creation and status changes | Step 4 | Signed payload, authorized configuration, bounded retries, delivery identifier, and duplicate-delivery handling |
| FR-14 | Owners can start and manage a Stripe test-mode subscription for their workspace; the backend enforces plan limits | Step 5 | Verified, duplicate/out-of-order webhook scenarios and concurrent limit enforcement; catalog limits and downgrade policy defined below |
| FR-15 | A reviewer can run the demo with documented sample accounts and synthetic workspaces without real customer data | Steps 6–7 | Reproduce the documented setup and primary flow |
| FR-16 | Owners can soft-delete a workspace only after closing paid/pending billing, immediately revoking future tenant access while retaining records | Step 5 | DEL-01–DEL-06 |

Initial authentication uses provisioned demo/development accounts. Public registration, password recovery, email invitations, workspace deletion, and membership write endpoints are outside the first slice. They must not be implied by the initial API. Workspace deletion is implemented in Step 5 after billing-state enforcement is available.

## Non-functional requirements

These are acceptance targets. No performance, security, or test results have been measured yet.

| ID | Requirement and target | Verification |
| --- | --- | --- |
| NFR-01 | Isolation: zero unauthorized cross-workspace reads or writes in the tenant-boundary test suite; absent context fails closed | Integration tests for every tenant endpoint, relationship, and job as introduced; WS/MB/TN scenarios |
| NFR-02 | Security: enforce authentication, role permissions, CSRF on unsafe browser requests, input validation, secure production cookies, and HTTPS in deployment; never expose secrets, password hashes, or stack traces | Positive/negative API tests, response inspection, and production-settings review |
| NFR-03 | Integrity: workspace/owner creation and business-change/audit writes are atomic; unique memberships and last-owner protection survive concurrent requests | PostgreSQL constraint, rollback, and concurrency integration tests |
| NFR-04 | Maintainability: follow the documented DDD boundaries, SOLID, Clean Code, DRY, KISS, and YAGNI; domain rules must not depend on HTTP or provider SDKs | Review each change; explain relevant SOLID decisions and justify new abstractions |
| NFR-05 | Testability: every new or changed business rule has a unit test and applicable integration coverage; mandatory checks pass before merging | Red → Green → Refactor evidence and CI results; do not use a coverage percentage as a substitute for scenario coverage |
| NFR-06 | Performance: target p95 at or below 500 ms and zero unexpected 5xx responses for initial authenticated read endpoints under 10 concurrent sessions over 60 seconds | Measure after warm-up on a recorded environment with 20 workspaces and 50 memberships each; report actual latency, throughput, errors, and query counts; exclude external providers |
| NFR-07 | Bounded reads: all collection endpoints are paginated, and query counts must not grow per returned membership through N+1 lookups | Test page-size limits and compare query counts for 1 versus 20 returned memberships |
| NFR-08 | Background reliability: enqueue after database commit, clear tenant context on every exit, use explicit timeouts and bounded retries, and prevent duplicate business effects | Simulated failures, duplicate tasks/events, and consecutive-workspace job tests; external webhook consumers receive a stable delivery ID for deduplication |
| NFR-09 | Reproducibility: Docker starts the documented stack, migrations initialize a clean PostgreSQL database, and dependencies are pinned | Clean-environment setup check; document required variables without secret values |
| NFR-10 | CI/CD: GitHub Actions runs backend/frontend checks and tests and builds containers; deployment is enabled only after hosting is configured and checks pass | Inspect a successful pipeline and, when configured, a deployment run |
| NFR-11 | Observability: errors and asynchronous deliveries carry a correlation identifier; logs avoid credentials, session cookies, and sensitive payloads | Inspect successful/failing request and job logs; verify the identifier can trace a failure |
| NFR-12 | Usability/accessibility: provide English labels, loading/empty/error states, visible keyboard focus, and a keyboard-accessible way to move an issue without dragging | Manual keyboard review and browser tests for the primary flow |
| NFR-13 | Documentation: setup, architecture, API behavior, test evidence, and measured limitations match the delivered version | A reviewer follows instructions from a clean environment and completes the demo flow |

The performance target is a project benchmark, not a production SLA. Production availability, backup/restore objectives, and capacity commitments require a hosting decision and are not claimed by this initial plan.

## Initial REST API contract

This is a design contract to implement and test. It does not represent running endpoints. Future membership writes, projects, issues, and billing will receive their own contracts before implementation.

### Shared conventions

- Base path: `/api/v1/`. Use trailing slashes and JSON request/response bodies except for empty responses.
- Authentication: server-side Django session in an HttpOnly cookie. Use same-origin browser requests with credentials. Secure cookies and HTTPS are required in deployment.
- Bootstrap CSRF before login. Send the returned token in `X-CSRFToken` on every unsafe browser request, including login and logout. Refresh it after login because the token is rotated.
- Initial identity uses `username` and `password`, matching provisioned Django accounts. No global user-search or registration endpoint is exposed.
- User, workspace, and membership IDs are server-generated positive integers. IDs are opaque references, never authorization credentials. No custom identifier framework is needed initially.
- Timestamps use ISO 8601 in UTC. JSON field names use `snake_case`.
- Workspace context comes from `/workspaces/{workspace_id}/...`, never a mutable global selection, body field, or trusted client header.
- List endpoints accept `page` (default 1) and `page_size` (default 20, maximum 100). Reject non-integer, non-positive, or over-limit values with `400`; an out-of-range page returns `404`. Order workspaces and memberships by `id` ascending for stable pagination.
- Paginated response: `{"count": 0, "next": null, "previous": null, "results": []}`. Non-null pagination links preserve filters and page size.
- Reject unknown input fields with `400`. A workspace name is trimmed and must contain 1–100 characters after trimming.
- Protected API responses are private and must not be stored in shared caches. Authentication and permission checks run before tenant data is returned.

### Endpoints

| Method and path | Access and input | Success | Main failures |
| --- | --- | --- | --- |
| `GET /api/v1/auth/csrf/` | Public; no body | `200 {"csrf_token": "<token>"}` and CSRF cookie; no session/account details | `429` when throttled |
| `POST /api/v1/auth/login/` | Public; CSRF required; `{"username": "alice", "password": "<password>"}` | `200` with current-user representation; establishes/rotates session and provides refreshed CSRF cookie | `400 invalid_credentials` for wrong credentials or inactive account; `400 validation_error`; `403 csrf_failed`; `429` |
| `POST /api/v1/auth/logout/` | CSRF required; no body | `204` with no body; invalidates current session; also `204` if already signed out with valid CSRF | `403 csrf_failed` |
| `GET /api/v1/auth/me/` | Active authenticated user; no body | `200` with current-user representation | `403 authentication_required` |
| `POST /api/v1/workspaces/create/` | Active authenticated user; CSRF required; `{"name": "Acme"}` | `201` with workspace representation and `Location: /api/v1/workspaces/{id}/` | `400 validation_error`; `403 authentication_required` or `csrf_failed` |
| `GET /api/v1/workspaces/` | Active authenticated user; pagination only | `200` paginated authorized workspace representations; empty results allowed | `400` invalid pagination; `403 authentication_required`; `404` out-of-range page |
| `GET /api/v1/workspaces/{workspace_id}/` | Any current member of that workspace | `200` workspace representation | `403 authentication_required`; `404 not_found` for nonexistent/inaccessible workspace |
| `GET /api/v1/workspaces/{workspace_id}/memberships/` | Any current member; pagination only | `200` paginated membership representations | `400` invalid pagination; `403 authentication_required`; `404 not_found` for nonexistent/inaccessible workspace or page |

For protected requests, an inactive account is treated as unauthenticated. The session-based contract uses `403 authentication_required` rather than introducing a token authentication scheme just to return `401`. Unsafe requests can fail CSRF validation before authentication; both outcomes deny access without changing data. For authenticated requests with valid CSRF, check workspace access before validating tenant-specific input so inaccessible workspaces consistently return `404`.

Login throttling target: at most 10 attempts per minute per client IP, with `429` and `Retry-After` when blocked. Use a shared limiter at deployment and test the limit; configure trusted-proxy handling before relying on forwarded IP headers. Throttling reduces abuse but is not a substitute for authentication or infrastructure-level protection.

### Representations

Current user (`login` and `me`):

```json
{
  "id": 7,
  "username": "alice",
  "display_name": "Alice"
}
```

`display_name` is the trimmed combination of Django first/last names, falling back to `username`. Account emails, password hashes, global privileges, and unrelated memberships are omitted.

Workspace (`create`, `list`, and `detail`):

```json
{
  "id": 12,
  "name": "Acme",
  "role": "owner",
  "created_at": "2026-11-07T15:00:00Z"
}
```

`role` always describes the current caller's membership. Ownership cannot be supplied through workspace creation input.

Membership (list item):

```json
{
  "id": 31,
  "user": {
    "id": 7,
    "username": "alice",
    "display_name": "Alice"
  },
  "role": "owner",
  "created_at": "2026-11-07T15:00:00Z"
}
```

The route defines the workspace, so each list item omits redundant workspace data. Only members of the authorized workspace appear.

### Error contract

All API errors, including CSRF rejections, use one shape; `fields` is an empty object when no field errors apply. Implement formatting at the API boundary, keeping domain rules independent of HTTP (SRP/DIP).

```json
{
  "error": {
    "code": "validation_error",
    "message": "The request contains invalid data.",
    "fields": {
      "name": ["This field must not be blank."]
    }
  }
}
```

| Status | Code | Meaning |
| --- | --- | --- |
| `400` | `validation_error` | Invalid JSON, field, unknown input, or pagination value; no writes committed |
| `400` | `invalid_credentials` | Generic login failure; do not distinguish missing user, wrong password, or inactive account |
| `403` | `authentication_required` | A protected request has no valid active session |
| `403` | `csrf_failed` | CSRF validation failed; no sensitive rejection details returned |
| `403` | `permission_denied` | An authenticated workspace member lacks the required role; used when write endpoints are introduced |
| `404` | `not_found` | Resource absent or inaccessible, or pagination page absent; same generic message |
| `405` | `method_not_allowed` | The endpoint does not support the requested method |
| `409` | `membership_exists` / `last_owner_required` | Membership-write conflicts in the follow-up slice |
| `400` | `user_unavailable` | Missing/inactive target account in an authorized exact-username membership addition |
| `409` | `billing_not_closed` | Workspace deletion blocked by paid or pending billing |
| `409` | `plan_limit_reached` | A workspace resource increase would exceed its effective plan limit |
| `415` | `unsupported_media_type` | A body uses an unsupported content type |
| `429` | `rate_limited` | Request limit reached; include `Retry-After` |
| `500` | `internal_error` | Unexpected failure; generic message with no stack trace or private details |

Add an `X-Request-ID` response header for correlation. Error messages remain in English; clients use stable codes rather than matching message text. Invalid identifiers and inaccessible identifiers must not reveal resource existence.

### API acceptance scenarios and traceability

| ID | Scenario | Requirements |
| --- | --- | --- |
| API-01 | Bootstrap CSRF, sign in, retrieve `me`, sign out, then confirm `me` is denied | FR-01, NFR-02 |
| API-02 | Reject invalid credentials and inactive accounts with the same generic error; reject unsafe requests with missing/invalid CSRF | FR-01, NFR-02 |
| API-03 | Create a workspace, verify the Location header and owner role, then find it in list/detail and the creator in memberships | FR-02–FR-04, WS-01 |
| API-04 | Enforce documented pagination, ordering, response fields, unknown-field rejection, and error shape | FR-03–FR-04, NFR-07, NFR-13 |
| API-05 | Repeat protected operations anonymously and using a different workspace's identifiers; verify denial without metadata leakage or writes | FR-03–FR-04, NFR-01–NFR-02, WS-08–WS-09 |
| API-06 | Revoke a membership between two requests using the same session; verify the next workspace request is not found | FR-03, MB-09 |
| API-07 | Exceed the login rate limit and verify `429`, `Retry-After`, and recovery after the configured window | FR-01, NFR-02 |
| API-08 | Exercise CSRF, malformed JSON, validation, not-found, unsupported method/media type, throttle, and unexpected-error paths; verify the common error envelope and request ID without sensitive details | NFR-02, NFR-11, NFR-13 |

Keep these scenarios alongside WS/MB/TN tests in the first-slice test plan. Membership revocation can be arranged directly in test fixtures before membership-write endpoints exist. Document any deviation before changing this contract.

## Existing-user membership policy

This policy applies to the Step 1 membership-management follow-up, not the initial read-only membership API. It supports provisioned accounts without adding an invitation or public account-search system.

- Do not expose a global user list, autocomplete, partial search, or email lookup. The administrator must already know the person's exact username.
- Add through `POST /api/v1/workspaces/{workspace_id}/memberships/` with `{"username": "bob", "role": "member"}`. Trim the username, then use exact case-sensitive matching against an active account. Do not accept a user ID, email, workspace field, or unknown fields in this operation.
- Validate the caller's active membership and role before account lookup. Owners may assign any allowed role; admins may assign only `member`; ordinary members are forbidden. Requests to inaccessible workspaces return `404` before lookup.
- Return `201` with the membership representation after successful creation. A current member's username is already visible in the authorized membership list; adding that user again returns `409 membership_exists` without changing their role.
- Missing and inactive accounts return the same `400 user_unavailable`, with no email, account state, or profile details. A successful addition necessarily confirms that the supplied username is usable; this is a deliberately restricted administrator capability, not a promise of complete account-existence secrecy.
- Throttle membership additions to 20 attempts per minute per actor/workspace pair, including failed attempts. Return `429` and `Retry-After` on exhaustion. Audit successful additions; record denied attempts in security logs without request payloads.
- Check seat limits and insert the membership in one transaction, serialized per workspace, with a database uniqueness constraint. Retries must not create duplicate memberships.
- Provision synthetic accounts through a documented development command. Account creation and invitations remain outside this delivery's public API.

| ID | Acceptance criterion |
| --- | --- |
| USR-01 | Owner adds an active exact-username match; only the authorized membership summary is returned |
| USR-02 | Partial names, case mismatches, absent accounts, and inactive accounts do not create memberships; unavailable accounts use the same generic error |
| USR-03 | Forbidden roles and inaccessible workspaces are rejected before any account lookup |
| USR-04 | Duplicate and concurrent additions preserve one membership; role changes require their separate authorized use case |
| USR-05 | Requests cannot retrieve unrelated email/profile information; the attempt limit is enforced and recovers after its window |
| USR-06 | At the seat limit, simultaneous additions cannot commit a membership count above the plan limit |

## Workspace deletion policy

For this delivery, deletion means **soft deletion**: immediate access revocation with retained database records. There is no public restore or permanent-purge endpoint. This keeps the use case small and avoids destructive cascades while preserving the audit trail. It is not a claim that retained personal data has been erased.

- Add a nullable `deleted_at` timestamp to Workspace when implementing this use case. Active workspaces have no deletion timestamp. Business data retains its workspace relationship.
- Endpoint: `DELETE /api/v1/workspaces/{workspace_id}/`, authenticated, CSRF-protected, owner-only. Require JSON `{"confirmation_name": "Acme"}` matching the current workspace name exactly. Reject a missing/mismatched confirmation with `400 validation_error`; unknown fields are rejected.
- The UI must clearly say that the workspace will become inaccessible, billing must be canceled first, and records will remain stored. Require typing the workspace name before submission.
- Workspaces with a paid subscription or a pending checkout/subscription change cannot be deleted. Return `409 billing_not_closed`. The owner must cancel the subscription first and wait for verified provider reconciliation; scheduled cancellation with a future effective date does not satisfy this condition. A Free workspace without a billing transition can be deleted.
- Deletion and billing-transition initiation must serialize on the workspace and recheck state. After deletion starts, block new checkout sessions and subscription changes. Late provider events may update internal reconciliation records but must not reactivate a workspace or grant access.
- In one transaction, verify authorization and billing state, set `deleted_at`, and record the deletion audit event. No child rows or files are physically removed by this operation. Return `204` with no body only after commit; a failed transaction leaves the workspace accessible and records no successful deletion.
- A deleted workspace disappears from discovery and is treated as not found by every tenant endpoint, including for former owners. Global user sessions and access to other workspaces remain valid. A repeated deletion returns the same generic `404` as any inaccessible workspace.
- Memberships remain for integrity/history but grant no access when their workspace is deleted. The last-owner rule applies to active workspaces; deletion does not remove or demote an owner.
- Jobs, notification/report downloads, attachment downloads, and pending outgoing webhook deliveries must recheck workspace state before execution/access and skip deleted workspaces. Stop future schedules and revoke pending undelivered work where supported; do not claim to retract a webhook already sent or a response already in flight.
- Retention for this synthetic-data demo lasts for the demo environment's lifetime. No automated purge is included. Before real customer use, define and implement retention, export, backup handling, and permanent-erasure procedures. Never describe this operation as permanent erasure in the UI or documentation.

| ID | Acceptance criterion |
| --- | --- |
| DEL-01 | Only a current owner with valid CSRF and exact confirmation can delete an active workspace |
| DEL-02 | Paid/pending billing blocks deletion, including cancellation scheduled for a future date; a reconciled Free workspace can be deleted |
| DEL-03 | Successful deletion commits its timestamp and audit event together; failure rolls both back |
| DEL-04 | Deleted workspaces are absent from discovery and return generic `404` for all former members; unrelated workspaces remain accessible |
| DEL-05 | Queued jobs and file/report access deny deleted workspaces; stored rows/files remain and no purge or restore API is exposed |
| DEL-06 | Concurrent checkout/deletion cannot establish an authorized new subscription transition after deletion; late billing events cannot restore access |

## Subscription plans and quota policy

Plans below are product decisions for the demo, not claims about Stripe pricing. Both tiers run with synthetic data; any paid checkout uses Stripe test mode only.

| Capability or limit per active workspace | Free | Pro |
| --- | --- | --- |
| Subscription price | No charge; no Stripe subscription required | USD 19 per month, test mode only |
| Memberships, including owners/admins | 5 | 25 |
| Projects | 2 | 20 |
| Workflow, sprint, comment, audit, report, and webhook features | Included | Included |

Only memberships and projects have plan-based quotas. Issues and attachment storage have no plan-based quotas in this delivery. Attachments retain a fixed 10 MiB per-file safety limit on both plans, independent of billing.

Use one application-owned plan catalog for names and limits; API responses and quota checks read it rather than duplicating constants across services or React. Keep the Stripe Pro price identifier in environment configuration. Do not create a separate entitlement platform or configurable plan editor.

- New workspaces start on Free. The initial slice enforces the membership limit when additions become available; the project limit is introduced with project creation. No Stripe dependency is required to create a workspace.
- Only owners manage subscriptions. Membership counts include every membership in an active workspace regardless of role or user activity. The project quota counts stored projects. Release a seat when its membership is removed; release a project slot only when an authorized permanent project removal is implemented. Issue and attachment operations do not consume plan quota.
- The backend checks authorization first, then quota, then performs creation atomically. Serialize quota-consuming writes per workspace, including bulk operations and jobs. Failed transactions consume no quota. Return `409 plan_limit_reached` with the affected resource, current usage, limit, and plan; never include another workspace's usage.
- Members may view workspace-local usage. Expose `GET /api/v1/workspaces/{workspace_id}/usage/` when quotas are introduced, returning `plan` and a `resources` object with `used` and `limit` for memberships and projects only. The UI displays the same server-reported values; it is not the enforcement boundary.
- Grant Pro only after verified Stripe reconciliation confirms the intended workspace, configured price, and active subscription. Browser success redirects never grant entitlements. Reject trial setup in the demo checkout; no annual plans, coupons, taxes, metered billing, or prorated plan switching are included.
- Pending, incomplete, delinquent, canceled, or otherwise non-active paid subscriptions do not grant Pro. The effective plan is Free until an active paid state is verified. Delinquency policy is deliberately strict for the demo: no additional grace period. A scheduled cancellation retains Pro only while the verified subscription remains active.
- Duplicate events must not apply effects twice. For out-of-order events, reconcile current provider state rather than blindly replacing local state with a stale event. Never apply events to a workspace supplied by an untrusted browser payload.
- On downgrade, keep existing records and downloads. If usage exceeds a Free limit, block only creates/increases for that resource; allow reads, edits that do not increase usage, and authorized removals. Do not delete customer data or prevent the owner from managing billing. Upgrading resumes creates once the effective limit permits them.
- Reject deletion while paid billing is active as specified above. Provider cancellation failures must not mark a subscription canceled or delete the workspace. Use explicit subscription state rather than inferring it from a user's role or checkout response.

Example quota error (the initial API error envelope retains its shape; `fields` contains the resource details):

```json
{
  "error": {
    "code": "plan_limit_reached",
    "message": "The workspace has reached its membership limit.",
    "fields": {
      "resource": "memberships",
      "used": 5,
      "limit": 5,
      "plan": "free"
    }
  }
}
```

| ID | Acceptance criterion |
| --- | --- |
| PLAN-01 | A newly created workspace uses Free without contacting Stripe; its creator consumes one seat |
| PLAN-02 | Creating the last permitted resource succeeds; the next create returns the documented quota conflict and changes nothing |
| PLAN-03 | Concurrent membership/project creates, including API requests, jobs, and bulk writes, cannot exceed the effective limit |
| PLAN-04 | A checkout redirect or unverified/duplicate/stale event cannot grant Pro; verified active reconciliation grants the catalog limits |
| PLAN-05 | Downgrading an over-limit workspace preserves existing records, permits reads and non-increasing edits, and blocks the affected increases |
| PLAN-06 | Only owners can manage billing; usage is visible only to current members and never leaks another tenant's counts |
| PLAN-07 | Inactive paid states use Free; scheduled cancellation retains Pro only until active entitlement ends; deleted workspaces never regain access |
| PLAN-08 | Price identifiers and server secrets stay out of source/frontend; demo checkout never uses live-mode credentials |

## Delivery sequence

Steps define the delivery order, not a daily schedule. Multiple steps may be completed on the same day. An increment is complete only after its acceptance criteria, tests, and review pass.

| Step | Delivery | Main verification |
| --- | --- | --- |
| 1 | Django/React/PostgreSQL base, authentication, workspace, memberships, Docker, test CI | Authentication and isolation between two companies |
| 2 | Projects, boards, issues, persistent drag-and-drop | Browser flow, authorized movement, visual rollback on API error |
| 3 | Sprints, configurable workflows, comments, attachments, audit log | Valid transitions, protected files, atomic history |
| 4 | Celery, internal notifications, asynchronous report, outgoing webhooks | Jobs after commit, bounded retries, duplicate-effect protection |
| 5 | Stripe test mode, subscriptions, plan limits, workspace soft deletion | Per-workspace subscription, authenticated idempotent webhook, enforced limits |
| 6 | Final integration, security/query review, deployed or recorded demo | Regression checks, measured results, reproducible execution |
| 7 | Documentation, 10-minute presentation, individual reflection, delivery review | Complete checklist in one Google Drive folder |

Keep each feature small: one workflow per board, internal notifications, one report, and two subscription plans. Additional integrations, advanced analytics, and predictive features are outside scope. Automated deployment requires a hosting decision; a recorded demo is accepted by the brief.

## Test and security strategy

Follow Red → Green → Refactor for each behavior. Add unit tests for new rules and integration tests for API, database, and external integration behavior.

Prioritize tenant isolation, the role matrix, last-owner protection, status transitions, transactional audit events, plan limits, duplicate/out-of-order Stripe events, job retries, and the primary React flow including API failures.

Use Django sessions, secure cookies, and CSRF protection, preferably with frontend and API on the same origin. Never commit credentials or expose server secrets to the frontend. Validate input and use parameterized ORM queries. Do not render unsanitized user HTML. Attachments require authorized downloads, size limits, type validation, and private storage. Outgoing webhooks require SSRF protection and blocking internal destinations. Validate Stripe webhook signatures; subscription confirmation must not rely on browser redirects.

Review main endpoints for N+1 queries and pagination. Record real test results and performance measurements with environment and dataset size. Do not present estimates as measured results.

## Deliverables and review

- Working deployed demo or screen recording.
- GitHub repository with small clean commits and reproducible setup, execution, and test instructions.
- Architecture diagram and data/API documentation covering authorization and isolation.
- Test results and relevant performance measurements.
- Ten-minute presentation: problem, design, challenges, results, and next steps.
- Individual reflection covering learning and ownership.
- One Google Drive folder containing all final links and artifacts.

Review SOLID, TDD, DDD, Clean Code, performance, security, and readability after every increment. Current follow-up concerns: validate library/version compatibility, validate safe private file delivery, and define production retention/permanent erasure before handling real customer data. RLS, external attachment storage, and expanded observability can be evaluated later; they are not part of the initial foundation.

## Next step

Implement only the first slice: executable foundation, authentication, workspace creation/discovery, and owner membership. Start with failing isolation and role tests. Initial files will cover Django configuration, the workspace module and tests, the React entry point, Docker, and GitHub Actions test CI.

Before implementation, inspect generated conventions and identify the exact affected files. Validate and pin compatible dependency versions during setup.

Operational decisions still needed: remote repository, hosting, Stripe test account, and Google Drive destination. These do not block local development.
