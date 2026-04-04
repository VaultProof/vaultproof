/**
 * Per-userId and per-IP rate limiting using Cloudflare KV counters.
 *
 * Limits enforced:
 *   - IP-based OAuth endpoint limit: 100 req/min per IP
 *   - General MCP tool calls:        30 req/min per userId
 *   - add_key specifically:          10 req/hour per userId
 *
 * All use a fixed window keyed on the current minute/hour bucket.
 *
 * KNOWN LIMITATION (same as auth code exchange race):
 * Cloudflare KV does not support atomic compare-and-swap (CAS). Concurrent
 * requests can all read the same counter value, all pass the limit check, and
 * all write back the same incremented value. Under burst load a determined
 * attacker can exceed the limits by issuing many parallel requests.
 * Full fix requires migration to Cloudflare Durable Objects for atomic counters.
 * Current mitigations: short window TTL (120 s), awaited writes to reduce the
 * race window within a single request's lifetime.
 */

import type { Env } from '../types.js';

/**
 * Check and increment the per-userId request rate limit (30 req/min).
 * Returns true if the request is within the limit, false if exceeded.
 */
export async function checkUserRateLimit(userId: string, env: Env): Promise<boolean> {
  const key = `rl:${userId}:${Math.floor(Date.now() / 60_000)}`;
  const raw = await env.RATE_LIMIT.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= 30) return false;
  await env.RATE_LIMIT.put(key, String(count + 1), { expirationTtl: 120 });
  return true;
}

/**
 * Check and increment the per-IP OAuth endpoint rate limit (100 req/min).
 *
 * Applied to /oauth/authorize and /oauth/token to prevent enumeration
 * and brute-force attacks before a userId is available.
 * Uses CF-Connecting-IP set by Cloudflare.
 * Returns true if within limit, false if exceeded.
 */
export async function checkIpRateLimit(ip: string, env: Env): Promise<boolean> {
  const key = `rl:ip:${ip}:${Math.floor(Date.now() / 60_000)}`;
  const raw = await env.RATE_LIMIT.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= 100) return false;
  await env.RATE_LIMIT.put(key, String(count + 1), { expirationTtl: 120 });
  return true;
}

/**
 * Check and increment the per-userId add_key rate limit (10 req/hour).
 * Returns true if the request is within the limit, false if exceeded.
 */
export async function checkAddKeyRateLimit(userId: string, env: Env): Promise<boolean> {
  const key = `rl:add_key:${userId}:${Math.floor(Date.now() / 3_600_000)}`;
  const raw = await env.RATE_LIMIT.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= 10) return false;
  await env.RATE_LIMIT.put(key, String(count + 1), { expirationTtl: 7200 });
  return true;
}
