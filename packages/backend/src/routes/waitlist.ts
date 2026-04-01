import type { FastifyInstance } from 'fastify';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

export async function waitlistRoutes(fastify: FastifyInstance) {
  fastify.post('/api/waitlist', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { email } = request.body as { email?: string };

    if (!email || !email.includes('@')) {
      return reply.status(400).send({ error: 'Valid email required' });
    }

    const { error } = await supabase
      .from('waitlist')
      .insert({ email: email.toLowerCase().trim() });

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
