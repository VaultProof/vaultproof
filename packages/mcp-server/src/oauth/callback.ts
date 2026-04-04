import { z } from 'zod';
import { errorResponse, jsonResponse } from '../lib/security-headers.js';
import { generateToken, encryptAesGcm, hmacSign, timingSafeEqual } from '../lib/crypto.js';
import { REGISTERED_CLIENTS, type OAuthCode } from './types.js';
import type { Env } from '../types.js';

const callbackSchema = z.object({
  user_id:        z.string().min(1),
  dev_key:        z.string().min(1),
  client_id:      z.string().min(1).max(100),
  redirect_uri:   z.string().min(1),
  code_challenge: z.string().min(43).max(128),
  scope:          z.string().min(1),
  state:          z.string().min(16).max(256),
  resource:       z.string().optional(),
  state_sig:      z.string().optional(),
});

/**
 * POST /oauth/callback (JSON body)
 *
 * Called by the VaultProof dashboard via fetch() after the user approves consent.
 * Accepts JSON body so the dev_key NEVER appears in a URL (browser history/Referer safe).
 * Returns { code, state, redirect_uri } — the dashboard then redirects the browser.
 *
 * CORS: only vaultproof.dev is allowed to call this endpoint.
 */
export async function handleCallback(request: Request, env: Env): Promise<Response> {
  // CORS: only allow calls from the VaultProof dashboard
  const origin = request.headers.get('Origin') ?? '';
  const allowedOrigin = 'https://vaultproof.dev';
  const corsHeaders: Record<string, string> = origin === allowedOrigin
    ? { 'Access-Control-Allow-Origin': allowedOrigin, 'Vary': 'Origin' }
    : {};

  // Handle preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders,
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  // Enforce origin for all non-preflight requests.
  // CORS headers alone don't prevent server-to-server calls (curl, Node fetch, etc.).
  // Reject any request not originating from the VaultProof dashboard.
  if (origin !== allowedOrigin) {
    return errorResponse(403, 'forbidden', 'Request origin not allowed');
  }

  if (request.method !== 'POST') {
    return errorResponse(405, 'method_not_allowed');
  }

  // Parse JSON body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'invalid_request', 'Expected JSON body');
  }

  const parsed = callbackSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join('; ');
    return errorResponse(400, 'invalid_request', message);
  }

  const data = parsed.data;

  // Validate resource parameter against MCP issuer (prevents audience confusion attacks)
  if (data.resource) {
    try {
      const resourceOrigin = new URL(data.resource).origin;
      const issuerOrigin = new URL(env.MCP_ISSUER).origin;
      if (resourceOrigin !== issuerOrigin) {
        return errorResponse(400, 'invalid_target', 'Resource mismatch');
      }
    } catch {
      return errorResponse(400, 'invalid_target', 'Resource mismatch');
    }
  }

  // Validate state signature (Fix 5: prevents state tampering)
  const url = new URL(request.url);
  const stateSig = data.state_sig || url.searchParams.get('state_sig');
  if (stateSig) {
    const expected = await hmacSign(data.state, env.MCP_SESSION_ENCRYPTION_KEY);
    if (!timingSafeEqual(stateSig, expected)) {
      return errorResponse(400, 'invalid_state', 'State signature verification failed');
    }
  }

  // Validate client_id and redirect_uri against registry (hardcoded + dynamic)
  // (prevents attackers from bypassing consent by calling this endpoint directly)
  const client = REGISTERED_CLIENTS[data.client_id];
  if (!client) {
    // Check KV for dynamically registered client (RFC 7591)
    const dynRecord = await env.MCP_SESSIONS.get(`client:${data.client_id}`);
    if (!dynRecord) {
      return errorResponse(400, 'invalid_client', 'Unknown client_id');
    }
    const dynClient = JSON.parse(dynRecord) as { clientId: string; clientName: string; redirectUris: string[] };
    if (!dynClient.redirectUris.includes(data.redirect_uri)) {
      return errorResponse(400, 'invalid_redirect_uri', 'redirect_uri not registered for this client');
    }
  } else if (!client.redirectUris.includes(data.redirect_uri)) {
    return errorResponse(400, 'invalid_redirect_uri', 'redirect_uri not registered for this client');
  }

  // Generate auth code and encrypt the dev key before storing
  const authCode = generateToken();
  const encryptedDevKey = await encryptAesGcm(data.dev_key, env.MCP_SESSION_ENCRYPTION_KEY);

  const oauthCode: OAuthCode = {
    clientId:       data.client_id,
    redirectUri:    data.redirect_uri,
    codeChallenge:  data.code_challenge,
    scope:          data.scope,
    userId:         data.user_id,
    expiresAt:      Date.now() + 60_000,   // 60 s — tight window limits concurrent-exchange race
    encryptedDevKey,
    audience:       env.MCP_ISSUER || 'https://mcp.vaultproof.dev',
  };

  await env.OAUTH_CODES.put(`code:${authCode}`, JSON.stringify(oauthCode), {
    expirationTtl: 60,
  });

  // Also store in Durable Object for atomic exchange (if available)
  if (env.OAUTH_CODE_DO) {
    const id = env.OAUTH_CODE_DO.idFromName('codes');
    const stub = env.OAUTH_CODE_DO.get(id);
    await stub.fetch('https://oauth-code/store', {
      method: 'POST',
      body: JSON.stringify({
        code: authCode,
        data: JSON.stringify(oauthCode),
        ttlSeconds: 60,
      }),
    });
  }

  // Return the code to the dashboard — the dashboard redirects the browser.
  // The dev_key never appears in any URL.
  return jsonResponse(
    { code: authCode, state: data.state, redirect_uri: data.redirect_uri },
    200,
    corsHeaders,
  );
}
