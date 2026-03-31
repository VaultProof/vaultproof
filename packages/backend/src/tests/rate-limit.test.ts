/**
 * VaultProof Rate Limit Tests
 *
 * Tests the tier-based rate limiting functions that enforce
 * monthly call limits and key slot limits per pricing tier.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { checkRateLimit, checkKeySlotLimit } from '../middleware/tier-limits.js';
import { randomBytes } from 'crypto';

// Set env vars for tests
process.env.VAULT_ENCRYPTION_KEY = 'aa95f81367855c92e7b92d42d0d5dd059b48eb25b64246e93c101bc6f28cd9bd';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.NODE_ENV = 'test';

const prisma = new PrismaClient();

const TEST_USER_ID = 'test-ratelimit-user-001';
const TEST_USER_EMAIL = 'ratelimit-test@vaultproof.dev';

describe('Rate Limit Tests', () => {
  let testKeySlotId: string;
  const createdKeySlotIds: string[] = [];

  before(async () => {
    // Clean up leftover data from previous runs
    const oldSlots = await prisma.keySlot.findMany({ where: { userId: TEST_USER_ID }, select: { id: true } });
    if (oldSlots.length > 0) {
      const oldIds = oldSlots.map(s => s.id);
      await prisma.accessLog.deleteMany({ where: { keySlotId: { in: oldIds } } });
      await prisma.appGrant.deleteMany({ where: { keySlotId: { in: oldIds } } });
      await prisma.keySlot.deleteMany({ where: { userId: TEST_USER_ID } });
    }

    // Create test user
    await prisma.user.upsert({
      where: { email: TEST_USER_EMAIL },
      update: {},
      create: { id: TEST_USER_ID, email: TEST_USER_EMAIL, passwordHash: '$2a$12$test' },
    });

    // Create a test key slot for rate limit checks
    const keySlot = await prisma.keySlot.create({
      data: {
        userId: TEST_USER_ID,
        provider: 'openai',
        label: 'Rate Limit Test Key',
        share1Encrypted: Buffer.from('test-encrypted-share'),
        vaultCommitment: 'test-commitment-ratelimit',
        authAppsRoot: '',
      },
    });
    testKeySlotId = keySlot.id;
    createdKeySlotIds.push(keySlot.id);
  });

  after(async () => {
    // Clean up ALL data for this test user (handles tracked + leftover slots)
    const allSlots = await prisma.keySlot.findMany({ where: { userId: TEST_USER_ID }, select: { id: true } });
    if (allSlots.length > 0) {
      const allIds = allSlots.map(s => s.id);
      await prisma.accessLog.deleteMany({ where: { keySlotId: { in: allIds } } });
      await prisma.appGrant.deleteMany({ where: { keySlotId: { in: allIds } } });
      await prisma.keySlot.deleteMany({ where: { userId: TEST_USER_ID } });
    }

    await prisma.user.deleteMany({ where: { id: TEST_USER_ID } });
    await prisma.$disconnect();
  });

  // --- Test 1: checkRateLimit with 0 calls ---

  it('allows requests when 0 calls have been made', async () => {
    const result = await checkRateLimit(testKeySlotId, 'free');

    assert.equal(result.allowed, true);
    assert.equal(result.used, 0);
    assert.equal(result.limit, 10000);
    assert.equal(result.remaining, 10000);
  });

  // --- Test 2: checkKeySlotLimit with 0 keys ---

  it('allows key slot creation when user has 0 active keys', async () => {
    // Use a different user ID with no key slots
    const emptyUserId = 'test-ratelimit-empty-user';

    await prisma.user.upsert({
      where: { email: 'empty-ratelimit@vaultproof.dev' },
      update: {},
      create: { id: emptyUserId, email: 'empty-ratelimit@vaultproof.dev', passwordHash: '$2a$12$test' },
    });

    const result = await checkKeySlotLimit(emptyUserId, 'free');

    assert.equal(result.allowed, true);
    assert.equal(result.used, 0);
    assert.equal(result.limit, 3);

    // Clean up the extra user
    await prisma.user.deleteMany({ where: { id: emptyUserId } });
  });

  // --- Test 3: checkKeySlotLimit with 3 keys (free tier max) ---

  it('blocks key slot creation when user has 3 active keys (free tier max)', async () => {
    // Create 2 more key slots (we already have 1 from before())
    for (let i = 0; i < 2; i++) {
      const ks = await prisma.keySlot.create({
        data: {
          userId: TEST_USER_ID,
          provider: 'openai',
          label: `Rate Limit Extra Key ${i}`,
          share1Encrypted: Buffer.from('test-encrypted'),
          vaultCommitment: `test-commitment-extra-${i}`,
          authAppsRoot: '',
        },
      });
      createdKeySlotIds.push(ks.id);
    }

    // Now the user has 3 active key slots
    const result = await checkKeySlotLimit(TEST_USER_ID, 'free');

    assert.equal(result.allowed, false);
    assert.equal(result.used, 3);
    assert.equal(result.limit, 3);
  });

  // --- Test 4: checkRateLimit after 10000 calls ---

  it('blocks requests after exceeding hard limit (free tier + 5% buffer)', async () => {
    // Free tier advertised limit is 10,000 but hard limit is 10,500 (5% buffer).
    // Insert 10,500 logs to hit the hard block.
    const HARD_LIMIT = 10500;
    const logs = [];
    for (let i = 0; i < HARD_LIMIT; i++) {
      logs.push({
        keySlotId: testKeySlotId,
        appId: 'ratelimit-internal-app',
        action: 'api_call',
        zkProof: 'test-proof',
        nullifier: `ratelimit-nullifier-${randomBytes(16).toString('hex')}-${i}`,
        timestamp: new Date(),
      });
    }

    // Batch insert in chunks to avoid query size limits
    const chunkSize = 200;
    for (let i = 0; i < logs.length; i += chunkSize) {
      await prisma.accessLog.createMany({
        data: logs.slice(i, i + chunkSize),
      });
    }

    const result = await checkRateLimit(testKeySlotId, 'free');

    assert.equal(result.allowed, false);
    assert.equal(result.used, HARD_LIMIT);
    assert.equal(result.limit, 10000);
    assert.equal(result.remaining, 0);
  });
});
