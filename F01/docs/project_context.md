# Project Context — FS-01 Multi-Vendor E-Commerce Marketplace

## Official Internship Statement

**Project:** FS-01 — Multi-Vendor E-Commerce Marketplace  
**Period:** 19/10/2026 to 19/11/2026 (estimated 14 days effort)  
**Current Stage:** P4 implementation is authorized through `MAX_AUTHORIZED_PHASE = 4`; P5 remains blocked pending separate explicit human authorization. Authentication and vendor onboarding are implemented. The current execution status is tracked in `F01/docs/task_list.md` and the latest run record.

## Planned Technologies

| Layer | Technology |
|-------|------------|
| Frontend | React |
| Backend | Node.js |
| Database | MongoDB |
| Search & Filtering | Elasticsearch |
| Caching & Sessions | Redis |
| Payments | Stripe Connect (Separate Charges and Transfers; test-mode integration still pending) |
| Image Storage | AWS S3 |

**Temporary local-development boundary:** Product and review images currently use a local storage adapter, and checkout returns a payment placeholder. These allow local development without provider accounts. They do not replace the target S3/Stripe Connect integrations and do not count as their completion. Implement and validate the real provider integrations when required by the authorized task and configured environment.

**AWS account:** Validated by the user in region us-east-2 (Ohio). Recorded as a human-confirmed fact (CD-075). This does not imply S3 integration is operational — S3StorageAdapter exists with tests but is not wired into production (T-703b). Local storage adapter remains the dev fallback.

## Official Deliverables

1. **Functional demonstration** — deployed or recorded
2. **GitHub repository** — organized commits, README, setup instructions
3. **Architecture diagram & data/API documentation**
4. **Test results** — and performance/accuracy metrics where applicable
5. **Final presentation** — 10 minutes
6. **Individual reflection** — on learning and contribution

## Stages Indicated in Official Statement

1. Plan roles, design data schema and API list
2. Implement JWT authentication and role-based access control
3. Develop vendor registration, product CRUD, image upload to S3
4. Implement search, filters, sorting with Elasticsearch
5. Implement cart, checkout, order lifecycle; use Redis for cart and session cache
6. Integrate payments and commissions with Stripe Connect or Razorpay (test mode)
7. Implement reviews, coupons, PDF invoices, admin dashboard, separate frontend/backend deploy

> Note: These stages guide planning. Initial implementation (Stages 1-2: auth, vendor onboarding) has been merged. P4 is authorized; `MAX_AUTHORIZED_PHASE = 4`. P5 requires separate explicit human authorization and is not authorized.

## Scope Boundaries

- **In scope:** Multi-vendor marketplace core domain (users, vendors, products, orders, payments, commissions, reviews, coupons, admin)
- **P5 only (not authorized):** Deployment, demo, presentation, and other P5 deliverables. P4 implementation remains in scope under the existing authorization.

## Source References

- Official internship statement (requirements & deliverables)
- F01/README.md (project description, objectives, technologies, features, status)
- F01/docs/modeling/conceptual-model.drawio (removed — see conceptual_model.md for current structured model; decisions.md is authoritative source)