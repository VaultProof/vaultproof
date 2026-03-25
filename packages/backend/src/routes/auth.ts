import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { generateToken, generateRefreshToken, requireAuth } from '../middleware/auth.js';
import { sendWelcomeEmail } from '../services/email.js';

const prisma = new PrismaClient();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(100),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function authRoutes(app: FastifyInstance) {
  // Register
  app.post('/register', async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.issues });
    }

    const email = parsed.data.email.toLowerCase().trim();
    const { password } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.status(409).send({ error: 'Email already registered' });
    }

    const refreshToken = generateRefreshToken();
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, passwordHash, refreshToken },
    });

    const token = generateToken(user.id, user.email);
    sendWelcomeEmail(user.email);

    return { token, refreshToken, user: { id: user.id, email: user.email } };
  });

  // Login
  app.post('/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input' });
    }

    const email = parsed.data.email.toLowerCase().trim();
    const { password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return reply.status(401).send({ error: 'Invalid email or password' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid email or password' });
    }

    const refreshToken = generateRefreshToken();
    await prisma.user.update({ where: { id: user.id }, data: { refreshToken } });

    const token = generateToken(user.id, user.email);

    return { token, refreshToken, user: { id: user.id, email: user.email } };
  });

  // Refresh token → new JWT
  app.post('/refresh', async (request, reply) => {
    const schema = z.object({ refreshToken: z.string().min(1) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input' });
    }

    const user = await prisma.user.findUnique({ where: { refreshToken: parsed.data.refreshToken } });
    if (!user) {
      return reply.status(401).send({ error: 'Invalid refresh token' });
    }

    const token = generateToken(user.id, user.email);
    return { token };
  });

  // Get current user
  app.get('/me', { preHandler: requireAuth }, async (request) => {
    const user = await prisma.user.findUnique({
      where: { id: request.auth!.userId },
      select: { id: true, email: true, createdAt: true },
    });
    if (!user) return { error: 'User not found' };
    return { user };
  });

  // Change password
  app.put('/password', { preHandler: requireAuth }, async (request, reply) => {
    const schema = z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8).max(100),
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input' });
    }

    const user = await prisma.user.findUnique({ where: { id: request.auth!.userId } });
    if (!user) return reply.status(404).send({ error: 'User not found' });

    const valid = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
    if (!valid) return reply.status(401).send({ error: 'Current password is incorrect' });

    const newHash = await bcrypt.hash(parsed.data.newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    });

    return { status: 'password_changed' };
  });

  // Delete account
  app.delete('/account', { preHandler: requireAuth }, async (request) => {
    const userId = request.auth!.userId;

    // Delete all data in order (foreign key constraints)
    const keySlots = await prisma.keySlot.findMany({ where: { userId }, select: { id: true } });
    const keySlotIds = keySlots.map((k) => k.id);

    if (keySlotIds.length > 0) {
      await prisma.accessLog.deleteMany({ where: { keySlotId: { in: keySlotIds } } });
      await prisma.appGrant.deleteMany({ where: { keySlotId: { in: keySlotIds } } });
      await prisma.keySlot.deleteMany({ where: { userId } });
    }

    await prisma.user.delete({ where: { id: userId } });

    return { status: 'account_deleted' };
  });
}
