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

  it('proxy throws without share2 for string key ID', async () => {
    const vault = new VaultProof('vp_live_test123');
    await assert.rejects(
      () => vault.proxy('some-key-id', '/v1/models'),
      /Share2 not found/
    );
  });
});
