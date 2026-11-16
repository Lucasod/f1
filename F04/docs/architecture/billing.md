# Stripe Billing — Technical Flow

Status: implemented, test mode only. Product prices/limits and downgrade behavior live in [subscription policy](../subscription_plans.md). No provider credentials, objects, account configuration, or charges have been created in source; Stripe test-mode end-to-end acceptance is pending external credentials (BLOCKED_EXTERNAL_CREDENTIALS).

## Local records and boundaries (implemented)

Models implemented in `backend/workspaces/models.py` (migrations `0017`–`0019`):

- **`WorkspaceBilling`** — one-to-one with `Workspace`: `customer_id` (nullable unique), `subscription_id` (nullable unique), `provider_status` nullable, `effective_plan` (`free`/`pro`, default `free`), `cancel_at_period_end` bool, `paid_through` nullable UTC, `last_synced_at` nullable. Tenant-scoped via `django-multitenant` (`tenant_id`). Default Free.
- **`BillingPlan`** — application-owned plan catalog (`free`/`pro`): `plan_id` (unique), `name`, `description`, `stripe_price_id`, `max_memberships`, `max_projects`, `price_cents`, `currency`, `interval`, `is_active`. Seeded by migration `0018` (Free: 5 memberships / 2 projects, 0 cents; Pro: 25 memberships / 20 projects, 1900 cents USD/month).
- **`BillingOperation`** — UUID `id`, `kind` (`checkout`/`cancel`/`portal`), `idempotency_key` (unique per workspace/kind via constraint), `state` (`pending`/`completed`/`failed`/`unknown`), `provider_object_id` nullable, `safe_result` JSON, `created_at`/`updated_at`. Foreign key to `Workspace`.
- **`StripeEventInbox`** — `event_id` unique, `event_type`, `received_at`, `provider_object_id`, `resolved_workspace_id` nullable, `state` (`pending`/`processed`/`failed`), `attempts`, `next_attempt_at` nullable, `error_code`. Tenant-scoped.

The `Workspace` model gained a nullable `deleted_at` timestamp for soft deletion; every tenant endpoint filters `deleted_at__isnull=True`.

Billing service layer (`backend/workspaces/billing_service.py`): `get_or_create_workspace_billing`, `get_effective_plan`, `create_billing_operation`, `record_stripe_event`, `check_project_quota` (serialized per workspace with `select_for_update()`, returns `409 plan_limit_reached` at the Free project limit of 2).

Stripe adapter (`backend/workspaces/stripe_adapter.py`) owns all Stripe SDK calls: `create_customer`, `create_checkout_session`, `cancel_subscription`, `create_portal_session`, `get_subscription`, `construct_webhook_event`. Raises `StripeAdapterError` on provider failure; callers translate to generic API errors without leaking provider internals.

HTTP services handle workspace authorization; a billing service coordinates operations; the Stripe adapter owns SDK calls. Entitlement calculation is a pure rule over verified provider state and configured catalog. This applies SRP/DIP without a generic payment framework.

Pinned Stripe SDK and API version `2025-06-30.basil` (via `STRIPE_API_VERSION` env var). Mock provider responses for automated tests; Stripe test-mode end-to-end evidence separately, pending credentials.

## API

Paths relative to `/api/v1/workspaces/{workspace_id}/`; current membership required, active workspace, CSRF for all browser writes. Owner-only except summary/usage. URLs and price IDs are never client-controlled.

| Method/path | Input | Result |
| --- | --- | --- |
| GET `billing/` | Member, no body | 200 `{plan, subscription_status, cancel_at_period_end, paid_through, sync_pending}`; omit customer/payment details |
| POST `billing/checkout/` | Owner; `{plan: "pro"}`; required Idempotency-Key UUID header | 201 `{operation_id, checkout_url}`; identical retry returns saved result; pending recovery returns 202 operation_id |
| POST `billing/portal/` | Owner; empty object; Idempotency-Key | 201 `{portal_url}`; portal configured for invoices/payment methods, not new subscriptions or plan changes |
| POST `billing/cancel/` | Owner; `{timing: "period_end"}` or `{timing: "immediate"}`; Idempotency-Key | 202 `{operation_id, state: "pending"}`; verified reconciliation updates summary |
| GET `billing/operations/{operation_id}/` | Owner | 200 operation id/kind/state, safe error_code, created_at; no provider secrets |

Unknown inputs return 400; unauthorized roles 403; active/open subscription or checkout returns 409 billing_operation_conflict; reused idempotency key with changed input returns 409 idempotency_conflict. Provider temporary failure after an uncertain outcome returns 202, never invites a new checkout under a new key. Definitive provider rejection marks failed with safe error code. Portal URLs expire; a fresh request needs a fresh key. No hardcoded customer-supplied redirect URLs.

## Checkout

1. Lock workspace, reject deleted workspace or active/pending subscription/checkout, validate Pro catalog, create/reuse BillingOperation and reserve billing transition. This prevents concurrent checkouts and workspace deletion.
2. Outside the transaction, create/retrieve a test Customer for that workspace using a stable provider idempotency key. Set workspace reference in server-owned metadata; never attach one workspace to another customer's supplied ID.
3. Create hosted Checkout Session with mode subscription, one configured monthly Pro price/quantity 1, existing customer, fixed application success/cancel URLs, and subscription/session metadata containing the workspace and operation IDs. No trial, coupons, tax collection, or quantity editing.
4. Persist Session ID/URL/expiry. Use provider idempotency for a network timeout; if the local persistence fails, recover the same provider result rather than create another subscription. Keep the transition reserved while the outcome is unknown.
5. Browser follows Checkout URL. On return it polls billing summary; it cannot activate Pro. A canceled browser redirect alone does not close the session; expire/retrieve the provider session before releasing its reservation. Recovery sweeps pending operations every 60 seconds and respects provider expiry; no fixed local timeout can silently free an unknown active checkout.
6. Stripe webhook triggers verified reconciliation. Confirm customer/workspace ownership, configured price, quantity, and live/test mode before enabling Pro. Clear the pending operation only after authoritative success or terminal expiration/failure. Unexpected multiple active subscriptions are flagged for operator reconciliation, not silently attached or canceled.

Hosted subscription Checkout follows the [official subscription integration](https://docs.stripe.com/payments/checkout/build-subscriptions). The idempotency, tenant locking, and recovery protocol above is application design.

## Incoming Stripe webhook

Public machine endpoint: `POST /api/v1/integrations/stripe/webhook/`. This endpoint alone is exempt from browser session/CSRF authentication; authenticate using Stripe-Signature against the configured webhook secret and exact raw body. Bound request size to 1 MiB; invalid signature/payload/mode returns 400 and stores no processed event.

Subscribe to checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed, checkout.session.expired, customer.subscription.created/updated/deleted, invoice.paid, and invoice.payment_failed. The invoice events initiate subscription reconciliation; do not grant entitlement merely because a payment object succeeded.

- Validate signature using SDK verification and its timestamp tolerance, persist inbox uniquely, then return 200 quickly. Duplicate known event returns 200. If persistence fails return 503 so Stripe can retry. Valid unknown/unsubscribed event is acknowledged 200 and ignored safely.
- Queue processing after commit with durable inbox recovery. Resolve customer/subscription to a server-created mapping; metadata is a consistency check, not authority to overwrite an arbitrary workspace mapping.
- Events can arrive out of order. Retrieve the current subscription/customer/session as relevant before applying state. Serialize reconciliation per workspace with a reclaimable lease and provider snapshot fetch after lease acquisition; avoid holding a DB transaction during HTTP. A lost lease may not commit results. Apply inbox completion and new entitlement/audit atomically.
- Pro requires active subscription, configured price/quantity, correct test customer mapping, and a nondeleted workspace. All other subscription states use Free under the documented strict demo policy. Persist period-end scheduling and derive paid_through from the selected subscription item's billing period using the pinned API version.
- Periodic reconciliation every 15 minutes repairs missed events and processes expired operations in bounded batches. Provider unavailability preserves the last verified state, marks sync_pending, and does not invent a downgrade. Once a known paid period expires without successful refresh, entitlement falls back to Free until verified; document this conservative demo rule in UI.
- Deleted workspace events update only internal reconciliation/history and never restore tenant access. Terminal failures are visible for operator retry using the same event ID.

Signature verification, duplicate handling, and non-ordered delivery follow [Stripe's webhook guidance](https://docs.stripe.com/webhooks). Our application retry policy is defined in [background jobs](background_jobs.md); it is distinct from Stripe's own delivery retry schedule.

## Cancellation and payment management

Portal sessions are scoped to the workspace Customer, with fixed return URL. Configure the portal for viewing invoices and updating payment methods. Application cancellation stays in the dedicated endpoint so timing and deletion gates have one explicit contract.

- Owner chooses period-end (default UI choice) or immediate cancellation with explicit confirmation. Serialize/reserve the operation against checkout/deletion; use provider idempotency where supported and retrieve current state before repeating an uncertain cancel.
- Period-end updates cancel_at_period_end=true. Preserve Pro only while verified active and within the paid period. At actual cancellation, reconcile to Free and retain existing over-limit data. Repeat with the same key returns the same operation; a later cancel on an already canceled subscription is a verified no-op.
- Immediate cancellation calls the subscription cancel operation with no prorated refund or final invoice generation for the fixed-price test demo. Clearly display that access limits switch to Free after confirmation and no refund is issued. Real payment/refund policies are outside this test-mode product.
- Reconcile the provider response/webhook before declaring completion. Provider/network failure must not falsely mark canceled or allow workspace deletion. The API returns pending while uncertain; the owner sees sync status and can retry the same operation.
- Canceling Free with no paid subscription is a no-op completed operation. Do not confuse incomplete checkout expiration with subscription cancellation; close both pending session and subscription state before unlocking deletion.
- No resume endpoint in MVP. An owner can start a new checkout only after the prior subscription is canceled and all pending operations are resolved.

Stripe supports both immediate and period-end cancellation; see [official cancellation documentation](https://docs.stripe.com/billing/subscriptions/cancel). The demo's refund and UI decisions above are our selected scope.

## Missing credentials behavior

`STRIPE_CONFIGURED = bool(STRIPE_API_KEY and STRIPE_WEBHOOK_SECRET and STRIPE_PRO_PRICE_ID)`; all three are read from environment variables and no secret values appear in source.

When `STRIPE_CONFIGURED` is false (local/test default, credentials not yet available):
- `POST billing/checkout/` → `400 validation_error` ("Stripe is not configured."); no checkout session is created.
- `POST /api/v1/integrations/stripe/webhook/` → `503 Service Unavailable`; no event is processed.
- Stripe test-mode end-to-end acceptance is BLOCKED_EXTERNAL_CREDENTIALS pending provisioned test credentials.

When configured, the webhook verifies `Stripe-Signature` against `STRIPE_WEBHOOK_SECRET` and the exact raw body via `stripe.Webhook.construct_event(..., tolerance=300)`, bounds request size to 1 MiB, returns `400` on invalid signature/payload, returns `503` if persistence fails, deduplicates by `event_id` (`200` for already-processed), and queues processing after commit.

## Acceptance tests

| ID | Required scenario |
| --- | --- |
| BILL-01 | Authorized checkout uses server price/customer/URLs; nonowners and cross-tenant IDs cannot create or inspect operations |
| BILL-02 | Concurrent checkout/deletion and uncertain network outcomes never free a reservation or duplicate a paid subscription |
| BILL-03 | Browser redirect, invalid signature, live event, wrong customer, wrong price, and mismatched metadata cannot grant Pro |
| BILL-04 | Duplicate and out-of-order events reconcile current state once, with an atomic entitlement/audit change |
| BILL-05 | Period-end and immediate cancellation preserve/downgrade correctly; failure leaves billing unresolved and deletion blocked |
| BILL-06 | Missed events and expired sessions recover; stale leases cannot overwrite fresh verified state; provider outages follow the known-period rule |
| BILL-07 | Over-limit downgrade preserves records and blocks only quota increases; recovery to active Pro restores capacity |
| BILL-08 | Portal ownership, expired links, idempotency conflicts, no-op cancellations, deleted tenant events, and secret redaction are covered |

Run unit/integration tests with mocked HTTP first, then record real Stripe test-mode checkout/cancel evidence with synthetic accounts. No live mode is enabled by this plan.
