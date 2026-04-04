/**
 * Tests for src/lib/crypto.ts
 *
 * Runs under standard Vitest with Node's globalThis.crypto (available since
 * Node 19 / Vitest's jsdom/node environment).  No Workers pool needed.
 */
import { describe, it, expect } from 'vitest';
import {
  generateToken,
  sha256Hex,
  hmacSign,
  generatePkceChallenge,
  timingSafeEqual,
  encryptAesGcm,
  decryptAesGcm,
} from '../lib/crypto.js';

// ---------------------------------------------------------------------------
// generateToken
// ---------------------------------------------------------------------------
describe('generateToken', () => {
  it('returns a 64-character hex string', () => {
    const token = generateToken();
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates unique tokens', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// sha256Hex
// ---------------------------------------------------------------------------
describe('sha256Hex', () => {
  it('produces the correct SHA-256 for the empty string', async () => {
    // Known SHA-256 of ""
    const result = await sha256Hex('');
    expect(result).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('produces the correct SHA-256 for "hello"', async () => {
    const result = await sha256Hex('hello');
    expect(result).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('returns a 64-character lowercase hex string', async () => {
    const result = await sha256Hex('test input');
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// hmacSign
// ---------------------------------------------------------------------------
describe('hmacSign', () => {
  it('returns a 64-character hex string', async () => {
    const sig = await hmacSign('GET:/api/v1/keys:1700000000000', 'super-secret');
    expect(sig).toHaveLength(64);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces the same signature for the same inputs', async () => {
    const payload = 'POST:/api/v1/sdk/keys:1700000000000';
    const secret = 'shared-secret';
    const sig1 = await hmacSign(payload, secret);
    const sig2 = await hmacSign(payload, secret);
    expect(sig1).toBe(sig2);
  });

  it('produces different signatures for different payloads', async () => {
    const secret = 'shared-secret';
    const sig1 = await hmacSign('GET:/a:1', secret);
    const sig2 = await hmacSign('GET:/b:1', secret);
    expect(sig1).not.toBe(sig2);
  });

  it('produces different signatures for different secrets', async () => {
    const payload = 'GET:/api:1';
    const sig1 = await hmacSign(payload, 'secret-a');
    const sig2 = await hmacSign(payload, 'secret-b');
    expect(sig1).not.toBe(sig2);
  });

  it('throws when the secret is empty', async () => {
    await expect(hmacSign('payload', '')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// generatePkceChallenge
// ---------------------------------------------------------------------------
describe('generatePkceChallenge', () => {
  it('produces the RFC 7636 S256 challenge for a known verifier', async () => {
    // RFC 7636 Appendix B example:
    // verifier  = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    // challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    const challenge = await generatePkceChallenge(
      'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    );
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('returns a BASE64URL string with no padding', async () => {
    const challenge = await generatePkceChallenge('some-random-verifier-string');
    expect(challenge).not.toMatch(/[+/=]/);
    expect(challenge).toMatch(/^[A-Za-z0-9\-_]+$/);
  });
});

// ---------------------------------------------------------------------------
// timingSafeEqual
// ---------------------------------------------------------------------------
describe('timingSafeEqual', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeEqual('hello', 'hello')).toBe(true);
    expect(timingSafeEqual('', '')).toBe(true);
    expect(timingSafeEqual('abc123', 'abc123')).toBe(true);
  });

  it('returns false for different strings', () => {
    expect(timingSafeEqual('hello', 'world')).toBe(false);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('', 'x')).toBe(false);
  });

  it('returns false for strings of different lengths', () => {
    expect(timingSafeEqual('short', 'longer')).toBe(false);
    expect(timingSafeEqual('longer', 'short')).toBe(false);
  });

  it('handles multi-byte (Unicode) content', () => {
    expect(timingSafeEqual('héllo', 'héllo')).toBe(true);
    expect(timingSafeEqual('héllo', 'hello')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// encryptAesGcm / decryptAesGcm
// ---------------------------------------------------------------------------
describe('AES-GCM round-trip', () => {
  // 32-byte key expressed as 64 hex chars
  const key = 'a'.repeat(64); // 0xaaaa...aa (32 bytes)

  it('decrypts to the original plaintext', async () => {
    const plaintext = 'Hello, VaultProof!';
    const ct = await encryptAesGcm(plaintext, key);
    const pt = await decryptAesGcm(ct, key);
    expect(pt).toBe(plaintext);
  });

  it('encrypts to a different ciphertext each time (random IV)', async () => {
    const plaintext = 'same message';
    const ct1 = await encryptAesGcm(plaintext, key);
    const ct2 = await encryptAesGcm(plaintext, key);
    expect(ct1).not.toBe(ct2);
  });

  it('returns a valid base64 string', async () => {
    const ct = await encryptAesGcm('test', key);
    expect(() => atob(ct)).not.toThrow();
  });

  it('throws on wrong key during decryption', async () => {
    const ct = await encryptAesGcm('secret', key);
    const wrongKey = 'b'.repeat(64);
    await expect(decryptAesGcm(ct, wrongKey)).rejects.toThrow();
  });

  it('throws when key is not 32 bytes', async () => {
    await expect(encryptAesGcm('text', 'short')).rejects.toThrow();
    await expect(decryptAesGcm('dGVzdA==', 'short')).rejects.toThrow();
  });

  it('handles empty plaintext', async () => {
    const ct = await encryptAesGcm('', key);
    const pt = await decryptAesGcm(ct, key);
    expect(pt).toBe('');
  });

  it('handles unicode plaintext', async () => {
    const plaintext = '🔑 secret key 🔐';
    const ct = await encryptAesGcm(plaintext, key);
    const pt = await decryptAesGcm(ct, key);
    expect(pt).toBe(plaintext);
  });
});
