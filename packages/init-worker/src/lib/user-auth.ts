/**
 * Dashboard user authentication via Supabase JWT.
 * Used ONLY on `POST /api/v1/init/*` routes where the init-cli is creating
 * a project or uploading shares. Proxy routes use `project-auth.ts` instead.
 */
import type { Env } from '../types.js';
import { getSupabase } from './supabase.js';

export interface UserAuth {
  userId: string;
  email: string;
}

export async function authenticateUser(
  request: Request,
  env: Env,
): Promise<UserAuth | null> {
  const authHeader = request.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  // Reject dev keys and project ids — this endpoint is JWT-only.
  if (!token || token.startsWith('vp_') || token.startsWith('vp-proj-')) return null;

  const supabase = getSupabase(env);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;

  const userId = data.user.id;
  const email = data.user.email;
  if (!userId || !email) return null;

  return { userId, email };
}
