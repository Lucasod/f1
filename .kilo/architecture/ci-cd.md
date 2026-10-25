# CI/CD Pipeline Design - FS-01 Marketplace

## Pipeline Overview
Separate pipelines for Frontend and Backend (per CD-053). GitHub Actions (or GitLab CI).

## Backend Pipeline
```
stages:
  - lint        # ESLint, Prettier, TypeScript check
  - test:unit   # Vitest (unit tests)
  - test:api    # Supertest (API/integration tests) - requires test DB
  - build       # TypeScript compile, Docker image build
  - scan        # Trivy (container scan), npm audit
  - deploy:staging  # Deploy to staging (auto on main)
  - deploy:prod     # Deploy to prod (manual approval)
```

## Frontend Pipeline
```
stages:
  - lint        # ESLint, Prettier, TypeScript check
  - test:unit   # Vitest (component tests)
  - test:e2e    # Playwright (critical paths) - requires staging API
  - build       # Vite production build, Docker image build
  - scan        # Trivy, npm audit
  - deploy:staging  # Deploy to Vercel preview (auto on main)
  - deploy:prod     # Deploy to Vercel prod (manual approval)
```

## Environments
| Environment | Branch | Deploy Trigger | Data |
|-------------|--------|----------------|------|
| Development | feature/* | Manual | Local Docker Compose |
| Staging | main | Auto on merge | Staging DB (subset) |
| Production | main (tag) | Manual approval | Prod DB |

## Testing Strategy (per CD-056)
- **Unit**: Vitest - pure functions, services, utilities
- **Integration**: Supertest - API endpoints with test DB
- **E2E**: Playwright - critical user journeys (auth, cart, checkout, payment)
- **Payment tests**: Stripe test mode, idempotency, duplicate prevention

## Quality Gates
- All tests pass
- TypeScript compile succeeds
- Linting passes
- No high/critical vulnerabilities (Trivy, npm audit)
- Coverage: not mandated (per CD-056) but tracked

## Rollback
- Docker image tags = git SHA
- Blue/green or rolling deployment
- Quick rollback: deploy previous image tag

## Secrets in CI
- GitHub Environments with protection rules
- Secrets injected at runtime (not in image)
- Staging/Prod separate secret scopes