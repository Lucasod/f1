#!/usr/bin/env bash
set -eu

scanner="$(dirname "$0")/scan-secrets.sh"
tmp=$(mktemp -d "${TMPDIR:-/tmp}/scanner-env-safety.XXXXXXXX")
trap 'rm -rf -- "$tmp"' EXIT
fixture="$tmp/input.txt"
synthetic='sk_test_'$(printf 'A%.0s' {1..20})
base64_value=$(printf 'B%.0s' {1..40})
failures=0

check() {
  description=$1
  expected=$2
  set +e
  output=$(bash "$scanner" "$fixture" 2>&1)
  status=$?
  set -e
  if [ "$status" -ne "$expected" ] || [[ "$output" == *"$synthetic"* ]] || [[ "$output" == *"$base64_value"* ]]; then
    printf 'FAIL: %s (exit %d, expected %d, output redacted)\n' "$description" "$status" "$expected"
    failures=$((failures + 1))
  else
    printf 'PASS: %s\n' "$description"
  fi
}

for marker in 'process.env.KEY' 'os.environ["KEY"]' 'getenv("KEY")' 'env["KEY"]' 'System.getenv("KEY")' 'os.Getenv("KEY")'; do
  printf '%s; value = "%s"\n' "$marker" "$synthetic" > "$fixture"
  check "detect synthetic token beside $marker" 1
  printf 'value = %s\n' "$marker" > "$fixture"
  check "accept environment reference $marker" 0
done

printf 'value = "%s"\n' "$synthetic" > "$fixture"
check 'detect synthetic token without environment reference' 1
printf 'ordinary text\n' > "$fixture"
check 'accept ordinary text' 0
printf 'binary\000data' > "$fixture"
check 'block binary input' 1
for ((i=0; i<10000; i++)); do printf 'synthetic text line\n'; done > "$fixture"
printf 'late\000binary\n' >> "$fixture"
check 'block late NUL in file input' 1
: > "$fixture"
check 'accept empty file input' 0
rm -- "$fixture"
check 'block missing input' 1

printf '%s=%s\n' 'secret' "$base64_value" > "$fixture"
set +e
output=$(bash "$scanner" "$fixture" 2>&1)
status=$?
set -e
if [ "$status" -eq 1 ] && [[ "$output" == *'Base64 secret assignment'* ]] && [[ "$output" != *"$base64_value"* ]] && [[ "$output" != *"$synthetic"* ]]; then
  printf 'PASS: detect synthetic base64 assignment\n'
else
  printf 'FAIL: detect synthetic base64 assignment (exit %d, output redacted)\n' "$status"
  failures=$((failures + 1))
fi
set +e
output=$(bash "$scanner" "$0" 2>&1)
status=$?
set -e
if [ "$status" -eq 0 ] && [[ "$output" != *"$synthetic"* ]] && [[ "$output" != *"$base64_value"* ]]; then
  printf 'PASS: scanner regression source is clean\n'
else
  printf 'FAIL: scanner regression source is clean (exit %d, output redacted)\n' "$status"
  failures=$((failures + 1))
fi

mkdir "$tmp/bin"
mkdir "$tmp/work"
real_grep=$(command -v grep)
real_sed=$(command -v sed)
real_rm=$(command -v rm)
real_tr=$(command -v tr)
real_wc=$(command -v wc)
cat > "$tmp/bin/git" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  diff)
    if [ "$SCANNER_TEST_CASE" = markdown ]; then printf 'staged.md\000'; else printf 'staged.txt\000'; fi ;;
  show)
    case "$SCANNER_TEST_CASE" in
      failure) printf '%s\n' "$SCANNER_TEST_SECRET"; printf '%s\n' "$SCANNER_TEST_SECRET" >&2; exit 7 ;;
      empty) : ;;
      mixed) printf 'process.env.KEY; value = "%s"\n' "$SCANNER_TEST_SECRET" ;;
      binary) printf 'binary\000data' ;;
      late_binary) for ((i=0; i<10000; i++)); do printf 'synthetic text line\n'; done; printf 'late\000binary\n' ;;
      markdown) printf '`%s`\n' "$SCANNER_TEST_SECRET" ;;
      *) exit 9 ;;
    esac ;;
  *) exit 9 ;;
esac
EOF
chmod +x "$tmp/bin/git"
cat > "$tmp/bin/grep" <<'EOF'
#!/usr/bin/env bash
if [ "${STUB_FAIL:-}" = grep ] && { [ "${1:-}" = -iEq ] || [ "${1:-}" = -iE ]; }; then
  printf '%s\n' "$SCANNER_TEST_SECRET" >&2
  exit 2
fi
exec "$REAL_GREP" "$@"
EOF
cat > "$tmp/bin/sed" <<'EOF'
#!/usr/bin/env bash
if [ "${STUB_FAIL:-}" = sed ]; then
  printf '%s\n' "$SCANNER_TEST_SECRET" >&2
  exit 2
fi
exec "$REAL_SED" "$@"
EOF
cat > "$tmp/bin/rm" <<'EOF'
#!/usr/bin/env bash
if { [ "${STUB_FAIL:-}" = rm ] || [ "${STUB_FAIL:-}" = rm_always ]; } && [ "${1:-}" = -f ] && [ "${2:-}" = -- ]; then
  printf x >> "$STUB_STATE.calls"
  printf '%s' "$3" > "$STUB_STATE.path"
  if [ "$(<"$STUB_STATE.calls")" = xx ] || { [ "$STUB_FAIL" = rm_always ] && [ "$(<"$STUB_STATE.calls")" = xxx ]; }; then
    printf '%s\n' "$SCANNER_TEST_SECRET" >&2
    exit 1
  fi
fi
exec "$REAL_RM" "$@"
EOF
chmod +x "$tmp/bin/grep" "$tmp/bin/sed" "$tmp/bin/rm"
cat > "$tmp/bin/tr" <<'EOF'
#!/usr/bin/env bash
if [ "${STUB_FAIL:-}" = tr ]; then
  printf '%s\n' "$SCANNER_TEST_SECRET" >&2
  exit 2
fi
exec "$REAL_TR" "$@"
EOF
chmod +x "$tmp/bin/tr"
cat > "$tmp/bin/wc" <<'EOF'
#!/usr/bin/env bash
if [ "${STUB_FAIL:-}" = wc ]; then
  printf '%s\n' "$SCANNER_TEST_SECRET" >&2
  exit 2
fi
exec "$REAL_WC" "$@"
EOF
chmod +x "$tmp/bin/wc"

check_staged() {
  description=$1
  scenario=$2
  expected=$3
  expected_message=$4
  synthetic_env_name=SCANNER_TEST_$(printf '%s' SECRET)
  set +e
  output=$(PATH="$tmp/bin:$PATH" TMPDIR="$tmp/work" SCANNER_TEST_CASE="$scenario" REAL_GREP="$real_grep" REAL_SED="$real_sed" REAL_RM="$real_rm" REAL_TR="$real_tr" REAL_WC="$real_wc" STUB_STATE="$tmp/stub" env "$synthetic_env_name=$synthetic" bash "$scanner" --staged 2>&1)
  status=$?
  set -e
  if [ "$status" -ne "$expected" ] || [[ "$output" == *"$synthetic"* ]] || [[ "$output" != *"$expected_message"* ]]; then
    printf 'FAIL: %s (exit %d, expected %d, output redacted)\n' "$description" "$status" "$expected"
    failures=$((failures + 1))
  else
    printf 'PASS: %s\n' "$description"
  fi
}

check_staged 'block failed staged read even with partial output' failure 2 'cannot read staged content'
check_staged 'accept genuinely empty staged file' empty 0 ''
check_staged 'detect staged environment and synthetic token' mixed 1 'Stripe secret key'
check_staged 'block staged binary input' binary 1 'Binary file'
check_staged 'block late NUL in staged input' late_binary 1 'Binary file'
check_staged 'preserve staged Markdown format handling' markdown 0 ''
STUB_FAIL=sed check_staged 'block failed Markdown preprocessing' markdown 2 'cannot scan staged snapshot'
STUB_FAIL=grep check_staged 'block failed pattern matching' mixed 2 'cannot scan staged snapshot'
STUB_FAIL=tr check_staged 'block failed binary detection' mixed 2 'cannot inspect staged content'
STUB_FAIL=wc check_staged 'block failed byte counting' mixed 2 'cannot inspect staged content'
STUB_FAIL=rm check_staged 'block failed snapshot cleanup' empty 2 'temporary file cleanup failed'
if [ -f "$tmp/stub.calls" ] && [ "$(<"$tmp/stub.calls")" = xxx ] && [ -f "$tmp/stub.path" ] && [ ! -e "$(<"$tmp/stub.path")" ]; then
  printf 'PASS: retry failed snapshot cleanup at exit\n'
else
  printf 'FAIL: retry failed snapshot cleanup at exit\n'
  failures=$((failures + 1))
fi
rm -f -- "$tmp/stub.calls" "$tmp/stub.path"
STUB_FAIL=rm_always check_staged 'block persistent snapshot cleanup failure' empty 2 'temporary file cleanup failed'
if [ -f "$tmp/stub.calls" ] && [ "$(<"$tmp/stub.calls")" = xxx ] && [ -f "$tmp/stub.path" ] && [ -f "$(<"$tmp/stub.path")" ]; then
  printf 'PASS: persistent cleanup failure retains snapshot for test cleanup\n'
else
  printf 'FAIL: persistent cleanup failure retains snapshot for test cleanup\n'
  failures=$((failures + 1))
fi

if [ "$failures" -ne 0 ]; then
  printf '%d check(s) failed\n' "$failures"
  exit 1
fi
printf 'All 34 checks passed\n'
