/**
 * Supabase Auth middleware for Fastify.
 *
 * Verifies Bearer tokens via supabase.auth.getUser() and attaches
 * the authenticated user to request.auth.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { createClient } from '@supabase/supabase-js';
import { PrismaClient } from '@prisma/client';
import { sendWelcomeEmail } from '../services/email.js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || ''
);

const prisma = new PrismaClient();

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

  // In test mode, accept test tokens
  if (process.env.NODE_ENV === 'test' && token.startsWith('test-token-')) {
    const userId = token.replace('test-token-', '');
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user) {
      request.auth = { userId: user.id, email: user.email };
      return;
    }
  }

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return reply.status(401).send({ error: 'Invalid or expired token' });
  }

  const email = (user.email || '').toLowerCase().trim();

  // Auto-create in our DB on first login (for OAuth users)
  let dbUser = await prisma.user.findUnique({ where: { email } });
  if (!dbUser) {
    dbUser = await prisma.user.create({
      data: { id: user.id, email, passwordHash: 'oauth' },
    });
    sendWelcomeEmail(email);
  }

  request.auth = { userId: dbUser.id, email: dbUser.email };
}

/** @deprecated Kept for test compatibility only. Supabase handles real tokens. */
export function generateToken(userId: string, _email: string): string {
  return 'test-token-' + userId;
}
