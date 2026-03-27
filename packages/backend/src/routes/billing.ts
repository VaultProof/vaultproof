import type { FastifyInstance } from 'fastify';
import Stripe from 'stripe';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

// --- Tier definitions ---

const TIERS = {
  starter: { name: 'VaultProof Starter', price: 900, interval: 'month' as const },
  pro: { name: 'VaultProof Pro', price: 2900, interval: 'month' as const },
  max: { name: 'VaultProof Max', price: 9900, interval: 'month' as const },
} as const;

type Tier = keyof typeof TIERS;

// Module-level cache for Stripe Price IDs
const priceIdCache = new Map<Tier, string>();

/**
 * Ensures Stripe products and prices exist for each tier.
 * Creates them if missing and caches the price IDs.
 */
async function ensurePrices(): Promise<Map<Tier, string>> {
  if (priceIdCache.size === Object.keys(TIERS).length) {
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

    // Look for an active recurring price on this product matching the amount
    const prices = await stripe.prices.list({
      product: productId,
      active: true,
      limit: 100,
    });

    const existingPrice = prices.data.find(
      (p) =>
        p.unit_amount === config.price &&
        p.recurring?.interval === config.interval &&
        p.currency === 'usd',
    );

    if (existingPrice) {
      priceIdCache.set(tier, existingPrice.id);
    } else {
      const price = await stripe.prices.create({
        product: productId,
        unit_amount: config.price,
        currency: 'usd',
        recurring: { interval: config.interval },
        metadata: { vaultproof_tier: tier },
      });
      priceIdCache.set(tier, price.id);
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
   */
  app.post<{ Body: { tier: Tier } }>(
    '/checkout',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tier } = request.body;
      if (!tier || !TIERS[tier]) {
        return reply.status(400).send({ error: 'Invalid tier. Must be starter or pro.' });
      }

      const userId = request.auth!.userId;
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      // Ensure Stripe prices are initialized
      const prices = await ensurePrices();
      const priceId = prices.get(tier)!;

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
        metadata: { userId, tier },
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

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        rawBody,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET!,
      );
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
          await prisma.user.update({
            where: { id: userId },
            data: {
              tier,
              stripeSubscriptionId: subscriptionId ?? null,
            },
          });
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
