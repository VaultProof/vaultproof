import * as Sentry from '@sentry/node';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'production',
    beforeSend(event) {
      // Don't report 4xx client errors
      const status = event.contexts?.response?.status_code as number;
      if (status && status >= 400 && status < 500) return null;
      return event;
    },
  });
}

import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import { config } from 'dotenv';
import { requireProxyAuth } from './middleware/proxy-auth.js';
import { authRoutes } from './routes/auth.js';
import { keyRoutes } from './routes/keys.js';
import { proxyRoutes } from './routes/proxy.js';
import { statsRoutes } from './routes/stats.js';
import { developerKeyRoutes } from './routes/developer-keys.js';
import { sdkRoutes } from './routes/sdk.js';
import { billingRoutes } from './routes/billing.js';
import { transparentProxyRoutes } from './routes/transparent-proxy.js';
import { adminRoutes } from './routes/admin.js';
import { warmupVerifier } from './crypto/proof-verifier.js';

config();

const PORT = parseInt(process.env.PORT || '3333', 10);
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'];

// Validate required secrets in production
if (process.env.NODE_ENV !== 'test' && process.env.NODE_ENV !== 'development') {
  const missing: string[] = [];
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'vaultproof-dev-secret-change-in-production') {
    missing.push('JWT_SECRET (must be set to a unique production value)');
  }
  if (!process.env.VAULT_ENCRYPTION_KEY) {
    missing.push('VAULT_ENCRYPTION_KEY');
  }
  if (!process.env.PROXY_SECRET) {
    missing.push('PROXY_SECRET');
  }
  if (missing.length > 0) {
    console.error('FATAL: Missing required secrets for production:');
    missing.forEach(s => console.error(`  - ${s}`));
    process.exit(1);
  }
  if (!process.env.REQUIRE_REAL_PROOFS) {
    console.error('FATAL: REQUIRE_REAL_PROOFS not set. ZK proof verification would use insecure placeholder.');
    console.error('  Set REQUIRE_REAL_PROOFS=true in your environment variables.');
    process.exit(1);
  }
}

async function start() {
  const app = Fastify({ logger: true });

  // Security headers
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  });

  // CORS
  await app.register(cors, {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  });

  // Rate limiting
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

  // Proxy authentication — all /api/* routes require Worker signature
  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      await requireProxyAuth(request, reply);
    }
  });

  // Error handler — log details server-side, generic message to client
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    const code = (error as any).statusCode || 500;
    if (code >= 500 && process.env.SENTRY_DSN) {
      Sentry.captureException(error, { extra: { url: request.url, method: request.method } });
    }
    reply.status(code).send({ error: 'Internal server error' });
  });

  // Health check (no proxy auth required)
  app.get('/health', async () => ({ status: 'ok', service: 'vaultproof' }));

  // Hidden admin routes (outside /api/ prefix — skips proxy auth hook)
  await app.register(adminRoutes, { prefix: '/admin' });

  // API routes
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(keyRoutes, { prefix: '/api/v1/keys' });
  await app.register(proxyRoutes, { prefix: '/api/v1/proxy' });
  await app.register(statsRoutes, { prefix: '/api/v1/stats' });
  await app.register(developerKeyRoutes, { prefix: '/api/v1/dev-keys' });
  await app.register(sdkRoutes, { prefix: '/api/v1/sdk' });
  await app.register(billingRoutes, { prefix: '/api/v1/billing' });

  // Transparent proxy — must be after /api/v1/ routes to avoid conflicts
  await app.register(transparentProxyRoutes, { prefix: '/v1' });

  // Warm up Noir verifier (throws in production if REQUIRE_REAL_PROOFS=true and circuit missing)
  await warmupVerifier();

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`VaultProof backend running on port ${PORT}`);

  // Graceful shutdown — finish in-flight requests before exiting
  const shutdown = async (signal: string) => {
    console.log(`${signal} received, shutting down gracefully...`);
    await app.close();
    console.log('Server closed. Exiting.');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
