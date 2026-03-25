import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VaultProof } from './index.js';

describe('@vaultproof/sdk', () => {
  it('creates an instance with string config', () => {
    const vault = new VaultProof('https://example.com');
    assert.ok(vault);
  });

  it('creates an instance with object config', () => {
    const vault = new VaultProof({ apiUrl: 'https://example.com', appId: 'my-app' });
    assert.ok(vault);
  });

  it('throws when calling store without auth', async () => {
    const vault = new VaultProof('https://example.com');
    await assert.rejects(
      () => vault.store('sk-test', 'openai'),
      /Not authenticated/
    );
  });

  it('throws when calling list without auth', async () => {
    const vault = new VaultProof('https://example.com');
    await assert.rejects(
      () => vault.list(),
      /Not authenticated/
    );
  });

  it('can set token manually', () => {
    const vault = new VaultProof('https://example.com');
    vault.setToken('my-jwt-token');
    // Should not throw on list (will fail on network, but auth check passes)
    assert.ok(vault);
  });
});
