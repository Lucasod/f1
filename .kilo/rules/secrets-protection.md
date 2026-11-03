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

## Technical Enforcement (MP-31D / MP-31G)

### Shareable Scanner

- Tracked scanner: `scripts/scan-secrets.sh`. Scans staged files (default, `--staged`) or files passed as arguments.
- Uses POSIX ERE only (`grep -E`); no PCRE. Fails explicitly if a required tool (grep, sed) is unavailable; git is required only for `--staged` mode.
- Reports only file paths + pattern labels + categories. Never prints matched values (defense-in-depth against log leakage).
- Exits 0 if clean, non-zero on findings or operational failure (fail-closed).

### Scanner Patterns and Categories

The scanner checks the following categories (Secret Taxonomy aligned):

- **Stripe keys** — secret key (`sk_`), restricted key (`rk_`), webhook secret (`whsec_`).
- **AWS access keys** — access key id (`AKIA`/`ASIA` + 16 chars).
- **GitHub tokens** — `gh[pousr]_...` and fine-grained PATs (`github_pat_...`).
- **Slack tokens** — `xox[baprs]-...`.
- **Private keys** — PEM private key blocks (`-----BEGIN ... PRIVATE KEY-----`).
- **Certificates** — PEM certificate blocks (`-----BEGIN CERTIFICATE-----`).
- **Connection strings** — URIs with embedded credentials (`scheme://user:pass@host`).
- **Passwords** — quoted password/passwd/pwd assignments (`password = "..."`).
- **API keys/secrets/tokens** — quoted api_key, secret_key, access_token, auth_token, client_secret, api_secret, and generic secret/token assignments.
- **Authorization headers** — `Authorization: Basic|Bearer|Token ...`.
- **Session cookies** — Set-Cookie/Cookie values and quoted session/session_id/sessionid assignments.
- **Base64-encoded secrets** — long base64 values assigned to secret/token/key/password/passwd.
- **Sensitive file names** — `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519`, `credentials.*`, `secrets.*`, `*.crt`, `*.cer` (allowlist: `*.example`).

**MP-31G hardening:** Password, API-key, generic-secret, and session-id patterns require an opening quote character, so unquoted identifiers/declarations (e.g. `const session = ...`, `handleChangePassword`, React state variables) no longer trigger false positives, while quoted credential-like literals remain detected. The `config.*` safe-line exception was removed so quoted secrets under `config.*` are still flagged.

### Backtick Stripping (MP-32)

- Inline code spans (backtick-quoted content in markdown) are stripped before scanning to avoid false positives from documentation examples. This is a general heuristic, not a file-specific exclusion. Fenced code blocks (triple backticks on separate lines) are not stripped; only inline code spans.
- Backtick stripping applies only to markdown files (`.md`, `.mdx`, `.markdown`); non-markdown files are scanned in full (no stripping).
- Backtick stripping is applied line-by-line: each line is processed independently, so an inline code span that spans multiple lines is not stripped. Inline code spans appearing inside fenced code blocks may also be stripped, because stripping is line-based and does not track fence state.

### Fail-Closed Behavior

- Missing required tool (grep, sed) → exit 2 with explicit error; git is required only for `--staged` mode (file mode does not need git).
- Binary files (detected via `grep -I` heuristic) → blocked, not inspected.
- Sensitive file names → blocked regardless of content.
- Staged enumeration or git errors → exit 2, commit blocked.
- Directory/non-regular-file input → non-zero, blocked.
- Empty/unreadable inputs are treated as text only when provably empty; otherwise fail closed.

### Pre-Commit Hook (Tracked Template + Installer)

- Tracked hook template: `.githooks/pre-commit` calls the scanner on staged content (`scripts/scan-secrets.sh --staged`).
- Installation: `scripts/install-hooks.sh` sets `git config core.hooksPath .githooks` (idempotent, safe). It backs up any pre-existing legacy hook to `.git/hooks/pre-commit.mp31-backup` instead of overwriting it.
- Manual activation alternative: `git config core.hooksPath .githooks`, or copy `.githooks/pre-commit` to `.git/hooks/pre-commit` (backup the old hook first).

### Limitations

- Hooks are local and bypassable via `--no-verify`.
- Not shared across clones unless activated (core.hooksPath is a local git config).
- Not a substitute for CI scanning; no CI workflow exists in this repository.
- Defense-in-depth only; scanner uses heuristics and may produce false positives or miss obfuscated/unquoted values (MP-31G reduced detection of unquoted secrets).
- Backtick inline-code stripping is a heuristic that can mask a real secret if it is written inside inline backticks in a markdown file; use obviously fake values in documentation examples or fenced code blocks (which are scanned) to avoid this.

### Installation Instructions

1. Run `scripts/install-hooks.sh` from the repository root (idempotent).
2. Verify with `git config --get core.hooksPath` (should print `.githooks`).
3. Confirm the hook is executable: `test -x .githooks/pre-commit`.
4. Test the scan: `bash scripts/test-scan-secrets.sh` (must pass 74 tests).
5. For a manual install: `git config core.hooksPath .githooks` or copy `.githooks/pre-commit` to `.git/hooks/pre-commit` after backing up any existing hook.

### Hook Divergence (MP-31B vs MP-31D/MP-31G)

- The legacy local hook at `.git/hooks/pre-commit` (MP-31B) is divergent and inactive: it uses an inline, narrower pattern set and does not delegate to the shared scanner.
- The authoritative hook is the tracked template at `.githooks/pre-commit`, activated via `core.hooksPath=.githooks`.
- Always use `scripts/install-hooks.sh` for activation; never commit `.git/hooks/` contents.
