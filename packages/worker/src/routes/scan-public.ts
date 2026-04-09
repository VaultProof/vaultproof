import type { Env } from '../types.js';
import {
  KEY_PATTERNS,
  ENV_VAR_MAP,
  shannonEntropy,
  shouldScanFile,
  MIN_ENTROPY,
  PROVIDER_NAMES,
} from '../lib/secret-patterns.js';

// Pre-build non-global versions of KEY_PATTERNS for use in scanFileContent.
// Creating RegExp objects in a hot inner loop is expensive in CF Worker CPU budget.
const KEY_PATTERNS_LOCAL = KEY_PATTERNS.map(({ pattern, provider }) => ({
  pattern: new RegExp(pattern.source, pattern.flags.replace('g', '')),
  provider,
}));

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
  if (value.length <= 8) return '...XXXX';
  return value.slice(0, 8) + '...XXXX';
}

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
    if (line.length > 2000) continue;

    if (isEnvFile) {
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

    for (const { pattern, provider } of KEY_PATTERNS_LOCAL) {
      const match = line.match(pattern);
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

export async function handlePublicScan(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) {
    const allowed = await checkScanRateLimit(env, ip);
    if (!allowed) {
      return Response.json(
        { error: '10 free scans per hour — try again soon.' },
        { status: 429 }
      );
    }
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
      headers: { 'User-Agent': 'VaultProof-Scanner/1.0', Accept: 'application/vnd.github+json' },
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
        const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
        if (contentLength > 512 * 1024) return null; // skip files > 512 KB
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
