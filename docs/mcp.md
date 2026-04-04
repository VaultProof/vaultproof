# VaultProof MCP Server

The MCP (Model Context Protocol) server allows AI assistants and agents to interact with VaultProof programmatically — store keys, check usage, and proxy API calls.

## Live URL

```
https://mcp.vaultproof.dev
```

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `/.well-known/oauth-authorization-server` | OAuth 2.1 metadata discovery |
| `/oauth/authorize` | Start OAuth authorization flow |
| `/oauth/callback` | OAuth callback (handles code exchange) |
| `/oauth/token` | Token exchange (authorization_code grant) |
| `/mcp` | MCP protocol (HTTP + SSE transport) |
| `/health` | Health check |

## MCP Tools

| Tool | Description |
|------|-------------|
| `list-keys` | List user's stored API keys (provider, label, status) |
| `store-key` | Store a new API key with Shamir split |
| `get-usage` | Get usage statistics (calls, errors, limits) |
| `proxy-request` | Proxy an API call through VaultProof |

## OAuth 2.1 Flow

The MCP server uses OAuth 2.1 with PKCE (S256) for authentication:

1. Client sends user to `/oauth/authorize` with `code_challenge`
2. User logs in via VaultProof (Supabase auth)
3. Callback issues an authorization code
4. Client exchanges code at `/oauth/token` with `code_verifier`
5. Server returns an access token (encrypted session)

**Supported scopes:** `keys:read`, `keys:write`, `usage:read`

## Infrastructure

- **Worker:** `vaultproof-mcp` (Cloudflare Workers)
- **KV Namespaces:**
  - `vaultproof-mcp-oauth-codes` — Short-lived authorization codes (60s TTL)
  - `vaultproof-mcp-sessions` — Encrypted session data
  - `vaultproof-mcp-rate-limit` — Per-user rate limiting
- **Secrets:** `PROXY_SECRET`, `MCP_SESSION_ENCRYPTION_KEY`
- **DNS:** CNAME `mcp` → `vaultproof.workers.dev` (proxied)

## Connecting an MCP Client

### Claude Desktop / Claude Code

Add to your MCP config:

```json
{
  "mcpServers": {
    "vaultproof": {
      "url": "https://mcp.vaultproof.dev/mcp"
    }
  }
}
```

The OAuth flow will prompt you to log in on first use.

### Programmatic Access

```typescript
// Discover OAuth metadata
const metadata = await fetch('https://mcp.vaultproof.dev/.well-known/oauth-authorization-server');

// Start OAuth flow with PKCE
// Exchange code for token
// Use token to call MCP tools via /mcp endpoint
```

## Security

- OAuth 2.1 with mandatory PKCE (S256)
- Authorization codes expire after 60 seconds
- Sessions encrypted with AES-256-GCM
- Per-user rate limiting (KV-based)
- SSRF protection on proxy requests
- Tool descriptions are static (no poisoning)
- JWTs and `vp_` keys rejected in tool inputs (no token passthrough)

### Known Limitations

- **Auth code race:** KV lacks compare-and-swap. Mitigated with 60s TTL and `authCodeHash` in sessions.
- **Rate limit counter race:** Concurrent requests can bypass KV counters. Mitigated with `await` on writes.
- Both require Cloudflare Durable Objects for atomic enforcement (planned).

## Deploying

```bash
cd packages/mcp-server
npx wrangler deploy
```

To update secrets:
```bash
npx wrangler secret put PROXY_SECRET
npx wrangler secret put MCP_SESSION_ENCRYPTION_KEY
```
