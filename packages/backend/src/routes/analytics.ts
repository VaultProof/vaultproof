import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';

export async function analyticsRoutes(app: FastifyInstance) {
  // Public endpoint - receives pageview events from pixel tracker
  // Rate limited separately
  app.post('/event', async (request, reply) => {
    const { type, page, referrer, sessionId } = request.body as {
      type: string; page?: string; referrer?: string; sessionId?: string;
    };

    // Only allow pageview from public endpoint
    if (type !== 'pageview') {
      return reply.status(400).send({ error: 'Invalid event type' });
    }

    // Basic validation
    if (!page || page.length > 500) {
      return reply.status(400).send({ error: 'Invalid page' });
    }

    await prisma.analyticsEvent.create({
      data: {
        type: 'pageview',
        page: page.slice(0, 500),
        referrer: referrer ? referrer.slice(0, 500) : null,
        sessionId: sessionId ? sessionId.slice(0, 100) : null,
      },
    });

    return { ok: true };
  });
}
