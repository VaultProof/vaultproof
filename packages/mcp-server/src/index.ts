/**
 * VaultProof MCP Server — Cloudflare Worker entry point.
 *
 * Route table:
 *   GET  /.well-known/oauth-authorization-server  → OAuth AS metadata
 *   GET  /.well-known/oauth-protected-resource    → Protected resource metadata
 *   GET  /oauth/authorize                          → Authorization endpoint
 *   POST /oauth/token                             → Token endpoint
 *   POST /oauth/callback                          → Consent callback (from dashboard)
 *   OPTIONS /oauth/callback                        → CORS preflight
 *   POST /mcp                                     → Streamable HTTP transport
 *   GET  /mcp/sse                                 → SSE transport (open stream)
 *   POST /mcp/sse/message                         → SSE transport (message channel)
 *   GET  /health                                  → Health check
 *   OPTIONS *                                     → CORS preflight
 *   *    *                                        → 404
 */

import { handleAuthorizationServerMetadata, handleProtectedResourceMetadata } from './oauth/metadata.js';
import { handleAuthorize } from './oauth/authorize.js';
import { handleToken } from './oauth/token.js';
import { handleCallback } from './oauth/callback.js';
import { handleStreamableHttp } from './mcp/transport-http.js';
import { handleSse, handleSseMessage } from './mcp/transport-sse.js';
import { securityHeaders, jsonResponse, errorResponse } from './lib/security-headers.js';
import { validateToken } from './auth/validate-token.js';
import { sha256Hex } from './lib/crypto.js';
import { checkUserRateLimit, checkIpRateLimit } from './lib/rate-limit.js';
import type { Env } from './types.js';

/** Apply security headers to any existing Response. */
function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(securityHeaders())) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// MCP clients (Claude Desktop, Cursor) that need cross-origin access
const MCP_ALLOWED_ORIGINS = [
  'https://claude.ai',
  'https://cursor.sh',
  'https://vaultproof.dev',
];

/** Build CORS preflight response for OPTIONS requests. */
function corsPreflight(request: Request): Response {
  const origin = request.headers.get('Origin') ?? '';
  // Reflect only registered origins — never wildcard (consistent with corsHeaders helper)
  const allowedOrigin = MCP_ALLOWED_ORIGINS.includes(origin) ? origin : '';
  return new Response(null, {
    status: 204,
    headers: {
      ...securityHeaders(),
      ...(allowedOrigin ? { 'Access-Control-Allow-Origin': allowedOrigin, 'Vary': 'Origin' } : {}),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { method, pathname } = { method: request.method, pathname: url.pathname };

    // ── CORS preflight ────────────────────────────────────────────────────────
    if (method === 'OPTIONS') {
      // /oauth/callback has its own preflight handling in the callback handler
      if (pathname === '/oauth/callback') {
        return withSecurityHeaders(await handleCallback(request, env));
      }
      return corsPreflight(request);
    }

    // ── Route dispatch ────────────────────────────────────────────────────────
    let response: Response;

    if (method === 'GET' && pathname === '/.well-known/oauth-authorization-server') {
      response = handleAuthorizationServerMetadata(env);
    } else if (method === 'GET' && pathname === '/.well-known/oauth-protected-resource') {
      response = handleProtectedResourceMetadata(env);
    } else if (method === 'GET' && pathname === '/oauth/authorize') {
      const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
      if (!await checkIpRateLimit(ip, env)) {
        response = errorResponse(429, 'rate_limit_exceeded', 'Too many requests', { 'Retry-After': '60' });
      } else {
        response = await handleAuthorize(request, env);
      }
    } else if (method === 'POST' && pathname === '/oauth/token') {
      const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
      if (!await checkIpRateLimit(ip, env)) {
        response = errorResponse(429, 'rate_limit_exceeded', 'Too many requests', { 'Retry-After': '60' });
      } else {
        response = await handleToken(request, env);
      }
    } else if (method === 'POST' && pathname === '/oauth/callback') {
      // Rate-limit to prevent auth-code flooding
      const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
      if (!await checkIpRateLimit(ip, env)) {
        response = errorResponse(429, 'rate_limit_exceeded', 'Too many requests', { 'Retry-After': '60' });
      } else {
        response = await handleCallback(request, env);
      }
    } else if (method === 'POST' && pathname === '/oauth/revoke') {
      // Token revocation — allows clients to invalidate a compromised token before expiry
      const sessionOrResp = await validateToken(request, env);
      if (sessionOrResp instanceof Response) {
        response = sessionOrResp;
      } else {
        const authHeader = request.headers.get('Authorization') || '';
        const token = authHeader.slice('Bearer '.length);
        const hash = await sha256Hex(token);
        await env.MCP_SESSIONS.delete(`session:${hash}`);
        response = jsonResponse({ revoked: true });
      }
    } else if (method === 'POST' && pathname === '/mcp') {
      // Validate token once — pass pre-validated session to the handler to avoid a
      // second KV read + TTL refresh inside handleStreamableHttp.
      const sessionOrResp = await validateToken(request, env);
      if (sessionOrResp instanceof Response) {
        response = sessionOrResp;
      } else {
        const allowed = await checkUserRateLimit(sessionOrResp.userId, env);
        if (!allowed) {
          response = errorResponse(429, 'rate_limit_exceeded', 'Too many requests', {
            'Retry-After': '60',
          });
        } else {
          response = await handleStreamableHttp(request, env, sessionOrResp);
        }
      }
    } else if (method === 'GET' && pathname === '/mcp/sse') {
      response = await handleSse(request, env);
    } else if (method === 'POST' && pathname === '/mcp/sse/message') {
      // Same pattern: validate once, pass session to avoid double KV read.
      const sessionOrResp = await validateToken(request, env);
      if (sessionOrResp instanceof Response) {
        response = sessionOrResp;
      } else {
        const allowed = await checkUserRateLimit(sessionOrResp.userId, env);
        if (!allowed) {
          response = errorResponse(429, 'rate_limit_exceeded', 'Too many requests', {
            'Retry-After': '60',
          });
        } else {
          response = await handleSseMessage(request, env, sessionOrResp);
        }
      }
    } else if (method === 'GET' && pathname === '/health') {
      response = jsonResponse({ status: 'ok' });
    } else {
      response = errorResponse(404, 'not_found', 'The requested resource was not found');
    }

    // Apply security headers to every response
    return withSecurityHeaders(response);
  },
};
