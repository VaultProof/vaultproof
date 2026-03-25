/**
 * @vaultproof/sdk — Store API keys without anyone seeing them. Even us.
 *
 * The SDK splits your API key locally using Shamir Secret Sharing.
 * The full key NEVER leaves your machine. Both shares are encrypted
 * with different keys and stored on our server. To reconstruct,
 * the server needs your vp_live_ key (which it only has temporarily
 * during the proxy call).
 *
 * Usage:
 *   const vault = new VaultProof('vp_live_abc123...')
 *   const key = await vault.store('sk-openai-key', 'openai', 'Production')
 *   const res = await vault.proxy(key.id, '/v1/chat/completions', {
 *     model: 'gpt-4',
 *     messages: [{ role: 'user', content: 'Hello!' }]
 *   })
 */

import { splitString, serializeShare } from '@vaultproof/shamir';

const DEFAULT_API_URL = 'https://api.vaultproof.dev';

export interface StoredKey {
  id: string;
  provider: string;
  label: string;
}

export interface ProxyResponse {
  status: number;
  data: any;
  ok: boolean;
}

export class VaultProof {
  private apiUrl: string;
  private apiKey: string;

  /**
   * Create a VaultProof client.
   * @param apiKey - Your developer API key (vp_live_... or vp_test_...)
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
   *
   * The key is Shamir-split RIGHT HERE on your machine.
   * The full key never leaves this process. Both shares are
   * sent encrypted with different keys.
   */
  async store(apiKey: string, provider: string, label?: string): Promise<StoredKey> {
    // Split the key LOCALLY — it never leaves this machine whole
    const shares = splitString(apiKey, 2, 2);
    const share1 = serializeShare(shares[0]);
    const share2 = serializeShare(shares[1]);

    // Send both shares to the server
    // Share 1 will be encrypted with VAULT_ENCRYPTION_KEY (server secret)
    // Share 2 will be encrypted with OUR vp_live_ key (developer secret)
    // Server can decrypt Share 1 but NOT Share 2 without our key
    const res = await this.fetch('/api/v1/sdk/store', {
      method: 'POST',
      body: { share1, share2, provider, label },
    });

    return {
      id: res.keyId,
      provider: res.provider,
      label: res.label,
    };
  }

  /**
   * Make a proxied API call.
   *
   * The server decrypts both shares (Share 1 with its key, Share 2 with
   * your vp_live_ key sent in the header), combines them for ~100ms,
   * makes the call, then zeros everything.
   *
   * @param keyId - Key ID from store()
   * @param path - API endpoint (e.g., '/v1/chat/completions')
   * @param body - Request body
   * @param method - HTTP method (default: 'POST')
   */
  async proxy(
    keyId: string,
    path: string,
    body?: any,
    method: string = 'POST'
  ): Promise<ProxyResponse> {
    const res = await globalThis.fetch(`${this.apiUrl}/api/v1/sdk/call`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify({ keyId, path, method, body }),
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
   * Revoke a stored key. Both shares are zeroed on the server.
   */
  async revoke(keyId: string): Promise<void> {
    await this.fetch('/api/v1/sdk/revoke', { method: 'POST', body: { keyId } });
  }

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
