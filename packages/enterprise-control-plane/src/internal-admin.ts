import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import { isOrganizationRole, type OrganizationRole } from '@vaultproof/core';
import type { EnterpriseControlPlaneEnv } from './config.js';
import { authenticateUser, type EnterpriseUserAuth } from './auth.js';
import { getSupabase } from './supabase.js';

const INTERNAL_AUTH_ERROR = 'VaultProof employee access required. Sign in with an approved employee account.';
const INTERNAL_ADMIN_SESSION_COOKIE = 'vp_internal_admin_session';
const INTERNAL_ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;
const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'yahoo.com',
  'proton.me',
  'protonmail.com',
  'aol.com',
]);

type MaybeArray<T> = T | T[] | null | undefined;

interface InternalAdminAuthResult {
  auth: EnterpriseUserAuth;
  allowedEmails: string[];
  allowedDomains: string[];
}

interface InternalAdminAuditEventRow {
  id: string;
  actor_user_id: string | null;
  actor_email: string;
  event_type: string;
  target_type: string;
  target_id: string | null;
  request_method: string | null;
  request_path: string | null;
  request_host: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface InternalAdminSupportNoteRow {
  id: string;
  organization_id: string | null;
  note_type: string;
  body: string;
  created_by_user_id: string | null;
  created_by_email: string;
  created_at: string;
}

interface InternalAdminBusinessStatusRow {
  id: string;
  organization_id: string;
  status: 'onboarding' | 'active' | 'at_risk' | 'paused' | 'offboarding';
  plan_label: string | null;
  summary: string;
  next_step: string | null;
  created_by_user_id: string | null;
  created_by_email: string;
  created_at: string;
}

interface InternalAdminActionRequestRow {
  id: string;
  organization_id: string | null;
  action_type: 'disable_org_access';
  risk_level: 'medium' | 'high' | 'critical';
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'cancelled';
  reason: string;
  requested_payload: Record<string, unknown> | null;
  requested_by_user_id: string | null;
  requested_by_email: string;
  approved_by_user_id: string | null;
  approved_by_email: string | null;
  approved_at: string | null;
  rejected_by_user_id: string | null;
  rejected_by_email: string | null;
  rejected_at: string | null;
  executed_by_user_id: string | null;
  executed_by_email: string | null;
  executed_at: string | null;
  decision_note: string | null;
  created_at: string;
  updated_at: string | null;
}

interface InternalAdminActionExecutionRecordRow {
  id: string;
  action_request_id: string;
  organization_id: string | null;
  action_type: 'disable_org_access';
  execution_mode: 'dry_run' | 'live';
  status: 'planned' | 'executed' | 'rolled_back' | 'failed';
  execution_enabled: boolean;
  preflight_result: Record<string, unknown> | null;
  rollback_payload: Record<string, unknown> | null;
  executed_by_user_id: string | null;
  executed_by_email: string;
  executed_at: string | null;
  created_at: string;
}

function csvList(value?: string): string[] {
  return (value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeRows<T>(rows: MaybeArray<T>): T[] {
  if (!rows) return [];
  return Array.isArray(rows) ? rows : [rows];
}

function emailDomain(email: string): string {
  return email.trim().toLowerCase().split('@').pop() || '';
}

function truncateForAudit(value: string | null, maxLength = 160): string | null {
  if (!value) return null;
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function secureStringEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function isAllowedInternalAdminEmail(email: string, env: EnterpriseControlPlaneEnv): {
  ok: boolean;
  allowedEmails: string[];
  allowedDomains: string[];
} {
  const normalizedEmail = email.trim().toLowerCase();
  const allowedEmails = csvList(env.internalAdminAllowedEmails);
  const allowedDomains = csvList(env.internalAdminAllowedDomains)
    .filter((domain) => !PUBLIC_EMAIL_DOMAINS.has(domain));
  const domain = emailDomain(normalizedEmail);

  return {
    ok: allowedEmails.includes(normalizedEmail) || (domain ? allowedDomains.includes(domain) : false),
    allowedEmails,
    allowedDomains,
  };
}

export async function authorizeInternalAdmin(
  request: Request,
  env: EnterpriseControlPlaneEnv,
): Promise<InternalAdminAuthResult | Response> {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    return Response.json({ error: 'Internal admin API is not configured.' }, { status: 501 });
  }

  const auth = await authenticateUser(request, env);
  if (!auth) {
    return Response.json({ error: INTERNAL_AUTH_ERROR }, { status: 401 });
  }

  const allowed = isAllowedInternalAdminEmail(auth.email, env);
  if (!allowed.ok) {
    return Response.json({
      error: 'This account is not allowed to use the VaultProof internal admin console.',
    }, { status: 403 });
  }

  return {
    auth,
    allowedEmails: allowed.allowedEmails,
    allowedDomains: allowed.allowedDomains,
  };
}

function internalAdminSessionCookie(token: string): string {
  return [
    `${INTERNAL_ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${INTERNAL_ADMIN_SESSION_MAX_AGE_SECONDS}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ].join('; ');
}

export function clearInternalAdminSessionCookie(): string {
  return [
    `${INTERNAL_ADMIN_SESSION_COOKIE}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ].join('; ');
}

async function handleInternalAdminSession(
  request: Request,
  env: EnterpriseControlPlaneEnv,
): Promise<Response> {
  if (request.method === 'DELETE') {
    return Response.json({ ok: true }, {
      headers: {
        'cache-control': 'no-store',
        'set-cookie': clearInternalAdminSessionCookie(),
      },
    });
  }

  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed.' }, { status: 405 });
  }

  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    return Response.json({ error: INTERNAL_AUTH_ERROR }, { status: 401 });
  }

  const authorized = await authorizeInternalAdmin(request, env);
  if (authorized instanceof Response) return authorized;

  await writeInternalAdminAuditEvent(
    env,
    authorized.auth,
    request,
    'internal_admin_session_started',
    {
      allowed_emails_configured: authorized.allowedEmails.length,
      allowed_domains_configured: authorized.allowedDomains.length,
    },
  );

  return Response.json({
    ok: true,
    email: authorized.auth.email,
    expires_in: INTERNAL_ADMIN_SESSION_MAX_AGE_SECONDS,
  }, {
    headers: {
      'cache-control': 'no-store',
      'set-cookie': internalAdminSessionCookie(token),
    },
  });
}

async function getUserEmailMap(
  env: EnterpriseControlPlaneEnv,
  userIds: string[],
): Promise<Map<string, string | null>> {
  const supabase = getSupabase(env);
  const uniqueIds = [...new Set(userIds.filter(Boolean))].slice(0, 25);
  const results = await Promise.all(uniqueIds.map(async (userId) => {
    try {
      const { data, error } = await supabase.auth.admin.getUserById(userId);
      if (error) return [userId, null] as const;
      return [userId, data.user?.email || null] as const;
    } catch {
      return [userId, null] as const;
    }
  }));

  return new Map(results);
}

function buildInternalAdminAuditRow(
  request: Request,
  auth: EnterpriseUserAuth,
  eventType: string,
  metadata: Record<string, unknown> = {},
): Omit<InternalAdminAuditEventRow, 'id' | 'created_at'> {
  const url = new URL(request.url);
  const headers = request.headers;

  return {
    actor_user_id: auth.userId,
    actor_email: auth.email,
    event_type: eventType,
    target_type: 'internal_admin',
    target_id: url.pathname,
    request_method: request.method,
    request_path: url.pathname,
    request_host: url.host,
    metadata: {
      ...metadata,
      query_keys: [...url.searchParams.keys()].slice(0, 12),
      user_agent: truncateForAudit(headers.get('user-agent')),
      forwarded_host: truncateForAudit(headers.get('x-forwarded-host') || headers.get('host')),
      source_ip_header_present: Boolean(
        headers.get('x-forwarded-for')
          || headers.get('x-real-ip')
          || headers.get('cf-connecting-ip')
          || headers.get('true-client-ip'),
      ),
    },
  };
}

async function writeInternalAdminAuditEvent(
  env: EnterpriseControlPlaneEnv,
  auth: EnterpriseUserAuth,
  request: Request,
  eventType: string,
  metadata: Record<string, unknown> = {},
): Promise<boolean> {
  try {
    const { error } = await getSupabase(env)
      .from('internal_admin_audit_events')
      .insert(buildInternalAdminAuditRow(request, auth, eventType, metadata));
    if (error) {
      console.warn(`internal admin audit insert skipped: ${error.message}`);
      return false;
    }
    return true;
  } catch (error) {
    console.warn(`internal admin audit insert failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

function requireInternalAdminActionApproval(
  request: Request,
  env: EnterpriseControlPlaneEnv,
): Response | null {
  if (env.internalAdminActionsEnabled !== true) {
    return Response.json({
      error: 'Internal admin write actions are disabled.',
    }, { status: 403 });
  }

  const expectedSecret = env.internalAdminApprovalSecret?.trim();
  if (!expectedSecret) {
    return Response.json({
      error: 'Internal admin approval secret is not configured.',
    }, { status: 501 });
  }

  const actualSecret = request.headers.get('x-vaultproof-internal-admin-approval') || '';
  if (!secureStringEquals(actualSecret, expectedSecret)) {
    return Response.json({
      error: 'Internal admin approval header is missing or invalid.',
    }, { status: 403 });
  }

  return null;
}

function validateInternalInvitationRole(value: unknown): OrganizationRole | null {
  if (isOrganizationRole(value)) return value;
  return null;
}

function validateBusinessStatus(value: unknown): InternalAdminBusinessStatusRow['status'] | null {
  if (
    value === 'onboarding'
    || value === 'active'
    || value === 'at_risk'
    || value === 'paused'
    || value === 'offboarding'
  ) {
    return value;
  }
  return null;
}

function validateInternalAdminActionType(value: unknown): InternalAdminActionRequestRow['action_type'] | null {
  return value === 'disable_org_access' ? value : null;
}

async function getRecentInternalAdminAudit(
  env: EnterpriseControlPlaneEnv,
): Promise<InternalAdminAuditEventRow[]> {
  try {
    const { data, error } = await getSupabase(env)
      .from('internal_admin_audit_events')
      .select('id, actor_user_id, actor_email, event_type, target_type, target_id, request_method, request_path, request_host, metadata, created_at')
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) {
      console.warn(`internal admin audit read skipped: ${error.message}`);
      return [];
    }
    return normalizeRows(data as MaybeArray<InternalAdminAuditEventRow>);
  } catch (error) {
    console.warn(`internal admin audit read failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

async function getInternalAdminSupportNotes(
  env: EnterpriseControlPlaneEnv,
  organizationId: string,
): Promise<{
  rows: InternalAdminSupportNoteRow[];
  schemaReady: boolean;
}> {
  try {
    const { data, error } = await getSupabase(env)
      .from('internal_admin_support_notes')
      .select('id, organization_id, note_type, body, created_by_user_id, created_by_email, created_at')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) {
      console.warn(`internal admin support notes read skipped: ${error.message}`);
      return { rows: [], schemaReady: false };
    }
    return {
      rows: normalizeRows(data as MaybeArray<InternalAdminSupportNoteRow>),
      schemaReady: true,
    };
  } catch (error) {
    console.warn(`internal admin support notes read failed: ${error instanceof Error ? error.message : String(error)}`);
    return { rows: [], schemaReady: false };
  }
}

async function getInternalAdminBusinessStatus(
  env: EnterpriseControlPlaneEnv,
  organizationId: string,
): Promise<{
  rows: InternalAdminBusinessStatusRow[];
  schemaReady: boolean;
}> {
  try {
    const { data, error } = await getSupabase(env)
      .from('internal_admin_business_status_updates')
      .select('id, organization_id, status, plan_label, summary, next_step, created_by_user_id, created_by_email, created_at')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(10);
    if (error) {
      console.warn(`internal admin business status read skipped: ${error.message}`);
      return { rows: [], schemaReady: false };
    }
    return {
      rows: normalizeRows(data as MaybeArray<InternalAdminBusinessStatusRow>),
      schemaReady: true,
    };
  } catch (error) {
    console.warn(`internal admin business status read failed: ${error instanceof Error ? error.message : String(error)}`);
    return { rows: [], schemaReady: false };
  }
}

async function getInternalAdminActionRequests(
  env: EnterpriseControlPlaneEnv,
  organizationId: string,
): Promise<{
  rows: InternalAdminActionRequestRow[];
  schemaReady: boolean;
}> {
  try {
    const { data, error } = await getSupabase(env)
      .from('internal_admin_action_requests')
      .select('id, organization_id, action_type, risk_level, status, reason, requested_payload, requested_by_user_id, requested_by_email, approved_by_user_id, approved_by_email, approved_at, rejected_by_user_id, rejected_by_email, rejected_at, executed_by_user_id, executed_by_email, executed_at, decision_note, created_at, updated_at')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) {
      console.warn(`internal admin action requests read skipped: ${error.message}`);
      return { rows: [], schemaReady: false };
    }
    return {
      rows: normalizeRows(data as MaybeArray<InternalAdminActionRequestRow>),
      schemaReady: true,
    };
  } catch (error) {
    console.warn(`internal admin action requests read failed: ${error instanceof Error ? error.message : String(error)}`);
    return { rows: [], schemaReady: false };
  }
}

async function getInternalAdminActionExecutionRecords(
  env: EnterpriseControlPlaneEnv,
  organizationId: string,
): Promise<{
  rows: InternalAdminActionExecutionRecordRow[];
  schemaReady: boolean;
}> {
  try {
    const { data, error } = await getSupabase(env)
      .from('internal_admin_action_execution_records')
      .select('id, action_request_id, organization_id, action_type, execution_mode, status, execution_enabled, preflight_result, rollback_payload, executed_by_user_id, executed_by_email, executed_at, created_at')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) {
      console.warn(`internal admin action execution records read skipped: ${error.message}`);
      return { rows: [], schemaReady: false };
    }
    return {
      rows: normalizeRows(data as MaybeArray<InternalAdminActionExecutionRecordRow>),
      schemaReady: true,
    };
  } catch (error) {
    console.warn(`internal admin action execution records read failed: ${error instanceof Error ? error.message : String(error)}`);
    return { rows: [], schemaReady: false };
  }
}

function buildSsoChecklist(sso: {
  company_domain: string | null;
  sso_provider: string | null;
  login_mode: string | null;
  status: string | null;
} | null): Array<{
  label: string;
  status: 'done' | 'todo';
  detail: string;
}> {
  return [{
    label: 'Confirm company domain',
    status: sso?.company_domain ? 'done' : 'todo',
    detail: sso?.company_domain || 'Add the customer-owned email domain.',
  }, {
    label: 'Choose identity provider',
    status: sso?.sso_provider ? 'done' : 'todo',
    detail: sso?.sso_provider || 'Expected path is Microsoft Entra ID through the Supabase SAML broker.',
  }, {
    label: 'Set login mode',
    status: sso?.login_mode ? 'done' : 'todo',
    detail: sso?.login_mode || 'Choose SSO-first, optional SSO, or migration mode.',
  }, {
    label: 'Verify rollout status',
    status: sso?.status === 'configured' ? 'done' : 'todo',
    detail: sso?.status || 'Wait for metadata exchange, test login, and customer sign-off.',
  }];
}

function enterpriseEvidenceLinks(env: EnterpriseControlPlaneEnv, organizationId: string): Array<{
  label: string;
  href: string;
}> {
  const host = env.enterpriseHostname || 'enterprise.vaultproof.dev';
  const base = `https://${host}`;
  const org = encodeURIComponent(organizationId);
  return [{
    label: 'Audit timeline',
    href: `${base}/app/audit?organization_id=${org}`,
  }, {
    label: 'Members and access review',
    href: `${base}/app/members?organization_id=${org}`,
  }, {
    label: 'Projects',
    href: `${base}/app/projects?organization_id=${org}`,
  }, {
    label: 'Production readiness',
    href: `${base}/readiness`,
  }];
}

export function renderInternalAdminPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>VaultProof Internal Admin</title>
  <style>
    :root { color-scheme: dark; --bg:#070b10; --panel:rgba(235,241,255,.08); --panel-strong:rgba(235,241,255,.13); --line:rgba(235,241,255,.16); --text:#eef4ff; --muted:#a9b6c8; --gold:#d7a84b; --blue:#8ec5ff; --green:#72e3b5; --red:#fb7185; --ink:#07110f; }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color:var(--text); background: radial-gradient(circle at 12% 10%, rgba(142,197,255,.22), transparent 28rem), radial-gradient(circle at 88% 0%, rgba(215,168,75,.16), transparent 30rem), linear-gradient(135deg, #060a10, #111827 52%, #050807); }
    a { color: inherit; text-decoration: none; }
    .shell { display:grid; grid-template-columns:280px 1fr; min-height:100vh; }
    .sidebar { border-right:1px solid var(--line); background:rgba(2,6,12,.72); padding:28px 20px; position:sticky; top:0; height:100vh; }
    .brand { display:flex; gap:12px; align-items:center; margin-bottom:28px; }
    .mark { width:38px; height:38px; border-radius:14px; display:grid; place-items:center; background:linear-gradient(135deg, var(--blue), #e9f5ff); color:#08111f; font-weight:900; }
    .brand-title { font-weight:850; letter-spacing:-.03em; }
    .brand-sub { color:var(--muted); font-size:12px; margin-top:2px; }
    .nav-label { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.12em; margin:22px 0 9px 10px; }
    .nav-link { display:flex; justify-content:space-between; padding:11px 12px; border-radius:14px; color:#dce8f9; border:1px solid transparent; margin-bottom:4px; }
    .nav-link:hover, .nav-link.active { background:var(--panel); border-color:var(--line); }
    .sidebar-note { margin-top:24px; border:1px solid var(--line); border-radius:18px; padding:14px; color:var(--muted); background:rgba(235,241,255,.06); font-size:12px; line-height:1.45; }
    .main { padding:30px; max-width:1400px; width:100%; }
    .topbar { display:flex; justify-content:space-between; gap:18px; align-items:flex-start; margin-bottom:22px; }
    .eyebrow { color:var(--blue); font-size:12px; font-weight:850; text-transform:uppercase; letter-spacing:.16em; }
    h1 { margin:8px 0 10px; font-size:clamp(38px, 5vw, 70px); line-height:.92; letter-spacing:-.07em; }
    .lead { color:var(--muted); max-width:780px; line-height:1.6; }
    button, select { border:1px solid var(--line); background:rgba(235,241,255,.08); color:var(--text); border-radius:13px; padding:11px 12px; font:inherit; }
    button { cursor:pointer; }
    .primary { background:linear-gradient(135deg, var(--blue), #e9f5ff); color:#08111f; border:0; font-weight:850; }
    .toolbar { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:10px; }
    .grid { display:grid; gap:16px; }
    .kpis { grid-template-columns:repeat(5, minmax(0,1fr)); margin-bottom:16px; }
    .two { grid-template-columns:minmax(0,1fr) minmax(360px,.8fr); }
    .card { border:1px solid var(--line); border-radius:24px; padding:20px; background:linear-gradient(180deg, var(--panel-strong), rgba(235,241,255,.05)); box-shadow:0 22px 90px rgba(0,0,0,.22); }
    .kpi-label { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.1em; }
    .kpi-value { font-size:34px; font-weight:850; letter-spacing:-.05em; margin-top:8px; }
    .kpi-sub { color:var(--muted); font-size:13px; margin-top:6px; }
    .section-title { display:flex; justify-content:space-between; gap:12px; align-items:center; margin-bottom:14px; }
    .section-title h2 { margin:0; font-size:20px; letter-spacing:-.03em; }
    .mini { color:var(--muted); font-size:13px; }
    .list { display:grid; gap:10px; }
    .row { display:grid; grid-template-columns:1fr auto; gap:14px; align-items:start; border:1px solid rgba(235,241,255,.1); border-radius:17px; padding:14px; background:rgba(2,6,12,.3); }
    .row-title { font-weight:780; letter-spacing:-.02em; }
    .row-sub { color:var(--muted); font-size:13px; margin-top:5px; line-height:1.45; }
    .tag { display:inline-block; color:var(--blue); border:1px solid rgba(142,197,255,.24); border-radius:999px; padding:5px 8px; font-size:12px; margin:3px 4px 0 0; white-space:nowrap; }
    .tag.good { color:var(--green); border-color:rgba(114,227,181,.24); }
    .tag.warn { color:var(--gold); border-color:rgba(215,168,75,.28); }
    .tag.bad { color:var(--red); border-color:rgba(251,113,133,.28); }
    .notice, .empty { color:var(--muted); border:1px dashed rgba(235,241,255,.22); border-radius:18px; padding:18px; background:rgba(2,6,12,.24); }
    .notice.error { color:var(--red); border-color:rgba(251,113,133,.3); }
    .actions { display:flex; gap:10px; flex-wrap:wrap; margin-top:14px; }
    .action { border:1px solid var(--line); border-radius:14px; padding:10px 12px; background:rgba(235,241,255,.07); }
    @media (max-width: 1050px) { .shell { grid-template-columns:1fr; } .sidebar { position:relative; height:auto; } .topbar { flex-direction:column; } .toolbar { justify-content:flex-start; } .kpis, .two { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><div class="mark">VP</div><div><div class="brand-title">VaultProof Internal</div><div class="brand-sub">employee admin console</div></div></div>
      <div class="nav-label">manage</div>
      <a class="nav-link active" href="#businesses"><span>Businesses</span><span class="tag">read</span></a>
      <a class="nav-link" href="#users"><span>Users</span></a>
      <a class="nav-link" href="#sso"><span>SSO</span></a>
      <a class="nav-link" href="#support"><span>Support</span></a>
      <a class="nav-link" href="#org-detail"><span>Org detail</span></a>
      <div class="nav-label">proof</div>
      <a class="nav-link" href="#runtime"><span>Runtime</span></a>
      <a class="nav-link" href="#audit"><span>Audit</span></a>
      <div class="sidebar-note"><strong>Safe first slice</strong><br />This console is read-only. Employee access is audited; write actions still need approval gates and break-glass rules.</div>
    </aside>
    <main class="main">
      <div class="topbar">
        <div>
          <div class="eyebrow">VaultProof employees only</div>
          <h1>Manage businesses safely.</h1>
          <p class="lead">See customer organizations, owners, users, projects, SSO rollout, readiness, and support signals without entering the customer-facing dashboard.</p>
        </div>
        <div class="toolbar">
          <button id="refreshBtn" class="primary" type="button">refresh</button>
          <a class="action" href="/app/login?internal_admin=true">employee sign in</a>
        </div>
      </div>

      <div id="notice" class="notice error" style="display:none"></div>

      <section class="grid kpis" id="runtime">
        <div class="card"><div class="kpi-label">businesses</div><div id="kpiBusinesses" class="kpi-value">...</div><div class="kpi-sub">active team orgs</div></div>
        <div class="card"><div class="kpi-label">users</div><div id="kpiUsers" class="kpi-value">...</div><div class="kpi-sub">org memberships</div></div>
        <div class="card"><div class="kpi-label">projects</div><div id="kpiProjects" class="kpi-value">...</div><div class="kpi-sub">active customer scopes</div></div>
        <div class="card"><div class="kpi-label">pending invites</div><div id="kpiInvites" class="kpi-value">...</div><div class="kpi-sub">need follow-up</div></div>
        <div class="card"><div class="kpi-label">SSO configured</div><div id="kpiSso" class="kpi-value">...</div><div class="kpi-sub">team orgs</div></div>
      </section>

      <section class="grid two">
        <div class="card" id="businesses">
          <div class="section-title"><h2>Businesses</h2><span id="businessMeta" class="mini"></span></div>
          <div id="businessList" class="list"><div class="empty">Loading businesses...</div></div>
        </div>
        <div class="card" id="support">
          <div class="section-title"><h2>Support queue</h2><span class="mini">safe triage</span></div>
          <div id="supportList" class="list"><div class="empty">Loading support signals...</div></div>
        </div>
      </section>

      <section class="grid two" style="margin-top:16px">
        <div class="card" id="users">
          <div class="section-title"><h2>Users and access</h2><span id="userMeta" class="mini"></span></div>
          <div id="userList" class="list"><div class="empty">Loading users...</div></div>
        </div>
        <div class="card" id="sso">
          <div class="section-title"><h2>SSO rollout</h2><span id="ssoMeta" class="mini"></span></div>
          <div id="ssoList" class="list"><div class="empty">Loading SSO status...</div></div>
        </div>
      </section>

      <section class="card" id="org-detail" style="margin-top:16px; display:none">
        <div class="section-title"><h2>Business detail</h2><span id="orgDetailMeta" class="mini">read-only</span></div>
        <div id="orgDetailContent" class="list"><div class="empty">Open a business to view member timeline, SSO checklist, support notes, and evidence links.</div></div>
      </section>

      <section class="card" id="audit" style="margin-top:16px">
        <div class="section-title"><h2>Recent customer audit</h2><span class="mini">latest governance/runtime signals</span></div>
        <div id="auditList" class="list"><div class="empty">Loading audit...</div></div>
      </section>

      <section class="card" id="internal-audit" style="margin-top:16px">
        <div class="section-title"><h2>Internal admin audit</h2><span class="mini">VaultProof employee access trail</span></div>
        <div id="internalAuditList" class="list"><div class="empty">Loading internal admin audit...</div></div>
      </section>
    </main>
  </div>
  <script>
    (function() {
      var token = localStorage.getItem('vaultproof_token') || '';
      function byId(id) { return document.getElementById(id); }
      function text(id, value) { var el = byId(id); if (el) el.textContent = value == null ? '' : String(value); }
      function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
      }
      function number(value) { var n = Number(value || 0); return Number.isFinite(n) ? n.toLocaleString() : '0'; }
      function rel(value) {
        if (!value) return 'never';
        var diff = Date.now() - new Date(value).getTime();
        if (!Number.isFinite(diff)) return String(value);
        var mins = Math.max(0, Math.round(diff / 60000));
        if (mins < 60) return mins + 'm ago';
        var hours = Math.round(mins / 60);
        if (hours < 48) return hours + 'h ago';
        return Math.round(hours / 24) + 'd ago';
      }
      function notice(message) {
        var el = byId('notice');
        if (!el) return;
        el.style.display = message ? 'block' : 'none';
        el.innerHTML = message ? escapeHtml(message) + ' <a href="/app/login?internal_admin=true">Employee sign in</a>' : '';
      }
      async function fetchOverview() {
        var response = await fetch('/api/v1/internal-admin/overview', {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json'
          }
        });
        var payload = await response.json().catch(function() { return null; });
        if (!response.ok) throw new Error((payload && payload.error) || 'Internal admin overview failed.');
        return payload;
      }
      function row(title, sub, tag, tone, href, linkLabel) {
        var side = '<span class="tag ' + (tone || '') + '">' + escapeHtml(tag || '') + '</span>';
        if (href) side += '<a class="tag" href="' + escapeHtml(href) + '">' + escapeHtml(linkLabel || 'open') + '</a>';
        return '<div class="row"><div><div class="row-title">' + escapeHtml(title) + '</div><div class="row-sub">' + escapeHtml(sub || '') + '</div></div><div>' + side + '</div></div>';
      }
      function selectedOrgId() {
        var match = window.location.pathname.match(/\\/orgs\\/([^/]+)/);
        return match ? decodeURIComponent(match[1]) : '';
      }
      async function fetchOrgDetail(orgId) {
        var response = await fetch('/api/v1/internal-admin/orgs/' + encodeURIComponent(orgId), {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json'
          }
        });
        var payload = await response.json().catch(function() { return null; });
        if (!response.ok) throw new Error((payload && payload.error) || 'Internal admin org detail failed.');
        return payload;
      }
      function tagList(items) {
        return (items || []).map(function(item) {
          var tone = item.status === 'done' || item.status === 'ready' ? 'good' : 'warn';
          return '<span class="tag ' + tone + '">' + escapeHtml(item.label || item.status || item) + '</span>';
        }).join('');
      }
      function renderOrgDetail(payload) {
        var section = byId('org-detail');
        if (!section) return;
        section.style.display = 'block';
        var org = payload.business || {};
        text('orgDetailMeta', (org.name || org.slug || org.id || 'business') + ' - read-only');
        var ssoChecklist = Array.isArray(payload.sso_checklist) ? payload.sso_checklist : [];
        var timeline = Array.isArray(payload.member_timeline) ? payload.member_timeline : [];
        var supportNotes = Array.isArray(payload.support_notes) ? payload.support_notes : [];
        var evidenceLinks = Array.isArray(payload.evidence_links) ? payload.evidence_links : [];
        var invitations = Array.isArray(payload.invitations) ? payload.invitations : [];
        var pendingInvitations = invitations.filter(function(invite) { return invite.status === 'pending'; });
        var statusUpdates = Array.isArray(payload.business_status_updates) ? payload.business_status_updates : [];
        var currentStatus = statusUpdates[0] || null;
        var actionRequests = Array.isArray(payload.action_requests) ? payload.action_requests : [];
        var executionRecords = Array.isArray(payload.execution_records) ? payload.execution_records : [];
        var html = '';
        html += row(org.name || org.slug || org.id || 'Business', (org.owner_email || 'owner unknown') + ' - ' + number(org.member_count) + ' users - ' + number(org.active_project_count) + ' active projects', org.sso && org.sso.status === 'configured' ? 'SSO ready' : 'SSO todo', org.sso && org.sso.status === 'configured' ? 'good' : 'warn');
        html += '<div class="row"><div><div class="row-title">Business plan and status</div><div class="row-sub">' + (currentStatus ? escapeHtml((currentStatus.plan_label || 'plan not set') + ' - ' + currentStatus.summary + (currentStatus.next_step ? ' - next: ' + currentStatus.next_step : '') + ' - ' + rel(currentStatus.created_at)) : (payload.business_status_schema_ready ? 'No business status has been recorded yet.' : 'Business status table is not applied yet.')) + '</div></div><span class="tag ' + (currentStatus && currentStatus.status === 'active' ? 'good' : 'warn') + '">' + escapeHtml(currentStatus ? currentStatus.status : (payload.business_status_schema_ready ? 'not set' : 'pending')) + '</span></div>';
        html += '<div class="row"><div><div class="row-title">SSO setup checklist</div><div class="row-sub">' + ssoChecklist.map(function(item) { return escapeHtml(item.label + ': ' + item.detail); }).join('<br>') + '</div></div><div>' + tagList(ssoChecklist) + '</div></div>';
        html += '<div class="row"><div><div class="row-title">User/member timeline</div><div class="row-sub">' + (timeline.length ? timeline.slice(0, 8).map(function(item) { return escapeHtml(item.label + ' - ' + (item.detail || '') + ' - ' + rel(item.created_at)); }).join('<br>') : 'No member timeline events yet.') + '</div></div><span class="tag">timeline</span></div>';
        html += '<div class="row"><div><div class="row-title">Pending invitation actions</div><div class="row-sub">' + (pendingInvitations.length ? pendingInvitations.map(function(invite) { return escapeHtml(invite.email + ' as ' + invite.role + ' - API: POST /api/v1/internal-admin/orgs/' + org.id + '/invitations/' + invite.id + '/resend or /revoke'); }).join('<br>') : 'No pending invites for this business.') + '</div></div><span class="tag warn">approval gated</span></div>';
        html += '<div class="row"><div><div class="row-title">Support notes</div><div class="row-sub">' + (supportNotes.length ? supportNotes.map(function(note) { return escapeHtml(note.note_type + ': ' + note.body + ' - ' + (note.created_by_email || 'employee') + ' - ' + rel(note.created_at)); }).join('<br>') : (payload.support_notes_schema_ready ? 'No support notes yet.' : 'Support notes table is not applied yet.')) + '</div></div><span class="tag ' + (payload.support_notes_schema_ready ? 'good' : 'warn') + '">' + (payload.support_notes_schema_ready ? 'ready' : 'pending') + '</span></div>';
        html += '<div class="row"><div><div class="row-title">Destructive action approvals</div><div class="row-sub">' + (actionRequests.length ? actionRequests.map(function(action) { return escapeHtml(action.action_type + ' - ' + action.status + ' - requested by ' + action.requested_by_email + ' - ' + action.reason + ' - ' + rel(action.created_at)); }).join('<br>') : (payload.action_requests_schema_ready ? 'No destructive action requests yet.' : 'Action request table is not applied yet.')) + '</div></div><span class="tag ' + (payload.action_requests_schema_ready ? 'warn' : 'bad') + '">' + (payload.action_requests_schema_ready ? 'approval required' : 'pending') + '</span></div>';
        html += '<div class="row"><div><div class="row-title">Destructive execution and rollback ledger</div><div class="row-sub">' + (executionRecords.length ? executionRecords.map(function(record) { var direction = record.preflight_result && record.preflight_result.action_direction === 'rollback' ? 'rollback plan' : 'execution plan'; return escapeHtml(direction + ' - ' + record.action_type + ' - ' + record.execution_mode + ' - ' + record.status + ' - by ' + record.executed_by_email + ' - ' + rel(record.created_at)); }).join('<br>') : (payload.execution_records_schema_ready ? 'No execution or rollback plans have been recorded yet.' : 'Execution record table is not applied yet.')) + '</div></div><span class="tag ' + (payload.execution_records_schema_ready ? 'warn' : 'bad') + '">' + (payload.execution_records_schema_ready ? 'dry-run only' : 'pending') + '</span></div>';
        html += '<div class="row"><div><div class="row-title">Evidence links</div><div class="row-sub">' + evidenceLinks.map(function(link) { return '<a class="tag" href="' + escapeHtml(link.href) + '">' + escapeHtml(link.label) + '</a>'; }).join('') + '</div></div><span class="tag good">links</span></div>';
        byId('orgDetailContent').innerHTML = html;
      }
      function render(payload) {
        var summary = payload.summary || {};
        text('kpiBusinesses', number(summary.active_business_count));
        text('kpiUsers', number(summary.membership_count));
        text('kpiProjects', number(summary.active_project_count));
        text('kpiInvites', number(summary.pending_invitation_count));
        text('kpiSso', number(summary.sso_configured_count));
        text('businessMeta', number((payload.businesses || []).length) + ' businesses visible');
        text('userMeta', number(summary.admin_membership_count) + ' admins/owners');
        text('ssoMeta', number(summary.sso_configured_count) + ' configured');

        var businesses = Array.isArray(payload.businesses) ? payload.businesses : [];
        byId('businessList').innerHTML = businesses.length ? businesses.map(function(biz) {
          var sso = biz.sso || {};
          var sub = (biz.owner_email || 'owner unknown') + ' - ' + number(biz.member_count) + ' users - ' + number(biz.active_project_count) + ' projects - created ' + rel(biz.created_at);
          return row(biz.name || biz.slug || biz.id, sub, sso.status === 'configured' ? 'SSO ready' : 'SSO todo', sso.status === 'configured' ? 'good' : 'warn', '/orgs/' + encodeURIComponent(biz.id), 'detail');
        }).join('') : '<div class="empty">No businesses found.</div>';

        var supportRows = businesses.filter(function(biz) {
          return biz.pending_invitation_count || !(biz.sso && biz.sso.status === 'configured') || biz.archived_at;
        });
        byId('supportList').innerHTML = supportRows.length ? supportRows.map(function(biz) {
          var reason = biz.archived_at ? 'archived customer' : biz.pending_invitation_count ? biz.pending_invitation_count + ' pending invites' : 'SSO not configured';
          return row(biz.name || biz.id, reason, biz.archived_at ? 'archived' : 'follow up', biz.archived_at ? 'bad' : 'warn');
        }).join('') : '<div class="empty">No support follow-ups from this snapshot.</div>';

        var users = Array.isArray(payload.users) ? payload.users : [];
        byId('userList').innerHTML = users.length ? users.slice(0, 12).map(function(user) {
          var sub = (user.email || user.user_id) + ' - ' + (user.organization_name || 'organization') + ' - joined ' + rel(user.created_at);
          var privileged = user.role === 'owner' || user.role === 'admin';
          return row(user.role, sub, privileged ? 'privileged' : 'standard', privileged ? 'warn' : 'good');
        }).join('') : '<div class="empty">No users found.</div>';

        var ssoRows = businesses.filter(function(biz) { return biz.sso; });
        byId('ssoList').innerHTML = ssoRows.length ? ssoRows.map(function(biz) {
          var sso = biz.sso || {};
          return row(biz.name || biz.id, (sso.company_domain || 'domain not set') + ' - ' + (sso.sso_provider || 'provider pending') + ' - ' + (sso.login_mode || 'mode pending'), sso.status || 'not started', sso.status === 'configured' ? 'good' : 'warn');
        }).join('') : '<div class="empty">No SSO settings found yet.</div>';

        var audit = Array.isArray(payload.recent_audit) ? payload.recent_audit : [];
        byId('auditList').innerHTML = audit.length ? audit.map(function(event) {
          return row(event.event_type || 'audit event', (event.organization_name || event.organization_id || 'unknown org') + ' - ' + (event.actor_email || 'system') + ' - ' + rel(event.created_at), event.target_type || 'audit', '');
        }).join('') : '<div class="empty">No recent audit events.</div>';

        var internalAudit = Array.isArray(payload.recent_internal_admin_audit) ? payload.recent_internal_admin_audit : [];
        byId('internalAuditList').innerHTML = internalAudit.length ? internalAudit.map(function(event) {
          var path = event.request_path || event.target_id || 'internal admin';
          var method = event.request_method || 'GET';
          return row(event.event_type || 'internal admin event', (event.actor_email || 'employee') + ' - ' + method + ' ' + path + ' - ' + rel(event.created_at), event.target_type || 'internal', 'good');
        }).join('') : '<div class="empty">No internal admin audit events yet. Apply the audit migration to persist this stream.</div>';
      }
      async function load() {
        if (!token) {
          notice('No employee session found.');
          return;
        }
        notice('');
        try {
          render(await fetchOverview());
          var orgId = selectedOrgId();
          if (orgId) renderOrgDetail(await fetchOrgDetail(orgId));
        } catch (error) {
          notice(error && error.message ? error.message : 'Internal admin failed to load.');
        }
      }
      var refreshBtn = byId('refreshBtn');
      if (refreshBtn) refreshBtn.addEventListener('click', load);
      load();
    })();
  </script>
</body>
</html>`;
}

async function handleInternalAdminOrgDetail(
  request: Request,
  env: EnterpriseControlPlaneEnv,
  organizationId: string,
): Promise<Response> {
  const orgId = decodeURIComponent(organizationId || '').trim();
  if (!orgId) {
    return Response.json({ error: 'Organization ID is required.' }, { status: 400 });
  }

  const authorized = await authorizeInternalAdmin(request, env);
  if (authorized instanceof Response) return authorized;

  const supabase = getSupabase(env);
  const auditWriteSucceeded = await writeInternalAdminAuditEvent(
    env,
    authorized.auth,
    request,
    'internal_admin_org_detail_viewed',
  );
  const [
    orgResult,
    memberResult,
    projectResult,
    inviteResult,
    ssoResult,
    auditResult,
    supportNoteResult,
    businessStatusResult,
    actionRequestResult,
    executionRecordResult,
  ] = await Promise.all([
    supabase
      .from('organizations')
      .select('id, name, slug, kind, owner_user_id, created_at, updated_at, archived_at')
      .eq('id', orgId)
      .limit(1),
    supabase
      .from('organization_members')
      .select('organization_id, user_id, role, created_at')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase
      .from('projects')
      .select('id, organization_id, vp_proj_id, name, revoked_at, created_at')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase
      .from('organization_invitations')
      .select('id, organization_id, email, role, status, created_at')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase
      .from('organization_sso_settings')
      .select('organization_id, company_domain, sso_provider, login_mode, status, updated_at')
      .eq('organization_id', orgId)
      .limit(1),
    supabase
      .from('organization_audit_events')
      .select('id, organization_id, actor_email, event_type, target_type, target_id, description, created_at')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(25),
    getInternalAdminSupportNotes(env, orgId),
    getInternalAdminBusinessStatus(env, orgId),
    getInternalAdminActionRequests(env, orgId),
    getInternalAdminActionExecutionRecords(env, orgId),
  ]);

  const firstError = orgResult.error || memberResult.error || projectResult.error || inviteResult.error || ssoResult.error || auditResult.error;
  if (firstError) {
    return Response.json({ error: `Internal admin org detail query failed: ${firstError.message}` }, { status: 500 });
  }

  const organization = normalizeRows(orgResult.data as MaybeArray<{
    id: string;
    name: string | null;
    slug: string | null;
    kind: string;
    owner_user_id: string | null;
    created_at: string;
    updated_at: string | null;
    archived_at: string | null;
  }>)[0];
  if (!organization) {
    return Response.json({ error: 'Organization not found.' }, { status: 404 });
  }

  const members = normalizeRows(memberResult.data as MaybeArray<{
    organization_id: string;
    user_id: string;
    role: string;
    created_at: string;
  }>);
  const projects = normalizeRows(projectResult.data as MaybeArray<{
    id: string;
    organization_id: string | null;
    vp_proj_id: string;
    name: string | null;
    revoked_at: string | null;
    created_at: string;
  }>);
  const invitations = normalizeRows(inviteResult.data as MaybeArray<{
    id: string;
    organization_id: string | null;
    email: string;
    role: string;
    status: string;
    created_at: string;
  }>);
  const sso = normalizeRows(ssoResult.data as MaybeArray<{
    organization_id: string;
    company_domain: string | null;
    sso_provider: string | null;
    login_mode: string | null;
    status: string | null;
    updated_at: string | null;
  }>)[0] || null;
  const auditRows = normalizeRows(auditResult.data as MaybeArray<{
    id: string;
    organization_id: string | null;
    actor_email: string | null;
    event_type: string;
    target_type: string | null;
    target_id: string | null;
    description: string | null;
    created_at: string;
  }>);
  const ownerEmailMap = await getUserEmailMap(env, organization.owner_user_id ? [organization.owner_user_id] : []);
  const memberEmailMap = await getUserEmailMap(env, members.map((member) => member.user_id));
  const activeProjects = projects.filter((project) => !project.revoked_at);
  const pendingInvitations = invitations.filter((invitation) => invitation.status === 'pending');
  const memberTimeline = [
    ...members.map((member) => ({
      type: 'member',
      label: `${member.role} member`,
      detail: memberEmailMap.get(member.user_id) || member.user_id,
      created_at: member.created_at,
    })),
    ...invitations.map((invitation) => ({
      type: 'invitation',
      label: `${invitation.status} invite`,
      detail: `${invitation.email} as ${invitation.role}`,
      created_at: invitation.created_at,
    })),
    ...auditRows.map((event) => ({
      type: 'audit',
      label: event.event_type,
      detail: event.description || event.actor_email || event.target_id || 'audit event',
      created_at: event.created_at,
    })),
  ].sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());

  return Response.json({
    generated_at: new Date().toISOString(),
    mode: 'read_only',
    admin_actions_enabled: false,
    admin: {
      user_id: authorized.auth.userId,
      email: authorized.auth.email,
    },
    business: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      owner_user_id: organization.owner_user_id,
      owner_email: organization.owner_user_id ? ownerEmailMap.get(organization.owner_user_id) || null : null,
      created_at: organization.created_at,
      updated_at: organization.updated_at,
      archived_at: organization.archived_at,
      member_count: members.length,
      active_project_count: activeProjects.length,
      pending_invitation_count: pendingInvitations.length,
      sso,
    },
    users: members.map((member) => ({
      user_id: member.user_id,
      email: memberEmailMap.get(member.user_id) || null,
      role: member.role,
      created_at: member.created_at,
    })),
    projects: projects.map((project) => ({
      id: project.id,
      vp_proj_id: project.vp_proj_id,
      name: project.name,
      revoked_at: project.revoked_at,
      created_at: project.created_at,
    })),
    invitations,
    recent_audit: auditRows,
    member_timeline: memberTimeline.slice(0, 30),
    sso_checklist: buildSsoChecklist(sso),
    support_notes_schema_ready: supportNoteResult.schemaReady,
    support_notes: supportNoteResult.rows.map((note) => ({
      id: note.id,
      note_type: note.note_type,
      body: note.body,
      created_by_user_id: note.created_by_user_id,
      created_by_email: note.created_by_email,
      created_at: note.created_at,
    })),
    business_status_schema_ready: businessStatusResult.schemaReady,
    business_status_updates: businessStatusResult.rows.map((status) => ({
      id: status.id,
      status: status.status,
      plan_label: status.plan_label,
      summary: status.summary,
      next_step: status.next_step,
      created_by_user_id: status.created_by_user_id,
      created_by_email: status.created_by_email,
      created_at: status.created_at,
    })),
    action_requests_schema_ready: actionRequestResult.schemaReady,
    action_requests: actionRequestResult.rows.map((action) => ({
      id: action.id,
      organization_id: action.organization_id,
      action_type: action.action_type,
      risk_level: action.risk_level,
      status: action.status,
      reason: action.reason,
      requested_payload: action.requested_payload,
      requested_by_user_id: action.requested_by_user_id,
      requested_by_email: action.requested_by_email,
      approved_by_user_id: action.approved_by_user_id,
      approved_by_email: action.approved_by_email,
      approved_at: action.approved_at,
      rejected_by_user_id: action.rejected_by_user_id,
      rejected_by_email: action.rejected_by_email,
      rejected_at: action.rejected_at,
      executed_at: action.executed_at,
      decision_note: action.decision_note,
      created_at: action.created_at,
      updated_at: action.updated_at,
    })),
    execution_records_schema_ready: executionRecordResult.schemaReady,
    execution_records: executionRecordResult.rows.map((record) => ({
      id: record.id,
      action_request_id: record.action_request_id,
      organization_id: record.organization_id,
      action_type: record.action_type,
      execution_mode: record.execution_mode,
      status: record.status,
      execution_enabled: record.execution_enabled,
      preflight_result: record.preflight_result,
      rollback_payload: record.rollback_payload,
      executed_by_user_id: record.executed_by_user_id,
      executed_by_email: record.executed_by_email,
      executed_at: record.executed_at,
      created_at: record.created_at,
    })),
    evidence_links: enterpriseEvidenceLinks(env, orgId),
    guardrails: [
      'Org detail is read-only.',
      auditWriteSucceeded
        ? 'Employee org-detail views are recorded in the internal admin audit stream.'
        : 'Internal admin audit migration is pending; org-detail views are allowed but not yet persisted.',
      'Support notes are display-only until approval-gated note creation is enabled.',
    ],
  }, {
    headers: {
      'cache-control': 'no-store',
    },
  });
}

async function ensureInternalAdminOrganizationExists(
  env: EnterpriseControlPlaneEnv,
  organizationId: string,
): Promise<Response | null> {
  const { data, error } = await getSupabase(env)
    .from('organizations')
    .select('id')
    .eq('id', organizationId)
    .limit(1);
  if (error) {
    return Response.json({ error: `Internal admin org lookup failed: ${error.message}` }, { status: 500 });
  }
  if (!normalizeRows(data as MaybeArray<{ id: string }>).length) {
    return Response.json({ error: 'Organization not found.' }, { status: 404 });
  }
  return null;
}

async function handleCreateInternalAdminSupportNote(
  request: Request,
  env: EnterpriseControlPlaneEnv,
  organizationId: string,
): Promise<Response> {
  const orgId = decodeURIComponent(organizationId || '').trim();
  if (!orgId) {
    return Response.json({ error: 'Organization ID is required.' }, { status: 400 });
  }

  const authorized = await authorizeInternalAdmin(request, env);
  if (authorized instanceof Response) return authorized;

  const approvalError = requireInternalAdminActionApproval(request, env);
  if (approvalError) return approvalError;

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    body = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const rawNoteType = typeof body.note_type === 'string' ? body.note_type.trim().toLowerCase() : 'support_note';
  const allowedNoteTypes = new Set(['support_note', 'onboarding', 'security', 'billing', 'go_live']);
  const noteType = allowedNoteTypes.has(rawNoteType) ? rawNoteType : 'support_note';
  const noteBody = typeof body.body === 'string' ? body.body.trim() : '';
  if (noteBody.length < 3) {
    return Response.json({ error: 'Support note body is required.' }, { status: 400 });
  }
  if (noteBody.length > 5000) {
    return Response.json({ error: 'Support note body must be 5000 characters or fewer.' }, { status: 400 });
  }

  const orgError = await ensureInternalAdminOrganizationExists(env, orgId);
  if (orgError) return orgError;

  const supabase = getSupabase(env);
  const insertResult = await supabase
    .from('internal_admin_support_notes')
    .insert({
      organization_id: orgId,
      note_type: noteType,
      body: noteBody,
      created_by_user_id: authorized.auth.userId,
      created_by_email: authorized.auth.email,
      metadata: {
        approval_header_present: true,
      },
    })
    .select('id, organization_id, note_type, body, created_by_user_id, created_by_email, created_at')
    .limit(1);

  if (insertResult.error) {
    return Response.json({ error: `Internal admin support note create failed: ${insertResult.error.message}` }, { status: 500 });
  }

  const note = normalizeRows(insertResult.data as MaybeArray<InternalAdminSupportNoteRow>)[0];
  await writeInternalAdminAuditEvent(
    env,
    authorized.auth,
    request,
    'internal_admin_support_note_created',
    {
      organization_id: orgId,
      support_note_id: note?.id || null,
      note_type: noteType,
    },
  );

  return Response.json({
    note,
    guardrails: [
      'Support note creation requires internal admin actions to be enabled.',
      'Support note creation requires the approval secret header.',
      'The support note creation event is written to internal admin audit.',
    ],
  }, {
    status: 201,
    headers: {
      'cache-control': 'no-store',
    },
  });
}

async function handleCreateInternalAdminInvitation(
  request: Request,
  env: EnterpriseControlPlaneEnv,
  organizationId: string,
): Promise<Response> {
  const orgId = decodeURIComponent(organizationId || '').trim();
  if (!orgId) {
    return Response.json({ error: 'Organization ID is required.' }, { status: 400 });
  }

  const authorized = await authorizeInternalAdmin(request, env);
  if (authorized instanceof Response) return authorized;

  const approvalError = requireInternalAdminActionApproval(request, env);
  if (approvalError) return approvalError;

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    body = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return Response.json({ error: 'email must be a valid email address.' }, { status: 400 });
  }
  const role = validateInternalInvitationRole(body.role || 'viewer');
  if (!role) {
    return Response.json({ error: 'role is not a valid organization role.' }, { status: 400 });
  }

  const orgError = await ensureInternalAdminOrganizationExists(env, orgId);
  if (orgError) return orgError;

  const now = new Date().toISOString();
  const { data, error } = await getSupabase(env)
    .from('organization_invitations')
    .insert({
      organization_id: orgId,
      email,
      role,
      status: 'pending',
      invited_by: authorized.auth.userId,
      created_at: now,
    })
    .select('id, organization_id, email, role, status, created_at, invited_by')
    .limit(1);

  if (error) {
    return Response.json({ error: `Internal admin invitation create failed: ${error.message}` }, { status: 500 });
  }

  const invitation = normalizeRows(data as MaybeArray<{
    id: string;
    organization_id: string;
    email: string;
    role: string;
    status: string;
    created_at: string;
    invited_by: string | null;
  }>)[0];

  await writeInternalAdminAuditEvent(
    env,
    authorized.auth,
    request,
    'internal_admin_invitation_created',
    {
      organization_id: orgId,
      invitation_id: invitation?.id || null,
      invited_email: email,
      role,
    },
  );

  return Response.json({
    invitation,
    guardrails: [
      'Invitation creation requires internal admin actions to be enabled.',
      'Invitation creation requires the approval secret header.',
      'Email delivery is handled by the normal customer invite flow; this endpoint records the employee action in internal admin audit.',
    ],
  }, {
    status: 201,
    headers: {
      'cache-control': 'no-store',
    },
  });
}

async function handleResendInternalAdminInvitation(
  request: Request,
  env: EnterpriseControlPlaneEnv,
  organizationId: string,
  invitationId: string,
): Promise<Response> {
  const orgId = decodeURIComponent(organizationId || '').trim();
  const inviteId = decodeURIComponent(invitationId || '').trim();
  if (!orgId || !inviteId) {
    return Response.json({ error: 'Organization ID and invitation ID are required.' }, { status: 400 });
  }

  const authorized = await authorizeInternalAdmin(request, env);
  if (authorized instanceof Response) return authorized;

  const approvalError = requireInternalAdminActionApproval(request, env);
  if (approvalError) return approvalError;

  const { data, error } = await getSupabase(env)
    .from('organization_invitations')
    .select('id, organization_id, email, role, status, created_at')
    .eq('id', inviteId)
    .eq('organization_id', orgId)
    .eq('status', 'pending')
    .limit(1);

  if (error) {
    return Response.json({ error: `Internal admin invitation lookup failed: ${error.message}` }, { status: 500 });
  }

  const invitation = normalizeRows(data as MaybeArray<{
    id: string;
    organization_id: string;
    email: string;
    role: string;
    status: string;
    created_at: string;
  }>)[0];
  if (!invitation) {
    return Response.json({ error: 'Pending invitation not found.' }, { status: 404 });
  }

  await writeInternalAdminAuditEvent(
    env,
    authorized.auth,
    request,
    'internal_admin_invitation_resend_requested',
    {
      organization_id: orgId,
      invitation_id: inviteId,
      invited_email: invitation.email,
      role: invitation.role,
    },
  );

  return Response.json({
    invitation,
    resend: {
      requested: true,
      email_delivery: 'not_sent_by_internal_admin_endpoint',
      next_step: 'Use the customer invite email flow or support tooling to deliver the invite.',
    },
    guardrails: [
      'Resend request requires internal admin actions to be enabled.',
      'Resend request requires the approval secret header.',
      'This endpoint records the support request; it does not expose service-role credentials to the browser.',
    ],
  }, {
    headers: {
      'cache-control': 'no-store',
    },
  });
}

async function handleRevokeInternalAdminInvitation(
  request: Request,
  env: EnterpriseControlPlaneEnv,
  organizationId: string,
  invitationId: string,
): Promise<Response> {
  const orgId = decodeURIComponent(organizationId || '').trim();
  const inviteId = decodeURIComponent(invitationId || '').trim();
  if (!orgId || !inviteId) {
    return Response.json({ error: 'Organization ID and invitation ID are required.' }, { status: 400 });
  }

  const authorized = await authorizeInternalAdmin(request, env);
  if (authorized instanceof Response) return authorized;

  const approvalError = requireInternalAdminActionApproval(request, env);
  if (approvalError) return approvalError;

  const { data, error } = await getSupabase(env)
    .from('organization_invitations')
    .update({
      status: 'revoked',
      revoked_at: new Date().toISOString(),
    })
    .eq('id', inviteId)
    .eq('organization_id', orgId)
    .eq('status', 'pending')
    .select('id, organization_id, email, role, status, revoked_at')
    .limit(1);

  if (error) {
    return Response.json({ error: `Internal admin invitation revoke failed: ${error.message}` }, { status: 500 });
  }

  const invitation = normalizeRows(data as MaybeArray<{
    id: string;
    organization_id: string;
    email: string;
    role: string;
    status: string;
    revoked_at: string | null;
  }>)[0];
  if (!invitation) {
    return Response.json({ error: 'Pending invitation not found.' }, { status: 404 });
  }

  await writeInternalAdminAuditEvent(
    env,
    authorized.auth,
    request,
    'internal_admin_invitation_revoked',
    {
      organization_id: orgId,
      invitation_id: inviteId,
      invited_email: invitation.email,
      previous_role: invitation.role,
    },
  );

  return Response.json({
    invitation,
    guardrails: [
      'Invitation revoke requires internal admin actions to be enabled.',
      'Invitation revoke requires the approval secret header.',
      'The revoke event is written to internal admin audit.',
    ],
  }, {
    headers: {
      'cache-control': 'no-store',
    },
  });
}

async function handleCreateInternalAdminBusinessStatusUpdate(
  request: Request,
  env: EnterpriseControlPlaneEnv,
  organizationId: string,
): Promise<Response> {
  const orgId = decodeURIComponent(organizationId || '').trim();
  if (!orgId) {
    return Response.json({ error: 'Organization ID is required.' }, { status: 400 });
  }

  const authorized = await authorizeInternalAdmin(request, env);
  if (authorized instanceof Response) return authorized;

  const approvalError = requireInternalAdminActionApproval(request, env);
  if (approvalError) return approvalError;

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    body = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const status = validateBusinessStatus(body.status || 'onboarding');
  if (!status) {
    return Response.json({ error: 'status must be one of: onboarding, active, at_risk, paused, offboarding.' }, { status: 400 });
  }

  const summary = typeof body.summary === 'string' ? body.summary.trim() : '';
  if (summary.length < 3) {
    return Response.json({ error: 'summary is required.' }, { status: 400 });
  }
  if (summary.length > 2000) {
    return Response.json({ error: 'summary must be 2000 characters or fewer.' }, { status: 400 });
  }

  const planLabel = typeof body.plan_label === 'string' && body.plan_label.trim()
    ? truncateForAudit(body.plan_label.trim(), 120)
    : null;
  const nextStep = typeof body.next_step === 'string' && body.next_step.trim()
    ? truncateForAudit(body.next_step.trim(), 500)
    : null;

  const orgError = await ensureInternalAdminOrganizationExists(env, orgId);
  if (orgError) return orgError;

  const { data, error } = await getSupabase(env)
    .from('internal_admin_business_status_updates')
    .insert({
      organization_id: orgId,
      status,
      plan_label: planLabel,
      summary,
      next_step: nextStep,
      created_by_user_id: authorized.auth.userId,
      created_by_email: authorized.auth.email,
      metadata: {
        approval_header_present: true,
      },
    })
    .select('id, organization_id, status, plan_label, summary, next_step, created_by_user_id, created_by_email, created_at')
    .limit(1);

  if (error) {
    return Response.json({ error: `Internal admin business status update failed: ${error.message}` }, { status: 500 });
  }

  const statusUpdate = normalizeRows(data as MaybeArray<InternalAdminBusinessStatusRow>)[0];
  await writeInternalAdminAuditEvent(
    env,
    authorized.auth,
    request,
    'internal_admin_business_status_updated',
    {
      organization_id: orgId,
      status_update_id: statusUpdate?.id || null,
      status,
      plan_label: planLabel,
    },
  );

  return Response.json({
    status_update: statusUpdate,
    guardrails: [
      'Business status updates require internal admin actions to be enabled.',
      'Business status updates require the approval secret header.',
      'Business status is internal VaultProof tracking and does not mutate customer organization records.',
    ],
  }, {
    status: 201,
    headers: {
      'cache-control': 'no-store',
    },
  });
}

async function handleCreateInternalAdminActionRequest(
  request: Request,
  env: EnterpriseControlPlaneEnv,
  organizationId: string,
): Promise<Response> {
  const orgId = decodeURIComponent(organizationId || '').trim();
  if (!orgId) {
    return Response.json({ error: 'Organization ID is required.' }, { status: 400 });
  }

  const authorized = await authorizeInternalAdmin(request, env);
  if (authorized instanceof Response) return authorized;

  const approvalError = requireInternalAdminActionApproval(request, env);
  if (approvalError) return approvalError;

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    body = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const actionType = validateInternalAdminActionType(body.action_type);
  if (!actionType) {
    return Response.json({ error: 'action_type must be disable_org_access.' }, { status: 400 });
  }

  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 12) {
    return Response.json({ error: 'reason must be at least 12 characters.' }, { status: 400 });
  }
  if (reason.length > 2000) {
    return Response.json({ error: 'reason must be 2000 characters or fewer.' }, { status: 400 });
  }

  const requestedPayload = body.requested_payload && typeof body.requested_payload === 'object' && !Array.isArray(body.requested_payload)
    ? body.requested_payload as Record<string, unknown>
    : {};

  const orgError = await ensureInternalAdminOrganizationExists(env, orgId);
  if (orgError) return orgError;

  const now = new Date().toISOString();
  const { data, error } = await getSupabase(env)
    .from('internal_admin_action_requests')
    .insert({
      organization_id: orgId,
      action_type: actionType,
      risk_level: 'critical',
      status: 'pending',
      reason,
      requested_payload: requestedPayload,
      requested_by_user_id: authorized.auth.userId,
      requested_by_email: authorized.auth.email,
      metadata: {
        approval_header_present: true,
        execution_wired: false,
      },
      created_at: now,
      updated_at: now,
    })
    .select('id, organization_id, action_type, risk_level, status, reason, requested_payload, requested_by_user_id, requested_by_email, approved_by_user_id, approved_by_email, approved_at, rejected_by_user_id, rejected_by_email, rejected_at, executed_by_user_id, executed_by_email, executed_at, decision_note, created_at, updated_at')
    .limit(1);

  if (error) {
    return Response.json({ error: `Internal admin action request create failed: ${error.message}` }, { status: 500 });
  }

  const actionRequest = normalizeRows(data as MaybeArray<InternalAdminActionRequestRow>)[0];
  await writeInternalAdminAuditEvent(
    env,
    authorized.auth,
    request,
    'internal_admin_action_request_created',
    {
      organization_id: orgId,
      action_request_id: actionRequest?.id || null,
      action_type: actionType,
      risk_level: 'critical',
    },
  );

  return Response.json({
    action_request: actionRequest,
    execution_enabled: false,
    guardrails: [
      'Destructive action requests require internal admin actions to be enabled.',
      'Destructive action requests require the approval secret header.',
      'This only creates a request. Disable-org execution is intentionally not wired until rollback/break-glass controls are finalized.',
    ],
  }, {
    status: 201,
    headers: {
      'cache-control': 'no-store',
    },
  });
}

async function handleDecideInternalAdminActionRequest(
  request: Request,
  env: EnterpriseControlPlaneEnv,
  actionRequestId: string,
  decision: 'approve' | 'reject',
): Promise<Response> {
  const requestId = decodeURIComponent(actionRequestId || '').trim();
  if (!requestId) {
    return Response.json({ error: 'Action request ID is required.' }, { status: 400 });
  }

  const authorized = await authorizeInternalAdmin(request, env);
  if (authorized instanceof Response) return authorized;

  const approvalError = requireInternalAdminActionApproval(request, env);
  if (approvalError) return approvalError;

  let body: Record<string, unknown> = {};
  try {
    if ((request.headers.get('content-length') || '0') !== '0') {
      const parsed = await request.json();
      body = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    }
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const note = typeof body.decision_note === 'string' && body.decision_note.trim()
    ? truncateForAudit(body.decision_note.trim(), 1000)
    : null;

  const supabase = getSupabase(env);
  const existingResult = await supabase
    .from('internal_admin_action_requests')
    .select('id, organization_id, action_type, risk_level, status, reason, requested_payload, requested_by_user_id, requested_by_email, approved_by_user_id, approved_by_email, approved_at, rejected_by_user_id, rejected_by_email, rejected_at, executed_by_user_id, executed_by_email, executed_at, decision_note, created_at, updated_at')
    .eq('id', requestId)
    .eq('status', 'pending')
    .limit(1);

  if (existingResult.error) {
    return Response.json({ error: `Internal admin action request lookup failed: ${existingResult.error.message}` }, { status: 500 });
  }

  const existing = normalizeRows(existingResult.data as MaybeArray<InternalAdminActionRequestRow>)[0];
  if (!existing) {
    return Response.json({ error: 'Pending action request not found.' }, { status: 404 });
  }

  if (
    existing.requested_by_user_id === authorized.auth.userId
    || existing.requested_by_email.trim().toLowerCase() === authorized.auth.email.trim().toLowerCase()
  ) {
    return Response.json({ error: 'A different VaultProof employee must approve or reject this action request.' }, { status: 409 });
  }

  const now = new Date().toISOString();
  const update = decision === 'approve'
    ? {
        status: 'approved',
        approved_by_user_id: authorized.auth.userId,
        approved_by_email: authorized.auth.email,
        approved_at: now,
        decision_note: note,
        updated_at: now,
      }
    : {
        status: 'rejected',
        rejected_by_user_id: authorized.auth.userId,
        rejected_by_email: authorized.auth.email,
        rejected_at: now,
        decision_note: note,
        updated_at: now,
      };

  const { data, error } = await supabase
    .from('internal_admin_action_requests')
    .update(update)
    .eq('id', requestId)
    .eq('status', 'pending')
    .select('id, organization_id, action_type, risk_level, status, reason, requested_payload, requested_by_user_id, requested_by_email, approved_by_user_id, approved_by_email, approved_at, rejected_by_user_id, rejected_by_email, rejected_at, executed_by_user_id, executed_by_email, executed_at, decision_note, created_at, updated_at')
    .limit(1);

  if (error) {
    return Response.json({ error: `Internal admin action request decision failed: ${error.message}` }, { status: 500 });
  }

  const actionRequest = normalizeRows(data as MaybeArray<InternalAdminActionRequestRow>)[0];
  await writeInternalAdminAuditEvent(
    env,
    authorized.auth,
    request,
    decision === 'approve'
      ? 'internal_admin_action_request_approved'
      : 'internal_admin_action_request_rejected',
    {
      organization_id: existing.organization_id,
      action_request_id: requestId,
      action_type: existing.action_type,
      risk_level: existing.risk_level,
    },
  );

  return Response.json({
    action_request: actionRequest,
    execution_enabled: false,
    guardrails: [
      'A different employee made the approval decision.',
      'The decision is recorded in internal admin audit.',
      'Approved disable-org requests are not executed until rollback/break-glass controls are finalized.',
    ],
  }, {
    headers: {
      'cache-control': 'no-store',
    },
  });
}

async function handlePlanInternalAdminActionExecution(
  request: Request,
  env: EnterpriseControlPlaneEnv,
  actionRequestId: string,
): Promise<Response> {
  const requestId = decodeURIComponent(actionRequestId || '').trim();
  if (!requestId) {
    return Response.json({ error: 'Action request ID is required.' }, { status: 400 });
  }

  const authorized = await authorizeInternalAdmin(request, env);
  if (authorized instanceof Response) return authorized;

  const approvalError = requireInternalAdminActionApproval(request, env);
  if (approvalError) return approvalError;

  const supabase = getSupabase(env);
  const actionResult = await supabase
    .from('internal_admin_action_requests')
    .select('id, organization_id, action_type, risk_level, status, reason, requested_payload, requested_by_user_id, requested_by_email, approved_by_user_id, approved_by_email, approved_at, rejected_by_user_id, rejected_by_email, rejected_at, executed_by_user_id, executed_by_email, executed_at, decision_note, created_at, updated_at')
    .eq('id', requestId)
    .eq('status', 'approved')
    .limit(1);

  if (actionResult.error) {
    return Response.json({ error: `Internal admin approved action lookup failed: ${actionResult.error.message}` }, { status: 500 });
  }

  const actionRequest = normalizeRows(actionResult.data as MaybeArray<InternalAdminActionRequestRow>)[0];
  if (!actionRequest) {
    return Response.json({ error: 'Approved action request not found.' }, { status: 404 });
  }
  if (actionRequest.action_type !== 'disable_org_access') {
    return Response.json({ error: 'Unsupported action request type.' }, { status: 400 });
  }
  if (!actionRequest.organization_id) {
    return Response.json({ error: 'Action request is missing organization_id.' }, { status: 400 });
  }

  const orgResult = await supabase
    .from('organizations')
    .select('id, name, slug, kind, owner_user_id, archived_at, archived_by_user_id, updated_at')
    .eq('id', actionRequest.organization_id)
    .limit(1);
  if (orgResult.error) {
    return Response.json({ error: `Internal admin org preflight failed: ${orgResult.error.message}` }, { status: 500 });
  }

  const organization = normalizeRows(orgResult.data as MaybeArray<{
    id: string;
    name: string | null;
    slug: string | null;
    kind: string;
    owner_user_id: string | null;
    archived_at: string | null;
    archived_by_user_id: string | null;
    updated_at: string | null;
  }>)[0];
  if (!organization) {
    return Response.json({ error: 'Organization not found for approved action request.' }, { status: 404 });
  }

  const blockers = [
    organization.kind !== 'team' ? 'only team organizations can be disabled' : null,
    organization.archived_at ? 'organization is already archived/disabled' : null,
  ].filter(Boolean) as string[];
  const preflightResult = {
    action_type: actionRequest.action_type,
    execution_mode: 'dry_run',
    execution_enabled: false,
    would_set_archived_at: !organization.archived_at,
    would_set_archived_by_user_id: authorized.auth.userId,
    blockers,
    warnings: [
      'Live disable-org execution is intentionally not enabled from this endpoint.',
      'Confirm customer authorization and rollback owner before live execution is added.',
    ],
  };
  const rollbackPayload = {
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      kind: organization.kind,
      owner_user_id: organization.owner_user_id,
      archived_at: organization.archived_at,
      archived_by_user_id: organization.archived_by_user_id,
      updated_at: organization.updated_at,
    },
    rollback_action: 'restore_previous_organization_archive_fields',
  };

  const now = new Date().toISOString();
  const insertResult = await supabase
    .from('internal_admin_action_execution_records')
    .insert({
      action_request_id: actionRequest.id,
      organization_id: actionRequest.organization_id,
      action_type: actionRequest.action_type,
      execution_mode: 'dry_run',
      status: 'planned',
      execution_enabled: false,
      preflight_result: preflightResult,
      rollback_payload: rollbackPayload,
      executed_by_user_id: authorized.auth.userId,
      executed_by_email: authorized.auth.email,
      executed_at: now,
    })
    .select('id, action_request_id, organization_id, action_type, execution_mode, status, execution_enabled, preflight_result, rollback_payload, executed_by_user_id, executed_by_email, executed_at, created_at')
    .limit(1);

  if (insertResult.error) {
    return Response.json({ error: `Internal admin action execution plan failed: ${insertResult.error.message}` }, { status: 500 });
  }

  const executionRecord = normalizeRows(insertResult.data as MaybeArray<InternalAdminActionExecutionRecordRow>)[0];
  await writeInternalAdminAuditEvent(
    env,
    authorized.auth,
    request,
    'internal_admin_action_execution_planned',
    {
      organization_id: actionRequest.organization_id,
      action_request_id: actionRequest.id,
      execution_record_id: executionRecord?.id || null,
      action_type: actionRequest.action_type,
      execution_mode: 'dry_run',
      execution_enabled: false,
    },
  );

  return Response.json({
    execution_record: executionRecord,
    preflight_result: preflightResult,
    rollback_payload: rollbackPayload,
    execution_enabled: false,
    guardrails: [
      'This endpoint only records a dry-run execution plan.',
      'No organization fields are changed.',
      'Live disable-org execution remains blocked until rollback/break-glass controls are finalized.',
    ],
  }, {
    status: 201,
    headers: {
      'cache-control': 'no-store',
    },
  });
}

async function handlePlanInternalAdminActionRollback(
  request: Request,
  env: EnterpriseControlPlaneEnv,
  executionRecordId: string,
): Promise<Response> {
  const recordId = decodeURIComponent(executionRecordId || '').trim();
  if (!recordId) {
    return Response.json({ error: 'Execution record ID is required.' }, { status: 400 });
  }

  const authorized = await authorizeInternalAdmin(request, env);
  if (authorized instanceof Response) return authorized;

  const approvalError = requireInternalAdminActionApproval(request, env);
  if (approvalError) return approvalError;

  const supabase = getSupabase(env);
  const executionResult = await supabase
    .from('internal_admin_action_execution_records')
    .select('id, action_request_id, organization_id, action_type, execution_mode, status, execution_enabled, preflight_result, rollback_payload, executed_by_user_id, executed_by_email, executed_at, created_at')
    .eq('id', recordId)
    .limit(1);

  if (executionResult.error) {
    return Response.json({ error: `Internal admin execution record lookup failed: ${executionResult.error.message}` }, { status: 500 });
  }

  const executionRecord = normalizeRows(executionResult.data as MaybeArray<InternalAdminActionExecutionRecordRow>)[0];
  if (!executionRecord) {
    return Response.json({ error: 'Execution record not found.' }, { status: 404 });
  }
  if (executionRecord.action_type !== 'disable_org_access') {
    return Response.json({ error: 'Unsupported execution record type.' }, { status: 400 });
  }
  if (executionRecord.status !== 'planned' && executionRecord.status !== 'executed') {
    return Response.json({ error: 'Only planned or executed action records can be rollback planned.' }, { status: 409 });
  }

  const rollbackPayload = executionRecord.rollback_payload && typeof executionRecord.rollback_payload === 'object'
    ? executionRecord.rollback_payload
    : {};
  const rollbackOrganization = rollbackPayload.organization && typeof rollbackPayload.organization === 'object'
    ? rollbackPayload.organization as Record<string, unknown>
    : null;
  if (!rollbackOrganization || typeof rollbackOrganization.id !== 'string') {
    return Response.json({ error: 'Execution record does not include a usable organization rollback payload.' }, { status: 409 });
  }

  const rollbackPlan = {
    action_type: executionRecord.action_type,
    action_direction: 'rollback',
    execution_mode: 'dry_run',
    rollback_enabled: false,
    would_restore_organization_fields: {
      id: rollbackOrganization.id,
      archived_at: rollbackOrganization.archived_at ?? null,
      archived_by_user_id: rollbackOrganization.archived_by_user_id ?? null,
      updated_at: rollbackOrganization.updated_at ?? null,
    },
    blockers: [
      executionRecord.execution_enabled ? null : 'source execution record was dry-run only',
      executionRecord.status === 'planned' ? 'source execution record was planned, not executed' : null,
    ].filter(Boolean),
    warnings: [
      'This endpoint only records a rollback dry-run plan.',
      'No organization fields are changed.',
      'Live rollback remains blocked until live destructive execution is operationalized.',
    ],
  };

  const now = new Date().toISOString();
  const insertResult = await supabase
    .from('internal_admin_action_execution_records')
    .insert({
      action_request_id: executionRecord.action_request_id,
      organization_id: executionRecord.organization_id,
      action_type: executionRecord.action_type,
      execution_mode: 'dry_run',
      status: 'planned',
      execution_enabled: false,
      preflight_result: rollbackPlan,
      rollback_payload: rollbackPayload,
      executed_by_user_id: authorized.auth.userId,
      executed_by_email: authorized.auth.email,
      executed_at: now,
    })
    .select('id, action_request_id, organization_id, action_type, execution_mode, status, execution_enabled, preflight_result, rollback_payload, executed_by_user_id, executed_by_email, executed_at, created_at')
    .limit(1);

  if (insertResult.error) {
    return Response.json({ error: `Internal admin rollback plan failed: ${insertResult.error.message}` }, { status: 500 });
  }

  const rollbackRecord = normalizeRows(insertResult.data as MaybeArray<InternalAdminActionExecutionRecordRow>)[0];
  await writeInternalAdminAuditEvent(
    env,
    authorized.auth,
    request,
    'internal_admin_action_rollback_planned',
    {
      organization_id: executionRecord.organization_id,
      action_request_id: executionRecord.action_request_id,
      source_execution_record_id: executionRecord.id,
      rollback_record_id: rollbackRecord?.id || null,
      action_type: executionRecord.action_type,
      execution_mode: 'dry_run',
      rollback_enabled: false,
    },
  );

  return Response.json({
    source_execution_record: executionRecord,
    rollback_record: rollbackRecord,
    rollback_plan: rollbackPlan,
    rollback_enabled: false,
    guardrails: [
      'This endpoint only records a dry-run rollback plan.',
      'No organization fields are changed.',
      'Use this plan to verify rollback evidence before live destructive execution is added.',
    ],
  }, {
    status: 201,
    headers: {
      'cache-control': 'no-store',
    },
  });
}

export async function handleInternalAdminRoutes(
  request: Request,
  env: EnterpriseControlPlaneEnv,
  pathSegments: string[],
): Promise<Response | null> {
  if (pathSegments.length === 1 && pathSegments[0] === 'session') {
    return handleInternalAdminSession(request, env);
  }

  if (
    request.method === 'POST'
    && pathSegments.length === 3
    && pathSegments[0] === 'orgs'
    && pathSegments[2] === 'invitations'
  ) {
    return handleCreateInternalAdminInvitation(request, env, pathSegments[1] || '');
  }

  if (
    request.method === 'POST'
    && pathSegments.length === 3
    && pathSegments[0] === 'orgs'
    && pathSegments[2] === 'action-requests'
  ) {
    return handleCreateInternalAdminActionRequest(request, env, pathSegments[1] || '');
  }

  if (
    request.method === 'POST'
    && pathSegments.length === 3
    && pathSegments[0] === 'orgs'
    && pathSegments[2] === 'support-notes'
  ) {
    return handleCreateInternalAdminSupportNote(request, env, pathSegments[1] || '');
  }

  if (
    request.method === 'POST'
    && pathSegments.length === 3
    && pathSegments[0] === 'orgs'
    && pathSegments[2] === 'status'
  ) {
    return handleCreateInternalAdminBusinessStatusUpdate(request, env, pathSegments[1] || '');
  }

  if (
    request.method === 'POST'
    && pathSegments.length === 5
    && pathSegments[0] === 'orgs'
    && pathSegments[2] === 'invitations'
    && pathSegments[4] === 'resend'
  ) {
    return handleResendInternalAdminInvitation(request, env, pathSegments[1] || '', pathSegments[3] || '');
  }

  if (
    request.method === 'POST'
    && pathSegments.length === 5
    && pathSegments[0] === 'orgs'
    && pathSegments[2] === 'invitations'
    && pathSegments[4] === 'revoke'
  ) {
    return handleRevokeInternalAdminInvitation(request, env, pathSegments[1] || '', pathSegments[3] || '');
  }

  if (
    request.method === 'POST'
    && pathSegments.length === 3
    && pathSegments[0] === 'action-requests'
    && (pathSegments[2] === 'approve' || pathSegments[2] === 'reject')
  ) {
    return handleDecideInternalAdminActionRequest(
      request,
      env,
      pathSegments[1] || '',
      pathSegments[2] === 'approve' ? 'approve' : 'reject',
    );
  }

  if (
    request.method === 'POST'
    && pathSegments.length === 3
    && pathSegments[0] === 'action-requests'
    && pathSegments[2] === 'execute-plan'
  ) {
    return handlePlanInternalAdminActionExecution(request, env, pathSegments[1] || '');
  }

  if (
    request.method === 'POST'
    && pathSegments.length === 3
    && pathSegments[0] === 'action-execution-records'
    && pathSegments[2] === 'rollback-plan'
  ) {
    return handlePlanInternalAdminActionRollback(request, env, pathSegments[1] || '');
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return null;
  }

  if (pathSegments.length === 2 && pathSegments[0] === 'orgs') {
    return handleInternalAdminOrgDetail(request, env, pathSegments[1] || '');
  }

  if (pathSegments.length !== 1 || pathSegments[0] !== 'overview') {
    return null;
  }

  const authorized = await authorizeInternalAdmin(request, env);
  if (authorized instanceof Response) return authorized;

  const supabase = getSupabase(env);
  const auditWriteSucceeded = await writeInternalAdminAuditEvent(
    env,
    authorized.auth,
    request,
    'internal_admin_overview_viewed',
  );
  const [
    orgResult,
    memberResult,
    projectResult,
    inviteResult,
    ssoResult,
    auditResult,
    internalAuditRows,
  ] = await Promise.all([
    supabase
      .from('organizations')
      .select('id, name, slug, kind, owner_user_id, created_at, updated_at, archived_at')
      .eq('kind', 'team')
      .order('created_at', { ascending: false })
      .limit(75),
    supabase
      .from('organization_members')
      .select('organization_id, user_id, role, created_at')
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase
      .from('projects')
      .select('id, organization_id, vp_proj_id, name, revoked_at, created_at')
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase
      .from('organization_invitations')
      .select('id, organization_id, email, role, status, created_at')
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase
      .from('organization_sso_settings')
      .select('organization_id, company_domain, sso_provider, login_mode, status, updated_at')
      .order('updated_at', { ascending: false })
      .limit(1000),
    supabase
      .from('organization_audit_events')
      .select('id, organization_id, actor_email, event_type, target_type, target_id, description, created_at')
      .order('created_at', { ascending: false })
      .limit(12),
    getRecentInternalAdminAudit(env),
  ]);

  const firstError = orgResult.error || memberResult.error || projectResult.error || inviteResult.error || ssoResult.error || auditResult.error;
  if (firstError) {
    return Response.json({ error: `Internal admin query failed: ${firstError.message}` }, { status: 500 });
  }

  const organizations = normalizeRows(orgResult.data as MaybeArray<{
    id: string;
    name: string | null;
    slug: string | null;
    kind: string;
    owner_user_id: string | null;
    created_at: string;
    updated_at: string | null;
    archived_at: string | null;
  }>);
  const members = normalizeRows(memberResult.data as MaybeArray<{
    organization_id: string;
    user_id: string;
    role: string;
    created_at: string;
  }>);
  const projects = normalizeRows(projectResult.data as MaybeArray<{
    id: string;
    organization_id: string | null;
    vp_proj_id: string;
    name: string | null;
    revoked_at: string | null;
    created_at: string;
  }>);
  const invitations = normalizeRows(inviteResult.data as MaybeArray<{
    id: string;
    organization_id: string | null;
    email: string;
    role: string;
    status: string;
    created_at: string;
  }>);
  const ssoRows = normalizeRows(ssoResult.data as MaybeArray<{
    organization_id: string;
    company_domain: string | null;
    sso_provider: string | null;
    login_mode: string | null;
    status: string | null;
    updated_at: string | null;
  }>);
  const auditRows = normalizeRows(auditResult.data as MaybeArray<{
    id: string;
    organization_id: string | null;
    actor_email: string | null;
    event_type: string;
    target_type: string | null;
    target_id: string | null;
    description: string | null;
    created_at: string;
  }>);

  const ownerEmailMap = await getUserEmailMap(env, organizations.map((organization) => organization.owner_user_id || ''));
  const memberEmailMap = await getUserEmailMap(env, members.map((member) => member.user_id));
  const orgById = new Map(organizations.map((organization) => [organization.id, organization]));
  const ssoByOrgId = new Map(ssoRows.map((row) => [row.organization_id, row]));
  const membersByOrg = new Map<string, typeof members>();
  const projectsByOrg = new Map<string, typeof projects>();
  const invitationsByOrg = new Map<string, typeof invitations>();

  for (const member of members) {
    const rows = membersByOrg.get(member.organization_id) || [];
    rows.push(member);
    membersByOrg.set(member.organization_id, rows);
  }
  for (const project of projects) {
    if (!project.organization_id) continue;
    const rows = projectsByOrg.get(project.organization_id) || [];
    rows.push(project);
    projectsByOrg.set(project.organization_id, rows);
  }
  for (const invitation of invitations) {
    if (!invitation.organization_id) continue;
    const rows = invitationsByOrg.get(invitation.organization_id) || [];
    rows.push(invitation);
    invitationsByOrg.set(invitation.organization_id, rows);
  }

  const activeBusinesses = organizations.filter((organization) => !organization.archived_at);
  const activeProjects = projects.filter((project) => !project.revoked_at);
  const pendingInvitations = invitations.filter((invitation) => invitation.status === 'pending');
  const configuredSso = ssoRows.filter((row) => row.status === 'configured');
  const adminMemberships = members.filter((member) => member.role === 'owner' || member.role === 'admin');

  const businesses = organizations.map((organization) => {
    const orgMembers = membersByOrg.get(organization.id) || [];
    const orgProjects = projectsByOrg.get(organization.id) || [];
    const orgInvitations = invitationsByOrg.get(organization.id) || [];
    const activeOrgProjects = orgProjects.filter((project) => !project.revoked_at);
    const pendingOrgInvitations = orgInvitations.filter((invitation) => invitation.status === 'pending');
    const sso = ssoByOrgId.get(organization.id) || null;
    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      owner_user_id: organization.owner_user_id,
      owner_email: organization.owner_user_id ? ownerEmailMap.get(organization.owner_user_id) || null : null,
      created_at: organization.created_at,
      updated_at: organization.updated_at,
      archived_at: organization.archived_at,
      member_count: orgMembers.length,
      admin_count: orgMembers.filter((member) => member.role === 'owner' || member.role === 'admin').length,
      active_project_count: activeOrgProjects.length,
      pending_invitation_count: pendingOrgInvitations.length,
      sso,
    };
  });

  return Response.json({
    generated_at: new Date().toISOString(),
    mode: 'read_only',
    admin_actions_enabled: false,
    admin: {
      user_id: authorized.auth.userId,
      email: authorized.auth.email,
      allowlist: {
        emails_configured: authorized.allowedEmails.length,
        domains_configured: authorized.allowedDomains.length,
      },
    },
    summary: {
      business_count: organizations.length,
      active_business_count: activeBusinesses.length,
      membership_count: members.length,
      admin_membership_count: adminMemberships.length,
      active_project_count: activeProjects.length,
      pending_invitation_count: pendingInvitations.length,
      sso_configured_count: configuredSso.length,
    },
    businesses,
    users: members.slice(0, 100).map((member) => {
      const organization = orgById.get(member.organization_id);
      return {
        organization_id: member.organization_id,
        organization_name: organization?.name || null,
        user_id: member.user_id,
        email: memberEmailMap.get(member.user_id) || null,
        role: member.role,
        created_at: member.created_at,
      };
    }),
    recent_audit: auditRows.map((event) => ({
      ...event,
      organization_name: event.organization_id ? orgById.get(event.organization_id)?.name || null : null,
    })),
    recent_internal_admin_audit: internalAuditRows.map((event) => ({
      id: event.id,
      actor_user_id: event.actor_user_id,
      actor_email: event.actor_email,
      event_type: event.event_type,
      target_type: event.target_type,
      target_id: event.target_id,
      request_method: event.request_method,
      request_path: event.request_path,
      request_host: event.request_host,
      created_at: event.created_at,
    })),
    guardrails: [
      'Browser never receives Supabase service-role credentials.',
      'Employee access requires an explicit email/domain allowlist.',
      auditWriteSucceeded
        ? 'Employee console views are recorded in the internal admin audit stream.'
        : 'Internal admin audit migration is pending; employee views are allowed but not yet persisted.',
      'This first slice remains read-only until approval gates and break-glass rules are added.',
    ],
  }, {
    headers: {
      'cache-control': 'no-store',
    },
  });
}
