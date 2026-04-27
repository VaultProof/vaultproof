#!/usr/bin/env bash
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-vaultproof-enterprise}"
DEPLOYMENT_NAME="${DEPLOYMENT_NAME:-vp-enterprise-secure-runtime-eastus-hsm}"
ENTERPRISE_URL="${ENTERPRISE_URL:-https://enterprise.vaultproof.dev}"
ACTION="${ACTION:-plan}"
SSH_RULE_NAME="${SSH_RULE_NAME:-AllowSshBootstrap}"
NSG_NAME="${NSG_NAME:-}"
NSG_RESOURCE_GROUP="${NSG_RESOURCE_GROUP:-}"
SKIP_READINESS_CHECK="${SKIP_READINESS_CHECK:-false}"

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

resource_group_from_id() {
  node -e "
const id = process.argv[1];
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

rule_access() {
  az network nsg rule show \
    --resource-group "${NSG_RESOURCE_GROUP}" \
    --nsg-name "${NSG_NAME}" \
    --name "${SSH_RULE_NAME}" \
    --query access \
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
    "${ENTERPRISE_URL%/}/readiness?ssh_lock_ts=$(date +%s)")"
  if [[ "${status}" != "200" ]]; then
    echo "Refusing to close SSH: ${ENTERPRISE_URL%/}/readiness returned HTTP ${status}." >&2
    exit 1
  fi

  node -e "
const fs = require('fs');
const payload = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
if (payload.production_ready !== true) {
  console.error('Refusing to close SSH: control plane production_ready is not true.');
  process.exit(1);
}
const blockers = Array.isArray(payload.production_blockers) ? payload.production_blockers : [];
if (blockers.length > 0) {
  console.error('Refusing to close SSH: production blockers remain: ' + blockers.join(', '));
  process.exit(1);
}
" "${tmp_file}"
}

require_command az
require_command node
resolve_nsg

case "${ACTION}" in
  plan)
    echo "VaultProof SSH bootstrap hardening plan"
    echo "  resource group: ${RESOURCE_GROUP}"
    echo "  deployment:     ${DEPLOYMENT_NAME}"
    echo "  NSG:            ${NSG_RESOURCE_GROUP}/${NSG_NAME}"
    echo "  rule:           ${SSH_RULE_NAME}"
    echo "  current access: $(rule_access)"
    echo
    echo "Close public SSH bootstrap after production readiness is verified:"
    echo "  ACTION=close bash infra/azure/enterprise-secure-runtime/harden-ssh-bootstrap.sh"
    echo
    echo "Reopen public SSH bootstrap as a break-glass step:"
    echo "  ACTION=reopen bash infra/azure/enterprise-secure-runtime/harden-ssh-bootstrap.sh"
    ;;
  close)
    require_production_ready
    az network nsg rule update \
      --resource-group "${NSG_RESOURCE_GROUP}" \
      --nsg-name "${NSG_NAME}" \
      --name "${SSH_RULE_NAME}" \
      --access Deny \
      -o none
    echo "Closed public SSH bootstrap by setting ${NSG_NAME}/${SSH_RULE_NAME} access to Deny."
    echo "Verify with: EXPECTED_SSH_BOOTSTRAP_ACCESS=Deny RUN_SSH_CHECKS=false npm run verify:enterprise-production"
    ;;
  reopen)
    az network nsg rule update \
      --resource-group "${NSG_RESOURCE_GROUP}" \
      --nsg-name "${NSG_NAME}" \
      --name "${SSH_RULE_NAME}" \
      --access Allow \
      -o none
    echo "Reopened public SSH bootstrap by setting ${NSG_NAME}/${SSH_RULE_NAME} access to Allow."
    ;;
  *)
    echo "Unknown ACTION: ${ACTION}. Use plan, close, or reopen." >&2
    exit 1
    ;;
esac
