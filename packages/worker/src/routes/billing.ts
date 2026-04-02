import type { Env } from '../types.js';
import { getSupabase } from '../lib/supabase.js';
import { authenticateUser } from '../lib/jwt-auth.js';
import Stripe from 'stripe';

const TIERS: Record<string, { name: string; price: number; annualPrice: number }> = {
  starter: { name: 'VaultProof Starter', price: 500, annualPrice: 5000 },
  pro: { name: 'VaultProof Pro', price: 2000, annualPrice: 20000 },
};

const priceIdCache = new Map<string, string>();

function getStripe(env: Env): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY);
}

async function ensurePrices(stripe: Stripe): Promise<Map<string, string>> {
  const expectedCount = Object.keys(TIERS).length * 2;
  if (priceIdCache.size === expectedCount) return priceIdCache;

  for (const [tier, config] of Object.entries(TIERS)) {
    const products = await stripe.products.list({ limit: 100, active: true });
    const existing = products.data.find(p => p.metadata.vaultproof_tier === tier);

    let productId: string;
    if (existing) {
      productId = existing.id;
    } else {
      const product = await stripe.products.create({ name: config.name, metadata: { vaultproof_tier: tier } });
      productId = product.id;
    }

    const prices = await stripe.prices.list({ product: productId, active: true, limit: 100 });

    // Monthly
    const monthlyPrice = prices.data.find(p => p.unit_amount === config.price && p.recurring?.interval === 'month' && p.currency === 'usd');
    if (monthlyPrice) {
      priceIdCache.set(tier, monthlyPrice.id);
    } else {
      const created = await stripe.prices.create({ product: productId, unit_amount: config.price, currency: 'usd', recurring: { interval: 'month' }, metadata: { vaultproof_tier: tier, billing_period: 'monthly' } });
      priceIdCache.set(tier, created.id);
    }

    // Annual
    const annualPrice = prices.data.find(p => p.unit_amount === config.annualPrice && p.recurring?.interval === 'year' && p.currency === 'usd');
    if (annualPrice) {
      priceIdCache.set(`${tier}_annual`, annualPrice.id);
    } else {
      const created = await stripe.prices.create({ product: productId, unit_amount: config.annualPrice, currency: 'usd', recurring: { interval: 'year' }, metadata: { vaultproof_tier: tier, billing_period: 'annual' } });
      priceIdCache.set(`${tier}_annual`, created.id);
    }
  }

  return priceIdCache;
}

export async function handleBilling(request: Request, env: Env, path: string): Promise<Response> {
  const user = await authenticateUser(request, env);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  if (path === 'status' && request.method === 'GET') return handleStatus(env, user.userId);
  if (path === 'checkout' && request.method === 'POST') return handleCheckout(request, env, user.userId);
  if (path === 'portal' && request.method === 'POST') return handlePortal(env, user.userId);

  return Response.json({ error: 'Not found' }, { status: 404 });
}

async function handleStatus(env: Env, userId: string): Promise<Response> {
  const supabase = getSupabase(env);
  const { data: userData } = await supabase
    .from('users')
    .select('tier, stripe_customer_id, stripe_subscription_id')
    .eq('id', userId)
    .single();

  if (!userData) return Response.json({ error: 'User not found' }, { status: 404 });

  return Response.json({
    tier: userData.tier || 'free',
    stripeCustomerId: userData.stripe_customer_id || null,
    hasSubscription: !!userData.stripe_subscription_id,
  });
}

async function handleCheckout(request: Request, env: Env, userId: string): Promise<Response> {
  let body: any;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { tier, annual } = body;
  if (!tier || !['starter', 'pro'].includes(tier)) {
    return Response.json({ error: 'Invalid tier. Must be starter or pro.' }, { status: 400 });
  }

  const supabase = getSupabase(env);
  const { data: userData } = await supabase.from('users').select('id, email, stripe_customer_id').eq('id', userId).single();
  if (!userData) return Response.json({ error: 'User not found' }, { status: 404 });

  const stripe = getStripe(env);
  const prices = await ensurePrices(stripe);
  const priceKey = annual ? `${tier}_annual` : tier;
  const priceId = prices.get(priceKey);
  if (!priceId) return Response.json({ error: 'Price not found' }, { status: 500 });

  // Get or create Stripe customer
  let customerId = userData.stripe_customer_id;
  if (!customerId) {
    const customers = await stripe.customers.list({ email: userData.email, limit: 1 });
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
    } else {
      const customer = await stripe.customers.create({ email: userData.email, metadata: { userId } });
      customerId = customer.id;
    }
    await supabase.from('users').update({ stripe_customer_id: customerId }).eq('id', userId);
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: 'https://vaultproof.dev/app/settings?billing=success',
    cancel_url: 'https://vaultproof.dev/app/settings?billing=cancel',
    metadata: { userId, tier, billingPeriod: annual ? 'annual' : 'monthly' },
  });

  return Response.json({ url: session.url });
}

async function handlePortal(env: Env, userId: string): Promise<Response> {
  const supabase = getSupabase(env);
  const { data: userData } = await supabase.from('users').select('stripe_customer_id').eq('id', userId).single();

  if (!userData?.stripe_customer_id) {
    return Response.json({ error: 'No billing account found. Subscribe to a plan first.' }, { status: 400 });
  }

  const stripe = getStripe(env);
  const session = await stripe.billingPortal.sessions.create({
    customer: userData.stripe_customer_id,
    return_url: 'https://vaultproof.dev/app/settings',
  });

  return Response.json({ url: session.url });
}
