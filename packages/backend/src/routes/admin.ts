import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { createClient } from '@supabase/supabase-js';

/**
 * Hidden admin routes — owner-only.
 *
 * Authenticates via Supabase Bearer token and checks the email
 * against ADMIN_EMAILS (comma-separated) env var.
 */

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'yee.nelsonk@gmail.com')
  .split(',').map(e => e.trim().toLowerCase());

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Missing authorization' });
  }

  const token = header.slice(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user || !user.email) {
    return reply.status(401).send({ error: 'Invalid or expired token' });
  }

  if (!ADMIN_EMAILS.includes(user.email.toLowerCase())) {
    return reply.status(403).send({ error: 'Forbidden' });
  }
}

export async function adminRoutes(app: FastifyInstance) {
  // Auth guard on every route in this plugin
  app.addHook('onRequest', requireAdmin);

  // ─── List all users ───────────────────────────────────────────────
  app.get('/users', async (request) => {
    const { page, limit, search } = request.query as {
      page?: string;
      limit?: string;
      search?: string;
    };

    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const take = Math.min(200, Math.max(1, parseInt(limit || '50', 10) || 50));
    const skip = (pageNum - 1) * take;

    const where = search
      ? { email: { contains: search, mode: 'insensitive' as const } }
      : {};

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          tier: true,
          createdAt: true,
          killSwitch: true,
          _count: {
            select: {
              keySlots: true,
              developerKeys: true,
            },
          },
        },
      }),
      prisma.user.count({ where }),
    ]);

    // Get total calls per user via their key slots
    const enriched = await Promise.all(
      users.map(async (user) => {
        const keySlotIds = await prisma.keySlot.findMany({
          where: { userId: user.id },
          select: { id: true },
        });
        const ids = keySlotIds.map((k) => k.id);

        const totalCalls =
          ids.length > 0
            ? await prisma.accessLog.count({
                where: { keySlotId: { in: ids } },
              })
            : 0;

        return {
          id: user.id,
          email: user.email,
          tier: user.tier,
          createdAt: user.createdAt,
          killSwitch: user.killSwitch,
          keyCount: user._count.keySlots,
          devKeyCount: user._count.developerKeys,
          totalCalls,
        };
      })
    );

    return { users: enriched, total, page: pageNum, limit: take };
  });

  // ─── Single user detail ───────────────────────────────────────────
  app.get('/users/:userId', async (request, reply) => {
    const { userId } = request.params as { userId: string };

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        keySlots: {
          select: {
            id: true,
            provider: true,
            label: true,
            status: true,
            dailyLimit: true,
            monthlyLimit: true,
            createdAt: true,
            rotatedAt: true,
            expiresAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        developerKeys: {
          select: {
            id: true,
            label: true,
            mode: true,
            allowedIps: true,
            allowedProviders: true,
            allowedEndpoints: true,
            lastUsed: true,
            createdAt: true,
            revokedAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }

    const keySlotIds = user.keySlots.map((k) => k.id);

    const [totalCalls, recentLogs] = await Promise.all([
      keySlotIds.length > 0
        ? prisma.accessLog.count({ where: { keySlotId: { in: keySlotIds } } })
        : Promise.resolve(0),
      keySlotIds.length > 0
        ? prisma.accessLog.findMany({
            where: { keySlotId: { in: keySlotIds } },
            orderBy: { timestamp: 'desc' },
            take: 50,
            select: {
              id: true,
              appId: true,
              action: true,
              timestamp: true,
              metadata: true,
              keySlot: { select: { provider: true, label: true } },
            },
          })
        : Promise.resolve([]),
    ]);

    return {
      id: user.id,
      email: user.email,
      tier: user.tier,
      stripeCustomerId: user.stripeCustomerId,
      stripeSubscriptionId: user.stripeSubscriptionId,
      globalDailyLimit: user.globalDailyLimit,
      globalMonthlyLimit: user.globalMonthlyLimit,
      killSwitch: user.killSwitch,
      createdAt: user.createdAt,
      keySlots: user.keySlots,
      developerKeys: user.developerKeys,
      totalCalls,
      recentActivity: recentLogs,
    };
  });

  // ─── User access logs ─────────────────────────────────────────────
  app.get('/users/:userId/logs', async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const { page, limit } = request.query as { page?: string; limit?: string };

    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const take = Math.min(500, Math.max(1, parseInt(limit || '100', 10) || 100));
    const skip = (pageNum - 1) * take;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }

    const keySlots = await prisma.keySlot.findMany({
      where: { userId },
      select: { id: true },
    });
    const keySlotIds = keySlots.map((k) => k.id);

    if (keySlotIds.length === 0) {
      return { logs: [], total: 0, page: pageNum, limit: take };
    }

    const where = { keySlotId: { in: keySlotIds } };

    const [logs, total] = await Promise.all([
      prisma.accessLog.findMany({
        where,
        skip,
        take,
        orderBy: { timestamp: 'desc' },
        select: {
          id: true,
          appId: true,
          action: true,
          timestamp: true,
          metadata: true,
          keySlot: { select: { provider: true, label: true } },
        },
      }),
      prisma.accessLog.count({ where }),
    ]);

    return { logs, total, page: pageNum, limit: take };
  });

  // ─── Global access logs ───────────────────────────────────────────
  app.get('/logs', async (request) => {
    const { page, limit, action } = request.query as {
      page?: string;
      limit?: string;
      action?: string;
    };

    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const take = Math.min(500, Math.max(1, parseInt(limit || '100', 10) || 100));
    const skip = (pageNum - 1) * take;

    const where = action ? { action } : {};

    const [logs, total] = await Promise.all([
      prisma.accessLog.findMany({
        where,
        skip,
        take,
        orderBy: { timestamp: 'desc' },
        select: {
          id: true,
          appId: true,
          action: true,
          timestamp: true,
          metadata: true,
          keySlot: {
            select: {
              provider: true,
              label: true,
              userId: true,
              user: { select: { email: true } },
            },
          },
        },
      }),
      prisma.accessLog.count({ where }),
    ]);

    return { logs, total, page: pageNum, limit: take };
  });

  // ─── Global stats ─────────────────────────────────────────────────
  app.get('/stats', async () => {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      totalKeys,
      totalDevKeys,
      callsToday,
      callsThisMonth,
      totalCallsAllTime,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.keySlot.count({ where: { status: 'ACTIVE' } }),
      prisma.developerKey.count({ where: { revokedAt: null } }),
      prisma.accessLog.count({ where: { timestamp: { gte: todayStart } } }),
      prisma.accessLog.count({ where: { timestamp: { gte: monthStart } } }),
      prisma.accessLog.count(),
    ]);

    // Active users: users who have at least one access log in the last 7 days
    // We query via keySlots -> accessLogs
    const activeKeySlots = await prisma.accessLog.findMany({
      where: { timestamp: { gte: weekAgo } },
      select: { keySlot: { select: { userId: true } } },
      distinct: ['keySlotId'],
    });
    const activeUserIds = new Set(activeKeySlots.map((l) => l.keySlot.userId));

    // Tier breakdown
    const tierCounts = await prisma.user.groupBy({
      by: ['tier'],
      _count: { id: true },
    });
    const tiers: Record<string, number> = {};
    for (const t of tierCounts) {
      tiers[t.tier] = t._count.id;
    }

    return {
      totalUsers,
      totalKeys,
      totalDevKeys,
      callsToday,
      callsThisMonth,
      totalCallsAllTime,
      activeUsersLast7Days: activeUserIds.size,
      tiers,
    };
  });

  // ─── Ban user ─────────────────────────────────────────────────────
  app.post('/users/:userId/ban', async (request, reply) => {
    const { userId } = request.params as { userId: string };

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, tier: true },
    });

    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }

    if (user.tier === 'banned') {
      return { message: 'User is already banned', userId };
    }

    // Ban the user and revoke all developer keys in a transaction
    const now = new Date();
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { tier: 'banned', killSwitch: true },
      }),
      prisma.developerKey.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);

    return {
      message: 'User banned and all developer keys revoked',
      userId,
      email: user.email,
    };
  });
}
