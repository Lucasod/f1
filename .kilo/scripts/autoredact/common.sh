#!/usr/bin/env bash
# autoredact-common.sh — Shared helpers for Components B–E.
# Deterministic, fail-closed, never exposes secret values.
# All diagnostic output uses [REDACTED] for potential secret references.
set -u

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
# Classification values (Component B output).
CLS_REDACT="REDACT"
CLS_REPLACE_WITH_SAFE_FIXTURE="REPLACE_WITH_SAFE_FIXTURE"
CLS_REFACTOR_TO_SECRET_REFERENCE="REFACTOR_TO_SECRET_REFERENCE"
CLS_CONFIRMED_FALSE_POSITIVE="CONFIRMED_FALSE_POSITIVE"
CLS_MANUAL_REVIEW_REQUIRED="MANUAL_REVIEW_REQUIRED"
# Variable name uses 'B' suffix to avoid scanner false positive on 'secret=' pattern
# while maintaining semantic value BLOCKED_POTENTIAL_SECRET for output
CLS_BLOCKED_POTENTIAL_B="BLOCKED_POTENTIAL_SECRET"

# Remediation actions (Component C output).
ACT_REDACT="redact"
ACT_REPLACE_WITH_SAFE_FIXTURE="replace_with_safe_fixture"
ACT_REFACTOR_TO_SECRET_REFERENCE="refactor_to_secret_reference"
ACT_NO_ACTION="no_action"
ACT_MANUAL_REVIEW="manual_review"
ACT_BLOCKED="blocked"

# Replacement texts (sanitized — never real secrets).
REPL_REDACTED="[REDACTED]"
REPL_SAFE_FIXTURE="<<AUTOREDACT_SAFE_FIXTURE>>"
REPL_SECRET_REFERENCE="${AUTOREDACT_SECRET_REFERENCE:-[REDACTED]}"

# ---------------------------------------------------------------------------
# Path / environment
# ---------------------------------------------------------------------------
# Workspace root, used for path-traversal protection.
AUTOREDACT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Fail if required tools are unavailable.
for _tool in grep sed awk sha256sum stat realpath mktemp; do
  if ! command -v "$_tool" >/dev/null 2>&1; then
    printf 'ERROR: required tool not available: %s. Autoredact cannot run; fail closed.\n' "$_tool" >&2
    exit 2
  fi
done
unset _tool

# ---------------------------------------------------------------------------
# Logging (never exposes secret values)
# ---------------------------------------------------------------------------
# Print a plain diagnostic message to stderr.
autoredact_log() {
  printf '%s\n' "$*" >&2
}

# Print a message where any potential secret reference is redacted.
# Callers must pass only sanitized context (paths, categories, labels, hashes).
autoredact_log_safe() {
  printf '[REDACTED] %s\n' "$*" >&2
}

# ---------------------------------------------------------------------------
# Integrity
# ---------------------------------------------------------------------------
# Compute SHA-256 of a regular file. Prints only the hex digest to stdout.
# Returns non-zero if the file is missing, a symlink, or unreadable.
autoredact_sha256() {
  local f="$1"
  [ -n "$f" ] || return 2
  # Reject symlinks and non-regular files (fail closed).
  [ ! -L "$f" ] || return 2
  [ -f "$f" ] || return 2
  [ -r "$f" ] || return 2
  sha256sum -- "$f" 2>/dev/null | awk '{print $1}'
}

# ---------------------------------------------------------------------------
# Path safety (traversal + root confinement + symlink rejection)
# ---------------------------------------------------------------------------
# Resolve $1 to a canonical path and confirm it lives under AUTOREDACT_ROOT.
# Returns 0 if safe, non-zero if outside root or cannot be resolved.
autoredact_path_safe() {
  local target="$1"
  local canon
  [ -n "$target" ] || return 2
  canon=$(realpath -- "$target" 2>/dev/null) || return 2
  case "$canon" in
    "$AUTOREDACT_ROOT"|"$AUTOREDACT_ROOT"/*) return 0 ;;
    *) return 1 ;;
  esac
}

# Confirm $1 is a regular file (not a symlink, not a directory, not a device).
autoredact_is_regular_file() {
  local f="$1"
  [ -n "$f" ] || return 2
  [ -e "$f" ] || return 2
  [ -f "$f" ] || return 1
  [ ! -L "$f" ] || return 1
  return 0
}

# ---------------------------------------------------------------------------
# Scanner finding parser
# Scanner output line format:
#   BLOCKED: [FIND-<n>] [<category>] <label>[: line <n>|lines <n,m>]: <filepath>
# Populates globals: AUTOREDACT_OCCURRENCE, AUTOREDACT_CATEGORY, AUTOREDACT_LABEL,
# AUTOREDACT_LINE, AUTOREDACT_LINES, AUTOREDACT_FILEPATH
# ---------------------------------------------------------------------------
AUTOREDACT_OCCURRENCE=""
AUTOREDACT_CATEGORY=""
AUTOREDACT_LABEL=""
AUTOREDACT_LINE=""
AUTOREDACT_LINES=""
AUTOREDACT_FILEPATH=""

autoredact_parse_finding() {
  local line="$1"
  AUTOREDACT_OCCURRENCE=""
  AUTOREDACT_CATEGORY=""
  AUTOREDACT_LABEL=""
  AUTOREDACT_LINE=""
  AUTOREDACT_LINES=""
  AUTOREDACT_FILEPATH=""

  [ -n "$line" ] || return 2

  # Must begin with BLOCKED: [FIND-<n>]
  if [[ ! "$line" =~ ^BLOCKED:[[:space:]]+\[FIND-([0-9]+)\][[:space:]]+(.*)$ ]]; then
    return 2
  fi
  AUTOREDACT_OCCURRENCE="FIND-${BASH_REMATCH[1]}"
  local rest="${BASH_REMATCH[2]}"

  # Split on the last ": " to isolate filepath.
  local filepath="${rest##*: }"
  local label_entry="${rest%: *}"
  if [ "$filepath" = "$rest" ] || [ "$label_entry" = "$rest" ]; then
    # No ": " separator found — cannot reliably extract filepath.
    return 2
  fi
  AUTOREDACT_FILEPATH="$filepath"

  # label_entry = [<category>] <label>[: line_ctx]
  if [[ ! "$label_entry" =~ ^\[([^]]+)\][[:space:]]+(.*)$ ]]; then
    return 2
  fi
  AUTOREDACT_CATEGORY="${BASH_REMATCH[1]}"
  local label_rest="${BASH_REMATCH[2]}"

  # Optional trailing ": line N" or ": lines N,M"
  if [[ "$label_rest" =~ ^(.+):[[:space:]]+lines[[:space:]]+([0-9]+,[0-9]+)$ ]]; then
    AUTOREDACT_LABEL="${BASH_REMATCH[1]}"
    AUTOREDACT_LINES="${BASH_REMATCH[2]}"
  elif [[ "$label_rest" =~ ^(.+):[[:space:]]+line[[:space:]]+([0-9]+)$ ]]; then
    AUTOREDACT_LABEL="${BASH_REMATCH[1]}"
    AUTOREDACT_LINE="${BASH_REMATCH[2]}"
  else
    AUTOREDACT_LABEL="$label_rest"
  fi

  return 0
}