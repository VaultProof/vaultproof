/**
 * Authentication for vp-proj-xxx project identifiers.
 *
 * Project IDs are NOT secrets — they are public identifiers that appear in
 * user .env files. Security relies on:
 *   1. Origin locking (allowed_origins registered at init time)
 *   2. Rate limiting (per-project, enforced elsewhere)
 *
 * `vp-proj-` tokens are scoped to proxy access only. They can never
 * access the management routes on this worker.
 */
import type { Env } from '../types.js';
import { getSupabase } from './supabase.js';
import { cacheGet, cacheSet } from './project-cache.js';

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Result of the combined "auth + key fetch" round trip.
 */
export interface AuthenticatedKey {
  keyId: string;
  provider: string;
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

  const allowed = allowedOrigins
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizeOrigin)
    .filter((origin): origin is string => origin !== null);

  const originHeader = request.headers.get('Origin');
  if (originHeader) {
    const requestOrigin = normalizeOrigin(originHeader);
    if (!requestOrigin) {
      return { error: 'Malformed Origin header', status: 403 };
    }
    if (!allowed.includes(requestOrigin)) {
      return { error: 'Origin not in project allowlist', status: 403 };
    }
    return null;
  }

  const refererHeader = request.headers.get('Referer');
  if (refererHeader) {
    const requestOrigin = normalizeOrigin(refererHeader);
    if (!requestOrigin) {
      return { error: 'Malformed Referer header', status: 403 };
    }
    if (!allowed.includes(requestOrigin)) {
      return { error: 'Origin not in project allowlist', status: 403 };
    }
    return null;
  }

  if (strictOrigin) {
    return { error: 'Origin header required for this project', status: 403 };
  }
  return null;
}

/**
 * Combined auth + key fetch.
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

  // ── Fast path: routing/origin metadata cached; shares still fetched fresh ──
  // Encrypted shares are NOT cached — see CachedKey in project-cache.ts.
  // Origin lock is ALWAYS re-checked against the current request headers —
  // the cache stores the allowlist string, not an authorization decision.
  const cached = cacheGet(token, slug);
  if (cached) {
    const originErr = checkOriginLock(request, cached.allowedOrigins, cached.strictOrigin);
    if (originErr) return originErr;

    // Fetch only the encrypted shares — a lightweight query with no project JOIN.
    const { data: sharesData, error: sharesError } = await supabase
      .from('project_keys')
      .select('id, provider, share1_encrypted, share2_b64')
      .eq('slug', slug)
      .eq('project_id', cached.projectId)
      .is('revoked_at', null)
      .maybeSingle();

    if (sharesError || !sharesData) {
      // Key was revoked or deleted since the metadata was cached; fail immediately.
      return { error: 'Project or key not found', status: 401 };
    }

    const shares = sharesData as unknown as {
      id: string;
      provider: string;
      share1_encrypted: string;
      share2_b64: string;
    };
    return {
      keyId: shares.id || cached.keyId,
      provider: shares.provider || cached.provider,
      projectId: cached.projectId,
      projectVpId: cached.projectVpId,
      share1Encrypted: shares.share1_encrypted,
      share2Encrypted: shares.share2_b64,
      upstreamBaseUrl: cached.upstreamBaseUrl,
      authHeaderName: cached.authHeaderName,
      authHeaderTemplate: cached.authHeaderTemplate,
      extraHeaders: cached.extraHeaders,
    };
  }

  // ── Slow path: full JOIN query ──
  // Single round trip: fetch the key row plus its parent project.
  const { data, error } = await supabase
    .from('project_keys')
    .select(`
      id,
      provider,
      project_id,
      share1_encrypted,
      share2_b64,
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
    // Do NOT cache failures — we want rotation and first-time registration
    // to take effect immediately, not after the TTL.
    return { error: 'Project or key not found', status: 401 };
  }

  const row = data as unknown as {
    id: string;
    provider: string;
    project_id: string;
    share1_encrypted: string;
    share2_b64: string;
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

  // Origin check against the JUST-FETCHED row. On subsequent cached hits
  // we'll re-check with the cached allowlist value.
  const originErr = checkOriginLock(request, row.projects.allowed_origins, row.projects.strict_origin);
  if (originErr) return originErr;

  if (!row.upstream_base_url || !row.auth_header_name || !row.auth_header_template) {
    return { error: 'Key is missing upstream configuration', status: 500 };
  }

  // ── Store routing/origin metadata in cache for the next 30s ──
  // Encrypted shares are deliberately excluded — see CachedKey in project-cache.ts.
  cacheSet(token, slug, {
    projectId: row.projects.id,
    projectVpId: row.projects.vp_proj_id,
    keyId: row.id,
    provider: row.provider,
    upstreamBaseUrl: row.upstream_base_url,
    authHeaderName: row.auth_header_name,
    authHeaderTemplate: row.auth_header_template,
    extraHeaders: row.extra_headers,
    allowedOrigins: row.projects.allowed_origins,
    strictOrigin: row.projects.strict_origin,
  });

  return {
    keyId: row.id,
    provider: row.provider,
    projectId: row.projects.id,
    projectVpId: row.projects.vp_proj_id,
    share1Encrypted: row.share1_encrypted,
    share2Encrypted: row.share2_b64,
    upstreamBaseUrl: row.upstream_base_url,
    authHeaderName: row.auth_header_name,
    authHeaderTemplate: row.auth_header_template,
    extraHeaders: row.extra_headers,
  };
}
