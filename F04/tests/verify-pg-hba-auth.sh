#!/usr/bin/env bash
# Verification test for MP-F04-021: pg_hba.conf authentication method.
#
# Asserts:
#   1. F04/postgres/pg_hba.conf uses scram-sha-256 (not trust)
#   2. F04/docker-compose.yml postgres service does NOT set POSTGRES_HOST_AUTH_METHOD=trust
#   3. F04/docker-compose.yml postgres service keeps POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
#
# Exit code 0 when all assertions pass, non-zero otherwise.
set -euo pipefail

F04_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PG_HBA="${F04_DIR}/postgres/pg_hba.conf"
COMPOSE="${F04_DIR}/docker-compose.yml"

failures=0

assert_contains() {
  local file="$1" pattern="$2" label="$3"
  if grep -qE "$pattern" "$file"; then
    echo "PASS: $label (found in $file)"
  else
    echo "FAIL: $label (pattern '$pattern' not found in $file)"
    failures=$((failures + 1))
  fi
}

assert_not_contains() {
  local file="$1" pattern="$2" label="$3"
  if grep -qE "$pattern" "$file"; then
    echo "FAIL: $label (pattern '$pattern' unexpectedly found in $file)"
    failures=$((failures + 1))
  else
    echo "PASS: $label (pattern '$pattern' absent from $file)"
  fi
}

echo "=== MP-F04-021 pg_hba.conf authentication verification ==="

# 1. pg_hba.conf must use scram-sha-256 for all three connection lines
assert_contains "$PG_HBA" 'scram-sha-256' 'pg_hba.conf uses scram-sha-256'
assert_not_contains "$PG_HBA" '\btrust\b' 'pg_hba.conf does not use trust'

# 2. docker-compose.yml must not set POSTGRES_HOST_AUTH_METHOD=trust anywhere
assert_not_contains "$COMPOSE" 'POSTGRES_HOST_AUTH_METHOD=trust' 'docker-compose.yml does not set POSTGRES_HOST_AUTH_METHOD=trust'

# 3. postgres service must keep POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
assert_contains "$COMPOSE" 'POSTGRES_PASSWORD=\$\{POSTGRES_PASSWORD\}' 'docker-compose.yml keeps POSTGRES_PASSWORD env var reference'

echo ""
if [ "$failures" -eq 0 ]; then
  echo "RESULT: ALL CHECKS PASSED"
  exit 0
else
  echo "RESULT: $failures CHECK(S) FAILED"
  exit 1
fi
