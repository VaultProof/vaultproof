#!/usr/bin/env tsx
/**
 * Unit tests for rate-limit.ts.
 *
 * The real Durable Object runs only in the Workers runtime, so we stub it
 * with an in-memory mock. These tests verify the caller-side logic:
 *   - In-memory burst bucket catches obvious floods
 *   - DO response is correctly interpreted
 *   - DO errors fail open (don't block legitimate traffic)
 *   - The four public functions pass the right (limit, window) to the DO
 */
import {
  checkProxyRateLimit,
  checkProjectCreateRateLimit,
  checkKeyUploadRateLimit,
  checkFailedAuthRateLimit,
  rateLimitResponse,
} from './rate-limit.js';

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) passed++;
  else { failed++; console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`); }
}

// ── Mock DO stub ──────────────────────────────────────────────────────────
interface CallRecord {
  key: string;
  limit: number;
  windowSeconds: number;
}

function makeMockEnv(responder: (req: { limit: number; windowSeconds: number }) => {
  ok: boolean;
  count?: number;
  retryAfter?: number;
  status?: number;
  throw?: boolean;
}, calls: CallRecord[]) {
  return {
    RATE_LIMITER: {
      idFromName(key: string) {
        return { key };
      },
      get(id: { key: string }) {
        return {
          async fetch(_url: string, init: { body: string }) {
            const body = JSON.parse(init.body) as { limit: number; windowSeconds: number };
            calls.push({ key: id.key, ...body });
            const r = responder(body);
            if (r.throw) throw new Error('network failure');
            if (r.status && r.status >= 400) {
              return new Response(JSON.stringify({ error: 'internal' }), { status: r.status });
            }
            return new Response(JSON.stringify({ ok: r.ok, count: r.count ?? 0, retryAfter: r.retryAfter }), { status: 200 });
          },
        };
      },
    },
  } as any;
}

async function runTests() {
  // ── Helper: unique IDs so in-memory state doesn't leak between tests ──
  let uniq = 0;
  const freshId = () => `proj-${++uniq}-${Math.random()}`;

  console.log('── proxy rate limit ──');
  {
    const calls: CallRecord[] = [];
    const env = makeMockEnv(() => ({ ok: true }), calls);
    const pid = freshId();
    const r = await checkProxyRateLimit(env, pid);
    ok('ok first call', r.ok);
    ok('DO called with correct limit', calls[0]?.limit === 60);
    ok('DO called with correct window', calls[0]?.windowSeconds === 60);
    ok('DO key format proxy:<id>', calls[0]?.key === `proxy:${pid}`);
  }

  console.log('── DO rejection bubbles up ──');
  {
    const calls: CallRecord[] = [];
    const env = makeMockEnv(() => ({ ok: false, retryAfter: 42 }), calls);
    const r = await checkProxyRateLimit(env, freshId());
    ok('not ok', r.ok === false);
    ok('retryAfter preserved', r.retryAfter === 42);
  }

  console.log('── DO error fails open (not closed) ──');
  {
    const calls: CallRecord[] = [];
    const env = makeMockEnv(() => ({ ok: true, status: 500 }), calls);
    const r = await checkProxyRateLimit(env, freshId());
    ok('500 from DO → allowed (fail-open)', r.ok === true);
  }

  console.log('── DO throw fails open ──');
  {
    const calls: CallRecord[] = [];
    const env = makeMockEnv(() => ({ ok: true, throw: true }), calls);
    const r = await checkProxyRateLimit(env, freshId());
    ok('thrown → allowed (fail-open)', r.ok === true);
  }

  console.log('── in-memory burst blocks before DO ──');
  {
    const calls: CallRecord[] = [];
    const env = makeMockEnv(() => ({ ok: true }), calls);
    const pid = freshId();
    // 10/sec limit; 15 rapid calls should produce at least 5 burst-blocks.
    let blocked = 0;
    for (let i = 0; i < 15; i++) {
      const r = await checkProxyRateLimit(env, pid);
      if (!r.ok && r.retryAfter === 1) blocked++;
    }
    ok('at least some burst-blocked before DO', blocked >= 5, `blocked=${blocked}`);
    ok('DO not called for blocked ones', calls.length <= 10, `do_calls=${calls.length}`);
  }

  console.log('── project-create uses 10/60s window ──');
  {
    const calls: CallRecord[] = [];
    const env = makeMockEnv(() => ({ ok: true }), calls);
    await checkProjectCreateRateLimit(env, freshId());
    ok('limit=10', calls[0]?.limit === 10);
    ok('window=60s', calls[0]?.windowSeconds === 60);
    ok('key prefix projcreate:', calls[0]?.key.startsWith('projcreate:'));
  }

  console.log('── key-upload uses 60/60s window ──');
  {
    const calls: CallRecord[] = [];
    const env = makeMockEnv(() => ({ ok: true }), calls);
    await checkKeyUploadRateLimit(env, freshId());
    ok('limit=60', calls[0]?.limit === 60);
    ok('key prefix keyupload:', calls[0]?.key.startsWith('keyupload:'));
  }

  console.log('── failed-auth uses 100/60s window ──');
  {
    const calls: CallRecord[] = [];
    const env = makeMockEnv(() => ({ ok: true }), calls);
    await checkFailedAuthRateLimit(env, '1.2.3.' + uniq);
    ok('limit=100', calls[0]?.limit === 100);
    ok('key prefix failauth:', calls[0]?.key.startsWith('failauth:'));
  }

  console.log('── failed-auth with empty IP skips rate limit ──');
  {
    const calls: CallRecord[] = [];
    const env = makeMockEnv(() => ({ ok: false }), calls);
    const r = await checkFailedAuthRateLimit(env, '');
    ok('empty IP → allowed, no DO call', r.ok === true && calls.length === 0);
  }

  console.log('── rateLimitResponse format ──');
  {
    const res = rateLimitResponse(42);
    ok('status 429', res.status === 429);
    ok('retry-after header', res.headers.get('Retry-After') === '42');
    ok('content-type json', res.headers.get('Content-Type') === 'application/json');
    const body = await res.json();
    ok('body has error field', typeof (body as any).error === 'string');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => { console.error(err); process.exit(1); });
