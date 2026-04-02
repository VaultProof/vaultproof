import type { Env } from '../types.js';
import { getSupabase } from '../lib/supabase.js';
import { authenticateUser } from '../lib/jwt-auth.js';

export async function handleAuth(request: Request, env: Env, path: string): Promise<Response> {
  const user = await authenticateUser(request, env);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  if (path === 'me' && request.method === 'GET') return handleMe(env, user.userId);

  return Response.json({ error: 'Not found' }, { status: 404 });
}

async function handleMe(env: Env, userId: string): Promise<Response> {
  const supabase = getSupabase(env);
  const { data: userData } = await supabase
    .from('users')
    .select('id, email, created_at, tier, kill_switch, global_daily_limit, global_monthly_limit, promo_code, tier_expires_at, has_seen_tour')
    .eq('id', userId)
    .single();

  if (!userData) return Response.json({ error: 'User not found' }, { status: 404 });

  return Response.json({
    user: {
      id: userData.id,
      email: userData.email,
      createdAt: userData.created_at,
      tier: userData.tier,
      killSwitch: userData.kill_switch,
      globalDailyLimit: userData.global_daily_limit,
      globalMonthlyLimit: userData.global_monthly_limit,
      promoCode: userData.promo_code,
      tierExpiresAt: userData.tier_expires_at,
      hasSeenTour: userData.has_seen_tour,
    },
  });
}
