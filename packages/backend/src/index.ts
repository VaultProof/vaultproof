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

config();

const PORT = parseInt(process.env.PORT || '3333', 10);
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'];

async function start() {
  const app = Fastify({ logger: true });

  // Security headers
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
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

  // Error handler — temporarily verbose for debugging
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    const code = (error as any).statusCode || 500;
    reply.status(code).send({
      error: (error as Error).message,
      type: (error as Error).name,
    });
  });

  // Health check (no proxy auth required)
  app.get('/health', async () => ({ status: 'ok', service: 'vaultproof' }));

  // API routes
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(keyRoutes, { prefix: '/api/v1/keys' });
  await app.register(proxyRoutes, { prefix: '/api/v1/proxy' });
  await app.register(statsRoutes, { prefix: '/api/v1/stats' });
  await app.register(developerKeyRoutes, { prefix: '/api/v1/dev-keys' });
  await app.register(sdkRoutes, { prefix: '/api/v1/sdk' });

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`VaultProof backend running on port ${PORT}`);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
