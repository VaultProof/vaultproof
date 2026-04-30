#!/usr/bin/env bash
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-vaultproof-enterprise}"
DEPLOYMENT_NAME="${DEPLOYMENT_NAME:-vp-enterprise-secure-runtime-eastus-hsm}"
ORIGIN_TLS_HOSTNAME="${ORIGIN_TLS_HOSTNAME:-origin.enterprise.vaultproof.dev}"
ENTERPRISE_HOSTNAME="${ENTERPRISE_HOSTNAME:-enterprise.vaultproof.dev}"
SSH_USER="${SSH_USER:-azureuser}"
ACTION="${ACTION:-plan}"
CONFIRM_ORIGIN_TLS_CERT="${CONFIRM_ORIGIN_TLS_CERT:-}"
TLS_CERT_PATH="${TLS_CERT_PATH:-/etc/vaultproof/tls/origin.crt}"
TLS_KEY_PATH="${TLS_KEY_PATH:-/etc/vaultproof/tls/origin.key}"
TLS_CSR_PATH="${TLS_CSR_PATH:-/etc/vaultproof/tls/origin.csr}"
LOCAL_CERT_FILE="${LOCAL_CERT_FILE:-}"
LOCAL_KEY_FILE="${LOCAL_KEY_FILE:-}"
FORCE_CERT_KEY_ROTATION="${FORCE_CERT_KEY_ROTATION:-false}"
RUN_PROXY_INSTALL="${RUN_PROXY_INSTALL:-true}"
RUN_LOCAL_TLS_CHECK="${RUN_LOCAL_TLS_CHECK:-true}"
TMP_REMOTE_DIR="${TMP_REMOTE_DIR:-/tmp/vaultproof-origin-tls-cert}"

require_command() {
  local command_name="$1"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Missing required command: ${command_name}" >&2
    exit 1
  fi
}

deployment_output() {
  local output_name="$1"
  az deployment group show \
    --resource-group "${RESOURCE_GROUP}" \
    --name "${DEPLOYMENT_NAME}" \
    --query "properties.outputs.${output_name}.value" \
    -o tsv
}

require_confirmation() {
  local expected="$1"
  local action_description="$2"
  if [[ "${CONFIRM_ORIGIN_TLS_CERT}" != "${expected}" ]]; then
    echo "Refusing ${action_description}: set CONFIRM_ORIGIN_TLS_CERT=${expected}." >&2
    exit 1
  fi
}

ssh_target() {
  echo "${SSH_USER}@$(deployment_output confidentialVmPublicIp)"
}

remote_ssh() {
  ssh -o BatchMode=yes -o ConnectTimeout=10 "$(ssh_target)" "$@"
}

show_plan() {
  local vm_public_ip
  vm_public_ip="$(deployment_output confidentialVmPublicIp)"
  cat <<EOF
VaultProof origin TLS certificate preparation
  resource group: ${RESOURCE_GROUP}
  deployment:     ${DEPLOYMENT_NAME}
  VM public IP:   ${vm_public_ip}
  SSH target:     ${SSH_USER}@${vm_public_ip}
  origin host:    ${ORIGIN_TLS_HOSTNAME}
  app host:       ${ENTERPRISE_HOSTNAME}
  cert path:      ${TLS_CERT_PATH}
  key path:       ${TLS_KEY_PATH}
  CSR path:       ${TLS_CSR_PATH}

Read-only/default action:
  npm run prepare:enterprise-origin-cert

Generate a CSR on the Confidential VM:
  ACTION=generate-csr CONFIRM_ORIGIN_TLS_CERT=generate-origin-csr npm run prepare:enterprise-origin-cert

Install a signed fullchain/certificate returned by your CA:
  ACTION=install LOCAL_CERT_FILE=/path/to/fullchain.pem CONFIRM_ORIGIN_TLS_CERT=install-origin-cert npm run prepare:enterprise-origin-cert

If you already generated the key outside the VM, pass LOCAL_KEY_FILE too:
  ACTION=install LOCAL_CERT_FILE=/path/to/fullchain.pem LOCAL_KEY_FILE=/path/to/privkey.pem CONFIRM_ORIGIN_TLS_CERT=install-origin-cert npm run prepare:enterprise-origin-cert

Verify what is installed on the VM:
  ACTION=check npm run prepare:enterprise-origin-cert

After install/check pass, continue with:
  npm run prepare:enterprise-origin-tls
  CUTOVER_READY_REQUIRED=true npm run verify:enterprise-origin-tls
EOF
}

generate_csr() {
  require_confirmation "generate-origin-csr" "origin TLS CSR generation"
  remote_ssh "sudo -n bash -s -- '${ORIGIN_TLS_HOSTNAME}' '${TLS_KEY_PATH}' '${TLS_CSR_PATH}' '${FORCE_CERT_KEY_ROTATION}'" <<'REMOTE'
set -euo pipefail
ORIGIN_TLS_HOSTNAME="$1"
TLS_KEY_PATH="$2"
TLS_CSR_PATH="$3"
FORCE_CERT_KEY_ROTATION="$4"
mkdir -p "$(dirname "${TLS_KEY_PATH}")"
chmod 0750 "$(dirname "${TLS_KEY_PATH}")"
if [[ -f "${TLS_KEY_PATH}" && "${FORCE_CERT_KEY_ROTATION}" != "true" ]]; then
  echo "Existing key found at ${TLS_KEY_PATH}; reusing it for the CSR."
else
  if [[ -f "${TLS_KEY_PATH}" ]]; then
    timestamp="$(date +%Y%m%d%H%M%S)"
    cp "${TLS_KEY_PATH}" "${TLS_KEY_PATH}.bak.${timestamp}"
    chmod 0600 "${TLS_KEY_PATH}.bak.${timestamp}"
    echo "Backed up existing key to ${TLS_KEY_PATH}.bak.${timestamp}."
  fi
  openssl genrsa -out "${TLS_KEY_PATH}" 3072
  chmod 0600 "${TLS_KEY_PATH}"
fi
openssl req -new -sha256 \
  -key "${TLS_KEY_PATH}" \
  -out "${TLS_CSR_PATH}" \
  -subj "/CN=${ORIGIN_TLS_HOSTNAME}" \
  -addext "subjectAltName=DNS:${ORIGIN_TLS_HOSTNAME}"
chmod 0644 "${TLS_CSR_PATH}"
echo "CSR created at ${TLS_CSR_PATH}."
echo
cat "${TLS_CSR_PATH}"
REMOTE
}

install_certificate() {
  require_confirmation "install-origin-cert" "origin TLS certificate install"
  if [[ -z "${LOCAL_CERT_FILE}" ]]; then
    echo "LOCAL_CERT_FILE is required for ACTION=install." >&2
    exit 1
  fi
  if [[ ! -f "${LOCAL_CERT_FILE}" ]]; then
    echo "LOCAL_CERT_FILE does not exist: ${LOCAL_CERT_FILE}" >&2
    exit 1
  fi
  if [[ -n "${LOCAL_KEY_FILE}" && ! -f "${LOCAL_KEY_FILE}" ]]; then
    echo "LOCAL_KEY_FILE does not exist: ${LOCAL_KEY_FILE}" >&2
    exit 1
  fi

  local target
  local remote_cert
  local remote_key
  target="$(ssh_target)"
  remote_cert="${TMP_REMOTE_DIR}/origin.crt"
  remote_key="${TMP_REMOTE_DIR}/origin.key"

  remote_ssh "rm -rf '${TMP_REMOTE_DIR}' && mkdir -p '${TMP_REMOTE_DIR}'"
  scp "${LOCAL_CERT_FILE}" "${target}:${remote_cert}" >/dev/null
  if [[ -n "${LOCAL_KEY_FILE}" ]]; then
    scp "${LOCAL_KEY_FILE}" "${target}:${remote_key}" >/dev/null
  fi

  remote_ssh "bash -s -- '${ORIGIN_TLS_HOSTNAME}' '${ENTERPRISE_HOSTNAME}' '${TLS_CERT_PATH}' '${TLS_KEY_PATH}' '${TMP_REMOTE_DIR}' '${RUN_PROXY_INSTALL}' '${RUN_LOCAL_TLS_CHECK}'" <<'REMOTE'
set -euo pipefail
ORIGIN_TLS_HOSTNAME="$1"
ENTERPRISE_HOSTNAME="$2"
TLS_CERT_PATH="$3"
TLS_KEY_PATH="$4"
TMP_REMOTE_DIR="$5"
RUN_PROXY_INSTALL="$6"
RUN_LOCAL_TLS_CHECK="$7"
remote_cert="${TMP_REMOTE_DIR}/origin.crt"
remote_key="${TMP_REMOTE_DIR}/origin.key"
openssl x509 -in "${remote_cert}" -noout -subject -issuer -dates
if ! openssl x509 -in "${remote_cert}" -noout -ext subjectAltName | grep -Fq "DNS:${ORIGIN_TLS_HOSTNAME}"; then
  echo "Certificate SAN does not include DNS:${ORIGIN_TLS_HOSTNAME}." >&2
  exit 1
fi
if [[ -f "${remote_key}" ]]; then
  sudo -n install -o root -g root -m 0600 "${remote_key}" "${TLS_KEY_PATH}"
fi
if ! sudo -n test -f "${TLS_KEY_PATH}"; then
  echo "No private key exists at ${TLS_KEY_PATH}; provide LOCAL_KEY_FILE or generate the CSR on this VM first." >&2
  exit 1
fi
sudo -n install -o root -g root -m 0644 "${remote_cert}" "${TLS_CERT_PATH}"
sudo -n rm -f /etc/vaultproof/tls/origin.self-signed
if [[ "${RUN_PROXY_INSTALL}" == "true" ]]; then
  sudo -n bash -c '
    ORIGIN_TLS_HOSTNAME="$1" \
    ENTERPRISE_HOSTNAME="$2" \
    TLS_CERT_PATH="$3" \
    TLS_KEY_PATH="$4" \
    /usr/local/sbin/vaultproof-install-origin-tls-proxy
  ' bash "${ORIGIN_TLS_HOSTNAME}" "${ENTERPRISE_HOSTNAME}" "${TLS_CERT_PATH}" "${TLS_KEY_PATH}"
fi
if [[ "${RUN_LOCAL_TLS_CHECK}" == "true" ]]; then
  curl -sS --connect-timeout 10 --max-time 20 \
    --resolve "${ORIGIN_TLS_HOSTNAME}:443:127.0.0.1" \
    "https://${ORIGIN_TLS_HOSTNAME}/health" >/tmp/vaultproof-origin-tls-install-health.json
  cat /tmp/vaultproof-origin-tls-install-health.json
  echo
fi
rm -rf "${TMP_REMOTE_DIR}"
REMOTE
}

check_certificate() {
  remote_ssh "ORIGIN_TLS_HOSTNAME='${ORIGIN_TLS_HOSTNAME}' TLS_CERT_PATH='${TLS_CERT_PATH}' TLS_KEY_PATH='${TLS_KEY_PATH}' bash -s" <<'REMOTE'
set -euo pipefail
echo "Installed certificate:"
if sudo -n test -f "${TLS_CERT_PATH}"; then
  sudo -n openssl x509 -in "${TLS_CERT_PATH}" -noout -subject -issuer -dates -ext subjectAltName
else
  echo "  missing ${TLS_CERT_PATH}"
fi
echo
echo "Installed key:"
if sudo -n test -f "${TLS_KEY_PATH}"; then
  echo "  present ${TLS_KEY_PATH}"
else
  echo "  missing ${TLS_KEY_PATH}"
fi
echo
echo "Self-signed marker:"
if sudo -n test -f /etc/vaultproof/tls/origin.self-signed; then
  echo "  present /etc/vaultproof/tls/origin.self-signed"
else
  echo "  absent"
fi
echo
echo "Trusted local TLS health:"
curl -sS --connect-timeout 10 --max-time 20 \
  --resolve "${ORIGIN_TLS_HOSTNAME}:443:127.0.0.1" \
  -o /tmp/vaultproof-origin-tls-cert-check-health.json \
  -w "  HTTP %{http_code}\n" \
  "https://${ORIGIN_TLS_HOSTNAME}/health" || true
REMOTE
}

require_command az
require_command node
require_command ssh

case "${ACTION}" in
  plan)
    show_plan
    ;;
  generate-csr)
    generate_csr
    ;;
  install)
    require_command scp
    install_certificate
    ;;
  check)
    check_certificate
    ;;
  *)
    echo "Unknown ACTION: ${ACTION}. Use plan, generate-csr, install, or check." >&2
    exit 1
    ;;
esac
