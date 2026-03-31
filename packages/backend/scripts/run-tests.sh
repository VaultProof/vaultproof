#!/usr/bin/env bash
#
# Runs the backend test suite and POSTs results to the admin API.
# Usage: ADMIN_TOKEN="..." BACKEND_URL="..." ./scripts/run-tests.sh
#
# ADMIN_TOKEN = Supabase access token for an admin user
# BACKEND_URL = e.g. https://dashboard-production-b76c.up.railway.app
# TRIGGERED_BY = "cron" | "manual" | "deploy" (default: "cron")

set -euo pipefail

BACKEND_URL="${BACKEND_URL:-https://dashboard-production-b76c.up.railway.app}"
TRIGGERED_BY="${TRIGGERED_BY:-cron}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"

cd "$BACKEND_DIR"

# Build first
npx tsc 2>/dev/null

# Run tests, capture output
START_MS=$(($(date +%s) * 1000))
TEST_OUTPUT=$(node --test --test-force-exit dist/tests/*.test.js 2>&1) || true
END_MS=$(($(date +%s) * 1000))
DURATION_MS=$((END_MS - START_MS))

# Parse results from the summary lines
TOTAL=$(echo "$TEST_OUTPUT" | grep -E '^ℹ tests' | awk '{print $3}')
PASS=$(echo "$TEST_OUTPUT" | grep -E '^ℹ pass' | awk '{print $3}')
FAIL=$(echo "$TEST_OUTPUT" | grep -E '^ℹ fail' | awk '{print $3}')

TOTAL=${TOTAL:-0}
PASS=${PASS:-0}
FAIL=${FAIL:-0}

if [ "$FAIL" -eq 0 ]; then
  STATUS="passed"
else
  STATUS="failed"
fi

# Extract failure details
FAILURES="[]"
if [ "$FAIL" -gt 0 ]; then
  FAILURES=$(echo "$TEST_OUTPUT" | awk '
    /^✖ failing tests:/{found=1; next}
    found && /^test at /{next}
    found && /^✖ /{
      gsub(/^✖ /, "");
      gsub(/ \([0-9.]+ms\)$/, "");
      name=$0;
      getline;
      error=$0;
      gsub(/"/, "\\\"", name);
      gsub(/"/, "\\\"", error);
      printf "{\"name\":\"%s\",\"error\":\"%s\"},", name, error
    }
  ' | sed 's/,$//' | awk '{print "["$0"]"}')
  # Fallback if parsing failed
  if [ "$FAILURES" = "[]" ] || [ -z "$FAILURES" ]; then
    FAILURES="[]"
  fi
fi

# POST results to admin API
if [ -n "${ADMIN_TOKEN:-}" ]; then
  curl -s -X POST "$BACKEND_URL/admin/test-results" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
      \"status\": \"$STATUS\",
      \"total\": $TOTAL,
      \"passed\": $PASS,
      \"failed\": $FAIL,
      \"durationMs\": $DURATION_MS,
      \"failures\": $FAILURES,
      \"triggeredBy\": \"$TRIGGERED_BY\"
    }" > /dev/null
  echo "Results posted: $STATUS ($PASS/$TOTAL passed)"
else
  echo "ADMIN_TOKEN not set — printing results only"
  echo "Status: $STATUS | Total: $TOTAL | Passed: $PASS | Failed: $FAIL | Duration: ${DURATION_MS}ms"
fi
