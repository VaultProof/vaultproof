import type { Env } from '../types.js';
import { getSupabase } from '../lib/supabase.js';
import { authenticateUser } from '../lib/jwt-auth.js';

export async function handleDevKeys(request: Request, env: Env, path: string): Promise<Response> {
  if (path === 'list') {
    return handleList(request, env);
  }

  if (path === 'create') {
    return handleCreate(request, env);
  }

  const settingsMatch = path.match(/^(.+)\/settings$/);
  if (settingsMatch) {
    return handleSettings(request, env, settingsMatch[1]);
  }

  const revokeMatch = path.match(/^(.+)\/revoke$/);
  if (revokeMatch) {
    return handleRevoke(request, env, revokeMatch[1]);
  }

  const rotateMatch = path.match(/^(.+)\/rotate$/);
  if (rotateMatch) {
    return handleRotate(request, env, rotateMatch[1]);
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}

async function hashKey(key: string): Promise<string> {
  const encoded = new TextEncoder().encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateDevKey(): string {
  return 'vp_live_' + crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

async function handleCreate(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const auth = await authenticateUser(request, env);
  if (!auth) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let label = 'Default';
  let mode = 'live';
  try {
    const body = await request.json() as { label?: string; mode?: string };
    if (body.label) label = body.label;
    if (body.mode) mode = body.mode;
  } catch {
    // use defaults
  }

  const key = generateDevKey();
  const keyHash = await hashKey(key);

  const supabase = getSupabase(env);
  const { data, error } = await supabase
    .from('developer_keys')
    .insert({
      id: crypto.randomUUID(),
      user_id: auth.userId,
      key,
      key_hash: keyHash,
      label,
      mode,
    })
    .select('id')
    .single();

  if (error) {
    return Response.json({ error: 'Failed to create key' }, { status: 500 });
  }

  return Response.json({ key, id: data.id });
}

async function handleRevoke(request: Request, env: Env, id: string): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const auth = await authenticateUser(request, env);
  if (!auth) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase(env);

  // Verify ownership
  const { data: existing } = await supabase
    .from('developer_keys')
    .select('id')
    .eq('id', id)
    .eq('user_id', auth.userId)
    .is('revoked_at', null)
    .single();

  if (!existing) {
    return Response.json({ error: 'Key not found or already revoked' }, { status: 404 });
  }

  const { error } = await supabase
    .from('developer_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    return Response.json({ error: 'Failed to revoke key' }, { status: 500 });
  }

  return Response.json({ status: 'revoked' });
}

async function handleRotate(request: Request, env: Env, id: string): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const auth = await authenticateUser(request, env);
  if (!auth) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase(env);

  // Verify ownership and get current key's label
  const { data: existing } = await supabase
    .from('developer_keys')
    .select('id, label, mode')
    .eq('id', id)
    .eq('user_id', auth.userId)
    .is('revoked_at', null)
    .single();

  if (!existing) {
    return Response.json({ error: 'Key not found or already revoked' }, { status: 404 });
  }

  // Revoke the old key
  const { error: revokeError } = await supabase
    .from('developer_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id);

  if (revokeError) {
    return Response.json({ error: 'Failed to revoke old key' }, { status: 500 });
  }

  // Create new key with same label
  const newKey = generateDevKey();
  const keyHash = await hashKey(newKey);

  const { data: newData, error: createError } = await supabase
    .from('developer_keys')
    .insert({
      id: crypto.randomUUID(),
      user_id: auth.userId,
      key: newKey,
      key_hash: keyHash,
      label: existing.label,
      mode: existing.mode,
    })
    .select('id')
    .single();

  if (createError) {
    return Response.json({ error: 'Failed to create new key' }, { status: 500 });
  }

  return Response.json({ key: newKey, id: newData.id });
}

async function handleSettings(request: Request, env: Env, id: string): Promise<Response> {
  if (request.method !== 'PUT') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const auth = await authenticateUser(request, env);
  if (!auth) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase(env);

  const { data: existing } = await supabase
    .from('developer_keys')
    .select('id')
    .eq('id', id)
    .eq('user_id', auth.userId)
    .is('revoked_at', null)
    .single();

  if (!existing) {
    return Response.json({ error: 'Key not found' }, { status: 404 });
  }

  let body: any;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const updates: Record<string, unknown> = {};
  if ('allowedIps' in body) updates.allowed_ips = body.allowedIps || null;
  if ('allowedOrigins' in body) updates.allowed_origins = body.allowedOrigins || null;
  if ('strictOrigin' in body) updates.strict_origin = !!body.strictOrigin;
  if ('allowedProviders' in body) updates.allowed_providers = body.allowedProviders || null;
  if ('allowedEndpoints' in body) updates.allowed_endpoints = body.allowedEndpoints || null;
  if ('allowedKeySlotIds' in body) updates.allowed_key_slot_ids = body.allowedKeySlotIds || null;
  if ('label' in body) updates.label = body.label;
  if ('webhookUrl' in body) updates.webhook_url = body.webhookUrl || null;
  if ('alertEmail' in body) updates.alert_email = body.alertEmail || null;
  if ('alertThreshold' in body) updates.alert_threshold = body.alertThreshold || null;

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: 'No fields to update' }, { status: 400 });
  }

  const { error } = await supabase
    .from('developer_keys')
    .update(updates)
    .eq('id', id);

  if (error) {
    return Response.json({ error: 'Failed to update settings' }, { status: 500 });
  }

  return Response.json({ ok: true });
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
    .select('id, key, label, mode, last_used, created_at, webhook_url, allowed_key_slot_ids, allowed_ips, allowed_origins, strict_origin, allowed_providers, allowed_endpoints')
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
    allowedIps: row.allowed_ips,
    allowedOrigins: row.allowed_origins,
    strictOrigin: row.strict_origin,
    allowedProviders: row.allowed_providers,
    allowedEndpoints: row.allowed_endpoints,
  }));

  return Response.json({ keys });
}
