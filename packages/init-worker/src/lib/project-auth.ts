/**
 * Authentication for vp-proj-xxx project identifiers.
 *
 * Project IDs are NOT secrets — they are public identifiers that appear in
 * user .env files. Security relies on:
 *   1. Origin locking (allowed_origins registered at init time)
 *   2. Rate limiting (per-project, enforced elsewhere)
 *
 * This is distinct from the legacy `vp_live_` developer keys, which are
 * secret and can access the management API. `vp-proj-` can only hit the
 * proxy routes on this worker.
 */
import type { Env, ProjectRecord } from '../types.js';
import { getSupabase } from './supabase.js';

export interface ProjectAuth {
  project: ProjectRecord;
}

/**
 * Result of the combined "auth + key fetch" round trip. This is the
 * fast path used by the proxy hot path — it does a single join query
 * instead of the old two-query (project lookup, then key lookup) pattern.
 */
export interface AuthenticatedKey {
  projectId: string;
  projectVpId: string;
  share1Encrypted: string;
  share2Encrypted: string;
  upstreamBaseUrl: string;
  authHeaderName: string;
  authHeaderTemplate: string;
  extraHeaders: Record<string, string> | null;
}

/**
 * Parse the bearer token. Pure, no I/O. Returns the project id string
 * if valid, or an error response descriptor.
 */
export function parseProjectToken(
  request: Request,
): { token: string } | { error: string; status: number } {
  const authHeader = request.headers.get('Authorization') || '';
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = bearerMatch?.[1]?.trim();
  if (!token || !token.startsWith('vp-proj-')) {
    return {
      error: 'Missing or malformed project identifier. Expected `Authorization: Bearer vp-proj-...`',
      status: 401,
    };
  }
  return { token };
}

/**
 * Origin-lock check. Pure, no I/O. Takes the project record fields we
 * need and the request headers; returns null if OK, error otherwise.
 */
export function checkOriginLock(
  request: Request,
  allowedOrigins: string | null,
  strictOrigin: boolean,
): { error: string; status: number } | null {
  if (!allowedOrigins) return null;
  const origin = request.headers.get('Origin') || request.headers.get('Referer') || '';
  const allowed = allowedOrigins.split(',').map((s) => s.trim()).filter(Boolean);
  const matched = allowed.some((a) => origin.startsWith(a));
  if (!matched && strictOrigin) {
    return { error: 'Origin not in project allowlist', status: 403 };
  }
  return null;
}

/**
 * Combined auth + key fetch in ONE Supabase round trip.
 *
 * Uses the Supabase JS client's embedded select to join project_keys
 * with its parent `projects` row. The `projects!inner` filter enforces
 * that the project exists (because of the !inner, rows without a valid
 * parent are excluded).
 *
 * Replaces the older pattern of:
 *   1. authenticateProject()  → SELECT from projects
 *   2. fetch project_keys row → SELECT from project_keys
 * with a single network call. Saves ~100-150ms per proxy request.
 */
export async function authenticateAndFetchKey(
  request: Request,
  env: Env,
  slug: string,
): Promise<AuthenticatedKey | { error: string; status: number }> {
  const parsed = parseProjectToken(request);
  if ('error' in parsed) return parsed;
  const token = parsed.token;

  const supabase = getSupabase(env);

  // Single round trip: fetch the key row plus its parent project.
  // PostgREST embed syntax: `projects!inner(...)` joins + requires the parent row.
  const { data, error } = await supabase
    .from('project_keys')
    .select(`
      project_id,
      share1_encrypted,
      share2_encrypted,
      upstream_base_url,
      auth_header_name,
      auth_header_template,
      extra_headers,
      projects!inner (
        id,
        vp_proj_id,
        allowed_origins,
        strict_origin,
        revoked_at
      )
    `)
    .eq('slug', slug)
    .is('revoked_at', null)
    .eq('projects.vp_proj_id', token)
    .is('projects.revoked_at', null)
    .maybeSingle();

  if (error || !data) {
    // We can't distinguish "project not found" from "key not found" at
    // the DB level because the inner join collapses both cases. The
    // caller decides which status to return based on context:
    //  - 401 if the project doesn't exist (enumeration defense)
    //  - 404 if the project exists but the slug doesn't
    // For the fast path we choose 401 by default to match the prior
    // behaviour when the project id itself is bogus. A follow-up query
    // could disambiguate, but that defeats the whole point of this
    // optimization.
    return { error: 'Project or key not found', status: 401 };
  }

  // Typescript's inference for embedded selects is weak; cast explicitly.
  const row = data as unknown as {
    project_id: string;
    share1_encrypted: string;
    share2_encrypted: string;
    upstream_base_url: string | null;
    auth_header_name: string | null;
    auth_header_template: string | null;
    extra_headers: Record<string, string> | null;
    projects: {
      id: string;
      vp_proj_id: string;
      allowed_origins: string | null;
      strict_origin: boolean;
      revoked_at: string | null;
    };
  };

  // Origin check, same as before.
  const originErr = checkOriginLock(request, row.projects.allowed_origins, row.projects.strict_origin);
  if (originErr) return originErr;

  // Upstream config must be present (set at registration time).
  if (!row.upstream_base_url || !row.auth_header_name || !row.auth_header_template) {
    return { error: 'Key is missing upstream configuration', status: 500 };
  }

  return {
    projectId: row.projects.id,
    projectVpId: row.projects.vp_proj_id,
    share1Encrypted: row.share1_encrypted,
    share2Encrypted: row.share2_encrypted,
    upstreamBaseUrl: row.upstream_base_url,
    authHeaderName: row.auth_header_name,
    authHeaderTemplate: row.auth_header_template,
    extraHeaders: row.extra_headers,
  };
}

/**
 * Legacy two-query path. Kept only for the (currently unused) case where
 * a caller needs the full project record without fetching a key. If
 * nothing uses it by the end of the perf work, we delete it.
 *
 * @deprecated Use authenticateAndFetchKey() on the proxy path.
 */
export async function authenticateProject(
  request: Request,
  env: Env,
): Promise<ProjectAuth | { error: string; status: number }> {
  const parsed = parseProjectToken(request);
  if ('error' in parsed) return parsed;

  const supabase = getSupabase(env);
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('vp_proj_id', parsed.token)
    .is('revoked_at', null)
    .maybeSingle();

  if (error || !data) {
    return { error: 'Project not found or revoked', status: 401 };
  }

  const project = data as ProjectRecord;
  const originErr = checkOriginLock(request, project.allowed_origins, project.strict_origin);
  if (originErr) return originErr;

  return { project };
}
