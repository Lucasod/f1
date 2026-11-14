#!/usr/bin/env bash
# context-analyzer.sh — Component B: Classifies file locations and patterns
# Output: CLASSIFICATION=<value>
# Never exposes secret values in output.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMON="$SCRIPT_DIR/common.sh"

# shellcheck source=./common.sh
# shellcheck disable=SC1091
. "$COMMON"

# Initialize globals
FILE_PATH=""
LINE_NUM=""
CATEGORY=""
LABEL=""

# Parse arguments
while [ $# -gt 0 ]; do
    case "$1" in
        --file)
            FILE_PATH="$2"
            shift 2
            ;;
        --line)
            LINE_NUM="$2"
            shift 2
            ;;
        --category)
            CATEGORY="$2"
            shift 2
            ;;
        --label)
            LABEL="$2"
            shift 2
            ;;
        --help|-h)
            cat <<'EOF'
Usage: context-analyzer.sh --file <path> --line <n> --category <cat> --label <label>
Classifies files for remediation action. Output: CLASSIFICATION=<value>

Classifications (Component B output):
  REDACT                           Hardcoded secrets in source code
  REPLACE_WITH_SAFE_FIXTURE        Test/spec/fixtures files
  REFACTOR_TO_SECRET_REFERENCE     Auth headers, connection strings
  CONFIRMED_FALSE_POSITIVE         node_modules, .git, vendor files
  MANUAL_REVIEW_REQUIRED           Markdown files, unknown contexts
  BLOCKED_POTENTIAL_SECRET         Sensitive filenames
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

if [ -z "$LINE_NUM" ]; then
    printf 'ERROR: --line required\n' >&2
    exit 1
fi

if [ -z "$CATEGORY" ]; then
    printf 'ERROR: --category required\n' >&2
    exit 1
fi

if [ -z "$LABEL" ]; then
    printf 'ERROR: --label required\n' >&2
    exit 1
fi

# Get basename for filename checks
BASENAME="${FILE_PATH##*/}"
DIR_PATH="${FILE_PATH%/*}"

# Classification logic

# 1. Check for sensitive filenames (BLOCKED_POTENTIAL_SECRET)
case "$BASENAME" in
    .env|.env.*|*.pem|*.key|*.p12|*.pfx|id_rsa|id_dsa|id_ecdsa|id_ed25519|credentials.*|secrets.*|*.crt|*.cer)
        echo "CLASSIFICATION=$CLS_BLOCKED_POTENTIAL_B"
        exit 0
        ;;
esac

# 2. Check for false positive locations (node_modules, .git, vendor)
case "$FILE_PATH" in
    */node_modules/*|*/.git/*|*/vendor/*|*/bower_components/*)
        echo "CLASSIFICATION=$CLS_CONFIRMED_FALSE_POSITIVE"
        exit 0
        ;;
esac

# 3. Check for test/spec/fixture files (REPLACE_WITH_SAFE_FIXTURE)
case "$FILE_PATH" in
    */tests/*|*/__tests__/*|*/test/*|*.spec.*|*.test.*|*/fixtures/*|*/conftest.py|*/conftest.js|*/conftest.ts|*/test_*.py|*/test_*.js|*/test_*.ts|*/spec_*.py|*/spec_*.js|*/spec_*.ts)
        echo "CLASSIFICATION=$CLS_REPLACE_WITH_SAFE_FIXTURE"
        exit 0
        ;;
esac

# 4. Check for markdown files (MANUAL_REVIEW_REQUIRED)
case "$BASENAME" in
    *.md|*.mdx|*.markdown)
        echo "CLASSIFICATION=$CLS_MANUAL_REVIEW_REQUIRED"
        exit 0
        ;;
esac

# 5. Check for authorization headers (REFACTOR_TO_SECRET_REFERENCE)
if [ "$CATEGORY" = "Authorization headers" ]; then
    echo "CLASSIFICATION=$CLS_REFACTOR_TO_SECRET_REFERENCE"
    exit 0
fi

# 6. Check for connection strings in source (REDACT)
if [ "$CATEGORY" = "Connection strings" ]; then
    echo "CLASSIFICATION=$CLS_REDACT"
    exit 0
fi

# 7. Check for hardcoded secrets in source code (REDACT)
case "$CATEGORY" in
    "Passwords")
        echo "CLASSIFICATION=$CLS_REDACT"
        exit 0
        ;;
    "API keys/secrets/tokens")
        echo "CLASSIFICATION=$CLS_REDACT"
        exit 0
        ;;
    "Stripe keys")
        echo "CLASSIFICATION=$CLS_REDACT"
        exit 0
        ;;
    "Private keys")
        echo "CLASSIFICATION=$CLS_REDACT"
        exit 0
        ;;
    "Certificates")
        echo "CLASSIFICATION=$CLS_REDACT"
        exit 0
        ;;
    "GitHub tokens")
        echo "CLASSIFICATION=$CLS_REDACT"
        exit 0
        ;;
    "Slack tokens")
        echo "CLASSIFICATION=$CLS_REDACT"
        exit 0
        ;;
    "Session cookies")
        echo "CLASSIFICATION=$CLS_REDACT"
        exit 0
        ;;
    "Base64-encoded secrets")
        echo "CLASSIFICATION=$CLS_REDACT"
        exit 0
        ;;
    *)
        # 8. Unknown category -> MANUAL_REVIEW_REQUIRED
        echo "CLASSIFICATION=$CLS_MANUAL_REVIEW_REQUIRED"
        exit 0
        ;;
esac