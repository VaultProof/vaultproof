#!/usr/bin/env bash
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-vaultproof-enterprise}"
DEPLOYMENT_NAME="${DEPLOYMENT_NAME:-vp-enterprise-secure-runtime-eastus-hsm}"
ENTERPRISE_URL="${ENTERPRISE_URL:-https://enterprise.vaultproof.dev}"
FRONT_DOOR_PROFILE="${FRONT_DOOR_PROFILE:-vaultproof-enterprise-fd}"
FRONT_DOOR_ENDPOINT="${FRONT_DOOR_ENDPOINT:-vaultproof-enterprise}"
FRONT_DOOR_ROUTE="${FRONT_DOOR_ROUTE:-default-route}"
FRONT_DOOR_ORIGIN_GROUP="${FRONT_DOOR_ORIGIN_GROUP:-default-origin-group}"
FRONT_DOOR_ORIGIN_NAME="${FRONT_DOOR_ORIGIN_NAME:-default-origin}"
ORIGIN_TLS_HOSTNAME="${ORIGIN_TLS_HOSTNAME:-origin.enterprise.vaultproof.dev}"
ORIGIN_TLS_PORT="${ORIGIN_TLS_PORT:-443}"
SSH_USER="${SSH_USER:-azureuser}"
ROLLBACK_ORIGIN_HOSTNAME="${ROLLBACK_ORIGIN_HOSTNAME:-}"
ROLLBACK_ORIGIN_PORT="${ROLLBACK_ORIGIN_PORT:-3001}"
CERTIFICATE_NAME_CHECK="${CERTIFICATE_NAME_CHECK:-Enabled}"
ACTION="${ACTION:-plan}"
SKIP_READINESS_CHECK="${SKIP_READINESS_CHECK:-false}"
SKIP_ORIGIN_TLS_CHECK="${SKIP_ORIGIN_TLS_CHECK:-false}"
RUN_VERIFIER="${RUN_VERIFIER:-false}"

require_command() {
  local command_name="$1"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Missing required command: ${command_name}" >&2
    exit 1
  fi
}

deployment_output() {
  local name="$1"
  az deployment group show \
    --resource-group "${RESOURCE_GROUP}" \
    --name "${DEPLOYMENT_NAME}" \
    --query "properties.outputs.${name}.value" \
    -o tsv
}

require_production_ready() {
  if [[ "${SKIP_READINESS_CHECK}" == "true" ]]; then
    echo "Skipping production readiness gate because SKIP_READINESS_CHECK=true."
    return
  fi

  require_command curl
  local tmp_file
  local status
  tmp_file="$(mktemp)"
  trap 'rm -f "${tmp_file}"' RETURN
  status="$(curl -sS --connect-timeout 10 --max-time 20 \
    -o "${tmp_file}" \
    -w "%{http_code}" \
    "${ENTERPRISE_URL%/}/readiness?tls_cutover_ts=$(date +%s)")"
  if [[ "${status}" != "200" ]]; then
    echo "Refusing TLS origin cutover: ${ENTERPRISE_URL%/}/readiness returned HTTP ${status}." >&2
    exit 1
  fi

  node -e "
const fs = require('fs');
const payload = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
if (payload.production_ready !== true) {
  console.error('Refusing TLS origin cutover: control plane production_ready is not true.');
  process.exit(1);
}
const blockers = Array.isArray(payload.production_blockers) ? payload.production_blockers : [];
if (blockers.length > 0) {
  console.error('Refusing TLS origin cutover: production blockers remain: ' + blockers.join(', '));
  process.exit(1);
}
" "${tmp_file}"
}

require_origin_tls() {
  if [[ "${SKIP_ORIGIN_TLS_CHECK}" == "true" ]]; then
    echo "Skipping VM-local origin TLS check because SKIP_ORIGIN_TLS_CHECK=true."
    return
  fi

  require_command ssh
  local vm_public_ip
  local status
  vm_public_ip="$(deployment_output confidentialVmPublicIp)"
  status="$(ssh -o BatchMode=yes -o ConnectTimeout=10 "${SSH_USER}@${vm_public_ip}" \
    "curl -sS --connect-timeout 10 --max-time 20 --resolve '${ORIGIN_TLS_HOSTNAME}:${ORIGIN_TLS_PORT}:127.0.0.1' -o /tmp/vaultproof-origin-tls-cutover-health.json -w '%{http_code}' 'https://${ORIGIN_TLS_HOSTNAME}:${ORIGIN_TLS_PORT}/health'")"
  if [[ "${status}" == "200" ]]; then
    echo "VM-local origin TLS health returned HTTP 200 for ${ORIGIN_TLS_HOSTNAME}:${ORIGIN_TLS_PORT}."
  else
    echo "Refusing TLS origin cutover: VM-local origin TLS health returned HTTP ${status}; expected 200." >&2
    exit 1
  fi
}

show_current_front_door() {
  echo "Current Front Door route:"
  az afd route show \
    --resource-group "${RESOURCE_GROUP}" \
    --profile-name "${FRONT_DOOR_PROFILE}" \
    --endpoint-name "${FRONT_DOOR_ENDPOINT}" \
    --route-name "${FRONT_DOOR_ROUTE}" \
    --query "{enabledState:enabledState,forwardingProtocol:forwardingProtocol,httpsRedirect:httpsRedirect}" \
    -o table

  echo
  echo "Current Front Door origin:"
  az afd origin show \
    --resource-group "${RESOURCE_GROUP}" \
    --profile-name "${FRONT_DOOR_PROFILE}" \
    --origin-group-name "${FRONT_DOOR_ORIGIN_GROUP}" \
    --origin-name "${FRONT_DOOR_ORIGIN_NAME}" \
    --query "{name:name,hostName:hostName,originHostHeader:originHostHeader,httpPort:httpPort,httpsPort:httpsPort,enabledState:enabledState,enforceCertificateNameCheck:enforceCertificateNameCheck}" \
    -o table
}

enable_tls_origin() {
  require_production_ready
  require_origin_tls

  az afd origin update \
    --resource-group "${RESOURCE_GROUP}" \
    --profile-name "${FRONT_DOOR_PROFILE}" \
    --origin-group-name "${FRONT_DOOR_ORIGIN_GROUP}" \
    --origin-name "${FRONT_DOOR_ORIGIN_NAME}" \
    --host-name "${ORIGIN_TLS_HOSTNAME}" \
    --origin-host-header "${ORIGIN_TLS_HOSTNAME}" \
    --http-port "${ROLLBACK_ORIGIN_PORT}" \
    --https-port "${ORIGIN_TLS_PORT}" \
    --enforce-certificate-name-check "${CERTIFICATE_NAME_CHECK}" \
    --enabled-state Enabled \
    -o none

  az afd route update \
    --resource-group "${RESOURCE_GROUP}" \
    --profile-name "${FRONT_DOOR_PROFILE}" \
    --endpoint-name "${FRONT_DOOR_ENDPOINT}" \
    --route-name "${FRONT_DOOR_ROUTE}" \
    --forwarding-protocol HttpsOnly \
    -o none

  echo "Front Door now forwards to ${ORIGIN_TLS_HOSTNAME}:${ORIGIN_TLS_PORT} with HttpsOnly."
}

rollback_http_origin() {
  local rollback_origin
  rollback_origin="${ROLLBACK_ORIGIN_HOSTNAME:-$(deployment_output confidentialVmPublicIp)}"

  az afd route update \
    --resource-group "${RESOURCE_GROUP}" \
    --profile-name "${FRONT_DOOR_PROFILE}" \
    --endpoint-name "${FRONT_DOOR_ENDPOINT}" \
    --route-name "${FRONT_DOOR_ROUTE}" \
    --forwarding-protocol HttpOnly \
    -o none

  az afd origin update \
    --resource-group "${RESOURCE_GROUP}" \
    --profile-name "${FRONT_DOOR_PROFILE}" \
    --origin-group-name "${FRONT_DOOR_ORIGIN_GROUP}" \
    --origin-name "${FRONT_DOOR_ORIGIN_NAME}" \
    --host-name "${rollback_origin}" \
    --origin-host-header "${rollback_origin}" \
    --http-port "${ROLLBACK_ORIGIN_PORT}" \
    --https-port "${ORIGIN_TLS_PORT}" \
    --enforce-certificate-name-check Disabled \
    --enabled-state Enabled \
    -o none

  echo "Front Door rolled back to ${rollback_origin}:${ROLLBACK_ORIGIN_PORT} with HttpOnly."
}

run_verifier_if_requested() {
  if [[ "${RUN_VERIFIER}" != "true" ]]; then
    return
  fi

  EXPECTED_FRONT_DOOR_FORWARDING_PROTOCOL=HttpsOnly \
  EXPECTED_FRONT_DOOR_ORIGIN_HOSTNAME="${ORIGIN_TLS_HOSTNAME}" \
  EXPECTED_FRONT_DOOR_ORIGIN_CERT_NAME_CHECK="${CERTIFICATE_NAME_CHECK}" \
  ORIGIN_TLS_HOSTNAME="${ORIGIN_TLS_HOSTNAME}" \
  bash "$(dirname "$0")/verify-production-runtime.sh"
}

require_command az
require_command node

case "${ACTION}" in
  plan)
    echo "VaultProof Front Door TLS origin cutover plan"
    echo "  resource group: ${RESOURCE_GROUP}"
    echo "  deployment:     ${DEPLOYMENT_NAME}"
    echo "  profile:        ${FRONT_DOOR_PROFILE}"
    echo "  endpoint:       ${FRONT_DOOR_ENDPOINT}"
    echo "  route:          ${FRONT_DOOR_ROUTE}"
    echo "  origin group:   ${FRONT_DOOR_ORIGIN_GROUP}"
    echo "  origin:         ${FRONT_DOOR_ORIGIN_NAME}"
    echo "  TLS origin:     ${ORIGIN_TLS_HOSTNAME}:${ORIGIN_TLS_PORT}"
    echo "  SSH user:       ${SSH_USER}"
    echo
    show_current_front_door
    echo
    echo "Enable TLS origin forwarding after DNS, certificate, NSG 443, and local TLS checks pass:"
    echo "  ACTION=enable ORIGIN_TLS_HOSTNAME=${ORIGIN_TLS_HOSTNAME} bash infra/azure/enterprise-secure-runtime/cutover-front-door-origin-tls.sh"
    echo
    echo "Rollback to HTTP origin:"
    echo "  ACTION=rollback bash infra/azure/enterprise-secure-runtime/cutover-front-door-origin-tls.sh"
    ;;
  enable)
    enable_tls_origin
    show_current_front_door
    run_verifier_if_requested
    ;;
  rollback)
    rollback_http_origin
    show_current_front_door
    ;;
  *)
    echo "Unknown ACTION: ${ACTION}. Use plan, enable, or rollback." >&2
    exit 1
    ;;
esac
