# ZK-MCP Demo: P0 + P1 Improvements Design

**Date:** 2026-03-29
**Status:** Approved
**Goal:** Add session tokens (P0), nullifiers (P1a), and per-client rate limiting (P1b) to the ZK-auth MCP demo.

---

## What We're Adding

| Item | Priority | Purpose |
|------|----------|---------|
| Session tokens | P0 | Avoid ZK math on every request — prove once, get a token |
| Nullifiers | P1a | Prevent same-body replay within the 60s timestamp window |
| Rate limiting | P1b | Per-client request quotas using `H(pubkey)` as pseudonymous ID |

---

## Session Tokens (P0)

### Flow

```
1. Client sends ZK proof (existing) → server verifies
2. Server generates token = 32 random bytes (hex)
   stores: SHA-256(token) → { userId, pubkey, expiresAt: now + 15min }
   returns token in response header: X-Session-Token: <hex>
3. Client stores token, sends on subsequent requests:
   header: X-Session-Token: <hex>
4. Server checks X-Session-Token first:
     valid + not expired → skip ZK proof entirely
     missing / invalid / expired → require ZK proof (fallback)
5. Client re-proves transparently when token expires
```

### Storage

```typescript
// src/auth/session-store.ts
Map<tokenHash, { userId: string; pubkeyHex: string; expiresAt: number }>
```

Token hash = `SHA-256(rawToken)` — raw token never stored, only its hash.

### Audit events added

- `session_issued` — userId, pubkeyHex prefix, expiresAt
- `session_used` — userId, tokenHash prefix
- `session_expired` — userId

---

## Nullifiers (P1a)

### What it prevents

The timestamp window already rejects proofs older than ~60 seconds. Nullifiers prevent the remaining gap: the same proof (same userId + same canonical body + same ts slot) being submitted twice within that window.

This is the same technique used by Worldcoin/Semaphore at 12M+ users.

### Flow

```
On every successful ZK proof verification:
  nullifier = SHA-256(userId + ":" + canonical(body) + ":" + ts_slot)

  if nullifier in store → 401 "Proof already used"
  else → store nullifier with slot metadata, proceed

Pruning (every 60s): drop all nullifiers from expired slots (slot < now_slot - 1)
```

### Storage

```typescript
// src/auth/nullifier-store.ts
Map<nullifier_hex, ts_slot>  // slot stored for pruning
```

### Audit events added

- `nullifier_rejected` — userId, nullifier prefix

---

## Rate Limiting (P1b)

### Design

Token bucket per client. Client identified by `SHA-256(pubkeyHex).slice(0, 16)` — pseudonymous, no identity leaked, stable across sessions.

```
Limit: 60 requests per 60-second window
Key:   H(pubkey).slice(0,16)

On each request (after auth):
  bucket = get or create { count, windowStart }
  if now - windowStart > 60s → reset bucket
  if count >= 60 → 429 Too Many Requests
  else → count++, proceed
```

### Storage

```typescript
// src/auth/rate-limiter.ts
Map<bucketKey, { count: number; windowStart: number }>
```

### Audit events added

- `rate_limited` — bucketKey, count

---

## Updated Handler Flow

```
POST /mcp:
  1. Check X-Session-Token header
       → valid + not expired: resolve userId + pubkey, skip to step 4
       → missing/invalid/expired: fall through to ZK proof
  2. Parse + verify ZK proof (existing: parse, lookup pubkey, verify)
  3. Check nullifier → reject if seen, store if new
  4. Rate limit by H(pubkey) → 429 if over limit
  5. Dispatch to MCP tool (existing)
  6. If step 2 was used (ZK path): issue session token in X-Session-Token response header
```

---

## New Files

```
src/auth/
  session-store.ts    — SessionStore class
  nullifier-store.ts  — NullifierStore class with slot-based pruning
  rate-limiter.ts     — RateLimiter class
```

## Modified Files

```
src/mcp/handler.ts   — integrate all three stores into auth flow
src/server.ts        — pass stores to handler, forward session token header
src/audit-log.ts     — add new event types
```

---

## What This Does NOT Add

- Persistence (registry + audit log stay in-memory — deferred to VaultProof integration)
- Token refresh endpoint (client just re-proves on expiry)
- Multi-instance shared state (single-process demo only)
