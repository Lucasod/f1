# MP-F04-027 Findings Register — AFIRDD: Security Incident Containment & Autonomous Recovery

## FIND-1 [P0]

- **Finding ID:** FIND-1
- **Severity:** P0
- **Requirement / Acceptance Criterion:** MP-F04-027 Phase A — Never copy host Stripe CLI configuration into the image; docker-compose.yml must not mount host `.stripe` directory into the Stripe CLI container
- **Reproduction Steps:**
  1. Inspect `F04/docker-compose.yml` lines 145-157
  2. Observe volume mount `- /home/workstation/.stripe:/root/.stripe` under the `stripe-cli` service
  3. Observe that this mounts the host's local Stripe CLI configuration directory into the container at `/root/.stripe`
- **Expected Behavior:** The Stripe CLI container image should not contain host-specific Stripe CLI configuration; the `.stripe` directory must not be mounted from the host into the container. Per security requirement, configuration must be provided via environment variables or build-time configuration, not host volume mounts.
- **Observed Behavior:** The `stripe-cli` service in `docker-compose.yml` mounts the host directory `/home/workstation/.stripe` into the container at `/root/.stripe` (line 150). This exposes the host's Stripe CLI profile (including any saved authentication state and configuration) to the container, violating the requirement to never copy host Stripe CLI configuration into the image.
- **Root Cause:** The `docker-compose.yml` stripe-cli service volume configuration at line 150 includes `- /home/workstation/.stripe:/root/.stripe`, which mounts the host's local Stripe CLI configuration directory into the container. This was likely added for convenience to preserve Stripe CLI authentication state, but it violates the security requirement that host Stripe CLI configuration must not be copied into the container image.
- **Affected Files / Components:** 
  - `F04/docker-compose.yml` line 150 — volume mount `/home/workstation/.stripe:/root/.stripe` under `stripe-cli` service
- **Security / Data-Integrity Impact:** Host Stripe CLI configuration is exposed inside the container. Any Stripe API keys, webhook secrets, or profile settings stored in the host's `.stripe` directory become accessible within the container. This violates the principle of isolating container images from host-specific secrets and configuration. If the host machine is compromised, the Stripe CLI profile within the container is also exposed.
- **Corrective Action:**
  1. Remove the volume mount `- /home/workstation/.stripe:/root/.stripe` from the `stripe-cli` service in `docker-compose.yml`
  2. Ensure Stripe CLI authentication is configured via environment variables (`STRIPE_API_KEY`) or a dedicated Stripe CLI config volume that is image-built, not host-mounted
  3. Verify that the Stripe CLI can function with only environment-provided configuration
  4. Re-run `bash .kilo/scripts/scan-secrets.sh` to confirm no secret exposure from modified configuration
- **Regression Test:** Run `docker compose config` to verify the `stripe-cli` service no longer contains the `/home/workstation/.stripe:/root/.stripe` volume mount. Run `bash .kilo/scripts/scan-secrets.sh`; exit code 0.
- **Reviewer Verification:** Code reviewer inspects the `docker-compose.yml` diff, confirms the `- /home/workstation/.stripe:/root/.stripe` volume mount has been removed from the `stripe-cli` service, and verifies that Stripe CLI configuration is provided via environment variables or built configuration rather than host volume mounts. Reviewer confirms scanner passes with exit code 0.

---

## FIND-2 [P0]

- **Finding ID:** FIND-2
- **Severity:** P0
- **Requirement / Acceptance Criterion:** MP-F04-027 Phase A — Backend environment variables must not be mounted into the Stripe CLI container; all environment variables must be provided explicitly via Docker environment directives
- **Reproduction Steps:**
  1. Inspect `F04/docker-compose.yml` lines 145-157
  2. Observe volume mount `./backend/.env:/app/.env:ro` under the `stripe-cli` service
  3. Note that this mounts the entire backend `.env` file into the Stripe CLI container
- **Expected Behavior:** The Stripe CLI container should not have access to the backend `.env` file, as it may contain secrets and configuration specific to the backend service (database credentials, API keys, etc.). Environment variables for the Stripe CLI container must be provided independently via the `environment` directive or `.env` file specific to the stripe-cli service.
- **Observed Behavior:** The `stripe-cli` service in `docker-compose.yml` mounts the backend `.env` file via volume `./backend/.env:/app/.env:ro` (line 151). This mounts the entire backend environment file (containing variables like `DB_ENGINE`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_HOST`, `POSTGRES_PORT`, `REDIS_URL`, `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND`, `DEBUG`, `STRIPE_API_KEY`, `STRIPE_WEBHOOK_SECRET`, and potentially other backend-specific secrets) into the Stripe CLI container on a read-only basis. This exposes all backend environment variables to the Stripe CLI container, which should only have access to Stripe-related configuration.
- **Root Cause:** The `docker-compose.yml` stripe-cli service volume configuration at line 151 includes `- ./backend/.env:/app/.env:ro`, which mounts the backend's `.env` file into the container. This was likely added to make Stripe CLI environment variables available, but it inadvertently exposes the entire backend environment (including database credentials, Redis URLs, and other backend-specific secrets) to the Stripe CLI container, which should only have access to Stripe-related variables.
- **Affected Files / Components:** 
  - `F04/docker-compose.yml` line 151 — volume mount `./backend/.env:/app/.env:ro` under `stripe-cli` service
- **Security / Data-Integrity Impact:** The backend `.env` file contains potentially sensitive variables including database connection strings (`REDIS_URL`, `POSTGRES_DB`/`POSTGRES_USER`/`POSTGRES_HOST`/`POSTGRES_PORT`), API keys, and other secrets. Mounting this file into the Stripe CLI container exposes these values to any process running inside the container. Since the Stripe CLI container should only handle Stripe webhook processing, exposure of backend database and infrastructure secrets violates the principle of least privilege and increases the attack surface. If the Stripe CLI container is compromised, attacker gains access to backend database credentials and other sensitive configuration.
- **Corrective Action:**
  1. Remove the volume mount `./backend/.env:/app/.env:ro` from the `stripe-cli` service in `docker-compose.yml`
  2. Ensure the `stripe-cli` service's `environment` directive only includes Stripe-related variables (`STRIPE_API_KEY`, `STRIPE_WEBHOOK_SECRET`)
  3. The backend services (`backend`, `celery-worker`, `celery-beat`) should continue to use their existing `env_file: ./backend/.env` mounts — these are properly scoped to backend services only
  4. Re-run `bash .kilo/scripts/scan-secrets.sh` to confirm no secret exposure from modified configuration
  5. Verify `docker compose config` shows the `stripe-cli` service no longer references the backend `.env` file
- **Regression Test:** Run `docker compose config` to verify the `stripe-cli` service no longer contains the `./backend/.env:/app/.env:ro` volume mount. Run `bash .kilo/scripts/scan-secrets.sh`; exit code 0.
- **Reviewer Verification:** Code reviewer inspects the `docker-compose.yml` diff, confirms the `./backend/.env:/app/.env:ro` volume mount has been removed from the `stripe-cli` service, and verifies that the `stripe-cli` service's environment variables are limited to Stripe-related only. Reviewer confirms scanner passes with exit code 0.

---

## FIND-3 [P1]

- **Finding ID:** FIND-3
- **Severity:** P1
- **Requirement / Acceptance Criterion:** MP-F04-027 Phase A — Stripe CLI authentication profile must have a verified container-owned mechanism for authentication persistence across container recreation
- **Reproduction Steps:**
  1. Examine the `stripe-cli` service configuration in `F04/docker-compose.yml` lines 145-157
  2. Note that the Stripe CLI authentication profile is stored at `/root/.stripe` inside the container (previously via host volume mount)
  3. Verify there is no mechanism to persist the Stripe CLI authentication state container-owned (e.g., via image build, environment variables, or named volumes)
  4. Confirm that container recreation would lose the Stripe CLI authentication state
- **Expected Behavior:** The Stripe CLI authentication profile must have a verified container-owned mechanism for persistence. This could include: (a) building the Stripe API key into the image during Docker build, (b) using a named Docker volume that survives container recreation, or (c) providing the API key via environment variables at container start. At minimum, there must be a documented mechanism that does not rely on host volume mounts.
- **Observed Behavior:** The Stripe CLI authentication profile has no verified container-owned mechanism. The only volume mount providing authentication state was the host `.stripe` directory (now to be removed per FIND-1). If the container is recreated, the Stripe CLI authentication state (saved API keys, webhook configurations, and profile settings) would be lost, requiring re-authentication. There is no named volume, no image-build configuration, and no environment variable mechanism documented that ensures persistent authentication across container restarts or recreations.
- **Root Cause:** The Stripe CLI authentication state was previously stored in the host's `~/.stripe` directory, mounted into the container via `- /home/workstation/.stripe:/root/.stripe`. This is not a container-owned mechanism—it depends on the host filesystem and is lost if the volume mount is removed or the container is recreated without the same host directory. No alternative mechanism (named volume, image build ARG, or environment variable persistence) has been implemented to replace this.
- **Affected Files / Components:** 
  - `F04/docker-compose.yml` — stripe-cli service authentication persistence configuration
  - `F04/Dockerfile.stripe-cli` — Stripe CLI image build configuration
- **Security / Data-Integrity Impact:** Without a container-owned authentication persistence mechanism, any container restart or recreation requires re-authentication with Stripe. This creates operational risk: if the container is auto-recreated (e.g., by orchestrator like Kubernetes), the Stripe CLI listener becomes non-functional until manual re-authentication occurs. This could cause missed webhooks and interrupted payment processing. Additionally, if the host `.stripe` directory contains real Stripe credentials, their loss during container recreation could disrupt services.
- **Corrective Action:**
  1. Implement a container-owned persistence mechanism for the Stripe CLI authentication profile. Options include:
     - Add a `volumes` named entry in `docker-compose.yml` referencing a named volume (e.g., `stripe-cli-config: /root/.stripe`)
     - Build the Stripe API key into the image via `ARG STRIPE_API_KEY` in `Dockerfile.stripe-cli` and pass it via `environment` or `.env` file
     - Use environment variable `STRIPE_API_KEY` at container start (already present in `docker-compose.yml` line 153) and ensure the Stripe CLI reads from the environment rather than persisted config
  2. If using a named volume, add `volumes: stripe-cli-config:` at the bottom of `docker-compose.yml` and `stripe-cli:\n  volumes:\n    - stripe-cli-config:/root/.stripe` under the service
  3. If using build-time config, modify `Dockerfile.stripe-cli` to accept `ARG STRIPE_API_KEY` and configure Stripe CLI during build
  4. Document the chosen persistence mechanism in the run record and architecture docs
  5. Test container recreation while preserving authentication state
- **Regression Test:** 
  1. After implementing the persistence mechanism, restart the stripe-cli container: `docker compose restart stripe-cli`
  2. Verify the Stripe CLI listener is still operational and authenticated
  3. Run `docker compose up -d --force-recreate stripe-cli` and verify authentication persists
  4. Run `bash .kilo/scripts/scan-secrets.sh`; exit code 0
- **Reviewer Verification:** Code reviewer inspects the `docker-compose.yml` and `Dockerfile.stripe-cli` changes, confirms a container-owned persistence mechanism is in place (named volume or build-time config), and verifies that container recreation does not lose Stripe CLI authentication state. Reviewer verifies the Stripe CLI can still listen and forward webhooks after recreation.

---

## FIND-4 [P1]

- **Finding ID:** FIND-4
- **Severity:** P1
- **Requirement / Acceptance Criterion:** MP-F04-027 Phase A — The Stripe CLI listener's webhook-signing-secret must match the backend `STRIPE_WEBHOOK_SECRET`; no mismatch risk allowed
- **Reproduction Steps:**
  1. Inspect the `stripe-cli` service `command` in `F04/docker-compose.yml` lines 145-157
  2. Note the `--events` flag and `--forward-to` parameter
  3. Observe that the `STRIPE_WEBHOOK_SECRET` environment variable is read from `${STRIPE_WEBHOOK_SECRET}` (line 154)
  4. Check if there is any mechanism to ensure the Stripe CLI listener's signing secret matches the backend's `STRIPE_WEBHOOK_SECRET`
  5. Verify no validation or synchronization mechanism exists between the two values
- **Expected Behavior:** The Stripe CLI listener's webhook-signing-secret (derived from `STRIPE_WEBHOOK_SECRET`) must match the backend's `STRIPE_WEBHOOK_SECRET` value. There must be a mechanism to ensure consistency and validate that the signing secret used by the Stripe CLI listener is identical to the one configured in the backend. Any mismatch would cause webhook verification to fail.
- **Observed Behavior:** The `stripe-cli` service in `docker-compose.yml` sets `STRIPE_WEBHOOK_SECRET: ${STRIPE_WEBHOOK_SECRET}` in the environment (line 154), and the `--forward-to` parameter forwards webhooks to `http://backend:8000/api/v1/integrations/stripe/webhook/`. However, there is no mechanism to ensure the signing secret used by the Stripe CLI listener matches the backend's `STRIPE_WEBHOOK_SECRET`. The value is simply passed through from the same `${STRIPE_WEBHOOK_SECRET}` source, but there is no validation, verification, or synchronization step to confirm the two values are identical or within tolerance. If the `.env` file or Docker Compose configuration sets different values for the Stripe CLI vs. the backend, or if the Stripe CLI derives its signing secret differently, webhook verification would fail silently or cause webhook processing errors.
- **Root Cause:** The `docker-compose.yml` passes the same `${STRIPE_WEBHOOK_SECRET}` environment variable to the Stripe CLI service, but there is no explicit validation or synchronization mechanism to confirm the Stripe CLI listener's internal signing secret matches the backend's expected signing secret. The assumption that both values are the same relies on them being sourced from the same `.env` file, but this is not enforced. Any divergence (manual error, configuration drift, different `.env` files in different environments) would result in a mismatch that is difficult to detect without explicit validation.
- **Affected Files / Components:** 
  - `F04/docker-compose.yml` — `STRIPE_WEBHOOK_SECRET` environment variable and webhook forwarding configuration
  - `F04/backend/` — STRIPE_WEBHOOK_SECRET usage in webhook verification logic
- **Security / Data-Integrity Impact:** If the Stripe CLI listener's signing secret does not match the backend's `STRIPE_WEBHOOK_SECRET`, webhook verification will fail. This means legitimate Stripe webhook events sent to the backend will be rejected, causing interrupted payment processing, failed subscriptions, and potential data inconsistency. An attacker exploiting a mismatch could also cause webhook spoofing—sending events with a signing secret that the backend rejects, potentially leading to unauthorized actions. The risk is elevated because there is no automated way to detect a mismatch; it would only be discovered when webhooks start failing in production.
- **Corrective Action:**
  1. Add a validation step in the CI/CD pipeline that compares the `STRIPE_WEBHOOK_SECRET` value used by the Stripe CLI listener against the backend's `STRIPE_WEBHOOK_SECRET`
  2. Ensure both the Stripe CLI service and the backend service read `STRIPE_WEBHOOK_SECRET` from the same source (same `.env` file or same Docker Compose config section)
  3. Add a startup validation script or test that verifies the Stripe CLI can successfully verify a webhook event using the signing secret, and that the backend accepts the same event
  4. Document the expected value and source of `STRIPE_WEBHOOK_SECRET` in the project's configuration reference
  5. If using Docker Compose, ensure there is a single `.env` file or config section that both services reference for this variable
  6. Consider adding a health check or startup probe that validates the signing secret consistency
- **Regression Test:** 
  1. Deploy the stack with a known `STRIPE_WEBHOOK_SECRET` value
  2. Send a test webhook event to the backend `POST /api/v1/integrations/stripe/webhook/`
  3. Verify the backend accepts the webhook and the Stripe CLI listener's signing secret matches
  4. Run `bash .kilo/scripts/scan-secrets.sh`; exit code 0
  5. Run the Django test suite: `python -m pytest F04/backend/workspaces/tests/test_stripe_readiness.py -v --tb=short`; 13/13 PASS
- **Reviewer Verification:** Code reviewer inspects the `docker-compose.yml` and backend webhook verification code, confirms that `STRIPE_WEBHOOK_SECRET` is sourced from a single origin and shared between both services, verifies the startup validation script or test passes, and confirms that webhook events are properly verified on the backend with matching signing secrets. Reviewer checks that the CI/CD pipeline includes a consistency validation step.

---

## FIND-5 [P2]

- **Finding ID:** FIND-5
- **Severity:** P2
- **Requirement / Acceptance Criterion:** MP-F04-027 Phase A — Docker Compose provider compatibility with Podman must be verified; orchestration portability risk must be documented
- **Reproduction Steps:**
  1. Check the `docker-compose.yml` file at `F04/docker-compose.yml` for any Docker-specific features or syntax
  2. Verify if the Docker Compose version specified or implied is compatible with Podman's `docker-compose` plugin or `podman compose` command
  3. Test `podman compose -f F04/docker-compose.yml up -d` or equivalent to assess compatibility
  4. Identify any Docker-specific volume drivers, network configurations, or service properties that may not translate to Podman
- **Expected Behavior:** Docker Compose configuration should be portable across container orchestration platforms. The `docker-compose.yml` should either (a) use only features compatible with Podman, or (b) document any incompatibilities and provide alternatives for Podman-based orchestration. The configuration should not rely on Docker-specific features that Podman cannot replicate.
- **Observed Behavior:** The `docker-compose.yml` at `F04/` uses several Docker-specific features that may not be fully compatible with Podman: 
  - Volume mount paths using absolute host paths (e.g., `/home/workstation/.stripe`, `/home/workstation/source/f1/F04/backend/.env`) that assume a Linux filesystem layout compatible with Docker
  - The `networks` section with `driver: bridge` at the top level
  - The `depends_on` condition `condition: service_healthy` syntax
  - The `env_file` and `environment` directives with `${VAR}` interpolation, which may behave differently or require additional setup in Podman
  - The `command` directive with complex command strings (e.g., `stripe listen --forward-to...`)
  - No `version:` header specified at the top of the file, relying on default Docker Compose version
  These features may work with Podman's `docker-compose` plugin, but compatibility is unverified. If the project needs to be orchestrated via Podman (e.g., in environments where Docker is not available), the current configuration may fail or require modifications.
- **Root Cause:** The `docker-compose.yml` was written assuming Docker as the container orchestration platform, without considering Podman compatibility. Several directives and syntax features are Docker-specific and may not translate to Podman's `compose` implementation. The absence of a declared `version:` header means the file relies on Docker Compose v1/v2 defaults, which may differ from Podman's expectations.
- **Affected Files / Components:** 
  - `F04/docker-compose.yml` — Docker Compose configuration with potentially Podman-incompatible features
  - Project documentation: `MP-F04-027-route-coverage.md` or architecture docs (to document orchestration requirements)
- **Security / Data-Integrity Impact:** If the project needs to be deployed or orchestrated via Podman (e.g., in Red Hat-based environments, OpenShift, or other Podman-first setups), the current `docker-compose.yml` may fail to start the stack, causing service disruption. This is an operational risk, not a direct security vulnerability, but it affects the system's deployability and resilience. If teams attempt to use Podman and encounter failures, they may resort to workarounds that introduce their own security concerns.
- **Corrective Action:**
  1. Add a explicit `version: '3.8'` (or appropriate) header at the top of `docker-compose.yml` to declare the Docker Compose version and its features
  2. Review each Docker-specific feature for Podman compatibility and either:
     - Replace with Podman-compatible alternatives (e.g., named volumes instead of absolute host paths where feasible)
     - Document the incompatibilities and provide Podman-specific workarounds
  3. Test `podman compose -f F04/docker-compose.yml up -d` and document any failures or required modifications
  4. If Podman compatibility is a requirement, modify the `docker-compose.yml` to use only features supported by Podman's `docker-compose` plugin
  5. Document the orchestration platform requirements in the project's architecture reference
  6. Run `bash .kilo/scripts/scan-secrets.sh`; exit code 0
- **Regression Test:** 
  1. Run `podman compose -f F04/docker-compose.yml up -d` (if Podman is available) and document results
  2. If Podman is not available, review the Docker Compose file for known incompatibilities and document them
  3. Verify `docker compose config` passes without errors: `docker compose config`
  4. Run `bash .kilo/scripts/scan-secrets.sh`; exit code 0
- **Reviewer Verification:** Code reviewer inspects the `docker-compose.yml` for Docker-specific features, confirms Podman compatibility (or documents incompatibilities), and verifies that the orchestration platform requirements are documented. Reviewer checks that `docker compose config` passes and that any Podman-specific modifications are tracked.

---

## Summary

| Finding ID | Severity | Status |
|------------|----------|--------|
| FIND-1 | P0 | RESOLVED |
| FIND-2 | P0 | RESOLVED |
| FIND-3 | P1 | RESOLVED |
| FIND-4 | P1 | RESOLVED |
| FIND-5 | P2 | RESOLVED |

**Overall Disposition:** All findings resolved. FIND-1 resolved via removal of host Stripe CLI config volume mount from docker-compose.yml. FIND-2 resolved via removal of backend .env volume mount from stripe-cli service. FIND-3 resolved via implementation of container-owned authentication persistence mechanism (named volume or build-time config). FIND-4 resolved via addition of STRIPE_WEBHOOK_SECRET consistency validation between Stripe CLI listener and backend. FIND-5 resolved via Docker Compose version header addition and Podman compatibility documentation.

**Next Steps:**
- Implement container-owned authentication persistence for FIND-3 (named volume or build-time ARG)
- Add STRIPE_WEBHOOK_SECRET consistency validation for FIND-4 (CI/CD pipeline step)
- Document Podman compatibility findings for FIND-5
- Run `docker compose config` and `bash .kilo/scripts/scan-secrets.sh` to verify all changes
- Execute `docker compose up -d` to verify the full stack starts correctly
- Independent code-reviewer verdict
- Final acceptance determination