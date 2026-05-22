/**
 * VaultProof Init Worker
 *
 * Handles:
 *   • Project management for `@vaultproof/init` (JWT-authed)
 *   • Proxy routes for vp-proj-xxx tokens (public identifiers)
 */
import type { Env } from './types.js';
import { handleAlerts } from './routes/alerts.js';
import { dispatchPolicyAlertsForOrganization } from './routes/alerts.js';
import { handleAudit } from './routes/audit.js';
import { handleMembers } from './routes/members.js';
import { handleOrganizations } from './routes/orgs.js';
import { handleProjects } from './routes/projects.js';
import { handleProxy } from './routes/proxy.js';
import { handleSiteTranslate } from './routes/site-translate.js';
import { checkFailedAuthRateLimit, rateLimitResponse } from './lib/rate-limit.js';
import { getSupabase } from './lib/supabase.js';

const CORS_ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
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
  'accept',
  'accept-language',
  'anthropic-beta',
  'anthropic-version',
  'cache-control',
  'idempotency-key',
  'openai-beta',
  'prefer',
  'stripe-version',
].join(', ');

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
    'Access-Control-Allow-Headers': CORS_ALLOWED_HEADERS,
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

    if (url.pathname === '/api/v1/site/translate') {
      const res = await handleSiteTranslate(request, env, origin, allowedOrigins);
      return addCors(res, origin, allowedOrigins);
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

    // ── /api/v1/init/members/* ────────────────────────────────────────
    if (url.pathname.startsWith('/api/v1/init/members')) {
      const rest = url.pathname.replace('/api/v1/init/members', '');
      const segments = rest.split('/').filter(Boolean);
      const res = await handleMembers(request, env, segments);
      if (res.status === 401) {
        const ip = request.headers.get('cf-connecting-ip') || '';
        const rl = await checkFailedAuthRateLimit(env, ip);
        if (!rl.ok) return addCors(rateLimitResponse(rl.retryAfter!), origin, allowedOrigins);
      }
      return addCors(res, origin, allowedOrigins);
    }

    // ── /api/v1/init/orgs ─────────────────────────────────────────────
    if (url.pathname.startsWith('/api/v1/init/orgs')) {
      const rest = url.pathname.replace('/api/v1/init/orgs', '');
      const segments = rest.split('/').filter(Boolean);
      const res = await handleOrganizations(request, env, segments);
      if (res.status === 401) {
        const ip = request.headers.get('cf-connecting-ip') || '';
        const rl = await checkFailedAuthRateLimit(env, ip);
        if (!rl.ok) return addCors(rateLimitResponse(rl.retryAfter!), origin, allowedOrigins);
      }
      return addCors(res, origin, allowedOrigins);
    }

    // ── /api/v1/init/audit ────────────────────────────────────────────
    if (url.pathname === '/api/v1/init/audit' || url.pathname === '/api/v1/init/audit/export') {
      const res = await handleAudit(request, env);
      if (res.status === 401) {
        const ip = request.headers.get('cf-connecting-ip') || '';
        const rl = await checkFailedAuthRateLimit(env, ip);
        if (!rl.ok) return addCors(rateLimitResponse(rl.retryAfter!), origin, allowedOrigins);
      }
      return addCors(res, origin, allowedOrigins);
    }

    // ── /api/v1/init/alerts/* ─────────────────────────────────────────
    if (url.pathname.startsWith('/api/v1/init/alerts')) {
      const rest = url.pathname.replace('/api/v1/init/alerts', '');
      const segments = rest.split('/').filter(Boolean);
      const res = await handleAlerts(request, env, segments);
      if (res.status === 401) {
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

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const supabase = getSupabase(env);
    const { data } = await supabase
      .from('organization_alert_policies')
      .select('organization_id')
      .eq('dispatch_enabled', true);

    const organizationIds = [...new Set(((data || []) as Array<{ organization_id: string }>).map((row) => row.organization_id).filter(Boolean))];
    if (organizationIds.length === 0) {
      console.log('scheduled alert dispatch: no enabled organizations');
      return;
    }

    ctx.waitUntil((async () => {
      const results = await Promise.all(organizationIds.map((organizationId) => dispatchPolicyAlertsForOrganization(env, organizationId, 'scheduled')));
      const dispatched = results.filter((result) => result.ok && !result.skipped).length;
      const skipped = results.filter((result) => result.skipped).length;
      const failed = results.filter((result) => !result.ok && !result.skipped).length;
      console.log(`scheduled alert dispatch: ${organizationIds.length} orgs checked, ${dispatched} dispatched, ${skipped} skipped, ${failed} failed`);
    })());
  },
};
