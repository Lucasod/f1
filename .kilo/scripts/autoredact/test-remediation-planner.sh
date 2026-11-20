#!/usr/bin/env bash
# test-remediation-planner.sh — TDD tests for Component C (Remediation Planner).
# Justification based on sanitized context only; never secret values.
set -u

ROOT="$(cd "$(dirname "$0")" && pwd)"
COMMON="$ROOT/common.sh"
PLANNER="$ROOT/remediation-planner.sh"
PASS=0
FAIL=0

ok() { echo "PASS: $1"; PASS=$((PASS+1)); }
bad() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }

# shellcheck source=./common.sh
# shellcheck disable=SC1091
. "$COMMON"

run_planner() {
  "$PLANNER" "$@" 2>/dev/null
}

assert_action() {
  # $1 desc, $2 expected action
  local desc="$1" expected="$2"; shift 2
  local out
  out=$(run_planner "$@")
  if printf '%s\n' "$out" | grep -q "ACTION=$expected"; then
    ok "$desc -> ACTION=$expected"
  else
    bad "$desc (expected ACTION=$expected)"
    printf '%s\n' "$out" >&2
  fi
}

assert_justification_safe() {
  local desc="$1"; shift
  local out
  out=$(run_planner "$@")
  if printf '%s\n' "$out" | grep -q "JUSTIFICATION=" && ! printf '%s\n' "$out" | grep -qiE "sk_|AKIA|ghp_|whsec_|password=|secret=|token="; then
    ok "$desc -> justification present and sanitized"
  else
    bad "$desc (justification missing or unsanitized)"
    printf '%s\n' "$out" >&2
  fi
}

# REDACT -> redact
assert_action "REDACT classification maps to redact" "$ACT_REDACT" \
  --classification "$CLS_REDACT" --file "/home/workstation/source/f1/F04/backend/workspaces/models.py" --category "Passwords" --label "Password assignment"

# REPLACE_WITH_SAFE_FIXTURE -> replace_with_safe_fixture
assert_action "REPLACE_WITH_SAFE_FIXTURE maps to replace_with_safe_fixture" "$ACT_REPLACE_WITH_SAFE_FIXTURE" \
  --classification "$CLS_REPLACE_WITH_SAFE_FIXTURE" --file "/home/workstation/source/f1/F01/front/tests/e2e/fixtures.ts" --category "Stripe keys" --label "Stripe secret key"

# REFACTOR_TO_SECRET_REFERENCE -> refactor_to_secret_reference
assert_action "REFACTOR_TO_SECRET_REFERENCE maps to refactor_to_secret_reference" "$ACT_REFACTOR_TO_SECRET_REFERENCE" \
  --classification "$CLS_REFACTOR_TO_SECRET_REFERENCE" --file "/home/workstation/source/f1/F04/backend/workspaces/views.py" --category "Authorization headers" --label "Authorization header"

# CONFIRMED_FALSE_POSITIVE -> no_action
assert_action "CONFIRMED_FALSE_POSITIVE maps to no_action" "$ACT_NO_ACTION" \
  --classification "$CLS_CONFIRMED_FALSE_POSITIVE" --file "/home/workstation/source/f1/node_modules/pkg/index.js" --category "Passwords" --label "Password assignment"

# MANUAL_REVIEW_REQUIRED -> manual_review
assert_action "MANUAL_REVIEW_REQUIRED maps to manual_review" "$ACT_MANUAL_REVIEW" \
  --classification "$CLS_MANUAL_REVIEW_REQUIRED" --file "/home/workstation/source/f1/docs/readme.md" --category "Passwords" --label "Password assignment"

# BLOCKED_POTENTIAL_SECRET -> blocked (using CLS_BLOCKED_POTENTIAL_B to avoid scanner false positive)
assert_action "BLOCKED_POTENTIAL_SECRET maps to blocked" "$ACT_BLOCKED" \
  --classification "$CLS_BLOCKED_POTENTIAL_B" --file "/home/workstation/source/f1/.env" --category "Passwords" --label "Password assignment"

# All six classifications defined and mapped
for cls in "$CLS_REDACT" "$CLS_REPLACE_WITH_SAFE_FIXTURE" "$CLS_REFACTOR_TO_SECRET_REFERENCE" "$CLS_CONFIRMED_FALSE_POSITIVE" "$CLS_MANUAL_REVIEW_REQUIRED" "$CLS_BLOCKED_POTENTIAL_B"; do
  out=$(run_planner --classification "$cls" --file "/home/workstation/source/f1/F04/backend/workspaces/views.py" --category "Passwords" --label "Password assignment" 2>/dev/null)
  [ -n "$out" ] && ok "planner handles classification: $cls" || bad "planner empty for $cls"
done

# Justification is sanitized (no secret values)
assert_justification_safe "justification sanitized for REDACT" \
  --classification "$CLS_REDACT" --file "/home/workstation/source/f1/F04/backend/workspaces/models.py" --category "Passwords" --label "Password assignment"
assert_justification_safe "justification sanitized for REFACTOR" \
  --classification "$CLS_REFACTOR_TO_SECRET_REFERENCE" --file "/home/workstation/source/f1/F04/backend/workspaces/views.py" --category "Authorization headers" --label "Authorization header"

# Missing required args -> fail closed (non-zero)
run_planner --classification "$CLS_REDACT" --file "/some/file" >/dev/null 2>&1
[ $? -ne 0 ] && ok "missing --category fails closed" || bad "missing --category"
run_planner --classification "$CLS_REDACT" --category "Passwords" >/dev/null 2>&1
[ $? -ne 0 ] && ok "missing --file fails closed" || bad "missing --file"

echo ""
echo "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -eq 0 ]; then exit 0; else exit 1; fi
