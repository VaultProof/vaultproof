/**
 * Project management routes.
 *
 *   POST /api/v1/init/projects             — create a project, return vp-proj-xxx
 *   POST /api/v1/init/projects/:id/keys    — store a Shamir-split key under a project
 *   GET  /api/v1/init/projects/:id         — fetch project metadata
 *
 * All routes require a Supabase JWT. Project identifiers are never accepted here.
 *
 * Universal upstream support (2026-04-11): the `/keys` route accepts a full
 * upstream config (upstream_base_url, auth_header_name, auth_header_template,
 * extra_headers, slug) so any Tier 1 Bearer-token REST API can be proxied.
 * All user-declared URLs and headers are validated against the SSRF guard.
 */
import type { Env, ProjectRecord } from '../types.js';
import { authenticateUser } from '../lib/user-auth.js';
import { getSupabase } from '../lib/supabase.js';
import { encrypt } from '../crypto/encryption.js';
import {
  validateUpstreamUrl,
  validateHeaderName,
  validateHeaderTemplate,
  validateExtraHeaders,
  validateSlug,
} from '../lib/ssrf-guard.js';
import {
  checkProjectCreateRateLimit,
  checkKeyUploadRateLimit,
  rateLimitResponse,
} from '../lib/rate-limit.js';

function generateProjectId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `vp-proj-${hex}`;
}

interface KeyUploadBody {
  provider?: string;
  slug?: string;
  share1?: string;
  share2?: string;
  env_var?: string;
  upstream_base_url?: string;
  auth_header_name?: string;
  auth_header_template?: string;
  extra_headers?: Record<string, string> | null;
}

interface ProjectWriteBody {
  name?: string | null;
  allowed_origins?: string | null;
  strict_origin?: boolean;
}

function normalizeAllowedOrigins(raw: string | null | undefined): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw.trim() === '') {
    return { ok: true, value: null };
  }

  const normalized = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      try {
        return new URL(origin).origin.toLowerCase();
      } catch {
        return null;
      }
    });

  if (normalized.some((origin) => origin === null)) {
    return { ok: false, error: 'allowed_origins must be a comma-separated list of valid origins' };
  }

  return { ok: true, value: [...new Set(normalized)].join(',') };
}

function parseStatsDays(request: Request, fallback = 30): number {
  const url = new URL(request.url);
  const raw = Number(url.searchParams.get('days'));
  if (!Number.isFinite(raw)) return fallback;
  const days = Math.floor(raw);
  if (days < 1) return 1;
  if (days > 90) return 90;
  return days;
}

function parseStatsLimit(request: Request, fallback = 5000): number {
  const url = new URL(request.url);
  const raw = Number(url.searchParams.get('limit'));
  if (!Number.isFinite(raw)) return fallback;
  const limit = Math.floor(raw);
  if (limit < 1) return 1;
  if (limit > 10000) return 10000;
  return limit;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function listActiveProjects(supabase: any, userId: string): Promise<Array<{ id: string; vp_proj_id: string; name: string | null }>> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, vp_proj_id, name')
    .eq('user_id', userId)
    .is('revoked_at', null);

  if (error || !data) return [];
  return data as Array<{ id: string; vp_proj_id: string; name: string | null }>;
}

async function getInitOverviewStats(supabase: any, userId: string): Promise<{
  totalProjects: number;
  totalKeys: number;
  providers: string[];
  providerCount: number;
  activeApps: number;
  totalCalls: number;
  errorRate: number;
  recentActivity: Array<Record<string, unknown>>;
}> {
  const projects = await listActiveProjects(supabase, userId);
  const projectIds = projects.map((p) => p.id);

  if (projectIds.length === 0) {
    return {
      totalProjects: 0,
      totalKeys: 0,
      providers: [],
      providerCount: 0,
      activeApps: 0,
      totalCalls: 0,
      errorRate: 0,
      recentActivity: [],
    };
  }

  const [{ data: keyRows }, totalCallsRes, errorCallsRes, recentLogsRes] = await Promise.all([
    supabase
      .from('project_keys')
      .select('id, project_id, provider, slug')
      .in('project_id', projectIds)
      .is('revoked_at', null),
    supabase
      .from('project_access_logs')
      .select('id', { count: 'exact', head: true })
      .in('project_id', projectIds),
    supabase
      .from('project_access_logs')
      .select('id', { count: 'exact', head: true })
      .in('project_id', projectIds)
      .gte('status_code', 400),
    supabase
      .from('project_access_logs')
      .select('id, project_key_id, provider, slug, method, upstream_path, status_code, latency_ms, timestamp, metadata')
      .in('project_id', projectIds)
      .order('timestamp', { ascending: false })
      .limit(20),
  ]);

  const keys = (keyRows || []) as Array<{ id: string; provider: string; slug: string | null }>;
  const providers = [...new Set(keys.map((k) => k.provider).filter(Boolean))];
  const keyMap = new Map<string, { provider: string; label: string }>();
  for (const key of keys) {
    keyMap.set(key.id, {
      provider: key.provider,
      label: key.slug || key.provider,
    });
  }

  const totalCalls = totalCallsRes?.count || 0;
  const errorCalls = errorCallsRes?.count || 0;
  const errorRate = totalCalls > 0 ? (errorCalls / totalCalls) * 100 : 0;

  const recentLogs = (recentLogsRes?.data || []) as Array<{
    project_key_id: string | null;
    provider: string | null;
    slug: string | null;
    method: string | null;
    upstream_path: string | null;
    status_code: number | null;
    latency_ms: number | null;
    timestamp: string;
    metadata: unknown;
  }>;

  const recentActivity = recentLogs.map((log) => {
    const keyInfo = log.project_key_id ? keyMap.get(log.project_key_id) : null;
    const endpoint = log.upstream_path || '';
    const method = (log.method || '').toUpperCase();
    const description = [method, endpoint].filter(Boolean).join(' ').trim() || (log.provider || log.slug || 'Proxy request');
    return {
      action: 'transparent_proxy',
      timestamp: log.timestamp,
      description,
      keySlot: {
        provider: keyInfo?.provider || log.provider || 'unknown',
        label: keyInfo?.label || log.slug || log.provider || 'unknown',
      },
      metadata: {
        status_code: log.status_code,
        endpoint,
        latency_ms: log.latency_ms,
      },
    };
  });

  return {
    totalProjects: projectIds.length,
    totalKeys: keys.length,
    providers,
    providerCount: providers.length,
    activeApps: providers.length,
    totalCalls,
    errorRate,
    recentActivity,
  };
}

async function getInitUsageStats(
  supabase: any,
  userId: string,
  days: number,
): Promise<{ usage: Array<{ date: string; calls: number; errors: number }> }> {
  const projects = await listActiveProjects(supabase, userId);
  const projectIds = projects.map((p) => p.id);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - (days - 1));

  const usage = Array.from({ length: days }, (_, idx) => {
    const date = new Date(start);
    date.setDate(start.getDate() + idx);
    return { date: toIsoDate(date), calls: 0, errors: 0 };
  });

  if (projectIds.length === 0) {
    return { usage };
  }

  const { data: logs } = await supabase
    .from('project_access_logs')
    .select('timestamp, status_code')
    .in('project_id', projectIds)
    .gte('timestamp', start.toISOString());

  const byDate = new Map<string, { date: string; calls: number; errors: number }>();
  for (const row of usage) byDate.set(row.date, row);

  for (const log of (logs || []) as Array<{ timestamp: string; status_code: number | null }>) {
    const date = String(log.timestamp).slice(0, 10);
    const bucket = byDate.get(date);
    if (!bucket) continue;
    bucket.calls += 1;
    if ((log.status_code || 0) >= 400) bucket.errors += 1;
  }

  return { usage };
}

async function getInitByKeyStats(
  supabase: any,
  userId: string,
): Promise<{
  keys: Array<{
    id: string;
    label: string;
    provider: string;
    keyPrefix: string;
    keySuffix: string;
    createdAt: string;
    created: string;
    lastUsed: string | null;
    callsThisMonth: number;
    dailyUsed: number;
    errorsThisMonth: number;
    status: string;
  }>;
}> {
  const projects = await listActiveProjects(supabase, userId);
  const projectIds = projects.map((p) => p.id);

  if (projectIds.length === 0) {
    return { keys: [] };
  }

  const { data: keyRows } = await supabase
    .from('project_keys')
    .select('id, project_id, provider, slug, created_at')
    .in('project_id', projectIds)
    .is('revoked_at', null);

  const keys = (keyRows || []) as Array<{
    id: string;
    project_id: string;
    provider: string;
    slug: string | null;
    created_at: string;
  }>;
  if (!keys.length) return { keys: [] };

  const keyIds = keys.map((k) => k.id);
  const now = Date.now();
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const dayAgoIso = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  const [{ data: monthlyLogs }, { data: latestLogs }] = await Promise.all([
    supabase
      .from('project_access_logs')
      .select('project_key_id, status_code, timestamp')
      .in('project_key_id', keyIds)
      .gte('timestamp', monthStart.toISOString()),
    supabase
      .from('project_access_logs')
      .select('project_key_id, timestamp')
      .in('project_key_id', keyIds)
      .order('timestamp', { ascending: false })
      .limit(5000),
  ]);

  const statsMap = new Map<string, { calls: number; errors: number; daily: number; lastUsed: string | null }>();
  for (const key of keys) {
    statsMap.set(key.id, { calls: 0, errors: 0, daily: 0, lastUsed: null });
  }

  for (const log of (monthlyLogs || []) as Array<{ project_key_id: string; status_code: number | null; timestamp: string }>) {
    const stat = statsMap.get(log.project_key_id);
    if (!stat) continue;
    stat.calls += 1;
    if ((log.status_code || 0) >= 400) stat.errors += 1;
    if (log.timestamp >= dayAgoIso) stat.daily += 1;
    if (!stat.lastUsed || log.timestamp > stat.lastUsed) stat.lastUsed = log.timestamp;
  }

  for (const log of (latestLogs || []) as Array<{ project_key_id: string; timestamp: string }>) {
    const stat = statsMap.get(log.project_key_id);
    if (!stat || stat.lastUsed) continue;
    stat.lastUsed = log.timestamp;
  }

  const output = keys.map((key) => {
    const stat = statsMap.get(key.id) || { calls: 0, errors: 0, daily: 0, lastUsed: null };
    return {
      id: key.id,
      label: key.slug || key.provider,
      provider: key.provider,
      keyPrefix: 'vp_key_',
      keySuffix: key.id.slice(-4),
      createdAt: key.created_at,
      created: key.created_at,
      lastUsed: stat.lastUsed,
      callsThisMonth: stat.calls,
      dailyUsed: stat.daily,
      errorsThisMonth: stat.errors,
      status: 'active',
    };
  });

  output.sort((a, b) => b.callsThisMonth - a.callsThisMonth);
  return { keys: output };
}

async function getInitLogsStats(
  supabase: any,
  userId: string,
  days: number,
  limit: number,
): Promise<{
  logs: Array<{
    id: string;
    timestamp: string;
    action: string;
    keySlotId: string | null;
    keyLabel: string;
    provider: string;
    appName: string;
    endpoint: string;
    status: string;
    latency: number | null;
    zkProofVerified: null;
    metadata: Record<string, unknown>;
  }>;
}> {
  const projects = await listActiveProjects(supabase, userId);
  const projectIds = projects.map((p) => p.id);
  if (!projectIds.length) return { logs: [] };

  const { data: keyRows } = await supabase
    .from('project_keys')
    .select('id, provider, slug')
    .in('project_id', projectIds)
    .is('revoked_at', null);

  const keyMap = new Map<string, { provider: string; label: string }>();
  for (const row of (keyRows || []) as Array<{ id: string; provider: string; slug: string | null }>) {
    keyMap.set(row.id, {
      provider: row.provider,
      label: row.slug || row.provider,
    });
  }

  const since = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString();
  const { data: logRows } = await supabase
    .from('project_access_logs')
    .select('id, project_key_id, provider, slug, method, upstream_path, status_code, latency_ms, error, metadata, timestamp')
    .in('project_id', projectIds)
    .gte('timestamp', since)
    .order('timestamp', { ascending: false })
    .limit(limit);

  const logs = ((logRows || []) as Array<{
    id: string;
    project_key_id: string | null;
    provider: string | null;
    slug: string | null;
    method: string | null;
    upstream_path: string | null;
    status_code: number | null;
    latency_ms: number | null;
    error: string | null;
    metadata: Record<string, unknown> | null;
    timestamp: string;
  }>).map((row) => {
    const keyInfo = row.project_key_id ? keyMap.get(row.project_key_id) : null;
    const provider = keyInfo?.provider || row.provider || 'unknown';
    const keyLabel = keyInfo?.label || row.slug || provider;
    const endpoint = row.upstream_path || '/';
    const method = (row.method || '').toUpperCase();
    const statusCode = row.status_code ?? (row.error ? 0 : 200);

    return {
      id: row.id,
      timestamp: row.timestamp,
      action: 'transparent_proxy',
      keySlotId: row.project_key_id || null,
      keyLabel,
      provider,
      appName: 'Init Proxy',
      endpoint: [method, endpoint].filter(Boolean).join(' ').trim(),
      status: statusCode >= 400 || statusCode === 0 ? 'error' : 'ok',
      latency: row.latency_ms ?? null,
      zkProofVerified: null,
      metadata: {
        status_code: statusCode,
        endpoint,
        method,
        latency_ms: row.latency_ms,
        error: row.error || null,
        ...(row.metadata || {}),
      },
    };
  });

  return { logs };
}

export async function handleProjects(
  request: Request,
  env: Env,
  pathSegments: string[],
): Promise<Response> {
  const auth = await authenticateUser(request, env);
  if (!auth) {
    return Response.json(
      { error: 'Not authenticated. Pass Authorization: Bearer <supabase jwt>' },
      { status: 401 },
    );
  }

  const supabase = getSupabase(env);
  const method = request.method;

  // POST /api/v1/init/projects — create a project
  if (method === 'POST' && pathSegments.length === 0) {
    const rl = await checkProjectCreateRateLimit(env, auth.userId);
    if (!rl.ok) return rateLimitResponse(rl.retryAfter!);

    let body: ProjectWriteBody = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      // empty body is fine
    }

    if (body.strict_origin !== undefined && typeof body.strict_origin !== 'boolean') {
      return Response.json({ error: 'strict_origin must be a boolean' }, { status: 400 });
    }

    const allowedOrigins = normalizeAllowedOrigins(body.allowed_origins);
    if (!allowedOrigins.ok) {
      return Response.json({ error: allowedOrigins.error }, { status: 400 });
    }
    if (body.strict_origin && !allowedOrigins.value) {
      return Response.json({ error: 'strict_origin requires allowed_origins' }, { status: 400 });
    }

    const vpProjId = generateProjectId();
    const { data, error } = await supabase
      .from('projects')
      .insert({
        user_id: auth.userId,
        vp_proj_id: vpProjId,
        name: body.name || null,
        allowed_origins: allowedOrigins.value,
        strict_origin: body.strict_origin ?? false,
      })
      .select('*')
      .single();

    if (error || !data) {
      console.error('Failed to create project:', error?.message);
      return Response.json({ error: 'Failed to create project', detail: 'Internal server error' }, { status: 500 });
    }

    const project = data as ProjectRecord;
    return Response.json(
      {
        id: project.id,
        vp_proj_id: project.vp_proj_id,
        name: project.name,
        created_at: project.created_at,
      },
      { status: 201 },
    );
  }

  // PUT /api/v1/init/projects/:id — update project metadata / origin lock
  if (method === 'PUT' && pathSegments.length === 1) {
    const projectId = pathSegments[0];

    const { data: existingProject, error: existingError } = await supabase
      .from('projects')
      .select('id, allowed_origins, strict_origin')
      .eq('id', projectId)
      .eq('user_id', auth.userId)
      .is('revoked_at', null)
      .maybeSingle();

    if (existingError || !existingProject) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }

    let body: ProjectWriteBody;
    try {
      body = (await request.json()) as ProjectWriteBody;
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    if (body.strict_origin !== undefined && typeof body.strict_origin !== 'boolean') {
      return Response.json({ error: 'strict_origin must be a boolean' }, { status: 400 });
    }

    const effectiveAllowedOrigins = body.allowed_origins !== undefined
      ? body.allowed_origins
      : existingProject.allowed_origins;
    const allowedOrigins = normalizeAllowedOrigins(effectiveAllowedOrigins);
    if (!allowedOrigins.ok) {
      return Response.json({ error: allowedOrigins.error }, { status: 400 });
    }
    const effectiveStrictOrigin = body.strict_origin ?? existingProject.strict_origin;
    if (effectiveStrictOrigin && !allowedOrigins.value) {
      return Response.json({ error: 'strict_origin requires allowed_origins' }, { status: 400 });
    }

    const updates: {
      name?: string | null;
      allowed_origins?: string | null;
      strict_origin?: boolean;
    } = {};

    if (body.name !== undefined) updates.name = body.name || null;
    if (body.allowed_origins !== undefined) updates.allowed_origins = allowedOrigins.value;
    if (body.strict_origin !== undefined) updates.strict_origin = body.strict_origin;

    const { data, error } = await supabase
      .from('projects')
      .update(updates)
      .eq('id', projectId)
      .eq('user_id', auth.userId)
      .is('revoked_at', null)
      .select('id, vp_proj_id, name, allowed_origins, strict_origin, created_at')
      .single();

    if (error || !data) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }

    return Response.json(data);
  }

  // GET /api/v1/init/projects/:id (skip if segment is 'stats' — handled below)
  if (method === 'GET' && pathSegments.length === 1 && pathSegments[0] !== 'stats') {
    const projectId = pathSegments[0];
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .eq('user_id', auth.userId)
      .is('revoked_at', null)
      .maybeSingle();

    if (error || !data) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }
    return Response.json(data);
  }

  // POST /api/v1/init/projects/:id/keys
  if (method === 'POST' && pathSegments.length === 2 && pathSegments[1] === 'keys') {
    const projectId = pathSegments[0];

    const rl = await checkKeyUploadRateLimit(env, auth.userId);
    if (!rl.ok) return rateLimitResponse(rl.retryAfter!);

    const { data: proj, error: projErr } = await supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', auth.userId)
      .is('revoked_at', null)
      .maybeSingle();

    if (projErr || !proj) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }

    let body: KeyUploadBody;
    try {
      body = (await request.json()) as KeyUploadBody;
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { provider, slug, share1, share2, env_var, upstream_base_url, auth_header_name, auth_header_template, extra_headers } = body;

    if (!provider || !share1 || !share2 || !upstream_base_url || !auth_header_name || !auth_header_template) {
      return Response.json(
        { error: 'Missing required fields: provider, share1, share2, upstream_base_url, auth_header_name, auth_header_template' },
        { status: 400 },
      );
    }

    // Share size cap — a real API key + Shamir overhead is ~300 bytes.
    // 4 KB gives 10x headroom for pathological keys and blocks memory/CPU
    // exhaustion via oversized share ciphertext.
    const MAX_SHARE_LENGTH = 4096;
    if (share1.length > MAX_SHARE_LENGTH || share2.length > MAX_SHARE_LENGTH) {
      return Response.json(
        { error: `share1/share2 exceed ${MAX_SHARE_LENGTH} chars` },
        { status: 400 },
      );
    }

    // ── SSRF + header validation ──
    const urlCheck = validateUpstreamUrl(upstream_base_url);
    if (!urlCheck.ok) {
      return Response.json({ error: `upstream_base_url rejected: ${urlCheck.error}` }, { status: 400 });
    }
    const nameCheck = validateHeaderName(auth_header_name);
    if (!nameCheck.ok) {
      return Response.json({ error: `auth_header_name rejected: ${nameCheck.error}` }, { status: 400 });
    }
    const templateCheck = validateHeaderTemplate(auth_header_template);
    if (!templateCheck.ok) {
      return Response.json({ error: `auth_header_template rejected: ${templateCheck.error}` }, { status: 400 });
    }
    const extrasCheck = validateExtraHeaders(extra_headers);
    if (!extrasCheck.ok) {
      return Response.json({ error: `extra_headers rejected: ${extrasCheck.error}` }, { status: 400 });
    }

    // Slug defaults to provider id if not supplied.
    const finalSlug = slug || provider;
    const slugCheck = validateSlug(finalSlug);
    if (!slugCheck.ok) {
      return Response.json({ error: `slug rejected: ${slugCheck.error}` }, { status: 400 });
    }

    // Encrypt Share 1. Share 2 stored as-is.
    const share1Bytes = Uint8Array.from(atob(share1), (c) => c.charCodeAt(0));
    const encrypted = encrypt(share1Bytes, env);
    const share1Encrypted = btoa(String.fromCharCode(...encrypted));

    const { error: upsertErr } = await supabase
      .from('project_keys')
      .upsert(
        {
          project_id: projectId,
          provider,
          slug: finalSlug,
          env_var: env_var || null,
          upstream_base_url: urlCheck.normalizedUrl,
          auth_header_name,
          auth_header_template,
          extra_headers: extra_headers ?? null,
          share1_encrypted: share1Encrypted,
          share2_b64: share2,
          revoked_at: null,
        },
        { onConflict: 'project_id,provider' },
      );

    if (upsertErr) {
      console.error('Failed to store key:', upsertErr.message);
      return Response.json({ error: 'Failed to store key', detail: 'Internal server error' }, { status: 500 });
    }

    return Response.json({ ok: true, provider, slug: finalSlug }, { status: 201 });
  }

  // GET /api/v1/init/projects — list all projects for this user
  if (method === 'GET' && pathSegments.length === 0) {
    const { data, error } = await supabase
      .from('projects')
      .select('id, vp_proj_id, name, allowed_origins, strict_origin, created_at')
      .eq('user_id', auth.userId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      return Response.json({ error: 'Failed to list projects' }, { status: 500 });
    }
    return Response.json({ projects: data || [] });
  }

  // DELETE /api/v1/init/projects/:id — revoke a project (soft delete)
  if (method === 'DELETE' && pathSegments.length === 1) {
    const projectId = pathSegments[0];
    const { data, error } = await supabase
      .from('projects')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', projectId)
      .eq('user_id', auth.userId)
      .is('revoked_at', null)
      .select('id, vp_proj_id')
      .single();

    if (error || !data) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }

    // Also revoke all keys under this project
    await supabase
      .from('project_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('project_id', projectId)
      .is('revoked_at', null);

    return Response.json({ ok: true, revoked: data });
  }

  // GET /api/v1/init/projects/:id/keys — list keys under a project
  if (method === 'GET' && pathSegments.length === 2 && pathSegments[1] === 'keys') {
    const projectId = pathSegments[0];

    // Verify ownership
    const { data: proj } = await supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', auth.userId)
      .is('revoked_at', null)
      .maybeSingle();

    if (!proj) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }

    const { data: keys, error } = await supabase
      .from('project_keys')
      .select('id, provider, slug, env_var, upstream_base_url, created_at, revoked_at')
      .eq('project_id', projectId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      return Response.json({ error: 'Failed to list keys' }, { status: 500 });
    }
    return Response.json({ keys: keys || [] });
  }

  // DELETE /api/v1/init/projects/:id/keys/:keyId — revoke a specific key
  if (method === 'DELETE' && pathSegments.length === 3 && pathSegments[1] === 'keys') {
    const projectId = pathSegments[0];
    const keyId = pathSegments[2];

    // Verify project ownership
    const { data: proj } = await supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', auth.userId)
      .is('revoked_at', null)
      .maybeSingle();

    if (!proj) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }

    const { data, error } = await supabase
      .from('project_keys')
      .update({
        revoked_at: new Date().toISOString(),
        share1_encrypted: null,
        share2_b64: null,
      })
      .eq('id', keyId)
      .eq('project_id', projectId)
      .is('revoked_at', null)
      .select('id, provider')
      .single();

    if (error || !data) {
      return Response.json({ error: 'Key not found' }, { status: 404 });
    }
    return Response.json({ ok: true, revoked: data });
  }

  // PUT /api/v1/init/projects/:id/keys/:keyId/rotate — rotate a key (new shares)
  if (method === 'PUT' && pathSegments.length === 4 && pathSegments[1] === 'keys' && pathSegments[3] === 'rotate') {
    const projectId = pathSegments[0];
    const keyId = pathSegments[2];

    const rl = await checkKeyUploadRateLimit(env, auth.userId);
    if (!rl.ok) return rateLimitResponse(rl.retryAfter!);

    // Verify project ownership
    const { data: proj } = await supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', auth.userId)
      .is('revoked_at', null)
      .maybeSingle();

    if (!proj) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }

    let body: { share1?: string; share2?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { share1, share2 } = body;
    if (!share1 || !share2) {
      return Response.json({ error: 'Missing required fields: share1, share2' }, { status: 400 });
    }

    const MAX_SHARE_LENGTH = 4096;
    if (share1.length > MAX_SHARE_LENGTH || share2.length > MAX_SHARE_LENGTH) {
      return Response.json({ error: `share1/share2 exceed ${MAX_SHARE_LENGTH} chars` }, { status: 400 });
    }

    // Encrypt the new Share 1
    const share1Bytes = Uint8Array.from(atob(share1), (c) => c.charCodeAt(0));
    const encrypted = encrypt(share1Bytes, env);
    const share1Encrypted = btoa(String.fromCharCode(...encrypted));

    const { data, error } = await supabase
      .from('project_keys')
      .update({
        share1_encrypted: share1Encrypted,
        share2_b64: share2,
      })
      .eq('id', keyId)
      .eq('project_id', projectId)
      .is('revoked_at', null)
      .select('id, provider')
      .single();

    if (error || !data) {
      return Response.json({ error: 'Key not found' }, { status: 404 });
    }
    return Response.json({ ok: true, rotated: data });
  }

  // GET /api/v1/init/projects/stats/*
  if (method === 'GET' && pathSegments.length >= 1 && pathSegments[0] === 'stats') {
    if (pathSegments.length === 2 && pathSegments[1] === 'overview') {
      const overview = await getInitOverviewStats(supabase, auth.userId);
      return Response.json(overview);
    }

    if (pathSegments.length === 2 && pathSegments[1] === 'usage') {
      const days = parseStatsDays(request, 30);
      return Response.json(await getInitUsageStats(supabase, auth.userId, days));
    }

    if (pathSegments.length === 2 && pathSegments[1] === 'by-key') {
      return Response.json(await getInitByKeyStats(supabase, auth.userId));
    }

    if (pathSegments.length === 2 && pathSegments[1] === 'logs') {
      const days = parseStatsDays(request, 90);
      const limit = parseStatsLimit(request, 5000);
      return Response.json(await getInitLogsStats(supabase, auth.userId, days, limit));
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}
