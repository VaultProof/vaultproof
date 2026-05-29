export interface SecureExecutionRequest {
  requestId: string;
  projectId: string;
  projectKeyId: string;
  organizationId: string | null;
  provider: string;
  slug: string;
  method: string;
  upstreamPath: string;
  query: string;
  headers: Record<string, string>;
  bodyBase64: string | null;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
  callerLock?: SecureExecutionCallerLock;
  apiInterface?: SecureExecutionApiInterface;
}

export type SecureExecutionApiProtocol = 'rest' | 'graphql' | 'unknown';

export interface SecureExecutionApiInterface {
  protocol: SecureExecutionApiProtocol;
  source: 'auto' | 'manual';
  confidence: 'high' | 'medium' | 'low';
  signals: string[];
}

export interface SecureExecutionCallerLock {
  origin?: string | null;
  refererOrigin?: string | null;
  customerGateway?: string | null;
  clientClass?: 'browser' | 'server' | 'device' | 'iot' | 'gateway' | 'unknown';
  deviceIdHash?: string | null;
  fleetId?: string | null;
  firmwareVersion?: string | null;
  sourceIp?: string | null;
  clientCertificateThumbprint?: string | null;
  clientCertificateSubject?: string | null;
}

export interface SecureExecutionResult {
  requestId: string;
  status: number;
  headers: Record<string, string>;
  bodyBase64: string | null;
  providerRequestId?: string | null;
  attestation?: SecureExecutionAttestationEvidence | null;
  error?: string | null;
}

export interface SignedSecureExecutionEnvelope {
  keyId: string;
  signature: string;
  request: SecureExecutionRequest;
}

export interface AzureSecureExecutionAttestationEvidence {
  provider: 'azure-confidential-vm';
  attestationProviderUri?: string | null;
  attestationTokenHash?: string | null;
  keyReleasePolicyHash?: string | null;
  keyId?: string | null;
  keyVersion?: string | null;
  executorBuildDigest?: string | null;
  confidentialVmResourceId?: string | null;
  claims?: {
    attestationType?: string | null;
    secureBoot?: boolean | null;
    vmIsolation?: string | null;
    measurementSummary?: string | null;
  };
}

export interface GcpSecureExecutionAttestationEvidence {
  provider: 'gcp-confidential-vm' | 'gcp-confidential-space';
  projectId?: string | null;
  location?: string | null;
  attestationTokenHash?: string | null;
  keyId?: string | null;
  keyVersion?: string | null;
  keyProtectionLevel?: 'SOFTWARE' | 'HSM' | 'EXTERNAL' | 'EXTERNAL_VPC' | string | null;
  executorBuildDigest?: string | null;
  confidentialVmResourceId?: string | null;
  claims?: {
    attestationType?: string | null;
    secureBoot?: boolean | null;
    vmIsolation?: string | null;
    measurementSummary?: string | null;
    imageDigest?: string | null;
    serviceAccountEmail?: string | null;
  };
}

export interface AwsSecureExecutionAttestationEvidence {
  provider: 'aws-nitro-enclave' | 'aws-ec2';
  region?: string | null;
  accountId?: string | null;
  attestationTokenHash?: string | null;
  keyId?: string | null;
  keyArn?: string | null;
  keyVersion?: string | null;
  keySpec?: string | null;
  keyUsage?: string | null;
  keyState?: string | null;
  keyOrigin?: string | null;
  executorBuildDigest?: string | null;
  confidentialVmResourceId?: string | null;
  claims?: {
    attestationType?: string | null;
    secureBoot?: boolean | null;
    vmIsolation?: string | null;
    measurementSummary?: string | null;
    imageDigest?: string | null;
    roleArn?: string | null;
  };
}

export type SecureExecutionAttestationEvidence =
  | AzureSecureExecutionAttestationEvidence
  | GcpSecureExecutionAttestationEvidence
  | AwsSecureExecutionAttestationEvidence;

function sortRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.keys(value)
    .sort((a, b) => a.localeCompare(b))
    .reduce<Record<string, unknown>>((acc, key) => {
      const next = value[key];
      if (Array.isArray(next)) {
        acc[key] = next.map((item) => {
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            return sortRecord(item as Record<string, unknown>);
          }
          return item;
        });
        return acc;
      }

      if (next && typeof next === 'object') {
        acc[key] = sortRecord(next as Record<string, unknown>);
        return acc;
      }

      acc[key] = next;
      return acc;
    }, {});
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  const base64 = typeof btoa === 'function'
    ? btoa(binary)
    : Buffer.from(bytes).toString('base64');

  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): Uint8Array | null {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  try {
    if (typeof atob === 'function') {
      const binary = atob(padded);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return bytes;
    }
    return new Uint8Array(Buffer.from(padded, 'base64'));
  } catch {
    return null;
  }
}

async function signBytes(message: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return toBase64Url(new Uint8Array(signature));
}

async function verifyBytes(message: string, signature: string, secret: string): Promise<boolean> {
  const signatureBytes = fromBase64Url(signature);
  if (!signatureBytes) return false;
  const signatureBuffer = signatureBytes.buffer.slice(
    signatureBytes.byteOffset,
    signatureBytes.byteOffset + signatureBytes.byteLength,
  ) as ArrayBuffer;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  return crypto.subtle.verify('HMAC', key, signatureBuffer, encoder.encode(message));
}

export function canonicalizeSecureExecutionRequest(request: SecureExecutionRequest): string {
  return JSON.stringify(sortRecord(request as unknown as Record<string, unknown>));
}

export async function signSecureExecutionRequest(
  request: SecureExecutionRequest,
  secret: string,
): Promise<string> {
  return signBytes(canonicalizeSecureExecutionRequest(request), secret);
}

export async function buildSignedSecureExecutionEnvelope(input: {
  keyId: string;
  secret: string;
  request: SecureExecutionRequest;
}): Promise<SignedSecureExecutionEnvelope> {
  return {
    keyId: input.keyId,
    signature: await signSecureExecutionRequest(input.request, input.secret),
    request: input.request,
  };
}

export async function verifySignedSecureExecutionEnvelope(
  envelope: SignedSecureExecutionEnvelope,
  secret: string,
): Promise<boolean> {
  return verifyBytes(canonicalizeSecureExecutionRequest(envelope.request), envelope.signature, secret);
}

export function isExpiredExecutionRequest(
  request: Pick<SecureExecutionRequest, 'expiresAt'>,
  now = new Date(),
): boolean {
  return new Date(request.expiresAt).getTime() <= now.getTime();
}
