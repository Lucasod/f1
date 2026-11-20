# MP-F01 — AFIRDD: Financial Closure

**Verdict: BLOCKED.** The original review identified production blockers. The follow-up addresses several of them, with focused tests passing. Live integrations and the full acceptance run remain open.

## Requirements matrix

| Requirement | Status | Evidence |
| --- | --- | --- |
| R-01 · Financial atomicity | Partial | The runtime now passes MongoDB to the payment service. Order writes reuse the conditional serializer and share the transaction session. Compose configures a replica set. Real rollback and shared wallet-and-ledger atomicity remain unverified. |
| R-02 · Webhook idempotency | Partial | The Checkout handler checks the persisted event ID and returns a retryable failure if persistence throws. Duplicate delivery across handler instances passes. Concurrent delivery and failure between the cart mutation and event write remain open. |
| R-03 · Concurrent payment attempts | Focused tests pass | Retries derive their key from the existing payment history. Mongo replay preserves ID and provider. The concurrent retry and repository mapping tests pass without a real Mongo server. |
| R-04 · Stripe Connect destination | Focused tests pass | Runtime wiring supplies the vendor repository. The service resolves a PaymentIntent to its charge for the Stripe transfer and rejects missing or inactive destinations. Stripe sandbox execution is unverified. |
| R-05 · Refund commission | Focused tests pass | Mongo payment mapping round-trips the captured commission snapshot so refunds can use the original rate. Legacy payments without a snapshot keep the existing fallback. |
| R-06 · Transfer to payout | Partial | [Payout creation](../../back/src/modules/payout/payout.service.ts#L96) checks for an existing reference before writing. Startup indexes omit the payout reference, and ledger recovery after a partial failure remains unverified. The installed Stripe event type list also omits `transfer.paid`, so the trigger needs provider-contract verification. |
| R-07 · Stripe test mode | External blocker | End-to-end verification requires configured Stripe test-mode credentials and connected accounts. |
| R-08 · PaymentIntent events | Focused tests pass | Checkout sends payment and order metadata to the intent. An early success can correlate from that metadata, and a captured payment with a pending order can re-enter finalization. Live event ordering remains unverified. |

## Financial integrity and rollback

CR-001 has code-level coverage. CR-002 still needs proof of shared wallet and ledger rollback. The CR-003 process-local set and swallowed write failure are corrected. Durable cart reconciliation across concurrent deliveries or a failed marker write remains open. The callback fixture verifies application wiring. Rollback verification requires a real transaction-capable MongoDB deployment and injected write failure.

## Test evidence

The full run also exposed an intermittent ordering failure. The in-memory repository now sorts order payments by creation time, matching MongoDB. The existing test uses a fixed clock to distinguish creation order from update order.

| Run | Result |
| --- | --- |
| Payment service before fixture change | 96 passed, 13 failed |
| Payment service after injecting the Mongo session fixture in 17 inline constructions | 109 passed |
| Focused financial suite, including payment, webhook, transfer and payout files | 209 passed across 12 files, including the Connect seed tests |
| Full backend command, preliminary suites | 14 isolated Checkout tests and 1 Node test passed |
| Full backend command, main Vitest suite | 1,205 passed, 505 failed, 146 skipped. An isolated health test confirmed `listen EPERM` on loopback. The full run also logged unavailable Redis. This is an environment-constrained run, not an acceptance baseline. |
| Backend and frontend builds | Passed |
| Frontend Vitest | 684 passed, 11 failed. The failed HTTP-backed checkout tests encountered `listen EPERM`. |
| Elasticsearch | The previous run reported GREEN and 5/5 passing. This review did not rerun the cluster checks. |

## Independent review and closure conditions

The original independent review returned **BLOCKED**. The follow-up changes have focused test evidence. Verify rollback and concurrent webhook behavior against real MongoDB and Redis, and confirm the provider contract for payouts. Rerun the complete backend suite where local HTTP and Redis are available. Record Stripe test-mode results when the external configuration is available.
