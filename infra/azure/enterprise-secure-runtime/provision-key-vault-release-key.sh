#!/usr/bin/env bash
set -euo pipefail

KEY_VAULT_NAME="${KEY_VAULT_NAME:-}"
POLICY_FILE="${POLICY_FILE:-}"
VM_PRINCIPAL_ID="${VM_PRINCIPAL_ID:-}"
KEY_NAME="${KEY_NAME:-vaultproof-enterprise-unwrap}"
OUT_ENV_FILE="${OUT_ENV_FILE:-./key-vault-key-env.sh}"

if [[ -z "${KEY_VAULT_NAME}" || -z "${POLICY_FILE}" || -z "${VM_PRINCIPAL_ID}" ]]; then
  cat >&2 <<'EOF'
Required environment variables:
  KEY_VAULT_NAME    Azure Key Vault Premium vault name, without .vault.azure.net
  POLICY_FILE       Path to skr-policy.json from build-skr-policy.mjs
  VM_PRINCIPAL_ID   System-assigned managed identity principal ID for the Confidential VM

Optional:
  KEY_NAME          Defaults to vaultproof-enterprise-unwrap
  OUT_ENV_FILE      Defaults to ./key-vault-key-env.sh

The caller needs Key Vault key create/export permissions on the vault and
Microsoft.Authorization/roleAssignments/write on the selected scope.
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

echo "Creating exportable RSA-HSM release root key in Key Vault ${KEY_VAULT_NAME}..."
az keyvault key create \
  --vault-name "${KEY_VAULT_NAME}" \
  --name "${KEY_NAME}" \
  --kty RSA-HSM \
  --size 3072 \
  --ops wrapKey unwrapKey \
  --exportable true \
  --policy "${POLICY_FILE}" \
  -o none

KEY_ID="$(az keyvault key show \
  --vault-name "${KEY_VAULT_NAME}" \
  --name "${KEY_NAME}" \
  --query 'key.kid' \
  -o tsv)"

KEY_VERSION="${KEY_ID##*/}"
KEY_RELEASE_URL="${KEY_ID}/release"
VAULT_RESOURCE_ID="$(az keyvault show \
  --name "${KEY_VAULT_NAME}" \
  --query id \
  -o tsv)"
ROLE_SCOPE="${KEY_VAULT_ROLE_SCOPE:-${VAULT_RESOURCE_ID}/keys/${KEY_NAME}}"

echo "Granting the Confidential VM managed identity release-only access to ${ROLE_SCOPE}..."
az role assignment create \
  --role "Key Vault Crypto Service Release User" \
  --assignee-object-id "${VM_PRINCIPAL_ID}" \
  --assignee-principal-type ServicePrincipal \
  --scope "${ROLE_SCOPE}" \
  -o none

cat > "${OUT_ENV_FILE}" <<EOF
export AZURE_KEY_RELEASE_URL='${KEY_RELEASE_URL}'
export AZURE_KEY_ID='${KEY_ID}'
export AZURE_KEY_VERSION='${KEY_VERSION}'
EOF
chmod 0600 "${OUT_ENV_FILE}"

cat <<EOF
Key Vault Premium release key ready:
  Key Vault:       ${KEY_VAULT_NAME}
  Key name:        ${KEY_NAME}
  Key ID:          ${KEY_ID}
  Key version:     ${KEY_VERSION}
  Key release URL: ${KEY_RELEASE_URL}
  Role scope:      ${ROLE_SCOPE}
  Env file:        ${OUT_ENV_FILE}

Next:
  1. Source ${OUT_ENV_FILE} before rendering enterprise-secure-executor.env.
  2. Restart vaultproof-executor.
  3. Confirm /readiness stays production_ready:true.
  4. Only then remove Managed HSM from the demo path.
EOF
