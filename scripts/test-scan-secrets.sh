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
S_STRIPE_RK='rk_test_''FAKE1234567890abcdef'
S_STRIPE_WH='whsec_''FAKE1234567890abcdef'
S_GHPAT="github_pat_$(printf 'a%.0s' {1..85})"
S_CONN='mongodb:''//user:pass@host/db'
S_API='ABCDEFGHIJKLMNOP''QRSTUVWX'
S_AUTH='abcdefghijklmnop''qrstuv'
S_LONGVAL='abcdefghijklmnopqrstuvwxyz''012345'
S_B64='QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE='
S_EXAMPLE='example''Password'
S_CLONE='cloneSecret''Value'

# Pattern components (split to avoid self-triggering scanner)
CERT_BEGIN="-----BEGIN"
CERT_END="CERTIFICATE-----"
CERT_MARKER="${CERT_BEGIN} ${CERT_END}"

CONN_SCHEME="mongodb"
CONN_SEP="://"
CONN_AUTH="user:pass@host/db"
CONN_STR="${CONN_SCHEME}${CONN_SEP}${CONN_AUTH}"

PW_PART1="pass"
PW_PART2="word"
PW="${PW_PART1}${PW_PART2}"
PW_VAL='example''Password'

SID_PART1="session"
SID_PART2="id"
SID="${SID_PART1}${SID_PART2}"
SID_VAL='abcdefghijklmnopqrstuvwxyz''012345'

CK_PART1="Coo"
CK_PART2="kie"
CK="${CK_PART1}${CK_PART2}"

HCP_PREFIX="handleChange"
HCP="${HCP_PREFIX}${PW_PART1}${PW_PART2}"

# Backtick-wrapped fixtures (constructed dynamically)
BT_CERT=$(printf '`%s`' "$CERT_MARKER")
BT_CONN=$(printf '`%s`' "$CONN_STR")
BT_PW=$(printf '`%s`' "${PW}=${PW_VAL}")
BT_SESS=$(printf '`%s`' "${SID}=\"${SID_VAL}\"")
BT_COOKIE=$(printf '`Cookie: %s`' "$SID_VAL")

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

check_no_detect() {
  label="$1"; fn="$2"; content="$3"
  printf '%s\n' "$content" > "$td/$fn"
  out=$("$SCANNER" "$td/$fn" 2>&1)
  rc=$?
  if [ "$rc" -eq 0 ] && ! printf '%s\n' "$out" | grep -qi "BLOCKED"; then
    ok "no-detect: $label"
  else
    bad "no-detect: $label (rc=$rc)"
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
check_detect "Password" "pw.txt" "$PW=\"$S_EXAMPLE\""
check_detect "API key" "api.txt" "api_key=\"$S_API\""
check_detect "Authorization" "auth.txt" "Authorization: Bearer $S_AUTH"
CK="Coo""kie"
SID="session""id"
check_detect "Session cookie" "cookie.txt" "$CK: $SID=\"$S_LONGVAL\""
printf '%s\n' '-----BEGIN'' CERTIFICATE-----' > "$td/cert.txt"
check_detect "Certificate" "cert.txt" "-----BEGIN"''" CERTIFICATE-----"
check_detect "Base64" "b64.txt" "secret=$S_B64"
check_detect "Stripe restricted key" "rk.txt" "key=$S_STRIPE_RK"
check_detect "Stripe webhook secret" "wh.txt" "whsec=$S_STRIPE_WH"
check_detect "GitHub fine-grained PAT" "ghpat.txt" "token=$S_GHPAT"

# --- Regression: false positives (should NOT detect) ---
check_no_detect "FP session Stripe checkout" "fp_session.ts" "const ${SID} = event.data.object as Stripe.Checkout.Session;"
check_no_detect "FP handleChangePassword" "fp_hcp.ts" "const ${HCP} = useCallback(() => {"
check_no_detect "FP currentPassword state" "fp_cp.ts" "const [currentPassword, setCurrentPassword] = useState('');"
check_no_detect "FP newPassword state" "fp_np.ts" "const [newPassword, setNewPassword] = useState('');"
check_no_detect "FP confirmPassword state" "fp_cfp.ts" "const [confirmPassword, setConfirmPassword] = useState('');"
check_no_detect "FP type password" "fp_type.html" "type=\"password\""
check_no_detect "FP value currentPassword" "fp_val.tsx" "value={currentPassword}"
check_no_detect "FP token function call" "fp_tokenfn.ts" "const token = getToken();"
check_no_detect "FP secret function call" "fp_secretfn.ts" "const secret = getSecret();"

# --- Regression: true positives (should still detect) ---
check_detect "Password" "tp_pw.txt" "password = \"mySecret123\""
check_detect "Session" "tp_sess.txt" "session = \"abc123def456ghi789jklmno\""
check_detect "Password" "tp_cp.txt" "currentPassword = \"secretValue\""
check_detect "Password" "tp_cfg.txt" "config.password = \"mySecret123\""
check_detect "Generic secret" "tp_cfgtok.txt" "config.token = \"secretvalue\""

# --- MP-32: backtick inline code stripping (should NOT detect) ---
check_no_detect "Backtick cert" "bt_cert.md" "$BT_CERT"
check_no_detect "Backtick conn" "bt_conn.md" "$BT_CONN"
check_no_detect "Backtick password" "bt_pw.md" "$BT_PW"
check_no_detect "Backtick session" "bt_sess.md" "$BT_SESS"

# --- MP-32: additional backtick negative cases for remaining patterns ---
PK_LINE='-----BEGIN'' RSA PRIVATE KEY-----'
BT_STRIPE_SK='`'"$S_STRIPE"'`'
BT_STRIPE_RK='`'"$S_STRIPE_RK"'`'
BT_STRIPE_WH='`'"$S_STRIPE_WH"'`'
BT_AWS='`'"$S_AWS"'`'
BT_GH='`'"$S_GH"'`'
BT_GHPAT='`'"$S_GHPAT"'`'
BT_SLACK='`'"$S_SLACK"'`'
BT_PK='`'"$PK_LINE"'`'
BT_API='`api_key="'"$S_API"'"`'
BT_GENERIC='`secret="'"$S_LONGVAL"'"`'
BT_AUTH='`Authorization: Bearer '"$S_AUTH"'`'
BT_COOKIE=$(printf '`Cookie: %s`' "$SID_VAL")
BT_B64='`secret='"$S_B64"'`'

check_no_detect "Backtick stripe sk" "bt_stripe_sk.md" "$BT_STRIPE_SK"
check_no_detect "Backtick stripe rk" "bt_stripe_rk.md" "$BT_STRIPE_RK"
check_no_detect "Backtick stripe wh" "bt_stripe_wh.md" "$BT_STRIPE_WH"
check_no_detect "Backtick aws" "bt_aws.md" "$BT_AWS"
check_no_detect "Backtick github" "bt_gh.md" "$BT_GH"
check_no_detect "Backtick github pat" "bt_ghpat.md" "$BT_GHPAT"
check_no_detect "Backtick slack" "bt_slack.md" "$BT_SLACK"
check_no_detect "Backtick private key" "bt_pk.md" "$BT_PK"
check_no_detect "Backtick api key" "bt_api2.md" "$BT_API"
check_no_detect "Backtick generic secret" "bt_gen.md" "$BT_GENERIC"
check_no_detect "Backtick authorization" "bt_auth2.md" "$BT_AUTH"
check_no_detect "Backtick session cookie" "bt_cookie.md" "$BT_COOKIE"
check_no_detect "Backtick base64" "bt_b64.md" "$BT_B64"

# --- MP-32: real secrets without backticks (should still detect) ---
check_detect "Certificate" "rt_cert.md" "$CERT_MARKER"
check_detect "Connection string" "rt_conn.md" "DB=${CONN_STR}"
check_detect "Password" "rt_pw.md" "${PW}=\"${PW_VAL}\""
check_detect "Session" "rt_sess.md" "${SID} = \"${SID_VAL}\""

# --- MP-32: mixed content (backtick example + real secret) ---
check_detect "Password" "mixed_bt.md" "docs: \`example\` real: ${PW} = \"secret123\""
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

# --- Directory input rejected ---
dirf="$tmpbase/somedir"
mkdir -p "$dirf"
out=$("$SCANNER" "$dirf" 2>&1); rc=$?
if [ "$rc" -ne 0 ] && printf '%s\n' "$out" | grep -qi "not a regular file"; then
  ok "directory input rejected"
else
  bad "directory input (rc=$rc)"; printf '%s\n' "$out" >&2
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

echo "$PW=\"$S_EXAMPLE\"" > c.txt
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

# --- Staged mode fails closed on git error ---
nongit="$tmpbase/nongitdir"
mkdir -p "$nongit"
out=$(cd "$nongit" && "$SCANNER" --staged 2>&1); rc=$?
if [ "$rc" -eq 2 ]; then
  ok "staged git error fails closed (exit 2)"
else
  bad "staged git error (expected 2 got $rc)"; printf '%s\n' "$out" >&2
fi

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
printf 'pass%s="%s"\n' "word" "$S_CLONE" > secretfile.txt
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
