#!/usr/bin/env bash
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-vaultproof-enterprise}"
ENTERPRISE_URL="${ENTERPRISE_URL:-https://enterprise.vaultproof.dev}"
ACTION="${ACTION:-inventory}"
CONTAINER_APPS="${CONTAINER_APPS:-vp-enterprise-control-plane vp-enterprise-secure-executor}"
CONTAINER_APPS_ENVIRONMENT="${CONTAINER_APPS_ENVIRONMENT:-managedEnvironment-vaultproofenter-9c88}"
ACR_NAME="${ACR_NAME:-vaultproofenterpriseacr}"
RESTORE_INGRESS_TARGET_PORT="${RESTORE_INGRESS_TARGET_PORT:-80}"
RESTORE_INGRESS_TRANSPORT="${RESTORE_INGRESS_TRANSPORT:-auto}"
FRONT_DOOR_PROFILE="${FRONT_DOOR_PROFILE:-vaultproof-enterprise-fd}"
FRONT_DOOR_ORIGIN_GROUP="${FRONT_DOOR_ORIGIN_GROUP:-default-origin-group}"
SKIP_READINESS_CHECK="${SKIP_READINESS_CHECK:-false}"
SKIP_FRONT_DOOR_ORIGIN_CHECK="${SKIP_FRONT_DOOR_ORIGIN_CHECK:-false}"
CONFIRM_CONTAINER_APPS_CLEANUP="${CONFIRM_CONTAINER_APPS_CLEANUP:-}"

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

app_names() {
  node -e "
const raw = process.argv[1] || '';
console.log(raw.split(/[,\s]+/).filter(Boolean).join('\n'));
" "${CONTAINER_APPS}"
}

app_exists() {
  local app_name="$1"
  az containerapp show --resource-group "${RESOURCE_GROUP}" --name "${app_name}" >/dev/null 2>&1
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
  status="$(curl -sS --connect-timeout 10 --max-time 20 \
    -o "${tmp_file}" \
    -w "%{http_code}" \
    "${ENTERPRISE_URL%/}/readiness?container_apps_cleanup_ts=$(date +%s)")"
  if [[ "${status}" != "200" ]]; then
    echo "Refusing cleanup: ${ENTERPRISE_URL%/}/readiness returned HTTP ${status}." >&2
    rm -f "${tmp_file}"
    exit 1
  fi

  if ! node -e "
const fs = require('fs');
const payload = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
if (payload.production_ready !== true) {
  console.error('Refusing cleanup: control plane production_ready is not true.');
  process.exit(1);
}
const blockers = Array.isArray(payload.production_blockers) ? payload.production_blockers : [];
if (blockers.length > 0) {
  console.error('Refusing cleanup: production blockers remain: ' + blockers.join(', '));
  process.exit(1);
}
" "${tmp_file}"; then
    rm -f "${tmp_file}"
    exit 1
  fi
  rm -f "${tmp_file}"
}

require_front_door_not_using_container_apps() {
  if [[ "${SKIP_FRONT_DOOR_ORIGIN_CHECK}" == "true" ]]; then
    echo "Skipping Front Door origin gate because SKIP_FRONT_DOOR_ORIGIN_CHECK=true."
    return
  fi

  local tmp_file
  tmp_file="$(mktemp)"
  if ! az afd origin list \
    --resource-group "${RESOURCE_GROUP}" \
    --profile-name "${FRONT_DOOR_PROFILE}" \
    --origin-group-name "${FRONT_DOOR_ORIGIN_GROUP}" \
    -o json > "${tmp_file}"; then
    rm -f "${tmp_file}"
    exit 1
  fi

  local active_container_app_origins
  active_container_app_origins="$(json_value "${tmp_file}" "origins => origins.filter((origin) => {
    const host = String(origin.hostName || '');
    return origin.enabledState === 'Enabled' && host.endsWith('.azurecontainerapps.io');
  }).map((origin) => origin.hostName)")"
  if [[ -n "${active_container_app_origins}" ]]; then
    echo "Refusing cleanup: Front Door still has enabled Container Apps origin(s):" >&2
    echo "${active_container_app_origins}" >&2
    rm -f "${tmp_file}"
    exit 1
  fi
  rm -f "${tmp_file}"
}

require_confirmation() {
  local expected="$1"
  local action_description="$2"
  if [[ "${CONFIRM_CONTAINER_APPS_CLEANUP}" != "${expected}" ]]; then
    echo "Refusing ${action_description}: set CONFIRM_CONTAINER_APPS_CLEANUP=${expected} to confirm this live cleanup action." >&2
    exit 1
  fi
}

inventory() {
  echo "VaultProof old Container Apps prototype inventory"
  echo "  resource group: ${RESOURCE_GROUP}"
  echo "  apps:           ${CONTAINER_APPS}"
  echo "  environment:    ${CONTAINER_APPS_ENVIRONMENT}"
  echo "  ACR:            ${ACR_NAME}"
  echo

  while IFS= read -r app_name; do
    if app_exists "${app_name}"; then
      az containerapp show \
        --resource-group "${RESOURCE_GROUP}" \
        --name "${app_name}" \
        --query "{name:name,provisioningState:properties.provisioningState,environmentId:properties.environmentId,latestRevisionName:properties.latestRevisionName,activeRevisionsMode:properties.configuration.activeRevisionsMode,ingress:properties.configuration.ingress,templateScale:properties.template.scale}" \
        -o json
    else
      echo "{\"name\":\"${app_name}\",\"exists\":false}"
    fi
  done < <(app_names)

  echo
  az afd origin list \
    --resource-group "${RESOURCE_GROUP}" \
    --profile-name "${FRONT_DOOR_PROFILE}" \
    --origin-group-name "${FRONT_DOOR_ORIGIN_GROUP}" \
    --query "[].{name:name,hostName:hostName,enabledState:enabledState,priority:priority,weight:weight}" \
    -o table
  echo
  echo "Guarded cleanup actions:"
  echo "  ACTION=disable-ingress CONFIRM_CONTAINER_APPS_CLEANUP=disable-prototype-ingress npm run cleanup:enterprise-container-apps"
  echo "  ACTION=scale-to-zero CONFIRM_CONTAINER_APPS_CLEANUP=scale-prototype-to-zero npm run cleanup:enterprise-container-apps"
  echo "  ACTION=restore-ingress CONFIRM_CONTAINER_APPS_CLEANUP=restore-prototype-ingress npm run cleanup:enterprise-container-apps"
  echo "  ACTION=delete-apps CONFIRM_CONTAINER_APPS_CLEANUP=delete-prototype-apps npm run cleanup:enterprise-container-apps"
  echo "  ACTION=delete-environment CONFIRM_CONTAINER_APPS_CLEANUP=delete-prototype-environment npm run cleanup:enterprise-container-apps"
  echo "  ACTION=delete-acr CONFIRM_CONTAINER_APPS_CLEANUP=delete-prototype-acr npm run cleanup:enterprise-container-apps"
}

disable_ingress() {
  require_confirmation "disable-prototype-ingress" "Container Apps ingress disable"
  require_production_ready
  require_front_door_not_using_container_apps
  while IFS= read -r app_name; do
    if app_exists "${app_name}"; then
      echo "Disabling external ingress for ${app_name}..."
      az containerapp ingress disable \
        --resource-group "${RESOURCE_GROUP}" \
        --name "${app_name}" \
        -o none
    else
      echo "Skipping ${app_name}; it does not exist."
    fi
  done < <(app_names)
}

scale_to_zero() {
  require_confirmation "scale-prototype-to-zero" "Container Apps scale-to-zero"
  require_production_ready
  require_front_door_not_using_container_apps
  while IFS= read -r app_name; do
    if app_exists "${app_name}"; then
      echo "Setting minimum replicas to 0 for ${app_name}..."
      az containerapp update \
        --resource-group "${RESOURCE_GROUP}" \
        --name "${app_name}" \
        --min-replicas 0 \
        -o none
    else
      echo "Skipping ${app_name}; it does not exist."
    fi
  done < <(app_names)
}

delete_apps() {
  require_confirmation "delete-prototype-apps" "Container Apps delete"
  require_production_ready
  require_front_door_not_using_container_apps
  while IFS= read -r app_name; do
    if app_exists "${app_name}"; then
      echo "Deleting Container App ${app_name}..."
      az containerapp delete \
        --resource-group "${RESOURCE_GROUP}" \
        --name "${app_name}" \
        --yes \
        -o none
    else
      echo "Skipping ${app_name}; it does not exist."
    fi
  done < <(app_names)
}

restore_ingress() {
  require_confirmation "restore-prototype-ingress" "Container Apps ingress restore"
  while IFS= read -r app_name; do
    if app_exists "${app_name}"; then
      echo "Restoring external ingress for ${app_name}..."
      az containerapp ingress enable \
        --resource-group "${RESOURCE_GROUP}" \
        --name "${app_name}" \
        --type external \
        --target-port "${RESTORE_INGRESS_TARGET_PORT}" \
        --transport "${RESTORE_INGRESS_TRANSPORT}" \
        -o none
    else
      echo "Skipping ${app_name}; it does not exist."
    fi
  done < <(app_names)
}

delete_environment() {
  require_confirmation "delete-prototype-environment" "Container Apps environment delete"
  require_production_ready
  require_front_door_not_using_container_apps
  echo "Deleting Container Apps environment ${CONTAINER_APPS_ENVIRONMENT}..."
  az containerapp env delete \
    --resource-group "${RESOURCE_GROUP}" \
    --name "${CONTAINER_APPS_ENVIRONMENT}" \
    --yes \
    -o none
}

delete_acr() {
  require_confirmation "delete-prototype-acr" "Azure Container Registry delete"
  require_production_ready
  require_front_door_not_using_container_apps
  echo "Deleting Azure Container Registry ${ACR_NAME}..."
  az acr delete \
    --resource-group "${RESOURCE_GROUP}" \
    --name "${ACR_NAME}" \
    --yes \
    -o none
}

require_command az
require_command node

case "${ACTION}" in
  inventory)
    inventory
    ;;
  disable-ingress)
    disable_ingress
    ;;
  scale-to-zero|scale-zero)
    scale_to_zero
    ;;
  restore-ingress)
    restore_ingress
    ;;
  delete-apps)
    delete_apps
    ;;
  delete-environment)
    delete_environment
    ;;
  delete-acr)
    delete_acr
    ;;
  *)
    echo "Unknown ACTION: ${ACTION}. Use inventory, disable-ingress, scale-to-zero, restore-ingress, delete-apps, delete-environment, or delete-acr." >&2
    exit 1
    ;;
esac
