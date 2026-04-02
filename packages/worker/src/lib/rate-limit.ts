import type { Env } from '../types.js';
import { getSupabase } from './supabase.js';
import { cacheGet, cacheSet } from './cache.js';

// ── IP-based rate limiter (KV-backed, cross-isolate) ──

const IP_LIMITS: Record<string, number> = {
  free: 30,
  starter: 60,
  pro: 300,
  max: 300,
  enterprise: 1000,
  banned: 0,
};

const PUBLIC_RPM = 30;
const KV_TTL = 60; // seconds — matches 1-minute window

export async function checkIpRateLimit(env: Env, ip: string, tier: string = 'free'): Promise<{ allowed: boolean; limit: number; remaining: number }> {
  const limit = IP_LIMITS[tier] ?? IP_LIMITS.free;
  const key = `rl:${tier}:${ip}`;

  const raw = await env.CACHE.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  const newCount = count + 1;

  // Write back with TTL (auto-expires after 60s)
  await env.CACHE.put(key, String(newCount), { expirationTtl: KV_TTL });

  return { allowed: newCount <= limit, limit, remaining: Math.max(0, limit - newCount) };
}

export async function checkPublicIpRateLimit(env: Env, ip: string): Promise<{ allowed: boolean; limit: number; remaining: number }> {
  const key = `rl:pub:${ip}`;

  const raw = await env.CACHE.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  const newCount = count + 1;

  await env.CACHE.put(key, String(newCount), { expirationTtl: KV_TTL });

  return { allowed: newCount <= PUBLIC_RPM, limit: PUBLIC_RPM, remaining: Math.max(0, PUBLIC_RPM - newCount) };
}

// Per-key burst limiter (in-memory, per-isolate)
const keyBuckets = new Map<string, { tokens: number; windowStart: number }>();
const KEY_RATE_LIMIT = 60;
const KEY_RATE_WINDOW = 60_000;

export function checkKeyRateLimit(keyId: string): boolean {
  const now = Date.now();
  const bucket = keyBuckets.get(keyId);
  if (!bucket || now - bucket.windowStart >= KEY_RATE_WINDOW) {
    keyBuckets.set(keyId, { tokens: KEY_RATE_LIMIT - 1, windowStart: now });
    return true;
  }
  if (bucket.tokens <= 0) return false;
  bucket.tokens--;
  return true;
}

// Tier configuration
const TIERS: Record<string, { maxCallsPerMonth: number; maxKeySlots: number }> = {
  free: { maxCallsPerMonth: 10000, maxKeySlots: 3 },
  starter: { maxCallsPerMonth: 50000, maxKeySlots: 10 },
  pro: { maxCallsPerMonth: 500000, maxKeySlots: 50 },
  max: { maxCallsPerMonth: 500000, maxKeySlots: 100 },
  enterprise: { maxCallsPerMonth: 999_999_999, maxKeySlots: 1000 },
  banned: { maxCallsPerMonth: 0, maxKeySlots: 0 },
};

const BUFFER_PERCENT = 1.05;
const CALL_ACTIONS = ['api_call', 'transparent_proxy', 'key_retrieval', 'key_retrieval_batch'];

export async function checkTierRateLimit(
  env: Env,
  keySlotId: string,
  tier: string = 'free',
): Promise<{ allowed: boolean; used: number; limit: number; remaining: number; nearLimit: boolean }> {
  const limits = TIERS[tier] || TIERS.free;
  const advertisedLimit = limits.maxCallsPerMonth;
  const hardLimit = Math.floor(advertisedLimit * BUFFER_PERCENT);

  // Check KV cache for current count
  const cacheKey = `ratelimit:${keySlotId}`;
  let used = await cacheGet<number>(env, cacheKey);

  if (used === null) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const supabase = getSupabase(env);
    const { count } = await supabase
      .from('access_logs')
      .select('*', { count: 'exact', head: true })
      .eq('key_slot_id', keySlotId)
      .in('action', CALL_ACTIONS)
      .gte('timestamp', monthStart);

    used = count || 0;
    await cacheSet(env, cacheKey, used, 60);
  }

  const remaining = Math.max(0, advertisedLimit - used);
  const nearLimit = used >= advertisedLimit * 0.9;
  const overBuffer = used >= hardLimit;

  return { allowed: !overBuffer, used, limit: advertisedLimit, remaining, nearLimit };
}
