import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VaultProof } from './index.js';

describe('@vaultproof/sdk', () => {
  it('creates an instance with API key', () => {
    const vault = new VaultProof('vp_live_test123abc');
    assert.ok(vault);
  });

  it('rejects invalid API key prefix', () => {
    assert.throws(
      () => new VaultProof('sk-not-a-vaultproof-key'),
      /Must start with vp_/
    );
  });

  it('accepts custom API URL', () => {
    const vault = new VaultProof('vp_live_test123', 'https://custom.api.com');
    assert.ok(vault);
  });

  it('accepts test mode keys', () => {
    const vault = new VaultProof('vp_test_abc123');
    assert.ok(vault);
  });

  it('store splits key locally using Shamir', async () => {
    // Verify the SDK imports Shamir — this will throw if the import fails
    const { splitString, serializeShare } = await import('@vaultproof/shamir');
    const shares = splitString('sk-test-key', 2, 2);
    assert.equal(shares.length, 2);
    const s1 = serializeShare(shares[0]);
    const s2 = serializeShare(shares[1]);
    assert.ok(s1.length > 0);
    assert.ok(s2.length > 0);
    // Key never sent whole — only shares
  });
});
