/**
 * JWT authentication middleware for Fastify.
 *
 * Protects routes by verifying Bearer tokens in the Authorization header.
 * Extracts userId from the JWT payload and attaches it to the request.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'vaultproof-dev-secret-change-in-production';

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
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthPayload;
    if (!payload.userId) {
      return reply.status(401).send({ error: 'Invalid token payload' });
    }
    request.auth = payload;
  } catch {
    return reply.status(401).send({ error: 'Invalid or expired token' });
  }
}

/**
 * Generate a JWT token for a user (used in testing and auth endpoints).
 */
export function generateToken(userId: string, email: string): string {
  return jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '7d' });
}
