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

const DEFAULT_API_URL = undefined;
const DEFAULT_DIRECT_URL = undefined;

export interface VaultProofOptions {
  /** API URL routed through the edge proxy */
  apiUrl?: string;
  /** Direct backend URL — skips the edge proxy for faster SDK calls */
  directUrl?: string;
  /** Session token (from /dev-keys/:id/session) */
  sessionToken?: string;
}

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
  private apiUrl: string | undefined;
  private directUrl: string | undefined;
  private apiKey: string;
  private sessionToken?: string;

  /**
   * Create a VaultProof client.
   * @param apiKey - Your developer API key (vp_live_... or vp_test_...)
   * @param options - Configuration options, or a string for backwards-compatible apiUrl
   * @param sessionToken - Deprecated: use options.sessionToken instead
   */
  constructor(apiKey: string, options?: string | VaultProofOptions, sessionToken?: string) {
    if (!apiKey.startsWith('vp_')) {
      throw new Error('Invalid API key. Must start with vp_live_ or vp_test_');
    }
    this.apiKey = apiKey;

    // Backwards compatible: second arg can be a string (apiUrl) or options object
    if (typeof options === 'string') {
      this.apiUrl = options || DEFAULT_API_URL;
      this.directUrl = DEFAULT_DIRECT_URL;
      this.sessionToken = sessionToken;
    } else {
      this.apiUrl = options?.apiUrl || DEFAULT_API_URL;
      this.directUrl = options?.directUrl || DEFAULT_DIRECT_URL;
      this.sessionToken = options?.sessionToken || sessionToken;
    }
  }

  /** Update the session token (e.g., after refresh). */
  setSessionToken(token: string): void {
    this.sessionToken = token;
  }

  /**
   * Store an API key securely.
   *
   * The key is Shamir-split RIGHT HERE on your machine.
   * The full key never leaves this process. Both shares are
   * sent encrypted with different keys.
   */
  async store(apiKey: string, provider: string, label?: string): Promise<StoredKey> {
    const shares = splitString(apiKey, 2, 2);
    const share1 = serializeShare(shares[0]);
    const share2 = serializeShare(shares[1]);

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
   */
  async proxy(
    keyId: string,
    path: string,
    body?: any,
    method: string = 'POST'
  ): Promise<ProxyResponse> {
    const proxyHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-API-Key': this.apiKey,
    };

    if (this.sessionToken) {
      proxyHeaders['X-VaultProof-Session'] = this.sessionToken;
    }

    const res = await globalThis.fetch(`${this.directUrl}/api/v1/sdk/call`, {
      method: 'POST',
      headers: proxyHeaders,
      body: JSON.stringify({ keyId, path, method, body }),
    });

    const data = await res.json().catch(() => null);
    return { status: res.status, data, ok: res.ok };
  }

  /**
   * Retrieve the raw API key from VaultProof.
   *
   * The key is reconstructed server-side from both encrypted shares
   * and returned over TLS. Use this for providers that aren't supported
   * by the transparent proxy (e.g., Stripe, Supabase, SMTP).
   */
  async retrieve(keyId: string): Promise<{ apiKey: string; provider: string }> {
    const res = await this.fetch('/api/v1/sdk/retrieve', {
      method: 'POST',
      body: { keyId },
      direct: true,
    });
    return { apiKey: res.apiKey, provider: res.provider };
  }

  /**
   * Retrieve multiple API keys in a single round trip.
   * Much faster than calling retrieve() in a loop when you need several keys.
   */
  async retrieveBatch(keyIds: string[]): Promise<Array<{ keyId: string; apiKey?: string; provider?: string; error?: string }>> {
    const res = await this.fetch('/api/v1/sdk/retrieve-batch', {
      method: 'POST',
      body: { keyIds },
      direct: true,
    });
    return res.keys || [];
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

  private async fetch(path: string, opts: { method?: string; body?: any; direct?: boolean } = {}): Promise<any> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-API-Key': this.apiKey,
    };

    if (this.sessionToken) {
      headers['X-VaultProof-Session'] = this.sessionToken;
    }

    const baseUrl = opts.direct ? this.directUrl : this.apiUrl;
    const res = await globalThis.fetch(`${baseUrl}${path}`, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
    return data;
  }
}

export default VaultProof;
