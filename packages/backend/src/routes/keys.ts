import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';
import { encrypt } from '../crypto/encryption.js';
import { requireAuth } from '../middleware/auth.js';
import { checkKeySlotLimit } from '../middleware/tier-limits.js';
import { randomBytes } from 'crypto';

// --- Zod schemas ---

const storeKeySchema = z.object({
  provider: z.string().min(1).max(50),
  label: z.string().max(100).optional(),
  share1: z.string().min(1).max(2048),
  vaultCommitment: z.string().min(1).max(2048),
  authAppsRoot: z.string().max(2048).optional(),
  appId: z.string().min(1).max(100).optional(),
  appName: z.string().max(100).optional(),
  expiresAt: z.string().datetime().optional(),
});

const grantAppSchema = z.object({
  appId: z.string().min(1).max(100),
  appName: z.string().max(100).optional(),
});

function escapeCSV(value: string): string {
  if (typeof value !== 'string') return '';
  const escaped = value.replace(/"/g, '""').replace(/[\r\n]/g, ' ');
  if (/^[=+\-@\t\r]/.test(escaped)) return `"'${escaped}"`;
  return `"${escaped}"`;
}

export async function keyRoutes(app: FastifyInstance) {
  // Store a new key (receives Share 1 from the widget after client-side split)
  app.post('/store', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = storeKeySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.issues });
    }

    const { provider, label, share1, vaultCommitment, authAppsRoot, appId, appName, expiresAt } = parsed.data;
    const userId = request.auth!.userId;

    // Check tier key slot limit (skip in test environment)
    if (process.env.NODE_ENV !== 'test') {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { tier: true } });
      const tier = (user?.tier as string) || 'free';
      const slotCheck = await checkKeySlotLimit(userId, tier);
      if (!slotCheck.allowed) {
        return reply.status(429).send({
          error: 'Key slot limit reached',
          used: slotCheck.used,
          limit: slotCheck.limit,
          upgrade: 'https://vaultproof.dev#pricing',
        });
      }
    }

    const keySlot = await prisma.keySlot.create({
      data: {
        userId,
        provider,
        label: label || `${provider} key`,
        share1Encrypted: new Uint8Array(encrypt(Buffer.from(share1, 'utf-8'))),
        vaultCommitment,
        authAppsRoot: authAppsRoot || '',
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      },
    });

    let grant = null;
    if (appId) {
      grant = await prisma.appGrant.create({
        data: {
          keySlotId: keySlot.id,
          appId,
          appName: appName || 'Unknown App',
        },
      });
    }

    return { keySlotId: keySlot.id, grantId: grant?.id, status: 'stored' };
  });

  // List user's key slots (auth: only your own)
  app.get('/list', { preHandler: requireAuth }, async (request) => {
    const userId = request.auth!.userId;

    const keySlots = await prisma.keySlot.findMany({
      where: { userId, status: 'ACTIVE' },
      select: {
        id: true,
        provider: true,
        label: true,
        status: true,
        createdAt: true,
        expiresAt: true,
        dailyLimit: true,
        monthlyLimit: true,
        blockOnLimit: true,
        appGrants: {
          where: { revokedAt: null },
          select: { id: true, appId: true, appName: true, grantedAt: true },
        },
      },
    });

    return { keySlots };
  });

  // Revoke a key slot (auth: must own it)
  app.post('/revoke/:keySlotId', { preHandler: requireAuth }, async (request, reply) => {
    const { keySlotId } = request.params as { keySlotId: string };
    const userId = request.auth!.userId;

    const slot = await prisma.keySlot.findUnique({ where: { id: keySlotId } });
    if (!slot) return reply.status(404).send({ error: 'Key slot not found' });
    if (slot.userId !== userId) return reply.status(403).send({ error: 'Not your key slot' });

    await prisma.keySlot.update({
      where: { id: keySlotId },
      data: {
        status: 'REVOKED',
        share1Encrypted: Buffer.alloc(0),
      },
    });

    await prisma.appGrant.updateMany({
      where: { keySlotId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return { status: 'revoked' };
  });

  // Grant an app access to a key slot (auth: must own it)
  app.post('/:keySlotId/grant', { preHandler: requireAuth }, async (request, reply) => {
    const { keySlotId } = request.params as { keySlotId: string };
    const userId = request.auth!.userId;

    const parsed = grantAppSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.issues });
    }

    const slot = await prisma.keySlot.findUnique({ where: { id: keySlotId } });
    if (!slot || slot.status !== 'ACTIVE') {
      return reply.status(404).send({ error: 'Key slot not found or inactive' });
    }
    if (slot.userId !== userId) return reply.status(403).send({ error: 'Not your key slot' });

    const grant = await prisma.appGrant.create({
      data: {
        keySlotId,
        appId: parsed.data.appId,
        appName: parsed.data.appName || 'Unknown App',
        permissions: '{}',
      },
    });

    return { grantId: grant.id, status: 'granted' };
  });

  // Revoke app access (auth: must own the key slot)
  app.post('/:keySlotId/revoke-app/:appId', { preHandler: requireAuth }, async (request, reply) => {
    const { keySlotId, appId } = request.params as { keySlotId: string; appId: string };
    const userId = request.auth!.userId;

    const slot = await prisma.keySlot.findUnique({ where: { id: keySlotId } });
    if (!slot) return reply.status(404).send({ error: 'Key slot not found' });
    if (slot.userId !== userId) return reply.status(403).send({ error: 'Not your key slot' });

    await prisma.appGrant.updateMany({
      where: { keySlotId, appId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return { status: 'app_revoked' };
  });

  // Get usage logs (auth: must own the key slot)
  app.get('/:keySlotId/logs', { preHandler: requireAuth }, async (request, reply) => {
    const { keySlotId } = request.params as { keySlotId: string };
    const userId = request.auth!.userId;

    const slot = await prisma.keySlot.findUnique({ where: { id: keySlotId } });
    if (!slot) return reply.status(404).send({ error: 'Key slot not found' });
    if (slot.userId !== userId) return reply.status(403).send({ error: 'Not your key slot' });

    const logs = await prisma.accessLog.findMany({
      where: { keySlotId },
      orderBy: { timestamp: 'desc' },
      take: 100,
      select: {
        id: true,
        appId: true,
        action: true,
        nullifier: true,
        timestamp: true,
        metadata: true,
      },
    });

    return { logs };
  });

  // Rotate key (auth: must own it)
  app.post('/:keySlotId/rotate', { preHandler: requireAuth }, async (request, reply) => {
    const { keySlotId } = request.params as { keySlotId: string };
    const userId = request.auth!.userId;

    const rotateSchema = z.object({
      share1: z.string().min(1).max(2048),
      vaultCommitment: z.string().min(1).max(2048),
      authAppsRoot: z.string().max(2048).optional(),
    });

    const parsed = rotateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input' });
    }

    const slot = await prisma.keySlot.findUnique({ where: { id: keySlotId } });
    if (!slot) return reply.status(404).send({ error: 'Key slot not found' });
    if (slot.userId !== userId) return reply.status(403).send({ error: 'Not your key slot' });
    if (slot.status !== 'ACTIVE') return reply.status(400).send({ error: 'Key slot not active' });

    await prisma.keySlot.update({
      where: { id: keySlotId },
      data: {
        share1Encrypted: new Uint8Array(encrypt(Buffer.from(parsed.data.share1, 'utf-8'))),
        vaultCommitment: parsed.data.vaultCommitment,
        authAppsRoot: parsed.data.authAppsRoot || slot.authAppsRoot,
        rotatedAt: new Date(),
      },
    });

    // Log rotation event
    await prisma.accessLog.create({
      data: {
        keySlotId,
        appId: 'system',
        action: 'key_rotation',
        zkProof: 'rotation',
        nullifier: `rotation-${keySlotId}-${randomBytes(16).toString('hex')}`,
        metadata: JSON.stringify({ rotatedAt: new Date().toISOString() }),
      },
    });

    return { status: 'rotated' };
  });

  // Update per-key call limits (auth: must own it)
  app.put('/:keySlotId/limits', { preHandler: requireAuth }, async (request, reply) => {
    const { keySlotId } = request.params as { keySlotId: string };
    const userId = request.auth!.userId;

    const limitsSchema = z.object({
      dailyLimit: z.number().int().min(1).nullable().optional(),
      monthlyLimit: z.number().int().min(1).nullable().optional(),
      blockOnLimit: z.boolean().optional(),
    });

    const parsed = limitsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.issues });
    }

    const slot = await prisma.keySlot.findUnique({ where: { id: keySlotId } });
    if (!slot) return reply.status(404).send({ error: 'Key slot not found' });
    if (slot.userId !== userId) return reply.status(403).send({ error: 'Not your key slot' });
    if (slot.status !== 'ACTIVE') return reply.status(400).send({ error: 'Key slot not active' });

    const updateData: Record<string, unknown> = {};
    if (parsed.data.dailyLimit !== undefined) updateData.dailyLimit = parsed.data.dailyLimit;
    if (parsed.data.monthlyLimit !== undefined) updateData.monthlyLimit = parsed.data.monthlyLimit;
    if (parsed.data.blockOnLimit !== undefined) updateData.blockOnLimit = parsed.data.blockOnLimit;

    const updated = await prisma.keySlot.update({
      where: { id: keySlotId },
      data: updateData,
    });

    return {
      status: 'updated',
      dailyLimit: updated.dailyLimit,
      monthlyLimit: updated.monthlyLimit,
      blockOnLimit: updated.blockOnLimit,
    };
  });

  // Export logs as CSV (auth: must own the key slot)
  app.get('/:keySlotId/logs/export', { preHandler: requireAuth }, async (request, reply) => {
    const { keySlotId } = request.params as { keySlotId: string };
    const userId = request.auth!.userId;

    const slot = await prisma.keySlot.findUnique({ where: { id: keySlotId } });
    if (!slot) return reply.status(404).send({ error: 'Key slot not found' });
    if (slot.userId !== userId) return reply.status(403).send({ error: 'Not your key slot' });

    const logs = await prisma.accessLog.findMany({
      where: { keySlotId },
      orderBy: { timestamp: 'desc' },
      take: 10000,
    });

    const csv = 'timestamp,action,appId,nullifier,metadata\n' +
      logs.map((l) =>
        `${l.timestamp.toISOString()},${escapeCSV(l.action)},${escapeCSV(l.appId)},${escapeCSV(l.nullifier)},${escapeCSV(l.metadata || '')}`
      ).join('\n');

    reply
      .header('Content-Type', 'text/csv')
      .header('Content-Disposition', `attachment; filename="vaultproof-logs-${keySlotId}.csv"`)
      .send(csv);
  });
}
