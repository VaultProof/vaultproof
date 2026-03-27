/**
 * Proxy Authentication Middleware
 *
 * Validates that requests come from our Cloudflare Worker.
 * Uses HMAC signature verification — the shared secret never
 * travels over the wire, only a signature derived from it.
 *
 * Checks:
 * 1. X-Proxy-Signature is a valid HMAC(method:path:timestamp, PROXY_SECRET)
 * 2. X-Proxy-Timestamp is within 30 seconds (prevents replay)
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { createHmac, timingSafeEqual } from 'crypto';

const PROXY_SECRET = process.env.PROXY_SECRET || '';
const MAX_TIMESTAMP_DRIFT = 30_000; // 30 seconds

export async function requireProxyAuth(request: FastifyRequest, reply: FastifyReply) {
  // Skip in dev/test
  if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
    return;
  }

  // Skip if no PROXY_SECRET configured
  if (!PROXY_SECRET) {
    return;
  }

  // Allow SDK-direct requests: skip HMAC only for SDK and transparent proxy routes.
  // These routes have their own authenticateDevKey middleware.
  const apiKey = request.headers['x-api-key'] as string;
  if (apiKey && apiKey.startsWith('vp_')) {
    const url = request.url.split('?')[0];
    if (url.startsWith('/api/v1/sdk/') || url.startsWith('/v1/')) {
      return;
    }
    // For non-SDK routes, vp_ key header does NOT bypass HMAC
  }

  const timestamp = request.headers['x-proxy-timestamp'] as string;
  const signature = request.headers['x-proxy-signature'] as string;

  if (!timestamp || !signature) {
    request.log.warn('Proxy auth failed: missing headers');
    return reply.status(403).send({ error: 'Forbidden' });
  }

  // Check timestamp is recent
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts)) {
    return reply.status(403).send({ error: 'Forbidden' });
  }

  const drift = Math.abs(Date.now() - ts);
  if (drift > MAX_TIMESTAMP_DRIFT) {
    request.log.warn(`Proxy auth failed: timestamp drift ${drift}ms`);
    return reply.status(403).send({ error: 'Request expired' });
  }

  // Verify HMAC signature
  const method = request.method;
  const path = request.url.split('?')[0];
  const payload = `${method}:${path}:${timestamp}`;
  const expected = createHmac('sha256', PROXY_SECRET).update(payload).digest('hex');

  if (!safeCompare(signature, expected)) {
    request.log.warn('Proxy auth failed: invalid signature');
    return reply.status(403).send({ error: 'Forbidden' });
  }
}

function safeCompare(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}
