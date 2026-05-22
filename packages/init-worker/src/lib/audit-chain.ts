import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  sign as signWithPrivateKey,
  verify as verifyWithPublicKey,
} from 'node:crypto';
import type { Env } from '../types.js';

export const AUDIT_CHAIN_VERSION = 1;
export const AUDIT_CHAIN_GENESIS_HASH = '0'.repeat(64);
const ED25519_SIGNATURE_PAYLOAD_PREFIX = 'vaultproof-audit-chain-v1';

export interface ProjectAccessLogAuditInput {
  project_id: string;
  project_key_id: string;
  slug: string;
  provider: string;
  method: string;
  upstream_path: string;
  status_code: number;
  latency_ms: number;
  error?: string | null;
  metadata?: Record<string, unknown> | null;
  timestamp: string;
}

export interface ProjectAccessLogAuditEvent {
  version: number;
  timestamp: string;
  project_id: string;
  project_key_id: string;
  slug: string;
  provider: string;
  method: string;
  upstream_path_hash: string;
  status_code: number;
  latency_ms: number;
  error: string | null;
  metadata_hash: string;
}

export interface AuditChainProof {
  version: number;
  event_hash: string;
  previous_hash: string;
  chain_hash: string;
  signature: string | null;
  signature_algorithm: 'ed25519' | 'hmac-sha256' | null;
  signature_key_id: string | null;
  public_key_spki_sha256: string | null;
  signed_at: string | null;
}

export interface AuditSigningPublicKeyInfo {
  algorithm: 'ed25519';
  key_id: string;
  public_key_spki_b64: string;
  public_key_spki_sha256: string;
}

function normalizeForJson(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(normalizeForJson);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      const normalized = normalizeForJson(obj[key]);
      if (normalized !== undefined) out[key] = normalized;
    }
    return out;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeForJson(value));
}

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function base64Url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function stripAuditChainMetadata(metadata: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!metadata) return {};
  const { audit_chain: _auditChain, ...rest } = metadata;
  return rest;
}

export function buildProjectAccessLogAuditEvent(input: ProjectAccessLogAuditInput): ProjectAccessLogAuditEvent {
  const metadata = stripAuditChainMetadata(input.metadata);
  return {
    version: AUDIT_CHAIN_VERSION,
    timestamp: input.timestamp,
    project_id: input.project_id,
    project_key_id: input.project_key_id,
    slug: input.slug,
    provider: input.provider,
    method: input.method.toUpperCase(),
    upstream_path_hash: sha256Hex(input.upstream_path),
    status_code: input.status_code,
    latency_ms: input.latency_ms,
    error: input.error ?? null,
    metadata_hash: sha256Hex(canonicalJson(metadata)),
  };
}

function getEd25519PrivateKey(env: Env): ReturnType<typeof createPrivateKey> | null {
  const raw = env.AUDIT_CHAIN_ED25519_PRIVATE_KEY_B64?.trim();
  if (!raw) return null;
  return createPrivateKey({
    key: Buffer.from(raw, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
}

function signaturePayload(chainHash: string): Buffer {
  return Buffer.from(`${ED25519_SIGNATURE_PAYLOAD_PREFIX}\n${chainHash}`, 'utf8');
}

function signingKeyId(publicKeyDer: Buffer, configuredKeyId?: string): string {
  return configuredKeyId?.trim() || sha256Hex(publicKeyDer).slice(0, 24);
}

export function getAuditSigningPublicKeyInfo(env: Env): AuditSigningPublicKeyInfo | null {
  const privateKey = getEd25519PrivateKey(env);
  if (!privateKey) return null;
  const publicKeyDer = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }) as Buffer;
  return {
    algorithm: 'ed25519',
    key_id: signingKeyId(publicKeyDer, env.AUDIT_CHAIN_KEY_ID),
    public_key_spki_b64: publicKeyDer.toString('base64'),
    public_key_spki_sha256: sha256Hex(publicKeyDer),
  };
}

function signChainHash(chainHash: string, env: Env): Pick<
  AuditChainProof,
  'signature' | 'signature_algorithm' | 'signature_key_id' | 'public_key_spki_sha256' | 'signed_at'
> {
  const privateKey = getEd25519PrivateKey(env);
  if (privateKey) {
    const publicKeyDer = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }) as Buffer;
    return {
      signature: base64Url(signWithPrivateKey(null, signaturePayload(chainHash), privateKey)),
      signature_algorithm: 'ed25519',
      signature_key_id: signingKeyId(publicKeyDer, env.AUDIT_CHAIN_KEY_ID),
      public_key_spki_sha256: sha256Hex(publicKeyDer),
      signed_at: new Date().toISOString(),
    };
  }

  const hmacKey = env.AUDIT_CHAIN_HMAC_KEY?.trim();
  if (hmacKey) {
    return {
      signature: createHmac('sha256', hmacKey).update(signaturePayload(chainHash)).digest('base64url'),
      signature_algorithm: 'hmac-sha256',
      signature_key_id: env.AUDIT_CHAIN_KEY_ID?.trim() || sha256Hex(hmacKey).slice(0, 24),
      public_key_spki_sha256: null,
      signed_at: new Date().toISOString(),
    };
  }

  return {
    signature: null,
    signature_algorithm: null,
    signature_key_id: null,
    public_key_spki_sha256: null,
    signed_at: null,
  };
}

export function buildAuditChainProof(
  input: ProjectAccessLogAuditInput,
  previousHash: string | null,
  env: Env,
): AuditChainProof {
  const event = buildProjectAccessLogAuditEvent(input);
  const eventHash = sha256Hex(canonicalJson(event));
  const normalizedPreviousHash = previousHash || AUDIT_CHAIN_GENESIS_HASH;
  const chainHash = sha256Hex(canonicalJson({
    event_hash: eventHash,
    previous_hash: normalizedPreviousHash,
    version: AUDIT_CHAIN_VERSION,
  }));
  return {
    version: AUDIT_CHAIN_VERSION,
    event_hash: eventHash,
    previous_hash: normalizedPreviousHash,
    chain_hash: chainHash,
    ...signChainHash(chainHash, env),
  };
}

export function extractAuditChainProof(metadata: Record<string, unknown> | null | undefined): AuditChainProof | null {
  const proof = metadata?.audit_chain;
  if (!proof || typeof proof !== 'object') return null;
  const p = proof as Partial<AuditChainProof>;
  if (
    p.version !== AUDIT_CHAIN_VERSION ||
    typeof p.event_hash !== 'string' ||
    typeof p.previous_hash !== 'string' ||
    typeof p.chain_hash !== 'string'
  ) {
    return null;
  }
  return {
    version: AUDIT_CHAIN_VERSION,
    event_hash: p.event_hash,
    previous_hash: p.previous_hash,
    chain_hash: p.chain_hash,
    signature: typeof p.signature === 'string' ? p.signature : null,
    signature_algorithm: p.signature_algorithm === 'ed25519' || p.signature_algorithm === 'hmac-sha256'
      ? p.signature_algorithm
      : null,
    signature_key_id: typeof p.signature_key_id === 'string' ? p.signature_key_id : null,
    public_key_spki_sha256: typeof p.public_key_spki_sha256 === 'string' ? p.public_key_spki_sha256 : null,
    signed_at: typeof p.signed_at === 'string' ? p.signed_at : null,
  };
}

export function verifyEd25519AuditSignature(
  chainHash: string,
  signatureBase64Url: string,
  publicKeySpkiB64: string,
): boolean {
  const publicKey = createPublicKey({
    key: Buffer.from(publicKeySpkiB64, 'base64'),
    format: 'der',
    type: 'spki',
  });
  const normalized = signatureBase64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return verifyWithPublicKey(null, signaturePayload(chainHash), publicKey, Buffer.from(padded, 'base64'));
}
