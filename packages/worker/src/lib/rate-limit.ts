import type { Env } from '../types.js';
import { getSupabase } from './supabase.js';

// ── IP-based rate limiter (in-memory burst + KV cross-isolate) ──

const IP_LIMITS: Record<string, number> = {
  free: 30,
  starter: 60,
  pro: 300,
  max: 300,
  enterprise: 1000,
  banned: 0,
};

const PUBLIC_RPM = 30;
const KV_TTL = 60;
const WINDOW_MS = 60_000;

// In-memory burst limiter — catches rapid requests within a single isolate
const memBuckets = new Map<string, { count: number; windowStart: number }>();

function checkMemLimit(key: string, limit: number): boolean {
  const now = Date.now();
  const bucket = memBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
    memBuckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  bucket.count++;
  return bucket.count <= limit;
}

export async function checkIpRateLimit(env: Env, ip: string, tier: string = 'free'): Promise<{ allowed: boolean; limit: number; remaining: number }> {
  const limit = IP_LIMITS[tier] ?? IP_LIMITS.free;
  const memKey = `mem:${tier}:${ip}`;

  // Layer 1: in-memory burst check (instant, no I/O)
  if (!checkMemLimit(memKey, limit)) {
    return { allowed: false, limit, remaining: 0 };
  }

  // Layer 2: KV cross-isolate check
  const key = `rl:${tier}:${ip}`;
  const raw = await env.CACHE.get(key);
  const count = raw ? parseInt(raw, 10) : 0;
  const newCount = count + 1;

  await env.CACHE.put(key, String(newCount), { expirationTtl: KV_TTL });

  return { allowed: newCount <= limit, limit, remaining: Math.max(0, limit - newCount) };
}

export async function checkPublicIpRateLimit(env: Env, ip: string): Promise<{ allowed: boolean; limit: number; remaining: number }> {
  const memKey = `mem:pub:${ip}`;

  // Layer 1: in-memory burst check
  if (!checkMemLimit(memKey, PUBLIC_RPM)) {
    return { allowed: false, limit: PUBLIC_RPM, remaining: 0 };
  }

  // Layer 2: KV cross-isolate check
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

  // Layer 1: KV real-time counter (incremented on every call)
  const kvKey = `monthly:${keySlotId}`;
  const kvRaw = await env.CACHE.get(kvKey);
  let kvCount = kvRaw ? parseInt(kvRaw, 10) : -1;

  // Layer 2: If no KV counter, seed from Supabase (source of truth)
  if (kvCount < 0) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const supabase = getSupabase(env);
    const { count } = await supabase
      .from('access_logs')
      .select('*', { count: 'exact', head: true })
      .eq('key_slot_id', keySlotId)
      .in('action', CALL_ACTIONS)
      .gte('timestamp', monthStart);

    kvCount = count || 0;
  }

  // Increment the counter
  const newCount = kvCount + 1;

  // TTL = seconds until end of month (max 31 days)
  const now = new Date();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const ttl = Math.max(60, Math.floor((monthEnd.getTime() - now.getTime()) / 1000));

  // Write incremented count back to KV
  await env.CACHE.put(kvKey, String(newCount), { expirationTtl: ttl });

  const remaining = Math.max(0, advertisedLimit - newCount);
  const nearLimit = newCount >= advertisedLimit * 0.9;
  const overBuffer = newCount >= hardLimit;

  return { allowed: !overBuffer, used: newCount, limit: advertisedLimit, remaining, nearLimit };
}

/**
 * Reconcile KV counter with Supabase (call periodically or after anomaly).
 * Resets KV to match the actual DB count.
 */
export async function reconcileUsageCount(
  env: Env,
  keySlotId: string,
): Promise<number> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const ttl = Math.max(60, Math.floor((monthEnd.getTime() - now.getTime()) / 1000));

  const supabase = getSupabase(env);
  const { count } = await supabase
    .from('access_logs')
    .select('*', { count: 'exact', head: true })
    .eq('key_slot_id', keySlotId)
    .in('action', CALL_ACTIONS)
    .gte('timestamp', monthStart);

  const actual = count || 0;
  await env.CACHE.put(`monthly:${keySlotId}`, String(actual), { expirationTtl: ttl });

  return actual;
}
