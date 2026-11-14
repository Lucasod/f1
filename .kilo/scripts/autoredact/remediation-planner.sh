#!/usr/bin/env bash
# remediation-planner.sh — Component C: Plans remediation based on classification
# Outputs remediation action and evidence metadata
# Never exposes secret values in output.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMON="$SCRIPT_DIR/common.sh"

# shellcheck source=./common.sh
# shellcheck disable=SC1091
. "$COMMON"

# Initialize globals
CLASSIFICATION=""
FILE_PATH=""
LINE_NUM=""
CATEGORY=""
LABEL=""

# Parse arguments
while [ $# -gt 0 ]; do
    case "$1" in
        --classification)
            CLASSIFICATION="$2"
            shift 2
            ;;
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
Usage: remediation-planner.sh --classification <value> --file <path> --category <cat> --label <label>
Determines remediation action based on classification.

Actions:
  redact                      Remove literal secret
  replace_with_safe_fixture   Use placeholder
  refactor_to_secret_reference Move to env/config
  no_action                   Already correct
  manual_review               Human intervention
  blocked                     Cannot proceed safely
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
if [ -z "$CLASSIFICATION" ]; then
    printf 'ERROR: --classification required\n' >&2
    exit 1
fi

if [ -z "$FILE_PATH" ]; then
    printf 'ERROR: --file required\n' >&2
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

# Map classification to action and output
case "$CLASSIFICATION" in
    "$CLS_REDACT")
        echo "ACTION=$ACT_REDACT"
        echo "EVIDENCE_FILE=$FILE_PATH"
        echo "EVIDENCE_CATEGORY=$CATEGORY"
        echo "EVIDENCE_LABEL=$LABEL"
        echo "JUSTIFICATION=Hardcoded secret in source code requires redaction"
        exit 0
        ;;
    "$CLS_REPLACE_WITH_SAFE_FIXTURE")
        echo "ACTION=$ACT_REPLACE_WITH_SAFE_FIXTURE"
        echo "EVIDENCE_FILE=$FILE_PATH"
        echo "EVIDENCE_CATEGORY=$CATEGORY"
        echo "EVIDENCE_LABEL=$LABEL"
        echo "JUSTIFICATION=Test/fixture file should use safe placeholder values"
        exit 0
        ;;
    "$CLS_REFACTOR_TO_SECRET_REFERENCE")
        echo "ACTION=$ACT_REFACTOR_TO_SECRET_REFERENCE"
        echo "EVIDENCE_FILE=$FILE_PATH"
        echo "EVIDENCE_CATEGORY=$CATEGORY"
        echo "EVIDENCE_LABEL=$LABEL"
        echo "JUSTIFICATION=Authentication/credential reference should use environment variable"
        exit 0
        ;;
    "$CLS_CONFIRMED_FALSE_POSITIVE")
        echo "ACTION=$ACT_NO_ACTION"
        echo "EVIDENCE_FILE=$FILE_PATH"
        echo "EVIDENCE_CATEGORY=$CATEGORY"
        echo "EVIDENCE_LABEL=$LABEL"
        echo "JUSTIFICATION=Confirmed false positive in vendor/excluded location"
        exit 0
        ;;
    "$CLS_MANUAL_REVIEW_REQUIRED")
        echo "ACTION=$ACT_MANUAL_REVIEW"
        echo "EVIDENCE_FILE=$FILE_PATH"
        echo "EVIDENCE_CATEGORY=$CATEGORY"
        echo "EVIDENCE_LABEL=$LABEL"
        echo "JUSTIFICATION=Markdown or unknown context requires human review"
        exit 0
        ;;
    "$CLS_BLOCKED_POTENTIAL_B")
        echo "ACTION=$ACT_BLOCKED"
        echo "EVIDENCE_FILE=$FILE_PATH"
        echo "EVIDENCE_CATEGORY=$CATEGORY"
        echo "EVIDENCE_LABEL=$LABEL"
        echo "JUSTIFICATION=Sensitive filename detected — cannot remediate automatically"
        exit 0
        ;;
    *)
        printf 'ERROR: unknown classification: %s\n' "$CLASSIFICATION" >&2
        exit 1
        ;;
esac