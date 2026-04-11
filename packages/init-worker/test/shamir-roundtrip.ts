#!/usr/bin/env tsx
/**
 * Cross-package property test.
 *
 * Verifies that @vaultproof/shamir's splitString produces shares that
 * init-worker's combineShares can reconstruct byte-for-byte. This is the
 * contract the entire system depends on — if it breaks, proxy calls
 * silently corrupt keys.
 *
 * Runs 1000 random strings + 6 edge cases. Exits non-zero on any failure.
 */
import { splitString, serializeShare } from '@vaultproof/shamir';
import { combineShares, deserializeShare } from '../src/crypto/shamir.js';

const ITERATIONS = 1000;

function randomString(len: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.+/=';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

let failed = 0;

// Random strings of varying lengths
for (let i = 0; i < ITERATIONS; i++) {
  const len = 8 + Math.floor(Math.random() * 200);
  const secret = randomString(len);
  const shares = splitString(secret, 2, 2);
  const s1 = deserializeShare(serializeShare(shares[0]));
  const s2 = deserializeShare(serializeShare(shares[1]));
  const bytes = combineShares([s1, s2]);
  const reconstructed = new TextDecoder().decode(bytes);
  if (reconstructed !== secret) {
    failed++;
    if (failed <= 3) {
      console.error(`  FAIL iter=${i} len=${len}`);
      console.error(`    expected: ${JSON.stringify(secret.slice(0, 80))}`);
      console.error(`    got:      ${JSON.stringify(reconstructed.slice(0, 80))}`);
    }
  }
}

// Edge cases that commonly trip naive implementations
const EDGES = [
  'a',                                            // 1 char
  'sk-proj-' + 'x'.repeat(100),                   // typical key length
  'x'.repeat(1000),                               // very long
  'key with spaces and = signs and | pipes',     // special chars
  '🔑emoji-key🔒',                                // unicode (multi-byte)
  '\x01\x02\x03\x7f\xff',                         // low / high bytes
];

for (const secret of EDGES) {
  try {
    const shares = splitString(secret, 2, 2);
    const s1 = deserializeShare(serializeShare(shares[0]));
    const s2 = deserializeShare(serializeShare(shares[1]));
    const bytes = combineShares([s1, s2]);
    if (new TextDecoder().decode(bytes) !== secret) {
      failed++;
      console.error(`  FAIL edge: ${JSON.stringify(secret.slice(0, 40))}`);
    }
  } catch (err) {
    failed++;
    console.error(`  FAIL edge threw: ${String(err).slice(0, 100)}`);
  }
}

const total = ITERATIONS + EDGES.length;
if (failed > 0) {
  console.error(`\n${failed} failed out of ${total}`);
  process.exit(1);
}
console.log(`${total} passed`);
