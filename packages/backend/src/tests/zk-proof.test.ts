/**
 * VaultProof ZK Proof Verification Tests
 *
 * Tests that the proof verifier correctly rejects invalid proofs.
 * We cannot generate valid proofs without the full Poseidon2 circuit,
 * but we CAN verify that invalid inputs are properly rejected.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verifyProof } from '../crypto/proof-verifier.js';

// Set env vars for tests
process.env.VAULT_ENCRYPTION_KEY = 'aa95f81367855c92e7b92d42d0d5dd059b48eb25b64246e93c101bc6f28cd9bd';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.NODE_ENV = 'test';

const validPublicInputs = {
  vaultCommitment: 'abc123def456',
  appIdHash: '789abc012def',
  authorizedAppsRoot: 'root-hash-placeholder',
  treeDepth: 4,
  nullifier: 'nullifier-test-value',
};

describe('ZK Proof Verification Tests', () => {

  // --- Test 1: Empty proof string ---

  it('rejects an empty proof string', async () => {
    const result = await verifyProof('', validPublicInputs);

    assert.equal(result.valid, false);
  });

  // --- Test 2: Short proof (<10 chars) ---

  it('rejects a proof shorter than 10 characters', async () => {
    const result = await verifyProof('abcd1234', validPublicInputs);

    assert.equal(result.valid, false);
    assert.ok(result.reason, 'Should provide a reason for rejection');
  });

  // --- Test 3: Garbage proof hex ---

  it('rejects garbage proof hex data', async () => {
    // Long enough to pass the length check, but completely invalid as a proof
    const garbageHex = 'deadbeefcafebabe0123456789abcdef'.repeat(8);

    const result = await verifyProof(garbageHex, validPublicInputs);

    assert.equal(result.valid, false);
    // If Noir verifier is loaded, it will reject with 'Proof verification failed'
    // If Noir is not available, the placeholder accepts long proofs — either way,
    // this verifies the function doesn't crash on garbage input
    if (result.reason && result.reason !== 'placeholder-verification') {
      assert.equal(result.reason, 'Proof verification failed');
    }
  });

  // --- Test 4: Wrong public inputs with garbage proof ---

  it('rejects garbage proof with wrong public inputs', async () => {
    const garbageHex = 'ff'.repeat(128);
    const wrongInputs = {
      vaultCommitment: '',
      appIdHash: '',
      authorizedAppsRoot: '',
      treeDepth: 0,
      nullifier: '',
    };

    const result = await verifyProof(garbageHex, wrongInputs);

    assert.equal(result.valid, false);
    if (result.reason && result.reason !== 'placeholder-verification') {
      assert.equal(result.reason, 'Proof verification failed');
    }
  });

  // --- Test 5: Null/undefined proof ---

  it('rejects null or undefined proof values', async () => {
    // Test with null cast to string
    const resultNull = await verifyProof(null as unknown as string, validPublicInputs);
    assert.equal(resultNull.valid, false);

    // Test with undefined cast to string
    const resultUndefined = await verifyProof(undefined as unknown as string, validPublicInputs);
    assert.equal(resultUndefined.valid, false);
  });
});
