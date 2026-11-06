# MP-36 — Forensic execution reconciliation (draft for independent audit)

**Reference run:** `mp-35-2026-11-06` (verified at `docs/agent_runs/mp-35-2026-11-06.md:3-15`). **Task:** MP-36. **Date:** 2026-11-06. **Ceiling:** P4. **Verdict:** the whole instruction chain has **not been demonstrated complete**. The provider and idle components exist as opt-in/tested models; normal agent runtime integration, live failover and actual autonomous eight-hour recovery are not established. The P2-CR002 investigation is not its remediation. Several narrow reviews passed; none closes the entire marketplace or mission.

This is a **bounded, incomplete forensic inventory**, not a claim that every material requirement or every past instruction was recovered. Independent audit of this report is **AWAITING_INDEPENDENT_REVIEW**. An absent transcript section is not proof that an instruction was never executed. Do not interpret a task-list `completed` label as an end-to-end acceptance result when the same row or its addendum excludes external behavior. Historical developer tests were not independently rerun here.

## Source recovery and method

- Full MP-36 request recovered from parent session `ses_e4eaf75b0ffe2E0d682hZTCsKZ`, user message, via local transcript recall. It contains sections 0–17 and mandates an independent reviewer, not implementation.
- MP-35 original, Addendum A, MP-35R, and B–D are in session `ses_e5116df09ffeXzMnJNjzPkTz5Z`; portions are indexed in retrieved output `tool_1b1533b35001nT6qoeVhppEAoG`. MP-34 and continuations were recovered from `ses_e51eeeb36ffedhZ7j821Y5HnMS`, output `tool_1b15816c1001KRWAVNJ9Fa8ofx`; MP-30 and Marketplace MP-31–33 from `ses_e532607f7ffe10JcdqNHJ9e5Hy`, output `tool_1b15816c2001Wes3IbI55zseVo`. These sources are **accessible**, although the transcript tool truncated its immediate response and this audit has not exhausted every section. MP-32 secrets-scanner work is a separate similarly numbered mission, `ses_e5d2f5a82ffebQVe3zJkn2qnWt`. Full section-by-section extraction and AT/FT inventory remain **NOT VERIFIED**, not SOURCE_NOT_AVAILABLE.
- Sources: `docs/agent_runs/mp-34-2026-11-05.md` and `mp-35-2026-11-06.md`; `F01/docs/{decisions,open_questions,task_list}.md`; current code and tests, including `kilo-orchestration/src/{provider-failover,resilient-orchestration,idle-recovery}.ts`. Current file and Git state take precedence over earlier snapshots. Existing Goal/Task state was not independently reconstructed; only historical descriptions and this session's participant board were available.
- Evidence levels below: **static** means inspected source/doc, **reported** means historical developer or coordinator report, **simulation** means tests using fake ports/clocks, **review** means an explicit independent scoped review; no live-provider or Mongo concurrency test was performed. A reviewer PASS is restricted to its stated artifact.

## 1–5. Instruction-to-evidence inventory and counts

Exactly one classification per row, applied to the specified narrow outcome, not to the entire feature. Sources use repository-relative paths; `R35` is `docs/agent_runs/mp-35-2026-11-06.md`, `R34` is `docs/agent_runs/mp-34-2026-11-05.md`, and `Q`/`T` are `F01/docs/open_questions.md`/`task_list.md`. Assigned agent is the principal responsible role; roles do not imply the entire workflow was verified.

| ID / source | Required action; agent | Actual evidence and level | Status | Remaining action / condition |
|---|---|---|---|---|
| I01 MP-34 P01a | Safe config diagnostics; Dev/Reviewer | R34:227–233 records narrow review PASS, no broad external security proof; review/reported | VERIFIED_COMPLETE | Preserve scope; review historical leakage separately |
| I02 MP-34 P1 | Vendor order-detail isolation; Dev/Reviewer | R34:249–261 narrow PASS; reviewer did not run tests | VERIFIED_COMPLETE | Other lists/mutations not covered |
| I03 MP-34 P0-A | Duplicate order correction; Dev/Reviewer | R34:371–387 narrow PASS, not concurrency or provider proof | VERIFIED_COMPLETE | Test concurrent checkout without suppressing legitimate repeat purchases |
| I04 MP-34 P0-B CR001 | Payment ownership 403 contract; Dev/Reviewer | R34:393 onward and R35:101 report narrow PASS | VERIFIED_COMPLETE | Full payment lifecycle remains open |
| I05 MP-35R B | Scoped identity keys and logout clear; Dev/Reviewer | R35:458–520; reported 36 tests, explicit narrow PASS, reviewer did not execute tests; logout test mocks clear | VERIFIED_COMPLETE | End-to-end account switch/cache emptiness unverified |
| I06 MP-35 original §2–4 | Discover tools, providers and feasibility; Orchestra/Dev | R35:20–162 static historical discovery; CLI/config visibility limited | PARTIALLY_COMPLETE | Current provider availability and actual native APIs unverified |
| I07 Addendum A §1–4 | Six ordered destinations; Dev | `provider-failover.ts:19–25`, R35:263–284; tests reported, only model/simulation | TESTED_SIMULATED_ONLY | Connect supported routing and verify each transition; no provider calls during audit |
| I08 MP-35 §5 | Recoverable-error classification and bounded failure; Dev | `provider-failover.ts:60–105,142–199`; R35:270–284 historical tests | TESTED_SIMULATED_ONLY | Real error types, cooldown and backoff not established; `backoffBaseMs` declared but no wait at :116–139,159–195 |
| I09 MP-35 §5.3–5.5 | Durable checkpoint and safe no-replay; Dev | R35:294–318,403–409,422–427; test reports and static code | PARTIALLY_COMPLETE | No universal operation safety, atomic external side effects, or real session recovery shown |
| I10 MP-35R | Integrate delegation port into normal agent runtime; Dev | `resilient-orchestration.ts:1–3,33–45`, test instantiation `tests/resilient-orchestration.test.ts:100`; no source construction found | IMPLEMENTED_NOT_INTEGRATED | Integrate actual runtime only when compatible and authorized |
| I11 MP-35R | Developer and Reviewer continuity; Dev | `resilient-orchestration.ts:55–83,132–138,159–166`: Developer completion cached; review directly delegated, checkpoint records pending review `none`, working tree `clean` | PARTIALLY_COMPLETE | Preserve actual reviewer state and working tree; validate restart/interruption and no false statements |
| I12 MP-35R B | Execute one real P4 task and independent review; Orchestra/Dev/Reviewer | R35:458–520 scoped cache change, developer-reported tests and review PASS | VERIFIED_COMPLETE | Full AT-01–AT-12 demonstration not established by this one task |
| I13 Addendum C | Three queue evaluations, selection, reset and intervals; Dev/Reviewer | `idle-recovery.ts:150–269`; R35:534–566 17 tests and 63 regressions reported; historical transcript reports narrow re-review PASS | TESTED_SIMULATED_ONLY | Real queue refresh, blocker reassessment and schedule execution need integration |
| I14 Addendum C | Persist `nextCheckAt`/restart state; Dev | `idle-recovery.ts:85–119`: optional explicit save/load; tests use temp files; not automatically called by `decide` | PARTIALLY_COMPLETE | Wire persistence to actual scheduler and recover reset context |
| I15 Addendum C | Durable actual wake-up, five intervals and final stop; Orchestra | `idle-recovery.ts:32,75–82,150–269` declares scheduler, never calls `requestWakeAt`; construction found only in tests | IMPLEMENTED_NOT_INTEGRATED | Establish supported runtime scheduler and demonstrate real wake/restart under separate authorization |
| I16 Addendum C | Prevent duplicate/concurrent wake-ups; Dev | `idle-recovery.ts:125–134` is instance-local claim plus optional file save; no cross-process atomic claim shown | NOT_VERIFIED | Prove cross-process fencing or use a real atomic lease |
| I17 Addendum D §1 | Security scanner triage; Dev | R35:588–622 reports file-mode scan exit 1, classifications only; no independent review | AWAITING_INDEPENDENT_REVIEW | Review sanitized classification; no scanner bypass |
| I18 Addendum D §2 | Investigate alleged commit attempt; Dev | R35:626–678: initiator UNKNOWN, no new successful ref movement found; review pending | INVESTIGATED_NOT_IMPLEMENTED | Attribute only with direct evidence; no Git mutation |
| I19 Addendum D §4 | Investigate P2-CR002; Dev/Reviewer | R35:684–824; reviewer transcript `ses_e509c679effew14i4PHAtyh23y` explicitly PASS for investigation only; record :824 predates review | VERIFIED_COMPLETE | Correct stale review-pending record only in separately authorized documentation work; do not close defect |
| I20 P2-CR002 | Safe RED and minimum correction; Dev/Reviewer | Static production split/unguarded writes R35:738–765; existing untracked `payment.stale-write.test.ts:52–93` asserts the defect, not the desired invariant | PARTIALLY_COMPLETE | Under prior P4 authorization select focused failing invariant test, implement and review; no Mongo/provider access required for initial test |
| I21 MP-35 §8.3 | Establish disposable Mongo test safety; Dev | R35:102–107 reports 10 files, two fixed DB names, 21 unfiltered cleanups as historical inventory | BLOCKED_VERIFIED | Unsafe shared-db execution prohibited; isolated design and safe unit work can proceed |
| I22 MP-35 §8.5 | Full vendor privacy, English UI and 404; Dev/Reviewer | R34:249–261 only detail scope; no exhaustive route/runtime coverage here | NOT_VERIFIED | Audit list and mutation authorization, UI strings and unknown-route behavior separately |
| I23 MP-35 §8.6 | Ledger, webhook, transfers, refund and payout correctness; Dev/Reviewer | T:215–221 and 288 distinguish internal lifecycle from provider integration | PARTIALLY_COMPLETE | Independently trace persistence and provider boundaries; test only in safe scope |
| I24 MP-35/36 | Full instruction reconciliation and reviewed decision dossier; Orchestra/Reviewer | This report explicitly bounded; review not yet requested by this developer | AWAITING_INDEPENDENT_REVIEW | Recover missing sources and actual diff; independent review and correction cycle |
| I25 MP-35 original §12 | Complete six-route recovery runbook and operational recovery; Orchestra | R35:127–162,366–384 describe feasibility and opt-in limitation; no complete runtime runbook established | NOT_VERIFIED | Locate or produce verified procedure under appropriate scope |
| I26 MP-30–33 | Extract all applicable prior instructions and outcomes; Orchestra | Original sessions accessible; partial extraction in supplemental inventory below | PARTIALLY_COMPLETE | Exhaustively correlate remaining source requirements |
| I27 MP-36 §16 | No P5 or S3 operations; all agents | R35:14,174–178; current MP-36 user instruction | EXPLICITLY_PROHIBITED | Human must change the boundary before execution |
| I28 MP-36 §16 | No Git mutations or production/provider operations; all agents | Parent MP-36 §16 and R35:626–632 | EXPLICITLY_PROHIBITED | Preserve worktree; user retains release ownership |
| I29 Q-016 | Mixed-cart coupon calculation; human | Q:211–220; T:230–232 | AWAITING_HUMAN_DECISION | Decide exact allocation/base; other coupon functionality independent |
| I30 Q-018 | Automated invoice generation trigger; human | Q:241–257: on-demand MVP, automation post-MVP | DEFERRED_BY_DECISION | No decision required for current on-demand path |

**Reconciled counts for I01–I30:** VERIFIED_COMPLETE 7; TESTED_SIMULATED_ONLY 3; PARTIALLY_COMPLETE 7; IMPLEMENTED_NOT_INTEGRATED 2; AWAITING_INDEPENDENT_REVIEW 2; INVESTIGATED_NOT_IMPLEMENTED 1; BLOCKED_VERIFIED 1; NOT_VERIFIED 3; EXPLICITLY_PROHIBITED 2; AWAITING_HUMAN_DECISION 1; DEFERRED_BY_DECISION 1. Total 30. See supplemental inventory for its own separately reconciled counts. No SOURCE_NOT_AVAILABLE classification is assigned merely because an accessible source has not been fully examined.

## 6. Agents and execution gaps

- **Orchestra:** capability discovery and checkpoints are evidenced by R35:20–162 and successive appendices. Real cache work was delegated and reviewed (R35:458–520). `tool_1b1533b35001nT6qoeVhppEAoG:1495–1500` documents pause before an actual eight-hour schedule and asks for fresh scope; Addendum D at :1566,1682 explicitly corrects broad authorization assumptions. This pause was **not evidence of compliance with the implemented eight-hour policy**. Whether all three passes occurred before pause is NOT VERIFIED. Recovered Addendum D permitted ordinary safe P4 investigation/focused tests/minimal fixes; requiring a new human approval for all such work was an overbroad interpretation. No conclusion that every possible task was eligible or executed.
- **Developer:** R35:331–342 and :548–565 report focused RED/GREEN and corrections; cache change R35:472–475 explicitly lacks captured RED. Existing `payment.stale-write.test.ts:52–93` is untracked and its assertions expect clobber; labels `RED` do not establish a failing regression test. No current execution or ownership of that untracked artifact is inferred. Preserve it.
- **Reviewer:** explicit narrow PASS on cache (R35:511–519) and investigation (session `ses_e509c679effew14i4PHAtyh23y`); tests not independently executed. Prior idle re-review PASS is coordinator-reported in recalled transcript :1482–1484, whereas R35:576–580 still says pending; report the discrepancy, not an invented run-record update. No broad security or full-system PASS established.

## 7. Failover, continuity and idle detailed findings

| # / requested route | Historical static configuration evidence | Access / integration / live |
|---|---|---|
| 1 GPT | R35:142–144: no GPT entry in inspected repo/global files; current session's model exists but does not prove this specific routing configuration absent everywhere | Installed/current model access does not prove recoverable route; exact route ID and live transition NOT VERIFIED |
| 2 Kilo Beam | R35:145 and `provider-failover.ts:21`: absent in inspected config | Runtime accessibility, identifier and handoff NOT VERIFIED |
| 3 OpenRouter Nemotron | R35:146: exact independent route absent in inspected config | Identifier, authentication readiness and route NOT VERIFIED |
| 4 Cline Nemotron | R35:63–78,147: Cline extension installed; model `nvidia/nemotron-3.5-lightning:free` listed under Cline provider | Config entry is not live access; separate client handoff and tools NOT VERIFIED |
| 5 OpenRouter Free | R35:148: `openrouter/free` listed under Cline provider, not proof of a direct OpenRouter route | Underlying model/tool support and live route NOT VERIFIED |
| 6 Kilo Auto Free | R35:149: requested ID not found in inspected config | ID, accessibility and runtime NOT VERIFIED |

All six are modeled in order (`provider-failover.ts:19–25`) and exercised only in controlled simulation per R35:270–280 and :415–435; session/context preservation and tool-call compatibility are unverified for **every** destination. `resilient-orchestration.ts:93–95` receives a destination but calls the same inner `delegateToCode(request)` without passing it, so attempt labels do not establish provider switching. `:132–133` forwards reviewer calls without equivalent checkpointing. Checkpoint marks `pendingReviewStatus: 'none'`, `workingTreeStateSummary: 'clean'`, `nonIdempotentOpsEncountered: []` unconditionally (:155–166); `lastVerifiedTest` is populated from requested checks (:103–106), not independently verified results. A crash after side effect but before completed checkpoint is not covered by the successful-completion replay guard. `safeToAutoReplay` existence alone is not evidence it is enforced by this path. R35:447 admits helper-only concurrent scheduling. No source-level construction of the resilient port or idle engine outside tests was found in the project TypeScript search; dynamically loaded/external callers were not exhaustively excluded.

Idle A–E: (A) state machine exists, (B) fake-clock tests developer-reported 17 passed and 63 related (R35:548–565), (C) actual orchestration integration not shown, (D) durable scheduler not shown, (E) real autonomous wake not shown. `idle-recovery.ts:6` intervals sum to 480 minutes; :252–266 models final safe stop after five, not proof elapsed time. `:164–175` returns before probing when not due, so newly eligible work needs a separate external trigger or waits; `:203–220` reset comparisons use in-memory `lastSnap`, which is not restored by :90–105; `hasExecuted` likewise is not persisted. `:125–134` is not an atomic multi-process lease, and `:192–195` guards only `financial_transfer`. `save()` is explicit and `requestWakeAt` unused. Whether each of three evaluations independently refreshes dependencies or blocker decisions depends on the injected probe and is not shown by the engine itself. Scheduler capability must be investigated in the actual current runtime: lack of integration is established; global unavailability of every platform scheduler is not.

## 8. FS-01 feature completeness and P2-CR002

| Area | Required behavior / evidence | Current scope and safe next action |
|---|---|---|
| Checkout duplicate prevention | R34:371–387 narrow PASS | Preserve legitimate subsequent purchases; isolate concurrent same-checkout test. Live provider and atomic stock/order proof outstanding (T:200,284). |
| Authorization/capture/PAID | CD-063 `F01/docs/decisions.md:529–616`; `payment.routes.ts:104–115` rejects unverified public confirmation; R35:728–747 | Authorization is not PAID; CAPTURED payment save precedes order update. Verify provider confirmation and persistence separately. |
| P2-CR002 | R35:733–808; independent investigation reviewer session above | **PARTIALLY_REAL**, medium confidence: static split persistence and unconditional non-PAID order writes; duplicate webhooks, terminal overwrite under real Mongo concurrency and actual incidents NOT VERIFIED. Existing retry repairs CAPTURED+pending but does not guarantee atomicity. Tests are sequential in-memory; existing untracked stale-write test asserts overwrite rather than rejecting it. |
| Privacy/cache | R34:249–261, R35:511–519 | Detail and two cache keys/logout have narrow PASS. Audit all lists, mutation responses, and cross-user/browser flows independently. |
| UI language/routing | CD-054 `decisions.md:439–445` English | 404 and exhaustive English compliance NOT VERIFIED; inspect routes and isolated frontend tests. |
| Mongo test safety | R35:102–107 historical inventory | No destructive shared DB tests. Design disposable isolated DB and fail-closed guard first; counts require fresh verification. |
| Elasticsearch | Q:198–207, CD-049 `decisions.md:402`, T:189 | Mongo remains authoritative, ES rebuildable; mapping/sync technical work is not automatically human-blocked. Runtime/search contract NOT VERIFIED. |
| Stripe/webhook/transfer | Q:147–168, T:215–221 | Separate Charges and Transfers decided. Internal paths are not real Stripe test proof; no provider calls in this audit. Check SDK/contract offline; test-mode verification subject to target and credentials without exposing them. |
| Ledger/refund/payout | CD-030 `decisions.md:247–250`, CD-048 :394–397 and CD-064 :618–634 | Wallet balance from transactions; refund/transfer reversal and persistence/duplicate financial effects require separate investigation. Vendor payout ≠ provider transfer by assumption. |
| Invoice | Q:241–257; T:233,292; PDFKit approval `decisions.md:898` | On-demand non-fiscal PDF is MVP; T reports local implementation and 43 tests, not independently rerun. Actual persistence/download needs tracing; S3 is prohibited and retention decisions do not block other work. |
| Coupons/reviews | Q:211–237; T:230–240 | CRUD/eligibility and review flows reported; mixed-cart amount remains undecided, delivery eligibility decided. Test and review scopes require independent confirmation. |
| Admin analytics | Q:42–51; T:234,237; recovered MP-33 user instruction `tool_1b15816c2001Wes3IbI55zseVo:1269–1400` | MP-33 explicitly defines initial vendor and admin financial indicators; older task-list assertion that all admin metrics are undefined is stale for that financial subset. Mathematical details and other operational metrics may remain open; independent implementation and correctness NOT VERIFIED. |
| Other P4 MVP features | T:142–145,189–240 | Task list is a starting inventory, not full verification. Unexamined features remain NOT VERIFIED; no percentage claimed. |

P2 technical alternatives: (1) condition existing-state updates/compare-and-swap, small per-document change but explicit conflict and retry semantics needed; (2) version fields, broader repository/schema compatibility and migration impact; (3) Mongo transaction/session, potentially stronger atomicity but topology, operational behavior and cross-module contracts need proof; (4) idempotent reconciliation, tolerates split persistence but requires durable retry and clearly specified recovery. CD-063 requires PAID only with captured payment; it does not prescribe transactions. A technical design/impact review is needed before broad changes, not automatically a new business decision. A safe focused in-memory regression is already permitted by prior Addendum D, although this MP-36 audit itself forbids implementation.

## 9. Scanner and reported Git attempt

R35:595–617 reports six file/category findings. Individual current scans and line-number-only pattern matching are detailed in the correction addendum below. Their context supports test fixtures and storage-key identifiers, but literal provenance cannot be proven from pattern matching; no claim of universal absence of exposure follows. R34:252 identifies a separate historical tool-output **candidate possible exposure** with credential authenticity unknown: recommend owner-led rotation of any potentially affected credential without reproducing it. External leakage remains NOT VERIFIED. Do not bypass the scanner.

R35:636–677 reports unchanged HEAD and no attributable evidence of initiator; failed attempts need not create reflog entries. Classification **UNKNOWN**, not proof either that an agent attempted a commit or that no attempt occurred. Do not retry; gather sanitized IDE/session evidence if available. The present `git status --short` shows staged and unstaged preexisting work but does not establish who staged it or when.

## 10–13. Blockers, existing decisions and human decision register

| Item / impact | Evidence and classification | Read-only / safe unit / independent work | Removal event |
|---|---|---|---|
| P2-CR002 | Static gaps R35:738–808; missing implementation is **ordinary engineering**, not global human blocker | Yes / yes without DB / yes | Focused invariant RED, bounded fix, review; broader transaction/schema impact independently assessed |
| Shared Mongo tests | R35:102–107; genuine **test-infrastructure safety** issue | Yes / mocked or disposable fail-closed only / yes | Demonstrate isolated target and nondestructive setup before execution |
| Live failover | R35:138–151 and current opt-in source; **unverified capability/config**, no provider calls in audit | Yes / simulated / yes | Separate authorized runtime integration and safe live verification; no new provider preference invented |
| Stripe test mode | Q:147–168; provider flow chosen; actual SDK/environment unspecified here | Yes / mocks / yes | Outside this audit, verify safe test account/config presence and explicitly authorized provider call; no live money |
| ES mapping | Q:198–207 technical-future, not inherently business blocked | Yes / mocks / yes | Implement technical design consistent with CD-049 and assess actual resources |
| Scanner / commit | R35:595–617,664–677; classification pending review, actor unknown | Yes / scanner tests if safely scoped / yes | Independent sanitized review or evidence, no bypass and no Git write |
| Pending review | R35:576–580 contradicts later historical review claim; I24 report pending | Yes / independent tasks yes | Reviewer explicit verdict and evidence; correct run record only if authorized |
| S3/P5 | MP-36 §16, R35:174–178; explicit prohibition | Read-only compatible analysis yes / non-S3 P4 tests yes / independent work yes | Explicit human boundary change; account availability alone insufficient |
| Q-016 | Q:211–220; mixed-cart business calculation undecided | Yes / non-discount tests yes / independent coupon features yes | Approve mixed-cart calculation; affects only dependent calculation |
| Q-018 retention | Q:249–257; Glacier/WORM pending; automation deferred | Yes / on-demand tests yes / non-invoice tasks yes | Human decisions only when these specific future capabilities are pursued |
| Admin scope | MP-33 explicitly defines initial financial metrics; T:234 conflicts/stale for this subset; Q:42–51 separately addresses permission model | Yes / specified metric tests yes / yes | Reconcile task record and implement defined subset; seek decisions only for genuinely unspecified metrics or semantics |
| CR-004 | R35:322–329 says `BLOCKED_*` treated terminal-for-pause; not a canonical business requirement | Yes / yes / yes | Establish distinction between paused and completed and test contractual terminology; decision needed only if competing approved policy cannot be reconciled |

**Already decided:** P4 ceiling/no S3/no P5/manual Git (parent MP-36 §16, R35:14); Stripe test-mode development and Connect Separate Charges and Transfers (Q:147–168; `decisions.md:618–634`); Mongo source of truth and rebuildable ES (`decisions.md:402`); PAID requires captured provider-confirmed payment (`decisions.md:607`, R35:714–716); ownership-based Vendor/Consumer isolation (Q:42–51); shared wallet and transaction-derived balance (`decisions.md:247–250`); invoice non-fiscal, historical, immutable on partial refund and PDFKit approved (`decisions.md:287–314,898`); BRL and English (`decisions.md:439–445`); no FX without requirement (same); six-stage priority (Addendum A, session `ses_e5116df09ffeXzMnJNjzPkTz5Z`, user message); idle intervals 30/60/90/120/180 minutes (same transcript recovered output :1681). Routing/404 decision source not verified by this audit; do not invent it. Current data should not be re-labeled from historical docs without verifying actual implementation.

**Decision D1 — Mixed-cart discount (Q-016).** Context: coupon has included/excluded products and categories; exclusion wins and one selected coupon per vendor is already decided (Q:211–220). Affected: mixed-cart calculation only. Options: apply to eligible line subtotal; alternative allocation/base only with a specified rounding rule. Recommendation: eligible-line subtotal with deterministic minor-unit rounding, subject to business approval. Default: validate eligibility and non-mixed flows now. Approval: **yes**, business amount changes. Deferral leaves mixed-cart discount disabled. Question: should the selected coupon apply only to the eligible items' subtotal, with a specified rounding rule?

**Decision D2 — Admin metric residuals, corrected.** MP-33 already specifies received today/month, confirmed distributions this month and outstanding distribution, plus operational indicators where supported (`tool_1b15816c2001Wes3IbI55zseVo:1317–1387`). Do not ask the user to select those metrics again. Q-003 concerns admin permission sufficiency; older T-1104 text conflicts with the later instruction. First reconcile canonical documentation and implement/test the specified subset. Human approval is **not established as necessary** for that subset; ask narrowly only if research reveals a genuine unresolved business meaning such as refund treatment or timezone that cannot be resolved technically. Other operational metrics remain unspecified.

**Decision D3 — Invoice retention (Q-018).** Context: Q:249–257 leaves Glacier after 90 days and 10-year Object Lock/WORM pending, separate from on-demand MVP. Options: defer retention features; approve each policy after legal/operational assessment; select another documented retention policy. Recommendation: defer irreversible lock and automation until retention obligations are confirmed. Default: local/on-demand P4 investigation without S3. Approval: **yes**, before imposing retention/irreversibility; S3 itself separately prohibited. Deferral affects retention only. Questions are separate: adopt 90-day Glacier transition? Require 10-year WORM? Invoice automation is already deferred, not a current prerequisite.

**Decision D4 — CR-004 pause semantics.** R35:322–329 records an open terminology/behavior ambiguity. Options: a separate pause predicate and mission completion predicate; or explicitly define completion to include blocked tasks with a distinct non-success result. Recommend separate completion vs pause to avoid implying success. Default: research existing contract and add isolated tests, no new policy invented. Approval: **not established** as necessary if existing contract resolves this; escalate only on genuine conflict. Deferral leaves helpers ambiguous, not the whole FS-01 backlog.

Other open entries in Q: Q-004 contact validation, Q-006 inventory concurrency/backorder, Q-009 retries/timeouts, Q-011/012 provider validation, Q-014 retention/TTL, Q-015 ES technical implementation, Q-029 auth policy, Q-030 moderation and Q-024 deployment each have distinct remaining work. This report has **not established which require immediate human decisions**; classify as pending investigation rather than silently combining them or asserting an exhaustive decision queue. Q-003 admin permission sufficiency (Q:42–51) is not resolved merely by two-level MVP retention. CR-004 is a run-record question, not shown as a canonical `open_questions.md` ID.

**Exclusions:** P5/S3/Git/provider calls during audit are temporary explicit prohibitions; invoice automation and frontend item-level delivery are recorded deferred (Q:249–257; T:241); multitenancy and NF-e are explicitly outside MVP (Q:274–282 and :249–256); actual live failover is unverified, not proven permanently impossible. No destructive DB or live financial operations.

## 14. Prioritized proposed P4 execution backlog (not executed by MP-36)

All executable items require normal scoped Developer delegation, focused TDD when applicable, and independent Reviewer. “READY” means within earlier broad P4 authorization, subject to concrete scope, safe environment and dependencies; it is **not** permission to implement in this audit.

| ID / priority / severity | Scope and dependencies | Acceptance and safe test | Human input / next action |
|---|---|---|---|
| B1 P0 high | P2-CR002 one invariant; preserve untracked test | Red test asserts stale update rejected or repair convergence; minimal guard; related isolated tests; review | No new business input for focused engineering; inspect preexisting test and design one correct failing test |
| B2 P0 high | Mongo test isolation, no shared data | Unique disposable DB target plus fail-closed tests before any cleanup | No business decision; inspect setup/cleanup statically and implement unit-tested guard in separate scope |
| B3 P1 high | Vendor privacy list/mutation; depends on relevant API files | Cross-vendor response and authorization regressions, independent review | None known; inspect list and mutation serializers |
| B4 P1 high | Financial webhook, ledger/refund idempotency | One defect at a time, safe fakes, then independently scoped review | Technical research first; no provider call |
| B5 P1 medium | Idle scheduler and replay safety | Real supported runtime adapter, atomic ownership, truthful checkpoints and tests; actual wake evidence separate | Runtime mechanism must be established; no assertion OS scheduler unavailable |
| B6 P1 medium | ES mapping/indexing | Contract tests using fakes, Mongo authoritative and rebuildable | No business decision for technical mapping; inspect T-302 and existing code |
| B7 P2 medium | English/404 and cache logout end-to-end | Focused frontend behavior and identity-switch tests | None known; inspect routing and strings |
| B8 P2 medium | Q-016 mixed-cart algorithm | Approved calculation and rounding, vendor-scoped tests | Human D1; independent coupon work continues |
| B9 P2 medium | Admin financial metrics specified in MP-33 | Period, confirmed-payment and distribution tests; verify role and underlying records | No new approval for already specified metrics; research remaining semantic conflicts |
| B10 P2 medium | Test-mode Stripe | Safe offline contract audit first, then separately authorized safe test-mode call | Credentials/config/target availability must be verified without values; no live operations |

Potential parallel work B1, B2, B3, B6 and B7 only after confirming actual file/resource disjointness and avoiding simultaneous shared-DB activity. B4 may conflict with B1 in payment/order files; sequence them if so. No task is actually scheduled or executed here.

## 15. Recommended next mission and human decision queue

First obtain independent review of this **incomplete draft**, including instruction coverage, classifications and security; recover missing MP-30–34/35 sections and enumerate remaining FT/AT deliverables before treating the dossier as comprehensive. Then, after presenting it for human review, run one focused P4 correction beginning with B1; do not conflate a release decision with this audit.

**Human decision queue**, ordered by direct authorized work potentially unblocked: (1) D1 mixed-cart coupon basis and rounding; (2) D3 invoice retention only when that deferred work is authorized. Initial financial dashboard indicators were already specified by MP-33; D2 is a documentation/technical reconciliation rather than an immediate decision. Q-003 permission sufficiency needs requirement analysis before escalating. CR-004 is technical unless a real policy conflict is shown. No new decision is required merely for safe P4 investigation, isolated unit tests, or ordinary scoped fixes under the earlier mission; MP-36 itself remains audit-only.

## Verification, scope and limitations

- This report alone is authorized for creation; no application/orchestration source, run record, Git index or external system was changed. No tests or provider calls were run. Documentation-only TDD is not applicable.
- `git status --short && git branch --show-current && git cat-file -t 5ccc9b6acebec6e51aaa96155982be00cc8d1b02` returned the expected branch and `commit`, plus preexisting staged/unstaged files and an untracked stale-write test. Existing run record inspected and its run ID confirmed. Exit code was not separately captured by the tool; successful final output indicates the chained commands completed, not proof of unchanged state after the observation.
- Source searches and reads are static; local transcripts are historical artifacts. No complete instruction extraction, complete feature audit, real runtime test, independent report review, or comprehensive historical leak investigation was done. No claim of production safety or release readiness is made.

## Correction addendum — recovered MP-30–34 chain and scanner (2026-11-06)

Independent review returned **CORRECTIONS_NEEDED**: CR-001 and CR-002 HIGH, CR-003 MEDIUM. This addendum corrects source availability, financial-dashboard decisions and historical security reporting. It remains subject to independent re-review. Source shorthand: `H30` = recalled session `ses_e532607f7ffe10JcdqNHJ9e5Hy`, saved retrieval `tool_1b15816c2001Wes3IbI55zseVo`; `H34` = session `ses_e51eeeb36ffedhZ7j821Y5HnMS`, retrieval `tool_1b15816c1001KRWAVNJ9Fa8ofx`. Line ranges refer to these local tool-output artifacts, not committed project files. Some transcript messages were truncated by the retrieval mechanism; the available output is not proof that all historical messages were captured.

### Historical timeline and numerical reconciliation

| Moment | Evidence | What it proves / does not prove |
|---|---|---|
| MP-30 report | H30:876–948 claims HEAD `c5bc340`, 3 modified files; backend 957 passed, 36 failed, 3 skipped (996 total); frontend 569 passed, 15 failed (584 total), and simultaneously reports exit 0 | Historical claims only. Arithmetic is consistent within each suite, but frontend exit 0 with 15 failures is unexplained and cannot establish successful testing. The 36 backend failures cannot be partly attributed to frontend failures without further evidence. |
| MP-32/33 report | H30:1975–2093,2251–2252,2730–2745 reports HEAD `07fd4ec`, 30→7 TS errors; backend 991/997, 3 failures; frontend 566/584, 18 failures | 991 + 3 = 994, leaving three outcomes not accounted for by that statement; 3 skipped is plausible but not established by this report alone. 566 + 18 = 584. Reported four additional dashboard diagnostics and whether they overlap with seven remain unresolved. Exact diagnostic output needed; no test run today. |
| MP-34 first checkpoint | R34:5–17,25–27: baseline `07fd4ec`; reported 14 tracked/8 untracked then observed 24 tracked/8 untracked before record creation; reported 994 backend pass/3 skip, 584 frontend pass, TS exit 0 | Reports have different times/scope and cannot be substituted for each other. Exact commands/full historical output missing; no conclusion that MP-33 counts were reproduced. |
| MP-34 subsequent checkpoint | R34:36–39: 24 tracked and 9 untracked including run record | Expected count difference for newly created record, not proof of source of other changes. |
| MP-35 Stage A | R35:109–113,248–253: clean state reported at HEAD `5ccc9b6`, after `07fd4ec` | Newer baseline supersedes earlier worktree snapshot, not history or attribution of intervening changes. |
| MP-36 | `git status --short` from this task showed staged/unstaged prior work and untracked stale-write test; branch and base commit verified | Current observation only; who staged or produced prior files and exact transition between baselines remain unknown. No Git mutations by this audit. |

### Supplemental requirement inventory — 24 separately classified rows

These rows extend, rather than replace or double-count, I01–I30; each represents one narrow outcome. An unavailable **result** is `NOT_VERIFIED`, not an unavailable accessible source.

| ID / source | Requirement / responsible role | Actual execution and verification level | Status | Remaining step / blocker or decision |
|---|---|---|---|---|
| S01 MP-30 §2 | Reconcile MP-29 baseline / Orchestra | H30:876–899 historical report; no full diff audit here | PARTIALLY_COMPLETE | Reconcile original baseline and present source. |
| S02 MP-30 §4.1 | No stored-value wallet or simulated transfers / Dev | H30:154–172; Q:181 and T:215–221 distinguish internal and provider behavior | NOT_VERIFIED | Trace current wallet routes/UI and actual provider proof. |
| S03 MP-30 §4.2 | Immutable event and Mongo persistence / Dev/Reviewer | H30:173–196; MP-33 claims foundation, R34:18 says static privacy/finance audit only | PARTIALLY_COMPLETE | Prove append-only repositories, indexes, duplicate and out-of-order behavior in safe isolation. |
| S04 MP-30 §4.3 | Per-vendor gross, commission, expected versus received / Dev | H30:197–217 and :1269–1316 | NOT_VERIFIED | Verify scoped calculations and no premature received status. |
| S05 MP-30 §4.4 | Retry checkout, clear cart only on confirmed payment / Dev | H30:218–230; R34:371–387 narrow duplicate correction | PARTIALLY_COMPLETE | Test retry, cart persistence and provider-confirmed clearing. |
| S06 MP-30 §4.5 | Reject own-store purchases; allow dual-role other vendors; admin cannot buy/self-register / Dev | H30:231–242 | NOT_VERIFIED | Trace ownership on backend and UI; isolated actor tests. |
| S07 MP-30 §4.6 and MP-33 §16 | On-demand streamed invoice, no permanent file or false URL / Dev | H30:243–261,1500–1537; Q:249–257 also describes S3 storage, a documented conflict | NOT_VERIFIED | Trace actual generation and download; reconcile later explicit no-storage instruction with canonical Q-018 without performing S3. |
| S08 MP-30 §5B | Multivendor provider financial lifecycle / Dev/Reviewer | H30 mission, T:215–221 reports internal lifecycle only | NOT_VERIFIED | Separate safe simulation and eventually authorized test-mode evidence. |
| S09 MP-30 §5C | Complete actor action matrix / Dev/Reviewer | H30 mission §5C; R34:249–261 is detail-only | NOT_VERIFIED | Inventory endpoint ownership and negative cases. |
| S10 MP-30 §5E | Catalog, ES search/index/rebuild / Dev | Q:198–207 and T:189 | PARTIALLY_COMPLETE | Implement and verify actual mapping/sync without treating technical future as human gate. |
| S11 MP-30 §5F | Delivered-order review flow / Dev | Q:224–237,418–428; T:230,240 reports implementation | PARTIALLY_COMPLETE | Independently verify order-based UI and server eligibility. |
| S12 MP-30 §7 | CI lint/types/tests/build, no deployment / Dev | H30 original §7; actual CI existence and branch triggers not inspected | NOT_VERIFIED | Inspect workflow files and classify P4 eligibility. |
| S13 MP-31 Marketplace | Payment status persistence fixes / Dev | `docs/agent_runs/orch-afirdd-exec-02-2026-11-05.md:125–187`, R35:728–756 | PARTIALLY_COMPLETE | Historical tests and current cross-machine correctness need independent confirmation. |
| S14 MP-32 Marketplace | Runtime reproduction: payment, webhook, checkout, UI / Dev | H30:2693–2706; `F01/docs/analysis/mp33_discrepancy_matrix.md:9–94` historical claims contain obsolete assertions | PARTIALLY_COMPLETE | Reconcile current source instead of accepting that matrix as current. |
| S15 MP-32 scanner | Markdown inline-code handling / Dev/Reviewer | `F01/docs/mp_log.md:2716–2795`; session `ses_e5d2f5a82ffebQVe3zJkn2qnWt` final report says self-review, contrary to an intermediate quoted PASS | PARTIALLY_COMPLETE | Distinguish self-review from independent verdict; inspect separate reviewer transcript and scanner limitations. |
| S16 MP-33 §12 | Distinguish lifecycle event from actual financial movement / Dev | H30:1025–1129 defines contract; R34:18 finance audit static | NOT_VERIFIED | Verify persisted classification and event identity. |
| S17 MP-33 §12 | Financial ledger immutability, replay, reconciliation / Dev | H30:1167–1258 lists required Mongo and retry scenarios | NOT_VERIFIED | Run only safe isolated tests after proving environment isolation. |
| S18 MP-33 §13 | Vendor dashboard indicators and ownership / Dev | H30:1269–1316 specifies gross, net expected, Stripe received, pending, bank payout and history | NOT_VERIFIED | Trace calculations and isolation against real underlying records. |
| S19 MP-33 §13 | Admin received today/month, distributed and pending / Dev | H30:1317–1387; T:234 older contradictory undefined scope | NOT_VERIFIED | Reconcile task docs and implement specified subset; no new metrics decision. |
| S20 MP-33 §14–15 | Two-vendor, period-aware financial scenarios / Dev/Reviewer | H30:1439–1490: 100/200 gross, 10% commission, 90/180 net, 300 gross and 270 total net; pending, transfer, retry, payout, refund | NOT_VERIFIED | Verify each scenario separately and effective dates; illustrative amounts do not set rates. |
| S21 MP-34 §3 A1–A2 | Resolve TypeScript and pass/fail/skip contradictions / Orchestra | H34:100–140 and timeline above; R34:15 calls later counts historical | PARTIALLY_COMPLETE | Obtain exact command/output and diagnostic identities; avoid unsafe suite. |
| S22 MP-34 §3 A3–A7 | English UI, full identity switching, routes/404, lifecycle and timeline / Dev/Reviewer | H34:145–268; R34:249–261 and R35:511–519 are narrow privacy/cache reviews | PARTIALLY_COMPLETE | Audit remaining surfaces, persisted timeline and reduced-motion behavior. |
| S23 MP-34 §4 B1–B5 | Ledger, Stripe semantics, wallet and dashboard scenario audit / Dev/Reviewer | H34:270–420; current evidence static/partial | PARTIALLY_COMPLETE | Verify pending/failed/reversal/refund/payout/duplicate/out-of-order/time-period cases, no provider call now. |
| S24 MP-34 §5 | Full workflow security exposure across channels / Orchestra/Reviewer | H34:422–480; R34:69,212,252: incomplete channels and possible candidate exposure | PARTIALLY_COMPLETE | Owner-led containment for affected credential if warranted, safe historical evidence and separate reviewer. |

**Supplemental counts:** PARTIALLY_COMPLETE 12 (S01,S03,S05,S10,S11,S13,S14,S15,S21,S22,S23,S24); NOT_VERIFIED 12 (S02,S04,S06,S07,S08,S09,S12,S16,S17,S18,S19,S20). Total: **24**. No other classifications occur in this supplemental inventory. Combined I01–I30 and S01–S24: VERIFIED_COMPLETE 7, TESTED_SIMULATED_ONLY 3, PARTIALLY_COMPLETE 19, IMPLEMENTED_NOT_INTEGRATED 2, AWAITING_INDEPENDENT_REVIEW 2, INVESTIGATED_NOT_IMPLEMENTED 1, BLOCKED_VERIFIED 1, NOT_VERIFIED 15, EXPLICITLY_PROHIBITED 2, AWAITING_HUMAN_DECISION 1, DEFERRED_BY_DECISION 1 = **54**. Counts cover only these 54 rows, not all material instructions in the recovered sessions.

### Workflow security — classified channels

R34:43–46,68–80,212,252 records a logging risk and a historical candidate possible exposure in tool output, authenticity unknown. **Candidate exposure, severity potentially high; real credential and external leak NOT VERIFIED.** Owner-led rotation of any potentially affected credential is recommended; do not reproduce or independently inspect credential-bearing output. P01a narrow PASS (R34:227–233) concerns a correction, not historic exposure. Git history/ref state was inspected in the prior attempt investigation (R35:636–677); it cannot prove no failed attempt or prior leak. This audit inspected only sanitized scanner categories and historical reports, not environment/auth files, raw application logs, shell history, provider dashboards, backup/snapshot contents, external destinations or complete inter-agent context. Access, exposure, and external transmission cannot be conflated. Missing complete historical logs remain a security-evidence gap.

### Individual scanner findings — safe current checks

Three **separate** explicit-file invocations of `bash scripts/scan-secrets.sh <file>` were run, reporting blocked categories only; none printed matching values. `authStore.test.ts`: password, API-key and generic-token patterns. `authStore.ts`: API-key and generic-token patterns. `ConsumerProfile.test.tsx`: password pattern. A separate subprocess check captured exit **1** for each; it captured exit **0** for this report. Historical combined invocation in R35:595–605 also reported exit 1. A Python metadata-only enumeration, without printing lines or values, returned:

| File/category | Matching line numbers | Context / disposition |
|---|---|---|
| `authStore.test.ts`, password | 155,175 | Test fixture context; R35:610 classified fictional. No independent proof of origin of every literal; no real credential established. |
| same, API key | 74,92,110,119,145,193,216,232,236,247,255,260,288,362,380,400 | Test response/assertion context; R35:611 classified fixture. Literal authenticity not proven from pattern alone. |
| same, generic token | 74,92,110,119,120,145,193,216,217,231,232,236,247,248,255,256,260,287,288,362,380,400 | Overlaps API matches; do not count each label as a distinct secret. Test fixture classification remains evidence-limited. |
| `authStore.ts`, API/generic | 48; 48,49 | R35:612–613 identifies local storage key names, not token contents; false-positive property-name matches. |
| `ConsumerProfile.test.tsx`, password | 138,139 | Test fixture context; R35:614 classified fictional; authenticity cannot be established by regex alone. |

Metadata enumeration used case-insensitive Python regex approximating scanner patterns and does not reproduce the scanner's full line filtering; differences from R35 line lists may reflect source or matcher differences. It does not establish that a token was transmitted or that tests accessed actual credentials. No value-level manual classification was performed. Recommend independent sanitized review; do not disable or weaken the scanner.

### Open-question reconciliation — all Q-001–031

`F01/docs/open_questions.md` is the source for the following; status labels are not automatic blockers. Q-001: person physical schema technical future (:16–25); Q-002: CPF/CNPJ validation technical future (:29–38); Q-003: admin permission matrix sufficiency partial (:42–51), while later MP-33 financial indicators are already directed; Q-004: allowed contact types/validation pending (:55–64), affects only dependent contact behavior; Q-005 resolved (:68–77); Q-006 reservation/backorder/concurrency technical future (:81–90), safe correctness research proceeds; Q-007 resolved (:94–103); Q-008 marked resolved but its own text retains filter/inheritance pending (:107–116), reconcile rather than silently close; Q-009 retry/timeouts/webhook correlation technical future (:120–129); Q-010 resolved (:133–143); Q-011/012 provider verification remains technical/environmental (:147–168), Stripe test-mode implementation already authorized by MP-30 and MP-34, although provider calls are forbidden **in this audit**; Q-013 resolved (:172–181); Q-014 final cart TTL/session timeout pending (:185–194), existing configurable default permits independent contract work; Q-015 ES mapping/sync technical (:198–207), not automatically human-blocked; Q-016 mixed-cart calculation genuinely business-pending (:211–220); Q-017 resolved (:224–237).

Q-018 (:241–257): commercial non-fiscal invoice and on-demand MVP are decided; Glacier transition after 90 days and 10-year WORM are separately **pending future retention decisions**, with options to approve, reject, or defer each, and require human approval before irreversible policy; automatic trigger remains deferred post-MVP and any future timing decision does not block current on-demand functionality. Q-018 says S3 Standard-IA, whereas later MP-30/33 instructions prohibit permanent PDF storage and S3 operations: document this conflict without silently choosing a canonical resolution. Present safe work can inspect/test streamed on-demand invoice with no S3; S3 remains explicitly prohibited. Q-019 vendor dashboard baseline resolved (:261–270), augmented by later financial indicators; Q-020 single marketplace resolved (:274–282); Q-021 history/deletion resolved (:286–295); Q-022 API style resolved (:299–309); Q-023 architecture resolved but installation claim may be stale (:313–322); Q-024 deployment technical future and P5/production prohibited (:326–335); Q-025 dedicated LGPD workstream out of scope (:339–348), ordinary security still required; Q-026 BRL/English resolved (:352–361); Q-027 manual refresh resolved (:365–374); Q-028 three-layer testing strategy resolved (:378–387), execution scope still P4; Q-029 login-email change/removal policy undefined and MFA/recovery technical future (:391–401), investigate specific behavior before seeking human policy; Q-030 comment moderation deferred (:405–414); Q-031 delivered-order review flow resolved (:418–428). CR-004 is an orchestration semantic question in R35:322–329, not Q-004.

**Limits after correction:** The recovered instructions show many distinct acceptance tests; this supplemental inventory groups some related requirements and does not yet establish complete coverage. The independent audit must evaluate remaining MP-30–35 prompts, authoritative dashboard/invoice conflicts, each FT/AT and all relevant financial scenarios. No tests, provider calls, external systems, Git writes, source edits, or existing run-record edits were performed in this correction.

**Correction verification:** `python3 -c 'import pathlib,collections,re; t=pathlib.Path("docs/agent_runs/mp-36-forensic-audit.md").read_text(); rows=[l.split("|") for l in t.splitlines() if re.match(r"\| [IS]\d\d ",l)]; print("rows",len(rows)); print(dict(collections.Counter(r[-3].strip() for r in rows)))'` returned 54 and exactly the combined counts above (exit 0). `git status --short -- docs/agent_runs/mp-36-forensic-audit.md docs/agent_runs/mp-35-2026-11-06.md` showed the report untracked and the preexisting reference record staged/unstaged (`AM`); no Git mutation was made. Scanner results are heuristic, not proof of absence of secrets.

## Re-review correction — scenario-level trace (2026-11-06)

Reviewer returned **CORRECTIONS_NEEDED** CR-001-R1, CR-002-R1 and CR-004-R1. S13 now cites the verified existing `docs/agent_runs/orch-afirdd-exec-02-2026-11-05.md:125–187`, not the nonexistent F01 path. Its historical :129–146 itself reports contradictory pass/fail/skip and zero exits; these claims are not independently validated. The following scenario trace is a **drill-down of existing rows**, not additional independent requirements for the 54-row aggregate: counting it again would double-count parents I07–I16 and S20–S23. Scenarios are individually listed because evidence varies. Where the same evidence applies, a group uses a single shared evidence entry; that is not an assertion of identical implementation coverage.

### FT-01–FT-26 — original acceptance identifiers

FT source: `tool_1b1533b35001nT6qoeVhppEAoG:506–547,790–815`. `F` = `kilo-orchestration/tests/provider-failover.test.ts`; `R` = `tests/resilient-orchestration.test.ts`; `C` = `tests/continuity-checkpoint.test.ts`; `T` = `tests/task-state.test.ts`. These are static test-source observations and historical reported test runs, **not executions in MP-36**. The run-record's Stage A FT numbering at R35:193–220 is a discovery mapping and must not be mistaken for the original acceptance numbering.

| ID | Intended outcome | Evidence / classification / exact gap |
|---|---|---|
| FT-01 | GPT 429 → Beam | R:117 simulated real orchestrator entry with injected mock; `TESTED_SIMULATED_ONLY`; no real provider switching. |
| FT-02 | Beam unavailable → OpenRouter Nemotron | F:34–45 skips unavailable entries but exercises Cline→router, not this particular pair; `NOT_VERIFIED`. |
| FT-03 | OpenRouter Nemotron → Cline | F:34–45 skips first three, does not demonstrate prior actual failure; `NOT_VERIFIED`. |
| FT-04 | Timeout bounded retry/failover | F:22–25 classification; controller :142–195 has bounds but no implemented backoff; `PARTIALLY_COMPLETE`. |
| FT-05 | Authentication failure no uncontrolled retry | F:28–32 and R35:418–420 simulation; `TESTED_SIMULATED_ONLY`. |
| FT-06 | All unavailable → checkpoint/safe stop | R:163 and R35:426–427 simulated exhaustion; `TESTED_SIMULATED_ONLY`. |
| FT-07 | Completed file modification not repeated | R35:422–424 simulates completed delegation report recovery, not actual interrupted file modification; `PARTIALLY_COMPLETE`. |
| FT-08 | Interrupted non-idempotent action never replayed | `resilient-orchestration.ts:55–87` handles completed checkpoint; crash after side effect before completion not proven; `NOT_VERIFIED`. |
| FT-09 | Recover scope and TDD phase | `resilient-orchestration.ts:145–166` writes fields, with current phase derived from checkpoint stage; semantic recovery `NOT_VERIFIED`. |
| FT-10 | Reviewer unavailable does not block independent READY | R35:429–430 helper simulation; no real cross-task scheduler (R35:447); `TESTED_SIMULATED_ONLY`. |
| FT-11 | AWAITING_REVIEW not global completion | `TESTED_SIMULATED_ONLY`: R35:429–430 helper tests reported; actual runtime termination integration remains unverified. |
| FT-12 | Provider failure never triggers Git mutation | Safety constraint and simulated controller inspected; no comprehensive runtime proof; `NOT_VERIFIED`. |
| FT-13 | No credentials in provider logs/reports | Scanner heuristics and no calls here do not prove all logs; `NOT_VERIFIED`. |
| FT-14 | App/test failure does not rotate | F:15–20; `TESTED_SIMULATED_ONLY`; real error translation may differ. |
| FT-15 | Priority and verified availability | F:10–13,34–45 static six-order and skips; `TESTED_SIMULATED_ONLY`; all live availability not proved. |
| FT-16 | Developer/Reviewer responsibilities survive recovery | `resilient-orchestration.ts:132–133` reviewer directly forwarded; `NOT_VERIFIED`. |
| FT-17 | Cross-project task-state isolation | Checkpoint mission/task identifiers are sanitized (R35:305–315); project isolation under shared storage `NOT_VERIFIED`. |
| FT-18 | Transient errors cannot loop indefinitely | F:48–53 and R35:426–427 bounded mock; `TESTED_SIMULATED_ONLY`. |
| FT-19 | Cline fails → free router | F:34–45 exercises this route in fake controller; `TESTED_SIMULATED_ONLY`. |
| FT-20 | Free router fails → Auto Free | F:34–53 uses configured default where Auto Free skipped; `NOT_VERIFIED`. |
| FT-21 | Auto Free fails → durable stop | R35:426–427 generic mock exhaustion, not proven for actual Auto Free; `NOT_VERIFIED`. |
| FT-22 | OpenRouter and Cline Nemotron distinct | F:10–13 lists distinct destination IDs; `TESTED_SIMULATED_ONLY`, provider identity not live-proved. |
| FT-23 | Router model without tools rejected safely | No capability check established in `provider-failover.ts:142–199`; `NOT_VERIFIED`. |
| FT-24 | No recursive fallback loop | F:48–53 bounded controller simulation; `TESTED_SIMULATED_ONLY`; real integration absent. |
| FT-25 | All six tried in exact order | F:10–13 checks list, :34–45 deliberately skips four; all-six actual attempts `NOT_VERIFIED`. |
| FT-26 | Preserve Orchestra/Dev/Reviewer roles | reviewer delegation is direct pass-through; real role continuity `NOT_VERIFIED`. |

Original FT statuses in this drill-down: `TESTED_SIMULATED_ONLY` 11 (01,05,06,10,11,14,15,18,19,22,24); `PARTIALLY_COMPLETE` 2 (04,07); `NOT_VERIFIED` 13 (02,03,08,09,12,13,16,17,20,21,23,25,26). Total: **26**. These are scenario statuses, not new aggregate parent counts.

### IDLE-01–15 — original acceptance identifiers, not test-label aliases

The original definitions are at `tool_1b1533b35001nT6qoeVhppEAoG:1309–1341`. The implementation test's IDLE numbering differs: for example original IDLE-02 means READY in pass two, while `idle-recovery.test.ts:96–97` labels progressive intervals IDLE-02. Do not equate names without reading behavior. R35:548–565 reports 17 tests and 63 related checks from Developer, not independent execution.

| Original ID | Required behavior | Evidence / status |
|---|---|---|
| IDLE-01 | Three distinct evaluations | `tests/idle-recovery.test.ts:68–95` fake probe; `TESTED_SIMULATED_ONLY`; real refresh not demonstrated. |
| IDLE-02 | READY on pass two executes | `tests/idle-recovery.test.ts:129–167` eligible selection simulated; exact second-pass timing requires assertion inspection; `PARTIALLY_COMPLETE`. |
| IDLE-03 | Three empty passes then 30m | test :68–95; `TESTED_SIMULATED_ONLY`. |
| IDLE-04 | 30m then 60m | test :96–128 fake clock; `TESTED_SIMULATED_ONLY`. |
| IDLE-05 | 90/120/180 in order | test :96–128; `TESTED_SIMULATED_ONLY`. |
| IDLE-06 | Final recheck then safe stop | test :96–128; real elapsed 8h not shown; `TESTED_SIMULATED_ONLY`. |
| IDLE-07 | READY during idle picked up at next check or notification | :160–175 early return; test :168–194, event-driven immediate resume not shown; `PARTIALLY_COMPLETE`. |
| IDLE-08 | Completed review unblocks work | test :195–213 fake snapshot; `TESTED_SIMULATED_ONLY`. |
| IDLE-09 | Restart preserves state and next wake | test :331–353 persists file; actual wake scheduling absent; `PARTIALLY_COMPLETE`. |
| IDLE-10 | Duplicate triggers cannot concurrently execute mission | test :413–463 simulates instance claim; no atomic cross-process fence; `NOT_VERIFIED`. |
| IDLE-11 | No provider calls/token use while waiting | No live scheduler/wait execution proven; `NOT_VERIFIED`. |
| IDLE-12 | No completed/non-idempotent replay | tests :309–330,383–412 use controlled state and narrow operation; broader crash/financial cases `PARTIALLY_COMPLETE`. |
| IDLE-13 | Unsupported scheduling honestly reported | test :464–end exercises absent scheduler; `TESTED_SIMULATED_ONLY`. |
| IDLE-14 | Cosmetic update does not reset | test :272–308; `TESTED_SIMULATED_ONLY`. |
| IDLE-15 | New authorized task resets | test :232–249; `TESTED_SIMULATED_ONLY`. |

Scenario totals: 9 `TESTED_SIMULATED_ONLY` (01,03,04,05,06,08,13,14,15), 4 `PARTIALLY_COMPLETE` (02,07,09,12), 2 `NOT_VERIFIED` (10,11) = 15. They remain bounded by I13–I16, not new completed work.

### Addendum B AT-01–12 and controlled execution

The accessible saved recall output contains a truncation marker at `tool_1b1533b35001nT6qoeVhppEAoG:951`; original AT-01–11 texts are not present in that recovered output. Historical summary :1121–1122 associates AT-01/02/04 with task selection and AT-05–10 with execution/review, but does not give exact acceptance wording. **AT-01–11: NOT_VERIFIED, exact criteria not recovered**; do not invent them. Original AT-12 at :955 requires boundaries; relevant explicit prohibitions were preserved by this audit, but all prior-agent operations were not exhaustively observed: **AT-12 NOT_VERIFIED**. R35:458–520 shows one actual selected cache task and narrow review; it does not by itself demonstrate every AT criterion. Next safe action: retrieve the original Addendum B message through a transcript mechanism that does not collapse the middle, then map each exact AT separately.

### Individual financial scenarios — drill-down of S20/S23

Source H30:1439–1505 and H34:350–420. The expected financial values are illustrative, not a commercial rate. All rows below are **NOT_VERIFIED as end-to-end scenario outcomes in this audit**, because no independent current test output or provider/Mongo execution was reviewed; a row is not marked failed solely for missing proof. Shared next safe step: inspect current tests/contracts; add isolated TDD tests one behavior at a time, without shared DB/provider, then independently review; actual provider confirmation requires separately safe test-mode execution outside this audit.

| Scenario | Required outcome / distinguishing evidence needed |
|---|---|
| Two vendor allocation | A gross 100/net 90; B gross 200/net 180; total gross 300, commission 30, net 270. Independently verify vendor and global totals. |
| Consumer payment confirmed | Count one confirmed consumer charge; checkout creation alone is insufficient. |
| Payment and order persistence | Confirm captured payment persisted before PAID; split-window repair and real concurrency separately tested (R35:738–765). |
| Both transfers pending | Neither counted as distributed; outstanding obligations correct. |
| A confirmed, B pending | Count A once; B remains outstanding. |
| Failed B transfer | Do not count failure as a movement or successful distribution. |
| Retry B transfer succeeds | One final distribution, no duplicate movement. |
| Reversal | Linked compensating event; preserve original movement and adjust relevant totals. |
| Refund before/after transfer | Correct refund, commission and reversal implications; do not invent missing policy. |
| A bank payout pending | Distinguish connected-account transfer from bank receipt. |
| A bank payout confirmed | Count bank payout only with appropriate provider evidence. |
| Duplicate provider event | Stable identity, idempotency and single economic movement. |
| Out-of-order event | Preserve valid monotonic state without assuming arrival order. |
| Reconciliation discrepancy | Detect mismatch against authoritative records, no fabricated correction. |
| Cross-month/effective date | Payment, transfer and payout belong to their own effective periods; day/month/year/offset boundaries H30:1439–1454. |
| Vendor isolation | A cannot read B private financial records; Admin may read authorized aggregate. |
| Historical immutability | Persisted original and linked corrections survive; TypeScript readonly alone is insufficient. |

### Decision disposition by remaining question

| IDs / affected work | Classification now | Next safe action / event |
|---|---|---|
| Q-001, Q-002 | Deferred **technical work** for physical person model and validation, Q:16–38 | Inspect existing implementation and required validation; no human decision established yet. |
| Q-003 | **Technical requirements evaluation** of admin permission sufficiency, Q:42–51; defined MP-33 financial indicators do not wait for unspecified metrics | Compare approved actions with current admin matrix; ask only about a demonstrated business gap. |
| Q-004 | **Potential present human decision** only if a current feature needs unspecified allowed contact types, Q:55–64 | Existing confirmed fields proceed; identify exact supported type list and business impact before asking. |
| Q-006 | Deferred business policy for reservations/backorder; concurrency is **technical safety work**, Q:81–90 | Test stock safety independently; ask policy only if enabling reservations/backorders. |
| Q-008 | Open filter/inheritance semantics despite `RESOLVED` heading, Q:107–116 | Determine whether authorized search needs those semantics; request narrow decision only if required and not already specified. |
| Q-009 | Technical retry/timeout/correlation, Q:120–129 | Research provider and idempotency behavior; no new human decision established. |
| Q-011/012 | Test infrastructure/provider validation, Q:147–168 | Test-mode implementation already authorized; audit prohibits provider calls; determine safe environment outside this audit. |
| Q-014 | **Present policy decision** if final cart/session retention is required; Q:185–194 explicitly permits current configurable default meanwhile | Continue contract tests; ask retention/timeout only for final policy, do not treat 30 days as approved. |
| Q-015 | Technical mapping/sync, Q:198–207 | Proceed consistent with Mongo source of truth; no human gate merely from technical-future status. |
| Q-016 | **Present human business decision**, Q:211–220 | Decide mixed-cart discount basis and rounding; other coupon work independent. |
| Q-018 | Glacier and WORM **future separate human decisions**; generation automation **deferred future decision**; on-demand now decided, Q:241–257 | On-demand no-S3 work proceeds; reconcile later no-storage instruction vs older S3 document, without S3 calls. |
| Q-023 | Technical implementation/state verification, Q:313–322 | Check current package/source; stale installation statement is not a human decision. |
| Q-024 | Deployment-target decision **deferred**, Q:326–335 | No P5/production implementation in this audit; local P4 work continues. |
| Q-029 | **Potential present human decision** for change/removal policy if current auth workflow requires it, Q:391–401; MFA/recovery technical future | First inventory current policy and safely preserve login integrity; escalate only exact unresolved rule. |
| Q-030 | Comment moderation **deferred future decision**, Q:405–414 | Existing immutable one-comment contract remains; do not block it. |
| CR-004 | Pause/completion naming is **technical contract clarification**, R35:322–329 | Inspect existing termination invariants and isolate test; ask human only on actual unresolved conflict. |

Remaining Q-005,007,010,013,017,019–022,025–028,031 have resolved/out-of-scope portions cited in the previous register; no new human decision is asserted. Q-008's unresolved portions are not erased by its heading. A present decision is task-specific, not an instruction to stop independent P4 work.

### Scanner disposition and safe next actions

Each `authStore.test.ts` password/API-key/generic match and each `ConsumerProfile.test.tsx` password match listed in the prior table is a **likely test-fixture false positive by code context**, with literal origin and actual credential status **NOT_VERIFIED**. Next: an authorized reviewer checks sanitized fixture provenance without disclosing values; replace a fixture only in an authorized implementation task if proven problematic. `authStore.ts:48–49` are storage-key identifiers per R35:612–613: **false-positive property-name matches**, not evidence of a stored credential value. Next: independent sanitized review, retain scanner. No evidence from these categories alone proves exposure; separate historical candidate R34:252 warrants owner-led rotation recommendation. These classifications do not override mandatory protection or authorize a scanner bypass.

**Remaining limitations:** Original Addendum B AT text is only partially recovered in the available transcript output; full MP-30–35 prompts and requirements are not yet exhaustively extracted, and individual financial runtime scenarios remain unexecuted. Therefore CR-001-R1 cannot honestly be reported resolved in full. This report is ready for another independent review as a **partial correction**, not a completed exhaustive audit. Parent 54-row counts are unchanged; FT, IDLE and financial trace tables are drill-downs and must not be added to them.

## MP-36R continuation — corrective audit (2026-11-06)

This continuation preserves the earlier audit trail. The AT-recovery statement immediately above is **superseded**: exact AT-01–12 wording was recovered using individual `kilo_local_recall` searches, not a full transcript read. The latest independent re-review is `CORRECTIONS_NEEDED`, with HIGH CR-001-R1 and CR-002-R1 open, and CR-004-R1 resolved, as explicitly stated by Reviewer in session `ses_e4ea8fd77ffe90xvXdVax6fvqV`, final re-review. No later independent PASS is claimed. The new material below is submitted for re-review; full extraction of every material MP-30–35 instruction is still not established.

### A. Verified execution, including unknowns

**Workspace:** `git status --short && git branch --show-current && git rev-parse HEAD && git cat-file -t 5ccc9b6acebec6e51aaa96155982be00cc8d1b02` reported branch `feature/closing-initial-implementation`, HEAD exactly `5ccc9b6acebec6e51aaa96155982be00cc8d1b02`, and type `commit`; existing front-end and orchestration changes are staged, `docs/agent_runs/mp-35-2026-11-06.md` is `AM`, and `F01/back/src/modules/order/payment.stale-write.test.ts` and this report are untracked. The status identifies current index/worktree state only; it neither attributes staging nor proves the history of the changes. No Git mutation was performed. R35:5 identifies the existing reference run.

**Source recovery method:** searches for each exact `AT-01 —` through `AT-11 —` returned overlapping snippets of one original user-authored Addendum B message, session `ses_e5116df09ffeXzMnJNjzPkTz5Z`, message `prt_1af20d02b001o3uDKC5eanVkJq`; AT-12 is in the same search result and saved output `tool_1b1533b35001nT6qoeVhppEAoG:955`. The earlier `kilo_local_recall` read produced a 29,909-character omission around these criteria. Search snippets enabled recovery of the exact sentences without accessing runtime databases, authentication files or secrets. These AT rows are a **drill-down of I12 and I24**, not additions to the aggregate 54 parent rows.

| AT | Exact original acceptance criterion | Execution evidence / status / missing step |
|---|---|---|
| AT-01 — Discovery | Orchestra identifies the task from the real backlog without the user naming a specific implementation file. | R35:458–463 records selected identity-cache task and observed keys. Prior-session search and user-directed candidate context do not independently establish that no specific file had been named. `NOT_VERIFIED`; inspect original selection chain and exact chronology. |
| AT-02 — Evidence | Orchestra verifies the defect or missing functionality instead of relying solely on an old report. | R35:460–463 records observed identity-free keys and missing logout clearing; static historical evidence. `PARTIALLY_COMPLETE`; independent runtime leak reproduction not established. |
| AT-03 — Research | Orchestra independently resolves at least one necessary technical unknown using authoritative evidence, if a genuine unknown arises. Do not fabricate research needs. | Stage A discovery R35:20–162 and cache findings exist; whether a necessary unknown for the selected task was independently resolved is not demonstrated. `NOT_VERIFIED`; inspect original task-specific research. |
| AT-04 — Planning | Orchestra creates a focused Task with dependencies and acceptance criteria. | R35:458–463,485–496 document selected scope and acceptance assertions; visual Task identity/dependencies not reconstructed. `PARTIALLY_COMPLETE`; recover board history. |
| AT-05 — Delegation | Code Developer receives a precise implementation scope. | R35:465–470,485–490 shows files and correction scope; original delegation contract is not reproduced in this record. `PARTIALLY_COMPLETE`; verify initial delegation message. |
| AT-06 — TDD | One focused RED → minimal GREEN sequence is demonstrated. | R35:472–475 explicitly says RED was not separately captured; `NOT_VERIFIED`, not implied by GREEN. A different task's RED does not fulfill this specific demonstration without checking its full AT context. |
| AT-07 — Regression | Relevant safe regression tests pass. | Developer reports three targeted frontend files and 36 tests passed, R35:498–502,515–516; reviewer did not rerun. `PARTIALLY_COMPLETE` as reported execution; independently reproduce in a safe environment. |
| AT-08 — Independent review | Code Reviewer examines the actual change and evidence. | R35:511–519 records scoped PASS after corrections, reviewer could not rerun tests; `VERIFIED_COMPLETE` only for the recorded narrow review, not full mission. |
| AT-09 — Correction | Concrete review findings are addressed, if any. | R35:485–504,511–518 records M-001 and L-001/L-002 addressed and re-reviewed. `VERIFIED_COMPLETE` for that scoped review; residual mocked-clear limitation remains. |
| AT-10 — Continuation | Orchestra evaluates the remaining queue and begins the next eligible action rather than immediately ending the mission. | R35:588–622,626–678,684–824 records subsequent scanner, Git-attempt and P2 investigations after the cache task. `PARTIALLY_COMPLETE`: those actions occurred, but full queue evaluation and eligibility prioritization are not independently demonstrated. |
| AT-11 — Honesty | Unverified claims and unsupported capabilities remain explicitly classified. | R35:382–385,574–576,816–824 distinguish simulation and investigation; the same record contains stale pending-review labels and conflicting reported typecheck wording. `PARTIALLY_COMPLETE`; reconcile those specific discrepancies. |
| AT-12 — Boundaries | No prohibited action occurs. | Current audit made no Git mutations/provider calls; prior Git attempt initiator is unknown (R35:664–677) and whole history not exhaustively observed. `NOT_VERIFIED` for the entire mission. |

AT counts: `VERIFIED_COMPLETE` 2 (08,09); `PARTIALLY_COMPLETE` 6 (02,04,05,07,10,11); `NOT_VERIFIED` 4 (01,03,06,12). Total **12**. Parent inventory remains 54; FT 26, IDLE 15 and AT 12 are overlapping detailed traces, not additional independent completed deliverables.

**Current source versus prior reports:** `F01/back/src/modules/invoice/invoice.service.ts:43–59` saves an empty URL/path in `generateInvoice`, while :95–111 `regeneratePdf` assigns a generated key and an example CDN URL and marks GENERATED; :157–170 resets URL/path but sets GENERATED in a branch whose comment says reset to pending. This static observation contradicts blanket assertions that invoice URLs are always the generated key or that every path stores no URL. It does not establish a production download failure or prove a real hosted file. Inspect route contracts, ownership and isolated tests before changing code. MP-30/33's no-permanent-PDF requirement and Q-018's older S3 policy remain documentary tension, not permission for S3.

**Reviewed execution summary:** R34:227–233,249–261,371–387,393 onward and 416–429 document narrow review results for diagnostics, detail, duplicate order, payment authorization and vendor mutation; R35:511–519 records narrow identity-cache re-review. R35:801–808 classifies P2 investigation `PARTIALLY_REAL`, and Reviewer session `ses_e509c679effew14i4PHAtyh23y` passes the investigation only. Historical MP-34R2 transcript `ses_e51885b2bffeJ6adtDHnzuPlou` reports an earlier P2 PASS and nine Mongo-file modifications, but R35:761–808 and present worktree do not demonstrate general non-PAID CAS or safe shared-DB execution. These are different scopes and baselines; do not overwrite one with the other. R34:252's possible sensitive historical output remains unverified; recommend affected-credential rotation by the owner without inspecting or reproducing values.

### B. Current work status and exact next safe action

| Work item | Evidence-based state | Next action and boundary |
|---|---|---|
| MP-36R source coverage | `PARTIALLY_COMPLETE`; AT text recovered; FT and IDLE already individually traced, MP-30–35 requirements still grouped and some original long-message text omitted | Continue source-by-source extraction using exact-message search snippets, verify each material requirement against actual code/run/review; do not declare a complete reconciliation from 54 parent rows. |
| Reviewer findings | HIGH CR-001-R1 and CR-002-R1 were open in latest explicit review; CR-004-R1 resolved | Independent Reviewer must examine this correction and decide disposition. No self-approval. |
| P2-CR002 | `INVESTIGATED_NOT_IMPLEMENTED` for general non-PAID CAS; split window and narrow PAID guard static, runtime Mongo race unverified | Preserve untracked stale-write test; formulate one isolated desired-invariant RED, then smallest safe fix under prior P4 authorization in a later mission. |
| Financial ledger, provider confirmation, transfer/payout | `NOT_VERIFIED` end-to-end; scenario-level inventory above; actual provider calls prohibited in this audit | Inspect relevant unit tests and repositories without credentials; one safe regression at a time. |
| Mongo test isolation | Shared/destructive execution is prohibited; historical fixes and observed static risk are not proof of safe target | Inspect target-selection guards; design fail-closed disposable isolation before any DB test. |
| Failover and idle | Opt-in simulated primitives; no demonstrated normal runtime wiring, actual provider rotation or autonomous wake | Assess runtime integration and atomic replay/lease safety, using fake boundary tests only until separately authorized. |
| Security scanner | File-scanner false-positive context likely for fixtures; value provenance remains `NOT_VERIFIED`; storage-key identifier matches are not credential values | Security Reviewer inspects provenance without disclosing values; no hook bypass, no automatic rotation. |
| Invoice | Static inconsistency above; S3/production prohibited | Read route and test contracts, isolate on-demand behavior and false-URL risk; no S3 action. |
| Q-003 / Q-004 / Q-014 / Q-016 / Q-018 / Q-029 / CR-004 | See C below; only task-specific genuine decisions, not a blanket stop | Continue independent P4 work after MP-36R report and human review; current mission remains audit-only. |

### C. Self-contained human decision dossier and conditional investigation queue

**C1 — Q-016: mixed-cart coupon base and rounding.** Origin Q:211–220/CD-050, affecting only the mixed eligible/ineligible item calculation. Already decided: exclusions win, one chosen coupon per vendor, no stacking. Options: (a) discount eligible items only with explicit minor-unit rounding; (b) another explicitly specified allocation/base; (c) defer. Recommendation: (a), because it respects targeting and keeps exclusions meaningful, but the business has not approved it. Consequences: (a)/(b) unblock mixed-cart implementation and tests; (c) leaves that path disabled, not coupon CRUD. **Human decision required now only to enable mixed-cart discount.** Question: which base and rounding rule should apply?

**C2 — Q-014: cart retention and session timeout.** Origin Q:185–194/NFR-PERF-003, affects final retention configuration and session lifecycle. Already decided: isolated guest/auth carts, merge strategy and configurable 30-day proposal; 30 days is not approved policy. Options: (a) approve a specified cart TTL and independently specified session timeout; (b) choose different values by cart type; (c) defer final policy while using the existing configurable proposal for tests. Recommendation: (c) until security, privacy and product owners assess tradeoffs; shorter sessions limit exposure but may disrupt users, longer retention aids recovery but retains data longer. **Human approval required for final policy, not for current safe cart contract tests.** Question when final policy is needed: what are the approved cart TTL and session timeout for each applicable identity state?

**C3 — Q-018a: Glacier transition.** Origin Q:249–257. Options: approve 90-day transition, select another interval, or defer; recommendation defer because MP-30/33 specify on-demand no-permanent-PDF behavior and S3 is prohibited. Impacts only future invoice object retention, not product images or present on-demand generation. **Human approval required only if such retention is later pursued.** Question then: should retained invoice objects transition to Glacier, and when?

**C4 — Q-018b: WORM/Object Lock.** Same origin; options approve 10 years, another period after legal review, or defer. Recommendation defer pending legal/operational assessment, since immutability may be irreversible and S3 remains prohibited. Impacts future retained objects, not on-demand P4 work. **Explicit human approval required before irreversible retention.** Question then: is WORM required, and for what duration?

**C5 — Q-018c: automated invoice trigger.** Q:251,255 makes on-demand MVP current and automation deferred. Options remain payment, delivery, schedule or no automatic generation; recommendation retain on-demand until a post-MVP requirement and exact trigger are approved. A decision is **future-only** and affects automated generation; no action needed for current on-demand work. Question then: if automation is adopted, which event triggers it?

**Conditional investigation Q-003:** CD-059 ownership and MP-33 initial financial metrics are already specified; Q:42–51 leaves Admin permission-matrix sufficiency unproven. Compare planned actions with actual authorization first. Only if a concrete uncovered action has no recorded policy ask the owner to choose its scope; this is not a current global business blocker.

**Conditional investigation Q-004:** address snapshot/cardinality and login-contact protection already decided (Q:55–64); allowed additional contact types and validation remain pending. Inventory currently required types and existing validation; if an authorized feature needs a new business-allowed type, ask specifically which type and constraints. Existing decided fields proceed now.

**Conditional investigation Q-029:** CD-060 decides one credential and unique login email; Q:391–401 leaves change/removal policy unconfirmed. Inspect the actual login-contact change and recovery paths. If the current feature cannot preserve login integrity without selecting a business rule, present alternatives for verification and recovery; do not ask the owner to re-decide cardinality or uniqueness. Until then, this is a task-specific research issue, not an established universal gate.

**Conditional investigation CR-004:** R35:322–329 records blocked-task terminal-for-pause semantics, not proof of business completion. Compare termination contract and `task-state` behavior, then implement/test separate pause versus success when within an authorized future scope. Human choice is needed only if established contracts conflict. Q-008's filter inheritance, Q-006 reservation/backorder and Q-030 moderation are future/conditional policies as previously catalogued; ES mapping, provider SDK behavior and concurrency mechanics are technical work. Do not inflate the human queue merely because implementation is missing.

**Decision queue:** C1 when mixed-cart capability is pursued; C2 before final cart/session retention policy; C3, C4 and C5 only for their respective future invoice work. Q-003/Q-004/Q-029/CR-004 remain explicitly **research-first conditional entries**, not silently omitted or described as proven decisions needed today. No decision authorizes Git, S3, P5, provider calls or production work during this audit.

**Unresolved audit limits and next step:** Targeted searches recovered AT wording, but full MP-31/32 and MP-34 continuation messages, the complete MP-35R/Addenda chain and every task/requirement have not yet been individually reconciled. The historical scanner triage does not establish whether a test literal was ever a real credential; independent sanitized provenance review remains. This draft therefore remains `CORRECTIONS_NEEDED` pending independent review and further coverage, not an exhaustive audit or release-readiness decision.

## MP-36R source-by-source continuation (2026-11-06)

**Latest independent verdict:** Reviewer `ses_e4ea8fd77ffe90xvXdVax6fvqV`, latest re-review, reports `CORRECTIONS_NEEDED`: CR-002-R1 addressed within reviewed evidence, AT-01–12 wording verified, and the sole remaining HIGH is CR-001-R1 (complete instruction-chain reconciliation). Earlier open-CR-002 references are retained as historical checkpoints, not current verdict. This section is another correction for review; it is not a Reviewer PASS.

### Source coverage index against recovered headings

This is an **index to existing, classified requirement rows**, not a new set of independent completed requirements: each reference points to an existing parent or scenario trace. A heading may cover several outcomes of different status; individual classifications are in the referenced rows. Grouping headings below is navigation only and never merges `VERIFIED_COMPLETE` with `NOT_VERIFIED`. `H30`, `H34` and `H35` refer to local recall outputs `tool_1b15816c2001Wes3IbI55zseVo`, `tool_1b15816c1001KRWAVNJ9Fa8ofx`, and `tool_1b1533b35001nT6qoeVhppEAoG`, respectively. Full source texts can contain additional subrequirements beyond the cited grouped outcome; `PARTIAL COVERAGE` remains explicit where not all were extracted.

| Source and original headings | Traced outcomes and evidence | Coverage / remainder |
|---|---|---|
| MP-30 original §§1–3 (`H30:19–149`) | Baseline S01; no stored value S02; provider and phase boundaries I27–28; historical status timeline above | Headings recovered; baseline evidence not full worktree history. |
| MP-30 §§4.1–4.7 (`H30:150–273`) | S02–S07; decisions C1–C5; P4 ownership/privacy I02,I22; invoice current-source observation in MP-36R A | Headings recovered; seller restrictions S06 and invoice S07 NOT_VERIFIED, not completed by policy alone. |
| MP-30 §5 A–H (`H30:274–472`) | Financial I23/S03–04/S08 and financial-scenario drill-down; actors S06/S09; checkout I03/I20/S05; catalog S10; reviews S11; frontend I05/I22/S22 | All eight heading titles recovered, but no proof every individual actor action or user journey has its own execution evidence: **PARTIAL COVERAGE**. |
| MP-30 §§6–12 (`H30:473–649`) | Q dossier C; CI S12; TDD AT-06; review AT-08/09; final/release I24; no deployment I28 | Full milestone reports/CI runs not independently established; S12 NOT_VERIFIED. |
| MP-31 Marketplace original `prt_1ad07a63a001ym3xgYjBx9kJCD` | Search for exact title recovered opening and phase cap; historical run record `docs/agent_runs/orch-afirdd-exec-02-2026-11-05.md:125–187`; S13 and timeline | **PARTIAL COVERAGE:** full original heading list and all acceptance subrequirements were not retrieved. Run record's payment/invoice/transfer reports are historical, not a substitute for original wording. |
| MP-32 Marketplace original `prt_1ad38cdf8001KiO7WPxDTSVDIE` | Exact title search recovers runtime/order-lifecycle objective. S14; R34:288–408; I03,I04,I20,I22 and S22 | **PARTIAL COVERAGE:** full original headings are inside truncated session segment; search for `MP-32 order timeline reduced motion` returned title/snippets but not complete sections. Do not equate with separately numbered secrets-scanner MP-32 S15. |
| MP-33 original `prt_1ad829d0e001m33mQyaqatlWEU` | Opening recovered by exact-title search; financial/Stripe/ledger/dashboard/invoice §§11.3–24 `H30:963–1922` map S07,S13–S20, financial-scenario drill-down and I21–23 | **PARTIAL COVERAGE:** §§1–11.2 omitted by saved transcript's truncation marker; despite searches, complete original headings and each assertion there are not established. Later source sections do not prove earlier requirements fulfilled. |
| MP-34 original §§1–2 (`H34:15–99`) | Execution ordering and safety I27–28; narrow TDD limits R34:15–18 and AT-06 | Operational rules inspected; no global claim of compliance. |
| MP-34 original §§3 A1–A7 (`H34:100–258`) | A1/A2 S21 and timeline; A3–A5 I05,I22/S22; A6 I03,I04,I20; A7 S22 and financial/UI next actions | A7 requires green/current/neutral timeline, connectors, terminal states, reduced motion and accessibility from persisted state; all currently NOT_VERIFIED as a feature, not evidenced by a neighboring test. |
| MP-34 original §§4–5 B1–B5/C1–C3 (`H34:259–479`) | Ledger S03,S16–17/S23, dashboard S18–20/scenarios; security S24 and R34:252 | Each financial scenario listed in drill-down; full agent-workflow channel audit remains partial, provider semantics not live-verified. |
| MP-34 original §§6–10 (`H34:480–649`) | Prioritized plan R34:63–192; one-test TDD AT-06; independent narrow reviews I01–05; final I24 | Initial historical report documents corrections preceding plan and uncaptured RED (R34:15–18); mission completion not demonstrated. |
| MP-34 initialization/visual and parallel addenda (`H34:680–812` and recovered session user message) | Capability discovery I06; actual visual board state not reconstructed AT-04; one-test TDD AT-06; nonblocking parallel flow AT-10 | **PARTIAL COVERAGE:** board history, task dependencies and parallel file/resource conflicts are NOT_VERIFIED, regardless of authorization to use Goals/Tasks. |
| MP-34 runtime directive (`H34:1339–1505`) | Duplicate checkout I03; provider-confirmed status I04/I20; isolated test and reviewer restrictions R34:288–408 | Narrow fixes have review but actual complete checkout→provider→frontend verification NOT_VERIFIED. |
| MP-34 continuation/concurrency (`H34:1682 onward`) | I20; R35:684–824; earlier historical P2 review differs in scope | **PARTIAL COVERAGE:** complete continuation heading list is not exhaustively mapped; do not infer real Mongo concurrency from prior mock PASS. |
| MP-34R §§0–11 (`H34:1820–2180`) | §§0–2 checkpoint/initialization I06,S21; §3 conditional transitions I20; §4 privacy I02/I22; §5 Mongo I21; §6 security S24; §7 checkout/provider S05/S08; §§8–11 AT-04/10 and I24,I27–28 | All top-level headings recovered. Exact Mongo match/modified counts, missing-order, stale-conflict and concurrent-success scenarios remain NOT_VERIFIED without safe Mongo test; no assumption that a test double proves them. |
| MP-34R2 §§1–7 (`H34:2250–2355`; original `ses_e51885b2bffeJ6adtDHnzuPlou`) | Recovery and continuous work AT-10; concurrency I20; privacy I02/I22; Mongo I21; checkout I03 and security S24; scoped reviews I01–05 | Original sections recovered. Later assistant's reported Mongo PASS/unique DB names do not prove isolation: conflicting later static evidence R35:102–107 requires fresh safe verification. |
| MP-34 urgent intervention (`ses_e51885b2bffeJ6adtDHnzuPlou`, user message `prt_1aeddd1bf001KBBi7Z4Lq3MFG9`) | No blind revert; capture one sanitized 500 exception, inspect serializer and callsites, preserve privacy, focused test/review. R34:416–429 records narrow mutation PASS. | Static review and developer-reported results establish narrow correction only; exact observed original stack trace and chronological RED are not independently established. |
| MP-35 original §§0–4 (`H35:19–168`) | I06; R35:20–162 capability/feasibility and six-provider discovery | Capability reports historical, native runtime access NOT_VERIFIED. |
| MP-35 §§5–7 (`H35:169–350`) | I07–11, FT-01–18 and checkpoint/no replay details; AT-10; CR-004 | Individual FT statuses and actual integration limitations above; real provider/session and cross-process guarantees unverified. |
| MP-35 §8.1–8.8 (`H35:351–469`) | Stripe S08, ES S10, Mongo I21, P2 I20, privacy I22, finance I23, S3/P5 I27 | Missing implementation/technical future not automatically a human blocker; historical Stage A classifications were superseded by Addendum D authorization correction. |
| MP-35 §§9–17 (`H35:470–742`) | Focused TDD AT-06/07; FT-01–18; runbook I25; independent review I24; phase/Git safety I27–28 | Controlled port demonstration is simulation; full actual execution, runbook and board end state remain NOT_VERIFIED. |
| MP-35 Addendum A §§1–6 (`H35:743–849`) | Six distinct routes I07/FT-19–26; capability and router limitations FT-20–26; configuration matrix above | Exact ordering implemented as model; no live proof, underlying router tool compatibility unverified. |
| MP-35R original `prt_1af1ed73a001KLZGn9jS3Btm5B` | Exact title/initial objective recovered by targeted search; delegation `ses_e50e07ac3ffe8FTjEtwoYUCAeS` supplies AC-R1–R4; R35:366–447 records opt-in implementation and tests. I10–11 and FT-01/06–11 trace actual entry-point simulation | **PARTIAL COVERAGE:** original user message's complete headings/wording were omitted in bulk recall. Delegation provides evidence of scoped interpretation, not proof it contains all original requirements. Default runtime wiring remains unproved. |
| MP-35R Addendum B original `prt_1af20d02b001o3uDKC5eanVkJq` | Exact AT-01–12 recovered by targeted searches and traced individually in MP-36R A; termination/checkpoint §§11–13 `H35:961–1018` | **PARTIAL COVERAGE:** original §§1–9 headings and their complete material outcomes have not all been extracted; exact AT wording is recovered, not a substitute for whole addendum. |
| MP-35R Addendum C §§1–10 (`H35:1170–1383`) | I13–16; original IDLE-01–15 table; fake clock, reset, persisted schedule, lease and actual scheduler independently classified | All top-level headings and original IDLE scenarios recovered. Test identifiers do not match original acceptance numbering. Actual wake and atomic lease remain unverified. |
| MP-35R Addendum D §§1–7 (`H35:1503–1640`) | §1 scanner I17 and per-finding safe table; §2 attempt I18; §3 authorization I20/B1; §4 P2 I19–20; §5 idle I15; §6 independent validation I17/I19/I24; §7 queue B | All headings recovered. Scanner classifications provenance-limited, Git actor UNKNOWN; P2 review PASS is investigation only and implementation is not closed. |

### Material omissions added to the inventory

The following outcomes were not separately represented by I01–I30/S01–S24. They are deliberately narrow, and are **additional distinct rows** rather than headings counted as requirements. No row claims completion from absence of evidence.

| ID / source | Required action and responsible agent | Evidence / status | Exact remaining step |
|---|---|---|---|
| U01 MP-34 visual addendum | Maintain per-defect visual task ownership, stage, dependencies, evidence and truthful completion / Orchestra, Developer, Reviewer | `H34:712–812`; current history not reconstructed. `NOT_VERIFIED` | Recover actual board/task history; do not infer status from current participant list. |
| U02 MP-34 parallel addendum | Identify nonconflicting file/resource ownership; report parallel execution, integration and bottlenecks / Orchestra | `H34` recovered user addendum; R34:249–261 records only narrow work. `NOT_VERIFIED` | Compare task execution timelines and overlapping resources; no conflicting DB actions. |
| U03 MP-34 A7 | Timeline colors, connectors, terminal state, reduced-motion and accessible labels derived from persisted order / Dev/Reviewer | `H34:245–258`; S22 broadly groups UI, but this distinct timeline contract has no current behavior evidence. `NOT_VERIFIED` | Inspect current component and isolated tests; assess each state and reduced motion. |
| U04 MP-34R §3.3 | Distinguish missing order, stale conflict, invalid transition, idempotent replay and concurrent success / Dev/Reviewer | `H34:1937–1980`, R35:761–800 describes PAID-only filter; real Mongo cases not proven. `PARTIALLY_COMPLETE` | Isolated test plan for each distinction; real DB only after disposable isolation is verified. |
| U05 MP-34R §5 | Validate disposable test DB, unique namespace, fail-closed target and teardown ownership before cleanup / Dev/Reviewer | `H34:2011–2038`, R35:102–107 historical inventory; prior report of unique names does not prove fail-closed enforcement. `PARTIALLY_COMPLETE` | Inspect current fixtures and test guards without touching DB. |
| U06 MP-35 §5.2 | Bounded retry, real backoff/cooldown, no repeated exhausted destination / Dev/Reviewer | `H35:198–211`, `provider-failover.ts:116–139,159–195` exposes options but no observed wait/cooldown. `PARTIALLY_COMPLETE` | Specify runtime-supported backoff/cooldown and fake-clock tests, no provider call. |
| U07 MP-35 §5.3/MP-35R | Checkpoint must report actual pending review, verified test and worktree state / Dev/Reviewer | `H35:212–239`, `resilient-orchestration.ts:103–106,155–166` uses requested checks and constant placeholders. `IMPLEMENTED_NOT_INTEGRATED` | Gather true state from authorized runtime boundaries; test failures and restart, avoid fabricating clean state. |
| U08 MP-35 §11 | Controlled fault-injection demonstration through actual task, recovery, independent Reviewer and Goal/Task final state / Orchestra/Reviewer | `H35:553–572`; R35:415–435 exercises real TS entrypoint with injected mocks, R35:447 limits scheduler path. `PARTIALLY_COMPLETE` | Show complete safe demo including independent review and board final state; label provider calls simulated. |
| U09 MP-35 Addendum A §3 | Check router-selected underlying model supports tools; preserve role and record selection where exposed / Dev/Reviewer | `H35:779–795`; `provider-failover.ts:142–199` contains no established tool-capability check; FT-23 NOT_VERIFIED. `NOT_VERIFIED` | Research supported adapter capability metadata before any routing. |
| U10 MP-35R Addendum D §6 | Independent reviewer verify scanner classification, Git compliance and task selection, not only P2 investigation / Reviewer | `H35:1612–1624`; R35:619–622,672–678 says scanner/Git investigations lack independent review. `AWAITING_INDEPENDENT_REVIEW` | Request sanitized review of exact scanner and Git evidence separately from P2. |

**U inventory counts:** NOT_VERIFIED 4 (U01,U02,U03,U09), PARTIALLY_COMPLETE 4 (U04,U05,U06,U08), IMPLEMENTED_NOT_INTEGRATED 1 (U07), AWAITING_INDEPENDENT_REVIEW 1 (U10) = 10. **Parent total:** prior 54 plus U01–U10 = **64**: VERIFIED_COMPLETE 7; TESTED_SIMULATED_ONLY 3; PARTIALLY_COMPLETE 23; IMPLEMENTED_NOT_INTEGRATED 3; AWAITING_INDEPENDENT_REVIEW 3; INVESTIGATED_NOT_IMPLEMENTED 1; BLOCKED_VERIFIED 1; NOT_VERIFIED 19; EXPLICITLY_PROHIBITED 2; AWAITING_HUMAN_DECISION 1; DEFERRED_BY_DECISION 1. FT/IDLE/AT tables remain overlapping drill-downs and are not added a second time. The total is for inventoried rows, not a claim all accessible material requirements were exhausted.

### Recovery attempts and precise residual limitations

1. `kilo_local_recall` read of `ses_e532607f7ffe10JcdqNHJ9e5Hy` returned an output with an explicit 148,743-character middle omission; `H30:963` resumes within MP-33 §11.3, so MP-31, MP-32 and MP-33 §§1–11.2 are not present as complete user messages in that output. Targeted searches for exact MP-31 and MP-32 titles identified their original message IDs, and queries about order timeline and ledger returned snippets, but did not recover complete headings. These messages are **accessible by search**, not `SOURCE_NOT_AVAILABLE`; their full extraction remains incomplete.
2. Read of `ses_e5116df09ffeXzMnJNjzPkTz5Z` omitted 29,909 characters at `H35:951`. Targeted exact-phrase searches recovered AT-01–12 and exact MP-35R/B message IDs; MP-35R original and Addendum B §§1–9 still lack complete heading extraction. The scoped Developer delegation is supporting evidence only, not a replacement for the user instruction.
3. `H34` includes MP-34 original and MP-34R/R2 heading lists; other continuation messages exist, including runtime directive and urgent no-revert intervention. Those recovered portions are traced above, but the intervening continuation and all subordinate bullets have not been exhaustively converted to individual outcomes.
4. No runtime database, credential-bearing environment, provider API, destructive database test, S3, P5 or Git mutation was used. Future reviewers can use supported local recall targeted searches and safe project evidence; do not access sensitive session database files as a workaround.

**Disposition:** CR-001-R1 has materially progressed through heading-level index and 10 newly inventoried outcomes, but this worker cannot honestly certify exhaustive extraction. It remains open pending completion and independent Reviewer assessment. CR-002-R1 remains addressed only to the extent of the last review; no subsequent review has approved this new section.

## Additional targeted original-message recovery

This addendum records what was actually recovered, not reconstructed section headings. In `kilo_local_recall` search, queries such as `# 2. MP-32`, `# 6. SESSION`, `# 7. CANONICAL`, `# 8. ORDER`, `# 9. ORDER TIMELINE`, and `# 11. STRIPE` returned matching excerpts in original MP-33 user message `prt_1ad829d0e001m33mQyaqatlWEU` of session `ses_e532607f7ffe10JcdqNHJ9e5Hy`. Queries `## 1. MISSION OBJECTIVE autonomy` and `## 8. AUTONOMY` located original Addendum B message `prt_1af20d02b001o3uDKC5eanVkJq` of session `ses_e5116df09ffeXzMnJNjzPkTz5Z`; query `Do not restart discovery or rewrite existing components` located original MP-35R message `prt_1af1ed73a001KLZGn9jS3Btm5B`. Exact MP-31 and MP-32 title searches located their original message IDs from the preceding source index, but their returned snippets were only openings, not a complete section body. Queries are keyword-ranked and can return an opening even when all words match later; this is an observed retrieval limitation, not evidence the full source is inaccessible.

The rows below are new independently classified **narrow outcomes**: they do not replace the broader parent statuses (notably I05, S14, S22), nor should a narrow source observation be reported as runtime completion.

| ID / original source | Specific recovered requirement | Current evidence and classification | Safe next action |
|---|---|---|---|
| V01 MP-33 §2 `prt_1ad829d0e001m33mQyaqatlWEU` | Audit each relevant MP-32 claim against actual repository, including whether immutable payment instances are persisted | `F01/docs/analysis/mp33_discrepancy_matrix.md:9–94` is a historical matrix and R35:738–765 identifies current payment/order gaps; neither establishes every claim's current disposition. `PARTIALLY_COMPLETE` | Revisit each claim using current code and safe test evidence; retain historical matrix as snapshot. |
| V02 MP-33 §6 same message | Prevent User A's `guestCartId` being merged into User B's account after logout | Static `F01/front/src/app/providers/authStore.ts:135–151` removes auth keys and React Query data but does not remove `guestCartId`; :238–241 later reads it for merge. `PARTIALLY_COMPLETE`: cache clear is implemented, this separate guest identifier risk remains unverified end-to-end. | Reproduce with two isolated accounts and a fake cart boundary; distinguish intentional anonymous cart from prior-user cart; independently review any fix. |
| V03 MP-33 §7 same message | `/products` is canonical Marketplace Home, not `/` as official home | `F01/front/src/App.tsx:35` registers `/products`; presence of route alone does not prove root redirect, logo, navigation or refresh behavior. `NOT_VERIFIED` | Inspect all navigation/redirect call sites and isolated router tests. |
| V04 MP-33 §8 same message | Keep payment authority separate from fulfillment; only validated provider confirmation establishes financial success | `F01/back/src/modules/order/order.domain.ts:154–161` defines vendor fulfillment transitions; R35:728–756 reports provider/payment persistence boundaries. `PARTIALLY_COMPLETE` | Verify all transitions and cross-boundary behavior with isolated fakes; do not infer provider confirmation from fulfillment. |
| V05 MP-33 §9 same message | Order timeline must respect reduced-motion; completed green, current subtle blue | U03 records the complete broader timeline contract; no current component behavior inspected in this continuation. `NOT_VERIFIED` | Locate actual timeline file without relying on a filename pattern, inspect styles and accessibility tests. |
| V06 MP-33 §10 → §11 same message | Nonexistent and cross-user resources need a real 404; catch-all redirect to `/` is insufficient | Original section boundary recovered by `# 11. STRIPE` search. `F01/front/src/App.tsx:72` currently redirects wildcard to `/`. `PARTIALLY_COMPLETE`: redirect is statically present, but actual server anti-enumeration and browser outcome not tested. | Trace unknown route and cross-user resource paths separately; verify safe 404 behavior. |
| V07 MP-33 §11 same message | Stripe Connect Separate Charges and Transfers implementation authorized in TEST/SANDBOX; never claim static inspection is provider E2E | Q:147–168 and T:215–221 support integration plan; no live calls were made here. `NOT_VERIFIED` for actual provider E2E. | Inspect contract and test-mode prerequisites safely; any provider call requires scope outside this audit. |
| V08 MP-35R original `prt_1af1ed73a001KLZGn9jS3Btm5B` | Existing controller, task-state and checkpoints must become part of actual orchestration execution path, not a standalone simulation | `kilo-orchestration/src/resilient-orchestration.ts:33–45,93–95`, tests use injected port and do not pass selected destination to inner port; R35:415–447 reports simulated proof. `IMPLEMENTED_NOT_INTEGRATED` | Trace a supported real runtime adapter and implement separately under authorized scope; do not claim live failover. |
| V09 Addendum B §1 `prt_1af20d02b001o3uDKC5eanVkJq` | Demonstrate practical autonomous Orchestra execution of a genuine FS-01 task | R35:458–520 records cache task and narrow independent re-review; AT-01–12 above show RED and other gaps. `PARTIALLY_COMPLETE` | Establish missing AT-01/03/06/12 evidence and actual queue continuation without treating review PASS as mission PASS. |
| V10 Addendum B §8 same message | Autonomy remains within P4, with no S3, P5, Git staging or prohibited operations | R35:14,174–178 and audit worktree observations support constraints; historical Git-attempt attribution UNKNOWN (R35:664–677). `NOT_VERIFIED` for all prior-agent actions. | Preserve evidence and continue only read-only audit; do not infer actor or retry Git action. |

**V counts:** PARTIALLY_COMPLETE 5 (V01,V02,V04,V06,V09), NOT_VERIFIED 4 (V03,V05,V07,V10), IMPLEMENTED_NOT_INTEGRATED 1 (V08). Total: **10**. Aggregate I/S/U/V: 74 parent/narrow rows: VERIFIED_COMPLETE 7, TESTED_SIMULATED_ONLY 3, PARTIALLY_COMPLETE 28, IMPLEMENTED_NOT_INTEGRATED 4, AWAITING_INDEPENDENT_REVIEW 3, INVESTIGATED_NOT_IMPLEMENTED 1, BLOCKED_VERIFIED 1, NOT_VERIFIED 23, EXPLICITLY_PROHIBITED 2, AWAITING_HUMAN_DECISION 1, DEFERRED_BY_DECISION 1 = **74**. FT/IDLE/AT are overlapping drill-downs and excluded from this total.

**Remaining extraction gap:** targeted phrase searches recovered MP-33 §§2,6–9 and the §10→11 boundary, MP-35R objective, and B §§1/8 plus AT. MP-31/32 section bodies, MP-33 §§1,3–5,10–11.2 in full, and MP-35R/B's other subsection bodies are not yet completely extracted. Searches for `# 3. TYPESCRIPT AND`, `# 4. PAYMENT LIFECYCLE`, `# 5. ENGLISH-ONLY`, `## 2. REQUIRED AUTONOMY`, `## 3. REAL BACKLOG`, `## 4. EVIDENCE-BASED`, `## 5. FALSE`, `## 6. TECHNICAL RESEARCH`, `## 7. TASK SELECTION`, and `## 9. AUTONOMY` did not return the expected original section text. The queries used inferred headings and their failure does not mean those sections are absent; each should be retried with confirmed distinctive wording. Local recall offers no message-ID/offset input, and full-session retrieval omitted the relevant middle. No secret-bearing runtime files were accessed as a workaround. CR-001-R1 remains open pending complete reconstruction and independent review.

## MP-36R2 — bounded canonical reconciliation

**Superseding counting rule:** a counted unit is one independently verifiable acceptance outcome, not a source mention, heading, review finding or parent plus drill-down. Historical totals of 30, 54, 64 and 74 are preserved as historical table-row counts and **must not be used as unique requirement counts**. The mapping below maps each historical I/S/U/V row once; rows with heterogeneous, parent, instruction or historical-only content are explicitly `CTX` rather than forced into a narrow outcome. FT/IDLE/AT and scenario tables are **supporting context**, not independently added to totals. This is a bounded canonical register, not proof that every accessible requirement has been recovered; specific extraction gaps follow.

**Independent review:** latest available verdict is `CORRECTIONS_NEEDED`, HIGH CR-001-R1 and MEDIUM CR-005 (parent session `ses_e4eaf75b0ffe2E0d682hZTCsKZ`, MP-36R report and MP-36R2 user directive). CR-002-R1 was addressed within the reviewed scope; CR-004-R1 was resolved. No later PASS for this addendum is claimed.

### Finite source manifest

`H30` = retrieved output `tool_1b15816c2001Wes3IbI55zseVo`; `H34` = `tool_1b15816c1001KRWAVNJ9Fa8ofx`; `H35` = `tool_1b1533b35001nT6qoeVhppEAoG`. Exact source sessions and message IDs are historical local recall references, not repository files. “Partial” means inspected material was recoverable, not that the source is unavailable.

| Source | Location and availability | Coverage / material trace / remaining extraction |
|---|---|---|
| MP-30 | Available, session `ses_e532607f7ffe10JcdqNHJ9e5Hy`, H30:6–649 | Top-level §§1–12 inspected; K01–K35 and prior source index map selected outcomes. Individual actor/journey requirements still need exhaustive extraction. Partial. |
| MP-31 Marketplace | Available by search, same session, user `prt_1ad07a63a001ym3xgYjBx9kJCD`; record `docs/agent_runs/orch-afirdd-exec-02-2026-11-05.md:125–187` | Opening and historical results only; full original heading bodies not retrieved. K30; partial. |
| MP-32 Marketplace | Available by search, same session, `prt_1ad38cdf8001KiO7WPxDTSVDIE` | Objective and follow-on MP-33 discrepancy evidence recovered; K03,K04,K26,K30. Full original sections not retrieved. Partial; unrelated scanner MP-32 is not this source. |
| MP-33 | Available by search, same session `prt_1ad829d0e001m33mQyaqatlWEU`, H30:963–1922 | §§11.3–24 inspected; targeted §§2,6–9 and §10→11 snippets recovered; K05,K18–K24,K26–K30. §§1,3–5,10–11.2 incomplete. Partial. |
| MP-34 original and addenda | Available, `ses_e51eeeb36ffedhZ7j821Y5HnMS`, H34:6–812,1339–1505,1682 onward | Original A1–A7/B1–B5/C1–C3, visual and runtime instructions inspected; K01–K04,K15–K18,K31–K33. Continuation subordinate bullets not exhaustively mapped. Partial. |
| MP-34R / R2 / urgent intervention | Available H34:1820–2355 and `ses_e51885b2bffeJ6adtDHnzuPlou`, user `prt_1aeddd1bf001KBBi7Z4Lq3MFG9` | Top-level R/R2 and urgent instruction inspected; K15–K18,K31–K33; earlier P2 PASS and later investigation have different scope. Partial exact execution coverage. |
| MP-35 original / A | Available `ses_e5116df09ffeXzMnJNjzPkTz5Z`, H35:6–849 | Original §§0–17 and A §§1–6 inspected; K06–K09,K11,K20, FT details. Runtime not proven. Partial requirement granularity. |
| MP-35R | Available by targeted search, same session `prt_1af1ed73a001KLZGn9jS3Btm5B`; delegation `ses_e50e07ac3ffe8FTjEtwoYUCAeS` | Original objective and delegated AC-R1–R4 inspected; K08–K10. Complete original message text/headings not recovered. Partial. |
| Addendum B | Available by targeted search, same session `prt_1af20d02b001o3uDKC5eanVkJq`; H35:961–1018 | Exact AT-01–12 recovered and traced; K10; original §§1–9 not completely extracted. Partial. |
| Addendum C | Available H35:1170–1383 | §§1–10 and IDLE-01–15 traced, K11. Real wake and runtime integration not demonstrated. |
| Addendum D | Available H35:1503–1640 | §§1–7 inspected; K12–K15; scanner and Git-attempt actor remain uncertain. |
| MP-36 / R / R2 and final transition addendum | Available session `ses_e4eaf75b0ffe2E0d682hZTCsKZ`, user messages including `prt_1b1749beb001d0UsefmHusaywe` | Original and R/R2 requests recovered; K19 is this report/review obligation. Transition permits future autonomous task work only **after dossier presentation**, not application changes in this audit. |
| Canonical project decisions | Available `F01/docs/decisions.md`, `open_questions.md`, `task_list.md` cited in sections 8–15 and MP-36R C above | Q-003/004/014/016/018/029 and CR-004 classified; Q-008 unresolved portion preserved. Not every decision independently revalidated. Partial. |
| Exact missing transcript sections | Original messages searchable, but full-session recall returned explicit 148,743- and 29,909-character omission; no message-offset parameter | **Partial retrieval, not SOURCE_NOT_AVAILABLE.** Attempts and search queries are listed immediately above. No uninspected requirement has been invented. |

### Canonical outcomes and evidence

Each K row is a distinct acceptance target. Evidence marked *reported* is not an independently rerun test. Reviewer coverage is narrow where named; `none established` means this audit did not locate a relevant independent verdict, not proof none exists. Each next action remains a recommendation for after presentation of the dossier, with safety restrictions unchanged.

| ID | Independently verifiable obligation; original instruction | Evidence / verification level and review scope | Status | Remaining acceptance / next action / dependency |
|---|---|---|---|---|
| K01 | Safe config diagnostics, MP-34 | R34:227–233 static scoped Reviewer PASS | VERIFIED_COMPLETE | Narrow scope only; broader security is K32. |
| K02 | Vendor detail response isolation, MP-34 | R34:249–261 scoped review | VERIFIED_COMPLETE | Detail only; lists/mutations K17. |
| K03 | Duplicate-order correction, MP-34 P0-A | R34:371–387 scoped review | VERIFIED_COMPLETE | Live concurrent checkout separate; preserve valid repeat purchases. |
| K04 | Payment ownership 403 contract, MP-34 | R34:393–408 scoped review | VERIFIED_COMPLETE | No provider lifecycle proof. |
| K05 | Identity-scoped React Query keys and logout clear, MP-35R B | R35:458–520, 36 tests *reported*, scoped review PASS | VERIFIED_COMPLETE | Cache scope only; guest cart K18. |
| K06 | Discover available failover capabilities, MP-35 §§2–4 | R35:20–162 static/reported; review scope not global | PARTIALLY_COMPLETE | Recheck actual native API and provider capability. |
| K07 | Six ordered provider attempts with bounded retries, MP-35/A | `provider-failover.ts:19–25,142–199`; historical fake tests; no live review proof | TESTED_SIMULATED_ONLY | Verify live adapter/capabilities separately; never equate labels with routing. |
| K08 | Truthful durable checkpoint and replay guard, MP-35 §5 | `resilient-orchestration.ts:55–87,103–106,155–166`; static, scoped tests | PARTIALLY_COMPLETE | Preserve actual reviewer/worktree/test state and crash-safe side-effect semantics. |
| K09 | Wire resilient selection to actual agent execution, MP-35R | `resilient-orchestration.ts:93–95` does not pass destination to inner port; no non-test construction found | IMPLEMENTED_NOT_INTEGRATED | Investigate supported runtime adapter; no provider calls now. |
| K10 | Demonstrate AT-01–12 on genuine task, Addendum B | AT table above; R35:458–520 scoped review PASS for cache only | PARTIALLY_COMPLETE | Establish missing discovery, research, RED and boundary evidence. |
| K11 | Schedule and recover real three-pass/five-interval idle policy, Addendum C | `idle-recovery.ts:85–119,125–134,150–269`; fake-clock results *reported* | IMPLEMENTED_NOT_INTEGRATED | Durable scheduler, cross-process claim and real wake remain unverified. |
| K12 | Independently verify scanner findings, Addendum D | R35:595–622 and sanitized table; source scans exit 1, provenance unknown | AWAITING_INDEPENDENT_REVIEW | Sanitized independent provenance review; never disclose values/bypass scanner. |
| K13 | Identify Git attempt origin, Addendum D | R35:626–678; ref observations do not identify actor | INVESTIGATED_NOT_IMPLEMENTED | Attribution UNKNOWN; obtain direct sanitized evidence if available. |
| K14 | P2-CR002 investigation, Addendum D | R35:684–824 and `ses_e509c679effew14i4PHAtyh23y`, investigation-only independent PASS | VERIFIED_COMPLETE | Investigation only; actual correction K15. |
| K15 | Prevent stale concurrent Order overwrite, MP-34R | R35:738–808, static + sequential mocks; prior narrower review not real Mongo proof | PARTIALLY_COMPLETE | Focused desired-invariant RED, minimal fix, isolated Mongo strategy and review. |
| K16 | Fail-closed disposable Mongo test target, MP-34R | R35:102–107 historical inventory; real current environment not tested | BLOCKED_VERIFIED | Design and verify isolated target before destructive cleanup. |
| K17 | Vendor list and mutation privacy, MP-34R | R34:416–429 narrow mutation review; full endpoint family not audited | PARTIALLY_COMPLETE | Test unauthorized nested vendor data across each list/mutation. |
| K18 | Prevent cross-account guest-cart merge, MP-33 §6 | `authStore.ts:135–151,238–241` static gap; no runtime proof or scoped review located | NOT_VERIFIED | Reproduce with fake cart/two isolated identities; no source edits now. |
| K19 | Complete independent MP-36R2 audit and decision register | This report and latest `CORRECTIONS_NEEDED` verdict | AWAITING_INDEPENDENT_REVIEW | Finish source extraction/count review; no self-approval. |
| K20 | Verified live failover runbook, MP-35 §12 | R35:127–162,366–384 historical feasibility | NOT_VERIFIED | Locate or validate end-to-end safe operating procedure. |
| K21 | No S3/P5 or Git mutations during audit, MP-36 §16 | Current audit has no reported mutations; separate unexpected index provenance UNKNOWN | NOT_VERIFIED | Independently check scope; do not infer all historical actions from current absence. |
| K22 | Decide mixed-cart coupon base and rounding, Q-016 | `F01/docs/open_questions.md:211–220` | AWAITING_HUMAN_DECISION | Dossier C1; only this calculation depends on choice. |
| K23 | Decide future invoice retention/automation, Q-018 | `open_questions.md:241–257`; automation deferred | DEFERRED_BY_DECISION | Separate Glacier/WORM/trigger decisions only when future work authorized. |
| K24 | Preserve cart through pending/failed checkout until provider confirmation, MP-30 §4.4 | H30:218–230 and R34:371–387 scoped duplicate fix | PARTIALLY_COMPLETE | Isolated retry/cart/confirmation regression; no provider call in audit. |
| K25 | Own-store and admin purchase restrictions, MP-30 §4.5 | H30:231–242; no exhaustive current authorization evidence | NOT_VERIFIED | Inspect server enforcement and isolated actor tests. |
| K26 | Stream on-demand invoice without false persistent URL, MP-30/33 | `invoice.service.ts:43–59,95–111,157–178` static inconsistency | NOT_VERIFIED | Trace routes/tests; resolve older storage-document conflict without S3. |
| K27 | ES mapping/sync with Mongo source of truth, MP-30/35 | Q:198–207; T:189 historical status | PARTIALLY_COMPLETE | Offline contracts and technical design; not automatically a human gate. |
| K28 | Delivered-order review eligibility, MP-30/Q-031 | Q:224–237; T:230,240 *reported* | PARTIALLY_COMPLETE | Verify current server authorization and UI independently. |
| K29 | CI lint/types/tests/build without deployment, MP-30 §7 | H30:494–521; workflow not fully inspected | NOT_VERIFIED | Inspect existing workflow and safe commands without modifying CI. |
| K30 | Reconcile MP-32 implementation claims, MP-33 §2 | `F01/docs/analysis/mp33_discrepancy_matrix.md:9–94` historical matrix | PARTIALLY_COMPLETE | Check each current source/test; original MP-31/32 text still partial. |
| K31 | Preserve correct vendor mutation response without leaking another vendor, urgent intervention | R34:416–429 narrow review and *reported* tests | VERIFIED_COMPLETE | Exact earlier exception/RED chronology not independently established. |
| K32 | Historical credential exposure channel investigation, MP-34 §5 | R34:69,212,252 records candidate; authenticity and external leak unknown | PARTIALLY_COMPLETE | Owner-led sanitized investigation; recommend rotation if potentially exposed. |
| K33 | Maintain effective visual Tasks/Goals and ownership, MP-34 addendum | H34:712–812; historical board not reconstructed | NOT_VERIFIED | Recover actual task history; no assumption from current board. |
| K34 | Ledger durable append-only/idempotent movements, MP-33 §§12–15 | H30:1025–1258; R34:18 static financial audit | NOT_VERIFIED | Isolated persistence/idempotency/reconciliation tests; no shared DB. |
| K35 | Financial dashboards correctly separate confirmed charges, transfers and payouts, MP-33 §§13–15 | H30:1269–1505; initial metrics specified; runtime scenarios not verified | NOT_VERIFIED | Trace period/ownership/financial semantics and test each safe scenario. |

**Canonical counts (K01–K35 only):** VERIFIED_COMPLETE 7; PARTIALLY_COMPLETE 10; TESTED_SIMULATED_ONLY 1; IMPLEMENTED_NOT_INTEGRATED 2; AWAITING_INDEPENDENT_REVIEW 2; INVESTIGATED_NOT_IMPLEMENTED 1; BLOCKED_VERIFIED 1; NOT_VERIFIED 9; AWAITING_HUMAN_DECISION 1; DEFERRED_BY_DECISION 1. Total **35**. These are bounded outcomes, not the total number of obligations in incompletely recovered source material; CTX rows with independent obligations remain work for traceability, not proof of zero additional requirements.

### Exhaustive mapping of prior rows to a canonical outcome or context

`CTX` means contextual/supporting/heterogeneous parent material; it is not counted as an additional outcome. A row's presence under one K does not transfer its historical status to that K without the evidence in the canonical table.

| Destination | Historical rows (each exactly once) |
|---|---|
| K01 | I01 |
| K02 | I02 |
| K03 | I03 |
| K04 | I04 |
| K05 | I05 |
| K06 | I06 |
| K07 | I07, I08, U06, U09 |
| K08 | I09, I11, U07 |
| K09 | I10, V08 |
| K10 | I12, U08, V09 |
| K11 | I13, I14, I15, I16 |
| K12 | I17, U10 |
| K13 | I18 |
| K14 | I19 |
| K15 | I20, U04 |
| K16 | I21, U05 |
| K17 | S09 |
| K18 | V02 |
| K19 | I24, I26 |
| K20 | I25 |
| K21 | I27, I28, V10 |
| K22 | I29 |
| K23 | I30 |
| K24 | S05 |
| K25 | S06 |
| K26 | S07 |
| K27 | S10 |
| K28 | S11 |
| K29 | S12 |
| K30 | S13, S14, V01 |
| K31 | (no prior I/S/U/V row; original urgent intervention + R34 review) |
| K32 | S24 |
| K33 | U01, U02 |
| K34 | S03, S16, S17 |
| K35 | S04, S18, S19, S20, S23 |
| CTX | I22, I23, S01, S02, S08, S15, S21, S22, U03, V03, V04, V05, V06, V07 |

CTX items are not all resolved: e.g. V03 canonical home, V06 404 behavior and U03 timeline are distinct unresolved work, but prior rows have not yet been split into fully evidenced canonical acceptance targets here. They remain explicitly **NOT VERIFIED**, not erased or counted as completed. The present bounded register therefore does not satisfy a claim of exhaustive material coverage. A Reviewer should decide whether additional separate K rows are needed; do not inflate totals with parent references.

### Git/index evidence and decision boundary

Read-only baseline immediately before this edit: branch `feature/closing-initial-implementation`, HEAD `5ccc9b6acebec6e51aaa96155982be00cc8d1b02`; MP-35 `A`, index/worktree blob `9edb17039bda2ae2b4bb60cb30161d932d6c106b`; report `AM`, index blob `59906d87d6f4110c59ad3405e370b38d08e2ffcc`, worktree blob `fe1ae7184d8598939cf445d1ac17914b45523023`. Earlier observations were MP-35 `AM`, report `??`; later `A`/`AM`. Exact timing and actor remain UNKNOWN. The user explicitly directed preserving the index; no staging, unstaging or other Git mutation was used here. This separate provenance risk does not invalidate unrelated narrow reviews.

Current decision dossier is MP-36R section C above: Q-016 mixed-cart calculation is a genuine business choice before that feature; Q-014 final cart/session retention is a conditional policy decision; Q-018 Glacier, WORM and automation are separate future decisions; Q-003, Q-004, Q-029 and CR-004 require narrow research before claiming a human gate. P2/ES/test isolation are technical work, not automatic business decisions. S3/P5/Git/provider calls during audit remain prohibited. The final autonomous AFIRDD addendum is a future transition after presenting the dossier and appropriate review, not permission to implement during this audit.

**Remaining HIGH scope:** accessible MP-31, MP-32, MP-33 early sections, MP-35R and Addendum B portions are still only partially extracted, despite exact message searches and documented truncation. The mapping makes historical double-counting explicit but does not by itself prove canonical completeness or that all CTX items are nonmaterial. Request independent review of this bounded correction; do not claim CR-001-R1 or CR-005 closed without its verdict.

### MP-36R2 continued — disaggregating historical context

This addendum supersedes the earlier CTX mapping and 35-outcome count without deleting historical evidence. Each new K outcome below has its own independently verifiable acceptance. The original source IDs in the immediately preceding manifest remain unchanged.

| ID | Independently verifiable obligation | Evidence / verification level and review scope | Status | Remaining acceptance and exact next safe action |
|---|---|---|---|---|
| K36 | Reconcile MP-29/MP-30 baseline against actual branch, worktree and previous decisions | H30:38–64 and R34:5–39 show distinct historical checkpoints; static/reported, no global review found | PARTIALLY_COMPLETE | Trace intervening tree snapshots and unexplained changes without modifying Git. |
| K37 | Avoid representing unsupported stored-value wallet or simulated transfers as real provider movement | H30:154–172 and Q:181; static decision, real payment integration not proven | NOT_VERIFIED | Trace wallet balances, API/UI labels and provider records safely. |
| K38 | Verify test-mode Stripe Connect one charge, per-vendor transfer and event semantics | Original MP-33 §11.1–11.2 `prt_1ad829d0e001m33mQyaqatlWEU`, targeted searches `Do not reclassify already authorized implementation as prohibited` and `## 11.2`; T:215–221 distinguishes internal flow | NOT_VERIFIED | Independently trace `source_transaction`, transfer group, commission and idempotency; provider verification only in separately authorized safe test mode. |
| K39 | Markdown inline-backtick secret-scanner behavior and independent review | `F01/docs/mp_log.md:2716–2795`; conflicting historical self-report and intermediate review claim, no current independent verdict established | PARTIALLY_COMPLETE | Reconcile original scanner reviewer session and run focused safe checks in separately scoped work. |
| K40 | Reconcile contradictory TypeScript/test totals and skipped outcomes | R34:5–17 and H30:876–948,1975–2093; static reports conflict, no commands rerun | PARTIALLY_COMPLETE | Obtain original sanitized test outputs, compare exact time/scope; do not run unsafe suite. |
| K41 | Persisted order timeline states, accessibility and reduced motion | Original MP-33 §9 same message, targeted `# 9. ORDER TIMELINE`; H34:245–258; no scoped runtime proof | NOT_VERIFIED | Find component and test states, labels, connectors and reduced motion in isolated frontend tests. |
| K42 | Canonical `/products` home and navigation | Original MP-33 §7, targeted `The project decision is`; `F01/front/src/App.tsx:35` shows only route existence | NOT_VERIFIED | Trace root redirect, logo, refresh and navigation and run safe router tests. |
| K43 | Keep provider-confirmed financial status separate from fulfillment transitions | Original MP-33 §8, targeted `# 8. ORDER`; `order.domain.ts:154–161` transitions and R35:728–756 static persistence trace | PARTIALLY_COMPLETE | Verify all paths and provider-confirmation checks with fake boundaries, then independent review. |
| K44 | Branded frontend 404 and safe nonexistent/cross-user resource behavior | Original MP-33 §10.3, targeted `catch-all redirect to \u0060/\u0060 does not satisfy the requirement`; `App.tsx:72` redirects wildcard to `/` | PARTIALLY_COMPLETE | Test frontend unknown path and backend cross-user resource behavior separately. |
| K45 | English-only user-facing UI | CD-054 `F01/docs/decisions.md:439–445`; R34:157–179 audit source; current full UI not independently verified | NOT_VERIFIED | Inspect current source and accessible labels; focused safe frontend tests. |

**Superseding mapping of the former CTX row:** S01→K36; S02→K37; S08 and V07→K38; S15→K39; S21→K40; U03 and V05→K41; V03→K42; V04→K43; V06→K44. I22 is a heterogeneous parent for K17,K41,K42,K44,K45; I23 is a heterogeneous financial parent for K34,K35,K37,K38,K43; S22 is a heterogeneous UI parent for K41,K42,K44,K45. These three are **supporting context, not separately counted outcomes**. Each of the 14 formerly CTX historical IDs is listed exactly once in this superseding mapping; all other historical mappings in the preceding table remain unchanged.

**Canonical counts K01–K45:** VERIFIED_COMPLETE 7; PARTIALLY_COMPLETE 15; TESTED_SIMULATED_ONLY 1; IMPLEMENTED_NOT_INTEGRATED 2; AWAITING_INDEPENDENT_REVIEW 2; INVESTIGATED_NOT_IMPLEMENTED 1; BLOCKED_VERIFIED 1; NOT_VERIFIED 14; AWAITING_HUMAN_DECISION 1; DEFERRED_BY_DECISION 1. Total **45**. Count is based on K rows, not I/S/U/V/FT/IDLE/AT rows; it is a bounded recovered register, not a claim of exhaustive unrecovered source text.

### Targeted source attempts, recovered scope and limits

1. Original MP-31 `ses_e532607f7ffe10JcdqNHJ9e5Hy` / `prt_1ad07a63a001ym3xgYjBx9kJCD`: exact-title search returned the opening and P4 ceiling. Repeated search for `MP-31's conclusion of functional completeness is NOT accepted` instead returned original MP-32 `prt_1ad38cdf8001KiO7WPxDTSVDIE`, establishing that later mission rejects an MP-31 completeness claim, **not** the exact contents of MP-31. The MP-31 user message is searchable; complete original section text remains partially extracted, not unavailable. K30/K36 cover confirmed evidence only.
2. Original MP-32 `prt_1ad38cdf8001KiO7WPxDTSVDIE`: targeted phrase above recovered its mandate to prioritize real application behavior over code inspection. Full-section attempts using title/known runtime terms still return bounded openings; K03,K04,K15,K24,K30 reflect recovered requirements and historical follow-up, not a complete source enumeration.
3. Original MP-33 `prt_1ad829d0e001m33mQyaqatlWEU`: targeted searches `Audit every relevant claim in MP-32 against the actual repository`, `MP-32 identified a serious issue`, `Test actual state transitions, not only isolated logout methods`, `The project decision is`, `# 8. ORDER`, `# 9. ORDER TIMELINE`, `catch-all redirect to \u0060/\u0060 does not satisfy the requirement`, `Do not reclassify already authorized implementation as prohibited` and `## 11.2` recovered exact fragments of §§2,6–11.2. K18,K30,K38,K41–K45 trace them. Full original §§1,3–5 and the unreturned portions of §§2,6–11.2 still need extraction; no inferred heading is presented as a recovered original.
4. Original MP-35R `ses_e5116df09ffeXzMnJNjzPkTz5Z` / `prt_1af1ed73a001KLZGn9jS3Btm5B`: targeted search `A standalone simulated controller is not sufficient` recovered Task 1 introductory integration requirement; K09/K08 trace static/test boundaries. Other original task bodies remain only partially extracted; Developer delegation is corroboration, not a substitute.
5. Original Addendum B `prt_1af20d02b001o3uDKC5eanVkJq`: targeted searches `The user requires a practical demonstration that Orchestra`, `After completing the currently authorized MP-35R integration`, `If research tools are unavailable, use supported alternatives`, and previously AT-01–12 recover fragments of §§1,8 and exact ATs; K10 traces demonstration. Sections 2–7 and 9 remain only partially recovered. Searches are ranked snippets without a section-offset selector; missing results are neither proof of absence nor SOURCE_NOT_AVAILABLE.
6. Full-session reads returned explicit middle omission markers (148,743 and 29,909 characters); subsequent targeted searches retrieve overlapping snippets but do not expose arbitrary offsets or full section boundaries. Future safe retrieval requires supported message-window access or further exact-text searches. No raw credential-bearing session storage should be read to bypass this limit.

**Secrets incident — sanitized:** a broad local recall search for section 11.2 returned a historical transcript snippet containing a partial representation of an access token. Authenticity and validity are unknown. Disclosure stopped; no token value is reproduced here. The coordinator was informed and the owner should assess revocation/rotation of the potentially affected session credential. No credential was rotated by this audit.

**Review status:** no independent review has yet adjudicated this disaggregation. CR-001-R1 remains limited by partially extracted accessible material; CR-005 is submitted for focused review, not self-approved. Preserve P4/no-S3/no-P5/no-provider/no-Git-write boundaries.

## Focused correction CR-005-R2 and source recovery

Latest independent Reviewer verdict is `CORRECTIONS_NEEDED`: HIGH CR-001-R1 remains open; CR-005-R2 identifies status merging in K07. The following is a **superseding interpretation**, preserving the historical K01–K45 rows. It does not assert independent approval.

### Split canonical outcomes and mapping overrides

K07 is now **only the simulated six-destination ordering and bounded-attempt behavior** (`TESTED_SIMULATED_ONLY`); it does not assert backoff, cooldown, router tool compatibility or real execution. Historical rows I07 and I08 map to K07 only for that narrow controller simulation. Their broader parent wording remains supporting context for the other outcomes below, not additional counted requirements.

| ID | Distinct independently verifiable outcome | Evidence / verification level / review scope | Status | Remaining acceptance and safe next action |
|---|---|---|---|
| K46 | Bounded retry with actual backoff/cooldown, MP-35 §5.2 | `kilo-orchestration/src/provider-failover.ts:116–139` declares `backoffBaseMs`; :159–195 invokes executor and breaks without an observed wait. Static evidence; no independent runtime review established. | PARTIALLY_COMPLETE | Define and test a real bounded timing policy with fake clocks; do not call providers. |
| K47 | Verify router-selected model tool compatibility before use, MP-35 A §3 | H35:779–795; `provider-failover.ts:142–199` shows no demonstrated capability check. Static inspection; no live compatibility test or scoped review found. | NOT_VERIFIED | Research supported provider/adapter capability metadata and test safe rejection without live calls. |
| K48 | Prevent replay after interrupted non-idempotent side effects, MP-35 §5.4 | `resilient-orchestration.ts:55–87` checks a completed checkpoint; R35:422–424 reports simulated completed-op recovery; crash after external effect before checkpoint not proven. Review covered narrower simulation. | PARTIALLY_COMPLETE | Design/test crash boundaries and durable side-effect identity; no financial/provider calls. |
| K49 | Execute three queue passes and progressive intervals in a fake-clock model, Addendum C | `idle-recovery.ts:150–269`; R35:548–565 reports 17 tests, not rerun here; historical review claim limited to simulated component. | TESTED_SIMULATED_ONLY | Preserve simulation and separately verify actual runtime integration K11. |
| K50 | Prevent duplicate concurrent mission wake-up across processes, Addendum C | `idle-recovery.ts:125–134` uses instance-local claim; no atomic cross-process fence established. Static observation; no effective runtime review. | NOT_VERIFIED | Assess supported atomic lease/fencing and isolated concurrency tests before runtime integration. |

**Mapping overrides:** I07/I08→K07; U06→K46; U09→K47. I09→K48; I11 and U07 remain K08, whose narrowed target is **truthful durable checkpoint contents and review continuity**, not replay guarantees. I13→K49; I14 and I15 remain K11, whose narrowed target is **real scheduler integration and persisted next wake**; I16→K50. Each cited historical ID retains exactly one canonical destination. All other historical mappings, including the 14 former CTX overrides immediately above, are unchanged. Original AT/FT/IDLE rows are explanatory drill-downs, excluded from the total.

**Neighbor inspection:** K08 previously mixed checkpoint truth and replay; it is separated into K08/K48. K11 previously grouped fake-clock model, real scheduler and concurrent wake fencing; it is separated into K11/K49/K50. K09 remains actual runtime routing, distinct from simulated K07 and router capability K47. K10 remains a composite autonomy demonstration with individually classified AT children; its `PARTIALLY_COMPLETE` status is not applied to each AT. K34/K35 are broader financial acceptance targets whose scenarios are individually `NOT_VERIFIED` in the existing drill-down; they require further disaggregation if future evidence yields differing statuses, and no provider-complete claim is made.

**Canonical counts K01–K50:** VERIFIED_COMPLETE 7; PARTIALLY_COMPLETE 17; TESTED_SIMULATED_ONLY 2; IMPLEMENTED_NOT_INTEGRATED 2; AWAITING_INDEPENDENT_REVIEW 2; INVESTIGATED_NOT_IMPLEMENTED 1; BLOCKED_VERIFIED 1; NOT_VERIFIED 16; AWAITING_HUMAN_DECISION 1; DEFERRED_BY_DECISION 1. Total **50**. Previous counts 35/45 remain historical, superseded by this count; scope remains the recovered bounded register, not a claim of exhaustive instructions.

### Secrets-safe targeted recovery attempts

After the possible token exposure documented above, only exact distinctive phrase searches with `limit=1` were used; no broad session transcript was read. `A standalone simulated controller is not sufficient` returned original MP-35R user message `prt_1af1ed73a001KLZGn9jS3Btm5B` opening Task 1; K09/K46–K48 distinguish requirements and evidence. `Audit every relevant claim in MP-32 against the actual repository` returned original MP-33 user message `prt_1ad829d0e001m33mQyaqatlWEU` §2; K30 traces its historical matrix, not all implementation claims. `The user requires a practical demonstration that Orchestra can operate autonomously` returned original Addendum B message `prt_1af20d02b001o3uDKC5eanVkJq` §1; K10 and original AT table trace it. Exact MP-31 and MP-32 title searches returned their original message IDs and openings only. Each source remains **accessible by search but partially extracted**; MP-31/32 full bodies, MP-33 early unreturned sections, MP-35R remaining tasks and B §§2–7/9 still require supported offset/window retrieval or more distinctive exact-text searches. No claim of source unavailability or exhaustive extraction follows from these bounded excerpts.

No credential value was reproduced, no provider/DB action was performed, and no Git index mutation was used. The earlier access-token incident and owner rotation recommendation remain active. Submit this focused correction for independent review; CR-001-R1 remains unresolved on current evidence.

## MP-36 final transition — bounded recovery, security and Q-016 (2026-11-06)

**Status:** `AWAITING_INDEPENDENT_REVIEW`; no claim of audit PASS. This addendum supersedes the previous current-status descriptions of Q-016 (including K22 and dossier C1): the user has now approved the rule below. Earlier pending entries remain as historical evidence, not the current decision queue.

### One bounded source-recovery attempt

Five targeted `kilo_local_recall` **search** calls, each with `limit=1`, formed one bounded attempt. No full transcript, credential-bearing output or unrestricted search was read during this attempt:

| Exact search query | Recovered original source and scope | Remaining gap |
|---|---|---|
| `MP-31 — FS-01 Marketplace MVP Completion Verification & Critical Gap Closure` | Session `ses_e532607f7ffe10JcdqNHJ9e5Hy`, message `prt_1ad07a63a001ym3xgYjBx9kJCD`; title, P4 ceiling and opening | Full sections not recovered. |
| `MP-32 — Marketplace Runtime Bug Reproduction, Order Lifecycle Correction` | Same session, `prt_1ad38cdf8001KiO7WPxDTSVDIE`; mission objective opening | Full sections not recovered. |
| `Audit every relevant claim in MP-32 against the actual repository` | Same session, `prt_1ad829d0e001m33mQyaqatlWEU`; MP-33 §2 opening, including persistence of returned immutable payment instance | Other early sections and remainder of §2 not recovered. |
| `A standalone simulated controller is not sufficient` | Session `ses_e5116df09ffeXzMnJNjzPkTz5Z`, `prt_1af1ed73a001KLZGn9jS3Btm5B`; MP-35R Task 1 introduction | Complete MP-35R task bodies not recovered. |
| `The user requires a practical demonstration that Orchestra can operate autonomously` | Same session, `prt_1af20d02b001o3uDK5eanVkJq`; Addendum B §1 opening | §§2–7/9 remain partially recovered; exact ATs remain in prior section. |

All five returned the same narrow material recovered in prior targeted searches; **no new substantive requirement or execution conclusion was established**. Searchable source is not `SOURCE_NOT_AVAILABLE`. The supported search offers ranked snippets rather than message-ID/offset windows; full-session recall previously omitted the relevant middle. After a prior possible-token disclosure, unrestricted transcript retrieval is not a safe workaround. CR-001-R1 therefore remains open/unproven; this bounded attempt does not justify claiming exhaustive coverage. The prior CR-005-R2 split and counts remain pending independent review.

### Sanitized possible token exposure

A prior broad local-recall result displayed a partial representation of an **access token** from a historical FS-01 manual test/checklist session. The session label and context indicate a test-oriented Marketplace workflow, but the issuing service, owner, authenticity, validity and whether the representation corresponds to an actual credential are **NOT VERIFIED**. This assessment relies only on metadata already observed; the secret-bearing output was not reread, queried or copied. Treat exposure as possible. The responsible owner should assess the affected test/session credential and revoke or rotate it if exposure cannot be excluded, following the applicable security process. No automatic rotation, revocation, provider call or credential disclosure was performed in this task.

### Q-016 — user approval and documentation transition

The user explicitly approved mixed-cart coupon calculation on **eligible subtotal only**, deterministic rounding to the operational currency's minor unit, deterministic allocation that preserves the exact rounded total, zero allocation to ineligible items, and stable repeated results; preserve currency abstraction. This approval does not prescribe an allocation algorithm. The authoritative record is `F01/docs/decisions.md` CD-050, which retains Q-016 origin and previously decided exclusions/no stacking/consumer choice. The fully resolved Q-016 entry was removed from `F01/docs/open_questions.md`; the precise algorithm and safe tests/independent review remain technical implementation work in T-1102/T-1106, not a new business blocker. Existing dated task addenda remain historical, not evidence that the newly approved rule is implemented. No application work was done.

The documentary update and this report require independent review. P4 remains the ceiling; no S3/P5, provider calls, unsafe shared DB tests, index mutations, credential action or application implementation is authorized by this audit.
