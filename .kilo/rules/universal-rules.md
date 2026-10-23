Kilo --- Universal Software Engineering Rules
Purpose: Provide one shared, technology-agnostic engineering
baseline for Kilo across projects.
Scope: Applies by default to all projects. Project-specific rules
may extend this baseline but must not be assumed universal.
Core orientation: Good engineering practices, Clean Code, SOLID,
DDD, TDD, DRY, KISS, YAGNI, security, correctness, and verifiable
evidence.
1. Universal principles and context discovery
1. Start by discovering the project rather than assuming its technology
   or architecture.
2. Inspect the repository, source files, dependency manifests,
   lockfiles, build/test configuration, CI workflows, documentation,
   and existing conventions relevant to the task.
3. Identify the actual language, frameworks, datastore, architecture,
   test tools, and execution commands from repository evidence. Do not
   infer a stack from a previous project.
4. Do not require a specific language, framework, directory layout,
   design pattern, test library, database, API style, or deployment
   platform unless the project requirements establish it.
5. Use principles as guidance, not as mechanical recipes. Choose
   practices proportionate to the problem, risk, and complexity.
6. A practice used successfully in one project is not automatically
   appropriate in another. Reassess its purpose and fit.
7. If repository evidence is incomplete, distinguish facts from
   assumptions. Ask a focused question only when the missing
   information materially affects correctness, safety, or scope.
8. Keep shared rules technology-agnostic. Put technology-specific
   instructions in optional project guidance only when needed; do not
   make routine projects require manual configuration to benefit from
   this baseline.
2. Clean Code and maintainability
1. Prefer code that makes intent, domain meaning, control flow, and
   side effects easy to understand.
2. Use clear, consistent names that express purpose. Avoid misleading
   names, unnecessary abbreviations, and vague names where meaning
   matters.
3. Keep functions, methods, and modules focused on a coherent
   responsibility. Split them when doing so improves comprehension,
   testability, or change isolation---not merely to satisfy a
   line-count target.
4. Reduce unnecessary coupling and make important dependencies and side
   effects visible.
5. Prefer straightforward solutions over clever, compressed, or
   unnecessarily indirect code.
6. Remove duplication when it represents duplicated knowledge or
   behavior likely to change together. Do not abstract superficially
   similar code if the concepts or reasons for change differ.
7. Avoid dead code, redundant conditions, unused abstractions,
   unexplained constants, and comments that merely restate the code.
8. Add comments and documentation to explain intent, constraints,
   non-obvious decisions, and reasons---not to compensate for confusing
   code when the code can be improved.
9. Refactor for clarity and design while preserving behavior. Keep
   refactoring separate from unrelated feature work where practical.
10. Do not simplify code by removing necessary validation, error
    handling, authorization, observability, tests, or business rules.
3. SOLID and design principles
1. Apply SOLID where it improves cohesion, changeability,
   substitutability, and dependency direction.
2. Single Responsibility: group behavior around a coherent
   responsibility or reason to change; do not interpret this as "one
   trivial method per class."
3. Open/Closed: introduce extension points when real variation or a
   stable extension need exists; do not predict every possible future
   feature.
4. Liskov Substitution: implementations must honor the contracts
   callers rely on, including meaningful error and behavioral
   guarantees.
5. Interface Segregation: keep contracts focused on the needs of
   their consumers; avoid large generic interfaces and interfaces with
   only ceremonial value.
6. Dependency Inversion: when an abstraction is useful, high-level
   policy should not be forced to depend on unstable low-level details.
   The appropriate layer defines the contract and another layer
   supplies the implementation.
7. Do not create an interface, base class, adapter, service,
   repository, or dependency-injection structure for every component by
   default.
8. Prefer composition when it makes relationships clearer. Use
   inheritance only when the subtype genuinely honors the parent
   contract.
9. Avoid circular dependencies, hidden global state, and implicit
   coupling.
10. Choose the simplest design that safely meets demonstrated
    requirements and can evolve without disproportionate cost.
4. DDD and understanding the domain
1. Understand the business problem and domain language before changing
   domain behavior.
2. Identify domain concepts, actors, workflows, business rules,
   invariants, and meaningful edge cases from requirements and existing
   evidence.
3. Use a consistent domain vocabulary in code and documentation when
   the domain warrants it.
4. Model domain behavior where it belongs; avoid scattering business
   rules across UI handlers, controllers, persistence callbacks, and
   infrastructure adapters.
5. Use entities, value objects, aggregates, domain services,
   repositories, domain events, and bounded contexts when they clarify
   real domain behavior or consistency boundaries---not as mandatory
   artifacts.
6. Protect aggregate and business invariants at the appropriate
   consistency boundary. Do not assume every object must be an
   aggregate or that every mutation needs an explicit lock.
7. Keep business policy independent of delivery and infrastructure
   details where practical. Domain or application layers may define
   abstractions; infrastructure provides concrete adapters when that
   separation is appropriate.
8. Distinguish domain rules from application orchestration and
   infrastructure concerns without creating layers that add no value.
9. Use bounded contexts when the domain has meaningful models or
   language that differ; do not split a small, coherent application
   into artificial contexts.
10. Record important domain assumptions and unresolved questions. Never
    present a provisional model or inference as a confirmed requirement.
5. TDD and testing discipline
1. Use TDD when it is practical and valuable for the task: Red →
   Green → Refactor.
   - Red: create or identify a meaningful test that demonstrates
     the missing or incorrect behavior.
   - Green: make the smallest correct change that makes the test
     pass.
   - Refactor: improve design while keeping the relevant tests
     passing.
2. Do not fabricate a Red result. If the test could not be run before
   the change, state that limitation and provide the strongest honest
   evidence available.
3. Tests should verify observable behavior, requirements, contracts,
   invariants, and important failure modes---not merely mirror
   implementation details.
4. Add regression tests for defects where feasible. A useful regression
   test should detect the original defect; explain any reason it
   cannot.
5. Never delete, skip, weaken, or alter a test merely to get a green
   run. Change expectations only when the test is demonstrably wrong or
   requirements have intentionally changed; explain the rationale.
6. Choose unit, integration, contract, end-to-end, security, and
   performance tests according to the risk and behavior being verified.
7. Use real dependencies when their behavior is the subject of the
   test. Mocks and stubs are appropriate for external boundaries,
   failure simulation, and controlled scenarios, but must not conceal
   the behavior the test claims to prove.
8. Avoid brittle tests coupled unnecessarily to internal method calls,
   private structure, or incidental formatting.
9. Keep test data isolated. Never let tests accidentally overwrite
   production data, operational indexes, or unrelated user data.
   Establish the test environment explicitly and fail closed when its
   safety cannot be established.
10. Run the most relevant tests first, then broader checks proportionate
    to the change and available environment.
11. Report exact commands and observed results. Distinguish executed
    checks, failures, skipped tests, checks not run, environmental
    limitations, and conclusions inferred from partial evidence.
12. A passing suite is evidence, not proof of total correctness or
    security. Review whether the tests actually exercise the intended
    behavior and meaningful failure cases.
6. DRY, KISS, YAGNI, and abstraction discipline
1. DRY: avoid duplicating the same knowledge or business rule in
   multiple places. Similar-looking code is not necessarily the same
   knowledge.
2. KISS: prefer the simplest solution that remains correct, secure,
   readable, testable, and maintainable.
3. YAGNI: do not implement speculative features, configuration
   knobs, extension points, or abstractions without a demonstrated
   need.
4. Prefer a small amount of clear duplication over an abstraction that
   obscures different concepts or creates excessive coupling.
5. Generalize after identifying a stable shared concept or repeated
   change pattern, not merely to avoid a few repeated lines.
6. Do not replace a correct implementation with an overly minimal one
   that omits edge cases, invariants, error handling, or essential
   tests.
7. Do not add dependencies when existing language or project
   capabilities adequately solve the problem.
7. Correctness, invariants, state, and errors
1. Identify the invariants that protect business correctness, security,
   permissions, and data integrity.
2. Revalidate assumptions at the point where they must hold; checks
   performed earlier may become stale.
3. Use explicit state machines when there are meaningful states,
   allowed transitions, and transition-specific rules. Do not require
   one for every simple update.
4. Define clear success and failure behavior at component and system
   boundaries.
5. A consistent error contract matters more than a universal return
   type. Use typed results, exceptions, error values, or another
   idiomatic mechanism suitable for the language and architecture.
6. Do not swallow errors or report success when an operation failed.
   Preserve useful diagnostic context while keeping external errors
   appropriately safe.
7. Handle partial failure and retries deliberately when an operation
   spans multiple resources or services.
8. Use idempotency or deduplication when retries or repeated requests
   could cause duplicate side effects.
8. Concurrency and transactions
1. Select concurrency control according to the invariant, datastore,
   transaction model, contention, and failure modes.
2. Do not require explicit locks for every mutation. Appropriate
   mechanisms may include atomic updates, database constraints,
   optimistic concurrency, transactions, row/document locks, isolation
   levels, or distributed coordination.
3. If a check can become stale before a write, revalidate the invariant
   within the effective atomic or concurrency-controlled boundary.
4. For example, concurrent purchases must not both consume the same
   remaining stock. The implementation must coordinate stock validation
   and decrement so the invariant remains true under concurrency.
5. Keep critical sections reasonably small, but never move an
   invariant-dependent decision outside the protected boundary merely
   to shorten a lock.
6. A transaction in one datastore does not automatically make
   operations across other databases, queues, payment providers, or
   external services atomic.
7. Consider conflicts, deadlocks, timeouts, retries, duplicate
   delivery, and partial failure when relevant. Test consequential race
   conditions where feasible.
9. Security, privacy, and permissions
1. Treat security as a design concern throughout development, not a
   final cleanup step.
2. Apply least privilege to users, services, credentials, agent tools,
   database roles, and infrastructure access.
3. Separate authentication (who the caller is) from authorization (what
   the caller may do).
4. Enforce authorization on the server for protected actions and
   resources. Do not trust UI visibility or client-supplied owner
   identifiers as proof of permission.
5. For HTTP APIs, 401 generally represents missing or invalid
   authentication, while 403 generally represents an authenticated
   caller lacking permission. Apply protocol semantics and deliberate
   anti-enumeration policies appropriately.
6. Validate inputs according to their types, allowed values, format,
   size, trust boundary, and business constraints.
7. Do not indiscriminately strip HTML tags as universal sanitization.
   Preserve legitimate input; encode output for its destination
   context. If HTML is intentionally allowed, sanitize it using an
   appropriate maintained allowlist sanitizer.
8. Use parameterized database queries or equivalent safe query
   mechanisms. Do not concatenate untrusted input into executable
   queries, commands, or expressions.
9. Protect secrets, tokens, private keys, and sensitive personal data.
   Do not commit secrets or expose them in logs, examples, reports,
   fixtures, or generated files.
10. Use TLS for sensitive network traffic except where a deliberately
    safe local context applies.
11. Apply request limits, rate limiting, abuse controls, security
    headers, and monitoring according to the system's exposure and
    threat model.
12. Do not assume CORS provides authentication or authorization.
13. Do not assume that using JWT or an "API-only" architecture
    automatically eliminates CSRF risk. Evaluate how credentials are
    stored and automatically sent by clients.
14. Use secure defaults and fail closed when a security-critical
    condition cannot be verified.
10. Authentication and technology-dependent security
1. Do not prescribe an authentication scheme universally. Choose
   sessions, cookies, bearer tokens, OAuth/OIDC, API keys, or other
   mechanisms based on clients, threat model, and requirements.
2. If JWT is used, explicitly validate permitted algorithms and
   required claims such as issuer, audience, and expiry. Select
   algorithms and key management based on supported standards and trust
   boundaries; never accept an algorithm solely because the token
   requests it.
3. Refresh tokens are applicable when the chosen authentication
   lifecycle uses them. If adopted, define secure storage, rotation,
   revocation, expiry, and reuse handling as appropriate.
4. CSRF controls depend on credential transport and browser behavior.
   Cookie-based credentials generally need deliberate CSRF protection;
   a bearer token explicitly attached by client code has a different
   risk profile.
5. Multi-tenancy is not universal. If the application is multi-tenant,
   define tenant identification and isolation across persistence,
   authorization, background jobs, caches, search, and files as
   relevant.
6. Resource ownership and seller/customer authorization are required
   where relevant, but do not automatically imply a full multi-tenant
   architecture.
7. GraphQL-specific protections---depth/complexity limits, batching
   controls, persisted-query allowlists, resolver authorization, and
   introspection policy---apply only when GraphQL is used. Configure
   them according to query costs, API design, deployment, and exposure.
8. Production introspection is a risk-based decision, not a universal
   prohibition. Consider operational needs, exposure, schema
   sensitivity, and compensating controls.
9. Do not impose Rails, RSpec, JWT, GraphQL, or any other
   stack-specific mechanism unless repository evidence and requirements
   justify it.
11. Data integrity and persistence
1. Use application validation together with datastore constraints and
   atomic operations where appropriate to protect critical invariants.
2. Design schema changes and migrations for the actual datastore and
   deployment process. Consider existing data, compatibility, rollback
   limitations, and mixed application versions.
3. Never perform destructive migrations, production data changes, bulk
   rewrites, restores, or irreversible operations without explicit
   authorization and a safety plan.
4. Make deletion, retention, restoration, and audit requirements
   explicit when relevant.
5. Establish a source of truth and consistency strategy when data is
   copied into caches, search indexes, queues, object storage, or other
   stores.
6. Do not assume unit tests prove real datastore constraints,
   transaction semantics, index behavior, or production compatibility.
12. External systems and integrations
1. Inspect existing integration code and authoritative documentation
   before relying on external API behavior.
2. Define timeouts, retries, idempotency, error mapping, and
   observability according to the integration's failure modes.
3. Verify provider responses or resulting state where needed; sending a
   request does not prove that an operation succeeded.
4. Do not assume multiple external systems share one atomic
   transaction.
5. Avoid unnecessary calls, duplicated side effects, and retry loops
   without bounds.
6. Treat files, URLs, MIME types, archives, serialized data, and
   external responses as untrusted input.
13. Repository, Git, and agent autonomy
1. Inspect repository status and relevant diffs before editing; review
   the resulting diff afterward.
2. Preserve existing user changes. Never reset, clean, overwrite,
   rebase, discard, or otherwise destroy work without explicit
   authorization.
3. Do not include unrelated changes in the task.
4. Agents must not commit automatically. The user retains control of
   commits, pushes, merges, releases, deployments, and publication
   unless they explicitly authorize a specific action.
5. Do not force-push, rewrite shared history, publish packages, deploy,
   or release without explicit authorization.
6. If repository state changes unexpectedly, stop and investigate
   rather than automatically cleaning it up.
7. Editing files does not itself prove completion. Review the diff and
   verify relevant behavior.
8. Use commands and tools discovered from the actual project; do not
   invent scripts or assume a tool is installed.
14. Incremental workflow
1. Establish the requested outcome, scope, relevant existing behavior,
   and risks.
2. Inspect relevant code, tests, configuration, documentation, and
   repository status.
3. Form a root-cause explanation or a clearly labeled hypothesis.
4. Choose the smallest sound change that addresses the requirement.
5. Add or update meaningful tests where appropriate, using TDD when
   practical.
6. Implement incrementally; avoid mixing unrelated refactoring into
   behavior changes.
7. Run relevant tests and checks using verified project commands.
8. Review the diff for unintended changes, weakened tests, leaked
   secrets, missing error handling, and scope drift.
9. Update documentation when behavior, configuration, design decisions,
   or operational requirements materially change.
10. Report the actual result, evidence, limitations, and remaining
    questions. Do not imply more certainty than the evidence supports.
15. Framework, language, and tooling conventions
1. Discover and follow idiomatic conventions for the project's actual
   language and framework.
2. Conventions such as Rails service objects with call, concerns,
   RSpec, factories, specific directory trees, repository classes, or
   dependency-injection containers are conditional---not universal
   mandates.
3. When a project already adopts a convention, follow it consistently
   unless there is a clear reason to improve it.
4. Do not create directories, interfaces, wrapper classes, services, or
   framework structures solely to satisfy a generic template.
5. Choose tools and test styles based on the repository's established
   stack, requirements, ecosystem, and risk.
16. Environment and operational safety
1. Distinguish development, test, staging, and production environments
   where accidental cross-environment access could cause harm.
2. Make test environment selection explicit when required for safety,
   and fail closed if a safe target cannot be established.
3. Never point tests, recovery tools, or experiments at operational
   data without explicit authorization and necessity.
4. Do not restart services, rebuild indexes, modify infrastructure,
   perform operational writes, or alter external systems without
   required authorization.
5. Distinguish read-only inspection from state-changing operations.
   Explain material risks and rollback limitations before seeking
   authorization.
6. Keep machine-specific paths, credentials, and private operational
   details out of shared rules.
17. Documentation, decisions, and traceability
1. Document meaningful behavior changes, non-obvious decisions,
   constraints, and operational effects.
2. Keep documentation aligned with implementation and tests. Do not
   describe planned behavior as implemented.
3. Mark assumptions, provisional decisions, limitations, and unresolved
   questions clearly.
4. Preserve traceability between requirements, domain concepts,
   decisions, implementation, and tests where those artifacts are used.
5. Avoid documentation churn that does not improve correctness,
   discoverability, or maintainability.
6. Fix contradictory or duplicated documentation when it is in scope;
   review generated trees and examples for editorial consistency.
18. Required reporting and evidence
For non-trivial tasks, provide a concise report containing:
- Goal and scope: what was requested and what changed.
- Approach and findings: root cause or hypothesis, important
  design decisions, and assumptions.
- Files changed: relevant paths and purpose.
- Verification: exact commands and observed results; explicitly
  list checks not run.
- Evidence and limits: what the checks prove and what they do not
  prove.
- Risks and follow-ups: remaining issues, questions, and next
  steps.
- Git state: relevant status/diff summary and whether a commit was
  made. Agents do not commit automatically.
Keep reports proportionate for small tasks, but always be truthful.
Never invent test results, tool output, code changes, or verification.
19. Safety gates requiring explicit authorization
Stop and obtain explicit authorization before: - destructive or
irreversible data changes; - production or operational writes,
migrations, restores, index rebuilds, or service restarts; - discarding,
overwriting, or resetting user work; - committing, pushing, merging,
deploying, releasing, or publishing; - accessing sensitive data outside
the authorized scope; - performing an action whose target or
consequences cannot be established safely.
Read-only inspection and reversible local changes may proceed within the
user's request and available permissions. If a safety-critical
prerequisite cannot be verified, fail closed and explain what is
missing.
20. Universal principle
Be strict about engineering outcomes and flexible about
implementation.
Clean Code, SOLID, DDD, TDD, DRY, KISS, and YAGNI guide judgment; none
is a mandate to add ceremony. First understand the problem, domain,
repository, and risks. Then select the simplest solution that preserves
correctness, security, maintainability, and verifiable behavior. The
Kilo should discover each project's technology and conventions from
evidence rather than importing assumptions from another project.
