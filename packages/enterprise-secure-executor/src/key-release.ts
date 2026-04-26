import type { AzureSecureExecutionAttestationEvidence } from '@vaultproof/core';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface VaultUnwrapKeyProvider {
  readonly mode: string;
  readonly hardwareBound: boolean;
  getVaultUnwrapKey(): Promise<string>;
  getAttestationEvidence(): Promise<AzureSecureExecutionAttestationEvidence | null>;
}

export class EnvVaultUnwrapKeyProvider implements VaultUnwrapKeyProvider {
  readonly mode = 'demo-env';
  readonly hardwareBound = false;

  constructor(private readonly vaultEncryptionKey: string) {}

  async getVaultUnwrapKey(): Promise<string> {
    return this.vaultEncryptionKey;
  }

  async getAttestationEvidence(): Promise<AzureSecureExecutionAttestationEvidence | null> {
    return null;
  }
}

export class NullVaultUnwrapKeyProvider implements VaultUnwrapKeyProvider {
  readonly mode = 'not-configured';
  readonly hardwareBound = false;

  async getVaultUnwrapKey(): Promise<string> {
    throw new Error('Vault unwrap key release is not configured.');
  }

  async getAttestationEvidence(): Promise<AzureSecureExecutionAttestationEvidence | null> {
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
    const vaultUnwrapKey = extractSymmetricKeyMaterial(releasedJws);
    const ttlMs = Number.isFinite(this.input.cacheTtlMs) ? Number(this.input.cacheTtlMs) : 60_000;
    this.cachedVaultUnwrapKey = {
      value: vaultUnwrapKey,
      expiresAt: now + Math.max(0, ttlMs),
    };
    return vaultUnwrapKey;
  }

  async getAttestationEvidence(): Promise<AzureSecureExecutionAttestationEvidence | null> {
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

export function buildVaultUnwrapKeyProvider(input: {
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
  fetchImpl?: typeof fetch;
  keyProvider?: VaultUnwrapKeyProvider;
}): VaultUnwrapKeyProvider {
  if (input.keyProvider) return input.keyProvider;

  const mode = (input.executorMode || 'demo').trim().toLowerCase();
  if (mode === 'confidential') {
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

function extractSymmetricKeyMaterial(releasedKeyJws: string): string {
  const payload = decodeJwsPayload(releasedKeyJws);
  const jwk = pickJwk(payload);
  if (!jwk || typeof jwk !== 'object') {
    throw new Error('Azure Secure Key Release response did not include a JWK payload.');
  }

  const kty = typeof jwk.kty === 'string' ? jwk.kty : '';
  const keyMaterial = typeof jwk.k === 'string' ? jwk.k : '';
  if (!['oct', 'oct-HSM'].includes(kty) || !keyMaterial) {
    throw new Error('Azure Secure Key Release must return an oct-HSM symmetric unwrap key for this executor.');
  }

  return base64UrlToBase64(keyMaterial);
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
