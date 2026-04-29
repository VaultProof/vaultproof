#!/usr/bin/env bash
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-vaultproof-enterprise}"
DEPLOYMENT_NAME="${DEPLOYMENT_NAME:-vp-enterprise-secure-runtime-eastus-hsm}"
ENTERPRISE_URL="${ENTERPRISE_URL:-https://enterprise.vaultproof.dev}"
FRONT_DOOR_PROFILE="${FRONT_DOOR_PROFILE:-vaultproof-enterprise-fd}"
FRONT_DOOR_ENDPOINT="${FRONT_DOOR_ENDPOINT:-vaultproof-enterprise}"
FRONT_DOOR_ROUTE="${FRONT_DOOR_ROUTE:-default-route}"
FRONT_DOOR_ORIGIN_GROUP="${FRONT_DOOR_ORIGIN_GROUP:-default-origin-group}"
MONITORING_DEPLOYMENT_NAME="${MONITORING_DEPLOYMENT_NAME:-${DEPLOYMENT_NAME}-monitoring}"
APIM_DEPLOYMENT_NAME="${APIM_DEPLOYMENT_NAME:-${DEPLOYMENT_NAME}-apim}"
EXPECTED_FRONT_DOOR_FORWARDING_PROTOCOL="${EXPECTED_FRONT_DOOR_FORWARDING_PROTOCOL:-HttpOnly}"
EXPECTED_FRONT_DOOR_ORIGIN_HOSTNAME="${EXPECTED_FRONT_DOOR_ORIGIN_HOSTNAME:-}"
EXPECTED_FRONT_DOOR_ORIGIN_CERT_NAME_CHECK="${EXPECTED_FRONT_DOOR_ORIGIN_CERT_NAME_CHECK:-}"
EXPECTED_MONITORING_DEPLOYED="${EXPECTED_MONITORING_DEPLOYED:-false}"
EXPECTED_APIM_DEPLOYED="${EXPECTED_APIM_DEPLOYED:-false}"
EXPECTED_APIM_INGRESS_SOURCE="${EXPECTED_APIM_INGRESS_SOURCE:-}"
ORIGIN_TLS_HOSTNAME="${ORIGIN_TLS_HOSTNAME:-}"
ORIGIN_TLS_INSECURE="${ORIGIN_TLS_INSECURE:-false}"
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
  deployment_output_from "${DEPLOYMENT_NAME}" "$1"
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

check_resource_present() {
  local label="$1"
  local resource_type="$2"
  local resource_name="$3"
  local output_file="$4"
  if [[ -z "${resource_name}" ]]; then
    fail "${label}: resource name is empty"
    return
  fi

  if az resource show \
    --resource-group "${RESOURCE_GROUP}" \
    --resource-type "${resource_type}" \
    --name "${resource_name}" \
    -o json > "${output_file}" 2>"${output_file}.err"; then
    pass "${label} exists: ${resource_name}"
  else
    fail "${label} is missing: ${resource_name}"
  fi
}

check_resource_id_present() {
  local label="$1"
  local resource_id="$2"
  local output_file="$3"
  if [[ -z "${resource_id}" ]]; then
    fail "${label}: resource ID is empty"
    return
  fi

  if az resource show --ids "${resource_id}" -o json > "${output_file}" 2>"${output_file}.err"; then
    pass "${label} exists"
  else
    fail "${label} is missing: ${resource_id}"
  fi
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

origins_json="${tmp_dir}/front-door-origins.json"
az afd origin list \
  --resource-group "${RESOURCE_GROUP}" \
  --profile-name "${FRONT_DOOR_PROFILE}" \
  --origin-group-name "${FRONT_DOOR_ORIGIN_GROUP}" \
  --query "[].{name:name,hostName:hostName,originHostHeader:originHostHeader,httpPort:httpPort,httpsPort:httpsPort,enabledState:enabledState,enforceCertificateNameCheck:enforceCertificateNameCheck}" \
  -o json > "${origins_json}"
enabled_origins="$(json_value "${origins_json}" "origins => origins.filter((origin) => origin.enabledState === 'Enabled').map((origin) => origin.hostName)")"
if [[ -n "${enabled_origins}" ]]; then
  pass "Front Door enabled origin(s): ${enabled_origins//$'\n'/, }"
else
  fail "Front Door has no enabled origin in ${FRONT_DOOR_ORIGIN_GROUP}"
fi
if [[ -n "${EXPECTED_FRONT_DOOR_ORIGIN_HOSTNAME}" ]]; then
  expected_origin_matches="$(json_value "${origins_json}" "origins => origins.filter((origin) => origin.enabledState === 'Enabled' && origin.hostName === '${EXPECTED_FRONT_DOOR_ORIGIN_HOSTNAME}').map((origin) => origin.name)")"
  if [[ -n "${expected_origin_matches}" ]]; then
    pass "Front Door enabled origin host matches ${EXPECTED_FRONT_DOOR_ORIGIN_HOSTNAME}"
  else
    fail "Front Door enabled origin host does not match ${EXPECTED_FRONT_DOOR_ORIGIN_HOSTNAME}; enabled: ${enabled_origins//$'\n'/, }"
  fi
fi
if [[ -n "${EXPECTED_FRONT_DOOR_ORIGIN_CERT_NAME_CHECK}" ]]; then
  cert_check_values="$(json_value "${origins_json}" "origins => origins.filter((origin) => origin.enabledState === 'Enabled').map((origin) => origin.enforceCertificateNameCheck || '')")"
  if [[ -z "${cert_check_values}" ]]; then
    fail "Front Door enabled origin certificate name check setting is missing"
  fi
  while IFS= read -r cert_check_value; do
    [[ -z "${cert_check_value}" ]] && continue
    check_equals "Front Door origin certificate name check" "${cert_check_value}" "${EXPECTED_FRONT_DOOR_ORIGIN_CERT_NAME_CHECK}"
  done <<< "${cert_check_values}"
fi

if [[ "${EXPECTED_MONITORING_DEPLOYED}" == "true" ]]; then
  echo
  echo "Azure Monitor production alerting:"
  echo "  deployment: ${MONITORING_DEPLOYMENT_NAME}"

  monitoring_workspace_name="$(deployment_output_from "${MONITORING_DEPLOYMENT_NAME}" monitoringWorkspaceName)"
  monitoring_app_insights_name="$(deployment_output_from "${MONITORING_DEPLOYMENT_NAME}" monitoringAppInsightsName)"
  monitoring_action_group_name="$(deployment_output_from "${MONITORING_DEPLOYMENT_NAME}" monitoringActionGroupName)"
  monitoring_health_test_name="$(deployment_output_from "${MONITORING_DEPLOYMENT_NAME}" monitoringHealthWebTestName)"
  monitoring_readiness_test_name="$(deployment_output_from "${MONITORING_DEPLOYMENT_NAME}" monitoringReadinessWebTestName)"
  monitoring_health_alert_name="$(deployment_output_from "${MONITORING_DEPLOYMENT_NAME}" monitoringHealthAlertName)"
  monitoring_readiness_alert_name="$(deployment_output_from "${MONITORING_DEPLOYMENT_NAME}" monitoringReadinessAlertName)"
  monitoring_vm_alert_name="$(deployment_output_from "${MONITORING_DEPLOYMENT_NAME}" monitoringVmAvailabilityAlertName)"

  workspace_json="${tmp_dir}/monitoring-workspace.json"
  app_insights_json="${tmp_dir}/monitoring-app-insights.json"
  action_group_json="${tmp_dir}/monitoring-action-group.json"
  health_test_json="${tmp_dir}/monitoring-health-test.json"
  readiness_test_json="${tmp_dir}/monitoring-readiness-test.json"
  health_alert_json="${tmp_dir}/monitoring-health-alert.json"
  readiness_alert_json="${tmp_dir}/monitoring-readiness-alert.json"
  vm_alert_json="${tmp_dir}/monitoring-vm-alert.json"

  check_resource_present "Log Analytics workspace" "Microsoft.OperationalInsights/workspaces" "${monitoring_workspace_name}" "${workspace_json}"
  check_resource_present "Application Insights component" "Microsoft.Insights/components" "${monitoring_app_insights_name}" "${app_insights_json}"
  check_resource_present "Azure Monitor action group" "Microsoft.Insights/actionGroups" "${monitoring_action_group_name}" "${action_group_json}"
  check_resource_present "Health availability test" "Microsoft.Insights/webtests" "${monitoring_health_test_name}" "${health_test_json}"
  check_resource_present "Readiness availability test" "Microsoft.Insights/webtests" "${monitoring_readiness_test_name}" "${readiness_test_json}"
  check_resource_present "Health availability alert" "Microsoft.Insights/metricAlerts" "${monitoring_health_alert_name}" "${health_alert_json}"
  check_resource_present "Readiness drift alert" "Microsoft.Insights/metricAlerts" "${monitoring_readiness_alert_name}" "${readiness_alert_json}"
  check_resource_present "VM availability alert" "Microsoft.Insights/metricAlerts" "${monitoring_vm_alert_name}" "${vm_alert_json}"

  if [[ -s "${action_group_json}" ]]; then
    check_equals "Action group enabled" "$(json_value "${action_group_json}" "p => p.properties?.enabled")" "true"
  fi
  if [[ -s "${health_test_json}" ]]; then
    check_equals "Health test enabled" "$(json_value "${health_test_json}" "p => p.properties?.Enabled ?? p.properties?.enabled")" "true"
    check_equals "Health test URL" "$(json_value "${health_test_json}" "p => p.properties?.Request?.RequestUrl ?? p.properties?.request?.requestUrl")" "${ENTERPRISE_URL%/}/health"
  fi
  if [[ -s "${readiness_test_json}" ]]; then
    check_equals "Readiness test enabled" "$(json_value "${readiness_test_json}" "p => p.properties?.Enabled ?? p.properties?.enabled")" "true"
    check_equals "Readiness test URL" "$(json_value "${readiness_test_json}" "p => p.properties?.Request?.RequestUrl ?? p.properties?.request?.requestUrl")" "${ENTERPRISE_URL%/}/readiness"
    check_equals "Readiness test content validation" "$(json_value "${readiness_test_json}" "p => p.properties?.ValidationRules?.ContentValidation?.ContentMatch ?? p.properties?.validationRules?.contentValidation?.contentMatch")" "\"production_ready\":true"
  fi
  if [[ -s "${health_alert_json}" ]]; then
    check_equals "Health alert enabled" "$(json_value "${health_alert_json}" "p => p.properties?.enabled")" "true"
    check_equals "Health alert severity" "$(json_value "${health_alert_json}" "p => p.properties?.severity")" "1"
  fi
  if [[ -s "${readiness_alert_json}" ]]; then
    check_equals "Readiness drift alert enabled" "$(json_value "${readiness_alert_json}" "p => p.properties?.enabled")" "true"
    check_equals "Readiness drift alert severity" "$(json_value "${readiness_alert_json}" "p => p.properties?.severity")" "0"
  fi
  if [[ -s "${vm_alert_json}" ]]; then
    check_equals "VM availability alert enabled" "$(json_value "${vm_alert_json}" "p => p.properties?.enabled")" "true"
    check_equals "VM availability alert severity" "$(json_value "${vm_alert_json}" "p => p.properties?.severity")" "1"
  fi
else
  echo
  echo "SKIP Azure Monitor production alerting checks because EXPECTED_MONITORING_DEPLOYED=false"
fi

if [[ "${EXPECTED_APIM_DEPLOYED}" == "true" ]]; then
  echo
  echo "Azure API Management gateway:"
  echo "  deployment: ${APIM_DEPLOYMENT_NAME}"

  api_management_name="$(deployment_output_from "${APIM_DEPLOYMENT_NAME}" apiManagementName)"
  api_management_gateway_url="$(deployment_output_from "${APIM_DEPLOYMENT_NAME}" apiManagementGatewayUrl)"
  api_management_backend_url="$(deployment_output_from "${APIM_DEPLOYMENT_NAME}" apiManagementBackendUrl)"
  api_management_api_url="$(deployment_output_from "${APIM_DEPLOYMENT_NAME}" apiManagementApiUrl)"
  api_management_logger_name="$(deployment_output_from "${APIM_DEPLOYMENT_NAME}" apiManagementAppInsightsLoggerName)"
  api_management_diagnostic_name="$(deployment_output_from "${APIM_DEPLOYMENT_NAME}" apiManagementDiagnosticName)"

  echo "  APIM name:       ${api_management_name}"
  echo "  gateway URL:     ${api_management_gateway_url}"
  echo "  API URL:         ${api_management_api_url}"
  echo "  backend URL:     ${api_management_backend_url}"

  apim_json="${tmp_dir}/apim-service.json"
  apim_api_json="${tmp_dir}/apim-api.json"
  apim_policy_json="${tmp_dir}/apim-policy.json"
  apim_named_value_json="${tmp_dir}/apim-origin-lock-named-value.json"
  apim_health_operation_json="${tmp_dir}/apim-health-operation.json"
  apim_readiness_operation_json="${tmp_dir}/apim-readiness-operation.json"
  apim_execute_operation_json="${tmp_dir}/apim-execute-operation.json"
  apim_proxy_operation_json="${tmp_dir}/apim-proxy-operation.json"
  subscription_id="$(az account show --query id -o tsv)"
  api_management_resource_id="/subscriptions/${subscription_id}/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.ApiManagement/service/${api_management_name}"

  check_resource_present "API Management service" "Microsoft.ApiManagement/service" "${api_management_name}" "${apim_json}"
  check_resource_id_present "APIM enterprise API" "${api_management_resource_id}/apis/vaultproof-enterprise" "${apim_api_json}"
  check_resource_id_present "APIM enterprise API policy" "${api_management_resource_id}/apis/vaultproof-enterprise/policies/policy" "${apim_policy_json}"
  check_resource_id_present "APIM origin-lock named value" "${api_management_resource_id}/namedValues/vaultproof-origin-lock-secret" "${apim_named_value_json}"
  check_resource_id_present "APIM health operation" "${api_management_resource_id}/apis/vaultproof-enterprise/operations/health" "${apim_health_operation_json}"
  check_resource_id_present "APIM readiness operation" "${api_management_resource_id}/apis/vaultproof-enterprise/operations/readiness" "${apim_readiness_operation_json}"
  check_resource_id_present "APIM execute operation" "${api_management_resource_id}/apis/vaultproof-enterprise/operations/execute" "${apim_execute_operation_json}"
  check_resource_id_present "APIM enterprise proxy operation" "${api_management_resource_id}/apis/vaultproof-enterprise/operations/enterprise-api-proxy" "${apim_proxy_operation_json}"

  if [[ -s "${apim_api_json}" ]]; then
    check_equals "APIM API path" "$(json_value "${apim_api_json}" "p => p.properties?.path")" "enterprise"
    check_equals "APIM API service URL" "$(json_value "${apim_api_json}" "p => p.properties?.serviceUrl")" "${api_management_backend_url}"
  fi
  if [[ -s "${apim_named_value_json}" ]]; then
    check_equals "APIM origin-lock named value is secret" "$(json_value "${apim_named_value_json}" "p => p.properties?.secret")" "true"
  fi

  if [[ -n "${api_management_logger_name}" ]]; then
    apim_logger_json="${tmp_dir}/apim-app-insights-logger.json"
    check_resource_id_present "APIM App Insights logger" "${api_management_resource_id}/loggers/${api_management_logger_name}" "${apim_logger_json}"
  fi
  if [[ -n "${api_management_diagnostic_name}" ]]; then
    apim_diagnostic_json="${tmp_dir}/apim-app-insights-diagnostic.json"
    check_resource_id_present "APIM App Insights diagnostic" "${api_management_resource_id}/apis/vaultproof-enterprise/diagnostics/${api_management_diagnostic_name}" "${apim_diagnostic_json}"
  fi

  apim_health_file="${tmp_dir}/apim-health.json"
  apim_health_status="$(http_status "${api_management_api_url%/}/health?verify_ts=$(date +%s)" "${apim_health_file}")"
  check_equals "APIM /health HTTP status" "${apim_health_status}" "200"
  if node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "${apim_health_file}" >/dev/null 2>&1; then
    check_equals "APIM health ok" "$(json_value "${apim_health_file}" "p => p.status")" "ok"
  else
    fail "APIM /health did not return valid JSON"
  fi

  apim_readiness_file="${tmp_dir}/apim-readiness.json"
  apim_readiness_status="$(http_status "${api_management_api_url%/}/readiness?verify_ts=$(date +%s)" "${apim_readiness_file}")"
  check_equals "APIM /readiness HTTP status" "${apim_readiness_status}" "200"
  if node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" "${apim_readiness_file}" >/dev/null 2>&1; then
    check_equals "APIM readiness production_ready" "$(json_value "${apim_readiness_file}" "p => p.production_ready")" "true"
    check_equals "APIM readiness security_profile" "$(json_value "${apim_readiness_file}" "p => p.security_profile")" "azure-confidential-production"
  else
    fail "APIM /readiness did not return valid JSON"
  fi
else
  echo
  echo "SKIP Azure API Management checks because EXPECTED_APIM_DEPLOYED=false"
fi

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
    const props = rule.properties || rule;
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
    const props = rule?.properties || rule;
    return props?.access;
  }")"
  if [[ -n "${EXPECTED_SSH_BOOTSTRAP_ACCESS}" ]]; then
    check_equals "SSH bootstrap NSG access" "${ssh_bootstrap_access}" "${EXPECTED_SSH_BOOTSTRAP_ACCESS}"
  else
    echo "SKIP SSH bootstrap NSG access check because EXPECTED_SSH_BOOTSTRAP_ACCESS is empty"
  fi

  if [[ "${EXPECTED_APIM_DEPLOYED}" == "true" ]]; then
    apim_control_plane_access="$(json_value "${nsg_rules_file}" "rules => {
      const rule = rules.find((candidate) => candidate.name === 'AllowApiManagementControlPlane');
      const props = rule?.properties || rule;
      return props?.access;
    }")"
    apim_control_plane_source="$(json_value "${nsg_rules_file}" "rules => {
      const rule = rules.find((candidate) => candidate.name === 'AllowApiManagementControlPlane');
      const props = rule?.properties || rule;
      return props?.sourceAddressPrefix || (props?.sourceAddressPrefixes || []).join(',');
    }")"
    check_equals "APIM control-plane NSG access" "${apim_control_plane_access}" "Allow"
    if [[ -n "${EXPECTED_APIM_INGRESS_SOURCE}" ]]; then
      check_equals "APIM control-plane NSG source" "${apim_control_plane_source}" "${EXPECTED_APIM_INGRESS_SOURCE}"
    elif [[ -n "${apim_control_plane_source}" ]]; then
      pass "APIM control-plane NSG source: ${apim_control_plane_source}"
    else
      fail "APIM control-plane NSG source is missing"
    fi
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
    tls_curl_extra=""
    if [[ "${ORIGIN_TLS_INSECURE}" == "true" ]]; then
      tls_curl_extra="-k"
      echo "WARN Local TLS origin check allows self-signed/untrusted certificates because ORIGIN_TLS_INSECURE=true"
    fi
    tls_status="$(ssh -o BatchMode=yes -o ConnectTimeout=10 "${SSH_USER}@${vm_public_ip}" \
      "curl -sS ${tls_curl_extra} --connect-timeout 10 --max-time 20 --resolve '${ORIGIN_TLS_HOSTNAME}:443:127.0.0.1' -o /tmp/vaultproof-origin-tls-health.json -w '%{http_code}' https://${ORIGIN_TLS_HOSTNAME}/health")"
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
