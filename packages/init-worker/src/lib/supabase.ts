import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../types.js';

let _client: SupabaseClient | null = null;

export function getSupabase(env: Env): SupabaseClient {
  if (!_client) {
    _client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _client;
}
