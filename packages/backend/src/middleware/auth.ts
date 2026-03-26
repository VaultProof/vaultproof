/**
 * Supabase Auth middleware for Fastify.
 *
 * Verifies Bearer tokens via supabase.auth.getUser() and attaches
 * the authenticated user to request.auth.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { createClient } from '@supabase/supabase-js';
import { prisma } from '../lib/prisma.js';
import { sendWelcomeEmail } from '../services/email.js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

export interface AuthPayload {
  userId: string;
  email: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthPayload;
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Missing or invalid Authorization header' });
  }

  const token = header.slice(7);

  // SECURITY: Test-only auth bypass. This block is gated on NODE_ENV === 'test'
  // (exact match — undefined or empty string won't pass). The token must also
  // start with 'test-token-' and resolve to an existing user in the database.
  // Never set NODE_ENV=test in production.
  if (process.env.NODE_ENV === 'test') {
    if (token.startsWith('test-token-')) {
      const userId = token.replace('test-token-', '');
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (user) {
        request.auth = { userId: user.id, email: user.email };
        return;
      }
    }
  }

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return reply.status(401).send({ error: 'Invalid or expired token' });
  }

  const email = (user.email || '').toLowerCase().trim();

  // Auto-create in our DB on first login (for OAuth users)
  // Use upsert to avoid race condition when two concurrent requests
  // both see findUnique return null and try to create the same user.
  const isNew = !(await prisma.user.findUnique({ where: { email } }));
  const dbUser = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { id: user.id, email, passwordHash: 'oauth' },
  });
  if (isNew) sendWelcomeEmail(email);

  request.auth = { userId: dbUser.id, email: dbUser.email };
}

/** @deprecated Kept for test compatibility only. Supabase handles real tokens. */
export function generateToken(userId: string, _email: string): string {
  return 'test-token-' + userId;
}
