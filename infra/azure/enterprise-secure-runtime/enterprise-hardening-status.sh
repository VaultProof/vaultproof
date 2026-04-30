#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

RESOURCE_GROUP="${RESOURCE_GROUP:-vaultproof-enterprise}"
DEPLOYMENT_NAME="${DEPLOYMENT_NAME:-vp-enterprise-secure-runtime-eastus-hsm}"
APIM_DEPLOYMENT_NAME="${APIM_DEPLOYMENT_NAME:-${DEPLOYMENT_NAME}-apim}"
MONITORING_DEPLOYMENT_NAME="${MONITORING_DEPLOYMENT_NAME:-${DEPLOYMENT_NAME}-monitoring}"
ENTERPRISE_URL="${ENTERPRISE_URL:-https://enterprise.vaultproof.dev}"
ORIGIN_TLS_HOSTNAME="${ORIGIN_TLS_HOSTNAME:-origin.enterprise.vaultproof.dev}"

RUN_PRODUCTION_VERIFIER="${RUN_PRODUCTION_VERIFIER:-true}"
RUN_SECRET_ROTATION_PLAN="${RUN_SECRET_ROTATION_PLAN:-true}"
RUN_PRIVATE_ORIGIN_PLAN="${RUN_PRIVATE_ORIGIN_PLAN:-true}"
RUN_APIM_JWT_PLAN="${RUN_APIM_JWT_PLAN:-true}"
RUN_ORIGIN_TLS_CERT_PLAN="${RUN_ORIGIN_TLS_CERT_PLAN:-true}"
RUN_ORIGIN_TLS_PREP_PLAN="${RUN_ORIGIN_TLS_PREP_PLAN:-true}"
RUN_ORIGIN_TLS_PREFLIGHT="${RUN_ORIGIN_TLS_PREFLIGHT:-true}"
RUN_APIM_PLAN="${RUN_APIM_PLAN:-true}"
RUN_ALTERNATE_ACCESS_PREP_PLAN="${RUN_ALTERNATE_ACCESS_PREP_PLAN:-true}"
RUN_ALTERNATE_ACCESS_CHECK="${RUN_ALTERNATE_ACCESS_CHECK:-true}"
RUN_SSH_PLAN="${RUN_SSH_PLAN:-true}"
RUN_CONTAINER_APPS_INVENTORY="${RUN_CONTAINER_APPS_INVENTORY:-true}"
RUN_LIVE_APP_QA="${RUN_LIVE_APP_QA:-false}"
EXIT_NONZERO_ON_ATTENTION="${EXIT_NONZERO_ON_ATTENTION:-false}"

attention_count=0
declare -a step_names=()
declare -a step_results=()
declare -a step_notes=()

require_command() {
  local command_name="$1"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "FAIL missing required command: ${command_name}" >&2
    exit 1
  fi
}

safe_slug() {
  node -e "
const input = process.argv[1] || 'step';
console.log(input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'step');
" "$1"
}

run_step() {
  local name="$1"
  shift
  local log_file
  local exit_code
  local blocker_count
  local warn_count
  local started_at
  local ended_at
  local duration
  local result
  local note

  log_file="${tmp_dir}/$(safe_slug "${name}").log"
  echo
  echo "== ${name} =="
  started_at="$(date +%s)"
  set +e
  "$@" 2>&1 | tee "${log_file}"
  exit_code="${PIPESTATUS[0]}"
  set -euo pipefail
  ended_at="$(date +%s)"
  duration=$((ended_at - started_at))
  blocker_count="$(grep -c '^BLOCKER ' "${log_file}" || true)"
  warn_count="$(grep -c '^WARN ' "${log_file}" || true)"

  if [[ "${exit_code}" -eq 0 && "${blocker_count}" -eq 0 ]]; then
    result="pass"
    note="${duration}s"
  elif [[ "${exit_code}" -eq 0 ]]; then
    result="attention"
    note="${blocker_count} blocker(s), ${warn_count} warning(s), ${duration}s"
    attention_count=$((attention_count + 1))
  else
    result="failed"
    note="exit ${exit_code}, ${blocker_count} blocker(s), ${warn_count} warning(s), ${duration}s"
    attention_count=$((attention_count + 1))
  fi

  step_names+=("${name}")
  step_results+=("${result}")
  step_notes+=("${note}")
}

run_or_skip() {
  local enabled="$1"
  local name="$2"
  shift 2
  if [[ "${enabled}" == "true" ]]; then
    run_step "${name}" "$@"
  else
    step_names+=("${name}")
    step_results+=("skipped")
    step_notes+=("disabled by RUN_* flag")
  fi
}

require_command bash
require_command node

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

echo "VaultProof enterprise hardening status"
echo "  resource group: ${RESOURCE_GROUP}"
echo "  deployment:     ${DEPLOYMENT_NAME}"
echo "  APIM deployment:${APIM_DEPLOYMENT_NAME}"
echo "  monitoring:     ${MONITORING_DEPLOYMENT_NAME}"
echo "  enterprise URL: ${ENTERPRISE_URL}"
echo "  origin TLS host:${ORIGIN_TLS_HOSTNAME}"
echo
echo "This command is read-only. It summarizes the remaining Azure hardening gates before TLS/APIM/SSH/container cleanup changes."

run_or_skip "${RUN_PRODUCTION_VERIFIER}" \
  "Production verifier" \
  env \
    RESOURCE_GROUP="${RESOURCE_GROUP}" \
    DEPLOYMENT_NAME="${DEPLOYMENT_NAME}" \
    MONITORING_DEPLOYMENT_NAME="${MONITORING_DEPLOYMENT_NAME}" \
    APIM_DEPLOYMENT_NAME="${APIM_DEPLOYMENT_NAME}" \
    ENTERPRISE_URL="${ENTERPRISE_URL}" \
    EXPECTED_MONITORING_DEPLOYED="${EXPECTED_MONITORING_DEPLOYED:-true}" \
    EXPECTED_APIM_DEPLOYED="${EXPECTED_APIM_DEPLOYED:-true}" \
    ORIGIN_TLS_HOSTNAME="${PRODUCTION_VERIFIER_ORIGIN_TLS_HOSTNAME:-}" \
    bash "${SCRIPT_DIR}/verify-production-runtime.sh"

run_or_skip "${RUN_SECRET_ROTATION_PLAN}" \
  "Secret rotation preparation plan" \
  env \
    ACTION=plan \
    CONTROL_PLANE_ENV_FILE="${CONTROL_PLANE_ENV_FILE:-/etc/vaultproof/enterprise-control-plane.env}" \
    EXECUTOR_ENV_FILE="${EXECUTOR_ENV_FILE:-/etc/vaultproof/enterprise-secure-executor.env}" \
    bash "${SCRIPT_DIR}/prepare-secret-rotation.sh"

run_or_skip "${RUN_PRIVATE_ORIGIN_PLAN}" \
  "Private origin preparation plan" \
  env \
    RESOURCE_GROUP="${RESOURCE_GROUP}" \
    DEPLOYMENT_NAME="${DEPLOYMENT_NAME}" \
    APIM_DEPLOYMENT_NAME="${APIM_DEPLOYMENT_NAME}" \
    FRONT_DOOR_PROFILE="${FRONT_DOOR_PROFILE:-vaultproof-enterprise-fd}" \
    FRONT_DOOR_ORIGIN_GROUP="${FRONT_DOOR_ORIGIN_GROUP:-default-origin-group}" \
    ACTION=plan \
    bash "${SCRIPT_DIR}/prepare-private-origin.sh"

run_or_skip "${RUN_APIM_JWT_PLAN}" \
  "APIM JWT validation preparation plan" \
  env \
    RESOURCE_GROUP="${RESOURCE_GROUP}" \
    APIM_DEPLOYMENT_NAME="${APIM_DEPLOYMENT_NAME}" \
    JWT_PROVIDER="${JWT_PROVIDER:-supabase}" \
    SUPABASE_URL="${SUPABASE_URL:-}" \
    ENTRA_TENANT_ID="${ENTRA_TENANT_ID:-}" \
    JWT_OPENID_CONFIG_URL="${JWT_OPENID_CONFIG_URL:-}" \
    JWT_ISSUER="${JWT_ISSUER:-}" \
    JWT_AUDIENCES="${JWT_AUDIENCES:-}" \
    VALIDATE_JWT_METADATA="${VALIDATE_JWT_METADATA:-false}" \
    ACTION=plan \
    bash "${SCRIPT_DIR}/prepare-apim-jwt-validation.sh"

run_or_skip "${RUN_ORIGIN_TLS_CERT_PLAN}" \
  "Origin TLS certificate plan" \
  env \
    RESOURCE_GROUP="${RESOURCE_GROUP}" \
    DEPLOYMENT_NAME="${DEPLOYMENT_NAME}" \
    ENTERPRISE_URL="${ENTERPRISE_URL}" \
    ORIGIN_TLS_HOSTNAME="${ORIGIN_TLS_HOSTNAME}" \
    ACTION=plan \
    bash "${SCRIPT_DIR}/prepare-origin-tls-certificate.sh"

run_or_skip "${RUN_ORIGIN_TLS_PREP_PLAN}" \
  "Origin TLS preparation plan" \
  env \
    RESOURCE_GROUP="${RESOURCE_GROUP}" \
    DEPLOYMENT_NAME="${DEPLOYMENT_NAME}" \
    APIM_DEPLOYMENT_NAME="${APIM_DEPLOYMENT_NAME}" \
    ENTERPRISE_URL="${ENTERPRISE_URL}" \
    ORIGIN_TLS_HOSTNAME="${ORIGIN_TLS_HOSTNAME}" \
    ACTION=plan \
    bash "${SCRIPT_DIR}/prepare-origin-tls-cutover.sh"

run_or_skip "${RUN_ORIGIN_TLS_PREFLIGHT}" \
  "Origin TLS readiness preflight" \
  env \
    RESOURCE_GROUP="${RESOURCE_GROUP}" \
    DEPLOYMENT_NAME="${DEPLOYMENT_NAME}" \
    ENTERPRISE_URL="${ENTERPRISE_URL}" \
    ORIGIN_TLS_HOSTNAME="${ORIGIN_TLS_HOSTNAME}" \
    CUTOVER_READY_REQUIRED=false \
    bash "${SCRIPT_DIR}/verify-origin-tls-readiness.sh"

run_or_skip "${RUN_APIM_PLAN}" \
  "APIM cutover plan" \
  env \
    RESOURCE_GROUP="${RESOURCE_GROUP}" \
    DEPLOYMENT_NAME="${DEPLOYMENT_NAME}" \
    APIM_DEPLOYMENT_NAME="${APIM_DEPLOYMENT_NAME}" \
    ENTERPRISE_URL="${ENTERPRISE_URL}" \
    ACTION=plan \
    bash "${SCRIPT_DIR}/cutover-front-door-apim.sh"

run_or_skip "${RUN_ALTERNATE_ACCESS_PREP_PLAN}" \
  "Alternate access preparation plan" \
  env \
    RESOURCE_GROUP="${RESOURCE_GROUP}" \
    DEPLOYMENT_NAME="${DEPLOYMENT_NAME}" \
    ACTION=plan \
    bash "${SCRIPT_DIR}/prepare-alternate-access.sh"

run_or_skip "${RUN_ALTERNATE_ACCESS_CHECK}" \
  "Alternate access readiness" \
  env \
    RESOURCE_GROUP="${RESOURCE_GROUP}" \
    DEPLOYMENT_NAME="${DEPLOYMENT_NAME}" \
    REQUIRE_ALTERNATE_ACCESS_READY=false \
    bash "${SCRIPT_DIR}/verify-alternate-access-readiness.sh"

run_or_skip "${RUN_SSH_PLAN}" \
  "SSH bootstrap hardening plan" \
  env \
    RESOURCE_GROUP="${RESOURCE_GROUP}" \
    DEPLOYMENT_NAME="${DEPLOYMENT_NAME}" \
    ENTERPRISE_URL="${ENTERPRISE_URL}" \
    ACTION=plan \
    bash "${SCRIPT_DIR}/harden-ssh-bootstrap.sh"

run_or_skip "${RUN_CONTAINER_APPS_INVENTORY}" \
  "Container Apps prototype inventory" \
  env \
    RESOURCE_GROUP="${RESOURCE_GROUP}" \
    ENTERPRISE_URL="${ENTERPRISE_URL}" \
    ACTION=inventory \
    bash "${SCRIPT_DIR}/cleanup-container-apps-prototype.sh"

run_or_skip "${RUN_LIVE_APP_QA}" \
  "Live enterprise app QA" \
  env ENTERPRISE_URL="${ENTERPRISE_URL}" node "${REPO_ROOT}/scripts/enterprise-live-app-qa.mjs"

echo
echo "Hardening status summary:"
for i in "${!step_names[@]}"; do
  printf '  %-36s %-9s %s\n' "${step_names[$i]}" "${step_results[$i]}" "${step_notes[$i]}"
done

if [[ "${attention_count}" -eq 0 ]]; then
  echo
  echo "All enabled hardening checks passed or were plan-only."
else
  echo
  echo "${attention_count} enabled hardening step(s) need attention before live cutover/cleanup."
  echo "Set EXIT_NONZERO_ON_ATTENTION=true if CI should fail on attention items."
  if [[ "${EXIT_NONZERO_ON_ATTENTION}" == "true" ]]; then
    exit 1
  fi
fi
