#!/usr/bin/env tsx
/**
 * Unit tests for project-auth.ts — specifically the pure helpers that
 * I extracted when refactoring authenticateProject() into
 * authenticateAndFetchKey() (single-query path).
 *
 * The Supabase network path (authenticateAndFetchKey) is tested
 * end-to-end by the staging integration suite; here we cover the
 * pure logic that handles token parsing and origin-lock enforcement.
 */
import { parseProjectToken, checkOriginLock } from './project-auth.js';

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) passed++;
  else { failed++; console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`); }
}

function req(headers: Record<string, string>): Request {
  return new Request('https://example.com/p/openai/v1/models', { headers });
}

// ── parseProjectToken ──────────────────────────────────────────────────
console.log('── parseProjectToken ──');
{
  const r1 = parseProjectToken(req({ Authorization: 'Bearer vp-proj-abc123' }));
  ok('valid token parses', 'token' in r1 && r1.token === 'vp-proj-abc123');

  const r2 = parseProjectToken(req({ Authorization: 'bearer vp-proj-xyz' }));
  ok('case-insensitive Bearer', 'token' in r2 && r2.token === 'vp-proj-xyz');

  const r3 = parseProjectToken(req({}));
  ok('no auth header → 401', 'error' in r3 && r3.status === 401);

  const r4 = parseProjectToken(req({ Authorization: 'Basic dXNlcjpwYXNz' }));
  ok('Basic → 401', 'error' in r4 && r4.status === 401);

  const r5 = parseProjectToken(req({ Authorization: 'Bearer vp_live_abc' }));
  ok('vp_live_ (wrong prefix) → 401', 'error' in r5 && r5.status === 401);

  const r6 = parseProjectToken(req({ Authorization: 'Bearer ' }));
  ok('empty bearer → 401', 'error' in r6 && r6.status === 401);

  const r7 = parseProjectToken(req({ Authorization: 'Bearer notajwt.at.all' }));
  ok('garbage token → 401', 'error' in r7 && r7.status === 401);

  const r8 = parseProjectToken(req({ Authorization: 'Bearer  vp-proj-doublespace' }));
  ok('double-space allowed (Bearer \\s+)', 'token' in r8 && r8.token === 'vp-proj-doublespace');
}

// ── checkOriginLock ───────────────────────────────────────────────────
console.log('── checkOriginLock ──');
{
  const r1 = checkOriginLock(req({ Origin: 'https://anything.com' }), null, false);
  ok('null allowlist → pass', r1 === null);

  const r2 = checkOriginLock(req({ Origin: 'https://anything.com' }), '', false);
  ok('empty string allowlist → pass', r2 === null);

  const r3 = checkOriginLock(
    req({ Origin: 'https://app.example.com' }),
    'https://app.example.com,https://other.com',
    true,
  );
  ok('exact match → pass', r3 === null);

  const r4 = checkOriginLock(
    req({ Origin: 'https://app.example.com/some/path' }),
    'https://app.example.com',
    true,
  );
  ok('prefix match → pass', r4 === null);

  const r5 = checkOriginLock(
    req({ Origin: 'https://evil.com' }),
    'https://app.example.com',
    true,
  );
  ok('mismatch + strict → 403', r5?.status === 403);
  ok('error message mentions allowlist', r5?.error.includes('allowlist') ?? false);

  const r6 = checkOriginLock(
    req({ Origin: 'https://evil.com' }),
    'https://app.example.com',
    false,
  );
  ok('mismatch + non-strict → pass', r6 === null);

  const r7 = checkOriginLock(
    req({ Referer: 'https://app.example.com/page' }),
    'https://app.example.com',
    true,
  );
  ok('Referer fallback works', r7 === null);

  const r8 = checkOriginLock(req({}), 'https://app.example.com', true);
  ok('no origin/referer + strict → 403', r8?.status === 403);

  const r9 = checkOriginLock(
    req({ Origin: 'https://b.com' }),
    ' https://a.com , https://b.com , https://c.com ',
    true,
  );
  ok('whitespace in allowlist tolerated', r9 === null);

  const r10 = checkOriginLock(
    req({ Origin: 'https://evil.com' }),
    'https://real.com,,,',
    true,
  );
  ok('empty entries do not match any origin', r10?.status === 403);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
