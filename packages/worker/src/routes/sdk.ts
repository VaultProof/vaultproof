import type { Env } from '../types.js';
import { authenticateDevKey } from '../lib/auth.js';
import { getSupabase } from '../lib/supabase.js';
import { encrypt } from '../crypto/encryption.js';

const PROVIDER_WHITELIST = new Set([
  'openai',
  'anthropic',
  'google',
  'together',
  'mistral',
  'cohere',
  'groq',
  'perplexity',
  'fireworks',
  'deepseek',
  'replicate',
  'stripe',
  'minimax',
]);

export async function handleSdk(
  request: Request,
  env: Env,
  path: string,
  ctx?: ExecutionContext,
): Promise<Response> {
  const auth = await authenticateDevKey(request, env, ctx);
  if (!auth) return Response.json({ error: 'Invalid API key format. Keys start with vp_live_ or vp_test_. Get yours from the VaultProof dashboard.' }, { status: 401 });

  const method = request.method;
  const supabase = getSupabase(env);

  // ── GET /sdk/keys ────────────────────────────────────────────────────
  if (path === 'keys' && method === 'GET') {
    const { data: slots, error } = await supabase
      .from('key_slots')
      .select('id, provider, label, env_var, created_at')
      .eq('user_id', auth.userId)
      .eq('status', 'ACTIVE');

    if (error) {
      return Response.json({ error: 'Failed to fetch keys' }, { status: 500 });
    }

    const keys = (slots || []).map((slot: any) => ({
      id: slot.id,
      provider: slot.provider,
      label: slot.label,
      envVar: slot.env_var,
      createdAt: slot.created_at,
    }));

    return Response.json({ keys });
  }

  // ── POST /sdk/store ──────────────────────────────────────────────────
  if (path === 'store' && method === 'POST') {
    let body: any;
    try {
      body = await request.json<any>();
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const { share1, share2, provider, label } = body;

    if (!share1 || !provider) {
      return Response.json(
        { error: 'Missing required fields: share1, provider' },
        { status: 400 },
      );
    }

    if (!PROVIDER_WHITELIST.has(provider)) {
      return Response.json(
        { error: `Invalid provider: ${provider}. Allowed: ${[...PROVIDER_WHITELIST].join(', ')}` },
        { status: 400 },
      );
    }

    // Encrypt share1 with VAULT_ENCRYPTION_KEY
    const share1Bytes = Uint8Array.from(atob(share1), (c) => c.charCodeAt(0));
    const encryptedBytes = encrypt(share1Bytes, env);
    const share1Encrypted = btoa(String.fromCharCode(...encryptedBytes));

    const keyId = crypto.randomUUID();
    const now = new Date().toISOString();

    const insertData: Record<string, any> = {
      id: keyId,
      user_id: auth.userId,
      provider,
      label: label || null,
      share1_encrypted: share1Encrypted,
      vault_commitment: crypto.randomUUID(),
      auth_apps_root: '',
      status: 'ACTIVE',
      created_at: now,
    };
    if (share2) {
      insertData.share2_encrypted = share2;
    }

    const { error: insertError } = await supabase.from('key_slots').insert(insertData);

    if (insertError) {
      return Response.json({ error: 'Failed to store key' }, { status: 500 });
    }

    // Create an app_grant row for the dev key's app
    const grantId = crypto.randomUUID();
    await supabase.from('app_grants').insert({
      id: grantId,
      key_slot_id: keyId,
      app_id: auth.keyId,
      app_name: 'SDK',
      granted_at: now,
    });

    return Response.json({ keyId, provider, label: label || null }, { status: 201 });
  }

  // ── POST /sdk/revoke ─────────────────────────────────────────────────
  if (path === 'revoke' && method === 'POST') {
    let body: any;
    try {
      body = await request.json<any>();
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const { keyId } = body;

    if (!keyId) {
      return Response.json({ error: 'Missing required field: keyId' }, { status: 400 });
    }

    // Verify ownership
    const { data: slot, error } = await supabase
      .from('key_slots')
      .select('id, user_id')
      .eq('id', keyId)
      .eq('user_id', auth.userId)
      .single();

    if (error || !slot) {
      return Response.json({ error: 'Key not found' }, { status: 404 });
    }

    const { error: updateError } = await supabase
      .from('key_slots')
      .update({
        status: 'REVOKED',
        share1_encrypted: null,
        share2_encrypted: null,
      })
      .eq('id', keyId);

    if (updateError) {
      return Response.json({ error: 'Failed to revoke key' }, { status: 500 });
    }

    return Response.json({ status: 'revoked' });
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}
