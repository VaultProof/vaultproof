#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-vaultproof-prod}"
LOCATION="${LOCATION:-us-central1}"
KEY_RING="${KEY_RING:-vaultproof-runtime}"
KMS_KEY="${KMS_KEY:-vaultproof-unwrap}"
GCP_KMS_CRYPTO_KEY_RESOURCE="${GCP_KMS_CRYPTO_KEY_RESOURCE:-${CUSTOMER_GCP_KMS_CRYPTO_KEY_RESOURCE:-}}"

if [[ -n "${GCP_KMS_CRYPTO_KEY_RESOURCE}" ]]; then
  if [[ ! "${GCP_KMS_CRYPTO_KEY_RESOURCE}" =~ ^projects/([^/]+)/locations/([^/]+)/keyRings/([^/]+)/cryptoKeys/([^/]+)$ ]]; then
    echo "GCP_KMS_CRYPTO_KEY_RESOURCE must look like projects/<project>/locations/<location>/keyRings/<ring>/cryptoKeys/<key>." >&2
    exit 1
  fi
  PROJECT_ID="${BASH_REMATCH[1]}"
  LOCATION="${BASH_REMATCH[2]}"
  KEY_RING="${BASH_REMATCH[3]}"
  KMS_KEY="${BASH_REMATCH[4]}"
fi

PLAINTEXT_FILE="$(mktemp)"
CIPHERTEXT_FILE="$(mktemp)"
cleanup() {
  rm -f "${PLAINTEXT_FILE}" "${CIPHERTEXT_FILE}"
}
trap cleanup EXIT

if [[ -n "${VAULT_UNWRAP_KEY_BASE64:-}" ]]; then
  printf '%s' "${VAULT_UNWRAP_KEY_BASE64}" | base64 -d > "${PLAINTEXT_FILE}"
else
  openssl rand 32 > "${PLAINTEXT_FILE}"
fi

gcloud kms encrypt \
  --project="${PROJECT_ID}" \
  --location="${LOCATION}" \
  --keyring="${KEY_RING}" \
  --key="${KMS_KEY}" \
  --plaintext-file="${PLAINTEXT_FILE}" \
  --ciphertext-file="${CIPHERTEXT_FILE}"

printf 'GCP_KMS_ENCRYPTED_VAULT_UNWRAP_KEY_BASE64='
base64 < "${CIPHERTEXT_FILE}" | tr -d '\n'
printf '\n'
