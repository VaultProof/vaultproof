/**
 * Rate limiting for the init-worker.
 *
 * Two-layer defense:
 *   1. In-memory burst bucket per isolate — catches obvious floods without
 *      a Durable Object round-trip. Best-effort (state not shared across
 *      isolates). Resets on isolate recycle.
 *   2. Durable Object window counter — strongly consistent across all
 *      edge POPs. This is the authoritative enforcement.
 *
 * The in-memory layer exists so well-behaved clients don't pay the DO
 * round-trip cost on every call. When a client bursts past the in-memory
 * threshold, we fall through to the DO which IS strongly consistent and
 * will correctly enforce the limit cross-isolate.
 *
 * Limits:
 *   - Proxy calls: 60/60s per project
 *   - Project creation: 10/60s per user
 *   - Key upload: 60/60s per user
 *   - Failed auth: 100/60s per IP
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

// ── Durable Object window counter ─────────────────────────────────────────
async function checkDoWindow(
  env: Env,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ ok: boolean; retryAfter: number }> {
  const id = env.RATE_LIMITER.idFromName(key);
  const stub = env.RATE_LIMITER.get(id);

  try {
    const res = await stub.fetch('http://internal/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit, windowSeconds }),
    });

    if (!res.ok) {
      // DO is misbehaving. Fail open — don't block legitimate traffic.
      return { ok: true, retryAfter: 0 };
    }

    const data = (await res.json()) as { ok: boolean; retryAfter?: number };
    return { ok: data.ok, retryAfter: data.retryAfter ?? 0 };
  } catch {
    // DO unreachable. Fail open.
    return { ok: true, retryAfter: 0 };
  }
}

// ── Public API ───────────────────────────────────────────────────────────

export async function checkProxyRateLimit(
  env: Env,
  projectId: string,
): Promise<{ ok: boolean; retryAfter?: number }> {
  const key = `proxy:${projectId}`;

  // Burst: 10/sec per isolate
  if (!checkMemBucket(key, 10, 1_000)) {
    return { ok: false, retryAfter: 1 };
  }

  // Window: 60/60s strongly consistent via DO
  return checkDoWindow(env, key, 60, 60);
}

export async function checkProjectCreateRateLimit(
  env: Env,
  userId: string,
): Promise<{ ok: boolean; retryAfter?: number }> {
  const key = `projcreate:${userId}`;
  if (!checkMemBucket(key, 5, 10_000)) return { ok: false, retryAfter: 10 };
  return checkDoWindow(env, key, 10, 60);
}

export async function checkKeyUploadRateLimit(
  env: Env,
  userId: string,
): Promise<{ ok: boolean; retryAfter?: number }> {
  const key = `keyupload:${userId}`;
  if (!checkMemBucket(key, 30, 10_000)) return { ok: false, retryAfter: 10 };
  return checkDoWindow(env, key, 60, 60);
}

export async function checkFailedAuthRateLimit(
  env: Env,
  ip: string,
): Promise<{ ok: boolean; retryAfter?: number }> {
  if (!ip) return { ok: true };
  const key = `failauth:${ip}`;
  if (!checkMemBucket(key, 30, 10_000)) return { ok: false, retryAfter: 10 };
  return checkDoWindow(env, key, 100, 60);
}

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
