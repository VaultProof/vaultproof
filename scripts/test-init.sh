#!/usr/bin/env bash
#
# VaultProof Init — pre-push test gate.
#
# Strict mode: any test failure blocks the push. Run this before every
# commit that touches:
#   - packages/init-worker
#   - packages/init-cli
#   - packages/shamir
#   - apps/site/providers.json
#
# Usage:
#   ./scripts/test-init.sh              # fast tests only
#   VP_JWT=<jwt> ./scripts/test-init.sh # adds staging integration tests
#
# Policy: new code must ship with new tests that exercise the new behavior.
# If you add a route, add a test for it. If you add a validator, add an
# assertion for each case. The gate only proves what it runs.
#

set -u  # error on unset variables; DO NOT use set -e (we want to run all tests)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# ── counters ─────────────────────────────────────────────────────────────
TOTAL=0
PASS=0
FAIL=0
SKIP=0
FAILED_TESTS=()

# ── colors (disabled when not a tty) ─────────────────────────────────────
if [ -t 1 ]; then
  RED=$'\033[0;31m'
  GRN=$'\033[0;32m'
  YLW=$'\033[0;33m'
  DIM=$'\033[0;90m'
  BLD=$'\033[1m'
  RST=$'\033[0m'
else
  RED='' ; GRN='' ; YLW='' ; DIM='' ; BLD='' ; RST=''
fi

header() {
  printf "\n%s\n" "══════════════════════════════════════════════════════════════"
  printf " %s%s%s\n" "$BLD" "$1" "$RST"
  printf "%s\n" "══════════════════════════════════════════════════════════════"
}

run_test() {
  local name=$1
  local cmd=$2
  TOTAL=$((TOTAL + 1))
  printf "  %-52s " "$name"
  local out
  if out=$(eval "$cmd" 2>&1); then
    PASS=$((PASS + 1))
    printf "%sPASS%s\n" "$GRN" "$RST"
  else
    FAIL=$((FAIL + 1))
    FAILED_TESTS+=("$name")
    printf "%sFAIL%s\n" "$RED" "$RST"
    echo "$out" | head -20 | sed 's/^/    /'
  fi
}

skip_test() {
  local name=$1
  local reason=$2
  SKIP=$((SKIP + 1))
  printf "  %-52s %sSKIP%s %s(%s)%s\n" "$name" "$YLW" "$RST" "$DIM" "$reason" "$RST"
}

# ── Fast: type checks ────────────────────────────────────────────────────
header "Type checks"
run_test "init-worker tsc --noEmit"    "cd packages/init-worker && npx tsc --noEmit"
run_test "init-cli tsc --noEmit"       "cd packages/init-cli && npx tsc --noEmit"

# ── Fast: unit tests ─────────────────────────────────────────────────────
header "Unit tests"
run_test "SSRF guard (85 cases)"       "cd packages/init-worker && npx tsx src/lib/ssrf-guard.test.ts"
run_test "Rate limiter (22 cases)"     "cd packages/init-worker && npx tsx src/lib/rate-limit.test.ts"
run_test "Fast crypto (22 cases)"      "cd packages/init-worker && npx tsx src/crypto/fast-crypt.test.ts"
run_test "Provider regex (51 cases)"   "cd packages/init-cli && npx tsx src/providers.test.ts"
run_test "Legacy API client (25 cases)" "cd packages/init-cli && npx tsx src/legacy.test.ts"
run_test "Rewrite migration (33 cases)" "cd packages/init-cli && npx tsx src/rewrite.test.ts"
run_test "Publish invariants (39 cases)" "cd packages/init-cli && npm run build && npx tsx src/publish.test.ts"
run_test "Shamir cross-pkg round-trip" "cd packages/init-worker && npx tsx test/shamir-roundtrip.ts"

# ── Network: staging ──────────────────────────────────────────────────────
header "Staging integration"

WORKER_URL="${VP_WORKER_URL:-https://vaultproof-init-staging.vaultproof.workers.dev}"

# Health check always runs — it's cheap and tells us if the worker is up.
run_test "staging /health"             "curl -sf '$WORKER_URL/health' -o /dev/null"

if [ -n "${VP_JWT:-}" ]; then
  run_test "integration suite" \
    "cd packages/init-worker && VP_JWT='$VP_JWT' VP_WORKER_URL='$WORKER_URL' npx tsx test/integration.ts"
else
  skip_test "integration suite" "VP_JWT not set (see docs for how to get one)"
fi

# ── Summary ──────────────────────────────────────────────────────────────
printf "\n%s\n" "──────────────────────────────────────────────────────────────"
printf "  %d passed, %d failed, %d skipped (of %d)\n" "$PASS" "$FAIL" "$SKIP" "$TOTAL"

if [ $FAIL -gt 0 ]; then
  printf "\n%sFAILED TESTS:%s\n" "$RED" "$RST"
  for t in "${FAILED_TESTS[@]}"; do
    printf "  %s✗%s %s\n" "$RED" "$RST" "$t"
  done
  printf "\n%sGATE: BLOCKED%s — do not push until all tests pass.\n\n" "$RED$BLD" "$RST"
  exit 1
fi

printf "\n%sGATE: OPEN%s — safe to push.\n\n" "$GRN$BLD" "$RST"
exit 0
