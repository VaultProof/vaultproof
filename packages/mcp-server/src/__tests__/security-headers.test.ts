/**
 * Tests for src/lib/security-headers.ts
 */
import { describe, it, expect } from 'vitest';
import {
  securityHeaders,
  corsHeaders,
  jsonResponse,
  errorResponse,
} from '../lib/security-headers.js';

// ---------------------------------------------------------------------------
// securityHeaders
// ---------------------------------------------------------------------------
describe('securityHeaders', () => {
  it('includes HSTS', () => {
    const h = securityHeaders();
    expect(h['Strict-Transport-Security']).toContain('max-age=31536000');
    expect(h['Strict-Transport-Security']).toContain('includeSubDomains');
  });

  it('includes X-Content-Type-Options: nosniff', () => {
    expect(securityHeaders()['X-Content-Type-Options']).toBe('nosniff');
  });

  it('includes X-Frame-Options: DENY', () => {
    expect(securityHeaders()['X-Frame-Options']).toBe('DENY');
  });

  it('includes Referrer-Policy', () => {
    expect(securityHeaders()['Referrer-Policy']).toBeTruthy();
  });

  it('includes Permissions-Policy', () => {
    expect(securityHeaders()['Permissions-Policy']).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// corsHeaders
// ---------------------------------------------------------------------------
describe('corsHeaders', () => {
  const allowed = ['https://app.vaultproof.dev', 'https://vaultproof.dev'];

  it('reflects origin back when it is in allowedOrigins', () => {
    const h = corsHeaders('https://vaultproof.dev', allowed);
    expect(h['Access-Control-Allow-Origin']).toBe('https://vaultproof.dev');
  });

  it('does NOT set Access-Control-Allow-Origin when origin is not allowed', () => {
    const h = corsHeaders('https://evil.com', allowed);
    expect(h['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('does NOT set Access-Control-Allow-Origin when origin is null', () => {
    const h = corsHeaders(null, allowed);
    expect(h['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('never sets wildcard (*)', () => {
    const h = corsHeaders('https://evil.com', []);
    expect(h['Access-Control-Allow-Origin']).not.toBe('*');
  });

  it('includes Access-Control-Allow-Methods', () => {
    const h = corsHeaders('https://vaultproof.dev', allowed);
    expect(h['Access-Control-Allow-Methods']).toContain('GET');
    expect(h['Access-Control-Allow-Methods']).toContain('POST');
  });

  it('includes Access-Control-Allow-Headers with expected values', () => {
    const h = corsHeaders('https://vaultproof.dev', allowed);
    expect(h['Access-Control-Allow-Headers']).toContain('Authorization');
    expect(h['Access-Control-Allow-Headers']).toContain('Content-Type');
  });

  it('includes Access-Control-Allow-Credentials: true', () => {
    const h = corsHeaders('https://vaultproof.dev', allowed);
    expect(h['Access-Control-Allow-Credentials']).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// jsonResponse
// ---------------------------------------------------------------------------
describe('jsonResponse', () => {
  it('defaults to status 200', () => {
    const r = jsonResponse({ ok: true });
    expect(r.status).toBe(200);
  });

  it('sets Content-Type: application/json', () => {
    const r = jsonResponse({ ok: true });
    expect(r.headers.get('content-type')).toBe('application/json');
  });

  it('includes security headers in the response', () => {
    const r = jsonResponse({ ok: true });
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('x-frame-options')).toBe('DENY');
  });

  it('serializes the body as JSON', async () => {
    const r = jsonResponse({ hello: 'world' });
    const body = await r.json();
    expect(body).toEqual({ hello: 'world' });
  });

  it('uses the provided status code', () => {
    const r = jsonResponse({ error: 'not found' }, 404);
    expect(r.status).toBe(404);
  });

  it('merges extraHeaders', () => {
    const r = jsonResponse({ ok: true }, 200, { 'Access-Control-Allow-Origin': 'https://a.com' });
    expect(r.headers.get('access-control-allow-origin')).toBe('https://a.com');
  });
});

// ---------------------------------------------------------------------------
// errorResponse
// ---------------------------------------------------------------------------
describe('errorResponse', () => {
  it('sets the given status code', () => {
    const r = errorResponse(400, 'invalid_request');
    expect(r.status).toBe(400);
  });

  it('includes the error field', async () => {
    const r = errorResponse(400, 'invalid_request');
    const body = await r.json() as { error: string };
    expect(body.error).toBe('invalid_request');
  });

  it('includes error_description when provided', async () => {
    const r = errorResponse(401, 'unauthorized', 'Token expired');
    const body = await r.json() as { error: string; error_description: string };
    expect(body.error_description).toBe('Token expired');
  });

  it('omits error_description when not provided', async () => {
    const r = errorResponse(403, 'forbidden');
    const body = await r.json() as Record<string, unknown>;
    expect(body['error_description']).toBeUndefined();
  });

  it('includes security headers', () => {
    const r = errorResponse(500, 'server_error');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
