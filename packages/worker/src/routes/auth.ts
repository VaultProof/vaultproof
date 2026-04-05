import type { Env } from '../types.js';
import { getSupabase } from '../lib/supabase.js';
import { authenticateUser } from '../lib/jwt-auth.js';

export async function handleAuth(request: Request, env: Env, path: string): Promise<Response> {
  // Refresh doesn't require an active session — it uses the refresh token
  if (path === 'refresh' && request.method === 'POST') return handleRefresh(request, env);

  const user = await authenticateUser(request, env);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  if (path === 'me' && request.method === 'GET') return handleMe(env, user.userId);
  if (path === 'tour-complete' && request.method === 'POST') return handleTourComplete(env, user.userId);

  return Response.json({ error: 'Not found' }, { status: 404 });
}

async function handleRefresh(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { refresh_token?: string; refreshToken?: string };
  const refreshToken = body.refresh_token || body.refreshToken;
  if (!refreshToken) {
    return Response.json({ error: 'refresh_token required' }, { status: 400 });
  }
  const supabase = getSupabase(env);
  const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) {
    return Response.json({ error: 'Refresh failed' }, { status: 401 });
  }
  return Response.json({
    token: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresIn: data.session.expires_in,
  });
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

async function handleTourComplete(env: Env, userId: string): Promise<Response> {
  const supabase = getSupabase(env);
  await supabase.from('users').update({ has_seen_tour: true }).eq('id', userId);
  return Response.json({ ok: true });
}
