#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-vaultproof-prod}"
BACKEND_SERVICE="${BACKEND_SERVICE:-vaultproof-enterprise-backend}"
SECRET_NAME="${ORIGIN_LOCK_SECRET_NAME:-enterprise-origin-lock-secret}"
HEADER_NAME="${ENTERPRISE_ORIGIN_LOCK_HEADER_NAME:-x-vaultproof-origin-lock}"
ROTATE="${ROTATE_ORIGIN_LOCK_SECRET:-false}"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud is required."
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required to generate the origin-lock secret."
  exit 1
fi

if ! gcloud compute backend-services describe "${BACKEND_SERVICE}" \
    --global \
    --project="${PROJECT_ID}" >/dev/null 2>&1; then
  echo "Backend service ${BACKEND_SERVICE} does not exist yet."
  echo "Run npm run configure:gcp-enterprise-edge first."
  exit 1
fi

if ! gcloud secrets describe "${SECRET_NAME}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud secrets create "${SECRET_NAME}" \
    --replication-policy=automatic \
    --project="${PROJECT_ID}" >/dev/null
  echo "Created Secret Manager container ${SECRET_NAME}."
fi

latest_version="$(gcloud secrets versions list "${SECRET_NAME}" \
  --project="${PROJECT_ID}" \
  --filter='state:ENABLED' \
  --sort-by='~createTime' \
  --limit=1 \
  --format='value(name)' 2>/dev/null || true)"

if [[ -z "${latest_version}" || "${ROTATE}" == "true" ]]; then
  tmp_secret="$(mktemp)"
  trap 'rm -f "${tmp_secret}"' EXIT
  openssl rand -base64 48 | tr -d '\n' > "${tmp_secret}"
  gcloud secrets versions add "${SECRET_NAME}" \
    --data-file="${tmp_secret}" \
    --project="${PROJECT_ID}" >/dev/null
  echo "Added a new enabled version to ${SECRET_NAME}."
else
  echo "Reusing latest enabled version of ${SECRET_NAME}."
fi

origin_lock_secret="$(gcloud secrets versions access latest \
  --secret="${SECRET_NAME}" \
  --project="${PROJECT_ID}")"

if [[ -z "${origin_lock_secret}" ]]; then
  echo "Latest origin-lock secret value is empty."
  exit 1
fi

gcloud compute backend-services update "${BACKEND_SERVICE}" \
  --global \
  --custom-request-header="${HEADER_NAME}:${origin_lock_secret}" \
  --project="${PROJECT_ID}" >/dev/null

echo "Origin lock configured on ${BACKEND_SERVICE}."
echo "  secret=${SECRET_NAME}"
echo "  header=${HEADER_NAME}"
echo "  backend_custom_header=true"
echo
echo "When real runtime env secrets are ready, render the control-plane env with:"
echo "  ENTERPRISE_REQUIRE_ORIGIN_LOCK=true"
echo "  ENTERPRISE_ORIGIN_LOCK_HEADER_NAME=${HEADER_NAME}"
echo "  ENTERPRISE_ORIGIN_LOCK_SECRET=\$(gcloud secrets versions access latest --secret=${SECRET_NAME} --project=${PROJECT_ID})"
