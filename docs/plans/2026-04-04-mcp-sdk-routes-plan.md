# MCP SDK Routes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make all VaultProof MCP server tools functional by adding SDK routes to the CF Worker and fixing the MCP handler's add_key flow.

**Architecture:** The MCP server (`mcp.vaultproof.dev`) calls the CF Worker backend (`api.vaultproof.dev`) via HMAC-signed requests with dev-key auth (`X-API-Key` header). We add three SDK routes to the Worker for key CRUD and update the stats route to accept dev-key auth. The MCP handler's add_key case is updated to Shamir-split keys before sending.

**Tech Stack:** Cloudflare Workers, Supabase (PostgREST), Shamir Secret Sharing (GF(256)), AES-256-GCM encryption, Vitest

**Design doc:** `docs/plans/2026-04-04-mcp-sdk-routes-design.md`

---

### Task 1: Create Worker SDK route — GET /keys

**Files:**
- Create: `packages/worker/src/routes/sdk.ts`

**Step 1: Create the SDK route handler with list keys endpoint**

```typescript
import type { Env, DevKeyAuth } from '../types.js';
import { authenticateDevKey } from '../lib/auth.js';
import { getSupabase } from '../lib/supabase.js';
import { encrypt } from '../crypto/encryption.js';
import { encryptShare2 } from '../crypto/share2.js';

export async function handleSdk(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  // All SDK routes require dev key auth
  const auth = await authenticateDevKey(request, env);
  if (!auth) {
    return Response.json(
      { error: 'Invalid API key format. Keys start with vp_live_ or vp_test_. Get yours from the VaultProof dashboard.' },
      { status: 401 },
    );
  }

  const method = request.method;
  const supabase = getSupabase(env);

  // GET /api/v1/sdk/keys
  if ((path === 'keys' || path === '') && method === 'GET') {
    const { data: keys, error } = await supabase
      .from('key_slots')
      .select('id, provider, label, env_var, created_at')
      .eq('user_id', auth.userId)
      .eq('status', 'ACTIVE');

    if (error) {
      return Response.json({ error: 'Failed to fetch keys' }, { status: 500 });
    }

    return Response.json({
      keys: (keys || []).map((k: any) => ({
        id: k.id,
        provider: k.provider,
        label: k.label,
        envVar: k.env_var,
        createdAt: k.created_at,
      })),
    });
  }

  // POST /api/v1/sdk/store
  if (path === 'store' && method === 'POST') {
    return handleStore(request, auth, env);
  }

  // POST /api/v1/sdk/revoke
  if (path === 'revoke' && method === 'POST') {
    return handleRevoke(request, auth, env);
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}

async function handleStore(
  request: Request,
  auth: DevKeyAuth,
  env: Env,
): Promise<Response> {
  const supabase = getSupabase(env);
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { share1, share2, provider, label } = body;
  if (!share1 || !provider) {
    return Response.json({ error: 'Missing required fields: share1, provider' }, { status: 400 });
  }

  // Validate provider
  const validProviders = new Set([
    'openai', 'anthropic', 'google', 'together', 'mistral',
    'cohere', 'groq', 'perplexity', 'fireworks', 'deepseek', 'replicate',
    'stripe', 'minimax',
  ]);
  if (!validProviders.has(provider)) {
    return Response.json({ error: `Unsupported provider: ${provider}` }, { status: 400 });
  }

  // Encrypt share1 with VAULT_ENCRYPTION_KEY
  const share1Bytes = Uint8Array.from(atob(share1), (c) => c.charCodeAt(0));
  const encryptedBytes = encrypt(share1Bytes, env);
  const share1Encrypted = btoa(String.fromCharCode(...encryptedBytes));

  // share2 is already encrypted by the caller (MCP server or SDK)
  // Store it as-is if provided
  const keySlotId = crypto.randomUUID();
  const now = new Date().toISOString();
  const effectiveLabel = label || `${provider} key`;

  const insertData: Record<string, any> = {
    id: keySlotId,
    user_id: auth.userId,
    provider,
    label: effectiveLabel,
    share1_encrypted: share1Encrypted,
    vault_commitment: crypto.randomUUID(),
    auth_apps_root: '',
    status: 'ACTIVE',
    created_at: now,
  };

  if (share2) {
    insertData.share2_encrypted = share2;
  }

  const { error: insertError } = await supabase.from('key_slots').insert(insertData);
  if (insertError) {
    return Response.json({ error: 'Failed to store key' }, { status: 500 });
  }

  // Create app grant for SDK
  await supabase.from('app_grants').insert({
    id: crypto.randomUUID(),
    key_slot_id: keySlotId,
    app_id: auth.keyId,
    app_name: 'SDK',
    granted_at: now,
  });

  return Response.json({ keyId: keySlotId, provider, label: effectiveLabel });
}

async function handleRevoke(
  request: Request,
  auth: DevKeyAuth,
  env: Env,
): Promise<Response> {
  const supabase = getSupabase(env);
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { keyId } = body;
  if (!keyId) {
    return Response.json({ error: 'Missing required field: keyId' }, { status: 400 });
  }

  // Verify ownership
  const { data: slot, error } = await supabase
    .from('key_slots')
    .select('id, user_id')
    .eq('id', keyId)
    .eq('user_id', auth.userId)
    .single();

  if (error || !slot) {
    return Response.json({ error: 'Key not found' }, { status: 404 });
  }

  const { error: updateError } = await supabase
    .from('key_slots')
    .update({
      status: 'REVOKED',
      share1_encrypted: '',
      share2_encrypted: '',
    })
    .eq('id', keyId);

  if (updateError) {
    return Response.json({ error: 'Failed to revoke key' }, { status: 500 });
  }

  return Response.json({ status: 'revoked' });
}
```

**Step 2: Run typecheck**

Run: `cd /Users/nelson/projects/zkvault/packages/worker && npx tsc --noEmit`
Expected: No errors related to sdk.ts

**Step 3: Commit**

```bash
git add packages/worker/src/routes/sdk.ts
git commit -m "feat(worker): add SDK routes for list/store/revoke keys"
```

---

### Task 2: Wire SDK routes into Worker index

**Files:**
- Modify: `packages/worker/src/index.ts`

**Step 1: Add SDK route import and handler**

In `packages/worker/src/index.ts`, add the import:
```typescript
import { handleSdk } from './routes/sdk.js';
```

Add the route block before the transparent proxy section (before `// Transparent proxy: /v1/*`):
```typescript
    // SDK routes (dev-key auth)
    if (url.pathname.startsWith('/api/v1/sdk/')) {
      try {
        const path = url.pathname.slice('/api/v1/sdk/'.length);
        const response = await handleSdk(request, env, path);
        return addCors(response, origin, allowedOrigins);
      } catch {
        return addCors(Response.json({ error: 'Service temporarily unavailable' }, { status: 503 }), origin, allowedOrigins);
      }
    }
```

**Step 2: Run typecheck**

Run: `cd /Users/nelson/projects/zkvault/packages/worker && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/worker/src/index.ts
git commit -m "feat(worker): wire SDK routes into main router"
```

---

### Task 3: Add dev-key auth fallback to stats/usage

**Files:**
- Modify: `packages/worker/src/routes/stats.ts`

**Step 1: Update handleStats to accept dev-key auth**

In `packages/worker/src/routes/stats.ts`, add the import:
```typescript
import { authenticateDevKey } from '../lib/auth.js';
```

Replace the auth block in `handleStats`:
```typescript
  // Try JWT auth first, fall back to dev-key auth
  let userId: string;
  const auth = await authenticateUser(request, env);
  if (auth) {
    userId = auth.userId;
  } else {
    const devAuth = await authenticateDevKey(request, env);
    if (!devAuth) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    userId = devAuth.userId;
  }
```

Remove the existing `if (!auth)` check and update the `switch` to use `userId` directly (it already does via `auth.userId` — just replace those references with the new `userId` variable).

The full updated function signature area becomes:
```typescript
export async function handleStats(request: Request, env: Env, path: string): Promise<Response> {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  // Try JWT auth first, fall back to dev-key auth (for MCP server)
  let userId: string;
  const auth = await authenticateUser(request, env);
  if (auth) {
    userId = auth.userId;
  } else {
    const devAuth = await authenticateDevKey(request, env);
    if (!devAuth) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    userId = devAuth.userId;
  }

  switch (path) {
    case 'overview':
      return handleOverview(userId, env);
    case 'usage':
      return handleUsage(userId, env, request);
    case 'by-key':
      return handleByKey(userId, env);
    default:
      return Response.json({ error: 'Not found' }, { status: 404 });
  }
}
```

**Step 2: Run typecheck**

Run: `cd /Users/nelson/projects/zkvault/packages/worker && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/worker/src/routes/stats.ts
git commit -m "feat(worker): add dev-key auth fallback to stats routes"
```

---

### Task 4: Update MCP handler — Shamir split in add_key

**Files:**
- Modify: `packages/mcp-server/src/mcp/handler.ts`

**Context:** The MCP server is a CF Worker. It does NOT have `@vaultproof/shamir` as a dependency, and it can't use node:crypto. However, the Worker package at `packages/worker/src/crypto/shamir.ts` has a pure Web Crypto implementation of Shamir split/serialize. We need to copy the Shamir split + serialize functions inline, or add a shared import.

**Step 1: Create Shamir + share2 encryption utilities in MCP server**

Create `packages/mcp-server/src/lib/shamir.ts` — copy from `packages/worker/src/crypto/shamir.ts`:

Only the functions needed: `split`, `serializeShare`, and the GF(256) helpers. The file already exists in the worker package and uses only `crypto.getRandomValues` (available in CF Workers).

```typescript
// Copy the exact contents of packages/worker/src/crypto/shamir.ts
// Only need: Share interface, serializeShare, split, splitString, gf256Mul, gf256Inv, evalPoly
```

Create `packages/mcp-server/src/lib/share2-encrypt.ts` — simplified share2 encryption using Web Crypto (matching the PBKDF2 approach in `packages/worker/src/crypto/share2.ts`):

```typescript
const ALGORITHM = 'AES-GCM';
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const PBKDF2_ITERATIONS = 100000;

async function deriveKeyFromVpKey(vpKey: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', encoder.encode(vpKey), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: ALGORITHM, length: 256 },
    false,
    ['encrypt'],
  );
}

export async function encryptShare2(share2: string, vpKey: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const derivedKey = await deriveKeyFromVpKey(vpKey, salt);
  const encoder = new TextEncoder();
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: ALGORITHM, iv }, derivedKey, encoder.encode(share2)),
  );
  const result = new Uint8Array(SALT_LENGTH + IV_LENGTH + encrypted.length);
  result.set(salt, 0);
  result.set(iv, SALT_LENGTH);
  result.set(encrypted, SALT_LENGTH + IV_LENGTH);
  // Return as base64 for JSON transport
  let binary = '';
  for (let i = 0; i < result.length; i++) binary += String.fromCharCode(result[i]);
  return btoa(binary);
}
```

**Step 2: Update the add_key case in handler.ts**

In `packages/mcp-server/src/mcp/handler.ts`, add imports:
```typescript
import { splitString, serializeShare } from '../lib/shamir.js';
import { encryptShare2 } from '../lib/share2-encrypt.js';
```

Replace the `case 'add_key':` block:
```typescript
      case 'add_key': {
        const addKeyAllowed = await checkAddKeyRateLimit(userId, env);
        if (!addKeyAllowed) {
          return mcpError('Rate limit exceeded: too many add_key calls. Try again later.');
        }
        const { provider, label, value } = args as {
          provider: string;
          label: string;
          value: string;
        };

        // Split the raw key into 2 Shamir shares (threshold=2)
        const shares = splitString(value, 2, 2);
        const share1 = serializeShare(shares[0]);
        const share2Raw = serializeShare(shares[1]);

        // Encrypt share2 with the developer's vp_live_ key
        const share2Encrypted = await encryptShare2(share2Raw, devKey);

        const resp = await callBackend(
          '/api/v1/sdk/store',
          'POST',
          { share1, share2: share2Encrypted, provider, label },
          devKey,
          env,
        );
        if (!resp.ok) {
          const body = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
          return mcpError(sanitizeString(body['error'], 256) ?? `Backend error: ${resp.status}`);
        }
        return mcpResult({ success: true, message: 'Key stored successfully' });
      }
```

**Step 3: Run typecheck**

Run: `cd /Users/nelson/projects/zkvault/packages/mcp-server && npx tsc --noEmit`
Expected: PASS

**Step 4: Run existing MCP tests**

Run: `cd /Users/nelson/projects/zkvault/packages/mcp-server && npx vitest run`
Expected: All existing tests pass (the add_key test mocks callBackend, so the new split logic is transparent to it)

**Step 5: Commit**

```bash
git add packages/mcp-server/src/lib/shamir.ts packages/mcp-server/src/lib/share2-encrypt.ts packages/mcp-server/src/mcp/handler.ts
git commit -m "feat(mcp): split keys with Shamir before sending to backend"
```

---

### Task 5: Deploy and test end-to-end

**Step 1: Deploy the Worker**

Run: `cd /Users/nelson/projects/zkvault && bash scripts/deploy-worker.sh`
Expected: Worker deploys successfully with health check passing

**Step 2: Verify SDK routes respond**

Run: `curl -s -o /dev/null -w "%{http_code}" https://api.vaultproof.dev/api/v1/sdk/keys`
Expected: 401 (not 404 — route exists but auth is required)

**Step 3: Deploy the MCP server**

Run: `cd /Users/nelson/projects/zkvault/packages/mcp-server && npx wrangler deploy`
Expected: MCP server deploys successfully

**Step 4: Test MCP tools via Claude Code**

Test `list_keys`, `get_usage`, `add_key` (with a test key), and `get_proxy_url` through the MCP server integration.

**Step 5: Commit any fixes**

```bash
git commit -m "fix: address deployment issues"
```
