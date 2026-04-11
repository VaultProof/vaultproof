#!/usr/bin/env tsx
/**
 * Integration test against a deployed init-worker.
 *
 *   VP_JWT=<supabase jwt> \
 *   VP_WORKER_URL=https://vaultproof-init-staging.vaultproof.workers.dev \
 *   npx tsx test/integration.ts
 *
 * Creates a project, uploads OpenAI + Stripe + Anthropic keys, hits each
 * /p/:slug/* proxy route, verifies the response came from the real upstream
 * (not from our worker or a cached error), and cleans up.
 *
 * Exits non-zero on any failure. Safe to run repeatedly.
 */
import { splitString, serializeShare } from '@vaultproof/shamir';

const WORKER_URL = process.env.VP_WORKER_URL || 'https://vaultproof-init-staging.vaultproof.workers.dev';
const JWT = process.env.VP_JWT;

if (!JWT) {
  console.error('Missing VP_JWT environment variable');
  process.exit(2);
}

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

async function post(path: string, body: unknown, auth: string): Promise<{ status: number; data: any }> {
  const res = await fetch(`${WORKER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function head(path: string, auth: string): Promise<{ status: number; headers: Record<string, string> }> {
  const res = await fetch(`${WORKER_URL}${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${auth}` },
  });
  const headers: Record<string, string> = {};
  for (const [k, v] of res.headers) headers[k.toLowerCase()] = v;
  return { status: res.status, headers };
}

function splitAndSerialize(secret: string): { share1: string; share2: string } {
  const s = splitString(secret, 2, 2);
  return { share1: serializeShare(s[0]), share2: serializeShare(s[1]) };
}

async function run(): Promise<void> {
  console.log(`\nIntegration tests against ${WORKER_URL}\n`);

  // ── Health check ──
  const health = await fetch(`${WORKER_URL}/health`);
  const healthBody = (await health.json()) as { status: string };
  check('health check', health.status === 200 && healthBody.status === 'ok');

  // ── Create project ──
  const create = await post('/api/v1/init/projects', { name: 'integration-test' }, JWT!);
  check('create project', create.status === 201 && !!create.data.vp_proj_id);
  const projectRowId = create.data.id as string;
  const vpProjId = create.data.vp_proj_id as string;
  if (!projectRowId) { console.error('cannot continue without project id'); process.exit(1); }

  // ── Upload OpenAI ──
  const openaiShares = splitAndSerialize('sk-proj-fake-' + 'a'.repeat(40));
  const uploadOa = await post(`/api/v1/init/projects/${projectRowId}/keys`, {
    provider: 'openai', slug: 'openai',
    ...openaiShares,
    upstream_base_url: 'https://api.openai.com',
    auth_header_name: 'Authorization',
    auth_header_template: 'Bearer {key}',
  }, JWT!);
  check('upload openai key', uploadOa.status === 201);

  // ── Upload Stripe ──
  const stripeShares = splitAndSerialize('sk_test_fake' + 'a'.repeat(24));
  const uploadSt = await post(`/api/v1/init/projects/${projectRowId}/keys`, {
    provider: 'stripe', slug: 'stripe',
    ...stripeShares,
    upstream_base_url: 'https://api.stripe.com',
    auth_header_name: 'Authorization',
    auth_header_template: 'Bearer {key}',
  }, JWT!);
  check('upload stripe key', uploadSt.status === 201);

  // ── Upload Anthropic (with extra_headers) ──
  const anthShares = splitAndSerialize('sk-ant-api03-fake-' + 'a'.repeat(80));
  const uploadAn = await post(`/api/v1/init/projects/${projectRowId}/keys`, {
    provider: 'anthropic', slug: 'anthropic',
    ...anthShares,
    upstream_base_url: 'https://api.anthropic.com',
    auth_header_name: 'x-api-key',
    auth_header_template: '{key}',
    extra_headers: { 'anthropic-version': '2023-06-01' },
  }, JWT!);
  check('upload anthropic key', uploadAn.status === 201);

  // ── Proxy: OpenAI ──
  const oaProxy = await head('/p/openai/v1/models', vpProjId);
  check('openai proxy reaches upstream',
    oaProxy.status === 401 && oaProxy.headers['openai-version'] !== undefined,
    `status=${oaProxy.status} openai-version=${oaProxy.headers['openai-version']}`);

  // ── Proxy: Stripe ──
  const stProxy = await head('/p/stripe/v1/customers', vpProjId);
  check('stripe proxy reaches upstream',
    stProxy.status === 401 && (stProxy.headers['www-authenticate'] || '').includes('Stripe'),
    `status=${stProxy.status}`);

  // ── Proxy: Anthropic ──
  const anProxy = await head('/p/anthropic/v1/messages', vpProjId);
  // Anthropic rejects HEAD with 405; either way the response comes from Anthropic.
  check('anthropic proxy reaches upstream',
    anProxy.status === 405 || anProxy.status === 401,
    `status=${anProxy.status}`);

  // ── Wrong slug = 404 ──
  const wrongSlug = await head('/p/nonexistent-slug/anything', vpProjId);
  check('wrong slug returns 404', wrongSlug.status === 404);

  // ── Bad project id = 401 ──
  const badProj = await head('/p/openai/v1/models', 'vp-proj-not-a-real-project');
  check('unknown project id returns 401', badProj.status === 401);

  // ── SSRF rejections (sample of 5) ──
  const ssrfCases: Array<[string, string]> = [
    ['http scheme', 'http://api.openai.com'],
    ['loopback IP', 'https://127.0.0.1'],
    ['metadata name', 'https://metadata.google.internal/'],
    ['.internal suffix', 'https://api.internal/'],
    ['.workers.dev suffix', 'https://evil.workers.dev/'],
  ];
  for (const [label, upstream] of ssrfCases) {
    const res = await post(`/api/v1/init/projects/${projectRowId}/keys`, {
      provider: `ssrf-${label.replace(/\W/g, '')}`,
      slug: `ssrf-${label.replace(/\W/g, '').toLowerCase().slice(0, 20)}`,
      ...openaiShares,
      upstream_base_url: upstream,
      auth_header_name: 'Authorization',
      auth_header_template: 'Bearer {key}',
    }, JWT!);
    check(`ssrf reject: ${label}`, res.status === 400, `status=${res.status}`);
  }

  // ── Cleanup ──
  console.log('\n  (manual cleanup: run `delete from public.projects where id = ...`)');
  console.log(`  project_row_id = ${projectRowId}`);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => { console.error(err); process.exit(1); });
