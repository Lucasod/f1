#!/usr/bin/env bash
# test-autoredact.sh — TDD tests for Component A (Autoredact orchestrator).
# Tests the end-to-end workflow; never exposes secret values.
set -u

ROOT="$(cd "$(dirname "$0")" && pwd)"
COMMON="$ROOT/common.sh"
AUTORA="$ROOT/autoredact.sh"
SCANNER="$ROOT/../scan-secrets.sh"
PASS=0
FAIL=0

ok() { echo "PASS: $1"; PASS=$((PASS+1)); }
bad() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }

# shellcheck source=./common.sh
# shellcheck disable=SC1091
. "$COMMON"

run_autoredact() {
  "$AUTORA" "$@" 2>/dev/null
}

# --- Scanner output parsing ---
out=$(run_autoredact --input "BLOCKED: [FIND-1] [API keys] test.sh:1")
if [ -n "$out" ]; then
  ok "autoredact accepts scanner output format"
else
  bad "autoredact rejects valid scanner output"
fi

# --- Unknown argument handling ---
out=$(run_autoredact --unknown-arg 2>/dev/null)
rc=$?
[ "$rc" -ne 0 ] && ok "unknown argument causes non-zero exit" || bad "unknown argument not rejected"

# --- Missing required args ---
out=$(run_autoredact 2>/dev/null)
rc=$?
[ "$rc" -ne 0 ] && ok "missing args causes non-zero exit" || bad "missing args not rejected"

echo ""
echo "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -eq 0 ]; then exit 0; else exit 1; fi