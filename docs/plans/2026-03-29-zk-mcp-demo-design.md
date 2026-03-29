# ZK-Auth MCP Server — Demo Design

**Date:** 2026-03-29
**Status:** Built + security-patched
**Goal:** Standalone local Node.js MCP server where authentication uses a Schnorr ZK proof instead of an API key, OAuth token, or password. Proof-of-concept — intended to validate the pattern before integrating into VaultProof.

---

## The Problem

Every LLM API and MCP server today authenticates callers with bearer tokens or API keys. These can be:

- Leaked in logs, frontends, or version control
- Replayed by anyone who intercepts them
- Stolen without the owner knowing

**The goal:** The client proves "I am allowed to call this" without ever sending a secret over the wire.

---

## The Solution: Schnorr ZK Proof (Fiat-Shamir)

A **Schnorr proof** is a non-interactive zero-knowledge proof of knowledge of a discrete logarithm. The client proves they know the private key behind a public key, without revealing the private key.

Uses **secp256k1** via `@noble/curves` — no WASM, no circuit compilation, pure Node.js.

---

## How It Works

### Concepts

| Term | Meaning |
|------|---------|
| `s` | Client's secret (private key, 32 random bytes) |
| `G` | secp256k1 generator point |
| `P = s * G` | Client's public key (stored on server) |
| `k` | Random nonce (fresh per request) |
| `R = k * G` | Commitment to the nonce |
| `e` | Challenge: `SHA256(R ‖ P ‖ canonical(body) ‖ ts)` |
| `z = k + e*s` | Response (proves knowledge of `s`) |
| `ts` | Timestamp slot: `floor(Date.now() / 30000)` |

### Registration (one-time)

```
client:
  s  = random 32 bytes              ← private key, never leaves client
  P  = s * G                        ← public key

client → server:  POST /register
  body: { userId, pubkey: P }

server:
  stores { userId → P }
```

### Per-request Authentication (Schnorr proof)

```
client (for each MCP request):
  k  = random nonce
  R  = k * G
  ts = floor(Date.now() / 30000)         ← 30-second slot
  e  = SHA256(R || P || JCS(body) || ts) ← Fiat-Shamir challenge
  z  = k + e * s  (mod curve order)
  proof = { userId, R, z, ts }

client → server:  POST /mcp
  header: X-ZK-Proof: { userId, R, z, ts }
  body:   <MCP JSON-RPC request>

server:
  1. look up P by userId
  2. check |ts - now_slot| ≤ 1          ← reject stale proofs
  3. recompute e = SHA256(R || P || JCS(body) || ts)
  4. reject if e == 0                    ← e=0 forgery guard
  5. check: z * G == R + e * P
  6. if valid → execute MCP tool
  7. if invalid → 401
```

**JCS** = JSON Canonicalization Scheme (RFC 8785) — sorts keys, normalises whitespace, so the same logical payload always hashes the same regardless of key ordering or serialiser differences.

### Why This Is Zero-Knowledge

The equation `z * G == R + e * P` holds iff `z = k + e*s`. The server sees `(R, z)` but cannot extract `s` — the discrete log problem makes this computationally infeasible. The client never transmits `s` or `k`.

---

## Architecture

```
zk-mcp-demo/
  src/
    auth/
      schnorr.ts        — prove() / verify() / canonicalizeBody()
      registry.ts       — in-memory Map<userId, pubkey>
    mcp/
      tools.ts          — echo, get_secret, get_user_info
      handler.ts        — ZK auth middleware → JSON-RPC dispatch
    audit-log.ts        — structured event log (register, auth, tool calls)
    zk-transport.ts     — MCP SDK Transport implementation (ZK per request)
    server.ts           — Express: /register, /mcp, /logs
    client-demo.ts      — raw fetch demo client + replay attack demo
    sdk-client.ts       — real MCP SDK Client using ZKTransport
  package.json
  tsconfig.json
```

---

## Security Fixes Applied (post-research)

Three vulnerabilities found in security research and patched:

| Issue | Risk | Fix |
|-------|------|-----|
| JSON serialisation not canonical | Different key order → different hash → broken or forgeable verification | RFC 8785 JCS via `json-canonicalize` |
| `e = 0` challenge forgery | Public key drops out of verification equation; any `z` passes | Explicit `if (e === 0n) return false` guard |
| No proof expiry | Captured proof valid forever | `ts` field (30s slot) in Fiat-Shamir hash; server rejects `|ts - now| > 1` |

---

## Known Remaining Risks

| Risk | Severity | Notes |
|------|----------|-------|
| Nonce reuse | Critical | If PRNG entropy is weak, two proofs with same `k` leak private key algebraically. Mitigated by `secp256k1.utils.randomPrivateKey()` using OS entropy. Follow BIP-340 aux_rand mixing before production. |
| Full proof per request | Performance | ZK math on every call adds ~1ms. Acceptable for demo; use session tokens in production. |
| In-memory registry + audit log | Ops | Lost on restart. Replace with Supabase at VaultProof integration time. |
| Raw body re-serialisation in server | Edge case | `server.ts` does `JSON.stringify(req.body)` (re-serialised). Self-consistent in demo. In CF Worker, use `request.text()` instead. |

---

## Production Improvements (identified, not yet built)

### P0 — Before any real users
1. **Session tokens** — prove once → server issues short-lived token (PASETO/JWT, 15 min) → use token for subsequent calls. Eliminates ZK math on every request.
2. **Persistent registry** — swap in-memory `Map` for Supabase table.
3. **Persistent audit log** — write to DB or structured log (Axiom/BetterStack).

### P1 — Before production traffic
4. **Semaphore-style nullifiers** — `H(privkey || body_hash || epoch)` prevents same-body replay without server nonce state.
5. **Server-issued nonce** — strongest replay prevention: server issues one-use nonce per session, client binds proof to nonce.
6. **Rate limiting by `H(pubkey)`** — pseudonymous per-client rate limiting without storing the key itself.

### P2 — VaultProof integration
7. **Swap `schnorr.ts` for Noir circuit** — replace secp256k1 Schnorr with existing `zk-engine.ts` Poseidon2 circuit.
8. **Swap registry for Supabase** — commitments, not pubkeys.
9. **Swap Express for CF Worker** — same shape as `packages/mcp-server/`.
10. **Nullifier KV** — track used `R` values for atomic one-use enforcement.

---

## Who Has Shipped ZK Auth in Production

| Project | What | Status |
|---------|------|--------|
| Sui zkLogin | Groth16 proof of OAuth JWT ownership | Mainnet, ACM CCS 2024, dual-audited |
| Worldcoin / World ID | Semaphore proof of biometric uniqueness | 12–16M users, Tinder integration |
| Polygon ID / Privado ID | ZK credential attribute proofs | Production since Q2 2022 |
| Semaphore | Anonymous group membership + nullifiers | Live on Ethereum mainnet |
| Aztec / Noir | ZKPassport + StealthNote | Ignition Chain live Nov 2025 |
| Sedicii | Enterprise ZK identity | Production in financial services |

**Nobody has shipped ZK auth for a general-purpose API gateway.** This is novel territory.

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/sdk` | MCP Client + Transport interface |
| `@noble/curves` | secp256k1 Schnorr math (no WASM) |
| `@noble/hashes` | SHA-256 |
| `json-canonicalize` | RFC 8785 JSON Canonicalization Scheme |
| `express` | HTTP server |

---

## VaultProof Integration Path

| Component | Demo | VaultProof |
|-----------|------|-----------|
| `schnorr.ts` prove/verify | secp256k1 Schnorr | Noir circuit (`zk-engine.ts`) |
| Registry store | in-memory `Map` | Supabase (commitments) |
| HTTP server | Express | Cloudflare Worker (`packages/mcp-server/`) |
| Replay protection | `ts` window | KV nullifier store |
| Auth merge | standalone | alongside / replacing OAuth in `feature/mcp-server` |
