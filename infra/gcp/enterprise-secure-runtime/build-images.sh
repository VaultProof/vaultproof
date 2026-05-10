#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-vaultproof-prod}"
LOCATION="${LOCATION:-us-central1}"
REPOSITORY="${REPOSITORY:-vaultproof}"
REGISTRY="${LOCATION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}"
BUILD_TAG="${BUILD_TAG:-$(git rev-parse --short HEAD 2>/dev/null || date -u +%Y%m%d%H%M%S)}"
PROJECT_NUMBER="${PROJECT_NUMBER:-$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')}"
BUILD_SERVICE_ACCOUNT="${BUILD_SERVICE_ACCOUNT:-vaultproof-deploy@${PROJECT_ID}.iam.gserviceaccount.com}"

gcloud builds submit \
  --project="${PROJECT_ID}" \
  --region="${LOCATION}" \
  --service-account="projects/${PROJECT_ID}/serviceAccounts/${BUILD_SERVICE_ACCOUNT}" \
  --config=cloudbuild.enterprise.yaml \
  --substitutions="_REGISTRY=${REGISTRY},_TAG=${BUILD_TAG}" \
  .

echo "CONTROL_PLANE_IMAGE=${REGISTRY}/enterprise-control-plane:${BUILD_TAG}"
echo "EXECUTOR_IMAGE=${REGISTRY}/enterprise-secure-executor:${BUILD_TAG}"

BUILD_TAG="${BUILD_TAG}" \
PROJECT_ID="${PROJECT_ID}" \
LOCATION="${LOCATION}" \
REPOSITORY="${REPOSITORY}" \
node scripts/update-gcp-build-doc.mjs
