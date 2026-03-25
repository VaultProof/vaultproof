/**
 * VaultProof — Secured Cloudflare Worker Edge Proxy
 *
 * Security layers:
 * 1. HMAC request signing (Worker -> Backend) — prevents direct backend access
 * 2. Timestamp validation — prevents replay of signed requests
 * 3. Rate limiting per IP — prevents brute force
 * 4. CORS restricted to allowed origins
 * 5. Security headers (no sniff, no frame, etc.)
 */

export interface Env {
  BACKEND_URL: string;
  PROXY_SECRET: string; // Shared secret between Worker and Backend
  ALLOWED_ORIGINS: string;
}

// Rate limit: track requests per IP
const ipRequestCounts = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 60; // requests per minute per IP
const RATE_WINDOW = 60_000; // 1 minute

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const backendUrl = env.BACKEND_URL || 'https://dashboard-production-b76c.up.railway.app';
    const proxySecret = env.PROXY_SECRET || '';
    const allowedOrigins = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const origin = request.headers.get('Origin') || '';
    const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';

    // --- Layer 3: Rate limiting per IP ---
    const now = Date.now();
    const ipEntry = ipRequestCounts.get(clientIp);
    if (ipEntry && now < ipEntry.resetAt) {
      if (ipEntry.count >= RATE_LIMIT) {
        return Response.json(
          { error: 'Rate limit exceeded. Try again later.' },
          { status: 429, headers: { ...corsHeaders(origin, allowedOrigins), 'Retry-After': '60' } }
        );
      }
      ipEntry.count++;
    } else {
      ipRequestCounts.set(clientIp, { count: 1, resetAt: now + RATE_WINDOW });
    }

    // Cleanup old entries periodically
    if (ipRequestCounts.size > 10000) {
      for (const [ip, entry] of ipRequestCounts) {
        if (now > entry.resetAt) ipRequestCounts.delete(ip);
      }
    }

    // --- Layer 4: CORS preflight ---
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin, allowedOrigins) });
    }

    // Health check
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return Response.json(
        { status: 'ok', service: 'vaultproof-edge', edge: true, secured: true },
        { headers: { ...corsHeaders(origin, allowedOrigins), ...securityHeaders() } }
      );
    }

    // --- Forward /api/* to backend with signed request ---
    if (url.pathname.startsWith('/api/')) {
      try {
        // --- Layer 1 + 2: HMAC request signing with timestamp ---
        const timestamp = Date.now().toString();
        const signPayload = `${request.method}:${url.pathname}:${timestamp}`;
        const signature = await hmacSign(signPayload, proxySecret);

        const headers = forwardHeaders(request.headers);
        headers.set('X-Proxy-Signature', signature);
        headers.set('X-Proxy-Timestamp', timestamp);
        headers.set('X-Forwarded-For', clientIp);

        const backendRequest = new Request(`${backendUrl}${url.pathname}${url.search}`, {
          method: request.method,
          headers,
          body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
        });

        const response = await fetch(backendRequest);

        const contentType = response.headers.get('content-type') || '';

        // SSE streaming
        if (contentType.includes('text/event-stream')) {
          return new Response(response.body, {
            status: response.status,
            headers: {
              ...Object.fromEntries(response.headers.entries()),
              ...corsHeaders(origin, allowedOrigins),
              ...securityHeaders(),
            },
          });
        }

        // Standard response
        const data = await response.text();
        return new Response(data, {
          status: response.status,
          headers: {
            'Content-Type': contentType || 'application/json',
            ...corsHeaders(origin, allowedOrigins),
            ...securityHeaders(),
          },
        });
      } catch {
        return Response.json(
          { error: 'Edge proxy error' },
          { status: 502, headers: { ...corsHeaders(origin, allowedOrigins), ...securityHeaders() } }
        );
      }
    }

    return Response.json(
      { error: 'Not found' },
      { status: 404, headers: { ...corsHeaders(origin, allowedOrigins), ...securityHeaders() } }
    );
  },
};

// --- HMAC Signing ---
async function hmacSign(payload: string, secret: string): Promise<string> {
  if (!secret) return 'no-secret';
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// --- CORS ---
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

// --- Security Headers ---
function securityHeaders(): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
}

// --- Forward Headers ---
function forwardHeaders(headers: Headers): Headers {
  const forwarded = new Headers();
  const forwardList = ['authorization', 'content-type', 'content-length', 'accept'];
  for (const key of forwardList) {
    const value = headers.get(key);
    if (value) forwarded.set(key, value);
  }
  return forwarded;
}
