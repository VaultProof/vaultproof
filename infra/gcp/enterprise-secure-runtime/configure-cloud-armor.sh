#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-vaultproof-prod}"
DOMAIN="${DOMAIN:-enterprise.vaultproof.dev}"
BACKEND_SERVICE="${BACKEND_SERVICE:-vaultproof-enterprise-backend}"
SECURITY_POLICY="${SECURITY_POLICY:-vaultproof-enterprise-armor}"
CLOUD_ARMOR_PREVIEW="${CLOUD_ARMOR_PREVIEW:-false}"

SENSITIVE_PATH_PRIORITY="${SENSITIVE_PATH_PRIORITY:-1000}"
EXECUTE_RATE_PRIORITY="${EXECUTE_RATE_PRIORITY:-1100}"
API_RATE_PRIORITY="${API_RATE_PRIORITY:-1200}"
EDGE_RATE_PRIORITY="${EDGE_RATE_PRIORITY:-1300}"

EXECUTE_RATE_LIMIT_PER_MINUTE="${EXECUTE_RATE_LIMIT_PER_MINUTE:-240}"
API_RATE_LIMIT_PER_MINUTE="${API_RATE_LIMIT_PER_MINUTE:-900}"
EDGE_RATE_LIMIT_PER_MINUTE="${EDGE_RATE_LIMIT_PER_MINUTE:-2400}"

SENSITIVE_PATH_EXPR="${SENSITIVE_PATH_EXPR:-request.path.matches('^/(\\.env|\\.git|\\.svn|wp-admin|wp-login\\.php|phpmyadmin|server-status|actuator|debug|config)(/|$).*') || request.path.matches('^/(id_rsa|id_dsa|id_ed25519|composer\\.json|package-lock\\.json|yarn\\.lock)$')}"
EXECUTE_PATH_EXPR="${EXECUTE_PATH_EXPR:-request.path.matches('^/api/v1/enterprise/projects/[^/]+/providers/[^/]+/execute$')}"
API_PATH_EXPR="${API_PATH_EXPR:-request.path.matches('^/api/v1/enterprise/.*')}"
EDGE_PATH_EXPR="${EDGE_PATH_EXPR:-request.path.matches('^/.*')}"

preview_args_for_command() {
  local command="$1"
  if [[ "${CLOUD_ARMOR_PREVIEW}" == "true" ]]; then
    printf '%s\n' "--preview"
  elif [[ "${command}" == "update" ]]; then
    printf '%s\n' "--no-preview"
  fi
}

ensure_policy() {
  if ! gcloud compute security-policies describe "${SECURITY_POLICY}" \
      --global \
      --project="${PROJECT_ID}" >/dev/null 2>&1; then
    gcloud compute security-policies create "${SECURITY_POLICY}" \
      --global \
      --type=CLOUD_ARMOR \
      --description="VaultProof Enterprise edge WAF and rate limits for ${DOMAIN}" \
      --project="${PROJECT_ID}"
  fi
}

rule_exists() {
  local priority="$1"
  gcloud compute security-policies rules describe "${priority}" \
    --security-policy="${SECURITY_POLICY}" \
    --project="${PROJECT_ID}" >/dev/null 2>&1
}

upsert_deny_rule() {
  local priority="$1"
  local expression="$2"
  local description="$3"
  local command="create"
  if rule_exists "${priority}"; then
    command="update"
  fi
  local preview_args=()
  while IFS= read -r arg; do
    [[ -n "${arg}" ]] && preview_args+=("${arg}")
  done < <(preview_args_for_command "${command}")

  gcloud compute security-policies rules "${command}" "${priority}" \
    --security-policy="${SECURITY_POLICY}" \
    --action=deny-403 \
    --expression="${expression}" \
    --description="${description}" \
    "${preview_args[@]}" \
    --project="${PROJECT_ID}"
}

upsert_throttle_rule() {
  local priority="$1"
  local expression="$2"
  local threshold="$3"
  local description="$4"
  local command="create"
  if rule_exists "${priority}"; then
    command="update"
  fi
  local preview_args=()
  while IFS= read -r arg; do
    [[ -n "${arg}" ]] && preview_args+=("${arg}")
  done < <(preview_args_for_command "${command}")

  gcloud compute security-policies rules "${command}" "${priority}" \
    --security-policy="${SECURITY_POLICY}" \
    --action=throttle \
    --expression="${expression}" \
    --rate-limit-threshold-count="${threshold}" \
    --rate-limit-threshold-interval-sec=60 \
    --conform-action=allow \
    --exceed-action=deny-429 \
    --enforce-on-key=ip \
    --description="${description}" \
    "${preview_args[@]}" \
    --project="${PROJECT_ID}"
}

ensure_policy

upsert_deny_rule \
  "${SENSITIVE_PATH_PRIORITY}" \
  "${SENSITIVE_PATH_EXPR}" \
  "Block common secret/config/admin scanner paths before the request reaches the VM."

upsert_throttle_rule \
  "${EXECUTE_RATE_PRIORITY}" \
  "${EXECUTE_PATH_EXPR}" \
  "${EXECUTE_RATE_LIMIT_PER_MINUTE}" \
  "Per-IP throttle for the enterprise secure execute product path."

upsert_throttle_rule \
  "${API_RATE_PRIORITY}" \
  "${API_PATH_EXPR}" \
  "${API_RATE_LIMIT_PER_MINUTE}" \
  "Per-IP throttle for enterprise API routes."

upsert_throttle_rule \
  "${EDGE_RATE_PRIORITY}" \
  "${EDGE_PATH_EXPR}" \
  "${EDGE_RATE_LIMIT_PER_MINUTE}" \
  "Per-IP coarse throttle for the enterprise public edge."

gcloud compute backend-services update "${BACKEND_SERVICE}" \
  --global \
  --security-policy="${SECURITY_POLICY}" \
  --project="${PROJECT_ID}"

echo "GCP Cloud Armor configured."
echo "  domain=${DOMAIN}"
echo "  backend_service=${BACKEND_SERVICE}"
echo "  security_policy=${SECURITY_POLICY}"
echo "  preview=${CLOUD_ARMOR_PREVIEW}"
echo "  deny_sensitive_paths=${SENSITIVE_PATH_PRIORITY}"
echo "  execute_rate_limit_per_minute=${EXECUTE_RATE_LIMIT_PER_MINUTE}"
echo "  api_rate_limit_per_minute=${API_RATE_LIMIT_PER_MINUTE}"
echo "  edge_rate_limit_per_minute=${EDGE_RATE_LIMIT_PER_MINUTE}"
