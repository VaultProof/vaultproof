/**
 * Per-key-slot rate limiting based on pricing tier.
 *
 * Tracks API calls per key slot per calendar month.
 * Enforces limits: Free=1K, Starter=10K, Pro=100K, Team=500K, Enterprise=unlimited.
 */

import { prisma } from '../lib/prisma.js';

export interface TierLimits {
  maxCallsPerMonth: number;
  maxKeySlots: number;
  maxAppGrantsPerKey: number;
}

const TIERS: Record<string, TierLimits> = {
  free: { maxCallsPerMonth: 1000, maxKeySlots: 3, maxAppGrantsPerKey: 1 },
  starter: { maxCallsPerMonth: 10000, maxKeySlots: 10, maxAppGrantsPerKey: 5 },
  pro: { maxCallsPerMonth: 100000, maxKeySlots: 30, maxAppGrantsPerKey: 20 },
  team: { maxCallsPerMonth: 500000, maxKeySlots: 100, maxAppGrantsPerKey: 100 },
  enterprise: { maxCallsPerMonth: Infinity, maxKeySlots: Infinity, maxAppGrantsPerKey: Infinity },
};

/**
 * Check if a key slot has exceeded its monthly call limit.
 * Returns the current usage and whether the limit is exceeded.
 */
export async function checkRateLimit(
  keySlotId: string,
  tier: string = 'free'
): Promise<{ allowed: boolean; used: number; limit: number; remaining: number }> {
  const limits = TIERS[tier] || TIERS.free;

  if (limits.maxCallsPerMonth === Infinity) {
    return { allowed: true, used: 0, limit: Infinity, remaining: Infinity };
  }

  // Count calls this calendar month
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const used = await prisma.accessLog.count({
    where: {
      keySlotId,
      action: 'api_call',
      timestamp: { gte: monthStart },
    },
  });

  const remaining = Math.max(0, limits.maxCallsPerMonth - used);

  return {
    allowed: used < limits.maxCallsPerMonth,
    used,
    limit: limits.maxCallsPerMonth,
    remaining,
  };
}

/**
 * Check if a user can create more key slots.
 */
export async function checkKeySlotLimit(
  userId: string,
  tier: string = 'free'
): Promise<{ allowed: boolean; used: number; limit: number }> {
  const limits = TIERS[tier] || TIERS.free;

  const used = await prisma.keySlot.count({
    where: { userId, status: 'ACTIVE' },
  });

  return {
    allowed: used < limits.maxKeySlots,
    used,
    limit: limits.maxKeySlots,
  };
}
