/**
 * Rate limiting for the init-worker.
 *
 * Two scopes:
 *   - Proxy calls  — keyed on project ID.   60 requests per 60s window.
 *   - Mgmt API     — keyed on user ID.      10 project creations per 60s,
 *                                            60 key uploads per 60s.
 *
 * Hybrid design (same pattern as the legacy worker):
 *   1. In-memory burst bucket per isolate: catches obvious floods without
 *      hitting KV. Resets when the isolate recycles (~seconds).
 *   2. KV window counter: cross-isolate, eventual consistency. Enforces the
 *      true limit even if an attacker hits multiple edge POPs in parallel.
 *
 * The KV minimum TTL is 60s, so windows are rounded to the nearest minute
 * to stay within that constraint without a soft-expiry envelope.
 */
import type { Env } from '../types.js';

// ── In-memory burst limiter ──────────────────────────────────────────────
interface Bucket {
  count: number;
  windowStart: number; // epoch ms
}
const memBuckets = new Map<string, Bucket>();

function checkMemBucket(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = memBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    memBuckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

// ── KV window counter ────────────────────────────────────────────────────
async function checkKvWindow(
  env: Env,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ ok: boolean; count: number }> {
  const windowId = Math.floor(Date.now() / 1000 / windowSeconds);
  const kvKey = `rl:${key}:${windowId}`;

  const current = await env.INIT_RATE_LIMIT.get(kvKey);
  const count = current ? parseInt(current, 10) || 0 : 0;

  if (count >= limit) {
    return { ok: false, count };
  }

  // Increment. Race-tolerant: if two requests write at once, the later write
  // wins and the counter might under-count by one — but the in-memory bucket
  // catches extreme bursts before this matters.
  await env.INIT_RATE_LIMIT.put(kvKey, String(count + 1), {
    expirationTtl: Math.max(60, windowSeconds * 2),
  });
  return { ok: true, count: count + 1 };
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Proxy call limit: 60 requests per 60s window per project.
 * Generous enough for most apps, tight enough to prevent quota burn from
 * a leaked project ID.
 *
 * The in-memory burst is tight (10/sec) because each proxy call runs a
 * scrypt decrypt — too many parallel calls on one isolate blow the CF
 * Workers CPU budget and return 1101. Serial usage at typical rates is
 * unaffected.
 */
export async function checkProxyRateLimit(
  env: Env,
  projectId: string,
): Promise<{ ok: boolean; retryAfter?: number }> {
  const key = `proxy:${projectId}`;

  // Burst: 10 requests / 1s per isolate. Stops parallel scrypt storms.
  if (!checkMemBucket(key, 10, 1_000)) {
    return { ok: false, retryAfter: 1 };
  }

  // Window: 60 / 60s cross-isolate.
  const { ok } = await checkKvWindow(env, key, 60, 60);
  return ok ? { ok: true } : { ok: false, retryAfter: 60 };
}

/**
 * Management API limit: 10 project creations per 60s per user.
 * Blocks mass-create DoS.
 */
export async function checkProjectCreateRateLimit(
  env: Env,
  userId: string,
): Promise<{ ok: boolean; retryAfter?: number }> {
  const key = `projcreate:${userId}`;
  if (!checkMemBucket(key, 5, 10_000)) return { ok: false, retryAfter: 10 };
  const { ok } = await checkKvWindow(env, key, 10, 60);
  return ok ? { ok: true } : { ok: false, retryAfter: 60 };
}

/**
 * Per-IP rate limit for unauthenticated failures. Defends against
 * enumeration of project IDs or JWT brute force.
 * 100 failed requests per minute per IP.
 */
export async function checkFailedAuthRateLimit(
  env: Env,
  ip: string,
): Promise<{ ok: boolean; retryAfter?: number }> {
  if (!ip) return { ok: true }; // don't gate if we can't identify source
  const key = `failauth:${ip}`;
  if (!checkMemBucket(key, 30, 10_000)) return { ok: false, retryAfter: 10 };
  const { ok } = await checkKvWindow(env, key, 100, 60);
  return ok ? { ok: true } : { ok: false, retryAfter: 60 };
}

/**
 * Key upload limit: 60/60s per user. Each init run uploads N keys.
 */
export async function checkKeyUploadRateLimit(
  env: Env,
  userId: string,
): Promise<{ ok: boolean; retryAfter?: number }> {
  const key = `keyupload:${userId}`;
  if (!checkMemBucket(key, 30, 10_000)) return { ok: false, retryAfter: 10 };
  const { ok } = await checkKvWindow(env, key, 60, 60);
  return ok ? { ok: true } : { ok: false, retryAfter: 60 };
}

/**
 * Standard response for rate-limited requests.
 */
export function rateLimitResponse(retryAfter: number): Response {
  return new Response(
    JSON.stringify({ error: 'Rate limit exceeded. Slow down.' }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfter),
      },
    },
  );
}
