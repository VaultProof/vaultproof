#!/usr/bin/env bash
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-vaultproof-enterprise}"
DEPLOYMENT_NAME="${DEPLOYMENT_NAME:-vp-enterprise-secure-runtime-eastus-hsm}"
APIM_DEPLOYMENT_NAME="${APIM_DEPLOYMENT_NAME:-${DEPLOYMENT_NAME}-apim}"
ENTERPRISE_URL="${ENTERPRISE_URL:-https://enterprise.vaultproof.dev}"
FRONT_DOOR_PROFILE="${FRONT_DOOR_PROFILE:-vaultproof-enterprise-fd}"
FRONT_DOOR_ENDPOINT="${FRONT_DOOR_ENDPOINT:-vaultproof-enterprise}"
FRONT_DOOR_ROUTE="${FRONT_DOOR_ROUTE:-default-route}"
FRONT_DOOR_ORIGIN_GROUP="${FRONT_DOOR_ORIGIN_GROUP:-default-origin-group}"
FRONT_DOOR_ORIGIN_NAME="${FRONT_DOOR_ORIGIN_NAME:-}"
APIM_ORIGIN_PATH="${APIM_ORIGIN_PATH:-/enterprise}"
ROLLBACK_ORIGIN_HOSTNAME="${ROLLBACK_ORIGIN_HOSTNAME:-}"
ROLLBACK_ORIGIN_PORT="${ROLLBACK_ORIGIN_PORT:-3001}"
ROLLBACK_ORIGIN_PATH="${ROLLBACK_ORIGIN_PATH:-}"
ROLLBACK_FORWARDING_PROTOCOL="${ROLLBACK_FORWARDING_PROTOCOL:-HttpOnly}"
CERTIFICATE_NAME_CHECK="${CERTIFICATE_NAME_CHECK:-Enabled}"
ACTION="${ACTION:-plan}"
SKIP_READINESS_CHECK="${SKIP_READINESS_CHECK:-false}"
SKIP_APIM_CHECK="${SKIP_APIM_CHECK:-false}"
ALLOW_HTTP_APIM_BACKEND="${ALLOW_HTTP_APIM_BACKEND:-false}"
CONFIRM_APIM_CUTOVER="${CONFIRM_APIM_CUTOVER:-}"
RUN_VERIFIER="${RUN_VERIFIER:-false}"

require_command() {
  local command_name="$1"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Missing required command: ${command_name}" >&2
    exit 1
  fi
}

deployment_output_from() {
  local deployment_name="$1"
  local output_name="$2"
  az deployment group show \
    --resource-group "${RESOURCE_GROUP}" \
    --name "${deployment_name}" \
    --query "properties.outputs.${output_name}.value" \
    -o tsv
}

deployment_output() {
  deployment_output_from "${DEPLOYMENT_NAME}" "$1"
}

apim_output() {
  deployment_output_from "${APIM_DEPLOYMENT_NAME}" "$1"
}

url_host() {
  node -e "
const value = process.argv[1] || '';
try {
  console.log(new URL(value).host);
} catch {
  console.error('Invalid URL: ' + value);
  process.exit(1);
}
" "$1"
}

json_value() {
  local file="$1"
  local expression="$2"
  node -e "
const fs = require('fs');
const payload = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const value = (${expression})(payload);
if (Array.isArray(value)) {
  console.log(value.join('\\n'));
} else if (value !== undefined && value !== null) {
  console.log(String(value));
}
" "${file}"
}

selected_front_door_origin_name() {
  if [[ -n "${FRONT_DOOR_ORIGIN_NAME}" ]]; then
    echo "${FRONT_DOOR_ORIGIN_NAME}"
    return
  fi

  local tmp_file
  tmp_file="$(mktemp)"
  trap 'rm -f "${tmp_file}"' RETURN
  az afd origin list \
    --resource-group "${RESOURCE_GROUP}" \
    --profile-name "${FRONT_DOOR_PROFILE}" \
    --origin-group-name "${FRONT_DOOR_ORIGIN_GROUP}" \
    -o json > "${tmp_file}"
  node -e "
const fs = require('fs');
const origins = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const enabled = origins.filter((origin) => origin.enabledState === 'Enabled');
if (enabled.length !== 1) {
  console.error('Expected exactly one enabled Front Door origin; found ' + enabled.length + '. Set FRONT_DOOR_ORIGIN_NAME explicitly.');
  for (const origin of origins) {
    console.error('- ' + origin.name + ' ' + origin.enabledState + ' ' + origin.hostName);
  }
  process.exit(1);
}
console.log(enabled[0].name);
" "${tmp_file}"
}

http_status() {
  local url="$1"
  local output_file="$2"
  local curl_exit
  local status
  shift 2
  set +e
  status="$(curl -sS --connect-timeout 10 --max-time 20 -o "${output_file}" -w "%{http_code}" "$@" "${url}" 2>"${output_file}.err")"
  curl_exit=$?
  set -e
  if [[ "${curl_exit}" -ne 0 ]]; then
    echo "000"
  else
    echo "${status}"
  fi
}

require_production_ready() {
  if [[ "${SKIP_READINESS_CHECK}" == "true" ]]; then
    echo "Skipping production readiness gate because SKIP_READINESS_CHECK=true."
    return
  fi

  local tmp_file
  local status
  tmp_file="$(mktemp)"
  trap 'rm -f "${tmp_file}"' RETURN
  status="$(http_status "${ENTERPRISE_URL%/}/readiness?apim_cutover_ts=$(date +%s)" "${tmp_file}")"
  if [[ "${status}" != "200" ]]; then
    echo "Refusing APIM cutover: ${ENTERPRISE_URL%/}/readiness returned HTTP ${status}." >&2
    exit 1
  fi

  node -e "
const fs = require('fs');
const payload = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
if (payload.production_ready !== true) {
  console.error('Refusing APIM cutover: control plane production_ready is not true.');
  process.exit(1);
}
const blockers = Array.isArray(payload.production_blockers) ? payload.production_blockers : [];
if (blockers.length > 0) {
  console.error('Refusing APIM cutover: production blockers remain: ' + blockers.join(', '));
  process.exit(1);
}
" "${tmp_file}"
}

require_apim_ready() {
  if [[ "${SKIP_APIM_CHECK}" == "true" ]]; then
    echo "Skipping APIM readiness gate because SKIP_APIM_CHECK=true."
    return
  fi

  local api_url
  local backend_url
  local health_file
  local readiness_file
  local health_status
  local readiness_status

  api_url="$(apim_output apiManagementApiUrl)"
  backend_url="$(apim_output apiManagementBackendUrl)"

  if [[ "${backend_url}" == http://* && "${ALLOW_HTTP_APIM_BACKEND}" != "true" ]]; then
    echo "Refusing APIM cutover: APIM backend URL is still HTTP (${backend_url})." >&2
    echo "Finish TLS/private-origin backend hardening first, or set ALLOW_HTTP_APIM_BACKEND=true for a controlled temporary cutover." >&2
    exit 1
  fi

  health_file="$(mktemp)"
  readiness_file="$(mktemp)"
  trap 'rm -f "${health_file}" "${readiness_file}"' RETURN

  health_status="$(http_status "${api_url%/}/health?apim_cutover_ts=$(date +%s)" "${health_file}")"
  if [[ "${health_status}" != "200" ]]; then
    echo "Refusing APIM cutover: APIM /health returned HTTP ${health_status}." >&2
    exit 1
  fi

  readiness_status="$(http_status "${api_url%/}/readiness?apim_cutover_ts=$(date +%s)" "${readiness_file}")"
  if [[ "${readiness_status}" != "200" ]]; then
    echo "Refusing APIM cutover: APIM /readiness returned HTTP ${readiness_status}." >&2
    exit 1
  fi

  node -e "
const fs = require('fs');
const payload = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
if (payload.production_ready !== true) {
  console.error('Refusing APIM cutover: APIM readiness production_ready is not true.');
  process.exit(1);
}
if (payload.security_profile !== 'azure-confidential-production') {
  console.error('Refusing APIM cutover: APIM readiness security_profile is ' + payload.security_profile);
  process.exit(1);
}
" "${readiness_file}"
}

require_confirmation() {
  local expected="$1"
  local action_description="$2"
  if [[ "${CONFIRM_APIM_CUTOVER}" != "${expected}" ]]; then
    echo "Refusing ${action_description}: set CONFIRM_APIM_CUTOVER=${expected} to mutate Front Door." >&2
    exit 1
  fi
}

show_current_front_door() {
  local origin_name
  origin_name="$(selected_front_door_origin_name)"
  echo "Current Front Door route:"
  az afd route show \
    --resource-group "${RESOURCE_GROUP}" \
    --profile-name "${FRONT_DOOR_PROFILE}" \
    --endpoint-name "${FRONT_DOOR_ENDPOINT}" \
    --route-name "${FRONT_DOOR_ROUTE}" \
    --query "{enabledState:enabledState,forwardingProtocol:forwardingProtocol,originPath:originPath,httpsRedirect:httpsRedirect}" \
    -o table

  echo
  echo "Current Front Door origin:"
  az afd origin show \
    --resource-group "${RESOURCE_GROUP}" \
    --profile-name "${FRONT_DOOR_PROFILE}" \
    --origin-group-name "${FRONT_DOOR_ORIGIN_GROUP}" \
    --origin-name "${origin_name}" \
    --query "{name:name,hostName:hostName,originHostHeader:originHostHeader,httpPort:httpPort,httpsPort:httpsPort,enabledState:enabledState,enforceCertificateNameCheck:enforceCertificateNameCheck}" \
    -o table
}

show_apim_target() {
  local gateway_url
  local api_url
  local backend_url
  local gateway_host
  gateway_url="$(apim_output apiManagementGatewayUrl)"
  api_url="$(apim_output apiManagementApiUrl)"
  backend_url="$(apim_output apiManagementBackendUrl)"
  gateway_host="$(url_host "${gateway_url}")"

  echo "APIM target:"
  echo "  deployment:  ${APIM_DEPLOYMENT_NAME}"
  echo "  gateway URL: ${gateway_url}"
  echo "  API URL:     ${api_url}"
  echo "  backend URL: ${backend_url}"
  echo "  origin host: ${gateway_host}"
  echo "  origin path: ${APIM_ORIGIN_PATH}"
}

update_route_origin_path() {
  local origin_path="$1"
  az afd route update \
    --resource-group "${RESOURCE_GROUP}" \
    --profile-name "${FRONT_DOOR_PROFILE}" \
    --endpoint-name "${FRONT_DOOR_ENDPOINT}" \
    --route-name "${FRONT_DOOR_ROUTE}" \
    --origin-path "${origin_path}" \
    -o none
}

enable_apim_origin() {
  local gateway_url
  local gateway_host
  local origin_name
  gateway_url="$(apim_output apiManagementGatewayUrl)"
  gateway_host="$(url_host "${gateway_url}")"
  origin_name="$(selected_front_door_origin_name)"

  require_confirmation "route-enterprise-through-apim" "APIM cutover"
  require_production_ready
  require_apim_ready

  az afd origin update \
    --resource-group "${RESOURCE_GROUP}" \
    --profile-name "${FRONT_DOOR_PROFILE}" \
    --origin-group-name "${FRONT_DOOR_ORIGIN_GROUP}" \
    --origin-name "${origin_name}" \
    --host-name "${gateway_host}" \
    --origin-host-header "${gateway_host}" \
    --http-port 80 \
    --https-port 443 \
    --enforce-certificate-name-check "${CERTIFICATE_NAME_CHECK}" \
    --enabled-state Enabled \
    -o none

  az afd route update \
    --resource-group "${RESOURCE_GROUP}" \
    --profile-name "${FRONT_DOOR_PROFILE}" \
    --endpoint-name "${FRONT_DOOR_ENDPOINT}" \
    --route-name "${FRONT_DOOR_ROUTE}" \
    --forwarding-protocol HttpsOnly \
    --origin-path "${APIM_ORIGIN_PATH}" \
    -o none

  echo "Front Door now forwards to APIM ${gateway_host}${APIM_ORIGIN_PATH} with HttpsOnly."
}

rollback_vm_origin() {
  local rollback_origin
  local origin_name
  rollback_origin="${ROLLBACK_ORIGIN_HOSTNAME:-$(deployment_output confidentialVmPublicIp)}"
  origin_name="$(selected_front_door_origin_name)"

  az afd route update \
    --resource-group "${RESOURCE_GROUP}" \
    --profile-name "${FRONT_DOOR_PROFILE}" \
    --endpoint-name "${FRONT_DOOR_ENDPOINT}" \
    --route-name "${FRONT_DOOR_ROUTE}" \
    --forwarding-protocol "${ROLLBACK_FORWARDING_PROTOCOL}" \
    -o none

  update_route_origin_path "${ROLLBACK_ORIGIN_PATH}"

  az afd origin update \
    --resource-group "${RESOURCE_GROUP}" \
    --profile-name "${FRONT_DOOR_PROFILE}" \
    --origin-group-name "${FRONT_DOOR_ORIGIN_GROUP}" \
    --origin-name "${origin_name}" \
    --host-name "${rollback_origin}" \
    --origin-host-header "${rollback_origin}" \
    --http-port "${ROLLBACK_ORIGIN_PORT}" \
    --https-port 443 \
    --enforce-certificate-name-check Disabled \
    --enabled-state Enabled \
    -o none

  echo "Front Door rolled back to ${rollback_origin}:${ROLLBACK_ORIGIN_PORT} with ${ROLLBACK_FORWARDING_PROTOCOL}."
}

run_verifier_if_requested() {
  if [[ "${RUN_VERIFIER}" != "true" ]]; then
    return
  fi

  local gateway_host
  gateway_host="$(url_host "$(apim_output apiManagementGatewayUrl)")"
  EXPECTED_FRONT_DOOR_FORWARDING_PROTOCOL=HttpsOnly \
  EXPECTED_FRONT_DOOR_ORIGIN_HOSTNAME="${gateway_host}" \
  EXPECTED_FRONT_DOOR_ORIGIN_CERT_NAME_CHECK="${CERTIFICATE_NAME_CHECK}" \
  EXPECTED_FRONT_DOOR_ORIGIN_PATH="${APIM_ORIGIN_PATH}" \
  EXPECTED_APIM_DEPLOYED=true \
  bash "$(dirname "$0")/verify-production-runtime.sh"
}

require_command az
require_command curl
require_command node

case "${ACTION}" in
  plan)
    echo "VaultProof Front Door APIM cutover plan"
    echo "  resource group: ${RESOURCE_GROUP}"
    echo "  deployment:     ${DEPLOYMENT_NAME}"
    echo "  APIM deployment:${APIM_DEPLOYMENT_NAME}"
    echo "  profile:        ${FRONT_DOOR_PROFILE}"
    echo "  endpoint:       ${FRONT_DOOR_ENDPOINT}"
    echo "  route:          ${FRONT_DOOR_ROUTE}"
    echo "  origin group:   ${FRONT_DOOR_ORIGIN_GROUP}"
    echo "  origin:         ${FRONT_DOOR_ORIGIN_NAME:-auto-select enabled origin}"
    echo
    show_apim_target
    echo
    show_current_front_door
    echo
    echo "Enable APIM routing only after TLS/private-origin risk is resolved:"
    echo "  ACTION=enable CONFIRM_APIM_CUTOVER=route-enterprise-through-apim RUN_VERIFIER=true npm run cutover:enterprise-apim"
    echo
    echo "Rollback to the VM origin:"
    echo "  ACTION=rollback CONFIRM_APIM_CUTOVER=rollback-enterprise-to-vm npm run cutover:enterprise-apim"
    ;;
  enable)
    enable_apim_origin
    show_current_front_door
    run_verifier_if_requested
    ;;
  rollback)
    require_confirmation "rollback-enterprise-to-vm" "APIM rollback"
    rollback_vm_origin
    show_current_front_door
    ;;
  *)
    echo "Unknown ACTION: ${ACTION}. Use plan, enable, or rollback." >&2
    exit 1
    ;;
esac
