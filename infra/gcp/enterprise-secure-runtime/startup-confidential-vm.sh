#!/usr/bin/env bash
set -euo pipefail

exec > >(tee -a /var/log/vaultproof-startup.log | logger -t vaultproof-startup -s 2>/dev/console) 2>&1

metadata_value() {
  curl -fsS -H 'Metadata-Flavor: Google' "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1" || true
}

PROJECT_ID="$(metadata_value vaultproof-project-id)"
PROJECT_ID="${PROJECT_ID:-vaultproof-prod}"
LOCATION="$(metadata_value vaultproof-location)"
LOCATION="${LOCATION:-us-central1}"
BUILD_TAG="$(metadata_value vaultproof-build-tag)"
BUILD_TAG="${BUILD_TAG:-manual}"
REGISTRY="${LOCATION}-docker.pkg.dev/${PROJECT_ID}/vaultproof"
CONTROL_PLANE_IMAGE="$(metadata_value vaultproof-control-plane-image)"
CONTROL_PLANE_IMAGE="${CONTROL_PLANE_IMAGE:-${REGISTRY}/enterprise-control-plane:${BUILD_TAG}}"
EXECUTOR_IMAGE="$(metadata_value vaultproof-executor-image)"
EXECUTOR_IMAGE="${EXECUTOR_IMAGE:-${REGISTRY}/enterprise-secure-executor:${BUILD_TAG}}"

echo "Starting VaultProof GCP runtime bootstrap"
echo "project=${PROJECT_ID}"
echo "control_plane_image=${CONTROL_PLANE_IMAGE}"
echo "executor_image=${EXECUTOR_IMAGE}"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl docker.io google-cloud-cli jq
systemctl enable --now docker

mkdir -p /etc/vaultproof
chmod 0750 /etc/vaultproof

fetch_secret_env() {
  local secret_name="$1"
  local destination="$2"
  if gcloud secrets versions access latest --secret="${secret_name}" --project="${PROJECT_ID}" > "${destination}.tmp" 2>/tmp/vaultproof-secret-error.log; then
    mv "${destination}.tmp" "${destination}"
    chmod 0600 "${destination}"
    echo "Loaded ${secret_name} from Secret Manager"
    return 0
  fi

  rm -f "${destination}.tmp"
  echo "Secret ${secret_name} has no readable latest version yet; writing bootstrap not-ready env"
  return 1
}

if ! fetch_secret_env enterprise-secure-executor-env /etc/vaultproof/enterprise-secure-executor.env; then
  cat > /etc/vaultproof/enterprise-secure-executor.env <<EOF
PORT=3002
ENTERPRISE_CLOUD_PROVIDER=gcp
VAULTPROOF_EXECUTOR_MODE=confidential
ENTERPRISE_EXECUTOR_ACCEPTED_SIGNING_KEYS=enterprise-gcp-bootstrap:not-ready-bootstrap
GCP_PROJECT_ID=${PROJECT_ID}
GCP_LOCATION=${LOCATION}
GCP_KMS_KEY_RING=vaultproof-runtime
GCP_KMS_KEY_NAME=vaultproof-unwrap
GCP_KMS_KEY_VERSION=1
GCP_KMS_PROTECTION_LEVEL=SOFTWARE
GCP_KMS_CACHE_TTL_MS=60000
VAULTPROOF_EXECUTOR_BUILD_DIGEST=bootstrap-not-ready
GCP_CONFIDENTIAL_VM_RESOURCE_ID=projects/${PROJECT_ID}/zones/us-central1-a/instances/vaultproof-enterprise-runtime-1
GCP_MEASUREMENT_SUMMARY=bootstrap-not-ready
GCP_SECURE_BOOT=true
GCP_SERVICE_ACCOUNT_EMAIL=vaultproof-executor@${PROJECT_ID}.iam.gserviceaccount.com
GCP_ATTESTATION_TYPE=google-cloud-attestation
GCP_ISOLATION_PROVIDER=gcp-confidential-vm
EOF
  chmod 0600 /etc/vaultproof/enterprise-secure-executor.env
fi

if ! fetch_secret_env enterprise-control-plane-env /etc/vaultproof/enterprise-control-plane.env; then
  cat > /etc/vaultproof/enterprise-control-plane.env <<EOF
PORT=3001
ENTERPRISE_CLOUD_PROVIDER=gcp
ENTERPRISE_HOSTNAME=enterprise.vaultproof.dev
ENTERPRISE_RUNTIME_TIER=shared-demo
ENTERPRISE_EXECUTOR_BASE_URL=http://127.0.0.1:3002
ENTERPRISE_EXECUTOR_SIGNING_KEY_ID=enterprise-gcp-bootstrap
ENTERPRISE_EXECUTOR_SIGNING_SECRET=not-ready-bootstrap
ENTERPRISE_REQUIRE_ORIGIN_LOCK=false
ENTERPRISE_ORIGIN_LOCK_HEADER_NAME=x-vaultproof-origin-lock
EOF
  chmod 0600 /etc/vaultproof/enterprise-control-plane.env
fi

ACCESS_TOKEN="$(gcloud auth print-access-token)"
printf '%s' "${ACCESS_TOKEN}" | docker login -u oauth2accesstoken --password-stdin "https://${LOCATION}-docker.pkg.dev"

docker pull "${EXECUTOR_IMAGE}"
docker pull "${CONTROL_PLANE_IMAGE}"

docker rm -f vaultproof-executor vaultproof-control-plane >/dev/null 2>&1 || true

docker run -d \
  --name vaultproof-executor \
  --restart unless-stopped \
  --network host \
  --env-file /etc/vaultproof/enterprise-secure-executor.env \
  "${EXECUTOR_IMAGE}"

docker run -d \
  --name vaultproof-control-plane \
  --restart unless-stopped \
  --network host \
  --env-file /etc/vaultproof/enterprise-control-plane.env \
  "${CONTROL_PLANE_IMAGE}"

sleep 5
echo "Executor health:"
curl -fsS http://127.0.0.1:3002/health || true
echo
echo "Control plane readiness:"
curl -fsS -H 'Host: enterprise.vaultproof.dev' http://127.0.0.1:3001/readiness || true
echo
echo "VaultProof GCP runtime bootstrap complete"
