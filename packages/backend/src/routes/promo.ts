import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

// --- Promo code config ---

const PROMO_CODES: Record<string, { tier: string; durationDays: number; maxRedemptions: number }> = {
  PRODUCTHUNT: { tier: 'pro', durationDays: 365, maxRedemptions: 200 },
};

export async function promoRoutes(app: FastifyInstance) {
  // POST /redeem — Redeem a promo code (requires auth)
  app.post('/redeem', { preHandler: [requireAuth] }, async (request, reply) => {
    const schema = z.object({ code: z.string().min(1).max(50).regex(/^[A-Z0-9_-]+$/i) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Missing or invalid code' });

    const code = parsed.data.code.toUpperCase().trim();
    const config = PROMO_CODES[code];
    if (!config) return reply.status(400).send({ error: 'Invalid promo code' });

    // Check if user already redeemed any promo code
    const user = await prisma.user.findUnique({ where: { id: request.auth!.userId } });
    if (!user) return reply.status(404).send({ error: 'User not found' });
    if (user.promoCode) return reply.status(409).send({ error: 'You have already redeemed a promo code' });

    const tierExpiresAt = new Date();
    tierExpiresAt.setDate(tierExpiresAt.getDate() + config.durationDays);

    // Atomic check-and-apply: re-check the cap inside a transaction so two concurrent
    // requests can't both slip through when the count is exactly at limit - 1.
    let updated: { tier: string; tierExpiresAt: Date | null };
    try {
      updated = await prisma.$transaction(async (tx) => {
        const redeemed = await tx.user.count({ where: { promoCode: code } });
        if (redeemed >= config.maxRedemptions) {
          throw Object.assign(new Error('limit_reached'), { code: 'LIMIT_REACHED' });
        }
        return tx.user.update({
          where: { id: user.id },
          data: { tier: config.tier, promoCode: code, tierExpiresAt },
        });
      });
    } catch (err: unknown) {
      if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'LIMIT_REACHED') {
        return reply.status(410).send({ error: 'This promo code has reached its redemption limit' });
      }
      throw err;
    }

    return {
      success: true,
      tier: updated.tier,
      tierExpiresAt: updated.tierExpiresAt,
    };
  });

  // GET /check/:code — Check if a promo code is valid (no auth)
  app.get('/check/:code', async (request, reply) => {
    const { code } = request.params as { code: string };
    if (!/^[A-Z0-9_-]{1,50}$/i.test(code)) return reply.status(400).send({ error: 'Invalid promo code format' });
    const normalized = code.toUpperCase().trim();
    const config = PROMO_CODES[normalized];
    if (!config) return reply.status(404).send({ error: 'Invalid promo code' });

    const redeemed = await prisma.user.count({ where: { promoCode: normalized } });
    const spotsLeft = Math.max(0, config.maxRedemptions - redeemed);

    return {
      valid: spotsLeft > 0,
      tier: config.tier,
      durationDays: config.durationDays,
      spotsLeft,
    };
  });

  // POST /feedback — Submit feedback (requires auth, promo users only)
  app.post('/feedback', { preHandler: [requireAuth] }, async (request, reply) => {
    const schema = z.object({ feedback: z.string().min(3).max(5000) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Feedback must be at least 3 characters' });

    const user = await prisma.user.findUnique({ where: { id: request.auth!.userId } });
    if (!user) return reply.status(404).send({ error: 'User not found' });
    if (!user.promoCode) return reply.status(403).send({ error: 'Feedback is only available for promo users' });

    await prisma.promoFeedback.create({
      data: {
        userId: user.id,
        feedback: parsed.data.feedback,
      },
    });

    return { success: true };
  });

  // GET /feedback/status — Check promo + feedback status (requires auth)
  app.get('/feedback/status', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.auth!.userId } });
    if (!user) return reply.status(404).send({ error: 'User not found' });

    // Check if user submitted feedback this week (Monday-Sunday)
    const now = new Date();
    const dayOfWeek = now.getUTCDay(); // 0=Sunday, 1=Monday, ...
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const weekStart = new Date(now);
    weekStart.setUTCDate(weekStart.getUTCDate() - mondayOffset);
    weekStart.setUTCHours(0, 0, 0, 0);

    const feedbackThisWeek = await prisma.promoFeedback.count({
      where: {
        userId: user.id,
        createdAt: { gte: weekStart },
      },
    });

    return {
      isPromo: !!user.promoCode,
      submittedThisWeek: feedbackThisWeek > 0,
      promoCode: user.promoCode,
      tierExpiresAt: user.tierExpiresAt,
    };
  });
}
