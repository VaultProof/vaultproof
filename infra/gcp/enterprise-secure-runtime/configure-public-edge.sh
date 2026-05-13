#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-vaultproof-prod}"
ZONE="${ZONE:-us-central1-a}"
NETWORK="${NETWORK:-vaultproof-enterprise}"
VM_NAME="${VM_NAME:-vaultproof-enterprise-runtime-1}"
DOMAIN="${DOMAIN:-enterprise.vaultproof.dev}"
CERT_DOMAINS="${CERT_DOMAINS:-${DOMAIN}}"
CONTROL_PLANE_PORT="${CONTROL_PLANE_PORT:-3001}"
LOAD_BALANCING_SCHEME="${LOAD_BALANCING_SCHEME:-EXTERNAL_MANAGED}"

GLOBAL_IP_NAME="${GLOBAL_IP_NAME:-vaultproof-enterprise-edge-ip}"
INSTANCE_GROUP="${INSTANCE_GROUP:-vaultproof-enterprise-runtime-ig}"
HEALTH_CHECK="${HEALTH_CHECK:-vaultproof-enterprise-health}"
BACKEND_SERVICE="${BACKEND_SERVICE:-vaultproof-enterprise-backend}"
URL_MAP="${URL_MAP:-vaultproof-enterprise-url-map}"
SSL_CERTIFICATE="${SSL_CERTIFICATE:-vaultproof-enterprise-cert}"
ADMIN_SSL_CERTIFICATE="${ADMIN_SSL_CERTIFICATE:-vaultproof-enterprise-admin-cert}"
SSL_POLICY="${SSL_POLICY:-vaultproof-enterprise-modern-tls}"
HTTPS_PROXY="${HTTPS_PROXY:-vaultproof-enterprise-https-proxy}"
HTTPS_FORWARDING_RULE="${HTTPS_FORWARDING_RULE:-vaultproof-enterprise-https}"
FIREWALL_RULE="${FIREWALL_RULE:-vaultproof-enterprise-allow-lb-to-control-plane}"
ORIGIN_LOCK_HEADER_NAME="${ORIGIN_LOCK_HEADER_NAME:-x-vaultproof-origin-lock}"
ORIGIN_LOCK_SECRET="${ENTERPRISE_ORIGIN_LOCK_SECRET:-${ORIGIN_LOCK_SECRET:-}}"

gcloud compute instances describe "${VM_NAME}" \
  --zone="${ZONE}" \
  --project="${PROJECT_ID}" >/dev/null

if ! gcloud compute addresses describe "${GLOBAL_IP_NAME}" --global --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud compute addresses create "${GLOBAL_IP_NAME}" \
    --global \
    --ip-version=IPV4 \
    --project="${PROJECT_ID}"
fi

EDGE_IP="$(gcloud compute addresses describe "${GLOBAL_IP_NAME}" --global --project="${PROJECT_ID}" --format='value(address)')"

if ! gcloud compute firewall-rules describe "${FIREWALL_RULE}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud compute firewall-rules create "${FIREWALL_RULE}" \
    --project="${PROJECT_ID}" \
    --network="${NETWORK}" \
    --direction=INGRESS \
    --priority=1000 \
    --action=ALLOW \
    --rules="tcp:${CONTROL_PLANE_PORT}" \
    --source-ranges=130.211.0.0/22,35.191.0.0/16 \
    --target-tags=vaultproof-enterprise-runtime \
    --enable-logging
fi

if ! gcloud compute instance-groups unmanaged describe "${INSTANCE_GROUP}" --zone="${ZONE}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud compute instance-groups unmanaged create "${INSTANCE_GROUP}" \
    --zone="${ZONE}" \
    --project="${PROJECT_ID}"
fi

CURRENT_INSTANCES="$(gcloud compute instance-groups unmanaged list-instances "${INSTANCE_GROUP}" --zone="${ZONE}" --project="${PROJECT_ID}" --format='value(instance)' 2>/dev/null || true)"
if [[ "${CURRENT_INSTANCES}" != *"${VM_NAME}"* ]]; then
  if ! gcloud compute instance-groups unmanaged add-instances "${INSTANCE_GROUP}" \
      --zone="${ZONE}" \
      --instances="${VM_NAME}" \
      --project="${PROJECT_ID}"; then
    CURRENT_INSTANCES="$(gcloud compute instance-groups unmanaged list-instances "${INSTANCE_GROUP}" --zone="${ZONE}" --project="${PROJECT_ID}" --format='value(instance)' 2>/dev/null || true)"
    if [[ "${CURRENT_INSTANCES}" != *"${VM_NAME}"* ]]; then
      echo "Failed to add ${VM_NAME} to ${INSTANCE_GROUP}."
      exit 1
    fi
    echo "${VM_NAME} is already attached to ${INSTANCE_GROUP}; continuing."
  fi
fi

gcloud compute instance-groups unmanaged set-named-ports "${INSTANCE_GROUP}" \
  --zone="${ZONE}" \
  --named-ports="http:${CONTROL_PLANE_PORT}" \
  --project="${PROJECT_ID}"

if ! gcloud compute health-checks describe "${HEALTH_CHECK}" --global --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud compute health-checks create http "${HEALTH_CHECK}" \
    --global \
    --host="${DOMAIN}" \
    --port="${CONTROL_PLANE_PORT}" \
    --request-path=/health \
    --check-interval=15s \
    --timeout=5s \
    --healthy-threshold=2 \
    --unhealthy-threshold=3 \
    --project="${PROJECT_ID}"
else
  gcloud compute health-checks update http "${HEALTH_CHECK}" \
    --global \
    --host="${DOMAIN}" \
    --port="${CONTROL_PLANE_PORT}" \
    --request-path=/health \
    --check-interval=15s \
    --timeout=5s \
    --healthy-threshold=2 \
    --unhealthy-threshold=3 \
    --project="${PROJECT_ID}"
fi

BACKEND_ARGS=(
  --global
  --load-balancing-scheme="${LOAD_BALANCING_SCHEME}"
  --protocol=HTTP
  --port-name=http
  --health-checks="${HEALTH_CHECK}"
  --global-health-checks
  --timeout=30s
  --enable-logging
  --logging-sample-rate=1.0
  --project="${PROJECT_ID}"
)

if [[ -n "${ORIGIN_LOCK_SECRET}" ]]; then
  BACKEND_ARGS+=(--custom-request-header="${ORIGIN_LOCK_HEADER_NAME}:${ORIGIN_LOCK_SECRET}")
else
  echo "WARNING: ORIGIN_LOCK_SECRET is empty; backend will not inject an origin-lock header."
  echo "Set ENTERPRISE_ORIGIN_LOCK_SECRET before production cutover."
fi

if ! gcloud compute backend-services describe "${BACKEND_SERVICE}" --global --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud compute backend-services create "${BACKEND_SERVICE}" "${BACKEND_ARGS[@]}"
else
  gcloud compute backend-services update "${BACKEND_SERVICE}" "${BACKEND_ARGS[@]}"
fi

BACKEND_GROUPS="$(gcloud compute backend-services describe "${BACKEND_SERVICE}" --global --project="${PROJECT_ID}" --format='value(backends[].group)' 2>/dev/null || true)"
if [[ "${BACKEND_GROUPS}" != *"/instanceGroups/${INSTANCE_GROUP}"* ]]; then
  gcloud compute backend-services add-backend "${BACKEND_SERVICE}" \
    --global \
    --instance-group="${INSTANCE_GROUP}" \
    --instance-group-zone="${ZONE}" \
    --balancing-mode=UTILIZATION \
    --max-utilization=0.8 \
    --project="${PROJECT_ID}"
fi

if ! gcloud compute url-maps describe "${URL_MAP}" --global --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud compute url-maps create "${URL_MAP}" \
    --global \
    --default-service="${BACKEND_SERVICE}" \
    --project="${PROJECT_ID}"
else
  gcloud compute url-maps set-default-service "${URL_MAP}" \
    --global \
    --default-service="${BACKEND_SERVICE}" \
    --project="${PROJECT_ID}"
fi

if ! gcloud compute ssl-certificates describe "${SSL_CERTIFICATE}" --global --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud compute ssl-certificates create "${SSL_CERTIFICATE}" \
    --global \
    --domains="${CERT_DOMAINS}" \
    --project="${PROJECT_ID}"
else
  echo "SSL certificate ${SSL_CERTIFICATE} already exists; leaving its domain list unchanged."
fi

SSL_CERTIFICATE_LIST="${SSL_CERTIFICATE}"
if [[ -n "${ADMIN_SSL_CERTIFICATE}" ]] \
  && gcloud compute ssl-certificates describe "${ADMIN_SSL_CERTIFICATE}" --global --project="${PROJECT_ID}" >/dev/null 2>&1; then
  SSL_CERTIFICATE_LIST="${SSL_CERTIFICATE_LIST},${ADMIN_SSL_CERTIFICATE}"
  echo "Including admin SSL certificate ${ADMIN_SSL_CERTIFICATE} on the HTTPS proxy."
fi

if ! gcloud compute ssl-policies describe "${SSL_POLICY}" --global --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud compute ssl-policies create "${SSL_POLICY}" \
    --global \
    --profile=MODERN \
    --min-tls-version=1.2 \
    --project="${PROJECT_ID}"
fi

if ! gcloud compute target-https-proxies describe "${HTTPS_PROXY}" --global --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud compute target-https-proxies create "${HTTPS_PROXY}" \
    --global \
    --url-map="${URL_MAP}" \
    --global-url-map \
    --ssl-certificates="${SSL_CERTIFICATE_LIST}" \
    --global-ssl-certificates \
    --ssl-policy="${SSL_POLICY}" \
    --global-ssl-policy \
    --project="${PROJECT_ID}"
else
  gcloud compute target-https-proxies update "${HTTPS_PROXY}" \
    --global \
    --url-map="${URL_MAP}" \
    --global-url-map \
    --ssl-certificates="${SSL_CERTIFICATE_LIST}" \
    --global-ssl-certificates \
    --ssl-policy="${SSL_POLICY}" \
    --global-ssl-policy \
    --project="${PROJECT_ID}"
fi

if ! gcloud compute forwarding-rules describe "${HTTPS_FORWARDING_RULE}" --global --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud compute forwarding-rules create "${HTTPS_FORWARDING_RULE}" \
    --global \
    --load-balancing-scheme="${LOAD_BALANCING_SCHEME}" \
    --network-tier=PREMIUM \
    --address="${GLOBAL_IP_NAME}" \
    --global-address \
    --target-https-proxy="${HTTPS_PROXY}" \
    --global-target-https-proxy \
    --ports=443 \
    --project="${PROJECT_ID}"
fi

echo "GCP public edge configured."
echo "  domain=${DOMAIN}"
echo "  edge_ip=${EDGE_IP}"
echo "  forwarding_rule=${HTTPS_FORWARDING_RULE}"
echo "  backend_service=${BACKEND_SERVICE}"
echo "  dns_next_step=Create a Cloudflare A record for ${DOMAIN} -> ${EDGE_IP}"
