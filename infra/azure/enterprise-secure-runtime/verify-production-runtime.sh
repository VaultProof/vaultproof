#!/usr/bin/env bash
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-vaultproof-enterprise}"
DEPLOYMENT_NAME="${DEPLOYMENT_NAME:-vp-enterprise-secure-runtime-eastus-hsm}"
ENTERPRISE_URL="${ENTERPRISE_URL:-https://enterprise.vaultproof.dev}"
FRONT_DOOR_PROFILE="${FRONT_DOOR_PROFILE:-vaultproof-enterprise-fd}"
FRONT_DOOR_ENDPOINT="${FRONT_DOOR_ENDPOINT:-vaultproof-enterprise}"
FRONT_DOOR_ROUTE="${FRONT_DOOR_ROUTE:-default-route}"
EXPECTED_FRONT_DOOR_FORWARDING_PROTOCOL="${EXPECTED_FRONT_DOOR_FORWARDING_PROTOCOL:-HttpOnly}"
ORIGIN_TLS_HOSTNAME="${ORIGIN_TLS_HOSTNAME:-}"
SSH_USER="${SSH_USER:-azureuser}"
RUN_SSH_CHECKS="${RUN_SSH_CHECKS:-true}"
EXPECTED_SSH_BOOTSTRAP_ACCESS="${EXPECTED_SSH_BOOTSTRAP_ACCESS:-Allow}"

failures=0

require_command() {
  local command_name="$1"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "FAIL missing required command: ${command_name}" >&2
    exit 1
  fi
}

pass() {
  echo "PASS $*"
}

fail() {
  echo "FAIL $*" >&2
  failures=$((failures + 1))
}

check_equals() {
  local label="$1"
  local actual="$2"
  local expected="$3"
  if [[ "${actual}" == "${expected}" ]]; then
    pass "${label}: ${actual}"
  else
    fail "${label}: expected ${expected}, got ${actual:-<empty>}"
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

http_status() {
  local url="$1"
  local output_file="$2"
  shift 2
  curl -sS --connect-timeout 10 --max-time 20 -o "${output_file}" -w "%{http_code}" "$@" "${url}"
}

require_command az
require_command curl
require_command node

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

echo "VaultProof enterprise production runtime verification"
echo "  resource group: ${RESOURCE_GROUP}"
echo "  deployment:     ${DEPLOYMENT_NAME}"
echo "  enterprise URL: ${ENTERPRISE_URL}"
echo

vm_name="$(deployment_output confidentialVmName)"
vm_public_ip="$(deployment_output confidentialVmPublicIp)"
vm_private_ip="$(deployment_output confidentialVmPrivateIp)"
vm_resource_id="$(deployment_output confidentialVmResourceId)"
attestation_uri="$(deployment_output attestationProviderUri)"

echo "Deployment outputs:"
echo "  VM name:         ${vm_name}"
echo "  VM public IP:    ${vm_public_ip}"
echo "  VM private IP:   ${vm_private_ip}"
echo "  VM resource ID:  ${vm_resource_id}"
echo "  Attestation URI: ${attestation_uri}"
echo

readiness_file="${tmp_dir}/readiness.json"
readiness_status="$(http_status "${ENTERPRISE_URL%/}/readiness?verify_ts=$(date +%s)" "${readiness_file}")"
check_equals "Front Door /readiness HTTP status" "${readiness_status}" "200"

if node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "${readiness_file}" >/dev/null 2>&1; then
  check_equals "control plane production_ready" "$(json_value "${readiness_file}" "p => p.production_ready")" "true"
  check_equals "control plane security_profile" "$(json_value "${readiness_file}" "p => p.security_profile")" "azure-confidential-production"
  check_equals "origin lock required" "$(json_value "${readiness_file}" "p => p.control_plane?.origin_lock_required")" "true"
  check_equals "Azure Front Door ID configured" "$(json_value "${readiness_file}" "p => p.control_plane?.azure_front_door_id_configured")" "true"
  check_equals "executor reachable" "$(json_value "${readiness_file}" "p => p.executor?.reachable")" "true"
  check_equals "executor production_ready" "$(json_value "${readiness_file}" "p => p.executor?.health?.production_ready")" "true"
  check_equals "executor key release mode" "$(json_value "${readiness_file}" "p => p.executor?.health?.key_release_mode")" "azure-secure-key-release"
  check_equals "executor hardware-bound release" "$(json_value "${readiness_file}" "p => p.executor?.health?.key_release_hardware_bound")" "true"
  check_equals "executor attestation evidence" "$(json_value "${readiness_file}" "p => p.executor?.health?.attestation_evidence_ready")" "true"
else
  fail "Front Door /readiness did not return valid JSON"
fi

echo
echo "Azure VM security profile:"
vm_security_json="${tmp_dir}/vm-security.json"
az vm show \
  --resource-group "${RESOURCE_GROUP}" \
  --name "${vm_name}" \
  --query "{securityType:securityProfile.securityType,secureBoot:securityProfile.uefiSettings.secureBootEnabled,vTpm:securityProfile.uefiSettings.vTpmEnabled,identity:identity.type}" \
  -o json > "${vm_security_json}"
check_equals "VM security type" "$(json_value "${vm_security_json}" "p => p.securityType")" "ConfidentialVM"
check_equals "VM secure boot" "$(json_value "${vm_security_json}" "p => p.secureBoot")" "true"
check_equals "VM vTPM" "$(json_value "${vm_security_json}" "p => p.vTpm")" "true"
check_equals "VM managed identity" "$(json_value "${vm_security_json}" "p => p.identity")" "SystemAssigned"

echo
echo "Azure Front Door profile:"
front_door_id="$(az afd profile show \
  --resource-group "${RESOURCE_GROUP}" \
  --profile-name "${FRONT_DOOR_PROFILE}" \
  --query frontDoorId \
  -o tsv)"
if [[ -n "${front_door_id}" ]]; then
  pass "Front Door ID present"
else
  fail "Front Door ID is missing"
fi

route_json="${tmp_dir}/front-door-route.json"
az afd route show \
  --resource-group "${RESOURCE_GROUP}" \
  --profile-name "${FRONT_DOOR_PROFILE}" \
  --endpoint-name "${FRONT_DOOR_ENDPOINT}" \
  --route-name "${FRONT_DOOR_ROUTE}" \
  --query "{enabledState:enabledState,forwardingProtocol:forwardingProtocol,httpsRedirect:httpsRedirect}" \
  -o json > "${route_json}"
check_equals "Front Door route enabled" "$(json_value "${route_json}" "p => p.enabledState")" "Enabled"
check_equals "Front Door origin forwarding protocol" "$(json_value "${route_json}" "p => p.forwardingProtocol")" "${EXPECTED_FRONT_DOOR_FORWARDING_PROTOCOL}"

echo
echo "NSG ingress posture:"
nic_id="$(az vm show --resource-group "${RESOURCE_GROUP}" --name "${vm_name}" --query "networkProfile.networkInterfaces[0].id" -o tsv)"
nsg_id="$(az network nic show --ids "${nic_id}" --query "networkSecurityGroup.id" -o tsv)"
if [[ -z "${nsg_id}" ]]; then
  subnet_id="$(az network nic show --ids "${nic_id}" --query "ipConfigurations[0].subnet.id" -o tsv)"
  nsg_id="$(az network vnet subnet show --ids "${subnet_id}" --query "networkSecurityGroup.id" -o tsv)"
fi
if [[ -z "${nsg_id}" ]]; then
  fail "VM NIC/subnet has no NSG attached"
else
  nsg_name="${nsg_id##*/}"
  nsg_resource_group="$(node -e "
const id = process.argv[1];
const match = id.match(/\/resourceGroups\/([^/]+)/i);
if (match) console.log(match[1]);
" "${nsg_id}")"
  pass "VM NIC/subnet has NSG attached: ${nsg_name}"
  nsg_rules_file="${tmp_dir}/nsg-rules.json"
  az network nsg rule list --resource-group "${nsg_resource_group}" --nsg-name "${nsg_name}" -o json > "${nsg_rules_file}"
  public_3001_allows="$(json_value "${nsg_rules_file}" "rules => rules.filter((rule) => {
    const props = rule.properties || {};
    if (props.direction !== 'Inbound' || props.access !== 'Allow') return false;
    const source = props.sourceAddressPrefix || '';
    const sources = props.sourceAddressPrefixes || [];
    const ports = [props.destinationPortRange, ...(props.destinationPortRanges || [])].filter(Boolean);
    const sourceMatches = source === 'Internet' || source === '*' || sources.includes('Internet') || sources.includes('*');
    const portMatches = ports.includes('3001') || ports.includes('*');
    return sourceMatches && portMatches;
  }).map((rule) => rule.name)")"
  if [[ -z "${public_3001_allows}" ]]; then
    pass "No broad Internet allow rule for control-plane port 3001"
  else
    fail "Broad Internet allow rule exists for port 3001: ${public_3001_allows//$'\n'/, }"
  fi

  ssh_bootstrap_access="$(json_value "${nsg_rules_file}" "rules => {
    const rule = rules.find((candidate) => candidate.name === 'AllowSshBootstrap');
    return rule?.properties?.access;
  }")"
  if [[ -n "${EXPECTED_SSH_BOOTSTRAP_ACCESS}" ]]; then
    check_equals "SSH bootstrap NSG access" "${ssh_bootstrap_access}" "${EXPECTED_SSH_BOOTSTRAP_ACCESS}"
  else
    echo "SKIP SSH bootstrap NSG access check because EXPECTED_SSH_BOOTSTRAP_ACCESS is empty"
  fi
fi

echo
echo "Direct origin access checks:"
direct_file="${tmp_dir}/direct-public-origin.txt"
set +e
direct_status="$(curl -sS --connect-timeout 10 --max-time 15 -H "host: ${ENTERPRISE_URL#https://}" -o "${direct_file}" -w "%{http_code}" "http://${vm_public_ip}:3001/health" 2>"${tmp_dir}/direct-public-origin.err")"
direct_exit=$?
set -e
if [[ "${direct_exit}" -ne 0 ]]; then
  pass "Direct public origin access blocked before app layer"
elif [[ "${direct_status}" == "403" ]]; then
  pass "Direct public origin access rejected by origin lock"
else
  fail "Direct public origin access returned HTTP ${direct_status}; expected timeout/block or 403"
fi

if [[ "${RUN_SSH_CHECKS}" == "true" ]]; then
  private_status="$(ssh -o BatchMode=yes -o ConnectTimeout=10 "${SSH_USER}@${vm_public_ip}" \
    "curl -sS -o /tmp/vaultproof-private-origin-check.txt -w '%{http_code}' -H 'host: ${ENTERPRISE_URL#https://}' http://${vm_private_ip}:3001/health")"
  check_equals "Private non-loopback origin access without FDID" "${private_status}" "403"

  loopback_file="${tmp_dir}/loopback-readiness.json"
  ssh -o BatchMode=yes -o ConnectTimeout=10 "${SSH_USER}@${vm_public_ip}" \
    "curl -sS -H 'host: ${ENTERPRISE_URL#https://}' http://127.0.0.1:3001/readiness" > "${loopback_file}"
  check_equals "Loopback readiness production_ready" "$(json_value "${loopback_file}" "p => p.production_ready")" "true"

  if [[ -n "${ORIGIN_TLS_HOSTNAME}" ]]; then
    tls_file="${tmp_dir}/origin-tls-health.json"
    tls_status="$(ssh -o BatchMode=yes -o ConnectTimeout=10 "${SSH_USER}@${vm_public_ip}" \
      "curl -sS --connect-timeout 10 --max-time 20 --resolve '${ORIGIN_TLS_HOSTNAME}:443:127.0.0.1' -o /tmp/vaultproof-origin-tls-health.json -w '%{http_code}' https://${ORIGIN_TLS_HOSTNAME}/health")"
    ssh -o BatchMode=yes -o ConnectTimeout=10 "${SSH_USER}@${vm_public_ip}" \
      "cat /tmp/vaultproof-origin-tls-health.json" > "${tls_file}"
    check_equals "Local TLS origin /health status" "${tls_status}" "200"
    check_equals "Local TLS origin health ok" "$(json_value "${tls_file}" "p => p.status")" "ok"
  fi
else
  echo "SKIP SSH-based VM checks because RUN_SSH_CHECKS=false"
fi

echo
if [[ "${failures}" -eq 0 ]]; then
  echo "VaultProof enterprise production runtime verification passed."
else
  echo "VaultProof enterprise production runtime verification failed with ${failures} issue(s)." >&2
  exit 1
fi
