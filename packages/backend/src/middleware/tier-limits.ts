/**
 * Per-key-slot rate limiting based on pricing tier.
 *
 * Tracks API calls per key slot per calendar month.
 * Enforces limits: Free=10K, Starter=50K, Pro=500K.
 */

import { prisma } from '../lib/prisma.js';

export interface TierLimits {
  maxCallsPerMonth: number;
  maxKeySlots: number;
  maxAppGrantsPerKey: number;
}

const TIERS: Record<string, TierLimits> = {
  free: { maxCallsPerMonth: 10000, maxKeySlots: 3, maxAppGrantsPerKey: 1 },
  starter: { maxCallsPerMonth: 50000, maxKeySlots: 10, maxAppGrantsPerKey: 5 },
  pro: { maxCallsPerMonth: 500000, maxKeySlots: 100, maxAppGrantsPerKey: 20 },
  // Legacy "max" tier maps to pro limits as a fallback
  max: { maxCallsPerMonth: 500000, maxKeySlots: 100, maxAppGrantsPerKey: 20 },
};

// Track which users already got a 90% warning this month (prevent spam)
const warned90: Map<string, number> = new Map();

// Clean up monthly
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of warned90) {
    if (now - ts > 30 * 24 * 60 * 60_000) warned90.delete(key);
  }
}, 60 * 60_000);

const CALL_ACTIONS = ['api_call', 'transparent_proxy', 'key_retrieval', 'key_retrieval_batch'];

/**
 * Check if a key slot has exceeded its monthly call limit.
 * Returns the current usage and whether the limit is exceeded.
 * Sends a 90% warning email if threshold crossed.
 */
export async function checkRateLimit(
  keySlotId: string,
  tier: string = 'free',
  alertEmail?: string | null
): Promise<{ allowed: boolean; used: number; limit: number; remaining: number; nearLimit: boolean }> {
  const limits = TIERS[tier] || TIERS.free;

  // Count all call types this calendar month
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const used = await prisma.accessLog.count({
    where: {
      keySlotId,
      action: { in: CALL_ACTIONS },
      timestamp: { gte: monthStart },
    },
  });

  const remaining = Math.max(0, limits.maxCallsPerMonth - used);
  const nearLimit = used >= limits.maxCallsPerMonth * 0.9;

  // Send 90% warning (once per user per month)
  if (nearLimit && alertEmail && !warned90.has(keySlotId)) {
    warned90.set(keySlotId, Date.now());
    // Import dynamically to avoid circular dependency
    import('../services/email.js').then(({ sendUsageAlert }) => {
      sendUsageAlert(alertEmail, `Key ${keySlotId.slice(0, 8)}...`, used, limits.maxCallsPerMonth);
    }).catch(() => {});
  }

  return {
    allowed: used < limits.maxCallsPerMonth,
    used,
    limit: limits.maxCallsPerMonth,
    remaining,
    nearLimit,
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
