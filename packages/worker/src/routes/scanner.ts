import type { Env } from '../types.js';
import { authenticateUser } from '../lib/jwt-auth.js';
import { getSupabase } from '../lib/supabase.js';
import { githubApi, getGhToken, auditLog } from '../lib/github.js';
import { encrypt } from '../crypto/encryption.js';
import { encryptShare2 } from '../crypto/share2.js';
import { splitString, serializeShare } from '../crypto/shamir.js';
import {
  ENV_VAR_MAP,
  PROVIDER_URLS,
  getProviderInfo,
} from '../lib/secret-patterns.js';
import { executeScan } from '../lib/scheduled-scan.js';
import { getAdapter } from '../lib/provider-adapters/index.js';
import { createSession, getSession } from '../lib/revoke-session.js';

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

  try {
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
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('GitHub callback error:', msg);
    return Response.json({ error: 'GitHub callback failed: ' + msg }, { status: 500 });
  }
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
/*  Key Revocation handlers                                            */
/* ------------------------------------------------------------------ */

async function handleRevokeAuthenticate(
  request: Request,
  env: Env,
  user: { userId: string },
): Promise<Response> {
  const body = await request.json() as { provider?: string; credentials?: { apiKey?: string } };
  if (!body.provider || !body.credentials) {
    return Response.json({ error: 'provider and credentials required' }, { status: 400 });
  }
  const adapter = getAdapter(body.provider);
  if (!adapter) {
    return Response.json({ error: `Unknown provider: ${body.provider}` }, { status: 400 });
  }
  const result = await adapter.authenticate(body.credentials);
  if (!result.authenticated) {
    return Response.json({ error: result.error || 'Authentication failed' }, { status: 401 });
  }
  const sessionToken = createSession(user.userId, body.provider, result.sessionData);
  auditLog(env, user.userId, '', 'revoke_authenticated', { provider: body.provider });
  return Response.json({ authenticated: true, sessionToken });
}

async function handleRevokeSingle(
  request: Request,
  env: Env,
  user: { userId: string },
): Promise<Response> {
  const body = await request.json() as { findingId?: string; sessionToken?: string };
  if (!body.findingId || !body.sessionToken) {
    return Response.json({ error: 'findingId and sessionToken required' }, { status: 400 });
  }
  const supabase = getSupabase(env);
  const { data: finding, error } = await supabase
    .from('scan_findings')
    .select('id, env_name, provider, masked_value, file, line, scan_id')
    .eq('id', body.findingId)
    .single();
  if (error || !finding) {
    return Response.json({ error: 'Finding not found' }, { status: 404 });
  }
  const { data: scan } = await supabase
    .from('scan_results')
    .select('user_id')
    .eq('id', finding.scan_id)
    .single();
  if (!scan || scan.user_id !== user.userId) {
    return Response.json({ error: 'Not authorized' }, { status: 403 });
  }
  const session = getSession(body.sessionToken, user.userId);
  if (!session) {
    return Response.json({ error: 'Session expired. Please re-authenticate.' }, { status: 401 });
  }
  const adapter = getAdapter(session.provider);
  if (!adapter) {
    return Response.json({ error: 'Provider not found' }, { status: 400 });
  }
  const findingRef = {
    id: finding.id,
    envName: finding.env_name,
    provider: finding.provider,
    maskedValue: finding.masked_value,
    file: finding.file,
    line: finding.line,
  };
  const steps = adapter.getSteps(findingRef);
  return Response.json({ findingId: finding.id, steps, currentStep: 0 });
}

async function handleRevokeBatch(
  request: Request,
  env: Env,
  user: { userId: string },
): Promise<Response> {
  const body = await request.json() as { findingIds?: string[]; sessionToken?: string };
  if (!body.findingIds?.length || !body.sessionToken) {
    return Response.json({ error: 'findingIds and sessionToken required' }, { status: 400 });
  }
  if (body.findingIds.length > 50) {
    return Response.json({ error: 'Maximum 50 findings per batch' }, { status: 400 });
  }
  const session = getSession(body.sessionToken, user.userId);
  if (!session) {
    return Response.json({ error: 'Session expired. Please re-authenticate.' }, { status: 401 });
  }
  const supabase = getSupabase(env);
  const { data: findings, error } = await supabase
    .from('scan_findings')
    .select('id, env_name, provider, masked_value, file, line, scan_id')
    .in('id', body.findingIds);
  if (error || !findings?.length) {
    return Response.json({ error: 'No findings found' }, { status: 404 });
  }
  const scanIds = [...new Set(findings.map(f => f.scan_id))];
  const { data: scans } = await supabase
    .from('scan_results')
    .select('id, user_id')
    .in('id', scanIds);
  const ownedScanIds = new Set((scans || []).filter(s => s.user_id === user.userId).map(s => s.id));
  const ownedFindings = findings.filter(f => ownedScanIds.has(f.scan_id));
  if (!ownedFindings.length) {
    return Response.json({ error: 'Not authorized' }, { status: 403 });
  }
  const adapter = getAdapter(session.provider);
  if (!adapter) {
    return Response.json({ error: 'Provider not found' }, { status: 400 });
  }
  const results = ownedFindings.map(f => {
    const ref = { id: f.id, envName: f.env_name, provider: f.provider, maskedValue: f.masked_value, file: f.file, line: f.line };
    return { findingId: f.id, steps: adapter.getSteps(ref), currentStep: 0 };
  });
  return Response.json({ results });
}

async function handleRevokeExecuteStep(
  request: Request,
  env: Env,
  user: { userId: string },
): Promise<Response> {
  const body = await request.json() as { findingId?: string; stepId?: string; sessionToken?: string };
  if (!body.findingId || !body.stepId || !body.sessionToken) {
    return Response.json({ error: 'findingId, stepId, and sessionToken required' }, { status: 400 });
  }
  const session = getSession(body.sessionToken, user.userId);
  if (!session) {
    return Response.json({ error: 'Session expired. Please re-authenticate.' }, { status: 401 });
  }
  const supabase = getSupabase(env);
  const { data: finding } = await supabase
    .from('scan_findings')
    .select('id, env_name, provider, masked_value, file, line, scan_id')
    .eq('id', body.findingId)
    .single();
  if (!finding) {
    return Response.json({ error: 'Finding not found' }, { status: 404 });
  }
  const { data: scan } = await supabase
    .from('scan_results')
    .select('user_id')
    .eq('id', finding.scan_id)
    .single();
  if (!scan || scan.user_id !== user.userId) {
    return Response.json({ error: 'Not authorized' }, { status: 403 });
  }
  const adapter = getAdapter(session.provider);
  if (!adapter) {
    return Response.json({ error: 'Provider not found' }, { status: 400 });
  }
  const findingRef = {
    id: finding.id,
    envName: finding.env_name,
    provider: finding.provider,
    maskedValue: finding.masked_value,
    file: finding.file,
    line: finding.line,
  };
  const steps = adapter.getSteps(findingRef);
  const stepIndex = steps.findIndex(s => s.id === body.stepId);
  if (stepIndex === -1) {
    return Response.json({ error: 'Step not found' }, { status: 400 });
  }
  const step = steps[stepIndex];

  // Manual steps are confirmed by the client — just advance
  if (step.type === 'manual') {
    const nextStep = stepIndex + 1 < steps.length ? stepIndex + 1 : undefined;
    return Response.json({ success: true, nextStep });
  }

  // Automated step: execute via adapter
  let result;
  if (step.id === 'revoke' || step.id === 'deactivate') {
    result = await adapter.revokeKey(
      { authenticated: true, sessionData: session.sessionData },
      findingRef,
    );
  } else if (step.id === 'create' && adapter.createKey) {
    result = await adapter.createKey(
      { authenticated: true, sessionData: session.sessionData },
      finding.env_name,
    );
  } else {
    result = { success: true };
  }

  if (!result.success) {
    auditLog(env, user.userId, finding.scan_id, 'revoke_step_failed', {
      findingId: finding.id, stepId: body.stepId, error: result.error,
    });
    return Response.json({ success: false, error: result.error });
  }

  auditLog(env, user.userId, finding.scan_id, 'revoke_step_completed', {
    findingId: finding.id, stepId: body.stepId,
  });
  const nextStep = stepIndex + 1 < steps.length ? stepIndex + 1 : undefined;
  return Response.json({
    success: true,
    nextStep,
    newKeyId: result.newKeyId,
    newKeyHint: result.newKeyHint,
  });
}

async function handleRevokeComplete(
  request: Request,
  env: Env,
  user: { userId: string },
): Promise<Response> {
  const body = await request.json() as { findingId?: string; sessionToken?: string };
  if (!body.findingId || !body.sessionToken) {
    return Response.json({ error: 'findingId and sessionToken required' }, { status: 400 });
  }
  const session = getSession(body.sessionToken, user.userId);
  if (!session) {
    return Response.json({ error: 'Session expired' }, { status: 401 });
  }
  const supabase = getSupabase(env);
  const { data: finding } = await supabase
    .from('scan_findings')
    .select('scan_id, provider')
    .eq('id', body.findingId)
    .single();
  if (!finding) {
    return Response.json({ error: 'Finding not found' }, { status: 404 });
  }
  const { data: scan } = await supabase
    .from('scan_results')
    .select('user_id')
    .eq('id', finding.scan_id)
    .single();
  if (!scan || scan.user_id !== user.userId) {
    return Response.json({ error: 'Not authorized' }, { status: 403 });
  }
  const { error } = await supabase
    .from('scan_findings')
    .update({ action: 'revoked' })
    .eq('id', body.findingId);
  if (error) {
    return Response.json({ error: 'Failed to update finding' }, { status: 500 });
  }
  auditLog(env, user.userId, finding.scan_id, 'key_revoked', {
    findingId: body.findingId, provider: finding.provider,
  });
  return Response.json({ revoked: true, offerMigration: true });
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

  // findings/bulk-ignore POST
  if (path === 'findings/bulk-ignore' && method === 'POST') {
    return handleBulkIgnore(request, env, user);
  }

  // findings/:findingId/ignore POST
  const findingIgnoreMatch = path.match(/^findings\/([^/]+)\/ignore$/);
  if (findingIgnoreMatch && method === 'POST') {
    return handleIgnoreFinding(env, user, findingIgnoreMatch[1]);
  }

  // scans/:scanId/create-pr POST
  const createPrMatch = path.match(/^scans\/([^/]+)\/create-pr$/);
  if (createPrMatch && method === 'POST') {
    return handleCreatePr(request, env, user, createPrMatch[1]);
  }

  // scans/:scanId/migrate POST
  const migrateMatch = path.match(/^scans\/([^/]+)\/migrate$/);
  if (migrateMatch && method === 'POST') {
    return handleMigrate(request, env, user, migrateMatch[1]);
  }

  // findings/:findingId/history-action POST
  const historyActionMatch = path.match(/^findings\/([^/]+)\/history-action$/);
  if (historyActionMatch && method === 'POST') {
    return handleHistoryAction(request, env, user, historyActionMatch[1]);
  }

  // allowlists GET
  if (path === 'allowlists' && method === 'GET') {
    return handleGetAllowlists(request, env, user);
  }

  // allowlists POST
  if (path === 'allowlists' && method === 'POST') {
    return handleCreateAllowlist(request, env, user);
  }

  // allowlists/:id DELETE
  const allowlistDeleteMatch = path.match(/^allowlists\/([^/]+)$/);
  if (allowlistDeleteMatch && method === 'DELETE') {
    return handleDeleteAllowlist(env, user, allowlistDeleteMatch[1]);
  }

  // revoke/authenticate POST
  if (path === 'revoke/authenticate' && method === 'POST') {
    return handleRevokeAuthenticate(request, env, user);
  }

  // revoke/single POST
  if (path === 'revoke/single' && method === 'POST') {
    return handleRevokeSingle(request, env, user);
  }

  // revoke/batch POST
  if (path === 'revoke/batch' && method === 'POST') {
    return handleRevokeBatch(request, env, user);
  }

  // revoke/execute-step POST
  if (path === 'revoke/execute-step' && method === 'POST') {
    return handleRevokeExecuteStep(request, env, user);
  }

  // revoke/complete POST
  if (path === 'revoke/complete' && method === 'POST') {
    return handleRevokeComplete(request, env, user);
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}

// ── Allowlists ──

async function handleGetAllowlists(
  request: Request,
  env: Env,
  user: { userId: string },
): Promise<Response> {
  const supabase = getSupabase(env);
  const url = new URL(request.url);
  const repo = url.searchParams.get('repo');

  let query = supabase
    .from('scan_allowlists')
    .select('*')
    .eq('user_id', user.userId)
    .order('created_at', { ascending: false });

  if (repo) {
    // Return entries that match this repo OR are global (null repo)
    query = query.or(`repo_full_name.eq.${repo},repo_full_name.is.null`);
  }

  const { data, error } = await query;
  if (error) {
    return Response.json({ error: 'Failed to fetch allowlists' }, { status: 500 });
  }
  return Response.json({ allowlists: data || [] });
}

async function handleCreateAllowlist(
  request: Request,
  env: Env,
  user: { userId: string },
): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { patternType, pattern, repo, reason } = body as {
    patternType?: string;
    pattern?: string;
    repo?: string;
    reason?: string;
  };

  if (!pattern || !pattern.trim()) {
    return Response.json({ error: 'Pattern is required' }, { status: 400 });
  }
  if (!patternType || !['file_path', 'env_name'].includes(patternType)) {
    return Response.json({ error: 'patternType must be file_path or env_name' }, { status: 400 });
  }

  const supabase = getSupabase(env);
  const id = crypto.randomUUID();
  const { data, error } = await supabase.from('scan_allowlists').insert({
    id,
    user_id: user.userId,
    repo_full_name: repo || null,
    pattern_type: patternType,
    pattern: pattern.trim(),
    reason: reason || null,
    created_at: new Date().toISOString(),
  }).select().single();

  if (error) {
    return Response.json({ error: 'Failed to create allowlist entry' }, { status: 500 });
  }

  auditLog(env, user.userId, '', 'allowlist.create', { id, patternType, pattern: pattern.trim(), repo: repo || null });

  return Response.json(data, { status: 201 });
}

async function handleDeleteAllowlist(
  env: Env,
  user: { userId: string },
  id: string,
): Promise<Response> {
  const supabase = getSupabase(env);

  // Verify ownership
  const { data: existing, error: fetchError } = await supabase
    .from('scan_allowlists')
    .select('id, user_id')
    .eq('id', id)
    .single();

  if (fetchError || !existing) {
    return Response.json({ error: 'Allowlist entry not found' }, { status: 404 });
  }
  if (existing.user_id !== user.userId) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { error } = await supabase
    .from('scan_allowlists')
    .delete()
    .eq('id', id);

  if (error) {
    return Response.json({ error: 'Failed to delete allowlist entry' }, { status: 500 });
  }

  auditLog(env, user.userId, '', 'allowlist.delete', { id });

  return Response.json({ success: true });
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
    // 4-14. Execute scan (fetch repo, scan files, verify, store findings)
    const result = await executeScan(env, user.userId, gh.token, repoFullName, branch, scanId);

    // 15. Return response
    return Response.json({
      scanId,
      status: 'completed',
      keysFound: result.keysFound,
      keysActive: result.keysActive,
      keysRevoked: result.keysRevoked,
      platforms: result.platforms,
      findings: result.findings.map((f) => {
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
        historyAction: f.history_action,
        prUrl: f.pr_url,
        maskedValue: f.masked_value,
        createdAt: f.created_at,
        rotationUrl: info.rotationUrl,
        providerInfo: info,
      };
    }),
  });
}

async function handleBulkIgnore(
  request: Request,
  env: Env,
  user: { userId: string },
): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { findingIds } = body as { findingIds?: string[] };
  if (
    !findingIds ||
    !Array.isArray(findingIds) ||
    findingIds.length === 0 ||
    findingIds.length > 100 ||
    !findingIds.every((id: any) => typeof id === 'string')
  ) {
    return Response.json(
      { error: 'findingIds must be a non-empty array of strings (max 100)' },
      { status: 400 },
    );
  }

  const supabase = getSupabase(env);

  // Fetch all requested findings with their scan IDs
  const { data: findings, error: findingsError } = await supabase
    .from('scan_findings')
    .select('id, scan_id')
    .in('id', findingIds);

  if (findingsError) {
    console.error('handleBulkIgnore fetch error:', findingsError.message);
    return Response.json({ error: 'Failed to fetch findings' }, { status: 500 });
  }

  if (!findings || findings.length === 0) {
    return Response.json({ ignored: 0 });
  }

  // Get unique scan IDs and verify ownership for all of them
  const scanIds = [...new Set(findings.map((f: any) => f.scan_id))];
  const { data: scans, error: scansError } = await supabase
    .from('scan_results')
    .select('id, user_id')
    .in('id', scanIds)
    .eq('user_id', user.userId);

  if (scansError) {
    console.error('handleBulkIgnore scans error:', scansError.message);
    return Response.json({ error: 'Failed to verify ownership' }, { status: 500 });
  }

  // Only include findings whose scans belong to this user
  const ownedScanIds = new Set((scans || []).map((s: any) => s.id));
  const ownedFindingIds = findings
    .filter((f: any) => ownedScanIds.has(f.scan_id))
    .map((f: any) => f.id);

  if (ownedFindingIds.length === 0) {
    return Response.json({ ignored: 0 });
  }

  // Bulk update
  const { error: updateError } = await supabase
    .from('scan_findings')
    .update({ action: 'ignored' })
    .in('id', ownedFindingIds);

  if (updateError) {
    console.error('handleBulkIgnore update error:', updateError.message);
    return Response.json({ error: 'Failed to ignore findings' }, { status: 500 });
  }

  // Audit log for each scan involved
  for (const scanId of ownedScanIds) {
    const idsForScan = findings
      .filter((f: any) => f.scan_id === scanId && ownedFindingIds.includes(f.id))
      .map((f: any) => f.id);
    auditLog(env, user.userId, scanId as string, 'findings_bulk_ignored', {
      findingIds: idsForScan,
      count: idsForScan.length,
    });
  }

  return Response.json({ ignored: ownedFindingIds.length });
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

// ── History Action (git-history findings) ──

async function handleHistoryAction(
  request: Request,
  env: Env,
  user: { userId: string },
  findingId: string,
): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { action } = body as { action?: string };
  const validActions = ['revoke-guided', 'store-rewrite', 'dismissed'];
  if (!action || !validActions.includes(action)) {
    return Response.json(
      { error: 'action must be one of: revoke-guided, store-rewrite, dismissed' },
      { status: 400 },
    );
  }

  const supabase = getSupabase(env);

  // Fetch finding and verify it is a git-history finding
  const { data: finding, error: findingError } = await supabase
    .from('scan_findings')
    .select('id, scan_id, source')
    .eq('id', findingId)
    .single();

  if (findingError || !finding) {
    return Response.json({ error: 'Finding not found' }, { status: 404 });
  }

  if (finding.source !== 'git-history') {
    return Response.json(
      { error: 'Only git-history findings support history actions' },
      { status: 400 },
    );
  }

  // Verify ownership via parent scan
  const { data: scan, error: scanError } = await supabase
    .from('scan_results')
    .select('user_id')
    .eq('id', finding.scan_id)
    .single();

  if (scanError || !scan || scan.user_id !== user.userId) {
    return Response.json({ error: 'Finding not found' }, { status: 404 });
  }

  // Update the history_action column
  const { error: updateError } = await supabase
    .from('scan_findings')
    .update({ history_action: action })
    .eq('id', findingId);

  if (updateError) {
    console.error('handleHistoryAction update error:', updateError.message);
    return Response.json({ error: 'Failed to update finding' }, { status: 500 });
  }

  auditLog(env, user.userId, finding.scan_id, 'history_action', {
    findingId,
    action,
  });

  return Response.json({ success: true, action });
}

// ── Create PR ──

async function handleCreatePr(
  request: Request,
  env: Env,
  user: { userId: string },
  scanId: string,
): Promise<Response> {
  // 1. Validate input
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { findings: findingActions } = body as {
    findings?: Array<{ findingId: string; action: 'vaultproof' | 'todo' }>;
  };
  if (
    !findingActions ||
    !Array.isArray(findingActions) ||
    findingActions.length === 0 ||
    !findingActions.every(
      (f: any) =>
        typeof f.findingId === 'string' &&
        (f.action === 'vaultproof' || f.action === 'todo'),
    )
  ) {
    return Response.json({ error: 'Invalid input' }, { status: 400 });
  }

  // 2. Verify scan ownership
  const supabase = getSupabase(env);
  const { data: scan, error: scanError } = await supabase
    .from('scan_results')
    .select('*')
    .eq('id', scanId)
    .single();

  if (scanError || !scan) {
    return Response.json({ error: 'Scan not found' }, { status: 404 });
  }
  if (scan.user_id !== user.userId) {
    return Response.json({ error: 'Scan not found' }, { status: 404 });
  }

  // 3. Get GitHub token
  const gh = await getGhToken(env, user.userId);
  if (!gh) {
    return Response.json({ error: 'GitHub not connected' }, { status: 400 });
  }

  // 4. Fetch findings from DB
  const { data: allFindings, error: findingsError } = await supabase
    .from('scan_findings')
    .select('*')
    .eq('scan_id', scanId);

  if (findingsError || !allFindings) {
    return Response.json({ error: 'Failed to fetch findings' }, { status: 500 });
  }

  try {
    // 5. Get default branch + base SHA
    const repo = await githubApi(gh.token, `/repos/${scan.repo_full_name}`);
    const defaultBranch = repo.default_branch;
    const ref = await githubApi(
      gh.token,
      `/repos/${scan.repo_full_name}/git/refs/heads/${defaultBranch}`,
    );
    const baseSha = ref.object.sha;

    // 6. Create feature branch
    const branchName = `vaultproof/scan-${Date.now()}`;
    await githubApi(gh.token, `/repos/${scan.repo_full_name}/git/refs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: baseSha,
      }),
    });

    // 7. Apply changes
    const changedFiles = new Map<string, string>();
    const processedFindings: Array<{
      envName: string;
      file: string;
      line: number | null;
      action: string;
    }> = [];

    // Build reverse map: provider → env var names
    const providerToEnvVars = new Map<string, string[]>();
    for (const [envName, provider] of Object.entries(ENV_VAR_MAP)) {
      const list = providerToEnvVars.get(provider) || [];
      list.push(envName);
      providerToEnvVars.set(provider, list);
    }

    const envExampleEntries: string[] = [];

    for (const fa of findingActions) {
      const finding = allFindings.find((f: any) => f.id === fa.findingId);
      if (!finding) continue;

      // For git-history findings, add a .env.example entry instead of modifying code
      if (finding.source === 'git-history') {
        const info = getProviderInfo(finding.provider);
        envExampleEntries.push(
          `# ${info.name} key found in git history — store in VaultProof instead`,
        );
        envExampleEntries.push(
          `# ${finding.env_name || finding.provider.toUpperCase() + '_API_KEY'}=<store-in-vaultproof>`,
        );
        processedFindings.push({
          envName: finding.env_name || finding.provider.toUpperCase() + '_API_KEY',
          file: '.env.example',
          line: null,
          action: 'git-history → documented',
        });
        continue;
      }

      // Fetch file content if not already cached
      if (!changedFiles.has(finding.file)) {
        try {
          const fileData = await githubApi(
            gh.token,
            `/repos/${scan.repo_full_name}/contents/${finding.file}?ref=${defaultBranch}`,
          );
          const decoded = atob(fileData.content.replace(/\n/g, ''));
          changedFiles.set(finding.file, decoded);
        } catch {
          continue;
        }
      }

      let content = changedFiles.get(finding.file)!;
      const isEnvFile =
        finding.file.endsWith('.env') || finding.file.includes('.env.');

      if (finding.mode === 'sdk-init' && fa.action === 'vaultproof') {
        // SDK init rewriting: inject baseURL and swap apiKey
        const proxyBase = `https://api.vaultproof.dev/v1/${finding.provider}`;

        if (finding.line) {
          const lines = content.split('\n');
          const lineIdx = finding.line - 1;

          // Find extent of constructor call (may span multiple lines)
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

          // Replace provider-specific env vars with VAULTPROOF_API_KEY
          const providerEnvVars = providerToEnvVars.get(finding.provider) || [
            `${finding.provider.toUpperCase()}_API_KEY`,
          ];
          for (const envVar of providerEnvVars) {
            block = block.replace(
              new RegExp(`process\\.env\\.${envVar}`, 'g'),
              'process.env.VAULTPROOF_API_KEY',
            );
            block = block.replace(
              new RegExp(`os\\.environ\\[["']${envVar}["']\\]`, 'g'),
              'os.environ["VAULTPROOF_API_KEY"]',
            );
          }

          // Inject baseURL if not already present
          if (!block.includes('baseURL') && !block.includes('base_url')) {
            const braceMatch = block.match(/new\s+\w+\s*\(\s*\{/);
            if (braceMatch && braceMatch.index !== undefined) {
              const afterBrace = block.slice(
                braceMatch.index + braceMatch[0].length,
              );
              if (afterBrace.trim().startsWith('}')) {
                block = block.replace(
                  /new\s+(\w+)\s*\(\s*\{\s*\}/,
                  `new $1({ baseURL: '${proxyBase}' }`,
                );
              } else {
                block = block.replace(
                  /(new\s+\w+\s*\(\s*\{)/,
                  `$1 baseURL: '${proxyBase}',`,
                );
              }
            } else {
              // Python pattern
              const pyMatch = block.match(/\(\s*api_key\s*=/);
              if (pyMatch) {
                block = block.replace(
                  /\(\s*(api_key\s*=)/,
                  `(base_url="${proxyBase}", $1`,
                );
              }
            }
          }

          const newBlockLines = block.split('\n');
          lines.splice(blockStart, blockEnd - blockStart + 1, ...newBlockLines);
          content = lines.join('\n');
        }

        changedFiles.set(finding.file, content);
        processedFindings.push({
          envName: finding.env_name,
          file: finding.file,
          line: finding.line,
          action: 'sdk-init → proxy',
        });
      } else if (finding.mode === 'http-url' && fa.action === 'vaultproof') {
        // HTTP URL rewriting: replace provider domains with VaultProof proxy
        if (finding.line) {
          const lines = content.split('\n');
          const lineIdx = finding.line - 1;
          if (lineIdx < lines.length) {
            for (const [domain, provider] of Object.entries(PROVIDER_URLS)) {
              const domainRegex = new RegExp(
                `https?://${domain.replace(/\./g, '\\.')}`,
                'g',
              );
              lines[lineIdx] = lines[lineIdx].replace(
                domainRegex,
                `https://api.vaultproof.dev/v1/${provider}`,
              );
            }
            content = lines.join('\n');
          }
        }

        changedFiles.set(finding.file, content);
        processedFindings.push({
          envName: finding.env_name,
          file: finding.file,
          line: finding.line,
          action: 'url → proxy',
        });
      } else if (finding.mode === 'env-ref' && fa.action === 'vaultproof') {
        // Env var reference rewriting
        if (finding.line) {
          const lines = content.split('\n');
          const lineIdx = finding.line - 1;
          if (lineIdx < lines.length) {
            lines[lineIdx] = lines[lineIdx].replace(
              new RegExp(`process\\.env\\.${finding.env_name}`, 'g'),
              'process.env.VAULTPROOF_API_KEY',
            );
            lines[lineIdx] = lines[lineIdx].replace(
              new RegExp(
                `os\\.environ\\[["']${finding.env_name}["']\\]`,
                'g',
              ),
              'os.environ["VAULTPROOF_API_KEY"]',
            );
            content = lines.join('\n');
          }
        }

        changedFiles.set(finding.file, content);
        processedFindings.push({
          envName: finding.env_name,
          file: finding.file,
          line: finding.line,
          action: 'env → VAULTPROOF_API_KEY',
        });
      } else if (isEnvFile && fa.action === 'vaultproof') {
        // .env file rewriting: comment out old key, add VAULTPROOF_API_KEY
        const lines = content.split('\n');
        const alreadyHasVaultproof = lines.some((l: string) =>
          l.trim().startsWith('VAULTPROOF_API_KEY='),
        );

        for (let i = 0; i < lines.length; i++) {
          const trimmed = lines[i].trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx === -1) continue;
          const varName = trimmed.slice(0, eqIdx).trim();
          if (varName === finding.env_name) {
            lines[i] = `# ${varName} — secured by VaultProof proxy`;
            break;
          }
        }

        if (!alreadyHasVaultproof) {
          lines.push('VAULTPROOF_API_KEY=vp_live_xxx');
        }

        content = lines.join('\n');
        changedFiles.set(finding.file, content);
        processedFindings.push({
          envName: finding.env_name,
          file: finding.file,
          line: finding.line,
          action: 'env-file → proxy',
        });
      } else {
        // Hardcoded key replacement (vaultproof or todo)
        const replacement =
          fa.action === 'vaultproof'
            ? `process.env.${finding.env_name}`
            : `process.env.${finding.env_name} /* TODO: Set ${finding.env_name} in your environment */`;

        if (finding.line) {
          const lines = content.split('\n');
          const lineIdx = finding.line - 1;
          if (lineIdx < lines.length) {
            lines[lineIdx] = lines[lineIdx].replace(
              /["'`][^"'`]{10,512}["'`]/g,
              replacement,
            );
            content = lines.join('\n');
          }
        }

        changedFiles.set(finding.file, content);
        processedFindings.push({
          envName: finding.env_name,
          file: finding.file,
          line: finding.line,
          action: fa.action,
        });
      }
    }

    // Add .env.example entries for git-history findings
    if (envExampleEntries.length > 0) {
      let envExample = '';
      // Try to fetch existing .env.example
      try {
        const fileData = await githubApi(
          gh.token,
          `/repos/${scan.repo_full_name}/contents/.env.example?ref=${defaultBranch}`,
        );
        envExample = atob(fileData.content.replace(/\n/g, ''));
      } catch {
        // File doesn't exist yet, start fresh
        envExample = '# Environment Variables\n# See https://vaultproof.dev for secure key management\n';
      }
      envExample += '\n' + envExampleEntries.join('\n') + '\n';
      changedFiles.set('.env.example', envExample);
    }

    if (changedFiles.size === 0 && processedFindings.length === 0) {
      return Response.json({ error: 'No changes to apply' }, { status: 400 });
    }

    // 8. Determine if proxy rewrites were applied
    const PROXY_ACTIONS = new Set([
      'sdk-init → proxy',
      'url → proxy',
      'env → VAULTPROOF_API_KEY',
      'env-file → proxy',
    ]);
    const hasProxyFindings = processedFindings.some((pf) =>
      PROXY_ACTIONS.has(pf.action),
    );

    // 9. Create tree + commit via GitHub Git Data API
    const treeItems: Array<{
      path: string;
      mode: string;
      type: string;
      sha: string;
    }> = [];
    for (const [filePath, content] of changedFiles) {
      const blob = await githubApi(
        gh.token,
        `/repos/${scan.repo_full_name}/git/blobs`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, encoding: 'utf-8' }),
        },
      );
      treeItems.push({
        path: filePath,
        mode: '100644',
        type: 'blob',
        sha: blob.sha,
      });
    }

    const newTree = await githubApi(
      gh.token,
      `/repos/${scan.repo_full_name}/git/trees`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base_tree: baseSha, tree: treeItems }),
      },
    );

    const commitMessage = hasProxyFindings
      ? 'fix: secure API keys via VaultProof proxy (VaultProof Scanner)'
      : 'fix: remove exposed API keys (VaultProof Scanner)';

    const commit = await githubApi(
      gh.token,
      `/repos/${scan.repo_full_name}/git/commits`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: commitMessage,
          tree: newTree.sha,
          parents: [baseSha],
        }),
      },
    );

    await githubApi(
      gh.token,
      `/repos/${scan.repo_full_name}/git/refs/heads/${branchName}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sha: commit.sha }),
      },
    );

    // 10. Build PR body
    const historyFindings = allFindings.filter(
      (f: any) => f.source === 'git-history',
    );
    const historyWarning =
      historyFindings.length > 0
        ? `\n## Git History Warning\n\nThe following keys were also found in git commit history. Removing them from source code does not remove them from history.\n\n**Action required — rotate these keys immediately:**\n${historyFindings
            .map((f: any) => {
              const info = getProviderInfo(f.provider);
              return `- \`${f.env_name}\` (${f.masked_value}) — [Rotate](${info.rotationUrl || '#'})`;
            })
            .join('\n')}\n`
        : '';

    const uniqueEnvNames = [
      ...new Set(processedFindings.map((pf) => pf.envName)),
    ].filter((n) => n !== 'VAULTPROOF_API_KEY');

    const prBody = `## Secured API Keys with VaultProof

This PR secures API keys found by [VaultProof Scanner](https://vaultproof.dev).${hasProxyFindings ? ' SDK initializations, HTTP URLs, and environment variable references have been rewritten to use the VaultProof transparent proxy.' : ''}

| Key | File | Action |
|-----|------|--------|
${processedFindings
  .map((pf) => {
    const desc =
      pf.action === 'sdk-init → proxy'
        ? 'Rewritten to use VaultProof proxy'
        : pf.action === 'url → proxy'
          ? 'URL redirected through VaultProof proxy'
          : pf.action === 'env → VAULTPROOF_API_KEY'
            ? 'Replaced with \`VAULTPROOF_API_KEY\`'
            : pf.action === 'env-file → proxy'
              ? 'Commented out, added \`VAULTPROOF_API_KEY\`'
              : `Replaced with \`process.env.${pf.envName}\``;
    return `| \`${pf.envName}\` | ${pf.file}${pf.line ? `:${pf.line}` : ''} | ${desc} |`;
  })
  .join('\n')}
${historyWarning}
## Setup

${hasProxyFindings ? `1. Add your VaultProof API key to your hosting provider:\n   - \`VAULTPROOF_API_KEY\` — get this from [VaultProof Dashboard](https://vaultproof.dev/app/keys)\n\n2. ` : ''}Set these environment variables in your hosting provider:
${uniqueEnvNames.map((name) => `- \`${name}\``).join('\n')}

---
*This PR was created by VaultProof Scanner with your approval.*
*VaultProof is not responsible for code modifications you approve and merge.*`;

    // 11. Create PR
    const pr = await githubApi(
      gh.token,
      `/repos/${scan.repo_full_name}/pulls`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: hasProxyFindings
            ? 'fix: secure API keys via VaultProof proxy (VaultProof Scanner)'
            : 'fix: remove exposed API keys (VaultProof Scanner)',
          body: prBody,
          head: branchName,
          base: defaultBranch,
        }),
      },
    );

    // 12. Update findings in DB
    for (const fa of findingActions) {
      await supabase
        .from('scan_findings')
        .update({ action: 'pr-created', pr_url: pr.html_url })
        .eq('id', fa.findingId);
    }

    auditLog(env, user.userId, scanId, 'created_pr', {
      prUrl: pr.html_url,
      prNumber: pr.number,
      findingsCount: processedFindings.length,
    });

    return Response.json({ prUrl: pr.html_url, prNumber: pr.number });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('create-pr failed:', scanId, message);
    return Response.json(
      { error: 'Failed to create PR. Please try again.' },
      { status: 500 },
    );
  }
}

// ── Migrate (guided migration: store keys + create dev key + create PR) ──

async function handleMigrate(
  request: Request,
  env: Env,
  user: { userId: string },
  scanId: string,
): Promise<Response> {
  // 1. Validate input
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { findings: findingActions } = body as {
    findings?: Array<{
      findingId: string;
      action: 'store' | 'rewrite' | 'skip';
      rawKey?: string;
    }>;
  };

  if (
    !findingActions ||
    !Array.isArray(findingActions) ||
    findingActions.length === 0 ||
    !findingActions.every(
      (f: any) =>
        typeof f.findingId === 'string' &&
        (f.action === 'store' || f.action === 'rewrite' || f.action === 'skip'),
    )
  ) {
    return Response.json({ error: 'Invalid input' }, { status: 400 });
  }

  // Validate: 'store' action requires rawKey
  for (const f of findingActions) {
    if (f.action === 'store' && !f.rawKey) {
      return Response.json(
        { error: `Finding ${f.findingId} has action 'store' but no rawKey provided` },
        { status: 400 },
      );
    }
  }

  // 2. Verify scan ownership
  const supabase = getSupabase(env);
  const { data: scan, error: scanError } = await supabase
    .from('scan_results')
    .select('*')
    .eq('id', scanId)
    .single();

  if (scanError || !scan) {
    return Response.json({ error: 'Scan not found' }, { status: 404 });
  }
  if (scan.user_id !== user.userId) {
    return Response.json({ error: 'Scan not found' }, { status: 404 });
  }

  // 3. Get GitHub token
  const gh = await getGhToken(env, user.userId);
  if (!gh) {
    return Response.json({ error: 'GitHub not connected' }, { status: 400 });
  }

  // 4. Fetch findings from DB
  const { data: allFindings, error: findingsError } = await supabase
    .from('scan_findings')
    .select('*')
    .eq('scan_id', scanId);

  if (findingsError || !allFindings) {
    return Response.json({ error: 'Failed to fetch findings' }, { status: 500 });
  }

  try {
    // ── Step 1: Ensure user has a developer key ─────────────────────
    let vpLiveKey: string | undefined;
    let devKeyCreated = false;

    // Check rate limit: max 5 non-revoked keys
    const { count: keyCount } = await supabase
      .from('developer_keys')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.userId)
      .is('revoked_at', null);

    if ((keyCount ?? 0) >= 5) {
      return Response.json(
        {
          error:
            'Maximum 5 developer keys per account. Revoke unused keys to proceed with migration.',
        },
        { status: 429 },
      );
    }

    // Auto-create a developer key for share2 encryption
    const randomBytes = crypto.getRandomValues(new Uint8Array(24));
    let base64url = '';
    {
      let binary = '';
      for (let i = 0; i < randomBytes.length; i++)
        binary += String.fromCharCode(randomBytes[i]);
      base64url = btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    }
    vpLiveKey = `vp_live_${base64url}`;

    // Hash with SHA-256
    const keyHashBuf = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(vpLiveKey),
    );
    const keyHash = [...new Uint8Array(keyHashBuf)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const maskedKey = vpLiveKey.slice(0, 12) + '...' + vpLiveKey.slice(-4);

    const { error: devKeyError } = await supabase
      .from('developer_keys')
      .insert({
        id: crypto.randomUUID(),
        user_id: user.userId,
        key: maskedKey,
        key_hash: keyHash,
        label: 'Auto-created by Scanner Migration',
        mode: 'live',
      });

    if (devKeyError) {
      console.error('developer_keys insert failed:', devKeyError.message);
      return Response.json(
        { error: 'Failed to create developer key' },
        { status: 500 },
      );
    }
    devKeyCreated = true;

    // ── Step 2: Store keys for findings with action 'store' ─────────
    const storedKeys: Array<{
      keyId: string;
      provider: string;
      label: string;
    }> = [];

    for (const fa of findingActions) {
      if (fa.action !== 'store' || !fa.rawKey) continue;

      const finding = allFindings.find((f: any) => f.id === fa.findingId);
      if (!finding) continue;

      try {
        // Shamir split: 2-of-2
        const shares = splitString(fa.rawKey, 2, 2);

        // Encrypt share1 with server key (VAULT_ENCRYPTION_KEY)
        const share1Serialized = serializeShare(shares[0]);
        const share1Encrypted = encrypt(
          new TextEncoder().encode(share1Serialized),
          env,
        );

        // Encrypt share2 with user's vp_live_ key
        const share2Serialized = serializeShare(shares[1]);
        const share2Encrypted = await encryptShare2(
          share2Serialized,
          vpLiveKey!,
        );

        const commitment = crypto.randomUUID().replace(/-/g, '') +
          crypto.randomUUID().replace(/-/g, '');
        const authAppsRoot = crypto.randomUUID().replace(/-/g, '') +
          crypto.randomUUID().replace(/-/g, '');

        const keySlotId = crypto.randomUUID();
        const label = finding.env_name || `${finding.provider} key`;

        const { error: slotError } = await supabase
          .from('key_slots')
          .insert({
            id: keySlotId,
            user_id: user.userId,
            provider: finding.provider,
            label,
            share1_encrypted: Buffer.from(share1Encrypted).toString('base64'),
            share2_encrypted: Buffer.from(share2Encrypted).toString('base64'),
            vault_commitment: commitment,
            auth_apps_root: authAppsRoot,
          });

        if (slotError) {
          console.error('key_slots insert failed:', slotError.message);
          continue;
        }

        storedKeys.push({
          keyId: keySlotId,
          provider: finding.provider,
          label,
        });
      } finally {
        // Zero the raw key from the input object
        if (fa.rawKey) {
          (fa as any).rawKey = '';
        }
      }
    }

    // ── Step 3: Prepare PR changes (rewrite findings) ─────────────
    const repo = await githubApi(gh.token, `/repos/${scan.repo_full_name}`);
    const defaultBranch = repo.default_branch;
    const ref = await githubApi(
      gh.token,
      `/repos/${scan.repo_full_name}/git/refs/heads/${defaultBranch}`,
    );
    const baseSha = ref.object.sha;

    const branchName = `vaultproof/migrate-${Date.now()}`;
    await githubApi(gh.token, `/repos/${scan.repo_full_name}/git/refs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: baseSha,
      }),
    });

    const changedFiles = new Map<string, string>();
    const processedFindings: Array<{
      envName: string;
      file: string;
      line: number | null;
      action: string;
    }> = [];

    // Build reverse map: provider → env var names
    const providerToEnvVars = new Map<string, string[]>();
    for (const [envName, provider] of Object.entries(ENV_VAR_MAP)) {
      const list = providerToEnvVars.get(provider) || [];
      list.push(envName);
      providerToEnvVars.set(provider, list);
    }

    const migrateEnvExampleEntries: string[] = [];

    for (const fa of findingActions) {
      if (fa.action === 'skip') continue;

      const finding = allFindings.find((f: any) => f.id === fa.findingId);
      if (!finding) continue;

      // For git-history findings, add a .env.example entry documenting the key
      if (finding.source === 'git-history') {
        const info = getProviderInfo(finding.provider);
        migrateEnvExampleEntries.push(
          `# ${info.name} key found in git history — store in VaultProof instead`,
        );
        migrateEnvExampleEntries.push(
          `# ${finding.env_name || finding.provider.toUpperCase() + '_API_KEY'}=<store-in-vaultproof>`,
        );
        processedFindings.push({
          envName: finding.env_name || finding.provider.toUpperCase() + '_API_KEY',
          file: '.env.example',
          line: null,
          action: 'git-history → documented',
        });
        continue;
      }

      // For 'store' action without a rewrite target, skip file changes
      if (fa.action === 'store' && !finding.line && !finding.file.endsWith('.env') && !finding.file.includes('.env.')) {
        continue;
      }

      // Fetch file content if not already cached
      if (!changedFiles.has(finding.file)) {
        try {
          const fileData = await githubApi(
            gh.token,
            `/repos/${scan.repo_full_name}/contents/${finding.file}?ref=${defaultBranch}`,
          );
          const decoded = atob(fileData.content.replace(/\n/g, ''));
          changedFiles.set(finding.file, decoded);
        } catch {
          continue;
        }
      }

      let content = changedFiles.get(finding.file)!;
      const isEnvFile =
        finding.file.endsWith('.env') || finding.file.includes('.env.');

      if (finding.mode === 'sdk-init') {
        // SDK init rewriting: inject baseURL and swap apiKey
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

          const providerEnvVars = providerToEnvVars.get(finding.provider) || [
            `${finding.provider.toUpperCase()}_API_KEY`,
          ];
          for (const envVar of providerEnvVars) {
            block = block.replace(
              new RegExp(`process\\.env\\.${envVar}`, 'g'),
              'process.env.VAULTPROOF_API_KEY',
            );
            block = block.replace(
              new RegExp(`os\\.environ\\[["']${envVar}["']\\]`, 'g'),
              'os.environ["VAULTPROOF_API_KEY"]',
            );
          }

          if (!block.includes('baseURL') && !block.includes('base_url')) {
            const braceMatch = block.match(/new\s+\w+\s*\(\s*\{/);
            if (braceMatch && braceMatch.index !== undefined) {
              const afterBrace = block.slice(
                braceMatch.index + braceMatch[0].length,
              );
              if (afterBrace.trim().startsWith('}')) {
                block = block.replace(
                  /new\s+(\w+)\s*\(\s*\{\s*\}/,
                  `new $1({ baseURL: '${proxyBase}' }`,
                );
              } else {
                block = block.replace(
                  /(new\s+\w+\s*\(\s*\{)/,
                  `$1 baseURL: '${proxyBase}',`,
                );
              }
            } else {
              const pyMatch = block.match(/\(\s*api_key\s*=/);
              if (pyMatch) {
                block = block.replace(
                  /\(\s*(api_key\s*=)/,
                  `(base_url="${proxyBase}", $1`,
                );
              }
            }
          }

          const newBlockLines = block.split('\n');
          lines.splice(blockStart, blockEnd - blockStart + 1, ...newBlockLines);
          content = lines.join('\n');
        }

        changedFiles.set(finding.file, content);
        processedFindings.push({
          envName: finding.env_name,
          file: finding.file,
          line: finding.line,
          action: 'sdk-init → proxy',
        });
      } else if (finding.mode === 'http-url') {
        // HTTP URL rewriting
        if (finding.line) {
          const lines = content.split('\n');
          const lineIdx = finding.line - 1;
          if (lineIdx < lines.length) {
            for (const [domain, provider] of Object.entries(PROVIDER_URLS)) {
              const domainRegex = new RegExp(
                `https?://${domain.replace(/\./g, '\\.')}`,
                'g',
              );
              lines[lineIdx] = lines[lineIdx].replace(
                domainRegex,
                `https://api.vaultproof.dev/v1/${provider}`,
              );
            }
            content = lines.join('\n');
          }
        }

        changedFiles.set(finding.file, content);
        processedFindings.push({
          envName: finding.env_name,
          file: finding.file,
          line: finding.line,
          action: 'url → proxy',
        });
      } else if (finding.mode === 'env-ref') {
        // Env var reference rewriting
        if (finding.line) {
          const lines = content.split('\n');
          const lineIdx = finding.line - 1;
          if (lineIdx < lines.length) {
            lines[lineIdx] = lines[lineIdx].replace(
              new RegExp(`process\\.env\\.${finding.env_name}`, 'g'),
              'process.env.VAULTPROOF_API_KEY',
            );
            lines[lineIdx] = lines[lineIdx].replace(
              new RegExp(
                `os\\.environ\\[["']${finding.env_name}["']\\]`,
                'g',
              ),
              'os.environ["VAULTPROOF_API_KEY"]',
            );
            content = lines.join('\n');
          }
        }

        changedFiles.set(finding.file, content);
        processedFindings.push({
          envName: finding.env_name,
          file: finding.file,
          line: finding.line,
          action: 'env → VAULTPROOF_API_KEY',
        });
      } else if (isEnvFile) {
        // .env file rewriting
        const lines = content.split('\n');
        const alreadyHasVaultproof = lines.some((l: string) =>
          l.trim().startsWith('VAULTPROOF_API_KEY='),
        );

        for (let i = 0; i < lines.length; i++) {
          const trimmed = lines[i].trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx === -1) continue;
          const varName = trimmed.slice(0, eqIdx).trim();
          if (varName === finding.env_name) {
            lines[i] = `# ${varName} — secured by VaultProof proxy`;
            break;
          }
        }

        if (!alreadyHasVaultproof) {
          lines.push('VAULTPROOF_API_KEY=vp_live_xxx');
        }

        content = lines.join('\n');
        changedFiles.set(finding.file, content);
        processedFindings.push({
          envName: finding.env_name,
          file: finding.file,
          line: finding.line,
          action: 'env-file → proxy',
        });
      } else {
        // Hardcoded key replacement
        const replacement = `process.env.${finding.env_name}`;

        if (finding.line) {
          const lines = content.split('\n');
          const lineIdx = finding.line - 1;
          if (lineIdx < lines.length) {
            lines[lineIdx] = lines[lineIdx].replace(
              /["'`][^"'`]{10,512}["'`]/g,
              replacement,
            );
            content = lines.join('\n');
          }
        }

        changedFiles.set(finding.file, content);
        processedFindings.push({
          envName: finding.env_name,
          file: finding.file,
          line: finding.line,
          action: 'vaultproof',
        });
      }
    }

    // Add .env.example entries for git-history findings
    if (migrateEnvExampleEntries.length > 0) {
      let envExample = '';
      try {
        const fileData = await githubApi(
          gh.token,
          `/repos/${scan.repo_full_name}/contents/.env.example?ref=${defaultBranch}`,
        );
        envExample = atob(fileData.content.replace(/\n/g, ''));
      } catch {
        envExample = '# Environment Variables\n# See https://vaultproof.dev for secure key management\n';
      }
      envExample += '\n' + migrateEnvExampleEntries.join('\n') + '\n';
      changedFiles.set('.env.example', envExample);
    }

    if (changedFiles.size === 0 && storedKeys.length === 0) {
      return Response.json(
        { error: 'No changes to apply — all findings were skipped' },
        { status: 400 },
      );
    }

    // ── Step 4: Create PR if there are code changes ─────────────────
    let prUrl = '';
    let prNumber = 0;

    if (changedFiles.size > 0) {
      const PROXY_ACTIONS = new Set([
        'sdk-init → proxy',
        'url → proxy',
        'env → VAULTPROOF_API_KEY',
        'env-file → proxy',
      ]);
      const hasProxyFindings = processedFindings.some((pf) =>
        PROXY_ACTIONS.has(pf.action),
      );

      const treeItems: Array<{
        path: string;
        mode: string;
        type: string;
        sha: string;
      }> = [];
      for (const [filePath, content] of changedFiles) {
        const blob = await githubApi(
          gh.token,
          `/repos/${scan.repo_full_name}/git/blobs`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content, encoding: 'utf-8' }),
          },
        );
        treeItems.push({
          path: filePath,
          mode: '100644',
          type: 'blob',
          sha: blob.sha,
        });
      }

      const newTree = await githubApi(
        gh.token,
        `/repos/${scan.repo_full_name}/git/trees`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base_tree: baseSha, tree: treeItems }),
        },
      );

      const commitMessage = hasProxyFindings
        ? 'fix: secure API keys via VaultProof proxy (VaultProof Migration)'
        : 'fix: remove exposed API keys (VaultProof Migration)';

      const commit = await githubApi(
        gh.token,
        `/repos/${scan.repo_full_name}/git/commits`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: commitMessage,
            tree: newTree.sha,
            parents: [baseSha],
          }),
        },
      );

      await githubApi(
        gh.token,
        `/repos/${scan.repo_full_name}/git/refs/heads/${branchName}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sha: commit.sha }),
        },
      );

      // Build PR body
      const historyFindings = allFindings.filter(
        (f: any) => f.source === 'git-history',
      );
      const historyWarning =
        historyFindings.length > 0
          ? `\n## Git History Warning\n\nThe following keys were also found in git commit history. Removing them from source code does not remove them from history.\n\n**Action required — rotate these keys immediately:**\n${historyFindings
              .map((f: any) => {
                const info = getProviderInfo(f.provider);
                return `- \`${f.env_name}\` (${f.masked_value}) — [Rotate](${info.rotationUrl || '#'})`;
              })
              .join('\n')}\n`
          : '';

      const storedKeysSection =
        storedKeys.length > 0
          ? `\n## Keys Stored in VaultProof\n\n${storedKeys.map((k) => `- **${k.provider}** — \`${k.label}\` (ID: \`${k.keyId}\`)`).join('\n')}\n`
          : '';

      const prBody = `## Guided Migration with VaultProof

This PR was created by [VaultProof's guided migration](https://vaultproof.dev). API keys have been secured and code has been rewritten to use the VaultProof transparent proxy.
${storedKeysSection}
| Key | File | Action |
|-----|------|--------|
${processedFindings
  .map((pf) => {
    const desc =
      pf.action === 'sdk-init → proxy'
        ? 'Rewritten to use VaultProof proxy'
        : pf.action === 'url → proxy'
          ? 'URL redirected through VaultProof proxy'
          : pf.action === 'env → VAULTPROOF_API_KEY'
            ? 'Replaced with \`VAULTPROOF_API_KEY\`'
            : pf.action === 'env-file → proxy'
              ? 'Commented out, added \`VAULTPROOF_API_KEY\`'
              : `Replaced with \`process.env.${pf.envName}\``;
    return `| \`${pf.envName}\` | ${pf.file}${pf.line ? `:${pf.line}` : ''} | ${desc} |`;
  })
  .join('\n')}
${historyWarning}
## Setup

1. Add your VaultProof API key to your hosting provider:
   - \`VAULTPROOF_API_KEY\` — get this from [VaultProof Dashboard](https://vaultproof.dev/app/keys)

---
*This PR was created by VaultProof's guided migration with your approval.*
*VaultProof is not responsible for code modifications you approve and merge.*`;

      const pr = await githubApi(
        gh.token,
        `/repos/${scan.repo_full_name}/pulls`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'fix: secure API keys via VaultProof guided migration',
            body: prBody,
            head: branchName,
            base: defaultBranch,
          }),
        },
      );

      prUrl = pr.html_url;
      prNumber = pr.number;
    }

    // ── Step 5: Update finding records ──────────────────────────────
    for (const fa of findingActions) {
      if (fa.action === 'skip') {
        await supabase
          .from('scan_findings')
          .update({ action: 'skipped' })
          .eq('id', fa.findingId);
      } else if (fa.action === 'store') {
        await supabase
          .from('scan_findings')
          .update({ action: 'migrated' })
          .eq('id', fa.findingId);
      } else {
        // rewrite
        await supabase
          .from('scan_findings')
          .update({
            action: 'pr-created',
            pr_url: prUrl || undefined,
          })
          .eq('id', fa.findingId);
      }
    }

    auditLog(env, user.userId, scanId, 'migrated', {
      prUrl,
      prNumber,
      storedKeys: storedKeys.length,
      rewrittenFindings: processedFindings.length,
    });

    return Response.json({
      prUrl: prUrl || undefined,
      prNumber: prNumber || undefined,
      devKey: devKeyCreated ? vpLiveKey : undefined,
      storedKeys,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('migrate failed:', scanId, message);
    return Response.json(
      { error: 'Migration failed. Please try again.' },
      { status: 500 },
    );
  }
}

