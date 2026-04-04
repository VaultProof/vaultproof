/**
 * HMAC-signed backend caller.
 *
 * Every request to the Railway backend is signed with:
 *   X-Proxy-Signature: HMAC-SHA256(method:pathname:timestamp, PROXY_SECRET)
 *   X-Proxy-Timestamp: <ms since epoch>
 *
 * This matches the verification logic in
 * packages/backend/src/middleware/proxy-auth.ts exactly.
 */

import { hmacSign } from '../lib/crypto.js';
import { isPublicUrl } from '../lib/ssrf.js';
import type { Env } from '../types.js';

/** Build the signed headers required by the backend proxy-auth middleware. */
async function buildProxyHeaders(
  method: string,
  pathname: string,
  env: Env
): Promise<Record<string, string>> {
  const timestamp = Date.now().toString();
  const payload = `${method}:${pathname}:${timestamp}`;
  const signature = await hmacSign(payload, env.PROXY_SECRET);
  return {
    'X-Proxy-Signature': signature,
    'X-Proxy-Timestamp': timestamp,
  };
}

/**
 * Call the Railway backend on behalf of an end-user using their developer key.
 *
 * Attaches:
 * - HMAC proxy-auth headers (prevents direct backend access)
 * - `X-API-Key: <devKey>` so the backend can identify the user via the SDK
 *   `authenticateDevKey` middleware.
 *
 * @param path   - Backend path, e.g. `/api/v1/sdk/keys`
 * @param method - HTTP method
 * @param body   - Request body (serialized as JSON when present)
 * @param devKey - `vp_live_…` developer key for user authentication
 * @param env    - Worker environment bindings
 */
export async function callBackend(
  path: string,
  method: 'GET' | 'POST' | 'PUT',
  body: unknown | undefined,
  devKey: string,
  env: Env
): Promise<Response> {
  // Guard against operator misconfiguration routing user credentials to non-HTTPS targets
  if (!env.BACKEND_URL.startsWith('https://')) {
    throw new Error('BACKEND_URL must be an HTTPS URL');
  }
  if (!isPublicUrl(env.BACKEND_URL)) {
    throw new Error('BACKEND_URL must be a public HTTPS URL');
  }
  const url = new URL(path, env.BACKEND_URL);
  const proxyHeaders = await buildProxyHeaders(method, url.pathname, env);

  const headers: Record<string, string> = {
    ...(method !== 'GET' && body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    'X-API-Key': devKey,
    ...proxyHeaders,
  };

  const request = new Request(url.toString(), {
    method,
    headers,
    body: method !== 'GET' && body !== undefined ? JSON.stringify(body) : undefined,
  });

  return fetch(request);
}

/**
 * Call the Railway backend for admin / user-management operations that
 * require Supabase authentication rather than a developer key.
 *
 * Attaches:
 * - HMAC proxy-auth headers
 * - `Authorization: Bearer <supabaseJwt>` for Supabase-guarded routes
 *
 * @param path        - Backend path, e.g. `/api/v1/admin/users`
 * @param method      - HTTP method
 * @param body        - Request body (serialized as JSON when present)
 * @param supabaseJwt - Supabase JWT for the authenticated user
 * @param env         - Worker environment bindings
 */
export async function callBackendAsAdmin(
  path: string,
  method: 'GET' | 'POST',
  body: unknown | undefined,
  supabaseJwt: string,
  env: Env
): Promise<Response> {
  const url = new URL(path, env.BACKEND_URL);
  const proxyHeaders = await buildProxyHeaders(method, url.pathname, env);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${supabaseJwt}`,
    ...proxyHeaders,
  };

  const request = new Request(url.toString(), {
    method,
    headers,
    body: method !== 'GET' && body !== undefined ? JSON.stringify(body) : undefined,
  });

  return fetch(request);
}
