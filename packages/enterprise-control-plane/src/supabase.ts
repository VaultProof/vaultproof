import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { EnterpriseControlPlaneEnv } from './config.js';

const clientCache = new Map<string, SupabaseClient>();

export function getSupabase(env: EnterpriseControlPlaneEnv): SupabaseClient {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }

  const cacheKey = env.supabaseUrl;
  let client = clientCache.get(cacheKey);
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    clientCache.set(cacheKey, client);
  }
  return client;
}
