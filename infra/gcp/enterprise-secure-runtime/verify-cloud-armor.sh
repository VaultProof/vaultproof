#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-vaultproof-prod}"
DOMAIN="${DOMAIN:-enterprise.vaultproof.dev}"
GLOBAL_IP_NAME="${GLOBAL_IP_NAME:-vaultproof-enterprise-edge-ip}"
BACKEND_SERVICE="${BACKEND_SERVICE:-vaultproof-enterprise-backend}"
SECURITY_POLICY="${SECURITY_POLICY:-vaultproof-enterprise-armor}"
VERIFY_BLOCKING="${VERIFY_BLOCKING:-true}"
ALLOW_INSECURE="${ALLOW_INSECURE:-false}"

EXPECTED_RULE_PRIORITIES=(
  "${SENSITIVE_PATH_PRIORITY:-1000}"
  "${SENSITIVE_APP_PRIORITY:-1001}"
  "${SENSITIVE_FILE_PRIORITY:-1002}"
  "${SENSITIVE_LOCKFILE_PRIORITY:-1003}"
  "${EXECUTE_RATE_PRIORITY:-1100}"
  "${API_RATE_PRIORITY:-1200}"
  "${EDGE_RATE_PRIORITY:-1300}"
)

EDGE_IP="$(gcloud compute addresses describe "${GLOBAL_IP_NAME}" --global --project="${PROJECT_ID}" --format='value(address)' 2>/dev/null || true)"
if [[ -z "${EDGE_IP}" ]]; then
  echo "No global edge IP found for ${GLOBAL_IP_NAME}."
  exit 1
fi

POLICY_SELF_LINK="$(gcloud compute security-policies describe "${SECURITY_POLICY}" \
  --global \
  --project="${PROJECT_ID}" \
  --format='value(selfLink)' 2>/dev/null || true)"
if [[ -z "${POLICY_SELF_LINK}" ]]; then
  echo "Cloud Armor policy ${SECURITY_POLICY} does not exist."
  exit 1
fi

BACKEND_POLICY="$(gcloud compute backend-services describe "${BACKEND_SERVICE}" \
  --global \
  --project="${PROJECT_ID}" \
  --format='value(securityPolicy)' 2>/dev/null || true)"
if [[ "${BACKEND_POLICY}" != "${POLICY_SELF_LINK}" && "${BACKEND_POLICY}" != *"/securityPolicies/${SECURITY_POLICY}" ]]; then
  echo "Backend ${BACKEND_SERVICE} is not attached to ${SECURITY_POLICY}."
  echo "  backend_policy=${BACKEND_POLICY:-none}"
  exit 1
fi

for priority in "${EXPECTED_RULE_PRIORITIES[@]}"; do
  gcloud compute security-policies rules describe "${priority}" \
    --security-policy="${SECURITY_POLICY}" \
    --project="${PROJECT_ID}" >/dev/null
done

echo "Cloud Armor policy:"
gcloud compute security-policies describe "${SECURITY_POLICY}" \
  --global \
  --project="${PROJECT_ID}" \
  --format='table(name,type,description)'

echo
echo "Cloud Armor rules:"
gcloud compute security-policies describe "${SECURITY_POLICY}" \
  --global \
  --project="${PROJECT_ID}" \
  --format='table(rules[].priority,rules[].action,rules[].preview,rules[].description)'

echo
echo "Backend policy:"
gcloud compute backend-services describe "${BACKEND_SERVICE}" \
  --global \
  --project="${PROJECT_ID}" \
  --format='table(name,securityPolicy)'

CURL_ARGS=(
  --silent
  --show-error
  --location
  --max-time
  "20"
  --output
  "/dev/null"
  --write-out
  "%{http_code}"
  --resolve
  "${DOMAIN}:443:${EDGE_IP}"
)

if [[ "${ALLOW_INSECURE}" == "true" ]]; then
  CURL_ARGS+=(--insecure)
fi

echo
echo "HTTPS /health through Cloud Armor:"
HEALTH_STATUS="$(curl "${CURL_ARGS[@]}" "https://${DOMAIN}/health")"
echo "${HEALTH_STATUS}"
if [[ "${HEALTH_STATUS}" != "200" ]]; then
  echo "Expected /health to return 200 through Cloud Armor."
  exit 1
fi

if [[ "${VERIFY_BLOCKING}" == "true" ]]; then
  echo
  echo "HTTPS /.env scanner probe through Cloud Armor:"
  BLOCK_STATUS="$(curl "${CURL_ARGS[@]}" "https://${DOMAIN}/.env")"
  echo "${BLOCK_STATUS}"
  if [[ "${BLOCK_STATUS}" != "403" ]]; then
    echo "Expected /.env scanner probe to return 403 through Cloud Armor."
    exit 1
  fi
fi

echo
echo "GCP Cloud Armor verification passed."
