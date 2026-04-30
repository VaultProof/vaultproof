#!/usr/bin/env bash
set -euo pipefail

ACTION="${ACTION:-plan}"
OUTPUT_DIR="${OUTPUT_DIR:-/tmp/vaultproof-secret-rotation-$(date -u +%Y%m%dT%H%M%SZ)}"
ROTATION_TIMESTAMP="${ROTATION_TIMESTAMP:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
SIGNING_KEY_ID="${ENTERPRISE_EXECUTOR_SIGNING_KEY_ID:-enterprise-azure-v$(date -u +%Y%m%d%H%M%S)}"
SIGNING_SECRET_BYTES="${SIGNING_SECRET_BYTES:-48}"
CONTROL_PLANE_ENV_FILE="${CONTROL_PLANE_ENV_FILE:-/etc/vaultproof/enterprise-control-plane.env}"
EXECUTOR_ENV_FILE="${EXECUTOR_ENV_FILE:-/etc/vaultproof/enterprise-secure-executor.env}"

require_command() {
  local command_name="$1"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Missing required command: ${command_name}" >&2
    exit 1
  fi
}

generate_secret() {
  openssl rand -base64 "${SIGNING_SECRET_BYTES}" | tr '+/' '-_' | tr -d '=\n'
  echo
}

show_plan() {
  cat <<EOF
VaultProof enterprise secret rotation preparation
  control-plane env: ${CONTROL_PLANE_ENV_FILE}
  executor env:      ${EXECUTOR_ENV_FILE}

This command is read-only by default. It does not read, print, or mutate live
secrets. Use it to prepare the remaining customer-handoff rotation work.

Recommended order:
  1. Generate fresh executor signing material:
     ACTION=generate-signing-material npm run prepare:enterprise-secret-rotation

  2. Rotate the Supabase service-role key in Supabase, then keep the new value
     only in your secure operator shell or password manager.

  3. Install the executor env first so the Confidential VM accepts the new
     signing key. For zero downtime, temporarily include old and new accepted
     signing keys in ENTERPRISE_EXECUTOR_ACCEPTED_SIGNING_KEYS.

  4. Install the control-plane env with ENTERPRISE_EXECUTOR_SIGNING_KEY_ID and
     ENTERPRISE_EXECUTOR_SIGNING_SECRET set to the new material.

  5. Add rotation evidence markers to the control-plane env:
     ROTATED_SUPABASE_SERVICE_ROLE_AT=<UTC timestamp>
     ROTATED_EXECUTOR_SIGNING_SECRET_AT=<UTC timestamp>

  6. Restart services and verify:
     sudo systemctl restart vaultproof-executor vaultproof-control-plane
     REQUIRE_ROTATION_ACK=true npm run verify:enterprise-secrets
     curl -sS https://enterprise.vaultproof.dev/readiness

Important:
  - Do not paste current secrets into chat or commit generated rotation files.
  - Keep the generated files chmod 600 and move final values into your password
    manager after installation.
EOF
}

generate_signing_material() {
  require_command openssl

  local signing_secret
  signing_secret="$(generate_secret)"

  umask 077
  mkdir -p "${OUTPUT_DIR}"
  chmod 700 "${OUTPUT_DIR}"

  local env_file="${OUTPUT_DIR}/signing-material.env"
  local checklist_file="${OUTPUT_DIR}/rotation-checklist.md"

  cat > "${env_file}" <<EOF
# VaultProof enterprise signing rotation material.
# Store this in a password manager and do not commit it.
export ENTERPRISE_EXECUTOR_SIGNING_KEY_ID='${SIGNING_KEY_ID}'
export ENTERPRISE_EXECUTOR_SIGNING_SECRET='${signing_secret}'
export ENTERPRISE_EXECUTOR_ACCEPTED_SIGNING_KEYS='${SIGNING_KEY_ID}:${signing_secret}'
export ROTATED_EXECUTOR_SIGNING_SECRET_AT='${ROTATION_TIMESTAMP}'
EOF

  cat > "${checklist_file}" <<EOF
# VaultProof Enterprise Secret Rotation Checklist

Generated: ${ROTATION_TIMESTAMP}

## Fresh Signing Material

- New signing key ID: \`${SIGNING_KEY_ID}\`
- Secret material file: \`${env_file}\`

The secret value is intentionally not printed to stdout. Load it only inside a
secure operator shell or password manager.

## Install Order

1. Rotate the Supabase service-role key in Supabase.
2. Render and install the executor env first.
3. Render and install the control-plane env second.
4. Add these evidence markers to the control-plane env after rotation:

\`\`\`bash
ROTATED_SUPABASE_SERVICE_ROLE_AT=${ROTATION_TIMESTAMP}
ROTATED_EXECUTOR_SIGNING_SECRET_AT=${ROTATION_TIMESTAMP}
\`\`\`

5. Restart both services.
6. Run:

\`\`\`bash
REQUIRE_ROTATION_ACK=true npm run verify:enterprise-secrets
curl -sS https://enterprise.vaultproof.dev/readiness
\`\`\`

## Zero-Downtime Note

For a no-gap signing rollover, install the executor env first with both the old
accepted key entry and the new \`${SIGNING_KEY_ID}\` entry, then switch the
control plane to the new key. After verification, remove the old accepted key
entry from the executor env.
EOF

  chmod 600 "${env_file}" "${checklist_file}"

  echo "Generated fresh enterprise signing material."
  echo "  key id:     ${SIGNING_KEY_ID}"
  echo "  env file:   ${env_file}"
  echo "  checklist:  ${checklist_file}"
  echo
  echo "The signing secret was written to the env file and was not printed."
}

case "${ACTION}" in
  plan)
    show_plan
    ;;
  generate-signing-material)
    generate_signing_material
    ;;
  *)
    echo "Unknown ACTION: ${ACTION}. Use plan or generate-signing-material." >&2
    exit 1
    ;;
esac
