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

const STRIPPED_HEADERS = new Set([
  'authorization',
  'x-api-key',
  'host',
  'connection',
  'transfer-encoding',
  'content-length', // recalculated by fetch
]);

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
    if (!providerConfig) {
      return reply.status(400).send({
        error: `Unknown provider "${provider}". Supported: ${Object.keys(PROVIDERS).join(', ')}`,
      });
    }

    // --- b. Authenticate developer key (vp_live_ from Authorization header) ---
    const auth = await authenticateDevKey(request, reply);
    if (!auth) {
      return reply.status(401).send({ error: 'Invalid API key. Send your vp_live_ key as Bearer token.' });
    }

    // --- b2. Enforce IP allowlist ---
    if (auth.devKey.allowedIps) {
      const clientIp = (request.headers['cf-connecting-ip'] as string) || request.ip;
      const allowed = auth.devKey.allowedIps.split(',').map((s: string) => s.trim());
      if (!allowed.includes(clientIp)) {
        return reply.status(403).send({ error: 'IP not allowed for this API key' });
      }
    }

    // --- b3. Enforce provider restriction ---
    if (auth.devKey.allowedProviders) {
      const allowed = auth.devKey.allowedProviders.split(',').map((s: string) => s.trim());
      if (!allowed.includes(provider)) {
        return reply.status(403).send({ error: `Provider '${provider}' not allowed for this API key` });
      }
    }

    // --- b4. Enforce endpoint restriction ---
    if (auth.devKey.allowedEndpoints) {
      const allowed = auth.devKey.allowedEndpoints.split(',').map((s: string) => s.trim());
      const requestPath = '/' + wildcardPath;
      if (!allowed.some((ep: string) => requestPath.startsWith(ep))) {
        return reply.status(403).send({ error: 'Endpoint not allowed for this API key' });
      }
    }

    // --- c. Find active key slot for this provider ---
    const keySlot = await prisma.keySlot.findFirst({
      where: { userId: auth.userId, provider, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });

    if (!keySlot) {
      return reply.status(404).send({
        error: `No active ${provider} key stored. Use the SDK to store a key first.`,
      });
    }

    // --- d. Check expiry ---
    if (keySlot.expiresAt && new Date(keySlot.expiresAt) < new Date()) {
      return reply.status(410).send({ error: 'Key has expired', expiresAt: keySlot.expiresAt });
    }

    // --- d2. Check per-key daily/monthly limits ---
    // Look up the user's tier to decide hard block vs overage
    const proxyUser = await prisma.user.findUnique({ where: { id: auth.userId }, select: { tier: true } });
    const proxyTier = (proxyUser?.tier as string) || 'free';

    if (keySlot.dailyLimit || keySlot.monthlyLimit) {
      const now = new Date();

      if (keySlot.dailyLimit) {
        const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const dailyCount = await prisma.accessLog.count({
          where: { keySlotId: keySlot.id, action: 'transparent_proxy', timestamp: { gte: dayStart } },
        });
        if (dailyCount >= keySlot.dailyLimit) {
          if (keySlot.blockOnLimit) {
            // Free tier: always hard block
            if (proxyTier === 'free') {
              return reply.status(429).send({
                error: 'Daily call limit reached',
                limit: keySlot.dailyLimit,
                used: dailyCount,
                resets: 'midnight UTC',
              });
            }
            // Paid tiers: allow but log as overage
            request.log.info({ msg: 'Daily overage call allowed', keySlotId: keySlot.id, tier: proxyTier, used: dailyCount, limit: keySlot.dailyLimit });
          }
          if (auth.devKey.alertEmail) {
            sendUsageAlert(auth.devKey.alertEmail, keySlot.label, dailyCount, keySlot.dailyLimit);
          }
        }
      }

      if (keySlot.monthlyLimit) {
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthlyCount = await prisma.accessLog.count({
          where: { keySlotId: keySlot.id, action: 'transparent_proxy', timestamp: { gte: monthStart } },
        });
        if (monthlyCount >= keySlot.monthlyLimit) {
          if (keySlot.blockOnLimit) {
            // Free tier: always hard block
            if (proxyTier === 'free') {
              return reply.status(429).send({
                error: 'Monthly call limit reached',
                limit: keySlot.monthlyLimit,
                used: monthlyCount,
                resets: 'next month',
              });
            }
            // Paid tiers: allow but log as overage
            request.log.info({ msg: 'Monthly overage call allowed', keySlotId: keySlot.id, tier: proxyTier, used: monthlyCount, limit: keySlot.monthlyLimit });
          }
          if (auth.devKey.alertEmail) {
            sendUsageAlert(auth.devKey.alertEmail, keySlot.label, monthlyCount, keySlot.monthlyLimit);
          }
        }
      }
    }

    if (!keySlot.share2Encrypted || keySlot.share2Encrypted.length === 0) {
      return reply.status(400).send({ error: 'Share 2 not stored for this key. Re-store via SDK.' });
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
      return reply.status(400).send({ error: 'Key reconstruction failed. Check your API key.' });
    }

    // --- f. Build upstream URL ---
    // Preserve query string from the original request
    const queryIndex = request.url.indexOf('?');
    const queryString = queryIndex !== -1 ? request.url.slice(queryIndex) : '';
    const upstreamUrl = `${providerConfig.upstream}/${wildcardPath}${queryString}`;

    // --- g. Forward the exact request ---
    const baseForwardHeaders: Record<string, string> = {};

    // Copy original headers, stripping auth-related and hop-by-hop headers
    for (const [key, value] of Object.entries(request.headers)) {
      if (STRIPPED_HEADERS.has(key.toLowerCase()) || !value) continue;
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
    const forwardHeaders = { ...baseForwardHeaders, ...providerConfig.authHeader(apiKey) };

    try {
      let response = await fetch(upstreamUrl, {
        method,
        headers: forwardHeaders,
        body: body ? new Uint8Array(body) : undefined,
      });

      // --- h. Zero the API key immediately ---
      apiKey = '';

      // --- Fallback logic: retry with a compatible provider on 5xx ---
      let fallbackProvider: string | null = null;
      let fallbackKeySlot: typeof keySlot | null = null;

      if (response.status >= 500 && response.status <= 599 && FALLBACK_MAP[provider]) {
        const fallbackCandidates = FALLBACK_MAP[provider];

        for (const candidate of fallbackCandidates) {
          const candidateSlot = await prisma.keySlot.findFirst({
            where: { userId: auth.userId, provider: candidate, status: 'ACTIVE' },
            orderBy: { createdAt: 'desc' },
          });

          if (!candidateSlot) continue;
          if (candidateSlot.expiresAt && new Date(candidateSlot.expiresAt) < new Date()) continue;
          if (!candidateSlot.share2Encrypted || candidateSlot.share2Encrypted.length === 0) continue;

          // Found a valid fallback — reconstruct key and retry
          let fallbackKey: string;
          try {
            fallbackKey = reconstructKey(candidateSlot);
          } catch {
            continue; // reconstruction failed, try next
          }

          const fallbackConfig = PROVIDERS[candidate];
          const fallbackUrl = `${fallbackConfig.upstream}/${wildcardPath}${queryString}`;
          const fallbackHeaders = { ...baseForwardHeaders, ...fallbackConfig.authHeader(fallbackKey) };

          try {
            const retryResponse = await fetch(fallbackUrl, {
              method,
              headers: fallbackHeaders,
              body: body ? new Uint8Array(body) : undefined,
            });

            // Zero fallback key immediately
            fallbackKey = '';

            // Use the fallback response regardless of status (we tried our best)
            response = retryResponse;
            fallbackProvider = candidate;
            fallbackKeySlot = candidateSlot;

            // Log the fallback event (non-blocking)
            prisma.accessLog.create({
              data: {
                keySlotId: candidateSlot.id,
                appId: auth.keyId,
                action: 'transparent_proxy_fallback',
                zkProof: 'sdk-authenticated',
                nullifier: `proxy-fallback-${randomBytes(16).toString('hex')}`,
                metadata: JSON.stringify({
                  original_provider: provider,
                  fallback_provider: candidate,
                  endpoint: `/${wildcardPath}`,
                  method,
                  status_code: retryResponse.status,
                  latency_ms: Date.now() - startTime,
                }),
              },
            }).catch(() => {});

            break; // Only one retry
          } catch {
            fallbackKey = '';
            continue; // Fetch itself failed, try next candidate
          }
        }
      }

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
            provider: activeProvider,
            endpoint: `/${wildcardPath}`,
            method,
            status_code: response.status,
            latency_ms: latencyMs,
            ...(fallbackProvider ? { fallback_from: provider } : {}),
          }),
        },
      }).catch(() => {});

      // Webhook notification (non-blocking)
      if (auth.devKey.webhookUrl && auth.devKey.webhookSecret) {
        sendWebhook(auth.devKey.webhookUrl, auth.devKey.webhookSecret, 'proxy.call', {
          keyId: activeKeySlot.id, path: `/${wildcardPath}`, status: response.status, latencyMs,
          ...(fallbackProvider ? { fallbackFrom: provider, fallbackTo: fallbackProvider } : {}),
        });
      }

      // Invalid key alert — notify if provider rejected the key (opt-in via alertEmail)
      if ((response.status === 401 || response.status === 403) && auth.devKey.alertEmail) {
        sendInvalidKeyAlert(auth.devKey.alertEmail, activeKeySlot.label, activeKeySlot.provider, response.status, '/' + wildcardPath);
      }

      // Usage alert check (non-blocking)
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

      // --- i. Handle SSE streaming ---
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
          // Client disconnected or upstream error
        } finally {
          reply.raw.end();
        }
        return;
      }

      // --- j. Standard response passthrough ---
      const data = await response.arrayBuffer();
      const replyObj = reply
        .status(response.status)
        .header('Content-Type', contentType || 'application/json');

      if (fallbackProvider) {
        replyObj
          .header('X-VaultProof-Fallback', 'true')
          .header('X-VaultProof-Provider', fallbackProvider);
      }

      replyObj.send(Buffer.from(data));
    } catch {
      apiKey = '';
      return reply.status(502).send({ error: 'Upstream provider error' });
    }
  });
}
