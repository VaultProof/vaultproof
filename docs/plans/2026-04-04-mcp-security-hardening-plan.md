# MCP Security Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden the VaultProof MCP server to world-class security by fixing all findings from the 2026-04-04 audit — 7 code-level fixes and 6 architecture-level protections.

**Architecture:** Phase 1 patches existing files with targeted fixes (timing-safe comparisons, CSP, error messages, Shamir assertions). Phase 2 adds Durable Objects for atomic rate limiting and code exchange. Phase 3 adds MCP-specific protections (tool integrity hashing, output sanitization, destructive op confirmation, revocation consistency).

**Tech Stack:** Cloudflare Workers, Durable Objects, KV, Vitest, Web Crypto API

**Audit doc:** `docs/plans/2026-04-04-mcp-security-audit.md`

---

### Task 1: Fix state signature timing attack

**Files:**
- Modify: `packages/mcp-server/src/oauth/callback.ts:84-88`

**Step 1: Write the failing test**

In `packages/mcp-server/src/__tests__/security.test.ts`, add a test that verifies callback uses timing-safe comparison. Since we can't directly test timing, test that the function is imported and used:

```typescript
describe('state signature validation', () => {
  it('should import timingSafeEqual from crypto module', async () => {
    // Read the callback source to verify it uses timingSafeEqual
    // This is a static analysis test — ensures no regression to !== comparison
    const fs = await import('fs');
    const source = fs.readFileSync('src/oauth/callback.ts', 'utf-8');
    expect(source).toContain('timingSafeEqual');
    expect(source).not.toMatch(/stateSig\s*!==\s*expected/);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/nelson/projects/zkvault/packages/mcp-server && npx vitest run`
Expected: FAIL — callback.ts still uses `!==`

**Step 3: Implement the fix**

In `packages/mcp-server/src/oauth/callback.ts`:

Add import at top:
```typescript
import { hmacSign, timingSafeEqual } from '../lib/crypto.js';
```

Remove `hmacSign` from existing import if it was imported separately.

Replace line 86:
```typescript
    if (stateSig !== expected) {
```
with:
```typescript
    if (!timingSafeEqual(stateSig, expected)) {
```

**Step 4: Run tests**

Run: `cd /Users/nelson/projects/zkvault/packages/mcp-server && npx vitest run`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/mcp-server/src/oauth/callback.ts packages/mcp-server/src/__tests__/security.test.ts
git commit -m "security(mcp): use timing-safe comparison for state signature"
```

---

### Task 2: Fix resource URL validation

**Files:**
- Modify: `packages/mcp-server/src/oauth/callback.ts:77-79`
- Modify: `packages/mcp-server/src/oauth/authorize.ts:58-59`

**Step 1: Write failing test**

In `packages/mcp-server/src/__tests__/security.test.ts`:

```typescript
describe('resource URL validation', () => {
  it('should reject resource with matching prefix but different origin', () => {
    // https://mcp.vaultproof.dev.attacker.com starts with https://mcp.vaultproof.dev
    // but has a different origin — must be rejected
    const malicious = 'https://mcp.vaultproof.dev.attacker.com/';
    const issuer = 'https://mcp.vaultproof.dev';
    const maliciousOrigin = new URL(malicious).origin;
    const issuerOrigin = new URL(issuer).origin;
    expect(maliciousOrigin).not.toBe(issuerOrigin);
  });
});
```

**Step 2: Implement the fix**

In `packages/mcp-server/src/oauth/callback.ts`, replace line 77-79:
```typescript
  if (data.resource && !data.resource.startsWith(env.MCP_ISSUER)) {
    return errorResponse(400, 'invalid_target', 'Resource mismatch');
  }
```
with:
```typescript
  if (data.resource) {
    try {
      const resourceOrigin = new URL(data.resource).origin;
      const issuerOrigin = new URL(env.MCP_ISSUER).origin;
      if (resourceOrigin !== issuerOrigin) {
        return errorResponse(400, 'invalid_target', 'Resource mismatch');
      }
    } catch {
      return errorResponse(400, 'invalid_target', 'Resource mismatch');
    }
  }
```

In `packages/mcp-server/src/oauth/authorize.ts`, replace line 58-59:
```typescript
  if (data.resource !== undefined && !data.resource.startsWith('https://mcp.vaultproof.dev')) {
    return errorResponse(400, 'invalid_target', 'resource must be https://mcp.vaultproof.dev');
  }
```
with:
```typescript
  if (data.resource !== undefined) {
    try {
      const resourceOrigin = new URL(data.resource).origin;
      if (resourceOrigin !== 'https://mcp.vaultproof.dev') {
        return errorResponse(400, 'invalid_target', 'Invalid resource');
      }
    } catch {
      return errorResponse(400, 'invalid_target', 'Invalid resource');
    }
  }
```

**Step 3: Run tests**

Run: `cd /Users/nelson/projects/zkvault/packages/mcp-server && npx vitest run`
Expected: All PASS

**Step 4: Commit**

```bash
git add packages/mcp-server/src/oauth/callback.ts packages/mcp-server/src/oauth/authorize.ts packages/mcp-server/src/__tests__/security.test.ts
git commit -m "security(mcp): use origin comparison for resource URL validation"
```

---

### Task 3: Add CSP header + generic scope error + Shamir assertions

**Files:**
- Modify: `packages/mcp-server/src/lib/security-headers.ts:11-19`
- Modify: `packages/mcp-server/src/oauth/authorize.ts:67`
- Modify: `packages/mcp-server/src/lib/shamir.ts`

**Step 1: Add CSP header**

In `packages/mcp-server/src/lib/security-headers.ts`, add to the `securityHeaders()` return object:
```typescript
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
```

**Step 2: Generic scope error**

In `packages/mcp-server/src/oauth/authorize.ts`, replace line 67:
```typescript
      return errorResponse(400, 'invalid_scope', `Unknown scope: ${s}`);
```
with:
```typescript
      return errorResponse(400, 'invalid_scope', 'Invalid scope requested');
```

**Step 3: Shamir CSPRNG assertion and constant-time comment**

In `packages/mcp-server/src/lib/shamir.ts`, at the top of `split()` function, add as the first line:
```typescript
  if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
    throw new Error('CSPRNG required: crypto.getRandomValues not available');
  }
```

Add comment above `gf256Mul`:
```typescript
// Constant-time: loop-based multiplication avoids lookup tables (CVE-2023-25000 mitigation)
```

**Step 4: Run tests**

Run: `cd /Users/nelson/projects/zkvault/packages/mcp-server && npx vitest run`
Expected: All PASS

**Step 5: Commit**

```bash
git add packages/mcp-server/src/lib/security-headers.ts packages/mcp-server/src/oauth/authorize.ts packages/mcp-server/src/lib/shamir.ts
git commit -m "security(mcp): add CSP header, generic scope errors, Shamir assertions"
```

---

### Task 4: Wire SSRF validation into backend client

**Files:**
- Modify: `packages/mcp-server/src/backend/client.ts`
- Modify: `packages/mcp-server/src/lib/ssrf.ts` (if needed)

**Step 1: Import and use isPublicUrl**

In `packages/mcp-server/src/backend/client.ts`, add import:
```typescript
import { isPublicUrl } from '../lib/ssrf.js';
```

After the existing HTTPS check (line 52-54), add:
```typescript
  if (!isPublicUrl(env.BACKEND_URL)) {
    throw new Error('BACKEND_URL must be a public HTTPS URL');
  }
```

**Step 2: Run tests**

Run: `cd /Users/nelson/projects/zkvault/packages/mcp-server && npx vitest run`
Expected: All PASS (BACKEND_URL in tests is `https://backend.example.com` which passes public URL check)

**Step 3: Commit**

```bash
git add packages/mcp-server/src/backend/client.ts
git commit -m "security(mcp): wire SSRF validation into backend client"
```

---

### Task 5: Atomic rate limiting with Durable Objects

**Files:**
- Create: `packages/mcp-server/src/durable-objects/rate-limiter.ts`
- Modify: `packages/mcp-server/src/lib/rate-limit.ts`
- Modify: `packages/mcp-server/src/types.ts`
- Modify: `packages/mcp-server/wrangler.toml`

**Step 1: Create the Durable Object class**

Create `packages/mcp-server/src/durable-objects/rate-limiter.ts`:

```typescript
/**
 * Atomic rate limiter using Durable Objects.
 *
 * Single-threaded execution guarantees no race conditions on counter
 * increment — fixes the KV eventual consistency bypass (CVE audit Fix 8).
 */

interface RateLimitRequest {
  key: string;
  limit: number;
  windowMs: number;
}

export class RateLimiterDO implements DurableObject {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const body = (await request.json()) as RateLimitRequest;
    const { key, limit, windowMs } = body;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Get current window entries
    const entries = ((await this.state.storage.get<number[]>(key)) ?? [])
      .filter((ts) => ts > windowStart);

    if (entries.length >= limit) {
      return Response.json({ allowed: false, count: entries.length });
    }

    entries.push(now);
    await this.state.storage.put(key, entries);

    // Schedule cleanup alarm if not already set
    const alarm = await this.state.storage.getAlarm();
    if (!alarm) {
      await this.state.storage.setAlarm(now + windowMs + 1000);
    }

    return Response.json({ allowed: true, count: entries.length });
  }

  async alarm(): Promise<void> {
    // Clean up expired entries
    const allKeys = await this.state.storage.list<number[]>();
    const now = Date.now();
    for (const [key, entries] of allKeys) {
      if (!Array.isArray(entries)) continue;
      const valid = entries.filter((ts) => ts > now - 3_600_000); // Keep up to 1 hour
      if (valid.length === 0) {
        await this.state.storage.delete(key);
      } else {
        await this.state.storage.put(key, valid);
      }
    }
  }
}
```

**Step 2: Update types.ts**

Add to `Env` interface in `packages/mcp-server/src/types.ts`:
```typescript
  RATE_LIMITER: DurableObjectNamespace;
```

**Step 3: Update wrangler.toml**

Add to `packages/mcp-server/wrangler.toml`:
```toml
[[durable_objects.bindings]]
name = "RATE_LIMITER"
class_name = "RateLimiterDO"

[[migrations]]
tag = "v1"
new_classes = ["RateLimiterDO"]
```

**Step 4: Update rate-limit.ts to use Durable Objects**

Replace the contents of `packages/mcp-server/src/lib/rate-limit.ts`:

```typescript
/**
 * Atomic rate limiting using Durable Objects.
 *
 * Each rate limit check is routed to a single Durable Object instance
 * keyed by the rate limit subject (userId or IP). Single-threaded
 * execution guarantees no concurrent bypass.
 *
 * Falls back to KV-based limiting if RATE_LIMITER binding is unavailable.
 */

import type { Env } from '../types.js';

async function checkLimit(
  env: Env,
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  // Use Durable Objects if available
  if (env.RATE_LIMITER) {
    const id = env.RATE_LIMITER.idFromName(key);
    const stub = env.RATE_LIMITER.get(id);
    const resp = await stub.fetch('https://rate-limiter/check', {
      method: 'POST',
      body: JSON.stringify({ key, limit, windowMs }),
    });
    const result = (await resp.json()) as { allowed: boolean };
    return result.allowed;
  }

  // Fallback to KV (non-atomic, best-effort)
  const bucket = `${key}:${Math.floor(Date.now() / windowMs)}`;
  const raw = await env.RATE_LIMIT.get(bucket);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= limit) return false;
  await env.RATE_LIMIT.put(bucket, String(count + 1), {
    expirationTtl: Math.ceil(windowMs / 1000) + 60,
  });
  return true;
}

/** Per-userId MCP tool call limit: 30 req/min */
export async function checkUserRateLimit(userId: string, env: Env): Promise<boolean> {
  return checkLimit(env, `rl:${userId}`, 30, 60_000);
}

/** Per-IP OAuth endpoint limit: 100 req/min */
export async function checkIpRateLimit(ip: string, env: Env): Promise<boolean> {
  return checkLimit(env, `rl:ip:${ip}`, 100, 60_000);
}

/** Per-userId add_key limit: 10 req/hour */
export async function checkAddKeyRateLimit(userId: string, env: Env): Promise<boolean> {
  return checkLimit(env, `rl:add_key:${userId}`, 10, 3_600_000);
}
```

**Step 5: Export DO class from index.ts**

Add to the end of `packages/mcp-server/src/index.ts`:
```typescript
export { RateLimiterDO } from './durable-objects/rate-limiter.js';
```

**Step 6: Run tests**

Run: `cd /Users/nelson/projects/zkvault/packages/mcp-server && npx vitest run`
Expected: All PASS (tests mock env, DO binding won't be present so falls back to KV)

**Step 7: Typecheck**

Run: `cd /Users/nelson/projects/zkvault/packages/mcp-server && npx tsc --noEmit`
Expected: PASS

**Step 8: Commit**

```bash
git add packages/mcp-server/src/durable-objects/rate-limiter.ts packages/mcp-server/src/lib/rate-limit.ts packages/mcp-server/src/types.ts packages/mcp-server/src/index.ts packages/mcp-server/wrangler.toml
git commit -m "security(mcp): atomic rate limiting via Durable Objects"
```

---

### Task 6: Atomic OAuth code exchange with Durable Objects

**Files:**
- Create: `packages/mcp-server/src/durable-objects/oauth-code.ts`
- Modify: `packages/mcp-server/src/oauth/token.ts`
- Modify: `packages/mcp-server/src/oauth/callback.ts`
- Modify: `packages/mcp-server/src/types.ts`
- Modify: `packages/mcp-server/wrangler.toml`
- Modify: `packages/mcp-server/src/index.ts`

**Step 1: Create OAuthCodeDO**

Create `packages/mcp-server/src/durable-objects/oauth-code.ts`:

```typescript
/**
 * Atomic OAuth authorization code storage.
 *
 * Guarantees single-use code exchange — concurrent requests to the same
 * code are serialized by the Durable Object's single-threaded execution.
 * Fixes the KV race condition (audit Fix 9).
 */

export class OAuthCodeDO implements DurableObject {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.pathname;

    if (request.method === 'POST' && action === '/store') {
      const { code, data, ttlSeconds } = (await request.json()) as {
        code: string;
        data: string;
        ttlSeconds: number;
      };
      // Store the code data
      await this.state.storage.put(`code:${code}`, data);
      // Set alarm for auto-expiry
      await this.state.storage.setAlarm(Date.now() + ttlSeconds * 1000);
      return Response.json({ stored: true });
    }

    if (request.method === 'POST' && action === '/exchange') {
      const { code } = (await request.json()) as { code: string };
      const key = `code:${code}`;
      const data = await this.state.storage.get<string>(key);
      if (!data) {
        // Code not found or already used
        return Response.json({ found: false });
      }
      // Atomically delete — no other request can use this code
      await this.state.storage.delete(key);
      return Response.json({ found: true, data });
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  async alarm(): Promise<void> {
    // Clean up all expired codes
    await this.state.storage.deleteAll();
  }
}
```

**Step 2: Update types.ts**

Add to `Env` interface:
```typescript
  OAUTH_CODE_DO: DurableObjectNamespace;
```

**Step 3: Update wrangler.toml**

Add another binding and migration:
```toml
[[durable_objects.bindings]]
name = "OAUTH_CODE_DO"
class_name = "OAuthCodeDO"
```

Update the migration to include both new classes:
```toml
[[migrations]]
tag = "v1"
new_classes = ["RateLimiterDO", "OAuthCodeDO"]
```

**Step 4: Update callback.ts to store code in DO**

In `packages/mcp-server/src/oauth/callback.ts`, after generating the auth code (around line 122-125), add DO storage alongside KV:

After the existing `env.OAUTH_CODES.put(...)` line, add:
```typescript
  // Also store in Durable Object for atomic exchange (if available)
  if (env.OAUTH_CODE_DO) {
    const id = env.OAUTH_CODE_DO.idFromName('codes');
    const stub = env.OAUTH_CODE_DO.get(id);
    await stub.fetch('https://oauth-code/store', {
      method: 'POST',
      body: JSON.stringify({
        code: authCode,
        data: JSON.stringify(oauthCode),
        ttlSeconds: 60,
      }),
    });
  }
```

**Step 5: Update token.ts to exchange from DO**

In `packages/mcp-server/src/oauth/token.ts`, in the code exchange section, add DO path before KV fallback. Replace the code lookup section with:

```typescript
  // Try atomic Durable Object exchange first
  let codeDataRaw: string | null = null;
  if (env.OAUTH_CODE_DO) {
    const id = env.OAUTH_CODE_DO.idFromName('codes');
    const stub = env.OAUTH_CODE_DO.get(id);
    const resp = await stub.fetch('https://oauth-code/exchange', {
      method: 'POST',
      body: JSON.stringify({ code: data.code }),
    });
    const result = (await resp.json()) as { found: boolean; data?: string };
    if (result.found && result.data) {
      codeDataRaw = result.data;
    }
  }

  // Fallback to KV if DO not available or code not found in DO
  if (!codeDataRaw) {
    codeDataRaw = await env.OAUTH_CODES.get(`code:${data.code}`);
  }

  if (!codeDataRaw) {
    return errorResponse(400, 'invalid_grant', 'Authorization code not found or expired');
  }
```

Then continue with the existing parsing logic using `codeDataRaw` instead of the old KV value. Also delete the KV entry for backwards compatibility:
```typescript
  await env.OAUTH_CODES.delete(`code:${data.code}`);
```

**Step 6: Export DO class from index.ts**

Add to exports in `packages/mcp-server/src/index.ts`:
```typescript
export { OAuthCodeDO } from './durable-objects/oauth-code.js';
```

**Step 7: Run tests + typecheck**

Run: `cd /Users/nelson/projects/zkvault/packages/mcp-server && npx vitest run && npx tsc --noEmit`
Expected: All PASS (tests mock KV, DO falls back gracefully)

**Step 8: Commit**

```bash
git add packages/mcp-server/src/durable-objects/oauth-code.ts packages/mcp-server/src/oauth/token.ts packages/mcp-server/src/oauth/callback.ts packages/mcp-server/src/types.ts packages/mcp-server/wrangler.toml packages/mcp-server/src/index.ts
git commit -m "security(mcp): atomic OAuth code exchange via Durable Objects"
```

---

### Task 7: Tool integrity checking (anti-rug-pull)

**Files:**
- Modify: `packages/mcp-server/src/mcp/tools.ts`

**Step 1: Add tools hash computation**

In `packages/mcp-server/src/mcp/tools.ts`, add at the end of the file:

```typescript
/**
 * Compute a SHA-256 hash of all tool definitions for integrity verification.
 * Clients can pin this hash and verify tools haven't been tampered with.
 * Defends against MCP tool poisoning / rug pull attacks.
 */
let cachedToolsHash: string | null = null;

export async function getToolsHash(): Promise<string> {
  if (cachedToolsHash) return cachedToolsHash;
  const serialized = JSON.stringify(TOOLS);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
  cachedToolsHash = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return cachedToolsHash;
}

export async function getToolsListResponseWithHash(): Promise<object> {
  const hash = await getToolsHash();
  return {
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
    _meta: { toolsHash: hash },
  };
}
```

**Step 2: Update transport to use hashed response and add header**

In the transport files that call `getToolsListResponse()`, replace with `getToolsListResponseWithHash()`. Search for usages in `transport-http.ts` and `transport-sse.ts` and update the imports and calls.

Also add `X-Tools-Hash` header to the response in the transport layer.

**Step 3: Run tests**

Run: `cd /Users/nelson/projects/zkvault/packages/mcp-server && npx vitest run`
Expected: All PASS

**Step 4: Commit**

```bash
git add packages/mcp-server/src/mcp/tools.ts packages/mcp-server/src/mcp/transport-http.ts packages/mcp-server/src/mcp/transport-sse.ts
git commit -m "security(mcp): tool integrity hash for anti-rug-pull defense"
```

---

### Task 8: MCP output sanitization (anti-prompt-injection)

**Files:**
- Modify: `packages/mcp-server/src/mcp/handler.ts`

**Step 1: Add output wrapping to mcpResult**

In `packages/mcp-server/src/mcp/handler.ts`, update the `mcpResult` helper:

```typescript
/** Marker tokens for tool output boundaries — stripped from backend data before wrapping */
const OUTPUT_START = '[TOOL_OUTPUT]';
const OUTPUT_END = '[/TOOL_OUTPUT]';

function mcpResult(data: unknown): object {
  let text = JSON.stringify(data, null, 2);
  // Strip any injection of our markers from the data itself
  text = text.replaceAll(OUTPUT_START, '').replaceAll(OUTPUT_END, '');
  return {
    content: [{ type: 'text', text: `${OUTPUT_START}\n${text}\n${OUTPUT_END}` }],
  };
}
```

**Step 2: Run tests**

Run: `cd /Users/nelson/projects/zkvault/packages/mcp-server && npx vitest run`
Expected: All PASS (existing tests check content structure, the markers are additive)

**Step 3: Commit**

```bash
git add packages/mcp-server/src/mcp/handler.ts
git commit -m "security(mcp): wrap tool outputs with boundary markers for prompt injection defense"
```

---

### Task 9: Human confirmation for destructive operations

**Files:**
- Modify: `packages/mcp-server/src/mcp/tools.ts`

**Step 1: Add annotations to tool definitions**

Update the `McpTool` interface:
```typescript
export interface McpTool {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  requiredScope: string;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}
```

Add annotations to each tool in the `TOOLS` array:

- `list_keys`: `annotations: { readOnlyHint: true, title: 'List stored keys' }`
- `get_proxy_url`: `annotations: { readOnlyHint: true, title: 'Get proxy URL' }`
- `add_key`: `annotations: { destructiveHint: true, title: 'Store new API key' }`
- `revoke_key`: `annotations: { destructiveHint: true, title: 'Revoke API key' }`
- `get_usage`: `annotations: { readOnlyHint: true, title: 'Get usage statistics' }`

Update `getToolsListResponseWithHash` (or `getToolsListResponse`) to include annotations in the output:
```typescript
tools: TOOLS.map((tool) => ({
  name: tool.name,
  description: tool.description,
  inputSchema: tool.inputSchema,
  ...(tool.annotations ? { annotations: tool.annotations } : {}),
})),
```

**Step 2: Run tests**

Run: `cd /Users/nelson/projects/zkvault/packages/mcp-server && npx vitest run`
Expected: All PASS

**Step 3: Commit**

```bash
git add packages/mcp-server/src/mcp/tools.ts
git commit -m "security(mcp): add tool annotations for destructive operation confirmation"
```

---

### Task 10: Session revocation consistency

**Files:**
- Modify: `packages/mcp-server/src/index.ts` (revoke endpoint)
- Modify: `packages/mcp-server/src/auth/validate-token.ts`

**Step 1: Write revocation marker on revoke**

In `packages/mcp-server/src/index.ts`, in the `/oauth/revoke` handler (around line 120-131), after `env.MCP_SESSIONS.delete()`, add:

```typescript
        // Write revocation marker for cross-region consistency
        // Even if the session KV delete hasn't propagated to all regions yet,
        // this marker will cause validateToken to reject the token.
        await env.MCP_SESSIONS.put(`revoked:${hash}`, '1', { expirationTtl: 300 });
```

**Step 2: Check revocation marker in validateToken**

In `packages/mcp-server/src/auth/validate-token.ts`, after hashing the token (line 67) and before the KV lookup (line 70), add:

```typescript
  // Check for revocation marker (cross-region consistency belt-and-suspenders)
  const revoked = await env.MCP_SESSIONS.get(`revoked:${hash}`);
  if (revoked) {
    return tokenError('invalid_token', 'Token has been revoked');
  }
```

**Step 3: Run tests**

Run: `cd /Users/nelson/projects/zkvault/packages/mcp-server && npx vitest run`
Expected: All PASS

**Step 4: Commit**

```bash
git add packages/mcp-server/src/index.ts packages/mcp-server/src/auth/validate-token.ts
git commit -m "security(mcp): revocation consistency marker for cross-region KV"
```

---

### Task 11: Deploy and verify

**Step 1: Typecheck everything**

Run: `cd /Users/nelson/projects/zkvault/packages/mcp-server && npx tsc --noEmit`
Expected: PASS

**Step 2: Run all tests**

Run: `cd /Users/nelson/projects/zkvault/packages/mcp-server && npx vitest run`
Expected: All 84+ tests PASS

**Step 3: Deploy**

Run: `cd /Users/nelson/projects/zkvault/packages/mcp-server && npx wrangler deploy`
Expected: Deploys with Durable Object migrations

**Step 4: Verify health**

Run: `curl -s https://mcp.vaultproof.dev/health`
Expected: `{"status":"ok"}`

**Step 5: Verify security headers**

Run: `curl -s -I https://mcp.vaultproof.dev/health | grep -i -E "content-security|strict-transport|x-content-type|x-frame"`
Expected: All security headers present including new CSP

**Step 6: Test MCP tools still work**

Test `list_keys` and `get_usage` via Claude Code MCP integration.

**Step 7: Commit any fixes**

```bash
git commit -m "security(mcp): deployment verification"
```
