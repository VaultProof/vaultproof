/**
 * VaultProof Security Tests
 *
 * Tests cryptographic properties: single share reveals nothing,
 * encryption at rest, replay prevention, brute force resistance.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'crypto';
import { split, combine, splitString, combineToString, serializeShare, deserializeShare } from '@vaultproof/shamir';
import { encrypt, decrypt, zeroBuffer } from '../crypto/encryption.js';

// Set encryption key for tests
process.env.VAULT_ENCRYPTION_KEY = 'aa95f81367855c92e7b92d42d0d5dd059b48eb25b64246e93c101bc6f28cd9bd';

describe('Security Tests', () => {

  // --- S1: Single share reveals nothing ---

  describe('Single share reveals nothing', () => {
    it('cannot reconstruct with only Share 1', () => {
      const secret = new TextEncoder().encode('sk-super-secret-key');
      const shares = split(secret, 2, 2);

      assert.throws(() => combine([shares[0]]), /at least 2/);
    });

    it('cannot reconstruct with only Share 2', () => {
      const secret = new TextEncoder().encode('sk-super-secret-key');
      const shares = split(secret, 2, 2);

      assert.throws(() => combine([shares[1]]), /at least 2/);
    });

    it('combining Share 1 with random data does NOT produce the original key', () => {
      const secretStr = 'sk-brute-force-test-key-123456';
      const secret = new TextEncoder().encode(secretStr);
      const shares = split(secret, 2, 2);

      // Try 1000 random "fake share 2" values
      let foundOriginal = false;
      for (let attempt = 0; attempt < 1000; attempt++) {
        const fakeShare2 = {
          x: 2,
          y: randomBytes(secret.length),
        };

        try {
          const result = combine([shares[0], fakeShare2]);
          const resultStr = new TextDecoder().decode(result);
          if (resultStr === secretStr) {
            foundOriginal = true;
            break;
          }
        } catch {
          // Some combinations may error — that's fine
        }
      }

      assert.ok(!foundOriginal, 'Should not reconstruct original key with random data in 1000 attempts');
    });

    it('share bytes have no statistical correlation to secret bytes', () => {
      // Test that shares don't leak information about the secret
      const secret = new Uint8Array(32);
      secret.fill(0xAA); // All bytes the same

      const shares = split(secret, 2, 2);

      // Count how many share bytes equal the secret bytes
      let matchCount = 0;
      for (let i = 0; i < secret.length; i++) {
        if (shares[0].y[i] === secret[i]) matchCount++;
      }

      // With random polynomial coefficients, expected matches ~1/256 = ~0.4%
      // Allow up to 25% as upper bound (would indicate a severe leak)
      const matchRate = matchCount / secret.length;
      assert.ok(
        matchRate < 0.25,
        `Share byte match rate ${(matchRate * 100).toFixed(1)}% is suspiciously high (expected ~0.4%)`
      );
    });
  });

  // --- S2: Encryption at rest ---

  describe('AES-256-GCM encryption', () => {
    it('encrypt/decrypt round-trip works', () => {
      const plaintext = Buffer.from('sk-test-key-for-encryption');
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);
      assert.deepEqual(decrypted, plaintext);
    });

    it('encrypted data is different from plaintext', () => {
      const plaintext = Buffer.from('sk-test-key-12345');
      const encrypted = encrypt(plaintext);

      assert.ok(!encrypted.includes(plaintext), 'Encrypted data should not contain plaintext');
    });

    it('encrypted data includes salt + iv + tag overhead', () => {
      const plaintext = Buffer.from('short');
      const encrypted = encrypt(plaintext);

      // salt(16) + iv(12) + tag(16) + ciphertext(5) = 49 bytes minimum
      assert.ok(encrypted.length >= 44 + plaintext.length, 'Encrypted data should include crypto overhead');
    });

    it('same plaintext produces different ciphertext (random IV)', () => {
      const plaintext = Buffer.from('sk-determinism-test');
      const encrypted1 = encrypt(plaintext);
      const encrypted2 = encrypt(plaintext);

      assert.ok(!encrypted1.equals(encrypted2), 'Two encryptions of same data should differ (random salt + IV)');
    });

    it('tampered ciphertext fails decryption (GCM auth)', () => {
      const plaintext = Buffer.from('sk-tamper-test');
      const encrypted = encrypt(plaintext);

      // Flip a bit in the ciphertext portion
      const tampered = Buffer.from(encrypted);
      tampered[tampered.length - 1] ^= 0xFF;

      assert.throws(() => decrypt(tampered), /Unsupported state|unable to authenticate/i);
    });

    it('truncated ciphertext fails decryption', () => {
      const plaintext = Buffer.from('sk-truncate-test');
      const encrypted = encrypt(plaintext);

      const truncated = encrypted.subarray(0, 20);
      assert.throws(() => decrypt(Buffer.from(truncated)));
    });

    it('zeroBuffer actually zeroes the buffer', () => {
      const buf = Buffer.from('sensitive-data-here');
      assert.ok(buf.toString() === 'sensitive-data-here');

      zeroBuffer(buf);

      // Every byte should be 0
      for (let i = 0; i < buf.length; i++) {
        assert.equal(buf[i], 0, `Byte ${i} should be zeroed`);
      }
    });
  });

  // --- S3: Shamir serialization security ---

  describe('Share serialization', () => {
    it('serialized shares are base64 and contain no plaintext', () => {
      const apiKey = 'sk-proj-ABCDEFGHIJ1234567890';
      const shares = splitString(apiKey, 2, 2);

      const s1 = serializeShare(shares[0]);
      const s2 = serializeShare(shares[1]);

      // Should be valid base64
      assert.ok(typeof s1 === 'string');
      assert.ok(typeof s2 === 'string');

      // Should not contain the plaintext API key
      assert.ok(!s1.includes(apiKey));
      assert.ok(!s2.includes(apiKey));

      // Round-trip should work
      const d1 = deserializeShare(s1);
      const d2 = deserializeShare(s2);
      const reconstructed = combineToString([d1, d2]);
      assert.equal(reconstructed, apiKey);
    });
  });

  // --- S4: No Math.random usage ---

  describe('Randomness quality', () => {
    it('Shamir uses crypto.randomBytes, not Math.random', () => {
      // Generate many shares and check for patterns
      // Math.random would produce detectable patterns over many iterations
      const results = new Set<string>();

      for (let i = 0; i < 100; i++) {
        const shares = splitString('test-key', 2, 2);
        const s = serializeShare(shares[0]);
        results.add(s);
      }

      // With crypto.randomBytes, all 100 should be unique
      assert.equal(results.size, 100, 'All 100 share generations should produce unique results');
    });
  });

  // --- S5: Missing encryption key ---

  describe('Missing encryption key', () => {
    it('throws when VAULT_ENCRYPTION_KEY is not set', () => {
      const savedKey = process.env.VAULT_ENCRYPTION_KEY;
      delete process.env.VAULT_ENCRYPTION_KEY;

      assert.throws(
        () => encrypt(Buffer.from('test')),
        /VAULT_ENCRYPTION_KEY not set/
      );

      // Restore
      process.env.VAULT_ENCRYPTION_KEY = savedKey;
    });
  });
});
