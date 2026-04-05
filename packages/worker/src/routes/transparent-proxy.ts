import type { Env, KeySlotRecord, UserRecord, DevKeyRecord } from '../types.js';
import { authenticateDevKey } from '../lib/auth.js';
import { checkKeyRateLimit, checkTierRateLimit } from '../lib/rate-limit.js';
import { getSupabase } from '../lib/supabase.js';
import { cacheGet, cacheSet } from '../lib/cache.js';
import { memGet, memSet } from '../lib/mem-cache.js';
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

/**
 * Fire threshold alerts (webhook + email log) when usage exceeds the
 * configured alertThreshold on a developer key. Uses KV to ensure
 * the alert fires only once per hour per key.
 */
async function fireThresholdAlerts(
  env: Env,
  devKey: DevKeyRecord,
  currentCount: number,
): Promise<void> {
  const threshold = devKey.alert_threshold;
  if (!threshold || currentCount < threshold) return;

  // Check if alert already sent this hour (dedup via KV)
  const hourKey = `alert:${devKey.id}:${new Date().toISOString().slice(0, 13)}`;
  const alreadySent = await env.CACHE.get(hourKey);
  if (alreadySent) return;

  // Mark alert as sent for this hour (soft-expiry: 3600s)
  await env.CACHE.put(hourKey, '1', { expirationTtl: 3600 });

  const timestamp = new Date().toISOString();

  // Webhook notification
  if (devKey.webhook_url) {
    const payload = JSON.stringify({
      event: 'usage_threshold_exceeded',
      key_id: devKey.id,
      key_label: devKey.label,
      threshold,
      current_count: currentCount,
      timestamp,
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Sign with HMAC-SHA256 if webhook_secret is set
    if (devKey.webhook_secret) {
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(devKey.webhook_secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
      const sigHex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
      headers['X-VaultProof-Signature'] = sigHex;
    }

    // Fire non-blocking — do not slow down the proxy response
    fetch(devKey.webhook_url, {
      method: 'POST',
      headers,
      body: payload,
    }).catch(() => { /* webhook delivery is best-effort */ });
  }

  // Email alert: log to scan_alerts table for now
  // TODO: Integrate with Resend or SendGrid to actually send emails
  if (devKey.alert_email) {
    const supabase = getSupabase(env);
    await supabase.from('scan_alerts').insert({
      id: crypto.randomUUID(),
      user_id: devKey.user_id,
      schedule_id: null,
      scan_id: null,
      repo_full_name: 'usage-alert',
      provider: 'proxy',
      file: `key:${devKey.label}`,
      masked_value: `threshold=${threshold}, count=${currentCount}, email=${devKey.alert_email}`,
      created_at: timestamp,
    });
  }
}

export async function handleTransparentProxy(
  request: Request,
  env: Env,
  path: string,
  ctx?: ExecutionContext,
): Promise<Response> {
  const t0 = performance.now();
  const timings: Record<string, number> = {};

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
  timings.provider = performance.now() - t0;
  let tStep = performance.now();
  const auth = await authenticateDevKey(request, env, ctx);
  if (!auth) {
    return Response.json({ error: 'API key not recognized.' }, { status: 401 });
  }

  timings.auth = performance.now() - tStep;

  // IP allowlist check
  if (auth.devKey.allowed_ips) {
    const clientIp = request.headers.get('cf-connecting-ip') || '';
    const allowedIps = auth.devKey.allowed_ips.split(',').map(ip => ip.trim());
    if (!allowedIps.includes(clientIp)) {
      return Response.json({ error: 'IP not allowed for this API key' }, { status: 403 });
    }
  }

  // Origin allowlist check
  if (auth.devKey.allowed_origins) {
    const origin = request.headers.get('origin') || '';
    const allowed = auth.devKey.allowed_origins.split(',').map(o => o.trim().toLowerCase());
    if (!origin && auth.devKey.strict_origin) {
      return Response.json({ error: 'Origin header required for this API key' }, { status: 403 });
    }
    if (origin && !allowed.includes(origin.toLowerCase())) {
      return Response.json({ error: 'Origin not allowed for this API key' }, { status: 403 });
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

  // e. Fetch user + key slot (L1: memory, L2: KV, L3: Supabase)
  tStep = performance.now();
  const supabase = getSupabase(env);
  const userCacheKey = `user:${auth.userId}`;
  const keyCacheKey = `keyslot:${auth.userId}:${provider}`;

  // L1: isolate memory (no I/O)
  let user = memGet<UserRecord>(userCacheKey);
  let keySlot = memGet<KeySlotRecord>(keyCacheKey);

  // L2: KV (if memory miss)
  if (!user || !keySlot) {
    const [kvUser, kvKey] = await Promise.all([
      user ? Promise.resolve(null) : cacheGet<UserRecord>(env, userCacheKey),
      keySlot ? Promise.resolve(null) : cacheGet<KeySlotRecord>(env, keyCacheKey),
    ]);
    if (kvUser) { user = kvUser; memSet(userCacheKey, user, 10); }
    if (kvKey) { keySlot = kvKey; memSet(keyCacheKey, keySlot, 10); }
  }

  // L3: Supabase (if KV miss)
  const fetchPromises: Promise<any>[] = [];
  if (!user) fetchPromises.push(supabase.from('users').select('id, email, tier, kill_switch, global_daily_limit, global_monthly_limit').eq('id', auth.userId).single());
  else fetchPromises.push(Promise.resolve(null));
  if (!keySlot) fetchPromises.push(supabase.from('key_slots').select('*').eq('user_id', auth.userId).eq('provider', provider).eq('status', 'ACTIVE').order('created_at', { ascending: false }).limit(1).single());
  else fetchPromises.push(Promise.resolve(null));

  const [userRes, keyRes] = await Promise.all(fetchPromises);
  if (userRes?.data && !userRes.error) { user = userRes.data; memSet(userCacheKey, user, 10); await cacheSet(env, userCacheKey, user, 10); }
  if (keyRes?.data && !keyRes.error) { keySlot = keyRes.data; memSet(keyCacheKey, keySlot, 10); await cacheSet(env, keyCacheKey, keySlot, 10); }

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

  timings.fetch = performance.now() - tStep;

  // f. Tier rate limiting
  tStep = performance.now();
  const tier = user?.tier || 'free';
  const rateCheck = await checkTierRateLimit(env, keySlot.id, tier);
  if (!rateCheck.allowed) {
    return Response.json({ error: 'Monthly call limit exceeded.', used: rateCheck.used, limit: rateCheck.limit }, { status: 429 });
  }

  timings.rateLimit = performance.now() - tStep;

  // g. Reconstruct API key
  tStep = performance.now();
  // Cache decrypted Share 1 in isolate memory (5s TTL) to skip scrypt on warm requests.
  // Share 1 alone is useless without Share 2 + the user's vp_ key, so this is safe.
  let apiKey: string | null = null;

  try {
    const share1CacheKey = `s1:${keySlot.id}`;
    let share1Str = memGet<string>(share1CacheKey);
    if (!share1Str) {
      const share1Bytes = hexToBytes(keySlot.share1_encrypted);
      const decryptedShare1 = decrypt(share1Bytes, env);
      share1Str = new TextDecoder().decode(decryptedShare1);
      zeroUint8Array(decryptedShare1);
      memSet(share1CacheKey, share1Str, 5);
    }

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

  timings.crypto = performance.now() - tStep;

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
  tStep = performance.now();
  const startTime = Date.now();
  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers: forwardHeaders,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
    });

    // Log access — must use waitUntil or CF Workers kills the promise after response
    const latencyMs = Date.now() - startTime;
    const logPromise = supabase.from('access_logs').insert({
      id: crypto.randomUUID(),
      key_slot_id: keySlot.id,
      app_id: 'transparent-proxy',
      action: 'transparent_proxy',
      zk_proof: 'n/a',
      nullifier: crypto.randomUUID(),
      metadata: JSON.stringify({ provider, endpoint: wildcardPath, status_code: upstreamResponse.status, latency_ms: latencyMs }),
    }).then(({ error: insertErr }) => {
      if (insertErr) console.error('[access_log] insert failed:', insertErr.message, insertErr.details);
    });
    if (ctx) ctx.waitUntil(Promise.resolve(logPromise));

    // Check threshold alerts — also needs waitUntil
    if (auth.devKey.alert_threshold || auth.devKey.webhook_url || auth.devKey.alert_email) {
      const alertPromise = fireThresholdAlerts(env, auth.devKey, rateCheck.used).catch(() => {});
      if (ctx) ctx.waitUntil(alertPromise);
    }

    timings.upstream = performance.now() - tStep;
    timings.total = performance.now() - t0;

    const responseHeaders = new Headers(upstreamResponse.headers);
    if (rateCheck.nearLimit) {
      responseHeaders.set('X-VaultProof-Usage-Warning', `${rateCheck.used}/${rateCheck.limit} calls used this month`);
    }
    // Server-Timing header for latency visibility (visible in DevTools Network tab)
    const serverTiming = Object.entries(timings)
      .map(([k, v]) => `${k};dur=${v.toFixed(1)}`)
      .join(', ');
    responseHeaders.set('Server-Timing', serverTiming);

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  } catch {
    return Response.json({ error: 'Upstream API error.' }, { status: 502 });
  }
}
