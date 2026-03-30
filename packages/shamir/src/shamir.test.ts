import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  split,
  combine,
  splitString,
  combineToString,
  serializeShare,
  deserializeShare,
} from './index.js';

describe('Shamir Secret Sharing', () => {
  it('splits and reconstructs a secret (2-of-2)', () => {
    const secret = new TextEncoder().encode('sk-test-openai-key-12345');
    const shares = split(secret, 2, 2);

    assert.equal(shares.length, 2);
    const reconstructed = combine(shares);
    assert.deepEqual(reconstructed, secret);
  });

  it('splits and reconstructs with string helpers', () => {
    const apiKey = 'sk-proj-abc123def456ghi789';
    const shares = splitString(apiKey, 2, 2);
    const result = combineToString(shares);
    assert.equal(result, apiKey);
  });

  it('works with 2-of-3 threshold (team mode)', () => {
    const secret = new TextEncoder().encode('team-api-key-xyz');
    const shares = split(secret, 3, 2);

    assert.equal(shares.length, 3);

    // Any 2 of 3 should work
    assert.deepEqual(combine([shares[0], shares[1]]), secret);
    assert.deepEqual(combine([shares[0], shares[2]]), secret);
    assert.deepEqual(combine([shares[1], shares[2]]), secret);

    // All 3 should also work
    assert.deepEqual(combine(shares), secret);
  });

  it('works with 2-of-5 threshold (larger team)', () => {
    const secret = new TextEncoder().encode('enterprise-key-abc');
    const shares = split(secret, 5, 2);

    assert.equal(shares.length, 5);

    // Any pair should reconstruct
    for (let i = 0; i < 5; i++) {
      for (let j = i + 1; j < 5; j++) {
        assert.deepEqual(combine([shares[i], shares[j]]), secret);
      }
    }
  });

  it('single share reveals nothing about the secret', () => {
    const secret = new TextEncoder().encode('sensitive-api-key');
    const shares = split(secret, 2, 2);

    // A single share should not equal the secret
    assert.notDeepEqual(shares[0].y, secret);
    assert.notDeepEqual(shares[1].y, secret);
  });

  it('serializes and deserializes shares', () => {
    const shares = splitString('my-secret-key', 2, 2);

    const serialized0 = serializeShare(shares[0]);
    const serialized1 = serializeShare(shares[1]);

    assert.equal(typeof serialized0, 'string');
    assert.equal(typeof serialized1, 'string');

    const deserialized0 = deserializeShare(serialized0);
    const deserialized1 = deserializeShare(serialized1);

    assert.equal(deserialized0.x, shares[0].x);
    assert.deepEqual(deserialized0.y, shares[0].y);

    const result = combineToString([deserialized0, deserialized1]);
    assert.equal(result, 'my-secret-key');
  });

  it('handles long API keys', () => {
    const longKey = 'sk-' + 'a'.repeat(200);
    const shares = splitString(longKey, 2, 2);
    const result = combineToString(shares);
    assert.equal(result, longKey);
  });

  it('handles binary data', () => {
    const binary = new Uint8Array(256);
    for (let i = 0; i < 256; i++) binary[i] = i;

    const shares = split(binary, 3, 2);
    assert.deepEqual(combine([shares[0], shares[2]]), binary);
  });

  it('rejects invalid parameters', () => {
    const secret = new TextEncoder().encode('test');

    assert.throws(() => split(secret, 1, 2), /Total shares/);
    assert.throws(() => split(secret, 2, 1), /Threshold/);
    assert.throws(() => split(new Uint8Array(0), 2, 2), /empty/);
    assert.throws(() => combine([{ x: 1, y: new Uint8Array([1]) }]), /at least 2/);
  });

  it('wrong shares produce wrong output', () => {
    const secret1 = new TextEncoder().encode('key-one');
    const secret2 = new TextEncoder().encode('key-two');

    const shares1 = split(secret1, 2, 2);
    const shares2 = split(secret2, 2, 2);

    // Mixing shares from different secrets should NOT produce either original
    const mixed = combine([shares1[0], shares2[1]]);
    assert.notDeepEqual(mixed, secret1);
    assert.notDeepEqual(mixed, secret2);
  });
});
