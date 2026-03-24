import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import { config } from 'dotenv';
import { keyRoutes } from './routes/keys.js';
import { proxyRoutes } from './routes/proxy.js';

config();

const PORT = parseInt(process.env.PORT || '3333', 10);
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'];

async function start() {
  const app = Fastify({ logger: true });

  // Security headers
  await app.register(helmet, {
    contentSecurityPolicy: false, // Widget needs to be embeddable
    crossOriginEmbedderPolicy: false,
  });

  // CORS — restrict to known origins
  await app.register(cors, {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
    credentials: true,
  });

  // Rate limiting
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

  // Generic error handler — never leak internals
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    const code = (error as any).statusCode || 500;
    reply.status(code).send({ error: 'Internal server error' });
  });

  // Health check (no auth)
  app.get('/health', async () => ({ status: 'ok', service: 'zkvault' }));

  // API routes
  await app.register(keyRoutes, { prefix: '/api/v1/keys' });
  await app.register(proxyRoutes, { prefix: '/api/v1/proxy' });

  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`ZK Vault backend running on port ${PORT}`);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
