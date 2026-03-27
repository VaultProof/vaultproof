/**
 * Developer API Key Management
 *
 * Developers get a `vp_live_` prefixed key they put in their .env.
 * This key authenticates all SDK requests — no JWT needed.
 */

import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';
import { randomBytes, createHash } from 'crypto';
import { requireAuth } from '../middleware/auth.js';
import { isIP } from 'net';

/** Validate webhook URL is a public HTTPS URL (blocks SSRF via private IPs, IPv6, decimal notation) */
function isPublicUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();

    // Must be HTTPS in production
    if (u.protocol !== 'https:' && process.env.NODE_ENV !== 'test') return false;

    // Block localhost variants
    if (h === 'localhost' || h === '[::1]' || h === '::1') return false;

    // Block IPv4 private/reserved ranges (including decimal/octal notation)
    if (isIP(h) === 4 || /^\d+$/.test(h)) {
      // Parse decimal notation (e.g. 2130706433 = 127.0.0.1)
      let ip = h;
      if (/^\d+$/.test(h)) {
        const num = parseInt(h, 10);
        if (num >= 0 && num <= 0xFFFFFFFF) {
          ip = `${(num >>> 24) & 0xFF}.${(num >>> 16) & 0xFF}.${(num >>> 8) & 0xFF}.${num & 0xFF}`;
        }
      }
      if (/^(127\.|0\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[0-2]\d))/.test(ip)) return false;
    }

    // Block IPv6 private/reserved
    if (h.startsWith('[') || isIP(h) === 6) {
      const v6 = h.replace(/^\[|\]$/g, '');
      if (/^(::1|fe80:|fc00:|fd00:|::ffff:(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.))/.test(v6.toLowerCase())) return false;
    }

    // Block URL credentials (user:pass@host)
    if (u.username || u.password) return false;

    return true;
  } catch { return false; }
}

const webhookUrlSchema = z.string().url().refine(isPublicUrl, { message: 'Must be a public HTTPS URL' }).optional();

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
      webhookUrl: webhookUrlSchema,
      webhookSecret: z.string().min(16).max(256).optional(),
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
        webhookUrl: parsed.data.webhookUrl,
        webhookSecret: parsed.data.webhookSecret,
      },
    });

    // Key is shown ONCE at creation. Never returned again (list endpoint returns masked version).
    const response = {
      id: devKey.id,
      key, // ⚠️ Show only once — save it now!
      label: devKey.label,
      mode: devKey.mode,
      createdAt: devKey.createdAt,
    };

    // Mask the stored key — full key was returned to user above, never needed again
    await prisma.developerKey.update({
      where: { id: devKey.id },
      data: { key: key.slice(0, 12) + '...' + key.slice(-4) },
    });

    return response;
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
        webhookUrl: true,
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
      webhookUrl: webhookUrlSchema,
      webhookSecret: z.string().min(16).max(256).optional(),
    });

    const parsed = schema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.issues });
    }

    const key = await prisma.developerKey.findUnique({ where: { id: keyId } });
    if (!key || key.userId !== userId) {
      return reply.status(404).send({ error: 'Key not found' });
    }

    // IP allowlist and usage alerts require Pro tier or higher
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { tier: true } });
    const tier = user?.tier || 'free';
    const proTiers = ['pro', 'max'];
    if (!proTiers.includes(tier)) {
      if (parsed.data.allowedIps || parsed.data.alertEmail || parsed.data.alertThreshold) {
        return reply.status(403).send({ error: 'IP allowlist and usage alerts require Pro plan or higher', upgrade: 'https://vaultproof.dev#pricing' });
      }
    }

    const updated = await prisma.developerKey.update({
      where: { id: keyId },
      data: {
        allowedIps: parsed.data.allowedIps ?? key.allowedIps,
        allowedProviders: parsed.data.allowedProviders ?? key.allowedProviders,
        allowedEndpoints: parsed.data.allowedEndpoints ?? key.allowedEndpoints,
        alertEmail: parsed.data.alertEmail ?? key.alertEmail,
        alertThreshold: parsed.data.alertThreshold ?? key.alertThreshold,
        webhookUrl: parsed.data.webhookUrl ?? key.webhookUrl,
        webhookSecret: parsed.data.webhookSecret ?? key.webhookSecret,
      },
    });

    return {
      id: updated.id,
      allowedIps: updated.allowedIps,
      allowedProviders: updated.allowedProviders,
      allowedEndpoints: updated.allowedEndpoints,
      alertEmail: updated.alertEmail,
      alertThreshold: updated.alertThreshold,
      webhookUrl: updated.webhookUrl,
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

    await prisma.$transaction([
      prisma.sessionToken.deleteMany({ where: { developerKeyId: keyId } }),
      prisma.developerKey.update({ where: { id: keyId }, data: { revokedAt: new Date() } }),
    ]);

    return { status: 'revoked' };
  });

  // Create a session token (requires Supabase JWT + vp_live_ key)
  // Token lives in CLI memory only — never written to disk
  app.post('/:keyId/session', { preHandler: requireAuth }, async (request, reply) => {
    const { keyId } = request.params as { keyId: string };
    const userId = request.auth!.userId;

    const key = await prisma.developerKey.findUnique({ where: { id: keyId } });
    if (!key || key.userId !== userId) return reply.status(404).send({ error: 'Key not found' });
    if (key.revokedAt) return reply.status(403).send({ error: 'Key is revoked' });

    // Generate a random 32-byte session token
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    await prisma.sessionToken.create({
      data: { developerKeyId: keyId, tokenHash, expiresAt },
    });

    // Cleanup expired tokens for this key (non-blocking)
    prisma.sessionToken.deleteMany({
      where: { developerKeyId: keyId, expiresAt: { lt: new Date() } },
    }).catch(() => {});

    return { token: rawToken, expiresAt: expiresAt.toISOString() };
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

  // Validate session token if present (opportunistic)
  // Interactive CLI always sends one; CI/scripts don't — both are valid
  const sessionHeader = request.headers['x-vaultproof-session'] as string;
  if (sessionHeader) {
    const sessionHash = createHash('sha256').update(sessionHeader).digest('hex');
    const session = await prisma.sessionToken.findUnique({ where: { tokenHash: sessionHash } });

    if (!session || session.developerKeyId !== devKey.id || session.expiresAt < new Date()) {
      return null; // Invalid/expired session token → reject
    }
  }

  // Update last used
  await prisma.developerKey.update({
    where: { id: devKey.id },
    data: { lastUsed: new Date() },
  }).catch(() => {}); // Non-blocking

  return { userId: devKey.userId, keyId: devKey.id, rawKey, devKey };
}
