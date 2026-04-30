#!/usr/bin/env bash
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-vaultproof-enterprise}"
DEPLOYMENT_NAME="${DEPLOYMENT_NAME:-vp-enterprise-secure-runtime-eastus-hsm}"
APIM_DEPLOYMENT_NAME="${APIM_DEPLOYMENT_NAME:-${DEPLOYMENT_NAME}-apim}"
FRONT_DOOR_PROFILE="${FRONT_DOOR_PROFILE:-vaultproof-enterprise-fd}"
FRONT_DOOR_ORIGIN_GROUP="${FRONT_DOOR_ORIGIN_GROUP:-default-origin-group}"
ACTION="${ACTION:-plan}"

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
    -o tsv 2>/dev/null || true
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

subscription_id() {
  az account show --query id -o tsv
}

write_json_or_empty_array() {
  local output_file="$1"
  shift
  if "$@" -o json > "${output_file}" 2>/dev/null; then
    return
  fi
  printf '[]\n' > "${output_file}"
}

write_json_or_empty_object() {
  local output_file="$1"
  shift
  if "$@" -o json > "${output_file}" 2>/dev/null; then
    return
  fi
  printf '{}\n' > "${output_file}"
}

load_context() {
  vm_name="$(deployment_output confidentialVmName)"
  vm_public_ip="$(deployment_output confidentialVmPublicIp)"
  vm_private_ip="$(deployment_output confidentialVmPrivateIp)"
  executor_subnet_id="$(deployment_output executorSubnetId)"
  control_plane_subnet_id="$(deployment_output controlPlaneSubnetId)"
  apim_name="$(apim_output apiManagementName)"
  apim_gateway_url="$(apim_output apiManagementGatewayUrl)"
  apim_backend_url="$(apim_output apiManagementBackendUrl)"

  afd_profile_json="${tmp_dir}/afd-profile.json"
  write_json_or_empty_object "${afd_profile_json}" \
    az afd profile show \
      --resource-group "${RESOURCE_GROUP}" \
      --profile-name "${FRONT_DOOR_PROFILE}"

  afd_origins_json="${tmp_dir}/afd-origins.json"
  write_json_or_empty_array "${afd_origins_json}" \
    az afd origin list \
      --resource-group "${RESOURCE_GROUP}" \
      --profile-name "${FRONT_DOOR_PROFILE}" \
      --origin-group-name "${FRONT_DOOR_ORIGIN_GROUP}"

  vm_json="${tmp_dir}/vm.json"
  if [[ -n "${vm_name}" ]]; then
    write_json_or_empty_object "${vm_json}" \
      az vm show \
        --resource-group "${RESOURCE_GROUP}" \
        --name "${vm_name}"
  else
    printf '{}\n' > "${vm_json}"
  fi

  nic_id="$(json_value "${vm_json}" "p => p.networkProfile?.networkInterfaces?.[0]?.id || ''")"
  nic_json="${tmp_dir}/nic.json"
  if [[ -n "${nic_id}" ]]; then
    write_json_or_empty_object "${nic_json}" az network nic show --ids "${nic_id}"
  else
    printf '{}\n' > "${nic_json}"
  fi

  nsg_id="$(json_value "${nic_json}" "p => p.networkSecurityGroup?.id || ''")"
  if [[ -z "${nsg_id}" ]]; then
    local subnet_id
    subnet_id="$(json_value "${nic_json}" "p => p.ipConfigurations?.[0]?.subnet?.id || ''")"
    if [[ -n "${subnet_id}" ]]; then
      subnet_json="${tmp_dir}/subnet.json"
      write_json_or_empty_object "${subnet_json}" az network vnet subnet show --ids "${subnet_id}"
      nsg_id="$(json_value "${subnet_json}" "p => p.networkSecurityGroup?.id || ''")"
    fi
  fi

  nsg_rules_json="${tmp_dir}/nsg-rules.json"
  if [[ -n "${nsg_id}" ]]; then
    nsg_name="${nsg_id##*/}"
    nsg_resource_group="$(resource_group_from_id "${nsg_id}")"
    write_json_or_empty_array "${nsg_rules_json}" \
      az network nsg rule list \
        --resource-group "${nsg_resource_group}" \
        --nsg-name "${nsg_name}"
  else
    nsg_name=""
    nsg_resource_group=""
    printf '[]\n' > "${nsg_rules_json}"
  fi

  apim_json="${tmp_dir}/apim.json"
  if [[ -n "${apim_name}" ]]; then
    local apim_id
    apim_id="/subscriptions/$(subscription_id)/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.ApiManagement/service/${apim_name}"
    write_json_or_empty_object "${apim_json}" \
      az resource show \
        --ids "${apim_id}" \
        --api-version 2024-05-01
  else
    printf '{}\n' > "${apim_json}"
  fi
}

show_front_door_state() {
  node -e "
const fs = require('fs');
const profile = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const origins = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const sku = profile?.sku?.name || 'unknown';
console.log('Front Door:');
console.log('  profile:             ' + (profile?.name || process.argv[3]));
console.log('  sku:                 ' + sku);
console.log('  origin group:        ' + process.argv[4]);
if (sku !== 'Premium_AzureFrontDoor') {
  console.log('BLOCKER Front Door Private Link requires an Azure Front Door Premium profile.');
} else {
  console.log('  private-link capable: yes');
}
if (!Array.isArray(origins) || origins.length === 0) {
  console.log('WARN no Front Door origins were found for this origin group.');
  process.exit(0);
}
const rows = origins.map((origin) => {
  const privateLink = origin.sharedPrivateLinkResource || origin.properties?.sharedPrivateLinkResource || null;
  const host = origin.hostName || origin.properties?.hostName || '';
  const header = origin.originHostHeader || origin.properties?.originHostHeader || '';
  const state = origin.enabledState || origin.properties?.enabledState || '';
  const certNameCheck = origin.enforceCertificateNameCheck || origin.properties?.enforceCertificateNameCheck || '';
  return { name: origin.name, host, header, state, certNameCheck, privateLink: Boolean(privateLink) };
});
for (const row of rows) {
  console.log('  origin:              ' + row.name + ' host=' + row.host + ' state=' + row.state + ' privateLink=' + row.privateLink + ' certNameCheck=' + row.certNameCheck);
}
const privateCount = rows.filter((row) => row.privateLink).length;
const publicCount = rows.length - privateCount;
if (privateCount > 0 && publicCount > 0) {
  console.log('BLOCKER Front Door does not allow public and private-link origins in the same origin group.');
}
" "${afd_profile_json}" "${afd_origins_json}" "${FRONT_DOOR_PROFILE}" "${FRONT_DOOR_ORIGIN_GROUP}"
}

show_vm_network_state() {
  echo "Confidential VM network:"
  echo "  VM:                  ${vm_name:-unknown}"
  echo "  public IP:           ${vm_public_ip:-unknown}"
  echo "  private IP:          ${vm_private_ip:-unknown}"
  echo "  executor subnet:     ${executor_subnet_id:-unknown}"
  echo "  control subnet:      ${control_plane_subnet_id:-unknown}"
  if [[ -n "${nsg_name}" ]]; then
    echo "  NSG:                 ${nsg_resource_group}/${nsg_name}"
  else
    echo "WARN no NSG found on the VM NIC or subnet."
  fi

  node -e "
const fs = require('fs');
const rules = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const watchedPorts = new Set(['22', '3001', '443']);
const values = (value) => Array.isArray(value) ? value : [value].filter(Boolean);
const matchesPort = (rule) => {
  const ranges = [...values(rule.destinationPortRange), ...values(rule.destinationPortRanges)];
  return ranges.some((range) => range === '*' || watchedPorts.has(String(range)));
};
const inboundAllows = rules
  .filter((rule) => rule.direction === 'Inbound' && rule.access === 'Allow' && matchesPort(rule))
  .sort((a, b) => (a.priority || 0) - (b.priority || 0));
if (inboundAllows.length === 0) {
  console.log('  public ingress rules: none on watched ports 22/3001/443');
} else {
  console.log('  watched allow rules:');
  for (const rule of inboundAllows) {
    const ports = [...values(rule.destinationPortRange), ...values(rule.destinationPortRanges)].join(',');
    const sources = [...values(rule.sourceAddressPrefix), ...values(rule.sourceAddressPrefixes)].join(',');
    console.log('    - ' + rule.name + ' priority=' + rule.priority + ' ports=' + ports + ' source=' + sources);
  }
}
" "${nsg_rules_json}"
}

show_apim_state() {
  node -e "
const fs = require('fs');
const payload = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const name = process.argv[2] || '';
const gateway = process.argv[3] || '';
const backend = process.argv[4] || '';
console.log('API Management:');
if (!name) {
  console.log('WARN APIM deployment output is empty; APIM private-origin path is unavailable until APIM is deployed.');
  process.exit(0);
}
const sku = payload?.sku?.name || payload?.properties?.sku?.name || 'unknown';
const publicNetworkAccess = payload?.properties?.publicNetworkAccess || 'unknown';
const virtualNetworkType = payload?.properties?.virtualNetworkType || 'None/unknown';
const privateConnections = payload?.properties?.privateEndpointConnections || [];
console.log('  service:             ' + name);
console.log('  gateway:             ' + gateway);
console.log('  backend:             ' + backend);
console.log('  sku:                 ' + sku);
console.log('  public access:       ' + publicNetworkAccess);
console.log('  virtual network:     ' + virtualNetworkType);
console.log('  private endpoints:   ' + privateConnections.length);
if (backend.startsWith('http://')) {
  console.log('WARN APIM still forwards to an HTTP backend; finish TLS/private backend hardening before APIM becomes the active public route.');
}
" "${apim_json}" "${apim_name}" "${apim_gateway_url}" "${apim_backend_url}"
}

show_migration_plan() {
  cat <<'EOF'

Private-origin migration plan:
  1. Keep the current public VM origin live until TLS, APIM, and alternate access are verified.
  2. Use Azure Front Door Premium for Private Link to the origin.
  3. Do not mix public and private-link origins in the same origin group; create a separate private origin group or staged route cutover.
  4. Choose one private-origin target:
     - APIM private-origin path: Front Door Premium -> APIM over Private Link -> enterprise control plane.
     - Internal load balancer path: Front Door Premium -> Private Link service -> internal load balancer -> Confidential VM control plane.
  5. Require a trusted origin certificate whose subject matches the private origin host name.
  6. Approve the Front Door private endpoint connection, validate /health and /readiness, then deny public 3001/443 origin ingress.
  7. Close public SSH only after alternate operator access is ready.

Reference docs:
  - https://learn.microsoft.com/azure/frontdoor/private-link
  - https://learn.microsoft.com/azure/frontdoor/standard-premium/how-to-enable-private-link-internal-load-balancer
EOF
}

show_plan() {
  echo "VaultProof private-origin preparation plan"
  echo "  resource group:      ${RESOURCE_GROUP}"
  echo "  deployment:          ${DEPLOYMENT_NAME}"
  echo "  APIM deployment:     ${APIM_DEPLOYMENT_NAME}"
  echo "  Front Door profile:  ${FRONT_DOOR_PROFILE}"
  echo "  origin group:        ${FRONT_DOOR_ORIGIN_GROUP}"
  echo
  echo "This command is read-only. It does not create Private Link, APIM, load balancer, or Front Door resources."
  echo
  show_front_door_state
  echo
  show_apim_state
  echo
  show_vm_network_state
  show_migration_plan
}

case "${ACTION}" in
  plan)
    require_command az
    require_command node
    tmp_dir="$(mktemp -d)"
    trap 'rm -rf "${tmp_dir}"' EXIT
    load_context
    show_plan
    ;;
  *)
    echo "Unknown ACTION: ${ACTION}. Use plan." >&2
    exit 1
    ;;
esac
