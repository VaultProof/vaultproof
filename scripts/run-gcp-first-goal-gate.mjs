#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const enterpriseUrl = (process.env.ENTERPRISE_URL || 'https://enterprise.vaultproof.dev').replace(/\/+$/, '');
const expectedSecurityProfile = process.env.ENTERPRISE_EXPECTED_SECURITY_PROFILE || 'google-confidential-production';
const runLocalChecks = process.env.SKIP_LOCAL_CHECKS !== 'true';
const runLiveEdge = process.env.SKIP_LIVE_EDGE !== 'true';
const allowDegradedDashboard = process.env.ALLOW_DEGRADED_DASHBOARD === 'true';
const demoOnly = process.env.GOAL1_DEMO_ONLY !== 'false';
const generateSupabaseTestSession = process.env.GENERATE_SUPABASE_TEST_SESSION !== 'false';
const pilotEmail = (process.env.DEMO_EMAIL || process.env.ENTERPRISE_PILOT_EMAIL || 'ken@vaultproof.dev').trim().toLowerCase();
const providedAccessToken = (process.env.ENTERPRISE_TEST_ACCESS_TOKEN || process.env.ACCESS_TOKEN || '').trim();
let accessToken = providedAccessToken;

const steps = [];
const blockers = [];
const warnings = [];

function tail(value, max = 3000) {
  const text = String(value || '').trim();
  if (text.length <= max) return text;
  return `...${text.slice(text.length - max)}`;
}

function pushStep(step) {
  steps.push({
    ...step,
    durationMs: step.durationMs || 0,
  });
}

function runStep(name, command, args, options = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...options.env },
    input: options.input,
    encoding: 'utf8',
    maxBuffer: 30 * 1024 * 1024,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const step = {
    name,
    command: [command, ...args].join(' '),
    status: result.status === 0 ? 'pass' : 'fail',
    durationMs: Date.now() - startedAt,
  };
  if (result.status !== 0) {
    step.outputTail = tail(output);
    blockers.push({ name, detail: tail(output) || `exit ${result.status}` });
  }
  pushStep(step);
  return result;
}

async function checkPilotData() {
  const startedAt = Date.now();
  const step = {
    name: 'Pilot Supabase data',
    command: `Supabase service-role check for ${pilotEmail}`,
    status: 'fail',
    durationMs: 0,
  };

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    blockers.push({
      name: 'pilot data check',
      detail: 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY so the gate can verify first pilot org/project/provider-slot data.',
    });
    step.outputTail = 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.';
    step.durationMs = Date.now() - startedAt;
    pushStep(step);
    return;
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    let user = null;
    for (let page = 1; page <= 20; page += 1) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw error;
      user = data.users.find((item) => item.email?.toLowerCase() === pilotEmail);
      if (user || data.users.length < 1000) break;
    }

    if (!user) {
      blockers.push({ name: 'pilot user', detail: `${pilotEmail} was not found in Supabase auth users.` });
      step.outputTail = 'Pilot user missing.';
      step.durationMs = Date.now() - startedAt;
      pushStep(step);
      return;
    }

    const { data: memberships, error: membershipError } = await supabase
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', user.id);
    if (membershipError) throw membershipError;

    const organizationIds = (memberships || []).map((row) => row.organization_id).filter(Boolean);
    if (!organizationIds.length) {
      blockers.push({ name: 'pilot organization membership', detail: `${pilotEmail} has no organization membership.` });
      step.outputTail = 'Pilot organization membership missing.';
      step.durationMs = Date.now() - startedAt;
      pushStep(step);
      return;
    }

    const { data: projects, error: projectsError } = await supabase
      .from('projects')
      .select('id, organization_id, vp_proj_id, name, caller_lock_policy, revoked_at')
      .in('organization_id', organizationIds)
      .is('revoked_at', null);
    if (projectsError) throw projectsError;

    const projectIds = (projects || []).map((row) => row.id).filter(Boolean);
    if (!projectIds.length) {
      blockers.push({ name: 'pilot project', detail: `${pilotEmail} has no active pilot project.` });
      step.outputTail = 'Pilot project missing.';
      step.durationMs = Date.now() - startedAt;
      pushStep(step);
      return;
    }

    const { data: projectMemberships, error: projectMembershipError } = await supabase
      .from('project_members')
      .select('project_id, role')
      .eq('user_id', user.id)
      .in('project_id', projectIds);
    if (projectMembershipError) throw projectMembershipError;

    if (!projectMemberships?.length) {
      blockers.push({ name: 'pilot project membership', detail: `${pilotEmail} has no project membership on the pilot project.` });
    }

    const { data: providerSlots, error: slotsError } = await supabase
      .from('project_keys')
      .select('id, project_id, provider, slug, upstream_base_url, auth_header_name, auth_header_template, share1_encrypted, share2_encrypted, revoked_at')
      .in('project_id', projectIds)
      .eq('provider', 'openai')
      .is('revoked_at', null);
    if (slotsError) throw slotsError;

    const usableSlot = (providerSlots || []).find((slot) => (
      slot.share1_encrypted
      && slot.share2_encrypted
      && slot.upstream_base_url
      && slot.auth_header_name
      && slot.auth_header_template
    ));
    const liveSlot = (providerSlots || []).find((slot) => (
      slot.share1_encrypted
      && slot.share2_encrypted
      && slot.upstream_base_url
      && slot.auth_header_name
      && slot.auth_header_template
      && !String(slot.share1_encrypted).startsWith('demo-dashboard-placeholder')
      && !String(slot.share2_encrypted).startsWith('demo-dashboard-placeholder')
    ));

    if (!usableSlot) {
      blockers.push({
        name: 'pilot provider slot',
        detail: `${pilotEmail} needs an active OpenAI provider slot with encrypted share fields, upstream URL, and auth header template.`,
      });
    } else if (!liveSlot && !demoOnly) {
      blockers.push({
        name: 'pilot provider slot material',
        detail: `${pilotEmail} needs a live OpenAI provider slot with decryptable encrypted shares. Demo placeholders are allowed only when GOAL1_DEMO_ONLY is not false.`,
      });
    } else if (!liveSlot && demoOnly) {
      warnings.push({
        name: 'demo provider slot material',
        detail: 'GOAL1_DEMO_ONLY=true; placeholder provider shares are acceptable for dry-run demo validation.',
      });
    }

    step.status = projectMemberships?.length && usableSlot && (demoOnly || liveSlot) ? 'pass' : 'fail';
    step.userId = user.id;
    step.organizationCount = organizationIds.length;
    step.projectCount = projectIds.length;
    step.openAiProviderSlotCount = providerSlots?.length || 0;
    step.providerSlotMaterial = liveSlot ? 'live-encrypted' : usableSlot ? 'demo-placeholder' : 'missing';
    step.durationMs = Date.now() - startedAt;
    pushStep(step);
  } catch (error) {
    blockers.push({
      name: 'pilot data check',
      detail: error instanceof Error ? error.message : 'Supabase pilot data check failed.',
    });
    step.outputTail = error instanceof Error ? error.stack || error.message : String(error);
    step.durationMs = Date.now() - startedAt;
    pushStep(step);
  }
}

async function fetchJson(path) {
  const startedAt = Date.now();
  const url = `${enterpriseUrl}${path}`;
  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
      },
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return {
      url,
      status: response.status,
      ok: response.ok,
      body,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      url,
      status: null,
      ok: false,
      body: null,
      error: error instanceof Error ? error.message : 'request failed',
      durationMs: Date.now() - startedAt,
    };
  }
}

function requireDocContains(file, text) {
  if (!existsSync(file)) {
    blockers.push({ name: 'required first-goal file missing', detail: file });
    return;
  }
  const content = readFileSync(file, 'utf8');
  if (!content.includes(text)) {
    blockers.push({ name: 'first-goal doc marker missing', detail: `${file} must contain ${text}` });
  }
}

function bool(value) {
  return value === true ? 'true' : value === false ? 'false' : 'unknown';
}

async function discoverPublicSupabaseConfig() {
  const envUrl = (process.env.SUPABASE_URL || '').trim();
  const envAnonKey = (process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
  if (envUrl && envAnonKey) {
    return { supabaseUrl: envUrl, supabaseAnonKey: envAnonKey, source: 'env' };
  }

  try {
    const response = await fetch(`${enterpriseUrl}/app/enterprise-login.js`, {
      headers: { accept: 'application/javascript,text/plain,*/*' },
    });
    const script = await response.text();
    if (!response.ok) return null;
    const scriptUrl = script.match(/const SUPABASE_URL = ["']([^"']+)["']/)?.[1] || '';
    const scriptAnonKey = script.match(/const SUPABASE_ANON_KEY = ["']([^"']+)["']/)?.[1] || '';
    if (!scriptUrl || !scriptAnonKey) return null;
    if (envUrl && scriptUrl !== envUrl) {
      warnings.push({
        name: 'public Supabase config mismatch',
        detail: 'Live login script Supabase URL differs from SUPABASE_URL; using live login script only for browser-session generation.',
      });
    }
    return { supabaseUrl: scriptUrl, supabaseAnonKey: scriptAnonKey, source: 'live-login-script' };
  } catch (error) {
    warnings.push({
      name: 'public Supabase config discovery',
      detail: error instanceof Error ? error.message : 'failed to fetch enterprise login script',
    });
    return null;
  }
}

async function maybeGeneratePilotAccessToken() {
  const startedAt = Date.now();
  const step = {
    name: 'Generate pilot test session',
    command: `Supabase magic-link session for ${pilotEmail}`,
    status: 'skipped',
    durationMs: 0,
  };

  if (accessToken) {
    step.reason = 'ENTERPRISE_TEST_ACCESS_TOKEN or ACCESS_TOKEN was provided.';
    step.durationMs = Date.now() - startedAt;
    pushStep(step);
    return;
  }

  if (!generateSupabaseTestSession) {
    step.reason = 'GENERATE_SUPABASE_TEST_SESSION=false.';
    step.durationMs = Date.now() - startedAt;
    pushStep(step);
    return;
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    step.status = 'fail';
    step.outputTail = 'SUPABASE_SERVICE_ROLE_KEY is required to generate a pilot test session.';
    step.durationMs = Date.now() - startedAt;
    blockers.push({
      name: 'pilot test session',
      detail: step.outputTail,
    });
    pushStep(step);
    return;
  }

  const publicConfig = await discoverPublicSupabaseConfig();
  if (!publicConfig?.supabaseUrl || !publicConfig?.supabaseAnonKey) {
    step.status = 'fail';
    step.outputTail = 'Could not discover public Supabase URL and anon key for browser-session generation.';
    step.durationMs = Date.now() - startedAt;
    blockers.push({
      name: 'pilot test session',
      detail: step.outputTail,
    });
    pushStep(step);
    return;
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const admin = createClient(publicConfig.supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const anon = createClient(publicConfig.supabaseUrl, publicConfig.supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: pilotEmail,
    });
    if (linkError) throw linkError;

    const emailOtp = linkData?.properties?.email_otp || '';
    const tokenHash = linkData?.properties?.hashed_token || '';
    if (!emailOtp && !tokenHash) {
      throw new Error('Supabase did not return an email OTP or hashed token for the generated magic link.');
    }

    const verifyArgs = emailOtp
      ? { email: pilotEmail, token: emailOtp, type: 'magiclink' }
      : { token_hash: tokenHash, type: 'magiclink' };
    const { data: verifyData, error: verifyError } = await anon.auth.verifyOtp(verifyArgs);
    if (verifyError) throw verifyError;

    accessToken = verifyData?.session?.access_token || '';
    if (!accessToken) {
      throw new Error('Supabase OTP verification did not return an access token.');
    }

    step.status = 'pass';
    step.publicConfigSource = publicConfig.source;
    step.userEmail = verifyData?.user?.email || pilotEmail;
    step.durationMs = Date.now() - startedAt;
    pushStep(step);
  } catch (error) {
    step.status = 'fail';
    step.outputTail = error instanceof Error ? error.message : 'failed to generate pilot test session';
    step.durationMs = Date.now() - startedAt;
    blockers.push({
      name: 'pilot test session',
      detail: step.outputTail,
    });
    pushStep(step);
  }
}

requireDocContains('docs/enterprise/gcp-first-goal-test-plan.md', 'Goal 1: Testable Paid Pilot');
requireDocContains('docs/enterprise/gcp-build-status.md', 'Goal 1');
requireDocContains('docs/enterprise/gcp-full-buildout-plan.md', 'Goal 1');

if (runLocalChecks) {
  runStep('Enterprise build', 'npm', ['run', 'build:enterprise']);
  runStep('Enterprise smoke', 'npm', ['run', 'test:enterprise-smoke']);
  runStep('GCP launch gate syntax', 'node', ['--check', 'scripts/run-gcp-customer-launch-gate.mjs']);
  runStep('GCP first-goal gate syntax', 'node', ['--check', 'scripts/run-gcp-first-goal-gate.mjs']);
} else {
  warnings.push({ name: 'local checks skipped', detail: 'SKIP_LOCAL_CHECKS=true' });
}

if (runLiveEdge) {
  runStep('GCP live edge verifier', 'npm', ['run', 'verify:gcp-enterprise-edge']);
} else {
  warnings.push({ name: 'live edge skipped', detail: 'SKIP_LIVE_EDGE=true' });
}

const health = await fetchJson('/health');
pushStep({
  name: 'Live /health',
  command: `GET ${health.url}`,
  status: health.ok && health.body?.status === 'ok' ? 'pass' : 'fail',
  durationMs: health.durationMs,
  statusCode: health.status,
});
if (!health.ok || health.body?.status !== 'ok') {
  blockers.push({
    name: 'live health',
    detail: JSON.stringify({ status: health.status, body: health.body, error: health.error }),
  });
}

const readiness = await fetchJson('/readiness');
const readinessBody = readiness.body && typeof readiness.body === 'object' ? readiness.body : {};
pushStep({
  name: 'Live /readiness',
  command: `GET ${readiness.url}`,
  status: readiness.ok ? 'pass' : 'fail',
  durationMs: readiness.durationMs,
  statusCode: readiness.status,
  productionReady: bool(readinessBody.production_ready),
  securityProfile: readinessBody.security_profile || 'unknown',
});
if (!readiness.ok) {
  blockers.push({
    name: 'live readiness',
    detail: JSON.stringify({ status: readiness.status, body: readiness.body, error: readiness.error }),
  });
}

const controlPlane = readinessBody.control_plane || {};
const executor = readinessBody.executor?.health || {};
const readinessBlockers = Array.isArray(readinessBody.production_blockers)
  ? readinessBody.production_blockers.map((item) => String(item)).filter(Boolean)
  : [];

if (readiness.ok && readinessBody.production_ready !== true) {
  blockers.push({
    name: 'production readiness',
    detail: readinessBlockers.length ? readinessBlockers.join('; ') : 'readiness did not report production_ready=true',
  });
}
if (readiness.ok && readinessBody.security_profile !== expectedSecurityProfile) {
  blockers.push({
    name: 'security profile',
    detail: `expected ${expectedSecurityProfile}, got ${readinessBody.security_profile || 'unknown'}`,
  });
}
if (readiness.ok && controlPlane.supabase_configured !== true) {
  blockers.push({ name: 'Supabase runtime data', detail: 'control plane does not have Supabase service-role credentials loaded' });
}
if (readiness.ok && controlPlane.origin_lock_configured !== true) {
  blockers.push({ name: 'origin lock configured', detail: 'control plane does not have the origin-lock secret loaded' });
}
if (readiness.ok && controlPlane.origin_lock_required !== true) {
  blockers.push({ name: 'origin lock required', detail: 'ENTERPRISE_REQUIRE_ORIGIN_LOCK is not enabled in the control-plane env' });
}
if (readiness.ok && executor.secure_execution_ready !== true) {
  blockers.push({ name: 'secure executor ready', detail: 'executor secure_execution_ready is not true' });
}
if (readiness.ok && executor.execution_material_resolver_ready !== true) {
  blockers.push({ name: 'executor material resolver', detail: 'executor material resolver is not ready' });
}
if (readiness.ok && executor.key_release_mode !== 'gcp-cloud-kms') {
  blockers.push({ name: 'GCP KMS key release', detail: `expected gcp-cloud-kms, got ${executor.key_release_mode || 'unknown'}` });
}
if (readiness.ok && executor.attestation_evidence_ready !== true) {
  blockers.push({ name: 'GCP attestation evidence', detail: 'executor attestation_evidence_ready is not true' });
}

await checkPilotData();
await maybeGeneratePilotAccessToken();

if (accessToken) {
  runStep('Enterprise dry execute', 'node', ['scripts/enterprise-live-execute-test.mjs'], {
    input: accessToken,
    env: {
      EXECUTE_DRY_RUN: 'true',
      ENTERPRISE_API_BASE: `${enterpriseUrl}/api/v1/enterprise`,
    },
  });
} else {
  blockers.push({
    name: 'enterprise dry execute',
    detail: 'Set ENTERPRISE_TEST_ACCESS_TOKEN or ACCESS_TOKEN so the gate can prove the control plane -> executor -> policy -> audit path.',
  });
  pushStep({
    name: 'Enterprise dry execute',
    command: 'node scripts/enterprise-live-execute-test.mjs',
    status: 'fail',
    durationMs: 0,
    outputTail: 'Missing ENTERPRISE_TEST_ACCESS_TOKEN or ACCESS_TOKEN.',
  });
}

if (allowDegradedDashboard && readiness.ok && health.ok) {
  warnings.push({
    name: 'degraded dashboard testing allowed',
    detail: 'ALLOW_DEGRADED_DASHBOARD=true; dashboard/edge can be tested before production readiness is complete.',
  });
}

const result = {
  status: blockers.length === 0 ? 'done' : 'blocked',
  goal: 'Goal 1: Testable Paid Pilot',
  enterpriseUrl,
  expectedSecurityProfile,
  options: {
    runLocalChecks,
    runLiveEdge,
    allowDegradedDashboard,
    demoOnly,
    pilotEmail,
    dryExecuteTokenProvided: Boolean(providedAccessToken),
    generatedSupabaseTestSession: Boolean(accessToken && !providedAccessToken),
  },
  live: {
    health: {
      status: health.status,
      ok: health.ok,
      body: health.body,
    },
    readiness: {
      status: readiness.status,
      ok: readiness.ok,
      production_ready: readinessBody.production_ready === true,
      security_profile: readinessBody.security_profile || null,
      production_blockers: readinessBlockers,
      control_plane: controlPlane,
      executor_health: executor,
    },
  },
  steps,
  warnings,
  blockers,
};

console.log(JSON.stringify(result, null, 2));

if (blockers.length > 0) {
  process.exit(1);
}
