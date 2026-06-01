import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { handleEnterpriseControlPlaneRequest } from '../packages/enterprise-control-plane/dist/enterprise-control-plane/src/index.js';

const ENTERPRISE_HOSTNAME = 'enterprise.vaultproof.dev';
const EVIDENCE_DIR = process.env.EVIDENCE_DIR || '/tmp/vaultproof-tenant-isolation-evidence';
const GENERATED_AT = new Date().toISOString();

const TOKENS = {
  alpha: 'jwt_tenant_alpha',
  beta: 'jwt_tenant_beta',
};

const USERS_BY_TOKEN = new Map([
  [TOKENS.alpha, { id: 'user_alpha_owner', email: 'owner@alpha.example' }],
  [TOKENS.beta, { id: 'user_beta_owner', email: 'owner@beta.example' }],
]);

const ORGANIZATIONS = [{
  id: 'org_alpha',
  name: 'Alpha Industries',
  slug: 'alpha-industries',
  kind: 'team',
  owner_user_id: 'user_alpha_owner',
  created_at: '2026-05-01T12:00:00.000Z',
  updated_at: '2026-05-01T12:00:00.000Z',
  archived_at: null,
}, {
  id: 'org_beta',
  name: 'Beta Labs',
  slug: 'beta-labs',
  kind: 'team',
  owner_user_id: 'user_beta_owner',
  created_at: '2026-05-02T12:00:00.000Z',
  updated_at: '2026-05-02T12:00:00.000Z',
  archived_at: null,
}];

const ORGANIZATION_MEMBERS = [{
  id: 'member_alpha_owner',
  organization_id: 'org_alpha',
  user_id: 'user_alpha_owner',
  role: 'owner',
  created_at: '2026-05-01T12:05:00.000Z',
}, {
  id: 'member_beta_owner',
  organization_id: 'org_beta',
  user_id: 'user_beta_owner',
  role: 'owner',
  created_at: '2026-05-02T12:05:00.000Z',
}];

const PROJECTS = [{
  id: 'proj_alpha',
  organization_id: 'org_alpha',
  vp_proj_id: 'vp-proj-alpha',
  name: 'Alpha Payments API',
  allowed_origins: null,
  strict_origin: false,
  caller_lock_policy: {
    allowed_providers: ['openai', 'resend'],
    allowed_methods: ['POST'],
    allowed_upstream_path_prefixes: ['/v1'],
  },
  revoked_at: null,
  created_at: '2026-05-01T12:10:00.000Z',
}, {
  id: 'proj_beta',
  organization_id: 'org_beta',
  vp_proj_id: 'vp-proj-beta',
  name: 'Beta Claims API',
  allowed_origins: null,
  strict_origin: false,
  caller_lock_policy: {
    allowed_providers: ['openai'],
    allowed_methods: ['POST'],
    allowed_upstream_path_prefixes: ['/v1'],
  },
  revoked_at: null,
  created_at: '2026-05-02T12:10:00.000Z',
}];

let projectKeys = [{
  id: 'key_alpha_openai',
  project_id: 'proj_alpha',
  provider: 'openai',
  slug: 'openai',
  upstream_base_url: 'https://api.openai.com',
  share1_encrypted: 'demo-dashboard-placeholder-share-1:proj_alpha:openai',
  share2_encrypted: 'demo-dashboard-placeholder-share-2:proj_alpha:openai',
  revoked_at: null,
}, {
  id: 'key_beta_openai',
  project_id: 'proj_beta',
  provider: 'openai',
  slug: 'openai',
  upstream_base_url: 'https://api.openai.com',
  share1_encrypted: 'demo-dashboard-placeholder-share-1:proj_beta:openai',
  share2_encrypted: 'demo-dashboard-placeholder-share-2:proj_beta:openai',
  revoked_at: null,
}];

let auditEvents = [{
  id: 'audit_alpha_bootstrap',
  organization_id: 'org_alpha',
  project_id: 'proj_alpha',
  actor_user_id: 'user_alpha_owner',
  actor_email: 'owner@alpha.example',
  event_type: 'tenant_alpha_control_event',
  target_type: 'project',
  target_id: 'proj_alpha',
  description: 'Alpha tenant control event',
  metadata: { tenant_marker: 'alpha-only' },
  created_at: '2026-05-03T12:00:00.000Z',
}, {
  id: 'audit_beta_bootstrap',
  organization_id: 'org_beta',
  project_id: 'proj_beta',
  actor_user_id: 'user_beta_owner',
  actor_email: 'owner@beta.example',
  event_type: 'tenant_beta_control_event',
  target_type: 'project',
  target_id: 'proj_beta',
  description: 'Beta tenant control event',
  metadata: { tenant_marker: 'beta-only' },
  created_at: '2026-05-03T12:01:00.000Z',
}];

const ACCESS_LOGS = [{
  id: 'access_alpha_1',
  project_id: 'proj_alpha',
  project_key_id: 'key_alpha_openai',
  provider: 'openai',
  slug: 'openai',
  method: 'POST',
  upstream_path: '/v1/responses',
  status_code: 200,
  latency_ms: 44,
  error: null,
  metadata: { provider_request_id: 'alpha-provider-request' },
  timestamp: '2026-05-03T12:02:00.000Z',
}, {
  id: 'access_beta_1',
  project_id: 'proj_beta',
  project_key_id: 'key_beta_openai',
  provider: 'openai',
  slug: 'openai',
  method: 'POST',
  upstream_path: '/v1/responses',
  status_code: 403,
  latency_ms: 19,
  error: 'policy_denied',
  metadata: { provider_request_id: 'beta-provider-request' },
  timestamp: '2026-05-03T12:03:00.000Z',
}];

const ORGANIZATION_INVITATIONS = [{
  id: 'invite_alpha_pending',
  organization_id: 'org_alpha',
  email: 'reviewer@alpha.example',
  role: 'auditor',
  status: 'pending',
  created_at: '2026-05-03T12:10:00.000Z',
  invited_by: 'user_alpha_owner',
}, {
  id: 'invite_beta_pending',
  organization_id: 'org_beta',
  email: 'reviewer@beta.example',
  role: 'auditor',
  status: 'pending',
  created_at: '2026-05-03T12:11:00.000Z',
  invited_by: 'user_beta_owner',
}];

const KMS_CONNECTIONS = [{
  id: 'kms_alpha',
  organization_id: 'org_alpha',
  provider: 'aws-kms',
  display_name: 'Alpha AWS KMS',
  status: 'verified',
  aws_account_id: '111122223333',
  aws_region: 'us-east-1',
  aws_kms_key_arn: 'arn:aws:kms:us-east-1:111122223333:key/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  aws_role_arn: 'arn:aws:iam::111122223333:role/VaultProofCustomerKmsRole',
  external_id: 'vaultproof-alpha-external-id',
  last_test_status: 'passed',
  last_tested_at: '2026-05-03T12:20:00.000Z',
  last_test_error: null,
  created_at: '2026-05-03T12:15:00.000Z',
  updated_at: '2026-05-03T12:20:00.000Z',
}, {
  id: 'kms_beta',
  organization_id: 'org_beta',
  provider: 'aws-kms',
  display_name: 'Beta AWS KMS',
  status: 'ready_to_test',
  aws_account_id: '444455556666',
  aws_region: 'us-west-2',
  aws_kms_key_arn: 'arn:aws:kms:us-west-2:444455556666:key/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  aws_role_arn: 'arn:aws:iam::444455556666:role/VaultProofCustomerKmsRole',
  external_id: 'vaultproof-beta-external-id',
  last_test_status: 'not_tested',
  last_tested_at: null,
  last_test_error: null,
  created_at: '2026-05-03T12:16:00.000Z',
  updated_at: '2026-05-03T12:16:00.000Z',
}];

const env = {
  supabaseUrl: 'https://tenant-isolation.supabase.test',
  supabaseServiceRoleKey: 'service-role-for-local-evidence',
  executorSigningKeyId: 'tenant-isolation-key',
  executorSigningSecret: 'tenant-isolation-signing-secret-32-bytes',
  awsKmsRuntimePrincipalArn: 'arn:aws:iam::999988887777:role/VaultProofRuntimeRole',
};

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

function organizationById(id) {
  return ORGANIZATIONS.find((organization) => organization.id === id) || null;
}

function projectById(id) {
  return PROJECTS.find((project) => project.id === id) || null;
}

function userById(id) {
  return [...USERS_BY_TOKEN.values()].find((user) => user.id === id) || null;
}

function eqParam(decodedUrl, field) {
  const match = decodedUrl.match(new RegExp(`[?&]${field}=eq\\.([^&]+)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function inParam(decodedUrl, field) {
  const match = decodedUrl.match(new RegExp(`[?&]${field}=in\\.\\(([^)]*)\\)`));
  if (!match?.[1]) return null;
  return match[1].split(',').map((value) => decodeURIComponent(value.trim())).filter(Boolean);
}

function requestedSelect(decodedUrl) {
  const match = decodedUrl.match(/[?&]select=([^&]+)/);
  return match?.[1] || '';
}

function activeProjectRowsForOrganization(organizationId) {
  return PROJECTS
    .filter((project) => project.organization_id === organizationId && !project.revoked_at)
    .map((project) => ({ ...project }));
}

function membershipsForUser(userId) {
  return ORGANIZATION_MEMBERS.filter((member) => member.user_id === userId);
}

function projectIdsFromUrl(decodedUrl) {
  const explicitProjectId = eqParam(decodedUrl, 'project_id');
  if (explicitProjectId) return [explicitProjectId];
  return inParam(decodedUrl, 'project_id') || [];
}

function filterProjectKeys(decodedUrl) {
  const projectIds = projectIdsFromUrl(decodedUrl);
  const slug = eqParam(decodedUrl, 'slug');
  const provider = eqParam(decodedUrl, 'provider');
  return projectKeys.filter((key) => {
    if (key.revoked_at) return false;
    if (projectIds.length && !projectIds.includes(key.project_id)) return false;
    if (slug && key.slug !== slug) return false;
    if (provider && key.provider !== provider) return false;
    return true;
  });
}

function materialModeForKey(key) {
  const share1 = String(key.share1_encrypted || '');
  const share2 = String(key.share2_encrypted || '');
  if (!share1 || !share2) return 'missing';
  if (share1.startsWith('demo-dashboard-placeholder') && share2.startsWith('demo-dashboard-placeholder')) {
    return 'demo-placeholder';
  }
  if (!share1.startsWith('demo-dashboard-placeholder') && !share2.startsWith('demo-dashboard-placeholder')) {
    return 'sealed-live';
  }
  return 'mixed';
}

function installFetchStub() {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const decodedUrl = decodeURIComponent(url);
    const method = (init?.method || 'GET').toUpperCase();

    if (url.includes('/auth/v1/user') && method === 'GET') {
      const authHeader = new Headers(init?.headers).get('authorization') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      const user = USERS_BY_TOKEN.get(token);
      if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);
      return jsonResponse(user);
    }

    if (url.includes('/auth/v1/admin/users/') && method === 'GET') {
      const userId = decodedUrl.split('/auth/v1/admin/users/')[1]?.split(/[?#]/)[0] || '';
      const user = userById(userId);
      return jsonResponse({ user: user || null }, user ? 200 : 404);
    }

    if (url.includes('/rest/v1/rpc/enterprise_projects_bootstrap') && method === 'POST') {
      return jsonResponse({ code: 'PGRST202', message: 'RPC intentionally unavailable in tenant-isolation evidence stub' }, 404);
    }

    if (url.includes('/rest/v1/rpc/enterprise_project_access_overview') && method === 'POST') {
      const body = JSON.parse(init?.body || '{}');
      const projectIds = Array.isArray(body.project_ids) ? body.project_ids : [];
      const rows = ACCESS_LOGS.filter((row) => projectIds.includes(row.project_id));
      return jsonResponse({
        total_calls: rows.length,
        error_calls: rows.filter((row) => (row.status_code || 0) >= 500).length,
        denied_calls: rows.filter((row) => [401, 403, 429].includes(row.status_code)).length,
        project_health: projectIds.map((projectId) => {
          const projectRows = rows.filter((row) => row.project_id === projectId);
          return {
            project_id: projectId,
            calls: projectRows.length,
            errors: projectRows.filter((row) => (row.status_code || 0) >= 500).length,
            denied: projectRows.filter((row) => [401, 403, 429].includes(row.status_code)).length,
            last_activity: projectRows.at(-1)?.timestamp || null,
          };
        }),
        recent_activity: rows,
      });
    }

    if (url.includes('/rest/v1/organization_members')) {
      const userId = eqParam(decodedUrl, 'user_id');
      const organizationId = eqParam(decodedUrl, 'organization_id');
      const select = requestedSelect(decodedUrl);

      if (select.includes('organizations')) {
        return jsonResponse(membershipsForUser(userId).map((member) => {
          const organization = organizationById(member.organization_id);
          if (select.includes('projects')) {
            return {
              role: member.role,
              organizations: {
                id: organization.id,
                projects: activeProjectRowsForOrganization(organization.id),
              },
            };
          }
          return {
            role: member.role,
            created_at: member.created_at,
            organizations: organization,
          };
        }).filter((row) => row.organizations));
      }

      let rows = ORGANIZATION_MEMBERS;
      if (userId) rows = rows.filter((member) => member.user_id === userId);
      if (organizationId) rows = rows.filter((member) => member.organization_id === organizationId);
      return jsonResponse(rows.map((member) => ({ ...member })));
    }

    if (url.includes('/rest/v1/project_members')) {
      const projectIds = projectIdsFromUrl(decodedUrl);
      const userId = eqParam(decodedUrl, 'user_id');
      if (requestedSelect(decodedUrl).includes('projects')) return jsonResponse([]);
      const rows = projectIds.length
        ? ORGANIZATION_MEMBERS
            .filter((member) => activeProjectRowsForOrganization(member.organization_id).some((project) => projectIds.includes(project.id)))
            .map((member) => {
              const project = activeProjectRowsForOrganization(member.organization_id)[0];
              return {
                project_id: project.id,
                user_id: member.user_id,
                role: member.role === 'owner' ? 'admin' : 'viewer',
                created_at: member.created_at,
              };
            })
        : [];
      return jsonResponse(userId ? rows.filter((row) => row.user_id === userId) : rows);
    }

    if (url.includes('/rest/v1/organizations') && method === 'GET') {
      const organizationId = eqParam(decodedUrl, 'id');
      if (organizationId) return jsonResponse(organizationById(organizationId));
      return jsonResponse(ORGANIZATIONS.map((organization) => ({ ...organization })));
    }

    if (url.includes('/rest/v1/projects') && method === 'GET') {
      const organizationId = eqParam(decodedUrl, 'organization_id');
      const projectId = eqParam(decodedUrl, 'id');
      let rows = PROJECTS.filter((project) => !project.revoked_at);
      if (organizationId) rows = rows.filter((project) => project.organization_id === organizationId);
      if (projectId) rows = rows.filter((project) => project.id === projectId);
      if (projectId && decodedUrl.includes('maybeSingle')) return jsonResponse(rows[0] || null);
      return jsonResponse(rows.map((project) => ({ ...project })));
    }

    if (url.includes('/rest/v1/project_keys')) {
      if (method === 'GET') {
        const rows = filterProjectKeys(decodedUrl);
        const select = requestedSelect(decodedUrl);
        const mappedRows = rows.map((key) => {
          const base = { ...key };
          if (select.includes('projects!inner')) base.projects = projectById(key.project_id);
          return base;
        });
        const wantsSingle = new Headers(init?.headers).get('accept')?.includes('application/vnd.pgrst.object+json');
        return jsonResponse(wantsSingle ? mappedRows[0] || null : mappedRows);
      }

      if (method === 'POST') {
        const body = JSON.parse(init?.body || '{}');
        const existingIndex = projectKeys.findIndex((key) => key.project_id === body.project_id && key.provider === body.provider);
        const row = {
          id: existingIndex >= 0 ? projectKeys[existingIndex].id : `key_created_${projectKeys.length + 1}`,
          project_id: body.project_id,
          provider: body.provider,
          slug: body.slug || body.provider,
          upstream_base_url: body.upstream_base_url || 'https://example.com',
          share1_encrypted: body.share1_encrypted,
          share2_encrypted: body.share2_encrypted,
          revoked_at: body.revoked_at || null,
        };
        if (existingIndex >= 0) projectKeys[existingIndex] = row;
        else projectKeys.unshift(row);
        return jsonResponse(row, 201);
      }
    }

    if (url.includes('/rest/v1/organization_kms_connections') && method === 'GET') {
      const organizationId = eqParam(decodedUrl, 'organization_id');
      return jsonResponse(KMS_CONNECTIONS.filter((row) => !organizationId || row.organization_id === organizationId));
    }

    if (url.includes('/rest/v1/organization_audit_events')) {
      if (method === 'GET') {
        const organizationId = eqParam(decodedUrl, 'organization_id');
        const projectId = eqParam(decodedUrl, 'project_id');
        let rows = auditEvents;
        if (organizationId) rows = rows.filter((row) => row.organization_id === organizationId);
        if (projectId) rows = rows.filter((row) => row.project_id === projectId);
        return jsonResponse(rows.map((row) => ({ ...row })).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
      }
      if (method === 'POST') {
        const body = JSON.parse(init?.body || '{}');
        const rows = (Array.isArray(body) ? body : [body]).map((row, index) => ({
          id: row.id || `audit_created_${auditEvents.length + index + 1}`,
          created_at: row.created_at || new Date().toISOString(),
          ...row,
        }));
        auditEvents.unshift(...rows);
        return jsonResponse([]);
      }
    }

    if (url.includes('/rest/v1/project_access_logs') && method === 'GET') {
      const projectIds = projectIdsFromUrl(decodedUrl);
      return jsonResponse(ACCESS_LOGS.filter((row) => !projectIds.length || projectIds.includes(row.project_id)));
    }

    if (url.includes('/rest/v1/project_access_log_daily_rollups') && method === 'GET') {
      return jsonResponse([]);
    }

    if (url.includes('/rest/v1/organization_invitations') && method === 'GET') {
      const organizationId = eqParam(decodedUrl, 'organization_id');
      const email = eqParam(decodedUrl, 'email');
      let rows = ORGANIZATION_INVITATIONS;
      if (organizationId) rows = rows.filter((row) => row.organization_id === organizationId);
      if (email) rows = rows.filter((row) => row.email === email);
      return jsonResponse(rows.map((row) => {
        const organization = organizationById(row.organization_id);
        return requestedSelect(decodedUrl).includes('organizations')
          ? { ...row, organizations: organization }
          : { ...row };
      }));
    }

    throw new Error(`Unhandled tenant-isolation stub fetch: ${method} ${decodedUrl}`);
  };
}

function buildRequest(pathname, token, organizationId, init = {}) {
  const headers = new Headers(init.headers || {});
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (organizationId) headers.set('x-vaultproof-organization', organizationId);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return new Request(`https://${ENTERPRISE_HOSTNAME}${pathname}`, {
    ...init,
    headers,
  });
}

async function requestJson(pathname, token, organizationId, init = {}) {
  const response = await handleEnterpriseControlPlaneRequest(buildRequest(pathname, token, organizationId, init), env);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  return { status: response.status, payload, headers: Object.fromEntries(response.headers.entries()) };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoTenantMarkers(value, blockedMarkers) {
  const serialized = JSON.stringify(value);
  for (const marker of blockedMarkers) {
    assert(!serialized.includes(marker), `Response leaked blocked tenant marker: ${marker}`);
  }
}

const cases = [];

async function runCase(name, control, fn) {
  const startedAt = new Date().toISOString();
  try {
    const detail = await fn();
    cases.push({
      name,
      control,
      status: 'passed',
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      detail,
    });
  } catch (error) {
    cases.push({
      name,
      control,
      status: 'failed',
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function summarizeProjects(payload) {
  return {
    active_organization_id: payload.active_organization_id,
    organizations: (payload.organizations || []).map((organization) => organization.id),
    projects: (payload.projects || []).map((project) => project.id),
    provider_slots: (payload.projects || []).flatMap((project) => {
      return (project.provider_slots || []).map((slot) => `${project.id}:${slot.slug}`);
    }),
  };
}

installFetchStub();

await runCase('Unauthenticated enterprise API requests are denied', 'CC6.1/CC6.6', async () => {
  const result = await requestJson('/api/v1/enterprise/projects/bootstrap', null, null);
  assert(result.status === 401, `Expected 401, got ${result.status}`);
  return { status: result.status };
});

await runCase('Tenant Alpha bootstrap cannot see Tenant Beta objects', 'CC6.2/CC6.3', async () => {
  const result = await requestJson('/api/v1/enterprise/projects/bootstrap', TOKENS.alpha, 'org_alpha');
  assert(result.status === 200, `Expected 200, got ${result.status}`);
  assert(result.payload.active_organization_id === 'org_alpha', 'Expected Alpha active organization');
  assert(result.payload.projects?.length === 1 && result.payload.projects[0].id === 'proj_alpha', 'Expected only Alpha project');
  assertNoTenantMarkers(result.payload, ['org_beta', 'proj_beta', 'Beta Labs', 'beta-provider-request']);
  return summarizeProjects(result.payload);
});

await runCase('Tenant Beta bootstrap cannot see Tenant Alpha objects', 'CC6.2/CC6.3', async () => {
  const result = await requestJson('/api/v1/enterprise/projects/bootstrap', TOKENS.beta, 'org_beta');
  assert(result.status === 200, `Expected 200, got ${result.status}`);
  assert(result.payload.active_organization_id === 'org_beta', 'Expected Beta active organization');
  assert(result.payload.projects?.length === 1 && result.payload.projects[0].id === 'proj_beta', 'Expected only Beta project');
  assertNoTenantMarkers(result.payload, ['org_alpha', 'proj_alpha', 'Alpha Industries', 'alpha-provider-request']);
  return summarizeProjects(result.payload);
});

await runCase('Client-supplied organization header cannot switch Tenant Alpha into Tenant Beta', 'CC6.2/CC6.3', async () => {
  const result = await requestJson('/api/v1/enterprise/orgs/current/kms-connections', TOKENS.alpha, 'org_beta');
  assert(result.status === 404, `Expected 404 for unauthorized organization header, got ${result.status}`);
  assertNoTenantMarkers(result.payload, ['444455556666', 'vaultproof-beta-external-id', 'Beta AWS KMS']);
  return { status: result.status, error: result.payload.error };
});

await runCase('KMS status is scoped to the signed-in tenant', 'CC6.2/CC6.6/C1.2', async () => {
  const result = await requestJson('/api/v1/enterprise/orgs/current/kms-connections', TOKENS.alpha, 'org_alpha');
  assert(result.status === 200, `Expected 200, got ${result.status}`);
  const rows = result.payload.kms_connections || [];
  assert(rows.length === 1 && rows[0].organization_id === 'org_alpha', 'Expected only Alpha KMS row');
  assert(rows[0].trust_policy?.Statement?.[0]?.Condition?.StringEquals?.['sts:ExternalId'] === 'vaultproof-alpha-external-id', 'Expected Alpha ExternalId in trust policy');
  assertNoTenantMarkers(result.payload, ['444455556666', 'vaultproof-beta-external-id', 'kms_beta']);
  return {
    kms_connection_ids: rows.map((row) => row.id),
    aws_account_ids: rows.map((row) => row.aws_account_id),
    trust_policy_principal: rows[0].trust_policy.Statement[0].Principal.AWS,
  };
});

await runCase('Audit evidence is scoped to the signed-in tenant', 'CC6.2/CC7.2', async () => {
  const result = await requestJson('/api/v1/enterprise/audit?days=90', TOKENS.alpha, 'org_alpha');
  assert(result.status === 200, `Expected 200, got ${result.status}`);
  assert(result.payload.organization?.id === 'org_alpha', 'Expected Alpha audit organization');
  assert((result.payload.events || []).length >= 1, 'Expected Alpha audit/proxy events');
  assert((result.payload.events || []).every((event) => event.project?.id !== 'proj_beta'), 'Expected no Beta project events');
  assertNoTenantMarkers(result.payload, ['tenant_beta_control_event', 'beta-provider-request', 'owner@beta.example']);
  return {
    organization_id: result.payload.organization.id,
    event_count: result.payload.events.length,
    event_ids: result.payload.events.map((event) => event.id),
  };
});

await runCase('Access review evidence is scoped to the signed-in tenant', 'CC6.2/CC6.3', async () => {
  const result = await requestJson('/api/v1/enterprise/members/access-review', TOKENS.alpha, 'org_alpha');
  assert(result.status === 200, `Expected 200, got ${result.status}`);
  assert(result.payload.organization?.id === 'org_alpha', 'Expected Alpha access-review organization');
  assert(result.payload.summary?.member_count === 1, `Expected one Alpha member, got ${result.payload.summary?.member_count}`);
  assertNoTenantMarkers(result.payload, ['user_beta_owner', 'reviewer@beta.example', 'vp-proj-beta']);
  return {
    organization_id: result.payload.organization.id,
    summary: result.payload.summary,
  };
});

await runCase('Tenant Alpha cannot create provider slots on Tenant Beta project', 'CC6.3/CC6.6', async () => {
  const beforeCount = projectKeys.filter((key) => key.project_id === 'proj_beta').length;
  const result = await requestJson('/api/v1/enterprise/projects/proj_beta/providers', TOKENS.alpha, 'org_alpha', {
    method: 'POST',
    body: JSON.stringify({
      provider: 'resend',
      slug: 'resend',
      upstream_base_url: 'https://api.resend.com',
    }),
  });
  const afterCount = projectKeys.filter((key) => key.project_id === 'proj_beta').length;
  assert(result.status === 404, `Expected 404, got ${result.status}`);
  assert(afterCount === beforeCount, 'Provider slot was created on Beta project');
  assertNoTenantMarkers(result.payload, ['proj_beta', 'Beta Claims API']);
  return { status: result.status, beta_provider_slot_count: afterCount };
});

await runCase('Tenant Alpha cannot execute against Tenant Beta project', 'CC6.3/CC7.2', async () => {
  const result = await requestJson('/api/v1/enterprise/projects/proj_beta/providers/openai/execute', TOKENS.alpha, 'org_alpha', {
    method: 'POST',
    body: JSON.stringify({
      method: 'POST',
      upstream_path: '/v1/responses',
      dry_run: true,
    }),
  });
  assert(result.status === 404, `Expected 404, got ${result.status}`);
  assertNoTenantMarkers(result.payload, ['proj_beta', 'Beta Claims API', 'key_beta_openai']);
  return { status: result.status, error: result.payload.error };
});

await runCase('Tenant Alpha can create an allowed provider slot only inside Tenant Alpha', 'CC6.3/CC7.2', async () => {
  const result = await requestJson('/api/v1/enterprise/projects/proj_alpha/providers', TOKENS.alpha, 'org_alpha', {
    method: 'POST',
    body: JSON.stringify({
      provider: 'resend',
      slug: 'resend',
      upstream_base_url: 'https://api.resend.com',
    }),
  });
  assert(result.status === 201, `Expected 201, got ${result.status}`);
  assert(result.payload.provider_slot?.project_id === 'proj_alpha', 'Expected provider slot on Alpha project');
  const createdAudit = auditEvents.find((event) => event.event_type === 'enterprise_provider_slot_created' && event.target_id === result.payload.provider_slot.key_id);
  assert(createdAudit?.organization_id === 'org_alpha', 'Expected provider slot audit event to stay in Alpha org');
  assertNoTenantMarkers(result.payload, ['proj_beta', 'org_beta', 'Beta Labs']);
  return {
    provider_slot: result.payload.provider_slot,
    audit_event: {
      id: createdAudit.id,
      organization_id: createdAudit.organization_id,
      project_id: createdAudit.project_id,
      event_type: createdAudit.event_type,
    },
  };
});

const failedCases = cases.filter((item) => item.status !== 'passed');
const evidence = {
  schemaVersion: 'vaultproof.enterprise.tenantIsolationEvidence.v1',
  generatedAt: GENERATED_AT,
  status: failedCases.length ? 'failed' : 'passed',
  summary: {
    passed: cases.length - failedCases.length,
    failed: failedCases.length,
    total: cases.length,
  },
  scope: {
    host: ENTERPRISE_HOSTNAME,
    tenant_boundary: [
      'organization_id',
      'organization_members',
      'project.organization_id',
      'project_keys.project_id',
      'organization_kms_connections.organization_id',
      'organization_audit_events.organization_id',
      'project_access_logs.project_id',
    ],
    tested_surfaces: [
      'enterprise API authentication',
      'project bootstrap',
      'customer KMS status',
      'audit evidence',
      'access review evidence',
      'provider-slot writes',
      'secure-execution request authorization',
    ],
  },
  controls: [{
    id: 'SOC2 CC6.1',
    description: 'Logical access is limited to authenticated users.',
  }, {
    id: 'SOC2 CC6.2',
    description: 'Tenant data access is restricted to authorized organization membership.',
  }, {
    id: 'SOC2 CC6.3',
    description: 'Role and tenant membership checks gate privileged actions.',
  }, {
    id: 'SOC2 CC6.6',
    description: 'Unauthorized logical access attempts fail closed.',
  }, {
    id: 'SOC2 CC7.2',
    description: 'Security-relevant tenant operations are auditable.',
  }],
  fixture: {
    tenants: ORGANIZATIONS.map((organization) => ({
      organization_id: organization.id,
      organization_name: organization.name,
      owner_user_id: organization.owner_user_id,
      project_ids: PROJECTS.filter((project) => project.organization_id === organization.id).map((project) => project.id),
      kms_connection_ids: KMS_CONNECTIONS.filter((connection) => connection.organization_id === organization.id).map((connection) => connection.id),
    })),
  },
  cases,
};

mkdirSync(EVIDENCE_DIR, { recursive: true });
const evidencePath = join(EVIDENCE_DIR, `vaultproof-tenant-isolation-evidence-${GENERATED_AT.replace(/[:.]/g, '-')}.json`);
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

if (failedCases.length) {
  console.error(`Tenant isolation evidence failed: ${failedCases.length}/${cases.length} cases failed`);
  console.error(`Evidence written to ${evidencePath}`);
  process.exit(1);
}

console.log(`Tenant isolation evidence passed: ${cases.length}/${cases.length} cases`);
console.log(`Evidence written to ${evidencePath}`);
