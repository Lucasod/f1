# Project Context — FS-01 Multi-Vendor E-Commerce Marketplace

## Official Internship Statement

**Project:** FS-01 — Multi-Vendor E-Commerce Marketplace  
**Period:** 19/10/2026 to 19/11/2026 (estimated 14 days effort)  
**Current Stage:** Initial implementation merged (authentication, vendor onboarding); P4/P5 blocked pending explicit human authorization. Documentation reconciliation in progress.

## Planned Technologies

| Layer | Technology |
|-------|------------|
| Frontend | React |
| Backend | Node.js |
| Database | MongoDB |
| Search & Filtering | Elasticsearch |
| Caching & Sessions | Redis |
| Payments | Stripe Connect or Razorpay (test mode) |
| Image Storage | AWS S3 |

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

> Note: These stages guide planning. Initial implementation (Stages 1-2: auth, vendor onboarding) has been merged. P4/P5 remain blocked pending explicit human authorization; MAX_AUTHORIZED_PHASE = 3 unchanged.

## Scope Boundaries

- **In scope:** Multi-vendor marketplace core domain (users, vendors, products, orders, payments, commissions, reviews, coupons, admin)
- **Out of scope for P4/P5 (blocked):** Further implementation details, specific class designs, database schema optimization, API endpoint specifications, infrastructure provisioning. Initial implementation (auth, vendor onboarding) completed in P0-P3.

## Source References

- Official internship statement (requirements & deliverables)
- F01/README.md (project description, objectives, technologies, features, status)
- F01/docs/modeling/conceptual-model.drawio (current conceptual diagram)