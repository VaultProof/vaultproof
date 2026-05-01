#!/usr/bin/env bash
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-vaultproof-enterprise}"
DEPLOYMENT_NAME="${DEPLOYMENT_NAME:-vp-enterprise-secure-runtime-eastus-hsm}"
ENTERPRISE_URL="${ENTERPRISE_URL:-https://enterprise.vaultproof.dev}"
FRONT_DOOR_PROFILE="${FRONT_DOOR_PROFILE:-vaultproof-enterprise-fd}"
FRONT_DOOR_ENDPOINT="${FRONT_DOOR_ENDPOINT:-vaultproof-enterprise}"
FRONT_DOOR_ROUTE="${FRONT_DOOR_ROUTE:-default-route}"
FRONT_DOOR_ORIGIN_GROUP="${FRONT_DOOR_ORIGIN_GROUP:-default-origin-group}"
ORIGIN_TLS_HOSTNAME="${ORIGIN_TLS_HOSTNAME:-origin.enterprise.vaultproof.dev}"
SSH_USER="${SSH_USER:-azureuser}"
RUN_SSH_CHECKS="${RUN_SSH_CHECKS:-true}"
CUTOVER_READY_REQUIRED="${CUTOVER_READY_REQUIRED:-false}"
TLS_CERT_PATH="${TLS_CERT_PATH:-/etc/vaultproof/tls/origin.crt}"
SELF_SIGNED_MARKER="${SELF_SIGNED_MARKER:-/etc/vaultproof/tls/origin.self-signed}"

failures=0
warnings=0

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

deployment_output() {
  local output_name="$1"
  az deployment group show \
    --resource-group "${RESOURCE_GROUP}" \
    --name "${DEPLOYMENT_NAME}" \
    --query "properties.outputs.${output_name}.value" \
    -o tsv
}

resolve_ipv4() {
  node -e "
const dns = require('dns').promises;
dns.resolve4(process.argv[1]).then((records) => {
  console.log(records.join('\\n'));
}).catch(() => process.exit(2));
" "$1"
}

check_destination_port_allow() {
  local rules_file="$1"
  local port="$2"
  local source_pattern="$3"
  node -e "
const fs = require('fs');
const rules = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const port = process.argv[2];
const sourcePattern = new RegExp(process.argv[3], 'i');
const matches = rules.filter((rule) => {
  const props = rule.properties || rule;
  if (props.direction !== 'Inbound' || props.access !== 'Allow') return false;
  const ports = [props.destinationPortRange, ...(props.destinationPortRanges || [])].filter(Boolean).map(String);
  const portMatches = ports.includes(port) || ports.includes('*');
  const sources = [props.sourceAddressPrefix, ...(props.sourceAddressPrefixes || [])].filter(Boolean).map(String);
  const sourceMatches = sources.some((source) => sourcePattern.test(source));
  return portMatches && sourceMatches;
});
console.log(matches.map((rule) => rule.name).join('\\n'));
" "${rules_file}" "${port}" "${source_pattern}"
}

require_command az
require_command curl
require_command node

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

echo "VaultProof origin TLS readiness preflight"
echo "  resource group: ${RESOURCE_GROUP}"
echo "  deployment:     ${DEPLOYMENT_NAME}"
echo "  enterprise URL: ${ENTERPRISE_URL}"
echo "  origin host:    ${ORIGIN_TLS_HOSTNAME}"
echo "  strict mode:    ${CUTOVER_READY_REQUIRED}"
echo

vm_name="$(deployment_output confidentialVmName)"
vm_public_ip="$(deployment_output confidentialVmPublicIp)"
vm_private_ip="$(deployment_output confidentialVmPrivateIp)"

echo "Deployment outputs:"
echo "  VM name:       ${vm_name}"
echo "  VM public IP:  ${vm_public_ip}"
echo "  VM private IP: ${vm_private_ip}"
echo

echo "DNS readiness:"
set +e
dns_records="$(resolve_ipv4 "${ORIGIN_TLS_HOSTNAME}")"
dns_exit=$?
set -e
if [[ "${dns_exit}" -ne 0 || -z "${dns_records}" ]]; then
  blocker "${ORIGIN_TLS_HOSTNAME} has no public IPv4 DNS record."
else
  echo "${dns_records}" | sed 's/^/  A: /'
  if grep -Fxq "${vm_public_ip}" <<< "${dns_records}"; then
    pass "Origin hostname resolves to the Confidential VM public IP."
  else
    blocker "Origin hostname does not resolve to the Confidential VM public IP ${vm_public_ip}."
  fi
fi

echo
echo "Front Door current route:"
route_json="${tmp_dir}/front-door-route.json"
az afd route show \
  --resource-group "${RESOURCE_GROUP}" \
  --profile-name "${FRONT_DOOR_PROFILE}" \
  --endpoint-name "${FRONT_DOOR_ENDPOINT}" \
  --route-name "${FRONT_DOOR_ROUTE}" \
  --query "{enabledState:enabledState,forwardingProtocol:forwardingProtocol,originPath:originPath,httpsRedirect:httpsRedirect}" \
  -o json > "${route_json}"
route_forwarding="$(json_value "${route_json}" "p => p.forwardingProtocol")"
route_origin_path="$(json_value "${route_json}" "p => p.originPath || ''")"
pass "Front Door route enabled state: $(json_value "${route_json}" "p => p.enabledState")"
if [[ "${route_forwarding}" == "HttpsOnly" ]]; then
  pass "Front Door already forwards with HttpsOnly."
else
  warn "Front Door still forwards with ${route_forwarding}; expected before cutover."
fi
if [[ -n "${route_origin_path}" ]]; then
  warn "Front Door route origin path is set to ${route_origin_path}; VM TLS origin usually expects an empty origin path."
else
  pass "Front Door route origin path is empty."
fi

echo
echo "Front Door enabled origins:"
origins_json="${tmp_dir}/front-door-origins.json"
az afd origin list \
  --resource-group "${RESOURCE_GROUP}" \
  --profile-name "${FRONT_DOOR_PROFILE}" \
  --origin-group-name "${FRONT_DOOR_ORIGIN_GROUP}" \
  --query "[].{name:name,hostName:hostName,originHostHeader:originHostHeader,httpPort:httpPort,httpsPort:httpsPort,enabledState:enabledState,enforceCertificateNameCheck:enforceCertificateNameCheck}" \
  -o json > "${origins_json}"
json_value "${origins_json}" "origins => origins.filter((origin) => origin.enabledState === 'Enabled').map((origin) => origin.name + ' ' + origin.hostName + ' http:' + origin.httpPort + ' https:' + origin.httpsPort)" | sed 's/^/  /'

echo
echo "NSG readiness:"
nic_id="$(az vm show --resource-group "${RESOURCE_GROUP}" --name "${vm_name}" --query "networkProfile.networkInterfaces[0].id" -o tsv)"
nsg_id="$(az network nic show --ids "${nic_id}" --query "networkSecurityGroup.id" -o tsv)"
if [[ -z "${nsg_id}" ]]; then
  subnet_id="$(az network nic show --ids "${nic_id}" --query "ipConfigurations[0].subnet.id" -o tsv)"
  nsg_id="$(az network vnet subnet show --ids "${subnet_id}" --query "networkSecurityGroup.id" -o tsv)"
fi
if [[ -z "${nsg_id}" ]]; then
  blocker "VM NIC/subnet has no NSG attached."
else
  nsg_name="${nsg_id##*/}"
  nsg_resource_group="$(node -e "const id = process.argv[1]; const match = id.match(/\/resourceGroups\/([^/]+)/i); if (match) console.log(match[1]);" "${nsg_id}")"
  nsg_rules_file="${tmp_dir}/nsg-rules.json"
  az network nsg rule list --resource-group "${nsg_resource_group}" --nsg-name "${nsg_name}" -o json > "${nsg_rules_file}"
  pass "VM NIC/subnet has NSG attached: ${nsg_name}"
  tls_rules="$(check_destination_port_allow "${nsg_rules_file}" 443 'AzureFrontDoor|FrontDoor')"
  if [[ -n "${tls_rules}" ]]; then
    pass "NSG allows Front Door/service-tag traffic to port 443: ${tls_rules//$'\n'/, }"
  else
    blocker "NSG does not allow Front Door/service-tag traffic to port 443."
  fi
fi

if [[ "${RUN_SSH_CHECKS}" == "true" ]]; then
  echo
  echo "VM-local TLS proxy and certificate readiness:"
  remote_json="${tmp_dir}/origin-tls-remote.json"
  set +e
  ssh -o BatchMode=yes -o ConnectTimeout=10 "${SSH_USER}@${vm_public_ip}" \
    "ORIGIN_TLS_HOSTNAME='${ORIGIN_TLS_HOSTNAME}' TLS_CERT_PATH='${TLS_CERT_PATH}' SELF_SIGNED_MARKER='${SELF_SIGNED_MARKER}' bash -s" > "${remote_json}" <<'REMOTE'
set -euo pipefail
configured_cert_path="${TLS_CERT_PATH}"
configured_key_path=""
nginx_config="/etc/nginx/sites-enabled/vaultproof-origin-tls.conf"
if [[ -f "${nginx_config}" ]]; then
  parsed_cert_path="$(awk '$1 == "ssl_certificate" { gsub(";", "", $2); print $2; exit }' "${nginx_config}" || true)"
  parsed_key_path="$(awk '$1 == "ssl_certificate_key" { gsub(";", "", $2); print $2; exit }' "${nginx_config}" || true)"
  if [[ -n "${parsed_cert_path}" ]]; then configured_cert_path="${parsed_cert_path}"; fi
  if [[ -n "${parsed_key_path}" ]]; then configured_key_path="${parsed_key_path}"; fi
fi
cert_exists=false
marker_exists=false
nginx_status="$(systemctl is-active nginx || true)"
if sudo -n test -f "${configured_cert_path}"; then cert_exists=true; fi
if sudo -n test -f "${SELF_SIGNED_MARKER}"; then marker_exists=true; fi
trusted_status=""
insecure_status=""
subject=""
issuer=""
not_before=""
not_after=""
san=""
if [[ "${cert_exists}" == "true" ]]; then
  subject="$(sudo -n openssl x509 -in "${configured_cert_path}" -noout -subject 2>/dev/null || true)"
  issuer="$(sudo -n openssl x509 -in "${configured_cert_path}" -noout -issuer 2>/dev/null || true)"
  not_before="$(sudo -n openssl x509 -in "${configured_cert_path}" -noout -startdate 2>/dev/null || true)"
  not_after="$(sudo -n openssl x509 -in "${configured_cert_path}" -noout -enddate 2>/dev/null || true)"
  san="$(sudo -n openssl x509 -in "${configured_cert_path}" -noout -ext subjectAltName 2>/dev/null || true)"
fi
trusted_status="$(curl -sS --connect-timeout 10 --max-time 20 --resolve "${ORIGIN_TLS_HOSTNAME}:443:127.0.0.1" -o /tmp/vaultproof-origin-tls-trusted-health.json -w "%{http_code}" "https://${ORIGIN_TLS_HOSTNAME}/health" 2>/tmp/vaultproof-origin-tls-trusted-health.err || true)"
insecure_status="$(curl -k -sS --connect-timeout 10 --max-time 20 --resolve "${ORIGIN_TLS_HOSTNAME}:443:127.0.0.1" -o /tmp/vaultproof-origin-tls-insecure-health.json -w "%{http_code}" "https://${ORIGIN_TLS_HOSTNAME}/health" 2>/tmp/vaultproof-origin-tls-insecure-health.err || true)"
node -e "
const payload = {
  nginxStatus: process.argv[1],
  certExists: process.argv[2] === 'true',
  selfSignedMarkerExists: process.argv[3] === 'true',
  trustedHealthStatus: process.argv[4] || null,
  insecureHealthStatus: process.argv[5] || null,
  subject: process.argv[6] || null,
  issuer: process.argv[7] || null,
  notBefore: process.argv[8] || null,
  notAfter: process.argv[9] || null,
  subjectAltName: process.argv[10] || null,
  configuredCertPath: process.argv[11] || null,
  configuredKeyPath: process.argv[12] || null,
};
console.log(JSON.stringify(payload, null, 2));
" "${nginx_status}" "${cert_exists}" "${marker_exists}" "${trusted_status}" "${insecure_status}" "${subject}" "${issuer}" "${not_before}" "${not_after}" "${san}" "${configured_cert_path}" "${configured_key_path}"
REMOTE
  ssh_exit=$?
  set -e

  if [[ "${ssh_exit}" -ne 0 ]]; then
    if [[ "${CUTOVER_READY_REQUIRED}" == "true" ]]; then
      blocker "VM-local TLS SSH checks failed for ${SSH_USER}@${vm_public_ip}; reopen SSH temporarily or set RUN_SSH_CHECKS=false only after independent VM-local TLS verification."
    else
      warn "Skipping VM-local TLS SSH checks because SSH to ${SSH_USER}@${vm_public_ip} failed; public SSH may be intentionally locked down."
    fi
  else

  nginx_status="$(json_value "${remote_json}" "p => p.nginxStatus")"
  cert_exists="$(json_value "${remote_json}" "p => p.certExists")"
  marker_exists="$(json_value "${remote_json}" "p => p.selfSignedMarkerExists")"
  trusted_status="$(json_value "${remote_json}" "p => p.trustedHealthStatus || ''")"
  insecure_status="$(json_value "${remote_json}" "p => p.insecureHealthStatus || ''")"
  configured_cert_path="$(json_value "${remote_json}" "p => p.configuredCertPath || ''")"
  san="$(json_value "${remote_json}" "p => p.subjectAltName || ''")"
  issuer="$(json_value "${remote_json}" "p => p.issuer || ''")"
  not_after="$(json_value "${remote_json}" "p => p.notAfter || ''")"

  if [[ "${nginx_status}" == "active" ]]; then
    pass "nginx is active."
  else
    blocker "nginx is not active; status is ${nginx_status:-missing}."
  fi
  if [[ "${cert_exists}" == "true" ]]; then
    pass "Origin TLS certificate exists at ${configured_cert_path:-${TLS_CERT_PATH}}."
    echo "  ${issuer}"
    echo "  ${not_after}"
  else
    blocker "Origin TLS certificate is missing at ${TLS_CERT_PATH}."
  fi
  if grep -Fq "DNS:${ORIGIN_TLS_HOSTNAME}" <<< "${san}"; then
    pass "Certificate SAN includes ${ORIGIN_TLS_HOSTNAME}."
  else
    blocker "Certificate SAN does not include DNS:${ORIGIN_TLS_HOSTNAME}."
  fi
  if [[ "${marker_exists}" == "true" ]]; then
    blocker "Temporary self-signed certificate marker exists at ${SELF_SIGNED_MARKER}."
  else
    pass "No temporary self-signed marker found."
  fi
  if [[ "${trusted_status}" == "200" ]]; then
    pass "Trusted VM-local TLS /health returned HTTP 200."
  else
    blocker "Trusted VM-local TLS /health returned HTTP ${trusted_status:-<empty>}; cert may be self-signed/untrusted."
  fi
  if [[ "${insecure_status}" == "200" ]]; then
    pass "Insecure VM-local TLS /health returned HTTP 200."
  else
    blocker "Insecure VM-local TLS /health returned HTTP ${insecure_status:-<empty>}."
  fi
  fi
else
  warn "Skipping VM-local SSH checks because RUN_SSH_CHECKS=false."
fi

echo
if [[ "${failures}" -eq 0 ]]; then
  echo "Origin TLS readiness preflight passed. Front Door HttpsOnly cutover can be considered after a final production verifier run."
elif [[ "${CUTOVER_READY_REQUIRED}" == "true" ]]; then
  echo "Origin TLS readiness preflight failed with ${failures} blocker(s) and ${warnings} warning(s)." >&2
  exit 1
else
  echo "Origin TLS readiness preflight found ${failures} blocker(s) and ${warnings} warning(s)."
  echo "Report-only mode is active. Set CUTOVER_READY_REQUIRED=true to make blockers fail the command."
fi
