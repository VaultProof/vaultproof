/**
 * Scanner Routes — Scan GitHub repos for exposed API keys.
 *
 * Requires GitHub OAuth (separate from Supabase login).
 * Users connect GitHub, pick a repo, VaultProof scans via GitHub API.
 * Pro plan only.
 */

import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { encrypt, decrypt } from '../crypto/encryption.js';
import { randomBytes } from 'crypto';

// ─── Config ──────────────────────────────────────────────────────────────────

const GITHUB_CLIENT_ID = process.env.GITHUB_SCANNER_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_SCANNER_CLIENT_SECRET || '';
const GITHUB_REDIRECT_URI = process.env.GITHUB_SCANNER_REDIRECT_URI || 'https://vaultproof.dev/app/scanner?github_callback=1';

// ─── Key detection (synced with CLI patterns) ────────────────────────────────

const KEY_PREFIX_PATTERNS: Array<{ pattern: RegExp; provider: string }> = [
  // AI / LLM
  { pattern: /^sk-proj-/, provider: 'openai' },
  { pattern: /^sk-[a-zA-Z0-9]{40,}$/, provider: 'openai' },
  { pattern: /^sk-ant-/, provider: 'anthropic' },
  { pattern: /^tog_/, provider: 'together' },
  { pattern: /^gsk_[a-zA-Z0-9]{40,}$/, provider: 'groq' },
  { pattern: /^pplx-[a-zA-Z0-9]{40,}$/, provider: 'perplexity' },
  { pattern: /^r8_[a-zA-Z0-9]{30,}$/, provider: 'replicate' },
  { pattern: /^fw_[a-zA-Z0-9]{30,}$/, provider: 'fireworks' },
  // Payments
  { pattern: /^sk_live_/, provider: 'stripe' },
  { pattern: /^sk_test_/, provider: 'stripe' },
  { pattern: /^pk_live_/, provider: 'stripe' },
  { pattern: /^pk_test_/, provider: 'stripe' },
  { pattern: /^whsec_/, provider: 'stripe' },
  { pattern: /^rk_live_/, provider: 'stripe' },
  { pattern: /^rk_test_/, provider: 'stripe' },
  // Google
  { pattern: /^AIza[0-9A-Za-z_-]{35}$/, provider: 'google' },
  // AWS
  { pattern: /^AKIA[0-9A-Z]{16}$/, provider: 'aws' },
  { pattern: /^ASIA[0-9A-Z]{16}$/, provider: 'aws' },
  // Email
  { pattern: /^SG\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/, provider: 'sendgrid' },
  { pattern: /^re_[a-zA-Z0-9]{20,}$/, provider: 'resend' },
  { pattern: /^xkeysib-[a-zA-Z0-9]{40,}$/, provider: 'brevo' },
  // Messaging
  { pattern: /^xoxb-/, provider: 'slack' },
  { pattern: /^xoxp-/, provider: 'slack' },
  // GitHub
  { pattern: /^ghp_[a-zA-Z0-9]{36}$/, provider: 'github' },
  { pattern: /^ghs_[a-zA-Z0-9]{36}$/, provider: 'github' },
  { pattern: /^github_pat_/, provider: 'github' },
  // Supabase
  { pattern: /^eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\./, provider: 'supabase' },
  // Twilio
  { pattern: /^SK[a-f0-9]{32}$/, provider: 'twilio' },
  // npm
  { pattern: /^npm_[a-zA-Z0-9]{36}$/, provider: 'npm' },
  // Datadog
  { pattern: /^dd[a-z]_[a-zA-Z0-9]{32,}$/, provider: 'datadog' },
  // GraphQL / CMS / BaaS
  { pattern: /^service:[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+$/, provider: 'apollo' },
  { pattern: /^CFPAT-[a-zA-Z0-9_-]{40,}$/, provider: 'contentful' },
  { pattern: /^fnA[a-zA-Z0-9_-]{20,}$/, provider: 'fauna' },
  { pattern: /^phc_[a-zA-Z0-9]{30,}$/, provider: 'posthog' },
  { pattern: /^nk_[a-zA-Z0-9]{20,}$/, provider: 'neon' },
  { pattern: /^AX[a-zA-Z0-9]{30,}$/, provider: 'upstash' },
  // Databases
  { pattern: /^mongodb\+srv:\/\//, provider: 'mongodb' },
];

const PROXY_PROVIDERS = new Set([
  'openai', 'anthropic', 'google', 'together', 'mistral', 'cohere',
  'groq', 'perplexity', 'fireworks', 'deepseek', 'replicate',
]);

const ROTATION_URLS: Record<string, string> = {
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  stripe: 'https://dashboard.stripe.com/apikeys',
  google: 'https://console.cloud.google.com/apis/credentials',
  github: 'https://github.com/settings/tokens',
  aws: 'https://console.aws.amazon.com/iam/home#/security_credentials',
  sendgrid: 'https://app.sendgrid.com/settings/api_keys',
  resend: 'https://resend.com/api-keys',
  supabase: 'https://supabase.com/dashboard/project/_/settings/api',
  slack: 'https://api.slack.com/apps',
  twilio: 'https://console.twilio.com',
  datadog: 'https://app.datadoghq.com/organization-settings/api-keys',
  contentful: 'https://app.contentful.com/account/profile/cma_tokens',
  fauna: 'https://dashboard.fauna.com',
  posthog: 'https://app.posthog.com/project/settings',
};

const VERIFY_ENDPOINTS: Record<string, { url: string; headers: (key: string) => Record<string, string> }> = {
  openai:    { url: 'https://api.openai.com/v1/models', headers: (k) => ({ Authorization: `Bearer ${k}` }) },
  anthropic: { url: 'https://api.anthropic.com/v1/models', headers: (k) => ({ 'x-api-key': k, 'anthropic-version': '2023-06-01' }) },
  stripe:    { url: 'https://api.stripe.com/v1/balance', headers: (k) => ({ Authorization: `Bearer ${k}` }) },
  github:    { url: 'https://api.github.com/user', headers: (k) => ({ Authorization: `Bearer ${k}`, 'User-Agent': 'VaultProof-Scanner' }) },
  sendgrid:  { url: 'https://api.sendgrid.com/v3/scopes', headers: (k) => ({ Authorization: `Bearer ${k}` }) },
  resend:    { url: 'https://api.resend.com/api-keys', headers: (k) => ({ Authorization: `Bearer ${k}` }) },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function shannonEntropy(str: string): number {
  if (!str || str.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const ch of str) freq.set(ch, (freq.get(ch) || 0) + 1);
  let entropy = 0;
  const len = str.length;
  for (const count of freq.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function detectProvider(value: string): string | null {
  for (const { pattern, provider } of KEY_PREFIX_PATTERNS) {
    if (pattern.test(value)) return provider;
  }
  return null;
}

function recommendMode(provider: string): string {
  return PROXY_PROVIDERS.has(provider) ? 'proxy' : 'env-injection';
}

async function verifyKey(provider: string, value: string): Promise<string> {
  const endpoint = VERIFY_ENDPOINTS[provider];
  if (!endpoint) return 'unknown';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(endpoint.url, {
      method: 'GET',
      headers: endpoint.headers(value),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.status < 400 || res.status === 429) return 'active';
    if (res.status === 401 || res.status === 403) return 'revoked';
    return 'unknown';
  } catch {
    clearTimeout(timer);
    return 'unknown';
  }
}

async function githubApi(token: string, path: string): Promise<any> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'VaultProof-Scanner',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function githubApiRaw(token: string, method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'VaultProof-Scanner',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`GitHub API ${res.status}: ${errBody.slice(0, 200)}`);
  }
  return res.json();
}

async function auditLog(userId: string, action: string, scanId?: string, metadata?: Record<string, unknown>) {
  await prisma.scanAuditLog.create({
    data: { userId, action, scanId, metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined },
  }).catch(() => {});
}

function getGhToken(conn: { accessToken: string }): string {
  const decrypted = decrypt(Buffer.from(conn.accessToken, 'base64'));
  const token = decrypted.toString();
  if (!token || token.length < 10) throw new Error('Decrypted token is empty or too short');
  return token;
}

// ─── Scannable file filters ─────────────────────────────────────────────────

const SCAN_EXTENSIONS = new Set(['.ts', '.js', '.jsx', '.tsx', '.py', '.go', '.rb', '.java', '.php', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.next', '.nuxt', 'vendor', '__pycache__', 'coverage', '.output', '.turbo']);

function shouldScanFile(path: string): boolean {
  const parts = path.split('/');
  const basename = parts[parts.length - 1] || '';
  // .env files
  if (basename === '.env' || basename.startsWith('.env.')) return true;
  // Source files
  const ext = basename.includes('.') ? '.' + basename.split('.').pop() : '';
  if (!SCAN_EXTENSIONS.has(ext)) return false;
  // Skip known directories
  return !parts.some((p) => SKIP_DIRS.has(p));
}

// ─── Route definitions ───────────────────────────────────────────────────────

export async function scannerRoutes(app: FastifyInstance) {
  app.addHook('onRequest', requireAuth);

  // ─── GitHub OAuth ──────────────────────────────────────────────────

  app.get('/github/status', async (request) => {
    const userId = request.auth!.userId;
    const conn = await prisma.githubConnection.findFirst({
      where: { userId, disconnectedAt: null },
      select: { githubUsername: true, connectedAt: true, scopes: true },
    });
    return { connected: !!conn, ...(conn || {}) };
  });

  app.get('/github/connect', async (request, reply) => {
    const userId = request.auth!.userId;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { tier: true } });
    if (!user || !['pro', 'max', 'enterprise'].includes(user.tier)) {
      return reply.status(403).send({ error: 'Scanner requires a Pro plan. Upgrade at https://vaultproof.dev/app/settings' });
    }
    if (!GITHUB_CLIENT_ID) {
      return reply.status(503).send({ error: 'GitHub Scanner is not configured on this server' });
    }

    const nonce = randomBytes(32).toString('hex');
    const statePayload = Buffer.from(JSON.stringify({ userId, nonce })).toString('base64url');
    const url = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(GITHUB_REDIRECT_URI)}&scope=repo&state=${statePayload}`;
    return { url };
  });

  app.post('/github/callback', async (request, reply) => {
    const schema = z.object({
      code: z.string().min(1).max(256),
      state: z.string().min(1).max(1024),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid callback parameters' });

    const { code, state } = parsed.data;

    let stateData: { userId: string; nonce: string };
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
    } catch {
      return reply.status(400).send({ error: 'Invalid state parameter' });
    }

    if (stateData.userId !== request.auth!.userId) {
      return reply.status(403).send({ error: 'State mismatch' });
    }

    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: GITHUB_REDIRECT_URI,
      }),
    });
    const tokenData = await tokenRes.json() as { access_token?: string; scope?: string; error?: string };
    if (!tokenData.access_token) {
      return reply.status(400).send({ error: tokenData.error || 'GitHub OAuth failed' });
    }

    const ghUser = await githubApi(tokenData.access_token, '/user');
    const encryptedToken = encrypt(Buffer.from(tokenData.access_token)).toString('base64');

    // Disconnect existing connection
    await prisma.githubConnection.updateMany({
      where: { userId: request.auth!.userId, disconnectedAt: null },
      data: { disconnectedAt: new Date() },
    });

    await prisma.githubConnection.create({
      data: {
        userId: request.auth!.userId,
        githubUsername: ghUser.login,
        accessToken: encryptedToken,
        scopes: tokenData.scope || 'repo',
      },
    });

    await auditLog(request.auth!.userId, 'connected_github', undefined, { githubUsername: ghUser.login });
    return { connected: true, githubUsername: ghUser.login };
  });

  app.delete('/github/disconnect', async (request) => {
    const userId = request.auth!.userId;
    await prisma.githubConnection.updateMany({
      where: { userId, disconnectedAt: null },
      data: { disconnectedAt: new Date() },
    });
    await auditLog(userId, 'disconnected_github');
    return { connected: false };
  });

  // ─── Repos ─────────────────────────────────────────────────────────

  app.get('/repos', async (request, reply) => {
    const userId = request.auth!.userId;
    const conn = await prisma.githubConnection.findFirst({ where: { userId, disconnectedAt: null } });
    if (!conn) return reply.status(400).send({ error: 'GitHub not connected' });

    let ghToken: string;
    try {
      ghToken = getGhToken(conn);
    } catch {
      return reply.status(500).send({ error: 'Failed to decrypt GitHub token. Try disconnecting and reconnecting.' });
    }

    let repos: any[];
    try {
      repos = await githubApi(ghToken, '/user/repos?per_page=100&sort=updated&type=owner');
    } catch {
      return reply.status(502).send({ error: 'Failed to fetch repos from GitHub. Your token may have expired — try reconnecting.' });
    }

    return {
      repos: (repos as any[]).map((r: any) => ({
        fullName: r.full_name,
        name: r.name,
        private: r.private,
        defaultBranch: r.default_branch,
        updatedAt: r.updated_at,
      })),
    };
  });

  // ─── Scan ──────────────────────────────────────────────────────────

  app.post('/scan', async (request, reply) => {
    const schema = z.object({
      repoFullName: z.string().min(1).max(200).regex(/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/),
      branch: z.string().max(200).optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid input' });

    const userId = request.auth!.userId;
    const { repoFullName, branch } = parsed.data;

    const conn = await prisma.githubConnection.findFirst({ where: { userId, disconnectedAt: null } });
    if (!conn) return reply.status(400).send({ error: 'GitHub not connected' });
    const ghToken = getGhToken(conn);

    const scan = await prisma.scanResult.create({
      data: { userId, repoFullName, branch: branch || 'default', status: 'in_progress' },
    });
    await auditLog(userId, 'started_scan', scan.id, { repoFullName });

    try {
      const repo = await githubApi(ghToken, `/repos/${repoFullName}`);
      const targetBranch = branch || repo.default_branch;
      await prisma.scanResult.update({ where: { id: scan.id }, data: { branch: targetBranch } });

      // Get file tree
      const tree = await githubApi(ghToken, `/repos/${repoFullName}/git/trees/${targetBranch}?recursive=1`);
      const files = (tree.tree as any[]).filter((f: any) => f.type === 'blob' && shouldScanFile(f.path));

      // Internal findings (value kept in memory, never stored)
      const findings: Array<{
        envName: string; provider: string; file: string; line: number | null;
        mode: string; verified: string; source: string; maskedValue: string;
        value: string;
      }> = [];
      const seenValues = new Set<string>();

      // Scan files (max 200)
      for (const file of files.slice(0, 200)) {
        let content: string;
        try {
          const blob = await githubApi(ghToken, `/repos/${repoFullName}/git/blobs/${file.sha}`);
          content = Buffer.from(blob.content, 'base64').toString('utf-8');
        } catch { continue; }
        if (content.length > 500_000) continue;

        const basename = (file.path as string).split('/').pop() || '';
        const isEnvFile = basename === '.env' || basename.startsWith('.env.');

        if (isEnvFile) {
          for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx === -1) continue;
            const name = trimmed.slice(0, eqIdx).trim();
            let value = trimmed.slice(eqIdx + 1).trim();
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
              value = value.slice(1, -1);
            }
            if (!value || value.length < 10 || seenValues.has(value)) continue;

            const provider = detectProvider(value);
            if (!provider && shannonEntropy(value) < 3.5) continue;

            seenValues.add(value);
            findings.push({
              envName: name,
              provider: provider || 'unknown',
              file: file.path,
              line: null,
              mode: provider ? recommendMode(provider) : 'env-injection',
              verified: 'unknown',
              source: 'current',
              maskedValue: value.slice(0, 6) + '...' + value.slice(-4),
              value,
            });
          }
        } else {
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const stringMatches = lines[i].matchAll(/["'`]([^"'`]{10,512})["'`]/g);
            for (const m of stringMatches) {
              const val = m[1];
              if (seenValues.has(val)) continue;
              const provider = detectProvider(val);
              if (!provider) continue;
              seenValues.add(val);
              findings.push({
                envName: `${provider.toUpperCase()}_API_KEY`,
                provider,
                file: file.path,
                line: i + 1,
                mode: recommendMode(provider),
                verified: 'unknown',
                source: 'current',
                maskedValue: val.slice(0, 6) + '...' + val.slice(-4),
                value: val,
              });
            }
          }
        }
      }

      // Scan git history (last 30 commits)
      try {
        const commits = await githubApi(ghToken, `/repos/${repoFullName}/commits?sha=${targetBranch}&per_page=30`);
        for (const commit of (commits as any[]).slice(0, 30)) {
          let detail: any;
          try { detail = await githubApi(ghToken, `/repos/${repoFullName}/commits/${commit.sha}`); } catch { continue; }
          for (const file of (detail.files || [])) {
            if (!file.patch) continue;
            for (const line of (file.patch as string).split('\n')) {
              if (!line.startsWith('-') || line.startsWith('---')) continue;
              const content = line.slice(1);
              const matches = content.matchAll(/["'`=]([^"'`\s]{10,512})/g);
              for (const m of matches) {
                const val = m[1];
                if (seenValues.has(val)) continue;
                const provider = detectProvider(val);
                if (!provider) continue;
                seenValues.add(val);
                findings.push({
                  envName: `${provider.toUpperCase()}_API_KEY`,
                  provider,
                  file: `${file.filename} (deleted)`,
                  line: null,
                  mode: recommendMode(provider),
                  verified: 'unknown',
                  source: 'git-history',
                  maskedValue: val.slice(0, 6) + '...' + val.slice(-4),
                  value: val,
                });
              }
            }
          }
        }
      } catch {
        // Git history scan failed — continue
      }

      // Verify keys (max 20)
      for (let i = 0; i < Math.min(findings.length, 20); i += 5) {
        const batch = findings.slice(i, i + 5);
        await Promise.all(batch.map(async (f) => {
          f.verified = await verifyKey(f.provider, f.value);
        }));
      }

      // Store findings in a transaction (no raw values stored)
      const dbFindings = await prisma.$transaction(
        findings.map((f) =>
          prisma.scanFinding.create({
            data: {
              scanId: scan.id,
              envName: f.envName,
              provider: f.provider,
              file: f.file,
              line: f.line,
              mode: f.mode,
              verified: f.verified,
              source: f.source,
              action: 'pending',
              maskedValue: f.maskedValue,
            },
          })
        )
      );

      const keysActive = findings.filter((f) => f.verified === 'active').length;
      const keysRevoked = findings.filter((f) => f.verified === 'revoked').length;

      await prisma.scanResult.update({
        where: { id: scan.id },
        data: { status: 'completed', completedAt: new Date(), keysFound: findings.length, keysActive, keysRevoked },
      });
      await auditLog(userId, 'completed_scan', scan.id, { keysFound: findings.length, keysActive, keysRevoked });

      return {
        scanId: scan.id,
        status: 'completed',
        keysFound: findings.length,
        keysActive,
        keysRevoked,
        findings: dbFindings.map((f) => ({
          id: f.id, envName: f.envName, provider: f.provider, file: f.file, line: f.line,
          mode: f.mode, verified: f.verified, source: f.source, maskedValue: f.maskedValue,
          rotationUrl: ROTATION_URLS[f.provider] || null,
        })),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      await prisma.scanResult.update({
        where: { id: scan.id },
        data: { status: 'failed', completedAt: new Date(), errorMessage: message },
      });
      await auditLog(userId, 'failed_scan', scan.id, { error: message });
      request.log.error({ msg: 'Scan failed', scanId: scan.id, error: message });
      return reply.status(500).send({ error: 'Scan failed. Please try again or check your GitHub connection.' });
    }
  });

  // ─── Scan history ──────────────────────────────────────────────────

  app.get('/scans', async (request) => {
    const userId = request.auth!.userId;
    const scans = await prisma.scanResult.findMany({
      where: { userId },
      orderBy: { startedAt: 'desc' },
      take: 50,
      select: {
        id: true, repoFullName: true, branch: true,
        keysFound: true, keysActive: true, keysRevoked: true,
        status: true, startedAt: true, completedAt: true,
      },
    });
    return { scans };
  });

  app.get('/scans/:scanId', async (request, reply) => {
    const { scanId } = request.params as { scanId: string };
    const userId = request.auth!.userId;
    const scan = await prisma.scanResult.findUnique({
      where: { id: scanId },
      include: { findings: true },
    });
    if (!scan || scan.userId !== userId) {
      return reply.status(404).send({ error: 'Scan not found' });
    }
    return {
      ...scan,
      findings: scan.findings.map((f) => ({
        ...f,
        rotationUrl: ROTATION_URLS[f.provider] || null,
      })),
    };
  });

  // ─── Finding actions ───────────────────────────────────────────────

  app.post('/findings/:findingId/ignore', async (request, reply) => {
    const { findingId } = request.params as { findingId: string };
    const userId = request.auth!.userId;
    const finding = await prisma.scanFinding.findUnique({
      where: { id: findingId },
      include: { scan: { select: { userId: true } } },
    });
    if (!finding || finding.scan.userId !== userId) {
      return reply.status(404).send({ error: 'Finding not found' });
    }
    await prisma.scanFinding.update({ where: { id: findingId }, data: { action: 'ignored' } });
    await auditLog(userId, 'ignored_key', finding.scanId, { envName: finding.envName });
    return { success: true };
  });

  // ─── Create PR ─────────────────────────────────────────────────────

  app.post('/scans/:scanId/create-pr', async (request, reply) => {
    const { scanId } = request.params as { scanId: string };
    const userId = request.auth!.userId;

    const schema = z.object({
      findings: z.array(z.object({
        findingId: z.string(),
        action: z.enum(['vaultproof', 'todo']),
      })),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid input' });

    const scan = await prisma.scanResult.findUnique({
      where: { id: scanId },
      include: { findings: true },
    });
    if (!scan || scan.userId !== userId) {
      return reply.status(404).send({ error: 'Scan not found' });
    }

    const conn = await prisma.githubConnection.findFirst({ where: { userId, disconnectedAt: null } });
    if (!conn) return reply.status(400).send({ error: 'GitHub not connected' });
    const ghToken = getGhToken(conn);

    // Get default branch SHA
    const repo = await githubApi(ghToken, `/repos/${scan.repoFullName}`);
    const defaultBranch = repo.default_branch;
    const ref = await githubApi(ghToken, `/repos/${scan.repoFullName}/git/refs/heads/${defaultBranch}`);
    const baseSha = ref.object.sha;

    // Create branch
    const branchName = `vaultproof/scan-${Date.now()}`;
    await githubApiRaw(ghToken, 'POST', `/repos/${scan.repoFullName}/git/refs`, {
      ref: `refs/heads/${branchName}`,
      sha: baseSha,
    });

    // Apply changes
    const changedFiles = new Map<string, string>();
    const processedFindings: Array<{ envName: string; file: string; line: number | null }> = [];

    for (const fa of parsed.data.findings) {
      const finding = scan.findings.find((f) => f.id === fa.findingId);
      if (!finding || finding.source === 'git-history') continue;

      if (!changedFiles.has(finding.file)) {
        try {
          const fileData = await githubApi(ghToken, `/repos/${scan.repoFullName}/contents/${finding.file}?ref=${defaultBranch}`);
          changedFiles.set(finding.file, Buffer.from(fileData.content, 'base64').toString('utf-8'));
        } catch { continue; }
      }

      let content = changedFiles.get(finding.file)!;
      const replacement = fa.action === 'vaultproof'
        ? `process.env.${finding.envName}`
        : `process.env.${finding.envName} /* TODO: Set ${finding.envName} in your environment */`;

      if (finding.line) {
        const lines = content.split('\n');
        const lineIdx = finding.line - 1;
        if (lineIdx < lines.length) {
          lines[lineIdx] = lines[lineIdx].replace(/["'`][^"'`]{10,512}["'`]/g, replacement);
          content = lines.join('\n');
        }
      }

      changedFiles.set(finding.file, content);
      processedFindings.push({ envName: finding.envName, file: finding.file, line: finding.line });
    }

    if (changedFiles.size === 0) {
      return reply.status(400).send({ error: 'No changes to apply' });
    }

    // Create tree + commit
    const treeItems = [];
    for (const [path, content] of changedFiles) {
      const blob = await githubApiRaw(ghToken, 'POST', `/repos/${scan.repoFullName}/git/blobs`, {
        content,
        encoding: 'utf-8',
      });
      treeItems.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
    }

    const newTree = await githubApiRaw(ghToken, 'POST', `/repos/${scan.repoFullName}/git/trees`, {
      base_tree: baseSha,
      tree: treeItems,
    });

    const commit = await githubApiRaw(ghToken, 'POST', `/repos/${scan.repoFullName}/git/commits`, {
      message: 'fix: remove exposed API keys (VaultProof Scanner)',
      tree: newTree.sha,
      parents: [baseSha],
    });

    await githubApiRaw(ghToken, 'PATCH', `/repos/${scan.repoFullName}/git/refs/heads/${branchName}`, {
      sha: commit.sha,
    });

    // Build PR body
    const historyFindings = scan.findings.filter((f) => f.source === 'git-history');
    const historyWarning = historyFindings.length > 0
      ? `\n## Git History Warning\n\nThe following keys were also found in git commit history. Removing them from source code does not remove them from history.\n\n**Action required — rotate these keys immediately:**\n${historyFindings.map((f) => `- \`${f.envName}\` (${f.maskedValue}) — [Rotate](${ROTATION_URLS[f.provider] || '#'})`).join('\n')}\n`
      : '';

    const prBody = `## Removed Exposed Keys

This PR removes hardcoded API keys found by [VaultProof Scanner](https://vaultproof.dev).

| Key | File | Action |
|-----|------|--------|
${processedFindings.map((pf) => `| \`${pf.envName}\` | ${pf.file}${pf.line ? `:${pf.line}` : ''} | Replaced with \`process.env.${pf.envName}\` |`).join('\n')}
${historyWarning}
## Setup

Set these environment variables in your hosting provider:
${[...new Set(processedFindings.map((pf) => pf.envName))].map((name) => `- \`${name}\``).join('\n')}

---
*This PR was created by VaultProof Scanner with your approval.*
*VaultProof is not responsible for code modifications you approve and merge.*`;

    const pr = await githubApiRaw(ghToken, 'POST', `/repos/${scan.repoFullName}/pulls`, {
      title: 'fix: remove exposed API keys (VaultProof Scanner)',
      body: prBody,
      head: branchName,
      base: defaultBranch,
    });

    // Update findings
    for (const fa of parsed.data.findings) {
      await prisma.scanFinding.update({
        where: { id: fa.findingId },
        data: { action: 'pr-created', prUrl: pr.html_url },
      });
    }

    await auditLog(userId, 'created_pr', scanId, {
      prUrl: pr.html_url,
      prNumber: pr.number,
      findingsCount: processedFindings.length,
    });

    return { prUrl: pr.html_url, prNumber: pr.number };
  });
}
