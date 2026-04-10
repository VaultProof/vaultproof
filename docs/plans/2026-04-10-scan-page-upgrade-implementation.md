# Scan Page Upgrade Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade the public `/scan` page to handle 500 files + 50 commits per scan, stream real progress, and surface three new finding categories (risky files, code smells, repo hygiene) so clean repos never leave users empty-handed.

**Architecture:** One worker file and one HTML file. The worker keeps its inline-request architecture but returns an `application/x-ndjson` streaming response instead of a single JSON payload. The frontend reads the stream to drive a real progress bar and renders four severity-tiered result sections.

**Tech Stack:** TypeScript, CF Workers (`ReadableStream`, `TransformStream`), vanilla HTML/JS, Tailwind CDN

**Design doc:** `docs/plans/2026-04-10-scan-page-upgrade-design.md`

**Verification:** No test framework in the worker package. Verification is `cd packages/worker && npx tsc --noEmit` plus end-to-end curl against the deployed worker. Pre-existing TS errors in `crypto/share2.ts` and `routes/transparent-proxy.ts` are NOT this plan's concern — do not touch them. Only ensure your changes add no NEW errors.

---

## Task 1: Bump worker constants and extend the Finding type

**Files:**
- Modify: `packages/worker/src/routes/scan-public.ts` (lines 19-24, 52-63)

**Step 1: Read the current constants block**

Run: Read `packages/worker/src/routes/scan-public.ts` lines 1-70 to confirm the current shape.

**Step 2: Update constants at the top of the file**

Replace lines 19-24:

```typescript
const MAX_FILES = 50;            // reduced to leave headroom for commit fetches
const MAX_CONCURRENT_FETCHES = 20;
const MAX_COMMITS = 20;          // last N commits to scan for history leaks
const MAX_FINDINGS = 200;
const RATE_LIMIT = 10;
const RATE_LIMIT_TTL = 3600;
```

With:

```typescript
const MAX_FILES = 500;
const MAX_CONCURRENT_FETCHES = 20;
const MAX_COMMITS = 50;
const MAX_FINDINGS = 500;
const RATE_LIMIT = 10;
const RATE_LIMIT_TTL = 3600;
const HISTORY_SCAN_TIMEOUT_MS = 25_000;
```

**Step 3: Update the history scan timeout reference**

In `scanHistory` (around line 129) change:

```typescript
const timer = setTimeout(() => abort.abort(), 15_000);
```

To:

```typescript
const timer = setTimeout(() => abort.abort(), HISTORY_SCAN_TIMEOUT_MS);
```

**Step 4: Extend the Finding interface**

Replace the current `Finding` interface (lines 52-63):

```typescript
interface Finding {
  provider: string;
  providerName: string;
  file: string;
  line: number;
  maskedValue: string;
  severity: 'CRITICAL' | 'HIGH';
  source: 'current' | 'history';
  commitSha?: string;
  commitMessage?: string;
  commitDate?: string;
}
```

With:

```typescript
type FindingCategory = 'secret' | 'file' | 'code' | 'hygiene';

interface Finding {
  category: FindingCategory;
  provider: string;          // providerName-free findings use category tag (e.g. 'eval')
  providerName: string;      // display name; for non-secret findings this is a short title
  file: string;
  line: number;
  maskedValue: string;        // '' for non-secret findings
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'INFO';
  source: 'current' | 'history';
  commitSha?: string;
  commitMessage?: string;
  commitDate?: string;
  title?: string;             // human-readable title for non-secret findings
  description?: string;       // short explanation shown in the result card
}
```

**Step 5: Backfill category on existing finding constructors**

Two spots construct secret `Finding` objects (lines 87 and 97 in the current file). Both are inside `scanLines()`. Add `category: 'secret'` to each literal:

Line 87 becomes:
```typescript
findings.push({ category: 'secret', provider, providerName: PROVIDER_NAMES[provider] || provider, file: filePath, line: i + 1, maskedValue: maskKey(value), severity: 'CRITICAL', ...ctx });
```

Line 97 becomes:
```typescript
findings.push({ category: 'secret', provider, providerName: PROVIDER_NAMES[provider] || provider, file: filePath, line: i + 1, maskedValue: maskKey(value), severity: 'CRITICAL', ...ctx });
```

**Step 6: Typecheck**

Run: `cd /Users/nelson/projects/zkvault/packages/worker && npx tsc --noEmit`
Expected: No new errors. Pre-existing errors in `crypto/share2.ts` and `routes/transparent-proxy.ts` remain unchanged.

**Step 7: Commit**

```bash
git add packages/worker/src/routes/scan-public.ts
git commit -m "feat(scanner): bump limits to 500 files / 50 commits and extend Finding type"
```

---

## Task 2: Add risky-file detector

**Files:**
- Modify: `packages/worker/src/routes/scan-public.ts`

**Step 1: Add the risky-file pattern table**

Add this block near the top of the file, right after the constants (around line 25):

```typescript
interface RiskyFilePattern {
  pattern: RegExp;
  title: string;
  description: string;
}

const RISKY_FILE_PATTERNS: RiskyFilePattern[] = [
  {
    // .env, .env.prod, .env.local — but NOT .env.example / .env.sample / .env.template / .env.dist
    pattern: /(^|\/)\.env(\.(?!example$|sample$|template$|dist$)[a-zA-Z0-9_-]+)?$/,
    title: 'Committed .env file',
    description: 'Environment files often contain live credentials. Add to .gitignore and rotate any leaked values.',
  },
  {
    pattern: /(^|\/)(id_rsa|id_dsa|id_ecdsa|id_ed25519)(\.pub)?$/,
    title: 'Committed SSH key',
    description: 'SSH private keys grant server access. Rotate immediately and remove from git history.',
  },
  {
    pattern: /\.(pem|key|p12|pfx|asc|gpg)$/i,
    title: 'Committed cryptographic key file',
    description: 'Key files are rarely safe to commit. Rotate and remove from history.',
  },
  {
    pattern: /(^|\/)\.aws\/(credentials|config)$/,
    title: 'Committed AWS credentials',
    description: 'AWS credentials grant cloud access. Rotate immediately and remove from history.',
  },
  {
    pattern: /(gcp-key|gcloud-service-key|service-account|firebase-adminsdk-[^/]+)\.json$/,
    title: 'Committed cloud service account',
    description: 'Service account JSONs grant cloud access. Rotate and remove from history.',
  },
  {
    pattern: /\.(sql|dump|bak)$/i,
    title: 'Committed database dump',
    description: 'Database dumps often contain PII, secrets, or live data. Remove from the repo.',
  },
];

function detectRiskyFiles(filePaths: string[]): Finding[] {
  const findings: Finding[] = [];
  for (const path of filePaths) {
    for (const { pattern, title, description } of RISKY_FILE_PATTERNS) {
      if (pattern.test(path)) {
        findings.push({
          category: 'file',
          provider: 'risky-file',
          providerName: title,
          file: path,
          line: 1,
          maskedValue: '',
          severity: 'HIGH',
          source: 'current',
          title,
          description,
        });
        break; // one finding per file; don't double-match
      }
    }
  }
  return findings;
}
```

**Step 2: Wire it into the main handler**

In `handlePublicScan`, after the `allFiles` filter is computed (around line 254) and before `filesToScan` is sliced, add the risky-file detection:

```typescript
const allFiles = (treeData.tree || []).filter(
  (f) => f.type === 'blob' && shouldScanFile(f.path)
);
const filesToScan = allFiles.slice(0, MAX_FILES);

// Check ALL tree entries (not just scannable files) for risky filenames
const allTreePaths = (treeData.tree || []).filter((f) => f.type === 'blob').map((f) => f.path);
const riskyFileFindings = detectRiskyFiles(allTreePaths);
```

**Step 3: Include riskyFileFindings in the final merge**

Find the line `const allFindings = [...currentResult.findings, ...historyResult.findings];` and replace with:

```typescript
const allFindings = [
  ...currentResult.findings,
  ...historyResult.findings,
  ...riskyFileFindings,
];
```

**Step 4: Typecheck**

Run: `cd /Users/nelson/projects/zkvault/packages/worker && npx tsc --noEmit`
Expected: No new errors.

**Step 5: Commit**

```bash
git add packages/worker/src/routes/scan-public.ts
git commit -m "feat(scanner): detect risky files committed to the repo"
```

---

## Task 3: Add code smell detector

**Files:**
- Modify: `packages/worker/src/routes/scan-public.ts`

**Step 1: Add the code-smell pattern table near the top of the file**

After `RISKY_FILE_PATTERNS`:

```typescript
interface CodeSmellPattern {
  pattern: RegExp;
  title: string;
  description: string;
  fileMatcher?: RegExp; // if present, only apply to files matching this regex
}

const CODE_SMELL_PATTERNS: CodeSmellPattern[] = [
  {
    pattern: /\beval\s*\(/,
    title: 'Use of eval()',
    description: 'eval() executes arbitrary strings as code. Use JSON.parse or a safer alternative.',
    fileMatcher: /\.(js|jsx|ts|tsx|py)$/i,
  },
  {
    pattern: /new\s+Function\s*\(/,
    title: 'Dynamic code via Function()',
    description: 'The Function constructor evaluates strings as code — same risk as eval().',
    fileMatcher: /\.(js|jsx|ts|tsx)$/i,
  },
  {
    pattern: /\.innerHTML\s*=/,
    title: 'Unsafe innerHTML assignment',
    description: 'Assigning unescaped strings to innerHTML enables XSS. Use textContent or a sanitizer.',
    fileMatcher: /\.(js|jsx|ts|tsx|html)$/i,
  },
  {
    pattern: /dangerouslySetInnerHTML/,
    title: 'dangerouslySetInnerHTML in React',
    description: 'Bypasses React escaping. Only use with strictly sanitized input.',
    fileMatcher: /\.(js|jsx|ts|tsx)$/i,
  },
  {
    pattern: /\b(md5|MD5|sha1|SHA1)\s*\(/,
    title: 'Weak hash function',
    description: 'MD5 and SHA1 are broken for security. Use SHA-256 or better.',
  },
  {
    pattern: /\b(DES|RC4)\b/,
    title: 'Weak cipher',
    description: 'DES and RC4 are broken. Use AES-256-GCM or ChaCha20-Poly1305.',
  },
  {
    pattern: /Access-Control-Allow-Origin[^\n]{0,50}["']\*["']/,
    title: 'CORS wildcard',
    description: 'Allowing all origins defeats CORS protection for authenticated endpoints.',
  },
  {
    pattern: /"\s*SELECT\b[^"]*"\s*\+/,
    title: 'SQL string concatenation',
    description: 'Concatenating user input into SQL strings enables injection. Use parameterized queries.',
    fileMatcher: /\.(js|jsx|ts|tsx|py|java|go|rb|php)$/i,
  },
];

function scanCodeSmells(lines: string[], filePath: string): Finding[] {
  const findings: Finding[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 2000) continue;
    for (const { pattern, title, description, fileMatcher } of CODE_SMELL_PATTERNS) {
      if (fileMatcher && !fileMatcher.test(filePath)) continue;
      if (pattern.test(line)) {
        findings.push({
          category: 'code',
          provider: 'code-smell',
          providerName: title,
          file: filePath,
          line: i + 1,
          maskedValue: '',
          severity: 'MEDIUM',
          source: 'current',
          title,
          description,
        });
      }
    }
  }
  return findings;
}
```

**Step 2: Wire it into scanFileContent**

Find `scanFileContent` (around line 106):

```typescript
function scanFileContent(content: string, filePath: string): Finding[] {
  return scanLines(content.split('\n'), filePath, { source: 'current' });
}
```

Replace with:

```typescript
function scanFileContent(content: string, filePath: string): Finding[] {
  const lines = content.split('\n');
  return [
    ...scanLines(lines, filePath, { source: 'current' }),
    ...scanCodeSmells(lines, filePath),
  ];
}
```

**Step 3: Typecheck**

Run: `cd /Users/nelson/projects/zkvault/packages/worker && npx tsc --noEmit`
Expected: No new errors.

**Step 4: Commit**

```bash
git add packages/worker/src/routes/scan-public.ts
git commit -m "feat(scanner): detect dangerous code patterns (eval, innerHTML, weak crypto, CORS, SQL concat)"
```

---

## Task 4: Add repo hygiene detector

**Files:**
- Modify: `packages/worker/src/routes/scan-public.ts`

**Step 1: Add the hygiene check function**

Add near the risky-file and code-smell functions:

```typescript
interface HygieneCheck {
  matchers: RegExp[];       // any of these matching a tree path means the file exists
  title: string;
  description: string;
}

const HYGIENE_CHECKS: HygieneCheck[] = [
  {
    matchers: [/^\.gitignore$/],
    title: 'No .gitignore file',
    description: "Without .gitignore, secrets accidentally committed can't be excluded from future commits.",
  },
  {
    matchers: [/^LICENSE(\.md|\.txt)?$/, /^COPYING$/],
    title: 'No LICENSE file',
    description: 'Unclear licensing blocks commercial and open-source reuse of this project.',
  },
  {
    matchers: [/^SECURITY\.md$/, /^\.github\/SECURITY\.md$/, /^docs\/SECURITY\.md$/],
    title: 'No security policy',
    description: 'SECURITY.md gives users a clear way to report vulnerabilities.',
  },
  {
    matchers: [/^README(\.md|\.rst|\.txt)?$/],
    title: 'No README',
    description: 'Hurts discoverability and user trust.',
  },
];

function detectHygieneIssues(allTreePaths: string[]): Finding[] {
  const findings: Finding[] = [];
  for (const check of HYGIENE_CHECKS) {
    const exists = allTreePaths.some((path) => check.matchers.some((m) => m.test(path)));
    if (!exists) {
      findings.push({
        category: 'hygiene',
        provider: 'hygiene',
        providerName: check.title,
        file: '',
        line: 0,
        maskedValue: '',
        severity: 'INFO',
        source: 'current',
        title: check.title,
        description: check.description,
      });
    }
  }
  return findings;
}
```

**Step 2: Wire it into the handler**

In `handlePublicScan`, next to where you added `riskyFileFindings` in Task 2, add:

```typescript
const hygieneFindings = detectHygieneIssues(allTreePaths);
```

**Step 3: Include in final merge**

Update the `allFindings` merge to include hygiene:

```typescript
const allFindings = [
  ...currentResult.findings,
  ...historyResult.findings,
  ...riskyFileFindings,
  ...hygieneFindings,
];
```

**Step 4: Exclude hygiene from the MAX_FINDINGS cap**

Hygiene findings are always-shown insurance — they shouldn't get dropped by the findings cap. After Pass 1/Pass 2 dedup but before the `slice(0, MAX_FINDINGS)`, partition them:

```typescript
// Pass 2: if a key exists in current files, suppress duplicate from history
const currentKeys = new Set(
  pass1.filter(f => f.source === 'current').map(f => `${f.file}:${f.provider}:${f.maskedValue}`)
);
const dedupedFindings = pass1.filter(f =>
  f.source === 'current' || !currentKeys.has(`${f.file}:${f.provider}:${f.maskedValue}`)
);

// Keep hygiene findings out of the MAX_FINDINGS cap — they're the retention-insurance items
const hygieneOnly = dedupedFindings.filter(f => f.category === 'hygiene');
const nonHygiene = dedupedFindings.filter(f => f.category !== 'hygiene');
const cappedFindings = [...nonHygiene.slice(0, MAX_FINDINGS), ...hygieneOnly];
```

**Step 5: Typecheck**

Run: `cd /Users/nelson/projects/zkvault/packages/worker && npx tsc --noEmit`
Expected: No new errors.

**Step 6: Commit**

```bash
git add packages/worker/src/routes/scan-public.ts
git commit -m "feat(scanner): report missing .gitignore, LICENSE, SECURITY.md, README"
```

---

## Task 5: Refactor handler to streaming NDJSON response

**Files:**
- Modify: `packages/worker/src/routes/scan-public.ts` (`handlePublicScan` function)

**Context:** The handler currently awaits `Promise.all([currentScanPromise, scanHistory(...)])` then returns `Response.json(...)`. We need to refactor so the scan runs inside an async task that writes NDJSON events to a `ReadableStream`, and the handler returns the Response immediately with the stream as its body. Progress events come from inside the file and history scan loops.

**Step 1: Add a stream writer helper**

Add this helper function near the top of the file (after the constants, before `scanLines`):

```typescript
function createNdjsonStream(): { stream: ReadableStream<Uint8Array>; write: (obj: unknown) => void; close: () => void } {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) { controller = c; },
  });
  let closed = false;
  return {
    stream,
    write(obj: unknown) {
      if (closed) return;
      try {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      } catch { /* controller already errored */ }
    },
    close() {
      if (closed) return;
      closed = true;
      try { controller.close(); } catch { /* already closed */ }
    },
  };
}
```

**Step 2: Thread a progress callback through the file scan**

The current file scan is an IIFE: `const currentScanPromise = (async () => { ... })();`. Extract it to a named helper that accepts a progress callback:

Replace the current file scan with:

```typescript
async function scanCurrentFiles(
  filesToScan: Array<{ path: string; url: string }>,
  env: Env,
  onProgress: (done: number, total: number) => void,
): Promise<{ findings: Finding[]; filesScanned: number }> {
  const findings: Finding[] = [];
  let filesScanned = 0;
  const total = filesToScan.length;

  for (let i = 0; i < filesToScan.length; i += MAX_CONCURRENT_FETCHES) {
    const batch = filesToScan.slice(i, i + MAX_CONCURRENT_FETCHES);
    const results = await Promise.all(
      batch.map(async (file) => {
        if (!file.url.startsWith(GITHUB_API_PREFIX)) return null;
        const fileAbort = new AbortController();
        const fileTimer = setTimeout(() => fileAbort.abort(), 5000);
        let res: Response;
        try {
          res = await fetch(file.url, {
            headers: { ...ghHeaders(env), Accept: 'application/vnd.github.raw+json' },
            signal: fileAbort.signal,
          });
        } catch {
          clearTimeout(fileTimer);
          return null;
        }
        clearTimeout(fileTimer);
        if (!res.ok) return null;
        const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
        if (contentLength > 512 * 1024) return null;
        const text = await res.text();
        return { path: file.path, content: text };
      }),
    );
    for (const result of results) {
      if (!result) continue;
      filesScanned++;
      findings.push(...scanFileContent(result.content, result.path));
    }
    onProgress(Math.min(i + MAX_CONCURRENT_FETCHES, total), total);
  }
  return { findings, filesScanned };
}
```

**Step 3: Thread a progress callback through the history scan**

Modify `scanHistory` to accept an optional `onProgress(done: number, total: number)` callback and call it after each commit batch:

```typescript
async function scanHistory(
  repo: string,
  env: Env,
  onProgress?: (done: number, total: number) => void,
): Promise<{ findings: Finding[]; commitsScanned: number }> {
  const findings: Finding[] = [];
  const headers = ghHeaders(env);

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), HISTORY_SCAN_TIMEOUT_MS);

  try {
    const commitsRes = await fetch(
      `https://api.github.com/repos/${repo}/commits?per_page=${MAX_COMMITS}`,
      { headers, signal: abort.signal },
    );
    if (!commitsRes.ok) return { findings, commitsScanned: 0 };

    const commits: Array<{ sha: string; commit: { message: string; author?: { date?: string } } }> = await commitsRes.json();
    if (!Array.isArray(commits) || commits.length === 0) return { findings, commitsScanned: 0 };

    const total = commits.length;
    let done = 0;

    for (let i = 0; i < commits.length; i += 10) {
      if (abort.signal.aborted) break;
      const batch = commits.slice(i, i + 10);
      const details = await Promise.all(batch.map(async (c) => {
        try {
          const res = await fetch(
            `https://api.github.com/repos/${repo}/commits/${c.sha}`,
            { headers, signal: abort.signal },
          );
          if (!res.ok) return null;
          const data = await res.json() as { files?: Array<{ filename: string; patch?: string }> };
          return { sha: c.sha, message: c.commit.message.split('\n')[0].slice(0, 72), date: c.commit.author?.date || '', files: data.files || [] };
        } catch {
          return null;
        }
      }));

      for (const detail of details) {
        if (!detail) continue;
        for (const file of detail.files) {
          if (!file.patch || !shouldScanFile(file.filename)) continue;
          const patchFindings = scanPatch(file.patch, file.filename, detail.sha, detail.message, detail.date);
          findings.push(...patchFindings);
        }
      }

      done += batch.length;
      if (onProgress) onProgress(Math.min(done, total), total);
    }

    return { findings, commitsScanned: commits.length };
  } catch {
    return { findings, commitsScanned: 0 };
  } finally {
    clearTimeout(timer);
  }
}
```

**Step 4: Refactor handlePublicScan to stream**

This is the main refactor. Replace the entire body of `handlePublicScan` after the initial guards (rate limit, JSON body parse, repo normalize) and the tree fetch (everything after the `allFiles` computation, approximately from line 254 onward) with the streaming pipeline:

```typescript
  // --- tree fetch and early error paths stay the same through line ~254 ---

  const allFiles = (treeData.tree || []).filter(
    (f) => f.type === 'blob' && shouldScanFile(f.path),
  );
  const filesToScan = allFiles.slice(0, MAX_FILES);
  const allTreePaths = (treeData.tree || []).filter((f) => f.type === 'blob').map((f) => f.path);

  // Detect filename-based and hygiene findings up front — they don't need fetches
  const riskyFileFindings = detectRiskyFiles(allTreePaths);
  const hygieneFindings = detectHygieneIssues(allTreePaths);

  // Build the NDJSON stream
  const { stream, write, close } = createNdjsonStream();

  // Background task: run the actual scan
  (async () => {
    try {
      write({ phase: 'tree' });

      const [currentResult, historyResult] = await Promise.all([
        scanCurrentFiles(filesToScan, env, (done, total) => {
          write({ phase: 'files', done, total });
        }),
        scanHistory(repo, env, (done, total) => {
          write({ phase: 'commits', done, total });
        }),
      ]);

      const allFindings = [
        ...currentResult.findings,
        ...historyResult.findings,
        ...riskyFileFindings,
        ...hygieneFindings,
      ];

      // Pass 1: deduplicate exact duplicates
      const seen = new Set<string>();
      const pass1 = allFindings.filter((f) => {
        const key = `${f.category}:${f.source}:${f.commitSha || ''}:${f.file}:${f.line}:${f.provider}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Pass 2: if a secret exists in current files, suppress history duplicate
      const currentKeys = new Set(
        pass1
          .filter((f) => f.category === 'secret' && f.source === 'current')
          .map((f) => `${f.file}:${f.provider}:${f.maskedValue}`),
      );
      const dedupedFindings = pass1.filter(
        (f) =>
          f.category !== 'secret' ||
          f.source === 'current' ||
          !currentKeys.has(`${f.file}:${f.provider}:${f.maskedValue}`),
      );

      // Hygiene is outside the MAX_FINDINGS cap
      const hygieneOnly = dedupedFindings.filter((f) => f.category === 'hygiene');
      const nonHygiene = dedupedFindings.filter((f) => f.category !== 'hygiene');
      const cappedFindings = [...nonHygiene.slice(0, MAX_FINDINGS), ...hygieneOnly];

      write({
        phase: 'done',
        result: {
          repo,
          filesScanned: currentResult.filesScanned,
          commitsScanned: historyResult.commitsScanned,
          findings: cappedFindings,
          truncated: nonHygiene.length > MAX_FINDINGS,
        },
      });
    } catch (err) {
      write({ phase: 'error', message: err instanceof Error ? err.message : 'Scan failed' });
    } finally {
      close();
    }
  })();

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
}
```

**Step 5: Verify the tree-fetch error paths still return normal JSON**

The existing early returns (rate limit 429, invalid JSON 400, repo not found 404, GitHub rate limit 429, private repo 403) all happen BEFORE the stream is created. They continue to return `Response.json(...)` as before. Only successful scans return a stream.

Double-check this by reading the function from top and confirming no early return was accidentally converted to streaming.

**Step 6: Typecheck**

Run: `cd /Users/nelson/projects/zkvault/packages/worker && npx tsc --noEmit`
Expected: No new errors.

**Step 7: Commit**

```bash
git add packages/worker/src/routes/scan-public.ts
git commit -m "feat(scanner): refactor to streaming NDJSON response with progress events"
```

---

## Task 6: Update scan page capability line and progress text

**Files:**
- Modify: `apps/site/scan.html`

**Step 1: Add capability line below the example text**

Find the "Example: github.com/..." paragraph (around line 236):

```html
<p class="text-xs text-gray-600 mt-3">Example: <button type="button" onclick="prefillExample()" class="text-gray-500 hover:text-gray-300 underline underline-offset-2 transition-colors">github.com/trufflesecurity/trufflehog</button></p>
```

Add this directly after it:

```html
<p class="text-xs text-gray-600 mt-2">Scans up to 500 files · 50 commits of history · secrets, risky files, code smells, hygiene</p>
```

**Step 2: Update progress helper text**

Find the progress box text (around line 249):

```html
<p class="text-xs text-gray-500 mt-0.5">This may take a few seconds for larger repos.</p>
```

Change to:

```html
<p class="text-xs text-gray-500 mt-0.5">Large repos can take 20–30 seconds.</p>
```

**Step 3: Commit**

```bash
git add apps/site/scan.html
git commit -m "feat(scan-page): add capability line and update progress helper text"
```

---

## Task 7: Add "What we scan" card grid

**Files:**
- Modify: `apps/site/scan.html`

**Step 1: Insert the card grid below the hero section**

Find the `<main class="max-w-2xl mx-auto px-4 sm:px-6 pb-32">` tag (around line 241). This is where the scan results and progress box live. The card grid should go INSIDE `<main>` but ABOVE the `progressBox` and result areas.

Insert this block immediately after the opening `<main ...>` tag (and BEFORE the existing `<div id="progressBox" class="hidden">`):

```html
        <!-- What we scan -->
        <div id="whatWeScan" class="mt-12 mb-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div class="bg-vp-surface border border-vp-border rounded-xl p-5">
            <div class="text-sm font-semibold text-gray-200 mb-2">🔑 Leaked API keys</div>
            <p class="text-xs text-gray-500 mb-2">Both current files AND git history</p>
            <ul class="text-xs text-gray-500 space-y-1">
              <li>OpenAI, Anthropic, Google AI</li>
              <li>AWS, Google Cloud</li>
              <li>Stripe, SendGrid, Resend, Brevo</li>
              <li>GitHub, npm, Slack, Datadog</li>
              <li>Supabase, MongoDB, Neon, Upstash</li>
              <li>PostHog, Contentful, Twilio</li>
              <li class="text-gray-600">and 13 more providers</li>
            </ul>
          </div>
          <div class="bg-vp-surface border border-vp-border rounded-xl p-5">
            <div class="text-sm font-semibold text-gray-200 mb-2">📁 Risky files committed</div>
            <ul class="text-xs text-gray-500 space-y-1 mt-2">
              <li>.env files</li>
              <li>Private keys (id_rsa, *.pem, *.key)</li>
              <li>Cloud credentials (.aws/credentials)</li>
              <li>Service account JSONs</li>
              <li>Database dumps (*.sql, *.dump, *.bak)</li>
            </ul>
          </div>
          <div class="bg-vp-surface border border-vp-border rounded-xl p-5">
            <div class="text-sm font-semibold text-gray-200 mb-2">⚠️ Code smells</div>
            <ul class="text-xs text-gray-500 space-y-1 mt-2">
              <li>eval() and Function() constructors</li>
              <li>Unsafe HTML (innerHTML, dangerouslySetInnerHTML)</li>
              <li>Weak crypto (MD5, SHA1, DES, RC4)</li>
              <li>CORS wildcards</li>
              <li>SQL string concatenation</li>
            </ul>
          </div>
          <div class="bg-vp-surface border border-vp-border rounded-xl p-5">
            <div class="text-sm font-semibold text-gray-200 mb-2">✅ Repo hygiene</div>
            <ul class="text-xs text-gray-500 space-y-1 mt-2">
              <li>.gitignore</li>
              <li>LICENSE</li>
              <li>SECURITY.md</li>
              <li>README.md</li>
            </ul>
          </div>
        </div>
```

**Step 2: Verify in browser**

Open `apps/site/scan.html` in a browser locally (or serve via a static server) and confirm:
- The grid appears below the hero and above the (hidden) progress box
- 4 columns on large screens, 2 on medium, 1 on mobile
- Doesn't compete visually with the hero

**Step 3: Commit**

```bash
git add apps/site/scan.html
git commit -m "feat(scan-page): add 'what we scan' 4-card grid with provider and category details"
```

---

## Task 8: Replace spinner with progress bar UI

**Files:**
- Modify: `apps/site/scan.html`

**Step 1: Replace the progress box markup**

Find the existing progress box:

```html
<!-- Progress indicator -->
<div id="progressBox" class="hidden">
    <div class="flex items-center gap-3 bg-vp-surface border border-vp-border rounded-xl px-5 py-4">
        <div class="spinner"></div>
        <div>
            <p id="progressText" class="text-sm font-medium text-gray-200">Scanning repository…</p>
            <p class="text-xs text-gray-500 mt-0.5">Large repos can take 20–30 seconds.</p>
        </div>
    </div>
</div>
```

Replace with:

```html
<!-- Progress indicator -->
<div id="progressBox" class="hidden">
    <div class="bg-vp-surface border border-vp-border rounded-xl px-5 py-4">
        <div class="flex items-center justify-between mb-2">
            <p id="progressPhase" class="text-sm font-medium text-gray-200">Starting scan…</p>
            <span id="progressPct" class="text-xs text-gray-500 font-mono">0%</span>
        </div>
        <div class="w-full h-2 bg-vp-border rounded-full overflow-hidden">
            <div id="progressFill" class="h-full bg-brand transition-all duration-300 ease-out" style="width:0%"></div>
        </div>
        <p class="text-xs text-gray-500 mt-2">Large repos can take 20–30 seconds.</p>
    </div>
</div>
```

**Step 2: Commit**

```bash
git add apps/site/scan.html
git commit -m "feat(scan-page): replace spinner with progress bar UI"
```

---

## Task 9: Replace JSON fetch with streaming reader

**Files:**
- Modify: `apps/site/scan.html`

**Context:** The existing `runScan()` function uses `fetch()` + `res.json()`. Replace it with a streaming reader that parses NDJSON line-by-line and updates the progress bar on each event.

**Step 1: Locate the existing runScan function**

Find `async function runScan(rawRepo)` in the `<script>` block (around line 463). Read it fully — it starts around line 463 and extends to around line 570. Pay attention to:
- How `progressBox`, `errorBox`, result rendering elements are shown/hidden
- The `setScanning(active)` helper
- The `gtag('event', ...)` calls that track the scan start/completion
- The HTTP error handling for 429, 404, 403, 500

**Step 2: Add progress-update helper above runScan**

Add this helper right above `async function runScan`:

```javascript
function updateProgressBar(state) {
    const phaseEl = document.getElementById('progressPhase');
    const pctEl = document.getElementById('progressPct');
    const fillEl = document.getElementById('progressFill');

    // Weighted progress: tree 5%, files 5->60%, commits 60->95%, done 100%
    let pct = 5;
    if (state.filesTotal > 0) {
        pct += (state.filesDone / state.filesTotal) * 55;
    }
    if (state.commitsTotal > 0) {
        pct += (state.commitsDone / state.commitsTotal) * 35;
    }
    pct = Math.min(pct, state.done ? 100 : 99);

    let phaseLabel = 'Starting scan…';
    if (state.done) phaseLabel = 'Done';
    else if (state.filesTotal > 0 && state.filesDone < state.filesTotal) {
        phaseLabel = `Scanning files (${state.filesDone}/${state.filesTotal})`;
    } else if (state.commitsTotal > 0 && state.commitsDone < state.commitsTotal) {
        phaseLabel = `Scanning git history (${state.commitsDone}/${state.commitsTotal})`;
    } else if (state.treeStarted) {
        phaseLabel = 'Fetching repo tree…';
    }

    phaseEl.textContent = phaseLabel;
    pctEl.textContent = Math.round(pct) + '%';
    fillEl.style.width = pct + '%';
}
```

**Step 3: Replace the fetch block inside runScan**

The existing `runScan` has a section that looks like:

```javascript
const res = await fetch('https://api.vaultproof.dev/api/scan/public', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo }),
});

if (!res.ok) {
    // ... existing HTTP error handling ...
}

const result = await res.json();
// ... then render results ...
```

Replace the response-handling portion with a streaming reader. The fetch call itself and the pre-scan setup (show progressBox, hide errorBox, disable button) stay the same. What changes is everything AFTER `const res = await fetch(...)`:

```javascript
if (!res.ok) {
    // Existing status-code → message mapping stays. Attempt to parse the error body.
    let errorMsg;
    try {
        const err = await res.json();
        errorMsg = err.error;
    } catch {
        errorMsg = null;
    }
    if (!errorMsg) {
        switch (res.status) {
            case 429: errorMsg = 'Rate limited. Try again in a few minutes.'; break;
            case 404: errorMsg = 'Repo not found. Is it public?'; break;
            case 403: errorMsg = 'Access denied. The repo may be private or rate limited.'; break;
            case 500: errorMsg = 'GitHub API error. Please try again in a moment.'; break;
            case 504: errorMsg = 'GitHub API timed out. Try again in a moment.'; break;
            default: errorMsg = 'Something went wrong. Try again.';
        }
    }
    throw new Error(errorMsg);
}

// Streaming NDJSON reader
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buf = '';
const progressState = {
    treeStarted: false,
    filesDone: 0,
    filesTotal: 0,
    commitsDone: 0,
    commitsTotal: 0,
    done: false,
};
let finalResult = null;

while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();  // keep incomplete last line
    for (const line of lines) {
        if (!line.trim()) continue;
        let evt;
        try { evt = JSON.parse(line); } catch { continue; }

        if (evt.phase === 'tree') {
            progressState.treeStarted = true;
        } else if (evt.phase === 'files') {
            progressState.filesDone = evt.done;
            progressState.filesTotal = evt.total;
        } else if (evt.phase === 'commits') {
            progressState.commitsDone = evt.done;
            progressState.commitsTotal = evt.total;
        } else if (evt.phase === 'done') {
            progressState.done = true;
            finalResult = evt.result;
        } else if (evt.phase === 'error') {
            throw new Error(evt.message || 'Scan failed');
        }

        updateProgressBar(progressState);
    }
}

if (!finalResult) throw new Error('Scan ended without a result');

// Let the filled bar sit for a brief moment before fading out
await new Promise(r => setTimeout(r, 300));

// Existing post-scan rendering: replace `result` references with `finalResult`
const result = finalResult;
// ... keep existing rendering code ...
```

The critical change: any subsequent code that used `result` keeps working because we aliased `finalResult` as `result`. Leave the gtag('event', ...) calls as they were.

**Step 4: Typecheck (HTML isn't typechecked, but verify the file parses)**

Open the file in a browser or run:
```bash
node -e "const fs=require('fs');const html=fs.readFileSync('apps/site/scan.html','utf8');if(!html.includes('updateProgressBar'))process.exit(1);console.log('ok')"
```
Expected: `ok`

**Step 5: Commit**

```bash
git add apps/site/scan.html
git commit -m "feat(scan-page): stream NDJSON scan results and drive real progress bar"
```

---

## Task 10: Render new result sections (risky files, code smells, recommendations)

**Files:**
- Modify: `apps/site/scan.html`

**Context:** The current rendering code only handles leaked-secret findings. We need to add three new sections: Risky files (HIGH), Code smells (MEDIUM), and Recommendations (INFO / hygiene). The existing `findings` array from the server now contains all four categories — we partition and render each.

**Step 1: Read the existing result rendering code**

Find where findings are rendered after `result` is available (around lines 530-560). Look for the block that builds finding cards from `result.findings`. Note how it handles:
- The "no findings found" (clean repo) success case
- The `source === 'history'` branch for git-history findings
- The summary text line

**Step 2: Partition findings by category in the rendering code**

Where `result.findings` is first accessed, add partitioning:

```javascript
const findings = finalResult.findings || [];
const secretFindings = findings.filter(f => f.category === 'secret');
const fileFindings = findings.filter(f => f.category === 'file');
const codeFindings = findings.filter(f => f.category === 'code');
const hygieneFindings = findings.filter(f => f.category === 'hygiene');
```

**Step 3: Update the "no findings" success case**

Currently, if `findings.length === 0` the page shows a green "This repo looks clean" message. Change the condition so this message only shows when there are NO secret, file, OR code findings (hygiene doesn't count as "bad"):

```javascript
const criticalCount = secretFindings.length + fileFindings.length + codeFindings.length;
if (criticalCount === 0) {
    // Show the "clean repo" success box
    // ... existing success box code, unchanged ...
} else {
    // Render findings sections
    // ... see Step 4 ...
}
```

However — even in the "clean repo" case, we still want to show the Recommendations section (hygiene findings). So inside the `criticalCount === 0` branch, ALSO render the recommendations section (Step 4d) afterwards.

**Step 4: Render new sections**

Below the existing secret-findings rendering block (inside the `else` branch), render three new sections.

**4a. Risky files section:**

```javascript
if (fileFindings.length > 0) {
    const fileSectionHtml = `
        <div class="mt-8">
            <h2 class="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                <span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-orange-500/20 text-orange-400 text-xs font-bold">!</span>
                Risky files committed (${fileFindings.length})
            </h2>
            <div class="space-y-2">
                ${fileFindings.map(f => `
                    <div class="bg-vp-surface border border-orange-900/40 rounded-xl px-5 py-4">
                        <div class="flex items-center gap-2 mb-1">
                            <span class="text-xs font-medium px-2 py-0.5 rounded-full bg-orange-500/10 border border-orange-500/30 text-orange-400">HIGH</span>
                            <span class="text-sm font-medium text-gray-200">${escapeHtml(f.title || f.providerName)}</span>
                        </div>
                        <p class="text-xs text-gray-500 font-mono mb-1">${escapeHtml(f.file)}</p>
                        <p class="text-xs text-gray-400">${escapeHtml(f.description || '')}</p>
                    </div>
                `).join('')}
            </div>
        </div>`;
    resultsEl.insertAdjacentHTML('beforeend', fileSectionHtml);
}
```

Replace `resultsEl` with whatever the results container is named in the existing code.

**4b. Code smells section:**

```javascript
if (codeFindings.length > 0) {
    const codeSectionHtml = `
        <div class="mt-8">
            <h2 class="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                <span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 text-xs font-bold">?</span>
                Code smells (${codeFindings.length})
            </h2>
            <div class="space-y-2">
                ${codeFindings.slice(0, 30).map(f => `
                    <div class="bg-vp-surface border border-amber-900/30 rounded-xl px-4 py-3">
                        <div class="flex items-center gap-2 mb-1">
                            <span class="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400">MEDIUM</span>
                            <span class="text-sm font-medium text-gray-300">${escapeHtml(f.title || f.providerName)}</span>
                        </div>
                        <p class="text-xs text-gray-500 font-mono">${escapeHtml(f.file)}:${f.line}</p>
                        <p class="text-xs text-gray-500 mt-1">${escapeHtml(f.description || '')}</p>
                    </div>
                `).join('')}
                ${codeFindings.length > 30 ? `<p class="text-xs text-gray-600 text-center mt-2">+ ${codeFindings.length - 30} more — showing top 30</p>` : ''}
            </div>
        </div>`;
    resultsEl.insertAdjacentHTML('beforeend', codeSectionHtml);
}
```

**4c. Recommendations section (always shown):**

```javascript
const recsSectionHtml = `
    <div class="mt-8 mb-8">
        <h2 class="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 text-xs font-bold">i</span>
            Recommendations
        </h2>
        <div class="bg-vp-surface border border-vp-border rounded-xl px-5 py-4">
            ${hygieneFindings.length === 0
                ? `<p class="text-sm text-gray-400">Looks great — all hygiene checks passed.</p>`
                : `<ul class="space-y-3">${hygieneFindings.map(f => `
                    <li class="text-sm">
                        <div class="text-gray-300 font-medium">${escapeHtml(f.title || f.providerName)}</div>
                        <div class="text-xs text-gray-500 mt-0.5">${escapeHtml(f.description || '')}</div>
                    </li>`).join('')}</ul>`
            }
        </div>
    </div>`;
resultsEl.insertAdjacentHTML('beforeend', recsSectionHtml);
```

The recommendations block ALWAYS renders, regardless of whether the repo was clean or had findings.

**4d. Add escapeHtml helper if not already present**

Search for `escapeHtml` in scan.html. If not present, add this helper at the top of the script block:

```javascript
function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
```

**Step 5: Verify in browser**

Open scan.html locally and trigger a scan against a known-dirty repo like `trufflesecurity/trufflehog`. You should see:
- Real progress bar updating
- Leaked secrets section (if any)
- Risky files section (if any)
- Code smells section (if any)
- Recommendations section (always)

**Step 6: Commit**

```bash
git add apps/site/scan.html
git commit -m "feat(scan-page): render risky files, code smells, and recommendations sections"
```

---

## Task 11: Deploy and smoke-test

**Files:** (deployment only, no code changes)

**Step 1: Deploy the worker**

```bash
cd /Users/nelson/projects/zkvault
bash scripts/deploy-worker.sh
```

Expected output:
```
[1/4] Current version: ...
[2/4] Deploying worker...
[3/4] Running health checks...
       Check 1/3: PASS (health=200, auth=401)
[4/4] Deploy successful!
```

If the health check fails, the script auto-rolls back. Investigate via `cd packages/worker && npx wrangler tail` and re-deploy after fix.

**Step 2: Push frontend to main for CF Pages auto-deploy**

```bash
git push origin dev
git push origin dev:main
```

CF Pages will rebuild `vaultproof.dev` from main within 1-2 minutes.

**Step 3: Smoke test — clean repo**

Once both deploys are live:

```bash
curl -N -X POST https://api.vaultproof.dev/api/scan/public \
  -H 'Content-Type: application/json' \
  -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15' \
  -d '{"repo":"sindresorhus/slugify"}'
```

The `-N` flag disables buffering so you see the NDJSON stream in real time.

Expected output (lines come in as the scan runs):
```
{"phase":"tree"}
{"phase":"files","done":20,"total":N}
{"phase":"commits","done":10,"total":M}
...
{"phase":"done","result":{"repo":"sindresorhus/slugify","filesScanned":...,"commitsScanned":...,"findings":[...],"truncated":false}}
```

For a clean repo, the `findings` array should contain zero `secret`, `file`, or `code` items, but 0-4 `hygiene` items.

**Step 4: Smoke test — dirty repo**

```bash
curl -N -X POST https://api.vaultproof.dev/api/scan/public \
  -H 'Content-Type: application/json' \
  -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15' \
  -d '{"repo":"trufflesecurity/trufflehog"}'
```

Expected: stream completes, `findings` array contains both secret findings (from test fixtures in that repo) AND hygiene findings.

**Step 5: Smoke test — browser UI**

Open https://vaultproof.dev/scan in a fresh incognito window.

Verify:
- "What we scan" card grid is visible below the form
- Capability line under the example text reads "Scans up to 500 files · 50 commits of history · secrets, risky files, code smells, hygiene"
- Paste `trufflesecurity/trufflehog` and click Scan
- Progress bar animates smoothly from 0% to 100% with phase labels changing
- Four result sections render in order: secrets / risky files / code smells / recommendations
- For a clean repo, the Recommendations section still shows

**Step 6: Check worker logs if anything looks off**

```bash
cd packages/worker && npx wrangler tail --env=""
```

Watch for errors as you trigger a scan from the browser. `wrangler tail` streams production logs in real time.

**Step 7: Final commit and push (if any follow-up fixes)**

If smoke tests pass cleanly, no further commits are needed. If you discover a small fix during smoke testing, commit it and re-deploy.

---

## Post-merge cleanup

None. The old `analytics_events`-style dual-write pattern is not relevant here since there's no legacy code path to preserve — `handlePublicScan` was a single function that we've refactored in place.

## Notes for future phases

- **Phase 2 (not in this plan):** Add OSV.dev dependency vulnerability scanning. Requires parsing `package.json` / `requirements.txt` / `Gemfile.lock`, calling OSV.dev bulk API (one additional subrequest per manifest, maybe 3-5 total), caching results in KV for 1 hour per package.
- **Phase 3 (speculative):** Allow signed-in users to scan private repos via GitHub OAuth, tied into the existing authed scanner infrastructure.
