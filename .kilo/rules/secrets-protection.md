# Secrets Protection — Mandatory Rule

**Status:** Mandatory. Applies to every agent, task, delegation, review, diagnostic, test, documentation, and command without exception.

**Precedence:** This rule prevails over diagnostic, debugging, audit, test, command, and agent-delegation instructions. No agent may bypass it, override it, or treat it as optional.

## Core Prohibitions

- Never display secret values in terminal output, logs, reports, documentation, tests, prompts, reasoning, agent messages, or any other artifact.
- Never run `cat .env`, `printenv`, `env`, or any equivalent command that reveals credentials or other secret values.
- Never print files or environment variables that contain secrets.
- Never pass credentials as command-line arguments.
- Never copy secret values into reports, documentation, fixtures, screenshots, chat messages, or agent messages.
- Never ask the user to paste full credentials in chat.
- Never reproduce a suspected secret in an incident record, finding, or report.

## Diagnostics

- Diagnostics may report only: the variable or secret name, whether it is configured or missing, the target environment, and a structural validation result (for example, format/length sanity) — never the value.
- Validate credentials internally without printing, logging, transmitting, or otherwise disclosing their content.
- Treat all secret-bearing files (such as `.env`) and environment variables as sensitive by default.

## Repository and File Protection

- `.env` files and any file containing secrets must stay out of Git and must be protected from accidental exposure (for example, via `.gitignore` and least-privilege access).
- Do not commit, print, or attach secret-bearing files.

## Suspected Exposure

- If a secret is suspected to have been exposed: stop disclosure immediately, do not reproduce the secret, record an incident that references only the secret name and scope, and recommend rotation of the affected credential.
- Rotation is recommended for any credential that may have been disclosed, even partially.

## Secret Taxonomy

Treat the following as secrets (non-exhaustive):

- API keys
- Tokens
- Passwords
- Database credentials
- Private keys
- Webhook secrets
- Certificates
- Connection strings
- Session cookies
- Authorization headers
- Base64-encoded secrets

When in doubt, treat as secret.

## Scope and Enforcement

- This rule applies regardless of the task, agent, or tool invoked. Diagnostics, debugging, audits, tests, and commands must comply.
- No agent may bypass this rule through delegation or any other mechanism.
- This precedence is absolute and may not be waived.
- When in doubt, treat a value as a secret and do not disclose it.

## Technical Enforcement (MP-31D)

- Shareable scanner: `scripts/scan-secrets.sh` (tracked). Scans staged files or files passed as args; covers all Secret Taxonomy categories and sensitive file names; handles binary files (fail-closed); uses POSIX ERE only (`grep -E`); fails explicitly if a required tool is unavailable; reports only file paths + pattern labels + categories (never matched values); exits 0 if clean, non-zero otherwise.
- Tracked hook template: `.githooks/pre-commit` calls the scanner on staged content.
- Installation: `scripts/install-hooks.sh` sets `git config core.hooksPath .githooks` (idempotent, safe). Activation manual alternative: `git config core.hooksPath .githooks` or copy `.githooks/pre-commit` to `.git/hooks/pre-commit` (backup the old hook first).
- Limitations: hooks are local and bypassable via `--no-verify`; not a substitute for CI scanning; defense-in-depth only.
