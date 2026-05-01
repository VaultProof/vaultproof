#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RESOURCE_GROUP="${RESOURCE_GROUP:-vaultproof-enterprise}"
DEPLOYMENT_NAME="${DEPLOYMENT_NAME:-vp-enterprise-secure-runtime-eastus-hsm}"
APIM_DEPLOYMENT_NAME="${APIM_DEPLOYMENT_NAME:-${DEPLOYMENT_NAME}-apim}"
ENTERPRISE_URL="${ENTERPRISE_URL:-https://enterprise.vaultproof.dev}"
ORIGIN_TLS_HOSTNAME="${ORIGIN_TLS_HOSTNAME:-origin.enterprise.vaultproof.dev}"
ORIGIN_TLS_BACKEND_URL="${ORIGIN_TLS_BACKEND_URL:-https://${ORIGIN_TLS_HOSTNAME}}"
DNS_ZONE_NAME="${DNS_ZONE_NAME:-vaultproof.dev}"
DNS_RESOURCE_GROUP="${DNS_RESOURCE_GROUP:-}"
DNS_RECORD_SET_NAME="${DNS_RECORD_SET_NAME:-}"
DNS_TTL="${DNS_TTL:-300}"
ROLLBACK_APIM_BACKEND_URL="${ROLLBACK_APIM_BACKEND_URL:-}"
APIM_API_ID="${APIM_API_ID:-vaultproof-enterprise}"
ACTION="${ACTION:-plan}"
CONFIRM_ORIGIN_TLS_PREP="${CONFIRM_ORIGIN_TLS_PREP:-}"
NSG_NAME="${NSG_NAME:-}"
NSG_RESOURCE_GROUP="${NSG_RESOURCE_GROUP:-}"
TLS_RULE_NAMES="${TLS_RULE_NAMES:-AllowFrontDoorTlsControlPlane AllowFrontDoorFrontendTlsControlPlane AllowFrontDoorFirstPartyTlsControlPlane}"
SKIP_READINESS_CHECK="${SKIP_READINESS_CHECK:-false}"
SKIP_TLS_PREFLIGHT="${SKIP_TLS_PREFLIGHT:-false}"

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

resource_group_from_id() {
  node -e "
const id = process.argv[1] || '';
const match = id.match(/\/resourceGroups\/([^/]+)/i);
if (match) console.log(match[1]);
" "$1"
}

resolve_nsg() {
  if [[ -n "${NSG_NAME}" ]]; then
    NSG_RESOURCE_GROUP="${NSG_RESOURCE_GROUP:-${RESOURCE_GROUP}}"
    return
  fi

  local vm_name
  local nic_id
  local nsg_id
  local subnet_id

  vm_name="$(deployment_output confidentialVmName)"
  nic_id="$(az vm show \
    --resource-group "${RESOURCE_GROUP}" \
    --name "${vm_name}" \
    --query "networkProfile.networkInterfaces[0].id" \
    -o tsv)"
  nsg_id="$(az network nic show --ids "${nic_id}" --query "networkSecurityGroup.id" -o tsv)"
  if [[ -z "${nsg_id}" ]]; then
    subnet_id="$(az network nic show --ids "${nic_id}" --query "ipConfigurations[0].subnet.id" -o tsv)"
    nsg_id="$(az network vnet subnet show --ids "${subnet_id}" --query "networkSecurityGroup.id" -o tsv)"
  fi
  if [[ -z "${nsg_id}" ]]; then
    echo "Could not find an NSG on the VM NIC or subnet." >&2
    exit 1
  fi

  NSG_NAME="${nsg_id##*/}"
  NSG_RESOURCE_GROUP="$(resource_group_from_id "${nsg_id}")"
}

rule_names() {
  node -e "
const raw = process.argv[1] || '';
console.log(raw.split(/[,\s]+/).filter(Boolean).join('\n'));
" "${TLS_RULE_NAMES}"
}

rule_access() {
  local rule_name="$1"
  az network nsg rule show \
    --resource-group "${NSG_RESOURCE_GROUP}" \
    --nsg-name "${NSG_NAME}" \
    --name "${rule_name}" \
    --query access \
    -o tsv 2>/dev/null || true
}

update_tls_rule_access() {
  local access="$1"
  local updated=0
  while IFS= read -r rule_name; do
    [[ -z "${rule_name}" ]] && continue
    if [[ -z "$(rule_access "${rule_name}")" ]]; then
      echo "Skipping missing NSG rule ${NSG_NAME}/${rule_name}." >&2
      continue
    fi
    az network nsg rule update \
      --resource-group "${NSG_RESOURCE_GROUP}" \
      --nsg-name "${NSG_NAME}" \
      --name "${rule_name}" \
      --access "${access}" \
      -o none
    echo "Set ${NSG_NAME}/${rule_name} access to ${access}."
    updated=$((updated + 1))
  done < <(rule_names)

  if [[ "${updated}" -eq 0 ]]; then
    echo "No TLS NSG rules were updated." >&2
    exit 1
  fi
}

resolve_ipv4() {
  node -e "
const dns = require('dns').promises;
dns.resolve4(process.argv[1]).then((records) => {
  console.log(records.join('\n'));
}).catch(() => process.exit(2));
" "$1"
}

derive_dns_record_set_name() {
  node -e "
const host = (process.argv[1] || '').replace(/\.$/, '').toLowerCase();
const zone = (process.argv[2] || '').replace(/\.$/, '').toLowerCase();
if (!host || !zone) process.exit(1);
if (host === zone) {
  console.log('@');
  process.exit(0);
}
if (!host.endsWith('.' + zone)) {
  console.error(host + ' is not inside DNS zone ' + zone);
  process.exit(2);
}
console.log(host.slice(0, -(zone.length + 1)));
" "${ORIGIN_TLS_HOSTNAME}" "${DNS_ZONE_NAME}"
}

resolve_dns_zone() {
  if [[ -n "${DNS_RESOURCE_GROUP}" ]]; then
    return 0
  fi

  DNS_RESOURCE_GROUP="$(az network dns zone list \
    --query "[?name=='${DNS_ZONE_NAME}'].resourceGroup | [0]" \
    -o tsv 2>/dev/null || true)"
  [[ -n "${DNS_RESOURCE_GROUP}" ]]
}

dns_record_set_name() {
  if [[ -n "${DNS_RECORD_SET_NAME}" ]]; then
    echo "${DNS_RECORD_SET_NAME}"
    return
  fi
  derive_dns_record_set_name
}

dns_record_values() {
  local record_set_name="$1"
  az network dns record-set a show \
    --resource-group "${DNS_RESOURCE_GROUP}" \
    --zone-name "${DNS_ZONE_NAME}" \
    --name "${record_set_name}" \
    --query "arecords[].ipv4Address" \
    -o tsv 2>/dev/null || true
}

http_status() {
  local url="$1"
  local output_file="$2"
  local status
  local curl_exit
  set +e
  status="$(curl -sS --connect-timeout 10 --max-time 20 -o "${output_file}" -w "%{http_code}" "${url}" 2>"${output_file}.err")"
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
  status="$(http_status "${ENTERPRISE_URL%/}/readiness?origin_tls_prep_ts=$(date +%s)" "${tmp_file}")"
  if [[ "${status}" != "200" ]]; then
    echo "Refusing origin TLS preparation: ${ENTERPRISE_URL%/}/readiness returned HTTP ${status}." >&2
    exit 1
  fi

  node -e "
const fs = require('fs');
const payload = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
if (payload.production_ready !== true) {
  console.error('Refusing origin TLS preparation: production_ready is not true.');
  process.exit(1);
}
const blockers = Array.isArray(payload.production_blockers) ? payload.production_blockers : [];
if (blockers.length > 0) {
  console.error('Refusing origin TLS preparation: production blockers remain: ' + blockers.join(', '));
  process.exit(1);
}
" "${tmp_file}"
}

require_tls_preflight() {
  if [[ "${SKIP_TLS_PREFLIGHT}" == "true" ]]; then
    echo "Skipping strict TLS preflight because SKIP_TLS_PREFLIGHT=true."
    return
  fi

  CUTOVER_READY_REQUIRED=true \
  ORIGIN_TLS_HOSTNAME="${ORIGIN_TLS_HOSTNAME}" \
  RESOURCE_GROUP="${RESOURCE_GROUP}" \
  DEPLOYMENT_NAME="${DEPLOYMENT_NAME}" \
  ENTERPRISE_URL="${ENTERPRISE_URL}" \
  bash "${SCRIPT_DIR}/verify-origin-tls-readiness.sh"
}

require_confirmation() {
  local expected="$1"
  local action_description="$2"
  if [[ "${CONFIRM_ORIGIN_TLS_PREP}" != "${expected}" ]]; then
    echo "Refusing ${action_description}: set CONFIRM_ORIGIN_TLS_PREP=${expected}." >&2
    exit 1
  fi
}

subscription_id() {
  az account show --query id -o tsv
}

apim_api_resource_id() {
  local apim_name="$1"
  echo "/subscriptions/$(subscription_id)/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.ApiManagement/service/${apim_name}/apis/${APIM_API_ID}"
}

apim_current_backend_url() {
  local apim_name="$1"
  local api_id
  api_id="$(apim_api_resource_id "${apim_name}")"
  az resource show \
    --ids "${api_id}" \
    --api-version 2024-05-01 \
    --query "properties.serviceUrl" \
    -o tsv
}

update_apim_backend_url() {
  local apim_name="$1"
  local service_url="$2"
  local api_id
  local body_file
  api_id="$(apim_api_resource_id "${apim_name}")"
  body_file="$(mktemp)"
  trap 'rm -f "${body_file}"' RETURN
  node -e "
const fs = require('fs');
fs.writeFileSync(process.argv[1], JSON.stringify({ properties: { serviceUrl: process.argv[2] } }));
" "${body_file}" "${service_url}"
  az rest \
    --method patch \
    --url "https://management.azure.com${api_id}?api-version=2024-05-01" \
    --body @"${body_file}" \
    -o none
}

upsert_origin_dns_record() {
  local vm_public_ip
  local record_set_name
  local current_records
  vm_public_ip="$(deployment_output confidentialVmPublicIp)"
  resolve_dns_zone || {
    echo "Could not find Azure DNS zone ${DNS_ZONE_NAME}. Set DNS_RESOURCE_GROUP if it exists in another resource group, or create the DNS record at your external DNS provider." >&2
    exit 1
  }
  record_set_name="$(dns_record_set_name)"

  az network dns record-set a create \
    --resource-group "${DNS_RESOURCE_GROUP}" \
    --zone-name "${DNS_ZONE_NAME}" \
    --name "${record_set_name}" \
    --ttl "${DNS_TTL}" \
    -o none >/dev/null 2>&1 || true

  current_records="$(dns_record_values "${record_set_name}")"
  if grep -Fxq "${vm_public_ip}" <<< "${current_records}"; then
    echo "Azure DNS A record already contains ${ORIGIN_TLS_HOSTNAME} -> ${vm_public_ip}."
    return
  fi

  az network dns record-set a add-record \
    --resource-group "${DNS_RESOURCE_GROUP}" \
    --zone-name "${DNS_ZONE_NAME}" \
    --record-set-name "${record_set_name}" \
    --ipv4-address "${vm_public_ip}" \
    -o none
  echo "Added Azure DNS A record ${ORIGIN_TLS_HOSTNAME} -> ${vm_public_ip} in ${DNS_RESOURCE_GROUP}/${DNS_ZONE_NAME} (${record_set_name})."
}

remove_origin_dns_record() {
  local vm_public_ip
  local record_set_name
  vm_public_ip="$(deployment_output confidentialVmPublicIp)"
  resolve_dns_zone || {
    echo "Could not find Azure DNS zone ${DNS_ZONE_NAME}. Set DNS_RESOURCE_GROUP if it exists in another resource group." >&2
    exit 1
  }
  record_set_name="$(dns_record_set_name)"

  az network dns record-set a remove-record \
    --resource-group "${DNS_RESOURCE_GROUP}" \
    --zone-name "${DNS_ZONE_NAME}" \
    --record-set-name "${record_set_name}" \
    --ipv4-address "${vm_public_ip}" \
    --keep-empty-record-set \
    -o none
  echo "Removed Azure DNS A record ${ORIGIN_TLS_HOSTNAME} -> ${vm_public_ip} from ${DNS_RESOURCE_GROUP}/${DNS_ZONE_NAME} (${record_set_name})."
}

show_plan() {
  local vm_public_ip
  local apim_name
  local current_apim_backend
  local dns_records
  local dns_exit
  local record_set_name
  vm_public_ip="$(deployment_output confidentialVmPublicIp)"
  apim_name="$(apim_output apiManagementName)"
  record_set_name="$(dns_record_set_name)"

  echo "VaultProof origin TLS preparation plan"
  echo "  resource group:    ${RESOURCE_GROUP}"
  echo "  deployment:        ${DEPLOYMENT_NAME}"
  echo "  APIM deployment:   ${APIM_DEPLOYMENT_NAME}"
  echo "  origin TLS host:   ${ORIGIN_TLS_HOSTNAME}"
  echo "  target HTTPS URL:  ${ORIGIN_TLS_BACKEND_URL}"
  echo "  VM public IP:      ${vm_public_ip}"
  echo "  NSG:               ${NSG_RESOURCE_GROUP}/${NSG_NAME}"
  echo

  echo "DNS:"
  if resolve_dns_zone; then
    echo "  Azure DNS zone: ${DNS_RESOURCE_GROUP}/${DNS_ZONE_NAME}"
    echo "  record set:     ${record_set_name}"
  else
    echo "  Azure DNS zone: <not found for ${DNS_ZONE_NAME}>"
    echo "  record set:     ${record_set_name}"
  fi
  set +e
  dns_records="$(resolve_ipv4 "${ORIGIN_TLS_HOSTNAME}")"
  dns_exit=$?
  set -e
  echo "  expected A: ${vm_public_ip}"
  if [[ "${dns_exit}" -eq 0 && -n "${dns_records}" ]]; then
    echo "${dns_records}" | sed 's/^/  current A:  /'
  else
    echo "  current A:  <none>"
  fi
  echo

  echo "NSG TLS rules:"
  while IFS= read -r rule_name; do
    [[ -z "${rule_name}" ]] && continue
    access="$(rule_access "${rule_name}")"
    echo "  ${rule_name}: ${access:-missing}"
  done < <(rule_names)
  echo

  echo "APIM backend:"
  if [[ -z "${apim_name}" ]]; then
    echo "  APIM is not deployed in ${APIM_DEPLOYMENT_NAME}."
  else
    current_apim_backend="$(apim_current_backend_url "${apim_name}")"
    echo "  APIM service: ${apim_name}"
    echo "  API id:       ${APIM_API_ID}"
    echo "  current:      ${current_apim_backend}"
    echo "  HTTPS target: ${ORIGIN_TLS_BACKEND_URL}"
  fi
  echo

  echo "Safe next steps:"
  echo "  1. Point DNS: ${ORIGIN_TLS_HOSTNAME} -> ${vm_public_ip}."
  echo "     If ${DNS_ZONE_NAME} is hosted in Azure DNS here:"
  echo "     ACTION=upsert-origin-dns CONFIRM_ORIGIN_TLS_PREP=create-origin-dns-record npm run prepare:enterprise-origin-tls"
  echo "  2. Install a publicly trusted certificate for ${ORIGIN_TLS_HOSTNAME} on the VM."
  echo "  3. Open NSG 443 only when ready:"
  echo "     ACTION=enable-nsg443 CONFIRM_ORIGIN_TLS_PREP=open-origin-443 npm run prepare:enterprise-origin-tls"
  echo "  4. Rerun strict readiness:"
  echo "     CUTOVER_READY_REQUIRED=true npm run verify:enterprise-origin-tls"
  echo "  5. Point APIM to the HTTPS origin after strict TLS readiness passes:"
  echo "     ACTION=update-apim-backend-https CONFIRM_ORIGIN_TLS_PREP=point-apim-to-origin-tls npm run prepare:enterprise-origin-tls"
  echo "  6. Then consider the confirmation-gated Front Door cutover:"
  echo "     ACTION=enable CONFIRM_ORIGIN_TLS_CUTOVER=enable-origin-https RUN_VERIFIER=true npm run cutover:enterprise-origin-tls"
  echo
  echo "Rollback DNS record if needed:"
  echo "  ACTION=remove-origin-dns CONFIRM_ORIGIN_TLS_PREP=remove-origin-dns-record npm run prepare:enterprise-origin-tls"
}

require_command az
require_command curl
require_command node
resolve_nsg

case "${ACTION}" in
  plan)
    show_plan
    ;;
  upsert-origin-dns)
    require_confirmation "create-origin-dns-record" "origin DNS A record upsert"
    require_production_ready
    upsert_origin_dns_record
    ;;
  remove-origin-dns)
    require_confirmation "remove-origin-dns-record" "origin DNS A record removal"
    remove_origin_dns_record
    ;;
  enable-nsg443)
    require_confirmation "open-origin-443" "NSG 443 open"
    require_production_ready
    update_tls_rule_access Allow
    echo "Opened origin TLS port 443 to the configured Front Door service tags."
    ;;
  disable-nsg443)
    require_confirmation "close-origin-443" "NSG 443 close"
    update_tls_rule_access Deny
    echo "Closed origin TLS port 443 for the configured Front Door service tags."
    ;;
  update-apim-backend-https)
    require_confirmation "point-apim-to-origin-tls" "APIM HTTPS backend update"
    require_production_ready
    require_tls_preflight
    apim_name="$(apim_output apiManagementName)"
    if [[ -z "${apim_name}" ]]; then
      echo "APIM is not deployed in ${APIM_DEPLOYMENT_NAME}." >&2
      exit 1
    fi
    update_apim_backend_url "${apim_name}" "${ORIGIN_TLS_BACKEND_URL}"
    echo "Updated APIM API ${APIM_API_ID} backend to ${ORIGIN_TLS_BACKEND_URL}."
    ;;
  rollback-apim-backend-http)
    require_confirmation "rollback-apim-backend-http" "APIM backend rollback"
    apim_name="$(apim_output apiManagementName)"
    if [[ -z "${apim_name}" ]]; then
      echo "APIM is not deployed in ${APIM_DEPLOYMENT_NAME}." >&2
      exit 1
    fi
    vm_public_ip="$(deployment_output confidentialVmPublicIp)"
    rollback_url="${ROLLBACK_APIM_BACKEND_URL:-http://${vm_public_ip}:3001}"
    update_apim_backend_url "${apim_name}" "${rollback_url}"
    echo "Rolled APIM API ${APIM_API_ID} backend back to ${rollback_url}."
    ;;
  *)
    echo "Unknown ACTION: ${ACTION}. Use plan, upsert-origin-dns, remove-origin-dns, enable-nsg443, disable-nsg443, update-apim-backend-https, or rollback-apim-backend-http." >&2
    exit 1
    ;;
esac
