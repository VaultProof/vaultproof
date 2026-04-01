# Workers Migration Design — Move VaultProof to Cloudflare Edge

> Drop Railway. Move the entire backend to CF Workers + Supabase. First Shamir-based secrets vault running at the edge.

**Goal:** Cut ~100-120ms per proxied call by eliminating the Railway round trip. Two vendors: Cloudflare + Supabase. $5/mo at current scale, scales cheaper than Railway.

---

## Architecture

```
Before:
  App → CF Worker (sign) → Railway (Prisma + reconstruct + proxy) → Provider
  Overhead: ~150-200ms

After:
  App → CF Worker (Supabase REST + reconstruct + proxy) → Provider
  Overhead: ~50-80ms

ZK proofs (rare, not in hot path):
  → Supabase Edge Function
```

### Components

| Component | Runs on | Responsibility |
|---|---|---|
| Edge Proxy Worker | CF Workers ($5/mo paid) | Auth, key lookup, Shamir reconstruction, rate limiting, proxy to upstream |
| Database | Supabase PostgreSQL (free tier) | All tables accessed via REST API |
| ZK Verifier | Supabase Edge Function (free tier) | Noir proof verification (only `/api/v1/proxy/call`) |

### What moves where

| Current (Railway/Fastify) | After |
|---|---|
| Transparent proxy (`/v1/:provider/*`) | CF Worker |
| Dev key auth | CF Worker |
| Shamir reconstruct + AES decrypt | CF Worker (Web Crypto + privy-io/shamir) |
| Rate limiting | CF Worker (KV-based) |
| Prisma DB queries | Supabase REST API (supabase-js) |
| Admin routes | CF Worker |
| Key storage, SDK routes | CF Worker |
| ZK proof verification | Supabase Edge Function |

---

## Crypto Migration

| Current (Node.js) | After (CF Worker) |
|---|---|
| `crypto.scryptSync` (Share 2 key derivation) | Web Crypto `PBKDF2` |
| `crypto.createCipheriv` (AES-256-GCM) | `subtle.encrypt` / `subtle.decrypt` |
| `crypto.createHash('sha256')` | `subtle.digest('SHA-256')` |
| `crypto.createHmac` (request signing) | Removed — Worker talks to Supabase directly |
| `@vaultproof/shamir` | `privy-io/shamir-secret-sharing` (pure TS, audited) |
| `crypto.randomBytes` | `crypto.getRandomValues` |

**Breaking change:** Share 2 uses scrypt → PBKDF2. Existing data must be migrated. Run a one-time migration script: decrypt with scrypt, re-encrypt with PBKDF2. Clean cutover, no dual-path.

---

## Data Access

Replace Prisma with supabase-js REST calls.

### Query mapping

| Query | Prisma | Supabase REST |
|---|---|---|
| Dev key by hash | `findUnique({ where: { keyHash } })` | `.from('developer_keys').select('*').eq('key_hash', h).single()` |
| Key slot by provider | `findFirst({ where: { userId, provider, status } })` | `.from('key_slots').select('*').eq('user_id', u).eq('provider', p).eq('status', 'ACTIVE').limit(1).single()` |
| Insert access log | `create({ data })` | `.from('access_logs').insert({...})` |
| Rate limit count | `count({ where })` | `.select('*', { count: 'exact', head: true }).eq(...)` |

### KV caching

| Data | TTL | Why |
|---|---|---|
| Dev key lookup (by hash) | 30s | Hot path, every request |
| Key slot (encrypted shares) | 30s | Avoids DB round trip |
| User tier/limits | 60s | Doesn't change often |
| Rate limit counters | 60s window | Per-key call counts |
| Access logs | No cache | Write-only |

On key revocation: delete KV cache entry immediately.

---

## Worker Structure

```
packages/worker/src/
  index.ts                — router
  routes/
    transparent-proxy.ts  — /v1/:provider/* (hot path)
    keys.ts               — /api/v1/keys/*
    sdk.ts                — /api/v1/sdk/*
    auth.ts               — /api/v1/auth/*
    admin.ts              — /admin/*
    dev-keys.ts           — /api/v1/dev-keys/*
  crypto/
    shamir.ts             — privy-io wrapper
    encryption.ts         — Web Crypto AES-256-GCM
    share2.ts             — PBKDF2 derivation + AES for Share 2
  lib/
    supabase.ts           — client init
    cache.ts              — KV helpers
    rate-limit.ts         — KV-based rate limiting
    auth.ts               — dev key auth + sessions
```

### Bindings (wrangler.toml)

```toml
[vars]
ALLOWED_ORIGINS = "https://vaultproof.dev"

[[kv_namespaces]]
binding = "CACHE"

[secrets]
# VAULT_ENCRYPTION_KEY
# SUPABASE_URL
# SUPABASE_SERVICE_ROLE_KEY
```

Bundle size: well under 10MB. No Prisma, no Noir WASM.

---

## Migration Plan (Zero Downtime)

### Phase 1: Build new Worker
- Port all routes
- Crypto rewrite (Web Crypto + privy-io/shamir)
- Supabase REST for all DB queries
- KV caching layer
- Deploy as `vaultproof-v2` (separate Worker, no traffic)

### Phase 2: Migration script
- Re-encrypt all Share 2 data: scrypt → PBKDF2
- Add `migrated` flag column
- Non-destructive: old data preserved in backup column

### Phase 3: Test
- Point promptsforeveryone at new Worker URL
- Verify Supabase, Stripe, Minimax proxy calls
- Compare response times old vs new
- Run adapted test suite

### Phase 4: Switch traffic
- Update `api.vaultproof.dev` to point to new Worker
- Monitor 24 hours
- Keep Railway running idle as rollback

### Phase 5: Cleanup
- Delete Railway service (-$5/mo)
- Archive `packages/backend` Fastify code
- Move ZK verifier to Supabase Edge Function

### Rollback
Switch DNS back to Railway. Old backend still running, old Share 2 encryption still works.

---

## Cost

| Scale | CF Workers | Railway equivalent |
|---|---|---|
| Current | $5/mo | $5/mo |
| 1M calls/mo | $5/mo | $5/mo |
| 10M calls/mo | $5.40/mo | $20+/mo |
| 100M calls/mo | $41.40/mo | $100+/mo |

---

## Risks

| Risk | Mitigation |
|---|---|
| Cross-request data leak via globals | Never store secrets in globals, pass through function args |
| Developer error logging secrets | Never log env vars, code review discipline |
| Dependency supply chain | Minimize deps (privy-io/shamir + supabase-js only) |
| KV eventual consistency (revoke delay) | Delete KV entry on revoke, 30s TTL max |
| scrypt → PBKDF2 migration | One-time script, backup old data, rollback possible |
| Unkey's lesson (KV p99 latency) | KV only for caching, not critical path. Supabase REST as fallback |
