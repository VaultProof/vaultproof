import { z } from 'zod';
import { errorResponse } from '../lib/security-headers.js';
import { hmacSign } from '../lib/crypto.js';
import { REGISTERED_CLIENTS, VALID_SCOPES } from './types.js';
import type { Env } from '../types.js';

const authorizeSchema = z.object({
  response_type:         z.literal('code'),
  client_id:             z.string().min(1).max(100),
  redirect_uri:          z.string().url(),
  code_challenge:        z.string().min(43).max(128).regex(/^[A-Za-z0-9\-_]+$/, 'code_challenge must be BASE64URL'),
  code_challenge_method: z.literal('S256'),
  scope:                 z.string().min(1),
  state:                 z.string().min(16).max(256),
  resource:              z.string().optional(),
});

/**
 * GET /oauth/authorize
 *
 * Validates the authorization request and redirects the user to the
 * VaultProof dashboard consent page at https://vaultproof.dev/mcp-auth.
 */
export async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());

  // 1. Zod validation
  const parsed = authorizeSchema.safeParse(params);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join('; ');
    return errorResponse(400, 'invalid_request', message);
  }

  const data = parsed.data;

  // 2. Validate client_id — check hardcoded registry first, then KV for dynamic clients
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
    // Dynamic client validated — continue with the rest of the flow
  } else {
    // 3. Validate redirect_uri (exact string match) for hardcoded clients
    if (!client.redirectUris.includes(data.redirect_uri)) {
      return errorResponse(400, 'invalid_redirect_uri', 'redirect_uri not registered for this client');
    }
  }

  // 4. Validate resource if present — accept with or without path
  if (data.resource !== undefined) {
    try {
      const resourceOrigin = new URL(data.resource).origin;
      if (resourceOrigin !== 'https://mcp.vaultproof.dev') {
        return errorResponse(400, 'invalid_target', 'Invalid resource');
      }
    } catch {
      return errorResponse(400, 'invalid_target', 'Invalid resource');
    }
  }

  // 5. Validate scopes
  const requestedScopes = data.scope.split(' ').filter(Boolean);
  const validScopeSet = new Set<string>(VALID_SCOPES);
  for (const s of requestedScopes) {
    if (!validScopeSet.has(s)) {
      return errorResponse(400, 'invalid_scope', 'Invalid scope requested');
    }
  }

  // 6. Defensive check on code_challenge_method (already enforced by Zod literal)
  if (data.code_challenge_method !== 'S256') {
    return errorResponse(400, 'invalid_request', 'Only S256 code_challenge_method is supported');
  }

  // 7. Build consent redirect to the dashboard — only whitelist known params
  // (prevents parameter pollution: extra attacker-injected query params are dropped)
  const consentUrl = new URL('https://vaultproof.dev/mcp-auth');
  const FORWARDED_PARAMS = ['client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'scope', 'state', 'resource'] as const;
  for (const key of FORWARDED_PARAMS) {
    const value = url.searchParams.get(key);
    if (value !== null) consentUrl.searchParams.set(key, value);
  }

  // 8. HMAC-sign the state parameter to detect tampering in callback
  const stateSignature = await hmacSign(data.state, env.MCP_SESSION_ENCRYPTION_KEY);
  consentUrl.searchParams.set('state_sig', stateSignature);

  return Response.redirect(consentUrl.toString(), 302);
}
