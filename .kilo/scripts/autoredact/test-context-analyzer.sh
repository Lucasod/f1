#!/usr/bin/env bash
# test-context-analyzer.sh — TDD tests for Component B (Context Analyzer).
# Uses only sanitized context (paths, categories, labels); never secret values.
set -u

ROOT="$(cd "$(dirname "$0")" && pwd)"
COMMON="$ROOT/common.sh"
ANALYZER="$ROOT/context-analyzer.sh"
PASS=0
FAIL=0

ok() { echo "PASS: $1"; PASS=$((PASS+1)); }
bad() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }

# shellcheck source=./common.sh
# shellcheck disable=SC1091
. "$COMMON"

run_analyzer() {
  # $1..$n args passed to context-analyzer.sh; captures stdout classification.
  "$ANALYZER" "$@" 2>/dev/null
}

# --- Sensitive file names -> BLOCKED_POTENTIAL_SECRET ---
run_analyzer --file "/home/workstation/source/f1/.env" --line 1 --category "Passwords" --label "Password assignment" | grep -q "CLASSIFICATION=BLOCKED_POTENTIAL_SECRET" && ok "sensitive .env -> BLOCKED_POTENTIAL_SECRET" || bad "sensitive .env"
run_analyzer --file "/home/workstation/source/f1/config/credentials.json" --line 1 --category "API keys/secrets/tokens" --label "API key assignment" | grep -q "CLASSIFICATION=BLOCKED_POTENTIAL_SECRET" && ok "sensitive credentials* -> BLOCKED_POTENTIAL_SECRET" || bad "sensitive credentials"
run_analyzer --file "/home/workstation/source/f1/id_rsa" --line 1 --category "Private keys" --label "Private key block" | grep -q "CLASSIFICATION=BLOCKED_POTENTIAL_SECRET" && ok "sensitive id_rsa -> BLOCKED_POTENTIAL_SECRET" || bad "sensitive id_rsa"

# --- node_modules / .git -> CONFIRMED_FALSE_POSITIVE ---
run_analyzer --file "/home/workstation/source/f1/node_modules/pkg/index.js" --line 1 --category "Passwords" --label "Password assignment" | grep -q "CLASSIFICATION=CONFIRMED_FALSE_POSITIVE" && ok "node_modules -> CONFIRMED_FALSE_POSITIVE" || bad "node_modules"
run_analyzer --file "/home/workstation/source/f1/.git/config" --line 1 --category "Authorization headers" --label "Authorization header" | grep -q "CLASSIFICATION=CONFIRMED_FALSE_POSITIVE" && ok ".git -> CONFIRMED_FALSE_POSITIVE" || bad ".git"

# --- Test / spec / fixture files -> REPLACE_WITH_SAFE_FIXTURE ---
run_analyzer --file "/home/workstation/source/f1/F01/front/tests/e2e/catalog.spec.ts" --line 1 --category "Passwords" --label "Password assignment" | grep -q "CLASSIFICATION=REPLACE_WITH_SAFE_FIXTURE" && ok "*.spec.ts -> REPLACE_WITH_SAFE_FIXTURE" || bad "spec file"
run_analyzer --file "/home/workstation/source/f1/F04/backend/workspaces/tests/test_billing.py" --line 1 --category "API keys/secrets/tokens" --label "API key assignment" | grep -q "CLASSIFICATION=REPLACE_WITH_SAFE_FIXTURE" && ok "test_*.py -> REPLACE_WITH_SAFE_FIXTURE" || bad "test file"
run_analyzer --file "/home/workstation/source/f1/F01/front/tests/e2e/fixtures.ts" --line 1 --category "Stripe keys" --label "Stripe secret key" | grep -q "CLASSIFICATION=REPLACE_WITH_SAFE_FIXTURE" && ok "fixtures.ts -> REPLACE_WITH_SAFE_FIXTURE" || bad "fixtures"

# --- Markdown -> MANUAL_REVIEW_REQUIRED ---
run_analyzer --file "/home/workstation/source/f1/docs/agent_runs/mp-f1-sec-autoredact-001-2026-11-13.md" --line 1 --category "Passwords" --label "Password assignment" | grep -q "CLASSIFICATION=MANUAL_REVIEW_REQUIRED" && ok ".md -> MANUAL_REVIEW_REQUIRED" || bad "markdown"

# --- Authorization header -> REFACTOR_TO_SECRET_REFERENCE ---
run_analyzer --file "/home/workstation/source/f1/F04/backend/workspaces/views.py" --line 1 --category "Authorization headers" --label "Authorization header" | grep -q "CLASSIFICATION=REFACTOR_TO_SECRET_REFERENCE" && ok "Authorization header -> REFACTOR_TO_SECRET_REFERENCE" || bad "auth header"

# --- Hardcoded secrets in source -> REDACT ---
run_analyzer --file "/home/workstation/source/f1/F04/backend/workspaces/models.py" --line 1 --category "Passwords" --label "Password assignment" | grep -q "CLASSIFICATION=REDACT" && ok "password assignment -> REDACT" || bad "password"
run_analyzer --file "/home/workstation/source/f1/F04/backend/workspaces/serializers.py" --line 1 --category "API keys/secrets/tokens" --label "API key assignment" | grep -q "CLASSIFICATION=REDACT" && ok "api key -> REDACT" || bad "api key"
run_analyzer --file "/home/workstation/source/f1/F04/backend/workspaces/tasks.py" --line 1 --category "Stripe keys" --label "Stripe secret key" | grep -q "CLASSIFICATION=REDACT" && ok "stripe key -> REDACT" || bad "stripe"
run_analyzer --file "/home/workstation/source/f1/F04/backend/workspaces/urls.py" --line 1 --category "Connection strings" --label "Connection string with credentials" | grep -q "CLASSIFICATION=REDACT" && ok "connection string -> REDACT" || bad "connection string"

# --- Unknown category -> MANUAL_REVIEW_REQUIRED ---
run_analyzer --file "/home/workstation/source/f1/F04/backend/workspaces/views.py" --line 1 --category "Unknown category" --label "Something" | grep -q "CLASSIFICATION=MANUAL_REVIEW_REQUIRED" && ok "unknown category -> MANUAL_REVIEW_REQUIRED" || bad "unknown category"

# --- Missing required args -> fail closed (non-zero) ---
run_analyzer --file "/some/file" --line 1 --category "Passwords" >/dev/null 2>&1
[ $? -ne 0 ] && ok "missing --label fails closed" || bad "missing --label"
run_analyzer --file "/some/file" --label "x" >/dev/null 2>&1
[ $? -ne 0 ] && ok "missing --category fails closed" || bad "missing --category"
run_analyzer --line 1 --category "Passwords" --label "x" >/dev/null 2>&1
[ $? -ne 0 ] && ok "missing --file fails closed" || bad "missing --file"

# --- No secret values in output: run with a secret-like path, confirm [REDACTED] only ---
out=$(run_analyzer --file "/home/workstation/source/f1/F04/backend/conf/settings.py" --line 1 --category "Passwords" --label "Password assignment" 2>/dev/null)
if printf '%s\n' "$out" | grep -qiE "sk_|AKIA|ghp_|whsec_|password=|secret="; then
  bad "analyzer leaked secret-like token in output"
else
  ok "analyzer output contains no secret-like tokens"
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -eq 0 ]; then exit 0; else exit 1; fi
