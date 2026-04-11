# VaultProof Security Policy

VaultProof protects API keys by splitting them into cryptographic shares and
reconstructing them only for the duration of a proxy call. This document
describes the threat model, responsible-disclosure process, and known
limitations of the `@vaultproof/init` system.

## Reporting a Vulnerability

**Email:** security@vaultproof.dev

Please include:

- A clear description of the issue and its impact
- Steps to reproduce, ideally with a minimal proof of concept
- Your name / handle if you want to be credited

We commit to:

- Acknowledging your report within **2 business days**
- Providing an initial assessment within **7 calendar days**
- Keeping you informed of remediation progress
- Publicly crediting you in the changelog (with your permission) after the fix ships

**Please do not publicly disclose issues before we have had a chance to fix them.**

## Scope

### In scope

- `@vaultproof/init` CLI (`packages/init-cli`)
- `vaultproof-init` Cloudflare Worker (`packages/init-worker`)
- `projects` and `project_keys` Supabase tables
- `https://init.vaultproof.dev` and `https://vaultproof-init-staging.vaultproof.workers.dev`
- The Shamir secret sharing implementation in `@vaultproof/shamir`
- SSRF guard in `packages/init-worker/src/lib/ssrf-guard.ts`

### Out of scope

- Third-party providers we proxy to (OpenAI, Stripe, Anthropic, etc.) — report to them directly
- Cloudflare Workers runtime issues — report to Cloudflare
- Supabase platform issues — report to Supabase
- Physical / social engineering against VaultProof contributors
- DoS that requires more than $100/month in resources to execute

## Security Model

### What a project ID (`vp-proj-...`) guarantees

Project IDs are **public identifiers**. They appear in `.env` files, commit
history, browser network tabs, and wherever developers put their config. The
security properties are:

- **Not usable to enumerate other projects** (12 random bytes = 2^96 keyspace)
- **Not usable to retrieve Shamir shares** (only the authenticated worker can decrypt)
- **Not usable to access the management API** (management routes require a Supabase JWT)
- **Rate-limited** per project (60 proxy calls / 60s)

A leaked project ID lets the attacker consume the owner's rate-limit budget
for proxy calls to pre-registered providers. **It does NOT let them recover
the protected API keys.**

### What the Shamir split guarantees

An API key is split into two shares on the client before upload:

- **Share 1** is AES-256-GCM encrypted with a server-side key and stored in Supabase
- **Share 2** is stored base64 as-is in Supabase

Either share alone is mathematically useless — recovering the original key
requires both shares. The worker combines them only in memory, only during a
proxy call, and zeroes the buffer immediately after issuing the upstream
fetch.

**This is not zero-knowledge.** The worker *can* reconstruct the key during
the proxy call window (typically <200ms). After the call, the full key no
longer exists anywhere in our system. We explicitly do **not** claim "the
server never sees your keys" — we claim "the server sees your keys only for
the duration of the proxy call, and never stores them."

### What the SSRF guard guarantees

User-declared upstream URLs go through a deny-list validator
([ssrf-guard.ts](src/lib/ssrf-guard.ts), 85 unit tests) before being stored.
The validator rejects:

- Any scheme other than `https:`
- URLs with embedded credentials
- Ports other than 443
- IPv4 / IPv6 literals (loopback, private, metadata, obfuscated forms)
- Cloud metadata hostnames (`169.254.169.254`, `metadata.google.internal`, etc.)
- Loopback names (`localhost`, `localhost.localdomain`, etc.)
- Suffixes: `.local`, `.internal`, `.localhost`, `.localdomain`, `.arpa`,
  `.workers.dev`, `.cloudflare.com`, `.cloudflareaccess.com`,
  `.cfargotunnel.com`, `.svc.cluster.local`
- Punycode hostnames (`xn--…`) to prevent homograph attacks
- Bare hostnames with no dot
- Hostnames longer than 253 chars or labels longer than 63 chars

Defense in depth beyond the validator:

- Outbound fetches use `redirect: 'manual'` so upstream 3xx responses cannot
  pivot the worker to internal hosts
- Cloudflare Workers runtime independently blocks RFC-1918 destinations
- Response headers from upstreams go through an explicit allowlist; the
  worker never reflects `Set-Cookie`, `Clear-Site-Data`, `Strict-Transport-Security`,
  or other potentially dangerous headers

## Known Limitations

### Scrypt CPU exhaustion under extreme parallel load

Each proxy call runs an AES-256-GCM decrypt that includes a scrypt KDF
(~60–100ms CPU on the Cloudflare Worker). Under ~30+ parallel calls to the
same project, the Cloudflare Worker CPU budget can be exceeded, producing
`1101` runtime errors on 2–5% of requests.

**Legitimate clients are not affected** — real applications hit this proxy
serially from a single process.

**Mitigation:** Durable Objects for strongly-consistent rate limiting, or
pre-derived Share 2 to eliminate the per-request scrypt. Tracked in
[init-security-audit.md](../../docs/plans/2026-04-11-init-security-audit.md)
as finding H1.

### In-memory state is best-effort

The rate limit uses an in-memory burst bucket plus a KV window counter. The
in-memory bucket does not share state across Cloudflare edge isolates, so
it is a best-effort first-line defense; the KV window is the authoritative
enforcement.

### 404 vs 401 for unknown projects

Unknown project IDs return 401 via a constant-time-ish path. Unknown slugs
on a known project return 404. An attacker who already knows a valid
project ID can distinguish "this project does not have a key for slug X"
from "this project ID does not exist." This is by design — the first case
is useful debugging information for the legitimate owner.

### Providers.json served from our own CDN

The CLI fetches provider detection patterns from
`https://vaultproof.dev/providers.json` at runtime. If that URL is
compromised (same threat model as the main site), an attacker could ship
malicious regex patterns via CLI update. The CLI falls back to a bundled
copy if the fetch fails, but cannot distinguish a bad-but-parseable response
from a good one.

**Mitigation:** pin providers.json content hash in the CLI at build time, or
sign the file. Tracked as a followup.

## Previous Audits

- **2026-04-01** — Full pentest on the legacy worker. 26 findings (5 critical,
  10 high, 7 medium, 4 low). All fixed or accepted with mitigations by 2026-04-09.
  Report: `docs/plans/2026-04-01-security-pentest-report.md` (private).
- **2026-04-02** — Follow-up audit after Worker migration. 0 critical, 0 high,
  2 medium. All fixed. Report: `docs/plans/2026-04-02-security-audit-full.md`
  (private).
- **2026-04-11** — Self-audit of `@vaultproof/init` system. 2 fixes in-session
  (CORS credentials, share size cap), 2 fixes in-session (response header
  whitelist, per-IP rate limit). Report:
  [docs/plans/2026-04-11-init-security-audit.md](../../docs/plans/2026-04-11-init-security-audit.md).
- **TBD** — Third-party pentest by Trail of Bits / Doyensec / Cure53 prior
  to enterprise GA.

## Supported Versions

Security fixes are applied only to the latest release of each package:

| Package | Supported version |
|---|---|
| `@vaultproof/init` | latest |
| `@vaultproof/shamir` | latest |
| `vaultproof-init` worker | latest deployed |

Older versions do not receive security patches. Upgrade via `npm install
@vaultproof/init@latest`.
