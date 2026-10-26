# F1 — Multi-Vendor E-Commerce Marketplace

## About the Project

An internship project focused on developing a multi-vendor e-commerce marketplace where multiple vendors can list and sell their products, while customers can browse and purchase products through a unified platform.

The platform will manage users, vendors, product catalogs, orders, payments, and commissions, while also providing administrative tools.

## Objectives

- Enable multiple vendors to sell their products on a single platform.
- Provide customers with a unified shopping experience.
- Manage orders containing products from multiple vendors.
- Integrate payment processing with split payments and commission calculations.
- Provide administrative tools for monitoring and managing sales.

## Planned Technologies

- **Frontend:** React
- **Backend:** Node.js
- **Database:** MongoDB
- **Search and Filtering:** Elasticsearch
- **Caching and Sessions:** Redis
- **Payments:** Stripe Connect or Razorpay, in test mode
- **Image Storage:** AWS S3

## Planned Features

- User authentication and role-based access control.
- Vendor registration and management.
- Product creation, editing, and retrieval.
- Product search, filtering, and sorting.
- Shopping cart and checkout.
- Order management and status tracking.
- Payment processing, commission calculations, and payment splitting.
- Coupons: creation, management, validation, and application during checkout.
- Product reviews and ratings.
- PDF invoice generation.
- Administrative dashboard with sales metrics and analytics.

## Project Structure

- `back/` — Backend API (Node.js/Express/TypeScript)
- `front/` — Frontend application (React/Vite/TypeScript)
- `docs/` — Marketplace-specific documentation (global documentation remains at repository root)

## Development Status

**Current Stage:** Implementation started.

Docker compose configuration, backend API structure, and frontend scaffolding are in progress. Requirements, domain entities, and technical architecture are being defined progressively alongside implementation.

## Documentation

Project documentation will be organized in `docs/` and will progressively include:

- Conceptual models and diagrams.
- Functional and non-functional requirements.
- Technical decisions and specifications.
- API and data documentation.
- Setup and execution instructions.