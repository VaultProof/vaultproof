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
import { PrismaClient } from '@prisma/client';
import { deserializeShare, combine } from '@vaultproof/shamir';
import { decrypt, zeroBuffer } from '../crypto/encryption.js';
import { decryptShare2 } from '../crypto/share2-encryption.js';
import { authenticateDevKey } from './developer-keys.js';
import { randomBytes } from 'crypto';
import { sendUsageAlert } from '../services/email.js';

const prisma = new PrismaClient();

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
};

/**
 * Strip headers that carry the VaultProof developer key or would conflict
 * with the real provider auth we inject.
 */
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
      const clientIp = request.headers['x-forwarded-for'] as string || request.ip;
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

    if (!keySlot.share2Encrypted || keySlot.share2Encrypted.length === 0) {
      return reply.status(400).send({ error: 'Share 2 not stored for this key. Re-store via SDK.' });
    }

    // --- e. Reconstruct API key from both encrypted shares ---
    let apiKey: string;
    let decryptedShare1: Buffer | null = null;
    try {
      // Decrypt Share 1 with VAULT_ENCRYPTION_KEY (server secret)
      decryptedShare1 = decrypt(Buffer.from(keySlot.share1Encrypted));
      const s1 = deserializeShare(decryptedShare1.toString('utf-8'));
      zeroBuffer(decryptedShare1);
      decryptedShare1 = null;

      // Decrypt Share 2 with developer's vp_live_ key
      const share2Str = decryptShare2(Buffer.from(keySlot.share2Encrypted), auth.rawKey);
      const s2 = deserializeShare(share2Str);

      // Combine both shares -> full API key
      apiKey = new TextDecoder().decode(combine([s1, s2]));
    } catch {
      if (decryptedShare1) zeroBuffer(decryptedShare1);
      return reply.status(400).send({ error: 'Key reconstruction failed. Check your API key.' });
    }

    // --- f. Build upstream URL ---
    // Preserve query string from the original request
    const queryIndex = request.url.indexOf('?');
    const queryString = queryIndex !== -1 ? request.url.slice(queryIndex) : '';
    const upstreamUrl = `${providerConfig.upstream}/${wildcardPath}${queryString}`;

    // --- g. Forward the exact request ---
    const forwardHeaders: Record<string, string> = {};

    // Copy original headers, stripping auth-related and hop-by-hop headers
    for (const [key, value] of Object.entries(request.headers)) {
      if (STRIPPED_HEADERS.has(key.toLowerCase()) || !value) continue;
      forwardHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
    }

    // Inject real provider auth header
    Object.assign(forwardHeaders, providerConfig.authHeader(apiKey));

    // Build body: use raw buffer for non-GET requests
    const method = request.method as string;
    let body: Buffer | undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      body = (request as any).rawBody || (request.body ? Buffer.from(JSON.stringify(request.body)) : undefined);
    }

    const startTime = Date.now();

    try {
      const response = await fetch(upstreamUrl, {
        method,
        headers: forwardHeaders,
        body: body ? new Uint8Array(body) : undefined,
      });

      // --- h. Zero the API key immediately ---
      apiKey = '';

      const contentType = response.headers.get('content-type') || '';
      const latencyMs = Date.now() - startTime;

      // --- k. Log the call (non-blocking) ---
      prisma.accessLog.create({
        data: {
          keySlotId: keySlot.id,
          appId: auth.keyId,
          action: 'transparent_proxy',
          zkProof: 'sdk-authenticated',
          nullifier: `proxy-${randomBytes(16).toString('hex')}`,
          metadata: JSON.stringify({
            provider,
            endpoint: `/${wildcardPath}`,
            method,
            status_code: response.status,
            latency_ms: latencyMs,
          }),
        },
      }).catch(() => {});

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
        reply.raw.writeHead(response.status, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });

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
      reply
        .status(response.status)
        .header('Content-Type', contentType || 'application/json')
        .send(Buffer.from(data));
    } catch {
      apiKey = '';
      return reply.status(502).send({ error: 'Upstream provider error' });
    }
  });
}
