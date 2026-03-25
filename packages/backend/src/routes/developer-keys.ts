/**
 * Developer API Key Management
 *
 * Developers get a `vp_live_` prefixed key they put in their .env.
 * This key authenticates all SDK requests — no JWT needed.
 */

import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { randomBytes, createHash } from 'crypto';
import { requireAuth } from '../middleware/auth.js';

const prisma = new PrismaClient();

function generateApiKey(mode: string = 'live'): string {
  const prefix = mode === 'test' ? 'vp_test_' : 'vp_live_';
  const random = randomBytes(24).toString('base64url');
  return prefix + random;
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export async function developerKeyRoutes(app: FastifyInstance) {
  // Create a new developer API key
  app.post('/create', { preHandler: requireAuth }, async (request, reply) => {
    const schema = z.object({
      label: z.string().max(100).optional(),
      mode: z.enum(['live', 'test']).optional(),
      allowedIps: z.string().max(500).optional(),
      allowedProviders: z.string().max(200).optional(),
      allowedEndpoints: z.string().max(500).optional(),
      alertEmail: z.string().email().optional(),
      alertThreshold: z.number().int().min(1).optional(),
    });

    const parsed = schema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input' });
    }

    const userId = request.auth!.userId;
    const mode = parsed.data.mode || 'live';
    const key = generateApiKey(mode);
    const keyHash = hashKey(key);

    const devKey = await prisma.developerKey.create({
      data: {
        userId,
        key, // Stored full key — shown once at creation
        keyHash,
        label: parsed.data.label || 'Default',
        mode,
        allowedIps: parsed.data.allowedIps,
        allowedProviders: parsed.data.allowedProviders,
        allowedEndpoints: parsed.data.allowedEndpoints,
        alertEmail: parsed.data.alertEmail,
        alertThreshold: parsed.data.alertThreshold,
      },
    });

    // Return the full key ONCE — after this, only the hash is used for lookup
    return {
      id: devKey.id,
      key, // ⚠️ Show only once — save it now!
      label: devKey.label,
      mode: devKey.mode,
      createdAt: devKey.createdAt,
    };
  });

  // List developer keys (shows masked keys, not full)
  app.get('/list', { preHandler: requireAuth }, async (request) => {
    const userId = request.auth!.userId;

    const keys = await prisma.developerKey.findMany({
      where: { userId, revokedAt: null },
      select: {
        id: true,
        key: true,
        label: true,
        mode: true,
        lastUsed: true,
        createdAt: true,
      },
    });

    // Mask keys: show first 12 chars + last 4
    return {
      keys: keys.map((k) => ({
        ...k,
        key: k.key.slice(0, 12) + '...' + k.key.slice(-4),
      })),
    };
  });

  // Update security settings on a developer key
  app.put('/:keyId/settings', { preHandler: requireAuth }, async (request, reply) => {
    const { keyId } = request.params as { keyId: string };
    const userId = request.auth!.userId;

    const schema = z.object({
      allowedIps: z.string().max(500).optional(),
      allowedProviders: z.string().max(200).optional(),
      allowedEndpoints: z.string().max(500).optional(),
      alertEmail: z.string().email().optional(),
      alertThreshold: z.number().int().min(1).optional(),
    });

    const parsed = schema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.issues });
    }

    const key = await prisma.developerKey.findUnique({ where: { id: keyId } });
    if (!key || key.userId !== userId) {
      return reply.status(404).send({ error: 'Key not found' });
    }

    const updated = await prisma.developerKey.update({
      where: { id: keyId },
      data: {
        allowedIps: parsed.data.allowedIps ?? key.allowedIps,
        allowedProviders: parsed.data.allowedProviders ?? key.allowedProviders,
        allowedEndpoints: parsed.data.allowedEndpoints ?? key.allowedEndpoints,
        alertEmail: parsed.data.alertEmail ?? key.alertEmail,
        alertThreshold: parsed.data.alertThreshold ?? key.alertThreshold,
      },
    });

    return {
      id: updated.id,
      allowedIps: updated.allowedIps,
      allowedProviders: updated.allowedProviders,
      allowedEndpoints: updated.allowedEndpoints,
      alertEmail: updated.alertEmail,
      alertThreshold: updated.alertThreshold,
    };
  });

  // Revoke a developer key
  app.post('/:keyId/revoke', { preHandler: requireAuth }, async (request, reply) => {
    const { keyId } = request.params as { keyId: string };
    const userId = request.auth!.userId;

    const key = await prisma.developerKey.findUnique({ where: { id: keyId } });
    if (!key || key.userId !== userId) {
      return reply.status(404).send({ error: 'Key not found' });
    }

    await prisma.developerKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });

    return { status: 'revoked' };
  });
}

/**
 * Middleware: Authenticate requests using a developer API key.
 * Accepts `Authorization: Bearer vp_live_...` or `X-API-Key: vp_live_...`
 */
export async function authenticateDevKey(
  request: any,
  reply: any
): Promise<{ userId: string; keyId: string; rawKey: string; devKey: any } | null> {
  const authHeader = request.headers.authorization as string;
  const apiKeyHeader = request.headers['x-api-key'] as string;

  let rawKey: string | null = null;

  if (apiKeyHeader && apiKeyHeader.startsWith('vp_')) {
    rawKey = apiKeyHeader;
  } else if (authHeader && authHeader.startsWith('Bearer vp_')) {
    rawKey = authHeader.slice(7);
  }

  if (!rawKey) return null;

  const keyHash = hashKey(rawKey);
  const devKey = await prisma.developerKey.findUnique({
    where: { keyHash },
  });

  if (!devKey || devKey.revokedAt) return null;

  // Update last used
  await prisma.developerKey.update({
    where: { id: devKey.id },
    data: { lastUsed: new Date() },
  }).catch(() => {}); // Non-blocking

  return { userId: devKey.userId, keyId: devKey.id, rawKey, devKey };
}
