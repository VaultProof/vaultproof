import type { SecureExecutionAttestationEvidence } from '@vaultproof/core';
import { execFile } from 'node:child_process';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_RELEASED_KEY_CACHE_TTL_MS = 60_000;
const MAX_RELEASED_KEY_CACHE_TTL_MS = 5 * 60_000;

export interface VaultUnwrapKeyProvider {
  readonly mode: string;
  readonly hardwareBound: boolean;
  getVaultUnwrapKey(): Promise<string>;
  getAttestationEvidence(): Promise<SecureExecutionAttestationEvidence | null>;
}

export class EnvVaultUnwrapKeyProvider implements VaultUnwrapKeyProvider {
  readonly mode = 'demo-env';
  readonly hardwareBound = false;

  constructor(private readonly vaultEncryptionKey: string) {}

  async getVaultUnwrapKey(): Promise<string> {
    return this.vaultEncryptionKey;
  }

  async getAttestationEvidence(): Promise<SecureExecutionAttestationEvidence | null> {
    return null;
  }
}

export class NullVaultUnwrapKeyProvider implements VaultUnwrapKeyProvider {
  readonly mode = 'not-configured';
  readonly hardwareBound = false;

  async getVaultUnwrapKey(): Promise<string> {
    throw new Error('Vault unwrap key release is not configured.');
  }

  async getAttestationEvidence(): Promise<SecureExecutionAttestationEvidence | null> {
    return null;
  }
}

export class AzureSecureKeyReleaseProvider implements VaultUnwrapKeyProvider {
  readonly mode = 'azure-secure-key-release';
  readonly hardwareBound = true;

  constructor(private readonly input: {
    keyReleaseUrl?: string;
    attestationToken?: string;
    attestationClientPath?: string;
    accessToken?: string;
    releaseEnc?: string;
    cacheTtlMs?: number;
    fetchImpl?: typeof fetch;
    attestationProviderUri?: string;
    attestationTokenHash?: string;
    keyReleasePolicyHash?: string;
    keyId?: string;
    keyVersion?: string;
    executorBuildDigest?: string;
    confidentialVmResourceId?: string;
    measurementSummary?: string;
  }) {}

  private cachedVaultUnwrapKey: { value: string; expiresAt: number } | null = null;
  private cachedAttestationToken: { value: string; expiresAt: number } | null = null;

  async getVaultUnwrapKey(): Promise<string> {
    if (!this.input.keyReleaseUrl) {
      throw new Error('Azure Secure Key Release requires a key release URL.');
    }

    const now = Date.now();
    if (this.cachedVaultUnwrapKey && this.cachedVaultUnwrapKey.expiresAt > now) {
      return this.cachedVaultUnwrapKey.value;
    }

    const attestationToken = await this.getAttestationToken();
    const accessToken = this.input.accessToken || await fetchManagedIdentityToken(this.fetchImpl());
    const releasedJws = await releaseAzureKey({
      fetchImpl: this.fetchImpl(),
      keyReleaseUrl: this.input.keyReleaseUrl,
      accessToken,
      attestationToken,
      enc: this.input.releaseEnc,
    });
    const vaultUnwrapKey = extractVaultUnwrapKeyMaterial(releasedJws);
    const ttlMs = normalizeReleasedKeyCacheTtlMs(this.input.cacheTtlMs);
    this.cachedVaultUnwrapKey = {
      value: vaultUnwrapKey,
      expiresAt: now + ttlMs,
    };
    return vaultUnwrapKey;
  }

  async getAttestationEvidence(): Promise<SecureExecutionAttestationEvidence | null> {
    const attestationToken = await this.getAttestationTokenForEvidence();
    const claims = attestationToken ? decodeAttestationClaims(attestationToken) : null;
    return {
      provider: 'azure-confidential-vm',
      attestationProviderUri: this.input.attestationProviderUri || null,
      attestationTokenHash: this.input.attestationTokenHash || (attestationToken ? sha256Base64Url(attestationToken) : null),
      keyReleasePolicyHash: this.input.keyReleasePolicyHash || null,
      keyId: this.input.keyId || null,
      keyVersion: this.input.keyVersion || null,
      executorBuildDigest: this.input.executorBuildDigest || null,
      confidentialVmResourceId: this.input.confidentialVmResourceId || null,
      claims: {
        attestationType: 'azure-maa',
        secureBoot: claims?.secureBoot ?? null,
        vmIsolation: 'azure-confidential-vm',
        measurementSummary: this.input.measurementSummary || claims?.measurementSummary || null,
      },
    };
  }

  private fetchImpl(): typeof fetch {
    return this.input.fetchImpl || fetch;
  }

  private async getAttestationToken(): Promise<string> {
    if (this.input.attestationToken) return this.input.attestationToken;

    const now = Date.now();
    if (this.cachedAttestationToken && this.cachedAttestationToken.expiresAt > now) {
      return this.cachedAttestationToken.value;
    }

    if (!this.input.attestationClientPath || !this.input.attestationProviderUri) {
      throw new Error('Azure Secure Key Release requires either AZURE_ATTESTATION_TOKEN or AZURE_ATTESTATION_CLIENT_PATH with AZURE_ATTESTATION_PROVIDER_URI.');
    }

    const { stdout } = await execFileAsync(
      this.input.attestationClientPath,
      ['-a', this.input.attestationProviderUri, '-o', 'token'],
      {
        timeout: 15_000,
        maxBuffer: 1024 * 1024,
      },
    );
    const token = stdout.trim().split(/\s+/).find((part) => part.startsWith('eyJ')) || '';
    if (!token) {
      throw new Error('Azure guest attestation client did not return a JWT token.');
    }

    this.cachedAttestationToken = {
      value: token,
      expiresAt: now + getJwtCacheTtlMs(token, 7 * 60 * 60 * 1000),
    };
    return token;
  }

  private async getAttestationTokenForEvidence(): Promise<string | null> {
    if (this.input.attestationToken) return this.input.attestationToken;
    if (this.cachedAttestationToken?.value) return this.cachedAttestationToken.value;
    if (!this.input.attestationClientPath || !this.input.attestationProviderUri) return null;

    try {
      return await this.getAttestationToken();
    } catch {
      return null;
    }
  }
}

export class GcpKmsVaultUnwrapKeyProvider implements VaultUnwrapKeyProvider {
  readonly mode = 'gcp-cloud-kms';
  readonly hardwareBound: boolean;

  constructor(private readonly input: {
    projectId?: string;
    location?: string;
    keyRing?: string;
    keyName?: string;
    cryptoKeyResource?: string;
    keyVersion?: string;
    keyProtectionLevel?: string;
    encryptedVaultUnwrapKeyBase64?: string;
    accessToken?: string;
    cacheTtlMs?: number;
    fetchImpl?: typeof fetch;
    attestationTokenHash?: string;
    attestationToken?: string;
    executorBuildDigest?: string;
    confidentialVmResourceId?: string;
    measurementSummary?: string;
    secureBoot?: boolean;
    imageDigest?: string;
    serviceAccountEmail?: string;
    attestationType?: string;
    isolationProvider?: 'gcp-confidential-vm' | 'gcp-confidential-space';
  }) {
    this.hardwareBound = (input.keyProtectionLevel || '').trim().toUpperCase() === 'HSM';
  }

  private cachedVaultUnwrapKey: { value: string; expiresAt: number } | null = null;

  async getVaultUnwrapKey(): Promise<string> {
    if (!this.input.encryptedVaultUnwrapKeyBase64) {
      throw new Error('GCP Cloud KMS requires GCP_KMS_ENCRYPTED_VAULT_UNWRAP_KEY_BASE64.');
    }

    const now = Date.now();
    if (this.cachedVaultUnwrapKey && this.cachedVaultUnwrapKey.expiresAt > now) {
      return this.cachedVaultUnwrapKey.value;
    }

    const keyResource = buildGcpKmsCryptoKeyResource(this.input);
    const accessToken = this.input.accessToken || await fetchGcpAccessToken(this.fetchImpl());
    const response = await this.fetchImpl()(`https://cloudkms.googleapis.com/v1/${keyResource}:decrypt`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        ciphertext: this.input.encryptedVaultUnwrapKeyBase64,
      }),
    });

    const payload = await response.json().catch(() => null) as { plaintext?: string; error?: { message?: string } } | null;
    if (!response.ok || !payload?.plaintext) {
      throw new Error(payload?.error?.message || `GCP Cloud KMS decrypt failed with ${response.status}`);
    }

    const vaultUnwrapKey = payload.plaintext;
    const ttlMs = normalizeReleasedKeyCacheTtlMs(this.input.cacheTtlMs);
    this.cachedVaultUnwrapKey = {
      value: vaultUnwrapKey,
      expiresAt: now + ttlMs,
    };
    return vaultUnwrapKey;
  }

  async getAttestationEvidence(): Promise<SecureExecutionAttestationEvidence | null> {
    const keyResource = buildGcpKmsCryptoKeyResource(this.input);
    const provider = this.input.isolationProvider || 'gcp-confidential-vm';
    const attestationTokenHash = this.input.attestationTokenHash
      || (this.input.attestationToken ? sha256Base64Url(this.input.attestationToken) : null);

    return {
      provider,
      projectId: parseGcpKmsResourcePart(keyResource, 'projects') || this.input.projectId || null,
      location: parseGcpKmsResourcePart(keyResource, 'locations') || this.input.location || null,
      attestationTokenHash,
      keyId: keyResource,
      keyVersion: this.input.keyVersion || null,
      keyProtectionLevel: this.input.keyProtectionLevel || null,
      executorBuildDigest: this.input.executorBuildDigest || null,
      confidentialVmResourceId: this.input.confidentialVmResourceId || null,
      claims: {
        attestationType: this.input.attestationType || 'google-cloud-attestation',
        secureBoot: this.input.secureBoot ?? null,
        vmIsolation: provider,
        measurementSummary: this.input.measurementSummary || null,
        imageDigest: this.input.imageDigest || null,
        serviceAccountEmail: this.input.serviceAccountEmail || null,
      },
    };
  }

  private fetchImpl(): typeof fetch {
    return this.input.fetchImpl || fetch;
  }
}

export class AwsKmsVaultUnwrapKeyProvider implements VaultUnwrapKeyProvider {
  readonly mode = 'aws-kms';
  readonly hardwareBound: boolean;

  constructor(private readonly input: {
    region?: string;
    keyId?: string;
    keyArn?: string;
    keyVersion?: string;
    keySpec?: string;
    keyUsage?: string;
    keyState?: string;
    keyOrigin?: string;
    encryptedVaultUnwrapKeyBase64?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    sessionToken?: string;
    cacheTtlMs?: number;
    fetchImpl?: typeof fetch;
    attestationTokenHash?: string;
    attestationToken?: string;
    executorBuildDigest?: string;
    confidentialVmResourceId?: string;
    measurementSummary?: string;
    secureBoot?: boolean;
    imageDigest?: string;
    roleArn?: string;
    attestationType?: string;
    isolationProvider?: 'aws-nitro-enclave' | 'aws-ec2';
  }) {
    const origin = (input.keyOrigin || '').trim().toUpperCase();
    this.hardwareBound = origin === 'AWS_CLOUDHSM' || origin === 'EXTERNAL_KEY_STORE';
  }

  private cachedVaultUnwrapKey: { value: string; expiresAt: number } | null = null;
  private cachedCredentials: { value: AwsCredentials; expiresAt: number } | null = null;

  async getVaultUnwrapKey(): Promise<string> {
    if (!this.input.encryptedVaultUnwrapKeyBase64) {
      throw new Error('AWS KMS requires AWS_KMS_ENCRYPTED_VAULT_UNWRAP_KEY_BASE64.');
    }

    const now = Date.now();
    if (this.cachedVaultUnwrapKey && this.cachedVaultUnwrapKey.expiresAt > now) {
      return this.cachedVaultUnwrapKey.value;
    }

    const region = getRequiredAwsRegion(this.input.region, this.input.keyArn || this.input.keyId);
    const credentials = await this.getCredentials();
    const payload = await decryptAwsKmsCiphertext({
      fetchImpl: this.fetchImpl(),
      region,
      keyId: this.input.keyArn || this.input.keyId,
      ciphertextBlob: this.input.encryptedVaultUnwrapKeyBase64,
      credentials,
    });
    const ttlMs = normalizeReleasedKeyCacheTtlMs(this.input.cacheTtlMs);
    this.cachedVaultUnwrapKey = {
      value: payload.plaintext,
      expiresAt: now + ttlMs,
    };
    return payload.plaintext;
  }

  async getAttestationEvidence(): Promise<SecureExecutionAttestationEvidence | null> {
    const keyId = this.input.keyArn || this.input.keyId || null;
    return {
      provider: this.input.isolationProvider || 'aws-ec2',
      region: this.input.region || parseAwsArnPart(keyId, 'region') || null,
      accountId: parseAwsArnPart(keyId, 'accountId') || null,
      attestationTokenHash: this.input.attestationTokenHash
        || (this.input.attestationToken ? sha256Base64Url(this.input.attestationToken) : null),
      keyId,
      keyArn: keyId?.startsWith('arn:') ? keyId : null,
      keyVersion: this.input.keyVersion || null,
      keySpec: this.input.keySpec || null,
      keyUsage: this.input.keyUsage || null,
      keyState: this.input.keyState || null,
      keyOrigin: this.input.keyOrigin || null,
      executorBuildDigest: this.input.executorBuildDigest || null,
      confidentialVmResourceId: this.input.confidentialVmResourceId || null,
      claims: {
        attestationType: this.input.attestationType || 'aws-kms-runtime-evidence',
        secureBoot: this.input.secureBoot ?? null,
        vmIsolation: this.input.isolationProvider || 'aws-ec2',
        measurementSummary: this.input.measurementSummary || null,
        imageDigest: this.input.imageDigest || null,
        roleArn: this.input.roleArn || null,
      },
    };
  }

  private fetchImpl(): typeof fetch {
    return this.input.fetchImpl || fetch;
  }

  private async getCredentials(): Promise<AwsCredentials> {
    if (this.input.accessKeyId && this.input.secretAccessKey) {
      return {
        accessKeyId: this.input.accessKeyId,
        secretAccessKey: this.input.secretAccessKey,
        sessionToken: this.input.sessionToken,
      };
    }

    const now = Date.now();
    if (this.cachedCredentials && this.cachedCredentials.expiresAt > now) {
      return this.cachedCredentials.value;
    }

    const fetched = await fetchAwsInstanceCredentials(this.fetchImpl());
    this.cachedCredentials = {
      value: fetched.credentials,
      expiresAt: fetched.expiresAt,
    };
    return fetched.credentials;
  }
}

export function buildVaultUnwrapKeyProvider(input: {
  enterpriseCloudProvider?: string;
  executorMode?: string;
  vaultEncryptionKey?: string;
  azureKeyReleaseUrl?: string;
  azureAttestationToken?: string;
  azureAttestationClientPath?: string;
  azureKeyVaultAccessToken?: string;
  azureKeyReleaseEnc?: string;
  azureKeyReleaseCacheTtlMs?: number;
  azureAttestationProviderUri?: string;
  azureAttestationTokenHash?: string;
  azureKeyReleasePolicyHash?: string;
  azureKeyId?: string;
  azureKeyVersion?: string;
  executorBuildDigest?: string;
  azureConfidentialVmResourceId?: string;
  azureMeasurementSummary?: string;
  gcpProjectId?: string;
  gcpLocation?: string;
  gcpKmsKeyRing?: string;
  gcpKmsKeyName?: string;
  gcpKmsCryptoKeyResource?: string;
  gcpKmsKeyVersion?: string;
  gcpKmsProtectionLevel?: string;
  gcpKmsEncryptedVaultUnwrapKeyBase64?: string;
  gcpKmsAccessToken?: string;
  gcpKmsCacheTtlMs?: number;
  gcpAttestationTokenHash?: string;
  gcpAttestationToken?: string;
  gcpConfidentialVmResourceId?: string;
  gcpMeasurementSummary?: string;
  gcpSecureBoot?: boolean;
  gcpImageDigest?: string;
  gcpServiceAccountEmail?: string;
  gcpAttestationType?: string;
  gcpIsolationProvider?: 'gcp-confidential-vm' | 'gcp-confidential-space';
  awsRegion?: string;
  awsKmsKeyId?: string;
  awsKmsKeyArn?: string;
  awsKmsKeyVersion?: string;
  awsKmsKeySpec?: string;
  awsKmsKeyUsage?: string;
  awsKmsKeyState?: string;
  awsKmsKeyOrigin?: string;
  awsKmsEncryptedVaultUnwrapKeyBase64?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsSessionToken?: string;
  awsKmsCacheTtlMs?: number;
  awsAttestationTokenHash?: string;
  awsAttestationToken?: string;
  awsConfidentialVmResourceId?: string;
  awsMeasurementSummary?: string;
  awsSecureBoot?: boolean;
  awsImageDigest?: string;
  awsRoleArn?: string;
  awsAttestationType?: string;
  awsIsolationProvider?: 'aws-nitro-enclave' | 'aws-ec2';
  fetchImpl?: typeof fetch;
  keyProvider?: VaultUnwrapKeyProvider;
}): VaultUnwrapKeyProvider {
  if (input.keyProvider) return input.keyProvider;

  const mode = (input.executorMode || 'demo').trim().toLowerCase();
  const cloudProvider = (input.enterpriseCloudProvider || 'azure').trim().toLowerCase();
  if (mode === 'confidential') {
    if (cloudProvider === 'gcp' || cloudProvider === 'google' || cloudProvider === 'google-cloud') {
      return new GcpKmsVaultUnwrapKeyProvider({
        projectId: input.gcpProjectId,
        location: input.gcpLocation,
        keyRing: input.gcpKmsKeyRing,
        keyName: input.gcpKmsKeyName,
        cryptoKeyResource: input.gcpKmsCryptoKeyResource,
        keyVersion: input.gcpKmsKeyVersion,
        keyProtectionLevel: input.gcpKmsProtectionLevel,
        encryptedVaultUnwrapKeyBase64: input.gcpKmsEncryptedVaultUnwrapKeyBase64,
        accessToken: input.gcpKmsAccessToken,
        cacheTtlMs: input.gcpKmsCacheTtlMs,
        fetchImpl: input.fetchImpl,
        attestationTokenHash: input.gcpAttestationTokenHash,
        attestationToken: input.gcpAttestationToken,
        executorBuildDigest: input.executorBuildDigest,
        confidentialVmResourceId: input.gcpConfidentialVmResourceId,
        measurementSummary: input.gcpMeasurementSummary,
        secureBoot: input.gcpSecureBoot,
        imageDigest: input.gcpImageDigest,
        serviceAccountEmail: input.gcpServiceAccountEmail,
        attestationType: input.gcpAttestationType,
        isolationProvider: input.gcpIsolationProvider,
      });
    }
    if (cloudProvider === 'aws' || cloudProvider === 'amazon' || cloudProvider === 'amazon-web-services') {
      return new AwsKmsVaultUnwrapKeyProvider({
        region: input.awsRegion,
        keyId: input.awsKmsKeyId,
        keyArn: input.awsKmsKeyArn,
        keyVersion: input.awsKmsKeyVersion,
        keySpec: input.awsKmsKeySpec,
        keyUsage: input.awsKmsKeyUsage,
        keyState: input.awsKmsKeyState,
        keyOrigin: input.awsKmsKeyOrigin,
        encryptedVaultUnwrapKeyBase64: input.awsKmsEncryptedVaultUnwrapKeyBase64,
        accessKeyId: input.awsAccessKeyId,
        secretAccessKey: input.awsSecretAccessKey,
        sessionToken: input.awsSessionToken,
        cacheTtlMs: input.awsKmsCacheTtlMs,
        fetchImpl: input.fetchImpl,
        attestationTokenHash: input.awsAttestationTokenHash,
        attestationToken: input.awsAttestationToken,
        executorBuildDigest: input.executorBuildDigest,
        confidentialVmResourceId: input.awsConfidentialVmResourceId,
        measurementSummary: input.awsMeasurementSummary,
        secureBoot: input.awsSecureBoot,
        imageDigest: input.awsImageDigest,
        roleArn: input.awsRoleArn,
        attestationType: input.awsAttestationType,
        isolationProvider: input.awsIsolationProvider,
      });
    }

    return new AzureSecureKeyReleaseProvider({
      keyReleaseUrl: input.azureKeyReleaseUrl,
      attestationToken: input.azureAttestationToken,
      attestationClientPath: input.azureAttestationClientPath,
      accessToken: input.azureKeyVaultAccessToken,
      releaseEnc: input.azureKeyReleaseEnc,
      cacheTtlMs: input.azureKeyReleaseCacheTtlMs,
      fetchImpl: input.fetchImpl,
      attestationProviderUri: input.azureAttestationProviderUri,
      attestationTokenHash: input.azureAttestationTokenHash,
      keyReleasePolicyHash: input.azureKeyReleasePolicyHash,
      keyId: input.azureKeyId,
      keyVersion: input.azureKeyVersion,
      executorBuildDigest: input.executorBuildDigest,
      confidentialVmResourceId: input.azureConfidentialVmResourceId,
      measurementSummary: input.azureMeasurementSummary,
    });
  }

  if (input.vaultEncryptionKey) {
    return new EnvVaultUnwrapKeyProvider(input.vaultEncryptionKey);
  }

  return new NullVaultUnwrapKeyProvider();
}

function buildGcpKmsCryptoKeyResource(input: {
  projectId?: string;
  location?: string;
  keyRing?: string;
  keyName?: string;
  cryptoKeyResource?: string;
}): string {
  const explicit = input.cryptoKeyResource?.trim();
  if (explicit) return explicit;

  const projectId = input.projectId?.trim();
  const location = input.location?.trim();
  const keyRing = input.keyRing?.trim();
  const keyName = input.keyName?.trim();
  if (!projectId || !location || !keyRing || !keyName) {
    throw new Error('GCP Cloud KMS requires GCP_PROJECT_ID, GCP_LOCATION, GCP_KMS_KEY_RING, and GCP_KMS_KEY_NAME or GCP_KMS_CRYPTO_KEY_RESOURCE.');
  }

  return `projects/${projectId}/locations/${location}/keyRings/${keyRing}/cryptoKeys/${keyName}`;
}

function parseGcpKmsResourcePart(resource: string, partName: string): string | null {
  const parts = resource.split('/');
  const index = parts.indexOf(partName);
  if (index < 0 || index + 1 >= parts.length) return null;
  return parts[index + 1] || null;
}

interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

function getRequiredAwsRegion(region: string | undefined, keyId: string | undefined): string {
  const explicit = region?.trim();
  if (explicit) return explicit;
  const arnRegion = parseAwsArnPart(keyId || '', 'region');
  if (arnRegion) return arnRegion;
  throw new Error('AWS KMS requires AWS_REGION or an AWS KMS key ARN with a region.');
}

function parseAwsArnPart(arn: string | null | undefined, partName: 'region' | 'accountId'): string | null {
  if (!arn?.startsWith('arn:')) return null;
  const parts = arn.split(':');
  if (parts.length < 6) return null;
  if (partName === 'region') return parts[3] || null;
  return parts[4] || null;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

function awsDate(value = new Date()): { amzDate: string; dateStamp: string } {
  const iso = value.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  };
}

function buildAwsAuthorizationHeader(input: {
  credentials: AwsCredentials;
  region: string;
  service: string;
  method: string;
  path: string;
  host: string;
  headers: Record<string, string>;
  payload: string;
  amzDate: string;
  dateStamp: string;
}): { authorization: string; signedHeaders: string } {
  const canonicalHeaderEntries = Object.entries(input.headers)
    .map(([key, value]) => [key.toLowerCase(), String(value).trim().replace(/\s+/g, ' ')] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  const canonicalHeaders = canonicalHeaderEntries.map(([key, value]) => `${key}:${value}\n`).join('');
  const signedHeaders = canonicalHeaderEntries.map(([key]) => key).join(';');
  const payloadHash = sha256Hex(input.payload);
  const canonicalRequest = [
    input.method,
    input.path,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const credentialScope = `${input.dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    input.amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');
  const dateKey = hmac(`AWS4${input.credentials.secretAccessKey}`, input.dateStamp);
  const regionKey = hmac(dateKey, input.region);
  const serviceKey = hmac(regionKey, input.service);
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  return {
    authorization: [
      `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`,
    ].join(', '),
    signedHeaders,
  };
}

async function decryptAwsKmsCiphertext(input: {
  fetchImpl: typeof fetch;
  region: string;
  keyId?: string;
  ciphertextBlob: string;
  credentials: AwsCredentials;
}): Promise<{ plaintext: string; keyId: string | null }> {
  const host = `kms.${input.region}.amazonaws.com`;
  const body: Record<string, unknown> = {
    CiphertextBlob: input.ciphertextBlob,
  };
  if (input.keyId) body.KeyId = input.keyId;
  const payload = JSON.stringify(body);
  const dates = awsDate();
  const headers: Record<string, string> = {
    'content-type': 'application/x-amz-json-1.1',
    host,
    'x-amz-date': dates.amzDate,
    'x-amz-target': 'TrentService.Decrypt',
  };
  if (input.credentials.sessionToken) {
    headers['x-amz-security-token'] = input.credentials.sessionToken;
  }
  const signed = buildAwsAuthorizationHeader({
    credentials: input.credentials,
    region: input.region,
    service: 'kms',
    method: 'POST',
    path: '/',
    host,
    headers,
    payload,
    amzDate: dates.amzDate,
    dateStamp: dates.dateStamp,
  });

  const response = await input.fetchImpl(`https://${host}/`, {
    method: 'POST',
    headers: {
      ...headers,
      authorization: signed.authorization,
    },
    body: payload,
  });
  const responsePayload = await response.json().catch(() => null) as { Plaintext?: string; KeyId?: string; __type?: string; message?: string; Message?: string } | null;
  if (!response.ok || !responsePayload?.Plaintext) {
    throw new Error(responsePayload?.message || responsePayload?.Message || `AWS KMS decrypt failed with ${response.status}`);
  }
  return {
    plaintext: responsePayload.Plaintext,
    keyId: responsePayload.KeyId || null,
  };
}

async function fetchAwsInstanceMetadataToken(fetchImpl: typeof fetch): Promise<string | null> {
  const response = await fetchImpl('http://169.254.169.254/latest/api/token', {
    method: 'PUT',
    headers: {
      'x-aws-ec2-metadata-token-ttl-seconds': '21600',
    },
  }).catch(() => null);
  if (!response?.ok) return null;
  return response.text();
}

async function fetchAwsInstanceCredentials(fetchImpl: typeof fetch): Promise<{ credentials: AwsCredentials; expiresAt: number }> {
  const token = await fetchAwsInstanceMetadataToken(fetchImpl);
  const metadataHeaders = token ? { 'x-aws-ec2-metadata-token': token } : undefined;
  const roleResponse = await fetchImpl('http://169.254.169.254/latest/meta-data/iam/security-credentials/', {
    headers: metadataHeaders,
  });
  const roleName = (await roleResponse.text()).trim().split(/\s+/)[0] || '';
  if (!roleResponse.ok || !roleName) {
    throw new Error(`AWS instance metadata role lookup failed with ${roleResponse.status}`);
  }

  const credentialsResponse = await fetchImpl(`http://169.254.169.254/latest/meta-data/iam/security-credentials/${encodeURIComponent(roleName)}`, {
    headers: metadataHeaders,
  });
  const payload = await credentialsResponse.json().catch(() => null) as {
    AccessKeyId?: string;
    SecretAccessKey?: string;
    Token?: string;
    Expiration?: string;
    Message?: string;
  } | null;
  if (!credentialsResponse.ok || !payload?.AccessKeyId || !payload.SecretAccessKey) {
    throw new Error(payload?.Message || `AWS instance metadata credential lookup failed with ${credentialsResponse.status}`);
  }
  const expiresAt = payload.Expiration ? Date.parse(payload.Expiration) - 5 * 60_000 : Date.now() + 55 * 60_000;
  return {
    credentials: {
      accessKeyId: payload.AccessKeyId,
      secretAccessKey: payload.SecretAccessKey,
      sessionToken: payload.Token,
    },
    expiresAt: Math.max(Date.now() + 60_000, expiresAt),
  };
}

function decodeAttestationClaims(jwt: string): { secureBoot: boolean | null; measurementSummary: string | null } | null {
  try {
    const payload = decodeJwsPayload(jwt);
    const isolationTee = payload['x-ms-isolation-tee'] as Record<string, unknown> | undefined;
    const runtime = isolationTee?.['x-ms-runtime'] as Record<string, unknown> | undefined;
    const vmConfiguration = runtime?.['vm-configuration'] as Record<string, unknown> | undefined;
    const secureBoot = typeof payload.secureboot === 'boolean'
      ? payload.secureboot
      : typeof vmConfiguration?.['secure-boot'] === 'boolean'
        ? vmConfiguration['secure-boot']
        : null;
    const launchMeasurement = typeof isolationTee?.['x-ms-sevsnpvm-launchmeasurement'] === 'string'
      ? isolationTee['x-ms-sevsnpvm-launchmeasurement']
      : null;
    const vmUniqueId = typeof vmConfiguration?.vmUniqueId === 'string'
      ? vmConfiguration.vmUniqueId
      : typeof payload['x-ms-azurevm-vmid'] === 'string'
        ? payload['x-ms-azurevm-vmid']
        : null;
    const tpmEnabled = typeof vmConfiguration?.['tpm-enabled'] === 'boolean'
      ? vmConfiguration['tpm-enabled']
      : null;
    const measurementSummary = [
      'sevsnpvm',
      launchMeasurement ? `launch:${launchMeasurement}` : null,
      vmUniqueId ? `vm:${vmUniqueId}` : null,
      secureBoot !== null ? `secureboot:${secureBoot}` : null,
      tpmEnabled !== null ? `tpm:${tpmEnabled}` : null,
    ].filter(Boolean).join(';');

    return {
      secureBoot,
      measurementSummary: measurementSummary || null,
    };
  } catch {
    return null;
  }
}

function getJwtCacheTtlMs(jwt: string, fallbackMs: number): number {
  try {
    const payload = decodeJwsPayload(jwt) as { exp?: number };
    if (!payload.exp) return fallbackMs;
    const expiresAt = payload.exp * 1000;
    const ttlMs = expiresAt - Date.now() - 5 * 60 * 1000;
    return Math.max(60_000, Math.min(ttlMs, fallbackMs));
  } catch {
    return fallbackMs;
  }
}

function normalizeReleasedKeyCacheTtlMs(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_RELEASED_KEY_CACHE_TTL_MS;
  return Math.max(0, Math.min(Number(value), MAX_RELEASED_KEY_CACHE_TTL_MS));
}

function sha256Base64Url(value: string): string {
  return createHash('sha256')
    .update(value)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function fetchManagedIdentityToken(fetchImpl: typeof fetch): Promise<string> {
  const url = new URL('http://169.254.169.254/metadata/identity/oauth2/token');
  url.searchParams.set('api-version', '2018-02-01');
  url.searchParams.set('resource', 'https://vault.azure.net');

  const response = await fetchImpl(url, {
    headers: {
      Metadata: 'true',
    },
  });

  const payload = await response.json().catch(() => null) as { access_token?: string; error_description?: string } | null;
  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.error_description || `Managed identity token request failed with ${response.status}`);
  }

  return payload.access_token;
}

async function fetchGcpAccessToken(fetchImpl: typeof fetch): Promise<string> {
  const response = await fetchImpl('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
    headers: {
      'Metadata-Flavor': 'Google',
    },
  });

  const payload = await response.json().catch(() => null) as { access_token?: string; error_description?: string } | null;
  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.error_description || `GCP metadata access token request failed with ${response.status}`);
  }

  return payload.access_token;
}

async function releaseAzureKey(input: {
  fetchImpl: typeof fetch;
  keyReleaseUrl: string;
  accessToken: string;
  attestationToken: string;
  enc?: string;
}): Promise<string> {
  const releaseUrl = new URL(input.keyReleaseUrl);
  if (!releaseUrl.searchParams.get('api-version')) {
    releaseUrl.searchParams.set('api-version', '2025-07-01');
  }

  const body: Record<string, string> = {
    target: input.attestationToken,
    nonce: randomUUID(),
  };
  if (input.enc) body.enc = input.enc;

  const response = await input.fetchImpl(releaseUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null) as { value?: string; error?: { message?: string } } | null;
  if (!response.ok || !payload?.value) {
    throw new Error(payload?.error?.message || `Azure Secure Key Release failed with ${response.status}`);
  }

  return payload.value;
}

function extractVaultUnwrapKeyMaterial(releasedKeyJws: string): string {
  const payload = decodeJwsPayload(releasedKeyJws);
  const jwk = pickJwk(payload);
  if (!jwk || typeof jwk !== 'object') {
    throw new Error('Azure Secure Key Release response did not include a JWK payload.');
  }

  const kty = typeof jwk.kty === 'string' ? jwk.kty : '';
  const keyMaterial = typeof jwk.k === 'string' ? jwk.k : '';
  if (!['oct', 'oct-HSM'].includes(kty) || !keyMaterial) {
    if (kty === 'RSA' || kty === 'RSA-HSM') {
      return deriveAes256RootFromReleasedJwk(jwk);
    }

    throw new Error('Azure Secure Key Release must return an oct-HSM symmetric key or RSA-HSM release root for this executor.');
  }

  return base64UrlToBase64(keyMaterial);
}

function deriveAes256RootFromReleasedJwk(jwk: Record<string, unknown>): string {
  const requiredPrivateParts = ['n', 'e', 'd', 'p', 'q', 'dp', 'dq', 'qi'];
  for (const part of requiredPrivateParts) {
    if (typeof jwk[part] !== 'string' || !jwk[part]) {
      throw new Error(`Released RSA-HSM JWK is missing private key material: ${part}`);
    }
  }

  const canonicalPrivateJwk = JSON.stringify(
    Object.fromEntries(
      Object.entries(jwk)
        .filter(([, value]) => typeof value === 'string')
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
  return createHash('sha256')
    .update('vaultproof-enterprise-rsa-hsm-release-root-v1')
    .update('\0')
    .update(canonicalPrivateJwk)
    .digest('base64');
}

function decodeJwsPayload(jws: string): Record<string, unknown> {
  const parts = jws.split('.');
  if (parts.length < 2 || !parts[1]) {
    throw new Error('Azure Secure Key Release response value was not a compact JWS.');
  }

  return JSON.parse(Buffer.from(base64UrlToBase64(parts[1]), 'base64').toString('utf8')) as Record<string, unknown>;
}

function pickJwk(payload: Record<string, unknown>): Record<string, unknown> | null {
  const direct = payload as Record<string, unknown>;
  if (direct.kty || direct.k) return direct;

  const nestedKeys = ['key', 'jwk', 'releasedKey'];
  for (const key of nestedKeys) {
    const value = direct[key];
    if (value && typeof value === 'object') return value as Record<string, unknown>;
  }

  return null;
}

function base64UrlToBase64(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
}
