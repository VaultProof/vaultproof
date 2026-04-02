import type { Env } from '../types.js';
import { getSupabase } from '../lib/supabase.js';
import { authenticateUser } from '../lib/jwt-auth.js';

export async function handleBilling(request: Request, env: Env, path: string): Promise<Response> {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const user = await authenticateUser(request, env);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  if (path === 'status') return handleStatus(env, user.userId);

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
