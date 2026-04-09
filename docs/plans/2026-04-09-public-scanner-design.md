# Public API Key Scanner — Design Doc

**Date:** 2026-04-09  
**Status:** Approved, ready for implementation

## Overview

A public-facing landing page at `/scan` that lets anyone scan a public GitHub repo for exposed API keys — no login required. Full results shown, with a sticky CTA pitching VaultProof signup. Pure lead funnel.

## Goals

- Attract developers who have (or suspect they have) exposed keys
- Build trust by showing results transparently — no gating
- Convert to free signup via sticky CTA after findings

## What's Not Included

- Paste-code input (deferred)
- Live key verification (pro scanner feature)
- Saving results to DB
- Any authentication

---

## Architecture

### Page: `apps/site/scan.html`

Static HTML. Same stack as rest of site: Tailwind CDN, Inter + JetBrains Mono fonts, dark theme (`#0a0a0f` background).

**Sections:**

1. **Hero** — Headline: "Find exposed API keys in any public GitHub repo". One-line subhead. Repo URL input + Scan button.
2. **Scan progress** — Files scanned counter ticking up while fetching.
3. **Results panel** — One card per finding:
   - Provider badge (e.g. "OpenAI", "Stripe")
   - File path + line number
   - Masked key value (prefix + `...XXXX`, e.g. `sk-ant-api03-...XXXX`)
   - Severity chip (CRITICAL for live keys, HIGH for .env patterns)
4. **Empty state** — "No exposed keys found. Nice work." + soft CTA.
5. **Sticky bottom bar** — Appears after scan completes with ≥1 finding:
   `"X keys found across Y files. VaultProof protects these in production. Free signup →"`

### Worker Endpoint: `POST /api/scan/public`

No auth. Lives in `packages/worker/src/routes/scan-public.ts`, registered in `packages/worker/src/index.ts`.

**Request:**
```json
{ "repo": "owner/repo" }
```
Accepts full GitHub URLs too — strip `https://github.com/` prefix before processing.

**Rate limit:** 10 scans/hr per IP via existing KV infra (`CACHE` namespace, key `rl:scan:pub:{ip}`).

**Flow:**
1. Validate + normalize repo slug (`owner/repo` format, alphanumeric + `-_./`)
2. IP rate limit check (return 429 if exceeded)
3. Fetch repo tree: `GET https://api.github.com/repos/{owner}/{repo}/git/trees/HEAD?recursive=1`
   - Handle 404 (repo not found), 403 (private repo)
4. Filter files via `shouldScanFile()` from `secret-patterns.ts` — cap at 100 files
5. Fetch file contents in parallel (max 20 concurrent), base64-decode
6. Scan each file:
   - `KEY_PATTERNS` — regex match on each line
   - `ENV_VAR_MAP` — `.env` file key=value extraction
   - Shannon entropy filter (`MIN_ENTROPY = 3.5`) to reduce false positives
7. Mask keys before returning: keep prefix up to first 8 chars + `...XXXX`
8. Return findings array

**Response:**
```json
{
  "repo": "owner/repo",
  "filesScanned": 42,
  "findings": [
    {
      "provider": "openai",
      "providerName": "OpenAI",
      "file": "src/client.ts",
      "line": 12,
      "maskedValue": "sk-proj-Ab1...XXXX",
      "severity": "CRITICAL"
    }
  ]
}
```

**Error responses:**
- `400` — invalid repo format
- `403` — private repo (message: "This repo is private. Only public repos can be scanned.")
- `404` — repo not found
- `429` — rate limit exceeded (message: "10 free scans per hour. Try again soon.")
- `500` — GitHub API error

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `apps/site/scan.html` | Create — public scanner page |
| `packages/worker/src/routes/scan-public.ts` | Create — public scan endpoint |
| `packages/worker/src/index.ts` | Modify — register `POST /api/scan/public` |

## Security Notes

- Keys are masked **in the Worker** before the response is sent — raw values never reach the browser
- No data is persisted (no DB writes)
- GitHub API called with no auth token (unauthenticated, 60 req/hr per Worker IP) — acceptable for initial launch; add a GitHub token secret if rate limits become a problem
- Rate limit key: `rl:scan:pub:{cf-connecting-ip}`, TTL 3600s, soft-expiry envelope pattern
