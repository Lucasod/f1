# Non-Functional Requirements — FS-01 Multi-Vendor E-Commerce Marketplace

## Document Control

**Version:** 1.0 (T-202)  
**Status:** Final — responsible review completed (T-204 ✅)  
**Created:** 2026-10-23  
**Updated:** 2026-10-23  
**Author:** MP-16 — T-202 execution  

---

## 1. Introduction

### 1.1 Purpose

This document captures the non-functional requirements for the FS-01 Multi-Vendor E-Commerce Marketplace MVP. Unlike functional requirements which specify *what* the system should do, these requirements define *how* the system should behave with respect to quality attributes, constraints, and observable system properties.

Each requirement is categorized by domain and references the confirmed decisions that authorize or constrain its specification. Requirements without confirmed decisions targeting specific values are documented as pending with their potential business impact.

### 1.2 References

| Document | Purpose |
|----------|---------|
| `F01/docs/project_context.md` | Technologies: React, Node.js, MongoDB, Elasticsearch, Redis, Stripe Connect, AWS S3 |
| `F01/docs/decisions.md` | Source of truth for NFR-related decisions (CD-004, CD-054, CD-055, CD-056, CD-057, CD-064, CD-065) |
| `F01/docs/open_questions.md` | Pending NFR targets (Q-026 currency, Q-028 coverage, others) |
| `F01/docs/functional_requirements.md` | Scope boundaries, actors, and functional context |
| Official internship statement | 14-day effort period, deliverable requirements |

---

## 2. Non-Functional Requirements by Domain

### 2.1 Security

| ID | NFR-SEC-001 |
|----|-------------|

**Title:** JWT-Based Authentication with Secure Token Lifecycle

**Description:** Users authenticate via email and password. Upon successful authentication, a JWT token is issued containing claims identifying the Person. Token validation occurs on every protected request.

**Authorization Model:**  
- **Admin:** Role-based access control (RBAC) via Role + PermissionENUM (Read, Read/Write)
- **Consumer:** Ownership-based isolation — users can only access their own data
- **Vendor:** Ownership-based isolation — users can only access their own products, orders, and transactions

**Reference:** CD-009, CD-010, CD-059, CD-060

**Observable Behavior:**
- Given valid credentials → JWT token issued with Person claims
- Given invalid credentials → 401 Unauthorized response
- Given protected resource request with valid token → ownership validated per CD-059

**Status:** DEFINED

---

| ID | NFR-SEC-002 |

**Title:** Login Email Uniqueness and Credential Protection

**Description:** The email used for login is globally unique. A Person's login email (Contact_Info with Type=email) is protected from deletion while associated with authentication.

**Reference:** CD-057, CD-060

**Observable Behavior:**
- Given registration attempt with existing login email → 409 Conflict with "email already in use"
- Given attempt to delete login email → 400 Bad Request with "login contact protected"

**Status:** DEFINED

---

| ID | NFR-SEC-003 |

**Title:** Idempotency for Payment Operations

**Description:** All payment and transfer operations must be idempotent to prevent duplicate financial transactions. PaymentIntents use Stripe's native idempotency_key. Transfers use application-level keys.

**Reference:** CD-064

**Observable Behavior:**
- Given duplicate PaymentIntent creation with same idempotency_key → same PaymentIntent returned
- Given duplicate Transfer request with same key → no duplicate transfer created

**Status:** DEFINED

---

| ID | NFR-SEC-004 |

**Title:** Cross-Actor Data Isolation

**Description:** Strict ownership isolation is enforced. Consumers cannot access Vendor data, Vendors cannot access other Vendors' data, and Admins cannot access Consumer/Vendor personal data except for platform management purposes.

**Reference:** CD-039, CD-059

**Observable Behavior:**
- Given Vendor A accessing Vendor B's orders → 403 Forbidden
- Given Consumer accessing Vendor dashboard → 403 Forbidden

**Status:** DEFINED

---

| ID | NFR-SEC-005 |

**Title:** HTTPS Enforcement (Production)

**Description:** All production traffic must use TLS. Internal service-to-service communication in development may use HTTP.

**Reference:** —

**Status:** PENDING

---

### 2.2 Data Consistency & Integrity

| ID | NFR-DATA-001 |

**Title:** MongoDB as Source of Truth

**Description:** MongoDB is the authoritative data store. Elasticsearch is a read-only index for search, rebuildable from MongoDB. Redis stores ephemeral session and cart data.

**Reference:** CD-049

**Observable Behavior:**
- Given product update in MongoDB → Elasticsearch index eventually reflects change
- Given Elasticsearch index rebuild → data integrity matches MongoDB

**Status:** DEFINED

---

| ID | NFR-DATA-002 |

**Title:** Order Snapshot Immutability

**Description:** At checkout, address and product data are copied as immutable snapshots to Orders. Historical Order_Items preserve price and quantity at time of purchase.

**Reference:** CD-036, CD-061

**Observable Behavior:**
- Given address updated after order → Order shipping address unchanged
- Given product price changed after order → Order_Item price unchanged

**Status:** DEFINED

---

| ID | NFR-DATA-003 |

**Title:** Append-Only History Preservation

**Description:** All history entities (*_History) are append-only. Records are never modified or overwritten after creation.

**Reference:** CD-033

**Observable Behavior:**
- Given order status update → previous status available in history
- Given status change attempted on historical record → rejected

**Status:** DEFINED

---

| ID | NFR-DATA-004 |

**Title:** Transaction Currency Definition

**Description:** The transaction currency for the marketplace has been defined as **BRL (Brazilian Real)** for the MVP scope. The interface language is confirmed as English (CD-054). Stripe Connect Separate Charges and Transfers supports BRL in Brazil (CD-064).

**Reference:** Q-026, CD-054, CD-064

**Status:** **DEFINED** (BRL definido para MVP)

---

| ID | NFR-DATA-005 |

**Title:** Identity Document Validation (CPF/CNPJ)

**Description:** Each Person must have exactly one tax identification — CPF (individual) or CNPJ (company), never both. Input validation ensures correct format and check digits.

**Reference:** CD-007

**Observable Behavior:**
- Given CPF and CNPJ both provided → 400 Bad Request
- Given neither provided → 400 Bad Request
- Given invalid format for provided document → 400 Bad Request with validation error

**Status:** PARTIALLY_DEFINED — Conceptual rule confirmed (CD-007: mutual exclusivity of CPF/CNPJ). Format validation rules (check digits, length) remain TECHNICAL_FUTURE.

---

### 2.3 Performance

| ID | NFR-PERF-001 |

**Title:** Search Response Time

**Description:** Product search queries must return results within a reasonable time threshold for consumer acceptable UX.

**Reference:** —

**Status:** PENDING — No confirmed target for search response time. A target value requires a decision. Impact: Affects search UX, Elasticsearch sizing, query optimization effort.

---

| ID | NFR-PERF-002 |

**Title:** Page Load Performance

**Description:** Frontend pages must load within acceptable thresholds for consumer experience.

**Reference:** —

**Status:** PENDING — No confirmed target for page load performance. A target value requires a decision. Impact: Affects frontend implementation, asset bundling, CDN strategy.

---

| ID | NFR-PERF-003 |

**Title:** Cart and Session Redis TTL

**Description:** Cart persistence duration and session timeout values need definition.

**Reference:** Q-014, CD-018

**Status:** PENDING — Cart TTL and session timeout values not defined. Typical values are implementation details pending decision.

**Impact:** Affects Redis memory usage, session invalidation strategy.

---

### 2.4 Availability & Reliability

| ID | NFR-AVAIL-001 |

**Title:** Service Health Check Endpoints

**Description:** Backend services expose health check endpoints for deployment monitoring and failover orchestration.

**Reference:** —

**Status:** PENDING — No target defined. Health check endpoints are an implementation detail for observability.

**Impact:** CI/CD health checks, container orchestration readiness probes.

---

| ID | NFR-AVAIL-002 |

**Title:** Payment Provider Resilience

**Description:** System handles payment provider outages gracefully, preserving order state and allowing retry.

**Reference:** CD-024, CD-048

**Observable Behavior:**
- Given provider timeout → Order remains in PENDING_PAYMENT, Payment in FAILED
- Given retry initiated → new Payment attempt created

**Status:** PARTIALLY_DEFINED — Resilience behavior confirmed (CD-024, CD-048: order state preserved, retry allowed). Specific timeout and retry targets remain PENDING.

---

### 2.5 Search Index Recovery

| ID | NFR-ES-001 |

**Title:** Elasticsearch Index Rebuildability

**Description:** Elasticsearch indices can be rebuilt from MongoDB source of truth. MongoDB remains the authoritative data store.

**Reference:** CD-049

**Observable Behavior:**
- Given Elasticsearch index corrupted → rebuild from MongoDB restores search capability
- Given fresh deployment → index rebuild script produces consistent search results

**Status:** DEFINED

---

### 2.6 Accessibility

| ID | NFR-A11Y-001 |

**Title:** Web Content Accessibility Guidelines (WCAG) Compliance

**Description:** The React frontend implements basic accessibility standards for consumer usability.

**Reference:** —

**Status:** PENDING — No accessibility requirements defined in internship statement or decisions. WCAG 2.1 AA compliance is a possible target but not confirmed.

**Impact:** User experience for users with disabilities, legal compliance in some jurisdictions.

---

### 2.7 Observability

| ID | NFR-OBS-001 |

**Title:** Structured Logging

**Description:** Backend services emit structured logs for debugging, auditing, and monitoring purposes.

**Reference:** —

**Status:** PENDING — Structured logging is an implementation detail for observability.

**Impact:** Production troubleshooting, log aggregation setup.

---

| ID | NFR-OBS-002 |

**Title:** Request/Response Metrics

**Description:** API endpoints expose metrics for monitoring system behavior and performance.

**Reference:** —

**Status:** PENDING — Metrics collection (Prometheus, histograms, error rates) not defined. Implementation detail for observability.

**Impact:** Production monitoring, alerting, SLO definition.

---

| ID | NFR-OBS-003 |

**Title:** Audit Trail for Financial Operations

**Description:** All financial operations (payments, transfers, refunds, commission adjustments) are recorded as Transaction entities for audit purposes.

**Reference:** CD-031, CD-048, CD-065

**Observable Behavior:**
- Given payment processed → Transaction record created with type SALE
- Given refund processed → Transaction record created with type REFUND

**Status:** DEFINED

---

### 2.8 Testability & Quality Assurance

| ID | NFR-TEST-001 |

**Title:** Three-Layer Testing Strategy

**Description:** The project uses three testing layers, all following TDD (RED → GREEN → REFACTOR):
- Unit tests: Vitest
- API/Integration tests: Supertest
- End-to-end tests: Playwright

**Reference:** CD-056

**Observable Behavior:**
- Given source code changes → unit tests pass locally
- Given API changes → integration tests validate contracts
- Given user flows → E2E tests verify complete journeys

**Status:** DEFINED

---

| ID | NFR-TEST-002 |

**Title:** Payment Test Scenarios

**Description:** Payment tests use provider test mode and must cover:
- Success flow (payment captured, transfers created)
- Failure flow (payment declined, order status updated)
- Repeated events (idempotency)
- Prevention of duplicate financial operations

**Reference:** CD-056

**Observable Behavior:**
- Given successful test payment → Order PAID, Vendor receives Transfer
- Given declined payment → Order FAILED_PAYMENT, no Transfer
- Given duplicate webhook with same idempotency_key → no duplicate Charge/Transfer

**Status:** DEFINED

---

| ID | NFR-TEST-003 |

**Title:** Test Coverage Target

**Description:** The minimum test coverage percentage is not defined.

**Reference:** Q-028, CD-056

**Status:** PENDING — Per CD-056: "Detailed configuration, CI integration, and coverage targets remain technical decisions. Do not invent a minimum coverage percentage."

**Impact:** CI gate failure, code quality assurance.

---

## 3. Traceability Matrix

| NFR ID | Domain | Source Decision | Status |
|--------|--------|-----------------|--------|
| NFR-SEC-001 | Security | CD-009, CD-010, CD-059, CD-060 | DEFINED |
| NFR-SEC-002 | Security | CD-057, CD-060 | DEFINED |
| NFR-SEC-003 | Security | CD-064 | DEFINED |
| NFR-SEC-004 | Security | CD-039, CD-059 | DEFINED |
| NFR-SEC-005 | Security | — | PENDING |
| NFR-DATA-001 | Data | CD-049 | DEFINED |
| NFR-DATA-002 | Data | CD-036, CD-061 | DEFINED |
| NFR-DATA-003 | Data | CD-033 | DEFINED |
| NFR-DATA-004 | Data | Q-026, CD-054, CD-064 | **DEFINED** |
| NFR-DATA-005 | Data | CD-007 | PARTIALLY_DEFINED |
| NFR-PERF-001 | Performance | — | PENDING |
| NFR-PERF-002 | Performance | — | PENDING |
| NFR-PERF-003 | Performance | Q-014 | PENDING |
| NFR-AVAIL-001 | Availability | — | PENDING |
| NFR-AVAIL-002 | Availability | CD-024, CD-048 | PARTIALLY_DEFINED |
| NFR-ES-001 | Search | CD-049 | DEFINED |
| NFR-A11Y-001 | Accessibility | — | PENDING |
| NFR-OBS-001 | Observability | — | PENDING |
| NFR-OBS-002 | Observability | — | PENDING |
| NFR-OBS-003 | Observability | CD-031, CD-048, CD-065 | DEFINED |
| NFR-TEST-001 | Testability | CD-056 | DEFINED |
| NFR-TEST-002 | Testability | CD-056 | DEFINED |
| NFR-TEST-003 | Testability | Q-028 | PENDING |

---

## 4. Glossary

| Term | Definition |
|------|------------|
| **CD** | Confirmed Decision identifier |
| **NFR** | Non-Functional Requirement |
| **DEFINED** | Requirement fully specified with confirmed decision(s) and observable acceptance criteria |
| **PARTIALLY_DEFINED** | Requirement partially confirmed by decision(s); remaining aspects pending or TECHNICAL_FUTURE |
| **PENDING** | No confirmed decision or target for the requirement; business impact documented |
| **TECHNICAL_FUTURE** | Conceptual rule defined; implementation details (format, values, mechanism) deferred to technical phase |
| **Q** | Open Question identifier |