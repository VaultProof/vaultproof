#!/usr/bin/env bash
set -euo pipefail

CONTROL_PLANE_ENV_FILE="${CONTROL_PLANE_ENV_FILE:-/etc/vaultproof/enterprise-control-plane.env}"
EXECUTOR_ENV_FILE="${EXECUTOR_ENV_FILE:-/etc/vaultproof/enterprise-secure-executor.env}"
MIN_SIGNING_SECRET_LENGTH="${MIN_SIGNING_SECRET_LENGTH:-32}"
REQUIRE_ROTATION_ACK="${REQUIRE_ROTATION_ACK:-false}"

failures=0

pass() {
  echo "PASS $*"
}

fail() {
  echo "FAIL $*" >&2
  failures=$((failures + 1))
}

env_value() {
  local file="$1"
  local key="$2"
  awk -v key="${key}" '
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    {
      split($0, parts, "=")
      name = parts[1]
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", name)
      if (name == key) {
        sub(/^[^=]*=/, "", $0)
        print $0
      }
    }
  ' "${file}" | tail -n 1
}

contains_weak_marker() {
  local value
  value="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "${value}" in
    ""|changeme|change-me|placeholder|replace-me|replace_me|example|test|demo|local-secret|local-smoke-secret|seed-token|"<service-role-key>"|"<signing-secret>")
      return 0
      ;;
    *changeme*|*placeholder*|*replace-me*|*replace_me*|*local-secret*|*local-smoke-secret*|*seed-token*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

require_file() {
  local label="$1"
  local file="$2"
  if [[ -f "${file}" ]]; then
    pass "${label} exists: ${file}"
  else
    fail "${label} is missing: ${file}"
  fi
}

require_nonempty() {
  local label="$1"
  local value="$2"
  if [[ -n "${value}" ]]; then
    pass "${label} is set"
  else
    fail "${label} is empty"
  fi
}

require_absent() {
  local label="$1"
  local value="$2"
  if [[ -z "${value}" ]]; then
    pass "${label} is absent"
  else
    fail "${label} must be absent for production"
  fi
}

require_not_weak() {
  local label="$1"
  local value="$2"
  if contains_weak_marker "${value}"; then
    fail "${label} looks like a setup/demo placeholder"
  else
    pass "${label} does not match known setup placeholders"
  fi
}

secret_for_key_id() {
  local accepted_keys="$1"
  local key_id="$2"
  local entry
  IFS=',' read -ra entries <<< "${accepted_keys}"
  for entry in "${entries[@]}"; do
    entry="${entry#"${entry%%[![:space:]]*}"}"
    entry="${entry%"${entry##*[![:space:]]}"}"
    if [[ "${entry}" == "${key_id}:"* ]]; then
      printf '%s' "${entry#*:}"
      return 0
    fi
  done
}

echo "VaultProof enterprise runtime secret verification"
echo "  control-plane env: ${CONTROL_PLANE_ENV_FILE}"
echo "  executor env:      ${EXECUTOR_ENV_FILE}"
echo

require_file "control-plane env" "${CONTROL_PLANE_ENV_FILE}"
require_file "executor env" "${EXECUTOR_ENV_FILE}"

if [[ ! -f "${CONTROL_PLANE_ENV_FILE}" || ! -f "${EXECUTOR_ENV_FILE}" ]]; then
  exit 1
fi

cp_signing_key_id="$(env_value "${CONTROL_PLANE_ENV_FILE}" ENTERPRISE_EXECUTOR_SIGNING_KEY_ID)"
cp_signing_secret="$(env_value "${CONTROL_PLANE_ENV_FILE}" ENTERPRISE_EXECUTOR_SIGNING_SECRET)"
executor_signing_keys="$(env_value "${EXECUTOR_ENV_FILE}" ENTERPRISE_EXECUTOR_ACCEPTED_SIGNING_KEYS)"
executor_mode="$(env_value "${EXECUTOR_ENV_FILE}" VAULTPROOF_EXECUTOR_MODE)"
cp_supabase_url="$(env_value "${CONTROL_PLANE_ENV_FILE}" SUPABASE_URL)"
cp_supabase_service_role="$(env_value "${CONTROL_PLANE_ENV_FILE}" SUPABASE_SERVICE_ROLE_KEY)"
executor_supabase_url="$(env_value "${EXECUTOR_ENV_FILE}" SUPABASE_URL)"
executor_supabase_service_role="$(env_value "${EXECUTOR_ENV_FILE}" SUPABASE_SERVICE_ROLE_KEY)"

require_nonempty "control-plane signing key id" "${cp_signing_key_id}"
require_nonempty "control-plane signing secret" "${cp_signing_secret}"
require_nonempty "executor accepted signing keys" "${executor_signing_keys}"
require_not_weak "control-plane signing secret" "${cp_signing_secret}"
if (( ${#cp_signing_secret} < MIN_SIGNING_SECRET_LENGTH )); then
  fail "control-plane signing secret must be at least ${MIN_SIGNING_SECRET_LENGTH} characters"
else
  pass "control-plane signing secret length is at least ${MIN_SIGNING_SECRET_LENGTH}"
fi

executor_matching_secret="$(secret_for_key_id "${executor_signing_keys}" "${cp_signing_key_id}")"
if [[ -n "${executor_matching_secret}" && "${executor_matching_secret}" == "${cp_signing_secret}" ]]; then
  pass "executor accepts the active control-plane signing key"
else
  fail "executor accepted signing keys do not match the active control-plane signing key"
fi
require_not_weak "executor accepted signing key material" "${executor_matching_secret}"

require_nonempty "control-plane Supabase URL" "${cp_supabase_url}"
require_nonempty "executor Supabase URL" "${executor_supabase_url}"
require_nonempty "control-plane Supabase service role key" "${cp_supabase_service_role}"
require_nonempty "executor Supabase service role key" "${executor_supabase_service_role}"
require_not_weak "control-plane Supabase service role key" "${cp_supabase_service_role}"
require_not_weak "executor Supabase service role key" "${executor_supabase_service_role}"
if [[ -n "${cp_supabase_url}" && -n "${executor_supabase_url}" && "${cp_supabase_url}" == "${executor_supabase_url}" ]]; then
  pass "control-plane and executor point at the same Supabase project"
else
  fail "control-plane and executor Supabase URLs do not match"
fi
if [[ -n "${cp_supabase_service_role}" && -n "${executor_supabase_service_role}" && "${cp_supabase_service_role}" == "${executor_supabase_service_role}" ]]; then
  pass "control-plane and executor use matching Supabase service role material"
else
  fail "control-plane and executor Supabase service role keys do not match"
fi

if [[ "${executor_mode}" == "confidential" ]]; then
  pass "executor mode is confidential"
else
  fail "executor mode must be confidential"
fi
require_absent "VAULT_ENCRYPTION_KEY" "$(env_value "${EXECUTOR_ENV_FILE}" VAULT_ENCRYPTION_KEY)"
require_absent "AZURE_ATTESTATION_TOKEN" "$(env_value "${EXECUTOR_ENV_FILE}" AZURE_ATTESTATION_TOKEN)"
require_nonempty "AZURE_KEY_RELEASE_URL" "$(env_value "${EXECUTOR_ENV_FILE}" AZURE_KEY_RELEASE_URL)"
require_nonempty "AZURE_ATTESTATION_PROVIDER_URI" "$(env_value "${EXECUTOR_ENV_FILE}" AZURE_ATTESTATION_PROVIDER_URI)"
require_nonempty "AZURE_ATTESTATION_CLIENT_PATH" "$(env_value "${EXECUTOR_ENV_FILE}" AZURE_ATTESTATION_CLIENT_PATH)"
require_nonempty "AZURE_ATTESTATION_TOKEN_HASH" "$(env_value "${EXECUTOR_ENV_FILE}" AZURE_ATTESTATION_TOKEN_HASH)"
require_nonempty "AZURE_KEY_RELEASE_POLICY_HASH" "$(env_value "${EXECUTOR_ENV_FILE}" AZURE_KEY_RELEASE_POLICY_HASH)"
require_nonempty "AZURE_KEY_ID" "$(env_value "${EXECUTOR_ENV_FILE}" AZURE_KEY_ID)"
require_nonempty "AZURE_KEY_VERSION" "$(env_value "${EXECUTOR_ENV_FILE}" AZURE_KEY_VERSION)"
require_nonempty "VAULTPROOF_EXECUTOR_BUILD_DIGEST" "$(env_value "${EXECUTOR_ENV_FILE}" VAULTPROOF_EXECUTOR_BUILD_DIGEST)"
require_nonempty "AZURE_CONFIDENTIAL_VM_RESOURCE_ID" "$(env_value "${EXECUTOR_ENV_FILE}" AZURE_CONFIDENTIAL_VM_RESOURCE_ID)"
require_nonempty "AZURE_MEASUREMENT_SUMMARY" "$(env_value "${EXECUTOR_ENV_FILE}" AZURE_MEASUREMENT_SUMMARY)"

if [[ "$(env_value "${CONTROL_PLANE_ENV_FILE}" ENTERPRISE_REQUIRE_ORIGIN_LOCK)" == "true" ]]; then
  pass "control-plane requires origin lock"
  if [[ -n "$(env_value "${CONTROL_PLANE_ENV_FILE}" ENTERPRISE_AZURE_FRONT_DOOR_ID)" || -n "$(env_value "${CONTROL_PLANE_ENV_FILE}" ENTERPRISE_ORIGIN_LOCK_SECRET)" ]]; then
    pass "origin lock has Front Door ID or custom secret material"
  else
    fail "origin lock is required but no Front Door ID or custom origin-lock secret is configured"
  fi
else
  fail "ENTERPRISE_REQUIRE_ORIGIN_LOCK must be true for customer production"
fi

if [[ "${REQUIRE_ROTATION_ACK}" == "true" ]]; then
  require_nonempty "ROTATED_SUPABASE_SERVICE_ROLE_AT" "$(env_value "${CONTROL_PLANE_ENV_FILE}" ROTATED_SUPABASE_SERVICE_ROLE_AT)"
  require_nonempty "ROTATED_EXECUTOR_SIGNING_SECRET_AT" "$(env_value "${CONTROL_PLANE_ENV_FILE}" ROTATED_EXECUTOR_SIGNING_SECRET_AT)"
fi

if (( failures > 0 )); then
  echo
  echo "VaultProof enterprise runtime secret verification failed with ${failures} issue(s)." >&2
  exit 1
fi

echo
echo "VaultProof enterprise runtime secret verification passed."
