#!/usr/bin/env bash
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-vaultproof-enterprise}"
DEPLOYMENT_NAME="${DEPLOYMENT_NAME:-vp-enterprise-secure-runtime-eastus-hsm}"
SSH_RULE_NAME="${SSH_RULE_NAME:-AllowSshBootstrap}"
REQUIRE_ALTERNATE_ACCESS_READY="${REQUIRE_ALTERNATE_ACCESS_READY:-false}"

failures=0
warnings=0
ready_paths=0

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

warn() {
  echo "WARN $*" >&2
  warnings=$((warnings + 1))
}

blocker() {
  echo "BLOCKER $*" >&2
  failures=$((failures + 1))
}

json_value() {
  local file="$1"
  local expression="$2"
  shift 2
  node -e "
const fs = require('fs');
const payload = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const value = (${expression})(payload);
if (Array.isArray(value)) {
  console.log(value.join('\\n'));
} else if (value !== undefined && value !== null) {
  console.log(String(value));
}
" "${file}" "$@"
}

deployment_output() {
  local output_name="$1"
  az deployment group show \
    --resource-group "${RESOURCE_GROUP}" \
    --name "${DEPLOYMENT_NAME}" \
    --query "properties.outputs.${output_name}.value" \
    -o tsv
}

resource_group_from_id() {
  node -e "
const id = process.argv[1] || '';
const match = id.match(/\/resourceGroups\/([^/]+)/i);
if (match) console.log(match[1]);
" "$1"
}

resource_name_from_id() {
  local resource_type="$1"
  local id="$2"
  node -e "
const type = process.argv[1];
const id = process.argv[2] || '';
const pattern = new RegExp('/' + type + '/([^/]+)', 'i');
const match = id.match(pattern);
if (match) console.log(match[1]);
" "${resource_type}" "${id}"
}

require_command az
require_command node

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

echo "VaultProof alternate operator access readiness"
echo "  resource group: ${RESOURCE_GROUP}"
echo "  deployment:     ${DEPLOYMENT_NAME}"
echo "  SSH rule:       ${SSH_RULE_NAME}"
echo "  strict mode:    ${REQUIRE_ALTERNATE_ACCESS_READY}"
echo

vm_name="$(deployment_output confidentialVmName)"
vm_public_ip="$(deployment_output confidentialVmPublicIp)"
vm_resource_id="$(deployment_output confidentialVmResourceId)"

vm_json="${tmp_dir}/vm.json"
az vm show \
  --resource-group "${RESOURCE_GROUP}" \
  --name "${vm_name}" \
  --query "{id:id,location:location,diagnosticsProfile:diagnosticsProfile,networkProfile:networkProfile}" \
  -o json > "${vm_json}"

location="$(json_value "${vm_json}" "p => p.location")"
nic_id="$(json_value "${vm_json}" "p => p.networkProfile?.networkInterfaces?.[0]?.id || ''")"

echo "VM:"
echo "  name:      ${vm_name}"
echo "  public IP: ${vm_public_ip}"
echo "  location:  ${location}"
echo "  id:        ${vm_resource_id}"
echo

if [[ -z "${nic_id}" ]]; then
  blocker "VM has no primary NIC in networkProfile."
else
  nic_json="${tmp_dir}/nic.json"
  az network nic show --ids "${nic_id}" -o json > "${nic_json}"
  subnet_id="$(json_value "${nic_json}" "p => p.ipConfigurations?.[0]?.subnet?.id || ''")"
  nsg_id="$(json_value "${nic_json}" "p => p.networkSecurityGroup?.id || ''")"
  if [[ -z "${nsg_id}" && -n "${subnet_id}" ]]; then
    subnet_json="${tmp_dir}/subnet.json"
    az network vnet subnet show --ids "${subnet_id}" -o json > "${subnet_json}"
    nsg_id="$(json_value "${subnet_json}" "p => p.networkSecurityGroup?.id || ''")"
  fi
fi

echo "Public SSH bootstrap:"
if [[ -z "${nsg_id:-}" ]]; then
  blocker "VM NIC/subnet has no NSG, so SSH bootstrap access cannot be assessed."
else
  nsg_name="${nsg_id##*/}"
  nsg_resource_group="$(resource_group_from_id "${nsg_id}")"
  ssh_rule_json="${tmp_dir}/ssh-rule.json"
  if az network nsg rule show \
    --resource-group "${nsg_resource_group}" \
    --nsg-name "${nsg_name}" \
    --name "${SSH_RULE_NAME}" \
    -o json > "${ssh_rule_json}" 2>/dev/null; then
    ssh_access="$(json_value "${ssh_rule_json}" "p => p.access || p.properties?.access || ''")"
    ssh_source="$(json_value "${ssh_rule_json}" "p => p.sourceAddressPrefix || p.properties?.sourceAddressPrefix || (p.sourceAddressPrefixes || p.properties?.sourceAddressPrefixes || []).join(',')")"
    echo "  NSG:     ${nsg_resource_group}/${nsg_name}"
    echo "  access:  ${ssh_access}"
    echo "  source:  ${ssh_source:-<empty>}"
    if [[ "${ssh_access}" == "Deny" ]]; then
      pass "Public SSH bootstrap is already closed."
    else
      warn "Public SSH bootstrap is still ${ssh_access:-unknown}; close only after another operator access path is ready."
    fi
  else
    blocker "Could not read NSG rule ${nsg_resource_group}/${nsg_name}/${SSH_RULE_NAME}."
  fi
fi
echo

echo "Boot diagnostics and serial console prerequisite:"
boot_enabled="$(json_value "${vm_json}" "p => p.diagnosticsProfile?.bootDiagnostics?.enabled")"
boot_storage_uri="$(json_value "${vm_json}" "p => p.diagnosticsProfile?.bootDiagnostics?.storageUri || ''")"
if [[ "${boot_enabled}" == "true" ]]; then
  ready_paths=$((ready_paths + 1))
  pass "Boot diagnostics is enabled; Azure serial console prerequisites are likely present."
  if [[ -n "${boot_storage_uri}" ]]; then
    echo "  storage URI: ${boot_storage_uri}"
  else
    echo "  storage URI: managed boot diagnostics"
  fi
else
  warn "Boot diagnostics is not enabled; Azure serial console is not a reliable break-glass path."
fi
echo

echo "Azure Bastion readiness:"
if [[ -z "${subnet_id:-}" ]]; then
  warn "Cannot resolve VM subnet, so Bastion readiness is unknown."
else
  vnet_id="${subnet_id%/subnets/*}"
  vnet_name="$(resource_name_from_id virtualNetworks "${vnet_id}")"
  vnet_resource_group="$(resource_group_from_id "${vnet_id}")"
  bastion_subnet_json="${tmp_dir}/bastion-subnet.json"
  if az network vnet subnet show \
    --resource-group "${vnet_resource_group}" \
    --vnet-name "${vnet_name}" \
    --name AzureBastionSubnet \
    -o json > "${bastion_subnet_json}" 2>/dev/null; then
    bastion_prefix="$(json_value "${bastion_subnet_json}" "p => p.addressPrefix || (p.addressPrefixes || []).join(',')")"
    pass "AzureBastionSubnet exists in ${vnet_resource_group}/${vnet_name}: ${bastion_prefix}"
  else
    warn "AzureBastionSubnet is missing from ${vnet_resource_group}/${vnet_name}."
  fi

  bastions_json="${tmp_dir}/bastions.json"
  if az network bastion list --resource-group "${vnet_resource_group}" -o json > "${bastions_json}" 2>/dev/null; then
    bastion_matches="$(json_value "${bastions_json}" "items => items.filter((item) => {
      const subnetIds = (item.ipConfigurations || item.properties?.ipConfigurations || []).map((ip) => ip.subnet?.id || ip.properties?.subnet?.id || '');
      return subnetIds.some((id) => id.toLowerCase().startsWith(process.argv[2].toLowerCase()));
    }).map((item) => item.name)" "${vnet_id}")"
    if [[ -n "${bastion_matches}" ]]; then
      ready_paths=$((ready_paths + 1))
      pass "Azure Bastion host is attached to the VM VNet: ${bastion_matches//$'\n'/, }"
    else
      warn "No Azure Bastion host in ${vnet_resource_group} appears attached to ${vnet_name}."
    fi
  else
    warn "Could not list Azure Bastion hosts in ${vnet_resource_group}; check RBAC/provider registration."
  fi
fi
echo

echo "Defender JIT VM access visibility:"
jit_json="${tmp_dir}/jit.json"
if az security jit-policy list --location "${location}" -o json > "${jit_json}" 2>/dev/null; then
  jit_matches="$(json_value "${jit_json}" "policies => policies.flatMap((policy) => policy.virtualMachines || policy.properties?.virtualMachines || []).filter((vm) => String(vm.id || '').toLowerCase() === process.argv[2].toLowerCase()).map((vm) => vm.id)" "${vm_resource_id}")"
  if [[ -n "${jit_matches}" ]]; then
    ready_paths=$((ready_paths + 1))
    pass "Defender JIT policy includes ${vm_name}."
  else
    warn "No Defender JIT policy includes ${vm_name} in ${location}."
  fi
else
  warn "Could not query Defender JIT policies; Azure Security/Defender may be unavailable or not enabled."
fi

echo
echo "Alternate access summary:"
echo "  ready path count: ${ready_paths}"
if [[ "${ready_paths}" -gt 0 ]]; then
  pass "At least one alternate operator access signal is present."
else
  blocker "No alternate operator access path was detected. Keep public SSH bootstrap open until Bastion/JIT/serial-console/private access is ready."
fi

if [[ "${failures}" -eq 0 ]]; then
  echo "Alternate operator access readiness passed with ${warnings} warning(s)."
elif [[ "${REQUIRE_ALTERNATE_ACCESS_READY}" == "true" ]]; then
  echo "Alternate operator access readiness failed with ${failures} blocker(s) and ${warnings} warning(s)." >&2
  exit 1
else
  echo "Alternate operator access readiness found ${failures} blocker(s) and ${warnings} warning(s)."
  echo "Report-only mode is active. Set REQUIRE_ALTERNATE_ACCESS_READY=true to make blockers fail the command."
fi
