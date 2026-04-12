#!/usr/bin/env tsx
/**
 * Unit tests for project-cache.ts.
 *
 * Covers:
 *   - Basic hit / miss
 *   - TTL expiry (simulated via injected `now`)
 *   - Key scoping: different projects and different slugs don't collide
 *   - Size cap eviction (oldest-first)
 *   - cacheDelete and cacheClear
 *   - Security invariants: no plaintext leak (cached shares are
 *     ciphertext), cached entries carry the allowlist for fresh re-check
 *     by the caller (not a pre-approved decision)
 */
import {
  cacheGet,
  cacheSet,
  cacheDelete,
  cacheClear,
  cacheSize,
  CACHE_TTL_MS,
  type CachedKey,
} from './project-cache.js';

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) passed++;
  else { failed++; console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`); }
}

function makeValue(projectId: string, slug: string): CachedKey {
  return {
    projectId,
    projectVpId: `vp-proj-${projectId}`,
    share1Encrypted: `share1-for-${projectId}-${slug}`,
    share2Encrypted: `share2-for-${projectId}-${slug}`,
    upstreamBaseUrl: 'https://api.openai.com',
    authHeaderName: 'Authorization',
    authHeaderTemplate: 'Bearer {key}',
    extraHeaders: null,
    allowedOrigins: null,
    strictOrigin: false,
  };
}

// ── Isolate state between test groups ──
cacheClear();

// ── Basic hit/miss ────────────────────────────────────────────────────
console.log('── basic hit/miss ──');
{
  ok('empty cache has size 0', cacheSize() === 0);
  ok('miss on empty', cacheGet('vp-proj-xxx', 'openai') === null);

  cacheSet('vp-proj-xxx', 'openai', makeValue('xxx', 'openai'));
  ok('size after set = 1', cacheSize() === 1);

  const hit = cacheGet('vp-proj-xxx', 'openai');
  ok('hit returns value', hit !== null);
  ok('hit has correct projectId', hit?.projectId === 'xxx');
  ok('hit has encrypted share (ciphertext)', hit?.share1Encrypted.startsWith('share1-') === true);
}

cacheClear();

// ── Key scoping ───────────────────────────────────────────────────────
console.log('── key scoping ──');
{
  cacheSet('vp-proj-a', 'openai', makeValue('a', 'openai'));
  cacheSet('vp-proj-b', 'openai', makeValue('b', 'openai'));
  cacheSet('vp-proj-a', 'stripe', makeValue('a', 'stripe'));

  ok('project A openai hits A', cacheGet('vp-proj-a', 'openai')?.projectId === 'a');
  ok('project B openai hits B', cacheGet('vp-proj-b', 'openai')?.projectId === 'b');
  ok('project A stripe different row', cacheGet('vp-proj-a', 'stripe')?.projectId === 'a');
  ok('project A stripe uses its own share',
    cacheGet('vp-proj-a', 'stripe')?.share1Encrypted === 'share1-for-a-stripe');
  ok('three entries', cacheSize() === 3);

  ok('missing slug on real project → null', cacheGet('vp-proj-a', 'ghost') === null);
  ok('real slug on missing project → null', cacheGet('vp-proj-never', 'openai') === null);
}

cacheClear();

// ── TTL expiry ────────────────────────────────────────────────────────
console.log('── TTL expiry ──');
{
  const t0 = 1_000_000;
  cacheSet('vp-proj-ttl', 'openai', makeValue('ttl', 'openai'), t0);

  // Right at set time
  ok('hit at t0', cacheGet('vp-proj-ttl', 'openai', t0) !== null);

  // Still valid just before expiry
  ok('hit at t0 + TTL - 1', cacheGet('vp-proj-ttl', 'openai', t0 + CACHE_TTL_MS - 1) !== null);

  // Miss exactly at expiry
  ok('miss at t0 + TTL', cacheGet('vp-proj-ttl', 'openai', t0 + CACHE_TTL_MS) === null);

  // Expired entry should be evicted on the miss
  ok('expired entry removed', cacheSize() === 0);

  // Miss after a long time
  cacheSet('vp-proj-ttl2', 'openai', makeValue('ttl2', 'openai'), t0);
  ok('miss at t0 + 1 hour', cacheGet('vp-proj-ttl2', 'openai', t0 + 3_600_000) === null);
}

cacheClear();

// ── Overwrite (same key, new value) ───────────────────────────────────
console.log('── overwrite ──');
{
  cacheSet('vp-proj-over', 'openai', makeValue('v1', 'openai'));
  cacheSet('vp-proj-over', 'openai', makeValue('v2', 'openai'));
  ok('overwrite replaces value', cacheGet('vp-proj-over', 'openai')?.projectId === 'v2');
  ok('overwrite does not double-count size', cacheSize() === 1);
}

cacheClear();

// ── Size cap + eviction ──────────────────────────────────────────────
console.log('── size cap ──');
{
  // Fill to cap + 1
  for (let i = 0; i < 1001; i++) {
    cacheSet(`vp-proj-${i}`, 'openai', makeValue(String(i), 'openai'));
  }
  ok('size capped at 1000', cacheSize() === 1000);
  // First entry should have been evicted
  ok('oldest entry evicted', cacheGet('vp-proj-0', 'openai') === null);
  // Most recent entry should still be there
  ok('newest entry retained', cacheGet('vp-proj-1000', 'openai')?.projectId === '1000');
  // Entry near the start was also evicted, near the end retained
  ok('entry 500 retained (still within window)', cacheGet('vp-proj-500', 'openai')?.projectId === '500');
}

cacheClear();

// ── cacheDelete ───────────────────────────────────────────────────────
console.log('── cacheDelete ──');
{
  cacheSet('vp-proj-del', 'openai', makeValue('del', 'openai'));
  cacheSet('vp-proj-del', 'stripe', makeValue('del', 'stripe'));
  cacheDelete('vp-proj-del', 'openai');
  ok('deleted entry gone', cacheGet('vp-proj-del', 'openai') === null);
  ok('other slug still present', cacheGet('vp-proj-del', 'stripe')?.projectId === 'del');
  ok('size decreased to 1', cacheSize() === 1);

  // Delete a non-existent key is a no-op
  cacheDelete('vp-proj-nonexistent', 'openai');
  ok('delete non-existent is no-op', cacheSize() === 1);
}

cacheClear();

// ── Security invariants ──────────────────────────────────────────────
console.log('── security invariants ──');
{
  // 1. The cache stores the encrypted share, never plaintext.
  cacheSet('vp-proj-sec', 'openai', makeValue('sec', 'openai'));
  const entry = cacheGet('vp-proj-sec', 'openai');
  ok('cached share1 contains "share1-" prefix (still ciphertext)',
    entry?.share1Encrypted.startsWith('share1-') === true);
  // The test value isn't actually encrypted; the real crypto path
  // passes base64-encoded ciphertext here. What this assertion
  // *means* is: whatever the caller put in cache, the cache gives
  // back verbatim. No decryption happens inside the cache.

  // 2. Different tokens don't collide via coincidence or string quirks.
  cacheSet('vp-proj-a|openai', 'x', makeValue('collide', 'x'));
  ok('token with pipe char does not collide',
    cacheGet('vp-proj-a', 'openai')?.projectId !== 'collide');

  // 3. The cached allowlist value is the data, not a decision.
  // (There's no "allow" or "deny" field; callers must re-run the lock
  // check against the current request on every hit.)
  const secWithOrigin: CachedKey = {
    ...makeValue('orig', 'openai'),
    allowedOrigins: 'https://app.example.com',
    strictOrigin: true,
  };
  cacheSet('vp-proj-orig', 'openai', secWithOrigin);
  const hit = cacheGet('vp-proj-orig', 'openai');
  ok('cached allowedOrigins is the raw string',
    hit?.allowedOrigins === 'https://app.example.com');
  ok('cached strictOrigin is the raw bool', hit?.strictOrigin === true);
  // There's no "isAuthorized" or similar field — the caller must
  // run checkOriginLock() itself against the live request headers.
}

cacheClear();
ok('cacheClear empties cache', cacheSize() === 0);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
