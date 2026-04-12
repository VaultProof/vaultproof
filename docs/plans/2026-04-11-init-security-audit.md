# VaultProof Init — Security Audit

**Date:** 2026-04-11
**Scope:** `@vaultproof/init` CLI + `vaultproof-init` Worker + `projects`/`project_keys` schema
**Method:** Self-audit by Claude Sonnet 4.6, informed by the 2026-04-01 pentest findings (project_vaultproof_pentest_apr01) and the test suite run on 2026-04-11
**Status:** Pre-launch. 2 findings already fixed (CORS, share size cap). Remainder tracked below.

---

## Threat Model

### Assets

| Asset | Where it lives | Protection goal |
|---|---|---|
| API keys (OpenAI, Stripe, etc.) | Split into 2 Shamir shares. Share 1 encrypted at rest with `VAULT_ENCRYPTION_KEY`. Share 2 stored base64 as-is | Never exist as plaintext outside the worker's ~100ms reconstruction window |
| User's Supabase JWT | Client-side (`~/.vaultproof/config.json`) and in transit to `/api/v1/init/*` | Only sent over TLS to vaultproof-init-* worker |
| `vp-proj-xxx` project ID | `.env` files, committed to repos, visible in client code | Not a secret — but must not enable quota theft or enumeration |
| Reconstructed plaintext key | Worker memory during proxy call | Zeroed after upstream fetch is issued |
| User's project ownership | `projects.user_id` foreign key to `auth.users` | Only the owner can access their shares (enforced by worker queries + Supabase RLS) |

### Adversaries

1. **Public attacker with a leaked project ID.** Found `vp-proj-xxx` in a public GitHub repo or browser-devtools network tab. Goal: burn the owner's API quota, exfiltrate provider responses, enumerate other resources.
2. **Malicious authenticated user.** Has a valid Supabase account. Goal: escalate to another user's shares, break the SSRF guard to pivot into internal networks, cause DoS for other tenants.
3. **Passive network observer.** Goal: extract shares or keys from transit. Defeated by TLS to every endpoint.
4. **Compromised provider endpoint.** Upstream (OpenAI, Stripe, etc.) returns malicious response headers or bodies. Goal: poison our worker's response to the client, set cookies in our domain, inject CSRF tokens.
5. **Runtime compromise.** Someone gets shell access on a Cloudflare edge machine. Out of scope — that's Cloudflare's threat model.

### Non-goals (explicitly out of scope)

- **ZK proofs of key ownership** — roadmap, not current
- **Client-side `.env` protection** — backup exists; anything else is local machine security
- **Provider account takeover** — if someone has the reconstructed key for the duration of one proxy call, they technically have the key. We can't prevent them from saving it. The ~100ms window just makes bulk exfiltration hard.
- **DDoS at CF edge** — Cloudflare's WAF handles this

---

## Findings

**Severity legend**
- **C** (Critical) — reachable attack with direct impact on asset confidentiality/integrity. Fix immediately.
- **H** (High) — reachable attack that requires chaining, or a design issue that will bite at scale.
- **M** (Medium) — hardening gap, limited impact, or defense-in-depth.
- **L** (Low) — minor, informational, or papercut.
- **I** (Informational) — documented behavior, not an issue.

### FIXED in this audit

#### C1 — CORS: `Access-Control-Allow-Credentials: true` with `Allow-Origin: *` (staging)
**Description:** The init-worker emitted `Allow-Credentials: true` while staging (`ALLOWED_ORIGINS=*`) echoed the caller's origin. This violates the CORS spec (browsers refuse credentialed requests when origin is `*`, but the echoed origin bypassed that check) and allows a malicious site to call the worker with the user's JWT in a browser context.
**Impact:** A page at `https://evil.com` could POST to `/api/v1/init/projects` with the user's JWT from their other tabs, creating projects or uploading crafted shares under the victim's account.
**Fix:** Removed `Allow-Credentials` entirely — the init-worker uses `Authorization: Bearer ...` only, never cookies, so credentialed CORS mode has no legitimate use. When `ALLOWED_ORIGINS=*`, the worker now returns `Access-Control-Allow-Origin: *` (not the echoed origin) to satisfy the spec. Specific origin lists still echo the matching origin with `Vary: Origin`.
**Verified:** Live on staging 2026-04-11 — preflight to evil.com returns `*`, no credentials header.
**Reference:** [packages/init-worker/src/index.ts](packages/init-worker/src/index.ts#L16)

#### M1 — Share ciphertext uncapped
**Description:** `share1_encrypted` and `share2_encrypted` accepted arbitrary length. A 100 KB share was accepted in testing. An attacker could upload gigabyte-sized shares, blowing worker memory on proxy calls that try to decrypt them.
**Impact:** DoS — each call to scrypt on oversized input consumes CPU proportional to input. Rate limiting would cap the blast radius but not prevent per-request exhaustion.
**Fix:** Added 4 KB cap on each of `share1` and `share2` at upload time. A real API-key Shamir share is ~300 bytes, so 4 KB is 13x headroom.
**Verified:** Live on staging 2026-04-11 — 5 KB share rejected with `share1/share2 exceed 4096 chars`.
**Reference:** [packages/init-worker/src/routes/projects.ts](packages/init-worker/src/routes/projects.ts#L143)

### OPEN

#### H1 — Rate limit under cross-isolate parallel load ("1101" CPU exhaustion)
**Description:** Under ~30 parallel requests to the same `/p/:slug/*` route, 2–5% of responses return a Cloudflare `1101` runtime error instead of a real response. Root cause: each proxy call runs a scrypt-backed decrypt (~60-100ms CPU), and parallel requests on the same isolate race past the in-memory burst limit (it's best-effort, not strongly consistent). The KV window limit (60/60s) is correct but eventually consistent, so it doesn't stop in-window bursts.
**Impact:** Limited to DoS. No data leak. The legitimate caller sees some 500s under unrealistic load; the attacker wastes their own quota on errors. A leaked project ID still cannot pull shares out.
**Fixes available:**
1. **Durable Objects** — strongly consistent rate limit across isolates. Documented as the correct pattern in the MCP server memo. 30-60 min to implement.
2. **Pre-derived Share 2** — move the scrypt from proxy time to enrollment time. Reduces per-request CPU to ~5ms. This is already on the perf audit TODO list (`project_vaultproof_perf_audit`).
3. **Short-term**: advise users that 1101 errors are transient and should be retried. OpenAI/Stripe SDKs already do exponential backoff.
**Recommendation:** Park until first production users hit it. The legitimate request rate is far below the threshold where this matters. Track as followup.
**Reference:** [packages/init-worker/src/lib/rate-limit.ts](packages/init-worker/src/lib/rate-limit.ts#L74)

#### M2 — Project enumeration via timing attack
**Description:** The `authenticateProject` function calls `supabase.from('projects').select('*').eq('vp_proj_id', token)`. The DB lookup time is proportional to the index seek, which is roughly constant (B-tree). But the branch afterwards differs: project found → origin check → 0 or 1 row from `project_keys`; project not found → short-circuit return. Timing difference is small but measurable.
**Impact:** An attacker could distinguish "project exists but is for a different provider" from "project does not exist". Low value because project IDs are 12 random bytes = 2^96 keyspace. At 1 request/ms, full enumeration takes 2.5 × 10^19 years.
**Fix:** Not worth the complexity. Monitor for bulk lookups via rate limiting (which is already per-project, so enumeration attempts for different IDs bypass rate limits). **Add a per-IP rate limit** for proxy calls that fail with 401 to limit enumeration rate from any single source.
**Recommendation:** Defer. Revisit if we see enumeration in the wild.
**Reference:** [packages/init-worker/src/lib/project-auth.ts](packages/init-worker/src/lib/project-auth.ts#L23)

#### M3 — Per-IP rate limit on unauthenticated requests (partially fixed, weak under real load)
**Description:** All authenticated rate limits are keyed on `project.id` or `user.id`. Added a per-IP rate limit that fires on 401/404 responses (30 failed requests per 10s burst, 100 per 60s window).
**PT-9 verification:** Fired 150 sequential requests with different random `vp-proj-xxx` identifiers. Only 2 were rate-limited; the rest returned 401. Root cause: the KV-backed window counter is eventually consistent, so a burst across multiple 60s windows doesn't trip the limit in time.
**Residual risk:** Limited by keyspace. Project IDs are 96 bits of entropy (12 random bytes). At 100 req/s sustained, brute-forcing even a single hit takes 2.5 × 10^19 years. JWT brute force is also impractical due to the ES256 signature check. M3 in its current form is defense in depth, not primary enforcement.
**Fix for later:** Durable Objects for strongly-consistent rate limiting. Same mitigation as H1.
**Recommendation:** Keep the current weak implementation as a speed-bump. Prioritize Durable Objects migration before any feature that makes enumeration higher-value (e.g., publicly-discoverable project metadata).

#### M4 — Upstream response header whitelist is implicit
**Description:** In `handleProxy`, I strip `content-encoding`, `content-length`, and `transfer-encoding` from the upstream response before forwarding. But I **pass through everything else**, including `Set-Cookie`, `Server`, and any custom headers. A malicious or compromised upstream could set cookies for our worker's domain (`init.vaultproof.dev`), which would persist in the user's browser and affect future requests.
**Impact:** Session fixation or CSRF pivot via upstream-set cookies. Low severity because (a) we only proxy to HTTPS upstreams the user declared, and (b) those upstreams are real API providers, not attacker-controlled. But defense in depth says strip.
**Fix:** Add `Set-Cookie`, `Clear-Site-Data`, `WWW-Authenticate` (already handled by browsers but cleaner to strip), and `Strict-Transport-Security` to the strip list. Or better: *explicit* allowlist of safe response headers.
**Recommendation:** Fix now. 10-line change.
**Reference:** [packages/init-worker/src/routes/proxy.ts](packages/init-worker/src/routes/proxy.ts#L119)

#### L1 — Internal project row ID exposed to client
**Description:** `POST /api/v1/init/projects` returns `id` (DB row UUID) alongside `vp_proj_id` (public identifier). The CLI needs `id` to subsequently call `/keys`.
**Impact:** None — the row ID is scoped to the owning user, never guessable (UUID v4 = 122 bits), and server-side checks always verify ownership before acting on it. But conceptually, having two separate "project identifiers" is slightly messy.
**Fix:** Replace `/api/v1/init/projects/:id/keys` with `/api/v1/init/projects/:vp_proj_id/keys` and drop the internal UUID from the response. Cleaner API, no security impact.
**Recommendation:** Low priority. Cosmetic.

#### L2 — JSON parse errors return 400 with no logging
**Description:** Malformed JSON returns `{"error":"Invalid JSON"}` and 400. No logging. An attacker brute-forcing garbage to find a parse error exploit would be invisible.
**Impact:** Reduced forensic capability, not a direct vulnerability.
**Fix:** Log malformed JSON attempts at WARN level. Could be done via the existing events pipeline (`recordEvent` in the legacy worker) — but init-worker is supposed to be isolated.
**Recommendation:** Defer. Add when we have a logging infrastructure for init-worker.

#### L3 — Health endpoint fingerprints the service
**Description:** `GET /health` returns `{"status":"ok","service":"vaultproof-init"}`. An attacker scanning for VaultProof deployments can identify them.
**Impact:** Information disclosure. Low value — the worker is meant to be publicly discoverable by customers.
**Fix:** None needed. Documented as intentional.
**Recommendation:** Accept.

#### I1 — CF Workers KV minimum TTL is 60 seconds
**Description:** Rate limit windows are 60s minimum. Any rate-limit with a sub-60s window cannot use KV directly.
**Impact:** None — our windows are designed around this.
**Status:** Documented in [rate-limit.ts](packages/init-worker/src/lib/rate-limit.ts#L24).

#### I2 — In-memory state is best-effort
**Description:** `memBuckets` Map is local to each CF isolate. State is lost on isolate recycle (minutes-hours) and not shared across isolates.
**Impact:** In-memory bursts can be bypassed by spreading traffic. This is why KV is the authoritative layer.
**Status:** Documented. See H1 for the scrypt-bound DoS consequence.

---

## Controls Verified by Testing

| Control | Test | Result |
|---|---|---|
| SSRF URL validation | 85 unit tests + 19 live integration | ALL REJECTED |
| Header injection | 6 unit tests + 4 live | ALL REJECTED |
| JWT auth on mgmt routes | 7 live boundary tests | PASS |
| `vp-proj-` auth on proxy routes | 6 live boundary tests | PASS |
| Provider regex false-match prevention | 51 unit tests | PASS |
| Shamir round-trip correctness | 1006 random + edge cases | PASS |
| Concurrent upserts | 10 parallel, same slug | PASS — exactly 1 row |
| Input length caps (url/template/headers) | 4 live tests | PASS |
| Share size cap | 1 live test | PASS (after fix) |
| CORS credentials mode | 1 live test + code review | PASS (after fix) |
| Response header leaks (stack traces, internal IDs, PII) | 8 endpoint audit | PASS — none leaked |
| Cross-project access | Verified via `project.user_id` check in every route | PASS |

## Controls Relying on Cloudflare / Supabase

| Control | Provider | Notes |
|---|---|---|
| TLS to endpoints | CF + clients | Enforced by HTTPS-only scheme |
| RFC-1918 block | CF Workers runtime | Defense in depth for SSRF |
| Supabase RLS on projects/project_keys | Supabase | `projects_select_own` + `project_keys_select_own` |
| DDoS | CF WAF | Out of scope for app-level audit |

## Immediate Action Items

1. **Fix M4 (upstream response header whitelist)** — 10 lines, do now.
2. **Fix M3 (per-IP rate limit for 401s)** — 20 lines, do now or before production.
3. **Document H1 as known limitation in SECURITY.md.** Revisit when we hit it for real.
4. **Defer L1/L2/L3/M2 as tracked followups.**

## Long-term / Not This Session

- Durable Objects for cross-isolate rate limiting (fixes H1 properly)
- Pre-derived Share 2 to eliminate per-request scrypt (addresses H1 root cause)
- Third-party pentest (Phase 4 in our roadmap)
- Formal SOC 2 attestation (separate track in `docs/compliance/`)
