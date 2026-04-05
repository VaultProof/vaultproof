/**
 * Isolate-local in-memory cache with TTL.
 * Lives only for the lifetime of the Worker isolate (~30s to minutes).
 * Used as an L1 cache above KV to avoid round-trips for repeated traffic.
 */

interface MemEntry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, MemEntry<unknown>>();

let lastCleanup = 0;
const CLEANUP_INTERVAL_MS = 10_000;

function maybeCleanup(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (entry.expiresAt < now) store.delete(key);
  }
}

export function memGet<T>(key: string): T | null {
  maybeCleanup();
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value as T;
}

export function memSet<T>(key: string, value: T, ttlSeconds: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export function memDel(key: string): void {
  store.delete(key);
}
