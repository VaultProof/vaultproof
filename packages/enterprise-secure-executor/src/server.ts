import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  handleEnterpriseSecureExecutorRequestWithEnv,
  type EnterpriseSecureExecutorEnv,
} from './index.js';

const MAX_REQUEST_BODY_BYTES = 5 * 1024 * 1024;

class RequestBodyTooLargeError extends Error {
  statusCode = 413;

  constructor() {
    super('Request body too large');
  }
}

async function readRequestBody(req: IncomingMessage): Promise<Buffer | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_REQUEST_BODY_BYTES) {
      throw new RequestBodyTooLargeError();
    }
    chunks.push(buffer);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url || '/', `http://${host}`);
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
      continue;
    }
    if (typeof value === 'string') headers.set(key, value);
  }

  const body = await readRequestBody(req);
  return new Request(url, {
    method: req.method || 'GET',
    headers,
    body: body ? new Uint8Array(body) : undefined,
  });
}

async function writeWebResponse(response: Response, res: ServerResponse): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));

  if (!response.body) {
    res.end();
    return;
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  res.end(bytes);
}

function parseAcceptedSigningKeys(raw?: string): Record<string, string> {
  if (!raw) return {};

  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, entry) => {
      const separatorIndex = entry.indexOf(':');
      if (separatorIndex <= 0) return acc;

      const keyId = entry.slice(0, separatorIndex).trim();
      const secret = entry.slice(separatorIndex + 1).trim();
      if (!keyId || !secret) return acc;

      acc[keyId] = secret;
      return acc;
    }, {});
}

function getEnv(): EnterpriseSecureExecutorEnv {
  return {
    acceptedSigningKeys: parseAcceptedSigningKeys(process.env.ENTERPRISE_EXECUTOR_ACCEPTED_SIGNING_KEYS),
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    vaultEncryptionKey: process.env.VAULT_ENCRYPTION_KEY,
    enterpriseCloudProvider: process.env.ENTERPRISE_CLOUD_PROVIDER,
    executorMode: process.env.VAULTPROOF_EXECUTOR_MODE,
    azureKeyReleaseUrl: process.env.AZURE_KEY_RELEASE_URL,
    azureAttestationToken: process.env.AZURE_ATTESTATION_TOKEN,
    azureAttestationClientPath: process.env.AZURE_ATTESTATION_CLIENT_PATH,
    azureKeyVaultAccessToken: process.env.AZURE_KEY_VAULT_ACCESS_TOKEN,
    azureKeyReleaseEnc: process.env.AZURE_KEY_RELEASE_ENC,
    azureKeyReleaseCacheTtlMs: Number.parseInt(process.env.AZURE_KEY_RELEASE_CACHE_TTL_MS || '', 10),
    azureAttestationProviderUri: process.env.AZURE_ATTESTATION_PROVIDER_URI,
    azureAttestationTokenHash: process.env.AZURE_ATTESTATION_TOKEN_HASH,
    azureKeyReleasePolicyHash: process.env.AZURE_KEY_RELEASE_POLICY_HASH,
    azureKeyId: process.env.AZURE_KEY_ID,
    azureKeyVersion: process.env.AZURE_KEY_VERSION,
    executorBuildDigest: process.env.VAULTPROOF_EXECUTOR_BUILD_DIGEST,
    azureConfidentialVmResourceId: process.env.AZURE_CONFIDENTIAL_VM_RESOURCE_ID,
    azureMeasurementSummary: process.env.AZURE_MEASUREMENT_SUMMARY,
    gcpProjectId: process.env.GCP_PROJECT_ID,
    gcpLocation: process.env.GCP_LOCATION,
    gcpKmsKeyRing: process.env.GCP_KMS_KEY_RING,
    gcpKmsKeyName: process.env.GCP_KMS_KEY_NAME,
    gcpKmsCryptoKeyResource: process.env.GCP_KMS_CRYPTO_KEY_RESOURCE,
    gcpKmsKeyVersion: process.env.GCP_KMS_KEY_VERSION,
    gcpKmsProtectionLevel: process.env.GCP_KMS_PROTECTION_LEVEL,
    gcpKmsEncryptedVaultUnwrapKeyBase64: process.env.GCP_KMS_ENCRYPTED_VAULT_UNWRAP_KEY_BASE64,
    gcpKmsAccessToken: process.env.GCP_KMS_ACCESS_TOKEN,
    gcpKmsCacheTtlMs: Number.parseInt(process.env.GCP_KMS_CACHE_TTL_MS || '', 10),
    gcpAttestationTokenHash: process.env.GCP_ATTESTATION_TOKEN_HASH,
    gcpAttestationToken: process.env.GCP_ATTESTATION_TOKEN,
    gcpConfidentialVmResourceId: process.env.GCP_CONFIDENTIAL_VM_RESOURCE_ID,
    gcpMeasurementSummary: process.env.GCP_MEASUREMENT_SUMMARY,
    gcpSecureBoot: process.env.GCP_SECURE_BOOT === 'true',
    gcpImageDigest: process.env.GCP_ATTESTATION_EXPECTED_IMAGE_DIGEST,
    gcpServiceAccountEmail: process.env.GCP_SERVICE_ACCOUNT_EMAIL,
    gcpAttestationType: process.env.GCP_ATTESTATION_TYPE,
    gcpIsolationProvider: process.env.GCP_ISOLATION_PROVIDER === 'gcp-confidential-space'
      ? 'gcp-confidential-space'
      : process.env.GCP_ISOLATION_PROVIDER === 'gcp-confidential-vm'
        ? 'gcp-confidential-vm'
        : undefined,
    awsRegion: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
    awsKmsKeyId: process.env.AWS_KMS_KEY_ID,
    awsKmsKeyArn: process.env.AWS_KMS_KEY_ARN,
    awsKmsKeyVersion: process.env.AWS_KMS_KEY_VERSION,
    awsKmsKeySpec: process.env.AWS_KMS_KEY_SPEC,
    awsKmsKeyUsage: process.env.AWS_KMS_KEY_USAGE,
    awsKmsKeyState: process.env.AWS_KMS_KEY_STATE,
    awsKmsKeyOrigin: process.env.AWS_KMS_KEY_ORIGIN,
    awsKmsEncryptedVaultUnwrapKeyBase64: process.env.AWS_KMS_ENCRYPTED_VAULT_UNWRAP_KEY_BASE64,
    awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
    awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    awsSessionToken: process.env.AWS_SESSION_TOKEN,
    awsKmsCacheTtlMs: Number.parseInt(process.env.AWS_KMS_CACHE_TTL_MS || '', 10),
    awsAttestationTokenHash: process.env.AWS_ATTESTATION_TOKEN_HASH,
    awsAttestationToken: process.env.AWS_ATTESTATION_TOKEN,
    awsConfidentialVmResourceId: process.env.AWS_CONFIDENTIAL_VM_RESOURCE_ID,
    awsMeasurementSummary: process.env.AWS_MEASUREMENT_SUMMARY,
    awsSecureBoot: process.env.AWS_SECURE_BOOT === 'true',
    awsImageDigest: process.env.AWS_ATTESTATION_EXPECTED_IMAGE_DIGEST,
    awsRoleArn: process.env.AWS_ROLE_ARN,
    awsExternalId: process.env.AWS_EXTERNAL_ID || process.env.AWS_ROLE_EXTERNAL_ID,
    awsRoleSessionName: process.env.AWS_ROLE_SESSION_NAME,
    awsAssumeRoleDurationSeconds: Number.parseInt(process.env.AWS_ASSUME_ROLE_DURATION_SECONDS || '', 10),
    awsAttestationType: process.env.AWS_ATTESTATION_TYPE,
    awsIsolationProvider: process.env.AWS_ISOLATION_PROVIDER === 'aws-nitro-enclave'
      ? 'aws-nitro-enclave'
      : process.env.AWS_ISOLATION_PROVIDER === 'aws-ec2'
        ? 'aws-ec2'
        : undefined,
  };
}

async function main(): Promise<void> {
  const port = Number.parseInt(process.env.PORT || '3002', 10);
  const env = getEnv();

  const server = createServer(async (req, res) => {
    try {
      const request = await toWebRequest(req);
      const response = await handleEnterpriseSecureExecutorRequestWithEnv(request, env);
      await writeWebResponse(response, res);
    } catch (error) {
      const statusCode = error instanceof RequestBodyTooLargeError ? error.statusCode : 500;
      const message = statusCode === 413
        ? 'Request body too large'
        : error instanceof Error ? error.message : 'Unexpected server error';
      res.statusCode = statusCode;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: message }));
    }
  });

  server.listen(port, () => {
    console.log(`vaultproof enterprise secure executor listening on :${port}`);
  });
}

void main();
