import { randomBytes } from 'node:crypto';

function createNonce(): string {
  return randomBytes(16).toString('base64');
}

function nonceInlineScripts(html: string, nonce: string): string {
  return html.replace(/<script(\s|>)/g, `<script nonce="${nonce}"$1`);
}

function buildHtmlCsp(nonce: string): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "script-src 'self' 'strict-dynamic' " +
      `'nonce-${nonce}' ` +
      'https://cdn.jsdelivr.net https://cdn.mxpnl.com',
    "script-src-attr 'none'",
    "connect-src 'self' " +
      'https://gwzkjiomemjlhtrdrlan.supabase.co ' +
      'wss://gwzkjiomemjlhtrdrlan.supabase.co ' +
      'https://api.vaultproof.dev https://staging-api.vaultproof.dev ' +
      'https://init.vaultproof.dev https://vaultproof-init-staging.vaultproof.workers.dev ' +
      'https://api-js.mixpanel.com https://api.mixpanel.com https://decide.mixpanel.com https://*.mixpanel.com',
  ].join('; ');
}

function buildNonHtmlCsp(): string {
  return [
    "default-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function applyCommonHeaders(headers: Headers): void {
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  headers.set(
    'permissions-policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
  );
}

export async function withEnterpriseSecurityHeaders(response: Response): Promise<Response> {
  const headers = new Headers(response.headers);
  applyCommonHeaders(headers);

  const contentType = headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('text/html')) {
    if (!headers.has('content-security-policy')) {
      headers.set('content-security-policy', buildNonHtmlCsp());
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  const nonce = createNonce();
  const body = nonceInlineScripts(await response.text(), nonce);
  headers.set('content-security-policy', buildHtmlCsp(nonce));

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
