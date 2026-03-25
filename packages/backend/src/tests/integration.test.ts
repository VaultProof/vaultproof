/**
 * VaultProof Integration Tests
 *
 * Tests the full flow: store key → proxy call → revoke → app auth
 * Uses SQLite dev database and real Shamir splitting.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { splitString, serializeShare } from '@vaultproof/shamir';
import { keyRoutes } from '../routes/keys.js';
import { proxyRoutes } from '../routes/proxy.js';
import { generateToken } from '../middleware/auth.js';

// Set env vars for tests
process.env.VAULT_ENCRYPTION_KEY = 'aa95f81367855c92e7b92d42d0d5dd059b48eb25b64246e93c101bc6f28cd9bd';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.NODE_ENV = 'test';

const prisma = new PrismaClient();

async function buildApp() {
  const app = Fastify();
  await app.register(keyRoutes, { prefix: '/api/v1/keys' });
  await app.register(proxyRoutes, { prefix: '/api/v1/proxy' });
  return app;
}

// Test user
const TEST_USER_ID = 'test-user-001';
const TEST_USER_EMAIL = 'test@vaultproof.dev';
const AUTH_HEADER = { authorization: `Bearer ${generateToken(TEST_USER_ID, TEST_USER_EMAIL)}` };

describe('VaultProof Integration Tests', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  before(async () => {
    // Ensure test user exists
    await prisma.user.upsert({
      where: { email: TEST_USER_EMAIL },
      update: {},
      create: { id: TEST_USER_ID, email: TEST_USER_EMAIL, passwordHash: '$2a$12$test' },
    });
    app = await buildApp();
  });

  after(async () => {
    // Clean up test data
    await prisma.accessLog.deleteMany({ where: { appId: { startsWith: 'test-' } } });
    await prisma.appGrant.deleteMany({ where: { appId: { startsWith: 'test-' } } });
    await prisma.keySlot.deleteMany({ where: { userId: TEST_USER_ID } });
    await prisma.$disconnect();
    await app.close();
  });

  // --- Test 1: Store and retrieve key shares ---

  it('stores a key and retrieves key slots', async () => {
    const testKey = 'sk-test-fake-openai-key-12345';
    const shares = splitString(testKey, 2, 2);
    const share1Serialized = serializeShare(shares[0]);

    // Store
    const storeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/keys/store',
      headers: AUTH_HEADER,
      payload: {
        provider: 'openai',
        label: 'Test Key',
        share1: share1Serialized,
        vaultCommitment: 'test-commitment-hash',
        appId: 'test-app-001',
        appName: 'Test App',
      },
    });

    assert.equal(storeRes.statusCode, 200);
    const storeData = storeRes.json();
    assert.ok(storeData.keySlotId);
    assert.equal(storeData.status, 'stored');

    // List
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/keys/list',
      headers: AUTH_HEADER,
    });

    assert.equal(listRes.statusCode, 200);
    const listData = listRes.json();
    assert.ok(listData.keySlots.length >= 1);

    const slot = listData.keySlots.find((s: any) => s.id === storeData.keySlotId);
    assert.ok(slot);
    assert.equal(slot.provider, 'openai');
    assert.equal(slot.label, 'Test Key');
    assert.equal(slot.status, 'ACTIVE');
  });

  it('share1 is encrypted in DB, not plaintext', async () => {
    const testKey = 'sk-encryption-test-key-67890';
    const shares = splitString(testKey, 2, 2);
    const share1Serialized = serializeShare(shares[0]);
    const share1Bytes = Buffer.from(share1Serialized, 'base64');

    const storeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/keys/store',
      headers: AUTH_HEADER,
      payload: {
        provider: 'anthropic',
        label: 'Encryption Test',
        share1: share1Serialized,
        vaultCommitment: 'test-commitment-2',
        appId: 'test-app-002',
        appName: 'Test App 2',
      },
    });

    const { keySlotId } = storeRes.json();

    // Read raw DB record
    const dbSlot = await prisma.keySlot.findUnique({
      where: { id: keySlotId },
    });

    assert.ok(dbSlot);
    // Encrypted data should be LONGER than plaintext (salt + iv + tag + ciphertext)
    assert.ok(
      Buffer.from(dbSlot.share1Encrypted).length > share1Bytes.length,
      'Encrypted share should be larger than plaintext share (includes salt + iv + tag)'
    );
    // Encrypted data should NOT contain the plaintext share
    assert.ok(
      !Buffer.from(dbSlot.share1Encrypted).includes(share1Bytes),
      'DB should not contain plaintext share bytes'
    );
  });

  // --- Test 2: Revocation ---

  it('revokes a key slot and zeroes Share 1', async () => {
    const testKey = 'sk-revoke-test-key';
    const shares = splitString(testKey, 2, 2);

    const storeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/keys/store',
      headers: AUTH_HEADER,
      payload: {
        provider: 'openai',
        label: 'Revoke Test',
        share1: serializeShare(shares[0]),
        vaultCommitment: 'test-commitment-3',
        appId: 'test-app-003',
        appName: 'Revoke App',
      },
    });

    const { keySlotId } = storeRes.json();

    // Revoke
    const revokeRes = await app.inject({
      method: 'POST',
      url: `/api/v1/keys/revoke/${keySlotId}`,
      headers: AUTH_HEADER,
    });

    assert.equal(revokeRes.statusCode, 200);
    assert.equal(revokeRes.json().status, 'revoked');

    // Verify in DB
    const dbSlot = await prisma.keySlot.findUnique({ where: { id: keySlotId } });
    assert.ok(dbSlot);
    assert.equal(dbSlot.status, 'REVOKED');
    assert.equal(Buffer.from(dbSlot.share1Encrypted).length, 0, 'Share 1 should be zeroed');

    // Verify no longer shows in list
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/keys/list',
      headers: AUTH_HEADER,
    });
    const activeSlots = listRes.json().keySlots;
    const found = activeSlots.find((s: any) => s.id === keySlotId);
    assert.ok(!found, 'Revoked key should not appear in active list');
  });

  // --- Test 3: App authorization ---

  it('grants and revokes app access', async () => {
    const testKey = 'sk-app-auth-test';
    const shares = splitString(testKey, 2, 2);

    const storeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/keys/store',
      headers: AUTH_HEADER,
      payload: {
        provider: 'openai',
        label: 'App Auth Test',
        share1: serializeShare(shares[0]),
        vaultCommitment: 'test-commitment-4',
        appId: 'test-app-A',
        appName: 'App A',
      },
    });

    const { keySlotId } = storeRes.json();

    // Grant app B
    const grantRes = await app.inject({
      method: 'POST',
      url: `/api/v1/keys/${keySlotId}/grant`,
      headers: AUTH_HEADER,
      payload: { appId: 'test-app-B', appName: 'App B' },
    });

    assert.equal(grantRes.statusCode, 200);
    assert.ok(grantRes.json().grantId);

    // Verify both apps in grants
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/keys/list',
      headers: AUTH_HEADER,
    });
    const slot = listRes.json().keySlots.find((s: any) => s.id === keySlotId);
    assert.equal(slot.appGrants.length, 2);

    // Revoke app B
    const revokeAppRes = await app.inject({
      method: 'POST',
      url: `/api/v1/keys/${keySlotId}/revoke-app/test-app-B`,
      headers: AUTH_HEADER,
    });

    assert.equal(revokeAppRes.statusCode, 200);

    // Verify only app A remains
    const listRes2 = await app.inject({
      method: 'GET',
      url: '/api/v1/keys/list',
      headers: AUTH_HEADER,
    });
    const slot2 = listRes2.json().keySlots.find((s: any) => s.id === keySlotId);
    assert.equal(slot2.appGrants.length, 1);
    assert.equal(slot2.appGrants[0].appId, 'test-app-A');
  });

  // --- Test 4: Replay prevention ---

  it('rejects replayed nullifiers', async () => {
    const testKey = 'sk-replay-test-key';
    const shares = splitString(testKey, 2, 2);

    const storeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/keys/store',
      headers: AUTH_HEADER,
      payload: {
        provider: 'openai',
        label: 'Replay Test',
        share1: serializeShare(shares[0]),
        vaultCommitment: 'test-commitment-5',
        appId: 'test-app-replay',
        appName: 'Replay App',
      },
    });

    const { keySlotId } = storeRes.json();
    const nullifier = 'test-nullifier-unique-123';

    // First call — should succeed (will fail on actual API call, but nullifier gets logged)
    const call1 = await app.inject({
      method: 'POST',
      url: '/api/v1/proxy/call',
      payload: {
        keySlotId,
        share2: serializeShare(shares[1]),
        zkProof: 'test-proof',
        nullifier,
        appId: 'test-app-replay',
        targetPath: '/v1/models',
        method: 'GET',
      },
    });

    // The call might fail on the actual proxy (no real OpenAI key), but that's fine
    // What matters is: the nullifier was recorded

    // Second call with SAME nullifier — should be rejected
    const call2 = await app.inject({
      method: 'POST',
      url: '/api/v1/proxy/call',
      payload: {
        keySlotId,
        share2: serializeShare(shares[1]),
        zkProof: 'test-proof',
        nullifier, // SAME nullifier — replay!
        appId: 'test-app-replay',
        targetPath: '/v1/models',
        method: 'GET',
      },
    });

    assert.equal(call2.statusCode, 403);
    assert.ok(call2.json().error.includes('replay'));
  });

  // --- Test 5: Unauthorized app rejected ---

  it('rejects proxy calls from unauthorized apps', async () => {
    const testKey = 'sk-unauth-app-test';
    const shares = splitString(testKey, 2, 2);

    const storeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/keys/store',
      headers: AUTH_HEADER,
      payload: {
        provider: 'openai',
        label: 'Unauth App Test',
        share1: serializeShare(shares[0]),
        vaultCommitment: 'test-commitment-6',
        appId: 'test-app-authorized',
        appName: 'Authorized App',
      },
    });

    const { keySlotId } = storeRes.json();

    // Try with unauthorized app
    const callRes = await app.inject({
      method: 'POST',
      url: '/api/v1/proxy/call',
      payload: {
        keySlotId,
        share2: serializeShare(shares[1]),
        zkProof: 'test-proof',
        nullifier: 'test-nullifier-unauth-' + Date.now(),
        appId: 'test-app-UNAUTHORIZED', // NOT granted
        targetPath: '/v1/models',
        method: 'GET',
      },
    });

    assert.equal(callRes.statusCode, 403);
    assert.ok(callRes.json().error.includes('not authorized'));
  });

  // --- Test 6: Access logs ---

  it('creates access logs for every proxy call', async () => {
    const testKey = 'sk-log-test-key';
    const shares = splitString(testKey, 2, 2);

    const storeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/keys/store',
      headers: AUTH_HEADER,
      payload: {
        provider: 'openai',
        label: 'Log Test',
        share1: serializeShare(shares[0]),
        vaultCommitment: 'test-commitment-7',
        appId: 'test-app-log',
        appName: 'Log App',
      },
    });

    const { keySlotId } = storeRes.json();
    const nullifier = 'test-nullifier-log-' + Date.now();

    // Make a proxy call (will likely fail at OpenAI, but log is created)
    await app.inject({
      method: 'POST',
      url: '/api/v1/proxy/call',
      payload: {
        keySlotId,
        share2: serializeShare(shares[1]),
        zkProof: 'test-proof-log',
        nullifier,
        appId: 'test-app-log',
        targetPath: '/v1/models',
        method: 'GET',
      },
    });

    // Check logs
    const logsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/keys/${keySlotId}/logs`,
      headers: AUTH_HEADER,
    });

    assert.equal(logsRes.statusCode, 200);
    const { logs } = logsRes.json();
    assert.ok(logs.length >= 1);

    const log = logs.find((l: any) => l.nullifier === nullifier);
    assert.ok(log, 'Access log should contain the nullifier');
    assert.equal(log.appId, 'test-app-log');
    assert.equal(log.action, 'api_call');
  });
});
