import type { Env, KeySlotRecord, UserRecord } from '../types.js';
import { authenticateDevKey } from '../lib/auth.js';
import { checkKeyRateLimit, checkTierRateLimit } from '../lib/rate-limit.js';
import { getSupabase } from '../lib/supabase.js';
import { cacheGet, cacheSet } from '../lib/cache.js';
import { decrypt, zeroUint8Array } from '../crypto/encryption.js';
import { decryptShare2, decryptShare2Legacy } from '../crypto/share2.js';
import { deserializeShare, combineShares } from '../crypto/shamir.js';

const PROVIDERS: Record<string, { upstream: string; authHeader: (key: string) => Record<string, string> }> = {
  openai: { upstream: 'https://api.openai.com', authHeader: (k) => ({ Authorization: `Bearer ${k}` }) },
  anthropic: { upstream: 'https://api.anthropic.com', authHeader: (k) => ({ 'x-api-key': k, 'anthropic-version': '2023-06-01' }) },
  google: { upstream: 'https://generativelanguage.googleapis.com', authHeader: (k) => ({ 'x-goog-api-key': k }) },
  together: { upstream: 'https://api.together.xyz', authHeader: (k) => ({ Authorization: `Bearer ${k}` }) },
  mistral: { upstream: 'https://api.mistral.ai', authHeader: (k) => ({ Authorization: `Bearer ${k}` }) },
  cohere: { upstream: 'https://api.cohere.com', authHeader: (k) => ({ Authorization: `Bearer ${k}` }) },
  groq: { upstream: 'https://api.groq.com', authHeader: (k) => ({ Authorization: `Bearer ${k}` }) },
  perplexity: { upstream: 'https://api.perplexity.ai', authHeader: (k) => ({ Authorization: `Bearer ${k}` }) },
  fireworks: { upstream: 'https://api.fireworks.ai', authHeader: (k) => ({ Authorization: `Bearer ${k}` }) },
  deepseek: { upstream: 'https://api.deepseek.com', authHeader: (k) => ({ Authorization: `Bearer ${k}` }) },
  replicate: { upstream: 'https://api.replicate.com', authHeader: (k) => ({ Authorization: `Bearer ${k}` }) },
  stripe: { upstream: 'https://api.stripe.com', authHeader: (k) => ({ Authorization: `Bearer ${k}` }) },
  minimax: { upstream: 'https://api.minimax.io', authHeader: (k) => ({ Authorization: `Bearer ${k}` }) },
};

const DYNAMIC_PROVIDERS: Record<string, {
  buildUpstream: (segments: string[]) => { url: string; remainingPath: string } | null;
  authHeader: (key: string) => Record<string, string>;
}> = {
  supabase: {
    buildUpstream: (segments) => {
      if (segments.length < 2) return null;
      const projectRef = segments[0];
      if (!/^[a-z0-9]{20}$/.test(projectRef)) return null;
      return { url: `https://${projectRef}.supabase.co`, remainingPath: '/' + segments.slice(1).join('/') };
    },
    authHeader: (k) => ({ apikey: k, Authorization: `Bearer ${k}` }),
  },
};

const SAFE_FORWARD_HEADERS = new Set([
  'content-type', 'accept', 'accept-encoding', 'accept-language',
  'cache-control', 'user-agent', 'anthropic-version', 'openai-beta',
  'stripe-version', 'idempotency-key', 'prefer',
]);

// Supabase REST returns bytea columns as PostgreSQL hex: \xABCD...
function hexToBytes(hex: string): Uint8Array {
  // Strip leading \x if present
  const clean = hex.startsWith('\\x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    throw new Error('Invalid hex string: odd length');
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16);
  }
  return bytes;
}

export async function handleTransparentProxy(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  // a. Extract provider
  const slashIdx = path.indexOf('/');
  const provider = slashIdx === -1 ? path : path.substring(0, slashIdx);
  const wildcardPath = slashIdx === -1 ? '' : path.substring(slashIdx + 1);

  const providerConfig = PROVIDERS[provider];
  const dynamicConfig = !providerConfig ? DYNAMIC_PROVIDERS[provider] : null;
  if (!providerConfig && !dynamicConfig) {
    return Response.json({ error: 'Unknown provider.' }, { status: 400 });
  }

  // b. Authenticate
  const auth = await authenticateDevKey(request, env);
  if (!auth) {
    return Response.json({ error: 'API key not recognized.' }, { status: 401 });
  }

  // IP allowlist check
  if (auth.devKey.allowed_ips) {
    const clientIp = request.headers.get('cf-connecting-ip') || '';
    const allowedIps = auth.devKey.allowed_ips.split(',').map(ip => ip.trim());
    if (!allowedIps.includes(clientIp)) {
      return Response.json({ error: 'IP not allowed for this API key' }, { status: 403 });
    }
  }

  // c. Per-key rate limit
  if (!checkKeyRateLimit(auth.keyId)) {
    return Response.json({ error: 'Rate limit exceeded (60 req/min).' }, { status: 429 });
  }

  // d. Restrictions
  if (auth.devKey.allowed_providers) {
    const allowed = auth.devKey.allowed_providers.split(',').map(s => s.trim());
    if (!allowed.includes(provider)) {
      return Response.json({ error: `Provider '${provider}' not allowed.` }, { status: 403 });
    }
  }
  if (auth.devKey.allowed_endpoints) {
    const allowed = auth.devKey.allowed_endpoints.split(',').map(s => s.trim());
    const reqPath = '/' + wildcardPath;
    // Exact segment match: allowed endpoint must equal the path OR be a path prefix
    // followed by '/' (not just any string prefix — prevents /models matching /models-admin)
    if (!allowed.some(ep => reqPath === ep || reqPath.startsWith(ep + '/'))) {
      return Response.json({ error: 'Endpoint not allowed.' }, { status: 403 });
    }
  }

  // e. Fetch user + key slot (parallel, with KV cache)
  const supabase = getSupabase(env);
  const userCacheKey = `user:${auth.userId}`;
  const keyCacheKey = `keyslot:${auth.userId}:${provider}`;

  let [user, keySlot] = await Promise.all([
    cacheGet<UserRecord>(env, userCacheKey),
    cacheGet<KeySlotRecord>(env, keyCacheKey),
  ]);

  const fetchPromises: Promise<any>[] = [];
  if (!user) fetchPromises.push(supabase.from('users').select('id, email, tier, kill_switch, global_daily_limit, global_monthly_limit').eq('id', auth.userId).single());
  else fetchPromises.push(Promise.resolve(null));
  if (!keySlot) fetchPromises.push(supabase.from('key_slots').select('*').eq('user_id', auth.userId).eq('provider', provider).eq('status', 'ACTIVE').order('created_at', { ascending: false }).limit(1).single());
  else fetchPromises.push(Promise.resolve(null));

  const [userRes, keyRes] = await Promise.all(fetchPromises);
  if (userRes?.data && !userRes.error) { user = userRes.data; await cacheSet(env, userCacheKey, user, 10); }
  if (keyRes?.data && !keyRes.error) { keySlot = keyRes.data; await cacheSet(env, keyCacheKey, keySlot, 10); }

  if (user?.kill_switch) {
    return Response.json({ error: 'All proxy calls are paused.' }, { status: 503 });
  }
  if (!keySlot) {
    return Response.json({ error: `No active ${provider} key stored.` }, { status: 404 });
  }
  if (keySlot.expires_at && new Date(keySlot.expires_at) < new Date()) {
    return Response.json({ error: 'Key has expired.' }, { status: 410 });
  }
  if (!keySlot.share2_encrypted) {
    return Response.json({ error: 'Key cannot be reconstructed.' }, { status: 400 });
  }

  // Key slot restriction
  if (auth.devKey.allowed_key_slot_ids) {
    const allowed = auth.devKey.allowed_key_slot_ids.split(',').map(s => s.trim());
    if (!allowed.includes(keySlot.id)) {
      return Response.json({ error: 'Key slot not allowed for this API key.' }, { status: 403 });
    }
  }

  // f. Tier rate limiting
  const tier = user?.tier || 'free';
  const rateCheck = await checkTierRateLimit(env, keySlot.id, tier);
  if (!rateCheck.allowed) {
    return Response.json({ error: 'Monthly call limit exceeded.', used: rateCheck.used, limit: rateCheck.limit }, { status: 429 });
  }

  // g. Reconstruct API key (in-memory only, never cached)
  let apiKey: string | null = null;

  try {
    const share1Bytes = hexToBytes(keySlot.share1_encrypted);
    const decryptedShare1 = decrypt(share1Bytes, env);
    const share1Str = new TextDecoder().decode(decryptedShare1);
    zeroUint8Array(decryptedShare1);

    const share2Bytes = hexToBytes(keySlot.share2_encrypted!);
    let share2Str: string;
    try {
      share2Str = await decryptShare2(share2Bytes, auth.rawKey);
    } catch {
      share2Str = decryptShare2Legacy(share2Bytes, auth.rawKey);
    }

    const share1 = deserializeShare(share1Str);
    const share2 = deserializeShare(share2Str);
    const combined = combineShares([share1, share2]);
    apiKey = new TextDecoder().decode(combined);
    zeroUint8Array(combined);
  } catch {
    return Response.json({ error: 'Key reconstruction failed.' }, { status: 400 });
  }

  // h. Build upstream URL
  let upstreamUrl: string;
  if (providerConfig) {
    upstreamUrl = `${providerConfig.upstream}/${wildcardPath}`;
  } else {
    const segments = wildcardPath.split('/');
    const resolved = dynamicConfig!.buildUpstream(segments);
    if (!resolved) {
      apiKey = '';
      return Response.json({ error: `Invalid ${provider} URL.` }, { status: 400 });
    }
    upstreamUrl = `${resolved.url}${resolved.remainingPath}`;
  }

  const url = new URL(request.url);
  if (url.search) upstreamUrl += url.search;

  // i. Forward headers
  const forwardHeaders: Record<string, string> = {};
  for (const [key, value] of request.headers.entries()) {
    if (SAFE_FORWARD_HEADERS.has(key.toLowerCase())) {
      forwardHeaders[key] = value;
    }
  }
  const authHeaders = providerConfig ? providerConfig.authHeader(apiKey) : dynamicConfig!.authHeader(apiKey);
  Object.assign(forwardHeaders, authHeaders);
  apiKey = '';

  // j. Proxy the request
  const startTime = Date.now();
  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers: forwardHeaders,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
    });

    // Log access non-blocking
    const latencyMs = Date.now() - startTime;
    supabase.from('access_logs').insert({
      key_slot_id: keySlot.id,
      app_id: 'transparent-proxy',
      action: 'transparent_proxy',
      zk_proof: 'n/a',
      nullifier: crypto.randomUUID(),
      metadata: JSON.stringify({ provider, endpoint: wildcardPath, status_code: upstreamResponse.status, latency_ms: latencyMs }),
    }).then(() => {});

    const responseHeaders = new Headers(upstreamResponse.headers);
    if (rateCheck.nearLimit) {
      responseHeaders.set('X-VaultProof-Usage-Warning', `${rateCheck.used}/${rateCheck.limit} calls used this month`);
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  } catch {
    return Response.json({ error: 'Upstream API error.' }, { status: 502 });
  }
}
