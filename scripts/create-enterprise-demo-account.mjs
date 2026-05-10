import { createCipheriv, createHmac, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { serializeShare, splitString } from '@vaultproof/shamir';

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
const demoProviderApiKey = process.env.DEMO_PROVIDER_API_KEY || process.env.OPENAI_API_KEY || '';
const vaultUnwrapKey = process.env.VAULT_UNWRAP_KEY_BASE64
  || process.env.VAULT_UNWRAP_KEY_HEX
  || process.env.VAULT_UNWRAP_KEY
  || '';

const VERSION_FAST = 0x02;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SALT_LENGTH = 16;
const VERSION_LENGTH = 1;
const ALGORITHM = 'aes-256-gcm';

function isMissingCallerLockPolicyError(error) {
  return error?.code === 'PGRST204'
    && String(error?.message || '').includes("'caller_lock_policy'")
    && String(error?.message || '').includes("'projects'");
}

function printSchemaFixAndExit(error) {
  console.error('Supabase schema is missing public.projects.caller_lock_policy, or PostgREST has not reloaded its schema cache.');
  console.error('');
  console.error('Run this SQL in the Supabase SQL editor, then rerun this command:');
  console.error('');
  console.error("alter table public.projects add column if not exists caller_lock_policy jsonb not null default '{}'::jsonb;");
  console.error('grant select, insert, update, delete on public.projects to service_role;');
  console.error("notify pgrst, 'reload schema';");
  console.error('');
  console.error(`Original error: ${error?.message || error}`);
  process.exit(1);
}

async function runStep(label, fn) {
  try {
    return await fn();
  } catch (error) {
    if (isMissingCallerLockPolicyError(error)) {
      printSchemaFixAndExit(error);
    }
    console.error(`Failed during ${label}:`);
    throw error;
  }
}

function normalizeSlug(value) {
  return String(value || 'vaultproof-enterprise-demo')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63) || 'vaultproof-enterprise-demo';
}

function getMasterKey(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) throw new Error('VAULT_UNWRAP_KEY_BASE64, VAULT_UNWRAP_KEY_HEX, or VAULT_UNWRAP_KEY is required to seed a decryptable provider slot.');
  if (/^[a-f0-9]{64}$/i.test(trimmed)) return Buffer.from(trimmed, 'hex');
  return Buffer.from(trimmed, 'base64');
}

function hkdfSha256(masterKey, salt, purpose) {
  const prk = createHmac('sha256', salt).update(masterKey).digest();
  const info = Buffer.from(purpose, 'utf8');
  return createHmac('sha256', prk).update(info).update(Buffer.from([0x01])).digest();
}

function encryptShare(serializedShare, vaultKey, purpose) {
  const plaintext = Buffer.from(serializedShare, 'base64');
  const masterKey = getMasterKey(vaultKey);
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const derivedKey = hkdfSha256(masterKey, salt, purpose);
  const cipher = createCipheriv(ALGORITHM, derivedKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION_FAST]), salt, iv, tag, encrypted]).toString('base64');
}

function buildProviderSlotMaterial() {
  if (!demoProviderApiKey || !vaultUnwrapKey) {
    return {
      real: false,
      share1_encrypted: 'demo-dashboard-placeholder-share-1',
      share2_encrypted: 'demo-dashboard-placeholder-share-2',
    };
  }

  const shares = splitString(demoProviderApiKey, 2, 2).map((share) => serializeShare(share));
  return {
    real: true,
    share1_encrypted: encryptShare(shares[0], vaultUnwrapKey, 'vaultproof-enterprise-share1-v1'),
    share2_encrypted: encryptShare(shares[1], vaultUnwrapKey, 'vaultproof-enterprise-share2-v1'),
  };
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

  const providerSlotMaterial = buildProviderSlotMaterial();
  let keyId = existingKey?.id;
  if (keyId && providerSlotMaterial.real) {
    const { error } = await supabase
      .from('project_keys')
      .update({
        slug: 'openai',
        env_var: 'OPENAI_API_KEY',
        upstream_base_url: 'https://api.openai.com',
        auth_header_name: 'authorization',
        auth_header_template: 'Bearer {key}',
        share1_encrypted: providerSlotMaterial.share1_encrypted,
        share2_encrypted: providerSlotMaterial.share2_encrypted,
        extra_headers: {},
        revoked_at: null,
      })
      .eq('id', keyId);
    if (error) throw error;
  } else if (!keyId) {
    const { data, error } = await supabase
      .from('project_keys')
      .insert({
        project_id: projectId,
        provider: 'openai',
        slug: 'openai',
        env_var: 'OPENAI_API_KEY',
        upstream_base_url: 'https://api.openai.com',
        auth_header_name: 'authorization',
        auth_header_template: 'Bearer {key}',
        share1_encrypted: providerSlotMaterial.share1_encrypted,
        share2_encrypted: providerSlotMaterial.share2_encrypted,
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

  return {
    providerSlotKeyId: keyId,
    providerSlotMaterialReady: providerSlotMaterial.real,
  };
}

const user = await runStep('auth user creation', () => ensureUser());
const organization = await runStep('organization creation', () => ensureOrganization(user.id));
await runStep('organization membership creation', () => ensureOrganizationMembership(organization.id, user.id));
const project = await runStep('project creation', () => ensureProject(organization.id, user.id));
await runStep('project membership creation', () => ensureProjectMembership(project.id, user.id));
let sampleData = null;
if (seedSampleData) {
  sampleData = await runStep('dashboard sample data seeding', () => seedDashboardSampleData(organization.id, user.id, project.id));
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
  providerSlotMaterialReady: sampleData?.providerSlotMaterialReady === true,
  providerSlotNote: sampleData?.providerSlotMaterialReady === true
    ? 'OpenAI provider slot was seeded with decryptable enterprise shares.'
    : 'Provider slot uses dashboard placeholders. Set DEMO_PROVIDER_API_KEY or OPENAI_API_KEY plus VAULT_UNWRAP_KEY_BASE64 to seed a live execute-ready slot.',
}, null, 2));
