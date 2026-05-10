import { randomUUID, createHmac } from 'node:crypto';

const RUNTIME_TOKEN_PREFIX = 'vp_exec_v1.';
const RUNTIME_TOKEN_AUDIENCE = 'vaultproof-enterprise-execute';
const RUNTIME_TOKEN_SCOPE = 'project:execute';

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function readRequiredEnv(name) {
  const value = process.env[name]?.trim() || '';
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const secret = readRequiredEnv('ENTERPRISE_PROXY_TOKEN_SECRET');
if (secret.length < 32) {
  throw new Error('ENTERPRISE_PROXY_TOKEN_SECRET must be at least 32 characters');
}

const projectId = readRequiredEnv('PROJECT_ID');
const now = Math.floor(Date.now() / 1000);
const ttlSeconds = Number.parseInt(process.env.TTL_SECONDS || '300', 10);
const safeTtlSeconds = Number.isFinite(ttlSeconds) && ttlSeconds > 0
  ? Math.min(ttlSeconds, 3600)
  : 300;

const payload = {
  v: 1,
  aud: RUNTIME_TOKEN_AUDIENCE,
  scope: RUNTIME_TOKEN_SCOPE,
  project_id: projectId,
  iat: now,
  nbf: now - 5,
  exp: now + safeTtlSeconds,
  jti: process.env.JTI?.trim() || randomUUID(),
};

const providers = parseList(process.env.PROVIDERS);
if (providers.length) payload.providers = providers;

const slugs = parseList(process.env.SLUGS);
if (slugs.length) payload.slugs = slugs;

const methods = parseList(process.env.METHODS);
if (methods.length) payload.methods = methods.map((method) => method.toUpperCase());

const upstreamPathPrefixes = parseList(process.env.UPSTREAM_PATH_PREFIXES);
if (upstreamPathPrefixes.length) payload.upstream_path_prefixes = upstreamPathPrefixes;

const customerGateways = parseList(process.env.CUSTOMER_GATEWAYS);
if (customerGateways.length) payload.customer_gateways = customerGateways;

const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
const signature = createHmac('sha256', secret)
  .update(`${RUNTIME_TOKEN_PREFIX}${encodedPayload}`)
  .digest('base64url');

const token = `${RUNTIME_TOKEN_PREFIX}${encodedPayload}.${signature}`;

console.log(JSON.stringify({
  token,
  expires_at: new Date(payload.exp * 1000).toISOString(),
  project_id: payload.project_id,
  jti: payload.jti,
  constraints: {
    providers: payload.providers || [],
    slugs: payload.slugs || [],
    methods: payload.methods || [],
    upstream_path_prefixes: payload.upstream_path_prefixes || [],
    customer_gateways: payload.customer_gateways || [],
  },
}, null, 2));
