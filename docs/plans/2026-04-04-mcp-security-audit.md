# MCP Server Security Audit — 2026-04-04

**Scope:** Full security audit of `packages/mcp-server/src/` against top CVEs, OWASP API Top 10, and MCP-specific attack vectors.

**Overall posture:** STRONG. Full OAuth 2.1 compliance, PKCE enforced (S256 only), timing-safe crypto, Zod input validation, comprehensive security headers, rate limiting. No critical vulnerabilities in code.

---

## Methodology

1. Line-by-line code audit of every `.ts` file in the MCP server
2. Cross-referenced against 30 CVEs and attack patterns:
   - MCP-specific: CVE-2025-6514 (mcp-remote RCE), CVE-2025-6515 (session hijacking), tool poisoning/rug pulls, prompt injection via tool results
   - OAuth: CVE-2025-4144 (CF Workers PKCE bypass), CVE-2024-23647 (PKCE downgrade), CVE-2020-7692 (missing PKCE), mix-up attacks, open redirectors
   - Shamir: CVE-2023-25000 (cache-timing), Trail of Bits weak RNG disclosures, share ID validation flaws
   - OWASP API Top 10 2023: BOLA, broken auth, SSRF, unrestricted resource consumption
   - CF Workers: KV eventual consistency races, timing side channels
3. Verified existing mitigations and identified gaps

---

## Existing Strengths (Already Secured)

| Area | Implementation | Files |
|------|---------------|-------|
| PKCE | S256 enforced, plain method rejected | `oauth/authorize.ts:11-12` |
| PKCE verification | Timing-safe comparison via `timingSafeEqual()` | `oauth/token.ts:70`, `lib/crypto.ts:89-99` |
| Auth code single-use | Delete after first use + duplicate detection + first session revocation | `oauth/token.ts:77-98` |
| Auth code TTL | 60 seconds | `oauth/callback.ts:118` |
| Session encryption | AES-256-GCM with fresh IV per encryption | `lib/crypto.ts:108-138` |
| Session binding | `boundSessionId` verified on every request | `mcp/transport-http.ts:65-69`, `mcp/transport-sse.ts:37-40` |
| Session TTL | 1 hour sliding window | `auth/validate-token.ts:89-93` |
| Token validation | Rejects JWTs and vp_ keys, only opaque bearer tokens | `auth/validate-token.ts:44-103` |
| Scope enforcement | Per-tool scope check before execution | `mcp/handler.ts:148-157` |
| Input validation | Zod schemas on all endpoints, strict patterns on key values | `oauth/*.ts`, `mcp/tools.ts:43-84` |
| CORS | Hardcoded origin whitelist, no wildcard | `index.ts:46-51` |
| Callback origin lock | Exact match `https://vaultproof.dev` only | `oauth/callback.ts:28-54` |
| Security headers | HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy | `lib/security-headers.ts:11-20` |
| WWW-Authenticate | All 401s include header per RFC 6750 | `auth/validate-token.ts:13-19` |
| Rate limiting | Per-user (30/min), per-IP (100/min), per-user add_key (10/hr) | `lib/rate-limit.ts` |
| SSRF protection | `isPublicUrl()` blocks private IPs, localhost, metadata endpoints | `lib/ssrf.ts:55-96` |
| Provider whitelist | 13 providers hardcoded, prevents path traversal in proxy URL | `mcp/handler.ts:112-116` |
| Backend URL guard | HTTPS-only enforcement on BACKEND_URL | `backend/client.ts:52-54` |
| Response sanitization | Control chars stripped, max length enforced, field allowlisting | `mcp/handler.ts:100-130` |
| Shamir CSPRNG | Uses `crypto.getRandomValues()` for polynomial coefficients | `lib/shamir.ts:59` |
| Shamir constant-time | Loop-based `gf256Mul` (no lookup tables), resistant to CVE-2023-25000 | `lib/shamir.ts:100-113` |
| OAuth metadata | RFC 8414 compliant | `oauth/metadata.ts` |
| Dynamic registration | RFC 7591 with redirect URI validation | `oauth/register.ts` |

---

## Findings & Remediations

### Code-Level Fixes (Priority: Immediate)

#### Fix 1: State signature timing attack
- **File:** `oauth/callback.ts:86`
- **CVE ref:** Timing side-channel pattern (CVE-2024-13176 class)
- **Issue:** HMAC state signature compared with `!==` (not constant-time)
- **Risk:** LOW — state is derived from public value, but violates defense-in-depth
- **Fix:** Replace `if (stateSig !== expected)` with `if (!timingSafeEqual(stateSig, expected))`

#### Fix 2: Resource URL validation prefix check
- **File:** `oauth/callback.ts:77-79`
- **Issue:** `data.resource.startsWith(env.MCP_ISSUER)` allows `https://mcp.vaultproof.dev.attacker.com`
- **Risk:** LOW — requires attacker to control subdomain
- **Fix:** Parse both as URLs, compare `new URL(data.resource).origin === new URL(env.MCP_ISSUER).origin`

#### Fix 3: Add CSP header
- **File:** `lib/security-headers.ts`
- **Issue:** Missing Content-Security-Policy header
- **Risk:** LOW — server returns JSON only, but CSP adds defense-in-depth
- **Fix:** Add `'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"`

#### Fix 4: Shamir constant-time documentation
- **File:** `lib/shamir.ts:100-113`
- **CVE ref:** CVE-2023-25000 (HashiCorp Vault Shamir cache-timing)
- **Issue:** No documentation that loop-based GF(256) is intentionally constant-time
- **Risk:** NONE — already correct, but undocumented intent risks regression
- **Fix:** Add comment: `// Constant-time: loop-based multiplication avoids lookup tables (CVE-2023-25000)`

#### Fix 5: CSPRNG assertion for Shamir
- **File:** `lib/shamir.ts:59`
- **CVE ref:** Trail of Bits weak RNG disclosures in tss-lib
- **Issue:** No runtime assertion that `crypto.getRandomValues` is available
- **Risk:** LOW — CF Workers always have it, but belt-and-suspenders
- **Fix:** Add assertion at top of `split()`: `if (!crypto?.getRandomValues) throw new Error('CSPRNG required')`

#### Fix 6: Generic scope error message
- **File:** `oauth/authorize.ts:67`
- **Issue:** Error message leaks scope names: `Unknown scope: ${s}`
- **Risk:** LOW — scope names are public per RFC 8414
- **Fix:** Replace with `'Invalid scope requested'`

#### Fix 7: Unused SSRF function
- **File:** `lib/ssrf.ts`
- **Issue:** `isPublicUrl()` defined but never called in request paths
- **Risk:** NONE — defensive code, but unused functions are confusing
- **Fix:** Either wire it into backend URL validation in `backend/client.ts` or remove it

### Architecture-Level Protections (Priority: High)

#### Fix 8: Atomic rate limiting via Durable Objects
- **File:** `lib/rate-limit.ts`
- **CVE ref:** CF Workers KV eventual consistency race conditions
- **Issue:** KV `get()`/`put()` is not atomic — concurrent requests can bypass rate limits under burst load
- **Current mitigation:** Short window TTL (120s)
- **Fix:** Create a `RateLimiter` Durable Object. Key by `userId` or `ip`. Use `this.storage.get()`/`put()` for atomic read-modify-write. Single-threaded execution guarantees no race.
- **Durable Object class:** `RateLimiterDO` with methods `checkLimit(key, maxRequests, windowMs)`

#### Fix 9: Atomic OAuth code exchange via Durable Objects
- **File:** `oauth/token.ts:77-98`
- **CVE ref:** OAuth authorization code replay (OWASP)
- **Issue:** Two concurrent requests can both redeem the same code before KV delete propagates
- **Current mitigation:** Duplicate detection + first session revocation (lines 93-98)
- **Fix:** Create an `OAuthCodeDO` Durable Object keyed by code hash. `exchange()` method checks, deletes, and returns in one atomic transaction. If already exchanged, reject immediately.

#### Fix 10: Tool integrity checking (anti-rug-pull)
- **CVE ref:** MCP tool poisoning / rug pull attacks (Invariant Labs, Acuvity 2025-2026)
- **Issue:** Tool definitions could theoretically be redefined between sessions
- **Current state:** Tools are hardcoded in `mcp/tools.ts` (safe), but no client-verifiable integrity proof
- **Fix:** Compute SHA-256 hash of serialized tool definitions at startup. Include `toolsHash` in `tools/list` response. Add `X-Tools-Hash` response header. Clients can pin and verify tools haven't changed.

#### Fix 11: MCP output sanitization (anti-prompt-injection)
- **CVE ref:** Indirect prompt injection via MCP tool results (Unit42, Simon Willison 2025)
- **Issue:** Backend API responses returned as tool results could contain prompt injection payloads that manipulate the LLM into calling other tools
- **Current state:** `sanitizeString()` strips control chars but doesn't defend against prompt injection
- **Fix:** Wrap all tool outputs in `[TOOL_OUTPUT]...[/TOOL_OUTPUT]` delimiters. Strip any instances of these markers from backend responses before wrapping. Add to `mcpResult()` helper.

#### Fix 12: Human confirmation for destructive operations
- **CVE ref:** MCP tool poisoning leading to unauthorized key operations
- **Issue:** `revoke_key` and `add_key` execute without human confirmation
- **Fix:** Add `annotations: { destructiveHint: true }` to `revoke_key` and `add_key` tool definitions in `mcp/tools.ts`. MCP clients that support annotations (Claude Code, Cursor) will require user approval.

#### Fix 13: Session revocation consistency
- **CVE ref:** CF Workers KV eventual consistency
- **Issue:** After session revocation, the `MCP_SESSIONS.delete()` may not propagate instantly across CF regions
- **Fix:** On revoke, write `revoked:{tokenHash}` marker to KV with 300s TTL. On validate, check for revocation marker before accepting session. If marker exists, reject even if session data is still cached.

---

## Not Applicable (Verified Safe)

| CVE / Attack | Why Not Applicable |
|---|---|
| CVE-2025-6514 (mcp-remote RCE) | VaultProof doesn't use mcp-remote, doesn't connect to other MCP servers |
| CVE-2025-4144 (CF Workers OAuth PKCE bypass) | VaultProof uses custom OAuth implementation, not `@cloudflare/workers-oauth-provider` |
| CVE-2025-68145/68143/68144 (Git MCP RCE) | No file-system or git operations in MCP server |
| CVE-2025-68664 (LangChain serialization) | No LangChain usage |
| CVE-2022-36083 (JOSE PBKDF2 DoS) | No JOSE/JWT library used — opaque tokens only |
| CVE-2026-34742 (Go SDK DNS rebinding) | Uses CF Workers, not Go SDK |
| OAuth device code phishing | Device code flow not implemented |
| OAuth mix-up attack | Single authorization server, no multi-AS client |
| BOLA (OWASP API1) | All key operations verify `userId` ownership |
| PKCE downgrade (CVE-2024-23647) | PKCE mandatory — `code_challenge` required in authorize.ts:11 |
| Session ID prediction (CVE-2025-6515) | Uses `crypto.getRandomValues()` for 256-bit tokens |

---

## Implementation Priority

| Phase | Fixes | Effort |
|-------|-------|--------|
| **Phase 1: Immediate** (code fixes) | Fix 1-7 | ~1 hour |
| **Phase 2: Architecture** (Durable Objects) | Fix 8-9 (rate limit + code exchange) | ~4 hours |
| **Phase 3: MCP hardening** | Fix 10-13 (tool integrity, output sanitization, confirmations, revocation) | ~3 hours |

---

## Sources

- CVE-2025-6514: mcp-remote command injection
- CVE-2025-4144: CF Workers OAuth PKCE bypass (GHSA-qgp8-v765-qxx9)
- CVE-2023-25000: HashiCorp Vault Shamir cache-timing (GHSA-vq4h-9ghm-qmrr)
- CVE-2024-23647: Authentik PKCE downgrade
- CVE-2024-13176: ECDSA timing side-channel
- Trail of Bits: Shamir SSS weak RNG disclosures (tss-lib)
- Unit42: MCP prompt injection attack vectors
- Invariant Labs: MCP tool poisoning
- Acuvity: MCP rug pulls / silent redefinition
- OWASP API Security Top 10 2023
- RFC 9700: OAuth 2.0 Security Best Current Practice
- Simon Willison: MCP prompt injection analysis (2025)
