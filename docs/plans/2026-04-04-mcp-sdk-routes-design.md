# MCP SDK Routes — Port to CF Worker

**Date:** 2026-04-04
**Status:** Approved

## Problem

The MCP server at `mcp.vaultproof.dev` calls backend SDK routes (`/api/v1/sdk/*`) and stats routes (`/api/v1/stats/usage`) that only exist on the old Fastify/Railway backend. The CF Worker at `api.vaultproof.dev` is missing these routes, so all MCP tool calls fail (404/401).

Additionally, `add_key` in the MCP handler sends a raw API key `{ provider, label, value }` but the backend store endpoint expects pre-split Shamir shares `{ share1, share2, provider, label }`. The `get_usage` endpoint uses JWT auth but the MCP authenticates with dev keys. Both were broken even before the Worker migration.

## Design

### 1. New Worker SDK routes — `packages/worker/src/routes/sdk.ts`

Dev-key authenticated routes (auth via `X-API-Key` header → SHA-256 hash → match `developer_keys` table):

- **`GET /keys`** — list active key slots for the dev key's user. Returns `{ keys: [{ id, provider, label, envVar, createdAt }] }`.
- **`POST /store`** — accept pre-split shares (`share1`, `share2`, `provider`, `label`). Encrypt share1 with `VAULT_ENCRYPTION_KEY`, store both shares. Returns `{ keyId, provider, label }`.
- **`POST /revoke`** — accept `{ keyId }`, set status to REVOKED, zero out share data. Returns `{ status: 'revoked' }`.

Wire into `packages/worker/src/index.ts` under `/api/v1/sdk/`.

### 2. Worker stats: dual auth for `/api/v1/stats/usage`

Update `handleStats` to accept dev-key auth as a fallback when JWT is not present. If `X-API-Key` header exists and no `Authorization: Bearer` JWT, authenticate via dev key hash lookup and resolve userId from the developer key's owner.

### 3. MCP handler: Shamir split before sending

Update `add_key` case in `packages/mcp-server/src/mcp/handler.ts`:

1. Import `split`, `serializeShare` from `@vaultproof/shamir`
2. Split raw `value` into 2 Shamir shares (threshold=2, shares=2)
3. Encrypt share2 with the dev key (same as SDK client does)
4. Send `{ share1: serializedShare1, share2: encryptedShare2, provider, label }` to `/api/v1/sdk/store`

The MCP server already has `@vaultproof/shamir` in the monorepo. No new dependency.

### 4. No changes needed

- Transparent proxy (`/v1/*`) — already works
- MCP `callBackend` — HMAC signing unchanged
- MCP `list_keys`, `revoke_key`, `get_proxy_url` handlers — just need Worker routes to exist

## Auth flow (MCP → Worker)

```
MCP Client → OAuth Bearer Token → MCP Server
  → Decrypt session → extract dev key
  → HMAC sign request (X-Proxy-Signature + X-Proxy-Timestamp)
  → X-API-Key: vp_live_... 
  → CF Worker (verify HMAC, then dev key hash lookup)
```

## Files to change

- `packages/worker/src/routes/sdk.ts` — **new file**
- `packages/worker/src/index.ts` — add SDK route handler
- `packages/worker/src/routes/stats.ts` — add dev-key auth fallback
- `packages/mcp-server/src/mcp/handler.ts` — split key in add_key case
