# Background Jobs, Events, and Outgoing Webhooks

Status: planned MVP contract. Follow the [domain API](../api/domain.md) and [tenant rules](../workspace_rules.md). PostgreSQL is authoritative; Redis is a Celery broker, not the only record of pending work.

## Transactional publication

Business services write audit and a durable DomainEvent in the same transaction as the change. A small outbox dispatcher queues committed events using Celery; an on-commit enqueue is a latency optimization, not the only delivery mechanism. A periodic scan recovers committed events not queued after a broker outage. This outbox is justified by the explicit notification/webhook reliability requirement; do not add an event-bus framework.

DomainEvent: UUID id, workspace_id FK, event_type, schema_version=1, actor_id nullable, aggregate_type/id, occurred_at, request_id, allowlisted payload JSON, dispatched_at nullable. Index pending dispatch by created time. Store only scalar IDs/changes, no file bytes, credentials, comment bodies, or issue descriptions. Use a unique event ID throughout retries.

| Event | Payload data | Consumers |
| --- | --- | --- |
| issue.created | issue_id, project_id, board_id, issue_key, status_id, assignee_id nullable | Assignee notification, outgoing webhooks |
| issue.status_changed | issue_id, project_id, board_id, issue_key, from_status_id, to_status_id | Assignee notification, outgoing webhooks |
| report.requested | report_id, requested_by_id, project_id nullable | Report generator only |
| attachment.cleanup_requested | attachment_id | Private object cleanup only |

Assignment-only edits do not emit notifications in the MVP. Notify the issue's current active assignee if still a workspace member and different from the actor; skip when null/ineligible. Internal notifications, no email/push. Webhook and notification creation is unique per event/destination or event/recipient. No events for failed mutations or no-ops.

## Job contracts

JSON-only task arguments: `workspace_id`, `record_id` (event, delivery, report, or attachment), `request_id`. Workers load the authoritative record under validated tenant context, recheck deleted/archived/access state as appropriate, and clear context in finally. Do not serialize ORM instances, secrets, or arbitrary callables. Deleted workspaces skip notifications/reports/outgoing deliveries; dedicated orphan cleanup never purges retained soft-deleted workspace files.

| Task | Result and idempotency | Limits/retry policy |
| --- | --- | --- |
| dispatch_outbox | Create unique delivery/notification records; queue pending work; mark event dispatched only after fan-out records are durable | Scan every 60 seconds, batches of 100; failed scan retries next tick; 30s soft/45s hard task limit |
| create_notification | Notification: id, workspace_id, recipient_id, event_id, issue_id, read_at nullable, created_at; unique event/recipient | 1 initial + 3 retries at 10s/30s/120s for transient DB/broker errors; 30s/45s |
| generate_report | Save one report result per request; late duplicate sees completed state and exits | 1 initial + 3 retries at 10s/30s/120s for transient errors; 120s/150s |
| deliver_webhook | Stable delivery ID and payload, durable attempt history, per-delivery lease to prevent concurrent sends | 1 initial + 4 retries after 60s/300s/1,800s/7,200s; 30s/45s |
| cleanup_attachment | Delete private object if explicitly deleted/failed/orphaned; missing object counts as success | 1 initial + 4 retries at 60s/300s/1,800s/7,200s; 60s/90s |
| reconcile_stripe_event | Reconcile current provider state; event-specific processing record and per-workspace billing coordination | 1 initial + 4 retries at 10s/60s/300s/1,800s; 60s/90s |

> **Nota de implementação:** Destas seis tarefas documentadas, cinco estão implementadas em `backend/workspaces/tasks.py`: `process_stripe_event` (processa eventos Stripe, substituindo conceptualmente `reconcile_stripe_event`), `generate_notification` (implementa `create_notification`), `generate_report`, `deliver_webhook` e `ping_task`. As tarefas `dispatch_outbox` e `cleanup_attachment` estão planejadas mas não implementadas como tarefas Celery nesta entrega. O `process_stripe_event` lida com processamento de eventos Stripe via webhook inbox em vez de uma tarefa separada de reconciliação.

Delays may include up to 10% positive jitter; attempt counters are durable and bounded. Retry transient network errors, timeouts, rate limits, deadlocks after transaction rollback, and provider 5xx. Do not retry invalid input, denied access, deleted tenant, or permanent provider 4xx. Stripe 429 uses Retry-After bounded to one hour. Mark terminal failures with safe error codes and expose to authorized operators; never retry forever.

Use late acknowledgment only for idempotent tasks. Queue redelivery is possible; task acknowledgment is not an exactly-once guarantee. Use row leases with expiry to reclaim abandoned processing, and a 60-second recovery scan for pending/expired work. A worker crash after an external delivery may cause duplicate delivery; recipients must deduplicate by delivery ID. PostgreSQL uniqueness prevents duplicate internal effects. Use one Celery worker and one separate Beat process initially; do not run multiple Beat schedulers.

These choices follow Celery's guidance on [idempotency, acknowledgment, and I/O timeouts](https://docs.celeryq.dev/en/stable/userguide/tasks.html). Application retry counts above are project decisions.

## Notifications and reports API

All paths relative to `/api/v1/workspaces/{workspace_id}/`, active member and CSRF for writes. Follow existing pagination/error conventions.

- GET `notifications/`: own notifications only, page ordered newest first; fields id, event_type, issue_id, issue_key, read_at, created_at. Filter unread=true/false. Do not expose other recipients.
- POST `notifications/{id}/read/`: own notification, empty input; 200 representation; repeat is no-op. Another recipient's ID is 404.
- POST `reports/`: `{ "type": "issue_counts", "project_id": 2 }`, project_id optional; 202 `{id, state: "pending", created_at}` plus Location. One pending/running report per requesting user/workspace returns existing request rather than multiplying jobs. Limit to 5 requests/minute per user/workspace.
- GET `reports/{id}/`: requester only (or Admin); recheck current access, then 200 id, type, project_id, state (pending/running/completed/failed), created_at, completed_at, result nullable, error_code nullable. Result is JSON totals by project/status category and priority, generated_at and total_issues, never file bytes or personal data. Completed results are a snapshot, not live counts. Generate using one consistent DB snapshot/query; no partially mixed totals.
- Failed report does not expose stack trace. No public report download URLs, schedules, arbitrary filters, or PDF engine. One fixed report satisfies the reports requirement.

## Outgoing webhook configuration

WebhookEndpoint: id, workspace_id, url (HTTPS, maximum 2,048 chars), event_types (subset of the two issue events), active bool, encrypted signing_secret, created_at, updated_at, version. Admin/owner only; max 5 endpoints per workspace as a fixed validation bound, not billing quota. A URL cannot contain credentials or a fragment; only port 443.

Endpoint paths: GET/POST `webhook-endpoints/`, PATCH/DELETE `webhook-endpoints/{id}/`. POST accepts url/event_types; returns 201 plus secret exactly once. PATCH accepts version, url/event_types/active; 200 safe representation. DELETE accepts version, returns 204 and cancels unsent deliveries. GET and all later responses omit secret. POST `webhook-endpoints/{id}/rotate-secret/` takes version; returns new secret once and increments version. No overlap period; pending payloads are signed with the current secret at send time.

Admin GET `webhook-endpoints/{id}/deliveries/` returns paginated id, event_id, event_type, state, attempt_count, last_http_status, next_attempt_at, last_error_code, created_at. Do not show raw response bodies. One manual POST `webhook-deliveries/{id}/retry/` per failed delivery resets a bounded retry cycle; retain delivery ID/body and attempt history; reject pending/succeeded deliveries with 409. Deleted/inactive endpoint or deleted workspace cannot be retried. URL changes invalidate unsent deliveries; never silently redirect an old payload to a new configured recipient.

Validate destination at configuration and every send: reject IP literals, loopback/private/link-local/reserved addresses, cloud metadata destinations, and DNS resolutions containing any non-public address. Connect only to the validated public IP while preserving hostname/SNI and checking TLS certificates; do not independently re-resolve during connection. Disable redirects. The transport adapter must be tested against DNS rebinding and IPv4/IPv6 bypasses; if safe pinning cannot be guaranteed, disable public URL configuration until an egress allowlist/proxy enforces it. This is an external HTTP responsibility (SRP), not a domain rule duplicated in each service.

## Delivery wire contract

POST application/json, schema version 1. Example:

```json
{
  "id": "fb43ca33-bfc1-49ee-8218-7d23522c4645",
  "type": "issue.status_changed",
  "schema_version": 1,
  "workspace_id": 12,
  "occurred_at": "2026-11-07T15:00:00Z",
  "data": {
    "issue_id": 42,
    "project_id": 2,
    "board_id": 3,
    "issue_key": "APP-7",
    "from_status_id": 1,
    "to_status_id": 2
  }
}
```

Payload id is the domain event ID; headers `X-FS04-Delivery-ID` (unique per endpoint/event), `X-FS04-Event`, `X-FS04-Timestamp` (Unix seconds), `X-FS04-Signature: v1=<hex>` and `X-Request-ID`. Signature is HMAC-SHA256 over `timestamp + "." + exact UTF-8 request body` using the endpoint secret. Consumers compare in constant time, reject timestamps outside 5 minutes, and deduplicate delivery IDs. Retries reuse exact body/delivery ID but generate a fresh timestamp/signature.

Use connect timeout 3s, read timeout 7s, total deadline 10s; cap response inspection at 8 KiB and do not retain response content. Any 2xx succeeds. Retry network/timeout/408/429/5xx. Other 3xx/4xx are permanent failures; redirects are never followed. For 429 apply Retry-After if valid, capped at two hours and no earlier than the configured backoff. No ordering guarantee between deliveries; consumers use occurred_at/event IDs or fetch current state through their own authorized integration. Do not promise exactly-once or secret fields in payloads.

## Acceptance tests

| ID | Required scenario |
| --- | --- |
| ASYNC-01 | Rollback publishes nothing; a broker outage after commit is recovered by outbox scan |
| ASYNC-02 | Duplicate tasks/redelivery create one internal notification/report result and bounded external attempts |
| ASYNC-03 | Success, exceptions, worker crash/expired lease, revoked membership, and deleted tenants respect context and eligibility |
| ASYNC-04 | Notification/report endpoints isolate tenant and recipient; report counts use consistent committed data |
| ASYNC-05 | Webhook signatures match exact bytes; retries retain IDs/body and refresh timestamps; consumers can deduplicate |
| ASYNC-06 | Retryable/permanent status codes, bounded attempts, timeouts, disabled endpoints, secret rotation, and one manual retry follow policy |
| ASYNC-07 | Private IPs, redirects, metadata addresses, DNS rebinding, IPv6 tricks, and credentials in URLs cannot bypass egress controls |
| ASYNC-08 | Secret fields and response bodies never appear in logs/list APIs; terminal failures remain observable |
