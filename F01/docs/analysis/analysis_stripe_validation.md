# Stripe Connect Test Mode Validation Analysis — CD-064/CD-065

## Context

**Confirmed Decisions (CD-064, CD-065):**
- Payment provider: Stripe Connect using **Separate Charges and Transfers**
- Single Charge on platform account per Order (amount = order_total, currency = BRL, capture = true)
- One Transfer per Order_Vendor_Group to vendor's connected account
- Commission: `vendor_net = ovg_total × (1 - commission_pct/100)`
- Refunds: Charge Refund + manual Transfer reversal per affected vendor
- Fulfillment trigger: Vendor confirmation (NOT Transfer completion)

**Dependencies:**
- CD-045: Commission from global percentage
- CD-048: Refund policy
- CD-058: Financial status (derived from refunds + transfer reversals)
- CD-063: State machines

**Documentation Sources:**
- https://docs.stripe.com/connect/separate-charges-and-transfers
- https://docs.stripe.com/connect/separate-charges-and-transfers?platform=web&integration=custom&ui=elements&api-integration=paymentintents
- https://docs.stripe.com/risk

---

## Validation Categories

### A. Confirmed Rules (Documented, No Test Required)

| Rule | Documented In | Verification Method |
|------|---------------|---------------------|
| Separate Charges and Transfers is supported in Brazil | Stripe docs: "Stripe supports separate charges and transfers in the following regions: ... BR" | ✅ Documented |
| Platform balance debited for Stripe fees | Stripe docs: "Your account balance is debited for the cost of the Stripe fees" | ✅ Documented |
| No auto-reversal on failed charge | Stripe docs: "If a transfer and the payment subsequently fails, your platform's balance is debited... you must then manually reverse the transfer" | ✅ Documented |
| Idempotency keys supported | Stripe API: Standard idempotency key support | ✅ Documented |
| Async payments require wait for charge.succeeded | Stripe docs: "For asynchronous payment methods... wait for a charge.succeeded event before creating a transfer" | ✅ Documented |

**Status: All core flow mechanics confirmed via documentation.**

---

### B. Behaviors That Need Test Mode Validation

#### B.1. Commission Calculation Accuracy
**What to validate:** Verify that `vendor_net = ovg_total × (1 - commission_pct/100)` calculates correctly with Stripe's fee deduction.

**Test Steps:**
1. Enable test mode in Stripe Dashboard
2. Create a connected account (Express or Custom)
3. Create a test payment with amount = 100 BRL
4. Create Transfer with amount = calculated `vendor_net`
5. Verify platform retains commission + Stripe fees
6. Verify vendor receives `vendor_net` after Stripe fee deduction

**Reference:** Stripe docs show fee structure:
- Payment processing fee (on Charge)
- Transfer fee (0.25% if "You handle pricing")

**Status: PENDING test execution** — requires Stripe test account.

---

#### B.2. Webhook Event Sequence
**What to validate:** Confirm correct event sequence for `charge.succeeded` → Transfer creation → `transfer.paid`.

**Test Steps:**
1. Set up webhook endpoint in test mode
2. Create test PaymentIntent
3. Complete test payment (card 4242424242424242)
4. Log events: `payment_intent.succeeded`, `charge.succeeded`
5. Create Transfer with `source_transaction = charge_id`
6. Log: `transfer.created`, `transfer.paid`
7. Verify timing: Transfer only processes after charge availability

**Reference:** Stripe docs confirm:
- "With a `source_transaction`, the transfer request automatically succeeds... we don't execute the transfer until the funds from that charge are available"
- Webhook events are reliable for state synchronization

**Status: PENDING test execution** — requires test webhook endpoint.

---

#### B.3. Transfer Reversal on Refund
**What to validate:** Manual Transfer reversal correctly returns funds after charge refund.

**Test Steps:**
1. Complete test payment and Transfer
2. Issue Refund via API
3. Manually reverse Transfer
4. Verify platform balance reflects correct commission adjustment

**Reference:** Stripe docs state: "After a charge is refunded... you should reverse the associated transfer". **Stripe webhook `payment_intent.succeeded`** is the key event for triggering Transfer creation (not just `charge.succeeded`).

**Status: PENDING test execution** — requires test refund workflow.

---

#### B.4. Multiple Transfers per Charge (Partial Recovery)
**What to validate:** Sum of transfers ≤ charge amount; platform balance covers Stripe fees; `transfer_group` correlation.

**Test Steps:**
1. Create charge = 100 BRL
2. Create Transfer 1 = 30 BRL with `transfer_group = ORDER_123`
3. Create Transfer 2 = 40 BRL with same `transfer_group`
4. Verify platform balance = 30 BRL (commission) - (Stripe fees)
5. Attempt Transfer 3 = 35 BRL → should fail (exceeds available)
6. Verify `transfer_group` correctly groups related transfers

**Reference:** Stripe docs: "You can create multiple transfers with the same `source_transaction`, as long as the sum of the transfers doesn't exceed the source charge"** and "`transfer_group` to the transfer"**

**Status: PENDING test execution** — requires test transfers.

---

#### B.5. Idempotency Keys
**What to validate:** Duplicate PaymentIntent creation with same idempotency key prevented.

**Test Steps:**
1. Create PaymentIntent with idempotency key `test_ord_123`
2. Verify creation succeeds
3. Attempt second creation with same key
4. Verify second call returns existing PaymentIntent (no duplicate)

**Reference:** Stripe API supports idempotency keys on all write operations.

**Status: PENDING test execution** — requires test API calls.

---

### C. Provider-Documented Behaviors (Trusted, No Test Required)

| Feature | Documented Behavior | Source |
|---------|---------------------|--------|
| Transfer availability | "By default, a transfer request fails when the amount exceeds the platform's available account balance" | Stripe docs |
| source_transaction availability | "The transfer takes on the pending status of the associated charge" | Stripe docs |
| Currency support | "For Transfers involving Brazil, the `source_transaction` parameter is mandatory" | Stripe docs |
| Webhook reliability | "Listen for these events rather than waiting on a callback from the client" | Stripe docs |

**Status: ✅ Documented and confirmed.**

---

### D. Requires Live/Production Access (Cannot Test Locally)

| Feature | Reason Cannot Test | Required For |
|---------|-------------------|--------------|
| Real card payments (not test cards) | Stripe test mode prevents actual fund movement | Live validation |
| Actual bank account payouts | Payouts only work with real external accounts | Vendor onboarding flow |
| KYC completion | Test mode bypasses KYC | Production deployment |
| Real Commission amounts | Test mode shows fee structure but not real P&L | Financial reporting |

**Status: ⚠️ Cannot validate without production credentials.**

---

## Stripe Test Mode Features Available

### Test Cards (from Stripe docs)
| Card | Scenario |
|------|----------|
| 4242424242424242 | Success (no authentication) |
| 4000002500003155 | Requires SCA authentication |
| 4000000000009995 | Declined (insufficient_funds) |
| 6205500000000000004 | UnionPay variable length |

### Webhook Testing
- Stripe Dashboard → Developers → Webhooks → Test events
- Send test events to simulate `charge.succeeded`, `transfer.paid`, etc.

---

## Recommendations for Test Validation

### Immediate Actions (When Test Credentials Available)
1. **Set up Stripe test account** with:
   - Platform account (seed card verification)
   - At least 1 connected account (Express dashboard)
   - Webhook endpoint URL configured

2. **Create validation test script** covering:
   - PaymentIntent creation with idempotency key
   - Charge → Transfer → Refund → Transfer reversal flow
   - Multiple transfers scenario
   - Webhook event handling

3. **Document test results** in a new MP entry when executed.

### Items That Cannot Be Validated Without Production Access
- Real bank account payouts
- Actual commission calculations with real stripe fees
- KYC flow completion
- Cross-border transfer behavior

---

## Traceability

| Document | Reference |
|----------|-----------|
| CD-064 | Payment Provider — Stripe Connect (Separate Charges and Transfers) |
| CD-065 | Payment and Vendor Distribution Flow — Separate Charges and Transfers |
| CD-045 | Commission — Global Percentage |
| CD-048 | Refund Policy and Financial Adjustments |
| CD-058 | Order Aggregate Financial Status |
| Q-011 | Payment Provider Selection (PARTIALLY_RESOLVED) |
| Q-012 | Split Payment Flow Design (PARTIALLY_RESOLVED) |
| FR-PAY-001..004 | Payment integration requirements |
| FR-REFUND-001..003 | Refund requirements |
| FR-WALLET-001 | Wallet/Transaction requirements |

---

## Conclusion

**CD-064 and CD-065 are confirmed decisions.** The flow mechanics are documented and align with Stripe's official documentation.

**Test mode validation items:**
- Commission accuracy: PENDING (requires test account)
- Webhook sequence: PENDING (requires webhook endpoint)
- Transfer reversal: PENDING (requires test refund workflow)
- Idempotency: PENDING (requires test API calls)

**Cannot validate without production credentials:**
- Real bank payouts
- Actual commission calculations
- KYC flow

**Next steps:**
1. Obtain Stripe test account credentials
2. Set up test connected accounts
3. Execute validation test script
4. Document results in MP-08 or new MP entry