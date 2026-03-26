import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/auth.js';

const prisma = new PrismaClient();

export async function authRoutes(app: FastifyInstance) {
  // Get current user
  app.get('/me', { preHandler: requireAuth }, async (request) => {
    const user = await prisma.user.findUnique({
      where: { id: request.auth!.userId },
      select: { id: true, email: true, createdAt: true, tier: true },
    });
    if (!user) return { error: 'User not found' };
    return { user };
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
