/**
 * Transparent Proxy — The killer feature.
 *
 * Users keep their existing OpenAI/Anthropic/etc SDKs and just change the base URL:
 *   api.openai.com  ->  api.vaultproof.dev/v1/openai
 *
 * VaultProof reconstructs the real API key from Shamir shares, swaps the
 * Authorization header, and forwards the request transparently. The SDK
 * never sees the real key.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { deserializeShare, combine } from '@vaultproof/shamir';
import { decrypt, zeroBuffer } from '../crypto/encryption.js';
import { decryptShare2 } from '../crypto/share2-encryption.js';
import { authenticateDevKey } from './developer-keys.js';
import { randomBytes } from 'crypto';
import { sendUsageAlert, sendInvalidKeyAlert } from '../services/email.js';
import { sendWebhook } from '../services/webhook.js';

const NON_PROXY_PROVIDERS = new Set(['aws', 'twilio', 'sendgrid', 'github', 'firebase', 'smtp', 'mailgun', 'postmark']);

const PROVIDERS: Record<string, { upstream: string; authHeader: (key: string) => Record<string, string> }> = {
  openai: {
    upstream: 'https://api.openai.com',
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  anthropic: {
    upstream: 'https://api.anthropic.com',
    authHeader: (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
  },
  google: {
    upstream: 'https://generativelanguage.googleapis.com',
    authHeader: (key) => ({ 'x-goog-api-key': key }),
  },
  together: {
    upstream: 'https://api.together.xyz',
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  mistral: {
    upstream: 'https://api.mistral.ai',
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  cohere: {
    upstream: 'https://api.cohere.com',
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  groq: {
    upstream: 'https://api.groq.com',
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  perplexity: {
    upstream: 'https://api.perplexity.ai',
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  fireworks: {
    upstream: 'https://api.fireworks.ai',
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  deepseek: {
    upstream: 'https://api.deepseek.com',
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  replicate: {
    upstream: 'https://api.replicate.com',
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  stripe: {
    upstream: 'https://api.stripe.com',
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
  },
};

// Providers with per-project upstream URLs.
// Format: /v1/supabase/<project-ref>/rest/v1/table
const DYNAMIC_PROVIDERS: Record<string, {
  buildUpstream: (segments: string[]) => { url: string; remainingPath: string } | null;
  authHeader: (key: string) => Record<string, string>;
}> = {
  supabase: {
    buildUpstream: (segments) => {
      // segments[0] = project ref, rest = path
      if (segments.length < 2) return null;
      const projectRef = segments[0];
      if (!/^[a-z0-9]+$/.test(projectRef)) return null;
      const remainingPath = '/' + segments.slice(1).join('/');
      return { url: `https://${projectRef}.supabase.co`, remainingPath };
    },
    authHeader: (key) => ({ apikey: key, Authorization: `Bearer ${key}` }),
  },
};

/**
 * Fallback map for OpenAI-compatible providers.
 * If the primary provider returns 5xx, we can retry with a compatible fallback.
 */
const FALLBACK_MAP: Record<string, string[]> = {
  openai: ['groq', 'together', 'deepseek', 'fireworks'],
  groq: ['openai', 'together', 'deepseek'],
  together: ['openai', 'groq', 'deepseek'],
  deepseek: ['openai', 'groq', 'together'],
  fireworks: ['openai', 'groq', 'together'],
};

// Allowlist: only these headers are forwarded to upstream providers.
// Using allowlist (not blacklist) prevents arbitrary header injection.
const ALLOWED_FORWARD_HEADERS = new Set([
  'content-type',
  'accept',
  'accept-encoding',
  'accept-language',
  'cache-control',
  'user-agent',
  // Provider-specific safe headers
  'anthropic-version',
  'openai-beta',
  'x-stainless-lang',
  'x-stainless-package-version',
  'x-stainless-os',
  'x-stainless-runtime',
  'x-stainless-runtime-version',
]);

// Per dev-key rate limiter — 60 calls/min per key (in-memory, resets on restart)
const keyRateLimitMap = new Map<string, { tokens: number; windowStart: number }>();
const KEY_RATE_LIMIT = 60;
const KEY_RATE_WINDOW = 60_000;

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [keyId, bucket] of keyRateLimitMap) {
    if (now - bucket.windowStart >= KEY_RATE_WINDOW) keyRateLimitMap.delete(keyId);
  }
}, 5 * 60_000);

function checkKeyRateLimit(keyId: string): boolean {
  const now = Date.now();
  const bucket = keyRateLimitMap.get(keyId);
  if (!bucket || now - bucket.windowStart >= KEY_RATE_WINDOW) {
    keyRateLimitMap.set(keyId, { tokens: KEY_RATE_LIMIT - 1, windowStart: now });
    return true;
  }
  if (bucket.tokens <= 0) return false;
  bucket.tokens--;
  return true;
}

export async function transparentProxyRoutes(app: FastifyInstance) {
  // Preserve raw body for exact passthrough to upstream providers.
  // Fastify normally parses JSON; we keep the original buffer so upstream
  // receives byte-identical payloads (important for signatures, etc.).
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    (req as any).rawBody = body;
    try {
      done(null, JSON.parse(body.toString()));
    } catch (e) {
      done(e as Error, undefined);
    }
  });

  app.all('/:provider/*', async (request: FastifyRequest, reply: FastifyReply) => {
    // --- a. Extract and validate provider ---
    const { provider } = request.params as { provider: string; '*': string };
    const wildcardPath = (request.params as any)['*'] as string;

    const providerConfig = PROVIDERS[provider];
    const dynamicConfig = !providerConfig ? DYNAMIC_PROVIDERS[provider] : null;
    if (!providerConfig && !dynamicConfig) {
      if (NON_PROXY_PROVIDERS.has(provider)) {
        return reply.status(400).send({
          error: `"${provider}" doesn't support the transparent proxy yet. See https://vaultproof.dev/docs#sdk-reference`,
        });
      }
      const supported = [...Object.keys(PROVIDERS), ...Object.keys(DYNAMIC_PROVIDERS)].join(', ');
      return reply.status(400).send({
        error: `Unknown provider "${provider}". Supported: ${supported}.`,
      });
    }

    // --- b. Authenticate developer key (vp_live_ from Authorization header) ---
    const authHeader = request.headers.authorization as string;
    const apiKeyHeader = request.headers['x-api-key'] as string;
    const rawKeyValue = apiKeyHeader || (authHeader ? authHeader.slice(7) : '');
    if (rawKeyValue && !rawKeyValue.startsWith('vp_')) {
      return reply.status(401).send({ error: 'Invalid API key format. Keys start with vp_live_ or vp_test_. Get yours from the VaultProof dashboard.' });
    }

    const auth = await authenticateDevKey(request, reply);
    if (!auth) {
      if (!rawKeyValue) {
        return reply.status(401).send({ error: 'Invalid API key format. Keys start with vp_live_ or vp_test_. Get yours from the VaultProof dashboard.' });
      }
      if ((request as any).__vpKeyRevoked) {
        return reply.status(401).send({ error: 'This API key has been revoked. Create a new one in the VaultProof dashboard.' });
      }
      return reply.status(401).send({ error: 'API key not recognized. It may have been revoked or never existed. Check your VAULTPROOF_API_KEY.' });
    }

    // --- b2. Per-key rate limit ---
    if (!checkKeyRateLimit(auth.keyId)) {
      return reply.status(429).send({ error: 'Rate limit exceeded for this API key (60 req/min). Slow down or upgrade your plan.' });
    }

    // --- b3. Enforce IP allowlist ---
    if (auth.devKey.allowedIps) {
      // Only trust cf-connecting-ip if the request came through the CF Worker (has proxy signature)
      const hasProxySignature = !!request.headers['x-proxy-signature'];
      const clientIp = hasProxySignature ? (request.headers['cf-connecting-ip'] as string) || request.ip : request.ip;
      const allowed = auth.devKey.allowedIps.split(',').map((s: string) => s.trim());
      if (!allowed.includes(clientIp)) {
        return reply.status(403).send({ error: 'IP not allowed for this API key' });
      }
    }

    // --- b4. Enforce provider restriction ---
    if (auth.devKey.allowedProviders) {
      const allowed = auth.devKey.allowedProviders.split(',').map((s: string) => s.trim());
      if (!allowed.includes(provider)) {
        return reply.status(403).send({ error: `Provider '${provider}' not allowed for this API key` });
      }
    }

    // --- b5. Enforce endpoint restriction ---
    if (auth.devKey.allowedEndpoints) {
      const allowed = auth.devKey.allowedEndpoints.split(',').map((s: string) => s.trim());
      const requestPath = '/' + wildcardPath;
      if (!allowed.some((ep: string) => requestPath.startsWith(ep))) {
        return reply.status(403).send({ error: 'Endpoint not allowed for this API key' });
      }
    }

    // --- Parallel DB queries: user account + key slot in one round trip ---
    const [userAccount, keySlot] = await Promise.all([
      prisma.user.findUnique({
        where: { id: auth.userId },
        select: { killSwitch: true, globalDailyLimit: true, globalMonthlyLimit: true, tier: true },
      }),
      prisma.keySlot.findFirst({
        where: { userId: auth.userId, provider, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    // --- Kill switch ---
    if (userAccount?.killSwitch) {
      return reply.status(503).send({ error: 'All proxy calls are paused. Disable the kill switch in your dashboard to resume.' });
    }

    if (!keySlot) {
      return reply.status(404).send({
        error: `No active ${provider} key stored. Use the SDK to store a key first.`,
      });
    }

    // --- d. Check expiry ---
    if (keySlot.expiresAt && new Date(keySlot.expiresAt) < new Date()) {
      return reply.status(410).send({ error: 'Key has expired', expiresAt: keySlot.expiresAt });
    }

    const proxyTier = (userAccount?.tier as string) || 'free';

    // --- Global + per-key limits (parallel where possible) ---
    const needsGlobalLimits = userAccount?.globalDailyLimit || userAccount?.globalMonthlyLimit;
    const needsKeyLimits = keySlot.dailyLimit || keySlot.monthlyLimit;

    if (needsGlobalLimits || needsKeyLimits) {
      const now = new Date();
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      // Build all count queries in parallel
      const countQueries: Promise<number>[] = [];
      const queryLabels: string[] = [];

      if (userAccount?.globalDailyLimit) {
        countQueries.push(
          prisma.keySlot.findMany({ where: { userId: auth.userId }, select: { id: true } })
            .then(slots => slots.length === 0 ? 0 : prisma.accessLog.count({
              where: { keySlotId: { in: slots.map(k => k.id) }, action: 'transparent_proxy', timestamp: { gte: dayStart } },
            }))
        );
        queryLabels.push('globalDaily');
      }
      if (userAccount?.globalMonthlyLimit) {
        countQueries.push(
          prisma.keySlot.findMany({ where: { userId: auth.userId }, select: { id: true } })
            .then(slots => slots.length === 0 ? 0 : prisma.accessLog.count({
              where: { keySlotId: { in: slots.map(k => k.id) }, action: 'transparent_proxy', timestamp: { gte: monthStart } },
            }))
        );
        queryLabels.push('globalMonthly');
      }
      if (keySlot.dailyLimit) {
        countQueries.push(
          prisma.accessLog.count({
            where: { keySlotId: keySlot.id, action: 'transparent_proxy', timestamp: { gte: dayStart } },
          })
        );
        queryLabels.push('keyDaily');
      }
      if (keySlot.monthlyLimit) {
        countQueries.push(
          prisma.accessLog.count({
            where: { keySlotId: keySlot.id, action: 'transparent_proxy', timestamp: { gte: monthStart } },
          })
        );
        queryLabels.push('keyMonthly');
      }

      const counts = await Promise.all(countQueries);
      const countMap = Object.fromEntries(queryLabels.map((l, i) => [l, counts[i]]));

      // Check global limits
      if (userAccount?.globalDailyLimit && countMap.globalDaily >= userAccount.globalDailyLimit) {
        return reply.status(429).send({ error: 'Global daily call limit reached', limit: userAccount.globalDailyLimit, used: countMap.globalDaily });
      }
      if (userAccount?.globalMonthlyLimit && countMap.globalMonthly >= userAccount.globalMonthlyLimit) {
        return reply.status(429).send({ error: 'Global monthly call limit reached', limit: userAccount.globalMonthlyLimit, used: countMap.globalMonthly });
      }

      // Check per-key limits
      if (keySlot.dailyLimit && countMap.keyDaily >= keySlot.dailyLimit) {
        if (keySlot.blockOnLimit && proxyTier === 'free') {
          return reply.status(429).send({ error: 'Daily call limit reached', limit: keySlot.dailyLimit, used: countMap.keyDaily, resets: 'midnight UTC' });
        }
        if (keySlot.blockOnLimit) {
          request.log.info({ msg: 'Daily overage call allowed', keySlotId: keySlot.id, tier: proxyTier, used: countMap.keyDaily, limit: keySlot.dailyLimit });
        }
        if (auth.devKey.alertEmail) {
          sendUsageAlert(auth.devKey.alertEmail, keySlot.label, countMap.keyDaily, keySlot.dailyLimit);
        }
      }
      if (keySlot.monthlyLimit && countMap.keyMonthly >= keySlot.monthlyLimit) {
        if (keySlot.blockOnLimit && proxyTier === 'free') {
          return reply.status(429).send({ error: 'Monthly call limit reached', limit: keySlot.monthlyLimit, used: countMap.keyMonthly, resets: 'next month' });
        }
        if (keySlot.blockOnLimit) {
          request.log.info({ msg: 'Monthly overage call allowed', keySlotId: keySlot.id, tier: proxyTier, used: countMap.keyMonthly, limit: keySlot.monthlyLimit });
        }
        if (auth.devKey.alertEmail) {
          sendUsageAlert(auth.devKey.alertEmail, keySlot.label, countMap.keyMonthly, keySlot.monthlyLimit);
        }
      }
    }

    if (!keySlot.share2Encrypted || keySlot.share2Encrypted.length === 0) {
      return reply.status(400).send({ error: 'Key cannot be reconstructed. It may have been revoked or corrupted. Try re-storing the key.' });
    }

    // --- Helper: reconstruct API key from a key slot's shares ---
    function reconstructKey(slot: NonNullable<typeof keySlot>): string {
      let ds1: Buffer | null = null;
      try {
        ds1 = decrypt(Buffer.from(slot.share1Encrypted));
        const s1 = deserializeShare(ds1.toString('utf-8'));
        zeroBuffer(ds1);
        ds1 = null;
        const share2Str = decryptShare2(Buffer.from(slot.share2Encrypted!), auth!.rawKey);
        const s2 = deserializeShare(share2Str);
        return new TextDecoder().decode(combine([s1, s2]));
      } catch (err) {
        if (ds1) zeroBuffer(ds1);
        throw err;
      }
    }

    // --- e. Reconstruct API key from both encrypted shares ---
    let apiKey: string;
    try {
      apiKey = reconstructKey(keySlot);
    } catch {
      return reply.status(400).send({ error: 'Key reconstruction failed. Your developer key (vp_live_) may not match the one used to store this key.' });
    }

    // --- f. Build upstream URL ---
    // Preserve query string from the original request
    const queryIndex = request.url.indexOf('?');
    const queryString = queryIndex !== -1 ? request.url.slice(queryIndex) : '';
    let upstreamUrl: string;
    if (providerConfig) {
      upstreamUrl = `${providerConfig.upstream}/${wildcardPath}${queryString}`;
    } else {
      // Dynamic provider — extract project ref from wildcard path
      const segments = wildcardPath.split('/');
      const resolved = dynamicConfig!.buildUpstream(segments);
      if (!resolved) {
        return reply.status(400).send({ error: `Invalid ${provider} URL. Expected: /v1/${provider}/<project-ref>/rest/v1/...` });
      }
      upstreamUrl = `${resolved.url}${resolved.remainingPath}${queryString}`;
    }

    // --- g. Forward the exact request ---
    const baseForwardHeaders: Record<string, string> = {};

    // Forward only explicitly allowed headers — prevents arbitrary header injection
    for (const [key, value] of Object.entries(request.headers)) {
      if (!ALLOWED_FORWARD_HEADERS.has(key.toLowerCase()) || !value) continue;
      baseForwardHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
    }

    // Build body: use raw buffer for non-GET requests
    const method = request.method as string;
    let body: Buffer | undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      body = (request as any).rawBody || (request.body ? Buffer.from(JSON.stringify(request.body)) : undefined);
    }

    const startTime = Date.now();

    // Inject real provider auth header for primary request
    const authHeaders = providerConfig ? providerConfig.authHeader(apiKey) : dynamicConfig!.authHeader(apiKey);
    const forwardHeaders = { ...baseForwardHeaders, ...authHeaders };

    // Only fallback if primary fetch throws (network unreachable), not on 5xx.
    let fallbackProvider: string | null = null;
    let fallbackKeySlot: typeof keySlot | null = null;
    let response!: Response;

    try {
      response = await fetch(upstreamUrl, {
        method,
        headers: forwardHeaders,
        body: body ? new Uint8Array(body) : undefined,
      });
      apiKey = '';
    } catch {
      // Primary provider unreachable — try compatible fallbacks
      apiKey = '';
      let resolved = false;

      if (FALLBACK_MAP[provider]) {
        for (const candidate of FALLBACK_MAP[provider]) {
          const candidateSlot = await prisma.keySlot.findFirst({
            where: { userId: auth.userId, provider: candidate, status: 'ACTIVE' },
            orderBy: { createdAt: 'desc' },
          });

          if (!candidateSlot) continue;
          if (candidateSlot.expiresAt && new Date(candidateSlot.expiresAt) < new Date()) continue;
          if (!candidateSlot.share2Encrypted || candidateSlot.share2Encrypted.length === 0) continue;

          let fallbackKey: string;
          try { fallbackKey = reconstructKey(candidateSlot); } catch { continue; }

          const fallbackConfig = PROVIDERS[candidate];
          const fallbackHeaders = { ...baseForwardHeaders, ...fallbackConfig.authHeader(fallbackKey) };

          try {
            const retryResponse = await fetch(
              `${fallbackConfig.upstream}/${wildcardPath}${queryString}`,
              { method, headers: fallbackHeaders, body: body ? new Uint8Array(body) : undefined }
            );
            fallbackKey = '';
            response = retryResponse;
            fallbackProvider = candidate;
            fallbackKeySlot = candidateSlot;
            resolved = true;

            prisma.accessLog.create({
              data: {
                keySlotId: candidateSlot.id,
                appId: auth.keyId,
                action: 'transparent_proxy_fallback',
                zkProof: 'sdk-authenticated',
                nullifier: `proxy-fallback-${randomBytes(16).toString('hex')}`,
                metadata: JSON.stringify({
                  original_provider: provider, fallback_provider: candidate,
                  endpoint: `/${wildcardPath}`, method,
                  status_code: retryResponse.status, latency_ms: Date.now() - startTime,
                }),
              },
            }).catch(() => {});

            break;
          } catch { fallbackKey = ''; continue; }
        }
      }

      if (!resolved) {
        return reply.status(502).send({ error: 'Upstream provider unreachable' });
      }
    }

    try {
      const contentType = response.headers.get('content-type') || '';
      const latencyMs = Date.now() - startTime;
      const activeKeySlot = fallbackKeySlot || keySlot;
      const activeProvider = fallbackProvider || provider;

      // --- k. Log the call (non-blocking) ---
      prisma.accessLog.create({
        data: {
          keySlotId: activeKeySlot.id,
          appId: auth.keyId,
          action: 'transparent_proxy',
          zkProof: 'sdk-authenticated',
          nullifier: `proxy-${randomBytes(16).toString('hex')}`,
          metadata: JSON.stringify({
            provider: activeProvider, endpoint: `/${wildcardPath}`, method,
            status_code: response.status, latency_ms: latencyMs,
            ...(fallbackProvider ? { fallback_from: provider } : {}),
          }),
        },
      }).catch(() => {});

      if (auth.devKey.webhookUrl && auth.devKey.webhookSecret) {
        sendWebhook(auth.devKey.webhookUrl, auth.devKey.webhookSecret, 'proxy.call', {
          keyId: activeKeySlot.id, path: `/${wildcardPath}`, status: response.status, latencyMs,
          ...(fallbackProvider ? { fallbackFrom: provider, fallbackTo: fallbackProvider } : {}),
        });
      }

      // Detect IP restriction errors from the provider and add a helpful hint
      if (response.status === 403) {
        // Read the body to check for IP-related error messages
        const clonedRes = response.clone();
        try {
          const errText = await clonedRes.text();
          const lowerErr = errText.toLowerCase();
          if (lowerErr.includes('ip') || lowerErr.includes('address') || lowerErr.includes('origin') || lowerErr.includes('whitelist') || lowerErr.includes('allowlist')) {
            return reply.status(403).send({
              error: `The provider rejected the request due to IP restrictions. The proxy call came from VaultProof's server, not your IP. Fix: remove the IP restriction on your API key, or use vault.retrieve() instead of the proxy so your server makes the call directly.`,
              provider_response: errText.slice(0, 500),
            });
          }
        } catch {}
      }

      if ((response.status === 401 || response.status === 403) && auth.devKey.alertEmail) {
        sendInvalidKeyAlert(auth.devKey.alertEmail, activeKeySlot.label, activeKeySlot.provider, response.status, '/' + wildcardPath);
      }

      if (auth.devKey.alertThreshold && auth.devKey.alertEmail) {
        const oneHourAgo = new Date(Date.now() - 3600_000);
        prisma.accessLog.count({
          where: { appId: auth.devKey.id, timestamp: { gte: oneHourAgo } },
        }).then(count => {
          if (count >= auth.devKey.alertThreshold!) {
            sendUsageAlert(auth.devKey.alertEmail!, auth.devKey.label, count, auth.devKey.alertThreshold!);
          }
        }).catch(() => {});
      }

      // --- i. SSE streaming ---
      if (contentType.includes('text/event-stream') && response.body) {
        const sseHeaders: Record<string, string> = {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        };
        if (fallbackProvider) {
          sseHeaders['X-VaultProof-Fallback'] = 'true';
          sseHeaders['X-VaultProof-Provider'] = fallbackProvider;
        }
        reply.raw.writeHead(response.status, sseHeaders);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            reply.raw.write(decoder.decode(value, { stream: true }));
          }
        } catch {
          // Client disconnected
        } finally {
          reply.raw.end();
        }
        return;
      }

      // --- j. Standard response ---
      const data = await response.arrayBuffer();
      const replyObj = reply.status(response.status).header('Content-Type', contentType || 'application/json');
      if (fallbackProvider) {
        replyObj.header('X-VaultProof-Fallback', 'true').header('X-VaultProof-Provider', fallbackProvider);
      }
      replyObj.send(Buffer.from(data));
    } catch {
      return reply.status(502).send({ error: 'Upstream provider error' });
    }
  });
}
