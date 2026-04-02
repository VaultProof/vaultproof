import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

export async function waitlistRoutes(fastify: FastifyInstance) {
  fastify.post('/api/waitlist', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const schema = z.object({ email: z.string().email().max(254) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Valid email required' });
    }
    const email = parsed.data.email.toLowerCase().trim();

    const { error } = await supabase
      .from('waitlist')
      .insert({ email });

    if (error) {
      // Unique violation — already signed up
      if (error.code === '23505') {
        return reply.send({ ok: true, existing: true });
      }
      return reply.status(500).send({ error: 'Something went wrong' });
    }

    return reply.send({ ok: true });
  });
}
