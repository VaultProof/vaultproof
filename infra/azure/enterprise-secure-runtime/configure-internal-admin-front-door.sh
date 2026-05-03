#!/usr/bin/env bash
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-vaultproof-enterprise}"
FRONT_DOOR_PROFILE="${FRONT_DOOR_PROFILE:-vaultproof-enterprise-fd}"
FRONT_DOOR_ENDPOINT="${FRONT_DOOR_ENDPOINT:-vaultproof-enterprise}"
FRONT_DOOR_ROUTE="${FRONT_DOOR_ROUTE:-default-route}"
INTERNAL_ADMIN_HOSTNAME="${VAULTPROOF_INTERNAL_ADMIN_HOSTNAME:-admin.vaultproof.dev}"
INTERNAL_ADMIN_CUSTOM_DOMAIN_NAME="${INTERNAL_ADMIN_CUSTOM_DOMAIN_NAME:-admin-vaultproof-dev}"
ACTION="${ACTION:-plan}"
CONFIRM_INTERNAL_ADMIN_FRONT_DOOR="${CONFIRM_INTERNAL_ADMIN_FRONT_DOOR:-}"

require_command() {
  local command_name="$1"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Missing required command: ${command_name}" >&2
    exit 1
  fi
}

require_confirmation() {
  local expected="$1"
  local action_description="$2"
  if [[ "${CONFIRM_INTERNAL_ADMIN_FRONT_DOOR}" != "${expected}" ]]; then
    echo "Refusing ${action_description}: set CONFIRM_INTERNAL_ADMIN_FRONT_DOOR=${expected} to mutate Front Door." >&2
    exit 1
  fi
}

json_value() {
  local json_file="$1"
  local expression="$2"
  shift 2
  node -e "
const fs = require('fs');
const payload = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const value = (${expression})(payload);
if (Array.isArray(value)) {
  for (const item of value) {
    if (item !== undefined && item !== null && String(item).length) console.log(String(item));
  }
} else if (value !== undefined && value !== null && String(value).length) {
  console.log(String(value));
}
" "${json_file}" "$@"
}

endpoint_hostname() {
  az afd endpoint show \
    --resource-group "${RESOURCE_GROUP}" \
    --profile-name "${FRONT_DOOR_PROFILE}" \
    --endpoint-name "${FRONT_DOOR_ENDPOINT}" \
    --query hostName \
    -o tsv
}

show_domain_json() {
  az afd custom-domain show \
    --resource-group "${RESOURCE_GROUP}" \
    --profile-name "${FRONT_DOOR_PROFILE}" \
    --custom-domain-name "${INTERNAL_ADMIN_CUSTOM_DOMAIN_NAME}" \
    -o json
}

domain_exists() {
  show_domain_json >/dev/null 2>&1
}

show_route() {
  echo "Front Door route:"
  az afd route show \
    --resource-group "${RESOURCE_GROUP}" \
    --profile-name "${FRONT_DOOR_PROFILE}" \
    --endpoint-name "${FRONT_DOOR_ENDPOINT}" \
    --route-name "${FRONT_DOOR_ROUTE}" \
    --query "{enabledState:enabledState,patternsToMatch:patternsToMatch,supportedProtocols:supportedProtocols,httpsRedirect:httpsRedirect,customDomains:customDomains[].id}" \
    -o table
}

show_domain() {
  if ! domain_exists; then
    echo "Custom domain ${INTERNAL_ADMIN_CUSTOM_DOMAIN_NAME} does not exist yet."
    return
  fi

  echo "Internal admin custom domain:"
  az afd custom-domain show \
    --resource-group "${RESOURCE_GROUP}" \
    --profile-name "${FRONT_DOOR_PROFILE}" \
    --custom-domain-name "${INTERNAL_ADMIN_CUSTOM_DOMAIN_NAME}" \
    --query "{name:name,hostName:hostName,provisioningState:provisioningState,domainValidationState:domainValidationState,certificateType:tlsSettings.certificateType,minimumTlsVersion:tlsSettings.minimumTlsVersion,validationToken:validationProperties.validationToken}" \
    -o table
}

show_dns_instructions() {
  local tmp_file
  local token
  local endpoint_host

  endpoint_host="$(endpoint_hostname)"
  echo
  echo "DNS records expected for ${INTERNAL_ADMIN_HOSTNAME}:"
  echo "  CNAME ${INTERNAL_ADMIN_HOSTNAME} -> ${endpoint_host}"

  if domain_exists; then
    tmp_file="$(mktemp)"
    trap 'rm -f "${tmp_file}"' RETURN
    show_domain_json > "${tmp_file}"
    token="$(json_value "${tmp_file}" "p => p.validationProperties?.validationToken || p.properties?.validationProperties?.validationToken || ''")"
    if [[ -n "${token}" ]]; then
      echo "  TXT   _dnsauth.${INTERNAL_ADMIN_HOSTNAME} -> ${token}"
    else
      echo "  TXT   _dnsauth.${INTERNAL_ADMIN_HOSTNAME} -> <validation token unavailable from current domain state>"
    fi
  else
    echo "  TXT   _dnsauth.${INTERNAL_ADMIN_HOSTNAME} -> <create the Front Door custom domain first to get the token>"
  fi
}

create_domain() {
  require_confirmation "create-admin-custom-domain" "internal admin custom-domain creation"

  if domain_exists; then
    echo "Custom domain ${INTERNAL_ADMIN_CUSTOM_DOMAIN_NAME} already exists."
    return
  fi

  az afd custom-domain create \
    --resource-group "${RESOURCE_GROUP}" \
    --profile-name "${FRONT_DOOR_PROFILE}" \
    --custom-domain-name "${INTERNAL_ADMIN_CUSTOM_DOMAIN_NAME}" \
    --host-name "${INTERNAL_ADMIN_HOSTNAME}" \
    --certificate-type ManagedCertificate \
    --minimum-tls-version TLS12 \
    -o none

  echo "Created Front Door custom domain ${INTERNAL_ADMIN_CUSTOM_DOMAIN_NAME} for ${INTERNAL_ADMIN_HOSTNAME}."
}

associate_route() {
  local tmp_dir
  local domain_id
  local route_json
  local merged_names
  local attached

  require_confirmation "associate-admin-route" "internal admin route association"

  if ! domain_exists; then
    echo "Custom domain ${INTERNAL_ADMIN_CUSTOM_DOMAIN_NAME} does not exist; run ACTION=create-domain first." >&2
    exit 1
  fi

  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "${tmp_dir}"' RETURN
  route_json="${tmp_dir}/route.json"

  domain_id="$(az afd custom-domain show \
    --resource-group "${RESOURCE_GROUP}" \
    --profile-name "${FRONT_DOOR_PROFILE}" \
    --custom-domain-name "${INTERNAL_ADMIN_CUSTOM_DOMAIN_NAME}" \
    --query id \
    -o tsv)"

  az afd route show \
    --resource-group "${RESOURCE_GROUP}" \
    --profile-name "${FRONT_DOOR_PROFILE}" \
    --endpoint-name "${FRONT_DOOR_ENDPOINT}" \
    --route-name "${FRONT_DOOR_ROUTE}" \
    -o json > "${route_json}"

  merged_names="$(json_value "${route_json}" "p => {
    const names = new Set((p.customDomains || [])
      .map((domain) => String(domain.id || '').split('/').filter(Boolean).pop())
      .filter(Boolean));
    names.add(process.argv[2]);
    return [...names];
  }" "${INTERNAL_ADMIN_CUSTOM_DOMAIN_NAME}")"

  if [[ -z "${merged_names}" ]]; then
    echo "Unable to resolve custom domain names for route update." >&2
    exit 1
  fi

  # shellcheck disable=SC2206
  local domain_args=( ${merged_names} )

  az afd route update \
    --resource-group "${RESOURCE_GROUP}" \
    --profile-name "${FRONT_DOOR_PROFILE}" \
    --endpoint-name "${FRONT_DOOR_ENDPOINT}" \
    --route-name "${FRONT_DOOR_ROUTE}" \
    --custom-domains "${domain_args[@]}" \
    -o none

  az afd route show \
    --resource-group "${RESOURCE_GROUP}" \
    --profile-name "${FRONT_DOOR_PROFILE}" \
    --endpoint-name "${FRONT_DOOR_ENDPOINT}" \
    --route-name "${FRONT_DOOR_ROUTE}" \
    -o json > "${route_json}"

  attached="$(json_value "${route_json}" "p => (p.customDomains || []).filter((domain) => String(domain.id || '').toLowerCase() === process.argv[2].toLowerCase()).map((domain) => domain.id)" "${domain_id}")"
  if [[ -z "${attached}" ]]; then
    echo "Route update completed, but ${INTERNAL_ADMIN_CUSTOM_DOMAIN_NAME} is not attached to ${FRONT_DOOR_ROUTE} yet." >&2
    echo "Try again after Azure Front Door finishes propagating the custom domain." >&2
    exit 1
  fi

  echo "Associated ${INTERNAL_ADMIN_HOSTNAME} with Front Door route ${FRONT_DOOR_ROUTE}."
}

require_command az
require_command node

echo "VaultProof internal admin Front Door configuration"
echo "  resource group: ${RESOURCE_GROUP}"
echo "  profile:        ${FRONT_DOOR_PROFILE}"
echo "  endpoint:       ${FRONT_DOOR_ENDPOINT}"
echo "  route:          ${FRONT_DOOR_ROUTE}"
echo "  admin host:     ${INTERNAL_ADMIN_HOSTNAME}"
echo "  domain name:    ${INTERNAL_ADMIN_CUSTOM_DOMAIN_NAME}"
echo

case "${ACTION}" in
  plan)
    show_route
    echo
    show_domain
    show_dns_instructions
    echo
    echo "Create the managed-certificate custom domain:"
    echo "  ACTION=create-domain CONFIRM_INTERNAL_ADMIN_FRONT_DOOR=create-admin-custom-domain npm run configure:enterprise-internal-admin-front-door"
    echo
    echo "After DNS validation succeeds, attach it to the existing route:"
    echo "  ACTION=associate-route CONFIRM_INTERNAL_ADMIN_FRONT_DOOR=associate-admin-route npm run configure:enterprise-internal-admin-front-door"
    ;;
  create-domain)
    create_domain
    show_domain
    show_dns_instructions
    ;;
  associate-route)
    associate_route
    show_route
    ;;
  *)
    echo "Unknown ACTION: ${ACTION}. Use plan, create-domain, or associate-route." >&2
    exit 1
    ;;
esac
