# Proxy Hot Path Performance Audit

**Date:** 2026-04-05

## Hot Path Breakdown

```
Request Entry
  ├─ [<1ms] Provider extraction (string parse)
  ├─ [Auth] authenticateDevKey()
  │  ├─ [<1ms] SHA-256 hash of API key
  │  ├─ [KV read] devkey:${keyHash} — 10s cache
  │  └─ [Supabase read, IF MISS] developer_keys lookup
  │
  ├─ [<1ms] IP allowlist + provider/endpoint restrictions
  ├─ [In-memory] Per-key rate limit — no I/O
  │
  ├─ [User + KeySlot fetch]
  │  ├─ [KV read x2, parallel] user:${userId}, keyslot:${userId}:${provider} — 10s cache
  │  └─ [Supabase read x2, IF MISS, parallel] users, key_slots
  │
  ├─ [Tier Rate Limit]
  │  ├─ [KV read] monthly:${keySlotId}
  │  ├─ [Supabase count, IF MISS] access_logs
  │  └─ [KV write] increment counter
  │
  ├─ [Share Reconstruction] 80-130ms ← BOTTLENECK
  │  ├─ [scryptSync] Share 1 decryption (~60-100ms)
  │  ├─ [PBKDF2 100k] Share 2 decryption (~20-30ms)
  │  ├─ [AES-GCM x2] decryptions (~2-4ms)
  │  └─ [GF(256)] Lagrange reconstruction (~1-2ms)
  │
  ├─ [<1ms] Upstream URL + header building
  └─ [UPSTREAM API] fetch() to provider
     └─ [Background] access_logs insert, threshold alerts
```

## What's Already Good

- Auth, user, key slot cached in KV (10s TTL)
- Per-key burst rate limit is in-memory only (no I/O)
- Access logs and alerts on ctx.waitUntil() (background)
- GF(256) share reconstruction is fast (~1-2ms)
- Header forwarding uses allowlist approach

## The Bottleneck

**Crypto: 80-130ms per request, every request.**

- scryptSync for Share 1 key derivation: ~60-100ms
- PBKDF2 (100k iterations) for Share 2 key derivation: ~20-30ms
- No caching of decrypted shares — reconstructed fresh every time
- This is the largest cost besides the upstream API call itself

## KV Reads on Hot Path (per request)

| Read | Key Pattern | TTL | Can Avoid? |
|------|-------------|-----|------------|
| Auth cache | `devkey:${keyHash}` | 10s | Yes — isolate memory |
| User cache | `user:${userId}` | 10s | Yes — isolate memory |
| KeySlot cache | `keyslot:${userId}:${provider}` | 10s | Yes — isolate memory |
| Monthly counter | `monthly:${keySlotId}` | End of month | Yes — buffer increments |

**Total: 4 KV reads + 1 KV write per request (on cache hit)**

## Optimization Priority

### 1. Isolate-local memory cache for decrypted Share 1
- Cache decrypted share material (not the full API key) for ~5 seconds
- Keyed by key slot ID
- Eliminates 60-100ms scrypt on repeated requests in the same isolate
- **Expected savings: 60-100ms on warm requests**

### 2. Isolate-local memory cache for auth + user + keySlot
- Cache in Worker memory above KV
- Skip 3-4 KV round-trips for repeated traffic
- Short TTL (5-10s) to match current KV TTL
- **Expected savings: 5-15ms per request (KV latency)**

### 3. Monthly usage counter redesign
- Current: KV read + write on every request
- Options: Durable Object counter, buffered async increments, periodic reconciliation
- **Expected savings: 3-8ms per request (KV write removal)**

### 4. Supabase client singleton
- Currently creates new client per getSupabase() call
- Cloudflare reuses HTTP connections but object creation is unnecessary
- **Expected savings: <1ms but cleaner code**

### 5. Reduce repeated crypto/serialization
- Precompute hex-to-bytes for share1_encrypted (stored as hex string in DB)
- Cache deserialized share metadata alongside the decrypted share
- **Expected savings: <1ms**

## Estimated Impact

| Scenario | Current | After Optimizations |
|----------|---------|---------------------|
| Cold request (all KV misses) | ~200-300ms + upstream | ~200-300ms + upstream (no change) |
| Warm request (KV hits) | ~100-150ms + upstream | ~10-20ms + upstream |
| Hot request (same isolate, cached) | N/A | ~5-10ms + upstream |

## Constraints

- Do NOT cache the fully reconstructed API key in memory
- Decrypted Share 1 cache is acceptable (useless without Share 2 + user's vp_ key)
- Revocation must propagate within cache TTL window
- Monthly limits must remain accurate (small overshoot acceptable)
