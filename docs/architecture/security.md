# Security Hardening Plan - FS-01 Marketplace

## Principles
- Least privilege (CD-059 ownership, Admin Role+PermissionENUM CD-004)
- Defense in depth
- Fail closed
- Zero trust network

## Authentication (CD-010, CD-057, CD-060)
- **JWT**: RS256, 15min access token, 7d refresh token (rotating)
- **Password**: Argon2id (min 12 chars, no max, breach check via HaveIBeenPwned API)
- **Credential**: 1:1 Person:Credential (CD-060), email globally unique
- **Login flow**: Email from ContactInfo (Type=email), lookup Person → Credential → verify
- **Session**: Refresh token stored hashed in DB, revoked on logout/password change
- **MFA**: TOTP (deferred - TECHNICAL_FUTURE per CD-034)

## Authorization
- **Consumer/Vendor**: Ownership-based middleware (resource.ownerPersonId === currentPersonId) per CD-059
- **Admin**: Role + PermissionENUM (read/read-write) per CD-004
- **Middleware order**: Auth → Rate limit → Authz → Validation → Handler

## Transport Security
- **TLS 1.3** everywhere (ALB terminates, mTLS for service-to-service if needed)
- **HSTS**: max-age=31536000, includeSubDomains, preload
- **Certificate**: ACM managed, auto-renewal

## HTTP Security Headers
```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https://api.stripe.com;
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

## Rate Limiting
| Tier | Limit | Scope |
|------|-------|-------|
| Anonymous | 100 req/min | IP |
| Authenticated | 1000 req/min | User ID |
| Auth endpoints | 10 req/min | IP + email |
| Payment endpoints | 30 req/min | User ID |
| Admin endpoints | 500 req/min | User ID |

- Redis-backed sliding window
- 429 with Retry-After header

## Input Validation
- **All inputs**: Zod schemas (derived from OpenAPI)
- **File uploads**: Signed S3 URLs, max 10MB, type allowlist (images: jpeg/png/webp)
- **No SQL/NoSQL injection**: Mongoose parameterized queries
- **XSS**: React auto-escapes, CSP blocks inline scripts

## Secrets Management
- **Never in code**: AWS Secrets Manager / Parameter Store
- **Rotation**: JWT secret (90d), DB passwords (90d), Stripe keys (per Stripe policy)
- **Access**: IAM roles with least privilege, no long-lived keys

## Data Protection
- **Encryption at rest**: MongoDB (encrypted storage), S3 (SSE-S3), Redis (in-transit TLS)
- **Encryption in transit**: TLS 1.3 everywhere
- **PII**: Email, name, CPF/CNPJ, address - encrypted at rest, access logged
- **Payment data**: Never stored (Stripe handles), only PaymentIntent IDs

## Audit Logging
- **Events**: Login, logout, password change, permission change, admin actions, payment/refund, data export
- **Format**: JSON with actor, action, resource, result, timestamp, requestId
- **Storage**: Separate audit log collection, immutable, 7-year retention

## Dependency Security
- **npm audit** in CI (fail on high/critical)
- **Dependabot** / Renovate for automated updates
- **Lockfile**: package-lock.json committed
- **SBOM**: Generate with Syft in CI

## Incident Response
- **Runbook**: Documented for: credential compromise, data breach, payment fraud, DDoS
- **Contacts**: Security team, Stripe support, AWS support
- **Drills**: Quarterly tabletop exercises