import type { Env } from '../types.js';
import { authenticateUser } from '../lib/jwt-auth.js';
import { getSupabase } from '../lib/supabase.js';
import { githubApi, auditLog } from '../lib/github.js';
import { encrypt } from '../crypto/encryption.js';

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
    return notImplemented();
  }

  // scan POST
  if (path === 'scan' && method === 'POST') {
    return notImplemented();
  }

  // scans/:scanId GET
  const scanIdMatch = path.match(/^scans\/([^/]+)$/);
  if (scanIdMatch && method === 'GET') {
    return notImplemented();
  }

  // findings/:findingId/ignore POST
  const findingIgnoreMatch = path.match(/^findings\/([^/]+)\/ignore$/);
  if (findingIgnoreMatch && method === 'POST') {
    return notImplemented();
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
