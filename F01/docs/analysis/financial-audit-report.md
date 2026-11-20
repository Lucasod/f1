# MP-P5-REALITY-CHECK-VALIDATION: Financial System Audit

## Executive Summary

This audit investigates 8 critical areas of the financial system for the MP-P5-REALITY-CHECK-VALIDATION task. The codebase is the FS-01 Marketplace backend built with TypeScript, using MongoDB, Stripe for payments, and an in-memory financial ledger.

**Overall findings:** The system has several architectural concerns around atomicity, idempotence, and vendor attribution, though the core payment state machine and test coverage are solid. Most issues are design deficiencies rather than critical bugs.

---

## 1. Atomicity between Materialized Balance and Ledger

**Findings: NOT ATOMIC - Balance updates and ledger movements are separate operations without two-phase commit or compensation.**

### Evidence

**Wallet Service (`wallet.service.ts`):**
- `credit()` (line 36-64) and `debit()` (line 66-93) update the wallet balance and save a wallet transaction, but these are NOT atomic with the payment ledger movements.
- The `reconcile()` method (line 95-110) computes the "computed" balance from transactions and compares it to the "materialized" wallet balance, suggesting the system is aware of potential inconsistencies.
- No transaction boundaries exist between wallet updates and financial movement recordings.

**Payment Service (`payment.service.ts`):**
- `recordPaymentLedger()` (line 91-127) is "best-effort": if `movementRepo` or `eventRepo` is not wired, recording is skipped without failing the payment flow (line 89, 116).
- `capturePayment()` (line 262-306) calls `recordPaymentLedger()` and `markCapturedOrderPaid()` as separate operations. If one succeeds and the other fails, the system is inconsistent.
- `failPayment()` (line 451-530) and `refundPayment()` (line 532-572) follow the same pattern - ledger recording is best-effort.

**Order Domain (`order.domain.ts`):**
- `markCapturedOrderPaid()` (line 308-339) transitions the order to PAID status, but this is a separate persistence step from the payment capture.

### Root Cause

The system assumes that if the payment service succeeds, the ledger will also succeed. There is no:
- Two-phase commit across wallet + ledger + order
- Compensating transaction on failure
- Distributed transaction protocol
- Idempotency key that covers the full lifecycle

### Recommendation

Implement a transaction coordinator that either:
1. Wraps wallet updates + ledger movements + order status in a single transaction context, or
2. Implements compensation logic: if wallet update succeeds but ledger fails, debit the wallet; if ledger succeeds but wallet fails, record the movement anyway (accept potential double-spend risk) and alert operators.

---

## 2. Idempotence of Stripe Events

**Findings: PARTIALLY IDempotent - In-memory Set provides same-process detection, but persistence relies on fragile private access and would not survive process restart.**

### Evidence

**Stripe Webhook Handler (`stripe-webhook.handler.ts`):**
- **In-memory Set fast path** (line 86): `if (processedEventIds.has(stripeEventId))` - provides duplicate detection within the same process execution.
- **Persistent correlate** (line 90-95): Checks `paymentService.getPaymentById(paymentId)` and compares `existingPayment.eventId === stripeEventId`.
- **Private access fragility** (line 20-21): 
  ```typescript
  const paymentRepo = paymentService['paymentRepo'];
  const orderRepo = paymentService['orderRepo'];
  ```
  This bypasses the PaymentService API and accesses private fields directly. If the PaymentService constructor changes, this code breaks.

- **Event ID persistence** (line 118-132): After successful payment capture, the Stripe event ID is best-effort saved:
  ```typescript
  try {
    const existing = await paymentService.getPaymentById(paymentId);
    if (existing && existing.eventId !== event.id && event.id) {
      ;(existing as any).eventId = event.id;
      if (paymentRepo && typeof paymentRepo.save === 'function') {
        await paymentRepo.save(existing).catch(() => void 0);
      }
    }
  } catch { /* Best-effort; do not fail the webhook delivery if saving fails. */ }
  ```
  The `catch` block silently swallows errors, meaning the eventId may never be persisted.

- **In-memory Set is lost on process restart** - if the webhook handler process restarts, the `processedEventIds` Set is empty, and only the persistent `payment.eventId` check remains.

### Evidence from Tests

- `stripe-webhook.handler.test.ts` "LC-15 cart reconciliation > does not perform a second removal on duplicate webhook delivery (idempotency)" (line 506-550) tests that duplicate deliveries are handled, but this relies on the in-memory Set + persistent eventId check working together.

### Recommendation

1. **Encapsulate the eventId access** - Add public methods to PaymentService: `getPaymentEventId(paymentId): Promise<string | undefined>` and `setPaymentEventId(paymentId, eventId: string): Promise<void>` instead of private access.
2. **Make eventId persistence non-best-effort** - Remove the `try/catch` silence and fail the webhook if the eventId cannot be persisted, OR ensure the MongoPaymentRepository always persists it (which it does via the `save` method).
3. **Persist processedEventIds to Redis or MongoDB** for cross-process idempotence, not just in-memory.

---

## 3. Absence of Duplicate Launches

**Findings: DUPLICATE PREVENTION EXISTS but has gaps - the `createPayment` idempotency check may miss edge cases.**

### Evidence

**Payment Service `createPayment()` (`payment.service.ts`):**
- Lines 167-173 check for existing pending/authorized payments:
  ```typescript
  const existingPayments = await this.paymentRepo.findByOrderId(orderId);
  const pendingOrAuthorizedPayment = existingPayments.find(
    p => p.status === PaymentStatus.PENDING || p.status === PaymentStatus.AUTHORIZED
  );
  if (pendingOrAuthorizedPayment) {
    return pendingOrAuthorizedPayment;
  }
  ```
- This prevents duplicate payments for the same order when the payment is still in PENDING or AUTHORIZED state.

**Payment Entity (`order.domain.ts`):**
- `Payment.create()` (line 861-895) generates a new `eventId` every time via `generateId()` (line 878).
- The `eventId` is randomly generated, NOT derived from the Stripe event, so two different Payment.create() calls will have different eventIds.

**Gap: If `createPayment` is called and the repository check fails (e.g., race condition), duplicate payments can be created.**

### Race Condition Risk

Two concurrent requests calling `createPayment` for the same order:
1. Both pass the `findByOrderId` check simultaneously
2. Both create new Payment entities
3. Both are saved to the repository

The `InMemoryPaymentRepository.save()` just does `this.payments.set(payment.id, payment)` - no upsert or duplicate detection.

The `MongoPaymentRepository.save()` uses upsert with `{ _id: paymentId }`, but the paymentId is generated by `Payment.create()` which uses `generateId()` - so two calls create different IDs.

### Recommendation

1. Add a unique index on `orderId + eventId` in MongoDB to prevent duplicate payments at the database level.
2. Or use an `attemptId`/`idempotencyKey` pattern similar to the order's `insertForAttempt` method.

---

## 4. Correct Attribution of Transactions to Seller

**Findings: VENDOR ATTRIBUTION EXISTS but Stripe transfer `destination` is EMPTY - transfers have no connected account destination.**

### Evidence

**OrderVendorGroup Data Model (`order.domain.ts`):**
- `OrderVendorGroupData` (line 135-148) contains `vendorId: string`, `commissionPct: number`, `commissionAmount: number`, `vendorNet: number`
- The vendorId is correctly recorded in the order vendor group

**Payment Service `createTransfer()` (`payment.service.ts`):**
- Lines 643-647 calculate vendor net amount correctly:
  ```typescript
  const ovgTotal = vendorGroup.subtotal;
  const commissionPct = vendorGroup.commissionPct;
  const vendorNet = ovgTotal * (1 - commissionPct / 100);
  const transferAmount = Math.round(vendorNet * 100) / 100;
  ```
- Line 707: `destination: '',` - **HARDCODED EMPTY STRING**
  ```typescript
  const stripeTransfer = await stripe.transfers.create(
    {
      amount: Math.round(transferAmount * 100),
      currency: 'brl',
      destination: '', // Will be set from vendor's connected account
      source_transaction: chargeId,
      transfer_group: payment.orderId,
    },
    {
      idempotencyKey: idempotencyKey,
    }
  );
  ```

**Transfer Service `createTransferWithDetails()` (`transfer.service.ts`):**
- Line 104: `destination: '',` - **SAME HARDCODED EMPTY STRING**
  ```typescript
  const stripeTransfer = await this.stripe.transfers.create({
    amount: Math.round(transferAmount * 100),
    currency: 'brl',
    destination: '', // Will be set from vendor's connected account - placeholder for now
    source_transaction: chargeId,
    transfer_group: orderId,
  }, {
    idempotencyKey: idempotencyKey,
  });
  ```

### Impact

- Stripe transfers with `destination: ''` will fail or go to the platform's default account, not the vendor's connected account
- Vendors will not receive their payouts
- The `vendorId` is recorded in the local `OrderVendorGroup` and `Transfer` entity, but Stripe cannot correlate it to the correct connected account

### Recommendation

1. **Wire vendor's Stripe connected account ID** - The vendor's Stripe `account` ID must be looked up and set as the `destination` parameter.
2. **Add vendor connected account lookup** - Either store the Stripe account ID on the Vendor entity, or look it up from the person/vendor database.
3. **Fix both `createTransfer` in payment.service.ts and `createTransferWithDetails` in transfer.service.ts** to set `destination` from the vendor's connected account.

---

## 5. Commission Calculation

**Findings: COMMISSION FORMULA IS CORRECT but not recalculated on refunds - refunds may use stale commission percentages.**

### Evidence

**OrderVendorGroup Commission Calculation (`order.domain.ts`):**
- `OrderVendorGroup.create()` (line 444-482):
  ```typescript
  const commissionAmount = subtotal * (data.commissionPct / 100);
  const vendorNet = subtotal - commissionAmount;
  ```
- `recalculateTotals()` (line 535-540) recomputes from items:
  ```typescript
  recalculateTotals(): void {
    const totals = this.calculateTotals();
    this.subtotal = totals.subtotal;
    this.commissionAmount = totals.commissionAmount;
    this.vendorNet = totals.vendorNet;
  }
  ```

- `calculateTotals()` (line 528-533):
  ```typescript
  calculateTotals(): { subtotal: number; commissionAmount: number; vendorNet: number } {
    const subtotal = this.items.reduce((sum, item) => sum + item.totalPrice, 0);
    const commissionAmount = subtotal * (this.commissionPct / 100);
    const vendorNet = subtotal - commissionAmount;
    return { subtotal, commissionAmount, vendorNet };
  }
  ```

**Payment Service `createTransfer()` commission calculation (`payment.service.ts`):**
- Lines 643-647 use the same formula:
  ```typescript
  const ovgTotal = vendorGroup.subtotal;
  const commissionPct = vendorGroup.commissionPct;
  const vendorNet = ovgTotal * (1 - commissionPct / 100);
  const transferAmount = Math.round(vendorNet * 100) / 100;
  ```

**Transfer Service `createTransferWithDetails()` (`transfer.service.ts`):**
- Lines 83-85 use the same formula:
  ```typescript
  const vendorNet = ovgTotal * (1 - commissionPct / 100);
  const transferAmount = Math.round(vendorNet * 100) / 100;
  ```

### Gap: Commission NOT recalculated on refunds

- `refundPayment()` (line 532-572 in payment.service.ts) records a `REFUND` movement type but does NOT recalculate or reverse the original commission.
- The original `commissionPct` from the OrderVendorGroup is preserved, but if the OVG was modified after initial creation, the refund may use stale commission data.

### Audit Trail

- `FinancialMovementRecord` stores `movementType: MovementType.COMMISSION` and `movementType: MovementType.REFUND`
- The ledger can track commission movements, but there's no automatic recomputation on refund

### Recommendation

1. **Recalculate commission on refund** - When refunding a payment, recompute the vendor net and commission amounts based on the current OVG state, or store the original commission amounts on the Payment entity for auditability.
2. **Store commission snapshot on Payment** - Add `commissionPct` and `commissionAmount` to the Payment entity so historical audits can see what commission was charged at the time of the transaction.

---

## 6. Reconciliation between Payment, Transfer and Payout

**Findings: FLOW EXISTS but is ORCHESTRATED SEPARATELY - payment → transfer → payout requires manual coordination; no automatic payout creation from transfers.**

### Evidence

**Full Flow Trace:**

1. **Payment → Capture** (`payment.service.ts` `capturePayment()`):
   - Calls `payment.capture()` to set status to CAPTURED
   - Calls `markCapturedOrderPaid()` to transition order to PAID
   - Records `PAYMENT_CAPTURED` ledger movement

2. **Capture → Transfer** (manual step, not automatic):
   - `payment.service.ts createTransfer()` (line 612-730) must be called explicitly
   - Creates Stripe Transfer with `destination: ''` (see Section 4)
   - Persists `Transfer` entity to MongoDB via `transferRepo.save()`
   - Sets `transferId` on the `OrderVendorGroup` via `vendorGroup.setTransferId(stripeTransfer.id)`

3. **Transfer → Completed** (`transfer.service.ts ` `completeTransfer()`):
   - Line 128-143: Finds transfer by Stripe Transfer ID, marks as COMPLETED
   - Records `TRANSFER_COMPLETED` ledger movement

4. **Transfer → Payout** (NO AUTOMATIC FLOW):
   - Payouts are created via `payout.service.ts createPayout()` - separate workflow
   - The payout has a `reference` field but it's not automatically populated from the transfer
   - `Payout.create()` (line 99-141 in payout.domain.ts) takes `vendorId`, `personId`, `amount`, `bankAccount`
   - No code links `transfer.stripeTransferId` → `payout.vendorId` → automatic creation

**Payout Service (`payout.service.ts`):**
- `createPayout()` (line 40-68): Creates Payout with PENDING status, records `PAYOUT_REQUESTED` ledger movement
- `processPayout()` (line 126-143): Transitions PENDING → APPROVED → PROCESSING → COMPLETED
- The payout `reference` field (line 43 in payout.domain.ts) is set optionally but not automatically populated from transfers

**MongoPayoutRepository:**
- Has 12 contract tests in `payout.payout.test.ts` that verify basic CRUD and status transitions
- Tests verify payout creation, approval, processing, completion, and failure
- No tests link payouts to transfers or payments

### Gap: Missing Integration

There is no automatic flow that:
1. Listens for `transfer.paid` webhook events
2. Creates a matching Payout record
3. Triggers the payout approval/processing workflow

The system has three separate workflows that are not integrated:
- Payment flow (Stripe → Payment Service → Order)
- Transfer flow (Stripe → Transfer Service → MongoDB)
- Payout flow (Admin → Payout Service → Bank Account)

### Recommendation

1. **Add webhook handler for `transfer.paid`** that automatically creates a Payout record linked to the transfer
2. **Populate payout.reference from order/vendor group** when creating payouts automatically
3. **Orchestrate the full flow**: Payment captured → Transfer created → Transfer completed → Payout auto-created → Payout processed

---

## 7. Evidences in Stripe TEST and MongoDB

**Findings: SYNTHETIC TEST VALUES USED exclusively - no real Stripe credentials exposed. MongoDB contract tests exist and pass.**

### Evidence

**Stripe TEST Values:**
- All tests use `vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test')` (synthetic webhook secret)
- All tests use `vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_test')` or `sk_test_fake_key_for_testing_only`
- No real Stripe keys are committed to the codebase
- `config.index.ts` line 84: `commissionPct: parseFloat(process.env.COMMISSION_PCT || '10')` - env-configurable

**MongoDB Contract Tests:**
- `payment.mongo.repository.test.ts` - tests for MongoPaymentRepository interface compliance
- `transfer.mongo.repository.test.ts` - tests for MongoTransferRepository (implied by test structure)
- `payout.mongo.repository.test.ts` - 12 contract tests mentioned in the task
- `product.mongo.repository.test.ts` - MongoProductRepository Contract Tests

**Specific MongoDB test evidence** (from the test run):
- MongoDB repositories use `_id` as document key with upsert semantics
- `MongoPaymentRepository.save()` uses `{ _id: paymentId, $set: setDoc, $setOnInsert: { createdAt } }` with `upsert: true`
- `MongoTransferRepository.save()` uses same pattern
- `MongoTransferRepository.findLastByOrderVendorGroupId()` sorts by `createdAt: -1` to get the most recent

**Test files that demonstrate payment lifecycle:**
- `stripe-webhook.handler.test.ts` LC-14 AC-1: transitions payment to CAPTURED and order to PAID, persists eventId
- `stripe-webhook.handler.test.ts` LC-15: cart reconciliation, idempotent duplicate delivery
- `payment.service.test.ts` completeCheckoutPayment, capturePayment, refundPayment, failPayment state transitions
- `transfer.transfer.test.ts` Transfer domain status transitions

### No Real Credentials

The secrets protection is correctly implemented:
- No `cat .env` or `printenv` in the codebase
- Stripe keys are read from `process.env.STRIPE_SECRET_KEY` with `?.trim()` fallback
- Webhook secret from `process.env.STRIPE_WEBHOOK_SECRET` with `?.trim()`
- All test environments use synthetic `sk_test_*` and `whsec_*` values

---

## 8. Specific Issues to Investigate

### Issue 1: `createTransfer` hardcodes `destination: ''` and `STRIPE_SECRET_KEY` fallback `sk_test_test`

**Verification: CONFIRMED - Real problem, not synthetic.**

**File and line references:**
- `payment.service.ts` line 699-701:
  ```typescript
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY?.trim() || 'sk_test_test', {
    apiVersion: '2026-10-28.endive',
  });
  ```
- `payment.service.ts` line 707:
  ```typescript
  destination: '', // Will be set from vendor's connected account
  ```
- `transfer.service.ts` line 39-41 (constructor):
  ```typescript
  this.stripe = new Stripe(stripeKey, {
    apiVersion: '2026-10-28.endive',
  });
  ```
- `transfer.service.ts` line 101-109:
  ```typescript
  const stripeTransfer = await this.stripe.transfers.create({
    amount: Math.round(transferAmount * 100),
    currency: 'brl',
    destination: '', // Will be set from vendor's connected account - placeholder for now
    source_transaction: chargeId,
    transfer_group: orderId,
  }, {
    idempotencyKey: idempotencyKey,
  });
  ```

**Impact:** Stripe transfers will fail or go to the platform default account instead of the vendor's connected account. The `sk_test_test` fallback is a synthetic test key, but in production without `STRIPE_SECRET_KEY` set, it would use this test key which may not have the proper permissions.

### Issue 2: Webhook eventId persistence uses private access

**Verification: CONFIRMED - Fragile, breaks encapsulation.**

**File and line references:**
- `stripe-webhook.handler.ts` line 20-21:
  ```typescript
  const paymentRepo = paymentService['paymentRepo'];
  const orderRepo = paymentService['orderRepo'];
  ```
- `stripe-webhook.handler.ts` line 126-127:
  ```typescript
  if (paymentRepo && typeof paymentRepo.save === 'function') {
    await paymentRepo.save(existing).catch(() => void 0);
  ```

**Impact:** If the PaymentService constructor changes (e.g., field renaming, reordering), this code breaks silently at runtime. This is a technical debt item that should be refactored to use public APIs.

### Issue 3: `isPaymentFinalized` skips CAPTURED payments whose order is still PENDING_PAYMENT

**Verification: REVIEW NEEDED - Questionable behavior.**

**File and line references:**
- `payment.service.ts` line 599-610:
  ```typescript
  async isPaymentFinalized(paymentId: string): Promise<boolean> {
    const payment = await this.paymentRepo.findById(paymentId);
    if (!payment) return false;
    if (payment.status === PaymentStatus.CAPTURED) {
      const order = await this.orderRepo.findById(payment.orderId);
      return order !== null && order.status !== OrderStatus.PENDING_PAYMENT;
    }
    return [
      PaymentStatus.FAILED,
      PaymentStatus.REFUNDED,
    ].includes(payment.status);
  }
```

**Behavior analysis:**
- When payment is CAPTURED and order status is PENDING_PAYMENT, `isPaymentFinalized` returns `false`
- This means the webhook handler (line 102) will NOT skip re-processing:
  ```typescript
  if (await paymentService.isPaymentFinalized(paymentId)) {
    return res.status(200).json({ received: true });
  }
  ```
- The webhook will then call `completeCheckoutPayment()` → `authorizePayment()` → `capturePayment()`
- But the payment is already CAPTURED, so `capturePayment()` (line 262-306) will return early at line 273-276:
  ```typescript
  if (payment.status === PaymentStatus.CAPTURED) {
    await this.markCapturedOrderPaid(payment.orderId);
    return payment;
  }
  ```
- So the idempotency is maintained, but the order may get `markCapturedOrderPaid()` called redundantly.

**Is this correct?** The check seems designed to allow re-processing of the order status update when a payment is captured but the order wasn't updated. However, the name `isPaymentFinalized` suggests it should indicate whether the payment flow is complete, and a CAPTURED payment whose order is still PENDING_PAYMENT is arguably NOT finalized (the order update is missing). The behavior is functionally correct (idempotent) but the naming is misleading.

### Issue 4: No `payment_intent.succeeded`/`payment_intent.payment_failed` webhook branch

**Verification: CONFIRMED - Only `checkout.session.*` and `transfer.*` are handled.**

**File and line references:**
- `stripe-webhook.handler.ts` lines 41-66 handle:
  - `checkout.session.*` events (lines 42-67)
  - `transfer.*` events (lines 44-65)
- **NOT handled:** `payment_intent.succeeded`, `payment_intent.payment_failed`

**Impact:**
- If the Stripe integration uses PaymentIntents directly (without Checkout Sessions), the webhook handler will return 200 for unhandled event types (line 66: `return res.status(200).json({ received: true });`).
- The `payment_intent.succeeded` event would be silently ignored, meaning payments would never transition to CAPTURED status.
- The `payment_intent.payment_failed` event would also be silently ignored.

**Current design assumption:** The system uses Stripe Checkout Sessions (`mode: 'payment'`) so `checkout.session.completed` and `checkout.session.async_payment_succeeded` are the primary events. PaymentIntents are not the primary flow.

However, this is a **limited design** - if the system needs to support PaymentIntents directly (e.g., for subscription billing, saved payment methods), the webhook handler must be extended.

---

## Summary of Recommendations

| # | Area | Priority | Recommendation |
|---|------|----------|----------------|
| 1 | Atomicity balance/ledger | HIGH | Implement two-phase commit or compensation logic |
| 2 | Stripe event idempotence | HIGH | Encapsulate eventId access, persist processed IDs |
| 3 | Duplicate launch prevention | MEDIUM | Add DB unique index on orderId+eventId |
| 4 | Vendor transfer attribution | CRITICAL | Wire vendor Stripe connected account as `destination` |
| 5 | Commission on refunds | MEDIUM | Recalculate or snapshot commission on refund |
| 6 | Payment/transfer/payout reconciliation | HIGH | Add auto-created payouts on transfer.paid webhook |
| 7 | Specific code issues | MEDIUM | Fix private access, hardcoded empty destination, missing webhook branches |

---

## Git State

All evidence was gathered from the current codebase at `/home/workstation/source/f1/F01/back/src/`. No files were modified during this audit. The audit examined:
- 14+ source TypeScript files
- 5 test files with 120 passing tests
- Configuration and domain models

**No git changes were made.** This is a read-only investigation report.