#!/usr/bin/env bash
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-vaultproof-enterprise}"
APIM_DEPLOYMENT_NAME="${APIM_DEPLOYMENT_NAME:-vp-enterprise-secure-runtime-eastus-hsm-apim}"
ENTERPRISE_URL="${ENTERPRISE_URL:-https://enterprise.vaultproof.dev}"
JWT_PROVIDER="${JWT_PROVIDER:-supabase}"
SUPABASE_URL="${SUPABASE_URL:-}"
ENTRA_TENANT_ID="${ENTRA_TENANT_ID:-}"
JWT_OPENID_CONFIG_URL="${JWT_OPENID_CONFIG_URL:-}"
JWT_ISSUER="${JWT_ISSUER:-}"
JWT_AUDIENCES="${JWT_AUDIENCES:-}"
VALIDATE_JWT_METADATA="${VALIDATE_JWT_METADATA:-false}"
DISCOVER_SUPABASE_URL_FROM_ENTERPRISE="${DISCOVER_SUPABASE_URL_FROM_ENTERPRISE:-true}"
ACTION="${ACTION:-plan}"

require_command() {
  local command_name="$1"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Missing required command: ${command_name}" >&2
    exit 1
  fi
}

deployment_parameter() {
  local parameter_name="$1"
  az deployment group show \
    --resource-group "${RESOURCE_GROUP}" \
    --name "${APIM_DEPLOYMENT_NAME}" \
    --query "properties.parameters.${parameter_name}.value" \
    -o json 2>/dev/null | node -e "
let raw = '';
process.stdin.on('data', (chunk) => raw += chunk);
process.stdin.on('end', () => {
  raw = raw.trim();
  if (!raw || raw === 'null') return;
  const value = JSON.parse(raw);
  if (Array.isArray(value)) {
    console.log(JSON.stringify(value));
  } else {
    console.log(String(value));
  }
});
"
}

normalize_url() {
  node -e "
const value = process.argv[1] || '';
if (!value) process.exit(0);
console.log(value.replace(/\/+$/, ''));
" "$1"
}

discover_supabase_url_from_enterprise() {
  if [[ "${DISCOVER_SUPABASE_URL_FROM_ENTERPRISE}" != "true" ]]; then
    return
  fi

  node -e "
const enterpriseUrl = (process.argv[1] || '').replace(/\\/+$/, '');
if (!enterpriseUrl) process.exit(0);
fetch(enterpriseUrl + '/app/enterprise-login.js')
  .then(async (response) => {
    if (!response.ok) process.exit(0);
    const text = await response.text();
    const match = text.match(/const SUPABASE_URL = '([^']+)'/);
    if (match?.[1]) console.log(match[1].replace(/\\/+$/, ''));
  })
  .catch(() => process.exit(0));
" "${ENTERPRISE_URL}"
}

derive_target() {
  local normalized_supabase_url
  local discovered_supabase_url
  normalized_supabase_url="$(normalize_url "${SUPABASE_URL}")"
  discovered_supabase_url=""

  if [[ -z "${normalized_supabase_url}" && "${JWT_PROVIDER}" == "supabase" && -z "${JWT_OPENID_CONFIG_URL}" ]]; then
    discovered_supabase_url="$(discover_supabase_url_from_enterprise)"
    normalized_supabase_url="$(normalize_url "${discovered_supabase_url}")"
  fi

  target_supabase_url_source=""
  if [[ -n "${SUPABASE_URL}" ]]; then
    target_supabase_url_source="SUPABASE_URL"
  elif [[ -n "${discovered_supabase_url}" ]]; then
    target_supabase_url_source="${ENTERPRISE_URL}/app/enterprise-login.js"
  fi

  case "${JWT_PROVIDER}" in
    supabase)
      if [[ -n "${JWT_OPENID_CONFIG_URL}" ]]; then
        target_openid_config_url="${JWT_OPENID_CONFIG_URL}"
      elif [[ -n "${normalized_supabase_url}" ]]; then
        target_openid_config_url="${normalized_supabase_url}/auth/v1/.well-known/openid-configuration"
      else
        target_openid_config_url=""
      fi
      target_issuer="${JWT_ISSUER:-${normalized_supabase_url:+${normalized_supabase_url}/auth/v1}}"
      target_audiences="${JWT_AUDIENCES:-[\"authenticated\"]}"
      ;;
    entra)
      if [[ -n "${JWT_OPENID_CONFIG_URL}" ]]; then
        target_openid_config_url="${JWT_OPENID_CONFIG_URL}"
      elif [[ -n "${ENTRA_TENANT_ID}" ]]; then
        target_openid_config_url="https://login.microsoftonline.com/${ENTRA_TENANT_ID}/v2.0/.well-known/openid-configuration"
      else
        target_openid_config_url=""
      fi
      target_issuer="${JWT_ISSUER}"
      target_audiences="${JWT_AUDIENCES}"
      ;;
    custom)
      target_openid_config_url="${JWT_OPENID_CONFIG_URL}"
      target_issuer="${JWT_ISSUER}"
      target_audiences="${JWT_AUDIENCES}"
      ;;
    *)
      echo "Unknown JWT_PROVIDER: ${JWT_PROVIDER}. Use supabase, entra, or custom." >&2
      exit 1
      ;;
  esac
}

validate_metadata() {
  if [[ "${VALIDATE_JWT_METADATA}" != "true" ]]; then
    echo "  metadata validation: skipped (set VALIDATE_JWT_METADATA=true to fetch OpenID metadata)"
    return
  fi

  if [[ -z "${target_openid_config_url}" ]]; then
    echo "BLOCKER cannot validate metadata because no OpenID configuration URL is selected."
    return
  fi

  node -e "
const url = process.argv[1];
fetch(url).then(async (response) => {
  if (!response.ok) {
    console.log('BLOCKER OpenID metadata returned HTTP ' + response.status + ': ' + url);
    process.exit(0);
  }
  const payload = await response.json();
  console.log('  metadata issuer:    ' + (payload.issuer || 'missing'));
  console.log('  metadata jwks_uri:  ' + (payload.jwks_uri || 'missing'));
  if (!payload.issuer || !payload.jwks_uri) {
    console.log('BLOCKER OpenID metadata must include issuer and jwks_uri.');
  }
}).catch((error) => {
  console.log('BLOCKER failed to fetch OpenID metadata: ' + error.message);
});
" "${target_openid_config_url}"
}

show_current_state() {
  current_enabled="$(deployment_parameter apiManagementJwtValidationEnabled)"
  current_openid="$(deployment_parameter apiManagementJwtOpenIdConfigUrl)"
  current_issuer="$(deployment_parameter apiManagementJwtIssuer)"
  current_audiences="$(deployment_parameter apiManagementJwtAudiences)"

  echo "Current APIM deployment JWT parameters:"
  echo "  enabled:             ${current_enabled:-unknown}"
  echo "  openid config:       ${current_openid:-empty}"
  echo "  issuer:              ${current_issuer:-empty}"
  echo "  audiences:           ${current_audiences:-[]}"
  if [[ "${current_enabled}" != "true" ]]; then
    echo "WARN APIM JWT validation is currently disabled."
  fi
}

show_target() {
  echo "Target JWT validation plan:"
  echo "  provider:            ${JWT_PROVIDER}"
  echo "  openid config:       ${target_openid_config_url:-missing}"
  echo "  issuer:              ${target_issuer:-metadata/default}"
  echo "  audiences:           ${target_audiences:-missing}"
  if [[ -n "${target_supabase_url_source}" ]]; then
    echo "  Supabase URL source: ${target_supabase_url_source}"
  fi

  if [[ -z "${target_openid_config_url}" ]]; then
    echo "BLOCKER select an OpenID configuration URL before enabling APIM JWT validation, or set SUPABASE_URL / JWT_OPENID_CONFIG_URL / ENTRA_TENANT_ID."
  fi
  if [[ -z "${target_audiences}" || "${target_audiences}" == "[]" ]]; then
    echo "BLOCKER select at least one API audience before enabling APIM JWT validation."
  fi
  if [[ "${JWT_PROVIDER}" == "supabase" && "${target_audiences}" == "[\"authenticated\"]" ]]; then
    echo "WARN Supabase default audience 'authenticated' is broad; use only if this APIM route should accept standard Supabase user access tokens."
  fi
  if [[ "${JWT_PROVIDER}" == "entra" && -z "${target_issuer}" ]]; then
    echo "WARN Entra issuer is not pinned; APIM will rely on OpenID metadata issuer unless apiManagementJwtIssuer is set."
  fi
}

show_commands() {
  cat <<EOF

Suggested deployment parameters after the issuer/audience decision is final:

  apiManagementJwtValidationEnabled=true
  apiManagementJwtOpenIdConfigUrl='${target_openid_config_url:-<openid-config-url>}'
  apiManagementJwtAudiences='${target_audiences:-["<api-audience>"]}'
EOF

  if [[ -n "${target_issuer}" ]]; then
    echo "  apiManagementJwtIssuer='${target_issuer}'"
  else
    echo "  apiManagementJwtIssuer='<optional-issuer-pin>'"
  fi

  cat <<'EOF'

Validation order:
  1. Confirm the customer-facing token issuer path: Supabase session JWT or direct Entra access token.
  2. Confirm the API audience. Avoid enabling APIM JWT validation with an unknown or overly broad audience.
  3. Redeploy APIM with the parameters above.
  4. Call APIM /health and /readiness with a valid bearer token.
  5. Verify that requests without a bearer token fail at APIM with 401.
  6. Keep VaultProof org/project authorization enabled in the control plane; APIM JWT validation is an outer gate, not a replacement.
EOF
}

show_plan() {
  derive_target

  echo "VaultProof APIM JWT validation preparation"
  echo "  resource group:      ${RESOURCE_GROUP}"
  echo "  APIM deployment:     ${APIM_DEPLOYMENT_NAME}"
  echo "  enterprise URL:      ${ENTERPRISE_URL}"
  echo
  echo "This command is read-only. It does not redeploy APIM or change policy."
  echo
  show_current_state
  echo
  show_target
  validate_metadata
  show_commands
}

case "${ACTION}" in
  plan)
    require_command az
    require_command node
    show_plan
    ;;
  *)
    echo "Unknown ACTION: ${ACTION}. Use plan." >&2
    exit 1
    ;;
esac
