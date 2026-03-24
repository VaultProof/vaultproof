/**
 * @zkvault/sdk — Simple SDK for storing and using API keys through ZK Vault.
 *
 * Usage:
 *   const vault = new ZKVault('https://zkvault.riallabs.com');
 *   await vault.login('user@example.com', 'password');
 *   const key = await vault.store('sk-my-openai-key', 'openai', 'Production');
 *   const response = await vault.proxy(key.id, '/v1/chat/completions', {
 *     model: 'gpt-4',
 *     messages: [{ role: 'user', content: 'Hello!' }]
 *   });
 */

import { splitString, serializeShare } from '@zkvault/shamir';

export interface ZKVaultConfig {
  /** Base URL of the ZK Vault API (e.g., 'https://zkvault.riallabs.com') */
  apiUrl: string;
  /** App ID for access control (default: 'sdk') */
  appId?: string;
}

export interface StoredKey {
  /** Key slot ID (UUID) */
  id: string;
  /** Provider name */
  provider: string;
  /** User-friendly label */
  label: string;
  /** Serialized Share 2 (base64) — keep this secret, stored locally */
  share2: string;
  /** Vault commitment hash */
  commitment: string;
}

export interface ProxyResponse {
  status: number;
  data: any;
  ok: boolean;
}

export class ZKVault {
  private apiUrl: string;
  private appId: string;
  private token: string | null = null;

  constructor(config: string | ZKVaultConfig) {
    if (typeof config === 'string') {
      this.apiUrl = config;
      this.appId = 'sdk';
    } else {
      this.apiUrl = config.apiUrl;
      this.appId = config.appId || 'sdk';
    }
  }

  /**
   * Set an existing JWT token (if you already have one).
   */
  setToken(token: string): void {
    this.token = token;
  }

  /**
   * Register a new account.
   */
  async register(email: string, password: string): Promise<{ token: string; userId: string }> {
    const res = await this.fetch('/api/v1/auth/register', {
      method: 'POST',
      body: { email, password },
    });
    this.token = res.token;
    return { token: res.token, userId: res.user.id };
  }

  /**
   * Login to an existing account.
   */
  async login(email: string, password: string): Promise<{ token: string; userId: string }> {
    const res = await this.fetch('/api/v1/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    this.token = res.token;
    return { token: res.token, userId: res.user.id };
  }

  /**
   * Store an API key. Shamir-splits it client-side, sends only Share 1 to vault.
   *
   * @param apiKey - Your API key (e.g., 'sk-proj-...')
   * @param provider - Provider name: 'openai', 'anthropic', 'google', 'together'
   * @param label - Friendly label (e.g., 'Production GPT-4')
   * @returns StoredKey object — save the `share2` field securely!
   */
  async store(apiKey: string, provider: string, label?: string): Promise<StoredKey> {
    this.requireAuth();

    // Split the key — it's destroyed after this
    const shares = splitString(apiKey, 2, 2);
    const share1 = serializeShare(shares[0]);
    const share2 = serializeShare(shares[1]);

    // Compute commitment
    const commitment = await this.sha256(share1 + ':' + share2);

    const res = await this.fetch('/api/v1/keys/store', {
      method: 'POST',
      body: {
        provider,
        label: label || `${provider} key`,
        share1,
        vaultCommitment: commitment,
        appId: this.appId,
        appName: `ZK Vault SDK (${this.appId})`,
      },
      auth: true,
    });

    return {
      id: res.keySlotId,
      provider,
      label: label || `${provider} key`,
      share2,
      commitment,
    };
  }

  /**
   * Make a proxied API call through ZK Vault.
   * The key is reconstructed ephemerally — never stored whole on the server.
   *
   * @param keyId - Key slot ID from store()
   * @param share2 - Share 2 from store() result
   * @param targetPath - API endpoint (e.g., '/v1/chat/completions')
   * @param body - Request body (for POST/PUT)
   * @param method - HTTP method (default: 'POST')
   */
  async proxy(
    keyId: string,
    share2: string,
    targetPath: string,
    body?: any,
    method: string = 'POST'
  ): Promise<ProxyResponse> {
    const nullifier = this.randomId();
    const proof = await this.sha256(share2 + ':' + nullifier);

    const res = await fetch(`${this.apiUrl}/api/v1/proxy/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keySlotId: keyId,
        share2,
        zkProof: proof,
        nullifier,
        appId: this.appId,
        targetPath,
        method,
        body,
      }),
    });

    const data = await res.json().catch(() => null);
    return { status: res.status, data, ok: res.ok };
  }

  /**
   * List all your stored keys.
   */
  async list(): Promise<Array<{ id: string; provider: string; label: string; status: string; createdAt: string }>> {
    this.requireAuth();
    const res = await this.fetch('/api/v1/keys/list', { auth: true });
    return res.keySlots || [];
  }

  /**
   * Revoke a key (destroys Share 1 on the server).
   */
  async revoke(keyId: string): Promise<void> {
    this.requireAuth();
    await this.fetch(`/api/v1/keys/revoke/${keyId}`, { method: 'POST', auth: true });
  }

  /**
   * Get usage stats.
   */
  async stats(): Promise<{ totalKeys: number; totalCalls: number; errorRate: number; activeApps: number }> {
    this.requireAuth();
    return this.fetch('/api/v1/stats/overview', { auth: true });
  }

  // --- Helpers ---

  private requireAuth() {
    if (!this.token) throw new Error('Not authenticated. Call login() or setToken() first.');
  }

  private async fetch(path: string, opts: { method?: string; body?: any; auth?: boolean } = {}): Promise<any> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (opts.auth && this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await globalThis.fetch(`${this.apiUrl}${path}`, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Request failed: ${res.status}`);
    }
    return data;
  }

  private randomId(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  private async sha256(input: string): Promise<string> {
    const data = new TextEncoder().encode(input);
    const buf = new ArrayBuffer(data.length);
    new Uint8Array(buf).set(data);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
}

export default ZKVault;
