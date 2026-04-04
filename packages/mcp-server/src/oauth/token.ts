import { z } from 'zod';
import { errorResponse, jsonResponse } from '../lib/security-headers.js';
import { generateToken, sha256Hex, generatePkceChallenge, timingSafeEqual, encryptAesGcm } from '../lib/crypto.js';
import type { OAuthCode, McpSession } from './types.js';
import type { Env } from '../types.js';

const tokenSchema = z.object({
  grant_type:    z.literal('authorization_code'),
  code:          z.string().min(1).max(256),
  redirect_uri:  z.string().url(),
  client_id:     z.string().min(1).max(100),
  code_verifier: z.string().min(43).max(128),
});

/**
 * POST /oauth/token
 *
 * Exchanges an authorization code for an access token.
 * Validates PKCE, consumes the code (single-use), and issues a session.
 */
export async function handleToken(request: Request, env: Env): Promise<Response> {
  // Parse application/x-www-form-urlencoded body
  let body: Record<string, string>;
  try {
    const text = await request.text();
    const urlParams = new URLSearchParams(text);
    body = Object.fromEntries(urlParams.entries());
  } catch {
    return errorResponse(400, 'invalid_request', 'Failed to parse request body');
  }

  // 1. Zod validation
  const parsed = tokenSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join('; ');
    return errorResponse(400, 'invalid_request', message);
  }

  const params = parsed.data;

  // 2. Look up the auth code in KV
  const stored = await env.OAUTH_CODES.get(`code:${params.code}`);
  if (!stored) {
    return errorResponse(400, 'invalid_grant', 'Authorization code not found or expired');
  }

  let storedCode: OAuthCode;
  try {
    storedCode = JSON.parse(stored) as OAuthCode;
  } catch {
    return errorResponse(400, 'invalid_grant', 'Malformed authorization code');
  }

  // 3. Explicit expiry check (defense-in-depth: KV TTL is eventually consistent)
  if (storedCode.expiresAt < Date.now()) {
    await env.OAUTH_CODES.delete(`code:${params.code}`);
    return errorResponse(400, 'invalid_grant', 'Authorization code expired');
  }

  // 4. Verify client_id and redirect_uri match stored values
  if (storedCode.clientId !== params.client_id) {
    return errorResponse(400, 'invalid_grant', 'client_id mismatch');
  }
  if (storedCode.redirectUri !== params.redirect_uri) {
    return errorResponse(400, 'invalid_grant', 'redirect_uri mismatch');
  }

  // 4. Verify PKCE: compute S256(code_verifier) and compare to stored challenge
  const computedChallenge = await generatePkceChallenge(params.code_verifier);
  if (!timingSafeEqual(computedChallenge, storedCode.codeChallenge)) {
    return errorResponse(400, 'invalid_grant', 'PKCE verification failed');
  }

  // 5. Compute authCodeHash before deletion — used for duplicate-exchange detection below.
  const authCodeHash = await sha256Hex(params.code);

  // 5a. Delete the code immediately (single-use).
  // NOTE: Cloudflare KV does not support atomic CAS, so two concurrent requests with
  // the same code can both pass steps 2–4 before either delete fires. This is a known
  // limitation — full fix requires migration to Cloudflare Durable Objects.
  // Mitigations applied here:
  //   a) Auth code TTL is 60 s (not 10 min) — see callback.ts.  Concurrent requests
  //      must arrive within the same short window AND beat the delete.
  //   b) used_code:<authCodeHash> entry (step 5b) tracks whether a session was already
  //      issued for this code. A second exchange revokes the first session and returns
  //      an error, limiting the attacker's window to the brief KV propagation delay.
  await env.OAUTH_CODES.delete(`code:${params.code}`);

  // 5b. Duplicate code exchange detection.
  // If another request already issued a session for this code (beating us in the KV race),
  // revoke that session and reject this exchange. The legitimate user will need to re-auth,
  // but the attacker's session is also revoked.
  const usedCodeKey = `used_code:${authCodeHash}`;
  const existingTokenHash = await env.OAUTH_CODES.get(usedCodeKey);
  if (existingTokenHash) {
    await env.MCP_SESSIONS.delete(`session:${existingTokenHash}`);
    return errorResponse(400, 'invalid_grant', 'Authorization code already used');
  }

  // 6. Generate access token and store session
  const accessToken = generateToken();
  const tokenHash = await sha256Hex(accessToken);

  const session: McpSession = {
    userId: storedCode.userId,
    scope: storedCode.scope,
    clientId: params.client_id,
    sessionId: crypto.randomUUID(),
    audience: 'https://mcp.vaultproof.dev',
    encryptedDevKey: storedCode.encryptedDevKey,
    issuedAt: Date.now(),
    authCodeHash,
  };

  // Encrypt session before storage — prevents metadata exposure on KV breach
  const encryptedSession = await encryptAesGcm(JSON.stringify(session), env.MCP_SESSION_ENCRYPTION_KEY);
  await env.MCP_SESSIONS.put(`session:${tokenHash}`, encryptedSession, {
    expirationTtl: 3600,
  });

  // 6a. Record that a session was issued for this code — allows revocation of the
  // first session if a duplicate exchange arrives later (step 5b above).
  // TTL = session TTL + 60 s buffer so the marker outlives any racing requests.
  await env.OAUTH_CODES.put(usedCodeKey, tokenHash, { expirationTtl: 3660 });

  // 7. Return token response
  return jsonResponse({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 3600,
    scope: storedCode.scope,
  });
}
