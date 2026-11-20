# MP-F04-028 — Requirements Matrix

## Audit Scope
- Repository: /home/workstation/source/f1/F04
- Branch: feature/closing-initial-implementation
- HEAD: cb00c505a5f6a13885c6d047bc8dcee3f9e5f8cb
- Audit date: 2026-11-19

## Requirements Classification Matrix

| Req ID | Requirement | Source Mission | Status | Evidence | Notes |
|---|---|---|---|---|---|
| REQ-001 | Django test suite passes | MP-F04-026 | COMPLETE | 284/284 tests pass (exit code 0) | All tests require SECRET_TEST_PASS and WEBHOOK_SIGNING_SECRET from .env |
| REQ-002 | Playwright test suite passes | MP-F04-026 | PARTIAL | 63/65 pass; 2 fail in drag-and-drop E2E | Drag-and-drop test fails due to @dnd-kit v6.3.1 + Playwright mouse event incompatibility; original 61 tests all pass |
| REQ-003 | Frontend TypeScript typecheck passes | MP-F04-026 | COMPLETE | npx tsc --noEmit exit code 0 | No type errors |
| REQ-004 | Frontend Vite production build passes | MP-F04-026 | COMPLETE | npm run build exit code 0 | 76 modules transformed in 986ms |
| REQ-005 | Secrets scanner clean | MP-F04-027 | COMPLETE | scan-secrets.sh exit 0 (staged + untracked) | No secret findings |
| REQ-006 | Stripe sandbox authentication | MP-F04-027 | COMPLETE | stripe-cli container starts, authenticates, reaches stripe listen | Identity acct_1UcUoyFkjRSrhiBo confirmed; rk_test_ sandbox mode |
| REQ-007 | Stripe CLI persistence across container recreation | MP-F04-027 | COMPLETE | Named volume stripe-cli-auth-f04 survives force-recreate | "Ready!" message after recreation |
| REQ-008 | STRIPE_WEBHOOK_SECRET correspondence with Django | MP-F04-027 | COMPLETE | Webhook signature verification returns 200 for valid signatures | Django validates signatures successfully |
| REQ-009 | Webhook signed delivery | MP-F04-027 | COMPLETE | stripe listen --forward-to to Django webhook endpoint | Returns 200 for valid HMAC-SHA256 |
| REQ-010 | Invalid signature rejection | MP-F04-027 | COMPLETE | test_stripe_webhook_invalid_signature_returns_400 passes | Returns 400 for invalid signatures |
| REQ-011 | Multi-tenant isolation | MP-F04-026 | COMPLETE | 109/109 Django tenant isolation tests pass | Cross-workspace access denied |
| REQ-012 | Stripe SDK v13+ compatibility | MP-F04-026 | COMPLETE | views.py line 2762: getattr(event, 'data', None) or getattr(event, 'Data', None) | Fix in place, tested by test_stripe_webhook_data_field_extraction |
| REQ-013 | Drag-and-drop between columns | MP-F04-026 | PARTIAL | In-session drag works via API transition; drag-preview not rendered with Playwright mouse events | @dnd-kit v6.3.1 PointerSensor doesn't respond to Playwright page.mouse events; needs native HTML5 Drag and Drop API |
| REQ-014 | Drag-and-drop to empty column | MP-F04-026 | PARTIAL | Column body has minHeight: 80 and useDroppable(ref=setNodeRef) but attributes/listeners not spread | Empty column can be drop target but drag-preview not injected by Playwright mouse simulation |
| REQ-015 | Drag-and-drop keyboard navigation | MP-F04-026 | PARTIAL | KeyboardSensor configured with sortableKeyboardCoordinates | Not E2E tested due to test environment limitation |
| REQ-016 | Tenant isolation for drag-and-drop | MP-F04-026 | COMPLETE | Outsider gets 403 on transition API call | Cross-tenant transition rejected |
| REQ-017 | Secrets scanner integration | MP-F04-027 | COMPLETE | Pre-commit hook active; scanner exits 0 | No secrets in any changed file |
| REQ-018 | Webhook idempotency | MP-F04-027 | COMPLETE | record_stripe_event prevents duplicate processing | Returns 200 for duplicate event_id |
| REQ-019 | CORS configuration for frontend dev server | MP-F04-026 | COMPLETE | Port 8765 added to _LOCAL_CORS_ORIGINS | Frontend on 8765 can access backend on 8000 |
| REQ-020 | stripe-cli env_file isolation | MP-F04-027 | COMPLETE | stripe-cli uses ./backend/.env.stripe-cli (STRIPE_* only) | Django/PostgreSQL/Celery credentials not exposed to stripe-cli |

## Status Summary
- COMPLETE: 16 requirements
- PARTIAL: 4 requirements (REQ-002, REQ-013, REQ-014, REQ-015)
- BROKEN: 0
- NOT_IMPLEMENTED: 0
- BLOCKED: 0
- NOT_VERIFIED: 0

## Cross-Reference
- See MP-F04-028-test-evidence.md for test command details and outputs
- See MP-F04-028-findings.md for classified findings
- See MP-F04-028-recovery-plan.md for prioritized correction plan
