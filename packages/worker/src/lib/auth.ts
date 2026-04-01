import type { Env, DevKeyAuth, DevKeyRecord } from '../types.js';
import { getSupabase } from './supabase.js';
import { cacheGet, cacheSet } from './cache.js';

async function sha256hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function authenticateDevKey(
  request: Request,
  env: Env,
): Promise<DevKeyAuth | null> {
  const authHeader = request.headers.get('authorization') || '';
  const apiKeyHeader = request.headers.get('x-api-key') || '';

  let rawKey: string | null = null;
  if (apiKeyHeader.startsWith('vp_')) {
    rawKey = apiKeyHeader;
  } else if (authHeader.startsWith('Bearer vp_')) {
    rawKey = authHeader.slice(7);
  }

  if (!rawKey) return null;
  if (!rawKey.startsWith('vp_live_') && !rawKey.startsWith('vp_test_')) return null;

  const keyHash = await sha256hex(rawKey);

  // Check KV cache first
  const cacheKey = `devkey:${keyHash}`;
  let devKey = await cacheGet<DevKeyRecord>(env, cacheKey);

  if (!devKey) {
    const supabase = getSupabase(env);
    const { data, error } = await supabase
      .from('developer_keys')
      .select('*')
      .eq('key_hash', keyHash)
      .single();

    if (error || !data) return null;
    devKey = data as DevKeyRecord;
    await cacheSet(env, cacheKey, devKey, 30);
  }

  if (devKey.revoked_at) return null;

  // Optional session token validation
  const sessionHeader = request.headers.get('x-vaultproof-session');
  if (sessionHeader) {
    const sessionHash = await sha256hex(sessionHeader);
    const supabase = getSupabase(env);
    const { data: session } = await supabase
      .from('session_tokens')
      .select('*')
      .eq('token_hash', sessionHash)
      .single();

    if (!session || session.developer_key_id !== devKey.id || new Date(session.expires_at) < new Date()) {
      return null;
    }
  }

  // Update lastUsed non-blocking
  const supabase = getSupabase(env);
  supabase.from('developer_keys').update({ last_used: new Date().toISOString() }).eq('id', devKey.id).then(() => {});

  return { userId: devKey.user_id, keyId: devKey.id, rawKey, devKey };
}
