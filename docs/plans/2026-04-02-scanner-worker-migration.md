# Scanner Worker Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate all 11 scanner routes from Railway backend to CF Worker, querying Supabase directly and calling GitHub API from the edge.

**Architecture:** New `packages/worker/src/routes/scanner.ts` file with helper modules for GitHub API, secret detection patterns, and PR generation. Uses existing `getSupabase()`, `authenticateUser()`, and worker encryption modules.

**Tech Stack:** Cloudflare Workers, Supabase PostgREST, GitHub REST API, AES-256-GCM encryption

**Progress Tracking:** Each task is independent and committed separately. If interrupted, check git log for last completed task and resume from the next one.

---

## Environment Variables Needed

Add to `Env` in `types.ts`:
- `GITHUB_CLIENT_ID: string`
- `GITHUB_CLIENT_SECRET: string`
- `GITHUB_REDIRECT_URI: string`

Set as worker secrets:
```bash
npx wrangler secret put GITHUB_CLIENT_ID --env staging
npx wrangler secret put GITHUB_CLIENT_SECRET --env staging
```

Set as wrangler.toml var:
```toml
GITHUB_REDIRECT_URI = "https://vaultproof.dev/app/scanner"
```

---

### Task 1: Add env vars and scaffold scanner route file

**Files:**
- Modify: `packages/worker/src/types.ts`
- Create: `packages/worker/src/routes/scanner.ts`
- Modify: `packages/worker/src/index.ts`
- Modify: `packages/worker/wrangler.toml`

**What to do:**

1. Add to `Env` interface in types.ts:
```typescript
GITHUB_CLIENT_ID: string;
GITHUB_CLIENT_SECRET: string;
GITHUB_REDIRECT_URI: string;
```

2. Create `scanner.ts` with router function:
```typescript
import type { Env } from '../types.js';
import { getSupabase } from '../lib/supabase.js';
import { authenticateUser, type AuthUser } from '../lib/jwt-auth.js';

export async function handleScanner(request: Request, env: Env, path: string): Promise<Response> {
  // Public: no auth needed for OAuth callback redirect
  
  const user = await authenticateUser(request, env);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  if (path === 'github/status' && request.method === 'GET') return handleGithubStatus(env, user);
  if (path === 'github/connect' && request.method === 'GET') return handleGithubConnect(env, user, request);
  if (path === 'github/callback' && request.method === 'POST') return handleGithubCallback(request, env, user);
  if (path === 'github/disconnect' && request.method === 'DELETE') return handleGithubDisconnect(env, user);
  if (path === 'repos' && request.method === 'GET') return handleRepos(env, user);
  if (path === 'scans' && request.method === 'GET') return handleListScans(env, user);
  if (path === 'scan' && request.method === 'POST') return handleScan(request, env, user);

  // Dynamic routes: scans/:id, findings/:id/ignore, scans/:id/create-pr, scans/:id/migrate
  const scanMatch = path.match(/^scans\/([^/]+)$/);
  if (scanMatch && request.method === 'GET') return handleGetScan(env, user, scanMatch[1]);

  const ignoreMatch = path.match(/^findings\/([^/]+)\/ignore$/);
  if (ignoreMatch && request.method === 'POST') return handleIgnoreFinding(env, user, ignoreMatch[1]);

  const prMatch = path.match(/^scans\/([^/]+)\/create-pr$/);
  if (prMatch && request.method === 'POST') return handleCreatePr(request, env, user, prMatch[1]);

  const migrateMatch = path.match(/^scans\/([^/]+)\/migrate$/);
  if (migrateMatch && request.method === 'POST') return handleMigrate(request, env, user, migrateMatch[1]);

  return Response.json({ error: 'Not found' }, { status: 404 });
}
```

3. Add route to `index.ts`:
```typescript
import { handleScanner } from './routes/scanner.js';

// Scanner routes
if (url.pathname.startsWith('/api/v1/scanner/')) {
  try {
    const path = url.pathname.slice('/api/v1/scanner/'.length);
    const response = await handleScanner(request, env, path);
    return addCors(response, origin, allowedOrigins);
  } catch {
    return addCors(Response.json({ error: 'Service temporarily unavailable' }, { status: 503 }), origin, allowedOrigins);
  }
}
```

4. Add to `wrangler.toml` vars:
```toml
GITHUB_REDIRECT_URI = "https://vaultproof.dev/app/scanner"
```
And staging:
```toml
[env.staging.vars]
GITHUB_REDIRECT_URI = "https://dev.vaultproof.pages.dev/app/scanner"
```

**Commit:** `feat: scaffold scanner route file with router and env vars`

---

### Task 2: GitHub helper module

**Files:**
- Create: `packages/worker/src/lib/github.ts`

**What to do:**

Create helper for GitHub API calls and token encryption/decryption.

```typescript
import type { Env } from '../types.js';
import { getSupabase } from './supabase.js';
import { encrypt, decrypt } from '../crypto/encryption.js';

export async function githubApi(token: string, path: string, options?: RequestInit): Promise<any> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'VaultProof-Scanner/1.0',
      ...(options?.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

export function encryptGhToken(token: string, env: Env): string {
  const encrypted = encrypt(new TextEncoder().encode(token), env.VAULT_ENCRYPTION_KEY);
  // Return as hex string
  return Array.from(encrypted).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function decryptGhToken(encryptedHex: string, env: Env): string {
  const bytes = new Uint8Array(encryptedHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  const decrypted = decrypt(bytes, env.VAULT_ENCRYPTION_KEY);
  return new TextDecoder().decode(decrypted).trim();
}

export async function getGhToken(env: Env, userId: string): Promise<{ token: string; connId: string } | null> {
  const supabase = getSupabase(env);
  const { data: conn } = await supabase
    .from('github_connections')
    .select('id, access_token')
    .eq('user_id', userId)
    .is('disconnected_at', null)
    .order('connected_at', { ascending: false })
    .limit(1)
    .single();

  if (!conn) return null;

  try {
    const token = decryptGhToken(conn.access_token, env);
    return { token, connId: conn.id };
  } catch {
    return null;
  }
}

export async function auditLog(env: Env, userId: string, scanId: string | null, action: string, metadata?: any): Promise<void> {
  const supabase = getSupabase(env);
  await supabase.from('scan_audit_logs').insert({
    id: crypto.randomUUID(),
    user_id: userId,
    scan_id: scanId,
    action,
    metadata: metadata ? JSON.stringify(metadata) : null,
  }).then(() => {});
}
```

**Note:** The encrypt/decrypt functions may need adaptation — check how the existing `packages/worker/src/crypto/encryption.ts` works. The backend uses Node.js `crypto.createCipheriv` with AES-256-GCM. The worker version should use `crypto.subtle` or the `nodejs_compat` flag. Read the existing worker encryption module before implementing.

**Commit:** `feat: add GitHub API helper with token encryption for scanner`

---

### Task 3: GitHub OAuth routes (status, connect, callback, disconnect)

**Files:**
- Modify: `packages/worker/src/routes/scanner.ts`

**What to do:**

Implement 4 GitHub OAuth handlers:

**handleGithubStatus:** Query `github_connections` for active connection.

**handleGithubConnect:** Generate HMAC-signed state, return GitHub OAuth URL.

**handleGithubCallback:** Validate state, exchange code for token, encrypt and store.

**handleGithubDisconnect:** Set `disconnected_at` on active connections.

Key details:
- State format: `base64(JSON({ userId, nonce, ts })):hmacSignature`
- HMAC key: `VAULT_ENCRYPTION_KEY` (since we removed PROXY_SECRET)
- State expiry: 15 minutes
- GitHub OAuth URL: `https://github.com/login/oauth/authorize?client_id={id}&redirect_uri={uri}&scope=repo&state={state}`
- Token exchange: POST `https://github.com/login/oauth/access_token` with `Accept: application/json`

**Commit:** `feat: add GitHub OAuth routes to scanner (connect, callback, disconnect, status)`

---

### Task 4: Repos listing route

**Files:**
- Modify: `packages/worker/src/routes/scanner.ts`

**What to do:**

Implement `handleRepos`:
1. Get decrypted GitHub token via `getGhToken()`
2. Call `GET /user/repos?per_page=100&sort=updated&type=owner`
3. Map response to `{ repos: [{ fullName, name, private, defaultBranch, updatedAt }] }`

**Commit:** `feat: add repos listing route to scanner`

---

### Task 5: Secret detection patterns module

**Files:**
- Create: `packages/worker/src/lib/secret-patterns.ts`

**What to do:**

Extract all 25+ regex patterns and helper functions into a module:

```typescript
export const KEY_PATTERNS: { pattern: RegExp; provider: string }[] = [
  { pattern: /sk-proj-[a-zA-Z0-9]{20,}/, provider: 'openai' },
  { pattern: /sk-[a-zA-Z0-9]{40,}/, provider: 'openai' },
  { pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/, provider: 'anthropic' },
  // ... all 25+ patterns from backend
];

export const SCANNABLE_EXTENSIONS = ['.ts', '.js', '.jsx', '.tsx', '.py', '.go', '.rb', '.java', '.php', '.mjs', '.cjs'];
export const SKIP_DIRS = ['node_modules', 'dist', 'build', '.next', '.nuxt', 'vendor', '__pycache__', 'coverage', '.output', '.turbo'];
export const MAX_FILES = 200;
export const MAX_FILE_LINES = 10000;
export const MAX_LINE_LENGTH = 2000;
export const MIN_ENTROPY = 3.5;

export function shannonEntropy(s: string): number { ... }
export function detectProvider(value: string): string | null { ... }
export function shouldScanFile(path: string): boolean { ... }
```

**Commit:** `feat: add secret detection patterns module for scanner`

---

### Task 6: Scan execution route (POST /scan)

**Files:**
- Modify: `packages/worker/src/routes/scanner.ts`

**What to do:**

This is the largest route (~400 lines). Implement `handleScan`:

1. Validate input (repoFullName, branch)
2. Create `scan_results` record with status='in_progress'
3. Fetch repo metadata from GitHub
4. Fetch file tree (recursive)
5. Filter to scannable files (max 200)
6. Detect hosting platforms from config files
7. Scan Phase A: .env file scanning
8. Scan Phase B: Hardcoded string detection in source
9. Scan Phase C: Code-level detection (SDK init, HTTP URLs, env refs)
10. Scan git history (last 30 commits)
11. Verify API keys (max 20, batches of 5)
12. Store findings in Supabase
13. Update scan result
14. Return response

**Important:** This route may hit CF Worker CPU limits (30s for paid plan). Consider:
- Limiting git history to 10 commits instead of 30
- Reducing max files to 100
- Skipping verification if scan takes too long

**Commit:** `feat: add scan execution route to scanner worker`

---

### Task 7: Scan results routes (list, get, ignore)

**Files:**
- Modify: `packages/worker/src/routes/scanner.ts`

**What to do:**

**handleListScans:** Query `scan_results` for user, limit 50, order by `started_at DESC`.

**handleGetScan:** Fetch scan + findings, verify ownership, add rotation URLs.

**handleIgnoreFinding:** Fetch finding → verify ownership via scan → update `action='ignored'`.

**Commit:** `feat: add scan results routes (list, get, ignore finding)`

---

### Task 8: PR creation route

**Files:**
- Modify: `packages/worker/src/routes/scanner.ts`

**What to do:**

Implement `handleCreatePr`:
1. Validate input (array of { findingId, action: 'vaultproof' | 'todo' })
2. Get GitHub token
3. Get default branch + base commit SHA
4. Create feature branch `vaultproof/scan-{timestamp}`
5. For each finding, rewrite the file content based on mode+action
6. Create git blobs → tree → commit → update branch ref
7. Create PR with summary table
8. Update findings with `action='pr-created'` and `prUrl`

File rewriting rules:
- `sdk-init` + `vaultproof`: Replace provider env var, inject baseURL
- `http-url` + `vaultproof`: Replace provider domain with proxy URL
- `env-ref` + `vaultproof`: Replace env var name
- `.env` + `vaultproof`: Comment out old, add VAULTPROOF_API_KEY
- `hardcoded` + `todo`: Replace with `process.env.{NAME} /* TODO */`

**Commit:** `feat: add PR creation route to scanner worker`

---

### Task 9: Guided migration route

**Files:**
- Modify: `packages/worker/src/routes/scanner.ts`

**What to do:**

Implement `handleMigrate`:
1. Validate input (array of { findingId, action: 'store' | 'rewrite' | 'skip', rawKey? })
2. Ensure user has a developer key (create if needed)
3. For `action='store'`: Shamir split → encrypt shares → create key_slot
4. For `action='rewrite'`: Same file rewriting as create-pr
5. Create PR if any file changes
6. Update findings with appropriate action status

**Note:** This uses Shamir secret sharing from `packages/worker/src/crypto/shamir.ts` and the encryption module. Verify these work in the worker before implementing.

**Commit:** `feat: add guided migration route to scanner worker`

---

### Task 10: Wire routes, deploy, and test

**Files:**
- Modify: `packages/worker/wrangler.toml`

**What to do:**

1. Set GitHub secrets:
```bash
npx wrangler secret put GITHUB_CLIENT_ID --env staging
npx wrangler secret put GITHUB_CLIENT_SECRET --env staging
```

2. Deploy staging: `npx wrangler deploy --env staging`

3. Test all endpoints:
```bash
# Status (no connection)
curl -s https://staging-api.vaultproof.dev/api/v1/scanner/github/status -H 'Authorization: Bearer {token}'

# Connect (returns OAuth URL)
curl -s https://staging-api.vaultproof.dev/api/v1/scanner/github/connect -H 'Authorization: Bearer {token}'

# List scans
curl -s https://staging-api.vaultproof.dev/api/v1/scanner/scans -H 'Authorization: Bearer {token}'

# List repos (requires GitHub connection)
curl -s https://staging-api.vaultproof.dev/api/v1/scanner/repos -H 'Authorization: Bearer {token}'
```

4. Full flow test:
- Connect GitHub
- List repos
- Scan a test repo
- View results
- Create PR
- Verify PR on GitHub

**Commit:** `feat: deploy scanner to staging, add GitHub secrets`

---

## Resumption Guide

If interrupted, check progress:
```bash
cd /Users/nelson/projects/zkvault
git log --oneline -10
```

Look for the last scanner-related commit to know which task was completed. Each task has a unique commit message prefix. Resume from the next task number.

**Files created by this migration:**
- `packages/worker/src/routes/scanner.ts` — all 11 route handlers
- `packages/worker/src/lib/github.ts` — GitHub API helper + token encryption
- `packages/worker/src/lib/secret-patterns.ts` — regex patterns + detection helpers

**Files modified:**
- `packages/worker/src/types.ts` — 3 new env vars
- `packages/worker/src/index.ts` — scanner route wiring
- `packages/worker/wrangler.toml` — GITHUB_REDIRECT_URI var
