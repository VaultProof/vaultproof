import type { Env } from '../types.js';
import { getSupabase } from '../lib/supabase.js';
import { authenticateUser } from '../lib/jwt-auth.js';

export async function handlePromo(request: Request, env: Env, path: string): Promise<Response> {
  if (path === 'feedback/status') {
    return handleFeedbackStatus(request, env);
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}

async function handleFeedbackStatus(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const auth = await authenticateUser(request, env);
  if (!auth) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase(env);
  const { userId } = auth;

  // Get user data
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('id, promo_code, tier, tier_expires_at')
    .eq('id', userId)
    .single();

  if (userError || !userData) {
    return Response.json({ error: 'User not found' }, { status: 404 });
  }

  // Calculate week start (Monday 00:00 UTC)
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sunday
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(now);
  weekStart.setUTCDate(weekStart.getUTCDate() - mondayOffset);
  weekStart.setUTCHours(0, 0, 0, 0);

  // Count feedback this week
  const { count, error: feedbackError } = await supabase
    .from('promo_feedback')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', weekStart.toISOString());

  if (feedbackError) {
    return Response.json({ error: 'Failed to query feedback' }, { status: 500 });
  }

  return Response.json({
    isPromo: !!userData.promo_code,
    submittedThisWeek: (count ?? 0) > 0,
    promoCode: userData.promo_code,
    tierExpiresAt: userData.tier_expires_at,
  });
}
