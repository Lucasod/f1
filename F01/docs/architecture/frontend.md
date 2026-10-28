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
│   │   └── ui/             # Design system components (created 2026-10-28)
│   ├── hooks/              # Custom hooks
│   ├── utils/              # Helpers, formatters
│   ├── api/                # API client (generated from OpenAPI)
│   └── types/              # Shared type definitions (PersonRole enum)
└── styles/                 # Global styles, Tailwind config
```

## Design System (Implemented 2026-10-28)
**Location:** `F01/front/src/components/ui/`

### Components
| Component | File | Purpose |
|-----------|------|---------|
| Button | `Button.tsx` | Primary, secondary, ghost, danger, outline variants; loading state; `asChild` for Links |
| Input | `Input.tsx` | Input, Textarea, Select with label, error, hint, required indicator |
| Card | `Card.tsx` | Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter; elevated/outlined variants |
| Badge | `Badge.tsx` | Success, warning, error, info, neutral variants with dot indicator |
| Spinner | `Spinner.tsx` | Spinner, LoadingOverlay, Skeleton, ProductCardSkeleton, TableRowSkeleton |
| EmptyState | `EmptyState.tsx` | Consistent empty states with predefined icons (products, dashboard, cart, search, etc.) |
| ErrorAlert | `ErrorAlert.tsx` | Error, warning, info variants; dismissible; action button support |
| Modal | `Modal.tsx` | Accessible modal with focus trapping; ConfirmDialog helper for delete confirmations |

### Design Tokens
- **Color Palette**: Blue primary (#2563eb), semantic colors (green success, yellow warning, red error, blue info)
- **Typography**: System font stack; h1: text-3xl font-bold, h2: text-2xl font-semibold, body: text-base, small: text-sm
- **Spacing**: Consistent 4px scale (space-1 through space-8)
- **Border Radius**: `rounded-lg` (8px) for cards/inputs, `rounded-full` for badges/buttons
- **Shadows**: `shadow-sm` for cards, `shadow-md` for hover, `shadow-lg` for modals
- **Transitions**: `transition-colors`, `transition-shadow`, `transition-transform` (150-200ms)
- **Accessibility**: Focus-visible outlines (`focus-visible:ring-2`), ARIA labels, semantic HTML, `role="status"` for loading, reduced motion support

### Technical Patterns
- **Zero new dependencies** - reused existing Tailwind CSS v4 setup
- **Component composition** - `asChild` pattern for polymorphic components (Button as Link)
- **TypeScript** - Full type safety with proper props interfaces
- **Tree-shaking** - Barrel export from `components/ui/index.ts`

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