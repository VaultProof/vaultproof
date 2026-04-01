# Workers Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate VaultProof's entire backend from Railway (Fastify/Prisma) to Cloudflare Workers + Supabase REST, cutting ~100ms per proxied call.

**Architecture:** Single CF Worker handles all routes. Supabase REST replaces Prisma for DB. Web Crypto API replaces Node.js crypto. KV caches hot-path data. ZK verification moves to Supabase Edge Function later (not in this plan — it's not in the hot path).

**Tech Stack:** Cloudflare Workers, supabase-js, privy-io/shamir-secret-sharing, Web Crypto API, KV

---

## Task 1: Scaffold the New Worker

**Files:**
- Modify: `packages/worker/wrangler.toml`
- Modify: `packages/worker/package.json`
- Create: `packages/worker/src/types.ts`

**Step 1: Update wrangler.toml**

```toml
name = "zkvault"
main = "src/index.ts"
compatibility_date = "2026-03-27"
compatibility_flags = ["nodejs_compat"]

[vars]
ALLOWED_ORIGINS = "https://vaultproof.dev,https://www.vaultproof.dev"

[[kv_namespaces]]
binding = "CACHE"
id = ""
preview_id = ""
```

Note: KV namespace IDs will be filled in after `wrangler kv namespace create CACHE`.

**Step 2: Create KV namespace**

Run: `cd packages/worker && wrangler kv namespace create CACHE`
Run: `wrangler kv namespace create CACHE --preview`

Copy the IDs into wrangler.toml.

**Step 3: Install dependencies**

Run: `cd packages/worker && npm install @supabase/supabase-js @privy-io/shamir-secret-sharing`

**Step 4: Create types file**

```typescript
// packages/worker/src/types.ts
export interface Env {
  BACKEND_URL: string;
  PROXY_SECRET: string;
  ALLOWED_ORIGINS: string;
  VAULT_ENCRYPTION_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  CACHE: KVNamespace;
}

export interface DevKeyAuth {
  userId: string;
  keyId: string;
  rawKey: string;
  devKey: DevKeyRecord;
}

export interface DevKeyRecord {
  id: string;
  userId: string;
  key: string;
  keyHash: string;
  label: string;
  mode: string;
  allowedIps: string | null;
  allowedProviders: string | null;
  allowedEndpoints: string | null;
  allowedKeySlotIds: string | null;
  alertEmail: string | null;
  alertThreshold: number | null;
  webhookUrl: string | null;
  webhookSecret: string | null;
  lastUsed: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface KeySlotRecord {
  id: string;
  user_id: string;
  provider: string;
  label: string;
  env_var: string | null;
  share1_encrypted: string; // base64 from Supabase REST
  share2_encrypted: string | null;
  vault_commitment: string;
  auth_apps_root: string;
  status: string;
  daily_limit: number | null;
  monthly_limit: number | null;
  block_on_limit: boolean;
  created_at: string;
  rotated_at: string | null;
  expires_at: string | null;
}

export interface UserRecord {
  id: string;
  email: string;
  tier: string;
  kill_switch: boolean;
  global_daily_limit: number | null;
  global_monthly_limit: number | null;
}
```

**Step 5: Commit**

```bash
git add packages/worker/
git commit -m "chore: scaffold Worker migration — deps, KV, types"
```

---

## Task 2: Web Crypto Encryption Module

**Files:**
- Create: `packages/worker/src/crypto/encryption.ts`

**Step 1: Implement AES-256-GCM with Web Crypto (PBKDF2 instead of scrypt)**

```typescript
// packages/worker/src/crypto/encryption.ts

const ALGORITHM = 'AES-GCM';
const IV_LENGTH = 12;
const TAG_LENGTH = 16; // GCM tag is appended by Web Crypto
const SALT_LENGTH = 16;
const PBKDF2_ITERATIONS = 100000;

function getMasterKey(env: { VAULT_ENCRYPTION_KEY: string }): Uint8Array {
  const key = env.VAULT_ENCRYPTION_KEY;
  if (!key) throw new Error('VAULT_ENCRYPTION_KEY not set');
  // Hex-encoded 32-byte key
  if (key.length === 64) {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 64; i += 2) {
      bytes[i / 2] = parseInt(key.substring(i, i + 2), 16);
    }
    return bytes;
  }
  // Base64-encoded
  const binary = atob(key);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(masterKey: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey('raw', masterKey, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: ALGORITHM, length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encrypt(plaintext: Uint8Array, env: { VAULT_ENCRYPTION_KEY: string }): Promise<Uint8Array> {
  const masterKey = getMasterKey(env);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const derivedKey = await deriveKey(masterKey, salt);

  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: ALGORITHM, iv }, derivedKey, plaintext));

  // Format: salt (16) + iv (12) + encrypted (includes GCM tag at end)
  const result = new Uint8Array(SALT_LENGTH + IV_LENGTH + encrypted.length);
  result.set(salt, 0);
  result.set(iv, SALT_LENGTH);
  result.set(encrypted, SALT_LENGTH + IV_LENGTH);
  return result;
}

export async function decrypt(data: Uint8Array, env: { VAULT_ENCRYPTION_KEY: string }): Promise<Uint8Array> {
  if (data.length < SALT_LENGTH + IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error('Invalid encrypted data: too short');
  }
  const masterKey = getMasterKey(env);
  const salt = data.slice(0, SALT_LENGTH);
  const iv = data.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = data.slice(SALT_LENGTH + IV_LENGTH);

  const derivedKey = await deriveKey(masterKey, salt);
  const decrypted = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, derivedKey, ciphertext);
  return new Uint8Array(decrypted);
}

export function zeroUint8Array(arr: Uint8Array): void {
  arr.fill(0);
}
```

**Step 2: Commit**

```bash
git add packages/worker/src/crypto/encryption.ts
git commit -m "feat: Web Crypto AES-256-GCM encryption for Workers"
```

---

## Task 3: Share 2 Encryption Module (PBKDF2)

**Files:**
- Create: `packages/worker/src/crypto/share2.ts`

**Step 1: Implement Share 2 encryption with PBKDF2**

```typescript
// packages/worker/src/crypto/share2.ts

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
    ['encrypt', 'decrypt']
  );
}

export async function encryptShare2(share2: string, vpKey: string): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const derivedKey = await deriveKeyFromVpKey(vpKey, salt);
  const encoder = new TextEncoder();
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: ALGORITHM, iv }, derivedKey, encoder.encode(share2)));

  const result = new Uint8Array(SALT_LENGTH + IV_LENGTH + encrypted.length);
  result.set(salt, 0);
  result.set(iv, SALT_LENGTH);
  result.set(encrypted, SALT_LENGTH + IV_LENGTH);
  return result;
}

export async function decryptShare2(data: Uint8Array, vpKey: string): Promise<string> {
  if (data.length < SALT_LENGTH + IV_LENGTH + 1) {
    throw new Error('Invalid encrypted Share 2: too short');
  }
  const salt = data.slice(0, SALT_LENGTH);
  const iv = data.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = data.slice(SALT_LENGTH + IV_LENGTH);

  const derivedKey = await deriveKeyFromVpKey(vpKey, salt);
  const decrypted = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, derivedKey, ciphertext);
  return new TextDecoder().decode(decrypted);
}
```

**Step 2: Commit**

```bash
git add packages/worker/src/crypto/share2.ts
git commit -m "feat: Share 2 encryption with PBKDF2 for Workers"
```

---

## Task 4: Supabase Client + KV Cache Helpers

**Files:**
- Create: `packages/worker/src/lib/supabase.ts`
- Create: `packages/worker/src/lib/cache.ts`

**Step 1: Supabase client factory**

```typescript
// packages/worker/src/lib/supabase.ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../types.js';

export function getSupabase(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
```

**Step 2: KV cache helpers**

```typescript
// packages/worker/src/lib/cache.ts
import type { Env } from '../types.js';

interface CacheOptions {
  ttlSeconds?: number;
}

export async function cacheGet<T>(env: Env, key: string): Promise<T | null> {
  const val = await env.CACHE.get(key, 'text');
  if (!val) return null;
  try {
    return JSON.parse(val) as T;
  } catch {
    return null;
  }
}

export async function cacheSet(env: Env, key: string, value: unknown, opts: CacheOptions = {}): Promise<void> {
  const ttl = opts.ttlSeconds || 30;
  await env.CACHE.put(key, JSON.stringify(value), { expirationTtl: ttl });
}

export async function cacheDel(env: Env, key: string): Promise<void> {
  await env.CACHE.delete(key);
}
```

**Step 3: Commit**

```bash
git add packages/worker/src/lib/
git commit -m "feat: Supabase client + KV cache helpers"
```

---

## Task 5: Developer Key Authentication

**Files:**
- Create: `packages/worker/src/lib/auth.ts`

**Step 1: Port authenticateDevKey to Workers**

```typescript
// packages/worker/src/lib/auth.ts
import type { Env, DevKeyAuth, DevKeyRecord } from '../types.js';
import { getSupabase } from './supabase.js';
import { cacheGet, cacheSet } from './cache.js';

async function sha256hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function authenticateDevKey(
  request: Request,
  env: Env,
): Promise<DevKeyAuth | null> {
  const authHeader = request.headers.get('authorization') || '';
  const apiKeyHeader = request.headers.get('x-api-key') || '';

  let rawKey: string | null = null;
  if (apiKeyHeader.startsWith('vp_')) {
    rawKey = apiKeyHeader;
  } else if (authHeader.startsWith('Bearer vp_')) {
    rawKey = authHeader.slice(7);
  }

  if (!rawKey) return null;
  if (!rawKey.startsWith('vp_live_') && !rawKey.startsWith('vp_test_')) return null;

  const keyHash = await sha256hex(rawKey);

  // Check KV cache first
  const cacheKey = `devkey:${keyHash}`;
  let devKey = await cacheGet<DevKeyRecord>(env, cacheKey);

  if (!devKey) {
    const supabase = getSupabase(env);
    const { data, error } = await supabase
      .from('developer_keys')
      .select('*')
      .eq('key_hash', keyHash)
      .single();

    if (error || !data) return null;
    devKey = data as DevKeyRecord;

    // Cache for 30s
    await cacheSet(env, cacheKey, devKey, { ttlSeconds: 30 });
  }

  if (devKey.revokedAt) return null;

  // Optional session token validation
  const sessionHeader = request.headers.get('x-vaultproof-session');
  if (sessionHeader) {
    const sessionHash = await sha256hex(sessionHeader);
    const supabase = getSupabase(env);
    const { data: session } = await supabase
      .from('session_tokens')
      .select('*')
      .eq('token_hash', sessionHash)
      .single();

    if (!session || session.developer_key_id !== devKey.id || new Date(session.expires_at) < new Date()) {
      return null;
    }
  }

  // Update lastUsed non-blocking
  const supabase = getSupabase(env);
  supabase.from('developer_keys').update({ last_used: new Date().toISOString() }).eq('id', devKey.id).then(() => {});

  return { userId: devKey.userId, keyId: devKey.id, rawKey, devKey };
}
```

**Step 2: Commit**

```bash
git add packages/worker/src/lib/auth.ts
git commit -m "feat: dev key authentication for Workers with KV cache"
```

---

## Task 6: Shamir Wrapper

**Files:**
- Create: `packages/worker/src/crypto/shamir.ts`

**Step 1: Wrap privy-io/shamir-secret-sharing**

```typescript
// packages/worker/src/crypto/shamir.ts
import { split, combine } from '@privy-io/shamir-secret-sharing';

export async function splitSecret(secret: Uint8Array, shares: number = 2, threshold: number = 2): Promise<Uint8Array[]> {
  return split(secret, shares, threshold);
}

export async function combineShares(shares: Uint8Array[]): Promise<Uint8Array> {
  return combine(shares);
}
```

Note: `@privy-io/shamir-secret-sharing` uses `Uint8Array` natively. The existing `@vaultproof/shamir` uses a custom Share type with `serializeShare`/`deserializeShare`. The migration script (Task 10) will handle converting stored share format.

Check the existing share format first:

```typescript
// Current @vaultproof/shamir serializes shares as base64 strings.
// The share data in the DB is: encrypt(serializeShare(share)) = encrypt(base64_string)
// After decryption we get a base64 string back.
// We need to keep the same format so existing stored shares work.
// Do NOT change the Shamir library yet — just decrypt the stored base64 and combine.
```

**Revised approach — keep existing share format:**

```typescript
// packages/worker/src/crypto/shamir.ts
//
// Existing shares are stored as base64-serialized @vaultproof/shamir shares.
// After decryption, we get the base64 string. We need to deserialize it
// back to the original format and combine.
//
// For the migration, we keep the existing share format and use
// the same deserialization logic. We only change the crypto layer
// (scrypt → PBKDF2), not the Shamir layer.
//
// The @vaultproof/shamir package's combine() accepts Share objects:
// { x: number, y: Uint8Array }
// serializeShare() encodes as: [x_byte, ...y_bytes] → base64
// deserializeShare() decodes: base64 → { x, y }

export function deserializeShare(base64: string): { x: number; y: Uint8Array } {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { x: bytes[0], y: bytes.slice(1) };
}

export function combineShares(shares: Array<{ x: number; y: Uint8Array }>): Uint8Array {
  // Shamir GF(256) combination — must match @vaultproof/shamir's combine()
  const len = shares[0].y.length;
  const result = new Uint8Array(len);

  for (let i = 0; i < len; i++) {
    let value = 0;
    for (let j = 0; j < shares.length; j++) {
      let basis = 1;
      for (let k = 0; k < shares.length; k++) {
        if (j === k) continue;
        const num = shares[k].x;
        const den = shares[k].x ^ shares[j].x;
        basis = gf256Mul(basis, gf256Mul(num, gf256Inv(den)));
      }
      value ^= gf256Mul(shares[j].y[i], basis);
    }
    result[i] = value;
  }

  return result;
}

// GF(256) arithmetic with irreducible polynomial x^8 + x^4 + x^3 + x + 1 (0x11b)
function gf256Mul(a: number, b: number): number {
  let result = 0;
  let aa = a;
  let bb = b;
  for (let i = 0; i < 8; i++) {
    if (bb & 1) result ^= aa;
    const hi = aa & 0x80;
    aa = (aa << 1) & 0xff;
    if (hi) aa ^= 0x1b;
    bb >>= 1;
  }
  return result;
}

function gf256Inv(a: number): number {
  if (a === 0) throw new Error('Cannot invert zero in GF(256)');
  // Fermat's little theorem: a^(254) = a^(-1) in GF(256)
  let result = a;
  for (let i = 0; i < 6; i++) {
    result = gf256Mul(result, result);
    result = gf256Mul(result, a);
  }
  result = gf256Mul(result, result);
  return result;
}
```

**Step 2: Commit**

```bash
git add packages/worker/src/crypto/shamir.ts
git commit -m "feat: Shamir GF(256) combine for Workers — matches @vaultproof/shamir format"
```

---

## Task 7: Rate Limiting Module

**Files:**
- Create: `packages/worker/src/lib/rate-limit.ts`

**Step 1: KV-based rate limiting**

```typescript
// packages/worker/src/lib/rate-limit.ts
import type { Env } from '../types.js';
import { getSupabase } from './supabase.js';
import { cacheGet, cacheSet } from './cache.js';

// Per-key in-memory rate limiter (60 req/min)
// Note: Workers don't share memory across isolates, so this is per-isolate.
// For strict global rate limiting, use KV. For burst protection, in-memory is fine.
const keyBuckets = new Map<string, { tokens: number; windowStart: number }>();
const KEY_RATE_LIMIT = 60;
const KEY_RATE_WINDOW = 60_000;

export function checkKeyRateLimit(keyId: string): boolean {
  const now = Date.now();
  const bucket = keyBuckets.get(keyId);
  if (!bucket || now - bucket.windowStart >= KEY_RATE_WINDOW) {
    keyBuckets.set(keyId, { tokens: KEY_RATE_LIMIT - 1, windowStart: now });
    return true;
  }
  if (bucket.tokens <= 0) return false;
  bucket.tokens--;
  return true;
}

// Tier-based monthly rate limiting
const TIERS: Record<string, { maxCallsPerMonth: number; maxKeySlots: number }> = {
  free: { maxCallsPerMonth: 10000, maxKeySlots: 3 },
  starter: { maxCallsPerMonth: 50000, maxKeySlots: 10 },
  pro: { maxCallsPerMonth: 500000, maxKeySlots: 50 },
  max: { maxCallsPerMonth: 500000, maxKeySlots: 100 },
};

const BUFFER_PERCENT = 1.05;
const CALL_ACTIONS = ['api_call', 'transparent_proxy', 'key_retrieval', 'key_retrieval_batch'];

export async function checkTierRateLimit(
  env: Env,
  keySlotId: string,
  tier: string = 'free',
): Promise<{ allowed: boolean; used: number; limit: number; remaining: number; nearLimit: boolean }> {
  const limits = TIERS[tier] || TIERS.free;
  const advertisedLimit = limits.maxCallsPerMonth;
  const hardLimit = Math.floor(advertisedLimit * BUFFER_PERCENT);

  // Check KV cache for current count
  const cacheKey = `ratelimit:${keySlotId}`;
  let used = await cacheGet<number>(env, cacheKey);

  if (used === null) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const supabase = getSupabase(env);
    const { count } = await supabase
      .from('access_logs')
      .select('*', { count: 'exact', head: true })
      .eq('key_slot_id', keySlotId)
      .in('action', CALL_ACTIONS)
      .gte('timestamp', monthStart);

    used = count || 0;
    await cacheSet(env, cacheKey, used, { ttlSeconds: 60 });
  }

  const remaining = Math.max(0, advertisedLimit - used);
  const nearLimit = used >= advertisedLimit * 0.9;
  const overBuffer = used >= hardLimit;

  return { allowed: !overBuffer, used, limit: advertisedLimit, remaining, nearLimit };
}
```

**Step 2: Commit**

```bash
git add packages/worker/src/lib/rate-limit.ts
git commit -m "feat: KV-based rate limiting for Workers"
```

---

## Task 8: Transparent Proxy Route (Hot Path)

**Files:**
- Create: `packages/worker/src/routes/transparent-proxy.ts`

**Step 1: Port the transparent proxy**

```typescript
// packages/worker/src/routes/transparent-proxy.ts
import type { Env, KeySlotRecord, UserRecord } from '../types.js';
import { authenticateDevKey } from '../lib/auth.js';
import { checkKeyRateLimit, checkTierRateLimit } from '../lib/rate-limit.js';
import { getSupabase } from '../lib/supabase.js';
import { cacheGet, cacheSet } from '../lib/cache.js';
import { decrypt, zeroUint8Array } from '../crypto/encryption.js';
import { decryptShare2 } from '../crypto/share2.js';
import { deserializeShare, combineShares } from '../crypto/shamir.js';

const PROVIDERS: Record<string, { upstream: string; authHeader: (key: string) => Record<string, string> }> = {
  openai: { upstream: 'https://api.openai.com', authHeader: (k) => ({ Authorization: `Bearer ${k}` }) },
  anthropic: { upstream: 'https://api.anthropic.com', authHeader: (k) => ({ 'x-api-key': k, 'anthropic-version': '2023-06-01' }) },
  google: { upstream: 'https://generativelanguage.googleapis.com', authHeader: (k) => ({ 'x-goog-api-key': k }) },
  together: { upstream: 'https://api.together.xyz', authHeader: (k) => ({ Authorization: `Bearer ${k}` }) },
  mistral: { upstream: 'https://api.mistral.ai', authHeader: (k) => ({ Authorization: `Bearer ${k}` }) },
  cohere: { upstream: 'https://api.cohere.com', authHeader: (k) => ({ Authorization: `Bearer ${k}` }) },
  groq: { upstream: 'https://api.groq.com', authHeader: (k) => ({ Authorization: `Bearer ${k}` }) },
  perplexity: { upstream: 'https://api.perplexity.ai', authHeader: (k) => ({ Authorization: `Bearer ${k}` }) },
  fireworks: { upstream: 'https://api.fireworks.ai', authHeader: (k) => ({ Authorization: `Bearer ${k}` }) },
  deepseek: { upstream: 'https://api.deepseek.com', authHeader: (k) => ({ Authorization: `Bearer ${k}` }) },
  replicate: { upstream: 'https://api.replicate.com', authHeader: (k) => ({ Authorization: `Bearer ${k}` }) },
  stripe: { upstream: 'https://api.stripe.com', authHeader: (k) => ({ Authorization: `Bearer ${k}` }) },
  minimax: { upstream: 'https://api.minimax.io', authHeader: (k) => ({ Authorization: `Bearer ${k}` }) },
};

const DYNAMIC_PROVIDERS: Record<string, {
  buildUpstream: (segments: string[]) => { url: string; remainingPath: string } | null;
  authHeader: (key: string) => Record<string, string>;
}> = {
  supabase: {
    buildUpstream: (segments) => {
      if (segments.length < 2) return null;
      const projectRef = segments[0];
      if (!/^[a-z0-9]+$/.test(projectRef)) return null;
      return { url: `https://${projectRef}.supabase.co`, remainingPath: '/' + segments.slice(1).join('/') };
    },
    authHeader: (k) => ({ apikey: k, Authorization: `Bearer ${k}` }),
  },
};

const SAFE_FORWARD_HEADERS = new Set([
  'content-type', 'accept', 'accept-encoding', 'accept-language',
  'cache-control', 'user-agent', 'anthropic-version', 'openai-beta',
  'stripe-version', 'idempotency-key', 'prefer',
]);

export async function handleTransparentProxy(
  request: Request,
  env: Env,
  path: string, // e.g. "openai/v1/chat/completions"
): Promise<Response> {
  // a. Extract provider
  const slashIdx = path.indexOf('/');
  const provider = slashIdx === -1 ? path : path.substring(0, slashIdx);
  const wildcardPath = slashIdx === -1 ? '' : path.substring(slashIdx + 1);

  const providerConfig = PROVIDERS[provider];
  const dynamicConfig = !providerConfig ? DYNAMIC_PROVIDERS[provider] : null;
  if (!providerConfig && !dynamicConfig) {
    const supported = [...Object.keys(PROVIDERS), ...Object.keys(DYNAMIC_PROVIDERS)].join(', ');
    return Response.json({ error: `Unknown provider "${provider}". Supported: ${supported}.` }, { status: 400 });
  }

  // b. Authenticate
  const auth = await authenticateDevKey(request, env);
  if (!auth) {
    return Response.json({ error: 'API key not recognized.' }, { status: 401 });
  }

  // c. Per-key rate limit
  if (!checkKeyRateLimit(auth.keyId)) {
    return Response.json({ error: 'Rate limit exceeded (60 req/min).' }, { status: 429 });
  }

  // d. Restrictions
  if (auth.devKey.allowedProviders) {
    const allowed = auth.devKey.allowedProviders.split(',').map(s => s.trim());
    if (!allowed.includes(provider)) {
      return Response.json({ error: `Provider '${provider}' not allowed.` }, { status: 403 });
    }
  }
  if (auth.devKey.allowedEndpoints) {
    const allowed = auth.devKey.allowedEndpoints.split(',').map(s => s.trim());
    if (!allowed.some(ep => ('/' + wildcardPath).startsWith(ep))) {
      return Response.json({ error: 'Endpoint not allowed.' }, { status: 403 });
    }
  }

  // e. Fetch user + key slot (parallel, with KV cache)
  const supabase = getSupabase(env);

  const userCacheKey = `user:${auth.userId}`;
  const keyCacheKey = `keyslot:${auth.userId}:${provider}`;

  let [user, keySlot] = await Promise.all([
    cacheGet<UserRecord>(env, userCacheKey),
    cacheGet<KeySlotRecord>(env, keyCacheKey),
  ]);

  if (!user || !keySlot) {
    const [userRes, keyRes] = await Promise.all([
      !user ? supabase.from('users').select('id, email, tier, kill_switch, global_daily_limit, global_monthly_limit').eq('id', auth.userId).single() : null,
      !keySlot ? supabase.from('key_slots').select('*').eq('user_id', auth.userId).eq('provider', provider).eq('status', 'ACTIVE').order('created_at', { ascending: false }).limit(1).single() : null,
    ]);

    if (userRes && !userRes.error) { user = userRes.data; await cacheSet(env, userCacheKey, user, { ttlSeconds: 60 }); }
    if (keyRes && !keyRes.error) { keySlot = keyRes.data; await cacheSet(env, keyCacheKey, keySlot, { ttlSeconds: 30 }); }
  }

  if (user?.kill_switch) {
    return Response.json({ error: 'All proxy calls are paused.' }, { status: 503 });
  }
  if (!keySlot) {
    return Response.json({ error: `No active ${provider} key stored.` }, { status: 404 });
  }
  if (keySlot.expires_at && new Date(keySlot.expires_at) < new Date()) {
    return Response.json({ error: 'Key has expired.' }, { status: 410 });
  }
  if (!keySlot.share2_encrypted) {
    return Response.json({ error: 'Key cannot be reconstructed.' }, { status: 400 });
  }

  // Key slot restriction
  if (auth.devKey.allowedKeySlotIds) {
    const allowed = auth.devKey.allowedKeySlotIds.split(',').map(s => s.trim());
    if (!allowed.includes(keySlot.id)) {
      return Response.json({ error: 'Key slot not allowed for this API key.' }, { status: 403 });
    }
  }

  // f. Tier rate limiting
  const tier = user?.tier || 'free';
  const rateCheck = await checkTierRateLimit(env, keySlot.id, tier);
  if (!rateCheck.allowed && tier === 'free') {
    return Response.json({ error: 'Monthly call limit exceeded.', used: rateCheck.used, limit: rateCheck.limit }, { status: 429 });
  }

  // g. Reconstruct API key
  let apiKey: string;
  try {
    // share1_encrypted comes as base64 from Supabase REST (bytea column)
    const share1Bytes = Uint8Array.from(atob(keySlot.share1_encrypted), c => c.charCodeAt(0));
    const decryptedShare1 = await decrypt(share1Bytes, env);
    const share1Str = new TextDecoder().decode(decryptedShare1);
    zeroUint8Array(decryptedShare1);

    const share2Bytes = Uint8Array.from(atob(keySlot.share2_encrypted), c => c.charCodeAt(0));
    const share2Str = await decryptShare2(share2Bytes, auth.rawKey);

    const share1 = deserializeShare(share1Str);
    const share2 = deserializeShare(share2Str);
    const combined = combineShares([share1, share2]);
    apiKey = new TextDecoder().decode(combined);
  } catch {
    return Response.json({ error: 'Failed to reconstruct key.' }, { status: 500 });
  }

  // h. Build upstream URL
  let upstreamUrl: string;
  if (providerConfig) {
    upstreamUrl = `${providerConfig.upstream}/${wildcardPath}`;
  } else {
    const segments = wildcardPath.split('/');
    const resolved = dynamicConfig!.buildUpstream(segments);
    if (!resolved) {
      return Response.json({ error: `Invalid ${provider} URL.` }, { status: 400 });
    }
    upstreamUrl = `${resolved.url}${resolved.remainingPath}`;
  }

  // Preserve query string
  const url = new URL(request.url);
  if (url.search) upstreamUrl += url.search;

  // i. Forward headers
  const forwardHeaders: Record<string, string> = {};
  for (const [key, value] of request.headers.entries()) {
    if (SAFE_FORWARD_HEADERS.has(key.toLowerCase())) {
      forwardHeaders[key] = value;
    }
  }
  const authHeaders = providerConfig ? providerConfig.authHeader(apiKey) : dynamicConfig!.authHeader(apiKey);
  Object.assign(forwardHeaders, authHeaders);

  // Zero the key
  apiKey = '';

  // j. Proxy the request
  const startTime = Date.now();
  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers: forwardHeaders,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
    });

    // Log access (non-blocking)
    const latencyMs = Date.now() - startTime;
    supabase.from('access_logs').insert({
      key_slot_id: keySlot.id,
      app_id: 'transparent-proxy',
      action: 'transparent_proxy',
      zk_proof: 'n/a',
      nullifier: crypto.randomUUID(),
      metadata: JSON.stringify({ provider, endpoint: wildcardPath, status_code: upstreamResponse.status, latency_ms: latencyMs }),
    }).then(() => {});

    // Return with CORS headers
    const responseHeaders = new Headers(upstreamResponse.headers);
    if (rateCheck.nearLimit) {
      responseHeaders.set('X-VaultProof-Usage-Warning', `${rateCheck.used}/${rateCheck.limit} calls used this month`);
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  } catch {
    return Response.json({ error: 'Upstream API error.' }, { status: 502 });
  }
}
```

**Step 2: Commit**

```bash
git add packages/worker/src/routes/transparent-proxy.ts
git commit -m "feat: transparent proxy route for Workers — full port from Fastify"
```

---

## Task 9: Wire Up the Router

**Files:**
- Modify: `packages/worker/src/index.ts`

**Step 1: Replace the current Worker with the new router**

The current Worker only signs and forwards to Railway. Replace it with the full backend.

```typescript
// packages/worker/src/index.ts
import type { Env } from './types.js';
import { handleTransparentProxy } from './routes/transparent-proxy.js';

function corsHeaders(origin: string, allowedOrigins: string[]): Record<string, string> {
  const isAllowed = allowedOrigins.includes(origin);
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : allowedOrigins[0],
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-VaultProof-Session',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const allowedOrigins = (env.ALLOWED_ORIGINS || 'https://vaultproof.dev').split(',').map(s => s.trim());
    const origin = request.headers.get('Origin') || '';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin, allowedOrigins) });
    }

    // Health check
    if (url.pathname === '/health') {
      return Response.json(
        { status: 'ok', service: 'vaultproof-edge', edge: true },
        { headers: corsHeaders(origin, allowedOrigins) }
      );
    }

    // Backend health (self-check)
    if (url.pathname === '/backend-health') {
      return Response.json(
        { status: 'ok', service: 'vaultproof' },
        { headers: corsHeaders(origin, allowedOrigins) }
      );
    }

    // Transparent proxy: /v1/*
    if (url.pathname.startsWith('/v1/')) {
      const path = url.pathname.slice(4); // remove "/v1/"
      const response = await handleTransparentProxy(request, env, path);
      // Add CORS headers to response
      const headers = new Headers(response.headers);
      for (const [k, v] of Object.entries(corsHeaders(origin, allowedOrigins))) {
        headers.set(k, v);
      }
      return new Response(response.body, { status: response.status, headers });
    }

    // TODO (Phase 2): /api/v1/* routes (keys, sdk, auth, dev-keys)
    // TODO (Phase 2): /admin/* routes
    // For now, forward these to Railway as a fallback
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin/') || url.pathname.startsWith('/analytics/')) {
      // Keep existing Railway forwarding for non-hot-path routes
      const backendUrl = env.BACKEND_URL;
      if (!backendUrl) {
        return Response.json({ error: 'Backend not configured' }, { status: 500 });
      }
      const timestamp = Date.now().toString();
      const signPayload = `${request.method}:${url.pathname}:${timestamp}`;
      const encoder = new TextEncoder();
      const keyData = encoder.encode(env.PROXY_SECRET);
      const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(signPayload));
      const signature = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');

      const headers = new Headers(request.headers);
      headers.set('X-Proxy-Signature', signature);
      headers.set('X-Proxy-Timestamp', timestamp);
      headers.set('X-Forwarded-For', request.headers.get('CF-Connecting-IP') || 'unknown');

      const backendResponse = await fetch(`${backendUrl}${url.pathname}${url.search}`, {
        method: request.method,
        headers,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      });

      const responseHeaders = new Headers(backendResponse.headers);
      for (const [k, v] of Object.entries(corsHeaders(origin, allowedOrigins))) {
        responseHeaders.set(k, v);
      }
      return new Response(backendResponse.body, { status: backendResponse.status, headers: responseHeaders });
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  },
};
```

**Step 2: Commit**

```bash
git add packages/worker/src/index.ts
git commit -m "feat: Worker router — transparent proxy direct, other routes to Railway fallback"
```

---

## Task 10: Share 2 Migration Script

**Files:**
- Create: `packages/backend/scripts/migrate-share2.ts`

This script decrypts all Share 2 data using the old scrypt method and re-encrypts with PBKDF2. Run once before switching traffic.

**Step 1: Write the migration script**

```typescript
// packages/backend/scripts/migrate-share2.ts
//
// Run with: npx tsx packages/backend/scripts/migrate-share2.ts
//
// Prerequisites:
// - VAULT_ENCRYPTION_KEY env var set
// - DATABASE_URL env var set
// - All existing share2_encrypted data uses scrypt key derivation

import { PrismaClient } from '@prisma/client';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const prisma = new PrismaClient();

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SALT_LENGTH = 16;
const PBKDF2_ITERATIONS = 100000;

// Old decryption (scrypt)
function decryptShare2Old(data: Buffer, vpKey: string): string {
  const salt = data.subarray(0, SALT_LENGTH);
  const iv = data.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = data.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const derivedKey = scryptSync(vpKey, salt, 32);
  const decipher = createDecipheriv(ALGORITHM, derivedKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
}

// New encryption (PBKDF2 — matches Worker implementation)
async function encryptShare2New(share2: string, vpKey: string): Promise<Buffer> {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  // Use Node.js pbkdf2 to match the Worker's PBKDF2
  const { pbkdf2 } = await import('crypto');
  const derivedKey = await new Promise<Buffer>((resolve, reject) => {
    pbkdf2(vpKey, salt, PBKDF2_ITERATIONS, 32, 'sha256', (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
  const cipher = createCipheriv(ALGORITHM, derivedKey, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(share2, 'utf-8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, tag, encrypted]);
}

async function main() {
  // We need the vp_live_ keys to re-encrypt. These are hashed in the DB.
  // We CANNOT re-encrypt Share 2 without the original vp_live_ key.
  //
  // Alternative approach: re-encrypt Share 1 only (which uses VAULT_ENCRYPTION_KEY).
  // Share 2 encryption stays as-is (scrypt) and we support both in the Worker.
  //
  // Actually — the simplest approach:
  // Keep Share 2 as scrypt. Only change Share 1 to PBKDF2.
  // The Worker supports the OLD scrypt format for Share 2 as a fallback.

  console.log('Migration approach: re-encrypt Share 1 from scrypt to PBKDF2.');
  console.log('Share 2 keeps scrypt (we cannot re-encrypt without vp_live_ keys).');
  console.log('Worker will support scrypt for Share 2 decryption.\n');

  // Actually, the VAULT_ENCRYPTION_KEY is used for Share 1 with scrypt.
  // We have it. So we CAN re-encrypt Share 1.

  const VAULT_KEY = process.env.VAULT_ENCRYPTION_KEY;
  if (!VAULT_KEY) {
    console.error('VAULT_ENCRYPTION_KEY not set');
    process.exit(1);
  }

  const masterKey = VAULT_KEY.length === 64 ? Buffer.from(VAULT_KEY, 'hex') : Buffer.from(VAULT_KEY, 'base64');

  const keySlots = await prisma.keySlot.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, share1Encrypted: true },
  });

  console.log(`Found ${keySlots.length} active key slots to migrate.\n`);

  let migrated = 0;
  let failed = 0;

  for (const slot of keySlots) {
    try {
      // Decrypt Share 1 with old scrypt method
      const data = Buffer.from(slot.share1Encrypted);
      const salt = data.subarray(0, SALT_LENGTH);
      const iv = data.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
      const tag = data.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
      const ciphertext = data.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
      const derivedKey = scryptSync(masterKey, salt, 32);
      const decipher = createDecipheriv(ALGORITHM, derivedKey, iv);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

      // Re-encrypt with PBKDF2
      const newSalt = randomBytes(SALT_LENGTH);
      const newIv = randomBytes(IV_LENGTH);
      const { pbkdf2Sync } = await import('crypto');
      const newDerivedKey = pbkdf2Sync(masterKey, newSalt, PBKDF2_ITERATIONS, 32, 'sha256');
      const cipher = createCipheriv(ALGORITHM, newDerivedKey, newIv);
      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const newTag = cipher.getAuthTag();
      const newEncrypted = Buffer.concat([newSalt, newIv, newTag, encrypted]);

      // Zero plaintext
      plaintext.fill(0);

      // Update in DB
      await prisma.keySlot.update({
        where: { id: slot.id },
        data: { share1Encrypted: newEncrypted },
      });

      migrated++;
      if (migrated % 10 === 0) console.log(`  Migrated ${migrated}/${keySlots.length}`);
    } catch (err) {
      failed++;
      console.error(`  FAILED slot ${slot.id}:`, (err as Error).message);
    }
  }

  console.log(`\nDone. Migrated: ${migrated}, Failed: ${failed}`);
  await prisma.$disconnect();
}

main().catch(console.error);
```

**Important realization:** We CANNOT re-encrypt Share 2 without the original `vp_live_` keys (which are hashed, not stored). So the Worker must support scrypt for Share 2 decryption.

**Step 2: Update Worker's share2.ts to support scrypt fallback**

Add to `packages/worker/src/crypto/share2.ts` — actually, Workers don't have `scryptSync`. We need to use the `node:crypto` compat layer which Workers now support with `nodejs_compat` flag.

Update wrangler.toml to include `nodejs_compat` (already done in Task 1).

Add scrypt fallback:

```typescript
// Add to packages/worker/src/crypto/share2.ts

// Legacy scrypt decryption for Share 2 (existing data)
// Uses node:crypto compat layer (requires nodejs_compat flag)
import { scryptSync, createDecipheriv } from 'node:crypto';

export function decryptShare2Legacy(data: Uint8Array, vpKey: string): string {
  const SALT_LEN = 16, IV_LEN = 12, TAG_LEN = 16;
  if (data.length < SALT_LEN + IV_LEN + TAG_LEN + 1) {
    throw new Error('Invalid encrypted Share 2: too short');
  }
  const buf = Buffer.from(data);
  const salt = buf.subarray(0, SALT_LEN);
  const iv = buf.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const tag = buf.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(SALT_LEN + IV_LEN + TAG_LEN);
  const derivedKey = scryptSync(vpKey, salt, 32);
  const decipher = createDecipheriv('aes-256-gcm', derivedKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
}
```

In the transparent proxy, try PBKDF2 first, fall back to scrypt legacy:

```typescript
// In transparent-proxy.ts, replace the share2 decryption with:
let share2Str: string;
try {
  share2Str = await decryptShare2(share2Bytes, auth.rawKey);
} catch {
  // Fallback: legacy scrypt encryption
  share2Str = decryptShare2Legacy(share2Bytes, auth.rawKey);
}
```

**Step 3: Commit**

```bash
git add packages/backend/scripts/migrate-share2.ts packages/worker/src/crypto/share2.ts
git commit -m "feat: Share 1 migration script (scrypt→PBKDF2) + Share 2 legacy scrypt fallback"
```

---

## Task 11: Deploy and Test

**Step 1: Set Worker secrets**

```bash
cd packages/worker
wrangler secret put VAULT_ENCRYPTION_KEY
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put PROXY_SECRET
wrangler secret put BACKEND_URL
```

**Step 2: Run Share 1 migration**

```bash
cd packages/backend
VAULT_ENCRYPTION_KEY=<key> DATABASE_URL=<url> npx tsx scripts/migrate-share2.ts
```

**Step 3: Deploy the new Worker**

```bash
cd packages/worker
npm run deploy
```

**Step 4: Test the transparent proxy**

```bash
# Test health
curl https://api.vaultproof.dev/health

# Test backend health
curl https://api.vaultproof.dev/backend-health

# Test proxy (should return 401 without valid key)
curl https://api.vaultproof.dev/v1/openai/v1/models
```

**Step 5: Test with promptsforeveryone**

- Verify Supabase queries work through the proxy
- Verify Stripe calls work
- Verify Minimax AI calls work
- Check response times vs old

**Step 6: Monitor for 24 hours**

Keep Railway running as fallback. Monitor error rates and latency.

**Step 7: Commit**

```bash
git commit -m "chore: deploy Workers migration — Phase 1 complete"
```

---

## Task 12: Cleanup (after 24h stable)

**Step 1: Remove Railway fallback from wrangler.toml**

Remove `BACKEND_URL` and `PROXY_SECRET` secrets.

**Step 2: Delete Railway service**

Go to Railway dashboard → delete the service.

**Step 3: Archive old backend code**

```bash
# Don't delete — move to archive for reference
git mv packages/backend packages/backend-archive
git commit -m "chore: archive Railway backend — fully migrated to Workers"
```

**Step 4: Update memory**

Update the infrastructure memory file to reflect the new architecture.
