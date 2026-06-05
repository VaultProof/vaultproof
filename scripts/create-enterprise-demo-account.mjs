import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const SEEDED_BY = 'create-enterprise-demo-account';
const SEED_VERSION = Number(process.env.DEMO_SEED_VERSION || 2);
const DEFAULT_DEMO_EMAIL = 'enterprise-demo+test@vaultproof.dev';
const DEFAULT_DEMO_ORG_NAME = 'Northstar Finance Group';
const DEFAULT_DEMO_ORG_SLUG = 'northstar-finance-demo';
const DASHBOARD_ORIGIN = 'https://enterprise.vaultproof.dev';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const missing = [
  supabaseUrl ? null : 'SUPABASE_URL',
  supabaseServiceRoleKey ? null : 'SUPABASE_SERVICE_ROLE_KEY',
].filter(Boolean);

if (missing.length) {
  console.error(`Missing required env: ${missing.join(', ')}`);
  console.error(`Example: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... DEMO_EMAIL=${DEFAULT_DEMO_EMAIL} npm run seed:enterprise-demo-account`);
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const demoEmail = (process.env.DEMO_EMAIL || DEFAULT_DEMO_EMAIL).trim().toLowerCase();
const demoPassword = process.env.DEMO_PASSWORD || '';
const demoOrgName = process.env.DEMO_ORG_NAME || DEFAULT_DEMO_ORG_NAME;
const demoOrgSlug = normalizeSlug(process.env.DEMO_ORG_SLUG || DEFAULT_DEMO_ORG_SLUG);
const requestedOrgId = (process.env.DEMO_ORG_ID || '').trim();
const useExistingWorkspace = process.env.DEMO_USE_EXISTING_WORKSPACE !== 'false';
const renameWorkspace = process.env.DEMO_RENAME_ORG !== 'false';
const refreshTraffic = process.env.DEMO_REFRESH_TRAFFIC === 'true';
const overwriteProviderSlots = process.env.DEMO_OVERWRITE_PROVIDER_SLOTS === 'true';

const seedMeta = {
  demo: true,
  seeded_by: SEEDED_BY,
  seed_version: SEED_VERSION,
  sample_customer: 'northstar-finance',
};

const providerDefaults = {
  openai: { upstream: 'https://api.openai.com', env: 'OPENAI_API_KEY', path: '/v1/responses', method: 'POST' },
  anthropic: { upstream: 'https://api.anthropic.com', env: 'ANTHROPIC_API_KEY', path: '/v1/messages', method: 'POST' },
  stripe: { upstream: 'https://api.stripe.com', env: 'STRIPE_SECRET_KEY', path: '/v1/payment_intents', method: 'POST' },
  cloudflare: { upstream: 'https://api.cloudflare.com', env: 'CLOUDFLARE_API_TOKEN', path: '/client/v4/zones', method: 'GET' },
  intercom: { upstream: 'https://api.intercom.io', env: 'INTERCOM_ACCESS_TOKEN', path: '/conversations', method: 'GET' },
  sendgrid: { upstream: 'https://api.sendgrid.com', env: 'SENDGRID_API_KEY', path: '/v3/mail/send', method: 'POST' },
  postmark: { upstream: 'https://api.postmarkapp.com', env: 'POSTMARK_SERVER_TOKEN', path: '/email', method: 'POST' },
  notion: { upstream: 'https://api.notion.com', env: 'NOTION_TOKEN', path: '/v1/pages', method: 'POST' },
  deepl: { upstream: 'https://api-free.deepl.com', env: 'DEEPL_API_KEY', path: '/v2/translate', method: 'POST' },
  google: { upstream: 'https://translation.googleapis.com', env: 'GOOGLE_API_KEY', path: '/v3/projects/northstar/locations/global:translateText', method: 'POST' },
  sentry: { upstream: 'https://sentry.io', env: 'SENTRY_AUTH_TOKEN', path: '/api/0/projects/northstar/web/', method: 'GET' },
  slack: { upstream: 'https://slack.com', env: 'SLACK_BOT_TOKEN', path: '/api/chat.postMessage', method: 'POST' },
  github: { upstream: 'https://api.github.com', env: 'GITHUB_TOKEN', path: '/repos/northstar/security-automation/actions/runs', method: 'GET' },
  supabase: { upstream: 'https://northstar.supabase.co', env: 'SUPABASE_SERVICE_ROLE_KEY', path: '/rest/v1/audit_events', method: 'GET' },
};

const demoProjects = [
  {
    slug: 'customer-api-gateway',
    name: 'Customer API Gateway',
    daysOld: 42,
    origins: 'https://app.northstarfinance.example,https://api.northstarfinance.example',
    providers: ['openai', 'stripe', 'cloudflare'],
    policy: {
      allowed_providers: ['openai', 'stripe', 'cloudflare'],
      allowed_methods: ['GET', 'POST'],
      allowed_upstream_hosts: ['api.openai.com', 'api.stripe.com', 'api.cloudflare.com'],
      allowed_customer_gateways: ['vaultproof-managed'],
      allowed_client_classes: ['server', 'worker'],
      rate_limit_per_minute: 420,
    },
  },
  {
    slug: 'ai-support-agent',
    name: 'AI Support Agent',
    daysOld: 34,
    origins: 'https://support.northstarfinance.example',
    providers: ['openai', 'anthropic', 'intercom'],
    policy: {
      allowed_providers: ['openai', 'anthropic', 'intercom'],
      allowed_methods: ['GET', 'POST'],
      allowed_upstream_hosts: ['api.openai.com', 'api.anthropic.com', 'api.intercom.io'],
      allowed_customer_gateways: ['vaultproof-managed'],
      allowed_client_classes: ['server'],
      rate_limit_per_minute: 260,
    },
  },
  {
    slug: 'billing-automation',
    name: 'Billing Automation',
    daysOld: 31,
    origins: 'https://billing.northstarfinance.example',
    providers: ['stripe', 'sendgrid', 'notion'],
    policy: {
      allowed_providers: ['stripe', 'sendgrid', 'notion'],
      allowed_methods: ['GET', 'POST'],
      allowed_upstream_hosts: ['api.stripe.com', 'api.sendgrid.com', 'api.notion.com'],
      allowed_customer_gateways: ['vaultproof-managed'],
      allowed_client_classes: ['server', 'job'],
      allowed_email_sender_domains: ['northstarfinance.example'],
      allowed_email_recipient_domains: ['northstarfinance.example', 'customer.example'],
      allowed_email_template_ids: ['invoice-ready', 'payment-failed'],
      require_email_template_id: true,
      rate_limit_per_minute: 180,
    },
  },
  {
    slug: 'email-notifications',
    name: 'Email Notifications',
    daysOld: 29,
    origins: 'https://notify.northstarfinance.example',
    providers: ['sendgrid', 'postmark'],
    policy: {
      allowed_providers: ['sendgrid', 'postmark'],
      allowed_methods: ['POST'],
      allowed_upstream_hosts: ['api.sendgrid.com', 'api.postmarkapp.com'],
      allowed_customer_gateways: ['vaultproof-managed'],
      allowed_client_classes: ['server'],
      allowed_email_sender_domains: ['northstarfinance.example'],
      allowed_email_recipient_domains: ['northstarfinance.example', 'customer.example'],
      allowed_email_template_ids: ['welcome', 'risk-alert', 'statement-ready'],
      require_email_template_id: true,
      rate_limit_per_minute: 520,
    },
  },
  {
    slug: 'localization-service',
    name: 'Localization Service',
    daysOld: 24,
    origins: 'https://content.northstarfinance.example',
    providers: ['deepl', 'google'],
    policy: {
      allowed_providers: ['deepl', 'google'],
      allowed_methods: ['GET', 'POST'],
      allowed_upstream_hosts: ['api-free.deepl.com', 'translation.googleapis.com'],
      allowed_customer_gateways: ['vaultproof-managed'],
      allowed_client_classes: ['worker', 'job'],
      rate_limit_per_minute: 140,
    },
  },
  {
    slug: 'analytics-pipeline',
    name: 'Analytics Pipeline',
    daysOld: 18,
    origins: 'https://analytics.northstarfinance.example',
    providers: ['google', 'sentry', 'slack'],
    policy: {
      allowed_providers: ['google', 'sentry', 'slack'],
      allowed_methods: ['GET', 'POST'],
      allowed_upstream_hosts: ['analyticsdata.googleapis.com', 'sentry.io', 'slack.com'],
      allowed_customer_gateways: ['vaultproof-managed'],
      allowed_client_classes: ['job', 'server'],
      rate_limit_per_minute: 240,
    },
  },
  {
    slug: 'security-automation',
    name: 'Security Automation',
    daysOld: 15,
    origins: 'https://security.northstarfinance.example',
    providers: ['github', 'cloudflare', 'supabase'],
    policy: {
      allowed_providers: ['github', 'cloudflare', 'supabase'],
      allowed_methods: ['GET', 'POST'],
      allowed_upstream_hosts: ['api.github.com', 'api.cloudflare.com', 'northstar.supabase.co'],
      allowed_customer_gateways: ['vaultproof-managed'],
      allowed_client_classes: ['server', 'job'],
      allowed_ip_cidrs: ['10.44.0.0/16'],
      rate_limit_per_minute: 160,
    },
  },
];

function normalizeSlug(value) {
  return String(value || 'vaultproof-enterprise-demo')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63) || 'vaultproof-enterprise-demo';
}

function shortHash(value, length = 8) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, length);
}

function daysAgoIso(days, hourOffset = 0, minuteOffset = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - Math.max(0, days));
  date.setUTCHours(Math.max(0, Math.min(23, 16 - hourOffset)), Math.max(0, Math.min(59, 20 + minuteOffset)), 0, 0);
  return date.toISOString();
}

function isPlaceholderMaterial(row) {
  const share1 = String(row?.share1_encrypted || '');
  const share2 = String(row?.share2_encrypted || '');
  return share1.startsWith('demo-dashboard-placeholder') && share2.startsWith('demo-dashboard-placeholder');
}

async function runStep(label, fn) {
  try {
    return await fn();
  } catch (error) {
    console.error(`Failed during ${label}: ${error?.message || error}`);
    throw error;
  }
}

async function optionalStep(label, fn, fallback = null) {
  try {
    return await fn();
  } catch (error) {
    console.warn(`Skipped ${label}: ${error?.message || error}`);
    return fallback;
  }
}

async function findUserByEmail(email) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
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
    const updates = {
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
    };
    if (demoPassword) updates.password = demoPassword;

    const { data, error } = await supabase.auth.admin.updateUserById(existing.id, updates);
    if (error) throw error;
    return {
      user: data.user,
      passwordStatus: demoPassword ? 'updated from DEMO_PASSWORD' : 'unchanged',
      created: false,
    };
  }

  if (!demoPassword) {
    throw new Error(`No Supabase user exists for ${demoEmail}. Set DEMO_PASSWORD to create it, or create the account first and rerun without DEMO_PASSWORD.`);
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
  return {
    user: data.user,
    passwordStatus: 'created from DEMO_PASSWORD',
    created: true,
  };
}

const roleRank = {
  owner: 90,
  admin: 80,
  iam_admin: 75,
  security_admin: 74,
  platform_admin: 73,
  developer: 60,
  auditor: 55,
  member: 40,
  viewer: 30,
};

function sortMembershipsLikeDashboard(userId, rows) {
  return rows.sort((left, right) => {
    const leftOrg = Array.isArray(left.organizations) ? left.organizations[0] : left.organizations;
    const rightOrg = Array.isArray(right.organizations) ? right.organizations[0] : right.organizations;
    const leftPersonal = leftOrg?.kind === 'personal' && leftOrg?.owner_user_id === userId ? 1 : 0;
    const rightPersonal = rightOrg?.kind === 'personal' && rightOrg?.owner_user_id === userId ? 1 : 0;
    if (leftPersonal !== rightPersonal) return rightPersonal - leftPersonal;
    const roleDelta = (roleRank[right.role] || 0) - (roleRank[left.role] || 0);
    if (roleDelta !== 0) return roleDelta;
    return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
  });
}

async function listUserOrganizations(userId) {
  const { data, error } = await supabase
    .from('organization_members')
    .select(`
      role,
      created_at,
      organizations!inner (
        id,
        name,
        slug,
        kind,
        owner_user_id,
        created_at,
        archived_at
      )
    `)
    .eq('user_id', userId)
    .is('organizations.archived_at', null);

  if (error) throw error;
  return sortMembershipsLikeDashboard(userId, data || [])
    .map((row) => ({
      role: row.role,
      created_at: row.created_at,
      organization: Array.isArray(row.organizations) ? row.organizations[0] : row.organizations,
    }))
    .filter((row) => row.organization);
}

async function createDemoOrganization(userId) {
  const { data: existing, error: lookupError } = await supabase
    .from('organizations')
    .select('id, name, slug, kind, owner_user_id, created_at')
    .eq('slug', demoOrgSlug)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) return existing;

  const { data, error } = await supabase
    .from('organizations')
    .insert({
      name: demoOrgName,
      slug: demoOrgSlug,
      kind: 'team',
      owner_user_id: userId,
    })
    .select('id, name, slug, kind, owner_user_id, created_at')
    .single();
  if (error) throw error;
  return data;
}

async function loadRequestedOrganization(userId) {
  if (!requestedOrgId) return null;
  const { data, error } = await supabase
    .from('organizations')
    .select('id, name, slug, kind, owner_user_id, created_at')
    .eq('id', requestedOrgId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`DEMO_ORG_ID ${requestedOrgId} was not found.`);
  await ensureOrganizationMembership(data.id, userId);
  return data;
}

async function ensureTargetOrganization(userId) {
  const requested = await loadRequestedOrganization(userId);
  let organization = requested;
  let source = requested ? 'requested' : '';

  if (!organization && useExistingWorkspace) {
    const memberships = await listUserOrganizations(userId);
    if (memberships.length) {
      organization = memberships[0].organization;
      source = 'existing_membership';
    }
  }

  if (!organization) {
    organization = await createDemoOrganization(userId);
    source = 'created_or_slug_match';
  }

  if (renameWorkspace) {
    const { data, error } = await supabase
      .from('organizations')
      .update({
        name: demoOrgName,
        updated_at: new Date().toISOString(),
      })
      .eq('id', organization.id)
      .select('id, name, slug, kind, owner_user_id, created_at')
      .single();
    if (error) throw error;
    organization = data;
  }

  await ensureOrganizationMembership(organization.id, userId);
  return { organization, source };
}

async function ensureOrganizationMembership(organizationId, userId) {
  const { error } = await supabase
    .from('organization_members')
    .upsert({
      organization_id: organizationId,
      user_id: userId,
      role: 'owner',
      invited_by: userId,
    }, { onConflict: 'organization_id,user_id' });
  if (error) throw error;
}

async function ensureProjectMembership(projectId, userId) {
  const { error } = await supabase
    .from('project_members')
    .upsert({
      project_id: projectId,
      user_id: userId,
      role: 'owner',
      invited_by: userId,
    }, { onConflict: 'project_id,user_id' });
  if (error) throw error;
}

async function ensureProject(organizationId, userId, spec) {
  const projectRef = `vp-proj-${shortHash(organizationId)}-${spec.slug.replace(/-/g, '').slice(0, 24)}`;
  const { data: existing, error: lookupError } = await supabase
    .from('projects')
    .select('id, vp_proj_id, name')
    .eq('organization_id', organizationId)
    .eq('name', spec.name)
    .is('revoked_at', null)
    .maybeSingle();
  if (lookupError) throw lookupError;

  const payload = {
    user_id: userId,
    organization_id: organizationId,
    name: spec.name,
    allowed_origins: spec.origins,
    strict_origin: true,
    caller_lock_policy: spec.policy,
    revoked_at: null,
  };

  if (existing) {
    const { data, error } = await supabase
      .from('projects')
      .update(payload)
      .eq('id', existing.id)
      .select('id, organization_id, vp_proj_id, name')
      .single();
    if (error) throw error;
    await ensureProjectMembership(data.id, userId);
    return data;
  }

  const { data, error } = await supabase
    .from('projects')
    .insert({
      ...payload,
      vp_proj_id: projectRef,
      created_at: daysAgoIso(spec.daysOld),
    })
    .select('id, organization_id, vp_proj_id, name')
    .single();
  if (error) throw error;
  await ensureProjectMembership(data.id, userId);
  return data;
}

async function ensureProviderSlot(project, provider) {
  const defaults = providerDefaults[provider] || providerDefaults.openai;
  const { data: existing, error: lookupError } = await supabase
    .from('project_keys')
    .select('id, share1_encrypted, share2_encrypted')
    .eq('project_id', project.id)
    .eq('provider', provider)
    .maybeSingle();
  if (lookupError) throw lookupError;

  const placeholderSuffix = `${project.id}:${provider}`;
  const basePayload = {
    project_id: project.id,
    provider,
    slug: provider,
    env_var: defaults.env,
    upstream_base_url: defaults.upstream,
    auth_header_name: 'authorization',
    auth_header_template: 'Bearer {key}',
    extra_headers: {},
    revoked_at: null,
  };
  const materialPayload = {
    share1_encrypted: `demo-dashboard-placeholder-share-1:${placeholderSuffix}`,
    share2_encrypted: `demo-dashboard-placeholder-share-2:${placeholderSuffix}`,
  };

  if (existing) {
    const { data, error } = await supabase
      .from('project_keys')
      .update({
        ...basePayload,
        ...(overwriteProviderSlots || isPlaceholderMaterial(existing) ? materialPayload : {}),
      })
      .eq('id', existing.id)
      .select('id, project_id, provider, slug')
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('project_keys')
    .insert({
      ...basePayload,
      ...materialPayload,
    })
    .select('id, project_id, provider, slug')
    .single();
  if (error) throw error;
  return data;
}

async function seedProjectsAndProviderSlots(organizationId, userId) {
  const projectRows = [];
  const providerRows = [];

  for (const spec of demoProjects) {
    const project = await ensureProject(organizationId, userId, spec);
    projectRows.push({ ...project, spec });
    for (const provider of spec.providers) {
      const slot = await ensureProviderSlot(project, provider);
      providerRows.push({ ...slot, project_id: project.id, project_name: project.name, spec });
    }
  }

  return { projectRows, providerRows };
}

async function hasSeededTraffic(projectIds) {
  if (!projectIds.length) return false;
  const { count, error } = await supabase
    .from('project_access_logs')
    .select('id', { count: 'exact', head: true })
    .in('project_id', projectIds)
    .contains('metadata', { seeded_by: SEEDED_BY, seed_version: SEED_VERSION });
  if (error) return false;
  return (count || 0) > 100;
}

function trafficStatus(index, day, provider) {
  if ((index + day) % 41 === 0) return { status: 429, error: 'demo rate limit exceeded' };
  if ((index + day) % 29 === 0) return { status: 403, error: 'demo caller-lock policy denial' };
  if ((index + day) % 53 === 0) return { status: 500, error: 'demo upstream transient error' };
  if (provider === 'stripe' && (index + day) % 17 === 0) return { status: 201, error: null };
  return { status: 200, error: null };
}

function statusBucket(statusCode) {
  if ([401, 403, 429].includes(Number(statusCode))) return 'denied';
  if (Number(statusCode) >= 400) return 'error';
  return 'success';
}

function buildTrafficLogs(providerRows) {
  const rows = [];
  const byProject = new Map();
  for (const row of providerRows) {
    const list = byProject.get(row.project_id) || [];
    list.push(row);
    byProject.set(row.project_id, list);
  }

  for (let day = 29; day >= 0; day -= 1) {
    for (const [projectId, slots] of byProject.entries()) {
      const projectSalt = Number.parseInt(shortHash(projectId, 4), 16);
      const dailyCalls = 3 + ((projectSalt + day) % 6);
      for (let index = 0; index < dailyCalls; index += 1) {
        const slot = slots[(index + day) % slots.length];
        const defaults = providerDefaults[slot.provider] || providerDefaults.openai;
        const status = trafficStatus(index + projectSalt, day, slot.provider);
        const apiProtocol = defaults.path.includes('graphql') ? 'graphql' : 'rest';
        const latency = 70 + ((projectSalt + day * 17 + index * 23) % 560);
        rows.push({
          project_id: projectId,
          project_key_id: slot.id,
          slug: slot.slug || slot.provider,
          provider: slot.provider,
          method: defaults.method,
          upstream_path: defaults.path,
          status_code: status.status,
          latency_ms: latency,
          error: status.error,
          metadata: {
            ...seedMeta,
            api_protocol: apiProtocol,
            caller_class: index % 3 === 0 ? 'server' : index % 3 === 1 ? 'worker' : 'job',
            region: index % 2 === 0 ? 'us-east-1' : 'us-central1',
            customer_gateway: 'vaultproof-managed',
            project_name: slot.project_name,
          },
          timestamp: daysAgoIso(day, (index + projectSalt) % 9, (index * 7) % 30),
        });
      }
    }
  }

  for (let index = 0; index < 36; index += 1) {
    const slot = providerRows[index % providerRows.length];
    const defaults = providerDefaults[slot.provider] || providerDefaults.openai;
    const status = trafficStatus(index, 0, slot.provider);
    rows.push({
      project_id: slot.project_id,
      project_key_id: slot.id,
      slug: slot.slug || slot.provider,
      provider: slot.provider,
      method: defaults.method,
      upstream_path: defaults.path,
      status_code: status.status,
      latency_ms: 95 + ((index * 37) % 420),
      error: status.error,
      metadata: {
        ...seedMeta,
        api_protocol: defaults.path.includes('graphql') ? 'graphql' : 'rest',
        caller_class: index % 2 === 0 ? 'server' : 'worker',
        region: index % 2 === 0 ? 'us-east-1' : 'us-central1',
        customer_gateway: 'vaultproof-managed',
        project_name: slot.project_name,
        recent_demo_activity: true,
      },
      timestamp: new Date(Date.now() - (index + 4) * 11 * 60 * 1000).toISOString(),
    });
  }

  return rows.sort((left, right) => String(left.timestamp).localeCompare(String(right.timestamp)));
}

function buildTrafficRollups(logRows) {
  const rollups = new Map();
  for (const row of logRows) {
    const day = String(row.timestamp).slice(0, 10);
    const bucket = statusBucket(row.status_code);
    const key = [row.project_id, day, row.provider, row.slug, bucket].join('::');
    const existing = rollups.get(key) || {
      project_id: row.project_id,
      day,
      provider: row.provider,
      slug: row.slug,
      status_bucket: bucket,
      call_count: 0,
      total_latency_ms: 0,
      max_latency_ms: 0,
      last_timestamp: row.timestamp,
      updated_at: new Date().toISOString(),
    };
    existing.call_count += 1;
    existing.total_latency_ms += Math.max(Number(row.latency_ms || 0), 0);
    existing.max_latency_ms = Math.max(existing.max_latency_ms, Number(row.latency_ms || 0));
    if (String(row.timestamp) > String(existing.last_timestamp || '')) existing.last_timestamp = row.timestamp;
    rollups.set(key, existing);
  }
  return [...rollups.values()];
}

async function insertRowsInChunks(table, rows, chunkSize = 500) {
  let inserted = 0;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const { error } = await supabase.from(table).insert(chunk);
    if (error) throw error;
    inserted += chunk.length;
  }
  return inserted;
}

async function upsertRowsInChunks(table, rows, onConflict, chunkSize = 500) {
  let upserted = 0;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict });
    if (error) throw error;
    upserted += chunk.length;
  }
  return upserted;
}

function isRollupTriggerGrantError(error) {
  const message = String(error?.message || error || '');
  return message.includes('permission denied for function project_access_log_status_bucket')
    || message.includes('permission denied for function rollup_project_access_log_insert');
}

async function seedTraffic(providerRows) {
  const projectIds = [...new Set(providerRows.map((row) => row.project_id))];
  if (!refreshTraffic && await hasSeededTraffic(projectIds)) {
    return { inserted: 0, rollupsUpserted: 0, skipped: true, fallback: null };
  }

  const rows = buildTrafficLogs(providerRows);
  try {
    return {
      inserted: await insertRowsInChunks('project_access_logs', rows),
      rollupsUpserted: 0,
      skipped: false,
      fallback: null,
    };
  } catch (error) {
    if (!isRollupTriggerGrantError(error)) throw error;
    const rollups = buildTrafficRollups(rows);
    return {
      inserted: 0,
      rollupsUpserted: await upsertRowsInChunks(
        'project_access_log_daily_rollups',
        rollups,
        'project_id,day,provider,slug,status_bucket',
      ),
      skipped: false,
      fallback: 'daily_rollups_only_until_rollup_trigger_grant_is_applied',
    };
  }
}

async function hasSeededAudit(organizationId) {
  const { count, error } = await supabase
    .from('organization_audit_events')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .contains('metadata', { seeded_by: SEEDED_BY, seed_version: SEED_VERSION });
  if (error) return false;
  return (count || 0) > 3;
}

async function seedAuditEvents(organizationId, userId, projectRows) {
  if (!refreshTraffic && await hasSeededAudit(organizationId)) {
    return { inserted: 0, skipped: true };
  }

  const bySlug = new Map(projectRows.map((row) => [row.spec.slug, row]));
  const events = [
    ['project_policy_updated', 'project', 'AI Support Agent caller-lock policy now requires the VaultProof-managed gateway.', 'ai-support-agent', 0, { changed_fields: ['allowed_customer_gateways', 'allowed_client_classes', 'rate_limit_per_minute'], approval: 'SEC-1842' }],
    ['enterprise_provider_slot_created', 'project_key', 'Postmark transactional email provider slot was added for the notification workload.', 'email-notifications', 1, { provider: 'postmark', material_mode: 'demo-placeholder' }],
    ['organization_alert_policy_updated', 'organization_alert_policy', 'Alert policy moved to warning and critical delivery for the pilot workspace.', null, 2, { minimum_severity: 'warning', dispatch_enabled: true }],
    ['organization_member_reviewed', 'organization_member', 'Quarterly access review completed for platform and security admins.', null, 3, { reviewed_roles: ['owner', 'platform_admin', 'security_admin', 'auditor'] }],
    ['proxy_access_policy_updated', 'organization_proxy_access_policy', 'Proxy access tier set to recommended monitor mode with automatic anomaly freeze enabled.', null, 4, { tier: 'recommended', enforcement_mode: 'monitor' }],
    ['enterprise_demo_account_seeded', 'organization', `Seeded enterprise demo sample data for ${demoEmail}.`, null, 0, { refreshed_by: SEEDED_BY }],
  ].map(([eventType, targetType, description, projectSlug, daysAgo, metadata], index) => {
    const project = projectSlug ? bySlug.get(projectSlug) : null;
    return {
      organization_id: organizationId,
      project_id: project?.id || null,
      actor_user_id: userId,
      actor_email: demoEmail,
      event_type: eventType,
      target_type: targetType,
      target_id: project?.id || organizationId,
      description,
      metadata: {
        ...seedMeta,
        ...metadata,
      },
      created_at: daysAgoIso(daysAgo, index),
    };
  });

  return {
    inserted: await insertRowsInChunks('organization_audit_events', events),
    skipped: false,
  };
}

async function ensureAlertDestination(organizationId, userId, destination) {
  const { data: existing, error: lookupError } = await supabase
    .from('organization_alert_destinations')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('channel_type', destination.channel_type)
    .eq('target', destination.target)
    .maybeSingle();
  if (lookupError) throw lookupError;

  if (existing) {
    const { data, error } = await supabase
      .from('organization_alert_destinations')
      .update({
        label: destination.label,
        enabled: destination.enabled,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select('id, channel_type, label, target')
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('organization_alert_destinations')
    .insert({
      organization_id: organizationId,
      channel_type: destination.channel_type,
      label: destination.label,
      target: destination.target,
      enabled: destination.enabled,
      created_by_user_id: userId,
      created_at: daysAgoIso(destination.daysOld || 20),
      updated_at: daysAgoIso(1),
    })
    .select('id, channel_type, label, target')
    .single();
  if (error) throw error;
  return data;
}

async function seedAlertPolicy(organizationId) {
  const { error } = await supabase
    .from('organization_alert_policies')
    .upsert({
      organization_id: organizationId,
      dispatch_enabled: true,
      minimum_severity: 'warning',
      min_interval_minutes: 15,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'organization_id' });
  if (error) throw error;
}

async function hasSeededAlertDeliveries(organizationId) {
  const { count, error } = await supabase
    .from('organization_alert_deliveries')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .contains('payload', { seeded_by: SEEDED_BY, seed_version: SEED_VERSION });
  if (error) return false;
  return (count || 0) > 2;
}

async function seedAlerts(organizationId, userId) {
  await seedAlertPolicy(organizationId);
  const destinations = [];
  for (const destination of [
    { label: 'Security operations email', channel_type: 'email', target: 'secops@northstarfinance.example', enabled: true, daysOld: 31 },
    { label: 'Platform Slack webhook', channel_type: 'webhook', target: 'https://hooks.slack.com/services/T000/B000/vaultproof-demo', enabled: true, daysOld: 28 },
    { label: 'Compliance mailbox', channel_type: 'email', target: 'compliance@northstarfinance.example', enabled: false, daysOld: 25 },
  ]) {
    destinations.push(await ensureAlertDestination(organizationId, userId, destination));
  }

  if (!refreshTraffic && await hasSeededAlertDeliveries(organizationId)) {
    return { destinations: destinations.length, deliveriesInserted: 0, dispatchRunsInserted: 0, skippedHistory: true };
  }

  const primaryEmail = destinations.find((item) => item.channel_type === 'email');
  const webhook = destinations.find((item) => item.channel_type === 'webhook');
  const deliveryRows = [
    [primaryEmail, 'policy_dispatch', 'delivered', 'Critical provider denial alert delivered to security operations.', 202, 0],
    [webhook, 'policy_dispatch', 'delivered', 'Webhook alert delivered for unusual Anthropic support-agent denial rate.', 200, 1],
    [primaryEmail, 'test_send', 'skipped', 'Email test-send was recorded; outbound email transport is not configured in the demo.', null, 2],
    [primaryEmail, 'policy_dispatch', 'delivered', 'Warning alert delivered for Cloudflare edge slot rotation reminder.', 202, 3],
    [webhook, 'policy_dispatch', 'failed', 'Demo webhook endpoint returned a simulated retryable failure.', 503, 5],
  ].filter(([destination]) => destination).map(([destination, deliveryKind, status, detail, responseStatus, daysAgo]) => ({
    organization_id: organizationId,
    destination_id: destination.id,
    channel_type: destination.channel_type,
    delivery_kind: deliveryKind,
    status,
    detail,
    response_status: responseStatus,
    payload: {
      ...seedMeta,
      severity: status === 'failed' ? 'warning' : 'info',
    },
    delivered_at: daysAgoIso(daysAgo),
  }));

  const dispatchRows = [
    ['scheduled', 'dispatched', '[demo seed v2] 2 warning alerts dispatched', 2, 2, 2, 0, 0, 0],
    ['scheduled', 'dispatched', '[demo seed v2] 1 critical alert dispatched', 1, 2, 1, 0, 0, 1],
    ['manual', 'skipped', '[demo seed v2] manual test send recorded without outbound email transport', 1, 1, 0, 0, 1, 2],
    ['scheduled', 'failed', '[demo seed v2] webhook delivery failed and will retry on next scheduled pass', 1, 2, 0, 1, 0, 5],
  ].map(([triggerSource, status, reason, dispatched, destinationCount, delivered, failed, skipped, daysAgo]) => ({
    organization_id: organizationId,
    trigger_source: triggerSource,
    status,
    reason,
    dispatched_alert_count: dispatched,
    destination_count: destinationCount,
    delivered_count: delivered,
    failed_count: failed,
    skipped_count: skipped,
    next_eligible_at: null,
    checked_at: daysAgoIso(daysAgo),
  }));

  return {
    destinations: destinations.length,
    deliveriesInserted: await insertRowsInChunks('organization_alert_deliveries', deliveryRows),
    dispatchRunsInserted: await insertRowsInChunks('organization_alert_dispatch_runs', dispatchRows),
    skippedHistory: false,
  };
}

async function seedProxyAccessPolicy(organizationId, userId) {
  const { error } = await supabase
    .from('organization_proxy_access_policies')
    .upsert({
      organization_id: organizationId,
      tier: 'recommended',
      enforcement_mode: 'monitor',
      allowed_egress_cidrs: ['35.235.240.0/20'],
      require_mtls: false,
      require_private_connectivity: false,
      anomaly_auto_freeze_enabled: true,
      default_rate_limit_per_minute: 600,
      default_provider_scope_mode: 'project_policy',
      freeze_state: 'active',
      freeze_reason: null,
      notes: 'Demo workspace uses recommended monitor mode to show proxy access posture without blocking sample traffic.',
      created_by: userId,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'organization_id' });
  if (error) throw error;
}

const userResult = await runStep('demo user lookup', () => ensureUser());
const user = userResult.user;
const target = await runStep('demo workspace selection', () => ensureTargetOrganization(user.id));
const { projectRows, providerRows } = await runStep('project and provider sample seeding', () => seedProjectsAndProviderSlots(target.organization.id, user.id));
const traffic = await runStep('traffic sample seeding', () => seedTraffic(providerRows));
const audit = await runStep('audit sample seeding', () => seedAuditEvents(target.organization.id, user.id, projectRows));
const alerts = await optionalStep('alert sample seeding', () => seedAlerts(target.organization.id, user.id), { destinations: 0, deliveriesInserted: 0, dispatchRunsInserted: 0, skippedHistory: true });
const proxyAccessPolicy = await optionalStep('proxy access policy sample seeding', () => seedProxyAccessPolicy(target.organization.id, user.id).then(() => true), false);

console.log(JSON.stringify({
  email: demoEmail,
  password_status: userResult.passwordStatus,
  loginUrl: 'https://enterprise.vaultproof.dev/app/login',
  dashboardUrl: `https://enterprise.vaultproof.dev/app/dashboard?org=${target.organization.id}`,
  workspace: {
    id: target.organization.id,
    name: target.organization.name,
    kind: target.organization.kind,
    source: target.source,
  },
  sample_data: {
    projects: projectRows.length,
    provider_slots: providerRows.length,
    traffic_logs_inserted: traffic.inserted,
    traffic_rollups_upserted: traffic.rollupsUpserted,
    traffic_fallback: traffic.fallback,
    traffic_history_skipped_existing_seed: traffic.skipped,
    audit_events_inserted: audit.inserted,
    audit_history_skipped_existing_seed: audit.skipped,
    alert_destinations: alerts.destinations,
    alert_deliveries_inserted: alerts.deliveriesInserted,
    alert_dispatch_runs_inserted: alerts.dispatchRunsInserted,
    alert_history_skipped_existing_seed: alerts.skippedHistory,
    proxy_access_policy_seeded: proxyAccessPolicy,
  },
  safety: {
    provider_slots_are_placeholders: true,
    no_raw_provider_keys_seeded: true,
    isolation: 'Seeded only into the organization selected for this demo user.',
  },
}, null, 2));
