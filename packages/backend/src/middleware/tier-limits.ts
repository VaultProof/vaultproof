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
  pro: { maxCallsPerMonth: 500000, maxKeySlots: 50, maxAppGrantsPerKey: 20 },
  // Legacy "max" tier maps to pro limits as a fallback
  max: { maxCallsPerMonth: 500000, maxKeySlots: 100, maxAppGrantsPerKey: 20 },
};

// Track which warnings have been sent this month (prevent spam)
// Key format: `${keySlotId}:${threshold}` e.g. "abc123:90" or "abc123:100"
const warnedThresholds: Map<string, number> = new Map();

// Clean up monthly
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of warnedThresholds) {
    if (now - ts > 30 * 24 * 60 * 60_000) warnedThresholds.delete(key);
  }
}, 60 * 60_000);

const CALL_ACTIONS = ['api_call', 'transparent_proxy', 'key_retrieval', 'key_retrieval_batch'];

// 5% hidden buffer — users see "limit reached" at 100% but calls continue until 105%
const BUFFER_PERCENT = 1.05;

/**
 * Check if a key slot has exceeded its monthly call limit.
 *
 * Advertised limit: the number shown to users (e.g. 10,000)
 * Hard limit: advertised + 5% buffer (e.g. 10,500) — silent grace period
 *
 * Notifications:
 * - 90%: email warning "approaching your limit"
 * - 100%: email "limit reached, upgrade to continue"
 * - 105%: hard block
 */
export async function checkRateLimit(
  keySlotId: string,
  tier: string = 'free',
  alertEmail?: string | null
): Promise<{ allowed: boolean; used: number; limit: number; remaining: number; nearLimit: boolean }> {
  const limits = TIERS[tier] || TIERS.free;
  const advertisedLimit = limits.maxCallsPerMonth;
  const hardLimit = Math.floor(advertisedLimit * BUFFER_PERCENT);

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

  const remaining = Math.max(0, advertisedLimit - used);
  const nearLimit = used >= advertisedLimit * 0.9;
  const atLimit = used >= advertisedLimit;
  const overBuffer = used >= hardLimit;

  // Send 90% warning (once per key per month)
  if (nearLimit && !atLimit && alertEmail) {
    const key90 = `${keySlotId}:90`;
    if (!warnedThresholds.has(key90)) {
      warnedThresholds.set(key90, Date.now());
      import('../services/email.js').then(({ sendUsageAlert }) => {
        sendUsageAlert(alertEmail, `Key ${keySlotId.slice(0, 8)}...`, used, advertisedLimit);
      }).catch(() => {});
    }
  }

  // Send 100% notification (once per key per month)
  if (atLimit && alertEmail) {
    const key100 = `${keySlotId}:100`;
    if (!warnedThresholds.has(key100)) {
      warnedThresholds.set(key100, Date.now());
      import('../services/email.js').then(({ sendUsageAlert }) => {
        sendUsageAlert(alertEmail, `Key ${keySlotId.slice(0, 8)}...`, used, advertisedLimit);
      }).catch(() => {});
    }
  }

  return {
    // Block at hard limit (105%), not at advertised limit (100%)
    allowed: !overBuffer,
    // Show advertised limit to the user, not the hard limit
    used,
    limit: advertisedLimit,
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
