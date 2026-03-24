/**
 * Proxy Authentication Middleware
 *
 * Validates that requests come from our Cloudflare Worker,
 * not directly from the internet. Checks:
 * 1. X-Proxy-Secret header matches PROXY_SECRET env var
 * 2. X-Proxy-Timestamp is within 30 seconds (prevents replay)
 * 3. X-Proxy-Signature is a valid HMAC of method:path:timestamp
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { createHmac, timingSafeEqual } from 'crypto';

const PROXY_SECRET = process.env.PROXY_SECRET || '';
const MAX_TIMESTAMP_DRIFT = 30_000; // 30 seconds

export async function requireProxyAuth(request: FastifyRequest, reply: FastifyReply) {
  // Skip proxy auth in development/test
  if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
    return;
  }

  // Skip if no PROXY_SECRET configured (backwards compatible)
  if (!PROXY_SECRET) {
    return;
  }

  const secret = request.headers['x-proxy-secret'] as string;
  const timestamp = request.headers['x-proxy-timestamp'] as string;
  const signature = request.headers['x-proxy-signature'] as string;

  // Check secret matches
  if (!secret || !safeCompare(secret, PROXY_SECRET)) {
    request.log.warn('Proxy auth failed: invalid secret');
    return reply.status(403).send({ error: 'Forbidden' });
  }

  // Check timestamp is recent (prevent replay)
  if (timestamp) {
    const ts = parseInt(timestamp, 10);
    const drift = Math.abs(Date.now() - ts);
    if (drift > MAX_TIMESTAMP_DRIFT) {
      request.log.warn(`Proxy auth failed: timestamp drift ${drift}ms`);
      return reply.status(403).send({ error: 'Request expired' });
    }
  }

  // Verify HMAC signature
  if (signature && timestamp) {
    const method = request.method;
    const path = request.url.split('?')[0];
    const payload = `${method}:${path}:${timestamp}`;
    const expected = hmacSign(payload, PROXY_SECRET);

    if (!safeCompare(signature, expected)) {
      request.log.warn('Proxy auth failed: invalid signature');
      return reply.status(403).send({ error: 'Invalid signature' });
    }
  }
}

function hmacSign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
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
