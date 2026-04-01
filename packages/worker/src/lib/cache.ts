import type { Env } from '../types.js';

interface CacheEnvelope<T> {
  value: T;
  /** Unix-ms when this entry should be considered stale */
  softExpiry: number;
}

export async function cacheGet<T>(env: Env, key: string): Promise<T | null> {
  const val = await env.CACHE.get(key, 'text');
  if (!val) return null;
  try {
    const envelope = JSON.parse(val) as CacheEnvelope<T>;
    // Honour soft TTL — treat as miss if past expiry
    if (envelope.softExpiry && Date.now() > envelope.softExpiry) return null;
    return envelope.value;
  } catch {
    return null;
  }
}

export async function cacheSet(env: Env, key: string, value: unknown, ttlSeconds: number = 60): Promise<void> {
  // KV minimum expirationTtl is 60 s. We always pass 60 s to KV but embed a
  // soft expiry inside the payload so callers can request shorter logical TTLs
  // (e.g. 10 s for revoked-key propagation).
  const hardTtl = Math.max(60, ttlSeconds);
  const envelope: CacheEnvelope<unknown> = {
    value,
    softExpiry: Date.now() + ttlSeconds * 1000,
  };
  await env.CACHE.put(key, JSON.stringify(envelope), { expirationTtl: hardTtl });
}

export async function cacheDel(env: Env, key: string): Promise<void> {
  await env.CACHE.delete(key);
}
