#!/usr/bin/env bash
# test-safe-executor.sh — TDD tests for Component D (Safe Remediation Executor).
# Deterministic line-range replacement with safety guards; never exposes secrets.
set -u

ROOT="$(cd "$(dirname "$0")" && pwd)"
COMMON="$ROOT/common.sh"
EXECUTOR="$ROOT/safe-executor.sh"
PASS=0
FAIL=0

ok() { echo "PASS: $1"; PASS=$((PASS+1)); }
bad() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }

# shellcheck source=./common.sh
# shellcheck disable=SC1091
. "$COMMON"

FIXTURE_DIR="$ROOT/test-fixtures"
mkdir -p "$FIXTURE_DIR"
cleanup() { rm -rf "$FIXTURE_DIR"; }
trap cleanup EXIT

make_file() {
  # $1 name, $2.. content lines
  local name="$1"; shift
  printf '%s\n' "$@" > "$FIXTURE_DIR/$name"
}

run_executor() {
  "$EXECUTOR" "$@" 2>/dev/null
}

# --- Happy path: replace lines 2-3 with [REDACTED], checksum verified ---
make_file "happy.txt" "line1" "SECRET_VALUE_1" "SECRET_VALUE_2" "line4"
before=$(autoredact_sha256 "$FIXTURE_DIR/happy.txt")
perms_before=$(stat -c '%a' "$FIXTURE_DIR/happy.txt")
out=$(run_executor --file "$FIXTURE_DIR/happy.txt" --start-line 2 --end-line 3 --replacement "[REDACTED]" --expected-checksum "$before")
rc=$?
after=$(autoredact_sha256 "$FIXTURE_DIR/happy.txt")
perms_after=$(stat -c '%a' "$FIXTURE_DIR/happy.txt")
if [ "$rc" -eq 0 ] && printf '%s\n' "$out" | grep -q "STATUS=ok" && [ "$before" != "$after" ]; then
  ok "happy path replaces lines and checksum changes"
else
  bad "happy path (rc=$rc)"; printf '%s\n' "$out" >&2
fi
# Content: line1, [REDACTED], line4
content=$(cat "$FIXTURE_DIR/happy.txt")
if printf '%s\n' "$content" | grep -qx "line1" && printf '%s\n' "$content" | grep -qx "\[REDACTED\]" && printf '%s\n' "$content" | grep -qx "line4"; then
  ok "happy path content correct (SECRET lines replaced)"
else
  bad "happy path content"; printf '%s\n' "$content" >&2
fi
# Permissions preserved
[ "$perms_before" = "$perms_after" ] && ok "permissions preserved" || bad "permissions changed ($perms_before -> $perms_after)"
# No secret value remains in file
if printf '%s\n' "$content" | grep -q "SECRET_VALUE"; then
  bad "secret value still present in file"
else
  ok "no secret value remains in file"
fi

# --- Reject symlink ---
make_file "target.txt" "keep" "secret" "keep"
ln -s "$FIXTURE_DIR/target.txt" "$FIXTURE_DIR/link.txt" 2>/dev/null
before=$(autoredact_sha256 "$FIXTURE_DIR/target.txt")
out=$(run_executor --file "$FIXTURE_DIR/link.txt" --start-line 2 --end-line 2 --replacement "[REDACTED]" --expected-checksum "$before" 2>/dev/null)
rc=$?
[ $? -ne 0 ] 2>/dev/null
[ "$rc" -ne 0 ] && ok "symlink rejected" || bad "symlink not rejected (rc=$rc)"

# --- Reject path traversal (outside root) ---
out=$(run_executor --file "/etc/passwd" --start-line 1 --end-line 1 --replacement "[REDACTED]" --expected-checksum "aaaa" 2>/dev/null)
rc=$?
[ "$rc" -ne 0 ] && ok "path traversal (/etc/passwd) rejected" || bad "path traversal not rejected (rc=$rc)"

# --- Reject concurrent modification / stale checksum (checksum mismatch) ---
make_file "stale.txt" "a" "b" "c"
wrong_checksum="0000000000000000000000000000000000000000000000000000000000000000"
out=$(run_executor --file "$FIXTURE_DIR/stale.txt" --start-line 2 --end-line 2 --replacement "[REDACTED]" --expected-checksum "$wrong_checksum" 2>/dev/null)
rc=$?
[ "$rc" -ne 0 ] && ok "stale checksum rejected (concurrent modification)" || bad "stale checksum not rejected (rc=$rc)"

# --- Reject out-of-bounds line range ---
make_file "bounds.txt" "a" "b" "c"
before=$(autoredact_sha256 "$FIXTURE_DIR/bounds.txt")
out=$(run_executor --file "$FIXTURE_DIR/bounds.txt" --start-line 5 --end-line 6 --replacement "[REDACTED]" --expected-checksum "$before" 2>/dev/null)
rc=$?
[ "$rc" -ne 0 ] && ok "out-of-bounds range rejected" || bad "out-of-bounds not rejected (rc=$rc)"
# File unchanged
after=$(autoredact_sha256 "$FIXTURE_DIR/bounds.txt")
[ "$before" = "$after" ] && ok "file unchanged after rejected range" || bad "file modified despite rejected range"

# --- Reject missing file ---
out=$(run_executor --file "$FIXTURE_DIR/does-not-exist.txt" --start-line 1 --end-line 1 --replacement "[RETED]" --expected-checksum "aaaa" 2>/dev/null)
rc=$?
[ "$rc" -ne 0 ] && ok "missing file rejected" || bad "missing file not rejected (rc=$rc)"

# --- No secret values in executor output ---
out=$(run_executor --file "$FIXTURE_DIR/happy.txt" --start-line 2 --end-line 2 --replacement "[REDACTED]" --expected-checksum "$(autoredact_sha256 "$FIXTURE_DIR/happy.txt")" 2>/dev/null)
if printf '%s\n' "$out" | grep -qiE "SECRET_VALUE|sk_|AKIA|ghp_|whsec_|password=|secret="; then
  bad "executor leaked secret-like token in output"
else
  ok "executor output contains no secret-like tokens"
fi

# --- Determinism: same inputs produce same after-checksum ---
make_file "det.txt" "x" "secret" "y" "secret" "z"
b=$(autoredact_sha256 "$FIXTURE_DIR/det.txt")
run_executor --file "$FIXTURE_DIR/det.txt" --start-line 2 --end-line 4 --replacement "[REDACTED]" --expected-checksum "$b" >/dev/null 2>&1
a1=$(autoredact_sha256 "$FIXTURE_DIR/det.txt")
# reset and repeat
printf '%s\n' "x" "secret" "y" "secret" "z" > "$FIXTURE_DIR/det.txt"
b=$(autoredact_sha256 "$FIXTURE_DIR/det.txt")
run_executor --file "$FIXTURE_DIR/det.txt" --start-line 2 --end-line 4 --replacement "[REDACTED]" --expected-checksum "$b" >/dev/null 2>&1
a2=$(autoredact_sha256 "$FIXTURE_DIR/det.txt")
[ "$a1" = "$a2" ] && ok "deterministic (same after-checksum)" || bad "non-deterministic ($a1 vs $a2)"

echo ""
echo "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -eq 0 ]; then exit 0; else exit 1; fi
