#!/usr/bin/env tsx
/**
 * Unit tests for fast-crypt.ts and the encryption.ts wrapper.
 *
 * Goals:
 *   - Fast-format round-trips correctly for many inputs
 *   - Tampering is detected (GCM auth tag works)
 *   - Wrong master key fails with an error (not silent corruption)
 *   - Latency benchmark: fast path completes 100 iterations in <500ms
 *     total
 */
import { randomBytes } from 'node:crypto';
import { encryptFast, decryptFast, isFastCiphertext } from './fast-crypt.js';
import { encrypt, decrypt } from './encryption.js';

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) passed++;
  else { failed++; console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`); }
}

function eq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ── Test env with a real 32-byte random master key ──
const env = { VAULT_ENCRYPTION_KEY: randomBytes(32).toString('hex') };
const env2 = { VAULT_ENCRYPTION_KEY: randomBytes(32).toString('hex') };

console.log('── fast-crypt round-trip ──');
{
  const samples = [
    new TextEncoder().encode('a'),
    new TextEncoder().encode('sk-proj-' + 'x'.repeat(100)),
    new Uint8Array([0, 1, 2, 3, 4, 0xff, 0xfe, 0x80]),
    new TextEncoder().encode('🔑 unicode 🔒'),
    new TextEncoder().encode('x'.repeat(500)),
  ];
  for (const s of samples) {
    const enc = encryptFast(s, env);
    ok('version byte is 0x02', enc[0] === 0x02);
    const dec = decryptFast(enc, env);
    ok(`round-trip len=${s.length}`, eq(s, dec));
  }
}

console.log('── isFastCiphertext detection ──');
{
  const fast = encryptFast(new TextEncoder().encode('hello'), env);
  ok('fast ciphertext detected', isFastCiphertext(fast));
}

console.log('── tampering detection ──');
{
  const enc = encryptFast(new TextEncoder().encode('plaintext'), env);

  // Flip a bit in the ciphertext body — should fail GCM auth
  const tampered = new Uint8Array(enc);
  tampered[tampered.length - 1] ^= 0x01;
  let threw = false;
  try { decryptFast(tampered, env); } catch { threw = true; }
  ok('tampered body throws', threw);

  // Flip a bit in the tag — should fail
  const tampered2 = new Uint8Array(enc);
  tampered2[1 + 16 + 12] ^= 0x01; // first byte of tag
  threw = false;
  try { decryptFast(tampered2, env); } catch { threw = true; }
  ok('tampered tag throws', threw);

  // Flip a bit in the salt — key derives differently, decryption fails
  const tampered3 = new Uint8Array(enc);
  tampered3[1] ^= 0x01;
  threw = false;
  try { decryptFast(tampered3, env); } catch { threw = true; }
  ok('tampered salt throws', threw);

  // Version byte not 0x02 → rejected
  const tampered4 = new Uint8Array(enc);
  tampered4[0] = 0x03;
  threw = false;
  try { decryptFast(tampered4, env); } catch { threw = true; }
  ok('wrong version byte throws', threw);
}

console.log('── wrong master key fails ──');
{
  const enc = encryptFast(new TextEncoder().encode('secret'), env);
  let threw = false;
  try { decryptFast(enc, env2); } catch { threw = true; }
  ok('different master key throws', threw);
}

console.log('── truncated ciphertext ──');
{
  const enc = encryptFast(new TextEncoder().encode('secret'), env);
  let threw = false;
  try { decryptFast(enc.slice(0, 10), env); } catch { threw = true; }
  ok('truncated throws', threw);
}

console.log('── dispatch layer (encryption.ts) ──');
{
  const enc = encrypt(new TextEncoder().encode('via dispatch'), env);
  ok('encrypt produces fast format', enc[0] === 0x02);
  const dec = decrypt(enc, env);
  ok('dispatch round-trip', new TextDecoder().decode(dec) === 'via dispatch');
}

console.log('── latency benchmark (100 fast-path round-trips) ──');
{
  const plaintext = new TextEncoder().encode('sk-proj-' + 'x'.repeat(60));
  const start = Date.now();
  for (let i = 0; i < 100; i++) {
    const enc = encryptFast(plaintext, env);
    const dec = decryptFast(enc, env);
    if (!eq(plaintext, dec)) {
      failed++;
      console.log('  FAIL: round-trip mismatch in benchmark at iter', i);
      break;
    }
  }
  const elapsed = Date.now() - start;
  console.log(`    100 round-trips: ${elapsed}ms (avg ${(elapsed / 100).toFixed(2)}ms per op)`);
  ok('100 fast round-trips under 500ms total', elapsed < 500, `took ${elapsed}ms`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
