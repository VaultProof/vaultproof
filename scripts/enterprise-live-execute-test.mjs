#!/usr/bin/env node

import { serializeShare, splitString } from '@vaultproof/shamir';

const API_BASE = process.env.ENTERPRISE_API_BASE || 'https://enterprise.vaultproof.dev/api/v1/enterprise';
const INIT_API_BASE = process.env.INIT_API_BASE || 'https://init.vaultproof.dev/api/v1/init';
const DRY_RUN = process.env.EXECUTE_DRY_RUN !== 'false' && process.env.DRY_RUN !== 'false';
const ALLOW_INIT_SEED = process.env.ALLOW_INIT_SEED === 'true';

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

function extractAccessToken(raw) {
  if (!raw) return null;
  if (raw.startsWith('eyJ')) return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed.access_token || null;
  } catch {
    return null;
  }
}

async function api(path, token, init = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
      authorization: `Bearer ${token}`,
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: response.ok, status: response.status, body };
}

async function initApi(path, token, init = {}) {
  const response = await fetch(`${INIT_API_BASE}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
      authorization: `Bearer ${token}`,
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: response.ok, status: response.status, body };
}

function pickOpenAiSlot(projects) {
  for (const project of projects) {
    const slot = (project.provider_slots || []).find((item) => item.slug === 'openai' || item.provider === 'openai');
    if (slot) return { project, slot };
  }
  return null;
}

async function seedDemoProject(token) {
  const createProjectResponse = await initApi('/projects', token, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Azure Enterprise Execute Demo',
      strict_origin: false,
    }),
  });
  console.log(JSON.stringify({
    step: 'seed-project',
    status: createProjectResponse.status,
    ok: createProjectResponse.ok,
    body: createProjectResponse.body,
  }, null, 2));

  if (!createProjectResponse.ok || !createProjectResponse.body?.id) {
    return false;
  }

  const shares = splitString('sk-vaultproof-enterprise-demo-invalid-key', 2, 2);
  const uploadKeyResponse = await initApi(`/projects/${createProjectResponse.body.id}/keys`, token, {
    method: 'POST',
    body: JSON.stringify({
      provider: 'openai',
      slug: 'openai',
      share1: serializeShare(shares[0]),
      share2: serializeShare(shares[1]),
      env_var: 'OPENAI_API_KEY',
      upstream_base_url: 'https://api.openai.com',
      auth_header_name: 'Authorization',
      auth_header_template: 'Bearer {key}',
      extra_headers: null,
    }),
  });
  console.log(JSON.stringify({
    step: 'seed-openai-slot',
    status: uploadKeyResponse.status,
    ok: uploadKeyResponse.ok,
    body: uploadKeyResponse.body,
  }, null, 2));

  return uploadKeyResponse.ok;
}

const token = extractAccessToken(await readStdin());
if (!token) {
  console.error('No access_token found on stdin.');
  process.exit(1);
}

const projectsResponse = await api('/projects', token);
console.log(JSON.stringify({
  step: 'list-projects',
  status: projectsResponse.status,
  ok: projectsResponse.ok,
  project_count: Array.isArray(projectsResponse.body?.projects) ? projectsResponse.body.projects.length : null,
}, null, 2));

let effectiveProjectsResponse = projectsResponse;
if (!projectsResponse.ok && projectsResponse.body?.error === 'Organization not found') {
  const suffix = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const orgResponse = await api('/orgs', token, {
    method: 'POST',
    body: JSON.stringify({
      name: 'VaultProof Enterprise Demo',
      slug: `vaultproof-enterprise-demo-${suffix}`,
    }),
  });
  console.log(JSON.stringify({
    step: 'bootstrap-org',
    status: orgResponse.status,
    ok: orgResponse.ok,
    body: orgResponse.body,
  }, null, 2));

  if (!orgResponse.ok && orgResponse.body?.error !== 'That organization slug is already taken') {
    process.exit(1);
  }

  effectiveProjectsResponse = await api('/projects', token);
  console.log(JSON.stringify({
    step: 'list-projects-after-org',
    status: effectiveProjectsResponse.status,
    ok: effectiveProjectsResponse.ok,
    project_count: Array.isArray(effectiveProjectsResponse.body?.projects) ? effectiveProjectsResponse.body.projects.length : null,
  }, null, 2));
}

if (!effectiveProjectsResponse.ok) {
  console.log(JSON.stringify(effectiveProjectsResponse.body, null, 2));
  process.exit(1);
}

let projects = effectiveProjectsResponse.body?.projects || [];
let selected = pickOpenAiSlot(projects);
if (!selected && ALLOW_INIT_SEED) {
  const seeded = await seedDemoProject(token);
  if (seeded) {
    effectiveProjectsResponse = await api('/projects', token);
    console.log(JSON.stringify({
      step: 'list-projects-after-seed',
      status: effectiveProjectsResponse.status,
      ok: effectiveProjectsResponse.ok,
      project_count: Array.isArray(effectiveProjectsResponse.body?.projects) ? effectiveProjectsResponse.body.projects.length : null,
    }, null, 2));
    projects = effectiveProjectsResponse.body?.projects || [];
    selected = pickOpenAiSlot(projects);
  }
}
if (!selected) {
  console.log(JSON.stringify({
    step: 'select-provider-slot',
    ok: false,
    error: ALLOW_INIT_SEED
      ? 'No OpenAI provider slot found on accessible enterprise projects.'
      : 'No OpenAI provider slot found on accessible enterprise projects. Set ALLOW_INIT_SEED=true only if you intentionally want to create a demo project through the legacy init API.',
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      vp_proj_id: project.vp_proj_id,
      provider_slots: project.provider_slots || [],
    })),
  }, null, 2));
  process.exit(1);
}

const payload = {
  dry_run: DRY_RUN,
  method: 'POST',
  upstream_path: '/v1/responses',
  headers: {
    'content-type': 'application/json',
    accept: 'application/json',
  },
  body_base64: Buffer.from(JSON.stringify({
    model: 'gpt-4.1-mini',
    input: 'Reply with exactly: vaultproof enterprise azure ok',
    max_output_tokens: 20,
  }), 'utf8').toString('base64'),
};

const executeResponse = await api(
  `/projects/${selected.project.id}/providers/${selected.slot.slug}/execute`,
  token,
  {
    method: 'POST',
    body: JSON.stringify(payload),
  },
);

console.log(JSON.stringify({
  step: DRY_RUN ? 'execute-dry-run' : 'execute',
  status: executeResponse.status,
  ok: executeResponse.ok,
  dry_run: DRY_RUN,
  project_id: selected.project.id,
  project_name: selected.project.name,
  provider_slug: selected.slot.slug,
  response: executeResponse.body,
}, null, 2));
