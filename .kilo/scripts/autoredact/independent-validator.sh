#!/usr/bin/env bash
# independent-validator.sh — Component E: Validates remediation results
# Re-runs scanner, verifies integrity, ensures no secret leaks
# Never exposes secret values in output.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMON="$SCRIPT_DIR/common.sh"

# shellcheck source=./common.sh
# shellcheck disable=SC1091
. "$COMMON"

SCANNER="$SCRIPT_DIR/../scan-secrets.sh"

# Initialize globals
FILE_PATH=""
EXPECTED_CHECKSUM=""

# Parse arguments
while [ $# -gt 0 ]; do
    case "$1" in
        --file)
            FILE_PATH="$2"
            shift 2
            ;;
        --expected-checksum)
            EXPECTED_CHECKSUM="$2"
            shift 2
            ;;
        --help|-h)
            cat <<'EOF'
Usage: independent-validator.sh --file <path> --expected-checksum <hex>
Validates remediation results.

Checks:
  - Target path exists and is regular file
  - Path is within AUTOREDACT_ROOT (no traversal)
  - Symlinks rejected
  - Checksum matches expected value
  - Scanner finds no NEW secret findings
  - Output does not contain secret patterns
  - Idempotent (re-run produces same result)

Output: STATUS=valid or STATUS=invalid
EOF
            exit 0
            ;;
        *)
            printf 'ERROR: unknown argument: %s\n' "$1" >&2
            exit 1
            ;;
    esac
done

# Validate required arguments
if [ -z "$FILE_PATH" ]; then
    printf 'ERROR: --file required\n' >&2
    exit 1
fi

if [ -z "$EXPECTED_CHECKSUM" ]; then
    printf 'ERROR: --expected-checksum required\n' >&2
    exit 1
fi

# Safety check: path must be within AUTOREDACT_ROOT (no traversal)
if ! autoredact_path_safe "$FILE_PATH"; then
    printf 'STATUS=invalid\n'
    exit 1
fi

# Safety check: file must exist and be regular (not symlink)
if ! autoredact_is_regular_file "$FILE_PATH"; then
    printf 'STATUS=invalid\n'
    exit 1
fi

# Check checksum (detect tampering or concurrent modification)
CURRENT_CHECKSUM=$(autoredact_sha256 "$FILE_PATH")
if [ -z "$CURRENT_CHECKSUM" ]; then
    printf 'STATUS=invalid\n'
    exit 1
fi

if [ "$CURRENT_CHECKSUM" != "$EXPECTED_CHECKSUM" ]; then
    printf 'STATUS=invalid\n'
    exit 1
fi

# Re-run scanner on affected file
SCANNER_OUTPUT=$("$SCANNER" "$FILE_PATH" 2>&1)
SCANNER_EXIT=$?

# If scanner found secrets, validation fails
if [ "$SCANNER_EXIT" -ne 0 ]; then
    printf 'STATUS=invalid\n'
    exit 1
fi

# Validate output does not contain secret patterns
if printf '%s\n' "$SCANNER_OUTPUT" | grep -qiE "sk_|AKIA|ghp_|whsec_|password=|secret=[\"']"; then
    printf 'STATUS=invalid\n'
    exit 1
fi

# All checks passed
printf 'STATUS=valid\n'
exit 0