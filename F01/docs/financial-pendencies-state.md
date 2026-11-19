# Financial Pendencies State — FS-01 Marketplace

State of financial pendencies as identified during the MP-FS01-RESUME-SECURITY-AND-AGENT-GOVERNANCE mission (2026-11-10). All items are documented within the authorized P4 scope; P5 phase items require explicit human authorization per MAX_AUTHORIZED_PHASE = 4.

---

## CR-001: Destination '' in Stripe Transfers

### Description

Stripe transfer destinations are appearing with empty `destination` field (`''`) in transfer records. This occurs during payout disbursement to vendor accounts.

### Code Logic

The transfer logic is conditional on `vendor.stripeAccountId`:

- When `vendor.stripeAccountId` is present → transfer uses the vendor's connected Stripe account as the destination
- When `vendor.stripeAccountId` is empty/missing → transfer proceeds with `destination: ''`, which requires human setup to assign the correct connected account

### Data Requirements

- This condition requires human setup to ensure vendor Stripe accounts are properly configured before payouts
- An empty destination is an unsafe failure path: the current service can persist a pending transfer and attempt a provider request without a valid destination. Static inspection alone does not prove the provider response.
- No automatic fallback exists; each case must be evaluated for whether the vendor should have a connected account

**Status (2026-11-18):** Partially mitigated — new transfer attempts reject a missing destination before persistence or provider calls. Recovery of previously pending records, provider failures and Connect setup remain open; see the current run record.

---

## CR-002: Absência de Atomicidade entre Wallet e Ledger

### Description

There is no atomicity guarantee between the wallet ledger and the financial ledger. This means a transaction could be recorded in one ledger but not the other, leading to inconsistent state.

### Documentation

This issue is documented in `financial-audit-report.md` with full details on the inconsistency mechanisms, edge cases, and recommended mitigation steps.

### Impact

- Balance discrepancies between wallet and ledger
- Potential double-spending or missed transactions
- Difficulty reconciling statements

**Status:** Documented in financial-audit-report.md — no code fix in P4 scope; requires P5 infrastructure changes for atomic transaction handling.

---

## CR-003: Idempotência Stripe Baseada em Memória e Acesso Frágil a Membros Privados

### Description

Stripe idempotency is currently based on in-memory state with fragile access to private members. This means:

- Idempotency keys are stored in memory only, not persisted
- Access to Stripe idempotency state relies on private member access that could break with refactoring
- Loss of idempotency state on server restart could cause duplicate charges

### Documentation

This issue is documented with recommendations for persistent idempotency key storage and improved access patterns.

### Risk

- Without persistent idempotency, retrying failed charges may not be properly deduplicated
- Fragile private member access increases technical debt and risk of subtle bugs

**Status:** Documented — P4 scope limits changes; persistent idempotency storage requires P5 infrastructure work.

---

## Authorization and Scope Notes

- All three CR-001, CR-002, CR-003 items are documented within the P4 knowledge base
- No code changes are performed for these items within the current P4 authorization (MAX_AUTHORIZED_PHASE = 4)
- P5 phase advancement (MAX_AUTHORIZED_PHASE → 5) is required for any code-level fixes or infrastructure changes
- These items are tracked for future work and do not block current P4 delivery

---

## Summary

| Code | Issue | Scope | Action |
|------|-------|-------|--------|
| CR-001 | Empty destination in Stripe transfers | P4: code logic conditional on vendor.stripeAccountId; data requires human setup | Await human configuration |
| CR-002 | No atomicity between wallet and ledger | P5: documented in financial-audit-report.md | P5 infrastructure needed |
| CR-003 | Stripe idempotência baseada em memória | P5: documented; fragile private member access | P5 infrastructure needed |

No real credential values are included in this document. All Stripe-related references are code-logic descriptions, not live credentials.