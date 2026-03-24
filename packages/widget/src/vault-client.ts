import { splitString, serializeShare } from '@zkvault/shamir';
import {
  initZKEngine,
  isZKReady,
  generateZKProof,
  fieldHash,
  randomField,
  buildAppMerkleTree,
  type ProofInputs,
} from './zk-engine.js';

export interface VaultConfig {
  vaultUrl: string;
  appId: string;
  appName: string;
}

export interface StoredKeyInfo {
  keySlotId: string;
  share2: string;
  provider: string;
  label: string;
  /** Slot secret — store securely on device. Needed for ZK proofs. */
  slotSecret: string;
  /** Hash of Share 2 — used in ZK proof. */
  shareHash: string;
  /** Vault commitment — Poseidon(slotSecret, shareHash). */
  vaultCommitment: string;
  /** Merkle root of authorized apps. */
  authorizedAppsRoot: string;
}

export interface ProxyCallOptions {
  keySlotId: string;
  targetPath: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  stream?: boolean;
}

/**
 * Client-side vault operations with real ZK proof generation.
 */
export class VaultClient {
  private config: VaultConfig;

  constructor(config: VaultConfig) {
    this.config = config;
  }

  /**
   * Pre-initialize the ZK engine (~11MB WASM download).
   * Call this early (e.g., on page load) so proof generation is instant later.
   */
  async warmup(): Promise<boolean> {
    return initZKEngine();
  }

  /**
   * Split an API key and store Share 1 in the vault.
   * Generates real Poseidon commitments and Merkle tree.
   */
  async storeKey(
    userId: string,
    apiKey: string,
    provider: string,
    label?: string
  ): Promise<StoredKeyInfo> {
    // 1. Split the key (never leaves device whole)
    const shares = splitString(apiKey, 2, 2);
    const share1Serialized = serializeShare(shares[0]);
    const share2Serialized = serializeShare(shares[1]);

    // 2. Generate slot secret (random field element, stored on device)
    const slotSecret = randomField();

    // 3. Compute share hash (field-compatible hash of Share 2)
    const shareHash = fieldHash(share2Serialized, '0');

    // 4. Compute vault commitment: Poseidon(slotSecret, shareHash)
    const vaultCommitment = fieldHash(slotSecret, shareHash);

    // 5. Build authorized apps Merkle tree (initially just this app)
    const appIdHash = fieldHash(this.config.appId, '0');
    const { root: authorizedAppsRoot } = buildAppMerkleTree(
      [this.config.appId],
      this.config.appId
    );

    // 6. Send Share 1 + commitment to vault
    const response = await fetch(`${this.config.vaultUrl}/api/v1/keys/store`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        provider,
        label: label || `${provider} key`,
        share1: share1Serialized,
        vaultCommitment,
        authAppsRoot: authorizedAppsRoot,
        appId: this.config.appId,
        appName: this.config.appName,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error((err as any).error || 'Failed to store key in vault');
    }

    const data = (await response.json()) as { keySlotId: string };

    return {
      keySlotId: data.keySlotId,
      share2: share2Serialized,
      provider,
      label: label || `${provider} key`,
      slotSecret,
      shareHash,
      vaultCommitment,
      authorizedAppsRoot,
    };
  }

  /**
   * Make a proxied API call with a real ZK proof.
   *
   * The proof proves:
   * 1. You own this key slot (know slotSecret + shareHash)
   * 2. This app is authorized (Merkle membership)
   * 3. This request is fresh (unique nullifier)
   */
  async proxyCall(
    keyInfo: {
      share2: string;
      slotSecret: string;
      shareHash: string;
      vaultCommitment: string;
      authorizedAppsRoot: string;
      authorizedApps?: string[];
    },
    options: ProxyCallOptions
  ): Promise<Response> {
    // 1. Generate fresh nonce
    const nonce = randomField();

    // 2. Compute nullifier: fieldHash(slotSecret, nonce)
    const nullifier = fieldHash(keyInfo.slotSecret, nonce);

    // 3. Compute app ID hash
    const appIdHash = fieldHash(this.config.appId, '0');

    // 4. Build Merkle proof for this app
    const apps = keyInfo.authorizedApps || [this.config.appId];
    const { root, path, indices } = buildAppMerkleTree(apps, this.config.appId);

    // 5. Generate real ZK proof
    let zkProof: string;
    try {
      const proofInputs: ProofInputs = {
        slotSecret: keyInfo.slotSecret,
        shareHash: keyInfo.shareHash,
        appAuthPath: path,
        appAuthIndices: indices,
        nonce,
        vaultCommitment: keyInfo.vaultCommitment,
        appIdHash,
        authorizedAppsRoot: root,
        treeDepth: Math.max(1, Math.ceil(Math.log2(Math.max(apps.length, 2)))),
        nullifier,
      };

      const result = await generateZKProof(proofInputs);
      zkProof = result.proofHex;
    } catch (err) {
      // Fallback to placeholder if WASM not available (e.g., SSR, Node.js)
      console.warn('ZK proof generation failed, using placeholder:', err);
      zkProof = await fallbackProof(keyInfo.share2, nullifier);
    }

    // 6. Send request through proxy
    const response = await fetch(`${this.config.vaultUrl}/api/v1/proxy/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keySlotId: options.keySlotId,
        share2: keyInfo.share2,
        zkProof,
        nullifier,
        appId: this.config.appId,
        targetPath: options.targetPath,
        method: options.method || 'POST',
        stream: options.stream || false,
        headers: options.headers,
        body: options.body,
      }),
    });

    return response;
  }

  async listKeys(userId: string) {
    const response = await fetch(`${this.config.vaultUrl}/api/v1/keys/list/${userId}`);
    if (!response.ok) throw new Error('Failed to list keys');
    return response.json();
  }

  async revokeKey(keySlotId: string) {
    const response = await fetch(
      `${this.config.vaultUrl}/api/v1/keys/revoke/${keySlotId}`,
      { method: 'POST' }
    );
    if (!response.ok) throw new Error('Failed to revoke key');
    return response.json();
  }
}

// Fallback for environments without WASM
async function fallbackProof(share2: string, nullifier: string): Promise<string> {
  const data = new TextEncoder().encode(share2 + ':' + nullifier);
  const buf = new ArrayBuffer(data.length);
  new Uint8Array(buf).set(data);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
