import type { Env } from '../types.js';
import { authenticateUser } from '../lib/jwt-auth.js';
import { getSupabase } from '../lib/supabase.js';
import { getUserTier } from '../lib/tier.js';
import { encrypt } from '../crypto/encryption.js';

const TIER_KEY_LIMITS: Record<string, number> = {
  free: 3,
  starter: 10,
  pro: 50,
  max: 100,
  enterprise: 1000,
};

export async function handleKeys(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  const user = await authenticateUser(request, env);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const method = request.method;
  const supabase = getSupabase(env);

  // ── GET /api/v1/keys/list ──────────────────────────────────────────
  if (path === 'list' && method === 'GET') {
    const { data: slots, error } = await supabase
      .from('key_slots')
      .select('id, user_id, provider, label, env_var, vault_commitment, auth_apps_root, status, daily_limit, monthly_limit, block_on_limit, created_at, rotated_at, expires_at')
      .eq('user_id', user.userId)
      .neq('status', 'REVOKED');

    if (error) {
      return Response.json({ error: 'Failed to fetch key slots' }, { status: 500 });
    }

    // Fetch non-revoked app grants for these slots
    const slotIds = (slots || []).map((s: any) => s.id);
    let grants: any[] = [];
    if (slotIds.length > 0) {
      const { data: grantData } = await supabase
        .from('app_grants')
        .select('*')
        .in('key_slot_id', slotIds)
        .is('revoked_at', null);
      grants = grantData || [];
    }

    const keySlots = (slots || []).map((slot: any) => ({
      ...slot,
      app_grants: grants.filter((g: any) => g.key_slot_id === slot.id),
    }));

    return Response.json({ keySlots });
  }

  // ── POST /api/v1/keys/store ────────────────────────────────────────
  if (path === 'store' && method === 'POST') {
    const body = await request.json<any>();
    const { provider, label, share1, vaultCommitment, authAppsRoot, appId, appName, expiresAt } = body;

    if (!provider || !share1 || !vaultCommitment) {
      return Response.json({ error: 'Missing required fields: provider, share1, vaultCommitment' }, { status: 400 });
    }

    // Check tier limit
    const tier = await getUserTier(env, user.userId);
    const limit = TIER_KEY_LIMITS[tier] ?? TIER_KEY_LIMITS.free;

    const { count, error: countError } = await supabase
      .from('key_slots')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.userId)
      .neq('status', 'REVOKED');

    if (countError) {
      return Response.json({ error: 'Failed to check key slot count' }, { status: 500 });
    }

    if ((count ?? 0) >= limit) {
      return Response.json(
        { error: `Key slot limit reached (${limit} for ${tier} tier)` },
        { status: 403 },
      );
    }

    // Encrypt share1
    const share1Bytes = Uint8Array.from(atob(share1), (c) => c.charCodeAt(0));
    const encryptedBytes = encrypt(share1Bytes, env);
    const share1Encrypted = btoa(String.fromCharCode(...encryptedBytes));

    const keySlotId = crypto.randomUUID();
    const now = new Date().toISOString();

    const { error: insertError } = await supabase.from('key_slots').insert({
      id: keySlotId,
      user_id: user.userId,
      provider,
      label: label || null,
      share1_encrypted: share1Encrypted,
      vault_commitment: vaultCommitment,
      auth_apps_root: authAppsRoot || null,
      status: 'ACTIVE',
      created_at: now,
      expires_at: expiresAt || null,
    });

    if (insertError) {
      return Response.json({ error: 'Failed to store key slot' }, { status: 500 });
    }

    let grantId: string | undefined;
    if (appId) {
      grantId = crypto.randomUUID();
      await supabase.from('app_grants').insert({
        id: grantId,
        key_slot_id: keySlotId,
        app_id: appId,
        app_name: appName || null,
        granted_at: now,
      });
    }

    return Response.json({ keySlotId, grantId, status: 'stored' }, { status: 201 });
  }

  // ── POST /api/v1/keys/revoke/:keySlotId ────────────────────────────
  const revokeMatch = path.match(/^revoke\/([a-f0-9-]+)$/);
  if (revokeMatch && method === 'POST') {
    const keySlotId = revokeMatch[1];

    const { data: slot, error } = await supabase
      .from('key_slots')
      .select('id, user_id')
      .eq('id', keySlotId)
      .eq('user_id', user.userId)
      .single();

    if (error || !slot) {
      return Response.json({ error: 'Key slot not found' }, { status: 404 });
    }

    const { error: updateError } = await supabase
      .from('key_slots')
      .update({ status: 'REVOKED' })
      .eq('id', keySlotId);

    if (updateError) {
      return Response.json({ error: 'Failed to revoke key slot' }, { status: 500 });
    }

    return Response.json({ status: 'revoked' });
  }

  // ── POST /api/v1/keys/:keySlotId/grant ─────────────────────────────
  const grantMatch = path.match(/^([a-f0-9-]+)\/grant$/);
  if (grantMatch && method === 'POST') {
    const keySlotId = grantMatch[1];

    const { data: slot, error } = await supabase
      .from('key_slots')
      .select('id, user_id, status')
      .eq('id', keySlotId)
      .eq('user_id', user.userId)
      .single();

    if (error || !slot) {
      return Response.json({ error: 'Key slot not found' }, { status: 404 });
    }
    if (slot.status !== 'ACTIVE') {
      return Response.json({ error: 'Key slot is not active' }, { status: 400 });
    }

    const body = await request.json<any>();
    const { appId, appName } = body;

    if (!appId) {
      return Response.json({ error: 'Missing required field: appId' }, { status: 400 });
    }

    const grantId = crypto.randomUUID();
    const { error: insertError } = await supabase.from('app_grants').insert({
      id: grantId,
      key_slot_id: keySlotId,
      app_id: appId,
      app_name: appName || null,
      granted_at: new Date().toISOString(),
    });

    if (insertError) {
      return Response.json({ error: 'Failed to create grant' }, { status: 500 });
    }

    return Response.json({ grantId, status: 'granted' }, { status: 201 });
  }

  // ── POST /api/v1/keys/:keySlotId/revoke-app/:appId ─────────────────
  const revokeAppMatch = path.match(/^([a-f0-9-]+)\/revoke-app\/(.+)$/);
  if (revokeAppMatch && method === 'POST') {
    const keySlotId = revokeAppMatch[1];
    const appId = revokeAppMatch[2];

    // Verify ownership
    const { data: slot, error } = await supabase
      .from('key_slots')
      .select('id, user_id')
      .eq('id', keySlotId)
      .eq('user_id', user.userId)
      .single();

    if (error || !slot) {
      return Response.json({ error: 'Key slot not found' }, { status: 404 });
    }

    const { error: updateError } = await supabase
      .from('app_grants')
      .update({ revoked_at: new Date().toISOString() })
      .eq('key_slot_id', keySlotId)
      .eq('app_id', appId)
      .is('revoked_at', null);

    if (updateError) {
      return Response.json({ error: 'Failed to revoke app grant' }, { status: 500 });
    }

    return Response.json({ status: 'app_revoked' });
  }

  // ── GET /api/v1/keys/:keySlotId/logs ───────────────────────────────
  const logsMatch = path.match(/^([a-f0-9-]+)\/logs$/);
  if (logsMatch && method === 'GET') {
    const keySlotId = logsMatch[1];

    // Verify ownership
    const { data: slot, error } = await supabase
      .from('key_slots')
      .select('id, user_id')
      .eq('id', keySlotId)
      .eq('user_id', user.userId)
      .single();

    if (error || !slot) {
      return Response.json({ error: 'Key slot not found' }, { status: 404 });
    }

    const { data: logs, error: logsError } = await supabase
      .from('access_logs')
      .select('*')
      .eq('key_slot_id', keySlotId)
      .order('timestamp', { ascending: false })
      .limit(100);

    if (logsError) {
      return Response.json({ error: 'Failed to fetch logs' }, { status: 500 });
    }

    return Response.json({ logs: logs || [] });
  }

  // ── POST /api/v1/keys/:keySlotId/rotate ────────────────────────────
  const rotateMatch = path.match(/^([a-f0-9-]+)\/rotate$/);
  if (rotateMatch && method === 'POST') {
    const keySlotId = rotateMatch[1];

    const { data: slot, error } = await supabase
      .from('key_slots')
      .select('id, user_id, status')
      .eq('id', keySlotId)
      .eq('user_id', user.userId)
      .single();

    if (error || !slot) {
      return Response.json({ error: 'Key slot not found' }, { status: 404 });
    }
    if (slot.status !== 'ACTIVE') {
      return Response.json({ error: 'Key slot is not active' }, { status: 400 });
    }

    const body = await request.json<any>();
    const { share1, vaultCommitment, authAppsRoot } = body;

    if (!share1 || !vaultCommitment) {
      return Response.json({ error: 'Missing required fields: share1, vaultCommitment' }, { status: 400 });
    }

    // Encrypt new share1
    const share1Bytes = Uint8Array.from(atob(share1), (c) => c.charCodeAt(0));
    const encryptedBytes = encrypt(share1Bytes, env);
    const share1Encrypted = btoa(String.fromCharCode(...encryptedBytes));

    const now = new Date().toISOString();

    const { error: updateError } = await supabase
      .from('key_slots')
      .update({
        share1_encrypted: share1Encrypted,
        vault_commitment: vaultCommitment,
        auth_apps_root: authAppsRoot || undefined,
        rotated_at: now,
      })
      .eq('id', keySlotId);

    if (updateError) {
      return Response.json({ error: 'Failed to rotate key' }, { status: 500 });
    }

    // Log rotation
    await supabase.from('access_logs').insert({
      id: crypto.randomUUID(),
      key_slot_id: keySlotId,
      action: 'rotate',
      timestamp: now,
    });

    return Response.json({ status: 'rotated' });
  }

  // ── PUT /api/v1/keys/:keySlotId/limits ─────────────────────────────
  const limitsMatch = path.match(/^([a-f0-9-]+)\/limits$/);
  if (limitsMatch && method === 'PUT') {
    const keySlotId = limitsMatch[1];

    const { data: slot, error } = await supabase
      .from('key_slots')
      .select('id, user_id, status')
      .eq('id', keySlotId)
      .eq('user_id', user.userId)
      .single();

    if (error || !slot) {
      return Response.json({ error: 'Key slot not found' }, { status: 404 });
    }
    if (slot.status !== 'ACTIVE') {
      return Response.json({ error: 'Key slot is not active' }, { status: 400 });
    }

    const body = await request.json<any>();
    const updates: Record<string, any> = {};
    if (body.dailyLimit !== undefined) updates.daily_limit = body.dailyLimit;
    if (body.monthlyLimit !== undefined) updates.monthly_limit = body.monthlyLimit;
    if (body.blockOnLimit !== undefined) updates.block_on_limit = body.blockOnLimit;

    if (Object.keys(updates).length === 0) {
      return Response.json({ error: 'No fields to update' }, { status: 400 });
    }

    const { data: updated, error: updateError } = await supabase
      .from('key_slots')
      .update(updates)
      .eq('id', keySlotId)
      .select('daily_limit, monthly_limit, block_on_limit')
      .single();

    if (updateError) {
      return Response.json({ error: 'Failed to update limits' }, { status: 500 });
    }

    return Response.json({
      dailyLimit: updated.daily_limit,
      monthlyLimit: updated.monthly_limit,
      blockOnLimit: updated.block_on_limit,
    });
  }

  // ── PUT /api/v1/keys/:keySlotId/expiry ─────────────────────────────
  const expiryMatch = path.match(/^([a-f0-9-]+)\/expiry$/);
  if (expiryMatch && method === 'PUT') {
    const keySlotId = expiryMatch[1];

    const { data: slot, error } = await supabase
      .from('key_slots')
      .select('id, user_id, status')
      .eq('id', keySlotId)
      .eq('user_id', user.userId)
      .single();

    if (error || !slot) {
      return Response.json({ error: 'Key slot not found' }, { status: 404 });
    }
    if (slot.status !== 'ACTIVE') {
      return Response.json({ error: 'Key slot is not active' }, { status: 400 });
    }

    const body = await request.json<any>();
    if (!body.expiresAt) {
      return Response.json({ error: 'Missing required field: expiresAt' }, { status: 400 });
    }

    const { error: updateError } = await supabase
      .from('key_slots')
      .update({ expires_at: body.expiresAt })
      .eq('id', keySlotId);

    if (updateError) {
      return Response.json({ error: 'Failed to update expiry' }, { status: 500 });
    }

    return Response.json({ status: 'updated' });
  }

  // ── GET /api/v1/keys/:keySlotId/logs/export ────────────────────────
  const exportMatch = path.match(/^([a-f0-9-]+)\/logs\/export$/);
  if (exportMatch && method === 'GET') {
    const keySlotId = exportMatch[1];

    // Verify ownership
    const { data: slot, error } = await supabase
      .from('key_slots')
      .select('id, user_id')
      .eq('id', keySlotId)
      .eq('user_id', user.userId)
      .single();

    if (error || !slot) {
      return Response.json({ error: 'Key slot not found' }, { status: 404 });
    }

    const { data: logs, error: logsError } = await supabase
      .from('access_logs')
      .select('*')
      .eq('key_slot_id', keySlotId)
      .order('timestamp', { ascending: false });

    if (logsError) {
      return Response.json({ error: 'Failed to fetch logs' }, { status: 500 });
    }

    const rows = logs || [];
    const headers = ['id', 'key_slot_id', 'app_id', 'action', 'zk_proof', 'nullifier', 'timestamp', 'metadata'];
    const csvLines = [headers.join(',')];

    for (const row of rows) {
      const values = headers.map((h) => {
        const val = row[h];
        if (val === null || val === undefined) return '';
        const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
        // Escape CSV: wrap in quotes if contains comma, quote, or newline
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      });
      csvLines.push(values.join(','));
    }

    return new Response(csvLines.join('\n'), {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="access-logs-${keySlotId}.csv"`,
      },
    });
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}
