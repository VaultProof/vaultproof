# VaultProof Security Audit

**Date:** 2026-03-25
**Scope:** Full codebase review of packages/backend, packages/shamir, packages/sdk, packages/cli, packages/widget, packages/worker

---

## Architecture Security

### Key Storage (Shamir + Dual Encryption)

**Status: SECURE**

The API key never exists whole on the server.

1. SDK splits key locally using Shamir 2-of-2 over GF(256)
2. Share 1 encrypted with AES-256-GCM using `VAULT_ENCRYPTION_KEY` (server env var)
3. Share 2 encrypted with AES-256-GCM using developer's `vp_live_` key (scrypt KDF)
4. Both encrypted shares stored in PostgreSQL

**To breach:** attacker needs database + VAULT_ENCRYPTION_KEY + vp_live_ key (three separate places).

**Verified by:**
- 14 security tests (shamir splitting, encryption, zeroing, tampering)
- 7 integration tests (store, encrypt at rest, revoke, app auth)
- Manual E2E test in production (register → store → proxy → revoke)

### Proxy Call (Ephemeral Reconstruction)

**Status: SECURE (with accepted risk)**

1. Server decrypts Share 1 with VAULT_ENCRYPTION_KEY
2. Server decrypts Share 2 with developer's vp_live_ key
3. Shares combined to reconstruct API key (~100ms)
4. Upstream API call made
5. Key zeroed from memory (Buffer.fill(0), string set to '')

**Accepted risk:** Key exists in server RAM for ~100ms. Mitigated by ephemeral lifetime + buffer zeroing. Future TEE tier will eliminate this.

**Verified by:** Buffer zeroing test, manual proxy test, access log creation test.

---

## Cryptography

| Algorithm | Use | Assessment |
|---|---|---|
| AES-256-GCM | Share encryption at rest | Strong. Random salt + IV per encryption. Auth tag prevents tampering. |
| Scrypt | Key derivation from master key / vp_live_ key | Strong. Memory-hard, slow. |
| HMAC-SHA256 | Worker → Backend proxy auth | Strong. Timing-safe comparison. 30s replay window. |
| Shamir SSS (GF(256)) | Key splitting | Strong. Proven, polynomial-based. Single share reveals zero info. |
| Noir Plonk | ZK proofs (Poseidon2, Merkle) | Strong. Real Barretenberg verification. Tampered proofs rejected. |
| Bcrypt (12 rounds) | Password hashing | Strong. Industry standard. |

**No use of Math.random() for cryptographic operations.** All randomness from crypto.randomBytes (verified by test).

---

## Authentication & Authorization

### JWT Authentication
- Bearer token in Authorization header
- 7-day expiry
- Payload: { userId, email }
- All key management routes require valid JWT
- **Fix applied:** Production startup now fails if JWT_SECRET is missing or default

### Developer API Keys (vp_live_)
- Generated from crypto.randomBytes(24) + base64url
- SHA-256 hashed for DB lookup (raw key never used for queries)
- Full key shown once at creation, then masked
- Revocation supported (revokedAt timestamp)

### Proxy Authentication (Worker → Backend)
- HMAC-SHA256 signature on method:path:timestamp
- 30-second timestamp drift max (anti-replay)
- Timing-safe comparison
- **Fix applied:** Production startup now fails if PROXY_SECRET is missing

### Authorization Checks
- Every key management endpoint verifies `slot.userId === request.auth.userId`
- App grants checked before proxy calls (403 if unauthorized)
- Nullifier uniqueness enforced (DB unique constraint + pre-verification logging)

---

## Input Validation

All endpoints use Zod schema validation:
- Email: `z.string().email()`
- Password: `z.string().min(8).max(100)`
- Provider: `z.enum(['openai', 'anthropic', 'google', 'together'])`
- Labels: `z.string().max(100)`
- Target path: `z.string().min(1).max(500)`
- HTTP method: `z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])`
- No mass assignment (all DB writes use explicit field lists)
- No raw SQL (Prisma parameterized queries only)

---

## Network Security

### Cloudflare Worker (Edge Proxy)
- Rate limiting: 60 req/min per IP
- CORS: restricted to vaultproof.dev
- Security headers: X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy, Permissions-Policy
- SSE streaming support (no buffering)
- Only forwards: authorization, content-type, content-length, accept, x-api-key

### Fastify Backend
- Helmet: security headers enabled
- CORS: restricted to ALLOWED_ORIGINS env var
- Rate limiting: 100 req/min global
- Tier rate limiting: 1K-200K calls/month per key slot
- Error handler: generic "Internal server error" to client, details logged server-side only

---

## ZK Proof Verification

### Circuit (key_auth.nr)
- Proves key ownership (Poseidon2 commitment)
- Proves app authorization (Merkle membership)
- Proves freshness (nullifier derived from nonce)
- 4/4 circuit tests passing (nargo test)

### Server Verification
- Real Barretenberg verification when circuit loads
- Garbage proofs correctly rejected
- Tampered proofs correctly rejected
- Wrong public inputs correctly rejected
- **Placeholder fallback:** accepts any 10+ char string if Noir fails to load
- **Controlled by:** `REQUIRE_REAL_PROOFS=true` env var
- **Recommendation:** Set `REQUIRE_REAL_PROOFS=true` on Railway

---

## Known Accepted Risks

1. **API key in RAM for ~100ms** during proxy call. Zeroed immediately after. TEE tier will address this.
2. **Tier hardcoded to free** until Stripe billing. All users get free tier limits (1K calls/month, 3 keys).
3. **Placeholder ZK proofs** still active by default. Real verification works but requires REQUIRE_REAL_PROOFS env var.
4. **No refresh tokens.** JWT expires after 7 days, user must re-login.

---

## Test Coverage

| Component | Tests | Status |
|---|---|---|
| Shamir SSS | 10 | Passing |
| AES-256-GCM encryption | 7 | Passing |
| Security properties | 7 | Passing |
| Integration (store/proxy/revoke) | 7 | Passing |
| SDK | 5 | Passing |
| Noir circuit | 4 | Passing |
| Auth & JWT | 9 | New |
| Developer keys | 7 | New |
| SDK routes | 6 | New |
| Rate limiting | 4 | New |
| ZK proof verification | 5 | New |

---

## Recommendations

### Before Production
1. Set `REQUIRE_REAL_PROOFS=true` on Railway
2. Verify all env vars are set (startup validation now enforces this)
3. Run `npm audit` and address any critical findings

### Future
1. Implement Stripe billing for tier enforcement
2. Add TEE option for enterprise tier (eliminates RAM exposure)
3. Add session refresh tokens (current 7-day expiry is acceptable for MVP)
4. Add Playwright E2E tests for dashboard
5. Add widget component tests (React Testing Library)
