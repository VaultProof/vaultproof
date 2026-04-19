/**
 * VaultProof Init Worker
 *
 * Handles:
 *   • Project management for `@vaultproof/init` (JWT-authed)
 *   • Proxy routes for vp-proj-xxx tokens (public identifiers)
 */
import type { Env } from './types.js';
import { handleProjects } from './routes/projects.js';
import { handleProxy } from './routes/proxy.js';
import { checkFailedAuthRateLimit, rateLimitResponse } from './lib/rate-limit.js';

// Re-export the Durable Object class so wrangler can bind it.
export { RateLimiter } from './do/rate-limiter.js';

function corsHeaders(origin: string, allowedOrigins: string[]): Record<string, string> {
  // The init-worker uses Authorization: Bearer ... only. No cookies, no
  // credentialed requests. We deliberately do NOT send
  // Access-Control-Allow-Credentials, so the staging wildcard
  // (ALLOWED_ORIGINS="*") is safe: browsers will not attach credentials.
  const wildcard = allowedOrigins.includes('*');
  const isAllowed = wildcard || allowedOrigins.includes(origin);

  // When the allowlist is the wildcard we return "*" (not the echoed origin)
  // so that credentialed mode is impossible for any caller that misconfigures
  // their client. When the allowlist is explicit, we echo the specific origin.
  const allowOrigin = wildcard ? '*' : isAllowed ? origin : '';

  return {
    ...(allowOrigin ? { 'Access-Control-Allow-Origin': allowOrigin } : {}),
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function mergeVary(headers: Headers, value: string): void {
  const existing = (headers.get('Vary') || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const next = new Set(existing);
  next.add(value);
  headers.set('Vary', Array.from(next).join(', '));
}

function setNoStore(headers: Headers): void {
  // Prevent shared caches from serving authenticated responses across users.
  headers.set('Cache-Control', 'private, no-store, max-age=0');
  headers.set('Pragma', 'no-cache');
  headers.set('Expires', '0');
}

function addCors(response: Response, origin: string, allowedOrigins: string[]): Response {
  const wildcard = allowedOrigins.includes('*');
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders(origin, allowedOrigins))) {
    headers.set(k, v);
  }
  mergeVary(headers, 'Authorization');
  if (!wildcard) mergeVary(headers, 'Origin');
  setNoStore(headers);
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1);
    }

    const allowedOrigins = (env.ALLOWED_ORIGINS || 'https://vaultproof.dev').split(',').map((s) => s.trim());
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin, allowedOrigins) });
    }

    if (url.pathname === '/health') {
      return addCors(
        Response.json({ status: 'ok', service: 'vaultproof-init' }),
        origin,
        allowedOrigins,
      );
    }

    // ── /api/v1/init/projects/* ───────────────────────────────────────
    if (url.pathname.startsWith('/api/v1/init/projects')) {
      const rest = url.pathname.replace('/api/v1/init/projects', '');
      const segments = rest.split('/').filter(Boolean);
      const res = await handleProjects(request, env, segments);
      if (res.status === 401) {
        // Enumeration defense: per-IP rate limit for failed auth.
        const ip = request.headers.get('cf-connecting-ip') || '';
        const rl = await checkFailedAuthRateLimit(env, ip);
        if (!rl.ok) return addCors(rateLimitResponse(rl.retryAfter!), origin, allowedOrigins);
      }
      return addCors(res, origin, allowedOrigins);
    }

    // ── /p/:slug/* (universal proxy) ──────────────────────────────────
    const proxyMatch = url.pathname.match(/^\/p\/([a-z0-9][a-z0-9-]{0,31})(\/.*)?$/);
    if (proxyMatch) {
      const slug = proxyMatch[1];
      const upstreamPath = proxyMatch[2] || '/';
      const res = await handleProxy(request, env, slug, upstreamPath + url.search, ctx);
      if (res.status === 401 || res.status === 404) {
        const ip = request.headers.get('cf-connecting-ip') || '';
        const rl = await checkFailedAuthRateLimit(env, ip);
        if (!rl.ok) return addCors(rateLimitResponse(rl.retryAfter!), origin, allowedOrigins);
      }
      return addCors(res, origin, allowedOrigins);
    }

    // ── /v1/* — Stripe-native path support ───────────────────────────
    if (url.pathname.startsWith('/v1/')) {
      const upstreamPath = url.pathname + url.search; // /v1/checkout/sessions?...
      const res = await handleProxy(request, env, 'stripe', upstreamPath, ctx);
      if (res.status === 401 || res.status === 404) {
        const ip = request.headers.get('cf-connecting-ip') || '';
        const rl = await checkFailedAuthRateLimit(env, ip);
        if (!rl.ok) return addCors(rateLimitResponse(rl.retryAfter!), origin, allowedOrigins);
      }
      return addCors(res, origin, allowedOrigins);
    }

    return addCors(Response.json({ error: 'Not found' }, { status: 404 }), origin, allowedOrigins);
  },
};
