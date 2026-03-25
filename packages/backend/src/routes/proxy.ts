import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { combine, deserializeShare, type Share } from '@vaultproof/shamir';
import { decrypt, zeroBuffer } from '../crypto/encryption.js';
import { verifyProof } from '../crypto/proof-verifier.js';
import { checkRateLimit } from '../middleware/tier-limits.js';
import axios from 'axios';
import https from 'https';
import http from 'http';

const prisma = new PrismaClient();

const PROVIDER_URLS: Record<string, string> = {
  openai: 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
  google: 'https://generativelanguage.googleapis.com',
  together: 'https://api.together.xyz',
  adzuna: 'https://api.adzuna.com',
};

const proxyCallSchema = z.object({
  keySlotId: z.string().min(1),
  share2: z.string().min(1),
  zkProof: z.string().min(1),
  nullifier: z.string().min(1),
  appId: z.string().min(1).max(100),
  targetPath: z.string().min(1).max(500),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional().default('POST'),
  stream: z.boolean().optional().default(false),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional(),
});

export async function proxyRoutes(app: FastifyInstance) {
  // Standard (non-streaming) proxy call
  app.post('/call', async (request, reply) => {
    const parsed = proxyCallSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.issues });
    }

    const { keySlotId, share2, zkProof, nullifier, appId, targetPath, method, stream, headers: clientHeaders, body: clientBody } = parsed.data;

    // 1. Check nullifier (replay prevention)
    const existingLog = await prisma.accessLog.findUnique({ where: { nullifier } });
    if (existingLog) {
      return reply.status(403).send({ error: 'Proof already used (replay detected)' });
    }

    // 2. Load key slot + verify app authorization
    const keySlot = await prisma.keySlot.findUnique({
      where: { id: keySlotId },
      include: { appGrants: { where: { appId, revokedAt: null } } },
    });

    if (!keySlot || keySlot.status !== 'ACTIVE') {
      return reply.status(404).send({ error: 'Key slot not found or inactive' });
    }
    if (keySlot.appGrants.length === 0) {
      return reply.status(403).send({ error: 'App not authorized for this key' });
    }

    // 3. Check tier rate limits (skip in test environment)
    if (process.env.NODE_ENV !== 'test') {
      const rateCheck = await checkRateLimit(keySlotId, 'free'); // TODO: look up user's tier
      if (!rateCheck.allowed) {
        return reply.status(429).send({
          error: 'Monthly call limit exceeded',
          used: rateCheck.used,
          limit: rateCheck.limit,
          upgrade: 'https://vaultproof.dev#pricing',
        });
      }
    }

    // 4. Log nullifier BEFORE proof verification (ensures replay prevention even if proof fails)
    await prisma.accessLog.create({
      data: { keySlotId, appId, action: 'api_call', zkProof, nullifier, metadata: JSON.stringify({ endpoint: targetPath, status: 'pending' }) },
    });

    // 4. Verify ZK proof (falls back to placeholder if Noir not loaded)
    const proofResult = await verifyProof(zkProof, {
      vaultCommitment: keySlot.vaultCommitment,
      appIdHash: appId,
      authorizedAppsRoot: keySlot.authAppsRoot,
      treeDepth: 1,
      nullifier,
    });

    if (!proofResult.valid) {
      // Update log with rejection reason
      await prisma.accessLog.updateMany({
        where: { nullifier },
        data: { metadata: JSON.stringify({ endpoint: targetPath, proofRejected: true, reason: proofResult.reason }) },
      });
      return reply.status(403).send({ error: 'Invalid ZK proof', reason: proofResult.reason });
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
              ...clientHeaders,
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
        headers: { ...clientHeaders, ...authHeader, 'Content-Type': 'application/json' },
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
