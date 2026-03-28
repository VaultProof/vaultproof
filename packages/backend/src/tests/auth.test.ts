/**
 * Auth Route Tests
 *
 * Tests the current auth routes: /me, /refresh, /kill-switch, /global-limits, /account.
 * Registration and login are handled by Supabase (not tested here).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { authRoutes } from '../routes/auth.js';
import { generateToken } from '../middleware/auth.js';

// Set env vars for tests
process.env.VAULT_ENCRYPTION_KEY = 'aa95f81367855c92e7b92d42d0d5dd059b48eb25b64246e93c101bc6f28cd9bd';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.NODE_ENV = 'test';

const prisma = new PrismaClient();

const TEST_USER_ID = 'auth-test-user-001';
const TEST_USER_EMAIL = 'auth-test@vaultproof.dev';

async function buildApp() {
  const app = Fastify();
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  return app;
}

describe('Auth Route Tests', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token: string;

  before(async () => {
    // Create test user
    await prisma.user.upsert({
      where: { email: TEST_USER_EMAIL },
      update: {},
      create: { id: TEST_USER_ID, email: TEST_USER_EMAIL, passwordHash: '$2a$12$test' },
    });

    token = generateToken(TEST_USER_ID, TEST_USER_EMAIL);
    app = await buildApp();
  });

  after(async () => {
    await prisma.user.deleteMany({ where: { email: TEST_USER_EMAIL } });
    await prisma.$disconnect();
    await app.close();
  });

  // --- GET /me ---

  it('GET /me with valid token returns user info', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(res.statusCode, 200);
    const data = res.json();
    assert.ok(data.user, 'Should return user object');
    assert.equal(data.user.email, TEST_USER_EMAIL);
    assert.ok(data.user.id);
    assert.ok(data.user.createdAt);
  });

  it('GET /me with invalid token returns 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: 'Bearer invalid-garbage-token' },
    });

    assert.equal(res.statusCode, 401);
    const data = res.json();
    assert.ok(data.error);
  });

  it('GET /me with no Authorization header returns 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
    });

    assert.equal(res.statusCode, 401);
    const data = res.json();
    assert.ok(data.error);
  });

  // --- POST /kill-switch ---

  it('POST /kill-switch toggles kill switch on', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/kill-switch',
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: true },
    });

    assert.equal(res.statusCode, 200);
    const data = res.json();
    assert.equal(data.killSwitch, true);
  });

  it('POST /kill-switch toggles kill switch off', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/kill-switch',
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: false },
    });

    assert.equal(res.statusCode, 200);
    const data = res.json();
    assert.equal(data.killSwitch, false);
  });

  it('POST /kill-switch rejects invalid input', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/kill-switch',
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: 'not-a-boolean' },
    });

    assert.equal(res.statusCode, 400);
  });

  // --- PUT /global-limits ---

  it('PUT /global-limits sets daily and monthly limits', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/auth/global-limits',
      headers: { authorization: `Bearer ${token}` },
      payload: { globalDailyLimit: 500, globalMonthlyLimit: 10000 },
    });

    assert.equal(res.statusCode, 200);
    const data = res.json();
    assert.equal(data.globalDailyLimit, 500);
    assert.equal(data.globalMonthlyLimit, 10000);
  });

  it('PUT /global-limits clears limits with null', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/auth/global-limits',
      headers: { authorization: `Bearer ${token}` },
      payload: { globalDailyLimit: null, globalMonthlyLimit: null },
    });

    assert.equal(res.statusCode, 200);
    const data = res.json();
    assert.equal(data.globalDailyLimit, null);
    assert.equal(data.globalMonthlyLimit, null);
  });

  // --- Auth required on all routes ---

  it('all protected routes reject unauthenticated requests', async () => {
    const routes = [
      { method: 'GET' as const, url: '/api/v1/auth/me' },
      { method: 'POST' as const, url: '/api/v1/auth/kill-switch' },
      { method: 'PUT' as const, url: '/api/v1/auth/global-limits' },
    ];

    for (const route of routes) {
      const res = await app.inject({ method: route.method, url: route.url });
      assert.equal(res.statusCode, 401, `${route.method} ${route.url} should require auth`);
    }
  });
});
