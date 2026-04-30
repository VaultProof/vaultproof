#!/usr/bin/env bash
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-vaultproof-enterprise}"
DEPLOYMENT_NAME="${DEPLOYMENT_NAME:-vp-enterprise-secure-runtime-eastus-hsm}"
ACTION="${ACTION:-plan}"
CONFIRM_ALTERNATE_ACCESS="${CONFIRM_ALTERNATE_ACCESS:-}"
BASTION_SUBNET_PREFIX="${BASTION_SUBNET_PREFIX:-10.42.254.0/26}"
BASTION_NAME="${BASTION_NAME:-}"
BASTION_PUBLIC_IP_NAME="${BASTION_PUBLIC_IP_NAME:-}"

require_command() {
  local command_name="$1"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Missing required command: ${command_name}" >&2
    exit 1
  fi
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

require_confirmation() {
  local expected="$1"
  local action_description="$2"
  if [[ "${CONFIRM_ALTERNATE_ACCESS}" != "${expected}" ]]; then
    echo "Refusing ${action_description}: set CONFIRM_ALTERNATE_ACCESS=${expected} to confirm this live Azure change." >&2
    exit 1
  fi
}

load_context() {
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
  if [[ -z "${nic_id}" ]]; then
    echo "Could not resolve the VM NIC from ${vm_name}." >&2
    exit 1
  fi

  nic_json="${tmp_dir}/nic.json"
  az network nic show --ids "${nic_id}" -o json > "${nic_json}"
  subnet_id="$(json_value "${nic_json}" "p => p.ipConfigurations?.[0]?.subnet?.id || ''")"
  if [[ -z "${subnet_id}" ]]; then
    echo "Could not resolve the VM subnet from ${nic_id}." >&2
    exit 1
  fi

  vnet_id="${subnet_id%/subnets/*}"
  vnet_name="$(resource_name_from_id virtualNetworks "${vnet_id}")"
  vnet_resource_group="$(resource_group_from_id "${vnet_id}")"
  BASTION_NAME="${BASTION_NAME:-${vnet_name}-bastion}"
  BASTION_PUBLIC_IP_NAME="${BASTION_PUBLIC_IP_NAME:-${vnet_name}-bastion-pip}"
}

boot_diagnostics_enabled() {
  json_value "${vm_json}" "p => p.diagnosticsProfile?.bootDiagnostics?.enabled"
}

bastion_subnet_exists() {
  az network vnet subnet show \
    --resource-group "${vnet_resource_group}" \
    --vnet-name "${vnet_name}" \
    --name AzureBastionSubnet \
    >/dev/null 2>&1
}

bastion_host_exists() {
  az network bastion show \
    --resource-group "${vnet_resource_group}" \
    --name "${BASTION_NAME}" \
    >/dev/null 2>&1
}

public_ip_exists() {
  az network public-ip show \
    --resource-group "${vnet_resource_group}" \
    --name "${BASTION_PUBLIC_IP_NAME}" \
    >/dev/null 2>&1
}

show_plan() {
  local boot_enabled
  boot_enabled="$(boot_diagnostics_enabled)"

  echo "VaultProof alternate access preparation plan"
  echo "  resource group:       ${RESOURCE_GROUP}"
  echo "  deployment:           ${DEPLOYMENT_NAME}"
  echo "  VM:                   ${vm_name}"
  echo "  VM public IP:         ${vm_public_ip}"
  echo "  location:             ${location}"
  echo "  VNet:                 ${vnet_resource_group}/${vnet_name}"
  echo "  Bastion subnet CIDR:  ${BASTION_SUBNET_PREFIX}"
  echo "  Bastion host:         ${BASTION_NAME}"
  echo "  Bastion public IP:    ${BASTION_PUBLIC_IP_NAME}"
  echo

  echo "Current state:"
  echo "  boot diagnostics:     ${boot_enabled:-false}"
  if bastion_subnet_exists; then
    echo "  AzureBastionSubnet:   present"
  else
    echo "  AzureBastionSubnet:   missing"
  fi
  if bastion_host_exists; then
    echo "  Bastion host:         present"
  else
    echo "  Bastion host:         missing"
  fi
  echo

  echo "Guarded setup actions:"
  echo "  ACTION=enable-boot-diagnostics CONFIRM_ALTERNATE_ACCESS=enable-boot-diagnostics npm run prepare:enterprise-alternate-access"
  echo "  ACTION=create-bastion-subnet CONFIRM_ALTERNATE_ACCESS=create-bastion-subnet npm run prepare:enterprise-alternate-access"
  echo "  ACTION=create-bastion-host CONFIRM_ALTERNATE_ACCESS=create-bastion-host npm run prepare:enterprise-alternate-access"
  echo
  echo "Recommended order before closing public SSH:"
  echo "  1. Enable boot diagnostics so serial-console prerequisites are present."
  echo "  2. Create AzureBastionSubnet and a Bastion host if you want browser-based operator access."
  echo "  3. Rerun: npm run verify:enterprise-alternate-access"
  echo "  4. Only then close SSH with: ALTERNATE_ACCESS_ACK=true CONFIRM_SSH_LOCKDOWN=close-public-ssh ACTION=close npm run harden:enterprise-ssh"
}

enable_boot_diagnostics() {
  require_confirmation "enable-boot-diagnostics" "boot diagnostics enable"
  az vm boot-diagnostics enable \
    --resource-group "${RESOURCE_GROUP}" \
    --name "${vm_name}" \
    -o none
  echo "Enabled boot diagnostics on ${vm_name}."
  echo "Verify with: npm run verify:enterprise-alternate-access"
}

create_bastion_subnet() {
  require_confirmation "create-bastion-subnet" "AzureBastionSubnet create"
  if bastion_subnet_exists; then
    echo "AzureBastionSubnet already exists in ${vnet_resource_group}/${vnet_name}."
    return
  fi

  az network vnet subnet create \
    --resource-group "${vnet_resource_group}" \
    --vnet-name "${vnet_name}" \
    --name AzureBastionSubnet \
    --address-prefixes "${BASTION_SUBNET_PREFIX}" \
    -o none
  echo "Created AzureBastionSubnet ${BASTION_SUBNET_PREFIX} in ${vnet_resource_group}/${vnet_name}."
}

create_bastion_host() {
  require_confirmation "create-bastion-host" "Azure Bastion host create"
  if ! bastion_subnet_exists; then
    echo "AzureBastionSubnet is missing. Run ACTION=create-bastion-subnet first." >&2
    exit 1
  fi

  if ! public_ip_exists; then
    az network public-ip create \
      --resource-group "${vnet_resource_group}" \
      --name "${BASTION_PUBLIC_IP_NAME}" \
      --location "${location}" \
      --sku Standard \
      --allocation-method Static \
      -o none
    echo "Created Bastion public IP ${vnet_resource_group}/${BASTION_PUBLIC_IP_NAME}."
  fi

  if bastion_host_exists; then
    echo "Bastion host ${vnet_resource_group}/${BASTION_NAME} already exists."
    return
  fi

  echo "Creating Azure Bastion host ${vnet_resource_group}/${BASTION_NAME}. This can take several minutes and creates billable Azure resources."
  az network bastion create \
    --resource-group "${vnet_resource_group}" \
    --name "${BASTION_NAME}" \
    --location "${location}" \
    --vnet-name "${vnet_name}" \
    --public-ip-address "${BASTION_PUBLIC_IP_NAME}" \
    -o none
  echo "Created Bastion host ${vnet_resource_group}/${BASTION_NAME}."
  echo "Verify with: npm run verify:enterprise-alternate-access"
}

require_command az
require_command node

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT
load_context

case "${ACTION}" in
  plan)
    show_plan
    ;;
  enable-boot-diagnostics)
    enable_boot_diagnostics
    ;;
  create-bastion-subnet)
    create_bastion_subnet
    ;;
  create-bastion-host)
    create_bastion_host
    ;;
  *)
    echo "Unknown ACTION: ${ACTION}. Use plan, enable-boot-diagnostics, create-bastion-subnet, or create-bastion-host." >&2
    exit 1
    ;;
esac
