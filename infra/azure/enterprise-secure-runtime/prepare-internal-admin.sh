#!/usr/bin/env bash
set -euo pipefail

INTERNAL_ADMIN_URL="${INTERNAL_ADMIN_URL:-https://admin.vaultproof.dev}"
ENTERPRISE_URL="${ENTERPRISE_URL:-https://enterprise.vaultproof.dev}"
INTERNAL_ADMIN_HOSTNAME="${VAULTPROOF_INTERNAL_ADMIN_HOSTNAME:-admin.vaultproof.dev}"
INTERNAL_ADMIN_EMAILS="${VAULTPROOF_INTERNAL_ADMIN_EMAILS:-}"
INTERNAL_ADMIN_DOMAINS="${VAULTPROOF_INTERNAL_ADMIN_DOMAINS:-}"
INTERNAL_ADMIN_ACTIONS_ENABLED="${VAULTPROOF_INTERNAL_ADMIN_ACTIONS_ENABLED:-false}"
INTERNAL_ADMIN_APPROVAL_SECRET="${VAULTPROOF_INTERNAL_ADMIN_APPROVAL_SECRET:-}"
RUN_NETWORK_CHECKS="${RUN_NETWORK_CHECKS:-true}"
RUN_SUPABASE_SCHEMA_CHECK="${RUN_SUPABASE_SCHEMA_CHECK:-true}"
SUPABASE_URL_VALUE="${SUPABASE_URL:-}"
SUPABASE_SERVICE_ROLE_KEY_VALUE="${SUPABASE_SERVICE_ROLE_KEY:-}"

warn_count=0
blocker_count=0

warn() {
  warn_count=$((warn_count + 1))
  echo "WARN $*"
}

blocker() {
  blocker_count=$((blocker_count + 1))
  echo "BLOCKER $*"
}

ok() {
  echo "OK $*"
}

require_command() {
  local command_name="$1"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    blocker "missing required command: ${command_name}"
  fi
}

http_status() {
  local url="$1"
  curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 8 --max-time 15 "${url}" || true
}

check_supabase_table() {
  local table_name="$1"
  local status

  status="$(
    curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 8 --max-time 15 \
      -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY_VALUE}" \
      -H "authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY_VALUE}" \
      "${SUPABASE_URL_VALUE%/}/rest/v1/${table_name}?select=id&limit=1" || true
  )"

  if [[ "${status}" == "200" || "${status}" == "206" ]]; then
    ok "Supabase table ready: ${table_name}"
  else
    blocker "Supabase table not readable with service role: ${table_name} (HTTP ${status:-none})"
  fi
}

echo "VaultProof internal admin launch preflight"
echo "  internal admin URL: ${INTERNAL_ADMIN_URL}"
echo "  enterprise URL:     ${ENTERPRISE_URL}"
echo "  hostname:           ${INTERNAL_ADMIN_HOSTNAME}"
echo
echo "This command is read-only. It checks env wiring, expected schema, and safe host separation before exposing admin.vaultproof.dev."
echo

require_command curl

if [[ -z "${INTERNAL_ADMIN_EMAILS}" && -z "${INTERNAL_ADMIN_DOMAINS}" ]]; then
  blocker "set VAULTPROOF_INTERNAL_ADMIN_EMAILS or VAULTPROOF_INTERNAL_ADMIN_DOMAINS before exposing the employee console"
else
  ok "employee allowlist env is present"
fi

if [[ "${INTERNAL_ADMIN_ACTIONS_ENABLED}" == "true" ]]; then
  if [[ -z "${INTERNAL_ADMIN_APPROVAL_SECRET}" ]]; then
    blocker "VAULTPROOF_INTERNAL_ADMIN_ACTIONS_ENABLED=true requires VAULTPROOF_INTERNAL_ADMIN_APPROVAL_SECRET"
  else
    warn "internal admin write actions are enabled; keep this false unless operating approval-gated employee writes live"
  fi
else
  ok "internal admin write actions are disabled by default"
fi

if [[ "${RUN_SUPABASE_SCHEMA_CHECK}" == "true" ]]; then
  if [[ -z "${SUPABASE_URL_VALUE}" || -z "${SUPABASE_SERVICE_ROLE_KEY_VALUE}" ]]; then
    warn "skipping Supabase schema checks because SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set"
  else
    check_supabase_table internal_admin_audit_events
    check_supabase_table internal_admin_support_notes
    check_supabase_table internal_admin_business_status_updates
    check_supabase_table internal_admin_action_requests
    check_supabase_table internal_admin_action_execution_records
    check_supabase_table organization_verifier_models
    check_supabase_table organization_proof_verifications
  fi
else
  ok "Supabase schema checks skipped by RUN_SUPABASE_SCHEMA_CHECK=false"
fi

if [[ "${RUN_NETWORK_CHECKS}" == "true" ]]; then
  enterprise_health_status="$(http_status "${ENTERPRISE_URL%/}/health")"
  if [[ "${enterprise_health_status}" == "200" ]]; then
    ok "enterprise health endpoint is reachable"
  else
    warn "enterprise health endpoint returned HTTP ${enterprise_health_status:-none}"
  fi

  enterprise_internal_status="$(http_status "${ENTERPRISE_URL%/}/api/v1/internal-admin/overview")"
  if [[ "${enterprise_internal_status}" == "404" ]]; then
    ok "internal admin API is not exposed on the customer enterprise host"
  else
    blocker "expected internal admin API to return 404 on enterprise host, got HTTP ${enterprise_internal_status:-none}"
  fi

  internal_page_status="$(http_status "${INTERNAL_ADMIN_URL%/}/")"
  if [[ "${internal_page_status}" == "200" ]]; then
    ok "internal admin page is reachable"
  else
    warn "internal admin page is not reachable yet (HTTP ${internal_page_status:-none}); configure Front Door/DNS before live use"
  fi

  internal_api_status="$(http_status "${INTERNAL_ADMIN_URL%/}/api/v1/internal-admin/overview")"
  if [[ "${internal_api_status}" == "401" || "${internal_api_status}" == "403" ]]; then
    ok "internal admin API requires employee authentication"
  else
    warn "expected internal admin API to require auth with 401/403, got HTTP ${internal_api_status:-none}"
  fi
else
  ok "network checks skipped by RUN_NETWORK_CHECKS=false"
fi

echo
if [[ "${blocker_count}" -gt 0 ]]; then
  echo "Internal admin preflight: blocked (${blocker_count} blocker(s), ${warn_count} warning(s))"
  exit 1
fi

if [[ "${warn_count}" -gt 0 ]]; then
  echo "Internal admin preflight: attention (${warn_count} warning(s))"
else
  echo "Internal admin preflight: ready"
fi
