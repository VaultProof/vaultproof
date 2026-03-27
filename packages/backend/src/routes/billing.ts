import type { FastifyInstance } from 'fastify';
import Stripe from 'stripe';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// --- Tier definitions ---

const TIERS = {
  starter: { name: 'VaultProof Starter', price: 900, annualPrice: 9000, interval: 'month' as const },
  pro: { name: 'VaultProof Pro', price: 2900, annualPrice: 29000, interval: 'month' as const },
  max: { name: 'VaultProof Max', price: 9900, annualPrice: 99000, interval: 'month' as const },
} as const;

type Tier = keyof typeof TIERS;

// Module-level cache for Stripe Price IDs (monthly and annual)
const priceIdCache = new Map<string, string>();

/**
 * Ensures Stripe products and prices exist for each tier (both monthly and annual).
 * Creates them if missing and caches the price IDs.
 */
async function ensurePrices(): Promise<Map<string, string>> {
  const expectedCount = Object.keys(TIERS).length * 2; // monthly + annual per tier
  if (priceIdCache.size === expectedCount) {
    return priceIdCache;
  }

  for (const [tier, config] of Object.entries(TIERS) as [Tier, (typeof TIERS)[Tier]][]) {
    // Search for existing product by metadata
    const products = await stripe.products.list({ limit: 100, active: true });
    const existing = products.data.find(
      (p) => p.metadata.vaultproof_tier === tier,
    );

    let productId: string;

    if (existing) {
      productId = existing.id;
    } else {
      const product = await stripe.products.create({
        name: config.name,
        metadata: { vaultproof_tier: tier },
      });
      productId = product.id;
    }

    // Look for active recurring prices on this product
    const prices = await stripe.prices.list({
      product: productId,
      active: true,
      limit: 100,
    });

    // --- Monthly price ---
    const existingMonthly = prices.data.find(
      (p) =>
        p.unit_amount === config.price &&
        p.recurring?.interval === 'month' &&
        p.currency === 'usd',
    );

    if (existingMonthly) {
      priceIdCache.set(tier, existingMonthly.id);
    } else {
      const monthlyPrice = await stripe.prices.create({
        product: productId,
        unit_amount: config.price,
        currency: 'usd',
        recurring: { interval: 'month' },
        metadata: { vaultproof_tier: tier, billing_period: 'monthly' },
      });
      priceIdCache.set(tier, monthlyPrice.id);
    }

    // --- Annual price (10 months = 2 months free) ---
    const existingAnnual = prices.data.find(
      (p) =>
        p.unit_amount === config.annualPrice &&
        p.recurring?.interval === 'year' &&
        p.currency === 'usd',
    );

    if (existingAnnual) {
      priceIdCache.set(`${tier}_annual`, existingAnnual.id);
    } else {
      const annualPrice = await stripe.prices.create({
        product: productId,
        unit_amount: config.annualPrice,
        currency: 'usd',
        recurring: { interval: 'year' },
        metadata: { vaultproof_tier: tier, billing_period: 'annual' },
      });
      priceIdCache.set(`${tier}_annual`, annualPrice.id);
    }
  }

  return priceIdCache;
}

// --- Routes ---

export async function billingRoutes(app: FastifyInstance) {
  // Register a content type parser that preserves the raw body for webhook verification.
  // This overrides the default JSON parser within this plugin scope.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body, done) => {
      (req as any).rawBody = body;
      try {
        done(null, JSON.parse((body as Buffer).toString()));
      } catch (e) {
        done(e as Error, undefined);
      }
    },
  );

  /**
   * POST /checkout
   * Creates a Stripe Checkout session for a subscription tier.
   * Accepts optional `annual: true` for yearly billing (2 months free).
   */
  app.post<{ Body: { tier: Tier; annual?: boolean } }>(
    '/checkout',
    { preHandler: requireAuth },
    async (request, reply) => {
      const checkoutSchema = z.object({
        tier: z.enum(['starter', 'pro', 'max']),
        annual: z.boolean().optional(),
      });

      const parsed = checkoutSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid input. tier must be starter, pro, or max.' });
      }

      const { tier, annual } = parsed.data;

      const userId = request.auth!.userId;
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      // Ensure Stripe prices are initialized
      const prices = await ensurePrices();
      const priceKey = annual ? `${tier}_annual` : tier;
      const priceId = prices.get(priceKey)!;

      // Create or retrieve Stripe customer
      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customers = await stripe.customers.list({
          email: user.email,
          limit: 1,
        });

        if (customers.data.length > 0) {
          customerId = customers.data[0].id;
        } else {
          const customer = await stripe.customers.create({
            email: user.email,
            metadata: { userId },
          });
          customerId = customer.id;
        }

        await prisma.user.update({
          where: { id: userId },
          data: { stripeCustomerId: customerId },
        });
      }

      // Create Checkout Session
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: 'https://vaultproof.dev/app/settings?billing=success',
        cancel_url: 'https://vaultproof.dev/app/settings?billing=cancel',
        metadata: { userId, tier, billingPeriod: annual ? 'annual' : 'monthly' },
      });

      return { url: session.url };
    },
  );

  /**
   * POST /webhook
   * Stripe webhook handler. No auth — Stripe signs the payload.
   */
  app.post('/webhook', async (request, reply) => {
    const rawBody = (request as any).rawBody as Buffer;
    const signature = request.headers['stripe-signature'] as string;

    if (!signature || !rawBody) {
      return reply.status(400).send({ error: 'Missing signature or body' });
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      return reply.status(500).send({ error: 'Webhook secret not configured' });
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err) {
      request.log.error(err, 'Webhook signature verification failed');
      return reply.status(400).send({ error: 'Invalid webhook signature' });
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        const tier = session.metadata?.tier;
        const subscriptionId =
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id;

        if (userId && tier) {
          // Idempotency: skip if tier already matches (duplicate webhook delivery)
          const existing = await prisma.user.findUnique({ where: { id: userId }, select: { tier: true, stripeSubscriptionId: true } });
          if (existing?.tier !== tier) {
            await prisma.user.update({
              where: { id: userId },
              data: { tier, stripeSubscriptionId: subscriptionId ?? null },
            });
          }
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        if (
          subscription.status === 'canceled' ||
          subscription.status === 'past_due'
        ) {
          await downgradeBySubscription(subscription.id);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await downgradeBySubscription(subscription.id);
        break;
      }
    }

    return { received: true };
  });

  /**
   * POST /portal
   * Creates a Stripe Billing Portal session so the user can manage their subscription.
   */
  app.post('/portal', { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.auth!.userId;
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user?.stripeCustomerId) {
      return reply.status(400).send({ error: 'No billing account found. Subscribe to a plan first.' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: 'https://vaultproof.dev/app/settings',
    });

    return { url: session.url };
  });

  /**
   * GET /status
   * Returns the current user's billing status.
   */
  app.get('/status', { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.auth!.userId;
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }

    return {
      tier: user.tier ?? 'free',
      stripeCustomerId: user.stripeCustomerId ?? null,
      hasSubscription: !!user.stripeSubscriptionId,
    };
  });

  /**
   * GET /usage
   * Returns current month usage and overage billing info.
   */
  app.get('/usage', { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.auth!.userId;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { tier: true } });
    const tier = (user?.tier as string) || 'free';

    const tierLimits: Record<string, number> = { free: 1000, starter: 25000, pro: 250000, max: 1000000 };
    const overageRates: Record<string, number> = { free: 0, starter: 0.0005, pro: 0.0003, max: 0 }; // per call

    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const keySlots = await prisma.keySlot.findMany({ where: { userId }, select: { id: true } });
    const keySlotIds = keySlots.map(k => k.id);

    const totalCalls = keySlotIds.length > 0 ? await prisma.accessLog.count({
      where: { keySlotId: { in: keySlotIds }, action: 'api_call', timestamp: { gte: monthStart } },
    }) : 0;

    const limit = tierLimits[tier] || 1000;
    const overageCalls = Math.max(0, totalCalls - limit);
    const rate = overageRates[tier] || 0;
    const overageCost = overageCalls * rate;

    return {
      tier,
      totalCalls,
      limit,
      overageCalls,
      overageRate: rate > 0 ? `$${rate}/call` : 'N/A',
      estimatedOverageCost: `$${overageCost.toFixed(2)}`,
    };
  });
}

// --- Helpers ---

/**
 * Downgrade a user to free tier by their Stripe subscription ID.
 */
async function downgradeBySubscription(subscriptionId: string): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { stripeSubscriptionId: subscriptionId },
  });

  if (user) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        tier: 'free',
        stripeSubscriptionId: null,
      },
    });
  }
}
