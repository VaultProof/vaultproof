/**
 * @vaultproof/sdk — The simplest way to manage API keys securely.
 *
 * Usage:
 *   const vault = new VaultProof('vp_live_abc123...')
 *   const key = await vault.store('sk-openai-key', 'openai', 'Production')
 *   const res = await vault.proxy(key, '/v1/chat/completions', {
 *     model: 'gpt-4',
 *     messages: [{ role: 'user', content: 'Hello!' }]
 *   })
 *   console.log(res.data)
 */

const DEFAULT_API_URL = 'https://api.vaultproof.dev';

export interface StoredKey {
  id: string;
  provider: string;
  label: string;
  /** Keep this secret — needed for proxy calls */
  share2: string;
}

export interface ProxyResponse {
  status: number;
  data: any;
  ok: boolean;
}

export class VaultProof {
  private apiUrl: string;
  private apiKey: string;
  private keyCache: Map<string, string> = new Map(); // keyId → share2

  /**
   * Create a VaultProof client.
   *
   * @param apiKey - Your developer API key (starts with vp_live_ or vp_test_)
   * @param apiUrl - API URL (default: https://api.vaultproof.dev)
   */
  constructor(apiKey: string, apiUrl?: string) {
    if (!apiKey.startsWith('vp_')) {
      throw new Error('Invalid API key. Must start with vp_live_ or vp_test_');
    }
    this.apiKey = apiKey;
    this.apiUrl = apiUrl || DEFAULT_API_URL;
  }

  /**
   * Store an API key securely.
   * The key is Shamir-split server-side. Share 2 is returned to you.
   *
   * @param apiKey - The API key to store (e.g., 'sk-proj-...')
   * @param provider - 'openai' | 'anthropic' | 'google' | 'together'
   * @param label - Friendly name (e.g., 'Production GPT-4')
   */
  async store(apiKey: string, provider: string, label?: string): Promise<StoredKey> {
    const res = await this.fetch('/api/v1/sdk/store', {
      method: 'POST',
      body: { apiKey, provider, label },
    });

    // Cache share2 for proxy calls
    this.keyCache.set(res.keyId, res.share2);

    return {
      id: res.keyId,
      provider: res.provider,
      label: res.label,
      share2: res.share2,
    };
  }

  /**
   * Make a proxied API call. The stored key is reconstructed for ~100ms, used, then zeroed.
   *
   * @param key - StoredKey from store(), or just the key ID (if share2 is cached)
   * @param path - API endpoint (e.g., '/v1/chat/completions')
   * @param body - Request body
   * @param method - HTTP method (default: 'POST')
   */
  async proxy(
    key: StoredKey | string,
    path: string,
    body?: any,
    method: string = 'POST'
  ): Promise<ProxyResponse> {
    let keyId: string;
    let share2: string;

    if (typeof key === 'string') {
      keyId = key;
      share2 = this.keyCache.get(key) || '';
      if (!share2) throw new Error('Share2 not found. Pass the full StoredKey object or call store() first.');
    } else {
      keyId = key.id;
      share2 = key.share2;
      this.keyCache.set(keyId, share2); // Cache for future calls
    }

    const res = await globalThis.fetch(`${this.apiUrl}/api/v1/sdk/call`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify({ keyId, share2, path, method, body }),
    });

    const data = await res.json().catch(() => null);
    return { status: res.status, data, ok: res.ok };
  }

  /**
   * List all stored keys.
   */
  async keys(): Promise<Array<{ id: string; provider: string; label: string; createdAt: string }>> {
    const res = await this.fetch('/api/v1/sdk/keys');
    return res.keys || [];
  }

  /**
   * Revoke a stored key. Share 1 is destroyed on the server.
   */
  async revoke(keyId: string): Promise<void> {
    await this.fetch('/api/v1/sdk/revoke', { method: 'POST', body: { keyId } });
    this.keyCache.delete(keyId);
  }

  // --- Internal ---

  private async fetch(path: string, opts: { method?: string; body?: any } = {}): Promise<any> {
    const res = await globalThis.fetch(`${this.apiUrl}${path}`, {
      method: opts.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
    return data;
  }
}

export default VaultProof;
