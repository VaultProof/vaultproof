/**
 * Atomic rate limiting using Durable Objects.
 *
 * Each rate limit check is routed to a single Durable Object instance
 * keyed by the rate limit subject (userId or IP). Single-threaded
 * execution guarantees no concurrent bypass.
 *
 * Falls back to KV-based limiting if RATE_LIMITER binding is unavailable.
 */

import type { Env } from '../types.js';

async function checkLimit(
  env: Env,
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  if (env.RATE_LIMITER) {
    const id = env.RATE_LIMITER.idFromName(key);
    const stub = env.RATE_LIMITER.get(id);
    const resp = await stub.fetch('https://rate-limiter/check', {
      method: 'POST',
      body: JSON.stringify({ key, limit, windowMs }),
    });
    const result = (await resp.json()) as { allowed: boolean };
    return result.allowed;
  }

  // Fallback to KV (non-atomic, best-effort)
  const bucket = `${key}:${Math.floor(Date.now() / windowMs)}`;
  const raw = await env.RATE_LIMIT.get(bucket);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= limit) return false;
  await env.RATE_LIMIT.put(bucket, String(count + 1), {
    expirationTtl: Math.ceil(windowMs / 1000) + 60,
  });
  return true;
}

/** Per-userId MCP tool call limit: 30 req/min */
export async function checkUserRateLimit(userId: string, env: Env): Promise<boolean> {
  return checkLimit(env, `rl:${userId}`, 30, 60_000);
}

/** Per-IP OAuth endpoint limit: 100 req/min */
export async function checkIpRateLimit(ip: string, env: Env): Promise<boolean> {
  return checkLimit(env, `rl:ip:${ip}`, 100, 60_000);
}

/** Per-userId add_key limit: 10 req/hour */
export async function checkAddKeyRateLimit(userId: string, env: Env): Promise<boolean> {
  return checkLimit(env, `rl:add_key:${userId}`, 10, 3_600_000);
}
