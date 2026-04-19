#!/usr/bin/env tsx

type JsonRecord = Record<string, unknown>;

const WORKER_URL = process.env.VP_WORKER_URL || 'https://init.vaultproof.dev';
const JWT = process.env.VP_JWT;
const PROJECT_TOKEN = process.env.VP_PROJECT_ID;
const PROXY_SLUG = process.env.VP_PROXY_SLUG || '';
const PROXY_PATH = process.env.VP_PROXY_PATH || '';
const POLL_ATTEMPTS = Math.max(1, Number(process.env.VP_POLL_ATTEMPTS || 5));
const POLL_DELAY_MS = Math.max(250, Number(process.env.VP_POLL_DELAY_MS || 1500));

if (!JWT) {
  console.error('Missing VP_JWT');
  console.error('Example: VP_JWT=<supabase-jwt> VP_PROJECT_ID=vp-proj-... npx tsx test/dashboard-diagnose.ts');
  process.exit(2);
}

if (!PROJECT_TOKEN) {
  console.error('Missing VP_PROJECT_ID');
  console.error('Example: VP_JWT=<supabase-jwt> VP_PROJECT_ID=vp-proj-... npx tsx test/dashboard-diagnose.ts');
  process.exit(2);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(path: string, authToken: string): Promise<{ status: number; data: any }> {
  const res = await fetch(`${WORKER_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function fetchProxy(path: string, authToken: string): Promise<{ status: number; headers: Record<string, string>; bodyPreview: string }> {
  const res = await fetch(`${WORKER_URL}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${authToken}`,
      'Cache-Control': 'no-store',
    },
  });
  const headers: Record<string, string> = {};
  for (const [key, value] of res.headers) headers[key.toLowerCase()] = value;
  const bodyPreview = await res.text().then((text) => text.slice(0, 180)).catch(() => '');
  return { status: res.status, headers, bodyPreview };
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function printSection(title: string): void {
  console.log(`\n== ${title} ==`);
}

function formatNum(value: unknown): string {
  return Number(value || 0).toLocaleString('en-US');
}

function summarizeProjectCalls(
  keys: Array<JsonRecord>,
  keyStatsRows: Array<JsonRecord>,
  logRows: Array<JsonRecord>,
): { projectCalls: number; matchingKeyStats: number; matchingLogs: number } {
  const keyIds = new Set(keys.map((row) => String(row.id || '')));
  let projectCalls = 0;
  let matchingKeyStats = 0;
  for (const row of keyStatsRows) {
    const keyId = String(row.id || row.keyId || '');
    if (!keyIds.has(keyId)) continue;
    matchingKeyStats += 1;
    projectCalls += Number(row.callsThisMonth || row.calls_this_month || 0);
  }

  let matchingLogs = 0;
  for (const row of logRows) {
    const keyId = String(row.keySlotId || row.key_slot_id || '');
    if (keyIds.has(keyId)) matchingLogs += 1;
  }

  return { projectCalls, matchingKeyStats, matchingLogs };
}

async function readSnapshot(projectRowId: string): Promise<{
  overview: JsonRecord;
  keys: Array<JsonRecord>;
  keyStatsRows: Array<JsonRecord>;
  logRows: Array<JsonRecord>;
  summary: { projectCalls: number; matchingKeyStats: number; matchingLogs: number };
}> {
  const [overviewRes, keysRes, byKeyRes, logsRes] = await Promise.all([
    fetchJson('/api/v1/init/projects/stats/overview', JWT!),
    fetchJson(`/api/v1/init/projects/${projectRowId}/keys`, JWT!),
    fetchJson('/api/v1/init/projects/stats/by-key', JWT!),
    fetchJson('/api/v1/init/projects/stats/logs?days=30&limit=50', JWT!),
  ]);

  const overview = (overviewRes.data || {}) as JsonRecord;
  const keys = asArray<JsonRecord>((keysRes.data || {}).keys);
  const keyStatsRows = asArray<JsonRecord>((byKeyRes.data || {}).keys);
  const logRows = asArray<JsonRecord>((logsRes.data || {}).logs);
  const summary = summarizeProjectCalls(keys, keyStatsRows, logRows);

  return { overview, keys, keyStatsRows, logRows, summary };
}

async function run(): Promise<void> {
  printSection('Config');
  console.log(`worker:   ${WORKER_URL}`);
  console.log(`project:  ${PROJECT_TOKEN}`);
  console.log(`probe:    ${PROXY_SLUG && PROXY_PATH ? `/p/${PROXY_SLUG}${PROXY_PATH}` : 'disabled'}`);

  const health = await fetchJson('/health', JWT);
  printSection('Health');
  console.log(`status:   ${health.status}`);
  console.log(`service:  ${String((health.data || {}).service || 'unknown')}`);

  const projectsRes = await fetchJson('/api/v1/init/projects', JWT);
  const projects = asArray<JsonRecord>((projectsRes.data || {}).projects);
  const project = projects.find((row) => String(row.vp_proj_id || '') === PROJECT_TOKEN);

  printSection('Project Ownership');
  console.log(`projects visible to this user: ${projects.length}`);
  if (!project) {
    console.log('result: project token is NOT owned by this dashboard account');
    console.log('meaning: traffic for this vp-proj will never show in this user dashboard');
    process.exit(1);
  }

  const projectRowId = String(project.id || '');
  console.log(`result: project belongs to this dashboard account`);
  console.log(`row id:  ${projectRowId}`);
  console.log(`name:    ${String(project.name || '(unnamed)')}`);

  const before = await readSnapshot(projectRowId);

  printSection('Current Dashboard Slice');
  console.log(`account total calls:    ${formatNum(before.overview.totalCalls)}`);
  console.log(`account total keys:     ${formatNum(before.overview.totalKeys)}`);
  console.log(`project keys:           ${before.keys.length}`);
  console.log(`project calls (by-key): ${formatNum(before.summary.projectCalls)}`);
  console.log(`project keyed stats:    ${before.summary.matchingKeyStats}`);
  console.log(`project logs found:     ${before.summary.matchingLogs}`);

  if (!PROXY_SLUG || !PROXY_PATH) {
    printSection('Interpretation');
    if (before.keys.length === 0) {
      console.log('This project has no keys, so no proxy traffic can be attributed to it.');
    } else if (before.summary.matchingLogs === 0 && before.summary.projectCalls === 0) {
      console.log('This account owns the project, but the dashboard sees no traffic for its keys.');
      console.log('That usually means the app is calling a different proxy path or a different vp-proj token.');
    } else {
      console.log('This account owns the project and the dashboard can already see matching traffic.');
    }
    return;
  }

  const probePath = `/p/${PROXY_SLUG}${PROXY_PATH.startsWith('/') ? PROXY_PATH : `/${PROXY_PATH}`}`;
  printSection('Proxy Probe');
  console.log(`calling: ${probePath}`);
  const proxyRes = await fetchProxy(probePath, PROJECT_TOKEN);
  console.log(`status:  ${proxyRes.status}`);
  if (proxyRes.headers['x-request-id'] || proxyRes.headers['request-id']) {
    console.log(`request: ${proxyRes.headers['x-request-id'] || proxyRes.headers['request-id']}`);
  }
  if (proxyRes.bodyPreview) {
    console.log(`body:    ${proxyRes.bodyPreview.replace(/\s+/g, ' ').trim()}`);
  }

  let after = before;
  let changed = false;
  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt += 1) {
    await sleep(POLL_DELAY_MS);
    after = await readSnapshot(projectRowId);
    changed =
      after.summary.projectCalls > before.summary.projectCalls ||
      after.summary.matchingLogs > before.summary.matchingLogs ||
      Number(after.overview.totalCalls || 0) > Number(before.overview.totalCalls || 0);
    console.log(
      `poll ${attempt}: account=${formatNum(after.overview.totalCalls)} project=${formatNum(after.summary.projectCalls)} logs=${after.summary.matchingLogs}`,
    );
    if (changed) break;
  }

  printSection('Result');
  if (changed) {
    console.log('Dashboard stats updated after the proxied request.');
    console.log('This means the project token, worker path, and dashboard ownership all line up.');
    return;
  }

  console.log('No dashboard-visible stats changed after the proxied request.');
  console.log('Most likely causes:');
  console.log('1. the live app is not using this vp-proj token');
  console.log('2. the live app is not hitting the init worker proxy path');
  console.log('3. traffic is landing under a different VaultProof account/project');
  process.exit(1);
}

run().catch((error) => {
  console.error('\nDiagnostic failed:');
  console.error(error);
  process.exit(1);
});
