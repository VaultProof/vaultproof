/**
 * Linked Keys (allowedKeySlotIds) Tests
 *
 * Verifies that developer keys with allowedKeySlotIds restrictions:
 *   LK-1: CAN access the linked slot
 *   LK-2: CANNOT access an unlinked slot (403)
 *   LK-3: Unrestricted key can access any slot
 *   LK-4: Cannot link to another user's slot (400)
 *   LK-5: List endpoint returns allowedKeySlotIds
 *   LK-6: Clearing allowedKeySlotIds removes restriction
 *
 * Security concern: if the restriction isn't enforced, a stolen/leaked
 * vp_live_ key scoped to one slot could be used to exfiltrate all slots.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { splitString, serializeShare } from '@vaultproof/shamir';
import { sdkRoutes } from '../routes/sdk.js';
import { developerKeyRoutes } from '../routes/developer-keys.js';
import { generateToken } from '../middleware/auth.js';

process.env.VAULT_ENCRYPTION_KEY = 'aa95f81367855c92e7b92d42d0d5dd059b48eb25b64246e93c101bc6f28cd9bd';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.NODE_ENV = 'test';

const prisma = new PrismaClient();

const USER_ID = 'linked-keys-user-001';
const USER_EMAIL = 'linked-keys@vaultproof.dev';
const OTHER_USER_ID = 'linked-keys-user-002';
const OTHER_USER_EMAIL = 'linked-keys-other@vaultproof.dev';

async function buildApp() {
  const app = Fastify();
  await app.register(developerKeyRoutes, { prefix: '/api/v1/dev-keys' });
  await app.register(sdkRoutes, { prefix: '/api/v1/sdk' });
  return app;
}

describe('Linked Keys (allowedKeySlotIds) Enforcement Tests', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  const authHeader = { authorization: `Bearer ${generateToken(USER_ID, USER_EMAIL)}` };
  const otherAuthHeader = { authorization: `Bearer ${generateToken(OTHER_USER_ID, OTHER_USER_EMAIL)}` };

  // Set in before()
  let devKeyUnrestricted: string;  // vp_live_ key, no allowedKeySlotIds
  let devKeyLinked: string;        // vp_live_ key linked to slotA only
  let devKeyLinkedId: string;      // id of devKeyLinked (for settings updates)
  let slotAId: string;             // openai slot belonging to USER_ID
  let slotBId: string;             // anthropic slot belonging to USER_ID
  let otherUserSlotId: string;     // slot belonging to OTHER_USER_ID

  before(async () => {
    await prisma.user.upsert({
      where: { email: USER_EMAIL },
      update: {},
      create: { id: USER_ID, email: USER_EMAIL, passwordHash: '$2a$12$test' },
    });
    await prisma.user.upsert({
      where: { email: OTHER_USER_EMAIL },
      update: {},
      create: { id: OTHER_USER_ID, email: OTHER_USER_EMAIL, passwordHash: '$2a$12$test' },
    });

    app = await buildApp();

    // Create two dev keys for the main user
    const r1 = await app.inject({ method: 'POST', url: '/api/v1/dev-keys/create', headers: authHeader, payload: { label: 'Unrestricted' } });
    const r2 = await app.inject({ method: 'POST', url: '/api/v1/dev-keys/create', headers: authHeader, payload: { label: 'Linked' } });
    assert.equal(r1.statusCode, 200, `Create unrestricted key failed: ${r1.body}`);
    assert.equal(r2.statusCode, 200, `Create linked key failed: ${r2.body}`);
    devKeyUnrestricted = r1.json().key;
    devKeyLinked = r2.json().key;
    devKeyLinkedId = r2.json().id;

    // Store two key slots for main user (different providers so both can be active)
    const sA = splitString('sk-test-linked-keys-slot-a', 2, 2);
    const sB = splitString('sk-test-linked-keys-slot-b', 2, 2);
    const storeA = await app.inject({
      method: 'POST',
      url: '/api/v1/sdk/store',
      headers: { 'x-api-key': devKeyUnrestricted },
      payload: { share1: serializeShare(sA[0]), share2: serializeShare(sA[1]), provider: 'openai', label: 'Slot A' },
    });
    const storeB = await app.inject({
      method: 'POST',
      url: '/api/v1/sdk/store',
      headers: { 'x-api-key': devKeyUnrestricted },
      payload: { share1: serializeShare(sB[0]), share2: serializeShare(sB[1]), provider: 'anthropic', label: 'Slot B' },
    });
    assert.equal(storeA.statusCode, 200, `Store slot A failed: ${storeA.body}`);
    assert.equal(storeB.statusCode, 200, `Store slot B failed: ${storeB.body}`);
    slotAId = storeA.json().keyId;
    slotBId = storeB.json().keyId;

    // Store a key slot for the other user
    const rOther = await app.inject({ method: 'POST', url: '/api/v1/dev-keys/create', headers: otherAuthHeader, payload: { label: 'Other Key' } });
    const sO = splitString('sk-test-linked-keys-other', 2, 2);
    const storeOther = await app.inject({
      method: 'POST',
      url: '/api/v1/sdk/store',
      headers: { 'x-api-key': rOther.json().key },
      payload: { share1: serializeShare(sO[0]), share2: serializeShare(sO[1]), provider: 'openai', label: 'Other Slot' },
    });
    assert.equal(storeOther.statusCode, 200, `Store other user slot failed: ${storeOther.body}`);
    otherUserSlotId = storeOther.json().keyId;

    // Link devKeyLinked → slotA only
    const settingsRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/dev-keys/${devKeyLinkedId}/settings`,
      headers: authHeader,
      payload: { allowedKeySlotIds: slotAId },
    });
    assert.equal(settingsRes.statusCode, 200, `Link key to slotA failed: ${settingsRes.body}`);
    assert.equal(settingsRes.json().allowedKeySlotIds, slotAId);
  });

  after(async () => {
    const slots = await prisma.keySlot.findMany({
      where: { userId: { in: [USER_ID, OTHER_USER_ID] } },
      select: { id: true },
    });
    const slotIds = slots.map((s) => s.id);
    if (slotIds.length > 0) {
      await prisma.accessLog.deleteMany({ where: { keySlotId: { in: slotIds } } });
      await prisma.appGrant.deleteMany({ where: { keySlotId: { in: slotIds } } });
      await prisma.keySlot.deleteMany({ where: { id: { in: slotIds } } });
    }
    const devKeys = await prisma.developerKey.findMany({
      where: { userId: { in: [USER_ID, OTHER_USER_ID] } },
      select: { id: true },
    });
    if (devKeys.length > 0) {
      await prisma.sessionToken.deleteMany({ where: { developerKeyId: { in: devKeys.map((k) => k.id) } } });
      await prisma.developerKey.deleteMany({ where: { userId: { in: [USER_ID, OTHER_USER_ID] } } });
    }
    await prisma.user.deleteMany({ where: { id: { in: [USER_ID, OTHER_USER_ID] } } });
    await prisma.$disconnect();
    await app.close();
  });

  // ── LK-1: Linked key CAN access the linked slot ──────────────────────

  it('LK-1: linked dev key can proxy-call its linked slot (not blocked with 403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sdk/call',
      headers: { 'x-api-key': devKeyLinked },
      payload: { keyId: slotAId, path: '/v1/models', method: 'GET' },
    });
    // VaultProof should allow through — upstream may 401 (fake key) but NOT 403 from us
    assert.notEqual(
      res.statusCode,
      403,
      `Linked key blocked its own allowed slot with 403. Body: ${res.body}`,
    );
  });

  // ── LK-2: Linked key CANNOT access an unlinked slot ──────────────────

  it('LK-2: linked dev key is blocked from calling an unlinked slot (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sdk/call',
      headers: { 'x-api-key': devKeyLinked },
      payload: { keyId: slotBId, path: '/v1/models', method: 'GET' },
    });
    assert.equal(
      res.statusCode,
      403,
      `Linked key must be blocked from accessing unlinked slot. Got ${res.statusCode}: ${res.body}`,
    );
    const body = res.json();
    assert.ok(
      body.error?.toLowerCase().includes('not linked') || body.error?.toLowerCase().includes('not allowed'),
      `Error should mention the restriction. Got: ${body.error}`,
    );
  });

  // ── LK-3: Unrestricted key can access any slot ────────────────────────

  it('LK-3a: unrestricted dev key can call slotA (not blocked)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sdk/call',
      headers: { 'x-api-key': devKeyUnrestricted },
      payload: { keyId: slotAId, path: '/v1/models', method: 'GET' },
    });
    assert.notEqual(res.statusCode, 403, `Unrestricted key should not be blocked. Got 403: ${res.body}`);
  });

  it('LK-3b: unrestricted dev key can call slotB (not blocked)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/sdk/call',
      headers: { 'x-api-key': devKeyUnrestricted },
      payload: { keyId: slotBId, path: '/v1/models', method: 'GET' },
    });
    assert.notEqual(res.statusCode, 403, `Unrestricted key should not be blocked. Got 403: ${res.body}`);
  });

  // ── LK-4: Cannot link to another user's slot ──────────────────────────

  it('LK-4: cannot set allowedKeySlotIds to another user\'s key slot (400)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/dev-keys/${devKeyLinkedId}/settings`,
      headers: authHeader,
      payload: { allowedKeySlotIds: otherUserSlotId },
    });
    assert.equal(
      res.statusCode,
      400,
      `Should reject another user's slot ID. Got ${res.statusCode}: ${res.body}`,
    );
    assert.ok(
      res.json().error?.includes('do not belong'),
      `Error should mention ownership. Got: ${res.json().error}`,
    );
    // Restore the correct allowedKeySlotIds
    await app.inject({
      method: 'PUT',
      url: `/api/v1/dev-keys/${devKeyLinkedId}/settings`,
      headers: authHeader,
      payload: { allowedKeySlotIds: slotAId },
    });
  });

  // ── LK-5: List endpoint returns allowedKeySlotIds ─────────────────────

  it('LK-5: dev key list returns allowedKeySlotIds field', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/dev-keys/list', headers: authHeader });
    assert.equal(res.statusCode, 200);
    const { keys } = res.json();
    const linked = keys.find((k: any) => k.id === devKeyLinkedId);
    assert.ok(linked, 'Linked dev key should appear in list');
    assert.equal(
      linked.allowedKeySlotIds,
      slotAId,
      `allowedKeySlotIds should be "${slotAId}", got "${linked.allowedKeySlotIds}"`,
    );
  });

  // ── LK-6: Clearing restriction removes it ────────────────────────────

  it('LK-6: clearing allowedKeySlotIds (null) lifts the restriction', async () => {
    // Clear
    const clearRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/dev-keys/${devKeyLinkedId}/settings`,
      headers: authHeader,
      payload: { allowedKeySlotIds: null },
    });
    assert.equal(clearRes.statusCode, 200, `Clear failed: ${clearRes.body}`);
    assert.equal(clearRes.json().allowedKeySlotIds, null);

    // Key should now reach slotB without 403
    const callRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sdk/call',
      headers: { 'x-api-key': devKeyLinked },
      payload: { keyId: slotBId, path: '/v1/models', method: 'GET' },
    });
    assert.notEqual(
      callRes.statusCode,
      403,
      `After clearing restriction key should reach slotB. Got 403: ${callRes.body}`,
    );
  });
});
