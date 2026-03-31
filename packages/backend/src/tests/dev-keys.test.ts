/**
 * Developer Key Route Tests
 *
 * Tests key creation, listing, revocation, and SDK authentication via X-API-Key.
 * Uses Fastify inject() with a mini app that registers dev-key and SDK routes.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { developerKeyRoutes } from '../routes/developer-keys.js';
import { sdkRoutes } from '../routes/sdk.js';
import { generateToken } from '../middleware/auth.js';

// Set env vars for tests
process.env.VAULT_ENCRYPTION_KEY = 'aa95f81367855c92e7b92d42d0d5dd059b48eb25b64246e93c101bc6f28cd9bd';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.NODE_ENV = 'test';

const prisma = new PrismaClient();

const TEST_USER_ID = 'devkey-test-user-001';
const TEST_USER_EMAIL = 'devkey-test@vaultproof.dev';
const AUTH_HEADER = { authorization: `Bearer ${generateToken(TEST_USER_ID, TEST_USER_EMAIL)}` };

async function buildApp() {
  const app = Fastify();
  await app.register(developerKeyRoutes, { prefix: '/api/v1/dev-keys' });
  await app.register(sdkRoutes, { prefix: '/api/v1/sdk' });
  return app;
}

describe('Developer Key Route Tests', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  before(async () => {
    // Clean up leftover data from previous runs
    const oldKeys = await prisma.developerKey.findMany({
      where: { userId: TEST_USER_ID },
      select: { id: true },
    });
    if (oldKeys.length > 0) {
      const oldIds = oldKeys.map(k => k.id);
      await prisma.sessionToken.deleteMany({ where: { developerKeyId: { in: oldIds } } });
      await prisma.developerKey.deleteMany({ where: { userId: TEST_USER_ID } });
    }

    // Ensure test user exists
    await prisma.user.upsert({
      where: { email: TEST_USER_EMAIL },
      update: {},
      create: { id: TEST_USER_ID, email: TEST_USER_EMAIL, passwordHash: '$2a$12$test' },
    });
    app = await buildApp();
  });

  after(async () => {
    // Delete session tokens before dev keys (no cascade in schema)
    const devKeyIds = (
      await prisma.developerKey.findMany({
        where: { userId: TEST_USER_ID },
        select: { id: true },
      })
    ).map((k) => k.id);
    if (devKeyIds.length > 0) {
      await prisma.sessionToken.deleteMany({ where: { developerKeyId: { in: devKeyIds } } });
    }
    await prisma.developerKey.deleteMany({ where: { userId: TEST_USER_ID } });
    await prisma.user.deleteMany({ where: { id: TEST_USER_ID } });
    await prisma.$disconnect();
    await app.close();
  });

  // --- Key Creation ---

  it('creates a live dev key with correct prefix and fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dev-keys/create',
      headers: AUTH_HEADER,
      payload: { label: 'Test Live Key' },
    });

    assert.equal(res.statusCode, 200);
    const data = res.json();
    assert.ok(data.id, 'Should return key id');
    assert.ok(data.key.startsWith('vp_live_'), `Key should start with vp_live_, got: ${data.key.slice(0, 12)}`);
    assert.equal(data.label, 'Test Live Key');
    assert.equal(data.mode, 'live');
    assert.ok(data.createdAt);
  });

  it('creates a test mode key with vp_test_ prefix', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dev-keys/create',
      headers: AUTH_HEADER,
      payload: { label: 'Test Mode Key', mode: 'test' },
    });

    assert.equal(res.statusCode, 200);
    const data = res.json();
    assert.ok(data.key.startsWith('vp_test_'), `Key should start with vp_test_, got: ${data.key.slice(0, 12)}`);
    assert.equal(data.mode, 'test');
  });

  // --- Key Listing ---

  it('lists dev keys with masked key values', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/dev-keys/list',
      headers: AUTH_HEADER,
    });

    assert.equal(res.statusCode, 200);
    const data = res.json();
    assert.ok(Array.isArray(data.keys), 'Should return an array of keys');
    assert.ok(data.keys.length >= 2, 'Should have at least 2 keys from previous tests');

    // Verify keys are masked (first 12 chars + ... + last 4)
    for (const key of data.keys) {
      assert.ok(key.key.includes('...'), `Key should be masked: ${key.key}`);
      assert.ok(key.id);
      assert.ok(key.label);
      assert.ok(key.mode);
    }
  });

  // --- Key Revocation ---

  it('revokes a dev key', async () => {
    // Create a key to revoke
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/dev-keys/create',
      headers: AUTH_HEADER,
      payload: { label: 'Key To Revoke' },
    });

    const { id: keyId } = createRes.json();

    // Revoke it
    const revokeRes = await app.inject({
      method: 'POST',
      url: `/api/v1/dev-keys/${keyId}/revoke`,
      headers: AUTH_HEADER,
    });

    assert.equal(revokeRes.statusCode, 200);
    assert.equal(revokeRes.json().status, 'revoked');

    // Verify it no longer appears in list (revoked keys are filtered out)
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/dev-keys/list',
      headers: AUTH_HEADER,
    });

    const found = listRes.json().keys.find((k: any) => k.id === keyId);
    assert.ok(!found, 'Revoked key should not appear in active list');
  });

  // --- SDK Authentication via X-API-Key ---

  it('SDK route authenticates with valid vp_live_ key in X-API-Key header', async () => {
    // Create a live key
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/dev-keys/create',
      headers: AUTH_HEADER,
      payload: { label: 'SDK Auth Test Key' },
    });

    const { key } = createRes.json();

    // Use the key to hit an SDK endpoint (GET /sdk/keys lists stored API keys)
    const sdkRes = await app.inject({
      method: 'GET',
      url: '/api/v1/sdk/keys',
      headers: { 'x-api-key': key },
    });

    assert.equal(sdkRes.statusCode, 200);
    const data = sdkRes.json();
    assert.ok(Array.isArray(data.keys), 'SDK /keys should return a keys array');
  });

  it('SDK route rejects revoked dev key (401)', async () => {
    // Create and immediately revoke a key
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/dev-keys/create',
      headers: AUTH_HEADER,
      payload: { label: 'Revoke Then SDK Test' },
    });

    const { id: keyId, key } = createRes.json();

    // Revoke it
    await app.inject({
      method: 'POST',
      url: `/api/v1/dev-keys/${keyId}/revoke`,
      headers: AUTH_HEADER,
    });

    // Try to use the revoked key on an SDK route
    const sdkRes = await app.inject({
      method: 'GET',
      url: '/api/v1/sdk/keys',
      headers: { 'x-api-key': key },
    });

    assert.equal(sdkRes.statusCode, 401);
    const data = sdkRes.json();
    assert.ok(data.error);
  });

  it('SDK route rejects garbage key (401)', async () => {
    const sdkRes = await app.inject({
      method: 'GET',
      url: '/api/v1/sdk/keys',
      headers: { 'x-api-key': 'garbage-not-a-real-key' },
    });

    assert.equal(sdkRes.statusCode, 401);
    const data = sdkRes.json();
    assert.ok(data.error);
  });

  // --- Session Token Creation ---

  it('ST-1: creates a session token for a valid active key', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/dev-keys/create',
      headers: AUTH_HEADER,
      payload: { label: 'Session Token Test Key' },
    });
    const { id: keyId } = createRes.json();

    const sessionRes = await app.inject({
      method: 'POST',
      url: `/api/v1/dev-keys/${keyId}/session`,
      headers: AUTH_HEADER,
    });

    assert.equal(sessionRes.statusCode, 200);
    const data = sessionRes.json();
    assert.ok(data.token, 'Should return a token');
    assert.ok(!data.token.startsWith('vp_'), 'Session token should not look like a dev key');
    assert.ok(data.expiresAt, 'Should return an expiresAt');
    assert.ok(
      new Date(data.expiresAt).getTime() > Date.now() + 4 * 60 * 1000,
      'Token should expire at least 4 minutes from now'
    );
  });

  it('ST-2: session endpoint returns 403 for a revoked key', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/dev-keys/create',
      headers: AUTH_HEADER,
      payload: { label: 'Revoke Before Session' },
    });
    const { id: keyId } = createRes.json();

    await app.inject({
      method: 'POST',
      url: `/api/v1/dev-keys/${keyId}/revoke`,
      headers: AUTH_HEADER,
    });

    const sessionRes = await app.inject({
      method: 'POST',
      url: `/api/v1/dev-keys/${keyId}/session`,
      headers: AUTH_HEADER,
    });

    assert.equal(sessionRes.statusCode, 403);
    assert.ok(sessionRes.json().error);
  });

  it('ST-3: session endpoint returns 404 for another user\'s key', async () => {
    const OTHER_USER_ID = 'devkey-test-user-002';
    const OTHER_USER_EMAIL = 'devkey-test2@vaultproof.dev';

    await prisma.user.upsert({
      where: { email: OTHER_USER_EMAIL },
      update: {},
      create: { id: OTHER_USER_ID, email: OTHER_USER_EMAIL, passwordHash: '$2a$12$test' },
    });

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/dev-keys/create',
      headers: { authorization: `Bearer ${generateToken(OTHER_USER_ID, OTHER_USER_EMAIL)}` },
      payload: { label: 'Other User Key' },
    });
    const { id: foreignKeyId } = createRes.json();

    // Try to get a session token for another user's key
    const sessionRes = await app.inject({
      method: 'POST',
      url: `/api/v1/dev-keys/${foreignKeyId}/session`,
      headers: AUTH_HEADER, // original user's auth
    });

    assert.equal(sessionRes.statusCode, 404);

    // Teardown second user
    await prisma.developerKey.deleteMany({ where: { userId: OTHER_USER_ID } });
    await prisma.user.deleteMany({ where: { id: OTHER_USER_ID } });
  });

  // --- SDK Authentication with Session Token ---

  it('ST-4: SDK route accepts valid dev key + valid session token', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/dev-keys/create',
      headers: AUTH_HEADER,
      payload: { label: 'SDK Session Auth Key' },
    });
    const { id: keyId, key } = createRes.json();

    const sessionRes = await app.inject({
      method: 'POST',
      url: `/api/v1/dev-keys/${keyId}/session`,
      headers: AUTH_HEADER,
    });
    const { token: sessionToken } = sessionRes.json();

    const sdkRes = await app.inject({
      method: 'GET',
      url: '/api/v1/sdk/keys',
      headers: { 'x-api-key': key, 'x-vaultproof-session': sessionToken },
    });

    assert.equal(sdkRes.statusCode, 200);
    assert.ok(Array.isArray(sdkRes.json().keys));
  });

  // Clean up active keys before session edge-case tests to avoid hitting the 5-key limit
  it('cleanup: revoke excess keys before session edge cases', async () => {
    const active = await prisma.developerKey.findMany({
      where: { userId: TEST_USER_ID, revokedAt: null },
      select: { id: true },
    });
    for (const k of active) {
      await prisma.$transaction([
        prisma.sessionToken.deleteMany({ where: { developerKeyId: k.id } }),
        prisma.developerKey.update({ where: { id: k.id }, data: { revokedAt: new Date() } }),
      ]);
    }
    const remaining = await prisma.developerKey.count({ where: { userId: TEST_USER_ID, revokedAt: null } });
    assert.equal(remaining, 0, 'All keys should be revoked for clean slate');
  });

  it('ST-5: SDK route rejects valid dev key + garbage session token', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/dev-keys/create',
      headers: AUTH_HEADER,
      payload: { label: 'SDK Garbage Session Key' },
    });
    const { key } = createRes.json();

    const sdkRes = await app.inject({
      method: 'GET',
      url: '/api/v1/sdk/keys',
      headers: { 'x-api-key': key, 'x-vaultproof-session': 'garbage-session-token' },
    });

    assert.equal(sdkRes.statusCode, 401);
  });

  it('ST-6: SDK route rejects valid dev key + expired session token', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/dev-keys/create',
      headers: AUTH_HEADER,
      payload: { label: 'SDK Expired Session Key' },
    });
    const { id: keyId, key } = createRes.json();

    // Directly insert an already-expired session token
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    await prisma.sessionToken.create({
      data: {
        developerKeyId: keyId,
        tokenHash,
        expiresAt: new Date(Date.now() - 1000), // already expired
      },
    });

    const sdkRes = await app.inject({
      method: 'GET',
      url: '/api/v1/sdk/keys',
      headers: { 'x-api-key': key, 'x-vaultproof-session': rawToken },
    });

    assert.equal(sdkRes.statusCode, 401);
  });

  it('ST-7: SDK route rejects session token belonging to a different dev key', async () => {
    // Create two keys
    const resA = await app.inject({
      method: 'POST',
      url: '/api/v1/dev-keys/create',
      headers: AUTH_HEADER,
      payload: { label: 'Key A' },
    });
    const resB = await app.inject({
      method: 'POST',
      url: '/api/v1/dev-keys/create',
      headers: AUTH_HEADER,
      payload: { label: 'Key B' },
    });
    const { id: keyIdA, key: keyA } = resA.json();
    const { key: keyB } = resB.json();

    // Get session token for keyA
    const sessionRes = await app.inject({
      method: 'POST',
      url: `/api/v1/dev-keys/${keyIdA}/session`,
      headers: AUTH_HEADER,
    });
    const { token: keyASession } = sessionRes.json();

    // Try to use keyA's session token with keyB
    const sdkRes = await app.inject({
      method: 'GET',
      url: '/api/v1/sdk/keys',
      headers: { 'x-api-key': keyB, 'x-vaultproof-session': keyASession },
    });

    assert.equal(sdkRes.statusCode, 401);
  });

  // --- Revocation Cascade ---

  it('ST-8: revoking a dev key deletes its session tokens', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/dev-keys/create',
      headers: AUTH_HEADER,
      payload: { label: 'Cascade Revoke Key' },
    });
    const { id: keyId } = createRes.json();

    // Get a session token
    await app.inject({
      method: 'POST',
      url: `/api/v1/dev-keys/${keyId}/session`,
      headers: AUTH_HEADER,
    });

    // Confirm session token exists
    const tokensBefore = await prisma.sessionToken.findMany({ where: { developerKeyId: keyId } });
    assert.ok(tokensBefore.length >= 1, 'Session token should exist before revocation');

    // Revoke the key
    const revokeRes = await app.inject({
      method: 'POST',
      url: `/api/v1/dev-keys/${keyId}/revoke`,
      headers: AUTH_HEADER,
    });
    assert.equal(revokeRes.statusCode, 200);

    // Confirm session tokens were deleted
    const tokensAfter = await prisma.sessionToken.findMany({ where: { developerKeyId: keyId } });
    assert.equal(tokensAfter.length, 0, 'Session tokens should be deleted after revocation');
  });
});
