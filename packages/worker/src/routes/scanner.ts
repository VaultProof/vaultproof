import type { Env } from '../types.js';
import { authenticateUser } from '../lib/jwt-auth.js';
import { getSupabase } from '../lib/supabase.js';
import { githubApi, getGhToken, auditLog } from '../lib/github.js';
import { encrypt } from '../crypto/encryption.js';
import {
  KEY_PATTERNS,
  SDK_INIT_PATTERNS,
  HTTP_URL_REGEX,
  PROVIDER_URLS,
  PROCESS_ENV_REGEX,
  OS_ENVIRON_REGEX,
  ENV_VAR_MAP,
  PLATFORM_FILES,
  MAX_FILES,
  MAX_FILE_LINES,
  MAX_LINE_LENGTH,
  MIN_ENTROPY,
  shannonEntropy,
  detectProvider,
  shouldScanFile,
  recommendMode,
  verifyKey,
  getProviderInfo,
} from '../lib/secret-patterns.js';

const notImplemented = () =>
  Response.json({ error: 'Not implemented' }, { status: 501 });

/* ------------------------------------------------------------------ */
/*  GitHub OAuth helpers                                               */
/* ------------------------------------------------------------------ */

async function hmacSign(
  payload: string,
  key: string,
): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(payload));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacVerify(
  payload: string,
  signature: string,
  key: string,
): Promise<boolean> {
  const expected = await hmacSign(payload, key);
  // Constant-time comparison
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

async function handleGithubStatus(
  env: Env,
  user: { userId: string },
): Promise<Response> {
  const supabase = getSupabase(env);
  const { data, error } = await supabase
    .from('github_connections')
    .select('github_username, connected_at, scopes')
    .eq('user_id', user.userId)
    .is('disconnected_at', null)
    .limit(1)
    .single();

  if (error || !data) {
    return Response.json({ connected: false });
  }

  return Response.json({
    connected: true,
    githubUsername: data.github_username,
    connectedAt: data.connected_at,
    scopes: data.scopes,
  });
}

async function handleGithubConnect(
  env: Env,
  user: { userId: string },
): Promise<Response> {
  if (!env.GITHUB_CLIENT_ID) {
    return Response.json(
      { error: 'GitHub integration not configured' },
      { status: 503 },
    );
  }

  const payload = JSON.stringify({
    userId: user.userId,
    nonce: crypto.randomUUID(),
    ts: Date.now(),
  });
  const base64Payload = btoa(payload);
  const hmacHex = await hmacSign(base64Payload, env.VAULT_ENCRYPTION_KEY);
  const state = `${base64Payload}:${hmacHex}`;

  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: env.GITHUB_REDIRECT_URI,
    scope: 'repo',
    state,
  });

  return Response.json({
    url: `https://github.com/login/oauth/authorize?${params.toString()}`,
  });
}

async function handleGithubCallback(
  request: Request,
  env: Env,
  user: { userId: string },
): Promise<Response> {
  const body = (await request.json()) as { code?: string; state?: string };
  const { code, state } = body;

  if (!code || !state) {
    return Response.json(
      { error: 'Missing code or state' },
      { status: 400 },
    );
  }

  // --- Validate state (CSRF) ---
  const colonIdx = state.lastIndexOf(':');
  if (colonIdx === -1) {
    return Response.json({ error: 'Invalid state' }, { status: 400 });
  }
  const base64Payload = state.slice(0, colonIdx);
  const signature = state.slice(colonIdx + 1);

  const valid = await hmacVerify(
    base64Payload,
    signature,
    env.VAULT_ENCRYPTION_KEY,
  );
  if (!valid) {
    return Response.json({ error: 'Invalid state signature' }, { status: 400 });
  }

  let statePayload: { userId: string; nonce: string; ts: number };
  try {
    statePayload = JSON.parse(atob(base64Payload));
  } catch {
    return Response.json({ error: 'Malformed state payload' }, { status: 400 });
  }

  // Check expiry (15 minutes)
  if (Date.now() - statePayload.ts > 15 * 60 * 1000) {
    return Response.json({ error: 'State expired' }, { status: 400 });
  }

  // Check user match
  if (statePayload.userId !== user.userId) {
    return Response.json({ error: 'State user mismatch' }, { status: 400 });
  }

  // --- Exchange code for token ---
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: env.GITHUB_REDIRECT_URI,
    }),
  });

  const tokenData = (await tokenRes.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!tokenData.access_token) {
    return Response.json(
      { error: tokenData.error_description || 'Token exchange failed' },
      { status: 400 },
    );
  }

  const accessToken = tokenData.access_token;

  // --- Get GitHub username ---
  const ghUser = (await githubApi(accessToken, '/user')) as {
    login: string;
  };
  const githubUsername = ghUser.login;

  // --- Encrypt token ---
  const tokenBytes = new TextEncoder().encode(accessToken);
  const encryptedBytes = encrypt(tokenBytes, env);
  const encryptedB64 = Buffer.from(encryptedBytes).toString('base64');

  // --- Upsert connection ---
  const supabase = getSupabase(env);
  const now = new Date().toISOString();

  // Disconnect any existing connections
  await supabase
    .from('github_connections')
    .update({ disconnected_at: now })
    .eq('user_id', user.userId)
    .is('disconnected_at', null);

  // Create new connection
  const connId = crypto.randomUUID();
  const { error: insertError } = await supabase
    .from('github_connections')
    .insert({
      id: connId,
      user_id: user.userId,
      access_token: encryptedB64,
      github_username: githubUsername,
      connected_at: now,
      scopes: 'repo',
    });

  if (insertError) {
    console.error('github_connections insert failed:', insertError.message);
    return Response.json(
      { error: 'Failed to save connection' },
      { status: 500 },
    );
  }

  auditLog(env, user.userId, connId, 'github_connected', { githubUsername });

  return Response.json({ connected: true, githubUsername });
}

async function handleGithubDisconnect(
  env: Env,
  user: { userId: string },
): Promise<Response> {
  const supabase = getSupabase(env);
  const now = new Date().toISOString();

  await supabase
    .from('github_connections')
    .update({ disconnected_at: now })
    .eq('user_id', user.userId)
    .is('disconnected_at', null);

  auditLog(env, user.userId, '', 'github_disconnected');

  return Response.json({ connected: false });
}

/* ------------------------------------------------------------------ */
/*  Main router                                                        */
/* ------------------------------------------------------------------ */

export async function handleScanner(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  const user = await authenticateUser(request, env);
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const method = request.method;

  // github/status GET
  if (path === 'github/status' && method === 'GET') {
    return handleGithubStatus(env, user);
  }

  // github/connect GET
  if (path === 'github/connect' && method === 'GET') {
    return handleGithubConnect(env, user);
  }

  // github/callback POST
  if (path === 'github/callback' && method === 'POST') {
    return handleGithubCallback(request, env, user);
  }

  // github/disconnect DELETE
  if (path === 'github/disconnect' && method === 'DELETE') {
    return handleGithubDisconnect(env, user);
  }

  // repos GET
  if (path === 'repos' && method === 'GET') {
    return handleRepos(env, user);
  }

  // scans GET
  if (path === 'scans' && method === 'GET') {
    return handleListScans(env, user);
  }

  // scan POST
  if (path === 'scan' && method === 'POST') {
    return handleScan(request, env, user);
  }

  // scans/:scanId GET
  const scanIdMatch = path.match(/^scans\/([^/]+)$/);
  if (scanIdMatch && method === 'GET') {
    return handleGetScan(env, user, scanIdMatch[1]);
  }

  // findings/:findingId/ignore POST
  const findingIgnoreMatch = path.match(/^findings\/([^/]+)\/ignore$/);
  if (findingIgnoreMatch && method === 'POST') {
    return handleIgnoreFinding(env, user, findingIgnoreMatch[1]);
  }

  // scans/:scanId/create-pr POST
  const createPrMatch = path.match(/^scans\/([^/]+)\/create-pr$/);
  if (createPrMatch && method === 'POST') {
    return notImplemented();
  }

  // scans/:scanId/migrate POST
  const migrateMatch = path.match(/^scans\/([^/]+)\/migrate$/);
  if (migrateMatch && method === 'POST') {
    return notImplemented();
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}

// ── Scan ──

async function handleScan(
  request: Request,
  env: Env,
  user: { userId: string },
): Promise<Response> {
  // 1. Validate input
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { repoFullName, branch } = body as {
    repoFullName?: string;
    branch?: string;
  };
  if (
    !repoFullName ||
    !/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(repoFullName)
  ) {
    return Response.json({ error: 'Invalid input' }, { status: 400 });
  }

  // 2. Get GitHub token
  const gh = await getGhToken(env, user.userId);
  if (!gh) {
    return Response.json({ error: 'GitHub not connected' }, { status: 400 });
  }

  // 3. Create scan record
  const supabase = getSupabase(env);
  const scanId = crypto.randomUUID();
  const now = new Date().toISOString();
  const { error: insertErr } = await supabase.from('scan_results').insert({
    id: scanId,
    user_id: user.userId,
    repo_full_name: repoFullName,
    branch: branch || 'default',
    status: 'in_progress',
    started_at: now,
    keys_found: 0,
    keys_active: 0,
    keys_revoked: 0,
    platforms: [],
  });
  if (insertErr) {
    console.error('scan_results insert failed:', insertErr.message);
    return Response.json({ error: 'Failed to create scan' }, { status: 500 });
  }
  auditLog(env, user.userId, scanId, 'started_scan', { repoFullName });

  try {
    // 4. Fetch repo metadata
    const repo = await githubApi(gh.token, `/repos/${repoFullName}`);
    const targetBranch = branch || repo.default_branch;
    await supabase
      .from('scan_results')
      .update({ branch: targetBranch })
      .eq('id', scanId);

    // 5. Fetch file tree
    const tree = await githubApi(
      gh.token,
      `/repos/${repoFullName}/git/trees/${targetBranch}?recursive=1`,
    );
    const allTreeFiles = tree.tree as Array<{
      path: string;
      sha: string;
      type: string;
    }>;
    const scannableFiles = allTreeFiles
      .filter((f) => f.type === 'blob' && shouldScanFile(f.path))
      .slice(0, MAX_FILES);

    // 6. Detect platforms
    const allPaths = allTreeFiles.map((f) => f.path);
    const platformSet = new Set<string>();
    for (const filePath of allPaths) {
      const platform = PLATFORM_FILES[filePath];
      if (platform) platformSet.add(platform);
      if (filePath.startsWith('.github/workflows/'))
        platformSet.add('GitHub Actions');
    }
    const platforms = [...platformSet];

    // Internal findings array (raw values kept in memory only, never stored)
    const findings: Array<{
      envName: string;
      provider: string;
      file: string;
      line: number | null;
      mode: string;
      verified: string;
      source: string;
      maskedValue: string;
      value: string;
    }> = [];
    const seenValues = new Set<string>();

    // 7. Fetch file contents in batches of 10
    const BLOB_BATCH = 10;
    const fileContents: Array<{ path: string; content: string }> = [];
    for (let i = 0; i < scannableFiles.length; i += BLOB_BATCH) {
      const batch = scannableFiles.slice(i, i + BLOB_BATCH);
      const results = await Promise.all(
        batch.map(async (file) => {
          try {
            const blob = await githubApi(
              gh.token,
              `/repos/${repoFullName}/git/blobs/${file.sha}`,
            );
            const raw = atob(blob.content.replace(/\n/g, ''));
            if (raw.length > 500_000) return null;
            return { path: file.path, content: raw };
          } catch {
            return null;
          }
        }),
      );
      for (const r of results) {
        if (r) fileContents.push(r);
      }
    }

    // 8–10. Scan each file
    for (const file of fileContents) {
      const basename = file.path.split('/').pop() || '';
      const isEnvFile = basename === '.env' || basename.startsWith('.env.');

      if (isEnvFile) {
        // Phase A: .env files — parse KEY=VALUE pairs
        for (const line of file.content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx === -1) continue;
          const name = trimmed.slice(0, eqIdx).trim();
          let value = trimmed.slice(eqIdx + 1).trim();
          if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.slice(1, -1);
          }
          if (!value || value.length < 10 || seenValues.has(value)) continue;

          const provider = detectProvider(value);
          if (!provider && shannonEntropy(value) < MIN_ENTROPY) continue;

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
        const lines = file.content.split('\n');
        if (lines.length > MAX_FILE_LINES) continue;

        // Phase B: Hardcoded strings — match quoted strings against KEY_PATTERNS
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].length > MAX_LINE_LENGTH) continue;
          const stringMatches = lines[i].matchAll(
            /["'`]([^"'`]{10,512})["'`]/g,
          );
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

        // Phase C: Code-level — SDK inits, HTTP URLs, env var refs
        for (let i = 0; i < lines.length; i++) {
          const ln = lines[i];

          // SDK init patterns
          for (const { pattern, provider } of SDK_INIT_PATTERNS) {
            pattern.lastIndex = 0;
            let sdkMatch: RegExpExecArray | null;
            while ((sdkMatch = pattern.exec(ln)) !== null) {
              const snippet = ln
                .slice(sdkMatch.index, sdkMatch.index + 40)
                .trim();
              findings.push({
                envName: `${provider.toUpperCase()}_API_KEY`,
                provider,
                file: file.path,
                line: i + 1,
                mode: 'sdk-init',
                verified: 'unknown',
                source: 'current',
                maskedValue:
                  snippet.length > 36
                    ? snippet.slice(0, 36) + '...'
                    : snippet,
                value: '',
              });
            }
          }

          // HTTP URL patterns
          HTTP_URL_REGEX.lastIndex = 0;
          let urlMatch: RegExpExecArray | null;
          while ((urlMatch = HTTP_URL_REGEX.exec(ln)) !== null) {
            const host = urlMatch[1];
            const provider = PROVIDER_URLS[host];
            if (!provider) continue;
            const url =
              urlMatch[0].length > 60
                ? urlMatch[0].slice(0, 60) + '...'
                : urlMatch[0];
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

          // Env var references (process.env.X / os.environ["X"])
          PROCESS_ENV_REGEX.lastIndex = 0;
          let envMatch: RegExpExecArray | null;
          while ((envMatch = PROCESS_ENV_REGEX.exec(ln)) !== null) {
            const varName = envMatch[1];
            const provider = ENV_VAR_MAP[varName];
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
            const provider = ENV_VAR_MAP[varName];
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

    // 11. Scan git history (last 10 commits — reduced for Worker CPU limits)
    try {
      const commits = await githubApi(
        gh.token,
        `/repos/${repoFullName}/commits?sha=${targetBranch}&per_page=10`,
      );
      for (const commit of (commits as any[]).slice(0, 10)) {
        let detail: any;
        try {
          detail = await githubApi(
            gh.token,
            `/repos/${repoFullName}/commits/${commit.sha}`,
          );
        } catch {
          continue;
        }
        for (const file of detail.files || []) {
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
      // Git history scan failed — continue without it
    }

    // 12. Verify keys (max 20, batches of 5) — skip code-level findings
    const CODE_LEVEL_MODES = new Set(['sdk-init', 'http-url', 'env-ref']);
    const keyFindings = findings.filter((f) => !CODE_LEVEL_MODES.has(f.mode));
    for (let i = 0; i < Math.min(keyFindings.length, 20); i += 5) {
      const batch = keyFindings.slice(i, i + 5);
      await Promise.all(
        batch.map(async (f) => {
          f.verified = await verifyKey(f.value, f.provider);
        }),
      );
    }

    // Zero raw key values — only maskedValue persists
    for (const f of findings) {
      f.value = '';
    }

    // 13. Store findings
    for (const f of findings) {
      await supabase.from('scan_findings').insert({
        id: crypto.randomUUID(),
        scan_id: scanId,
        env_name: f.envName,
        provider: f.provider,
        file: f.file,
        line: f.line,
        mode: f.mode,
        verified: f.verified,
        source: f.source,
        action: 'pending',
        masked_value: f.maskedValue,
        created_at: new Date().toISOString(),
      });
    }

    // 14. Update scan result
    const keysActive = keyFindings.filter(
      (f) => f.verified === 'active',
    ).length;
    const keysRevoked = keyFindings.filter(
      (f) => f.verified === 'revoked',
    ).length;
    const keysFound = keyFindings.length;

    await supabase
      .from('scan_results')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        keys_found: keysFound,
        keys_active: keysActive,
        keys_revoked: keysRevoked,
        platforms,
      })
      .eq('id', scanId);
    auditLog(env, user.userId, scanId, 'completed_scan', {
      keysFound,
      keysActive,
      keysRevoked,
    });

    // 15. Return response
    return Response.json({
      scanId,
      status: 'completed',
      keysFound,
      keysActive,
      keysRevoked,
      platforms,
      findings: findings.map((f) => {
        const info = getProviderInfo(f.provider);
        return {
          envName: f.envName,
          provider: f.provider,
          file: f.file,
          line: f.line,
          mode: f.mode,
          verified: f.verified,
          source: f.source,
          maskedValue: f.maskedValue,
          rotationUrl: info.rotationUrl || null,
          providerName: info.name,
        };
      }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await supabase
      .from('scan_results')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: message,
      })
      .eq('id', scanId);
    auditLog(env, user.userId, scanId, 'failed_scan', { error: message });
    console.error('Scan failed:', scanId, message);
    return Response.json(
      {
        error:
          'Scan failed. Please try again or check your GitHub connection.',
      },
      { status: 500 },
    );
  }
}

// ── Repos ──

async function handleRepos(env: Env, user: { userId: string }): Promise<Response> {
  const gh = await getGhToken(env, user.userId);
  if (!gh) return Response.json({ error: 'No GitHub connection. Connect GitHub first.' }, { status: 400 });

  try {
    const repos = await githubApi(gh.token, '/user/repos?per_page=100&sort=updated&type=owner');
    return Response.json({
      repos: repos.map((r: any) => ({
        fullName: r.full_name,
        name: r.name,
        private: r.private,
        defaultBranch: r.default_branch,
        updatedAt: r.updated_at,
      })),
    });
  } catch (e: any) {
    return Response.json({ error: 'Failed to fetch repos from GitHub' }, { status: 502 });
  }
}

// ── Scan results ──

async function handleListScans(
  env: Env,
  user: { userId: string },
): Promise<Response> {
  const supabase = getSupabase(env);

  const { data, error } = await supabase
    .from('scan_results')
    .select('id, repo_full_name, branch, keys_found, keys_active, keys_revoked, status, started_at, completed_at')
    .eq('user_id', user.userId)
    .order('started_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('handleListScans error:', error.message);
    return Response.json({ error: 'Failed to fetch scans' }, { status: 500 });
  }

  return Response.json({
    scans: (data || []).map((s: any) => ({
      id: s.id,
      repoFullName: s.repo_full_name,
      branch: s.branch,
      keysFound: s.keys_found,
      keysActive: s.keys_active,
      keysRevoked: s.keys_revoked,
      status: s.status,
      startedAt: s.started_at,
      completedAt: s.completed_at,
    })),
  });
}

async function handleGetScan(
  env: Env,
  user: { userId: string },
  scanId: string,
): Promise<Response> {
  const supabase = getSupabase(env);

  // Fetch scan
  const { data: scan, error: scanError } = await supabase
    .from('scan_results')
    .select('*')
    .eq('id', scanId)
    .single();

  if (scanError || !scan) {
    return Response.json({ error: 'Scan not found' }, { status: 404 });
  }

  // Verify ownership
  if (scan.user_id !== user.userId) {
    return Response.json({ error: 'Scan not found' }, { status: 404 });
  }

  // Fetch findings
  const { data: findings, error: findingsError } = await supabase
    .from('scan_findings')
    .select('*')
    .eq('scan_id', scanId);

  if (findingsError) {
    console.error('handleGetScan findings error:', findingsError.message);
    return Response.json({ error: 'Failed to fetch findings' }, { status: 500 });
  }

  return Response.json({
    id: scan.id,
    repoFullName: scan.repo_full_name,
    branch: scan.branch,
    keysFound: scan.keys_found,
    keysActive: scan.keys_active,
    keysRevoked: scan.keys_revoked,
    status: scan.status,
    startedAt: scan.started_at,
    completedAt: scan.completed_at,
    errorMessage: scan.error_message,
    platforms: scan.platforms,
    findings: (findings || []).map((f: any) => {
      const info = getProviderInfo(f.provider);
      return {
        id: f.id,
        scanId: f.scan_id,
        envName: f.env_name,
        provider: f.provider,
        file: f.file,
        line: f.line,
        mode: f.mode,
        verified: f.verified,
        source: f.source,
        action: f.action,
        prUrl: f.pr_url,
        maskedValue: f.masked_value,
        createdAt: f.created_at,
        rotationUrl: info.rotationUrl,
        providerInfo: info,
      };
    }),
  });
}

async function handleIgnoreFinding(
  env: Env,
  user: { userId: string },
  findingId: string,
): Promise<Response> {
  const supabase = getSupabase(env);

  // Fetch finding
  const { data: finding, error: findingError } = await supabase
    .from('scan_findings')
    .select('id, scan_id')
    .eq('id', findingId)
    .single();

  if (findingError || !finding) {
    return Response.json({ error: 'Finding not found' }, { status: 404 });
  }

  // Fetch parent scan to verify ownership
  const { data: scan, error: scanError } = await supabase
    .from('scan_results')
    .select('user_id')
    .eq('id', finding.scan_id)
    .single();

  if (scanError || !scan || scan.user_id !== user.userId) {
    return Response.json({ error: 'Finding not found' }, { status: 404 });
  }

  // Update finding action
  const { error: updateError } = await supabase
    .from('scan_findings')
    .update({ action: 'ignored' })
    .eq('id', findingId);

  if (updateError) {
    console.error('handleIgnoreFinding update error:', updateError.message);
    return Response.json({ error: 'Failed to ignore finding' }, { status: 500 });
  }

  auditLog(env, user.userId, finding.scan_id, 'finding_ignored', { findingId });

  return Response.json({ success: true });
}
