#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-vaultproof-prod}"
ZONE="${ZONE:-us-central1-a}"
VM_NAME="${VM_NAME:-vaultproof-enterprise-runtime-1}"
CONTROL_PLANE_SECRET="${CONTROL_PLANE_SECRET:-enterprise-control-plane-env}"
EXECUTOR_SECRET="${EXECUTOR_SECRET:-enterprise-secure-executor-env}"
CONTROL_PLANE_ENV_FILE="${CONTROL_PLANE_ENV_FILE:-enterprise-control-plane.env}"
EXECUTOR_ENV_FILE="${EXECUTOR_ENV_FILE:-enterprise-secure-executor.env}"
RESET_VM="${RESET_VM:-false}"

if [[ "${CONFIRM_GCP_SECRET_PUBLISH:-}" != "publish-gcp-runtime-secrets" ]]; then
  echo "Set CONFIRM_GCP_SECRET_PUBLISH=publish-gcp-runtime-secrets to add new Secret Manager versions."
  exit 1
fi

require_file() {
  local path="$1"
  if [[ ! -s "${path}" ]]; then
    echo "Required env file is missing or empty: ${path}"
    exit 1
  fi
}

require_key() {
  local path="$1"
  local key="$2"
  if ! grep -Eq "^${key}=" "${path}"; then
    echo "Required key ${key} is missing from ${path}"
    exit 1
  fi
}

reject_bootstrap_values() {
  local path="$1"
  if grep -Eq 'not-ready-bootstrap|bootstrap-not-ready' "${path}"; then
    echo "Bootstrap placeholder values are still present in ${path}"
    exit 1
  fi
}

require_file "${CONTROL_PLANE_ENV_FILE}"
require_file "${EXECUTOR_ENV_FILE}"

require_key "${CONTROL_PLANE_ENV_FILE}" ENTERPRISE_CLOUD_PROVIDER
require_key "${CONTROL_PLANE_ENV_FILE}" ENTERPRISE_HOSTNAME
require_key "${CONTROL_PLANE_ENV_FILE}" ENTERPRISE_EXECUTOR_SIGNING_KEY_ID
require_key "${CONTROL_PLANE_ENV_FILE}" ENTERPRISE_EXECUTOR_SIGNING_SECRET
require_key "${CONTROL_PLANE_ENV_FILE}" SUPABASE_URL
require_key "${CONTROL_PLANE_ENV_FILE}" SUPABASE_ANON_KEY
require_key "${CONTROL_PLANE_ENV_FILE}" SUPABASE_SERVICE_ROLE_KEY
require_key "${CONTROL_PLANE_ENV_FILE}" VAULTPROOF_INTERNAL_ADMIN_ACTIONS_ENABLED

if grep -Eq '^VAULTPROOF_INTERNAL_ADMIN_ACTIONS_ENABLED=true$' "${CONTROL_PLANE_ENV_FILE}" \
  && ! grep -Eq '^VAULTPROOF_INTERNAL_ADMIN_APPROVAL_SECRET=.+$' "${CONTROL_PLANE_ENV_FILE}"; then
  echo "VAULTPROOF_INTERNAL_ADMIN_ACTIONS_ENABLED=true requires VAULTPROOF_INTERNAL_ADMIN_APPROVAL_SECRET in ${CONTROL_PLANE_ENV_FILE}"
  exit 1
fi

require_key "${EXECUTOR_ENV_FILE}" ENTERPRISE_CLOUD_PROVIDER
require_key "${EXECUTOR_ENV_FILE}" VAULTPROOF_EXECUTOR_MODE
require_key "${EXECUTOR_ENV_FILE}" ENTERPRISE_EXECUTOR_ACCEPTED_SIGNING_KEYS
require_key "${EXECUTOR_ENV_FILE}" GCP_KMS_ENCRYPTED_VAULT_UNWRAP_KEY_BASE64
require_key "${EXECUTOR_ENV_FILE}" GCP_ATTESTATION_TOKEN_HASH
require_key "${EXECUTOR_ENV_FILE}" GCP_MEASUREMENT_SUMMARY
require_key "${EXECUTOR_ENV_FILE}" SUPABASE_URL
require_key "${EXECUTOR_ENV_FILE}" SUPABASE_SERVICE_ROLE_KEY

reject_bootstrap_values "${CONTROL_PLANE_ENV_FILE}"
reject_bootstrap_values "${EXECUTOR_ENV_FILE}"

gcloud secrets versions add "${CONTROL_PLANE_SECRET}" \
  --data-file="${CONTROL_PLANE_ENV_FILE}" \
  --project="${PROJECT_ID}" >/dev/null

gcloud secrets versions add "${EXECUTOR_SECRET}" \
  --data-file="${EXECUTOR_ENV_FILE}" \
  --project="${PROJECT_ID}" >/dev/null

echo "Published new Secret Manager versions:"
echo "  ${CONTROL_PLANE_SECRET}"
echo "  ${EXECUTOR_SECRET}"

if [[ "${RESET_VM}" == "true" ]]; then
  gcloud compute instances reset "${VM_NAME}" \
    --zone="${ZONE}" \
    --project="${PROJECT_ID}"
  echo "Reset ${VM_NAME} so startup loads the latest secret versions."
else
  echo "VM not reset. Set RESET_VM=true to reload latest secrets through startup."
fi
