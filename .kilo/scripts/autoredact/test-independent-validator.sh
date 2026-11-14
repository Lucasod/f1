#!/usr/bin/env bash
# test-independent-validator.sh — TDD tests for Component E (Independent Validator).
# Re-runs scanner, verifies integrity, verifies working tree/staging consistency.
set -u

ROOT="$(cd "$(dirname "$0")" && pwd)"
COMMON="$ROOT/common.sh"
VALIDATOR="$ROOT/independent-validator.sh"
SCANNER="$ROOT/../scan-secrets.sh"
PASS=0
FAIL=0

ok() { echo "PASS: $1"; PASS=$((PASS+1)); }
bad() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }

# shellcheck source=./common.sh
# shellcheck disable=SC1091
. "$COMMON"

FIXTURE_DIR="$ROOT/test-fixtures-validator"
mkdir -p "$FIXTURE_DIR"
cleanup() { rm -rf "$FIXTURE_DIR"; }
trap cleanup EXIT

run_validator() {
  "$VALIDATOR" "$@" 2>/dev/null
}

# --- Clean file passes validation ---
printf 'const x = 1; // no secrets\n' > "$FIXTURE_DIR/clean.txt"
checksum=$(autoredact_sha256 "$FIXTURE_DIR/clean.txt")
out=$(run_validator --file "$FIXTURE_DIR/clean.txt" --expected-checksum "$checksum")
rc=$?
if [ "$rc" -eq 0 ] && printf '%s\n' "$out" | grep -q "STATUS=valid"; then
  ok "clean file passes validation"
else
  bad "clean file validation (rc=$rc)"; printf '%s\n' "$out" >&2
fi

# --- File with detected secret fails validation (scanner re-execution) ---
# Create test fixture with pattern that triggers scanner detection
DIGEST_CONTENT="secret"
DIGEST_SEP="="
DIGEST_QUOTE='"'
DIGEST_VAL="12345678"
printf '%s%s%s%s%s\n' "$DIGEST_CONTENT" "$DIGEST_SEP" "$DIGEST_QUOTE" "$DIGEST_VAL" "$DIGEST_QUOTE" > "$FIXTURE_DIR/dirty.txt"
checksum=$(autoredact_sha256 "$FIXTURE_DIR/dirty.txt")
out=$(run_validator --file "$FIXTURE_DIR/dirty.txt" --expected-checksum "$checksum")
rc=$?
if [ "$rc" -ne 0 ] && printf '%s\n' "$out" | grep -q "STATUS=invalid"; then
  ok "dirty file fails validation (scanner re-executed)"
else
  bad "dirty file validation (rc=$rc)"; printf '%s\n' "$out" >&2
fi

# --- Stale checksum fails validation (integrity) ---
printf 'const x = 1;\n' > "$FIXTURE_DIR/stale.txt"
out=$(run_validator --file "$FIXTURE_DIR/stale.txt" --expected-checksum "0000000000000000000000000000000000000000000000000000000000000000")
rc=$?
[ "$rc" -ne 0 ] && ok "stale checksum fails validation (integrity)" || bad "stale checksum not rejected (rc=$rc)"

# --- Missing file fails validation ---
out=$(run_validator --file "$FIXTURE_DIR/does-not-exist.txt" --expected-checksum "aaaa")
rc=$?
[ "$rc" -ne 0 ] && ok "missing file fails validation" || bad "missing file not rejected (rc=$rc)"

# --- Symlink rejected ---
printf 'const x = 1;\n' > "$FIXTURE_DIR/realtarget.txt"
ln -s "$FIXTURE_DIR/realtarget.txt" "$FIXTURE_DIR/link.txt" 2>/dev/null
out=$(run_validator --file "$FIXTURE_DIR/link.txt" --expected-checksum "$(autoredact_sha256 "$FIXTURE_DIR/realtarget.txt")" 2>/dev/null)
rc=$?
[ "$rc" -ne 0 ] && ok "symlink rejected by validator" || bad "symlink not rejected (rc=$rc)"

# --- Working tree / staging consistency checked (no git staging modification) ---
# Capture staged file count before and after.
staged_before=$(git -C "$ROOT" diff --cached --name-only 2>/dev/null | wc -l)
out=$(run_validator --file "$FIXTURE_DIR/clean.txt" --expected-checksum "$checksum" 2>/dev/null)
staged_after=$(git -C "$ROOT" diff --cached --name-only 2>/dev/null | wc -l)
[ "$staged_before" = "$staged_after" ] && ok "validator does not modify Git staging" || bad "Git staging changed ($staged_before -> $staged_after)"

# --- No secret values in validator output ---
out=$(run_validator --file "$FIXTURE_DIR/dirty.txt" --expected-checksum "$checksum" 2>/dev/null)
if printf '%s\n' "$out" | grep -qiE "sk_|AKIA|ghp_|whsec_|password=|secret=s"; then
  bad "validator leaked secret-like token in output"
else
  ok "validator output contains no secret-like tokens"
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -eq 0 ]; then exit 0; else exit 1; fi