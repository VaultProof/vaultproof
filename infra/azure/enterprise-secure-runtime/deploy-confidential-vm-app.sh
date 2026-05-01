#!/usr/bin/env bash
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-vaultproof-enterprise}"
DEPLOYMENT_NAME="${DEPLOYMENT_NAME:-vp-enterprise-secure-runtime-eastus-hsm}"
VM_HOST="${VM_HOST:-}"
SSH_USER="${SSH_USER:-azureuser}"
APP_DIR="${APP_DIR:-/opt/vaultproof/zkvault}"
ARCHIVE_PATH="${ARCHIVE_PATH:-/tmp/vaultproof-cvm-deploy.tgz}"
RUN_NPM_CI="${RUN_NPM_CI:-true}"
RUN_BUILD="${RUN_BUILD:-true}"
RESTART_SERVICES="${RESTART_SERVICES:-vaultproof-executor vaultproof-control-plane}"
VERIFY_AFTER_DEPLOY="${VERIFY_AFTER_DEPLOY:-false}"
SSH_CONNECT_TIMEOUT="${SSH_CONNECT_TIMEOUT:-10}"
SKIP_SSH_PREFLIGHT="${SKIP_SSH_PREFLIGHT:-false}"

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

print_ssh_reopen_guidance() {
  cat >&2 <<EOF
SSH preflight to ${SSH_USER}@${VM_HOST} failed.

If public SSH bootstrap is intentionally locked down, temporarily reopen it,
deploy, verify, then close it again:

  CONFIRM_SSH_LOCKDOWN=reopen-public-ssh ACTION=reopen npm run harden:enterprise-ssh
  npm run deploy:enterprise-vm
  ALTERNATE_ACCESS_ACK=true CONFIRM_SSH_LOCKDOWN=close-public-ssh ACTION=close npm run harden:enterprise-ssh
  EXPECTED_SSH_BOOTSTRAP_ACCESS=Deny RUN_SSH_CHECKS=false npm run verify:enterprise-production

If you are deploying through a private network path and know SSH is reachable
outside the public bootstrap rule, set SKIP_SSH_PREFLIGHT=true.
EOF
}

require_ssh_reachable() {
  if [[ "${SKIP_SSH_PREFLIGHT}" == "true" ]]; then
    echo "Skipping SSH preflight because SKIP_SSH_PREFLIGHT=true."
    return
  fi

  if ssh -o BatchMode=yes -o ConnectTimeout="${SSH_CONNECT_TIMEOUT}" "${SSH_USER}@${VM_HOST}" "true" >/dev/null 2>&1; then
    return
  fi

  print_ssh_reopen_guidance
  exit 1
}

make_archive() {
  rm -f "${ARCHIVE_PATH}"
  (
    cd "${repo_root}/.."
    if COPYFILE_DISABLE=1 tar --no-xattrs \
      --exclude node_modules \
      --exclude .git \
      --exclude .next \
      --exclude dist \
      -czf "${ARCHIVE_PATH}" "$(basename "${repo_root}")" 2>/dev/null; then
      return
    fi

    COPYFILE_DISABLE=1 tar \
      --exclude node_modules \
      --exclude .git \
      --exclude .next \
      --exclude dist \
      -czf "${ARCHIVE_PATH}" "$(basename "${repo_root}")"
  )
}

require_command scp
require_command ssh

if [[ -z "${VM_HOST}" ]]; then
  require_command az
  VM_HOST="$(deployment_output confidentialVmPublicIp)"
fi

if [[ -z "${VM_HOST}" ]]; then
  echo "VM_HOST is empty and could not be discovered from deployment outputs." >&2
  exit 1
fi

echo "Deploying VaultProof enterprise app to Confidential VM"
echo "  repo:       ${repo_root}"
echo "  target:     ${SSH_USER}@${VM_HOST}:${APP_DIR}"
echo "  npm ci:     ${RUN_NPM_CI}"
echo "  build:      ${RUN_BUILD}"
echo "  restarts:   ${RESTART_SERVICES:-<none>}"
echo

require_ssh_reachable
make_archive
scp -o BatchMode=yes -o ConnectTimeout="${SSH_CONNECT_TIMEOUT}" "${ARCHIVE_PATH}" "${SSH_USER}@${VM_HOST}:/tmp/vaultproof.tgz"

remote_command="$(
  printf 'APP_DIR=%q RUN_NPM_CI=%q RUN_BUILD=%q RESTART_SERVICES=%q bash -s' \
    "${APP_DIR}" \
    "${RUN_NPM_CI}" \
    "${RUN_BUILD}" \
    "${RESTART_SERVICES}"
)"

ssh -o BatchMode=yes -o ConnectTimeout="${SSH_CONNECT_TIMEOUT}" "${SSH_USER}@${VM_HOST}" "${remote_command}" <<'REMOTE'
set -euo pipefail

sudo mkdir -p "${APP_DIR}"
sudo tar -xzf /tmp/vaultproof.tgz -C "${APP_DIR}" --strip-components=1
app_parent="$(dirname "${APP_DIR}")"
sudo chown -R "${USER}:${USER}" "${app_parent}"
sudo chmod 0750 "${app_parent}"

cd "${APP_DIR}"

if [[ "${RUN_NPM_CI}" == "true" ]]; then
  npm ci
fi

if [[ "${RUN_BUILD}" == "true" ]]; then
  npm run build:enterprise
fi

sudo install -m 0644 infra/azure/enterprise-secure-runtime/vaultproof-executor.service /etc/systemd/system/vaultproof-executor.service
sudo install -m 0644 infra/azure/enterprise-secure-runtime/vaultproof-control-plane.service /etc/systemd/system/vaultproof-control-plane.service
sudo install -m 0755 infra/azure/enterprise-secure-runtime/install-origin-tls-proxy.sh /usr/local/sbin/vaultproof-install-origin-tls-proxy
sudo systemctl daemon-reload
sudo systemctl enable vaultproof-executor vaultproof-control-plane >/dev/null

sudo chown -R vaultproof:vaultproof "${app_parent}"
sudo chmod 0750 "${app_parent}"

if [[ -n "${RESTART_SERVICES}" ]]; then
  for service in ${RESTART_SERVICES}; do
    sudo systemctl restart "${service}"
  done
  sleep 3
  for service in ${RESTART_SERVICES}; do
    sudo systemctl status "${service}" --no-pager
  done
fi
REMOTE

if [[ "${VERIFY_AFTER_DEPLOY}" == "true" ]]; then
  if [[ -x "${script_dir}/verify-production-runtime.sh" ]]; then
    bash "${script_dir}/verify-production-runtime.sh"
  else
    echo "Skipping verification because verify-production-runtime.sh is not executable." >&2
  fi
fi

echo
echo "Deploy complete."
