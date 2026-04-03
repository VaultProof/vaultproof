#!/bin/bash
# Production worker deploy with health check and auto-rollback
# Usage: ./scripts/deploy-worker.sh

set -e

WORKER_DIR="packages/worker"
HEALTH_URL="https://api.vaultproof.dev/health"
MAX_RETRIES=3
RETRY_DELAY=5

echo "=== VaultProof Production Deploy ==="
echo ""

# 1. Get current version before deploy (for rollback)
cd "$WORKER_DIR"
PREV_VERSION=$(npx wrangler deployments list 2>/dev/null | grep "Active" | awk '{print $1}' || echo "unknown")
echo "[1/4] Current version: $PREV_VERSION"

# 2. Deploy
echo "[2/4] Deploying worker..."
DEPLOY_OUTPUT=$(npx wrangler deploy 2>&1)
echo "$DEPLOY_OUTPUT" | tail -3

NEW_VERSION=$(echo "$DEPLOY_OUTPUT" | grep "Version ID" | awk '{print $NF}' || echo "unknown")
echo "       New version: $NEW_VERSION"

# 3. Health check with retries
echo "[3/4] Running health checks..."
HEALTHY=false

for i in $(seq 1 $MAX_RETRIES); do
    sleep $RETRY_DELAY

    HTTP_CODE=$(curl -s -o /tmp/vp_health.json -w "%{http_code}" "$HEALTH_URL" 2>/dev/null || echo "000")
    RESPONSE=$(cat /tmp/vp_health.json 2>/dev/null || echo "{}")

    if [ "$HTTP_CODE" = "200" ]; then
        # Also test an auth-required endpoint returns 401 (not 500/503)
        AUTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://api.vaultproof.dev/api/v1/stats/overview" 2>/dev/null || echo "000")

        if [ "$AUTH_CODE" = "401" ]; then
            echo "       Check $i/$MAX_RETRIES: PASS (health=200, auth=401)"
            HEALTHY=true
            break
        else
            echo "       Check $i/$MAX_RETRIES: PARTIAL (health=200, auth=$AUTH_CODE)"
        fi
    else
        echo "       Check $i/$MAX_RETRIES: FAIL (health=$HTTP_CODE)"
    fi
done

# 4. Result
echo ""
if [ "$HEALTHY" = true ]; then
    echo "[4/4] Deploy successful!"
    echo ""
    echo "  Version:  $NEW_VERSION"
    echo "  Health:   OK"
    echo "  Rollback: npx wrangler rollback --version-id=$PREV_VERSION"
    echo ""

    # Log deploy
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) | DEPLOY | $NEW_VERSION | SUCCESS" >> ../../deploy.log
else
    echo "[4/4] Health check FAILED — rolling back!"
    echo ""

    npx wrangler rollback 2>&1 || true

    echo ""
    echo "  ROLLED BACK to previous version"
    echo "  Failed version: $NEW_VERSION"
    echo "  Check worker logs: npx wrangler tail"
    echo ""

    # Log failed deploy
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) | DEPLOY | $NEW_VERSION | FAILED+ROLLBACK" >> ../../deploy.log

    exit 1
fi
