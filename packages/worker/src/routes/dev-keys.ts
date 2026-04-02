import type { Env } from '../types.js';
import { getSupabase } from '../lib/supabase.js';
import { authenticateUser } from '../lib/jwt-auth.js';

export async function handleDevKeys(request: Request, env: Env, path: string): Promise<Response> {
  if (path === 'list') {
    return handleList(request, env);
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}

async function handleList(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const auth = await authenticateUser(request, env);
  if (!auth) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase(env);
  const { data, error } = await supabase
    .from('developer_keys')
    .select('id, key, label, mode, last_used, created_at, webhook_url, allowed_key_slot_ids')
    .eq('user_id', auth.userId)
    .is('revoked_at', null);

  if (error) {
    return Response.json({ error: 'Failed to fetch keys' }, { status: 500 });
  }

  const keys = (data ?? []).map((row) => ({
    id: row.id,
    key: row.key.slice(0, 12) + '...' + row.key.slice(-4),
    label: row.label,
    mode: row.mode,
    lastUsed: row.last_used,
    createdAt: row.created_at,
    webhookUrl: row.webhook_url,
  }));

  return Response.json({ keys });
}
