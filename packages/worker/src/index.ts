import type { Env } from './types.js';
import { handleTransparentProxy } from './routes/transparent-proxy.js';
import { handleAnalyticsEvent } from './routes/analytics.js';
import { handleStats } from './routes/stats.js';
import { handleDevKeys } from './routes/dev-keys.js';
import { handlePromo } from './routes/promo.js';
import { handleAdmin } from './routes/admin.js';
import { checkPublicIpRateLimit } from './lib/rate-limit.js';

function corsHeaders(origin: string, allowedOrigins: string[]): Record<string, string> {
  const isAllowed = allowedOrigins.includes(origin);
  return {
    ...(isAllowed ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-VaultProof-Session',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };
}

function addCors(response: Response, origin: string, allowedOrigins: string[]): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders(origin, allowedOrigins))) {
    headers.set(k, v);
  }
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const allowedOrigins = (env.ALLOWED_ORIGINS || 'https://vaultproof.dev').split(',').map(s => s.trim());
    const origin = request.headers.get('Origin') || '';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin, allowedOrigins) });
    }

    // Health check
    if (url.pathname === '/health') {
      return addCors(
        Response.json({ status: 'ok', service: 'vaultproof-edge', edge: true }),
        origin, allowedOrigins
      );
    }

    // Backend health
    if (url.pathname === '/backend-health') {
      return addCors(
        Response.json({ status: 'ok', service: 'vaultproof' }),
        origin, allowedOrigins
      );
    }

    // Analytics event (public, no auth — IP rate limited)
    if (url.pathname === '/analytics/event') {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const rl = checkPublicIpRateLimit(ip);
      if (!rl.allowed) {
        return addCors(Response.json({ error: 'Rate limited — try again in a moment' }, { status: 429 }), origin, allowedOrigins);
      }
      try {
        const response = await handleAnalyticsEvent(request, env);
        return addCors(response, origin, allowedOrigins);
      } catch {
        return addCors(Response.json({ error: 'Service temporarily unavailable' }, { status: 503 }), origin, allowedOrigins);
      }
    }

    // Stats routes
    if (url.pathname.startsWith('/api/v1/stats/')) {
      try {
        const path = url.pathname.slice('/api/v1/stats/'.length);
        const response = await handleStats(request, env, path);
        return addCors(response, origin, allowedOrigins);
      } catch {
        return addCors(Response.json({ error: 'Service temporarily unavailable' }, { status: 503 }), origin, allowedOrigins);
      }
    }

    // Dev keys routes
    if (url.pathname.startsWith('/api/v1/dev-keys/')) {
      try {
        const path = url.pathname.slice('/api/v1/dev-keys/'.length);
        const response = await handleDevKeys(request, env, path);
        return addCors(response, origin, allowedOrigins);
      } catch {
        return addCors(Response.json({ error: 'Service temporarily unavailable' }, { status: 503 }), origin, allowedOrigins);
      }
    }

    // Promo routes
    if (url.pathname.startsWith('/api/v1/promo/')) {
      try {
        const path = url.pathname.slice('/api/v1/promo/'.length);
        const response = await handlePromo(request, env, path);
        return addCors(response, origin, allowedOrigins);
      } catch {
        return addCors(Response.json({ error: 'Service temporarily unavailable' }, { status: 503 }), origin, allowedOrigins);
      }
    }

    // Admin routes
    if (url.pathname.startsWith('/admin/')) {
      try {
        const path = url.pathname.slice('/admin/'.length);
        const response = await handleAdmin(request, env, path);
        return addCors(response, origin, allowedOrigins);
      } catch {
        return addCors(Response.json({ error: 'Service temporarily unavailable' }, { status: 503 }), origin, allowedOrigins);
      }
    }

    // Transparent proxy: /v1/*
    if (url.pathname.startsWith('/v1/')) {
      try {
        const path = url.pathname.slice(4);
        const response = await handleTransparentProxy(request, env, path);
        return addCors(response, origin, allowedOrigins);
      } catch {
        return addCors(Response.json({ error: 'Service temporarily unavailable' }, { status: 503 }), origin, allowedOrigins);
      }
    }

    return addCors(Response.json({ error: 'Not found' }, { status: 404 }), origin, allowedOrigins);
  },
};
