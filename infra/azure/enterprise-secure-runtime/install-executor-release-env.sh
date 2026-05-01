#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/vaultproof/enterprise-secure-executor.env}"
KEY_ENV_FILE="${KEY_ENV_FILE:-/tmp/key-vault-key-env.sh}"
SKR_ENV_FILE="${SKR_ENV_FILE:-/tmp/skr-env.sh}"
SERVICE_NAME="${SERVICE_NAME:-vaultproof-executor}"
RESTART_SERVICE="${RESTART_SERVICE:-false}"

if [[ "$(id -u)" != "0" ]]; then
  echo "Run as root, for example: sudo bash $0" >&2
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Executor env file not found: ${ENV_FILE}" >&2
  exit 1
fi

if [[ ! -f "${KEY_ENV_FILE}" ]]; then
  echo "Key release env file not found: ${KEY_ENV_FILE}" >&2
  exit 1
fi

if [[ ! -f "${SKR_ENV_FILE}" ]]; then
  echo "SKR policy env file not found: ${SKR_ENV_FILE}" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "${KEY_ENV_FILE}"
# shellcheck disable=SC1090
source "${SKR_ENV_FILE}"

required_values=(
  AZURE_KEY_RELEASE_URL
  AZURE_KEY_ID
  AZURE_KEY_VERSION
  AZURE_ATTESTATION_TOKEN_HASH
  AZURE_KEY_RELEASE_POLICY_HASH
  AZURE_MEASUREMENT_SUMMARY
)

for key in "${required_values[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    echo "Missing required value from env snippets: ${key}" >&2
    exit 1
  fi
done

set_env() {
  local key="$1"
  local value="$2"
  local tmp_file
  tmp_file="$(mktemp)"

  if grep -q "^${key}=" "${ENV_FILE}"; then
    awk -v key="${key}" -v value="${value}" '
      index($0, key "=") == 1 { print key "=" value; next }
      { print }
    ' "${ENV_FILE}" > "${tmp_file}"
  else
    cp "${ENV_FILE}" "${tmp_file}"
    printf "%s=%s\n" "${key}" "${value}" >> "${tmp_file}"
  fi

  cat "${tmp_file}" > "${ENV_FILE}"
  rm -f "${tmp_file}"
}

backup_file="${ENV_FILE}.bak.$(date -u +%Y%m%dT%H%M%SZ)"
cp "${ENV_FILE}" "${backup_file}"

set_env AZURE_KEY_RELEASE_URL "${AZURE_KEY_RELEASE_URL}"
set_env AZURE_KEY_ID "${AZURE_KEY_ID}"
set_env AZURE_KEY_VERSION "${AZURE_KEY_VERSION}"
set_env AZURE_ATTESTATION_TOKEN_HASH "${AZURE_ATTESTATION_TOKEN_HASH}"
set_env AZURE_KEY_RELEASE_POLICY_HASH "${AZURE_KEY_RELEASE_POLICY_HASH}"
set_env AZURE_MEASUREMENT_SUMMARY "${AZURE_MEASUREMENT_SUMMARY}"

chown root:vaultproof "${ENV_FILE}"
chmod 0640 "${ENV_FILE}"

echo "Updated ${ENV_FILE}"
echo "Backup: ${backup_file}"
echo "Installed release key version: ${AZURE_KEY_VERSION}"

if [[ "${RESTART_SERVICE}" == "true" ]]; then
  systemctl restart "${SERVICE_NAME}"
  echo "Restarted ${SERVICE_NAME}"
fi
