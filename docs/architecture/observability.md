# Observability Design - FS-01 Marketplace

## Pillars
1. **Logs** - Structured JSON, correlated by request ID
2. **Metrics** - RED (Rate, Errors, Duration) + USE (Utilization, Saturation, Errors)
3. **Traces** - Distributed tracing for async operations

## Logging
- **Format**: JSON with fields: timestamp, level, requestId, service, module, message, context
- **Levels**: error, warn, info, debug
- **Correlation**: Request ID propagated via headers (x-request-id) through all services
- **Output**: stdout (container) → CloudWatch Logs / Loki
- **Sampling**: Debug in dev, Info+ in prod
- **PII**: Never log passwords, tokens, full card numbers (mask last 4)

## Metrics (Prometheus format)
### API Metrics (per endpoint)
- `http_requests_total` (counter) - by method, path, status
- `http_request_duration_seconds` (histogram) - by method, path
- `http_requests_in_flight` (gauge)

### Business Metrics
- `orders_created_total` (counter) - by status
- `payments_processed_total` (counter) - by status (succeeded, failed, refunded)
- `cart_operations_total` (counter) - by operation (add, update, remove, merge)
- `vendor_onboarding_total` (counter)
- `reviews_created_total` (counter)

### Infrastructure Metrics
- `node_cpu_usage`, `node_memory_usage`, `node_disk_usage`
- `mongodb_connections`, `redis_connections`, `es_cluster_health`
- `queue_depth` (async jobs)

## Alerting Rules (Critical)
| Alert | Condition | Severity |
|-------|-----------|----------|
| APIErrorRateHigh | 5xx rate > 5% for 5m | Critical |
| APILatencyP99High | p99 > 2s for 5m | Warning |
| PaymentFailureRate | failed payments > 10% for 5m | Critical |
| DatabaseConnectionsHigh | > 80% max connections | Warning |
| DiskSpaceLow | < 15% free | Warning |

## Tracing (OpenTelemetry)
- **Instrumentation**: Auto-instrument Node.js (HTTP, MongoDB, Redis)
- **Sampling**: 10% in prod, 100% in staging
- **Propagation**: W3C TraceContext
- **Exporter**: OTLP → Tempo / X-Ray
- **Key Spans**: HTTP request, DB query, Redis op, Stripe API call, async job

## Dashboards
- **API Overview**: RPS, error rate, latency (p50/p95/p99)
- **Business**: Orders, revenue, conversion funnel
- **Payment**: Success/failure, refund rate, Stripe webhook latency
- **Infrastructure**: CPU, memory, disk, DB connections

## Log Retention
- Application logs: 30 days (hot), 1 year (cold/Glacier)
- Audit logs (auth, payment, admin actions): 7 years
- Access logs: 90 days