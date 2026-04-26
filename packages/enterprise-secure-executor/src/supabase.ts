import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const clientCache = new Map<string, SupabaseClient>();

export function getSupabase(input: {
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
}): SupabaseClient {
  if (!input.supabaseUrl || !input.supabaseServiceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }

  const cacheKey = input.supabaseUrl;
  let client = clientCache.get(cacheKey);
  if (!client) {
    client = createClient(input.supabaseUrl, input.supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    clientCache.set(cacheKey, client);
  }

  return client;
}
