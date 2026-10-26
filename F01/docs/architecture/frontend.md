# Frontend Architecture - FS-01 Marketplace

## Architecture Style
Component-based architecture with clear separation of concerns. Server state vs client state management.

## Technology Stack
- React 18 + TypeScript
- Vite (build tool)
- React Router (v7) (routing)
- TanStack Query (server state) - **Decision for Q-023**
- Zustand (client state: auth, cart, UI)
- Tailwind CSS (styling)
- Playwright (E2E tests)
- Vitest (unit tests)

## Folder Structure
```
front/src/
├── app/                    # App-level setup
│   ├── providers/          # Context providers (Auth, Query, Cart)
│   └── routes/             # Route definitions
├── features/               # Feature-based modules
│   ├── auth/               # Login, register, password reset
│   ├── cart/               # Cart page, mini-cart, merge guest
│   ├── checkout/           # Address, payment, confirmation
│   ├── products/           # Catalog, search, product detail
│   ├── orders/             # Order history, tracking, details
│   ├── vendor/             # Vendor dashboard, product mgmt
│   ├── reviews/            # Review display, write review
│   ├── coupons/            # Coupon apply at checkout
│   └── admin/              # Admin dashboard
├── shared/                 # Shared components & utilities
│   ├── components/         # UI primitives (Button, Input, Card, Modal)
│   ├── hooks/              # Custom hooks
│   ├── utils/              # Helpers, formatters
│   └── api/                # API client (generated from OpenAPI)
└── styles/                 # Global styles, Tailwind config
```

## State Management
- **Server State**: TanStack Query (caching, invalidation, optimistic updates)
- **Client State**: Zustand (auth tokens, user profile, cart, UI state)
- **URL State**: React Router (filters, pagination, search params)

## Key Patterns
- API client generated from OpenAPI spec (`F01/docs/api/openapi.yaml`)
- Protected routes with role-based access (Consumer, Vendor, Admin)
- Optimistic updates for cart/checkout
- Error boundaries per feature
- Lazy-loaded feature routes

## Build & Deploy
- Vite production build
- Deploy to Vercel (per CD-053 separate frontend deploy)
- Environment variables for API URL