/**
 * Security and CORS headers.
 *
 * Ported and extended from packages/worker/src/index.ts.
 */

/**
 * Return standard security response headers.
 * Applied to every response from the MCP server.
 */
export function securityHeaders(): Record<string, string> {
  return {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
}

/**
 * Return CORS headers for the given request origin.
 *
 * - If `origin` is present in `allowedOrigins`, reflects it back.
 * - Never sets `Access-Control-Allow-Origin: *` — wildcard would allow any
 *   origin to send credentialed requests, which is a security risk.
 * - If origin is not allowed, omits the ACAO header entirely so the browser
 *   blocks the cross-origin request.
 */
export function corsHeaders(
  origin: string | null,
  allowedOrigins: string[]
): Record<string, string> {
  const isAllowed = origin !== null && allowedOrigins.includes(origin);
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-API-Key, X-VaultProof-Session',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };
  if (isAllowed && origin) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

/**
 * Build a JSON Response with security headers merged in.
 *
 * @param data         - Value to JSON-serialize as the body
 * @param status       - HTTP status code (default 200)
 * @param extraHeaders - Additional headers to merge (e.g. CORS)
 */
export function jsonResponse(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...securityHeaders(),
      ...extraHeaders,
    },
  });
}

/**
 * Build a JSON error Response compatible with OAuth 2.0 error format.
 *
 * Returns `{ error, error_description }` with security headers.
 *
 * @param status      - HTTP status code
 * @param error       - OAuth/API error code (e.g. "invalid_request")
 * @param description - Human-readable description (optional)
 */
export function errorResponse(
  status: number,
  error: string,
  description?: string,
  extraHeaders?: Record<string, string>,
): Response {
  const body: { error: string; error_description?: string } = { error };
  if (description) body.error_description = description;
  return jsonResponse(body, status, extraHeaders);
}
