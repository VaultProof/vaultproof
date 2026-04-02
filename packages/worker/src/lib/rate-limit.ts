import type { Env } from '../types.js';
import { getSupabase } from './supabase.js';
import { cacheGet, cacheSet } from './cache.js';

// ── IP-based rate limiter (in-memory, per-isolate) ──
const ipBuckets = new Map<string, { count: number; windowStart: number }>();

const IP_LIMITS: Record<string, { rpm: number }> = {
  free:       { rpm: 30 },
  starter:    { rpm: 60 },
  pro:        { rpm: 300 },
  max:        { rpm: 300 },
  enterprise: { rpm: 1000 },
  banned:     { rpm: 0 },
};
const IP_WINDOW = 60_000;

export function checkIpRateLimit(ip: string, tier: string = 'free'): { allowed: boolean; limit: number; remaining: number } {
  const limits = IP_LIMITS[tier] || IP_LIMITS.free;
  const now = Date.now();
  const bucket = ipBuckets.get(ip);

  if (!bucket || now - bucket.windowStart >= IP_WINDOW) {
    ipBuckets.set(ip, { count: 1, windowStart: now });
    return { allowed: true, limit: limits.rpm, remaining: limits.rpm - 1 };
  }

  bucket.count++;
  const remaining = Math.max(0, limits.rpm - bucket.count);
  return { allowed: bucket.count <= limits.rpm, limit: limits.rpm, remaining };
}

// Public endpoint rate limit (no auth, use IP only)
const PUBLIC_RPM = 30;

export function checkPublicIpRateLimit(ip: string): { allowed: boolean; limit: number; remaining: number } {
  const key = `pub:${ip}`;
  const now = Date.now();
  const bucket = ipBuckets.get(key);

  if (!bucket || now - bucket.windowStart >= IP_WINDOW) {
    ipBuckets.set(key, { count: 1, windowStart: now });
    return { allowed: true, limit: PUBLIC_RPM, remaining: PUBLIC_RPM - 1 };
  }

  bucket.count++;
  const remaining = Math.max(0, PUBLIC_RPM - bucket.count);
  return { allowed: bucket.count <= PUBLIC_RPM, limit: PUBLIC_RPM, remaining };
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
