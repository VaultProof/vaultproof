# Scanner Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Scanner page in the VaultProof dashboard that lets users connect GitHub, scan repos for exposed API keys, and create PRs to fix them.

**Architecture:** Separate GitHub OAuth app for repo access. Backend routes handle OAuth flow, call GitHub API to read files/history, run the same detection patterns as the CLI, and use GitHub API to create PRs. Frontend is a vanilla HTML page matching the existing dashboard pattern.

**Tech Stack:** Fastify (backend routes), Prisma (DB), GitHub REST API (no cloning), vanilla HTML/JS/Tailwind (frontend), Supabase (auth — existing)

---

### Task 1: Add Prisma Models

**Files:**
- Modify: `packages/backend/prisma/schema.prisma` (append to end)

**Step 1: Add the four new models to schema.prisma**

```prisma
model GithubConnection {
  id              String    @id @default(uuid())
  userId          String
  user            User      @relation(fields: [userId], references: [id])
  githubUsername   String
  accessToken     String    // Encrypted with VAULT_ENCRYPTION_KEY
  scopes          String    // Comma-separated
  connectedAt     DateTime  @default(now())
  disconnectedAt  DateTime?
}

model ScanResult {
  id            String        @id @default(uuid())
  userId        String
  user          User          @relation(fields: [userId], references: [id])
  repoFullName  String
  branch        String
  keysFound     Int           @default(0)
  keysActive    Int           @default(0)
  keysRevoked   Int           @default(0)
  status        String        @default("in_progress") // in_progress, completed, failed
  startedAt     DateTime      @default(now())
  completedAt   DateTime?
  errorMessage  String?
  findings      ScanFinding[]
  auditLogs     ScanAuditLog[]
}

model ScanFinding {
  id          String   @id @default(uuid())
  scanId      String
  scan        ScanResult @relation(fields: [scanId], references: [id], onDelete: Cascade)
  envName     String
  provider    String
  file        String
  line        Int?
  mode        String   // proxy, env-injection
  verified    String   // active, revoked, unknown
  source      String   // current, git-history
  action      String   @default("pending") // pending, stored, pr-created, ignored
  prUrl       String?
  maskedValue String
  createdAt   DateTime @default(now())
}

model ScanAuditLog {
  id        String   @id @default(uuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  scanId    String?
  scan      ScanResult? @relation(fields: [scanId], references: [id], onDelete: SetNull)
  action    String   // connected_github, started_scan, completed_scan, etc.
  metadata  Json?
  createdAt DateTime @default(now())
}
```

Also add the relations to the User model:
```prisma
// Add to existing User model:
githubConnections GithubConnection[]
scanResults       ScanResult[]
scanAuditLogs     ScanAuditLog[]
```

**Step 2: Generate Prisma client**

Run: `cd packages/backend && npx prisma generate`
Expected: `✔ Generated Prisma Client`

**Step 3: Create migration**

Run: `cd packages/backend && npx prisma migrate dev --name add-scanner-tables`
Expected: Migration created and applied

**Step 4: Commit**

```bash
git add packages/backend/prisma/
git commit -m "feat(scanner): add database models — GithubConnection, ScanResult, ScanFinding, ScanAuditLog"
```

---

### Task 2: Scanner Backend — GitHub OAuth Routes

**Files:**
- Create: `packages/backend/src/routes/scanner.ts`
- Modify: `packages/backend/src/index.ts` (add route registration at ~line 131)

**Step 1: Create scanner.ts with GitHub OAuth endpoints**

The OAuth flow:
1. `GET /api/v1/scanner/github/connect` — redirects to GitHub OAuth
2. `GET /api/v1/scanner/github/callback` — handles callback, stores encrypted token
3. `DELETE /api/v1/scanner/github/disconnect` — revokes token
4. `GET /api/v1/scanner/github/status` — check if connected

```typescript
// packages/backend/src/routes/scanner.ts

import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { encrypt, decrypt } from '../crypto/encryption.js';
import { randomBytes } from 'crypto';

// GitHub OAuth App credentials (separate from Supabase login)
const GITHUB_CLIENT_ID = process.env.GITHUB_SCANNER_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_SCANNER_CLIENT_SECRET || '';
const GITHUB_REDIRECT_URI = process.env.GITHUB_SCANNER_REDIRECT_URI || 'https://vaultproof.dev/app/scanner?github_callback=1';

// Same key prefix patterns as CLI (keep in sync)
const KEY_PREFIX_PATTERNS: Array<{ pattern: RegExp; provider: string }> = [
  // AI / LLM
  { pattern: /^sk-proj-/, provider: "openai" },
  { pattern: /^sk-[a-zA-Z0-9]{40,}$/, provider: "openai" },
  { pattern: /^sk-ant-/, provider: "anthropic" },
  { pattern: /^tog_/, provider: "together" },
  { pattern: /^gsk_[a-zA-Z0-9]{40,}$/, provider: "groq" },
  { pattern: /^pplx-[a-zA-Z0-9]{40,}$/, provider: "perplexity" },
  { pattern: /^r8_[a-zA-Z0-9]{30,}$/, provider: "replicate" },
  { pattern: /^fw_[a-zA-Z0-9]{30,}$/, provider: "fireworks" },
  // Payments
  { pattern: /^sk_live_/, provider: "stripe" },
  { pattern: /^sk_test_/, provider: "stripe" },
  { pattern: /^pk_live_/, provider: "stripe" },
  { pattern: /^pk_test_/, provider: "stripe" },
  { pattern: /^whsec_/, provider: "stripe" },
  // Google
  { pattern: /^AIza[0-9A-Za-z_-]{35}$/, provider: "google" },
  // AWS
  { pattern: /^AKIA[0-9A-Z]{16}$/, provider: "aws" },
  { pattern: /^ASIA[0-9A-Z]{16}$/, provider: "aws" },
  // Email
  { pattern: /^SG\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/, provider: "sendgrid" },
  { pattern: /^re_[a-zA-Z0-9]{20,}$/, provider: "resend" },
  // Messaging
  { pattern: /^xoxb-/, provider: "slack" },
  { pattern: /^xoxp-/, provider: "slack" },
  // GitHub
  { pattern: /^ghp_[a-zA-Z0-9]{36}$/, provider: "github" },
  { pattern: /^ghs_[a-zA-Z0-9]{36}$/, provider: "github" },
  { pattern: /^github_pat_/, provider: "github" },
  // Supabase
  { pattern: /^eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\./, provider: "supabase" },
  // Twilio
  { pattern: /^SK[a-f0-9]{32}$/, provider: "twilio" },
  // npm
  { pattern: /^npm_[a-zA-Z0-9]{36}$/, provider: "npm" },
  // Datadog
  { pattern: /^dd[a-z]_[a-zA-Z0-9]{32,}$/, provider: "datadog" },
];

const PROXY_PROVIDERS = new Set([
  "openai", "anthropic", "google", "together", "mistral", "cohere",
  "groq", "perplexity", "fireworks", "deepseek", "replicate",
]);

const ROTATION_URLS: Record<string, string> = {
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  stripe: "https://dashboard.stripe.com/apikeys",
  google: "https://console.cloud.google.com/apis/credentials",
  github: "https://github.com/settings/tokens",
  aws: "https://console.aws.amazon.com/iam/home#/security_credentials",
  sendgrid: "https://app.sendgrid.com/settings/api_keys",
  resend: "https://resend.com/api-keys",
  supabase: "https://supabase.com/dashboard/project/_/settings/api",
  slack: "https://api.slack.com/apps",
  twilio: "https://console.twilio.com",
  datadog: "https://app.datadoghq.com/organization-settings/api-keys",
};

const VERIFY_ENDPOINTS: Record<string, { url: string; headers: (key: string) => Record<string, string> }> = {
  openai:    { url: "https://api.openai.com/v1/models", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
  anthropic: { url: "https://api.anthropic.com/v1/models", headers: (k) => ({ "x-api-key": k, "anthropic-version": "2023-06-01" }) },
  stripe:    { url: "https://api.stripe.com/v1/balance", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
  github:    { url: "https://api.github.com/user", headers: (k) => ({ Authorization: `Bearer ${k}`, "User-Agent": "VaultProof-Scanner" }) },
  sendgrid:  { url: "https://api.sendgrid.com/v3/scopes", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
  resend:    { url: "https://api.resend.com/api-keys", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
};

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
  return PROXY_PROVIDERS.has(provider) ? "proxy" : "env-injection";
}

async function verifyKey(provider: string, value: string): Promise<string> {
  const endpoint = VERIFY_ENDPOINTS[provider];
  if (!endpoint) return "unknown";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(endpoint.url, {
      method: "GET",
      headers: endpoint.headers(value),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.status < 400 || res.status === 429) return "active";
    if (res.status === 401 || res.status === 403) return "revoked";
    return "unknown";
  } catch {
    clearTimeout(timer);
    return "unknown";
  }
}

/** Call GitHub API with the user's stored token. */
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

/** Audit log helper */
async function auditLog(userId: string, action: string, scanId?: string, metadata?: Record<string, unknown>) {
  await prisma.scanAuditLog.create({
    data: { userId, action, scanId, metadata: metadata || undefined },
  }).catch(() => {});
}

export async function scannerRoutes(app: FastifyInstance) {
  // All scanner routes require auth
  app.addHook('onRequest', requireAuth);

  // ─── GitHub OAuth ──────────────────────────────────────────────────

  // Check connection status
  app.get('/github/status', async (request) => {
    const userId = request.auth!.userId;
    const conn = await prisma.githubConnection.findFirst({
      where: { userId, disconnectedAt: null },
      select: { githubUsername: true, connectedAt: true, scopes: true },
    });
    return { connected: !!conn, ...(conn || {}) };
  });

  // Start OAuth flow
  app.get('/github/connect', async (request, reply) => {
    const userId = request.auth!.userId;
    // Check tier
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { tier: true } });
    if (!user || !['pro', 'max', 'enterprise'].includes(user.tier)) {
      return reply.status(403).send({ error: 'Scanner requires a Pro plan. Upgrade at https://vaultproof.dev/app/settings' });
    }

    const state = randomBytes(32).toString('hex');
    // Store state in a short-lived record (or use a signed JWT)
    // For simplicity, encode userId in state
    const statePayload = Buffer.from(JSON.stringify({ userId, nonce: state })).toString('base64url');
    const url = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(GITHUB_REDIRECT_URI)}&scope=repo&state=${statePayload}`;
    return { url };
  });

  // OAuth callback
  app.post('/github/callback', async (request, reply) => {
    const schema = z.object({
      code: z.string().min(1).max(256),
      state: z.string().min(1).max(1024),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid callback parameters' });

    const { code, state } = parsed.data;

    // Decode state to get userId
    let stateData: { userId: string; nonce: string };
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
    } catch {
      return reply.status(400).send({ error: 'Invalid state parameter' });
    }

    // Verify the authenticated user matches the state
    if (stateData.userId !== request.auth!.userId) {
      return reply.status(403).send({ error: 'State mismatch' });
    }

    // Exchange code for token
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

    // Get GitHub username
    const ghUser = await githubApi(tokenData.access_token, '/user');

    // Encrypt token before storage
    const encryptedToken = encrypt(Buffer.from(tokenData.access_token)).toString('base64');

    // Disconnect any existing connection first
    await prisma.githubConnection.updateMany({
      where: { userId: request.auth!.userId, disconnectedAt: null },
      data: { disconnectedAt: new Date() },
    });

    // Store new connection
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

  // Disconnect
  app.delete('/github/disconnect', async (request) => {
    const userId = request.auth!.userId;
    await prisma.githubConnection.updateMany({
      where: { userId, disconnectedAt: null },
      data: { disconnectedAt: new Date() },
    });
    await auditLog(userId, 'disconnected_github');
    return { connected: false };
  });

  // ─── Repo listing ──────────────────────────────────────────────────

  app.get('/repos', async (request, reply) => {
    const userId = request.auth!.userId;
    const conn = await prisma.githubConnection.findFirst({
      where: { userId, disconnectedAt: null },
    });
    if (!conn) return reply.status(400).send({ error: 'GitHub not connected' });

    const token = decrypt(Buffer.from(conn.accessToken, 'base64')).toString();
    const repos = await githubApi(token, '/user/repos?per_page=100&sort=updated&type=owner');
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

  // ─── Scan a repo ───────────────────────────────────────────────────

  app.post('/scan', async (request, reply) => {
    const schema = z.object({
      repoFullName: z.string().min(1).max(200).regex(/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/),
      branch: z.string().max(200).optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid input' });

    const userId = request.auth!.userId;
    const { repoFullName, branch } = parsed.data;

    // Get GitHub token
    const conn = await prisma.githubConnection.findFirst({
      where: { userId, disconnectedAt: null },
    });
    if (!conn) return reply.status(400).send({ error: 'GitHub not connected' });
    const ghToken = decrypt(Buffer.from(conn.accessToken, 'base64')).toString();

    // Create scan record
    const scan = await prisma.scanResult.create({
      data: { userId, repoFullName, branch: branch || 'default', status: 'in_progress' },
    });
    await auditLog(userId, 'started_scan', scan.id, { repoFullName });

    try {
      // Get default branch if not specified
      const repo = await githubApi(ghToken, `/repos/${repoFullName}`);
      const targetBranch = branch || repo.default_branch;

      // Update branch in scan
      await prisma.scanResult.update({ where: { id: scan.id }, data: { branch: targetBranch } });

      // Get file tree
      const tree = await githubApi(ghToken, `/repos/${repoFullName}/git/trees/${targetBranch}?recursive=1`);
      const files = (tree.tree as any[]).filter((f: any) => f.type === 'blob');

      // Filter to scannable files
      const SCAN_EXTENSIONS = new Set(['.env', '.ts', '.js', '.jsx', '.tsx', '.py', '.go', '.rb', '.java', '.php']);
      const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.next', 'vendor', '__pycache__', 'coverage']);

      const filesToScan = files.filter((f: any) => {
        const path = f.path as string;
        // .env files (any name starting with .env)
        const basename = path.split('/').pop() || '';
        if (basename === '.env' || basename.startsWith('.env.')) return true;
        // Source files
        const ext = basename.includes('.') ? '.' + basename.split('.').pop() : '';
        if (!SCAN_EXTENSIONS.has(ext)) return false;
        // Skip directories
        const parts = path.split('/');
        return !parts.some((p: string) => SKIP_DIRS.has(p));
      });

      // Scan each file (limit to 200 files)
      const findings: Array<{
        envName: string; provider: string; file: string; line: number | null;
        mode: string; verified: string; source: string; maskedValue: string;
        value: string; // Only in memory, never stored
      }> = [];

      const seenValues = new Set<string>();

      for (const file of filesToScan.slice(0, 200)) {
        let content: string;
        try {
          const blob = await githubApi(ghToken, `/repos/${repoFullName}/git/blobs/${file.sha}`);
          content = Buffer.from(blob.content, 'base64').toString('utf-8');
        } catch { continue; }

        // Skip files > 500KB
        if (content.length > 500_000) continue;

        const isEnvFile = file.path.split('/').pop()?.startsWith('.env');

        if (isEnvFile) {
          // Parse .env format
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
            if (!value || value.length < 10) continue;
            if (seenValues.has(value)) continue;

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
          // Scan source code for hardcoded strings
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const lineStr = lines[i];
            const stringMatches = lineStr.matchAll(/["'`]([^"'`]{10,512})["'`]/g);
            for (const m of stringMatches) {
              const val = m[1];
              if (seenValues.has(val)) continue;
              const provider = detectProvider(val);
              if (!provider) continue;
              seenValues.add(val);
              const envName = `${provider.toUpperCase()}_API_KEY`;
              findings.push({
                envName,
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

      // Scan git history (last 50 commits)
      try {
        const commits = await githubApi(ghToken, `/repos/${repoFullName}/commits?sha=${targetBranch}&per_page=50`);
        for (const commit of (commits as any[]).slice(0, 50)) {
          let commitDetail: any;
          try {
            commitDetail = await githubApi(ghToken, `/repos/${repoFullName}/commits/${commit.sha}`);
          } catch { continue; }

          for (const file of (commitDetail.files || [])) {
            if (!file.patch) continue;
            // Only look at removed lines
            for (const line of (file.patch as string).split('\n')) {
              if (!line.startsWith('-') || line.startsWith('---')) continue;
              const content = line.slice(1);
              // Check for key patterns in removed content
              const stringMatches = content.matchAll(/["'`=]([^"'`\s]{10,512})/g);
              for (const m of stringMatches) {
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
        // Git history scan failed — continue without it
      }

      // Verify keys (max 20, parallel batches of 5)
      for (let i = 0; i < Math.min(findings.length, 20); i += 5) {
        const batch = findings.slice(i, i + 5);
        await Promise.all(batch.map(async (f) => {
          f.verified = await verifyKey(f.provider, f.value);
        }));
      }

      // Store findings in DB (without raw values)
      const dbFindings = await Promise.all(findings.map((f) =>
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
      ));

      // Update scan result
      const keysActive = findings.filter((f) => f.verified === 'active').length;
      const keysRevoked = findings.filter((f) => f.verified === 'revoked').length;

      await prisma.scanResult.update({
        where: { id: scan.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
          keysFound: findings.length,
          keysActive,
          keysRevoked,
        },
      });

      await auditLog(userId, 'completed_scan', scan.id, {
        keysFound: findings.length, keysActive, keysRevoked,
      });

      return {
        scanId: scan.id,
        status: 'completed',
        keysFound: findings.length,
        keysActive,
        keysRevoked,
        findings: dbFindings.map((f, i) => ({
          id: f.id,
          envName: f.envName,
          provider: f.provider,
          file: f.file,
          line: f.line,
          mode: f.mode,
          verified: f.verified,
          source: f.source,
          maskedValue: f.maskedValue,
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
      return reply.status(500).send({ error: 'Scan failed', details: message });
    }
  });

  // ─── Get scan results ──────────────────────────────────────────────

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

    await prisma.scanFinding.update({
      where: { id: findingId },
      data: { action: 'ignored' },
    });
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

    // Get GitHub token
    const conn = await prisma.githubConnection.findFirst({
      where: { userId, disconnectedAt: null },
    });
    if (!conn) return reply.status(400).send({ error: 'GitHub not connected' });
    const ghToken = decrypt(Buffer.from(conn.accessToken, 'base64')).toString();

    // Get default branch SHA
    const repo = await githubApi(ghToken, `/repos/${scan.repoFullName}`);
    const defaultBranch = repo.default_branch;
    const ref = await githubApi(ghToken, `/repos/${scan.repoFullName}/git/refs/heads/${defaultBranch}`);
    const baseSha = ref.object.sha;

    // Create branch
    const timestamp = Date.now();
    const branchName = `vaultproof/scan-${timestamp}`;
    await fetch(`https://api.github.com/repos/${scan.repoFullName}/git/refs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ghToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'VaultProof-Scanner',
      },
      body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha }),
    });

    // Apply changes per finding
    const changedFiles = new Map<string, string>(); // path → new content
    const findingActions = parsed.data.findings;
    const processedFindings: string[] = [];

    for (const fa of findingActions) {
      const finding = scan.findings.find((f) => f.id === fa.findingId);
      if (!finding || finding.source === 'git-history') continue;

      // Get current file content
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

      // Replace hardcoded key with env reference
      // For source files: replace quoted string containing the masked pattern
      if (finding.line) {
        const lines = content.split('\n');
        const lineIdx = finding.line - 1;
        if (lineIdx < lines.length) {
          // Replace any quoted string on that line that matches a key pattern
          lines[lineIdx] = lines[lineIdx].replace(
            /["'`][^"'`]{10,512}["'`]/g,
            replacement
          );
          content = lines.join('\n');
        }
      }

      changedFiles.set(finding.file, content);
      processedFindings.push(finding.envName);
    }

    if (changedFiles.size === 0) {
      return reply.status(400).send({ error: 'No changes to apply' });
    }

    // Create tree with changed files
    const baseTree = await githubApi(ghToken, `/repos/${scan.repoFullName}/git/trees/${baseSha}`);

    const treeItems = [];
    for (const [path, content] of changedFiles) {
      const blob = await fetch(`https://api.github.com/repos/${scan.repoFullName}/git/blobs`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ghToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'VaultProof-Scanner',
        },
        body: JSON.stringify({ content, encoding: 'utf-8' }),
      }).then((r) => r.json()) as { sha: string };

      treeItems.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
    }

    const newTree = await fetch(`https://api.github.com/repos/${scan.repoFullName}/git/trees`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ghToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'VaultProof-Scanner',
      },
      body: JSON.stringify({ base_tree: baseSha, tree: treeItems }),
    }).then((r) => r.json()) as { sha: string };

    // Create commit
    const commit = await fetch(`https://api.github.com/repos/${scan.repoFullName}/git/commits`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ghToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'VaultProof-Scanner',
      },
      body: JSON.stringify({
        message: 'fix: remove exposed API keys (VaultProof Scanner)',
        tree: newTree.sha,
        parents: [baseSha],
      }),
    }).then((r) => r.json()) as { sha: string };

    // Update branch ref
    await fetch(`https://api.github.com/repos/${scan.repoFullName}/git/refs/heads/${branchName}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${ghToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'VaultProof-Scanner',
      },
      body: JSON.stringify({ sha: commit.sha }),
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
${processedFindings.map((name) => {
  const f = scan.findings.find((ff) => ff.envName === name);
  return f ? `| \`${f.envName}\` | ${f.file}${f.line ? `:${f.line}` : ''} | Replaced with \`process.env.${f.envName}\` |` : '';
}).filter(Boolean).join('\n')}
${historyWarning}
## Setup

Set these environment variables in your hosting provider:
${processedFindings.map((name) => `- \`${name}\``).join('\n')}

---
*This PR was created by VaultProof Scanner with your approval.*
*VaultProof is not responsible for code modifications you approve and merge.*`;

    // Create PR
    const prRes = await fetch(`https://api.github.com/repos/${scan.repoFullName}/pulls`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ghToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'VaultProof-Scanner',
      },
      body: JSON.stringify({
        title: 'fix: remove exposed API keys (VaultProof Scanner)',
        body: prBody,
        head: branchName,
        base: defaultBranch,
      }),
    }).then((r) => r.json()) as { html_url: string; number: number };

    // Update findings
    for (const fa of findingActions) {
      await prisma.scanFinding.update({
        where: { id: fa.findingId },
        data: { action: 'pr-created', prUrl: prRes.html_url },
      });
    }

    await auditLog(userId, 'created_pr', scanId, {
      prUrl: prRes.html_url, prNumber: prRes.number, findingsCount: processedFindings.length,
    });

    return { prUrl: prRes.html_url, prNumber: prRes.number };
  });
}
```

**Step 2: Register the route in index.ts**

Add after the promo routes registration (~line 131):

```typescript
import { scannerRoutes } from './routes/scanner.js';

// After: await app.register(promoRoutes, { prefix: '/api/v1/promo' });
await app.register(scannerRoutes, { prefix: '/api/v1/scanner' });
```

**Step 3: Verify TypeScript compiles**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: No new errors (existing allowedKeySlotIds errors are pre-existing)

**Step 4: Commit**

```bash
git add packages/backend/src/routes/scanner.ts packages/backend/src/index.ts
git commit -m "feat(scanner): backend routes — GitHub OAuth, repo scanning, PR creation"
```

---

### Task 3: Scanner Frontend — HTML Page

**Files:**
- Create: `apps/site/app/scanner.html`
- Modify: `apps/site/app/index.html` (add sidebar item)
- Modify: `apps/site/app/keys.html` (add sidebar item)
- Modify: `apps/site/app/logs.html` (add sidebar item)
- Modify: `apps/site/app/settings.html` (add sidebar item)

**Step 1: Add "Scanner" to sidebar in all 5 dashboard pages**

After the Agents nav item, before Access Logs, add:

```html
<a href="/app/scanner" class="sidebar-nav-item flex items-center gap-3 px-3 py-2.5 rounded-xl text-gray-400 hover:text-white hover:bg-white/5 text-sm transition">
  <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
  </svg>
  <span class="sidebar-label">Scanner</span>
</a>
```

**Step 2: Create scanner.html**

Copy the structure from keys.html (HTML head, sidebar, top nav, auth check). The main content area has three states:

1. **Not connected:** "Connect GitHub" button with disclaimer
2. **Connected:** Repo list with "Scan" button per repo
3. **Scan results:** Found keys with action buttons

Full page is ~800 lines of vanilla HTML/JS/Tailwind following the existing dashboard pattern. Key sections:

- GitHub OAuth connect/disconnect
- Repo list (fetched from `/api/v1/scanner/repos`)
- Scan trigger (POST to `/api/v1/scanner/scan`)
- Results table with per-key actions (store/PR/ignore)
- Scan history table
- PR creation flow with diff preview modal

**Step 3: Verify page loads**

Open `https://vaultproof.dev/app/scanner` in browser, confirm sidebar shows, auth redirect works.

**Step 4: Commit**

```bash
git add apps/site/app/scanner.html apps/site/app/index.html apps/site/app/keys.html apps/site/app/logs.html apps/site/app/settings.html
git commit -m "feat(scanner): dashboard page — connect GitHub, scan repos, create PRs"
```

---

### Task 4: Create GitHub OAuth App

**Step 1: Create OAuth app at github.com/settings/developers**

- Application name: `VaultProof Scanner`
- Homepage URL: `https://vaultproof.dev`
- Callback URL: `https://vaultproof.dev/app/scanner?github_callback=1`
- Check: "Request user authorization (OAuth) during installation"

**Step 2: Add env vars to Railway**

```
GITHUB_SCANNER_CLIENT_ID=<from GitHub>
GITHUB_SCANNER_CLIENT_SECRET=<from GitHub>
GITHUB_SCANNER_REDIRECT_URI=https://vaultproof.dev/app/scanner?github_callback=1
```

**Step 3: Verify OAuth flow end-to-end**

1. Open Scanner page → click Connect GitHub
2. Authorize on GitHub → redirected back
3. Verify repos list loads
4. Scan a test repo → verify results show

---

### Task 5: Run Prisma Migration on Railway

**Step 1: Connect to Railway database**

Run: `cd packages/backend && DATABASE_URL=<railway-url> npx prisma migrate deploy`
Expected: 4 new tables created

**Step 2: Verify via Supabase Table Editor**

Check that `GithubConnection`, `ScanResult`, `ScanFinding`, `ScanAuditLog` tables exist.

---

### Task 6: End-to-End Test

**Step 1: Connect GitHub on Scanner page**

**Step 2: Scan a test repo (e.g. a fork with fake keys)**

**Step 3: Verify findings show correctly**
- Check key detection matches CLI output
- Check verification status (active/revoked/unknown)
- Check git history findings show separately

**Step 4: Create a PR**
- Select a finding, choose "Replace with VaultProof"
- Review diff preview
- Click "Create PR"
- Verify PR appears on GitHub with correct branch, diff, and body

**Step 5: Verify audit log**
- Check admin panel shows scan + PR creation logs

**Step 6: Commit and push**

```bash
git push origin main
```
