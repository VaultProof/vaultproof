import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

// In-memory rate limiter for /refresh — 5 attempts per IP per minute
const refreshRateLimit = new Map<string, { count: number; resetAt: number }>();

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of refreshRateLimit) {
    if (now > record.resetAt) refreshRateLimit.delete(ip);
  }
}, 5 * 60_000);

function checkRefreshRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = refreshRateLimit.get(ip);
  if (!record || now > record.resetAt) {
    refreshRateLimit.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (record.count >= 5) return false;
  record.count++;
  return true;
}

export async function authRoutes(app: FastifyInstance) {
  // Refresh a Supabase access token using a refresh token
  // Used by the CLI when the JWT is near expiry
  app.post('/refresh', async (request, reply) => {
    // Use request.ip (respects Fastify trustProxy), NOT x-forwarded-for (spoofable)
    const clientIp = request.ip;
    if (!checkRefreshRateLimit(clientIp)) {
      return reply.status(429).send({ error: 'Too many refresh attempts. Try again in a minute.' });
    }

    const schema = z.object({ refreshToken: z.string().min(1).max(2048) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Missing refreshToken' });

    const { data, error } = await supabase.auth.refreshSession({ refresh_token: parsed.data.refreshToken });
    if (error || !data.session) {
      return reply.status(401).send({ error: 'Invalid or expired refresh token' });
    }

    return {
      token: data.session.access_token,
      refreshToken: data.session.refresh_token,
    };
  });

  // Get current user
  app.get('/me', { preHandler: requireAuth }, async (request) => {
    const user = await prisma.user.findUnique({
      where: { id: request.auth!.userId },
      select: { id: true, email: true, createdAt: true, tier: true, killSwitch: true, globalDailyLimit: true, globalMonthlyLimit: true, promoCode: true, tierExpiresAt: true },
    });
    if (!user) return { error: 'User not found' };
    return { user };
  });

  // POST /kill-switch — toggle kill switch
  app.post('/kill-switch', { preHandler: requireAuth }, async (request, reply) => {
    const schema = z.object({ enabled: z.boolean() });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid input' });

    await prisma.user.update({
      where: { id: request.auth!.userId },
      data: { killSwitch: parsed.data.enabled },
    });

    return { killSwitch: parsed.data.enabled };
  });

  // PUT /global-limits — set global daily/monthly limits
  app.put('/global-limits', { preHandler: requireAuth }, async (request, reply) => {
    const schema = z.object({
      globalDailyLimit: z.number().int().min(1).nullable().optional(),
      globalMonthlyLimit: z.number().int().min(1).nullable().optional(),
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid input' });

    const updated = await prisma.user.update({
      where: { id: request.auth!.userId },
      data: {
        globalDailyLimit: parsed.data.globalDailyLimit,
        globalMonthlyLimit: parsed.data.globalMonthlyLimit,
      },
    });

    return { globalDailyLimit: updated.globalDailyLimit, globalMonthlyLimit: updated.globalMonthlyLimit };
  });

  // Delete account
  app.delete('/account', { preHandler: requireAuth }, async (request) => {
    const userId = request.auth!.userId;
    const keySlots = await prisma.keySlot.findMany({ where: { userId }, select: { id: true } });
    const keySlotIds = keySlots.map((k) => k.id);

    if (keySlotIds.length > 0) {
      await prisma.accessLog.deleteMany({ where: { keySlotId: { in: keySlotIds } } });
      await prisma.appGrant.deleteMany({ where: { keySlotId: { in: keySlotIds } } });
      await prisma.keySlot.deleteMany({ where: { userId } });
    }
    await prisma.developerKey.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });

    return { status: 'account_deleted' };
  });
}
