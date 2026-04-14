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

  // GET /api/v1/init/stats — dashboard overview stats
  if (method === 'GET' && pathSegments.length === 1 && pathSegments[0] === 'stats') {
    const { data: projects } = await supabase
      .from('projects')
      .select('id')
      .eq('user_id', auth.userId)
      .is('revoked_at', null);

    const projectIds = (projects || []).map((p: { id: string }) => p.id);

    let totalKeys = 0;
    if (projectIds.length > 0) {
      const { count } = await supabase
        .from('project_keys')
        .select('id', { count: 'exact', head: true })
        .in('project_id', projectIds)
        .is('revoked_at', null);
      totalKeys = count || 0;
    }

    // Unique providers across all projects
    let providers: string[] = [];
    if (projectIds.length > 0) {
      const { data: providerRows } = await supabase
        .from('project_keys')
        .select('provider')
        .in('project_id', projectIds)
        .is('revoked_at', null);
      providers = [...new Set((providerRows || []).map((r: { provider: string }) => r.provider))];
    }

    return Response.json({
      totalProjects: projectIds.length,
      totalKeys,
      providers,
      providerCount: providers.length,
    });
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}
