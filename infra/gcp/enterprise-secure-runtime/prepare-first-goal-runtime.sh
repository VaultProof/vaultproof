#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-vaultproof-prod}"
LOCATION="${LOCATION:-us-central1}"
ZONE="${ZONE:-us-central1-a}"
KEY_RING="${KEY_RING:-vaultproof-runtime}"
KMS_KEY="${KMS_KEY:-vaultproof-unwrap}"
VM_NAME="${VM_NAME:-vaultproof-enterprise-runtime-1}"
ORIGIN_LOCK_SECRET_NAME="${ORIGIN_LOCK_SECRET_NAME:-enterprise-origin-lock-secret}"
SIGNING_KEY_ID="${ENTERPRISE_EXECUTOR_SIGNING_KEY_ID:-enterprise-gcp-v1}"
SEED_PILOT="${SEED_PILOT:-false}"
RESET_VM="${RESET_VM:-true}"
CONFIRM="${CONFIRM_GCP_FIRST_GOAL_RUNTIME:-}"

require_command() {
  local command="$1"
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "${command} is required."
    exit 1
  fi
}

require_env() {
  local key="$1"
  if [[ -z "${!key:-}" ]]; then
    echo "${key} is required."
    exit 1
  fi
}

extract_doc_value() {
  local label="$1"
  local path="${2:-docs/enterprise/gcp-build-status.md}"
  if [[ ! -f "${path}" ]]; then
    return 0
  fi
  grep -E "^- ${label}:" "${path}" | head -1 | sed -E 's/.*`([^`]+)`.*/\1/'
}

require_command gcloud
require_command openssl
require_command base64
require_command grep
require_command sed

require_env SUPABASE_URL
require_env SUPABASE_SERVICE_ROLE_KEY

ENTERPRISE_EXECUTOR_SIGNING_SECRET="${ENTERPRISE_EXECUTOR_SIGNING_SECRET:-$(openssl rand -base64 32 | tr -d '\n')}"
ENTERPRISE_EXECUTOR_ACCEPTED_SIGNING_KEYS="${ENTERPRISE_EXECUTOR_ACCEPTED_SIGNING_KEYS:-${SIGNING_KEY_ID}:${ENTERPRISE_EXECUTOR_SIGNING_SECRET}}"
VAULTPROOF_EXECUTOR_BUILD_DIGEST="${VAULTPROOF_EXECUTOR_BUILD_DIGEST:-$(extract_doc_value 'Executor digest')}"

if [[ -z "${VAULTPROOF_EXECUTOR_BUILD_DIGEST}" || "${VAULTPROOF_EXECUTOR_BUILD_DIGEST}" == "unknown" ]]; then
  echo "VAULTPROOF_EXECUTOR_BUILD_DIGEST is required, or docs/enterprise/gcp-build-status.md must contain the current executor digest."
  exit 1
fi

if [[ -z "${GCP_ATTESTATION_TOKEN_HASH:-}" || -z "${GCP_MEASUREMENT_SUMMARY:-}" ]]; then
  echo "Collecting GCP runtime evidence for Goal 1 env values..."
  evidence_exports="$(
    PROJECT_ID="${PROJECT_ID}" \
    LOCATION="${LOCATION}" \
    ZONE="${ZONE}" \
    VM_NAME="${VM_NAME}" \
    KEY_RING="${KEY_RING}" \
    KMS_KEY="${KMS_KEY}" \
    GCP_KMS_KEY_VERSION="${GCP_KMS_KEY_VERSION:-1}" \
    VAULTPROOF_EXECUTOR_BUILD_DIGEST="${VAULTPROOF_EXECUTOR_BUILD_DIGEST}" \
    OUTPUT_FORMAT=env \
    bash infra/gcp/enterprise-secure-runtime/collect-runtime-evidence.sh
  )"
  eval "${evidence_exports}"
fi

require_env GCP_ATTESTATION_TOKEN_HASH
require_env GCP_MEASUREMENT_SUMMARY

if [[ -z "${VAULT_UNWRAP_KEY_BASE64:-}" && -z "${GCP_KMS_ENCRYPTED_VAULT_UNWRAP_KEY_BASE64:-}" ]]; then
  if [[ "${ALLOW_GENERATE_NEW_UNWRAP_ROOT:-false}" != "true" ]]; then
    echo "Set VAULT_UNWRAP_KEY_BASE64 to the existing unwrap root, or set ALLOW_GENERATE_NEW_UNWRAP_ROOT=true for fresh pilot-only data."
    exit 1
  fi
  VAULT_UNWRAP_KEY_BASE64="$(openssl rand 32 | base64 | tr -d '\n')"
fi

if [[ -z "${GCP_KMS_ENCRYPTED_VAULT_UNWRAP_KEY_BASE64:-}" ]]; then
  GCP_KMS_ENCRYPTED_VAULT_UNWRAP_KEY_BASE64="$(
    PROJECT_ID="${PROJECT_ID}" \
    LOCATION="${LOCATION}" \
    KEY_RING="${KEY_RING}" \
    KMS_KEY="${KMS_KEY}" \
    VAULT_UNWRAP_KEY_BASE64="${VAULT_UNWRAP_KEY_BASE64}" \
    bash infra/gcp/enterprise-secure-runtime/encrypt-vault-unwrap-key.sh \
      | sed -n 's/^GCP_KMS_ENCRYPTED_VAULT_UNWRAP_KEY_BASE64=//p'
  )"
fi

if [[ -z "${GCP_KMS_ENCRYPTED_VAULT_UNWRAP_KEY_BASE64}" ]]; then
  echo "Failed to produce GCP_KMS_ENCRYPTED_VAULT_UNWRAP_KEY_BASE64."
  exit 1
fi

if [[ -z "${ENTERPRISE_ORIGIN_LOCK_SECRET:-}" ]]; then
  ENTERPRISE_ORIGIN_LOCK_SECRET="$(
    gcloud secrets versions access latest \
      --secret="${ORIGIN_LOCK_SECRET_NAME}" \
      --project="${PROJECT_ID}" 2>/dev/null || true
  )"
fi

if [[ -z "${ENTERPRISE_ORIGIN_LOCK_SECRET}" ]]; then
  PROJECT_ID="${PROJECT_ID}" \
  ORIGIN_LOCK_SECRET_NAME="${ORIGIN_LOCK_SECRET_NAME}" \
  npm run configure:gcp-enterprise-origin-lock >/dev/null
  ENTERPRISE_ORIGIN_LOCK_SECRET="$(
    gcloud secrets versions access latest \
      --secret="${ORIGIN_LOCK_SECRET_NAME}" \
      --project="${PROJECT_ID}"
  )"
fi

if [[ -z "${ENTERPRISE_ORIGIN_LOCK_SECRET}" ]]; then
  echo "Failed to load ENTERPRISE_ORIGIN_LOCK_SECRET."
  exit 1
fi

tmpdir="$(mktemp -d)"
cleanup() {
  if [[ "${KEEP_RENDERED_ENV:-false}" == "true" ]]; then
    echo "Rendered env files kept in ${tmpdir}"
  else
    rm -rf "${tmpdir}"
  fi
}
trap cleanup EXIT

control_env_file="${tmpdir}/enterprise-control-plane.env"
executor_env_file="${tmpdir}/enterprise-secure-executor.env"

SUPABASE_URL="${SUPABASE_URL}" \
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY}" \
ENTERPRISE_EXECUTOR_SIGNING_KEY_ID="${SIGNING_KEY_ID}" \
ENTERPRISE_EXECUTOR_SIGNING_SECRET="${ENTERPRISE_EXECUTOR_SIGNING_SECRET}" \
ENTERPRISE_REQUIRE_ORIGIN_LOCK=true \
ENTERPRISE_ORIGIN_LOCK_SECRET="${ENTERPRISE_ORIGIN_LOCK_SECRET}" \
bash infra/gcp/enterprise-secure-runtime/render-control-plane-env.sh > "${control_env_file}"

SUPABASE_URL="${SUPABASE_URL}" \
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY}" \
ENTERPRISE_EXECUTOR_ACCEPTED_SIGNING_KEYS="${ENTERPRISE_EXECUTOR_ACCEPTED_SIGNING_KEYS}" \
GCP_KMS_ENCRYPTED_VAULT_UNWRAP_KEY_BASE64="${GCP_KMS_ENCRYPTED_VAULT_UNWRAP_KEY_BASE64}" \
GCP_KMS_KEY_VERSION="${GCP_KMS_KEY_VERSION:-1}" \
VAULTPROOF_EXECUTOR_BUILD_DIGEST="${VAULTPROOF_EXECUTOR_BUILD_DIGEST}" \
GCP_ATTESTATION_TOKEN_HASH="${GCP_ATTESTATION_TOKEN_HASH}" \
GCP_MEASUREMENT_SUMMARY="${GCP_MEASUREMENT_SUMMARY}" \
PROJECT_ID="${PROJECT_ID}" \
LOCATION="${LOCATION}" \
ZONE="${ZONE}" \
KEY_RING="${KEY_RING}" \
KMS_KEY="${KMS_KEY}" \
VM_NAME="${VM_NAME}" \
bash infra/gcp/enterprise-secure-runtime/render-executor-env.sh > "${executor_env_file}"

echo "Rendered and validated Goal 1 runtime env files."
echo "  control-plane keys: $(grep -c '^[A-Z0-9_]*=' "${control_env_file}")"
echo "  executor keys: $(grep -c '^[A-Z0-9_]*=' "${executor_env_file}")"

if [[ "${CONFIRM}" != "publish" ]]; then
  echo "Dry run only. Set CONFIRM_GCP_FIRST_GOAL_RUNTIME=publish to publish Secret Manager versions and reset the VM."
  exit 0
fi

CONFIRM_GCP_SECRET_PUBLISH=publish-gcp-runtime-secrets \
CONTROL_PLANE_ENV_FILE="${control_env_file}" \
EXECUTOR_ENV_FILE="${executor_env_file}" \
PROJECT_ID="${PROJECT_ID}" \
ZONE="${ZONE}" \
VM_NAME="${VM_NAME}" \
RESET_VM="${RESET_VM}" \
bash infra/gcp/enterprise-secure-runtime/publish-runtime-secrets.sh

if [[ "${SEED_PILOT}" == "true" ]]; then
  if [[ -n "${DEMO_PROVIDER_API_KEY:-}" || -n "${OPENAI_API_KEY:-}" ]]; then
    require_env VAULT_UNWRAP_KEY_BASE64
    seed_mode="live decryptable OpenAI provider slot"
  else
    seed_mode="demo dashboard placeholder provider slot"
  fi

  SUPABASE_URL="${SUPABASE_URL}" \
  SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY}" \
  DEMO_EMAIL="${DEMO_EMAIL:-ken@vaultproof.dev}" \
  DEMO_ORG_NAME="${DEMO_ORG_NAME:-VaultProof Pilot}" \
  DEMO_PROJECT_NAME="${DEMO_PROJECT_NAME:-First Paid Pilot}" \
  DEMO_PROVIDER_API_KEY="${DEMO_PROVIDER_API_KEY:-}" \
  VAULT_UNWRAP_KEY_BASE64="${VAULT_UNWRAP_KEY_BASE64:-}" \
  node scripts/create-enterprise-demo-account.mjs
  echo "Pilot data seeded with ${seed_mode}."
else
  echo "Pilot data not seeded. Set SEED_PILOT=true to seed dashboard data; add DEMO_PROVIDER_API_KEY with VAULT_UNWRAP_KEY_BASE64 for live provider material."
fi

echo "Goal 1 runtime secret publish path completed. Run npm run gate:gcp-first-goal after the VM finishes restarting."
