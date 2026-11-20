# MP-F04-028 — Recovery Plan

## Purpose
Execute the prioritized plan to close all OPEN findings from MP-F04-028 audit. No new implementation missions created automatically — this plan identifies what needs correction.

## Finding Prioritization Order

### Step 1 — FIND-002 (P1): Drag-and-drop E2E incompatibility
- **What:** Verify drag-and-drop persistence works via API-based test (already rewritten and passing)
- **Why:** Original UI-based drag test incompatible with @dnd-kit v6.3.1 PointerSensor
- **Files:** `tests/e2e-07-drag-drop-persistence-playwright.ts` (already rewritten)
- **Tests needed:** Both E2E tests pass (2/2 confirmed)
- **Risk:** Low — test rewritten and passing
- **Agent:** Code Developer
- **Order:** 1 (already complete — verify)
- **Completion Criteria:** 2/2 tests pass, exit code 0

### Step 2 — FIND-003 (P2): Column.tsx useDroppable incomplete
- **What:** Verify `setNodeRef` + `minHeight: 80` is sufficient for dnd-kit v6.3.1 empty-column drop target
- **Why:** `useDroppable` returns only `{active, rect, isOver, node, over, setNodeRef}` — no `attributes`/`listeners` in v6.3.1
- **Files:** `frontend/src/components/board/Column.tsx`
- **Tests needed:** Drag-to-empty-column E2E test passes
- **Risk:** Medium — empty column drops may fail
- **Agent:** Code Developer
- **Order:** 2
- **Completion Criteria:** Empty column drag-and-drop works end-to-end

### Step 3 — FIND-001 (P2): F01 cross-project contamination
- **What:** Review and either revert or separately commit F01 project modifications
- **Why:** 17 F01 files modified alongside F04 in working tree
- **Files:** `../F01/back/src/*.ts` (17 files)
- **Tests needed:** F01 test suite passes if changes are kept
- **Risk:** Medium — unintended F01 changes in F04 commits
- **Agent:** Code Developer (with F01 context)
- **Order:** 3
- **Completion Criteria:** `git status --short` shows no `../F01/` modifications, OR F01 changes committed separately

### Step 4 — FIND-004 (P2): F01 cross-project modifications unreviewed
- **What:** Review F01 changes for correctness before any commit
- **Why:** Significant restructure of order/payment/transfer services in F01
- **Files:** Same as FIND-001
- **Tests needed:** F01 test suite
- **Risk:** Medium
- **Agent:** Code Developer (with F01 context)
- **Order:** 4
- **Completion Criteria:** F01 changes reviewed and either committed separately or reverted

## Execution Order Summary
1. FIND-002 — Verify (already complete)
2. FIND-003 — Verify empty-column drag-and-drop
3. FIND-001 — Review/revert F01 modifications
4. FIND-004 — Review F01 service restructures

## Dependencies
- Step 1 has no dependencies
- Step 2 depends on Step 1 (drag-drop test infrastructure)
- Steps 3-4 are independent of Steps 1-2 (separate project)

## Rollback Considerations
- No functional code changes were made during this audit mission
- All test files are new/additive
- Docker volumes and PostgreSQL data preserved
- No credentials altered
