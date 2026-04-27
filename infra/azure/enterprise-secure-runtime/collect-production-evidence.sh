#!/usr/bin/env bash
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-vaultproof-enterprise}"
DEPLOYMENT_NAME="${DEPLOYMENT_NAME:-vp-enterprise-secure-runtime-eastus-hsm}"
ENTERPRISE_URL="${ENTERPRISE_URL:-https://enterprise.vaultproof.dev}"
FRONT_DOOR_PROFILE="${FRONT_DOOR_PROFILE:-vaultproof-enterprise-fd}"
FRONT_DOOR_ENDPOINT="${FRONT_DOOR_ENDPOINT:-vaultproof-enterprise}"
FRONT_DOOR_ROUTE="${FRONT_DOOR_ROUTE:-default-route}"
SSH_USER="${SSH_USER:-azureuser}"
RUN_SSH_CHECKS="${RUN_SSH_CHECKS:-true}"
OUTPUT_DIR="${OUTPUT_DIR:-/tmp/vaultproof-production-evidence}"
EVIDENCE_FILE="${EVIDENCE_FILE:-}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../../.." && pwd)"

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

write_json_file() {
  local file="$1"
  shift
  "$@" -o json > "${file}"
}

http_capture() {
  local url="$1"
  local body_file="$2"
  shift 2
  local status
  local exit_code
  set +e
  status="$(curl -sS --connect-timeout 10 --max-time 20 -o "${body_file}" -w "%{http_code}" "$@" "${url}" 2>"${body_file}.err")"
  exit_code=$?
  set -e
  node -e "
const fs = require('fs');
const bodyPath = process.argv[1];
const status = process.argv[2];
const exitCode = Number(process.argv[3]);
const stderrPath = bodyPath + '.err';
let body = '';
let parsed = null;
let stderr = '';
try { body = fs.readFileSync(bodyPath, 'utf8'); } catch {}
try { parsed = JSON.parse(body); } catch {}
try { stderr = fs.readFileSync(stderrPath, 'utf8').trim(); } catch {}
console.log(JSON.stringify({ statusCode: status, exitCode, stderr, body: parsed || body.slice(0, 2000) }, null, 2));
" "${body_file}" "${status}" "${exit_code}"
}

require_command az
require_command curl
require_command node
if [[ "${RUN_SSH_CHECKS}" == "true" ]]; then
  require_command ssh
fi

mkdir -p "${OUTPUT_DIR}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
if [[ -z "${EVIDENCE_FILE}" ]]; then
  EVIDENCE_FILE="${OUTPUT_DIR}/vaultproof-enterprise-production-evidence-${timestamp}.json"
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

vm_name="$(deployment_output confidentialVmName)"
vm_public_ip="$(deployment_output confidentialVmPublicIp)"
vm_private_ip="$(deployment_output confidentialVmPrivateIp)"

echo "Collecting VaultProof enterprise production evidence"
echo "  deployment: ${DEPLOYMENT_NAME}"
echo "  VM:         ${vm_name}"
echo "  URL:        ${ENTERPRISE_URL}"
echo "  output:     ${EVIDENCE_FILE}"

write_json_file "${tmp_dir}/deployment.json" az deployment group show \
  --resource-group "${RESOURCE_GROUP}" \
  --name "${DEPLOYMENT_NAME}" \
  --query "{id:id,name:name,properties:{provisioningState:properties.provisioningState,timestamp:properties.timestamp,outputs:properties.outputs}}"

write_json_file "${tmp_dir}/vm-security.json" az vm show \
  --resource-group "${RESOURCE_GROUP}" \
  --name "${vm_name}" \
  --query "{id:id,name:name,location:location,identity:identity,securityProfile:securityProfile,hardwareProfile:hardwareProfile,osProfile:{computerName:osProfile.computerName,adminUsername:osProfile.adminUsername},networkProfile:networkProfile}"

write_json_file "${tmp_dir}/vm-instance.json" az vm get-instance-view \
  --resource-group "${RESOURCE_GROUP}" \
  --name "${vm_name}" \
  --query "{statuses:instanceView.statuses,vmAgent:instanceView.vmAgent}"

write_json_file "${tmp_dir}/frontdoor-profile.json" az afd profile show \
  --resource-group "${RESOURCE_GROUP}" \
  --profile-name "${FRONT_DOOR_PROFILE}" \
  --query "{id:id,name:name,frontDoorId:frontDoorId,sku:sku,resourceState:resourceState,provisioningState:provisioningState,originResponseTimeoutSeconds:originResponseTimeoutSeconds}"

write_json_file "${tmp_dir}/frontdoor-route.json" az afd route show \
  --resource-group "${RESOURCE_GROUP}" \
  --profile-name "${FRONT_DOOR_PROFILE}" \
  --endpoint-name "${FRONT_DOOR_ENDPOINT}" \
  --route-name "${FRONT_DOOR_ROUTE}" \
  --query "{id:id,name:name,enabledState:enabledState,forwardingProtocol:forwardingProtocol,httpsRedirect:httpsRedirect,patternsToMatch:patternsToMatch,supportedProtocols:supportedProtocols,originGroup:originGroup,ruleSets:ruleSets,customDomains:customDomains}"

write_json_file "${tmp_dir}/frontdoor-origins.json" az afd origin list \
  --resource-group "${RESOURCE_GROUP}" \
  --profile-name "${FRONT_DOOR_PROFILE}" \
  --origin-group-name default-origin-group \
  --query "[].{name:name,hostName:hostName,originHostHeader:originHostHeader,httpPort:httpPort,httpsPort:httpsPort,enabledState:enabledState,priority:priority,weight:weight}"

readiness_capture="${tmp_dir}/readiness-capture.json"
http_capture "${ENTERPRISE_URL%/}/readiness?evidence_ts=$(date +%s)" "${tmp_dir}/readiness-body.json" > "${readiness_capture}"

health_capture="${tmp_dir}/health-capture.json"
http_capture "${ENTERPRISE_URL%/}/health?evidence_ts=$(date +%s)" "${tmp_dir}/health-body.json" > "${health_capture}"

direct_public_capture="${tmp_dir}/direct-public-origin.json"
http_capture "http://${vm_public_ip}:3001/health" "${tmp_dir}/direct-public-origin-body.txt" -H "host: ${ENTERPRISE_URL#https://}" > "${direct_public_capture}"

nic_id="$(az vm show --resource-group "${RESOURCE_GROUP}" --name "${vm_name}" --query "networkProfile.networkInterfaces[0].id" -o tsv)"
nsg_id="$(az network nic show --ids "${nic_id}" --query "networkSecurityGroup.id" -o tsv)"
if [[ -z "${nsg_id}" ]]; then
  subnet_id="$(az network nic show --ids "${nic_id}" --query "ipConfigurations[0].subnet.id" -o tsv)"
  nsg_id="$(az network vnet subnet show --ids "${subnet_id}" --query "networkSecurityGroup.id" -o tsv)"
fi

if [[ -n "${nsg_id}" ]]; then
  nsg_name="${nsg_id##*/}"
  nsg_resource_group="$(node -e "const id = process.argv[1]; const match = id.match(/\/resourceGroups\/([^/]+)/i); if (match) console.log(match[1]);" "${nsg_id}")"
  write_json_file "${tmp_dir}/nsg-rules.json" az network nsg rule list \
    --resource-group "${nsg_resource_group}" \
    --nsg-name "${nsg_name}" \
    --query "[].{name:name,priority:properties.priority,direction:properties.direction,access:properties.access,protocol:properties.protocol,sourceAddressPrefix:properties.sourceAddressPrefix,sourceAddressPrefixes:properties.sourceAddressPrefixes,destinationPortRange:properties.destinationPortRange,destinationPortRanges:properties.destinationPortRanges}"
else
  printf '[]\n' > "${tmp_dir}/nsg-rules.json"
fi

ssh_capture="${tmp_dir}/ssh-checks.json"
if [[ "${RUN_SSH_CHECKS}" == "true" ]]; then
  ssh -o BatchMode=yes -o ConnectTimeout=10 "${SSH_USER}@${vm_public_ip}" \
    "VM_PRIVATE_IP='${vm_private_ip}' ENTERPRISE_HOST='${ENTERPRISE_URL#https://}' bash -s" > "${ssh_capture}" <<'REMOTE'
set -euo pipefail
executor_status="$(systemctl is-active vaultproof-executor || true)"
control_plane_status="$(systemctl is-active vaultproof-control-plane || true)"
loopback_readiness="$(curl -sS -H "host: ${ENTERPRISE_HOST}" http://127.0.0.1:3001/readiness)"
private_body_file="/tmp/vaultproof-private-origin-evidence.json"
private_status="$(curl -sS -o "${private_body_file}" -w "%{http_code}" -H "host: ${ENTERPRISE_HOST}" "http://${VM_PRIVATE_IP}:3001/health")"
node -e "
const fs = require('fs');
const readiness = JSON.parse(process.argv[1]);
let privateBody = '';
try { privateBody = fs.readFileSync(process.argv[4], 'utf8'); } catch {}
let privateParsed = null;
try { privateParsed = JSON.parse(privateBody); } catch {}
console.log(JSON.stringify({
  services: {
    executor: process.argv[2],
    controlPlane: process.argv[3],
  },
  loopbackReadiness: readiness,
  privateOriginWithoutFrontDoorId: {
    statusCode: process.argv[5],
    body: privateParsed || privateBody.slice(0, 2000),
  },
}, null, 2));
" "${loopback_readiness}" "${executor_status}" "${control_plane_status}" "${private_body_file}" "${private_status}"
REMOTE
else
  printf '{"skipped":true}\n' > "${ssh_capture}"
fi

git_commit="$(git -C "${repo_root}" rev-parse HEAD 2>/dev/null || true)"

node -e "
const fs = require('fs');
const path = require('path');
const tmp = process.argv[1];
const output = process.argv[2];
const read = (name) => JSON.parse(fs.readFileSync(path.join(tmp, name), 'utf8'));
const evidence = {
  schemaVersion: 'vaultproof.enterprise.productionEvidence.v1',
  generatedAt: new Date().toISOString(),
  generatedBy: 'infra/azure/enterprise-secure-runtime/collect-production-evidence.sh',
  gitCommit: process.argv[3] || null,
  inputs: {
    resourceGroup: process.argv[4],
    deploymentName: process.argv[5],
    enterpriseUrl: process.argv[6],
    frontDoorProfile: process.argv[7],
    frontDoorEndpoint: process.argv[8],
    frontDoorRoute: process.argv[9],
  },
  azure: {
    deployment: read('deployment.json'),
    vmSecurity: read('vm-security.json'),
    vmInstance: read('vm-instance.json'),
    frontDoorProfile: read('frontdoor-profile.json'),
    frontDoorRoute: read('frontdoor-route.json'),
    frontDoorOrigins: read('frontdoor-origins.json'),
    nsgRules: read('nsg-rules.json'),
  },
  runtime: {
    publicHealth: read('health-capture.json'),
    publicReadiness: read('readiness-capture.json'),
    directPublicOrigin: read('direct-public-origin.json'),
    sshChecks: read('ssh-checks.json'),
  },
};
fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\\n');
" \
  "${tmp_dir}" \
  "${EVIDENCE_FILE}" \
  "${git_commit}" \
  "${RESOURCE_GROUP}" \
  "${DEPLOYMENT_NAME}" \
  "${ENTERPRISE_URL}" \
  "${FRONT_DOOR_PROFILE}" \
  "${FRONT_DOOR_ENDPOINT}" \
  "${FRONT_DOOR_ROUTE}"

echo "Evidence written to ${EVIDENCE_FILE}"
