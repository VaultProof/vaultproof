/**
 * Auth Route Tests
 *
 * Tests registration, login, and protected /me endpoint.
 * Uses Fastify inject() with a mini app that only registers auth routes.
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

const TEST_EMAILS = [
  'auth-test-1@vaultproof.dev',
  'auth-test-2@vaultproof.dev',
  'auth-test-3@vaultproof.dev',
  'auth-test-login@vaultproof.dev',
];

async function buildApp() {
  const app = Fastify();
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  return app;
}

describe('Auth Route Tests', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  before(async () => {
    // Clean up any leftover test data from previous runs
    await prisma.user.deleteMany({
      where: { email: { in: TEST_EMAILS } },
    });
    app = await buildApp();
  });

  after(async () => {
    // Clean up all test users
    await prisma.user.deleteMany({
      where: { email: { in: TEST_EMAILS } },
    });
    await prisma.$disconnect();
    await app.close();
  });

  // --- Registration ---

  it('registers with valid email and password, returns token and user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'auth-test-1@vaultproof.dev',
        password: 'securePass123',
      },
    });

    assert.equal(res.statusCode, 200);
    const data = res.json();
    assert.ok(data.token, 'Response should contain a token');
    assert.ok(data.user, 'Response should contain a user object');
    assert.equal(data.user.email, 'auth-test-1@vaultproof.dev');
    assert.ok(data.user.id, 'User should have an id');
  });

  it('rejects registration with duplicate email (409)', async () => {
    // First, register a user
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'auth-test-2@vaultproof.dev',
        password: 'securePass123',
      },
    });

    // Try to register again with the same email
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'auth-test-2@vaultproof.dev',
        password: 'differentPass456',
      },
    });

    assert.equal(res.statusCode, 409);
    const data = res.json();
    assert.ok(data.error.includes('already'));
  });

  it('rejects registration with short password (400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'auth-test-3@vaultproof.dev',
        password: 'short',
      },
    });

    assert.equal(res.statusCode, 400);
    const data = res.json();
    assert.ok(data.error);
  });

  // --- Login ---

  it('logs in with correct credentials, returns token', async () => {
    // Register first
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'auth-test-login@vaultproof.dev',
        password: 'loginTestPass99',
      },
    });

    // Login
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'auth-test-login@vaultproof.dev',
        password: 'loginTestPass99',
      },
    });

    assert.equal(res.statusCode, 200);
    const data = res.json();
    assert.ok(data.token, 'Login should return a token');
    assert.ok(data.user, 'Login should return a user object');
    assert.equal(data.user.email, 'auth-test-login@vaultproof.dev');
  });

  it('rejects login with wrong password (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'auth-test-login@vaultproof.dev',
        password: 'wrongPassword999',
      },
    });

    assert.equal(res.statusCode, 401);
    const data = res.json();
    assert.ok(data.error.includes('Invalid'));
  });

  it('rejects login with non-existent email (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'does-not-exist@vaultproof.dev',
        password: 'anyPassword123',
      },
    });

    assert.equal(res.statusCode, 401);
    const data = res.json();
    assert.ok(data.error.includes('Invalid'));
  });

  // --- GET /me ---

  it('GET /me with valid token returns user info', async () => {
    // Register and capture the token
    const registerRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email: 'auth-test-3@vaultproof.dev',
        password: 'meTestPass123',
      },
    });

    const { token } = registerRes.json();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(res.statusCode, 200);
    const data = res.json();
    assert.ok(data.user, 'Should return user object');
    assert.equal(data.user.email, 'auth-test-3@vaultproof.dev');
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
});
