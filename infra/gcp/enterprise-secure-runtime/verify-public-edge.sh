#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-vaultproof-prod}"
DOMAIN="${DOMAIN:-enterprise.vaultproof.dev}"
GLOBAL_IP_NAME="${GLOBAL_IP_NAME:-vaultproof-enterprise-edge-ip}"
BACKEND_SERVICE="${BACKEND_SERVICE:-vaultproof-enterprise-backend}"
SSL_CERTIFICATE="${SSL_CERTIFICATE:-vaultproof-enterprise-cert}"
HTTPS_FORWARDING_RULE="${HTTPS_FORWARDING_RULE:-vaultproof-enterprise-https}"
ALLOW_INSECURE="${ALLOW_INSECURE:-false}"

EDGE_IP="$(gcloud compute addresses describe "${GLOBAL_IP_NAME}" --global --project="${PROJECT_ID}" --format='value(address)' 2>/dev/null || true)"
if [[ -z "${EDGE_IP}" ]]; then
  echo "No global edge IP found for ${GLOBAL_IP_NAME}."
  exit 1
fi

echo "Edge IP: ${EDGE_IP}"
echo

echo "Forwarding rule:"
gcloud compute forwarding-rules describe "${HTTPS_FORWARDING_RULE}" \
  --global \
  --project="${PROJECT_ID}" \
  --format='table(name,IPAddress,IPProtocol,portRange,loadBalancingScheme,target)'

echo
echo "Managed certificate:"
gcloud compute ssl-certificates describe "${SSL_CERTIFICATE}" \
  --global \
  --project="${PROJECT_ID}" \
  --format='json(name,managed.status,managed.domainStatus,expireTime)'

echo
echo "Backend health:"
gcloud compute backend-services get-health "${BACKEND_SERVICE}" \
  --global \
  --project="${PROJECT_ID}" || true

echo
echo "DNS:"
dig +short "${DOMAIN}" || true

CURL_ARGS=(
  --silent
  --show-error
  --location
  --max-time
  "20"
  --resolve
  "${DOMAIN}:443:${EDGE_IP}"
)

if [[ "${ALLOW_INSECURE}" == "true" ]]; then
  CURL_ARGS+=(--insecure)
fi

echo
echo "HTTPS /health through edge:"
curl "${CURL_ARGS[@]}" "https://${DOMAIN}/health"
echo

echo
echo "HTTPS /readiness through edge:"
curl "${CURL_ARGS[@]}" "https://${DOMAIN}/readiness"
echo
