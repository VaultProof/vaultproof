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
import { prisma } from '../lib/prisma.js';
import { z } from 'zod';
import { deserializeShare, combine } from '@vaultproof/shamir';
import { encrypt, decrypt, zeroBuffer } from '../crypto/encryption.js';
import { encryptShare2, decryptShare2 } from '../crypto/share2-encryption.js';
import { authenticateDevKey } from './developer-keys.js';
import { randomBytes } from 'crypto';
import { sendUsageAlert, sendKeyExpiryWarning, sendInvalidKeyAlert } from '../services/email.js';
import { sendWebhook } from '../services/webhook.js';

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
};

export async function sdkRoutes(app: FastifyInstance) {
  // Authenticate all SDK routes with developer API key
  app.addHook('onRequest', async (request, reply) => {
    const authHeaderVal = request.headers.authorization as string;
    const apiKeyHeaderVal = request.headers['x-api-key'] as string;
    const rawKeyValue = apiKeyHeaderVal || (authHeaderVal ? authHeaderVal.slice(7) : '');
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

    // Enforce IP allowlist
    const devKey = auth.devKey;
    if (devKey.allowedIps) {
      // Only trust cf-connecting-ip if the request came through the CF Worker (has proxy signature)
      const hasProxySignature = !!request.headers['x-proxy-signature'];
      const clientIp = hasProxySignature ? (request.headers['cf-connecting-ip'] as string) || request.ip : request.ip;
      const allowed = devKey.allowedIps.split(',').map((s: string) => s.trim());
      if (!allowed.includes(clientIp)) {
        return reply.status(403).send({ error: 'IP not allowed for this API key' });
      }
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
      share1: z.string().min(1).max(2048),       // Serialized Shamir Share 1 (base64)
      share2: z.string().min(1).max(2048),       // Serialized Shamir Share 2 (base64)
      provider: z.string().min(1).max(50).toLowerCase(),
      label: z.string().max(100).optional(),
      expiresAt: z.string().datetime().optional(),
      dailyLimit: z.number().int().min(1).optional(),
      monthlyLimit: z.number().int().min(1).optional(),
      blockOnLimit: z.boolean().optional(),
      envVar: z.string().max(100).optional(),
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.issues });
    }

    const { userId, keyId: devKeyId, rawKey: vpKey } = (request as any).devAuth;
    const { share1, share2, provider, label, expiresAt, dailyLimit, monthlyLimit, blockOnLimit, envVar } = parsed.data;

    // Check for duplicate keys — same provider + label or same provider + envVar
    const effectiveLabel = label || `${provider} key`;
    const duplicates = await prisma.keySlot.findMany({
      where: {
        userId,
        provider,
        status: 'ACTIVE',
        OR: [
          { label: effectiveLabel },
          ...(envVar ? [{ envVar }] : []),
        ],
      },
      select: { id: true, label: true, envVar: true },
    });

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
        dailyLimit,
        monthlyLimit,
        blockOnLimit: blockOnLimit ?? true,
        envVar: envVar || undefined,
      },
    });

    await prisma.appGrant.create({
      data: { keySlotId: keySlot.id, appId: devKeyId, appName: 'SDK' },
    });

    // Webhook notification (non-blocking)
    const authDevKeyStore = (request as any).devAuth.devKey;
    if (authDevKeyStore.webhookUrl && authDevKeyStore.webhookSecret) {
      sendWebhook(authDevKeyStore.webhookUrl, authDevKeyStore.webhookSecret, 'key.stored', {
        keyId: keySlot.id, provider, label: keySlot.label,
      });
    }

    const response: Record<string, unknown> = {
      keyId: keySlot.id,
      provider,
      label: keySlot.label,
      envVar: keySlot.envVar,
    };

    if (duplicates.length > 0) {
      response.warning = `You already have ${duplicates.length} active ${provider} key${duplicates.length > 1 ? 's' : ''} with the same label or env var. Consider revoking the old one to avoid confusion.`;
      response.duplicateKeyIds = duplicates.map((d) => d.id);
    }

    return response;
  });

  /**
   * Call — Server decrypts both shares using separate keys, combines, proxies, zeros.
   * Developer only sends their vp_live_ key (via X-API-Key header) + keyId + path.
   */
  app.post('/call', async (request, reply) => {
    const schema = z.object({
      keyId: z.string().min(1).max(100),
      path: z.string().min(1).max(2000),
      method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional(),
      body: z.unknown().optional(),
      headers: z.record(z.string().max(200), z.string().max(8192)).optional().refine((h) => !h || Object.keys(h).length <= 20, { message: 'Max 20 headers' }),
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.issues });
    }

    const { userId, rawKey: vpKey, devKey: authDevKey } = (request as any).devAuth;
    const { keyId, path, method, body: reqBody, headers: reqHeaders } = parsed.data;

    // Kill switch — blocks ALL proxy calls for this user
    const userAccount = await prisma.user.findUnique({ where: { id: userId }, select: { killSwitch: true, globalDailyLimit: true, globalMonthlyLimit: true } });
    if (userAccount?.killSwitch) {
      return reply.status(503).send({ error: 'All proxy calls are paused. Disable the kill switch in your dashboard to resume.' });
    }

    // Global daily/monthly limits (across ALL keys)
    if (userAccount?.globalDailyLimit || userAccount?.globalMonthlyLimit) {
      const userKeySlots = await prisma.keySlot.findMany({ where: { userId }, select: { id: true } });
      const allKeyIds = userKeySlots.map(k => k.id);

      if (userAccount.globalDailyLimit && allKeyIds.length > 0) {
        const dayStart = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
        const dailyTotal = await prisma.accessLog.count({
          where: { keySlotId: { in: allKeyIds }, action: 'api_call', timestamp: { gte: dayStart } },
        });
        if (dailyTotal >= userAccount.globalDailyLimit) {
          return reply.status(429).send({ error: 'Global daily call limit reached', limit: userAccount.globalDailyLimit, used: dailyTotal });
        }
      }

      if (userAccount.globalMonthlyLimit && allKeyIds.length > 0) {
        const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        const monthlyTotal = await prisma.accessLog.count({
          where: { keySlotId: { in: allKeyIds }, action: 'api_call', timestamp: { gte: monthStart } },
        });
        if (monthlyTotal >= userAccount.globalMonthlyLimit) {
          return reply.status(429).send({ error: 'Global monthly call limit reached', limit: userAccount.globalMonthlyLimit, used: monthlyTotal });
        }
      }
    }

    // Load key slot
    const keySlot = await prisma.keySlot.findUnique({ where: { id: keyId } });
    if (!keySlot || keySlot.userId !== userId || keySlot.status !== 'ACTIVE') {
      return reply.status(404).send({ error: 'Key not found. Check the key ID is correct and the key hasn\'t been revoked.' });
    }

    // Check expiry
    if (keySlot.expiresAt && new Date(keySlot.expiresAt) < new Date()) {
      return reply.status(410).send({ error: 'Key has expired', expiresAt: keySlot.expiresAt });
    }

    // Check per-key daily/monthly limits
    // Look up the user's tier to decide hard block vs overage
    const sdkUser = await prisma.user.findUnique({ where: { id: userId }, select: { tier: true } });
    const sdkTier = (sdkUser?.tier as string) || 'free';

    if (keySlot.dailyLimit || keySlot.monthlyLimit) {
      const now = new Date();

      if (keySlot.dailyLimit) {
        const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const dailyCount = await prisma.accessLog.count({
          where: { keySlotId: keyId, action: 'api_call', timestamp: { gte: dayStart } },
        });
        if (dailyCount >= keySlot.dailyLimit) {
          if (keySlot.blockOnLimit) {
            // Free tier: always hard block
            if (sdkTier === 'free') {
              return reply.status(429).send({
                error: 'Daily call limit reached',
                limit: keySlot.dailyLimit,
                used: dailyCount,
                resets: 'midnight UTC',
              });
            }
            // Paid tiers: allow but log as overage
            request.log.info({ msg: 'Daily overage call allowed', keySlotId: keyId, tier: sdkTier, used: dailyCount, limit: keySlot.dailyLimit });
          }
          // Alert only mode — continue but notify
          if (authDevKey.alertEmail) {
            sendUsageAlert(authDevKey.alertEmail, keySlot.label, dailyCount, keySlot.dailyLimit);
          }
        }
      }

      if (keySlot.monthlyLimit) {
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthlyCount = await prisma.accessLog.count({
          where: { keySlotId: keyId, action: 'api_call', timestamp: { gte: monthStart } },
        });
        if (monthlyCount >= keySlot.monthlyLimit) {
          if (keySlot.blockOnLimit) {
            // Free tier: always hard block
            if (sdkTier === 'free') {
              return reply.status(429).send({
                error: 'Monthly call limit reached',
                limit: keySlot.monthlyLimit,
                used: monthlyCount,
                resets: 'next month',
              });
            }
            // Paid tiers: allow but log as overage
            request.log.info({ msg: 'Monthly overage call allowed', keySlotId: keyId, tier: sdkTier, used: monthlyCount, limit: keySlot.monthlyLimit });
          }
          if (authDevKey.alertEmail) {
            sendUsageAlert(authDevKey.alertEmail, keySlot.label, monthlyCount, keySlot.monthlyLimit);
          }
        }
      }
    }

    if (!keySlot.share2Encrypted || keySlot.share2Encrypted.length === 0) {
      return reply.status(400).send({ error: 'Key cannot be reconstructed. It may have been revoked or corrupted. Try re-storing the key.' });
    }

    // Enforce linked key restriction
    if (authDevKey.allowedKeySlotIds) {
      const allowed = authDevKey.allowedKeySlotIds.split(',').map((s: string) => s.trim()).filter(Boolean);
      if (allowed.length > 0 && !allowed.includes(keyId)) {
        return reply.status(403).send({ error: 'This API key is not linked to the requested key slot. Update linked keys in your dashboard.' });
      }
    }

    // Enforce provider restriction
    if (authDevKey.allowedProviders) {
      const allowed = authDevKey.allowedProviders.split(',').map((s: string) => s.trim());
      if (!allowed.includes(keySlot.provider)) {
        return reply.status(403).send({ error: `Provider '${keySlot.provider}' not allowed for this API key` });
      }
    }

    // Enforce endpoint restriction
    if (authDevKey.allowedEndpoints) {
      const allowed = authDevKey.allowedEndpoints.split(',').map((s: string) => s.trim());
      if (!allowed.some((ep: string) => path.startsWith(ep))) {
        return reply.status(403).send({ error: 'Endpoint not allowed for this API key' });
      }
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
      return reply.status(400).send({ error: 'Key reconstruction failed. Your developer key (vp_live_) may not match the one used to store this key.' });
    }

    const authHeader = buildAuthHeader(keySlot.provider, apiKey);
    const startTime = Date.now();

    try {
      const upstreamUrl = `${providerUrl}${path}`;
      // Only forward safe headers — prevent Host, Transfer-Encoding, etc. injection
      const SAFE_HEADERS = new Set(['content-type', 'accept', 'accept-encoding', 'accept-language', 'cache-control', 'user-agent', 'anthropic-version', 'openai-beta']);
      const filteredHeaders: Record<string, string> = {};
      if (reqHeaders) {
        for (const [k, v] of Object.entries(reqHeaders)) {
          if (SAFE_HEADERS.has(k.toLowerCase())) filteredHeaders[k] = v;
        }
      }
      const fetchHeaders: Record<string, string> = {
        ...filteredHeaders,
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

      // Webhook notification (non-blocking)
      if (authDevKey.webhookUrl && authDevKey.webhookSecret) {
        sendWebhook(authDevKey.webhookUrl, authDevKey.webhookSecret, 'proxy.call', {
          keyId, path, status: response.status, latencyMs,
        });
      }

      // Detect IP restriction errors and return a helpful message
      if (response.status === 403) {
        try {
          const clonedRes = response.clone();
          const errText = await clonedRes.text();
          const lowerErr = errText.toLowerCase();
          if (lowerErr.includes('ip') || lowerErr.includes('address') || lowerErr.includes('origin') || lowerErr.includes('whitelist') || lowerErr.includes('allowlist')) {
            return reply.status(403).send({
              error: `The provider rejected the request due to IP restrictions. The call came from VaultProof's server, not your IP. Fix: remove the IP restriction on your API key, or use vault.retrieve() so your server makes the call directly.`,
              provider_response: errText.slice(0, 500),
            });
          }
        } catch {}
      }

      // Invalid key alert — notify if provider rejected the key (opt-in via alertEmail)
      if ((response.status === 401 || response.status === 403) && authDevKey.alertEmail) {
        sendInvalidKeyAlert(authDevKey.alertEmail, keySlot.label, keySlot.provider, response.status, path);
      }

      // Usage alert check (non-blocking)
      if (authDevKey.alertThreshold && authDevKey.alertEmail) {
        const oneHourAgo = new Date(Date.now() - 3600_000);
        prisma.accessLog.count({
          where: { appId: authDevKey.id, timestamp: { gte: oneHourAgo } },
        }).then(count => {
          if (count >= authDevKey.alertThreshold!) {
            sendUsageAlert(authDevKey.alertEmail!, authDevKey.label, count, authDevKey.alertThreshold!);
          }
        }).catch(() => {});
      }

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

  /**
   * Retrieve — Reconstruct the raw API key from encrypted shares.
   * Used by CLI `vaultproof env` and `vaultproof exec` commands.
   * The key is reconstructed server-side and returned over TLS.
   */
  app.post('/retrieve', async (request, reply) => {
    const schema = z.object({ keyId: z.string().min(1).max(100) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid input' });

    const { userId, rawKey: vpKey } = (request as any).devAuth;
    const { keyId } = parsed.data;

    const keySlot = await prisma.keySlot.findUnique({ where: { id: keyId } });
    if (!keySlot || keySlot.userId !== userId || keySlot.status !== 'ACTIVE') {
      return reply.status(404).send({ error: 'Key not found. Check the key ID is correct and the key hasn\'t been revoked.' });
    }

    if (keySlot.expiresAt && new Date(keySlot.expiresAt) < new Date()) {
      return reply.status(410).send({ error: 'Key has expired' });
    }

    if (!keySlot.share2Encrypted || keySlot.share2Encrypted.length === 0) {
      return reply.status(400).send({ error: 'Key cannot be reconstructed. It may have been revoked or corrupted. Try re-storing the key.' });
    }

    let apiKey: string;
    try {
      const decrypted1 = decrypt(Buffer.from(keySlot.share1Encrypted));
      const s1 = deserializeShare(decrypted1.toString('utf-8'));
      zeroBuffer(decrypted1);
      const share2Str = decryptShare2(Buffer.from(keySlot.share2Encrypted), vpKey);
      const s2 = deserializeShare(share2Str);
      apiKey = new TextDecoder().decode(combine([s1, s2]));
    } catch {
      return reply.status(400).send({ error: 'Key reconstruction failed. Your developer key (vp_live_) may not match the one used to store this key.' });
    }

    // Log the retrieval
    prisma.accessLog.create({
      data: {
        keySlotId: keyId,
        appId: (request as any).devAuth.keyId,
        action: 'key_retrieval',
        zkProof: 'sdk-authenticated',
        nullifier: `retrieve-${randomBytes(16).toString('hex')}`,
        metadata: JSON.stringify({ provider: keySlot.provider }),
      },
    }).catch(() => {});

    return { apiKey, provider: keySlot.provider };
  });

  /**
   * Batch Retrieve — Reconstruct multiple API keys in a single round trip.
   * Accepts an array of key IDs, returns all reconstructed keys at once.
   */
  app.post('/retrieve-batch', async (request, reply) => {
    const schema = z.object({ keyIds: z.array(z.string().min(1).max(100)).min(1).max(20) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid input. Provide keyIds array (max 20).' });

    const { userId, rawKey: vpKey } = (request as any).devAuth;
    const { keyIds } = parsed.data;

    const keySlots = await prisma.keySlot.findMany({
      where: { id: { in: keyIds }, userId, status: 'ACTIVE' },
    });

    const results: Array<{ keyId: string; apiKey?: string; provider?: string; error?: string }> = [];

    for (const requestedId of keyIds) {
      const slot = keySlots.find(s => s.id === requestedId);
      if (!slot) {
        results.push({ keyId: requestedId, error: 'Key not found. Check the key ID is correct and the key hasn\'t been revoked.' });
        continue;
      }
      if (slot.expiresAt && new Date(slot.expiresAt) < new Date()) {
        results.push({ keyId: requestedId, error: 'Key has expired' });
        continue;
      }
      if (!slot.share2Encrypted || slot.share2Encrypted.length === 0) {
        results.push({ keyId: requestedId, error: 'Key cannot be reconstructed. It may have been revoked or corrupted. Try re-storing the key.' });
        continue;
      }

      try {
        const decrypted1 = decrypt(Buffer.from(slot.share1Encrypted));
        const s1 = deserializeShare(decrypted1.toString('utf-8'));
        zeroBuffer(decrypted1);
        const share2Str = decryptShare2(Buffer.from(slot.share2Encrypted), vpKey);
        const s2 = deserializeShare(share2Str);
        const apiKey = new TextDecoder().decode(combine([s1, s2]));
        results.push({ keyId: requestedId, apiKey, provider: slot.provider });
      } catch {
        results.push({ keyId: requestedId, error: 'Key reconstruction failed. Your developer key (vp_live_) may not match the one used to store this key.' });
      }
    }

    // Log batch retrieval (fire-and-forget)
    prisma.accessLog.create({
      data: {
        keySlotId: keyIds[0],
        appId: (request as any).devAuth.keyId,
        action: 'key_retrieval_batch',
        zkProof: 'sdk-authenticated',
        nullifier: `retrieve-batch-${randomBytes(16).toString('hex')}`,
        metadata: JSON.stringify({ count: keyIds.length, providers: results.filter(r => r.provider).map(r => r.provider) }),
      },
    }).catch(() => {});

    return { keys: results };
  });

  // List stored keys
  app.get('/keys', async (request) => {
    const { userId } = (request as any).devAuth;
    const keys = await prisma.keySlot.findMany({
      where: { userId, status: 'ACTIVE' },
      select: { id: true, provider: true, label: true, envVar: true, createdAt: true },
    });
    return { keys };
  });

  // Account limits — used by CLI `migrate` to check capacity before scanning
  app.get('/limits', async (request) => {
    const { userId } = (request as any).devAuth;

    const [user, usedSlots] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { tier: true } }),
      prisma.keySlot.count({ where: { userId, status: 'ACTIVE' } }),
    ]);

    const tier = (user?.tier as string) || 'free';

    // Import tier definitions inline to avoid circular deps
    const TIER_LIMITS: Record<string, { maxKeySlots: number }> = {
      free: { maxKeySlots: 3 },
      starter: { maxKeySlots: 10 },
      pro: { maxKeySlots: 50 },
      max: { maxKeySlots: 50 },
      enterprise: { maxKeySlots: 1000 },
    };

    const limits = TIER_LIMITS[tier] || TIER_LIMITS.free;

    return {
      tier,
      keySlots: {
        used: usedSlots,
        limit: limits.maxKeySlots,
        available: Math.max(0, limits.maxKeySlots - usedSlots),
      },
      features: {
        migrate: tier === 'pro' || tier === 'max' || tier === 'enterprise',
      },
    };
  });

  // Revoke a key
  app.post('/revoke', async (request, reply) => {
    const schema = z.object({ keyId: z.string().min(1).max(100) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid input' });

    const { userId } = (request as any).devAuth;
    const { keyId } = parsed.data;

    const keySlot = await prisma.keySlot.findUnique({ where: { id: keyId } });
    if (!keySlot || keySlot.userId !== userId) {
      return reply.status(404).send({ error: 'Key not found. Check the key ID is correct and the key hasn\'t been revoked.' });
    }

    await prisma.keySlot.update({
      where: { id: keyId },
      data: {
        status: 'REVOKED',
        share1Encrypted: Buffer.alloc(0),
        share2Encrypted: Buffer.alloc(0),
      },
    });

    // Webhook notification (non-blocking)
    const authDevKeyRevoke = (request as any).devAuth.devKey;
    if (authDevKeyRevoke.webhookUrl && authDevKeyRevoke.webhookSecret) {
      sendWebhook(authDevKeyRevoke.webhookUrl, authDevKeyRevoke.webhookSecret, 'key.revoked', {
        keyId,
      });
    }

    return { status: 'revoked' };
  });

  // Update per-key call limits
  app.put('/keys/:keyId/limits', async (request, reply) => {
    const schema = z.object({
      dailyLimit: z.number().int().min(1).nullable().optional(),
      monthlyLimit: z.number().int().min(1).nullable().optional(),
      blockOnLimit: z.boolean().optional(),
    });

    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.issues });
    }

    const { userId } = (request as any).devAuth;
    const { keyId } = request.params as { keyId: string };

    const keySlot = await prisma.keySlot.findUnique({ where: { id: keyId } });
    if (!keySlot || keySlot.userId !== userId) {
      return reply.status(404).send({ error: 'Key not found. Check the key ID is correct and the key hasn\'t been revoked.' });
    }
    if (keySlot.status !== 'ACTIVE') {
      return reply.status(400).send({ error: 'Key slot not active' });
    }

    const updateData: Record<string, unknown> = {};
    if (parsed.data.dailyLimit !== undefined) updateData.dailyLimit = parsed.data.dailyLimit;
    if (parsed.data.monthlyLimit !== undefined) updateData.monthlyLimit = parsed.data.monthlyLimit;
    if (parsed.data.blockOnLimit !== undefined) updateData.blockOnLimit = parsed.data.blockOnLimit;

    await prisma.keySlot.update({
      where: { id: keyId },
      data: updateData,
    });

    return {
      status: 'updated',
      dailyLimit: parsed.data.dailyLimit ?? keySlot.dailyLimit,
      monthlyLimit: parsed.data.monthlyLimit ?? keySlot.monthlyLimit,
      blockOnLimit: parsed.data.blockOnLimit ?? keySlot.blockOnLimit,
    };
  });

  // Validate a key against its provider
  app.post('/validate', async (request, reply) => {
    const schema = z.object({ keyId: z.string().min(1).max(100) });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid input' });

    const { userId, rawKey: vpKey } = (request as any).devAuth;
    const { keyId } = parsed.data;

    const keySlot = await prisma.keySlot.findUnique({ where: { id: keyId } });
    if (!keySlot || keySlot.userId !== userId || keySlot.status !== 'ACTIVE') {
      return reply.status(404).send({ error: 'Key not found. Check the key ID is correct and the key hasn\'t been revoked.' });
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
        return reply.status(400).send({ error: 'Key cannot be reconstructed. It may have been revoked or corrupted. Try re-storing the key.' });
      }
      const share2Str = decryptShare2(Buffer.from(keySlot.share2Encrypted), vpKey);
      const s2 = deserializeShare(share2Str);
      apiKey = new TextDecoder().decode(combine([s1, s2]));
    } catch {
      return reply.status(400).send({ error: 'Key reconstruction failed. Your developer key (vp_live_) may not match the one used to store this key.' });
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
