#!/usr/bin/env bash
# safe-executor.sh — Component D: Executes remediation actions safely
# Deterministic, location-specific changes only
# Never exposes secret values in output or logs.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMON="$SCRIPT_DIR/common.sh"

# shellcheck source=./common.sh
# shellcheck disable=SC1091
. "$COMMON"

# Initialize globals
FILE_PATH=""
START_LINE=""
END_LINE=""
REPLACEMENT=""
EXPECTED_CHECKSUM=""

# Parse arguments
while [ $# -gt 0 ]; do
    case "$1" in
        --file)
            FILE_PATH="$2"
            shift 2
            ;;
        --start-line)
            START_LINE="$2"
            shift 2
            ;;
        --end-line)
            END_LINE="$2"
            shift 2
            ;;
        --replacement)
            REPLACEMENT="$2"
            shift 2
            ;;
        --expected-checksum)
            EXPECTED_CHECKSUM="$2"
            shift 2
            ;;
        --help|-h)
            cat <<'EOF'
Usage: safe-executor.sh --file <path> --start-line <n> --end-line <m> --replacement <text> --expected-checksum <hex>
Executes remediation by replacing lines [start..end] with replacement text.

Safety checks:
  - Target path exists and is regular file
  - Path is within AUTOREDACT_ROOT (no traversal)
  - Symlinks rejected
  - Atomic read-modify-write pattern
  - Checksum validation (concurrent modification protection)
  - Line range bounds validation

Output: STATUS=ok or STATUS=error
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

if [ -z "$START_LINE" ]; then
    printf 'ERROR: --start-line required\n' >&2
    exit 1
fi

if [ -z "$END_LINE" ]; then
    printf 'ERROR: --end-line required\n' >&2
    exit 1
fi

if [ -z "$REPLACEMENT" ]; then
    printf 'ERROR: --replacement required\n' >&2
    exit 1
fi

if [ -z "$EXPECTED_CHECKSUM" ]; then
    printf 'ERROR: --expected-checksum required\n' >&2
    exit 1
fi

# Validate line numbers are positive integers
if ! [[ "$START_LINE" =~ ^[0-9]+$ ]] || [ "$START_LINE" -lt 1 ]; then
    printf 'STATUS=error\n'
    exit 1
fi

if ! [[ "$END_LINE" =~ ^[0-9]+$ ]] || [ "$END_LINE" -lt 1 ]; then
    printf 'STATUS=error\n'
    exit 1
fi

if [ "$START_LINE" -gt "$END_LINE" ]; then
    printf 'STATUS=error\n'
    exit 1
fi

# Safety check: path must be within AUTOREDACT_ROOT (no traversal)
if ! autoredact_path_safe "$FILE_PATH"; then
    printf 'STATUS=error\n'
    exit 1
fi

# Safety check: file must exist and be regular (not symlink)
if ! autoredact_is_regular_file "$FILE_PATH"; then
    printf 'STATUS=error\n'
    exit 1
fi

# Get current checksum
CURRENT_CHECKSUM=$(autoredact_sha256 "$FILE_PATH")
if [ -z "$CURRENT_CHECKSUM" ]; then
    printf 'STATUS=error\n'
    exit 1
fi

# Validate checksum (concurrent modification protection)
if [ "$CURRENT_CHECKSUM" != "$EXPECTED_CHECKSUM" ]; then
    printf 'STATUS=error\n'
    exit 1
fi

# Get line count
LINE_COUNT=$(wc -l < "$FILE_PATH" 2>/dev/null)
if [ -z "$LINE_COUNT" ]; then
    printf 'STATUS=error\n'
    exit 1
fi

# Validate line range is within file bounds
if [ "$END_LINE" -gt "$LINE_COUNT" ]; then
    printf 'STATUS=error\n'
    exit 1
fi

# Store original permissions
ORIGINAL_PERMS=$(stat -c '%a' "$FILE_PATH")

# Create temporary file for atomic write
TMP_FILE=$(mktemp 2>/dev/null) || {
    printf 'STATUS=error\n' >&2
    exit 1
}

# Perform atomic read-modify-write
{
    # Read lines 1 to (start_line - 1)
    head -n $((START_LINE - 1)) "$FILE_PATH" 2>/dev/null
    # Write replacement text
    printf '%s\n' "$REPLACEMENT"
    # Read lines (end_line + 1) to end
    tail -n +$((END_LINE + 1)) "$FILE_PATH" 2>/dev/null
} > "$TMP_FILE"

# Verify temp file was created
if [ ! -f "$TMP_FILE" ]; then
    printf 'STATUS=error\n' >&2
    exit 1
fi

# Restore original permissions on temp file before move
chmod "$ORIGINAL_PERMS" "$TMP_FILE" 2>/dev/null || true

# Atomic move
mv "$TMP_FILE" "$FILE_PATH"

printf 'STATUS=ok\n'
exit 0