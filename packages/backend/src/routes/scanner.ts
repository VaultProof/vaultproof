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
import { encryptShare2 } from '../crypto/share2-encryption.js';
import { splitString, serializeShare } from '@vaultproof/shamir';
import { randomBytes, createHash } from 'crypto';

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

// ─── Code-level detection (SDK inits, HTTP URLs, env var refs) ──────────────

const PROVIDER_URLS: Record<string, string> = {
  'api.openai.com': 'openai',
  'api.anthropic.com': 'anthropic',
  'generativelanguage.googleapis.com': 'google',
  'api.together.xyz': 'together',
  'api.mistral.ai': 'mistral',
  'api.cohere.ai': 'cohere',
  'api.groq.com': 'groq',
  'api.perplexity.ai': 'perplexity',
  'api.fireworks.ai': 'fireworks',
  'api.deepseek.com': 'deepseek',
  'api.replicate.com': 'replicate',
};

const SDK_INIT_PATTERNS: Array<{ regex: RegExp; provider: string }> = [
  { regex: /new\s+OpenAI\s*\(/g, provider: 'openai' },
  { regex: /new\s+Anthropic\s*\(/g, provider: 'anthropic' },
  { regex: /new\s+GoogleGenerativeAI\s*\(/g, provider: 'google' },
  { regex: /OpenAI\s*\(\s*(?:api_key|$)/g, provider: 'openai' },
  { regex: /Anthropic\s*\(\s*(?:api_key|$)/g, provider: 'anthropic' },
  { regex: /genai\.configure\s*\(/g, provider: 'google' },
];

const ENV_VAR_PATTERNS: Record<string, string> = {
  'OPENAI_API_KEY': 'openai',
  'ANTHROPIC_API_KEY': 'anthropic',
  'GOOGLE_API_KEY': 'google',
  'TOGETHER_API_KEY': 'together',
  'MISTRAL_API_KEY': 'mistral',
  'COHERE_API_KEY': 'cohere',
  'GROQ_API_KEY': 'groq',
  'PERPLEXITY_API_KEY': 'perplexity',
  'FIREWORKS_API_KEY': 'fireworks',
  'DEEPSEEK_API_KEY': 'deepseek',
  'REPLICATE_API_TOKEN': 'replicate',
};

// Pre-built regexes for code-level detection
const HTTP_URL_REGEX = new RegExp(
  `https?://(${Object.keys(PROVIDER_URLS).map(u => u.replace(/\./g, '\\.')).join('|')})(/[^\\s"'\`]*)`,
  'g'
);

const ENV_VAR_NAMES = Object.keys(ENV_VAR_PATTERNS);
const PROCESS_ENV_REGEX = new RegExp(
  `process\\.env\\.(${ENV_VAR_NAMES.join('|')})`,
  'g'
);
const OS_ENVIRON_REGEX = new RegExp(
  `os\\.environ\\[["'](${ENV_VAR_NAMES.join('|')})["']\\]`,
  'g'
);

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

const PROVIDER_INFO: Record<string, { name: string; desc: string; risk: string; steps: string[] }> = {
  openai: { name: 'OpenAI', desc: 'AI language models (GPT-4, DALL-E, Whisper)', risk: 'Anyone with this key can make API calls charged to your account', steps: ['Go to https://platform.openai.com/api-keys', 'Create a new secret key', 'Delete the old key', 'Update your .env'] },
  anthropic: { name: 'Anthropic', desc: 'Claude AI models', risk: 'Anyone with this key can make Claude API calls charged to your account', steps: ['Go to https://console.anthropic.com/settings/keys', 'Create a new API key', 'Delete the old key', 'Update your .env'] },
  stripe: { name: 'Stripe', desc: 'Payment processing', risk: 'A live key can create charges, issue refunds, and access customer data', steps: ['Go to https://dashboard.stripe.com/apikeys', "Click 'Roll key' next to the compromised key", 'Update your .env and hosting env vars'] },
  google: { name: 'Google / Firebase', desc: 'Google Cloud APIs, Firebase, Maps', risk: 'Could access cloud resources or incur charges depending on enabled APIs', steps: ['Go to https://console.cloud.google.com/apis/credentials', 'Delete the old key and create a new one', 'Update your .env'] },
  aws: { name: 'AWS', desc: 'Amazon Web Services', risk: 'Full access depending on IAM permissions — can incur massive charges', steps: ['Go to https://console.aws.amazon.com/iam', 'Deactivate the old access key', 'Create a new access key pair', 'Update all environments'] },
  github: { name: 'GitHub', desc: 'Code repos, Actions, Packages', risk: 'Can read/write repos, trigger workflows, access org data', steps: ['Go to https://github.com/settings/tokens', 'Delete the token', 'Generate a new one with minimal scopes', 'Update your .env and CI secrets'] },
  supabase: { name: 'Supabase', desc: 'Database, Auth, Storage', risk: 'Service role key bypasses RLS and has full database access', steps: ['Go to Supabase Dashboard > Settings > API', 'Keys cannot be rotated without recreating the project', 'Restrict database access immediately if service key is exposed'] },
  sendgrid: { name: 'SendGrid', desc: 'Email delivery', risk: 'Can send emails from your domain — potential for phishing', steps: ['Go to https://app.sendgrid.com/settings/api_keys', 'Delete the old key', 'Create a new one', 'Update your .env'] },
  resend: { name: 'Resend', desc: 'Email API', risk: 'Can send emails from your verified domains', steps: ['Go to https://resend.com/api-keys', 'Delete the old key', 'Create a new one', 'Update your .env'] },
  slack: { name: 'Slack', desc: 'Team messaging', risk: 'Can post messages, read channels, access workspace data', steps: ['Go to https://api.slack.com/apps', 'Reinstall the app to generate new tokens', 'Update your .env'] },
  twilio: { name: 'Twilio', desc: 'SMS and voice', risk: 'Can send SMS/calls charged to your account', steps: ['Go to https://console.twilio.com', 'Rotate your Auth Token', 'Update your .env'] },
  datadog: { name: 'Datadog', desc: 'Monitoring', risk: 'Can access metrics, logs, and traces', steps: ['Go to https://app.datadoghq.com/organization-settings/api-keys', 'Revoke and recreate', 'Update your .env'] },
  contentful: { name: 'Contentful', desc: 'Headless CMS', risk: 'Can read/write content and manage spaces', steps: ['Go to https://app.contentful.com/account/profile/cma_tokens', 'Revoke and recreate', 'Update your .env'] },
  fauna: { name: 'FaunaDB', desc: 'Serverless database', risk: 'Can read/write data depending on key permissions', steps: ['Go to https://dashboard.fauna.com > Security > Keys', 'Delete and recreate', 'Update your .env'] },
  posthog: { name: 'PostHog', desc: 'Product analytics', risk: 'Can access analytics events and user data', steps: ['Go to https://app.posthog.com/project/settings', 'Rotate your project API key', 'Update your .env'] },
};

// ─── Hosting platform detection ─────────────────────────────────────────────

const PLATFORM_FILES: Record<string, string> = {
  'vercel.json': 'Vercel',
  '.vercel/project.json': 'Vercel',
  'railway.toml': 'Railway',
  'railway.json': 'Railway',
  'fly.toml': 'Fly.io',
  'render.yaml': 'Render',
  'netlify.toml': 'Netlify',
  'Dockerfile': 'Docker',
  'docker-compose.yml': 'Docker Compose',
  'docker-compose.yaml': 'Docker Compose',
  'heroku.yml': 'Heroku',
  'Procfile': 'Heroku',
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

      // Detect hosting platforms from repo config files
      const allPaths = (tree.tree as any[]).map((f: any) => f.path as string);
      const platformSet = new Set<string>();
      for (const filePath of allPaths) {
        const platform = PLATFORM_FILES[filePath];
        if (platform) platformSet.add(platform);
        if (filePath.startsWith('.github/workflows/')) platformSet.add('GitHub Actions');
      }
      const platforms = [...platformSet];

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

          // ── Code-level detection: SDK inits, HTTP URLs, env var refs ──
          for (let i = 0; i < lines.length; i++) {
            const ln = lines[i];

            // SDK init detection
            for (const { regex, provider } of SDK_INIT_PATTERNS) {
              regex.lastIndex = 0;
              let sdkMatch: RegExpExecArray | null;
              while ((sdkMatch = regex.exec(ln)) !== null) {
                const snippet = ln.slice(sdkMatch.index, sdkMatch.index + 40).trim();
                findings.push({
                  envName: `${provider.toUpperCase()}_API_KEY`,
                  provider,
                  file: file.path,
                  line: i + 1,
                  mode: 'sdk-init',
                  verified: 'unknown',
                  source: 'current',
                  maskedValue: snippet.length > 36 ? snippet.slice(0, 36) + '...' : snippet,
                  value: '',
                });
              }
            }

            // HTTP URL detection
            HTTP_URL_REGEX.lastIndex = 0;
            let urlMatch: RegExpExecArray | null;
            while ((urlMatch = HTTP_URL_REGEX.exec(ln)) !== null) {
              const host = urlMatch[1];
              const provider = PROVIDER_URLS[host];
              if (!provider) continue;
              const url = urlMatch[0].length > 60 ? urlMatch[0].slice(0, 60) + '...' : urlMatch[0];
              findings.push({
                envName: `${provider.toUpperCase()}_API_KEY`,
                provider,
                file: file.path,
                line: i + 1,
                mode: 'http-url',
                verified: 'unknown',
                source: 'current',
                maskedValue: url,
                value: '',
              });
            }

            // Env var reference detection (process.env.X / os.environ["X"])
            PROCESS_ENV_REGEX.lastIndex = 0;
            let envMatch: RegExpExecArray | null;
            while ((envMatch = PROCESS_ENV_REGEX.exec(ln)) !== null) {
              const varName = envMatch[1];
              const provider = ENV_VAR_PATTERNS[varName];
              if (!provider) continue;
              findings.push({
                envName: varName,
                provider,
                file: file.path,
                line: i + 1,
                mode: 'env-ref',
                verified: 'unknown',
                source: 'current',
                maskedValue: `process.env.${varName}`,
                value: '',
              });
            }

            OS_ENVIRON_REGEX.lastIndex = 0;
            while ((envMatch = OS_ENVIRON_REGEX.exec(ln)) !== null) {
              const varName = envMatch[1];
              const provider = ENV_VAR_PATTERNS[varName];
              if (!provider) continue;
              findings.push({
                envName: varName,
                provider,
                file: file.path,
                line: i + 1,
                mode: 'env-ref',
                verified: 'unknown',
                source: 'current',
                maskedValue: `os.environ["${varName}"]`,
                value: '',
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

      // Verify keys (max 20) — skip code-level findings (no actual key value)
      const CODE_LEVEL_MODES = new Set(['sdk-init', 'http-url', 'env-ref']);
      const keyFindings = findings.filter((f) => !CODE_LEVEL_MODES.has(f.mode));
      for (let i = 0; i < Math.min(keyFindings.length, 20); i += 5) {
        const batch = keyFindings.slice(i, i + 5);
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

      const keysActive = keyFindings.filter((f) => f.verified === 'active').length;
      const keysRevoked = keyFindings.filter((f) => f.verified === 'revoked').length;
      const keysFound = keyFindings.length;

      await prisma.scanResult.update({
        where: { id: scan.id },
        data: { status: 'completed', completedAt: new Date(), keysFound, keysActive, keysRevoked, platforms },
      });
      await auditLog(userId, 'completed_scan', scan.id, { keysFound, keysActive, keysRevoked });

      return {
        scanId: scan.id,
        status: 'completed',
        keysFound,
        keysActive,
        keysRevoked,
        platforms,
        findings: dbFindings.map((f) => ({
          id: f.id, envName: f.envName, provider: f.provider, file: f.file, line: f.line,
          mode: f.mode, verified: f.verified, source: f.source, maskedValue: f.maskedValue,
          rotationUrl: ROTATION_URLS[f.provider] || null,
          providerInfo: PROVIDER_INFO[f.provider] || null,
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
          providerInfo: PROVIDER_INFO[f.provider] || null,
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
    const processedFindings: Array<{ envName: string; file: string; line: number | null; action: string }> = [];

    // Build reverse map: provider domain → provider name (for URL rewriting)
    const DOMAIN_TO_PROVIDER = PROVIDER_URLS; // already domain→provider

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
      const isEnvFile = finding.file.endsWith('.env') || finding.file.includes('.env.');

      if (finding.mode === 'sdk-init' && fa.action === 'vaultproof') {
        // ── SDK init rewriting ──────────────────────────────────────
        // Inject baseURL and swap apiKey to VAULTPROOF_API_KEY
        const proxyBase = `https://api.vaultproof.dev/v1/${finding.provider}`;

        // Match the SDK constructor block on the target line(s)
        // e.g. new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
        // →    new OpenAI({ apiKey: process.env.VAULTPROOF_API_KEY, baseURL: 'https://api.vaultproof.dev/v1/openai' })
        if (finding.line) {
          const lines = content.split('\n');
          const lineIdx = finding.line - 1;

          // Find the extent of the constructor call (may span multiple lines)
          let blockStart = lineIdx;
          let blockEnd = lineIdx;
          let depth = 0;
          let foundOpen = false;
          for (let i = lineIdx; i < lines.length && i < lineIdx + 20; i++) {
            for (const ch of lines[i]) {
              if (ch === '(') { depth++; foundOpen = true; }
              if (ch === ')') { depth--; }
              if (foundOpen && depth === 0) { blockEnd = i; break; }
            }
            if (foundOpen && depth === 0) break;
          }

          // Extract the constructor block as a string
          const blockLines = lines.slice(blockStart, blockEnd + 1);
          let block = blockLines.join('\n');

          // Replace provider-specific env vars with VAULTPROOF_API_KEY
          // Check both standard _API_KEY and any known alternate names (e.g. REPLICATE_API_TOKEN)
          const providerEnvVars = [`${finding.provider.toUpperCase()}_API_KEY`];
          for (const [envName, prov] of Object.entries(ENV_VAR_PATTERNS)) {
            if (prov === finding.provider && !providerEnvVars.includes(envName)) {
              providerEnvVars.push(envName);
            }
          }
          for (const envVar of providerEnvVars) {
            block = block.replace(
              new RegExp(`process\\.env\\.${envVar}`, 'g'),
              'process.env.VAULTPROOF_API_KEY'
            );
            block = block.replace(
              new RegExp(`os\\.environ\\[["']${envVar}["']\\]`, 'g'),
              'os.environ["VAULTPROOF_API_KEY"]'
            );
          }

          // Inject baseURL if not already present
          if (!block.includes('baseURL') && !block.includes('base_url')) {
            // JS/TS pattern: find the opening { of the constructor options
            const braceMatch = block.match(/new\s+\w+\s*\(\s*\{/);
            if (braceMatch && braceMatch.index !== undefined) {
              // Check if the block has existing properties
              const afterBrace = block.slice(braceMatch.index + braceMatch[0].length);
              if (afterBrace.trim().startsWith('}')) {
                // Empty options: new OpenAI({})
                block = block.replace(
                  /new\s+(\w+)\s*\(\s*\{\s*\}/,
                  `new $1({ baseURL: '${proxyBase}' }`
                );
              } else {
                // Has properties: inject baseURL after opening brace
                block = block.replace(
                  /(new\s+\w+\s*\(\s*\{)/,
                  `$1 baseURL: '${proxyBase}',`
                );
              }
            } else {
              // Python pattern: Client(api_key=...) → inject base_url
              const pyMatch = block.match(/\(\s*api_key\s*=/);
              if (pyMatch && pyMatch.index !== undefined) {
                block = block.replace(
                  /\(\s*(api_key\s*=)/,
                  `(base_url="${proxyBase}", $1`
                );
              }
            }
          }

          // Replace block lines with the rewritten block
          const newBlockLines = block.split('\n');
          lines.splice(blockStart, blockEnd - blockStart + 1, ...newBlockLines);
          content = lines.join('\n');
        }

        changedFiles.set(finding.file, content);
        processedFindings.push({ envName: finding.envName, file: finding.file, line: finding.line, action: 'sdk-init → proxy' });

      } else if (finding.mode === 'http-url' && fa.action === 'vaultproof') {
        // ── HTTP URL rewriting ──────────────────────────────────────
        // Replace provider domains with VaultProof proxy
        // e.g. https://api.openai.com/v1/chat/completions
        //    → https://api.vaultproof.dev/v1/openai/v1/chat/completions
        if (finding.line) {
          const lines = content.split('\n');
          const lineIdx = finding.line - 1;
          if (lineIdx < lines.length) {
            for (const [domain, provider] of Object.entries(DOMAIN_TO_PROVIDER)) {
              const domainRegex = new RegExp(`https?://${domain.replace(/\./g, '\\.')}`, 'g');
              lines[lineIdx] = lines[lineIdx].replace(domainRegex, `https://api.vaultproof.dev/v1/${provider}`);
            }
            content = lines.join('\n');
          }
        }

        changedFiles.set(finding.file, content);
        processedFindings.push({ envName: finding.envName, file: finding.file, line: finding.line, action: 'url → proxy' });

      } else if (finding.mode === 'env-ref' && fa.action === 'vaultproof') {
        // ── Env var reference rewriting ──────────────────────────────
        // Replace provider env var names with VAULTPROOF_API_KEY
        if (finding.line) {
          const lines = content.split('\n');
          const lineIdx = finding.line - 1;
          if (lineIdx < lines.length) {
            // process.env.OPENAI_API_KEY → process.env.VAULTPROOF_API_KEY
            lines[lineIdx] = lines[lineIdx].replace(
              new RegExp(`process\\.env\\.${finding.envName}`, 'g'),
              'process.env.VAULTPROOF_API_KEY'
            );
            // os.environ["OPENAI_API_KEY"] → os.environ["VAULTPROOF_API_KEY"]
            lines[lineIdx] = lines[lineIdx].replace(
              new RegExp(`os\\.environ\\[["']${finding.envName}["']\\]`, 'g'),
              'os.environ["VAULTPROOF_API_KEY"]'
            );
            content = lines.join('\n');
          }
        }

        changedFiles.set(finding.file, content);
        processedFindings.push({ envName: finding.envName, file: finding.file, line: finding.line, action: 'env → VAULTPROOF_API_KEY' });

      } else if (isEnvFile && fa.action === 'vaultproof') {
        // ── .env file rewriting ─────────────────────────────────────
        // Comment out old key line and add VAULTPROOF_API_KEY placeholder
        const lines = content.split('\n');
        let alreadyHasVaultproof = lines.some((l) => l.trim().startsWith('VAULTPROOF_API_KEY='));

        for (let i = 0; i < lines.length; i++) {
          const trimmed = lines[i].trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx === -1) continue;
          const varName = trimmed.slice(0, eqIdx).trim();
          if (varName === finding.envName) {
            lines[i] = `# ${varName} — secured by VaultProof proxy`;
            break;
          }
        }

        if (!alreadyHasVaultproof) {
          lines.push('VAULTPROOF_API_KEY=vp_live_xxx');
        }

        content = lines.join('\n');
        changedFiles.set(finding.file, content);
        processedFindings.push({ envName: finding.envName, file: finding.file, line: finding.line, action: 'env-file → proxy' });

      } else {
        // ── Original hardcoded key replacement (proxy / env-injection) ─
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
        processedFindings.push({ envName: finding.envName, file: finding.file, line: finding.line, action: fa.action });
      }
    }

    if (changedFiles.size === 0) {
      return reply.status(400).send({ error: 'No changes to apply' });
    }

    // Determine if any proxy rewrites were applied (used for commit message + PR body)
    const PROXY_ACTIONS = new Set(['sdk-init → proxy', 'url → proxy', 'env → VAULTPROOF_API_KEY', 'env-file → proxy']);
    const hasProxyFindings = processedFindings.some((pf) => PROXY_ACTIONS.has(pf.action));

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
      message: hasProxyFindings
        ? 'fix: secure API keys via VaultProof proxy (VaultProof Scanner)'
        : 'fix: remove exposed API keys (VaultProof Scanner)',
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

    const prBody = `## Secured API Keys with VaultProof

This PR secures API keys found by [VaultProof Scanner](https://vaultproof.dev).${hasProxyFindings ? ' SDK initializations, HTTP URLs, and environment variable references have been rewritten to use the VaultProof transparent proxy.' : ''}

| Key | File | Action |
|-----|------|--------|
${processedFindings.map((pf) => {
      const desc = pf.action === 'sdk-init → proxy' ? 'Rewritten to use VaultProof proxy'
        : pf.action === 'url → proxy' ? 'URL redirected through VaultProof proxy'
        : pf.action === 'env → VAULTPROOF_API_KEY' ? 'Replaced with `VAULTPROOF_API_KEY`'
        : pf.action === 'env-file → proxy' ? 'Commented out, added `VAULTPROOF_API_KEY`'
        : `Replaced with \`process.env.${pf.envName}\``;
      return `| \`${pf.envName}\` | ${pf.file}${pf.line ? `:${pf.line}` : ''} | ${desc} |`;
    }).join('\n')}
${historyWarning}
## Setup

${hasProxyFindings ? `1. Add your VaultProof API key to your hosting provider:\n   - \`VAULTPROOF_API_KEY\` — get this from [VaultProof Dashboard](https://vaultproof.dev/app/keys)\n\n2. ` : ''}Set these environment variables in your hosting provider:
${[...new Set(processedFindings.map((pf) => pf.envName))].filter((n) => n !== 'VAULTPROOF_API_KEY').map((name) => `- \`${name}\``).join('\n')}

---
*This PR was created by VaultProof Scanner with your approval.*
*VaultProof is not responsible for code modifications you approve and merge.*`;

    const pr = await githubApiRaw(ghToken, 'POST', `/repos/${scan.repoFullName}/pulls`, {
      title: hasProxyFindings
        ? 'fix: secure API keys via VaultProof proxy (VaultProof Scanner)'
        : 'fix: remove exposed API keys (VaultProof Scanner)',
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

  // ─── Migrate (guided migration: store keys + create dev key + create PR) ──

  app.post('/scans/:scanId/migrate', async (request, reply) => {
    const { scanId } = request.params as { scanId: string };
    const userId = request.auth!.userId;

    const schema = z.object({
      findings: z.array(z.object({
        findingId: z.string(),
        action: z.enum(['store', 'rewrite', 'skip']),
        rawKey: z.string().max(2048).optional(),
      })),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid input', details: parsed.error.issues });

    // Validate: 'store' action requires rawKey
    for (const f of parsed.data.findings) {
      if (f.action === 'store' && !f.rawKey) {
        return reply.status(400).send({ error: `Finding ${f.findingId} has action 'store' but no rawKey provided` });
      }
    }

    // Validate scan ownership
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

    // ── Step 1: Ensure user has a developer key ─────────────────────
    let vpLiveKey: string | undefined;
    let devKeyCreated = false;

    const existingDevKeys = await prisma.developerKey.findMany({
      where: { userId, revokedAt: null },
      take: 1,
    });

    if (existingDevKeys.length > 0) {
      // User has a key but we don't have the raw value (only hash stored).
      // We need to create a new one for share2 encryption during migration.
      // The frontend should pass the raw key, but for auto-migration we create a fresh one.
      vpLiveKey = undefined; // Will create a new one below
    }

    if (!vpLiveKey) {
      // Check rate limit: max 5 non-revoked keys
      const keyCount = await prisma.developerKey.count({
        where: { userId, revokedAt: null },
      });
      if (keyCount >= 5) {
        return reply.status(429).send({
          error: 'Maximum 5 developer keys per account. Revoke unused keys to proceed with migration.',
        });
      }

      // Auto-create a developer key
      const prefix = 'vp_live_';
      const random = randomBytes(24).toString('base64url');
      vpLiveKey = prefix + random;
      const keyHash = createHash('sha256').update(vpLiveKey).digest('hex');
      const maskedKey = vpLiveKey.slice(0, 12) + '...' + vpLiveKey.slice(-4);

      await prisma.developerKey.create({
        data: {
          userId,
          key: maskedKey,
          keyHash,
          label: 'Auto-created by Scanner Migration',
          mode: 'live',
        },
      });
      devKeyCreated = true;
    }

    // ── Step 2: Store keys for findings with action 'store' ─────────
    const storedKeys: Array<{ keyId: string; provider: string; label: string }> = [];

    for (const fa of parsed.data.findings) {
      if (fa.action !== 'store' || !fa.rawKey) continue;

      const finding = scan.findings.find((f) => f.id === fa.findingId);
      if (!finding) continue;

      try {
        // Shamir split: 2-of-2
        const shares = splitString(fa.rawKey, 2, 2);

        // Encrypt share1 with server key (VAULT_ENCRYPTION_KEY)
        const share1Encrypted = encrypt(Buffer.from(serializeShare(shares[0])));

        // Encrypt share2 with user's vp_live_ key
        const share2Encrypted = encryptShare2(serializeShare(shares[1]), vpLiveKey!);

        const commitment = randomBytes(32).toString('hex');
        const authAppsRoot = randomBytes(32).toString('hex');

        const keySlot = await prisma.keySlot.create({
          data: {
            userId,
            provider: finding.provider,
            label: finding.envName || `${finding.provider} key`,
            share1Encrypted: new Uint8Array(share1Encrypted),
            share2Encrypted: new Uint8Array(share2Encrypted),
            vaultCommitment: commitment,
            authAppsRoot,
          },
        });

        storedKeys.push({
          keyId: keySlot.id,
          provider: finding.provider,
          label: keySlot.label,
        });
      } finally {
        // Zero the raw key from the input object
        if (fa.rawKey) {
          (fa as any).rawKey = '';
        }
      }
    }

    // ── Step 3: Prepare PR changes (reuse create-pr rewriting logic) ─
    const repo = await githubApi(ghToken, `/repos/${scan.repoFullName}`);
    const defaultBranch = repo.default_branch;
    const ref = await githubApi(ghToken, `/repos/${scan.repoFullName}/git/refs/heads/${defaultBranch}`);
    const baseSha = ref.object.sha;

    const branchName = `vaultproof/migrate-${Date.now()}`;
    await githubApiRaw(ghToken, 'POST', `/repos/${scan.repoFullName}/git/refs`, {
      ref: `refs/heads/${branchName}`,
      sha: baseSha,
    });

    const changedFiles = new Map<string, string>();
    const processedFindings: Array<{ envName: string; file: string; line: number | null; action: string }> = [];

    const DOMAIN_TO_PROVIDER = PROVIDER_URLS;

    for (const fa of parsed.data.findings) {
      if (fa.action === 'skip') continue;

      const finding = scan.findings.find((f) => f.id === fa.findingId);
      if (!finding || finding.source === 'git-history') continue;

      if (!changedFiles.has(finding.file)) {
        try {
          const fileData = await githubApi(ghToken, `/repos/${scan.repoFullName}/contents/${finding.file}?ref=${defaultBranch}`);
          changedFiles.set(finding.file, Buffer.from(fileData.content, 'base64').toString('utf-8'));
        } catch { continue; }
      }

      let content = changedFiles.get(finding.file)!;
      const isEnvFile = finding.file.endsWith('.env') || finding.file.includes('.env.');

      if (finding.mode === 'sdk-init') {
        // SDK init rewriting — same logic as create-pr
        const proxyBase = `https://api.vaultproof.dev/v1/${finding.provider}`;

        if (finding.line) {
          const lines = content.split('\n');
          const lineIdx = finding.line - 1;

          let blockStart = lineIdx;
          let blockEnd = lineIdx;
          let depth = 0;
          let foundOpen = false;
          for (let i = lineIdx; i < lines.length && i < lineIdx + 20; i++) {
            for (const ch of lines[i]) {
              if (ch === '(') { depth++; foundOpen = true; }
              if (ch === ')') { depth--; }
              if (foundOpen && depth === 0) { blockEnd = i; break; }
            }
            if (foundOpen && depth === 0) break;
          }

          const blockLines = lines.slice(blockStart, blockEnd + 1);
          let block = blockLines.join('\n');

          const providerEnvVars = [`${finding.provider.toUpperCase()}_API_KEY`];
          for (const [envName, prov] of Object.entries(ENV_VAR_PATTERNS)) {
            if (prov === finding.provider && !providerEnvVars.includes(envName)) {
              providerEnvVars.push(envName);
            }
          }
          for (const envVar of providerEnvVars) {
            block = block.replace(
              new RegExp(`process\\.env\\.${envVar}`, 'g'),
              'process.env.VAULTPROOF_API_KEY'
            );
            block = block.replace(
              new RegExp(`os\\.environ\\[["']${envVar}["']\\]`, 'g'),
              'os.environ["VAULTPROOF_API_KEY"]'
            );
          }

          if (!block.includes('baseURL') && !block.includes('base_url')) {
            const braceMatch = block.match(/new\s+\w+\s*\(\s*\{/);
            if (braceMatch && braceMatch.index !== undefined) {
              const afterBrace = block.slice(braceMatch.index + braceMatch[0].length);
              if (afterBrace.trim().startsWith('}')) {
                block = block.replace(
                  /new\s+(\w+)\s*\(\s*\{\s*\}/,
                  `new $1({ baseURL: '${proxyBase}' }`
                );
              } else {
                block = block.replace(
                  /(new\s+\w+\s*\(\s*\{)/,
                  `$1 baseURL: '${proxyBase}',`
                );
              }
            } else {
              const pyMatch = block.match(/\(\s*api_key\s*=/);
              if (pyMatch && pyMatch.index !== undefined) {
                block = block.replace(
                  /\(\s*(api_key\s*=)/,
                  `(base_url="${proxyBase}", $1`
                );
              }
            }
          }

          const newBlockLines = block.split('\n');
          lines.splice(blockStart, blockEnd - blockStart + 1, ...newBlockLines);
          content = lines.join('\n');
        }

        changedFiles.set(finding.file, content);
        processedFindings.push({ envName: finding.envName, file: finding.file, line: finding.line, action: 'sdk-init → proxy' });

      } else if (finding.mode === 'http-url') {
        // HTTP URL rewriting
        if (finding.line) {
          const lines = content.split('\n');
          const lineIdx = finding.line - 1;
          if (lineIdx < lines.length) {
            for (const [domain, provider] of Object.entries(DOMAIN_TO_PROVIDER)) {
              const domainRegex = new RegExp(`https?://${domain.replace(/\./g, '\\.')}`, 'g');
              lines[lineIdx] = lines[lineIdx].replace(domainRegex, `https://api.vaultproof.dev/v1/${provider}`);
            }
            content = lines.join('\n');
          }
        }

        changedFiles.set(finding.file, content);
        processedFindings.push({ envName: finding.envName, file: finding.file, line: finding.line, action: 'url → proxy' });

      } else if (finding.mode === 'env-ref') {
        // Env var reference rewriting
        if (finding.line) {
          const lines = content.split('\n');
          const lineIdx = finding.line - 1;
          if (lineIdx < lines.length) {
            lines[lineIdx] = lines[lineIdx].replace(
              new RegExp(`process\\.env\\.${finding.envName}`, 'g'),
              'process.env.VAULTPROOF_API_KEY'
            );
            lines[lineIdx] = lines[lineIdx].replace(
              new RegExp(`os\\.environ\\[["']${finding.envName}["']\\]`, 'g'),
              'os.environ["VAULTPROOF_API_KEY"]'
            );
            content = lines.join('\n');
          }
        }

        changedFiles.set(finding.file, content);
        processedFindings.push({ envName: finding.envName, file: finding.file, line: finding.line, action: 'env → VAULTPROOF_API_KEY' });

      } else if (isEnvFile) {
        // .env file rewriting
        const lines = content.split('\n');
        let alreadyHasVaultproof = lines.some((l) => l.trim().startsWith('VAULTPROOF_API_KEY='));

        for (let i = 0; i < lines.length; i++) {
          const trimmed = lines[i].trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx === -1) continue;
          const varName = trimmed.slice(0, eqIdx).trim();
          if (varName === finding.envName) {
            lines[i] = `# ${varName} — secured by VaultProof proxy`;
            break;
          }
        }

        if (!alreadyHasVaultproof) {
          lines.push('VAULTPROOF_API_KEY=vp_live_xxx');
        }

        content = lines.join('\n');
        changedFiles.set(finding.file, content);
        processedFindings.push({ envName: finding.envName, file: finding.file, line: finding.line, action: 'env-file → proxy' });

      } else {
        // Hardcoded key replacement
        const replacement = `process.env.${finding.envName}`;

        if (finding.line) {
          const lines = content.split('\n');
          const lineIdx = finding.line - 1;
          if (lineIdx < lines.length) {
            lines[lineIdx] = lines[lineIdx].replace(/["'`][^"'`]{10,512}["'`]/g, replacement);
            content = lines.join('\n');
          }
        }

        changedFiles.set(finding.file, content);
        processedFindings.push({ envName: finding.envName, file: finding.file, line: finding.line, action: 'vaultproof' });
      }
    }

    if (changedFiles.size === 0 && storedKeys.length === 0) {
      return reply.status(400).send({ error: 'No changes to apply — all findings were skipped' });
    }

    // ── Step 4: Create the PR if there are code changes ─────────────
    let prUrl = '';
    let prNumber = 0;

    if (changedFiles.size > 0) {
      const PROXY_ACTIONS = new Set(['sdk-init → proxy', 'url → proxy', 'env → VAULTPROOF_API_KEY', 'env-file → proxy']);
      const hasProxyFindings = processedFindings.some((pf) => PROXY_ACTIONS.has(pf.action));

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
        message: hasProxyFindings
          ? 'fix: secure API keys via VaultProof proxy (VaultProof Migration)'
          : 'fix: remove exposed API keys (VaultProof Migration)',
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

      const storedKeysSection = storedKeys.length > 0
        ? `\n## Keys Stored in VaultProof\n\n${storedKeys.map((k) => `- **${k.provider}** — \`${k.label}\` (ID: \`${k.keyId}\`)`).join('\n')}\n`
        : '';

      const prBody = `## Guided Migration with VaultProof

This PR was created by [VaultProof's guided migration](https://vaultproof.dev). API keys have been secured and code has been rewritten to use the VaultProof transparent proxy.
${storedKeysSection}
| Key | File | Action |
|-----|------|--------|
${processedFindings.map((pf) => {
        const desc = pf.action === 'sdk-init → proxy' ? 'Rewritten to use VaultProof proxy'
          : pf.action === 'url → proxy' ? 'URL redirected through VaultProof proxy'
          : pf.action === 'env → VAULTPROOF_API_KEY' ? 'Replaced with \`VAULTPROOF_API_KEY\`'
          : pf.action === 'env-file → proxy' ? 'Commented out, added \`VAULTPROOF_API_KEY\`'
          : `Replaced with \`process.env.${pf.envName}\``;
        return `| \`${pf.envName}\` | ${pf.file}${pf.line ? `:${pf.line}` : ''} | ${desc} |`;
      }).join('\n')}
${historyWarning}
## Setup

1. Add your VaultProof API key to your hosting provider:
   - \`VAULTPROOF_API_KEY\` — get this from [VaultProof Dashboard](https://vaultproof.dev/app/keys)

---
*This PR was created by VaultProof's guided migration with your approval.*
*VaultProof is not responsible for code modifications you approve and merge.*`;

      const pr = await githubApiRaw(ghToken, 'POST', `/repos/${scan.repoFullName}/pulls`, {
        title: 'fix: secure API keys via VaultProof guided migration',
        body: prBody,
        head: branchName,
        base: defaultBranch,
      });

      prUrl = pr.html_url;
      prNumber = pr.number;
    }

    // ── Step 5: Update finding records ──────────────────────────────
    for (const fa of parsed.data.findings) {
      if (fa.action === 'skip') {
        await prisma.scanFinding.update({
          where: { id: fa.findingId },
          data: { action: 'skipped' },
        }).catch(() => {});
      } else {
        await prisma.scanFinding.update({
          where: { id: fa.findingId },
          data: {
            action: fa.action === 'store' ? 'migrated' : 'pr-created',
            prUrl: prUrl || undefined,
          },
        }).catch(() => {});
      }
    }

    await auditLog(userId, 'migrated', scanId, {
      prUrl,
      prNumber,
      storedKeys: storedKeys.length,
      rewrittenFindings: processedFindings.length,
    });

    return {
      prUrl,
      prNumber,
      devKey: devKeyCreated ? vpLiveKey : undefined,
      storedKeys,
      platforms: (scan.platforms as string[]) || []
    };
  });
}
