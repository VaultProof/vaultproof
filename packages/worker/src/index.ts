/**
 * ZK Vault — Cloudflare Worker Proxy
 *
 * Lightweight edge proxy that forwards requests to the
 * Railway backend. Adds CORS, caching headers, and edge latency.
 *
 * This is a thin proxy layer — all business logic (auth, ZK verification,
 * Shamir reconstruction) runs on the Railway backend.
 *
 * Future: Move reconstruction logic directly into the Worker
 * to eliminate the Railway hop entirely.
 */

export interface Env {
  BACKEND_URL: string;
  ALLOWED_ORIGINS: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const backendUrl = env.BACKEND_URL || 'https://dashboard-production-b76c.up.railway.app';
    const allowedOrigins = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim());
    const origin = request.headers.get('Origin') || '';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin, allowedOrigins),
      });
    }

    // Health check
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return Response.json(
        { status: 'ok', service: 'zkvault-edge', edge: true },
        { headers: corsHeaders(origin, allowedOrigins) }
      );
    }

    // Forward all /api/* requests to Railway backend
    if (url.pathname.startsWith('/api/')) {
      try {
        const backendRequest = new Request(`${backendUrl}${url.pathname}${url.search}`, {
          method: request.method,
          headers: forwardHeaders(request.headers),
          body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
        });

        const response = await fetch(backendRequest);

        // Check if streaming response (SSE)
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('text/event-stream')) {
          // Stream through directly
          return new Response(response.body, {
            status: response.status,
            headers: {
              ...Object.fromEntries(response.headers.entries()),
              ...corsHeaders(origin, allowedOrigins),
            },
          });
        }

        // Standard JSON response
        const data = await response.text();
        return new Response(data, {
          status: response.status,
          headers: {
            'Content-Type': contentType || 'application/json',
            ...corsHeaders(origin, allowedOrigins),
          },
        });
      } catch (err) {
        return Response.json(
          { error: 'Edge proxy error' },
          { status: 502, headers: corsHeaders(origin, allowedOrigins) }
        );
      }
    }

    // Default: 404
    return Response.json(
      { error: 'Not found' },
      { status: 404, headers: corsHeaders(origin, allowedOrigins) }
    );
  },
};

function corsHeaders(origin: string, allowed: string[]): Record<string, string> {
  const isAllowed = allowed.length === 0 || allowed.includes(origin) || allowed.includes('*');
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin || '*' : '',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };
}

function forwardHeaders(headers: Headers): Headers {
  const forwarded = new Headers();
  // Forward auth and content headers, strip hop-by-hop
  const forwardList = ['authorization', 'content-type', 'content-length', 'accept', 'user-agent'];
  for (const key of forwardList) {
    const value = headers.get(key);
    if (value) forwarded.set(key, value);
  }
  return forwarded;
}
