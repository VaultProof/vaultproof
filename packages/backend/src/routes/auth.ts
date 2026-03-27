import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { z } from 'zod';

export async function authRoutes(app: FastifyInstance) {
  // Get current user
  app.get('/me', { preHandler: requireAuth }, async (request) => {
    const user = await prisma.user.findUnique({
      where: { id: request.auth!.userId },
      select: { id: true, email: true, createdAt: true, tier: true, killSwitch: true, globalDailyLimit: true, globalMonthlyLimit: true },
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
