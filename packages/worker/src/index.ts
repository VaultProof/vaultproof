import type { Env } from './types.js';
import { handleTransparentProxy } from './routes/transparent-proxy.js';

async function forwardToRailway(request: Request, url: URL, env: Env): Promise<Response> {
  const timestamp = Date.now().toString();
  const signPayload = `${request.method}:${url.pathname}:${timestamp}`;
  const encoder = new TextEncoder();
  const keyData = encoder.encode(env.PROXY_SECRET);
  const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(signPayload));
  const signature = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');

  const headers = new Headers(request.headers);
  headers.set('X-Proxy-Signature', signature);
  headers.set('X-Proxy-Timestamp', timestamp);
  headers.set('X-Forwarded-For', request.headers.get('CF-Connecting-IP') || 'unknown');

  return fetch(`${env.BACKEND_URL}${url.pathname}${url.search}`, {
    method: request.method,
    headers,
    body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
  });
}

function corsHeaders(origin: string, allowedOrigins: string[]): Record<string, string> {
  const isAllowed = allowedOrigins.includes(origin);
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : allowedOrigins[0],
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

    // DEBUG: temporary endpoint to test Supabase connection + key lookup
    if (url.pathname === '/debug-auth') {
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
        const testHash = '42cd9061d8940cbb20228dc595902002b15e028734077f96a4bf3a2e8f0c3867';
        const { data, error } = await sb.from('developer_keys').select('id, key_hash, user_id, revoked_at').eq('key_hash', testHash).single();
        return Response.json({
          supabaseUrl: env.SUPABASE_URL ? 'set (' + env.SUPABASE_URL.slice(0, 30) + '...)' : 'NOT SET',
          serviceKeySet: !!env.SUPABASE_SERVICE_ROLE_KEY,
          serviceKeyPrefix: env.SUPABASE_SERVICE_ROLE_KEY?.slice(0, 10) || 'NOT SET',
          queryError: error?.message || null,
          found: !!data,
          data: data ? { id: data.id, user_id: data.user_id, revoked: data.revoked_at } : null,
        });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500 });
      }
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

    // Transparent proxy: /v1/* — handled at the edge, falls back to Railway
    if (url.pathname.startsWith('/v1/')) {
      try {
        const path = url.pathname.slice(4);
        const response = await handleTransparentProxy(request, env, path);
        return addCors(response, origin, allowedOrigins);
      } catch {
        // Fallback: forward to Railway transparent proxy
        if (env.BACKEND_URL && env.PROXY_SECRET) {
          try {
            const fallbackResponse = await forwardToRailway(request, url, env);
            return addCors(fallbackResponse, origin, allowedOrigins);
          } catch {}
        }
        return addCors(Response.json({ error: 'Service temporarily unavailable' }, { status: 503 }), origin, allowedOrigins);
      }
    }

    // All other routes: forward to Railway backend
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin/') || url.pathname.startsWith('/analytics/') || url.pathname.startsWith('/waitlist')) {
      if (!env.BACKEND_URL || !env.PROXY_SECRET) {
        return addCors(Response.json({ error: 'Backend not configured' }, { status: 500 }), origin, allowedOrigins);
      }

      const backendResponse = await forwardToRailway(request, url, env);
      return addCors(
        new Response(backendResponse.body, { status: backendResponse.status, headers: backendResponse.headers }),
        origin, allowedOrigins
      );
    }

    return addCors(Response.json({ error: 'Not found' }, { status: 404 }), origin, allowedOrigins);
  },
};
