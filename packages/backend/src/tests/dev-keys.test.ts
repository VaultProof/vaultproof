/**
 * Developer Key Route Tests
 *
 * Tests key creation, listing, revocation, and SDK authentication via X-API-Key.
 * Uses Fastify inject() with a mini app that registers dev-key and SDK routes.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
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
    // Ensure test user exists
    await prisma.user.upsert({
      where: { email: TEST_USER_EMAIL },
      update: {},
      create: { id: TEST_USER_ID, email: TEST_USER_EMAIL, passwordHash: '$2a$12$test' },
    });
    app = await buildApp();
  });

  after(async () => {
    // Clean up dev keys and user
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
});
