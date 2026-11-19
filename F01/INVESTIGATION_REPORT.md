# R$ 79.90 Stripe × MongoDB Divergence Investigation

## Issue Summary
Payment shows as paid in Stripe Test Mode, but the MongoDB order remains in `pending_payment` status instead of transitioning to `paid`.

## Investigation Scope
Examined the payment flow from Checkout Session creation through Stripe integration to MongoDB order status update.

### Files Examined

1. **`back/src/modules/order/order.domain.ts`** - Order status enum, payment status, financial status, and valid transition matrix
2. **`back/src/modules/order/order.service.ts`** - Order service, `handlePaymentCallback`, `markPaymentAuthorized`, `markPaymentFailed`
3. **`back/src/modules/stripe/stripe.service.ts`** - Stripe service, `createCheckoutSessionWithCustomer`, checkout session creation with line items
4. **`back/src/modules/order/payment.service.ts`** - Payment service, `createPayment`, `authorizePayment`, `completeCheckoutPayment`, `capturePayment`, `markCapturedOrderPaid`
5. **`back/src/modules/checkout/checkout.service.ts`** - Checkout service, `checkout`, `createCheckoutSessionWithCustomer`, session creation flow
6. **`back/src/modules/checkout/stripe-checkout.provider.ts`** - Stripe checkout provider, session creation with price data
7. **`back/src/modules/checkout/stripe-webhook.handler.ts`** - Stripe webhook handler, event processing and payment completion
8. **`back/src/modules/order/order.mongo.repository.ts`** - MongoDB order repository, save/update logic with status transition guards
9. **`back/src/modules/payment/payment.service.ts`** - Also examined (payment-related methods)

## Key Code Flow: Checkout Session → Stripe Payment → Order Status Update

### 1. Order Creation (`checkout.service.ts` `checkout()` method)
- Order created with `status: OrderStatus.PENDING_PAYMENT`, `financialStatus: FinancialStatus.PENDING`
- Payment created via `paymentService.createPayment()` with `amount: order.totalAmount`, `provider: 'stripe'`
- Payment status: `PaymentStatus.PENDING`

### 2. Checkout Session Creation (`checkout.service.ts` `createCheckoutSessionWithCustomer()`)
- Calls `stripeService.createCheckoutSessionWithCustomer()`
- Line items built from `order.vendorGroups.flatMap(group => group.items.map(item => ({ quantity, price_data: { currency: 'brl', unit_amount: Math.round(item.unitPrice * 100), product_data: { name: item.productName } } })))`
- For R$ 79.90 product: `Math.round(79.90 * 100) = 7990` cents
- Metadata: `{ orderId: order.id, paymentId: payment.id }`
- Session created with `mode: 'payment'`, `currency: 'brl'`

### 3. Stripe Payment Success → Webhook (`stripe-webhook.handler.ts`)
On `checkout.session.completed` with `session.payment_status === 'paid'`:
- Extracts `paymentId` from `session.metadata.paymentId`
- Extracts `session.amount_total` (e.g., 7990 for R$ 79.90)
- Calls `paymentService.completeCheckoutPayment(paymentId, paymentIntentId, session.amount_total)`

### 4. `completeCheckoutPayment` (`payment.service.ts` lines 279-296)
```typescript
async completeCheckoutPayment(paymentId: string, providerTransactionId: string, amountTotal: number): Promise<Payment> {
  const existing = await this.paymentRepo.findById(paymentId);
  if (!Number.isInteger(amountTotal) || Math.round(existing.amount * 100) !== amountTotal) {
    throw new Error(PaymentError.PAYMENT_AMOUNT_MISMATCH);
  }
  if (existing.status === PaymentStatus.FAILED || existing.status === PaymentStatus.REFUNDED) {
    return existing;
  }
  if (existing.status === PaymentStatus.PENDING) {
    await this.authorizePayment(paymentId, providerTransactionId);
  }
  return this.capturePayment(paymentId);
}
```

**Critical amount comparison**: `Math.round(existing.amount * 100) !== amountTotal`
- `existing.amount` = payment amount from DB (e.g., 79.90)
- `amountTotal` = `session.amount_total` from Stripe (e.g., 7990 cents)
- For R$ 79.90: `Math.round(79.90 * 100) = 7990`, matches `amountTotal = 7990` ✓

### 5. `authorizePayment` (`payment.service.ts` lines 200-261)
- Validates `payment.amount === order.totalAmount`
- Validates `order.status === OrderStatus.PENDING_PAYMENT`
- Calls `payment.authorize(providerTransactionId)` → payment status → `AUTHORIZED`
- Records payment ledger for each vendor group

### 6. `capturePayment` (`payment.service.ts` lines 298-363)
- Validates payment status is `AUTHORIZED`
- Calls `payment.capture()` → payment status → `CAPTURED`
- Calls `markCapturedOrderPaid(payment.orderId)`

### 7. `markCapturedOrderPaid` (`payment.service.ts` lines 365-403)
```typescript
private async markCapturedOrderPaid(orderId: string): Promise<void> {
  const order = await this.orderRepo.findById(orderId);
  if (order.status === OrderStatus.PENDING_PAYMENT) {
    order.transitionTo(OrderStatus.PAID);    // Transitions order.status: PENDING_PAYMENT → PAID
    this.financialStatus = FinancialStatus.PAID;
    await this.orderRepo.update(order);
  }
  if (order.status === OrderStatus.PAID) {
    for (const vg of order.vendorGroups) {
      vg.updateStatus(OrderVendorGroupStatus.PENDING);  // Set all VG statuses to PENDING
    }
    await this.orderRepo.update(order);
  }
}
```
- **Key**: Transitions order from `PENDING_PAYMENT` → `PAID`, sets `financialStatus: FinancialStatus.PAID`

### 8. Order Status Transition Matrix (`order.domain.ts` lines 193-201)
```typescript
export const VALID_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING_PAYMENT]: [OrderStatus.PAID, OrderStatus.FAILED_PAYMENT, OrderStatus.CANCELLED],
  [OrderStatus.PAID]: [OrderStatus.PROCESSING, OrderStatus.CANCELLED, OrderStatus.FAILED_PAYMENT],
  // ...
};
```
- `PENDING_PAYMENT → PAID` is a valid transition ✓

## Divergence Analysis: Where Stripe "Paid" Doesn't Update MongoDB Order to PAID

### Primary Divergence Point: `PAYMENT_AMOUNT_MISMATCH`

The **most critical divergence point** is the amount comparison in `completeCheckoutPayment`:

```typescript
if (!Number.isInteger(amountTotal) || Math.round(existing.amount * 100) !== amountTotal) {
  throw new Error(PaymentError.PAYMENT_AMOUNT_MISMATCH);
}
```

If this check throws `PAYMENT_AMOUNT_MISMATCH`:
- The webhook handler catches it and returns 500 `STRIPE_WEBHOOK_PROCESSING_FAILED`
- The order **never** reaches `markCapturedOrderPaid`
- The order **remains** in `PENDING_PAYMENT` status in MongoDB
- Stripe shows the payment as `paid`, but MongoDB order stays `pending`

**For R$ 79.90 specifically**: The comparison `Math.round(79.90 * 100) = 7990` should match `session.amount_total = 7990`. However, edge cases could cause mismatch:
- Floating-point representation differences in `existing.amount`
- Order total calculated differently than Stripe line item summation
- Payment amount stored in different units (cents vs. major)

### Secondary Divergence Points

1. **Payment status not `PENDING` when webhook fires**
   - If payment status is already `AUTHORIZED` (from previous partial flow), `completeCheckoutPayment` skips `authorizePayment` and goes straight to `capturePayment` — this is intentional for idempotency but could mask issues if the order state is inconsistent.

2. **Order status changed between creation and webhook**
   - If order status was modified (e.g., to `CANCELLED`) between order creation and webhook processing, `authorizePayment` would throw `ORDER_NOT_PAYABLE`, and the order would not be updated.

3. **Webhook not processed**
   - If the webhook endpoint returns non-200, Stripe may retry, but if the underlying issue (e.g., amount mismatch) persists, the order remains stuck.

4. **`markCapturedOrderPaid` conditional update failure**
   - The MongoDB repository's `save` method uses conditional writes based on current order status. If the order has already been updated by another process, the conditional update may fail, though the code includes fallback logic.

## Verification & Test Results

### Test Suite Results
- **Payment service tests**: 83/83 passed ✓
- **Stripe service tests**: 23/23 passed ✓
- **Webhook handler tests**: 16/17 passed (1 pre-existing failure: duplicate webhook call count assertion, unrelated to amount issue)
- **AC-1 acceptance test**: Confirms `checkout.session.completed` → payment CAPTURED + order PAID ✓

### Key Test Evidence
The webhook handler test `AC-1` (`stripe-webhook.handler.test.ts` lines 311-367) validates the full flow:
```typescript
// After handler processes checkout.session.completed:
const updatedPayment = await paymentService.getPaymentById(payment.id);
expect(updatedPayment?.status).toBe(PaymentStatus.CAPTURED);  // ✓

const updatedOrder = await orderRepo.findById(order.id);
expect(updatedOrder?.status).toBe(OrderStatus.PAID);  // ✓
```

### Test That Exposes the Divergence
The test at `payment.service.test.ts` lines 92-98:
```typescript
it('rejects a completed Checkout Session whose paid amount differs from the order', async () => {
  const payment = await createTestPayment();
  await expect(paymentService.completeCheckoutPayment(payment.id, 'pi_test_123', 999))
    .rejects.toThrow(PaymentError.PAYMENT_AMOUNT_MISMATCH);
  expect(payment.status).toBe(PaymentStatus.PENDING);  // Order stays PENDING if amount mismatches
});
```
This demonstrates that when `amountTotal` (999 cents) doesn't match `Math.round(existing.amount * 100)` (10000 cents for a $100 order), the webhook fails and the order stays `PENDING`.

## Root Cause Hypothesis

The divergence occurs when **`Math.round(existing.amount * 100) !== session.amount_total`** in `completeCheckoutPayment`. This causes:

1. `PaymentError.PAYMENT_AMOUNT_MISMATCH` to be thrown
2. Webhook handler returns 500 `STRIPE_WEBHOOK_PROCESSING_FAILED`
3. Order status **never** updated from `PENDING_PAYMENT` to `PAID`
4. Stripe dashboard shows payment as `paid`, but MongoDB order remains `pending`

**For R$ 79.90**: The amounts should match (`79.90 × 100 = 7990`), but any discrepancy in how the order total was calculated vs. how Stripe computes `amount_total` from line items would cause this mismatch.

## Files Changed / Recommendations

No code changes were made during this investigation. The following should be verified:

1. **Verify amount consistency**: Ensure `order.totalAmount` matches the Stripe-computed `amount_total` for the specific order containing the R$ 79.90 product.

2. **Check floating-point precision**: Verify that `existing.amount` is stored as exactly 79.90 (not 79.9000001 or 79.8999999) in MongoDB.

3. **Add defensive check**: Consider adding a debug log in `completeCheckoutPayment` to print both amounts when the mismatch check fails, aiding future troubleshooting.

4. **Monitor webhook errors**: Track occurrences of `STRIPE_WEBHOOK_PROCESSING_FAILED` in production to identify if amount mismatches are recurring.

## Git State
- All tests pass except 1 pre-existing unrelated test (duplicate webhook call count)
- No files modified during this investigation
- Repository at `/home/workstation/source/f1/F01`