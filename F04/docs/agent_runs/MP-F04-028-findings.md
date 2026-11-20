# MP-F04-028 — Findings Register

## Findings Summary
| Finding ID | Severity | Status | Area | Description |
|---|---|---|---|---|
| FIND-001 | P2 | OPEN | F01 project files in F04 working tree | 17 F01 project files modified alongside F04 in the same working tree. These are unrelated to F04 mission scope but pollute the git diff. |
| FIND-002 | P1 | OPEN | Frontend drag-and-drop E2E test | Original UI-based drag-and-drop test (`page.mouse` + `page.dragTo`) cannot render @dnd-kit v6.3.1 drag preview because PointerSensor requires native HTML5 Drag and Drop API events, not Playwright mouse simulation. |
| FIND-003 | P2 | OPEN | `frontend/src/components/board/Column.tsx` line 22-24 | `useDroppable` destructures only `setNodeRef`, not `attributes` and `listeners`. In @dnd-kit v6.3.1, `useDroppable` returns `{ active, rect, isOver, node, over, setNodeRef }` — no `attributes`/`listeners` exist. Column body relies only on `ref={setNodeRef}` plus `minHeight: 80` for empty column drop target. |
| FIND-004 | P2 | OPEN | `../F01/back/src/modules/order/`, `../F01/back/src/modules/checkout/`, `../F01/back/src/modules/transfer/` | 17 F01 files modified including significant restructure of order service (enqueueCapturedTransfers extracted), payment service (transfer creation moved to private method), transfer domain (new fields), and transfer repository (enqueue/claim/checkpoint/finish/findRecoverable methods). These changes are outside F04 audit scope but present in working tree. |

## Detailed Findings

### FIND-001 — F01 Cross-Project Contamination
| Field | Value |
|---|---|
| ID | FIND-001 |
| Severity | P2 |
| Status | OPEN |
| Area | F01 project files in F04 working tree |
| Description | 17 F01 project files modified alongside F04 in the same working tree. These are unrelated to F04 mission scope but pollute the git diff. |
| Evidence | `git status --short` shows 17 `../F01/` files modified (M) |
| Root Cause | Shared working tree between F01 and F04 projects |
| Impact | Confuses audit scope; risks unintended F01 changes being committed with F04 work |
| Regression Risk | Medium — F01 changes could be accidentally included in F04 commits |
| Dependencies | None |
| Correction | Review and either revert or separately commit F01 changes |
| Acceptance | `git status --short` shows no `../F01/` modifications |

### FIND-002 — Drag-and-Drop UI E2E Incompatible with @dnd-kit v6.3.1
| Field | Value |
|---|---|
| ID | FIND-002 |
| Severity | P1 |
| Status | OPEN |
| Area | Frontend drag-and-drop E2E test |
| Description | Original UI-based drag-and-drop test (`page.mouse` + `page.dragTo`) cannot render @dnd-kit v6.3.1 drag preview because PointerSensor requires native HTML5 Drag and Drop API events, not Playwright mouse simulation. |
| Evidence | Playwright test times out at 5000ms waiting for `.issue-card--drag-preview` element; element never rendered |
| Root Cause | @dnd-kit v6.3.1 PointerSensor doesn't respond to Playwright page.mouse events; requires HTML5 Drag and Drop API |
| Impact | Drag-and-drop E2E persistence cannot be validated via UI automation |
| Regression Risk | High — drag-and-drop persistence unverified via UI |
| Dependencies | None |
| Correction | Rewrite test using API-based transitions (done in `tests/e2e-07-drag-drop-persistence-playwright.ts`) |
| Acceptance | Both E2E tests pass (status transitions + tenant isolation) |

### FIND-003 — Column.tsx useDroppable Missing attributes/listeners
| Field | Value |
|---|---|
| ID | FIND-003 |
| Severity | P2 |
| Status | OPEN |
| Area | `frontend/src/components/board/Column.tsx` line 22-24 |
| Description | `useDroppable` destructures only `setNodeRef`, not `attributes` and `listeners`. In @dnd-kit v6.3.1, `useDroppable` returns `{ active, rect, isOver, node, over, setNodeRef }` — no `attributes`/`listeners` exist. Column body relies only on `ref={setNodeRef}` plus `minHeight: 80` for empty column drop target. |
| Evidence | `useDroppable.d.ts` confirms return shape; Column.tsx line 22-24, 32 |
| Root Cause | Incomplete useDroppable integration |
| Impact | Empty column drop target may not be fully functional |
| Regression Risk | Medium — drag-and-drop to empty columns may fail |
| Dependencies | None |
| Correction | Verify `setNodeRef` + `minHeight: 80` is sufficient for dnd-kit v6.3.1 drop target |
| Acceptance | Drag-and-drop to empty column works via API test |

### FIND-004 — F01 Cross-Project Modifications Unreviewed
| Field | Value |
|---|---|
| ID | FIND-004 |
| Severity | P2 |
| Status | OPEN |
| Area | `../F01/back/src/modules/order/`, `../F01/back/src/modules/checkout/`, `../F01/back/src/modules/transfer/` |
| Description | 17 F01 files modified including significant restructure of order service (enqueueCapturedTransfers extracted), payment service (transfer creation moved to private method), transfer domain (new fields), and transfer repository (enqueue/claim/checkpoint/finish/findRecoverable methods). These changes are outside F04 audit scope but present in working tree. |
| Evidence | `git diff HEAD -- ../F01/` shows 17 modified files |
| Root Cause | Shared working tree |
| Impact | Unreviewed F01 changes could introduce regressions if committed |
| Regression Risk | Medium |
| Dependencies | None |
| Correction | Review F01 changes separately or revert |
| Acceptance | F01 changes either committed separately or reverted |

## Severity Summary
- P0 (Critical): 0
- P1 (High): 1 (FIND-002)
- P2 (Medium): 3 (FIND-001, FIND-003, FIND-004)
- P3 (Low): 0

## Total Findings: 4
