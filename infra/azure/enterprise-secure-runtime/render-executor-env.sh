#!/usr/bin/env bash
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-vaultproof-enterprise}"
DEPLOYMENT_NAME="${DEPLOYMENT_NAME:-vp-enterprise-secure-runtime}"
SIGNING_KEYS="${ENTERPRISE_EXECUTOR_ACCEPTED_SIGNING_KEYS:-}"
SUPABASE_URL_VALUE="${SUPABASE_URL:-}"
SUPABASE_SERVICE_ROLE_KEY_VALUE="${SUPABASE_SERVICE_ROLE_KEY:-}"
BUILD_DIGEST="${VAULTPROOF_EXECUTOR_BUILD_DIGEST:-}"
MEASUREMENT_SUMMARY="${AZURE_MEASUREMENT_SUMMARY:-}"
KEY_RELEASE_POLICY_HASH="${AZURE_KEY_RELEASE_POLICY_HASH:-}"
ATTESTATION_CLIENT_PATH="${AZURE_ATTESTATION_CLIENT_PATH:-/usr/local/bin/AttestationClient}"

if ! command -v az >/dev/null 2>&1; then
  echo "Azure CLI is required. Run this from Azure Cloud Shell or a machine with az installed." >&2
  exit 1
fi

deployment_output() {
  local name="$1"
  az deployment group show \
    --resource-group "${RESOURCE_GROUP}" \
    --name "${DEPLOYMENT_NAME}" \
    --query "properties.outputs.${name}.value" \
    -o tsv
}

KEY_RELEASE_URL="$(deployment_output prototypeKeyReleaseUrl)"
ATTESTATION_PROVIDER_URI="$(deployment_output attestationProviderUri)"
UNWRAP_KEY_ID="$(deployment_output unwrapKeyId)"
CONFIDENTIAL_VM_RESOURCE_ID="$(deployment_output confidentialVmResourceId)"

cat <<EOF
PORT=3002
VAULTPROOF_EXECUTOR_MODE=confidential
SUPABASE_URL=${SUPABASE_URL_VALUE}
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY_VALUE}
ENTERPRISE_EXECUTOR_ACCEPTED_SIGNING_KEYS=${SIGNING_KEYS}
AZURE_KEY_RELEASE_URL=${KEY_RELEASE_URL}
AZURE_ATTESTATION_PROVIDER_URI=${ATTESTATION_PROVIDER_URI}
AZURE_ATTESTATION_CLIENT_PATH=${ATTESTATION_CLIENT_PATH}
AZURE_KEY_RELEASE_POLICY_HASH=${KEY_RELEASE_POLICY_HASH}
AZURE_KEY_ID=${UNWRAP_KEY_ID}
AZURE_KEY_VERSION=${UNWRAP_KEY_ID##*/}
VAULTPROOF_EXECUTOR_BUILD_DIGEST=${BUILD_DIGEST}
AZURE_CONFIDENTIAL_VM_RESOURCE_ID=${CONFIDENTIAL_VM_RESOURCE_ID}
AZURE_MEASUREMENT_SUMMARY=${MEASUREMENT_SUMMARY}
EOF

cat >&2 <<'EOF'

Review the generated env before installing it on the Confidential VM.
Do not add VAULT_ENCRYPTION_KEY for confidential mode.
Do not add AZURE_ATTESTATION_TOKEN unless temporarily debugging attestation.
EOF
