/**
 * Token validation for the MCP server.
 *
 * Accepts opaque bearer tokens issued by POST /oauth/token.
 * Rejects JWTs and vp_ developer keys — those are for the backend directly.
 */

import { sha256Hex, decryptAesGcm, encryptAesGcm } from '../lib/crypto.js';
import { errorResponse } from '../lib/security-headers.js';
import type { McpSession } from '../oauth/types.js';
import type { Env } from '../types.js';

const WWW_AUTH =
  'Bearer realm="mcp.vaultproof.dev", resource_metadata_uri="https://mcp.vaultproof.dev/.well-known/oauth-protected-resource"';

/** 401 with WWW-Authenticate on every token rejection path (RFC 6750 §3). */
function tokenError(error: string, description: string): Response {
  return errorResponse(401, error, description, { 'WWW-Authenticate': WWW_AUTH });
}

export interface ValidatedSession {
  userId: string;
  scope: string;
  sessionId: string;
  encryptedDevKey: string;
}

/**
 * Validate an incoming Bearer token against the MCP_SESSIONS KV store.
 *
 * Returns a ValidatedSession on success, or a ready-to-send Response on failure.
 *
 * Steps:
 * 1. Extract Authorization: Bearer <token>
 * 2. Reject JWTs (token.split('.').length === 3)
 * 3. Reject vp_ dev keys
 * 4. Hash token with SHA-256
 * 5. Look up session:<hash> in KV
 * 6. Verify audience
 * 7. Refresh sliding TTL
 * 8. Return session fields
 */
export async function validateToken(
  request: Request,
  env: Env,
): Promise<ValidatedSession | Response> {
  // 1. Extract bearer token
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return tokenError('unauthorized', 'Missing Authorization header');
  }

  const token = authHeader.slice('Bearer '.length);

  // 2. Reject JWTs
  if (token.split('.').length === 3) {
    return tokenError('invalid_token', 'MCP tokens must be opaque bearer tokens, not JWTs');
  }

  // 3. Reject vp_ developer keys
  if (token.startsWith('vp_')) {
    return tokenError('invalid_token', 'Use OAuth 2.1 to authenticate with the MCP server');
  }

  // 4. Hash the token
  const hash = await sha256Hex(token);

  // 5. Look up session in KV
  const stored = await env.MCP_SESSIONS.get(`session:${hash}`);
  if (!stored) {
    return tokenError('invalid_token', 'Session not found or expired');
  }

  // 6. Decrypt and parse
  let session: McpSession;
  try {
    const plaintext = await decryptAesGcm(stored, env.MCP_SESSION_ENCRYPTION_KEY);
    session = JSON.parse(plaintext) as McpSession;
  } catch {
    return tokenError('invalid_token', 'Malformed session data');
  }

  // 7. Verify audience
  if (session.audience !== 'https://mcp.vaultproof.dev') {
    return tokenError('invalid_token', 'Invalid token audience');
  }

  // 8. Refresh sliding TTL (re-encrypt on write — new IV each time)
  const encryptedSession = await encryptAesGcm(JSON.stringify(session), env.MCP_SESSION_ENCRYPTION_KEY);
  await env.MCP_SESSIONS.put(`session:${hash}`, encryptedSession, {
    expirationTtl: 3600,
  });

  // 9. Return session fields
  return {
    userId: session.userId,
    scope: session.scope,
    sessionId: session.sessionId,
    encryptedDevKey: session.encryptedDevKey,
  };
}
