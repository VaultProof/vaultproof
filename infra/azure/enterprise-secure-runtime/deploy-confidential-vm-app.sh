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

make_archive
scp "${ARCHIVE_PATH}" "${SSH_USER}@${VM_HOST}:/tmp/vaultproof.tgz"

remote_command="$(
  printf 'APP_DIR=%q RUN_NPM_CI=%q RUN_BUILD=%q RESTART_SERVICES=%q bash -s' \
    "${APP_DIR}" \
    "${RUN_NPM_CI}" \
    "${RUN_BUILD}" \
    "${RESTART_SERVICES}"
)"

ssh "${SSH_USER}@${VM_HOST}" "${remote_command}" <<'REMOTE'
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
