#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-vaultproof-prod}"
LOCATION="${LOCATION:-us-central1}"
ZONE="${ZONE:-us-central1-a}"
BILLING_ACCOUNT="${BILLING_ACCOUNT:-019623-FDBB0F-3D4240}"
KEY_RING="${KEY_RING:-vaultproof-runtime}"
KMS_KEY="${KMS_KEY:-vaultproof-unwrap}"
REPOSITORY="${REPOSITORY:-vaultproof}"

CONTROL_PLANE_SA="vaultproof-control-plane@${PROJECT_ID}.iam.gserviceaccount.com"
EXECUTOR_SA="vaultproof-executor@${PROJECT_ID}.iam.gserviceaccount.com"
DEPLOY_SA="vaultproof-deploy@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud config set project "${PROJECT_ID}" >/dev/null
gcloud config set compute/region "${LOCATION}" >/dev/null
gcloud config set compute/zone "${ZONE}" >/dev/null

gcloud billing projects link "${PROJECT_ID}" --billing-account="${BILLING_ACCOUNT}" >/dev/null

gcloud services enable \
  serviceusage.googleapis.com \
  cloudbilling.googleapis.com \
  billingbudgets.googleapis.com \
  cloudresourcemanager.googleapis.com \
  compute.googleapis.com \
  cloudkms.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  dns.googleapis.com \
  logging.googleapis.com \
  monitoring.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  cloudbuild.googleapis.com \
  confidentialcomputing.googleapis.com \
  certificatemanager.googleapis.com \
  containeranalysis.googleapis.com \
  containerscanning.googleapis.com \
  --project="${PROJECT_ID}"

ensure_service_account() {
  local name="$1"
  local display_name="$2"
  local description="$3"
  if ! gcloud iam service-accounts describe "${name}@${PROJECT_ID}.iam.gserviceaccount.com" --project="${PROJECT_ID}" >/dev/null 2>&1; then
    gcloud iam service-accounts create "${name}" \
      --display-name="${display_name}" \
      --description="${description}" \
      --project="${PROJECT_ID}"
  fi
}

ensure_service_account vaultproof-control-plane "VaultProof Control Plane" "Runs the VaultProof enterprise control plane"
ensure_service_account vaultproof-executor "VaultProof Secure Executor" "Runs the VaultProof confidential secure executor"
ensure_service_account vaultproof-deploy "VaultProof Deployment" "Deploys VaultProof production infrastructure and runtime releases"

for runtime_sa in "${CONTROL_PLANE_SA}" "${EXECUTOR_SA}"; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${runtime_sa}" \
    --role=roles/logging.logWriter \
    --condition=None >/dev/null
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${runtime_sa}" \
    --role=roles/monitoring.metricWriter \
    --condition=None >/dev/null
done

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${DEPLOY_SA}" \
  --role=roles/logging.logWriter \
  --condition=None >/dev/null
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${DEPLOY_SA}" \
  --role=roles/artifactregistry.writer \
  --condition=None >/dev/null
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${DEPLOY_SA}" \
  --role=roles/storage.objectViewer \
  --condition=None >/dev/null

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${EXECUTOR_SA}" \
  --role=roles/artifactregistry.reader \
  --condition=None >/dev/null

if ! gcloud artifacts repositories describe "${REPOSITORY}" --location="${LOCATION}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud artifacts repositories create "${REPOSITORY}" \
    --repository-format=docker \
    --location="${LOCATION}" \
    --description="VaultProof production container images" \
    --project="${PROJECT_ID}"
fi

if ! gcloud kms keyrings describe "${KEY_RING}" --location="${LOCATION}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud kms keyrings create "${KEY_RING}" --location="${LOCATION}" --project="${PROJECT_ID}"
fi

if ! gcloud kms keys describe "${KMS_KEY}" --keyring="${KEY_RING}" --location="${LOCATION}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud kms keys create "${KMS_KEY}" \
    --keyring="${KEY_RING}" \
    --location="${LOCATION}" \
    --purpose=encryption \
    --protection-level=software \
    --project="${PROJECT_ID}"
fi

gcloud kms keys add-iam-policy-binding "${KMS_KEY}" \
  --keyring="${KEY_RING}" \
  --location="${LOCATION}" \
  --member="serviceAccount:${EXECUTOR_SA}" \
  --role=roles/cloudkms.cryptoKeyDecrypter \
  --project="${PROJECT_ID}" >/dev/null

for secret_name in enterprise-control-plane-env enterprise-secure-executor-env; do
  if ! gcloud secrets describe "${secret_name}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
    gcloud secrets create "${secret_name}" --replication-policy=automatic --project="${PROJECT_ID}"
  fi
done

gcloud secrets add-iam-policy-binding enterprise-control-plane-env \
  --member="serviceAccount:${CONTROL_PLANE_SA}" \
  --role=roles/secretmanager.secretAccessor \
  --project="${PROJECT_ID}" >/dev/null

gcloud secrets add-iam-policy-binding enterprise-control-plane-env \
  --member="serviceAccount:${EXECUTOR_SA}" \
  --role=roles/secretmanager.secretAccessor \
  --project="${PROJECT_ID}" >/dev/null

gcloud secrets add-iam-policy-binding enterprise-secure-executor-env \
  --member="serviceAccount:${EXECUTOR_SA}" \
  --role=roles/secretmanager.secretAccessor \
  --project="${PROJECT_ID}" >/dev/null

echo "GCP foundation ready:"
echo "  project=${PROJECT_ID}"
echo "  registry=${LOCATION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}"
echo "  kms_key=projects/${PROJECT_ID}/locations/${LOCATION}/keyRings/${KEY_RING}/cryptoKeys/${KMS_KEY}"
echo "  control_plane_sa=${CONTROL_PLANE_SA}"
echo "  executor_sa=${EXECUTOR_SA}"
echo "  deploy_sa=${DEPLOY_SA}"
