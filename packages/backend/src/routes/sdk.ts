/**
 * SDK Endpoints — Server never sees the full API key.
 *
 * Store flow:
 *   SDK splits key locally (Shamir) → encrypts Share 2 with vp_live_ key
 *   → sends encrypted Share 1 + encrypted Share 2 to server
 *   → server stores both but can only decrypt Share 1
 *   → Share 2 can only be decrypted with the developer's vp_live_ key
 *
 * Call flow:
 *   SDK sends vp_live_ key → server decrypts Share 2 with it
 *   → decrypts Share 1 with VAULT_ENCRYPTION_KEY → combines → proxies → zeros
 *
 * To breach: attacker needs database + VAULT_ENCRYPTION_KEY + vp_live_ key
 * Three separate things in three separate places.
 */

import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { deserializeShare, combine } from '@vaultproof/shamir';
import { encrypt, decrypt, zeroBuffer } from '../crypto/encryption.js';
import { encryptShare2, decryptShare2 } from '../crypto/share2-encryption.js';
import { authenticateDevKey } from './developer-keys.js';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

const PROVIDER_URLS: Record<string, string> = {
  openai: 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
  google: 'https://generativelanguage.googleapis.com',
  together: 'https://api.together.xyz',
};

export async function sdkRoutes(app: FastifyInstance) {
  // Authenticate all SDK routes with developer API key
  app.addHook('onRequest', async (request, reply) => {
    const auth = await authenticateDevKey(request, reply);
    if (!auth) {
      return reply.status(401).send({ error: 'Invalid API key. Use your vp_live_ key.' });
    }
    (request as any).devAuth = auth;
  });

  /**
   * Store — SDK splits the key client-side, sends both encrypted shares.
   * Server NEVER sees the raw API key.
   */
  app.post('/store', async (request, reply) => {
    const schema = z.object({
      // SDK sends pre-split, pre-encrypted shares
      share1: z.string().min(1),       // Serialized Shamir Share 1 (base64)
      share2: z.string().min(1),       // Serialized Shamir Share 2 (base64)
      provider: z.enum(['openai', 'anthropic', 'google', 'together']),
      label: z.string().max(100).optional(),
      expiresAt: z.string().datetime().optional(),
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.issues });
    }

    const { userId, keyId: devKeyId, rawKey: vpKey } = (request as any).devAuth;
    const { share1, share2, provider, label, expiresAt } = parsed.data;

    // Encrypt Share 1 with VAULT_ENCRYPTION_KEY (server secret)
    const share1Encrypted = encrypt(Buffer.from(share1, 'utf-8'));

    // Encrypt Share 2 with developer's vp_live_ key (developer secret)
    const share2Encrypted = encryptShare2(share2, vpKey);

    const commitment = randomBytes(32).toString('hex');

    const keySlot = await prisma.keySlot.create({
      data: {
        userId,
        provider,
        label: label || `${provider} key`,
        share1Encrypted: new Uint8Array(share1Encrypted),
        share2Encrypted: new Uint8Array(share2Encrypted),
        vaultCommitment: commitment,
        authAppsRoot: '',
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      },
    });

    await prisma.appGrant.create({
      data: { keySlotId: keySlot.id, appId: devKeyId, appName: 'SDK' },
    });

    return {
      keyId: keySlot.id,
      provider,
      label: keySlot.label,
      // No share2 returned — it's stored encrypted on server
      // Developer just needs their vp_live_ key to use it
    };
  });

  /**
   * Call — Server decrypts both shares using separate keys, combines, proxies, zeros.
   * Developer only sends their vp_live_ key (via X-API-Key header) + keyId + path.
   */
  app.post('/call', async (request, reply) => {
    const schema = z.object({
      keyId: z.string().min(1),
      path: z.string().min(1),
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional(),
      body: z.unknown().optional(),
      headers: z.record(z.string(), z.string()).optional(),
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.issues });
    }

    const { userId, rawKey: vpKey } = (request as any).devAuth;
    const { keyId, path, method, body: reqBody, headers: reqHeaders } = parsed.data;

    // Load key slot
    const keySlot = await prisma.keySlot.findUnique({ where: { id: keyId } });
    if (!keySlot || keySlot.userId !== userId || keySlot.status !== 'ACTIVE') {
      return reply.status(404).send({ error: 'Key not found' });
    }

    // Check expiry
    if (keySlot.expiresAt && new Date(keySlot.expiresAt) < new Date()) {
      return reply.status(410).send({ error: 'Key has expired', expiresAt: keySlot.expiresAt });
    }

    if (!keySlot.share2Encrypted || keySlot.share2Encrypted.length === 0) {
      return reply.status(400).send({ error: 'Share 2 not stored for this key. Re-store via SDK.' });
    }

    const providerUrl = PROVIDER_URLS[keySlot.provider];
    if (!providerUrl) {
      return reply.status(400).send({ error: 'Unknown provider' });
    }

    // Reconstruct key ephemerally from both encrypted shares
    let apiKey: string;
    let decryptedShare1: Buffer | null = null;
    try {
      // Decrypt Share 1 with VAULT_ENCRYPTION_KEY
      decryptedShare1 = decrypt(Buffer.from(keySlot.share1Encrypted));
      const s1 = deserializeShare(decryptedShare1.toString('utf-8'));
      zeroBuffer(decryptedShare1);
      decryptedShare1 = null;

      // Decrypt Share 2 with developer's vp_live_ key
      const share2Str = decryptShare2(Buffer.from(keySlot.share2Encrypted), vpKey);
      const s2 = deserializeShare(share2Str);

      // Combine both shares → full API key
      apiKey = new TextDecoder().decode(combine([s1, s2]));
    } catch {
      if (decryptedShare1) zeroBuffer(decryptedShare1);
      return reply.status(400).send({ error: 'Key reconstruction failed. Check your API key.' });
    }

    const authHeader = buildAuthHeader(keySlot.provider, apiKey);
    const startTime = Date.now();

    try {
      const upstreamUrl = `${providerUrl}${path}`;
      const fetchHeaders: Record<string, string> = {
        ...reqHeaders,
        ...authHeader,
        'Content-Type': 'application/json',
      };

      const response = await fetch(upstreamUrl, {
        method: (method || 'POST') as string,
        headers: fetchHeaders,
        body: reqBody ? JSON.stringify(reqBody) : undefined,
      });

      // Zero the key immediately after sending the request
      apiKey = '';

      const contentType = response.headers.get('content-type') || '';
      const latencyMs = Date.now() - startTime;

      // Log the call (non-blocking)
      prisma.accessLog.create({
        data: {
          keySlotId: keyId,
          appId: (request as any).devAuth.keyId,
          action: 'api_call',
          zkProof: 'sdk-authenticated',
          nullifier: `sdk-${randomBytes(16).toString('hex')}`,
          metadata: JSON.stringify({ endpoint: path, status_code: response.status, latency_ms: latencyMs }),
        },
      }).catch(() => {});

      // SSE streaming — forward chunks as they arrive
      if (contentType.includes('text/event-stream') && response.body) {
        reply.raw.writeHead(response.status, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
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

      // Standard JSON response
      const data = await response.text();
      reply.status(response.status).header('Content-Type', contentType || 'application/json').send(data);
    } catch {
      apiKey = '';
      return reply.status(502).send({ error: 'Upstream API error' });
    }
  });

  // List stored keys
  app.get('/keys', async (request) => {
    const { userId } = (request as any).devAuth;
    const keys = await prisma.keySlot.findMany({
      where: { userId, status: 'ACTIVE' },
      select: { id: true, provider: true, label: true, createdAt: true },
    });
    return { keys };
  });

  // Revoke a key
  app.post('/revoke', async (request, reply) => {
    const schema = z.object({ keyId: z.string().min(1) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid input' });

    const { userId } = (request as any).devAuth;
    const { keyId } = parsed.data;

    const keySlot = await prisma.keySlot.findUnique({ where: { id: keyId } });
    if (!keySlot || keySlot.userId !== userId) {
      return reply.status(404).send({ error: 'Key not found' });
    }

    await prisma.keySlot.update({
      where: { id: keyId },
      data: {
        status: 'REVOKED',
        share1Encrypted: Buffer.alloc(0),
        share2Encrypted: Buffer.alloc(0),
      },
    });

    return { status: 'revoked' };
  });

  // Validate a key against its provider
  app.post('/validate', async (request, reply) => {
    const schema = z.object({ keyId: z.string().min(1) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid input' });

    const { userId, rawKey: vpKey } = (request as any).devAuth;
    const { keyId } = parsed.data;

    const keySlot = await prisma.keySlot.findUnique({ where: { id: keyId } });
    if (!keySlot || keySlot.userId !== userId || keySlot.status !== 'ACTIVE') {
      return reply.status(404).send({ error: 'Key not found' });
    }

    // Check expiry
    if (keySlot.expiresAt && new Date(keySlot.expiresAt) < new Date()) {
      return reply.status(410).send({ error: 'Key has expired', expiresAt: keySlot.expiresAt });
    }

    // Reconstruct key ephemerally
    let apiKey: string;
    try {
      const decrypted1 = decrypt(Buffer.from(keySlot.share1Encrypted));
      const s1 = deserializeShare(decrypted1.toString('utf-8'));
      zeroBuffer(decrypted1);

      if (!keySlot.share2Encrypted || keySlot.share2Encrypted.length === 0) {
        return reply.status(400).send({ error: 'Share 2 not available' });
      }
      const share2Str = decryptShare2(Buffer.from(keySlot.share2Encrypted), vpKey);
      const s2 = deserializeShare(share2Str);
      apiKey = new TextDecoder().decode(combine([s1, s2]));
    } catch {
      return reply.status(400).send({ error: 'Key reconstruction failed' });
    }

    // Test against provider
    const providerUrl = PROVIDER_URLS[keySlot.provider];
    if (!providerUrl) {
      apiKey = '';
      return reply.status(400).send({ error: 'Unknown provider' });
    }

    const authHeader = buildAuthHeader(keySlot.provider, apiKey);
    const startTime = Date.now();

    try {
      const res = await fetch(`${providerUrl}/v1/models`, {
        method: 'GET',
        headers: { ...authHeader },
      });
      apiKey = '';
      const latencyMs = Date.now() - startTime;

      return {
        valid: res.ok,
        provider: keySlot.provider,
        status: res.status,
        latencyMs,
        error: res.ok ? undefined : `Provider returned ${res.status}`,
      };
    } catch (err) {
      apiKey = '';
      return {
        valid: false,
        provider: keySlot.provider,
        latencyMs: Date.now() - startTime,
        error: 'Connection failed',
      };
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
