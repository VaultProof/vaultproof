# Scan Page Upgrade — Design

**Date:** 2026-04-10
**Status:** Approved
**Scope:** Public `/scan` page only (`apps/site/scan.html` + `packages/worker/src/routes/scan-public.ts`). Authed `/app/scanner` untouched.

## Goals

1. Scan up to 500 files per repo (from 50) and 50 commits of git history (from 20) so the scanner is useful for real projects, not just toy repos.
2. Return more than just leaked API keys so clean repos still get useful feedback and don't bounce.
3. Show real streaming progress while the scan runs, not a spinner.
4. Make the scan page transparent about what it actually checks for, so users trust it.

## Non-goals

- No dependency CVE scanning (OSV.dev) — save for phase 2.
- No changes to the authed scanner, its database schema, or its UI.
- No changes to the 10/hr/IP rate limit.
- No pagination, job queues, or background workers — keep the scan inline in one request.

## Constraints discovered

**CF Workers budget.** Paid plan allows 1000 subrequests per request and 30s CPU. Current scan uses ~90 subrequests (50 files + 20 commits + 2 tree/list). Our target (500 files + 50 commits) needs ~552 subrequests — 55% of the ceiling, comfortable.

**GitHub API rate limit.** Was the real blocker. Unauthenticated GitHub API is 60/hr per IP, globally pooled across our CF egress IPs. At 552 reqs per scan, that's less than one scan per hour worldwide. Solution: added `GITHUB_TOKEN` secret (PAT with `public_repo` scope) to the production worker, which bumps the limit to 5000/hr → ~9 full scans per hour worker-wide, aligning with the existing 10/hr/IP user-facing rate limit.

**History scan timeout.** Hardcoded at 15s. 50 commits at 10 concurrent = ~5 batches × ~1s = ~5s. Bumped to 25s for safety margin.

## Worker changes — `packages/worker/src/routes/scan-public.ts`

### Constants

| Constant | Before | After | Why |
|----------|--------|-------|-----|
| `MAX_FILES` | 50 | 500 | User target |
| `MAX_COMMITS` | 20 | 50 | User target |
| `MAX_FINDINGS` | 200 | 500 | 10× more files means 10× potential findings |
| History-scan hard timeout | 15s | 25s | Safety margin for 50 commits |

### Finding schema extension

Current `Finding` has `{provider, providerName, file, line, maskedValue, severity, source, commitSha?, commitMessage?, commitDate?}`. Add three optional fields:

```typescript
category?: 'secret' | 'file' | 'code' | 'hygiene';  // default 'secret'
title?: string;         // used when the finding has no provider (e.g. "Committed private key")
description?: string;   // short human-readable explanation
```

Existing secret findings remain backward compatible — they stay in the `secret` category by default.

### New finding categories

**1. Risky files (`category: "file"`, severity: `HIGH`)**

Check filenames in the tree (zero extra fetches). Reject if filename matches:
- `.env` / `.env.*` but NOT `.env.example`, `.env.sample`, `.env.template`, `.env.dist`
- Private keys: `id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.asc`, `*.gpg`
- Cloud credentials: `.aws/credentials`, `.aws/config`, `gcp-key.json`, `gcloud-service-key*.json`, `service-account*.json`, `firebase-adminsdk-*.json`
- Database dumps: `*.sql`, `*.dump`, `*.bak`, `database.dump`, `backup.tar*`

Each match becomes a finding with `title: "Committed private key file"` (etc.), `description: "Private keys in the repo are often live credentials. Rotate and remove from git history."`, `file: <path>`, `line: 1`, `category: "file"`, `severity: "HIGH"`.

**2. Code smells (`category: "code"`, severity: `MEDIUM`)**

Regex-scan every file (piggybacking on the existing line-scan loop). Patterns:

| Pattern | Title | Languages |
|---------|-------|-----------|
| `\beval\s*\(` | "Use of eval()" | .js .ts .py |
| `new\s+Function\s*\(` | "Dynamic code via Function()" | .js .ts |
| `\.innerHTML\s*=` | "Unsafe innerHTML assignment" | .js .ts .html |
| `dangerouslySetInnerHTML` | "dangerouslySetInnerHTML in React" | .js .ts .jsx .tsx |
| `\b(md5|sha1)\s*\(` | "Weak hash function" | all |
| `\b(DES|RC4)\b` | "Weak cipher" | all |
| `Access-Control-Allow-Origin[^\n]*["'\s]\*["'\s]` | "CORS wildcard" | all |
| `"\s*SELECT[^"]*"\s*\+` | "SQL string concatenation" | .js .ts .py .java .go |

Each match: `title: <from table>`, `description: <short explanation>`, `file, line, category: "code"`, `severity: "MEDIUM"`.

**3. Repo hygiene (`category: "hygiene"`, severity: `INFO`)**

After the tree fetch, check for presence of:

| Missing file | Title | Description |
|--------------|-------|-------------|
| `.gitignore` | "No .gitignore file" | "Without one, secrets accidentally committed can't be excluded." |
| `LICENSE` / `LICENSE.md` / `LICENSE.txt` | "No LICENSE file" | "Unclear licensing blocks commercial and open-source use." |
| `SECURITY.md` / `.github/SECURITY.md` | "No security policy" | "Users have no clear way to report vulnerabilities." |
| `README.md` / `README.rst` / `README` | "No README" | "Hurts discoverability and user trust." |

Each missing file becomes one finding. Always reported — even a perfectly clean repo will surface 0–4 hygiene items. This is the retention insurance against empty-result bounces.

### Streaming response

Instead of `Response.json(result)`, return a `ReadableStream` with `Content-Type: application/x-ndjson`.

Events emitted during the scan:

```
{"phase":"tree"}
{"phase":"files","done":40,"total":500}
{"phase":"commits","done":10,"total":50}
{"phase":"files","done":80,"total":500}
...
{"phase":"done","result":{"repo":"owner/repo","filesScanned":500,"commitsScanned":50,"findings":[...],"truncated":false}}
```

On failure:
```
{"phase":"error","message":"GitHub API timed out"}
```

Then close the stream.

**Architecture:** keep the existing parallel file-scan + history-scan (`Promise.all`). Both branches write to a shared `TransformStream` writer as each batch completes. Events are interleaved — client handles that correctly because progress is tracked per phase independently.

### Plumbing details

- CORS wrapper in `index.ts` already uses `new Response(response.body, ...)` which preserves streams.
- Rate limit check (10/hr/IP) happens before the stream starts — errors still return as normal JSON, not stream.
- Bot filter and body parsing still happen before stream starts.
- `ctx.waitUntil` is not needed — the stream keeps the request alive naturally.

## Frontend changes — `apps/site/scan.html`

### 1. Capability line under the form

One line right below the "Example: github.com/..." line:

```
Scans up to 500 files · 50 commits of history · secrets, risky files, code smells, hygiene
```

Styled as `text-xs text-gray-600`, same muted tone as the example line.

### 2. "What we scan" card grid

Added below the form, above the results area. Always visible.

Layout: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-12 mb-8`

Four cards, each `bg-vp-surface border border-vp-border rounded-xl p-5`:

**Card 1 — Leaked API keys**
- Icon: 🔑
- "Both current files AND git history"
- Bullets: OpenAI + Anthropic + Google AI, AWS + Google Cloud, Stripe + SendGrid + Resend, GitHub + npm + Slack + Datadog, Supabase + MongoDB + Neon + Upstash, PostHog + Contentful + Twilio, "and 13 more providers"

**Card 2 — Risky files committed**
- Icon: 📁
- Bullets: `.env` files, Private keys (`id_rsa`, `*.pem`, `*.key`), Cloud credentials (`.aws/credentials`), Service account JSONs, Database dumps (`*.sql`, `*.dump`, `*.bak`)

**Card 3 — Code smells**
- Icon: ⚠️
- Bullets: `eval()` and `Function()` constructors, Unsafe HTML (`innerHTML`, `dangerouslySetInnerHTML`), Weak crypto (MD5, SHA1, DES, RC4), CORS wildcards, SQL string concatenation

**Card 4 — Repo hygiene**
- Icon: ✅
- Bullets: `.gitignore`, `LICENSE`, `SECURITY.md`, `README.md`

### 3. Progress bar

Replaces the existing spinner-only progress box.

Structure:
```html
<div id="progressBox" class="hidden">
  <div class="bg-vp-surface border border-vp-border rounded-xl px-5 py-4">
    <div class="flex items-center justify-between text-xs mb-2">
      <span id="progressPhase" class="text-gray-300 font-medium">Starting scan...</span>
      <span id="progressPct" class="text-gray-500 font-mono">0%</span>
    </div>
    <div class="w-full h-2 bg-vp-border rounded-full overflow-hidden">
      <div id="progressFill" class="h-full bg-brand transition-all duration-300 ease-out" style="width:0%"></div>
    </div>
  </div>
</div>
```

Phase labels:
- `{"phase":"tree"}` → "Fetching repo tree..."
- `{"phase":"files",...}` → `"Scanning files (${done}/${total})"`
- `{"phase":"commits",...}` → `"Scanning git history (${done}/${total})"`
- `{"phase":"done",...}` → "Done"
- `{"phase":"error",...}` → bar turns red, error shown in error box

Progress calculation (weighted because scans run in parallel):
- Base: tree fetch = 5%
- Files contribution: `(filesDone / filesTotal) * 55` (from 5% to 60%)
- Commits contribution: `(commitsDone / commitsTotal) * 35` (from 60% to 95%)
- Total: base + files + commits, capped at 100% until done event fires
- On done: animate to 100% and turn bar green for ~400ms before fading out

### 4. Streaming reader

Replace current `fetch().then(res.json())` with:

```javascript
const res = await fetch(API, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ repo }),
});
if (!res.ok) { /* existing HTTP error handling */ }

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buf = '';
let filesDone = 0, filesTotal = 0, commitsDone = 0, commitsTotal = 0;
let finalResult = null;

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  const lines = buf.split('\n');
  buf = lines.pop(); // keep the incomplete last chunk
  for (const line of lines) {
    if (!line.trim()) continue;
    let evt;
    try { evt = JSON.parse(line); } catch { continue; }
    handleProgressEvent(evt);
    if (evt.phase === 'done') finalResult = evt.result;
    if (evt.phase === 'error') throw new Error(evt.message);
  }
}

if (!finalResult) throw new Error('Scan ended without a result');
renderResults(finalResult);
```

### 5. Result sections

Rendered in order after a scan completes:

1. **Leaked secrets** (CRITICAL) — existing card layout, unchanged.
2. **Risky files** (HIGH) — new section. Card per finding: file path, title, description. Red accent.
3. **Code smells** (MEDIUM) — new section. Same card pattern, amber accent, more compact.
4. **Recommendations** (INFO) — new section. Always shown. Lighter gray styling. Lists each missing hygiene file as a bullet with a short explanation.

Each section is only shown if it has at least one finding — except **Recommendations**, which is always shown even if all four hygiene files are present (in that case it shows a single "Looks great — all hygiene checks passed" row).

### 6. Progress text copy

Replace "This may take a few seconds for larger repos." with "Large repos can take 20–30 seconds."

## Deployment

1. Deploy the worker: `bash scripts/deploy-worker.sh`. Already-added `GITHUB_TOKEN` secret will be picked up automatically. Health check verifies `/health` returns 200 and auth endpoints return 401.
2. Push HTML to `main`. CF Pages auto-deploys.
3. Smoke test with a known-clean repo (expect hygiene findings only) and a known-dirty repo (expect secrets + risky files).

## Risks and mitigations

**Risk:** 500 files × git history might push wall-clock time to ~25s and feel slow.
**Mitigation:** Progress bar makes waiting feel tolerable. The existing 15s history timeout bumps to 25s — we won't exceed that.

**Risk:** New finding categories could create noisy results for some repos.
**Mitigation:** Severity tiering (HIGH/MEDIUM/INFO) + visual separation by section. User always sees critical leaks first, noise collapses below.

**Risk:** Adding "code smells" extends VaultProof's scanner beyond its API-key-leak positioning, muddying brand.
**Mitigation:** Only applies to the free `/scan` page — authed scanner stays focused. The free tool is a top-of-funnel retention play, the authed product stays narrow.

**Risk:** Streaming response could break behind some corporate proxies that buffer responses.
**Mitigation:** Set `X-Content-Type-Options: nosniff` and `Cache-Control: no-store` headers to discourage intermediate buffering. Accept residual risk — corporate users behind strict proxies are not the target audience for a free public scanner.
