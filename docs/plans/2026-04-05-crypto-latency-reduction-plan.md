# Crypto Latency Reduction — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce proxy crypto overhead from ~31-105ms to ~4-15ms by lowering scrypt/PBKDF2 iteration counts with lazy migration of existing keys.

**Architecture:** Lower scrypt N from 16384→4096 for Share 1, PBKDF2 from 100K→10K for Share 2. Add `crypto_version` column to `key_slots`. On proxy request, detect legacy keys and re-encrypt with new params on first use. New keys use low params from the start.

**Tech Stack:** Cloudflare Worker (TypeScript), node:crypto (scrypt), Web Crypto (PBKDF2), Supabase PostgreSQL.

**Design doc:** `docs/plans/2026-04-05-crypto-latency-reduction-design.md`

---

### Task 1: Add crypto_version to KeySlotRecord Type

**Files:**
- Modify: `packages/worker/src/types.ts:43-59`

**Step 1: Add field to KeySlotRecord interface**

Add `crypto_version` after `expires_at`:

```typescript
export interface KeySlotRecord {
  id: string;
  user_id: string;
  provider: string;
  label: string;
  env_var: string | null;
  share1_encrypted: string;
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
  crypto_version: number | null;
}
```

**Step 2: Commit**

```bash
git add packages/worker/src/types.ts
git commit -m "feat(crypto): add crypto_version to KeySlotRecord type"
```

---

### Task 2: Add crypto_version Column to Supabase

**Files:**
- None (SQL migration via Supabase dashboard or MCP)

**Step 1: Run SQL migration**

Execute this SQL against the Supabase database:

```sql
ALTER TABLE key_slots ADD COLUMN IF NOT EXISTS crypto_version integer;
COMMENT ON COLUMN key_slots.crypto_version IS 'NULL=legacy (high iterations), 2=reduced iterations (scrypt N=4096, PBKDF2 10K)';
```

**Step 2: Verify**

```sql
SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'key_slots' AND column_name = 'crypto_version';
```

Expected: `crypto_version | integer | YES`

---

### Task 3: Update encryption.ts with Configurable scrypt Params

**Files:**
- Modify: `packages/worker/src/crypto/encryption.ts`

**Step 1: Add versioned encrypt/decrypt functions**

The file currently uses `scryptSync(masterKey, salt, 32)` with Node.js defaults (N=16384). Add new functions that accept params, and keep the old ones as legacy:

```typescript
/**
 * AES-256-GCM encryption for Share 1 at rest.
 * v1 (legacy): scrypt with Node.js defaults (N=16384, r=8, p=1)
 * v2: scrypt with reduced params (N=4096, r=8, p=1)
 */
import { scryptSync, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SALT_LENGTH = 16;

const SCRYPT_V2 = { N: 4096, r: 8, p: 1 };

function getMasterKey(env: { VAULT_ENCRYPTION_KEY: string }): Buffer {
  const key = env.VAULT_ENCRYPTION_KEY;
  if (!key) throw new Error('VAULT_ENCRYPTION_KEY not set');
  if (key.length === 64) return Buffer.from(key, 'hex');
  return Buffer.from(key, 'base64');
}

/** Encrypt with v2 params (N=4096). Used for new keys and re-encryption. */
export function encryptV2(plaintext: Uint8Array, env: { VAULT_ENCRYPTION_KEY: string }): Uint8Array {
  const masterKey = getMasterKey(env);
  const salt = randomBytes(SALT_LENGTH);
  const derivedKey = scryptSync(masterKey, salt, 32, SCRYPT_V2);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, derivedKey, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return new Uint8Array(Buffer.concat([salt, iv, tag, encrypted]));
}

/** Decrypt with legacy params (Node.js defaults: N=16384). */
export function decrypt(data: Uint8Array, env: { VAULT_ENCRYPTION_KEY: string }): Uint8Array {
  if (data.length < SALT_LENGTH + IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error('Invalid encrypted data: too short');
  }
  const masterKey = getMasterKey(env);
  const buf = Buffer.from(data);
  const salt = buf.subarray(0, SALT_LENGTH);
  const iv = buf.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = buf.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const ciphertext = buf.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const derivedKey = scryptSync(masterKey, salt, 32);
  const decipher = createDecipheriv(ALGORITHM, derivedKey, iv);
  decipher.setAuthTag(tag);
  return new Uint8Array(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
}

/** Decrypt with v2 params (N=4096). */
export function decryptV2(data: Uint8Array, env: { VAULT_ENCRYPTION_KEY: string }): Uint8Array {
  if (data.length < SALT_LENGTH + IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error('Invalid encrypted data: too short');
  }
  const masterKey = getMasterKey(env);
  const buf = Buffer.from(data);
  const salt = buf.subarray(0, SALT_LENGTH);
  const iv = buf.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = buf.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const ciphertext = buf.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const derivedKey = scryptSync(masterKey, salt, 32, SCRYPT_V2);
  const decipher = createDecipheriv(ALGORITHM, derivedKey, iv);
  decipher.setAuthTag(tag);
  return new Uint8Array(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
}

/** @deprecated Use encryptV2 for new keys. Kept for reference only. */
export function encrypt(plaintext: Uint8Array, env: { VAULT_ENCRYPTION_KEY: string }): Uint8Array {
  const masterKey = getMasterKey(env);
  const salt = randomBytes(SALT_LENGTH);
  const derivedKey = scryptSync(masterKey, salt, 32);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, derivedKey, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return new Uint8Array(Buffer.concat([salt, iv, tag, encrypted]));
}

export function zeroUint8Array(arr: Uint8Array): void {
  arr.fill(0);
}
```

**Step 2: Commit**

```bash
git add packages/worker/src/crypto/encryption.ts
git commit -m "feat(crypto): add encryptV2/decryptV2 with scrypt N=4096"
```

---

### Task 4: Update share2.ts with Configurable PBKDF2 Iterations

**Files:**
- Modify: `packages/worker/src/crypto/share2.ts`

**Step 1: Add v2 functions with 10K iterations**

```typescript
const ALGORITHM = 'AES-GCM';
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const PBKDF2_ITERATIONS_LEGACY = 100000;
const PBKDF2_ITERATIONS_V2 = 10000;

async function deriveKey(vpKey: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', encoder.encode(vpKey), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    { name: ALGORITHM, length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Encrypt Share 2 with v2 params (10K iterations). Used for new keys and re-encryption. */
export async function encryptShare2V2(share2: string, vpKey: string): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const derivedKey = await deriveKey(vpKey, salt, PBKDF2_ITERATIONS_V2);
  const encoder = new TextEncoder();
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: ALGORITHM, iv }, derivedKey, encoder.encode(share2)));
  const result = new Uint8Array(SALT_LENGTH + IV_LENGTH + encrypted.length);
  result.set(salt, 0);
  result.set(iv, SALT_LENGTH);
  result.set(encrypted, SALT_LENGTH + IV_LENGTH);
  return result;
}

/** Decrypt Share 2 with v2 params (10K iterations). */
export async function decryptShare2V2(data: Uint8Array, vpKey: string): Promise<string> {
  const salt = data.slice(0, SALT_LENGTH);
  const iv = data.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = data.slice(SALT_LENGTH + IV_LENGTH);
  const derivedKey = await deriveKey(vpKey, salt, PBKDF2_ITERATIONS_V2);
  const decrypted = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, derivedKey, ciphertext);
  return new TextDecoder().decode(decrypted);
}

/** Encrypt Share 2 with legacy params (100K iterations). */
export async function encryptShare2(share2: string, vpKey: string): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const derivedKey = await deriveKey(vpKey, salt, PBKDF2_ITERATIONS_LEGACY);
  const encoder = new TextEncoder();
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: ALGORITHM, iv }, derivedKey, encoder.encode(share2)));
  const result = new Uint8Array(SALT_LENGTH + IV_LENGTH + encrypted.length);
  result.set(salt, 0);
  result.set(iv, SALT_LENGTH);
  result.set(encrypted, SALT_LENGTH + IV_LENGTH);
  return result;
}

/** Decrypt Share 2 with legacy params (100K iterations). */
export async function decryptShare2(data: Uint8Array, vpKey: string): Promise<string> {
  const salt = data.slice(0, SALT_LENGTH);
  const iv = data.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = data.slice(SALT_LENGTH + IV_LENGTH);
  const derivedKey = await deriveKey(vpKey, salt, PBKDF2_ITERATIONS_LEGACY);
  const decrypted = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, derivedKey, ciphertext);
  return new TextDecoder().decode(decrypted);
}

// Legacy scrypt decryption for existing Share 2 data.
// Uses node:crypto compat layer (requires nodejs_compat flag in wrangler.toml).
// The old format is: salt (16) + iv (12) + tag (16) + ciphertext
import { scryptSync, createDecipheriv } from 'node:crypto';

export function decryptShare2Legacy(data: Uint8Array, vpKey: string): string {
  const TAG_LENGTH = 16;
  if (data.length < SALT_LENGTH + IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error('Invalid encrypted Share 2: too short');
  }
  const buf = Buffer.from(data);
  const salt = buf.subarray(0, SALT_LENGTH);
  const iv = buf.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = buf.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const ciphertext = buf.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const derivedKey = scryptSync(vpKey, salt, 32);
  const decipher = createDecipheriv('aes-256-gcm', derivedKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
}
```

**Step 2: Commit**

```bash
git add packages/worker/src/crypto/share2.ts
git commit -m "feat(crypto): add encryptShare2V2/decryptShare2V2 with PBKDF2 10K"
```

---

### Task 5: Update Transparent Proxy to Use V2 + Lazy Migration

**Files:**
- Modify: `packages/worker/src/routes/transparent-proxy.ts:7-9,278-312`

This is the core change. The proxy must:
1. Detect `crypto_version` on the key slot
2. Use appropriate decrypt functions
3. If legacy, re-encrypt with v2 params and update DB (via `ctx.waitUntil` — non-blocking)

**Step 1: Update imports**

Change lines 7-9 from:
```typescript
import { decrypt, zeroUint8Array } from '../crypto/encryption.js';
import { decryptShare2, decryptShare2Legacy } from '../crypto/share2.js';
```

To:
```typescript
import { decrypt, decryptV2, encryptV2, zeroUint8Array } from '../crypto/encryption.js';
import { decryptShare2, decryptShare2V2, encryptShare2V2, decryptShare2Legacy } from '../crypto/share2.js';
```

**Step 2: Replace the reconstruction block (lines 278-312)**

Replace the reconstruction section with version-aware logic:

```typescript
  // g. Reconstruct API key
  tStep = performance.now();
  let apiKey: string | null = null;
  const isV2 = keySlot.crypto_version === 2;

  try {
    // Decrypt Share 1
    const share1CacheKey = `s1:${keySlot.id}`;
    let share1Str = memGet<string>(share1CacheKey);
    if (!share1Str) {
      const share1Bytes = hexToBytes(keySlot.share1_encrypted);
      const decryptedShare1 = isV2 ? decryptV2(share1Bytes, env) : decrypt(share1Bytes, env);
      share1Str = new TextDecoder().decode(decryptedShare1);
      zeroUint8Array(decryptedShare1);
      memSet(share1CacheKey, share1Str, 5);
    }

    // Decrypt Share 2
    const share2Bytes = hexToBytes(keySlot.share2_encrypted!);
    let share2Str: string;
    if (isV2) {
      share2Str = await decryptShare2V2(share2Bytes, auth.rawKey);
    } else {
      try {
        share2Str = await decryptShare2(share2Bytes, auth.rawKey);
      } catch {
        share2Str = decryptShare2Legacy(share2Bytes, auth.rawKey);
      }
    }

    // Combine shares
    const share1 = deserializeShare(share1Str);
    const share2 = deserializeShare(share2Str);
    const combined = combineShares([share1, share2]);
    apiKey = new TextDecoder().decode(combined);
    zeroUint8Array(combined);

    // Lazy migration: re-encrypt with v2 params (non-blocking)
    if (!isV2 && ctx) {
      const plainShare1 = new TextEncoder().encode(share1Str);
      const newShare1 = encryptV2(plainShare1, env);
      zeroUint8Array(plainShare1);
      const newShare2 = await encryptShare2V2(share2Str, auth.rawKey);
      const newShare1Hex = bytesToHex(newShare1);
      const newShare2Hex = bytesToHex(newShare2);

      ctx.waitUntil(
        getSupabase(env)
          .from('key_slots')
          .update({
            share1_encrypted: newShare1Hex,
            share2_encrypted: newShare2Hex,
            crypto_version: 2,
          })
          .eq('id', keySlot.id)
          .then(() => {
            // Invalidate Share 1 cache so next request uses v2
            memSet(share1CacheKey, null, 0);
          })
      );
    }
  } catch {
    return Response.json({ error: 'Key reconstruction failed.' }, { status: 400 });
  }

  timings.crypto = performance.now() - tStep;
```

**Step 3: Add bytesToHex helper**

Check if `bytesToHex` already exists in transparent-proxy.ts (there's `hexToBytes` — we need the reverse). If not, add near the top of the file alongside `hexToBytes`:

```typescript
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
```

**Step 4: Verify `ctx` is available**

Check the function signature of `handleTransparentProxy`. It should already receive `ctx: ExecutionContext` — verify this. If not, add it.

**Step 5: Verify `getSupabase` is imported**

Check if `getSupabase` is already imported in transparent-proxy.ts. It should be — it's used for logging. If not, add:

```typescript
import { getSupabase } from '../lib/supabase.js';
```

**Step 6: Commit**

```bash
git add packages/worker/src/routes/transparent-proxy.ts
git commit -m "feat(crypto): add v2 decryption + lazy migration in proxy"
```

---

### Task 6: Update Key Storage Routes to Use V2

**Files:**
- Modify: `packages/worker/src/routes/keys.ts` (lines with `encrypt(`)
- Modify: `packages/worker/src/routes/sdk.ts` (lines with `encrypt(`)
- Modify: `packages/worker/src/routes/scanner.ts` (lines with `encrypt(` and `encryptShare2(`)

All new keys should use v2 encryption and set `crypto_version: 2`.

**Step 1: Update keys.ts**

Find all `encrypt(` calls (lines ~90 and ~289) and change to `encryptV2(`. Update the import from:
```typescript
import { encrypt, ... } from '../crypto/encryption.js';
```
To:
```typescript
import { encryptV2, ... } from '../crypto/encryption.js';
```

Also find the Supabase insert/update for key_slots and add `crypto_version: 2` to the data object.

**Step 2: Update sdk.ts**

Find `encrypt(` call (line ~83) and change to `encryptV2(`. Update the import. Add `crypto_version: 2` to the Supabase insert.

**Step 3: Update scanner.ts**

Find `encrypt(` call (line ~1867) and change to `encryptV2(`. Find `encryptShare2(` call (line ~1874) and change to `encryptShare2V2(`. Update imports. Add `crypto_version: 2` to the Supabase insert.

**Step 4: Commit**

```bash
git add packages/worker/src/routes/keys.ts packages/worker/src/routes/sdk.ts packages/worker/src/routes/scanner.ts
git commit -m "feat(crypto): use v2 encryption for new key storage"
```

---

### Task 7: Update Tier Rate Limit to Use Memory Cache

**Files:**
- Modify: `packages/worker/src/lib/rate-limit.ts`

This is an additional optimization — move tier rate limit counter from KV (50-100ms) to in-memory first, falling back to KV.

**Step 1: Add in-memory tier counter**

In `checkTierRateLimit`, add an L1 memory check before the KV read. Use the existing `memGet`/`memSet` pattern:

```typescript
import { memGet, memSet } from './mem-cache.js';
```

At the start of `checkTierRateLimit`, check memory first:

```typescript
const memKey = `tier:${keySlotId}`;
const memCount = memGet<number>(memKey);
if (memCount !== null) {
  // Use memory count, skip KV read
  const newCount = memCount + 1;
  memSet(memKey, newCount, 60);
  // Still write to KV in background for cross-isolate consistency
  // ... existing KV write logic
}
```

This saves 50-100ms on the warm path by skipping the KV read.

**Step 2: Commit**

```bash
git add packages/worker/src/lib/rate-limit.ts
git commit -m "perf: add in-memory tier rate limit cache"
```

---

### Task 8: Deploy and Verify

**Step 1: Deploy to staging**

```bash
cd packages/worker
wrangler deploy --env staging
```

**Step 2: Test with an existing key**

Make a proxy request through staging. Check the `Server-Timing` response header for crypto timing:
```
Server-Timing: crypto;dur=XX
```

First request (legacy key): should show higher crypto time + trigger lazy migration.
Second request: should show v2 crypto time (~4-15ms warm).

**Step 3: Verify migration happened**

```sql
SELECT id, crypto_version FROM key_slots WHERE crypto_version = 2;
```

Should show the key that was just used.

**Step 4: Test with a new key**

Store a new key via the dashboard. Verify it's created with `crypto_version = 2`.

**Step 5: Deploy to production**

```bash
cd packages/worker
wrangler deploy
```

**Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix(crypto): adjustments from deployment testing"
```
