import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';

const eventSchema = z.object({
  type: z.enum(['pageview']),
  page: z.string().max(500).optional(),
  referrer: z.string().max(200).optional(),
  sessionId: z.string().max(100).optional(),
});

export async function analyticsRoutes(app: FastifyInstance) {
  // Public endpoint - receives pageview events from pixel tracker
  // Rate limited separately
  app.post('/event', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = eventSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid event data', details: parsed.error.issues });
    }

    const { type, page, referrer, sessionId } = parsed.data;

    await prisma.analyticsEvent.create({
      data: {
        type: 'pageview',
        page: page ?? null,
        referrer: referrer ?? null,
        sessionId: sessionId ?? null,
      },
    });

    return { ok: true };
  });
}
