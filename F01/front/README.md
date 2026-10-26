# FS-01 Frontend

Frontend application for the FS-01 Marketplace, built with React, Vite, and TypeScript.

## Overview

This is a single-page application (SPA) for the FS-01 marketplace platform. It provides user authentication, role-based access control, and a foundation for consumer, vendor, and admin interfaces.

**Stack**: React 18 · Vite 5 · TypeScript 5 · React Router 7 · Zustand 5 · Vitest · Playwright

## Project Structure

```
src/
├── app/                    # Application-level setup
│   ├── providers/          # Context providers (AuthProvider)
│   └── routes/             # Route components (ProtectedRoute)
├── features/               # Feature-based modules
│   ├── auth/               # Authentication (login, register)
│   └── home/               # Home page
├── shared/                 # Shared utilities and API
│   └── api/                # API clients (auth.ts)
├── components/             # Reusable UI components (to be added)
├── hooks/                  # Custom React hooks (to be added)
├── tests/                  # Test configuration and utilities
│   └── setup.ts            # Vitest setup (jest-dom)
└── main.tsx                # Application entry point
```

## Key Technologies

| Category | Technology | Version |
|----------|------------|---------|
| Framework | React | 18.3 |
| Build Tool | Vite | 5.4 |
| Routing | React Router | 7.18 |
| State Management | Zustand | 5.0 |
| Unit Testing | Vitest + JSDOM + Testing Library | 2.1 |
| E2E Testing | Playwright | 1.47 |
| Language | TypeScript | 5.6 |

## Available Scripts

Run from `F01/front/`:

```bash
# Development
npm run dev          # Start dev server at http://localhost:5173
npm run build        # Type-check + production build to dist/
npm run preview      # Preview production build locally

# Testing
npm run test         # Run unit tests once (Vitest)
npm run test:watch   # Run unit tests in watch mode
npm run test:coverage # Run tests with coverage report
npm run test:e2e     # Run E2E tests (Playwright)
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_PROXY_TARGET` | Backend target used by the Vite `/api` proxy | `http://localhost:3000` |

API requests use relative `/api` paths, so the browser talks to Vite and Vite forwards requests to this target. Override it in `.env.local` for local development:

```bash
VITE_API_PROXY_TARGET=http://localhost:3000
```

## Vite Proxy

The Vite dev server proxies `/api` requests from its own network namespace:

```typescript
// vite.config.ts
server: {
  proxy: {
    '/api': {
      target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3000',
      changeOrigin: true
    }
  }
}
```

- Local Vite uses `http://localhost:3000` by default.
- The standalone frontend Compose file maps `host.docker.internal` to the host gateway and targets the backend on host port `3000`.
- The integrated `F01/docker-compose.yml` targets the backend service directly at `http://backend:3000`; it does not depend on host-gateway DNS.

## Docker Usage

```bash
# From F01/front/
docker compose up --build   # Build and start frontend container
docker compose up           # Start (uses cached build)
docker compose down         # Stop and remove container
```

- **Port**: `5173:5173` (host:container)
- **Hot reload**: Source files mounted as volumes
- **Environment**: `VITE_API_PROXY_TARGET` is set for the frontend container; the browser makes same-origin `/api` requests through Vite.

## State Management (Zustand)

Authentication state is managed via `src/app/providers/authStore.ts` using Zustand with `persist` middleware.

**Store shape**:
```typescript
interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  
  // Actions
  login(email, password): Promise<void>;
  register(input): Promise<void>;
  logout(): void;
  refreshAccessToken(): Promise<void>;
  initializeAuth(): void;
  hasRole(role: UserRole): boolean;
}
```

**Persistence**: Tokens and user data persist to `localStorage` (key: `auth-storage`). Only serializable fields are persisted via `partialize`.

**Usage**:
```typescript
import { useAuth } from '@/app/providers/AuthProvider';

function MyComponent() {
  const { user, isAuthenticated, login, logout, hasRole } = useAuth();
  // ...
}
```

## Routing (React Router 7)

Routes defined in `src/App.tsx` with nested `ProtectedRoute` wrappers:

| Path | Access | Description |
|------|--------|-------------|
| `/` | Public | Home page |
| `/login` | Public | Login page |
| `/register` | Public | Registration page |
| `/dashboard` | Authenticated | User dashboard |
| `/products` | Authenticated | Product listing |
| `/vendor/*` | VENDOR / ADMIN | Vendor management |
| `/admin/*` | ADMIN | Admin panel |

**ProtectedRoute** (`src/app/routes/ProtectedRoute.tsx`):
- Redirects unauthenticated users to `/login` (preserves `from` location)
- Supports `allowedRoles` prop for role-based access
- Shows loading spinner while `isLoading`
- Shows "Access Denied" for insufficient permissions
- Admin role bypasses all role checks

## Testing Approach

### Unit / Integration Tests (Vitest + JSDOM)

- **Config**: `vite.config.ts` → `test` section
- **Environment**: `jsdom`
- **Test files**: `src/**/*.test.{ts,tsx}`
- **Setup**: `src/tests/setup.ts` (imports `@testing-library/jest-dom`)
- **Coverage**: `@vitest/coverage-v8` (text, JSON, HTML reporters)

Run: `npm run test` or `npm run test:coverage`

### E2E Tests (Playwright)

- **Config**: `playwright.config.ts`
- **Test dir**: `tests/e2e/` (to be created)
- **Browser**: Chromium (Desktop Chrome)
- **Base URL**: `http://localhost:5173`
- **Web server**: Auto-starts `npm run dev` for tests

Run: `npm run test:e2e`

---

For backend documentation, see `../back/README.md`. For project-wide architecture, see `../../docs/architecture/`.