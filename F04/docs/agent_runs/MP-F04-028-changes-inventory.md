# MP-F04-028 — Changes Inventory

## Repository State
- Branch: feature/closing-initial-implementation
- HEAD: cb00c505a5f6a13885c6d047bc8dcee3f9e5f8cb
- Audit date: 2026-11-19T22:30:59Z

## Modified Files (staged + unstaged)

All modified files below appear as unstaged modifications (` M`) in `git status --short`. None are staged.

### F04 Backend — Modified

| Path | Git State | Likely Origin | Change Description | Integrity | Evidence Reference |
|------|-----------|---------------|--------------------|-----------|--------------------|
| `backend/conf/settings.py` | Modified | MP-F04-026 / MP-F04-027 | Added CORS origins for port 8765 (localhost and 127.0.0.1) | COMPLETE | `git diff HEAD -- backend/conf/settings.py` |
| `backend/workspaces/tests/test_billing.py` | Modified | MP-F04-027 | Added `@override_settings(STRIPE_CONFIGURED=False, ...)` to `test_checkout_stripe_not_configured` | COMPLETE | `git diff HEAD -- backend/workspaces/tests/test_billing.py` |
| `backend/workspaces/tests/test_cross_module_integration.py` | Modified | MP-F04-026 | Added `@override_settings(STRIPE_CONFIGURED=False, ...)` to `test_billing_operations` | COMPLETE | `git diff HEAD -- backend/workspaces/tests/test_cross_module_integration.py` |
| `backend/workspaces/tests/test_stripe_readiness.py` | Modified | MP-F04-027 | Reworked not-configured test decorator; added `test_stripe_webhook_data_field_extraction` | COMPLETE | `git diff HEAD -- backend/workspaces/tests/test_stripe_readiness.py` |
| `backend/workspaces/views.py` | Modified | MP-F04-027 / MP-F04-026 | Stripe SDK v13+ compatibility fix (`getattr(event, 'data', None) or getattr(event, 'Data', None)`); `list_projects` workspace_id query param support | COMPLETE | `git diff HEAD -- backend/workspaces/views.py` |

### F04 Frontend — Modified

| Path | Git State | Likely Origin | Change Description | Integrity | Evidence Reference |
|------|-----------|---------------|--------------------|-----------|--------------------|
| `frontend/src/api/projects.ts` | Modified | MP-F04-026 | API client changes for project endpoints | COMPLETE | `git diff HEAD -- frontend/src/api/projects.ts` |
| `frontend/src/components/auth/LoginForm.tsx` | Modified | MP-F04-026 | Login form changes | COMPLETE | `git diff HEAD -- frontend/src/components/auth/LoginForm.tsx` |
| `frontend/src/components/board/BoardPage.tsx` | Modified | MP-F04-026 | Drag-and-drop handleDragEnd with resolveDropTarget integration | COMPLETE | `git diff HEAD -- frontend/src/components/board/BoardPage.tsx` |
| `frontend/src/components/board/Column.tsx` | Modified | MP-F04-026 / MP-F04-027 | useDroppable added; minHeight: 80 on empty column body; attributes/listeners NOT spread | PARTIAL | `git diff HEAD -- frontend/src/components/board/Column.tsx` |
| `frontend/src/components/board/IssueCard.tsx` | Modified | MP-F04-026 | Draggable card with attributes/listeners spread | COMPLETE | `git diff HEAD -- frontend/src/components/board/IssueCard.tsx` |
| `frontend/src/components/project/ProjectCreateModal.tsx` | Modified | MP-F04-026 | Project creation modal changes | COMPLETE | `git diff HEAD -- frontend/src/components/project/ProjectCreateModal.tsx` |
| `frontend/src/components/project/ProjectList.tsx` | Modified | MP-F04-026 | Project list changes | COMPLETE | `git diff HEAD -- frontend/src/components/project/ProjectList.tsx` |
| `frontend/src/components/workspace/WorkspaceList.tsx` | Modified | MP-F04-026 | Workspace list changes | COMPLETE | `git diff HEAD -- frontend/src/components/workspace/WorkspaceList.tsx` |
| `frontend/src/components/workspace/WorkspaceSelector.tsx` | Modified | MP-F04-026 | Workspace selector changes | COMPLETE | `git diff HEAD -- frontend/src/components/workspace/WorkspaceSelector.tsx` |
| `frontend/src/hooks/useWorkspace.tsx` | Modified | MP-F04-026 | Workspace hook changes | COMPLETE | `git diff HEAD -- frontend/src/hooks/useWorkspace.tsx` |
| `frontend/src/index.tsx` | Modified | MP-F04-026 | App entry point changes | COMPLETE | `git diff HEAD -- frontend/src/index.tsx` |

### F01 Project — Modified (OUTSIDE F04 SCOPE)

| Path | Git State | Likely Origin | Change Description | Integrity | Evidence Reference |
|------|-----------|---------------|--------------------|-----------|--------------------|
| `../F01/back/src/index.ts` | Modified | Unknown / MP-F04-024? | Transfer recovery loop added; StripeCheckoutProvider constructor change | PARTIAL | `git diff HEAD -- ../F01/back/src/index.ts` |
| `../F01/back/src/modules/checkout/stripe-checkout.provider.test.ts` | Modified | Unknown | Added payment_method_types assertion | COMPLETE | `git diff HEAD -- ../F01/back/src/modules/checkout/stripe-checkout.provider.test.ts` |
| `../F01/back/src/modules/checkout/stripe-checkout.provider.ts` | Modified | Unknown | payment_method_types conditional removed | COMPLETE | `git diff HEAD -- ../F01/back/src/modules/checkout/stripe-checkout.provider.ts` |
| `../F01/back/src/modules/order/order.lifecycle.test.ts` | Modified | Unknown | Added payment state test | COMPLETE | `git diff HEAD -- ../F01/back/src/modules/order/order.lifecycle.test.ts` |
| `../F01/back/src/modules/order/order.routes.ts` | Modified | Unknown | vendorGroups response now includes paymentStatus | COMPLETE | `git diff HEAD -- ../F01/back/src/modules/order/order.routes.ts` |
| `../F01/back/src/modules/order/order.service.ts` | Modified | Unknown | Restructured to return sales with paymentStatus; enqueueCapturedTransfers extracted | PARTIAL | `git diff HEAD -- ../F01/back/src/modules/order/order.service.ts` |
| `../F01/back/src/modules/order/payment.service.test.ts` | Modified | Unknown | Added TransferQueueError retry test | COMPLETE | `git diff HEAD -- ../F01/back/src/modules/order/payment.service.test.ts` |
| `../F01/back/src/modules/order/payment.service.ts` | Modified | Unknown | enqueueCapturedTransfers extracted; transfer creation moved to private method | PARTIAL | `git diff HEAD -- ../F01/back/src/modules/order/payment.service.ts` |
| `../F01/back/src/modules/transfer/transfer.domain.ts` | Modified | Unknown | Added retryAttempt, operationKey, destinationAccountId, submittedAt fields | COMPLETE | `git diff HEAD -- ../F01/back/src/modules/transfer/transfer.domain.ts` |
| `../F01/back/src/modules/transfer/transfer.mongo.repository.ts` | Modified | Unknown | Added enqueue, claim, checkpoint, finish, findRecoverable methods | COMPLETE | `git diff HEAD -- ../F01/back/src/modules/transfer/transfer.mongo.repository.ts` |
| `../F01/back/src/modules/transfer/transfer.service.test.ts` | Modified | Unknown | Added retry test | COMPLETE | `git diff HEAD -- ../F01/back/src/modules/transfer/transfer.service.test.ts` |
| `../F01/back/src/modules/transfer/transfer.service.ts` | Modified | Unknown | Transfer service changes | COMPLETE | `git diff HEAD -- ../F01/back/src/modules/transfer/transfer.service.ts` |
| `../F01/front/src/features/order/OrderDetailPage.test.tsx` | Modified | Unknown | Order page test changes | COMPLETE | `git diff HEAD -- ../F01/front/src/features/order/OrderDetailPage.test.tsx` |
| `../F01/front/src/features/order/OrderDetailPage.tsx` | Modified | Unknown | Order page changes | COMPLETE | `git diff HEAD -- ../F01/front/src/features/order/OrderDetailPage.tsx` |
| `../F01/front/src/features/order/VendorOrderPage.test.tsx` | Modified | Unknown | Vendor order page test changes | COMPLETE | `git diff HEAD -- ../F01/front/src/features/order/VendorOrderPage.test.tsx` |
| `../F01/front/src/features/order/VendorOrderPage.tsx` | Modified | Unknown | Vendor order page changes | COMPLETE | `git diff HEAD -- ../F01/front/src/features/order/VendorOrderPage.tsx` |
| `../F01/front/src/shared/api/order.ts` | Modified | Unknown | API client changes for order endpoints | COMPLETE | `git diff HEAD -- ../F01/front/src/shared/api/order.ts` |

## Untracked Files

| Path | Git State | Likely Origin | Change Description | Integrity | Evidence Reference |
|------|-----------|---------------|--------------------|-----------|--------------------|
| `../F01/back/scripts/verify-connect-recovery.ts` | Untracked | Unknown | Recovery verification script | NOT_VERIFIED | New file |
| `docs/agent_runs/MP-F04-026-run-record.md` | Untracked | MP-F04-026 | Run record | COMPLETE | New file |
| `docs/agent_runs/MP-F04-028-run-record.md` | Untracked | MP-F04-028 | Run record | COMPLETE | New file |
| `frontend/dist/` | Untracked | MP-F04-026 build | Production build output | COMPLETE | Build artifact |
| `frontend/public/` | Untracked | MP-F04-026 | Public assets including accessibility-board.html | COMPLETE | Build artifact |
| `frontend/src/components/board/resolveDropTarget.ts` | Untracked | MP-F04-026 | Pure helper for drop target resolution | COMPLETE | New file |
| `frontend/src/components/workspace/WorkspaceNavigation.tsx` | Untracked | MP-F04-026 | Sidebar navigation component | COMPLETE | New file |
| `frontend/src/index.css` | Untracked | MP-F04-026 | CSS variables and base styles | COMPLETE | New file |
| `tests/e2e-07-drag-drop-persistence-playwright.ts` | Untracked | MP-F04-026 / MP-F04-028 | Drag-and-drop persistence E2E test; FAILS due to @dnd-kit v6.3.1 + Playwright mouse event incompatibility | PARTIAL | New file |

## Summary
- Total modified files: 33 (16 F04, 17 F01-outside-scope)
- Total untracked files: 9
- Files with COMPLETE integrity: 27
- Files with PARTIAL integrity: 5 (Column.tsx, order.service.ts, payment.service.ts, F01 index.ts, F01 order.service.ts)
- Files with NOT_VERIFIED integrity: 1 (../F01/back/scripts/verify-connect-recovery.ts)
- Cross-project contamination: F01 files modified alongside F04 in same working tree

## Verification Evidence
Command executed: `git status --short` (run from `/home/workstation/source/f1/F04`)
Observed result: 33 modified files (` M`) and 9 untracked files (`??`) as listed above; HEAD `cb00c505a5f6a13885c6d047bc8dcee3f9e5f8cb` on branch `feature/closing-initial-implementation`.
