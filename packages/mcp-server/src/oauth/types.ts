export interface OAuthCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;     // S256 challenge stored at auth time
  scope: string;
  userId: string;
  expiresAt: number;         // Unix ms
  encryptedDevKey: string;   // AES-256-GCM encrypted vp_live_ key (base64)
}

export interface McpSession {
  userId: string;
  scope: string;
  clientId: string;
  sessionId: string;         // UUID, for SSE binding
  audience: string;          // Must equal 'https://mcp.vaultproof.dev'
  encryptedDevKey: string;   // AES-256-GCM encrypted vp_live_ key (base64)
  issuedAt: number;          // Unix ms
  authCodeHash: string;      // SHA-256(authCode) — used to detect duplicate code exchange
}

export const REGISTERED_CLIENTS: Record<string, { redirectUris: string[]; name: string }> = {
  'claude-desktop': {
    name: 'Claude Desktop',
    redirectUris: ['https://claude.ai/oauth/callback', 'claude://oauth/callback'],
  },
  cursor: {
    name: 'Cursor',
    redirectUris: ['cursor://oauth/mcp/callback'],
  },
  'vaultproof-cli': {
    name: 'VaultProof CLI',
    redirectUris: ['http://127.0.0.1:8787/callback'],
  },
};

export const VALID_SCOPES = ['keys:read', 'keys:write', 'usage:read'] as const;
export type Scope = typeof VALID_SCOPES[number];
