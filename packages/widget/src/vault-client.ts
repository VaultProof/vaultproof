import { splitString, serializeShare, type Share } from '@zkvault/shamir';

export interface VaultConfig {
  vaultUrl: string;
  appId: string;
  appName: string;
}

export interface StoredKeyInfo {
  keySlotId: string;
  share2: string; // base64, stored on device
  provider: string;
  label: string;
}

export interface ProxyCallOptions {
  keySlotId: string;
  targetPath: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

/**
 * Client-side vault operations.
 * Handles Shamir splitting, share storage, and proxied API calls.
 */
export class VaultClient {
  private config: VaultConfig;

  constructor(config: VaultConfig) {
    this.config = config;
  }

  /**
   * Split an API key and store Share 1 in the vault.
   * Share 2 is returned for local device storage.
   */
  async storeKey(
    userId: string,
    apiKey: string,
    provider: string,
    label?: string
  ): Promise<StoredKeyInfo> {
    // 1. Split the key on the client (key never sent whole)
    const shares = splitString(apiKey, 2, 2);

    // Share 1 goes to vault, Share 2 stays on device
    const share1Serialized = serializeShare(shares[0]);
    const share2Serialized = serializeShare(shares[1]);

    // 2. Compute vault commitment (placeholder — will use Poseidon in browser WASM)
    const vaultCommitment = await computeCommitment(share1Serialized, share2Serialized);

    // 3. Send Share 1 to the vault
    const response = await fetch(`${this.config.vaultUrl}/api/v1/keys/store`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        provider,
        label: label || `${provider} key`,
        share1: share1Serialized,
        vaultCommitment,
        appId: this.config.appId,
        appName: this.config.appName,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error((err as any).error || 'Failed to store key in vault');
    }

    const data = await response.json() as { keySlotId: string };

    return {
      keySlotId: data.keySlotId,
      share2: share2Serialized,
      provider,
      label: label || `${provider} key`,
    };
  }

  /**
   * Make a proxied API call through the vault.
   * The vault reconstructs the key ephemerally using both shares.
   */
  async proxyCall(
    share2: string,
    options: ProxyCallOptions
  ): Promise<Response> {
    // Generate a ZK proof (placeholder — will use Noir WASM)
    const nonce = crypto.getRandomValues(new Uint8Array(32));
    const nullifier = await computeNullifier(nonce);
    const zkProof = await generateProof(share2, nullifier);

    const response = await fetch(`${this.config.vaultUrl}/api/v1/proxy/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keySlotId: options.keySlotId,
        share2,
        zkProof,
        nullifier,
        appId: this.config.appId,
        targetPath: options.targetPath,
        method: options.method || 'POST',
        headers: options.headers,
        body: options.body,
      }),
    });

    return response;
  }

  /**
   * List user's key slots from the vault.
   */
  async listKeys(userId: string) {
    const response = await fetch(
      `${this.config.vaultUrl}/api/v1/keys/list/${userId}`
    );
    if (!response.ok) throw new Error('Failed to list keys');
    return response.json();
  }

  /**
   * Revoke a key slot (destroys Share 1 in vault).
   */
  async revokeKey(keySlotId: string) {
    const response = await fetch(
      `${this.config.vaultUrl}/api/v1/keys/revoke/${keySlotId}`,
      { method: 'POST' }
    );
    if (!response.ok) throw new Error('Failed to revoke key');
    return response.json();
  }
}

// --- Crypto helpers (will be replaced with Noir WASM in production) ---

async function sha256(input: string | Uint8Array): Promise<Uint8Array> {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const buf = new ArrayBuffer(data.length);
  new Uint8Array(buf).set(data);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return new Uint8Array(hash);
}

async function computeCommitment(share1: string, share2: string): Promise<string> {
  // MVP: SHA-256 hash of both shares as commitment
  // Production: Poseidon hash via Noir WASM
  return bufToHex(await sha256(share1 + ':' + share2));
}

async function computeNullifier(nonce: Uint8Array): Promise<string> {
  // MVP: SHA-256 of nonce
  // Production: Poseidon hash via Noir WASM
  return bufToHex(await sha256(nonce));
}

async function generateProof(share2: string, nullifier: string): Promise<string> {
  // MVP: Placeholder proof (hash of inputs)
  // Production: Full Noir proof generation via Barretenberg WASM
  return bufToHex(await sha256(share2 + ':' + nullifier));
}

function bufToHex(buf: Uint8Array): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
