import { z } from 'zod';
import { errorResponse, jsonResponse } from '../lib/security-headers.js';
import { generateToken } from '../lib/crypto.js';
import type { Env } from '../types.js';

const registerSchema = z.object({
  client_name: z.string().min(1).max(200),
  redirect_uris: z.array(z.string().url()).min(1).max(10),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.literal('none').optional(),
});

/**
 * POST /oauth/register
 *
 * RFC 7591 — OAuth 2.0 Dynamic Client Registration.
 * Allows MCP clients (e.g. Claude Code) to register themselves at runtime
 * instead of requiring hardcoded entries in REGISTERED_CLIENTS.
 */
export async function handleRegister(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse(405, 'method_not_allowed');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'invalid_request', 'Expected JSON body');
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(400, 'invalid_client_metadata', parsed.error.issues.map(i => i.message).join('; '));
  }

  const data = parsed.data;

  // Validate redirect URIs — allow http://localhost and http://127.0.0.1 for local
  // clients, https:// for remote clients, and app-specific schemes (claude://, cursor://, vscode://).
  for (const uri of data.redirect_uris) {
    if (uri.startsWith('claude://') || uri.startsWith('cursor://') || uri.startsWith('vscode://')) {
      continue; // App-specific schemes are allowed
    }
    const u = new URL(uri);
    const isLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (!isLocal && u.protocol !== 'https:') {
      return errorResponse(400, 'invalid_redirect_uri', `redirect_uri must use https, or be localhost/127.0.0.1: ${uri}`);
    }
  }

  // Generate a client_id with dyn_ prefix so we can distinguish dynamic clients
  const clientId = 'dyn_' + generateToken().slice(0, 32);

  // Store in KV with 90-day TTL (clients re-register as needed)
  const clientRecord = {
    clientId,
    clientName: data.client_name,
    redirectUris: data.redirect_uris,
    createdAt: Date.now(),
  };

  await env.MCP_SESSIONS.put(
    `client:${clientId}`,
    JSON.stringify(clientRecord),
    { expirationTtl: 90 * 24 * 60 * 60 } // 90 days
  );

  return jsonResponse({
    client_id: clientId,
    client_name: data.client_name,
    redirect_uris: data.redirect_uris,
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  }, 201);
}
