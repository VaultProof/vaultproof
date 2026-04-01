import type { Env } from '../types.js';

export async function cacheGet<T>(env: Env, key: string): Promise<T | null> {
  const val = await env.CACHE.get(key, 'text');
  if (!val) return null;
  try {
    return JSON.parse(val) as T;
  } catch {
    return null;
  }
}

export async function cacheSet(env: Env, key: string, value: unknown, ttlSeconds: number = 60): Promise<void> {
  // KV minimum TTL is 60 seconds
  const ttl = Math.max(60, ttlSeconds);
  await env.CACHE.put(key, JSON.stringify(value), { expirationTtl: ttl });
}

export async function cacheDel(env: Env, key: string): Promise<void> {
  await env.CACHE.delete(key);
}
