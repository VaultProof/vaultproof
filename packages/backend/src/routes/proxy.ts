import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';
import { combine, deserializeShare, type Share } from '@vaultproof/shamir';
import { decrypt, zeroBuffer } from '../crypto/encryption.js';
import { verifyProof } from '../crypto/proof-verifier.js';
import { checkRateLimit } from '../middleware/tier-limits.js';
import axios from 'axios';
import https from 'https';
import http from 'http';

// Safe headers allowlist — only these are forwarded to upstream providers
const SAFE_FORWARD_HEADERS = new Set(['content-type', 'accept', 'accept-encoding', 'accept-language', 'cache-control', 'user-agent', 'anthropic-version', 'openai-beta']);

function filterSafeHeaders(headers?: Record<string, string>): Record<string, string> {
  if (!headers) return {};
  const filtered: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (SAFE_FORWARD_HEADERS.has(k.toLowerCase())) filtered[k] = v;
  }
  return filtered;
}

const PROVIDER_URLS: Record<string, string> = {
  openai: 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
  google: 'https://generativelanguage.googleapis.com',
  together: 'https://api.together.xyz',
  mistral: 'https://api.mistral.ai',
  cohere: 'https://api.cohere.com',
  groq: 'https://api.groq.com',
  perplexity: 'https://api.perplexity.ai',
  fireworks: 'https://api.fireworks.ai',
  deepseek: 'https://api.deepseek.com',
  replicate: 'https://api.replicate.com',
  adzuna: 'https://api.adzuna.com',
};

const proxyCallSchema = z.object({
  keySlotId: z.string().min(1).max(100),
  share2: z.string().min(1).max(2048),
  zkProof: z.string().min(1).max(10000),
  nullifier: z.string().min(1).max(500),
  appId: z.string().min(1).max(100),
  targetPath: z.string().min(1).max(500),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional().default('POST'),
  stream: z.boolean().optional().default(false),
  headers: z.record(z.string().max(200), z.string().max(8192)).optional().refine((h) => !h || Object.keys(h).length <= 20, { message: 'Max 20 headers' }),
  body: z.unknown().optional(),
});

const proxyRateLimit = new Map<string, { count: number; resetAt: number }>();

export async function proxyRoutes(app: FastifyInstance) {
  // NOTE: No requireAuth — widget flow authenticates via ZK proof + app grant + nullifier.
  // Users send Share 2 directly. JWT is not used in the widget flow.
  app.post('/call', async (request, reply) => {
    const parsed = proxyCallSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.issues });
    }

    const { keySlotId, share2, zkProof, nullifier, appId, targetPath, method, stream, headers: clientHeaders, body: clientBody } = parsed.data;

    // Per-appId burst rate limit (60 req/min)
    const now = Date.now();
    const record = proxyRateLimit.get(appId);
    if (record && now < record.resetAt && record.count >= 60) {
      return reply.status(429).send({ error: 'Rate limit exceeded (60 req/min)' });
    }
    if (!record || now >= record.resetAt) {
      proxyRateLimit.set(appId, { count: 1, resetAt: now + 60000 });
    } else {
      record.count++;
    }

    // 1. Load key slot + verify app authorization (read-only, no DB writes yet)
    const keySlot = await prisma.keySlot.findUnique({
      where: { id: keySlotId },
      include: { appGrants: { where: { appId, revokedAt: null } } },
    });

    if (!keySlot || keySlot.status !== 'ACTIVE') {
      return reply.status(404).send({ error: 'Key slot not found or inactive' });
    }

    // Check expiry
    if (keySlot.expiresAt && new Date(keySlot.expiresAt) < new Date()) {
      return reply.status(410).send({ error: 'Key has expired', expiresAt: keySlot.expiresAt });
    }

    // Return generic 403 — don't reveal whether the appId exists or is registered
    if (keySlot.appGrants.length === 0) {
      return reply.status(403).send({ error: 'App is not authorized to use this key. Grant access in the VaultProof dashboard.' });
    }

    // 2. Check tier rate limits (skip in test environment)
    if (process.env.NODE_ENV !== 'test') {
      const slotOwner = await prisma.user.findUnique({ where: { id: keySlot.userId }, select: { tier: true, email: true } });
      const tier = (slotOwner?.tier as string) || 'free';
      const rateCheck = await checkRateLimit(keySlotId, tier, slotOwner?.email);
      if (!rateCheck.allowed) {
        // Free tier: hard block
        if (tier === 'free') {
          return reply.status(429).send({
            error: 'Monthly call limit exceeded',
            used: rateCheck.used,
            limit: rateCheck.limit,
            upgrade: 'https://vaultproof.dev#pricing',
          });
        }
        // Paid tiers (starter, pro, max): allow but log as overage
        // Billing happens via Stripe metered usage or manual invoice
        request.log.info({
          msg: 'Overage call allowed',
          keySlotId,
          tier,
          used: rateCheck.used,
          limit: rateCheck.limit,
        });
      }

      // Add warning header when near limit
      if (rateCheck.nearLimit) {
        reply.header('X-VaultProof-Usage-Warning', `${rateCheck.used}/${rateCheck.limit} calls used this month (${Math.round(rateCheck.used / rateCheck.limit * 100)}%)`);
      }
    }

    // 3. Verify ZK proof BEFORE claiming the nullifier.
    // This ensures an invalid proof never burns a nullifier — an attacker cannot lock
    // a user's nullifier by racing with a forged/invalid proof.
    if (process.env.NODE_ENV !== 'test') {
      const allGrants = await prisma.appGrant.count({ where: { keySlotId, revokedAt: null } });
      const treeDepth = Math.max(1, Math.ceil(Math.log2(Math.max(2, allGrants))));

      const proofResult = await verifyProof(zkProof, {
        vaultCommitment: keySlot.vaultCommitment,
        appIdHash: appId,
        authorizedAppsRoot: keySlot.authAppsRoot,
        treeDepth,
        nullifier,
      });

      if (!proofResult.valid) {
        request.log.warn(`Proof rejected for keySlot ${keySlotId}: ${proofResult.reason}`);
        return reply.status(403).send({ error: 'ZK proof verification failed. The proof may be expired or generated with incorrect parameters.' });
      }
    }

    // 4. Claim nullifier atomically (replay prevention).
    // Proof is valid — now write to DB. If another request already claimed this
    // nullifier (concurrent replay), the unique constraint throws and we reject.
    try {
      await prisma.accessLog.create({
        data: {
          keySlotId,
          appId,
          action: 'api_call',
          zkProof,
          nullifier,
          metadata: JSON.stringify({ endpoint: targetPath, status: 'pending' }),
        },
      });
    } catch {
      return reply.status(403).send({ error: 'Proof already used (replay detected)' });
    }

    // 5. Reconstruct API key ephemerally
    let apiKey: string;
    let decryptedShare1: Buffer | null = null;
    try {
      decryptedShare1 = decrypt(Buffer.from(keySlot.share1Encrypted));
      // Decrypt gives us the base64 serialized share string
      const share1 = deserializeShare(decryptedShare1.toString('utf-8'));
      const share2Parsed = deserializeShare(share2);
      apiKey = new TextDecoder().decode(combine([share1, share2Parsed]));
      zeroBuffer(decryptedShare1);
      decryptedShare1 = null;
    } catch {
      if (decryptedShare1) zeroBuffer(decryptedShare1);
      return reply.status(400).send({ error: 'Failed to reconstruct key' });
    }

    const providerUrl = PROVIDER_URLS[keySlot.provider];
    if (!providerUrl) {
      apiKey = '';
      return reply.status(400).send({ error: 'Unknown provider' });
    }

    const targetUrl = `${providerUrl}${targetPath}`;
    const authHeader = buildAuthHeader(keySlot.provider, apiKey);
    const startTime = Date.now();

    // 5. SSE streaming path
    if (stream) {
      apiKey = ''; // Zero key before streaming begins

      try {
        const url = new URL(targetUrl);
        const requestModule = url.protocol === 'https:' ? https : http;
        const bodyStr = clientBody ? JSON.stringify(clientBody) : undefined;

        const proxyReq = requestModule.request(
          {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + url.search,
            method: method,
            headers: {
              ...filterSafeHeaders(clientHeaders),
              ...authHeader,
              'Content-Type': 'application/json',
              ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr).toString() } : {}),
            },
          },
          (proxyRes) => {
            // Set SSE headers
            reply.raw.writeHead(proxyRes.statusCode || 200, {
              'Content-Type': proxyRes.headers['content-type'] || 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
              'Transfer-Encoding': 'chunked',
            });

            // Stream chunks directly through
            proxyRes.on('data', (chunk: Buffer) => {
              reply.raw.write(chunk);
            });

            proxyRes.on('end', async () => {
              reply.raw.end();
              await prisma.accessLog.updateMany({
                where: { nullifier },
                data: {
                  metadata: JSON.stringify({
                    endpoint: targetPath,
                    status_code: proxyRes.statusCode,
                    latency_ms: Date.now() - startTime,
                    streamed: true,
                  }),
                },
              });
            });

            proxyRes.on('error', () => {
              reply.raw.end();
            });
          }
        );

        proxyReq.on('error', async () => {
          if (!reply.raw.headersSent) {
            reply.raw.writeHead(502, { 'Content-Type': 'application/json' });
          }
          reply.raw.end(JSON.stringify({ error: 'Upstream API error' }));
          await prisma.accessLog.updateMany({
            where: { nullifier },
            data: { metadata: JSON.stringify({ endpoint: targetPath, error: true, latency_ms: Date.now() - startTime }) },
          });
        });

        if (bodyStr) proxyReq.write(bodyStr);
        proxyReq.end();

        // Tell Fastify we're handling the response manually
        return reply;
      } catch {
        return reply.status(502).send({ error: 'Upstream API error' });
      }
    }

    // 6. Standard (non-streaming) path
    let statusCode: number;
    try {
      const response = await axios({
        method: method as any,
        url: targetUrl,
        headers: { ...filterSafeHeaders(clientHeaders), ...authHeader, 'Content-Type': 'application/json' },
        data: clientBody,
        timeout: 30000,
        validateStatus: () => true,
      });

      statusCode = response.status;
      apiKey = '';

      await prisma.accessLog.updateMany({
        where: { nullifier },
        data: { metadata: JSON.stringify({ endpoint: targetPath, status_code: statusCode, latency_ms: Date.now() - startTime }) },
      });

      return reply.status(response.status).send(response.data);
    } catch {
      apiKey = '';

      await prisma.accessLog.updateMany({
        where: { nullifier },
        data: { metadata: JSON.stringify({ endpoint: targetPath, error: true, latency_ms: Date.now() - startTime }) },
      });

      return reply.status(502).send({ error: 'Upstream API error' });
    }
  });
}

function buildAuthHeader(provider: string, apiKey: string): Record<string, string> {
  switch (provider) {
    case 'openai':
    case 'together':
      return { Authorization: `Bearer ${apiKey}` };
    case 'anthropic':
      return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
    case 'google':
      return { 'x-goog-api-key': apiKey };
    default:
      return { Authorization: `Bearer ${apiKey}` };
  }
}
