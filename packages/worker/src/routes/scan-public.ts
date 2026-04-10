import type { Env } from '../types.js';
import {
  KEY_PATTERNS,
  ENV_VAR_MAP,
  shannonEntropy,
  shouldScanFile,
  MIN_ENTROPY,
  PROVIDER_NAMES,
  stripKeyPrefix,
} from '../lib/secret-patterns.js';

// Pre-build non-global versions of KEY_PATTERNS for use in scanFileContent.
// Creating RegExp objects in a hot inner loop is expensive in CF Worker CPU budget.
const KEY_PATTERNS_LOCAL = KEY_PATTERNS.map(({ pattern, provider }) => ({
  pattern: new RegExp(pattern.source, pattern.flags.replace('g', '')),
  provider,
}));

const MAX_FILES = 500;
const MAX_CONCURRENT_FETCHES = 20;
const MAX_COMMITS = 50;
const MAX_FINDINGS = 500;
const RATE_LIMIT = 10;
const RATE_LIMIT_TTL = 3600;
const HISTORY_SCAN_TIMEOUT_MS = 25_000;

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
      try { controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n')); } catch { /* controller errored */ }
    },
    close() {
      if (closed) return;
      closed = true;
      try { controller.close(); } catch { /* already closed */ }
    },
  };
}

interface RiskyFilePattern {
  pattern: RegExp;
  title: string;
  description: string;
  severity: 'HIGH' | 'MEDIUM';
}

const RISKY_FILE_PATTERNS: RiskyFilePattern[] = [
  {
    pattern: /(^|\/)\.env(\.(?!example$|sample$|template$|dist$)[a-zA-Z0-9_-]+)?$/,
    title: 'Committed .env file',
    description: 'Environment files often contain live credentials. Add to .gitignore and rotate any leaked values.',
    severity: 'HIGH',
  },
  {
    // Private keys only — exclude .pub (public keys are safe to commit)
    pattern: /(^|\/)(id_rsa|id_dsa|id_ecdsa|id_ed25519)$/,
    title: 'Committed SSH private key',
    description: 'SSH private keys grant server access. Rotate immediately and remove from git history.',
    severity: 'HIGH',
  },
  {
    pattern: /\.(pem|key|p12|pfx|asc|gpg)$/i,
    title: 'Committed cryptographic key file',
    description: 'Key files are rarely safe to commit. Rotate and remove from history.',
    severity: 'HIGH',
  },
  {
    pattern: /(^|\/)\.aws\/(credentials|config)$/,
    title: 'Committed AWS credentials',
    description: 'AWS credentials grant cloud access. Rotate immediately and remove from history.',
    severity: 'HIGH',
  },
  {
    pattern: /(gcp-key|gcloud-service-key|service-account|firebase-adminsdk-[^/]+)\.json$/,
    title: 'Committed cloud service account',
    description: 'Service account JSONs grant cloud access. Rotate and remove from history.',
    severity: 'HIGH',
  },
  {
    // *.dump and *.bak are binary dumps — almost always unintentional
    pattern: /\.(dump|bak)$/i,
    title: 'Committed database dump',
    description: 'Database dumps often contain PII, secrets, or live data. Remove from the repo.',
    severity: 'HIGH',
  },
  {
    // *.sql files are often migrations/fixtures — flag as MEDIUM, not HIGH
    pattern: /\.sql$/i,
    title: 'Committed SQL file',
    description: 'SQL files may contain sensitive schema or seed data. Verify no credentials are hardcoded.',
    severity: 'MEDIUM',
  },
];

function detectRiskyFiles(filePaths: string[]): Finding[] {
  const findings: Finding[] = [];
  for (const path of filePaths) {
    for (const { pattern, title, description, severity } of RISKY_FILE_PATTERNS) {
      if (pattern.test(path)) {
        findings.push({
          category: 'file',
          provider: 'risky-file',
          providerName: title,
          file: path,
          line: 1,
          maskedValue: '',
          severity,
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
    pattern: /Access-Control-Allow-Origin[^\n]{0,50}(["']\*["']|\*\s*$)/,
    title: 'CORS wildcard',
    description: 'Allowing all origins defeats CORS protection for authenticated endpoints.',
  },
  {
    pattern: /(['"])\s*SELECT\b[^'"]*\1\s*\+/,
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
    matchers: [/^LICENSE(\.md|\.txt)?$/i, /^COPYING$/i],
    title: 'No LICENSE file',
    description: 'Unclear licensing blocks commercial and open-source reuse of this project.',
  },
  {
    matchers: [/^SECURITY\.md$/i, /^\.github\/SECURITY\.md$/i, /^docs\/SECURITY\.md$/i],
    title: 'No security policy',
    description: 'SECURITY.md gives users a clear way to report vulnerabilities.',
  },
  {
    matchers: [/^README(\.md|\.rst|\.txt|\.org)?$/i],
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

async function checkScanRateLimit(env: Env, ip: string): Promise<boolean> {
  const key = `rl:scan:pub:${ip}`;
  const raw = await env.CACHE.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= RATE_LIMIT) return false;
  await env.CACHE.put(key, String(count + 1), { expirationTtl: RATE_LIMIT_TTL });
  return true;
}

function normalizeRepo(input: string): string | null {
  let slug = input.trim();
  slug = slug.replace(/^https?:\/\/github\.com\//, '');
  slug = slug.replace(/\.git$/, '');
  slug = slug.replace(/\/$/, '');
  const match = slug.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!match) return null;
  return slug;
}

function maskKey(value: string): string {
  if (value.length <= 4) return '...XXXX';
  // Show up to 12 chars: enough to identify provider prefix but not expose entropy
  const prefix = value.slice(0, Math.min(12, Math.floor(value.length / 2)));
  return prefix + '...XXXX';
}

type FindingCategory = 'secret' | 'file' | 'code' | 'hygiene';

interface Finding {
  category: FindingCategory;
  provider: string;
  providerName: string;
  file: string;
  line: number;
  maskedValue: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'INFO';
  source: 'current' | 'history';
  commitSha?: string;
  commitMessage?: string;
  commitDate?: string;
  title?: string;
  description?: string;
}

interface ScanContext {
  source: 'current' | 'history';
  commitSha?: string;
  commitMessage?: string;
  commitDate?: string;
}

function scanLines(lines: string[], filePath: string, ctx: ScanContext): Finding[] {
  const findings: Finding[] = [];
  const isEnvFile = filePath.endsWith('.env') || filePath.includes('.env.');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 2000) continue;

    if (isEnvFile) {
      const envMatch = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
      if (envMatch) {
        const [, varName, rawValue] = envMatch;
        const value = rawValue.replace(/^["']|["']$/g, '').trim();
        const provider = ENV_VAR_MAP[varName];
        if (provider && shannonEntropy(value) >= MIN_ENTROPY) {
          findings.push({ category: 'secret', provider, providerName: PROVIDER_NAMES[provider] || provider, file: filePath, line: i + 1, maskedValue: maskKey(value), severity: 'CRITICAL', ...ctx });
        }
      }
    }

    for (const { pattern, provider } of KEY_PATTERNS_LOCAL) {
      const match = line.match(pattern);
      if (match) {
        const value = match[0];
        if (shannonEntropy(stripKeyPrefix(value)) >= MIN_ENTROPY) {
          findings.push({ category: 'secret', provider, providerName: PROVIDER_NAMES[provider] || provider, file: filePath, line: i + 1, maskedValue: maskKey(value), severity: 'CRITICAL', ...ctx });
        }
      }
    }
  }

  return findings;
}

function scanFileContent(content: string, filePath: string): Finding[] {
  const lines = content.split('\n');
  return [
    ...scanLines(lines, filePath, { source: 'current' }),
    ...scanCodeSmells(lines, filePath),
  ];
}

// Scan the `+` lines (additions) in a git patch for a single file.
function scanPatch(patch: string, filePath: string, commitSha: string, commitMessage: string, commitDate: string): Finding[] {
  const ctx: ScanContext = { source: 'history', commitSha, commitMessage, commitDate };
  // Extract only added lines (start with `+` but not `+++` file header)
  const addedLines = patch
    .split('\n')
    .filter(l => l.startsWith('+') && !l.startsWith('+++'))
    .map(l => l.slice(1)); // strip leading `+`
  return scanLines(addedLines, filePath, ctx);
}

const GITHUB_API_PREFIX = 'https://api.github.com/';

async function scanHistory(repo: string, env: Env, onProgress?: (done: number, total: number) => void): Promise<{ findings: Finding[]; commitsScanned: number }> {
  const findings: Finding[] = [];
  const headers = ghHeaders(env);

  // 25-second hard budget for the entire history scan
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), HISTORY_SCAN_TIMEOUT_MS);

  try {
    // Fetch commit list
    const commitsRes = await fetch(
      `https://api.github.com/repos/${repo}/commits?per_page=${MAX_COMMITS}`,
      { headers, signal: abort.signal }
    );
    if (!commitsRes.ok) return { findings, commitsScanned: 0 };

    const commits: Array<{ sha: string; commit: { message: string; author?: { date?: string } } }> = await commitsRes.json();
    if (!Array.isArray(commits) || commits.length === 0) return { findings, commitsScanned: 0 };

    // Fetch each commit's detail (contains file patches) in parallel batches of 10
    let done = 0;
    const total = commits.length;
    for (let i = 0; i < commits.length; i += 10) {
      if (abort.signal.aborted) break;
      const batch = commits.slice(i, i + 10);
      const details = await Promise.all(batch.map(async (c) => {
        try {
          const res = await fetch(
            `https://api.github.com/repos/${repo}/commits/${c.sha}`,
            { headers, signal: abort.signal }
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

function ghHeaders(env: Env): Record<string, string> {
  const h: Record<string, string> = { 'User-Agent': 'VaultProof-Scanner/1.0', Accept: 'application/vnd.github+json' };
  if (env.GITHUB_TOKEN) h['Authorization'] = `Bearer ${env.GITHUB_TOKEN}`;
  return h;
}

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

export async function handlePublicScan(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  // Always rate-limit. Use 'unknown' as sentinel when CF-Connecting-IP is absent
  // (non-CF path, local dev) so all such traffic shares one bucket rather than
  // bypassing the limit entirely.
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const allowed = await checkScanRateLimit(env, ip);
  if (!allowed) {
    return Response.json(
      { error: '10 free scans per hour — try again soon.' },
      { status: 429, headers: { 'Retry-After': String(RATE_LIMIT_TTL) } }
    );
  }

  let body: { repo?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const repo = normalizeRepo(typeof body.repo === 'string' ? body.repo : '');
  if (!repo) {
    return Response.json(
      { error: 'Invalid repo. Use "owner/repo" or a full GitHub URL.' },
      { status: 400 }
    );
  }

  const treeUrl = `https://api.github.com/repos/${repo}/git/trees/HEAD?recursive=1`;
  const treeController = new AbortController();
  const treeTimer = setTimeout(() => treeController.abort(), 8000);
  let treeRes: Response;
  try {
    treeRes = await fetch(treeUrl, {
      headers: ghHeaders(env),
      signal: treeController.signal,
    });
  } catch {
    clearTimeout(treeTimer);
    return Response.json({ error: 'GitHub API timed out. Try again in a moment.' }, { status: 504 });
  }
  clearTimeout(treeTimer);

  if (treeRes.status === 404) {
    return Response.json({ error: 'Repo not found. Is it public?' }, { status: 404 });
  }
  if (treeRes.status === 403 || treeRes.status === 401) {
    // GitHub returns 403 (not 429) when the unauthenticated rate limit is hit.
    // Distinguish by checking X-RateLimit-Remaining header.
    const remaining = treeRes.headers.get('X-RateLimit-Remaining');
    if (remaining === '0') {
      return Response.json(
        { error: 'GitHub API rate limit reached. Try again in a few minutes.' },
        { status: 429 }
      );
    }
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

  // Check ALL tree entries (not just scannable files) for risky filenames
  const allTreePaths = (treeData.tree || []).filter((f) => f.type === 'blob').map((f) => f.path);
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
        const key = `${f.source}:${f.commitSha || ''}:${f.file}:${f.line}:${f.provider}:${f.title ?? ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Pass 2: suppress history duplicates of current-file secrets
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

      // Hygiene findings are always-shown — exclude from the MAX_FINDINGS cap
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
