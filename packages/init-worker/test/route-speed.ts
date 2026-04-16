#!/usr/bin/env tsx
/**
 * Whole-route speed test for init-worker proxy path.
 *
 * Usage:
 *   VP_JWT=<supabase jwt> \
 *   VP_WORKER_URL=https://vaultproof-init-staging.vaultproof.workers.dev \
 *   npx tsx test/route-speed.ts
 *
 * Optional tuning:
 *   VP_SPEED_WARMUP=5
 *   VP_SPEED_REQUESTS=30
 *   VP_SPEED_P50_MS=700
 *   VP_SPEED_P95_MS=1400
 *   VP_SPEED_P99_MS=2000
 */
import { splitString, serializeShare } from '@vaultproof/shamir';

type Json = Record<string, unknown>;

const WORKER_URL = process.env.VP_WORKER_URL || 'https://vaultproof-init-staging.vaultproof.workers.dev';
const JWT = process.env.VP_JWT;

const WARMUP = parseInt(process.env.VP_SPEED_WARMUP || '5', 10);
const REQUESTS = parseInt(process.env.VP_SPEED_REQUESTS || '30', 10);

const P50_LIMIT = parseFloat(process.env.VP_SPEED_P50_MS || '700');
const P95_LIMIT = parseFloat(process.env.VP_SPEED_P95_MS || '1400');
const P99_LIMIT = parseFloat(process.env.VP_SPEED_P99_MS || '2000');

if (!JWT) {
  console.error('Missing VP_JWT environment variable');
  process.exit(2);
}

if (!Number.isFinite(WARMUP) || WARMUP < 0) {
  console.error(`Invalid VP_SPEED_WARMUP: ${String(process.env.VP_SPEED_WARMUP)}`);
  process.exit(2);
}
if (!Number.isFinite(REQUESTS) || REQUESTS <= 0) {
  console.error(`Invalid VP_SPEED_REQUESTS: ${String(process.env.VP_SPEED_REQUESTS)}`);
  process.exit(2);
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const w = idx - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

function fmt(ms: number): string {
  return `${ms.toFixed(1)}ms`;
}

function splitAndSerialize(secret: string): { share1: string; share2: string } {
  const shares = splitString(secret, 2, 2);
  return { share1: serializeShare(shares[0]), share2: serializeShare(shares[1]) };
}

async function post(path: string, body: Json, auth: string): Promise<{ status: number; data: Json }> {
  const res = await fetch(`${WORKER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Json;
  return { status: res.status, data };
}

async function timedProxyCall(vpProjId: string): Promise<{ ms: number; status: number; openaiVersion: string | null }> {
  const start = performance.now();
  const res = await fetch(`${WORKER_URL}/p/openai/v1/models`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${vpProjId}` },
  });
  await res.arrayBuffer();
  const end = performance.now();
  return {
    ms: end - start,
    status: res.status,
    openaiVersion: res.headers.get('openai-version'),
  };
}

async function run(): Promise<void> {
  console.log(`\nRoute speed test against ${WORKER_URL}`);
  console.log(`Path: GET /p/openai/v1/models`);
  console.log(`Warmup: ${WARMUP}, Measured: ${REQUESTS}\n`);

  const health = await fetch(`${WORKER_URL}/health`);
  if (health.status !== 200) {
    console.error(`Health check failed: status=${health.status}`);
    process.exit(1);
  }

  const create = await post('/api/v1/init/projects', { name: `speed-test-${Date.now()}` }, JWT!);
  if (create.status !== 201 || !create.data.id || !create.data.vp_proj_id) {
    console.error(`Project create failed: status=${create.status}`);
    process.exit(1);
  }

  const projectRowId = String(create.data.id);
  const vpProjId = String(create.data.vp_proj_id);

  const openaiShares = splitAndSerialize(`sk-proj-fake-${'a'.repeat(40)}`);
  const upload = await post(`/api/v1/init/projects/${projectRowId}/keys`, {
    provider: 'openai',
    slug: 'openai',
    ...openaiShares,
    upstream_base_url: 'https://api.openai.com',
    auth_header_name: 'Authorization',
    auth_header_template: 'Bearer {key}',
  }, JWT!);

  if (upload.status !== 201) {
    console.error(`OpenAI key upload failed: status=${upload.status}`);
    process.exit(1);
  }

  for (let i = 0; i < WARMUP; i++) {
    const sample = await timedProxyCall(vpProjId);
    if (sample.status !== 401 || !sample.openaiVersion) {
      console.error(`Warmup request ${i + 1} failed: status=${sample.status}, openai-version=${sample.openaiVersion}`);
      process.exit(1);
    }
  }

  const timings: number[] = [];
  for (let i = 0; i < REQUESTS; i++) {
    const sample = await timedProxyCall(vpProjId);
    if (sample.status !== 401 || !sample.openaiVersion) {
      console.error(`Measured request ${i + 1} failed: status=${sample.status}, openai-version=${sample.openaiVersion}`);
      process.exit(1);
    }
    timings.push(sample.ms);
  }

  const p50 = percentile(timings, 50);
  const p95 = percentile(timings, 95);
  const p99 = percentile(timings, 99);
  const min = Math.min(...timings);
  const max = Math.max(...timings);
  const mean = avg(timings);

  console.log('Latency summary');
  console.log(`  min:  ${fmt(min)}`);
  console.log(`  p50:  ${fmt(p50)} (limit ${fmt(P50_LIMIT)})`);
  console.log(`  p95:  ${fmt(p95)} (limit ${fmt(P95_LIMIT)})`);
  console.log(`  p99:  ${fmt(p99)} (limit ${fmt(P99_LIMIT)})`);
  console.log(`  avg:  ${fmt(mean)}`);
  console.log(`  max:  ${fmt(max)}`);
  console.log(`  n:    ${timings.length}`);
  console.log(`  vp_proj_id: ${vpProjId}`);
  console.log(`  project_row_id: ${projectRowId}`);
  console.log('  note: cleanup is currently manual (same as integration.ts)');

  const failures: string[] = [];
  if (p50 > P50_LIMIT) failures.push(`p50 ${fmt(p50)} > ${fmt(P50_LIMIT)}`);
  if (p95 > P95_LIMIT) failures.push(`p95 ${fmt(p95)} > ${fmt(P95_LIMIT)}`);
  if (p99 > P99_LIMIT) failures.push(`p99 ${fmt(p99)} > ${fmt(P99_LIMIT)}`);

  if (failures.length > 0) {
    console.error('\nSPEED TEST FAILED');
    for (const line of failures) console.error(`  - ${line}`);
    process.exit(1);
  }

  console.log('\nSPEED TEST PASSED');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
