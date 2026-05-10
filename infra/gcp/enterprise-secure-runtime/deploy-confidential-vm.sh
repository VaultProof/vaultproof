#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-vaultproof-prod}"
LOCATION="${LOCATION:-us-central1}"
ZONE="${ZONE:-us-central1-a}"
NETWORK="${NETWORK:-vaultproof-enterprise}"
SUBNET="${SUBNET:-vaultproof-enterprise-${LOCATION}}"
SUBNET_RANGE="${SUBNET_RANGE:-10.60.0.0/24}"
VM_NAME="${VM_NAME:-vaultproof-enterprise-runtime-1}"
MACHINE_TYPE="${MACHINE_TYPE:-n2d-standard-2}"
BUILD_TAG="${BUILD_TAG:-$(git rev-parse --short HEAD 2>/dev/null || echo manual)}"
REGISTRY="${LOCATION}-docker.pkg.dev/${PROJECT_ID}/vaultproof"
CONTROL_PLANE_IMAGE="${CONTROL_PLANE_IMAGE:-${REGISTRY}/enterprise-control-plane:${BUILD_TAG}}"
EXECUTOR_IMAGE="${EXECUTOR_IMAGE:-${REGISTRY}/enterprise-secure-executor:${BUILD_TAG}}"
RUNTIME_SA="${RUNTIME_SA:-vaultproof-executor@${PROJECT_ID}.iam.gserviceaccount.com}"
STARTUP_SCRIPT="${STARTUP_SCRIPT:-infra/gcp/enterprise-secure-runtime/startup-confidential-vm.sh}"

if gcloud compute instances describe "${VM_NAME}" --zone="${ZONE}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  echo "Instance ${VM_NAME} already exists in ${ZONE}; leaving it in place."
  echo "Use gcloud compute instances reset ${VM_NAME} --zone=${ZONE} --project=${PROJECT_ID} after updating metadata/startup behavior."
  exit 0
fi

if ! gcloud compute networks describe "${NETWORK}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud compute networks create "${NETWORK}" \
    --project="${PROJECT_ID}" \
    --subnet-mode=custom \
    --bgp-routing-mode=regional
fi

if ! gcloud compute networks subnets describe "${SUBNET}" --region="${LOCATION}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud compute networks subnets create "${SUBNET}" \
    --project="${PROJECT_ID}" \
    --region="${LOCATION}" \
    --network="${NETWORK}" \
    --range="${SUBNET_RANGE}"
fi

if ! gcloud compute firewall-rules describe vaultproof-enterprise-allow-iap-ssh --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud compute firewall-rules create vaultproof-enterprise-allow-iap-ssh \
    --project="${PROJECT_ID}" \
    --network="${NETWORK}" \
    --direction=INGRESS \
    --priority=1000 \
    --action=ALLOW \
    --rules=tcp:22 \
    --source-ranges=35.235.240.0/20 \
    --target-tags=vaultproof-enterprise-runtime \
    --enable-logging
fi

gcloud compute instances create "${VM_NAME}" \
  --project="${PROJECT_ID}" \
  --zone="${ZONE}" \
  --machine-type="${MACHINE_TYPE}" \
  --network="${NETWORK}" \
  --subnet="${SUBNET}" \
  --tags=vaultproof-enterprise-runtime \
  --service-account="${RUNTIME_SA}" \
  --scopes=cloud-platform \
  --image-family=debian-12 \
  --image-project=debian-cloud \
  --boot-disk-size=30GB \
  --boot-disk-type=pd-balanced \
  --maintenance-policy=TERMINATE \
  --confidential-compute-type=SEV \
  --shielded-secure-boot \
  --shielded-vtpm \
  --shielded-integrity-monitoring \
  --metadata="vaultproof-project-id=${PROJECT_ID},vaultproof-location=${LOCATION},vaultproof-build-tag=${BUILD_TAG},vaultproof-control-plane-image=${CONTROL_PLANE_IMAGE},vaultproof-executor-image=${EXECUTOR_IMAGE}" \
  --metadata-from-file="startup-script=${STARTUP_SCRIPT}"

echo "Created ${VM_NAME} in ${ZONE}."
echo "Inspect startup logs with:"
echo "  gcloud compute instances get-serial-port-output ${VM_NAME} --zone=${ZONE} --project=${PROJECT_ID} --port=1"
