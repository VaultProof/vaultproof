#!/usr/bin/env bash
set -euo pipefail

ACTION="${ACTION:-plan}"
CLIENT_CERT_FILE="${CLIENT_CERT_FILE:-}"
CLIENT_CLASS="${CLIENT_CLASS:-gateway}"
CUSTOMER_GATEWAY="${CUSTOMER_GATEWAY:-customer-apim}"
SUBJECT_FRAGMENT="${SUBJECT_FRAGMENT:-}"
PROJECT_ID="${PROJECT_ID:-<project-id>}"

require_command() {
  local command_name="$1"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Missing required command: ${command_name}" >&2
    exit 1
  fi
}

normalize_hex() {
  tr '[:upper:]' '[:lower:]' | tr -cd 'a-f0-9'
}

json_string() {
  node -e "console.log(JSON.stringify(process.argv[1] || ''))" "$1"
}

cert_fingerprint() {
  local algorithm="$1"
  openssl x509 -in "${CLIENT_CERT_FILE}" -noout -fingerprint "-${algorithm}" \
    | awk -F= '{print $2}' \
    | normalize_hex
}

cert_field() {
  shift 0
  openssl x509 -in "${CLIENT_CERT_FILE}" "$@"
}

derive_subject_fragment() {
  local raw_subject="$1"
  local derived_cn

  if [[ -n "${SUBJECT_FRAGMENT}" ]]; then
    printf '%s\n' "${SUBJECT_FRAGMENT}" | tr '[:upper:]' '[:lower:]'
    return
  fi

  derived_cn="$(
    node -e "
const subject = process.argv[1] || '';
const stripped = subject.replace(/^subject=/, '');
const parts = stripped.split(/,(?=(?:[^\\\\]|\\\\.)*(?:,|$))/);
const cn = parts.find((part) => part.toLowerCase().startsWith('cn='));
console.log((cn || stripped).trim().toLowerCase());
" "${raw_subject}"
  )"

  printf '%s\n' "${derived_cn}"
}

print_policy_snippet() {
  local sha1_thumbprint="$1"
  local subject_fragment="$2"

  node -e "
const payload = {
  allowed_client_classes: [process.argv[1]],
  allowed_customer_gateways: [process.argv[2]],
  allowed_client_certificate_thumbprints: process.argv[3] ? [process.argv[3]] : ['<normalized-sha1-thumbprint>'],
  allowed_client_certificate_subjects: process.argv[4] ? [process.argv[4]] : ['<subject-fragment>'],
};
console.log(JSON.stringify(payload, null, 2));
" "${CLIENT_CLASS}" "${CUSTOMER_GATEWAY}" "${sha1_thumbprint}" "${subject_fragment}"
}

print_apim_policy_contract() {
  cat <<'EOF'

APIM/customer gateway header contract:
  x-vaultproof-client-class: gateway
  x-vaultproof-customer-gateway: customer-apim
  x-vaultproof-client-cert-thumbprint: APIM/client gateway certificate thumbprint
  x-vaultproof-client-cert-subject: APIM/client gateway certificate subject

APIM policy shape:
  <set-header name="x-vaultproof-client-class" exists-action="override">
    <value>gateway</value>
  </set-header>
  <set-header name="x-vaultproof-customer-gateway" exists-action="override">
    <value>customer-apim</value>
  </set-header>
  <set-header name="x-vaultproof-client-cert-thumbprint" exists-action="override">
    <value>@(context.Request.Certificate == null ? "" : context.Request.Certificate.Thumbprint)</value>
  </set-header>
  <set-header name="x-vaultproof-client-cert-subject" exists-action="override">
    <value>@(context.Request.Certificate == null ? "" : context.Request.Certificate.Subject)</value>
  </set-header>

Gateway safety rules:
  1. Enable client-certificate/request-certificate support on the APIM/custom gateway hostname that terminates mTLS.
  2. Validate the customer certificate at the gateway before forwarding trusted VaultProof headers.
  3. Strip inbound x-vaultproof-client-cert-* headers from public clients before setting gateway-derived values.
  4. Keep VaultProof org/project authorization and caller-lock enforcement enabled in the control plane.
EOF
}

print_test_hints() {
  local sha1_thumbprint="$1"
  local subject_fragment="$2"

  cat <<EOF

Safe test order:
  1. Add the policy snippet to the test project caller_lock_policy.
  2. Send a dry-run execution request through the trusted gateway with:
       x-vaultproof-client-class: ${CLIENT_CLASS}
       x-vaultproof-customer-gateway: ${CUSTOMER_GATEWAY}
       x-vaultproof-client-cert-thumbprint: ${sha1_thumbprint:-<normalized-sha1-thumbprint>}
       x-vaultproof-client-cert-subject: ${subject_fragment:-<subject-fragment>}
       dry_run: true
  3. Confirm the request reaches the executor and audit metadata records caller-lock context.
  4. Repeat without the cert headers and confirm the control plane denies before secure execution dispatch.

Example project patch target:
  project_id: ${PROJECT_ID}
  caller_lock_policy += the JSON snippet above
EOF
}

show_cert_plan() {
  local sha1_thumbprint
  local sha256_thumbprint
  local subject
  local issuer
  local serial
  local dates
  local subject_fragment

  if [[ ! -f "${CLIENT_CERT_FILE}" ]]; then
    echo "BLOCKER CLIENT_CERT_FILE does not exist: ${CLIENT_CERT_FILE}"
    return
  fi

  require_command openssl
  sha1_thumbprint="$(cert_fingerprint sha1)"
  sha256_thumbprint="$(cert_fingerprint sha256)"
  subject="$(cert_field -noout -subject -nameopt RFC2253)"
  issuer="$(cert_field -noout -issuer -nameopt RFC2253)"
  serial="$(cert_field -noout -serial)"
  dates="$(cert_field -noout -dates | tr '\n' ';' | sed 's/;$//')"
  subject_fragment="$(derive_subject_fragment "${subject}")"

  echo "Client certificate evidence:"
  echo "  file:                 ${CLIENT_CERT_FILE}"
  echo "  subject:              ${subject#subject=}"
  echo "  issuer:               ${issuer#issuer=}"
  echo "  ${serial}"
  echo "  ${dates}"
  echo "  sha1 thumbprint:      ${sha1_thumbprint}"
  echo "  sha256 thumbprint:    ${sha256_thumbprint}"
  echo "  subject fragment:     ${subject_fragment}"
  echo
  echo "Control-plane caller_lock_policy snippet:"
  print_policy_snippet "${sha1_thumbprint}" "${subject_fragment}"
  print_apim_policy_contract
  print_test_hints "${sha1_thumbprint}" "${subject_fragment}"
}

show_empty_plan() {
  echo "WARN CLIENT_CERT_FILE was not provided, so this plan cannot compute a certificate thumbprint yet."
  echo "WARN Provide CLIENT_CERT_FILE=/path/to/client-cert.pem to generate the exact caller-lock policy snippet."
  echo
  echo "Control-plane caller_lock_policy snippet template:"
  print_policy_snippet "" ""
  print_apim_policy_contract
  print_test_hints "" ""
}

show_plan() {
  echo "VaultProof mTLS caller-lock preparation"
  echo "  action:               ${ACTION}"
  echo "  project id:           ${PROJECT_ID}"
  echo "  client class:         ${CLIENT_CLASS}"
  echo "  customer gateway:     ${CUSTOMER_GATEWAY}"
  echo "  client cert file:     ${CLIENT_CERT_FILE:-not set}"
  echo
  echo "This command is read-only. It does not change APIM, Front Door, Supabase, or project policy."
  echo

  if [[ -n "${CLIENT_CERT_FILE}" ]]; then
    show_cert_plan
  else
    show_empty_plan
  fi
}

case "${ACTION}" in
  plan)
    require_command node
    show_plan
    ;;
  *)
    echo "Unknown ACTION: ${ACTION}. Use plan." >&2
    exit 1
    ;;
esac
