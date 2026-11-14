#!/usr/bin/env bash
# test-runner.sh — Test runner for autoredact component tests.
# Runs all component tests; aggregates results.
# Never exposes secret values.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR"

PASS=0
FAIL=0

ok() { echo "PASS: $1"; PASS=$((PASS+1)); }
bad() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }

# Run each component test
echo "=== Running Component B Tests ==="
"$ROOT/test-context-analyzer.sh"
if [ $? -eq 0 ]; then
  echo "Component B: ALL PASSED"
else
  echo "Component B: SOME FAILED"
  bad "test-context-analyzer.sh"
fi

echo ""
echo "=== Running Component C Tests ==="
"$ROOT/test-remediation-planner.sh"
if [ $? -eq 0 ]; then
  echo "Component C: ALL PASSED"
else
  echo "Component C: SOME FAILED"
  bad "test-remediation-planner.sh"
fi

echo ""
echo "=== Running Component D Tests ==="
"$ROOT/test-safe-executor.sh"
if [ $? -eq 0 ]; then
  echo "Component D: ALL PASSED"
else
  echo "Component D: SOME FAILED"
  bad "test-safe-executor.sh"
fi

echo ""
echo "=== Running Component E Tests ==="
"$ROOT/test-independent-validator.sh"
if [ $? -eq 0 ]; then
  echo "Component E: ALL PASSED"
else
  echo "Component E: SOME FAILED"
  bad "test-independent-validator.sh"
fi

echo ""
echo "=== Test Runner Summary ==="
echo "Total: $PASS passed, $FAIL failed"

# Also run the main scanner test suite
echo ""
echo "=== Running Scanner Test Suite ==="
"$ROOT/../scan-secrets.sh" --test-suite 2>/dev/null
if [ $? -eq 0 ]; then
  echo "Scanner test suite: ALL PASSED"
else
  echo "Scanner test suite: SOME FAILED"
fi

if [ "$FAIL" -eq 0 ]; then
  echo ""
  echo "ALL TESTS PASSED"
  exit 0
else
  echo ""
  echo "SOME TESTS FAILED"
  exit 1
fi