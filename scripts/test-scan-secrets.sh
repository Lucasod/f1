#!/usr/bin/env bash
# Test suite for scripts/scan-secrets.sh (MP-31D). Uses only fictitious credentials.

set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCANNER="$ROOT/scripts/scan-secrets.sh"
PASS=0
FAIL=0

ok() { echo "PASS: $1"; PASS=$((PASS+1)); }
bad() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }

tmpbase="$(mktemp -d)"
trap 'rm -rf "$tmpbase"' EXIT
mkdir -p /tmp/scratchpad

# Fictitious secrets (split literals so this file itself is not flagged)
S_STRIPE='sk_test_''FAKE1234567890abcdef'
S_AWS='AKIA''IOSFODNN7EXAMPLE'
S_GH='ghp_''abcdefghijklmnopqrstuvwxyz0123456789'
S_SLACK='xoxb-''1234567890-abcdefghij'
S_CONN='mongodb:''//user:pass@host/db'
S_API='ABCDEFGHIJKLMNOP''QRSTUVWX'
S_AUTH='abcdefghijklmnop''qrstuv'
S_LONGVAL='abcdefghijklmnopqrstuvwxyz''012345'
S_B64='QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE='
S_EXAMPLE='example''Password'
S_CLONE='cloneSecret''Value'

run_expect() {
  # $1 expected exit, rest args
  exp="$1"; shift
  "$SCANNER" "$@" >/tmp/scratchpad/out.txt 2>&1
  rc=$?
  desc="$*"
  if [ "$rc" = "$exp" ]; then ok "$desc (exit $rc)"; else bad "$desc (expected $exp got $rc)"; cat /tmp/scratchpad/out.txt >&2; fi
}

td="$tmpbase/cat"; mkdir -p "$td"

check_detect() {
  label="$1"; fn="$2"; content="$3"
  printf '%s\n' "$content" > "$td/$fn"
  out=$("$SCANNER" "$td/$fn" 2>&1)
  rc=$?
  if [ "$rc" -ne 0 ] && printf '%s\n' "$out" | grep -qi "$label"; then
    ok "detect: $label"
  else
    bad "detect: $label (rc=$rc)"
    printf '%s\n' "$out" >&2
  fi
}

check_detect "Stripe" "stripe.txt" "key = \"$S_STRIPE\""
check_detect "AWS" "aws.txt" "AWS_ACCESS_KEY_ID=$S_AWS"
check_detect "GitHub" "gh.txt" "token=$S_GH"
check_detect "Slack" "slack.txt" "slack=$S_SLACK"
printf '%s\n' '-----BEGIN'' RSA PRIVATE KEY-----' > "$td/pk.txt"
check_detect "Private key" "pk.txt" "-----BEGIN"''" RSA PRIVATE KEY-----"
check_detect "Connection string" "conn.txt" "DB=$S_CONN"
PW="pass""word"
check_detect "Password" "pw.txt" "$PW=$S_EXAMPLE"
check_detect "API key" "api.txt" "api_key=\"$S_API\""
check_detect "Authorization" "auth.txt" "Authorization: Bearer $S_AUTH"
CK="Coo""kie"
SID="session""id"
check_detect "Session cookie" "cookie.txt" "$CK: $SID=$S_LONGVAL"
printf '%s\n' '-----BEGIN'' CERTIFICATE-----' > "$td/cert.txt"
check_detect "Certificate" "cert.txt" "-----BEGIN"''" CERTIFICATE-----"
check_detect "Base64" "b64.txt" "secret=$S_B64"

# --- Sensitive file names ---
sens="$tmpbase/sens"; mkdir -p "$sens"
for name in .env .env.local foo.pem foo.key id_rsa credentials.json secrets.yaml foo.crt foo.cer foo.p12 foo.pfx; do
  echo x > "$sens/$name"
  out=$("$SCANNER" "$sens/$name" 2>&1); rc=$?
  if [ "$rc" -ne 0 ] && printf '%s\n' "$out" | grep -qi "sensitive file"; then
    ok "sensitive name: $name"
  else
    bad "sensitive name: $name (rc=$rc)"
  fi
done
echo 'PORT=3000' > "$sens/benign.env.example"
run_expect 0 "$sens/benign.env.example"

# --- Binary file ---
binf="$tmpbase/bin.dat"
printf 'a\x00b\x00c' > "$binf"
out=$("$SCANNER" "$binf" 2>&1); rc=$?
if [ "$rc" -ne 0 ] && printf '%s\n' "$out" | grep -qi "binary file not inspected"; then
  ok "binary file reported"
else
  bad "binary file (rc=$rc)"; printf '%s\n' "$out" >&2
fi

# --- Benign file passes ---
echo 'const x = 1; // no secrets' > "$tmpbase/benign.ts"
run_expect 0 "$tmpbase/benign.ts"

# --- Multiple staged files ---
grepo="$tmpbase/grepo"
rm -rf "$grepo"; mkdir -p "$grepo"; cd "$grepo"
git init -q
git config user.email t@t.com; git config user.name t
echo ok > a.txt
echo ok2 > b.txt
git add a.txt b.txt
out=$("$SCANNER" --staged 2>&1); rc=$?
if [ "$rc" -eq 0 ]; then ok "multiple staged benign pass"; else bad "multiple staged benign (rc=$rc)"; printf '%s\n' "$out" >&2; fi

echo "$PW=$S_EXAMPLE" > c.txt
git add c.txt
out=$("$SCANNER" --staged 2>&1); rc=$?
if [ "$rc" -ne 0 ]; then ok "multiple staged with secret fails"; else bad "multiple staged with secret (rc=$rc)"; fi
cd "$ROOT"

# --- PCRE/tool unavailable (no grep) ---
emptybin="$tmpbase/emptybin"; mkdir -p "$emptybin"
echo 'hello' > "$tmpbase/p.txt"
PATH="$emptybin" /usr/bin/bash "$SCANNER" "$tmpbase/p.txt" >/tmp/scratchpad/out.txt 2>&1
rc=$?
if [ "$rc" -ne 0 ]; then ok "tool unavailable fails closed (exit $rc)"; else bad "tool unavailable did not fail"; fi

# --- Scanner failure non-zero on missing file ---
run_expect 1 "$tmpbase/does-not-exist.txt"

# --- No secret values in output ---
printf 'key="%s"\n' "$S_STRIPE" > "$tmpbase/secretout.txt"
out=$("$SCANNER" "$tmpbase/secretout.txt" 2>&1)
if printf '%s\n' "$out" | grep -qF "$S_STRIPE"; then
  bad "secret value leaked in output"
else
  ok "no secret values in output"
fi

# --- Hook installation in temp clone ---
clone="$tmpbase/clone"
rm -rf "$clone"; cp -a "$ROOT" "$clone"
cd "$clone"
"$clone/scripts/install-hooks.sh" >/tmp/scratchpad/hookinstall.txt 2>&1
rc=$?
hp=$(git config --get core.hooksPath)
if [ "$rc" -eq 0 ] && [ "$hp" = ".githooks" ] && [ -x "$clone/.githooks/pre-commit" ]; then
  ok "hook installation in temp clone"
else
  bad "hook installation (rc=$rc hooksPath=$hp)"
  cat /tmp/scratchpad/hookinstall.txt >&2
fi
printf 'pass%s=%s\n' "word" "$S_CLONE" > secretfile.txt
git add secretfile.txt
if git commit -m "test secret" >/tmp/scratchpad/commitout.txt 2>&1; then
  bad "hook did not block commit"
else
  if grep -qi "secrets scan\|BLOCKED" /tmp/scratchpad/commitout.txt; then
    ok "hook blocks commit with secret"
  else
    bad "commit failed but not due to scanner?"
    cat /tmp/scratchpad/commitout.txt >&2
  fi
fi
cd "$ROOT"

echo ""
echo "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -eq 0 ]; then exit 0; else exit 1; fi
