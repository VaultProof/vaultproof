import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../types.js';

const clientCache = new Map<string, SupabaseClient>();

export function getSupabase(env: Env): SupabaseClient {
  const key = env.SUPABASE_URL;
  let client = clientCache.get(key);
  if (!client) {
    client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    clientCache.set(key, client);
  }
  return client;
}
