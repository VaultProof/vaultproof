/**
 * Simplified SDK Endpoints
 *
 * These endpoints are designed for developers using `vp_live_` API keys.
 * They handle Shamir splitting, share management, and proxying internally.
 * The developer never touches shares, proofs, or nullifiers.
 *
 * Usage:
 *   POST /api/v1/sdk/store   { apiKey, provider, label }
 *   POST /api/v1/sdk/call    { keyId, path, method, body }
 *   GET  /api/v1/sdk/keys    (list stored keys)
 *   POST /api/v1/sdk/revoke  { keyId }
 */

import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { splitString, serializeShare, deserializeShare, combine } from '@vaultproof/shamir';
import { encrypt, decrypt, zeroBuffer } from '../crypto/encryption.js';
import { authenticateDevKey } from './developer-keys.js';
import { randomBytes } from 'crypto';
import axios from 'axios';

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

  // Store an API key (handles Shamir split internally)
  app.post('/store', async (request, reply) => {
    const schema = z.object({
      apiKey: z.string().min(1),
      provider: z.enum(['openai', 'anthropic', 'google', 'together']),
      label: z.string().max(100).optional(),
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.issues });
    }

    const { userId, keyId: devKeyId } = (request as any).devAuth;
    const { apiKey, provider, label } = parsed.data;

    // Shamir split the key
    const shares = splitString(apiKey, 2, 2);
    const share1 = serializeShare(shares[0]);
    const share2 = serializeShare(shares[1]);

    // Encrypt Share 1 for storage
    const share1Encrypted = encrypt(Buffer.from(share1, 'utf-8'));

    // Compute commitment
    const commitment = randomBytes(32).toString('hex');

    // Store in DB
    const keySlot = await prisma.keySlot.create({
      data: {
        userId,
        provider,
        label: label || `${provider} key`,
        share1Encrypted: new Uint8Array(share1Encrypted),
        vaultCommitment: commitment,
        authAppsRoot: '',
      },
    });

    // Grant the developer's app access
    await prisma.appGrant.create({
      data: {
        keySlotId: keySlot.id,
        appId: devKeyId,
        appName: 'SDK',
      },
    });

    return {
      keyId: keySlot.id,
      provider,
      label: keySlot.label,
      // Share 2 is returned — SDK stores it in memory/config
      // Never stored on our server
      share2,
    };
  });

  // Make a proxied API call (handles reconstruction internally)
  app.post('/call', async (request, reply) => {
    const schema = z.object({
      keyId: z.string().min(1),
      share2: z.string().min(1),
      path: z.string().min(1),
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional(),
      body: z.unknown().optional(),
      headers: z.record(z.string(), z.string()).optional(),
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.issues });
    }

    const { userId } = (request as any).devAuth;
    const { keyId, share2, path, method, body: reqBody, headers: reqHeaders } = parsed.data;

    // Load key slot
    const keySlot = await prisma.keySlot.findUnique({ where: { id: keyId } });
    if (!keySlot || keySlot.userId !== userId || keySlot.status !== 'ACTIVE') {
      return reply.status(404).send({ error: 'Key not found' });
    }

    const providerUrl = PROVIDER_URLS[keySlot.provider];
    if (!providerUrl) {
      return reply.status(400).send({ error: 'Unknown provider' });
    }

    // Reconstruct key ephemerally
    let apiKey: string;
    let decrypted: Buffer | null = null;
    try {
      decrypted = decrypt(Buffer.from(keySlot.share1Encrypted));
      const s1 = deserializeShare(decrypted.toString('utf-8'));
      const s2 = deserializeShare(share2);
      apiKey = new TextDecoder().decode(combine([s1, s2]));
      zeroBuffer(decrypted);
      decrypted = null;
    } catch {
      if (decrypted) zeroBuffer(decrypted);
      return reply.status(400).send({ error: 'Invalid share — key reconstruction failed' });
    }

    // Build auth header
    const authHeader = buildAuthHeader(keySlot.provider, apiKey);
    const startTime = Date.now();

    // Make the API call
    try {
      const response = await axios({
        method: (method || 'POST') as any,
        url: `${providerUrl}${path}`,
        headers: { ...reqHeaders, ...authHeader, 'Content-Type': 'application/json' },
        data: reqBody,
        timeout: 30000,
        validateStatus: () => true,
      });

      apiKey = '';

      // Log the call
      await prisma.accessLog.create({
        data: {
          keySlotId: keyId,
          appId: (request as any).devAuth.keyId,
          action: 'api_call',
          zkProof: 'sdk-authenticated',
          nullifier: `sdk-${randomBytes(16).toString('hex')}`,
          metadata: JSON.stringify({ endpoint: path, status_code: response.status, latency_ms: Date.now() - startTime }),
        },
      });

      return reply.status(response.status).send(response.data);
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
      data: { status: 'REVOKED', share1Encrypted: Buffer.alloc(0) },
    });

    return { status: 'revoked' };
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
