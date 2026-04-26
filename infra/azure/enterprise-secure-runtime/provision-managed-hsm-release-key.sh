#!/usr/bin/env bash
set -euo pipefail

MANAGED_HSM_NAME="${MANAGED_HSM_NAME:-}"
POLICY_FILE="${POLICY_FILE:-}"
VM_PRINCIPAL_ID="${VM_PRINCIPAL_ID:-}"
KEY_NAME="${KEY_NAME:-vaultproof-enterprise-unwrap}"
OUT_ENV_FILE="${OUT_ENV_FILE:-./managed-hsm-key-env.sh}"

if [[ -z "${MANAGED_HSM_NAME}" || -z "${POLICY_FILE}" || -z "${VM_PRINCIPAL_ID}" ]]; then
  cat >&2 <<'EOF'
Required environment variables:
  MANAGED_HSM_NAME   Azure Managed HSM name, without .managedhsm.azure.net
  POLICY_FILE        Path to skr-policy.json from build-skr-policy.mjs
  VM_PRINCIPAL_ID    System-assigned managed identity principal ID for the Confidential VM

Optional:
  KEY_NAME           Defaults to vaultproof-enterprise-unwrap
  OUT_ENV_FILE       Defaults to ./managed-hsm-key-env.sh
EOF
  exit 2
fi

if ! command -v az >/dev/null 2>&1; then
  echo "Azure CLI is required. Run this from Azure Cloud Shell or a machine with az installed." >&2
  exit 1
fi

if [[ ! -f "${POLICY_FILE}" ]]; then
  echo "Policy file not found: ${POLICY_FILE}" >&2
  exit 1
fi

echo "Creating exportable RSA-HSM release root key in ${MANAGED_HSM_NAME}..."
az keyvault key create \
  --hsm-name "${MANAGED_HSM_NAME}" \
  --name "${KEY_NAME}" \
  --kty RSA-HSM \
  --size 3072 \
  --ops export \
  --exportable true \
  --policy "${POLICY_FILE}" \
  -o none

KEY_ID="$(az keyvault key show \
  --hsm-name "${MANAGED_HSM_NAME}" \
  --name "${KEY_NAME}" \
  --query 'key.kid' \
  -o tsv)"

KEY_VERSION="${KEY_ID##*/}"
KEY_RELEASE_URL="${KEY_ID}/release"

echo "Granting the Confidential VM managed identity release-only access to /keys/${KEY_NAME}..."
az keyvault role assignment create \
  --hsm-name "${MANAGED_HSM_NAME}" \
  --role "Managed HSM Crypto Service Release User" \
  --assignee-object-id "${VM_PRINCIPAL_ID}" \
  --assignee-principal-type MSI \
  --scope "/keys/${KEY_NAME}" \
  -o none

cat > "${OUT_ENV_FILE}" <<EOF
export AZURE_KEY_RELEASE_URL='${KEY_RELEASE_URL}'
export AZURE_KEY_ID='${KEY_ID}'
export AZURE_KEY_VERSION='${KEY_VERSION}'
EOF
chmod 0600 "${OUT_ENV_FILE}"

cat <<EOF
Managed HSM release key ready:
  HSM:             ${MANAGED_HSM_NAME}
  Key name:        ${KEY_NAME}
  Key ID:          ${KEY_ID}
  Key version:     ${KEY_VERSION}
  Key release URL: ${KEY_RELEASE_URL}
  Env file:        ${OUT_ENV_FILE}
EOF
