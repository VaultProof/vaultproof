#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/vaultproof/zkvault"
SERVICE_FILE="/etc/systemd/system/vaultproof-executor.service"
ENV_FILE="/etc/vaultproof/enterprise-secure-executor.env"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash bootstrap-confidential-vm.sh" >&2
  exit 1
fi

apt-get update
apt-get install -y ca-certificates curl git ufw

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

if ! id vaultproof >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin vaultproof
fi

mkdir -p /opt/vaultproof /etc/vaultproof
chown -R vaultproof:vaultproof /opt/vaultproof
chmod 0750 /opt/vaultproof
chmod 0750 /etc/vaultproof

if [[ ! -f "${APP_DIR}/package.json" || ! -f "${APP_DIR}/packages/enterprise-secure-executor/package.json" ]]; then
  echo "Copy or clone the VaultProof repo into ${APP_DIR} before running this script again." >&2
  echo "Expected package files:" >&2
  echo "  ${APP_DIR}/package.json" >&2
  echo "  ${APP_DIR}/packages/enterprise-secure-executor/package.json" >&2
  exit 2
fi

cd "${APP_DIR}"
npm ci
npm run build:enterprise
chown -R vaultproof:vaultproof "${APP_DIR}"

if [[ ! -f "${ENV_FILE}" ]]; then
  cat > "${ENV_FILE}" <<'EOF'
PORT=3002
VAULTPROOF_EXECUTOR_MODE=confidential
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ENTERPRISE_EXECUTOR_ACCEPTED_SIGNING_KEYS=
AZURE_KEY_RELEASE_URL=
AZURE_ATTESTATION_PROVIDER_URI=
AZURE_ATTESTATION_CLIENT_PATH=/usr/local/bin/AttestationClient
AZURE_KEY_RELEASE_POLICY_HASH=
AZURE_KEY_ID=
AZURE_KEY_VERSION=
VAULTPROOF_EXECUTOR_BUILD_DIGEST=
AZURE_CONFIDENTIAL_VM_RESOURCE_ID=
AZURE_MEASUREMENT_SUMMARY=
EOF
  chmod 0640 "${ENV_FILE}"
  chown root:vaultproof "${ENV_FILE}"
  echo "Created ${ENV_FILE}. Fill in the values before starting the service." >&2
fi

install -m 0644 infra/azure/enterprise-secure-runtime/vaultproof-executor.service "${SERVICE_FILE}"

ufw allow OpenSSH
ufw allow from 10.42.1.0/24 to any port 3002 proto tcp
ufw --force enable

systemctl daemon-reload
systemctl enable vaultproof-executor

echo "Bootstrap complete."
echo "Next:"
echo "1. Edit ${ENV_FILE}"
echo "2. systemctl start vaultproof-executor"
echo "3. systemctl status vaultproof-executor --no-pager"
