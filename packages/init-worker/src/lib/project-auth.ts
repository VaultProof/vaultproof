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

const VAULT_SECRET_PROVIDER_PREFIX = 'vaultenv-';

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

const PROJECT_TOKEN_HEADER_NAMES = [
  'authorization',
  'x-api-key',
  'api-key',
  'apikey',
  'api-token',
  'fastly-key',
  'circle-token',
  'x-auth-token',
  'x-subscription-token',
  'x-goog-api-key',
  'xi-api-key',
  'x-e2b-api-key',
  'x-algolia-api-key',
  'x-assemblyai-api-key',
  'x-bb-api-key',
  'x-hume-api-key',
  'x-figma-token',
  'x-api-token',
  'x-gladia-key',
  'x-apikey',
  'x-cc-api-key',
  'x-portkey-api-key',
  'x-prerender-token',
  'x-rollbar-access-token',
  'x-typesense-api-key',
  'private-token',
  'x-gitlab-token',
  'x-honeycomb-team',
  'shortcut-token',
  'accesskey',
  'unstructured-api-key',
  'dd-api-key',
  'x-elasticemail-apikey',
  'x-postage-server-token',
  'x-postmark-server-token',
  'x-sendlayer-api-key',
  'x-smtp2go-api-key',
];

function parseBasicProjectToken(value: string): string | null {
  const encoded = value.match(/^Basic\s+(.+)$/i)?.[1]?.trim();
  if (!encoded) return null;
  try {
    const decoded = atob(encoded);
    const [user, pass] = decoded.split(':');
    if (user?.startsWith('vp-proj-')) return user;
    if (pass?.startsWith('vp-proj-')) return pass;
  } catch {
    return null;
  }
  return null;
}

function extractProjectToken(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('vp-proj-')) return trimmed;

  const bearer = trimmed.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer?.startsWith('vp-proj-')) return bearer;

  const token = trimmed.match(/^Token\s+(.+)$/i)?.[1]?.trim();
  if (token?.startsWith('vp-proj-')) return token;

  const pagerDutyToken = trimmed.match(/^Token\s+token=(.+)$/i)?.[1]?.trim();
  if (pagerDutyToken?.startsWith('vp-proj-')) return pagerDutyToken;

  const providerSchemeToken = trimmed.match(/^[A-Za-z][A-Za-z0-9._-]*\s+(.+)$/)?.[1]?.trim();
  if (providerSchemeToken?.startsWith('vp-proj-')) return providerSchemeToken;

  return parseBasicProjectToken(trimmed);
}

/**
 * Parse the public project identifier. Pure, no I/O. Returns the project id
 * string if valid, or an error response descriptor.
 *
 * Most SDKs send their configured API key in provider-specific headers
 * (`x-api-key`, `api-key`, `PRIVATE-TOKEN`, etc.). After init rewrites a
 * provider key to `vp-proj-...`, those headers must authenticate the proxy
 * just like `Authorization: Bearer vp-proj-...` does.
 */
export function parseProjectToken(
  request: Request,
): { token: string } | { error: string; status: number } {
  for (const headerName of PROJECT_TOKEN_HEADER_NAMES) {
    const token = extractProjectToken(request.headers.get(headerName));
    if (token) {
      return { token };
    }
  }
  return {
    error: 'Missing or malformed project identifier. Expected `vp-proj-...` in Authorization or a supported provider API-key header',
    status: 401,
  };
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
    if (cached.provider.startsWith(VAULT_SECRET_PROVIDER_PREFIX)) {
      return { error: 'Vault-only secrets are not proxyable', status: 404 };
    }
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

  if (row.provider.startsWith(VAULT_SECRET_PROVIDER_PREFIX)) {
    return { error: 'Vault-only secrets are not proxyable', status: 404 };
  }

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
