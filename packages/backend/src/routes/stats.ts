import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

export async function statsRoutes(app: FastifyInstance) {
  // Overview stats
  app.get('/overview', { preHandler: requireAuth }, async (request) => {
    const userId = request.auth!.userId;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const keySlots = await prisma.keySlot.findMany({
      where: { userId, status: 'ACTIVE' },
      select: { id: true },
    });

    const keySlotIds = keySlots.map((k) => k.id);

    // Total calls this month
    const totalCalls = keySlotIds.length > 0
      ? await prisma.accessLog.count({
          where: {
            keySlotId: { in: keySlotIds },
            action: { in: ['api_call', 'transparent_proxy', 'key_retrieval', 'key_retrieval_batch'] },
            timestamp: { gte: monthStart },
          },
        })
      : 0;

    // Error count this month
    const errorCalls = keySlotIds.length > 0
      ? await prisma.accessLog.count({
          where: {
            keySlotId: { in: keySlotIds },
            action: { in: ['api_call', 'transparent_proxy', 'key_retrieval', 'key_retrieval_batch'] },
            timestamp: { gte: monthStart },
            metadata: { contains: '"error":true' },
          },
        })
      : 0;

    // Active apps (unique appIds with non-revoked grants)
    const activeApps = keySlotIds.length > 0
      ? await prisma.appGrant.findMany({
          where: { keySlotId: { in: keySlotIds }, revokedAt: null },
          select: { appId: true },
          distinct: ['appId'],
        })
      : [];

    // Recent activity
    const recentLogs = keySlotIds.length > 0
      ? await prisma.accessLog.findMany({
          where: { keySlotId: { in: keySlotIds } },
          orderBy: { timestamp: 'desc' },
          take: 20,
          select: {
            id: true,
            appId: true,
            action: true,
            timestamp: true,
            metadata: true,
            keySlot: { select: { provider: true, label: true } },
          },
        })
      : [];

    return {
      totalKeys: keySlots.length,
      totalCalls,
      errorCalls,
      errorRate: totalCalls > 0 ? Math.round((errorCalls / totalCalls) * 100) : 0,
      activeApps: activeApps.length,
      recentActivity: recentLogs,
    };
  });

  // Usage per day (for chart)
  app.get('/usage', { preHandler: requireAuth }, async (request) => {
    const userId = request.auth!.userId;
    const { days } = request.query as { days?: string };
    const numDays = Math.max(1, Math.min(parseInt(days || '30', 10) || 30, 90));

    const keySlots = await prisma.keySlot.findMany({
      where: { userId },
      select: { id: true },
    });
    const keySlotIds = keySlots.map((k) => k.id);

    if (keySlotIds.length === 0) return { usage: [] };

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - numDays);

    const logs = await prisma.accessLog.findMany({
      where: {
        keySlotId: { in: keySlotIds },
        action: { in: ['api_call', 'transparent_proxy', 'key_retrieval', 'key_retrieval_batch'] },
        timestamp: { gte: startDate },
      },
      select: { timestamp: true, metadata: true },
      orderBy: { timestamp: 'asc' },
    });

    // Group by day
    const dailyMap: Record<string, { calls: number; errors: number }> = {};
    for (let i = 0; i < numDays; i++) {
      const d = new Date();
      d.setDate(d.getDate() - (numDays - 1 - i));
      const key = d.toISOString().split('T')[0];
      dailyMap[key] = { calls: 0, errors: 0 };
    }

    for (const log of logs) {
      const key = log.timestamp.toISOString().split('T')[0];
      if (dailyMap[key]) {
        dailyMap[key].calls++;
        if (log.metadata && typeof log.metadata === 'string' && log.metadata.includes('"error":true')) {
          dailyMap[key].errors++;
        }
      }
    }

    return {
      usage: Object.entries(dailyMap).map(([date, data]) => ({
        date,
        ...data,
      })),
    };
  });

  // Per-key breakdown
  app.get('/by-key', { preHandler: requireAuth }, async (request) => {
    const userId = request.auth!.userId;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const keySlots = await prisma.keySlot.findMany({
      where: { userId, status: 'ACTIVE' },
      select: {
        id: true,
        provider: true,
        label: true,
        createdAt: true,
        appGrants: {
          where: { revokedAt: null },
          select: { appId: true, appName: true },
        },
      },
    });

    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const breakdown = await Promise.all(
      keySlots.map(async (key) => {
        const totalCalls = await prisma.accessLog.count({
          where: { keySlotId: key.id, action: { in: ['api_call', 'transparent_proxy', 'key_retrieval', 'key_retrieval_batch'] }, timestamp: { gte: monthStart } },
        });

        const dailyCalls = await prisma.accessLog.count({
          where: { keySlotId: key.id, action: { in: ['api_call', 'transparent_proxy', 'key_retrieval', 'key_retrieval_batch'] }, timestamp: { gte: dayStart } },
        });

        const errorCalls = await prisma.accessLog.count({
          where: {
            keySlotId: key.id,
            action: { in: ['api_call', 'transparent_proxy', 'key_retrieval', 'key_retrieval_batch'] },
            timestamp: { gte: monthStart },
            metadata: { contains: '"error":true' },
          },
        });

        const lastLog = await prisma.accessLog.findFirst({
          where: { keySlotId: key.id, action: { in: ['api_call', 'transparent_proxy', 'key_retrieval', 'key_retrieval_batch'] } },
          orderBy: { timestamp: 'desc' },
          select: { timestamp: true },
        });

        return {
          id: key.id,
          provider: key.provider,
          label: key.label,
          createdAt: key.createdAt,
          apps: key.appGrants,
          callsThisMonth: totalCalls,
          dailyUsed: dailyCalls,
          monthlyUsed: totalCalls,
          errorsThisMonth: errorCalls,
          lastUsed: lastLog?.timestamp || null,
        };
      })
    );

    return { keys: breakdown };
  });
}
