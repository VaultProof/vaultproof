/**
 * Shared PrismaClient singleton.
 *
 * Every file imports from here instead of creating new PrismaClient().
 * Prevents connection pool exhaustion under load.
 */

import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
