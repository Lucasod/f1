#!/usr/bin/env bash
# Shareable secret scanner (MP-31D).
# Scans staged files (--staged, default) or files passed as arguments.
# Prints only file paths + pattern labels + categories. Never prints matched values.
# Exits 0 if clean, non-zero if findings or operational failure.

set -u

# Prerequisite tools: fail closed if unavailable.
for tool in grep sed tr wc; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'ERROR: required tool not available: %s. Scan cannot run; commit blocked.\n' "$tool" >&2
    exit 2
  fi
done

# ---------------------------------------------------------------------------
# Pattern table: "CATEGORY<TAB>LABEL<TAB>ERE-regex"
# Uses POSIX ERE (grep -E). No PCRE.
# Split literals (avoid self-flagging when scanning this file)
PK_RE='-----BEGIN'' (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----'
CERT_RE='-----BEGIN'' CERTIFICATE-----'

# ---------------------------------------------------------------------------
PATTERNS=(
  $'Stripe keys\tStripe secret key\tsk_(test|live|rk)_[A-Za-z0-9]{16,}'
  $'Stripe keys\tStripe restricted key\trk_(test|live)_[A-Za-z0-9]{16,}'
  $'Stripe keys\tStripe webhook secret\twhsec_[A-Za-z0-9]{16,}'
  $'AWS access keys\tAWS access key id\t(AKIA|ASIA)[0-9A-Z]{16}'
  $'GitHub tokens\tGitHub token\tgh[pousr]_[A-Za-z0-9]{36,}'
  $'GitHub tokens\tGitHub fine-grained PAT\tgithub_pat_[A-Za-z0-9_]{80,}'
  $'Slack tokens\tSlack token\txox[baprs]-[A-Za-z0-9-]{10,}'
  "Private keys"$'\t'"Private key block"$'\t'"$PK_RE"
  "Certificates"$'\t'"Certificate block"$'\t'"$CERT_RE"
  $'Connection strings\tConnection string with credentials\t[a-zA-Z][a-zA-Z0-9+.-]*://[^[:space:]/:@]+:[^[:space:]/@]+@'
  $'Passwords\tPassword assignment\t(^|[^[:alnum:]_])(password|passwd|pwd)[[:space:]]*[:=][[:space:]]*["'\''][^"'\''[:space:]]{4,}'
  $'API keys/secrets/tokens\tAPI key assignment\t(api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|api[_-]?secret)[[:space:]]*[:=][[:space:]]*["'\''][^"'\''[:space:]]{8,}'
  $'API keys/secrets/tokens\tGeneric secret assignment\t(secret|token)[[:space:]]*[:=][[:space:]]*["'\''][^"'\''[:space:]]{8,}'
  $'Authorization headers\tAuthorization header\t(Authorization|authorization)[[:space:]]*[:=][[:space:]]*(Basic|Bearer|Token)[[:space:]]+[A-Za-z0-9._+/=-]{8,}'
  $'Session cookies\tSession cookie\t(Set-Cookie|Cookie)[[:space:]]*[:=][[:space:]]*[^[:space:]]{16,}'
  $'Session cookies\tSession id assignment\t(sessionid|session_id|session)[[:space:]]*[:=][[:space:]]*["'\''][^"'\''[:space:]]{16,}'
  $'Base64-encoded secrets\tBase64 secret assignment\t(secret|token|key|password|passwd)[[:space:]]*[:=][[:space:]]*["'\'']?[A-Za-z0-9+/]{32,}={0,2}["'\'']?'
)

# Sensitive filename check. Returns 0 if sensitive (blocked).
is_sensitive_name() {
  base="$1"
  # allowlist *.example
  case "$base" in
    *.example) return 1 ;;
  esac
  case "$base" in
    .env|.env.*) return 0 ;;
    *.pem|*.key|*.p12|*.pfx) return 0 ;;
    id_rsa|id_dsa|id_ecdsa|id_ed25519) return 0 ;;
    credentials.*|secrets.*) return 0 ;;
    *.crt|*.cer) return 0 ;;
  esac
  return 1
}

# Determine whether a file is markdown (by extension). Backtick stripping
# applies only to markdown files to avoid under-detecting secrets in
# template literals in non-markdown files (CR-002).
is_markdown_file() {
  f="$1"
  base="${f##*/}"
  case "$base" in
    *.[Mm][Dd]|*.[Mm][Dd][Xx]|*.[Mm][Aa][Rr][Kk][Dd][Oo][Ww][Nn]) return 0 ;;
  esac
  return 1
}

is_binary_file() {
  f="$1"
  [ -f "$f" ] || return 2
  original_bytes=$(LC_ALL=C wc -c < "$f" 2>/dev/null) || return 2
  text_bytes=$(set -o pipefail; LC_ALL=C tr -d '\000' < "$f" 2>/dev/null | LC_ALL=C wc -c 2>/dev/null) || return 2
  [[ "$original_bytes" =~ ^[[:space:]]*[0-9]+[[:space:]]*$ && "$text_bytes" =~ ^[[:space:]]*[0-9]+[[:space:]]*$ ]] || return 2
  if [ "$original_bytes" -ne "$text_bytes" ]; then return 0; fi
  return 1
}

# Content scan for a single file. Sets FOUND_LABELS (newline list) via global.
FOUND_LABELS=""

scan_text_content() {
  # $1 = file containing the snapshot; $2 = original name for format detection.
  scan_path="$1"
  scan_name="$2"
  FOUND_LABELS=""
  content=$(cat "$scan_path" 2>/dev/null) || return 1

  # Strip inline code spans (backtick-quoted content) to avoid
  # false positives from documentation examples. This is a general
  # heuristic applied ONLY to markdown files; non-markdown files are
  # scanned in full to avoid under-detection in template literals.
  if is_markdown_file "$scan_name"; then
    content_stripped=$(printf '%s\n' "$content" | sed 's/`[^`]*`//g' 2>/dev/null) || return 1
  else
    content_stripped="$content"
  fi

  for entry in "${PATTERNS[@]}"; do
    category="${entry%%$'\t'*}"
    rest="${entry#*$'\t'}"
    label="${rest%%$'\t'*}"
    regex="${rest#*$'\t'}"
    printf '%s\n' "$content_stripped" | grep -iE -- "$regex" >/dev/null 2>&1
    match_status=$?
    if [ "$match_status" -eq 0 ]; then
      if [ -z "$FOUND_LABELS" ]; then
        FOUND_LABELS="[$category] $label"
      else
        FOUND_LABELS="$FOUND_LABELS"$'\n'"[$category] $label"
      fi
    elif [ "$match_status" -ne 1 ]; then
      return 1
    fi
  done
  return 0
}

found=0

cleanup_temp() {
  if ! rm -f -- "$temp_pending" 2>/dev/null; then
    printf 'ERROR: temporary file cleanup failed; scan blocked.\n' >&2
    return 1
  fi
}

cleanup_on_exit() {
  exit_status=$?
  cleanup_temp || exit_status=2
  exit "$exit_status"
}

# Determine mode
mode="staged"
file_args=()
for arg in "$@"; do
  case "$arg" in
    --staged) mode="staged" ;;
    --help|-h)
      cat <<'EOF'
Usage: scan-secrets.sh [--staged] [file ...]
  --staged   Scan git staged files (default when no files given).
  file ...   Scan the given files.
Exits 0 if clean, non-zero if findings.
EOF
      exit 0
      ;;
    *) file_args+=("$arg"); mode="files" ;;
  esac
done

if [ "$mode" = "staged" ] && [ ${#file_args[@]} -eq 0 ]; then
  if ! command -v git >/dev/null 2>&1; then
    printf 'ERROR: git not available; staged scan cannot run.\n' >&2
    exit 2
  fi
  # staged file list
  staged_tmp=$(mktemp 2>/dev/null) || {
    printf 'ERROR: cannot create temp file for staged scan.\n' >&2
    exit 2
  }
  temp_pending="$staged_tmp"
  trap cleanup_on_exit EXIT
  git diff --cached --name-only -z --diff-filter=ACMR >"$staged_tmp" 2>/dev/null
  git_rc=$?
  if [ "$git_rc" -ne 0 ]; then
    printf 'ERROR: git diff --cached failed (exit %d); staged scan cannot run.\n' "$git_rc" >&2
    exit 2
  fi
  staged_files=()
  while IFS= read -r -d '' f; do
    staged_files+=("$f")
  done < "$staged_tmp"
  cleanup_temp || exit 2
  trap - EXIT
  if [ ${#staged_files[@]} -eq 0 ]; then
    # nothing staged; clean
    exit 0
  fi
  for f in "${staged_files[@]}"; do
    base="${f##*/}"
    if is_sensitive_name "$base"; then
      printf 'BLOCKED: [Sensitive file] sensitive file name: %s\n' "$f" >&2
      found=1
      continue
    fi
    staged_name="$f"
    staged_content=$(mktemp 2>/dev/null) || {
      printf 'ERROR: cannot create temp file for staged content.\n' >&2
      exit 2
    }
    temp_pending="$staged_content"
    trap cleanup_on_exit EXIT
    if ! git show ":$staged_name" >"$staged_content" 2>/dev/null; then
      printf 'ERROR: cannot read staged content: %s\n' "$staged_name" >&2
      exit 2
    fi
    is_binary_file "$staged_content"
    binary_status=$?
    if [ "$binary_status" -eq 0 ]; then
      cleanup_temp || exit 2
      trap - EXIT
      printf 'BLOCKED: [Binary file] binary file not inspected: %s\n' "$staged_name" >&2
      found=1
      continue
    elif [ "$binary_status" -ne 1 ]; then
      printf 'ERROR: cannot inspect staged content: %s\n' "$staged_name" >&2
      exit 2
    fi
    if ! scan_text_content "$staged_content" "$staged_name"; then
      printf 'ERROR: cannot scan staged snapshot: %s\n' "$staged_name" >&2
      exit 2
    fi
    cleanup_temp || exit 2
    trap - EXIT
    if [ -n "$FOUND_LABELS" ]; then
      while IFS= read -r lbl; do
        [ -z "$lbl" ] && continue
        printf 'BLOCKED: %s: %s\n' "$lbl" "$staged_name" >&2
      done <<< "$FOUND_LABELS"
      found=1
    fi
  done
else
  for f in "${file_args[@]}"; do
    if [ ! -e "$f" ]; then
      printf 'ERROR: file not found: %s\n' "$f" >&2
      found=1
      continue
    fi
    if [ ! -f "$f" ]; then
      printf 'ERROR: not a regular file: %s\n' "$f" >&2
      found=1
      continue
    fi
    base="${f##*/}"
    if is_sensitive_name "$base"; then
      printf 'BLOCKED: [Sensitive file] sensitive file name: %s\n' "$f" >&2
      found=1
      continue
    fi
    is_binary_file "$f"
    binary_status=$?
    if [ "$binary_status" -eq 0 ]; then
      printf 'BLOCKED: [Binary file] binary file not inspected: %s\n' "$f" >&2
      found=1
      continue
    elif [ "$binary_status" -ne 1 ]; then
      printf 'ERROR: cannot inspect file: %s\n' "$f" >&2
      exit 2
    fi
    if ! scan_text_content "$f" "$f"; then
      printf 'ERROR: cannot scan file: %s\n' "$f" >&2
      exit 2
    fi
    if [ -n "$FOUND_LABELS" ]; then
      while IFS= read -r lbl; do
        [ -z "$lbl" ] && continue
        printf 'BLOCKED: %s: %s\n' "$lbl" "$f" >&2
      done <<< "$FOUND_LABELS"
      found=1
    fi
  done
fi

if [ "$found" -ne 0 ]; then
  printf '\nCommit aborted by local secrets scan. Remove the secret, rotate if exposed, and retry.\n' >&2
  exit 1
fi
exit 0
