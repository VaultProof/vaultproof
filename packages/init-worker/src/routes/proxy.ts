/**
 * Universal provider proxy.
 *
 *   /p/:slug/*   → looks up (project, slug) → decrypt shares → forward upstream
 *
 * The slug can be any registered provider on the project. The upstream base
 * URL, auth header, and extra headers are all stored per-key and validated at
 * registration time via the SSRF guard, so at request time we only need to
 * build the outgoing fetch.
 *
 * Security properties:
 *   - `redirect: 'manual'` — upstream 3xx responses are passed through raw,
 *     preventing redirect-based SSRF pivots.
 *   - `Host` header is not forwarded (fetch derives it from the URL).
 *   - `X-Forwarded-*` headers are dropped.
 *   - Reconstructed key lives in memory only for the duration of fetch() and
 *     is zeroed immediately after.
 */
import type { Env } from '../types.js';
import { authenticateAndFetchKey } from '../lib/project-auth.js';
import { decrypt, zeroUint8Array } from '../crypto/encryption.js';
import { deserializeShare, combineShares } from '../crypto/shamir.js';
import { checkProxyRateLimit, rateLimitResponse } from '../lib/rate-limit.js';

const SAFE_FORWARD_HEADERS = new Set([
  'content-type',
  'accept',
  'accept-encoding',
  'accept-language',
  'cache-control',
  'user-agent',
  'openai-beta',
  'stripe-version',
  'idempotency-key',
  'prefer',
  'anthropic-version',
  'anthropic-beta',
]);

export async function handleProxy(
  request: Request,
  env: Env,
  slug: string,
  upstreamPath: string,
): Promise<Response> {
  // Single round trip: auth + origin lock + key fetch + upstream config.
  // Replaces two sequential Supabase queries with one JOIN.
  const auth = await authenticateAndFetchKey(request, env, slug);
  if ('error' in auth) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  // Rate limit: keyed on the authenticated project ID (NOT the caller IP)
  // so leaked project IDs cannot burn through their owner's quota from
  // many addresses. 60 requests per 60s per project.
  const rl = await checkProxyRateLimit(env, auth.projectId);
  if (!rl.ok) return rateLimitResponse(rl.retryAfter!);

  // ── Body size limit — reject non-GET/HEAD requests exceeding 10 MB ──
  const BODY_SIZE_LIMIT = 10 * 1024 * 1024; // 10 MB
  if (!['GET', 'HEAD'].includes(request.method)) {
    const contentLength = request.headers.get('content-length');
    if (contentLength !== null && parseInt(contentLength, 10) > BODY_SIZE_LIMIT) {
      return Response.json({ error: 'Request body too large' }, { status: 413 });
    }
  }

  // ── Reconstruct the key ──
  let reconstructed: Uint8Array | null = null;
  let share1Plain: Uint8Array | null = null;
  let realKey: string;
  try {
    const share1CipherBytes = Uint8Array.from(atob(auth.share1Encrypted), (c) => c.charCodeAt(0));
    share1Plain = decrypt(share1CipherBytes, env);
    const share1 = deserializeShare(btoa(String.fromCharCode(...share1Plain)));
    const share2 = deserializeShare(auth.share2Encrypted);
    reconstructed = combineShares([share1, share2]);
    realKey = new TextDecoder().decode(reconstructed);
  } catch {
    return Response.json({ error: 'Failed to reconstruct key' }, { status: 500 });
  } finally {
    if (share1Plain) share1Plain.fill(0);
  }

  // ── Build upstream request ──
  const base = auth.upstreamBaseUrl.replace(/\/+$/, '');
  const path = upstreamPath.startsWith('/') ? upstreamPath : `/${upstreamPath}`;
  const upstreamUrl = `${base}${path}`;

  // Rebuild the auth header from the template. Template validation in
  // ssrf-guard guarantees no control chars and that {key} is present.
  const authHeaderValue = auth.authHeaderTemplate.replace('{key}', realKey);

  const forwardHeaders = new Headers();
  for (const [k, v] of request.headers) {
    if (SAFE_FORWARD_HEADERS.has(k.toLowerCase())) forwardHeaders.set(k, v);
  }
  forwardHeaders.set(auth.authHeaderName, authHeaderValue);

  if (auth.extraHeaders) {
    for (const [k, v] of Object.entries(auth.extraHeaders)) {
      forwardHeaders.set(k, v.includes('{key}') ? v.replace('{key}', realKey) : v);
    }
  }

  const upstreamReq = new Request(upstreamUrl, {
    method: request.method,
    headers: forwardHeaders,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    redirect: 'manual',
  });

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstreamReq);
  } finally {
    if (reconstructed) zeroUint8Array(reconstructed);
    // JS strings are immutable — setting realKey = '' drops the reference but
    // does NOT overwrite the underlying V8 heap allocation. The string copy
    // will persist until GC collects it. This is a known JS limitation: only
    // the Uint8Array above can be cryptographically zeroed. Minimise the
    // window by keeping realKey scoped tightly and avoiding string copies.
    realKey = '';
  }

  // Explicit allowlist of response headers we pass back to the client.
  // Stripping unknown headers prevents a malicious upstream from setting
  // cookies for our domain, injecting HSTS, or pivoting via Clear-Site-Data.
  // SDK clients need content-type and standard cache/CORS headers; provider
  // metadata (openai-*, stripe-*, x-request-id) is whitelisted for debugging.
  const SAFE_RESPONSE_HEADERS = new Set([
    'content-type',
    'cache-control',
    'etag',
    'last-modified',
    'retry-after',
    'www-authenticate',
    'x-ratelimit-limit',
    'x-ratelimit-remaining',
    'x-ratelimit-reset',
    'x-request-id',
    'openai-version',
    'openai-processing-ms',
    'openai-organization',
    'anthropic-ratelimit-requests-remaining',
    'anthropic-ratelimit-tokens-remaining',
    'stripe-version',
    'request-id',
  ]);
  const resHeaders = new Headers();
  for (const [k, v] of upstreamRes.headers) {
    if (SAFE_RESPONSE_HEADERS.has(k.toLowerCase())) resHeaders.set(k, v);
  }
  return new Response(upstreamRes.body, { status: upstreamRes.status, headers: resHeaders });
}
