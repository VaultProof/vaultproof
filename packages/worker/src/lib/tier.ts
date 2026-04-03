import type { Env } from '../types.js';
import { getSupabase } from './supabase.js';

export async function getUserTier(env: Env, userId: string): Promise<string> {
  const supabase = getSupabase(env);
  const { data } = await supabase
    .from('users')
    .select('tier')
    .eq('id', userId)
    .single();
  return data?.tier || 'free';
}
