import type { Env } from '../types.js';
import { getSupabase } from './supabase.js';

export interface JwtAuth {
  userId: string;
  email: string;
}

/**
 * Authenticate a dashboard user via Supabase JWT token.
 * Skips tokens that start with `vp_` (those are dev keys, handled by auth.ts).
 * Returns { userId, email } on success, null otherwise.
 */
export async function authenticateUser(
  request: Request,
  env: Env,
): Promise<JwtAuth | null> {
  const authHeader = request.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  if (!token || token.startsWith('vp_')) return null;

  const supabase = getSupabase(env);
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) return null;

  const userId = data.user.id;
  const email = data.user.email;
  if (!userId || !email) return null;

  // Auto-create user row if missing (Supabase auth user may not exist in public.users yet)
  const supabaseDb = getSupabase(env);
  const { data: existingUser } = await supabaseDb
    .from('users')
    .select('id')
    .eq('id', userId)
    .single();
  if (!existingUser) {
    await supabaseDb.from('users').insert({
      id: userId,
      email,
      tier: 'free',
      created_at: new Date().toISOString(),
      kill_switch: false,
      has_seen_tour: false,
      global_daily_limit: 1000,
      global_monthly_limit: 30000,
    });
  }

  return { userId, email };
}

/**
 * Authenticate an admin user via Supabase JWT token.
 * Same as authenticateUser, but also checks that the email is in the
 * ADMIN_EMAILS allowlist (comma-separated env var).
 */
export async function authenticateAdmin(
  request: Request,
  env: Env,
): Promise<JwtAuth | null> {
  const auth = await authenticateUser(request, env);
  if (!auth) return null;

  const allowlist = (env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (!allowlist.includes(auth.email.toLowerCase())) return null;

  return auth;
}
