/**
 * In-memory cache for project routing metadata used by authenticateAndFetchKey.
 *
 * One entry per (vp-proj-token, slug) pair. Hits let the proxy skip
 * the Supabase round trip for origin and routing checks, cutting p50
 * overhead for workloads that hammer the same project.
 *
 * Security constraints — read these before editing:
 *
 *   1. TTL is 30s. This is the maximum window between a user revoking
 *      a project (or rotating its allowlist) and the worker picking
 *      up the change. Shorter = less stale data, more Supabase load.
 *      30s is the budget the security model accepts.
 *
 *   2. Only SUCCESSFUL lookups are cached. A "project not found"
 *      result is never cached, so rotation and first-time registration
 *      both work immediately without a 30s delay.
 *
 *   3. Encrypted shares are NOT cached. Both share1_encrypted and
 *      share2_b64 are intentionally excluded from the cached
 *      type so that both ciphertexts never sit together in long-lived
 *      memory. Shares are always fetched fresh from Supabase on every
 *      proxy call — only routing and origin metadata is cached.
 *
 *   4. Origin-lock enforcement is fresh on every request. The cache
 *      stores the allowlist STRING but checkOriginLock() runs against
 *      the current request headers every time, so a cached entry
 *      doesn't let a cached origin through.
 *
 *   5. Per-isolate only. No cross-isolate sharing. Each isolate
 *      independently converges on correct state. Rate limits (which
 *      DO need cross-isolate consistency) go through the DO, not the
 *      cache.
 *
 *   6. Size cap: 1000 entries. Eviction is simple: if we hit the cap,
 *      drop the oldest entry. Good enough for this read-heavy workload.
 */

export interface CachedKey {
  projectId: string;
  projectVpId: string;
  keyId: string;
  provider: string;
  // share1Encrypted and share2Encrypted are intentionally absent — see constraint 3 above.
  upstreamBaseUrl: string;
  authHeaderName: string;
  authHeaderTemplate: string;
  extraHeaders: Record<string, string> | null;
  allowedOrigins: string | null;
  strictOrigin: boolean;
}

interface CacheEntry {
  value: CachedKey;
  expiresAt: number; // epoch ms
}

const MAX_ENTRIES = 1000;
export const CACHE_TTL_MS = 30_000;

const store = new Map<string, CacheEntry>();

function makeKey(vpProjToken: string, slug: string): string {
  return `${vpProjToken}|${slug}`;
}

/**
 * Look up a cached entry. Returns null if missing or expired.
 * Expired entries are lazily evicted.
 */
export function cacheGet(vpProjToken: string, slug: string, now: number = Date.now()): CachedKey | null {
  const key = makeKey(vpProjToken, slug);
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

/**
 * Store a successful lookup in the cache. Enforces the size cap by
 * evicting the oldest entry (insertion order) if full.
 */
export function cacheSet(
  vpProjToken: string,
  slug: string,
  value: CachedKey,
  now: number = Date.now(),
): void {
  const key = makeKey(vpProjToken, slug);

  if (!store.has(key) && store.size >= MAX_ENTRIES) {
    // Evict oldest. Map iteration order is insertion order.
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }

  store.set(key, { value, expiresAt: now + CACHE_TTL_MS });
}

/**
 * Remove a specific entry. Used by tests and could be used by a
 * future "invalidate now" admin endpoint.
 */
export function cacheDelete(vpProjToken: string, slug: string): void {
  store.delete(makeKey(vpProjToken, slug));
}

/** Clear the entire cache. Tests only. */
export function cacheClear(): void {
  store.clear();
}

/** Current size. For tests and observability. */
export function cacheSize(): number {
  return store.size;
}
