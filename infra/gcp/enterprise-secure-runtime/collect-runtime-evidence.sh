#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-vaultproof-prod}"
LOCATION="${LOCATION:-us-central1}"
ZONE="${ZONE:-us-central1-a}"
VM_NAME="${VM_NAME:-vaultproof-enterprise-runtime-1}"
KEY_RING="${KEY_RING:-vaultproof-runtime}"
KMS_KEY="${KMS_KEY:-vaultproof-unwrap}"
GCP_KMS_KEY_VERSION="${GCP_KMS_KEY_VERSION:-${CUSTOMER_GCP_KMS_KEY_VERSION:-}}"
GCP_KMS_CRYPTO_KEY_RESOURCE="${GCP_KMS_CRYPTO_KEY_RESOURCE:-${CUSTOMER_GCP_KMS_CRYPTO_KEY_RESOURCE:-}}"
OUTPUT_FORMAT="${OUTPUT_FORMAT:-env}"
EVIDENCE_OUTPUT_FILE="${EVIDENCE_OUTPUT_FILE:-}"

KMS_PROJECT_ID="${KMS_PROJECT_ID:-${PROJECT_ID}}"
KMS_LOCATION="${KMS_LOCATION:-${LOCATION}}"

if [[ -n "${GCP_KMS_CRYPTO_KEY_RESOURCE}" ]]; then
  if [[ ! "${GCP_KMS_CRYPTO_KEY_RESOURCE}" =~ ^projects/([^/]+)/locations/([^/]+)/keyRings/([^/]+)/cryptoKeys/([^/]+)$ ]]; then
    echo "GCP_KMS_CRYPTO_KEY_RESOURCE must look like projects/<project>/locations/<location>/keyRings/<ring>/cryptoKeys/<key>." >&2
    exit 1
  fi
  KMS_PROJECT_ID="${BASH_REMATCH[1]}"
  KMS_LOCATION="${BASH_REMATCH[2]}"
  KEY_RING="${BASH_REMATCH[3]}"
  KMS_KEY="${BASH_REMATCH[4]}"
fi

require_command() {
  local command="$1"
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "${command} is required." >&2
    exit 1
  fi
}

extract_doc_value() {
  local label="$1"
  local path="${2:-docs/enterprise/gcp-build-status.md}"
  if [[ ! -f "${path}" ]]; then
    return 0
  fi
  grep -E "^- ${label}:" "${path}" | head -1 | sed -E 's/.*`([^`]+)`.*/\1/'
}

require_command gcloud
require_command node
require_command grep
require_command sed

VAULTPROOF_EXECUTOR_BUILD_DIGEST="${VAULTPROOF_EXECUTOR_BUILD_DIGEST:-$(extract_doc_value 'Executor digest')}"
if [[ -z "${VAULTPROOF_EXECUTOR_BUILD_DIGEST}" || "${VAULTPROOF_EXECUTOR_BUILD_DIGEST}" == "unknown" ]]; then
  echo "VAULTPROOF_EXECUTOR_BUILD_DIGEST is required, or docs/enterprise/gcp-build-status.md must contain the current executor digest." >&2
  exit 1
fi

tmpdir="$(mktemp -d)"
cleanup() {
  rm -rf "${tmpdir}"
}
trap cleanup EXIT

vm_json="${tmpdir}/vm.json"
kms_key_json="${tmpdir}/kms-key.json"
kms_version_json="${tmpdir}/kms-version.json"

gcloud compute instances describe "${VM_NAME}" \
  --zone="${ZONE}" \
  --project="${PROJECT_ID}" \
  --format=json > "${vm_json}"

gcloud kms keys describe "${KMS_KEY}" \
  --location="${KMS_LOCATION}" \
  --keyring="${KEY_RING}" \
  --project="${KMS_PROJECT_ID}" \
  --format=json > "${kms_key_json}"

if [[ -z "${GCP_KMS_KEY_VERSION}" ]]; then
  GCP_KMS_KEY_VERSION="$(
    node -e "const key=require(process.argv[1]); const name=key.primary && key.primary.name || ''; process.stdout.write(name.split('/').pop() || '')" "${kms_key_json}"
  )"
fi

if [[ -z "${GCP_KMS_KEY_VERSION}" ]]; then
  echo "GCP_KMS_KEY_VERSION is required because the KMS primary version could not be discovered." >&2
  exit 1
fi

gcloud kms keys versions describe "${GCP_KMS_KEY_VERSION}" \
  --location="${KMS_LOCATION}" \
  --keyring="${KEY_RING}" \
  --key="${KMS_KEY}" \
  --project="${KMS_PROJECT_ID}" \
  --format=json > "${kms_version_json}"

GCP_EVIDENCE_VM_JSON="${vm_json}" \
GCP_EVIDENCE_KMS_KEY_JSON="${kms_key_json}" \
GCP_EVIDENCE_KMS_VERSION_JSON="${kms_version_json}" \
PROJECT_ID="${PROJECT_ID}" \
KMS_PROJECT_ID="${KMS_PROJECT_ID}" \
LOCATION="${LOCATION}" \
KMS_LOCATION="${KMS_LOCATION}" \
ZONE="${ZONE}" \
VM_NAME="${VM_NAME}" \
KEY_RING="${KEY_RING}" \
KMS_KEY="${KMS_KEY}" \
GCP_KMS_CRYPTO_KEY_RESOURCE="${GCP_KMS_CRYPTO_KEY_RESOURCE}" \
GCP_KMS_KEY_VERSION="${GCP_KMS_KEY_VERSION}" \
VAULTPROOF_EXECUTOR_BUILD_DIGEST="${VAULTPROOF_EXECUTOR_BUILD_DIGEST}" \
OUTPUT_FORMAT="${OUTPUT_FORMAT}" \
EVIDENCE_OUTPUT_FILE="${EVIDENCE_OUTPUT_FILE}" \
node --input-type=module <<'NODE'
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256Base64Url(value) {
  return createHash('sha256').update(value).digest('base64url');
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function envLine(key, value) {
  return `export ${key}=${shellQuote(value)}`;
}

const vm = readJson(process.env.GCP_EVIDENCE_VM_JSON);
const kmsKey = readJson(process.env.GCP_EVIDENCE_KMS_KEY_JSON);
const kmsVersion = readJson(process.env.GCP_EVIDENCE_KMS_VERSION_JSON);

const projectId = process.env.PROJECT_ID;
const kmsProjectId = process.env.KMS_PROJECT_ID || projectId;
const location = process.env.LOCATION;
const kmsLocation = process.env.KMS_LOCATION || location;
const zone = process.env.ZONE;
const vmName = process.env.VM_NAME;
const keyRing = process.env.KEY_RING;
const kmsKeyName = process.env.KMS_KEY;
const explicitKmsResource = process.env.GCP_KMS_CRYPTO_KEY_RESOURCE || '';
const keyVersion = process.env.GCP_KMS_KEY_VERSION;
const executorDigest = process.env.VAULTPROOF_EXECUTOR_BUILD_DIGEST;

const confidential = vm.confidentialInstanceConfig || {};
const shielded = vm.shieldedInstanceConfig || {};
const network = Array.isArray(vm.networkInterfaces) ? vm.networkInterfaces[0] || {} : {};
const accessConfig = Array.isArray(network.accessConfigs) ? network.accessConfigs[0] || {} : {};
const serviceAccounts = Array.isArray(vm.serviceAccounts) ? vm.serviceAccounts : [];
const runtimeServiceAccount = serviceAccounts[0]?.email || null;
const protectionLevel = kmsVersion.protectionLevel || kmsKey.versionTemplate?.protectionLevel || null;
const keyState = kmsVersion.state || null;
const kmsResource = explicitKmsResource || `projects/${kmsProjectId}/locations/${kmsLocation}/keyRings/${keyRing}/cryptoKeys/${kmsKeyName}`;
const vmResource = `projects/${projectId}/zones/${zone}/instances/${vmName}`;
const confidentialType = confidential.confidentialInstanceType || null;
const confidentialEnabled = confidential.enableConfidentialCompute === true || Boolean(confidentialType);

const blockers = [];
const warnings = [];

if (vm.name !== vmName) blockers.push(`VM name mismatch: expected ${vmName}, got ${vm.name || 'unknown'}`);
if (vm.status !== 'RUNNING') warnings.push(`VM status is ${vm.status || 'unknown'}`);
if (!confidentialEnabled) blockers.push('Confidential Compute is not enabled on the VM');
if ((confidentialType || '').toUpperCase() !== 'SEV') {
  blockers.push(`Confidential Compute type is ${confidentialType || 'unknown'}, expected SEV`);
}
if (shielded.enableSecureBoot !== true) blockers.push('Shielded Secure Boot is not enabled');
if (shielded.enableVtpm !== true) blockers.push('Shielded vTPM is not enabled');
if (shielded.enableIntegrityMonitoring !== true) blockers.push('Shielded integrity monitoring is not enabled');
if (protectionLevel !== 'SOFTWARE') blockers.push(`GCP KMS protection level is ${protectionLevel || 'unknown'}, expected SOFTWARE for the no-HSM shared pilot`);
if (keyState !== 'ENABLED') blockers.push(`GCP KMS key version ${keyVersion} is ${keyState || 'unknown'}, expected ENABLED`);
if (!executorDigest || executorDigest === 'unknown') blockers.push('Executor image digest is missing');
if (!runtimeServiceAccount) blockers.push('Runtime service account is missing from VM description');

const measurementSummary = [
  'gcp-confidential-vm',
  `project:${projectId}`,
  `zone:${zone}`,
  `vm:${vmName}`,
  `confidential:${confidentialType || 'unknown'}`,
  `secureBoot:${shielded.enableSecureBoot === true}`,
  `vtpm:${shielded.enableVtpm === true}`,
  `integrity:${shielded.enableIntegrityMonitoring === true}`,
  `kmsProject:${kmsProjectId}`,
  `kmsLocation:${kmsLocation}`,
  `kms:${protectionLevel || 'unknown'}`,
  `executor:${executorDigest}`,
].join(';');

const evidence = {
  collectedAt: new Date().toISOString(),
  projectId,
  location,
  kmsProjectId,
  kmsLocation,
  zone,
  vm: {
    name: vm.name || null,
    resource: vmResource,
    status: vm.status || null,
    machineType: vm.machineType?.split('/').pop() || null,
    cpuPlatform: vm.cpuPlatform || null,
    internalIp: network.networkIP || null,
    externalIp: accessConfig.natIP || null,
    serviceAccountEmail: runtimeServiceAccount,
    confidentialInstanceConfig: {
      enableConfidentialCompute: confidentialEnabled,
      confidentialInstanceType: confidentialType,
    },
    shieldedInstanceConfig: {
      enableSecureBoot: shielded.enableSecureBoot === true,
      enableVtpm: shielded.enableVtpm === true,
      enableIntegrityMonitoring: shielded.enableIntegrityMonitoring === true,
    },
  },
  kms: {
    keyResource: kmsResource,
    keyVersion,
    purpose: kmsKey.purpose || null,
    state: keyState,
    protectionLevel,
    algorithm: kmsVersion.algorithm || null,
  },
  executor: {
    buildDigest: executorDigest,
  },
  claims: {
    attestationType: 'google-cloud-attestation',
    vmIsolation: 'gcp-confidential-vm',
    measurementSummary,
  },
  warnings,
};

const canonicalEvidence = stableStringify(evidence);
const attestationTokenHash = sha256Base64Url(canonicalEvidence);

if (blockers.length) {
  console.error(JSON.stringify({
    status: 'blocked',
    blockers,
    warnings,
  }, null, 2));
  process.exit(1);
}

const outputFile = process.env.EVIDENCE_OUTPUT_FILE;
if (outputFile) {
  writeFileSync(outputFile, `${JSON.stringify({
    ...evidence,
    attestationTokenHash,
  }, null, 2)}\n`);
}

if (process.env.OUTPUT_FORMAT === 'json') {
  console.log(JSON.stringify({
    status: 'ok',
    attestationTokenHash,
    measurementSummary,
    confidentialVmResourceId: vmResource,
    kmsProtectionLevel: protectionLevel,
    kmsKeyVersion: keyVersion,
    executorDigest,
    warnings,
  }, null, 2));
} else {
  console.log(envLine('GCP_ATTESTATION_TOKEN_HASH', attestationTokenHash));
  console.log(envLine('GCP_MEASUREMENT_SUMMARY', measurementSummary));
  console.log(envLine('GCP_CONFIDENTIAL_VM_RESOURCE_ID', vmResource));
  console.log(envLine('GCP_KMS_CRYPTO_KEY_RESOURCE', kmsResource));
  console.log(envLine('GCP_KMS_KEY_VERSION', keyVersion));
  console.log(envLine('GCP_KMS_PROTECTION_LEVEL', protectionLevel));
  console.log(envLine('GCP_ATTESTATION_EXPECTED_IMAGE_DIGEST', executorDigest));
}
NODE
