# Crypto Latency Reduction — Design

**Date:** 2026-04-05
**Status:** Approved

## Overview

Reduce proxy overhead from ~31-105ms (warm) to ~4-15ms (warm) by lowering key derivation iteration counts for both Shamir shares. Lazy migration re-encrypts existing keys on next use.

## Changes

### Share 1 (scrypt + AES-256-GCM)

- **File:** `packages/worker/src/crypto/encryption.ts`
- **Current:** `scryptSync(masterKey, salt, 32)` — Node.js defaults: N=16384, r=8, p=1
- **New:** `scryptSync(masterKey, salt, 32, { N: 4096, r: 8, p: 1 })`
- **Latency:** 50-200ms → 10-40ms
- **Note:** Share 1 is also memory-cached (5s TTL), so warm-path impact is minimal

### Share 2 (PBKDF2 + AES-256-GCM)

- **File:** `packages/worker/src/crypto/share2.ts`
- **Current:** `PBKDF2_ITERATIONS = 100000`
- **New:** `PBKDF2_ITERATIONS = 10000`
- **Latency:** 30-100ms → 3-10ms
- **Note:** Share 2 is never cached — derived from user's vp_ token each request

### Shamir Combine (unchanged)

- GF(256) Lagrange interpolation stays at ~1-5ms
- No changes needed

### DB Schema

- Add `crypto_version` column to `key_slots` table
  - `NULL` = legacy (high iteration counts)
  - `2` = new (reduced iteration counts)

## Lazy Migration

Old keys stay encrypted with legacy params until their next use:

1. Request arrives, read `key_slots.crypto_version`
2. If `NULL` (legacy):
   - Decrypt Share 1 with old scrypt defaults (N=16384)
   - Decrypt Share 2 with old PBKDF2 (100K iterations)
   - Re-encrypt Share 1 with new scrypt (N=4096)
   - Re-encrypt Share 2 with new PBKDF2 (10K iterations)
   - Update `key_slots` with new encrypted shares + `crypto_version = 2`
3. If `2` (new):
   - Decrypt with new params directly
4. Continue normal proxy flow

First request for a legacy key pays the old latency cost once, then all subsequent requests are fast.

## Latency Impact

### Warm path (Share 1 cached)

| Step | Before | After |
|------|--------|-------|
| Share 1 (cache hit) | <5ms | <5ms |
| Share 2 decrypt | 30-100ms | 3-10ms |
| Shamir combine | 1-5ms | 1-5ms |
| **Total crypto** | **31-105ms** | **4-15ms** |

### Cold path (all cache miss)

| Step | Before | After |
|------|--------|-------|
| Share 1 decrypt | 50-200ms | 10-40ms |
| Share 2 decrypt | 30-100ms | 3-10ms |
| Shamir combine | 1-5ms | 1-5ms |
| **Total crypto** | **81-405ms** | **14-55ms** |

## What Doesn't Change

- AES-256-GCM encryption algorithm
- Shamir 2-of-2 secret sharing scheme
- Share 1 memory cache (5s TTL)
- Zero-after-use behavior
- Share format and storage encoding (hex in Supabase)
- Legacy scrypt fallback path for old Share 2 format

## Security Considerations

- 10K PBKDF2 iterations is used by 1Password and other password managers
- scrypt N=4096 is still computationally expensive for brute-force
- Shares are protected by two independent secrets (VAULT_ENCRYPTION_KEY + user's vp_ token)
- An attacker needs both secrets plus the encrypted shares to reconstruct — iteration count is a third layer of defense
