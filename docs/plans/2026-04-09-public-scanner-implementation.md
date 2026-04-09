# Public API Key Scanner — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a public `/scan` landing page + `POST /api/scan/public` Worker endpoint that lets anyone scan a public GitHub repo for exposed API keys with no login required.

**Architecture:** New route `scan-public.ts` in the Worker fetches a repo's file tree from GitHub, runs the existing `secret-patterns.ts` detection library, masks any found keys, and returns JSON. The static `scan.html` page calls this endpoint, renders findings as cards, and shows a sticky CTA after any findings.

**Tech Stack:** Cloudflare Workers (TypeScript), existing `secret-patterns.ts` pattern library, KV rate limiting, static HTML + Tailwind CDN.

---

### Task 1: Worker — `scan-public.ts` route

**Files:**
- Create: `packages/worker/src/routes/scan-public.ts`

**Step 1: Create the file with the rate-limit helper**

```typescript
// packages/worker/src/routes/scan-public.ts
import type { Env } from '../types.js';
import {
  KEY_PATTERNS,
  ENV_VAR_MAP,
  shannonEntropy,
  shouldScanFile,
  MIN_ENTROPY,
  PROVIDER_NAMES,
} from '../lib/secret-patterns.js';

const MAX_FILES = 100;
const MAX_CONCURRENT_FETCHES = 20;
const RATE_LIMIT = 10;
const RATE_LIMIT_TTL = 3600;

async function checkScanRateLimit(env: Env, ip: string): Promise<boolean> {
  const key = `rl:scan:pub:${ip}`;
  const raw = await env.CACHE.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= RATE_LIMIT) return false;
  await env.CACHE.put(key, String(count + 1), { expirationTtl: RATE_LIMIT_TTL });
  return true;
}
```

**Step 2: Add the repo normalizer + validator**

Append to `scan-public.ts`:

```typescript
function normalizeRepo(input: string): string | null {
  // Strip GitHub URL prefix if present
  let slug = input.trim();
  slug = slug.replace(/^https?:\/\/github\.com\//, '');
  slug = slug.replace(/\.git$/, '');
  slug = slug.replace(/\/$/, '');
  // Must be owner/repo, each part alphanumeric + hyphens/underscores/dots
  const match = slug.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!match) return null;
  return slug;
}
```

**Step 3: Add the key masker**

Append to `scan-public.ts`:

```typescript
function maskKey(value: string): string {
  if (value.length <= 8) return '...XXXX';
  return value.slice(0, 8) + '...XXXX';
}
```

**Step 4: Add the file scanner**

Append to `scan-public.ts`:

```typescript
interface Finding {
  provider: string;
  providerName: string;
  file: string;
  line: number;
  maskedValue: string;
  severity: 'CRITICAL' | 'HIGH';
}

function scanFileContent(content: string, filePath: string): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split('\n');
  const isEnvFile = filePath.endsWith('.env') || filePath.includes('.env.');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 2000) continue; // skip minified lines

    if (isEnvFile) {
      // Parse KEY=VALUE pairs in .env files
      const envMatch = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
      if (envMatch) {
        const [, varName, rawValue] = envMatch;
        const value = rawValue.replace(/^["']|["']$/g, '').trim();
        const provider = ENV_VAR_MAP[varName];
        if (provider && shannonEntropy(value) >= MIN_ENTROPY) {
          findings.push({
            provider,
            providerName: PROVIDER_NAMES[provider] || provider,
            file: filePath,
            line: i + 1,
            maskedValue: maskKey(value),
            severity: 'CRITICAL',
          });
        }
      }
    }

    // Run all key patterns against the line
    for (const { pattern, provider } of KEY_PATTERNS) {
      // Clone pattern to reset lastIndex for global regexes
      const localPattern = new RegExp(pattern.source, pattern.flags.replace('g', ''));
      const match = line.match(localPattern);
      if (match) {
        const value = match[0];
        if (shannonEntropy(value) >= MIN_ENTROPY) {
          findings.push({
            provider,
            providerName: PROVIDER_NAMES[provider] || provider,
            file: filePath,
            line: i + 1,
            maskedValue: maskKey(value),
            severity: 'CRITICAL',
          });
        }
      }
    }
  }

  return findings;
}
```

**Step 5: Add the main handler**

Append to `scan-public.ts`:

```typescript
export async function handlePublicScan(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  // Rate limit by IP
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const allowed = await checkScanRateLimit(env, ip);
  if (!allowed) {
    return Response.json(
      { error: '10 free scans per hour — try again soon.' },
      { status: 429 }
    );
  }

  // Parse + validate body
  let body: { repo?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const repo = normalizeRepo(body.repo || '');
  if (!repo) {
    return Response.json(
      { error: 'Invalid repo. Use "owner/repo" or a full GitHub URL.' },
      { status: 400 }
    );
  }

  // Fetch repo tree from GitHub
  const treeUrl = `https://api.github.com/repos/${repo}/git/trees/HEAD?recursive=1`;
  const treeRes = await fetch(treeUrl, {
    headers: { 'User-Agent': 'VaultProof-Scanner/1.0', Accept: 'application/vnd.github+json' },
  });

  if (treeRes.status === 404) {
    return Response.json({ error: 'Repo not found. Is it public?' }, { status: 404 });
  }
  if (treeRes.status === 403 || treeRes.status === 401) {
    return Response.json(
      { error: 'This repo is private. Only public repos can be scanned.' },
      { status: 403 }
    );
  }
  if (!treeRes.ok) {
    return Response.json({ error: 'GitHub API error. Try again in a moment.' }, { status: 500 });
  }

  const treeData: { tree?: Array<{ path: string; type: string; url: string }> } = await treeRes.json();
  const allFiles = (treeData.tree || []).filter(
    (f) => f.type === 'blob' && shouldScanFile(f.path)
  );
  const filesToScan = allFiles.slice(0, MAX_FILES);

  // Fetch file contents in parallel (batched)
  const findings: Finding[] = [];
  let filesScanned = 0;

  for (let i = 0; i < filesToScan.length; i += MAX_CONCURRENT_FETCHES) {
    const batch = filesToScan.slice(i, i + MAX_CONCURRENT_FETCHES);
    const results = await Promise.all(
      batch.map(async (file) => {
        const res = await fetch(file.url, {
          headers: {
            'User-Agent': 'VaultProof-Scanner/1.0',
            Accept: 'application/vnd.github.raw+json',
          },
        });
        if (!res.ok) return null;
        // GitHub returns raw content with Accept: application/vnd.github.raw+json
        const text = await res.text();
        return { path: file.path, content: text };
      })
    );

    for (const result of results) {
      if (!result) continue;
      filesScanned++;
      const fileFindings = scanFileContent(result.content, result.path);
      findings.push(...fileFindings);
    }
  }

  // Deduplicate (same file + line + provider)
  const seen = new Set<string>();
  const dedupedFindings = findings.filter((f) => {
    const key = `${f.file}:${f.line}:${f.provider}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return Response.json({
    repo,
    filesScanned,
    findings: dedupedFindings,
  });
}
```

**Step 6: Manual smoke test**

Start the worker locally:
```bash
cd packages/worker && npm run dev
```

Test with curl:
```bash
# Valid public repo
curl -X POST http://localhost:8787/api/scan/public \
  -H "Content-Type: application/json" \
  -d '{"repo":"torvalds/linux"}'
# Expected: { repo, filesScanned: N, findings: [] }

# Invalid repo
curl -X POST http://localhost:8787/api/scan/public \
  -H "Content-Type: application/json" \
  -d '{"repo":"not a repo"}'
# Expected: 400 { error: "Invalid repo..." }

# Private/nonexistent repo
curl -X POST http://localhost:8787/api/scan/public \
  -H "Content-Type: application/json" \
  -d '{"repo":"doesnotexist99999/fakerepo"}'
# Expected: 404
```

**Step 7: Commit**

```bash
git add packages/worker/src/routes/scan-public.ts
git commit -m "feat: add POST /api/scan/public Worker endpoint"
```

---

### Task 2: Register route in `index.ts`

**Files:**
- Modify: `packages/worker/src/index.ts`

**Step 1: Add the import**

At the top of `packages/worker/src/index.ts`, after the existing imports, add:

```typescript
import { handlePublicScan } from './routes/scan-public.js';
```

**Step 2: Register the route**

In `packages/worker/src/index.ts`, add this block **before** the `/v1/` transparent proxy block (around line 167):

```typescript
// Public scan (no auth, IP rate limited)
if (url.pathname === '/api/scan/public') {
  try {
    const response = await handlePublicScan(request, env);
    return addCors(response, origin, allowedOrigins);
  } catch {
    return addCors(Response.json({ error: 'Service temporarily unavailable' }, { status: 503 }), origin, allowedOrigins);
  }
}
```

**Step 3: Verify it routes correctly**

```bash
cd packages/worker && npm run dev
curl -X POST http://localhost:8787/api/scan/public \
  -H "Content-Type: application/json" \
  -d '{"repo":"octocat/Hello-World"}'
# Expected: { repo: "octocat/Hello-World", filesScanned: N, findings: [] }
```

**Step 4: Commit**

```bash
git add packages/worker/src/index.ts
git commit -m "feat: register /api/scan/public route in Worker"
```

---

### Task 3: Frontend — `scan.html`

**Files:**
- Create: `apps/site/scan.html`

**Step 1: Create the page shell**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <!-- Google Analytics -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-NE5RYX1WTF"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-NE5RYX1WTF');</script>
  <link rel="icon" type="image/png" href="/favicon.png">
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Free API Key Scanner — VaultProof</title>
  <meta name="description" content="Scan any public GitHub repo for exposed API keys. Free, instant, no signup required.">
  <meta property="og:title" content="Free API Key Scanner — VaultProof">
  <meta property="og:description" content="Scan any public GitHub repo for exposed API keys. Free, instant, no signup required.">
  <meta property="og:image" content="https://vaultproof.dev/ogimage.png">
  <link rel="canonical" href="https://vaultproof.dev/scan">
  <script src="https://cdn.tailwindcss.com/3.4.17"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" />
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            sans: ['Inter', 'sans-serif'],
            mono: ['JetBrains Mono', 'monospace']
          },
          colors: {
            brand: '#6366f1',
            'brand-hover': '#5558e6',
            cyan: '#06b6d4',
            surface: '#0a0a0f',
            card: '#111118',
            border: '#1e1e2e'
          }
        }
      }
    };
  </script>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: 'Inter', sans-serif; background: #0a0a0f; margin: 0; color: #e2e8f0; }
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: #0a0a0f; }
    ::-webkit-scrollbar-thumb { background: #2a2a3a; border-radius: 3px; }
    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .fade-in-up { animation: fadeInUp 0.3s ease forwards; }
    .spinner { animation: spin 0.8s linear infinite; }
    #sticky-cta { transition: transform 0.3s ease, opacity 0.3s ease; }
  </style>
</head>
<body class="min-h-screen">

  <!-- Nav -->
  <nav class="border-b border-border px-6 py-4 flex items-center justify-between">
    <a href="/" class="flex items-center gap-2">
      <img src="/logo-sm.png" alt="VaultProof" class="h-7 w-7">
      <span class="font-semibold text-white font-['Space_Grotesk']">VaultProof</span>
    </a>
    <a href="/app/login.html" class="text-sm text-slate-400 hover:text-white transition-colors">Sign in →</a>
  </nav>

  <!-- Hero -->
  <section class="max-w-2xl mx-auto px-6 pt-16 pb-12 text-center">
    <div class="inline-flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-full px-3 py-1 text-xs text-red-400 mb-6">
      <span class="w-1.5 h-1.5 rounded-full bg-red-400 inline-block"></span>
      Free scanner — no signup required
    </div>
    <h1 class="text-4xl font-bold text-white font-['Space_Grotesk'] mb-4 leading-tight">
      Find exposed API keys<br>in any public GitHub repo
    </h1>
    <p class="text-slate-400 text-lg mb-10">
      Paste a repo URL. We scan it instantly for leaked keys, .env patterns, and hardcoded secrets.
    </p>

    <!-- Input -->
    <form id="scan-form" class="flex flex-col sm:flex-row gap-3">
      <input
        id="repo-input"
        type="text"
        placeholder="github.com/owner/repo"
        class="flex-1 bg-card border border-border rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-brand text-sm font-mono"
        autocomplete="off"
        spellcheck="false"
      />
      <button
        id="scan-btn"
        type="submit"
        class="bg-brand hover:bg-brand-hover text-white font-semibold px-6 py-3 rounded-xl transition-colors text-sm whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Scan repo
      </button>
    </form>
    <p class="text-xs text-slate-600 mt-3">Public repos only. Keys are masked — raw values never leave the server.</p>
  </section>

  <!-- Results area -->
  <section class="max-w-2xl mx-auto px-6 pb-32">
    <!-- Progress -->
    <div id="progress" class="hidden text-center py-12">
      <div class="inline-flex items-center gap-3 text-slate-400">
        <svg class="spinner w-5 h-5 text-brand" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
        </svg>
        <span id="progress-text" class="text-sm">Fetching repo tree…</span>
      </div>
    </div>

    <!-- Error -->
    <div id="error-box" class="hidden bg-red-900/20 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm text-center"></div>

    <!-- Results -->
    <div id="results" class="hidden">
      <div id="results-summary" class="flex items-center justify-between mb-4">
        <span id="results-label" class="text-sm text-slate-400"></span>
      </div>
      <div id="findings-list" class="space-y-3"></div>
    </div>

    <!-- Empty state -->
    <div id="empty-state" class="hidden text-center py-16">
      <div class="text-4xl mb-4">✓</div>
      <h3 class="text-white font-semibold text-lg mb-2">No exposed keys found</h3>
      <p class="text-slate-400 text-sm mb-6">Nice work. This repo looks clean.</p>
      <a href="/app/login.html" class="text-brand hover:underline text-sm">
        Use VaultProof to keep it that way →
      </a>
    </div>
  </section>

  <!-- Sticky CTA (hidden until findings appear) -->
  <div
    id="sticky-cta"
    class="fixed bottom-0 left-0 right-0 translate-y-full opacity-0 pointer-events-none z-50"
    aria-hidden="true"
  >
    <div class="bg-red-950/90 backdrop-blur-md border-t border-red-500/30 px-6 py-4">
      <div class="max-w-2xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <p id="cta-headline" class="text-white font-semibold text-sm"></p>
          <p class="text-red-300 text-xs mt-0.5">VaultProof protects these in production — keys never touch your code.</p>
        </div>
        <a
          href="/app/login.html"
          class="bg-red-500 hover:bg-red-400 text-white font-semibold px-5 py-2.5 rounded-lg text-sm whitespace-nowrap transition-colors flex-shrink-0"
        >
          Free signup →
        </a>
      </div>
    </div>
  </div>

  <script>
    const API_BASE = 'https://api.vaultproof.dev';

    const form = document.getElementById('scan-form');
    const repoInput = document.getElementById('repo-input');
    const scanBtn = document.getElementById('scan-btn');
    const progressEl = document.getElementById('progress');
    const progressText = document.getElementById('progress-text');
    const errorBox = document.getElementById('error-box');
    const resultsEl = document.getElementById('results');
    const resultsLabel = document.getElementById('results-label');
    const findingsList = document.getElementById('findings-list');
    const emptyState = document.getElementById('empty-state');
    const stickyCta = document.getElementById('sticky-cta');
    const ctaHeadline = document.getElementById('cta-headline');

    const SEVERITY_COLORS = {
      CRITICAL: 'bg-red-500/10 border-red-500/30 text-red-400',
      HIGH: 'bg-orange-500/10 border-orange-500/30 text-orange-400',
    };

    const PROVIDER_ICONS = {
      openai: '🤖', anthropic: '🤖', stripe: '💳', github: '🐙',
      aws: '☁️', google: '🔍', sendgrid: '📧', resend: '📧',
      supabase: '🗄️', slack: '💬', twilio: '📱', default: '🔑',
    };

    function providerIcon(provider) {
      return PROVIDER_ICONS[provider] || PROVIDER_ICONS.default;
    }

    function findingCard(finding) {
      const severityClass = SEVERITY_COLORS[finding.severity] || SEVERITY_COLORS.HIGH;
      return `
        <div class="bg-card border border-border rounded-xl p-4 fade-in-up">
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-center gap-2 min-w-0">
              <span class="text-lg flex-shrink-0">${providerIcon(finding.provider)}</span>
              <div class="min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-white font-semibold text-sm">${escapeHtml(finding.providerName)}</span>
                  <span class="border rounded px-1.5 py-0.5 text-xs font-medium ${severityClass}">
                    ${escapeHtml(finding.severity)}
                  </span>
                </div>
                <p class="text-slate-500 text-xs mt-1 font-mono truncate">
                  ${escapeHtml(finding.file)}:${finding.line}
                </p>
              </div>
            </div>
            <code class="text-xs font-mono text-slate-300 bg-slate-800/50 px-2 py-1 rounded flex-shrink-0">
              ${escapeHtml(finding.maskedValue)}
            </code>
          </div>
        </div>
      `;
    }

    function escapeHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function showStickyCta(findingCount, fileCount) {
      ctaHeadline.textContent = `${findingCount} exposed key${findingCount !== 1 ? 's' : ''} found across ${fileCount} file${fileCount !== 1 ? 's' : ''}.`;
      stickyCta.classList.remove('translate-y-full', 'opacity-0', 'pointer-events-none');
      stickyCta.setAttribute('aria-hidden', 'false');
    }

    function reset() {
      progressEl.classList.add('hidden');
      errorBox.classList.add('hidden');
      resultsEl.classList.add('hidden');
      emptyState.classList.add('hidden');
      stickyCta.classList.add('translate-y-full', 'opacity-0', 'pointer-events-none');
      stickyCta.setAttribute('aria-hidden', 'true');
      findingsList.innerHTML = '';
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const rawInput = repoInput.value.trim();
      if (!rawInput) return;

      reset();
      scanBtn.disabled = true;
      scanBtn.textContent = 'Scanning…';
      progressEl.classList.remove('hidden');
      progressText.textContent = 'Fetching repo tree…';

      // Track scan attempt
      if (typeof gtag !== 'undefined') {
        gtag('event', 'public_scan_started', { repo: rawInput });
      }

      try {
        progressText.textContent = 'Scanning files for exposed keys…';
        const res = await fetch(`${API_BASE}/api/scan/public`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repo: rawInput }),
        });

        const data = await res.json();
        progressEl.classList.add('hidden');

        if (!res.ok) {
          errorBox.textContent = data.error || 'Something went wrong. Please try again.';
          errorBox.classList.remove('hidden');
          return;
        }

        const { findings, filesScanned, repo } = data;

        if (findings.length === 0) {
          emptyState.classList.remove('hidden');
          return;
        }

        // Show results
        const uniqueFiles = new Set(findings.map(f => f.file)).size;
        resultsLabel.textContent = `${findings.length} finding${findings.length !== 1 ? 's' : ''} in ${filesScanned} files scanned`;
        findingsList.innerHTML = findings.map(findingCard).join('');
        resultsEl.classList.remove('hidden');
        showStickyCta(findings.length, uniqueFiles);

        // Track findings
        if (typeof gtag !== 'undefined') {
          gtag('event', 'public_scan_completed', {
            repo,
            findings_count: findings.length,
            files_scanned: filesScanned,
          });
        }
      } catch {
        progressEl.classList.add('hidden');
        errorBox.textContent = 'Network error. Check your connection and try again.';
        errorBox.classList.remove('hidden');
      } finally {
        scanBtn.disabled = false;
        scanBtn.textContent = 'Scan repo';
      }
    });

    // Pre-fill from URL param: /scan?repo=owner/repo
    const urlParams = new URLSearchParams(window.location.search);
    const preRepo = urlParams.get('repo');
    if (preRepo) {
      repoInput.value = preRepo;
      form.requestSubmit();
    }
  </script>
</body>
</html>
```

**Step 2: Open the page locally**

Open `apps/site/scan.html` directly in a browser (or via a local HTTP server). Verify:
- Page renders with dark theme and nav
- Input is focused/prominent
- No console errors

**Step 3: Wire to local Worker and test end-to-end**

With Worker running (`cd packages/worker && npm run dev`), temporarily change `API_BASE` in `scan.html` to `http://localhost:8787`, then:

1. Enter `octocat/Hello-World` → expect: scan runs, empty state (no keys found)
2. Enter `not a repo` → expect: error message shown
3. Enter a nonexistent repo → expect: 404 error message
4. Hit the rate limit (submit 11 times) → expect: 429 message

After testing, revert `API_BASE` to `https://api.vaultproof.dev`.

**Step 4: Commit**

```bash
git add apps/site/scan.html
git commit -m "feat: add public API key scanner landing page at /scan"
```

---

### Task 4: Add `/scan` to sitemap and nav

**Files:**
- Modify: `apps/site/sitemap.xml`
- Modify: `apps/site/index.html` (optional — add a link from homepage)

**Step 1: Add to sitemap**

Open `apps/site/sitemap.xml`. Add an entry mirroring the existing pattern:

```xml
<url>
  <loc>https://vaultproof.dev/scan</loc>
  <changefreq>weekly</changefreq>
  <priority>0.8</priority>
</url>
```

**Step 2: Add a link from homepage (optional but recommended)**

In `apps/site/index.html`, find the hero section or nav. Add a link near the existing CTAs:

```html
<a href="/scan" class="text-sm text-slate-400 hover:text-white underline underline-offset-2">
  Free repo scanner →
</a>
```

**Step 3: Commit**

```bash
git add apps/site/sitemap.xml apps/site/index.html
git commit -m "feat: add /scan to sitemap and homepage nav"
```

---

### Task 5: Deploy and verify in production

**Step 1: Deploy the Worker**

```bash
bash scripts/deploy-worker.sh
```

Expected: health check passes, auto-rollback does NOT trigger.

**Step 2: Deploy the frontend**

CF Pages deploys automatically on push to `main`. Just push:

```bash
git push origin main
```

**Step 3: Smoke test in production**

```bash
curl -X POST https://api.vaultproof.dev/api/scan/public \
  -H "Content-Type: application/json" \
  -d '{"repo":"octocat/Hello-World"}'
# Expected: { repo, filesScanned: N, findings: [] }
```

Then open `https://vaultproof.dev/scan` in a browser and run a real scan.

**Step 4: Done**

```bash
# No additional commit needed — production verified.
```
