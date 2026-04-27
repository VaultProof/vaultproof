import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const requiredEnv = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const missing = requiredEnv.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing required env: ${missing.join(', ')}`);
  console.error('Example: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... DEMO_EMAIL=enterprise-demo@example.com node scripts/create-enterprise-demo-account.mjs');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const demoEmail = (process.env.DEMO_EMAIL || `enterprise-demo+${Date.now()}@vaultproof.dev`).trim().toLowerCase();
const demoPassword = process.env.DEMO_PASSWORD || `VaultProof-demo-${randomBytes(9).toString('base64url')}!`;
const demoOrgName = process.env.DEMO_ORG_NAME || 'VaultProof Enterprise Demo';
const demoOrgSlug = normalizeSlug(process.env.DEMO_ORG_SLUG || demoOrgName);
const demoProjectName = process.env.DEMO_PROJECT_NAME || 'Confidential Runtime Pilot';
const demoProjectRef = process.env.DEMO_PROJECT_REF || `vp-demo-${randomBytes(5).toString('hex')}`;
const seedSampleData = process.env.DEMO_SEED_SAMPLE_DATA !== 'false';

function normalizeSlug(value) {
  return String(value || 'vaultproof-enterprise-demo')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63) || 'vaultproof-enterprise-demo';
}

async function findUserByEmail(email) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLowerCase() === email);
    if (found) return found;
    if (data.users.length < 1000) return null;
  }
  return null;
}

async function ensureUser() {
  const existing = await findUserByEmail(demoEmail);
  if (existing) {
    const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
      password: demoPassword,
      email_confirm: true,
      user_metadata: {
        ...(existing.user_metadata || {}),
        full_name: existing.user_metadata?.full_name || 'Enterprise Demo User',
        vaultproof_demo: true,
      },
      app_metadata: {
        ...(existing.app_metadata || {}),
        vaultproof_demo: true,
      },
    });
    if (error) throw error;
    return data.user;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: demoEmail,
    password: demoPassword,
    email_confirm: true,
    user_metadata: {
      full_name: 'Enterprise Demo User',
      vaultproof_demo: true,
    },
    app_metadata: {
      vaultproof_demo: true,
    },
  });
  if (error) throw error;
  return data.user;
}

async function ensureOrganization(userId) {
  const { data: existing } = await supabase
    .from('organizations')
    .select('id, name, slug, kind, owner_user_id')
    .eq('slug', demoOrgSlug)
    .eq('kind', 'team')
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from('organizations')
      .update({
        name: demoOrgName,
        owner_user_id: userId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select('id, name, slug, kind, owner_user_id')
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('organizations')
    .insert({
      name: demoOrgName,
      slug: demoOrgSlug,
      kind: 'team',
      owner_user_id: userId,
    })
    .select('id, name, slug, kind, owner_user_id')
    .single();
  if (error) throw error;
  return data;
}

async function ensureOrganizationMembership(organizationId, userId) {
  const { error } = await supabase
    .from('organization_members')
    .upsert({
      organization_id: organizationId,
      user_id: userId,
      role: 'owner',
      invited_by: userId,
    }, {
      onConflict: 'organization_id,user_id',
    });
  if (error) throw error;
}

async function ensureProject(organizationId, userId) {
  const { data: existing } = await supabase
    .from('projects')
    .select('id, vp_proj_id')
    .eq('organization_id', organizationId)
    .eq('name', demoProjectName)
    .is('revoked_at', null)
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from('projects')
      .update({
        user_id: userId,
        allowed_origins: 'https://enterprise.vaultproof.dev',
        strict_origin: true,
        caller_lock_policy: {
          allowed_providers: ['openai'],
          allowed_methods: ['POST'],
          allowed_upstream_hosts: ['api.openai.com'],
          allowed_upstream_path_prefixes: ['/v1/responses'],
          rate_limit_per_minute: 120,
          allowed_customer_gateways: ['vaultproof-managed'],
        },
      })
      .eq('id', existing.id)
      .select('id, vp_proj_id, name')
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('projects')
    .insert({
      user_id: userId,
      organization_id: organizationId,
      vp_proj_id: demoProjectRef,
      name: demoProjectName,
      allowed_origins: 'https://enterprise.vaultproof.dev',
      strict_origin: true,
      caller_lock_policy: {
        allowed_providers: ['openai'],
        allowed_methods: ['POST'],
        allowed_upstream_hosts: ['api.openai.com'],
        allowed_upstream_path_prefixes: ['/v1/responses'],
        rate_limit_per_minute: 120,
        allowed_customer_gateways: ['vaultproof-managed'],
      },
    })
    .select('id, vp_proj_id, name')
    .single();
  if (error) throw error;
  return data;
}

async function ensureProjectMembership(projectId, userId) {
  const { error } = await supabase
    .from('project_members')
    .upsert({
      project_id: projectId,
      user_id: userId,
      role: 'owner',
      invited_by: userId,
    }, {
      onConflict: 'project_id,user_id',
    });
  if (error) throw error;
}

async function seedDashboardSampleData(organizationId, userId, projectId) {
  const { data: existingKey } = await supabase
    .from('project_keys')
    .select('id')
    .eq('project_id', projectId)
    .eq('provider', 'openai')
    .maybeSingle();

  let keyId = existingKey?.id;
  if (!keyId) {
    const { data, error } = await supabase
      .from('project_keys')
      .insert({
        project_id: projectId,
        provider: 'openai',
        slug: 'openai',
        env_var: 'OPENAI_API_KEY',
        upstream_base_url: 'https://api.openai.com',
        auth_header_name: 'authorization',
        auth_header_template: 'Bearer {{secret}}',
        share1_encrypted: 'demo-dashboard-placeholder-share-1',
        share2_encrypted: 'demo-dashboard-placeholder-share-2',
        extra_headers: {},
      })
      .select('id')
      .single();
    if (error) throw error;
    keyId = data.id;
  }

  const now = Date.now();
  const logs = [
    { minutesAgo: 12, status: 200, latency: 188 },
    { minutesAgo: 39, status: 200, latency: 221 },
    { minutesAgo: 84, status: 403, latency: 24 },
  ].map((row) => ({
    project_id: projectId,
    project_key_id: keyId,
    slug: 'openai',
    provider: 'openai',
    method: 'POST',
    upstream_path: '/v1/responses',
    status_code: row.status,
    latency_ms: row.latency,
    error: row.status >= 400 ? 'demo policy denial' : null,
    metadata: {
      demo: true,
      seeded_by: 'create-enterprise-demo-account',
    },
    timestamp: new Date(now - row.minutesAgo * 60 * 1000).toISOString(),
  }));

  const { error: logError } = await supabase
    .from('project_access_logs')
    .insert(logs);
  if (logError) throw logError;

  const { error: auditError } = await supabase
    .from('organization_audit_events')
    .insert({
      organization_id: organizationId,
      project_id: projectId,
      actor_user_id: userId,
      actor_email: demoEmail,
      event_type: 'enterprise_demo_account_seeded',
      target_type: 'organization',
      target_id: organizationId,
      description: `Seeded enterprise demo dashboard account for ${demoEmail}`,
      metadata: {
        demo: true,
        project_ref: demoProjectRef,
      },
    });
  if (auditError) throw auditError;
}

const user = await ensureUser();
const organization = await ensureOrganization(user.id);
await ensureOrganizationMembership(organization.id, user.id);
const project = await ensureProject(organization.id, user.id);
await ensureProjectMembership(project.id, user.id);
if (seedSampleData) {
  await seedDashboardSampleData(organization.id, user.id, project.id);
}

console.log(JSON.stringify({
  email: demoEmail,
  password: demoPassword,
  loginUrl: 'https://enterprise.vaultproof.dev/app/login',
  dashboardUrl: `https://enterprise.vaultproof.dev/app/dashboard?org=${organization.id}`,
  organization: {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
  },
  project: {
    id: project.id,
    vp_proj_id: project.vp_proj_id,
    name: project.name,
  },
  seededSampleData: seedSampleData,
}, null, 2));
