#!/usr/bin/env tsx
/**
 * Unit tests for legacy.ts — the legacy API client used by --check-legacy.
 *
 * The network call (listLegacyKeys) is tested via a mocked global fetch.
 * The parser (parseLegacyList) is tested directly with good / bad / edge inputs.
 */
import { parseLegacyList, listLegacyKeys, type LegacyListResponse } from './legacy.js';

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) passed++;
  else { failed++; console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`); }
}

// ── parseLegacyList: good shapes ──────────────────────────────────────────
console.log('── parseLegacyList: happy path ──');
{
  const good = {
    keys: [
      { id: 'abc', provider: 'openai', label: 'prod', envVar: 'OPENAI_API_KEY', createdAt: '2026-03-12T00:00:00Z' },
      { id: 'def', provider: 'stripe', label: null, envVar: 'STRIPE_SECRET_KEY', createdAt: '2026-04-02T00:00:00Z' },
    ],
  };
  const parsed = parseLegacyList(good);
  ok('parses 2 keys', parsed.keys.length === 2);
  ok('first is openai', parsed.keys[0].provider === 'openai');
  ok('preserves envVar', parsed.keys[0].envVar === 'OPENAI_API_KEY');
  ok('preserves createdAt', parsed.keys[0].createdAt === '2026-03-12T00:00:00Z');
  ok('null label stays null', parsed.keys[1].label === null);
}

// ── parseLegacyList: missing / malformed fields ──────────────────────────
console.log('── parseLegacyList: tolerance ──');
{
  const missingLabel = { keys: [{ id: 'a', provider: 'openai' }] };
  const p = parseLegacyList(missingLabel);
  ok('missing label → null', p.keys[0]?.label === null);
  ok('missing envVar → null', p.keys[0]?.envVar === null);
  ok('missing createdAt → empty string', p.keys[0]?.createdAt === '');
}

// ── parseLegacyList: garbage inputs ──────────────────────────────────────
console.log('── parseLegacyList: rejection ──');
{
  ok('null → empty', parseLegacyList(null).keys.length === 0);
  ok('undefined → empty', parseLegacyList(undefined).keys.length === 0);
  ok('string → empty', parseLegacyList('hello').keys.length === 0);
  ok('array → empty', parseLegacyList([1, 2, 3]).keys.length === 0);
  ok('missing keys field → empty', parseLegacyList({ other: 'x' }).keys.length === 0);
  ok('keys not array → empty', parseLegacyList({ keys: 'nope' }).keys.length === 0);
}

// ── parseLegacyList: mixed valid / invalid rows ──────────────────────────
console.log('── parseLegacyList: partial drops ──');
{
  const mixed = {
    keys: [
      { id: 'valid', provider: 'openai' },
      null,
      { provider: 'stripe' },           // missing id
      { id: 'also-valid', provider: 'groq', label: 'dev', envVar: null, createdAt: '2026-04-10T00:00:00Z' },
      'not an object',
      { id: 'no-provider' },             // missing provider
    ],
  };
  const p = parseLegacyList(mixed);
  ok('keeps only valid rows', p.keys.length === 2, `got ${p.keys.length}`);
  ok('keeps first valid', p.keys[0]?.id === 'valid');
  ok('keeps second valid', p.keys[1]?.id === 'also-valid');
}

// ── listLegacyKeys: mocked fetch ─────────────────────────────────────────
console.log('── listLegacyKeys: network mocking ──');
{
  const originalFetch = globalThis.fetch;
  let capturedHeaders: Record<string, string> = {};
  let capturedUrl = '';

  // Good response
  globalThis.fetch = (async (url: string, init: { headers: Record<string, string> }) => {
    capturedUrl = url;
    capturedHeaders = init.headers;
    return new Response(JSON.stringify({
      keys: [{ id: '1', provider: 'openai', label: 'prod', envVar: 'OPENAI_API_KEY', createdAt: '2026-03-12T00:00:00Z' }],
    }), { status: 200 });
  }) as any;

  const result = await listLegacyKeys('vp_live_fake-test-key');
  ok('calls correct URL path', capturedUrl.endsWith('/api/v1/sdk/keys'), `got ${capturedUrl}`);
  ok('sends X-API-Key header', capturedHeaders['X-API-Key'] === 'vp_live_fake-test-key');
  ok('returns parsed keys', result.keys.length === 1);

  // Non-ok response → empty (not throw)
  globalThis.fetch = (async () => new Response('forbidden', { status: 403 })) as any;
  const forbidden = await listLegacyKeys('vp_live_xyz');
  ok('non-ok response → empty', forbidden.keys.length === 0);

  // Network throws → empty
  globalThis.fetch = (async () => { throw new Error('boom'); }) as any;
  const boomed = await listLegacyKeys('vp_live_xyz');
  ok('fetch throws → empty', boomed.keys.length === 0);

  // Invalid JSON → empty
  globalThis.fetch = (async () => new Response('<html>not json</html>', { status: 200 })) as any;
  const badjson = await listLegacyKeys('vp_live_xyz');
  ok('invalid JSON → empty', badjson.keys.length === 0);

  globalThis.fetch = originalFetch;
}

// ── listLegacyKeys: invalid vp_live_ prefix ──────────────────────────────
console.log('── listLegacyKeys: prefix check ──');
{
  const noPrefix = await listLegacyKeys('not-a-valid-key');
  ok('missing vp_live_ prefix → empty (no network call)', noPrefix.keys.length === 0);

  const empty = await listLegacyKeys('');
  ok('empty string → empty', empty.keys.length === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
