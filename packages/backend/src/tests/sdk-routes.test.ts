/**
 * VaultProof SDK Routes Tests
 *
 * Tests the SDK endpoints that developers use with their vp_live_ keys:
 * store keys, list keys, revoke keys, and proxy calls.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { splitString, serializeShare } from '@vaultproof/shamir';
import { sdkRoutes } from '../routes/sdk.js';
import { developerKeyRoutes } from '../routes/developer-keys.js';
import { authRoutes } from '../routes/auth.js';
import { generateToken } from '../middleware/auth.js';

// Set env vars for tests
process.env.VAULT_ENCRYPTION_KEY = 'aa95f81367855c92e7b92d42d0d5dd059b48eb25b64246e93c101bc6f28cd9bd';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.NODE_ENV = 'test';

const prisma = new PrismaClient();

const TEST_USER_ID = 'test-sdk-user-001';
const TEST_USER_EMAIL = 'sdk-test@vaultproof.dev';

async function buildApp() {
  const app = Fastify();
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(developerKeyRoutes, { prefix: '/api/v1/dev-keys' });
  await app.register(sdkRoutes, { prefix: '/api/v1/sdk' });
  return app;
}

describe('SDK Routes Tests', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let vpLiveKey: string;
  let sdkHeaders: Record<string, string>;
  const authHeader = { authorization: `Bearer ${generateToken(TEST_USER_ID, TEST_USER_EMAIL)}` };
  const storedKeyIds: string[] = [];

  before(async () => {
    // Create test user
    await prisma.user.upsert({
      where: { email: TEST_USER_EMAIL },
      update: {},
      create: { id: TEST_USER_ID, email: TEST_USER_EMAIL, passwordHash: '$2a$12$test' },
    });

    app = await buildApp();

    // Create a developer key via the dev-keys route
    const createKeyRes = await app.inject({
      method: 'POST',
      url: '/api/v1/dev-keys/create',
      headers: authHeader,
      payload: { label: 'SDK Test Key', mode: 'live' },
    });

    assert.equal(createKeyRes.statusCode, 200);
    const keyData = createKeyRes.json();
    vpLiveKey = keyData.key;
    assert.ok(vpLiveKey.startsWith('vp_live_'), 'Developer key should start with vp_live_');

    sdkHeaders = { 'x-api-key': vpLiveKey };
  });

  after(async () => {
    // Clean up test data in reverse dependency order
    const keySlots = await prisma.keySlot.findMany({
      where: { userId: TEST_USER_ID },
      select: { id: true },
    });
    const keySlotIds = keySlots.map((k) => k.id);

    if (keySlotIds.length > 0) {
      await prisma.accessLog.deleteMany({ where: { keySlotId: { in: keySlotIds } } });
      await prisma.appGrant.deleteMany({ where: { keySlotId: { in: keySlotIds } } });
      await prisma.keySlot.deleteMany({ where: { userId: TEST_USER_ID } });
    }

    await prisma.developerKey.deleteMany({ where: { userId: TEST_USER_ID } });
    await prisma.user.deleteMany({ where: { id: TEST_USER_ID } });
    await prisma.$disconnect();
    await app.close();
  });

  // --- Test 1: Store key with valid Shamir shares ---

  it('stores a key with valid Shamir shares and returns keyId, provider, label', async () => {
    const testApiKey = 'sk-test-sdk-store-key-abc123';
    const shares = splitString(testApiKey, 2, 2);
    const share1 = serializeShare(shares[0]);
    const share2 = serializeShare(shares[1]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sdk/store',
      headers: sdkHeaders,
      payload: {
        share1,
        share2,
        provider: 'openai',
        label: 'My OpenAI Key',
      },
    });

    assert.equal(res.statusCode, 200);
    const data = res.json();
    assert.ok(data.keyId, 'Response should include keyId');
    assert.equal(data.provider, 'openai');
    assert.equal(data.label, 'My OpenAI Key');

    storedKeyIds.push(data.keyId);
  });

  // --- Test 2: Store key with invalid provider ---

  it('rejects store with empty provider', async () => {
    const testApiKey = 'sk-test-empty-provider';
    const shares = splitString(testApiKey, 2, 2);
    const share1 = serializeShare(shares[0]);
    const share2 = serializeShare(shares[1]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sdk/store',
      headers: sdkHeaders,
      payload: {
        share1,
        share2,
        provider: '',
        label: 'Empty Provider',
      },
    });

    assert.equal(res.statusCode, 400);
    const data = res.json();
    assert.ok(data.error, 'Should return an error message');
  });

  // --- Test 3: List keys ---

  it('lists keys and includes the stored key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/sdk/keys',
      headers: sdkHeaders,
    });

    assert.equal(res.statusCode, 200);
    const data = res.json();
    assert.ok(Array.isArray(data.keys), 'Response should have a keys array');
    assert.ok(data.keys.length >= 1, 'Should have at least one key');

    const found = data.keys.find((k: any) => k.id === storedKeyIds[0]);
    assert.ok(found, 'Stored key should appear in list');
    assert.equal(found.provider, 'openai');
  });

  // --- Test 4: Revoke key ---

  it('revokes a key and it disappears from the list', async () => {
    // Store a key to revoke
    const testApiKey = 'sk-test-sdk-revoke-key';
    const shares = splitString(testApiKey, 2, 2);

    const storeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sdk/store',
      headers: sdkHeaders,
      payload: {
        share1: serializeShare(shares[0]),
        share2: serializeShare(shares[1]),
        provider: 'anthropic',
        label: 'Revoke Me',
      },
    });

    assert.equal(storeRes.statusCode, 200);
    const { keyId } = storeRes.json();
    storedKeyIds.push(keyId);

    // Revoke it
    const revokeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sdk/revoke',
      headers: sdkHeaders,
      payload: { keyId },
    });

    assert.equal(revokeRes.statusCode, 200);
    assert.equal(revokeRes.json().status, 'revoked');

    // Verify it is gone from list
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/sdk/keys',
      headers: sdkHeaders,
    });

    const keys = listRes.json().keys;
    const found = keys.find((k: any) => k.id === keyId);
    assert.ok(!found, 'Revoked key should not appear in active key list');
  });

  // --- Test 5: Store and proxy call ---

  it('stores a key and proxies a call (expects upstream auth error, not 500)', async () => {
    const testApiKey = 'sk-test-sdk-proxy-key-fake';
    const shares = splitString(testApiKey, 2, 2);

    const storeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sdk/store',
      headers: sdkHeaders,
      payload: {
        share1: serializeShare(shares[0]),
        share2: serializeShare(shares[1]),
        provider: 'openai',
        label: 'Proxy Test Key',
      },
    });

    assert.equal(storeRes.statusCode, 200);
    const { keyId } = storeRes.json();
    storedKeyIds.push(keyId);

    // Proxy call — will get auth error from OpenAI (fake key), but should not 500
    const callRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sdk/call',
      headers: sdkHeaders,
      payload: {
        keyId,
        path: '/v1/models',
        method: 'GET',
      },
    });

    // We expect an upstream error (401 from OpenAI) forwarded back, not a server crash
    assert.ok(callRes.statusCode !== 500, `Should not get 500 internal error, got ${callRes.statusCode}`);
  });

  // --- Test 6: Proxy with revoked key ---

  it('returns 404 when proxying with a revoked key', async () => {
    // Store and revoke a key
    const testApiKey = 'sk-test-sdk-revoked-proxy';
    const shares = splitString(testApiKey, 2, 2);

    const storeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sdk/store',
      headers: sdkHeaders,
      payload: {
        share1: serializeShare(shares[0]),
        share2: serializeShare(shares[1]),
        provider: 'openai',
        label: 'Revoke Then Proxy',
      },
    });

    const { keyId } = storeRes.json();
    storedKeyIds.push(keyId);

    // Revoke
    await app.inject({
      method: 'POST',
      url: '/api/v1/sdk/revoke',
      headers: sdkHeaders,
      payload: { keyId },
    });

    // Try to proxy — should get 404
    const callRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sdk/call',
      headers: sdkHeaders,
      payload: {
        keyId,
        path: '/v1/models',
        method: 'GET',
      },
    });

    assert.equal(callRes.statusCode, 404);
    assert.ok(callRes.json().error, 'Should return an error for revoked key');
  });

  // --- Test 7: Store key with envVar and return it in list ---

  it('stores a key with envVar and returns it in list', async () => {
    const shares = splitString('sk-test-envvar-key-12345678', 2, 2);
    const storeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sdk/store',
      headers: sdkHeaders,
      payload: {
        provider: 'supabase',
        label: 'url',
        share1: serializeShare(shares[0]),
        share2: serializeShare(shares[1]),
        envVar: 'NEXT_PUBLIC_SUPABASE_URL',
      },
    });

    assert.equal(storeRes.statusCode, 200);
    const storeData = storeRes.json();
    assert.equal(storeData.envVar, 'NEXT_PUBLIC_SUPABASE_URL');

    // Verify it comes back in the keys list
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/sdk/keys',
      headers: sdkHeaders,
    });

    assert.equal(listRes.statusCode, 200);
    const found = listRes.json().keys.find((k: any) => k.id === storeData.keyId);
    assert.ok(found, 'Key should appear in list');
    assert.equal(found.envVar, 'NEXT_PUBLIC_SUPABASE_URL');
  });
});
