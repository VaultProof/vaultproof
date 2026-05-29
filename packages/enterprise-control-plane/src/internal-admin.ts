import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import {
  isOrganizationRole,
  isValidDomain,
  normalizeDomain,
  normalizeSlug,
  type OrganizationRole,
} from '@vaultproof/core';
import { getEnterpriseHostname, type EnterpriseControlPlaneEnv } from './config.js';
import { injectEnterpriseAnalytics } from './analytics.js';
import { writeGovernanceAuditEvent } from './audit.js';
import { authenticateUser, type EnterpriseUserAuth } from './auth.js';
import { getSupabase } from './supabase.js';

const INTERNAL_AUTH_ERROR = 'VaultProof employee access required. Sign in with an approved employee account.';
const INTERNAL_ADMIN_SESSION_COOKIE = 'vp_internal_admin_session';
const INTERNAL_ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;
const INTERNAL_ADMIN_REQUIRED_EMAIL_DOMAIN = 'vaultproof.dev';
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

interface InternalAdminAuthUser {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
}

interface InternalAdminBreakGlassEvidence {
  customer_authorization_ref: string;
  rollback_owner_email: string;
  rollback_plan_summary: string;
  break_glass_reason: string;
}

interface InternalAdminCallRollupRow {
  project_id: string | null;
  day: string | null;
  call_count: number | string | null;
  status_bucket: string | null;
  last_timestamp: string | null;
}

interface InternalAdminRawAccessLogRow {
  project_id: string | null;
  status_code: number | string | null;
  timestamp: string | null;
}

interface InternalAdminApiCallStats {
  call_count: number;
  error_count: number;
  denied_count: number;
  last_api_call_at: string | null;
}

interface InternalAdminDailyApiCallStats extends InternalAdminApiCallStats {
  day: string;
}

interface InternalAdminApiCallAnalytics {
  byProjectId: Map<string, InternalAdminApiCallStats>;
  totals: InternalAdminApiCallStats;
  dailyTotals: InternalAdminDailyApiCallStats[];
  source: 'rollup_table' | 'raw_logs_sample' | 'missing';
  schemaReady: boolean;
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

function isMissingOrganizationSsoSettingsTable(error: { code?: string; message?: string } | null | undefined): boolean {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === '42P01'
    || error?.code === 'PGRST205'
    || (message.includes('organization_sso_settings') && (
      message.includes('schema cache')
      || message.includes('does not exist')
      || message.includes('could not find')
    ));
}

function isMissingProjectAccessRollupTable(error: { code?: string; message?: string } | null | undefined): boolean {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === '42P01'
    || error?.code === 'PGRST205'
    || (message.includes('project_access_log_daily_rollups') && (
      message.includes('schema cache')
      || message.includes('does not exist')
      || message.includes('could not find')
    ));
}

function truncateForAudit(value: string | null, maxLength = 160): string | null {
  if (!value) return null;
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function normalizeInternalAdminEmail(value: unknown): string {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : '';
}

function secureStringEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function positiveCount(value: unknown): number {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function emptyApiCallStats(): InternalAdminApiCallStats {
  return {
    call_count: 0,
    error_count: 0,
    denied_count: 0,
    last_api_call_at: null,
  };
}

function mergeApiCallStats(
  target: InternalAdminApiCallStats,
  source: InternalAdminApiCallStats,
): InternalAdminApiCallStats {
  target.call_count += source.call_count;
  target.error_count += source.error_count;
  target.denied_count += source.denied_count;
  if (source.last_api_call_at && (!target.last_api_call_at || source.last_api_call_at > target.last_api_call_at)) {
    target.last_api_call_at = source.last_api_call_at;
  }
  return target;
}

function addRollupRowToStats(
  statsByProjectId: Map<string, InternalAdminApiCallStats>,
  totals: InternalAdminApiCallStats,
  dailyTotalsByDay: Map<string, InternalAdminDailyApiCallStats>,
  row: InternalAdminCallRollupRow,
): void {
  const projectId = typeof row.project_id === 'string' ? row.project_id : '';
  if (!projectId) return;
  const callCount = positiveCount(row.call_count);
  const bucket = String(row.status_bucket || '').toLowerCase();
  const rowStats: InternalAdminApiCallStats = {
    call_count: callCount,
    error_count: bucket === 'error' || bucket === 'denied' ? callCount : 0,
    denied_count: bucket === 'denied' ? callCount : 0,
    last_api_call_at: typeof row.last_timestamp === 'string' && row.last_timestamp ? row.last_timestamp : null,
  };
  const existing = statsByProjectId.get(projectId) || emptyApiCallStats();
  mergeApiCallStats(existing, rowStats);
  statsByProjectId.set(projectId, existing);
  mergeApiCallStats(totals, rowStats);
  const day = typeof row.day === 'string' && row.day ? row.day.slice(0, 10) : '';
  if (day) {
    const dailyStats = dailyTotalsByDay.get(day) || { ...emptyApiCallStats(), day };
    mergeApiCallStats(dailyStats, rowStats);
    dailyTotalsByDay.set(day, dailyStats);
  }
}

function addRawAccessLogRowToStats(
  statsByProjectId: Map<string, InternalAdminApiCallStats>,
  totals: InternalAdminApiCallStats,
  dailyTotalsByDay: Map<string, InternalAdminDailyApiCallStats>,
  row: InternalAdminRawAccessLogRow,
): void {
  const projectId = typeof row.project_id === 'string' ? row.project_id : '';
  if (!projectId) return;
  const statusCode = Number(row.status_code || 0);
  const denied = statusCode === 401 || statusCode === 403 || statusCode === 429;
  const rowStats: InternalAdminApiCallStats = {
    call_count: 1,
    error_count: statusCode >= 400 ? 1 : 0,
    denied_count: denied ? 1 : 0,
    last_api_call_at: typeof row.timestamp === 'string' && row.timestamp ? row.timestamp : null,
  };
  const existing = statsByProjectId.get(projectId) || emptyApiCallStats();
  mergeApiCallStats(existing, rowStats);
  statsByProjectId.set(projectId, existing);
  mergeApiCallStats(totals, rowStats);
  const day = typeof row.timestamp === 'string' && row.timestamp ? row.timestamp.slice(0, 10) : '';
  if (day) {
    const dailyStats = dailyTotalsByDay.get(day) || { ...emptyApiCallStats(), day };
    mergeApiCallStats(dailyStats, rowStats);
    dailyTotalsByDay.set(day, dailyStats);
  }
}

function sortedDailyApiCallStats(
  dailyTotalsByDay: Map<string, InternalAdminDailyApiCallStats>,
): InternalAdminDailyApiCallStats[] {
  return [...dailyTotalsByDay.values()]
    .sort((left, right) => left.day.localeCompare(right.day))
    .slice(-30);
}

function isAllowedInternalAdminEmail(email: string, env: EnterpriseControlPlaneEnv): {
  ok: boolean;
  allowedEmails: string[];
  allowedDomains: string[];
} {
  const normalizedEmail = email.trim().toLowerCase();
  const allowedEmails = csvList(env.internalAdminAllowedEmails)
    .filter((allowedEmail) => emailDomain(allowedEmail) === INTERNAL_ADMIN_REQUIRED_EMAIL_DOMAIN);
  const allowedDomains = csvList(env.internalAdminAllowedDomains)
    .filter((domain) => !PUBLIC_EMAIL_DOMAINS.has(domain))
    .filter((domain) => domain === INTERNAL_ADMIN_REQUIRED_EMAIL_DOMAIN);
  const domain = emailDomain(normalizedEmail);

  return {
    ok: domain === INTERNAL_ADMIN_REQUIRED_EMAIL_DOMAIN
      && (allowedEmails.includes(normalizedEmail) || allowedDomains.includes(domain)),
    allowedEmails,
    allowedDomains,
  };
}

async function getInternalAdminApiCallAnalytics(
  env: EnterpriseControlPlaneEnv,
  projectIds: string[],
): Promise<InternalAdminApiCallAnalytics> {
  const uniqueProjectIds = [...new Set(projectIds.filter(Boolean))];
  const emptyResult: InternalAdminApiCallAnalytics = {
    byProjectId: new Map(),
    totals: emptyApiCallStats(),
    dailyTotals: [],
    source: 'missing',
    schemaReady: true,
  };

  if (uniqueProjectIds.length === 0) {
    return emptyResult;
  }

  const supabase = getSupabase(env);
  try {
    const rollupResult = await supabase
      .from('project_access_log_daily_rollups')
      .select('project_id, day, call_count, status_bucket, last_timestamp')
      .in('project_id', uniqueProjectIds)
      .limit(10000);

    if (!rollupResult.error) {
      const byProjectId = new Map<string, InternalAdminApiCallStats>();
      const totals = emptyApiCallStats();
      const dailyTotalsByDay = new Map<string, InternalAdminDailyApiCallStats>();
      for (const row of normalizeRows(rollupResult.data as MaybeArray<InternalAdminCallRollupRow>)) {
        addRollupRowToStats(byProjectId, totals, dailyTotalsByDay, row);
      }
      return {
        byProjectId,
        totals,
        dailyTotals: sortedDailyApiCallStats(dailyTotalsByDay),
        source: 'rollup_table',
        schemaReady: true,
      };
    }

    if (!isMissingProjectAccessRollupTable(rollupResult.error)) {
      console.warn(`internal admin API call rollup read skipped: ${rollupResult.error.message}`);
    }
  } catch (error) {
    console.warn(`internal admin API call rollup read failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const rawResult = await supabase
      .from('project_access_logs')
      .select('project_id, status_code, timestamp')
      .in('project_id', uniqueProjectIds)
      .order('timestamp', { ascending: false })
      .limit(10000);

    if (!rawResult.error) {
      const byProjectId = new Map<string, InternalAdminApiCallStats>();
      const totals = emptyApiCallStats();
      const dailyTotalsByDay = new Map<string, InternalAdminDailyApiCallStats>();
      for (const row of normalizeRows(rawResult.data as MaybeArray<InternalAdminRawAccessLogRow>)) {
        addRawAccessLogRowToStats(byProjectId, totals, dailyTotalsByDay, row);
      }
      return {
        byProjectId,
        totals,
        dailyTotals: sortedDailyApiCallStats(dailyTotalsByDay),
        source: 'raw_logs_sample',
        schemaReady: false,
      };
    }

    console.warn(`internal admin API call raw-log fallback skipped: ${rawResult.error.message}`);
  } catch (error) {
    console.warn(`internal admin API call raw-log fallback failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    ...emptyResult,
    schemaReady: false,
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

function validateInternalAdminSsoStatus(value: unknown): 'requested' | 'configured' | null {
  if (value === 'requested' || value === 'configured') return value;
  return null;
}

function validateInternalAdminSsoLoginMode(value: unknown): 'sso-first' | 'assisted' | null {
  if (value === 'sso-first' || value === 'assisted') return value;
  return null;
}

function normalizeInternalAdminSsoProvider(value: unknown): string | null | Response {
  const provider = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!provider) return null;
  if (provider.length > 80) {
    return Response.json({ error: 'sso_provider must be 80 characters or fewer.' }, { status: 400 });
  }
  if (!/^[a-z0-9][a-z0-9._ -]*$/.test(provider)) {
    return Response.json({ error: 'sso_provider can only contain letters, numbers, spaces, dots, underscores, and hyphens.' }, { status: 400 });
  }
  return provider;
}

function ssoStartRedirectUrl(env: EnterpriseControlPlaneEnv, companyDomain: string): string {
  const params = new URLSearchParams({
    auth: 'sso',
    sso_domain: companyDomain,
  });
  return `https://${getEnterpriseHostname(env)}/app/login?${params.toString()}`;
}

function responseErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    for (const key of ['message', 'error_description', 'error', 'msg']) {
      if (typeof record[key] === 'string' && record[key]) return record[key] as string;
    }
  }
  return fallback;
}

async function checkSupabaseSsoStart(env: EnterpriseControlPlaneEnv, companyDomain: string): Promise<{
  broker_status: 'ready' | 'blocked';
  checked_at: string;
  company_domain: string;
  error: string | null;
  redirect_host: string | null;
  redirect_to: string;
  supabase_status: number | null;
}> {
  const checkedAt = new Date().toISOString();
  const redirectTo = ssoStartRedirectUrl(env, companyDomain);
  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    return {
      broker_status: 'blocked',
      checked_at: checkedAt,
      company_domain: companyDomain,
      error: 'Supabase public auth config is missing on the enterprise control plane.',
      redirect_host: null,
      redirect_to: redirectTo,
      supabase_status: null,
    };
  }

  let payload: unknown = null;
  let status: number | null = null;
  try {
    const response = await fetch(`${env.supabaseUrl.replace(/\/+$/, '')}/auth/v1/sso`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        apikey: env.supabaseAnonKey,
        authorization: `Bearer ${env.supabaseAnonKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        domain: companyDomain,
        redirect_to: redirectTo,
        skip_http_redirect: true,
      }),
    });
    status = response.status;
    payload = await response.json().catch(() => null);
    const redirectUrl = payload && typeof payload === 'object'
      ? typeof (payload as Record<string, unknown>).url === 'string'
        ? (payload as Record<string, unknown>).url as string
        : ''
      : '';
    let redirectHost: string | null = null;
    if (redirectUrl) {
      try {
        redirectHost = new URL(redirectUrl).hostname;
      } catch {
        redirectHost = null;
      }
    }
    if (response.ok && redirectUrl) {
      return {
        broker_status: 'ready',
        checked_at: checkedAt,
        company_domain: companyDomain,
        error: null,
        redirect_host: redirectHost,
        redirect_to: redirectTo,
        supabase_status: status,
      };
    }
    return {
      broker_status: 'blocked',
      checked_at: checkedAt,
      company_domain: companyDomain,
      error: responseErrorMessage(payload, `Supabase SSO start returned HTTP ${response.status}.`),
      redirect_host: redirectHost,
      redirect_to: redirectTo,
      supabase_status: status,
    };
  } catch (error) {
    return {
      broker_status: 'blocked',
      checked_at: checkedAt,
      company_domain: companyDomain,
      error: error instanceof Error ? error.message : 'Supabase SSO start check failed.',
      redirect_host: null,
      redirect_to: redirectTo,
      supabase_status: status,
    };
  }
}

function validateInternalAdminActionType(value: unknown): InternalAdminActionRequestRow['action_type'] | null {
  return value === 'disable_org_access' ? value : null;
}

function requiredPayloadString(
  payload: Record<string, unknown>,
  fieldName: keyof InternalAdminBreakGlassEvidence,
  label: string,
  minLength: number,
  maxLength: number,
): string | Response {
  const value = typeof payload[fieldName] === 'string' ? payload[fieldName].trim() : '';
  if (value.length < minLength) {
    return Response.json({ error: `${label} is required for destructive action requests.` }, { status: 400 });
  }
  if (value.length > maxLength) {
    return Response.json({ error: `${label} must be ${maxLength} characters or fewer.` }, { status: 400 });
  }
  return value;
}

function validateBreakGlassEvidence(
  payload: Record<string, unknown>,
): InternalAdminBreakGlassEvidence | Response {
  const customerAuthorizationRef = requiredPayloadString(
    payload,
    'customer_authorization_ref',
    'customer_authorization_ref',
    6,
    160,
  );
  if (customerAuthorizationRef instanceof Response) return customerAuthorizationRef;

  const rollbackOwnerEmail = requiredPayloadString(
    payload,
    'rollback_owner_email',
    'rollback_owner_email',
    6,
    254,
  );
  if (rollbackOwnerEmail instanceof Response) return rollbackOwnerEmail;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rollbackOwnerEmail)) {
    return Response.json({ error: 'rollback_owner_email must be a valid email address.' }, { status: 400 });
  }

  const rollbackPlanSummary = requiredPayloadString(
    payload,
    'rollback_plan_summary',
    'rollback_plan_summary',
    12,
    1000,
  );
  if (rollbackPlanSummary instanceof Response) return rollbackPlanSummary;

  const breakGlassReason = requiredPayloadString(
    payload,
    'break_glass_reason',
    'break_glass_reason',
    12,
    1000,
  );
  if (breakGlassReason instanceof Response) return breakGlassReason;

  return {
    customer_authorization_ref: customerAuthorizationRef,
    rollback_owner_email: rollbackOwnerEmail.toLowerCase(),
    rollback_plan_summary: rollbackPlanSummary,
    break_glass_reason: breakGlassReason,
  };
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

function enterpriseBusinessLoginLinks(
  env: EnterpriseControlPlaneEnv,
  organizationId: string,
  companyDomain?: string | null,
): Array<{
  label: string;
  href: string;
}> {
  const host = env.enterpriseHostname || 'enterprise.vaultproof.dev';
  const base = `https://${host}`;
  const org = encodeURIComponent(organizationId);
  const links = [{
    label: 'Business login',
    href: `${base}/app/login?org=${org}`,
  }, {
    label: 'Business dashboard',
    href: `${base}/app/dashboard?org=${org}`,
  }];

  const normalizedDomain = normalizeDomain(companyDomain || '');
  if (normalizedDomain && isValidDomain(normalizedDomain)) {
    links.push({
      label: 'SSO login',
      href: `${base}/app/login?sso_domain=${encodeURIComponent(normalizedDomain)}&org=${org}`,
    });
  }

  return links;
}

export function renderInternalAdminPage(env: EnterpriseControlPlaneEnv = {}): string {
  return injectEnterpriseAnalytics(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>VaultProof Internal Admin</title>
  <style>
    :root { color-scheme: light; --bg:#f5f7fb; --bg-mid:#e9eff5; --paper:#fff; --panel:rgba(255,255,255,.86); --panel-strong:rgba(255,255,255,.98); --card-bg:#fff; --row-bg:#f8fafc; --surface:#eef3f7; --line:rgba(26,40,52,.14); --line-soft:rgba(26,40,52,.08); --text:#17202a; --muted:#526170; --soft:#7a8794; --gold:#315f95; --accent:#315f95; --accent-soft:rgba(49, 95, 149, .12); --green:#15803d; --red:#dc2626; --blue:#2563eb; --warn:#b45309; --ink:#fff; --primary-bg:#315f95; --primary-text:#ffffff; --primary-border:#315f95; --control-bg:rgba(255,255,255,.92); --option-bg:#fff; --option-text:#17202a; --sidebar-bg:#18201f; --sidebar-card-bg:#101615; --sidebar-text:#fff; --sidebar-muted:rgba(188,216,210,.74); --sidebar-link:rgba(255,255,255,.88); --sidebar-link-active-bg:rgba(49, 95, 149, .16); --sidebar-link-active-border:rgba(111, 158, 213, .42); --sidebar-line:rgba(111, 158, 213, .18); --shadow:0 18px 54px rgba(26,40,52,.10); }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-weight:400; color:var(--text); background:var(--bg); }
    a { color: inherit; text-decoration: none; }
    .shell { display:grid; grid-template-columns:300px minmax(0, 1fr); gap:20px; min-height:100vh; max-width:1480px; margin:0 auto; padding:16px 24px; }
    .sidebar { border:1px solid var(--sidebar-line); background:var(--sidebar-bg); color:var(--sidebar-text); border-radius:8px; padding:16px; position:sticky; top:16px; align-self:start; max-height:calc(100vh - 32px); overflow:auto; box-shadow:0 24px 70px rgba(26,40,52,.22); }
    .brand { display:flex; gap:12px; align-items:center; margin-bottom:14px; padding:4px 4px 16px; border-bottom:1px solid rgba(255,255,255,.1); }
    .mark { width:38px; height:38px; border-radius:14px; display:grid; place-items:center; background:var(--primary-bg); color:var(--primary-text); font-weight:700; }
    .brand-title { font-weight:600; font-size:16px; line-height:1.12; letter-spacing:0; color:var(--sidebar-text); }
    .brand-sub { color:#6f9ed5; font-size:12px; margin-top:4px; font-weight:400; letter-spacing:.16em; text-transform:uppercase; }
    .nav-label { color:rgba(255,255,255,.35); font-size:11px; font-weight:400; text-transform:uppercase; letter-spacing:.18em; margin:16px 0 8px 10px; }
    .nav-link { display:flex; justify-content:space-between; gap:10px; padding:10px 12px; border-radius:8px; color:var(--sidebar-link); border:1px solid rgba(255,255,255,.08); margin-bottom:5px; font-size:14px; font-weight:600; line-height:1.25; }
    .nav-link:hover, .nav-link.active { background:var(--sidebar-link-active-bg); border-color:var(--sidebar-link-active-border); color:var(--sidebar-text); }
    .sidebar .tag { color:#6f9ed5; border-color:rgba(111, 158, 213, .34); background:rgba(111, 158, 213, .08); }
    .sidebar-note { margin-top:18px; border:1px solid rgba(255,255,255,.1); border-radius:8px; padding:14px; color:rgba(255,255,255,.7); background:rgba(255,255,255,.07); font-size:12px; line-height:1.45; }
    .main { min-width:0; padding:20px; max-width:none; width:100%; background:#fff; border:1px solid var(--line); border-radius:8px; box-shadow:var(--shadow); }
    .topbar { display:flex; justify-content:space-between; gap:18px; align-items:flex-start; margin-bottom:22px; }
    .eyebrow { display:inline-flex; color:var(--green); background:rgba(21,128,61,.1); border:1px solid rgba(21,128,61,.18); border-radius:999px; padding:6px 9px; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.16em; }
    h1 { margin:12px 0; font-size:2.6rem; line-height:1.08; font-weight:600; letter-spacing:0; max-width:760px; }
    .lead { color:var(--muted); max-width:780px; line-height:1.6; }
    button, select, input, textarea { border:1px solid var(--line); background:var(--control-bg); color:var(--text); border-radius:8px; padding:11px 12px; font:inherit; }
    option { background:var(--option-bg); color:var(--option-text); }
    textarea { resize:vertical; min-height:86px; }
    button { cursor:pointer; }
    .primary { background:var(--primary-bg); color:var(--primary-text); border-color:var(--primary-border); font-weight:600; }
    .toolbar { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:10px; }
    .grid { display:grid; gap:16px; }
    .kpis { grid-template-columns:repeat(5, minmax(0,1fr)); margin-bottom:16px; }
    .two { grid-template-columns:minmax(0,1fr) minmax(360px,.8fr); }
    .card { border:1px solid var(--line); border-radius:8px; padding:20px; background:var(--card-bg); box-shadow:var(--shadow); }
    .control-center { margin-bottom:16px; overflow:hidden; }
    .control-title { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; margin-bottom:16px; }
    .control-title h2 { margin:0; font-size:22px; font-weight:600; letter-spacing:0; }
    .control-title p { margin:6px 0 0; color:var(--muted); max-width:760px; line-height:1.5; }
    .control-kpis { display:grid; grid-template-columns:1.25fr repeat(4, minmax(0,1fr)); gap:12px; margin-bottom:16px; }
    .control-kpi { border:1px solid var(--line-soft); border-radius:8px; padding:15px; background:var(--row-bg); min-width:0; }
    .control-kpi.main { background:var(--accent-soft); border-color:rgba(49, 95, 149, .22); }
    .control-chart-grid { display:grid; grid-template-columns:minmax(0,1.1fr) minmax(0,1fr); gap:14px; }
    .control-chart-grid.visual { grid-template-columns:minmax(0,1.45fr) minmax(320px,.75fr); }
    .control-panel { border:1px solid var(--line-soft); border-radius:8px; padding:16px; background:var(--row-bg); min-width:0; }
    .control-panel h3 { margin:0; font-size:16px; font-weight:600; letter-spacing:0; }
    .chart-shell { margin-top:14px; min-height:220px; border:1px solid var(--line-soft); border-radius:8px; background:#fff; padding:14px; display:grid; align-items:end; overflow:hidden; }
    .sparkline-chart { width:100%; height:220px; display:block; }
    .sparkline-axis { color:var(--muted); font-size:11px; display:flex; justify-content:space-between; gap:10px; margin-top:8px; }
    .donut-wrap { display:grid; grid-template-columns:132px 1fr; gap:14px; align-items:center; margin-top:14px; }
    .donut-chart { width:132px; height:132px; border-radius:999px; display:grid; place-items:center; background:conic-gradient(var(--green) 0deg, var(--green) 1deg, rgba(26,40,52,.10) 1deg, rgba(26,40,52,.10) 360deg); }
    .donut-hole { width:76px; height:76px; border-radius:999px; background:#fff; display:grid; place-items:center; text-align:center; border:1px solid var(--line-soft); color:var(--text); font-weight:600; }
    .donut-hole span { display:block; color:var(--muted); font-size:11px; font-weight:400; margin-top:2px; }
    .legend-list { display:grid; gap:8px; }
    .legend-item { display:flex; justify-content:space-between; gap:10px; color:var(--muted); font-size:12px; }
    .legend-item strong { color:var(--text); font-weight:600; }
    .legend-dot { width:9px; height:9px; border-radius:999px; display:inline-block; margin-right:7px; }
    .stacked-bar { display:flex; height:18px; overflow:hidden; border-radius:999px; background:rgba(26,40,52,.10); margin-top:14px; }
    .stacked-segment { min-width:0; transition:width 160ms ease; }
    .chart-summary { color:var(--muted); font-size:12px; line-height:1.45; margin-top:10px; }
    .chart-list { display:grid; gap:11px; margin-top:14px; }
    .chart-row { display:grid; gap:6px; }
    .chart-row-head { display:flex; justify-content:space-between; gap:12px; color:var(--muted); font-size:12px; }
    .chart-row-head strong { color:var(--text); font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .chart-track { height:11px; border-radius:999px; background:rgba(26,40,52,.12); overflow:hidden; }
    .chart-bar { height:100%; width:0; border-radius:999px; background:linear-gradient(90deg, var(--green), var(--blue)); }
    .chart-bar.gold { background:linear-gradient(90deg, var(--primary-bg), var(--green)); }
    .chart-bar.warn { background:linear-gradient(90deg, var(--warn), var(--red)); }
    .chart-empty { color:var(--muted); border:1px dashed var(--line); border-radius:16px; padding:14px; background:var(--row-bg); font-size:13px; }
    .kpi-label { color:var(--soft); font-size:12px; font-weight:400; text-transform:uppercase; letter-spacing:0; }
    .kpi-value { font-size:34px; font-weight:600; letter-spacing:0; margin-top:8px; }
    .kpi-sub { color:var(--muted); font-size:13px; margin-top:6px; }
    .section-title { display:flex; justify-content:space-between; gap:12px; align-items:center; margin-bottom:14px; }
    .section-title h2 { margin:0; font-size:19px; font-weight:600; letter-spacing:0; }
    .mini { color:var(--muted); font-size:13px; }
    .list { display:grid; gap:10px; }
    .row { display:grid; grid-template-columns:1fr auto; gap:14px; align-items:start; border:1px solid var(--line-soft); border-radius:17px; padding:14px; background:var(--row-bg); }
    .row-title { font-weight:600; letter-spacing:0; }
    .row-sub { color:var(--muted); font-size:13px; margin-top:5px; line-height:1.45; }
    .row-sub.good { color:var(--green); }
    .row-sub.bad { color:var(--red); }
    .tag { display:inline-block; color:var(--blue); border:1px solid rgba(37,99,235,.24); border-radius:999px; padding:5px 8px; font-size:12px; margin:3px 4px 0 0; white-space:nowrap; }
    .tag.good { color:var(--green); border-color:rgba(62,93,87,.24); }
    .tag.warn { color:var(--warn); border-color:rgba(180,83,9,.30); }
    .tag.bad { color:var(--red); border-color:rgba(220,38,38,.28); }
    .notice, .empty { color:var(--muted); border:1px dashed var(--line); border-radius:18px; padding:18px; background:var(--row-bg); }
    .notice.error { color:var(--red); border-color:rgba(220,38,38,.3); }
    .actions { display:flex; gap:10px; flex-wrap:wrap; margin-top:14px; }
    .action { border:1px solid var(--line); border-radius:14px; padding:10px 12px; background:var(--control-bg); color:var(--text); }
    .admin-action-panel { display:grid; gap:16px; margin-top:4px; }
    .action-grid { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:14px; }
    .action-form { border:1px solid var(--line-soft); border-radius:18px; padding:16px; background:var(--row-bg); display:grid; gap:12px; }
    .action-form h3 { margin:0; font-size:16px; font-weight:600; letter-spacing:0; }
    .field { display:grid; gap:6px; color:var(--soft); font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:0; }
    .field input, .field select, .field textarea { width:100%; color:var(--text); font-size:14px; font-weight:500; text-transform:none; letter-spacing:0; }
    .form-row { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
    .form-status { color:var(--muted); font-size:13px; min-height:18px; }
    .form-status.good { color:var(--green); }
    .form-status.bad { color:var(--red); }
    .admin-actions-toolbar { display:grid; grid-template-columns:minmax(220px, 360px) 1fr; gap:12px; align-items:end; }
    .danger { color:#fff; background:var(--red); border:0; }
    .inline-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:8px; }
    .link-stack { display:flex; flex-wrap:wrap; gap:7px; margin-top:8px; }
    .create-business { margin-bottom:16px; }
    @media (max-width: 1050px) { .shell { grid-template-columns:1fr; padding:12px; } .sidebar { position:relative; top:0; max-height:none; height:auto; order:2; } .main { order:1; } .topbar { flex-direction:column; } .toolbar { justify-content:flex-start; } .kpis, .two, .action-grid, .admin-actions-toolbar, .form-row, .control-kpis, .control-chart-grid, .control-chart-grid.visual, .donut-wrap { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><div class="mark">VP</div><div><div class="brand-title">VaultProof Internal</div><div class="brand-sub">employee admin console</div></div></div>
      <div class="nav-label">manage</div>
      <a class="nav-link active" href="#control-center"><span>Control Center</span><span class="tag">live</span></a>
      <a class="nav-link" href="#business-create"><span>Create business</span></a>
      <a class="nav-link" href="#businesses"><span>Businesses</span><span class="tag">read</span></a>
      <a class="nav-link" href="#users"><span>Users</span></a>
      <a class="nav-link" href="#sso"><span>SSO</span></a>
      <a class="nav-link" href="#support"><span>Support</span></a>
      <a class="nav-link" href="#org-detail"><span>Org detail</span></a>
      <div class="nav-label">proof</div>
      <a class="nav-link" href="/app/launch"><span>Launch board</span><span class="tag">staff</span></a>
      <a class="nav-link" href="/app/demo"><span>Buyer walkthrough</span><span class="tag">staff</span></a>
      <a class="nav-link" href="/app/onboarding"><span>Paid onboarding</span><span class="tag">staff</span></a>
      <a class="nav-link" href="/app/org"><span>Org workspace</span><span class="tag">staff</span></a>
      <a class="nav-link" href="/app/support"><span>Support room</span><span class="tag">staff</span></a>
      <a class="nav-link" href="/app/pilot"><span>Pilot proposal</span><span class="tag">staff</span></a>
      <a class="nav-link" href="/app/pilot-success"><span>Pilot success</span><span class="tag">staff</span></a>
      <a class="nav-link" href="#runtime"><span>Runtime</span></a>
      <a class="nav-link" href="#audit"><span>Audit</span></a>
    </aside>
    <main class="main">
      <div class="topbar">
        <div>
          <h1>Enterprise customer operations</h1>
          <p class="lead">Add businesses, invite business admins, set SSO, and copy the correct per-business login link without entering the customer-facing dashboard.</p>
        </div>
        <div class="toolbar">
          <button id="refreshBtn" class="primary" type="button">refresh</button>
          <a class="action" href="/app/launch">launch board</a>
          <a class="action" href="/app/demo">walkthrough</a>
          <a class="action" href="/app/onboarding">onboarding</a>
          <a class="action" href="/app/org">org workspace</a>
          <a class="action" href="/app/support">support</a>
          <a class="action" href="/app/pilot">pilot proposal</a>
          <a class="action" href="/app/pilot-success">pilot success</a>
        </div>
      </div>

      <div id="notice" class="notice error" style="display:none"></div>

      <section class="card control-center" id="control-center">
        <div class="control-title">
          <div>
            <div class="eyebrow">internal control center</div>
            <h2>Control Center</h2>
            <p>Enterprise business command view for signed-on businesses, users, SSO rollout, pending invites, and API proxy traffic across customer projects.</p>
          </div>
          <span id="controlApiMeta" class="tag">loading traffic</span>
        </div>
        <div class="control-kpis">
          <div class="control-kpi main"><div class="kpi-label">total API calls</div><div id="controlTotalCalls" class="kpi-value">...</div><div class="kpi-sub">from access-log rollups</div></div>
          <div class="control-kpi"><div class="kpi-label">signed-on businesses</div><div id="controlSignedBusinesses" class="kpi-value">...</div><div class="kpi-sub">with at least one user</div></div>
          <div class="control-kpi"><div class="kpi-label">users</div><div id="controlUsers" class="kpi-value">...</div><div class="kpi-sub">all memberships</div></div>
          <div class="control-kpi"><div class="kpi-label">SSO ready</div><div id="controlSso" class="kpi-value">...</div><div class="kpi-sub">configured businesses</div></div>
          <div class="control-kpi"><div class="kpi-label">pending invites</div><div id="controlPendingInvites" class="kpi-value">...</div><div class="kpi-sub">customer access follow-up</div></div>
        </div>
        <div class="control-chart-grid visual">
          <div class="control-panel">
            <div class="section-title"><h3>API call trend</h3><span id="apiTrendMeta" class="mini">daily rollup</span></div>
            <div id="apiTrendChart" class="chart-shell"><div class="chart-empty">Loading API trend chart...</div></div>
          </div>
          <div class="control-panel">
            <div class="section-title"><h3>Account mix</h3><span class="mini">business status</span></div>
            <div id="accountMixDonut" class="donut-wrap"><div class="chart-empty">Loading account mix...</div></div>
          </div>
        </div>
        <div class="control-chart-grid" style="margin-top:14px">
          <div class="control-panel">
            <div class="section-title"><h3>Businesses and users</h3><span class="mini">signed-on status</span></div>
            <div id="businessUserChart" class="chart-list"><div class="chart-empty">Loading business sign-on chart...</div></div>
          </div>
          <div class="control-panel">
            <div class="section-title"><h3>API calls by business</h3><span class="mini">total proxy usage</span></div>
            <div id="businessCallChart" class="chart-list"><div class="chart-empty">Loading API call chart...</div></div>
          </div>
        </div>
        <div class="control-chart-grid" style="margin-top:14px">
          <div class="control-panel">
            <div class="section-title"><h3>Traffic health</h3><span class="mini">success, error, denied</span></div>
            <div id="trafficHealthChart" class="chart-list"><div class="chart-empty">Loading traffic health...</div></div>
          </div>
          <div class="control-panel">
            <div class="section-title"><h3>Launch blockers</h3><span class="mini">chart view</span></div>
            <div id="blockerChart" class="chart-list"><div class="chart-empty">Loading blocker chart...</div></div>
          </div>
        </div>
      </section>

      <section class="grid kpis" id="runtime">
        <div class="card"><div class="kpi-label">businesses</div><div id="kpiBusinesses" class="kpi-value">...</div><div class="kpi-sub">active team orgs</div></div>
        <div class="card"><div class="kpi-label">users</div><div id="kpiUsers" class="kpi-value">...</div><div class="kpi-sub">org memberships</div></div>
        <div class="card"><div class="kpi-label">projects</div><div id="kpiProjects" class="kpi-value">...</div><div class="kpi-sub">active customer scopes</div></div>
        <div class="card"><div class="kpi-label">pending invites</div><div id="kpiInvites" class="kpi-value">...</div><div class="kpi-sub">need follow-up</div></div>
        <div class="card"><div class="kpi-label">SSO configured</div><div id="kpiSso" class="kpi-value">...</div><div class="kpi-sub">team orgs</div></div>
      </section>

      <section class="card create-business" id="business-create">
        <div class="section-title"><h2>Create business</h2><span class="mini">staff approval required</span></div>
        <form id="createBusinessForm" class="action-form">
          <div class="form-row">
            <label class="field">business name<input name="name" placeholder="Acme Security"></label>
            <label class="field">owner email<input name="owner_email" type="email" placeholder="admin@customer.com"></label>
          </div>
          <div class="form-row">
            <label class="field">company domain<input name="company_domain" placeholder="customer.com"></label>
            <label class="field">slug<input name="slug" placeholder="acme-security"></label>
          </div>
          <div class="form-row">
            <label class="field">SSO provider<select name="sso_provider"><option value="microsoft-entra">microsoft-entra</option><option value="okta">okta</option><option value="google-workspace">google-workspace</option><option value="generic-saml">generic-saml</option><option value="supabase-saml">supabase-saml</option></select></label>
            <label class="field">approval secret<input id="businessApprovalSecret" type="password" autocomplete="off" placeholder="required for writes"></label>
          </div>
          <button class="primary" type="submit">create business</button>
          <div id="businessCreateStatus" class="form-status"></div>
        </form>
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
        <div class="section-title"><h2>Business detail</h2><span id="orgDetailMeta" class="mini">approval-gated actions</span></div>
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
      function percent(value, max) {
        var numeric = Number(value || 0);
        var maximum = Number(max || 0);
        if (!Number.isFinite(numeric) || !Number.isFinite(maximum) || maximum <= 0) return '0%';
        return Math.max(0, Math.min(100, Math.round((numeric / maximum) * 100))) + '%';
      }
      function businessLabel(biz) {
        return biz && (biz.name || biz.slug || biz.id) ? (biz.name || biz.slug || biz.id) : 'Business';
      }
      function notice(message) {
        var el = byId('notice');
        if (!el) return;
        el.style.display = message ? 'block' : 'none';
        el.textContent = message || '';
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
      function chartRow(title, metric, value, max, tone) {
        return '<div class="chart-row"><div class="chart-row-head"><strong>' + escapeHtml(title) + '</strong><span>' + escapeHtml(metric) + '</span></div><div class="chart-track"><div class="chart-bar ' + escapeHtml(tone || '') + '" style="width:' + percent(value, max) + '"></div></div></div>';
      }
      function dayLabel(value) {
        if (!value) return '';
        var date = new Date(value + 'T00:00:00Z');
        if (!Number.isFinite(date.getTime())) return String(value).slice(5);
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
      }
      function renderTrendChart(rows) {
        var trend = Array.isArray(rows) ? rows.slice(-14) : [];
        var total = trend.reduce(function(sum, row) { return sum + Number(row.call_count || 0); }, 0);
        if (!trend.length || total <= 0) {
          return '<div class="chart-empty">No daily API call trend is available yet.</div>';
        }
        var width = 640;
        var height = 190;
        var topPad = 16;
        var bottom = 176;
        var maxCalls = Math.max.apply(null, [1].concat(trend.map(function(row) { return Number(row.call_count || 0); })));
        var step = trend.length > 1 ? width / (trend.length - 1) : width;
        var points = trend.map(function(row, index) {
          var x = trend.length > 1 ? Math.round(index * step) : Math.round(width / 2);
          var y = Math.round(bottom - ((Number(row.call_count || 0) / maxCalls) * (bottom - topPad)));
          return { x: x, y: y, calls: Number(row.call_count || 0), day: row.day || '' };
        });
        var line = points.map(function(point, index) {
          return (index === 0 ? 'M' : 'L') + point.x + ' ' + point.y;
        }).join(' ');
        var area = line + ' L ' + points[points.length - 1].x + ' ' + bottom + ' L ' + points[0].x + ' ' + bottom + ' Z';
        var circles = points.map(function(point) {
          return '<circle cx="' + point.x + '" cy="' + point.y + '" r="4"><title>' + escapeHtml(dayLabel(point.day) + ': ' + number(point.calls) + ' calls') + '</title></circle>';
        }).join('');
        var first = trend[0] ? dayLabel(trend[0].day) : '';
        var last = trend[trend.length - 1] ? dayLabel(trend[trend.length - 1].day) : '';
        return '<div><svg class="sparkline-chart" viewBox="0 0 ' + width + ' 220" role="img" aria-label="Daily API call trend"><path d="M0 ' + bottom + ' H' + width + '" fill="none" stroke="rgba(26,40,52,.12)" stroke-width="1"></path><path d="' + area + '" fill="rgba(49, 95, 149, .18)"></path><path d="' + line + '" fill="none" stroke="#315f95" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></path><g fill="#ffffff" stroke="#315f95" stroke-width="3">' + circles + '</g></svg><div class="sparkline-axis"><span>' + escapeHtml(first) + '</span><span>peak ' + number(maxCalls) + ' calls</span><span>' + escapeHtml(last) + '</span></div></div>';
      }
      function renderDonut(items, center, label) {
        var total = items.reduce(function(sum, item) { return sum + Number(item.value || 0); }, 0);
        if (total <= 0) {
          return '<div class="chart-empty">No account status data is visible yet.</div>';
        }
        var cursor = 0;
        var segments = items.map(function(item) {
          var start = cursor;
          var size = (Number(item.value || 0) / total) * 360;
          cursor += size;
          return item.color + ' ' + Math.round(start) + 'deg ' + Math.round(cursor) + 'deg';
        }).join(', ');
        var legend = items.map(function(item) {
          return '<div class="legend-item"><span><span class="legend-dot" style="background:' + escapeHtml(item.color) + '"></span>' + escapeHtml(item.label) + '</span><strong>' + number(item.value) + '</strong></div>';
        }).join('');
        return '<div class="donut-chart" style="background:conic-gradient(' + segments + ')"><div class="donut-hole">' + escapeHtml(center) + '<span>' + escapeHtml(label) + '</span></div></div><div class="legend-list">' + legend + '</div>';
      }
      function renderStackedBar(items, total) {
        var maximum = Number(total || 0);
        if (maximum <= 0) return '';
        return '<div class="stacked-bar">' + items.map(function(item) {
          return '<span class="stacked-segment" style="width:' + percent(item.value, maximum) + ';background:' + escapeHtml(item.color) + '"></span>';
        }).join('') + '</div>';
      }
      function renderControlCenter(payload) {
        var summary = payload.summary || {};
        var businesses = Array.isArray(payload.businesses) ? payload.businesses : [];
        var activeBusinesses = businesses.filter(function(biz) { return !biz.archived_at; });
        var signedOnBusinesses = activeBusinesses.filter(function(biz) { return Number(biz.member_count || 0) > 0; });
        var noUserBusinesses = activeBusinesses.filter(function(biz) { return Number(biz.member_count || 0) === 0; });
        var ssoReadyBusinesses = activeBusinesses.filter(function(biz) { return biz.sso && biz.sso.status === 'configured'; });
        var pendingInviteBusinesses = activeBusinesses.filter(function(biz) { return Number(biz.pending_invitation_count || 0) > 0; });
        var archivedBusinesses = businesses.filter(function(biz) { return biz.archived_at; });
        var totalCalls = Number(summary.total_api_call_count || 0);
        var errorCalls = Number(summary.api_error_count || 0);
        var deniedCalls = Number(summary.api_denied_count || 0);
        var nonDeniedErrors = Math.max(0, errorCalls - deniedCalls);
        var successCalls = Math.max(0, totalCalls - errorCalls);

        text('controlTotalCalls', number(totalCalls));
        text('controlSignedBusinesses', number(signedOnBusinesses.length) + '/' + number(activeBusinesses.length));
        text('controlUsers', number(summary.membership_count));
        text('controlSso', number(summary.sso_configured_count));
        text('controlPendingInvites', number(summary.pending_invitation_count));
        text('controlApiMeta', (summary.api_call_source === 'rollup_table' ? 'rollup-backed' : 'traffic sample') + ' - ' + number(totalCalls) + ' calls');
        text('apiTrendMeta', (Array.isArray(payload.api_call_trend) ? payload.api_call_trend.length : 0) + ' daily buckets');
        byId('apiTrendChart').innerHTML = renderTrendChart(payload.api_call_trend);
        byId('accountMixDonut').innerHTML = renderDonut([
          { label: 'Signed on', value: signedOnBusinesses.length, color: '#15803d' },
          { label: 'No users yet', value: noUserBusinesses.length, color: '#b45309' },
          { label: 'Archived', value: archivedBusinesses.length, color: '#dc2626' }
        ], number(activeBusinesses.length), 'active');

        var userMax = Math.max.apply(null, [1].concat(activeBusinesses.map(function(biz) { return Number(biz.member_count || 0); })));
        var businessUserRows = activeBusinesses
          .slice()
          .sort(function(left, right) { return Number(right.member_count || 0) - Number(left.member_count || 0); })
          .slice(0, 8)
          .map(function(biz) {
            var users = Number(biz.member_count || 0);
            var status = users > 0 ? 'signed on' : 'no users yet';
            return chartRow(businessLabel(biz), number(users) + ' users - ' + status, users, userMax, users > 0 ? '' : 'warn');
          })
          .join('');
        byId('businessUserChart').innerHTML = businessUserRows || '<div class="chart-empty">No businesses are visible yet.</div>';

        var callRows = activeBusinesses
          .slice()
          .sort(function(left, right) { return Number(right.api_call_count || 0) - Number(left.api_call_count || 0); })
          .slice(0, 8);
        var callMax = Math.max.apply(null, [1].concat(callRows.map(function(biz) { return Number(biz.api_call_count || 0); })));
        byId('businessCallChart').innerHTML = totalCalls > 0 ? callRows.map(function(biz) {
          var calls = Number(biz.api_call_count || 0);
          var last = biz.last_api_call_at ? ' - last ' + rel(biz.last_api_call_at) : '';
          return chartRow(businessLabel(biz), number(calls) + ' calls' + last, calls, callMax, 'gold');
        }).join('') : '<div class="chart-empty">No API proxy calls are recorded in the admin snapshot yet.</div>';

        var trafficRows = [
          { title: 'Successful calls', metric: number(successCalls), value: successCalls, tone: '', color: '#15803d' },
          { title: 'Provider/app errors', metric: number(nonDeniedErrors), value: nonDeniedErrors, tone: 'warn', color: '#b45309' },
          { title: 'Denied by policy', metric: number(deniedCalls), value: deniedCalls, tone: 'warn', color: '#dc2626' }
        ];
        var trafficMax = Math.max.apply(null, [1].concat(trafficRows.map(function(item) { return item.value; })));
        byId('trafficHealthChart').innerHTML = totalCalls > 0 ? renderStackedBar(trafficRows, totalCalls) + trafficRows.map(function(item) {
          return chartRow(item.title, item.metric, item.value, trafficMax, item.tone);
        }).join('') + '<div class="chart-summary">' + number(totalCalls) + ' total calls across visible businesses.</div>' : '<div class="chart-empty">Traffic health appears after the API proxy records calls.</div>';

        var blockerRows = [
          { title: 'Pending invites', metric: number(summary.pending_invitation_count), value: Number(summary.pending_invitation_count || 0), tone: 'warn' },
          { title: 'SSO not configured', metric: number(Math.max(0, activeBusinesses.length - ssoReadyBusinesses.length)), value: Math.max(0, activeBusinesses.length - ssoReadyBusinesses.length), tone: 'warn' },
          { title: 'No users yet', metric: number(noUserBusinesses.length), value: noUserBusinesses.length, tone: 'warn' },
          { title: 'Policy denials', metric: number(deniedCalls), value: deniedCalls, tone: 'warn' }
        ];
        var blockerMax = Math.max.apply(null, [1].concat(blockerRows.map(function(item) { return item.value; })));
        byId('blockerChart').innerHTML = blockerRows.map(function(item) {
          return chartRow(item.title, item.metric, item.value, blockerMax, item.tone);
        }).join('');
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
      function approvalSecret() {
        var input = byId('adminApprovalSecret') || byId('businessApprovalSecret');
        return input && input.value ? input.value.trim() : '';
      }
      function formValue(form, name) {
        var field = form && form.elements ? form.elements[name] : null;
        return field && typeof field.value === 'string' ? field.value.trim() : '';
      }
      function setActionStatus(message, tone) {
        var status = byId('adminActionStatus');
        if (!status) return;
        status.className = 'form-status ' + (tone || '');
        status.textContent = message || '';
      }
      function setCreateStatus(message, tone) {
        var status = byId('businessCreateStatus');
        if (!status) return;
        status.className = 'form-status ' + (tone || '');
        status.textContent = message || '';
      }
      async function postAdminAction(path, body) {
        var secret = approvalSecret();
        if (!secret) throw new Error('Approval secret is required for admin writes.');
        var response = await fetch(path, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
            'x-vaultproof-internal-admin-approval': secret
          },
          body: body ? JSON.stringify(body) : '{}'
        });
        var payload = await response.json().catch(function() { return null; });
        if (!response.ok) throw new Error((payload && payload.error) || 'Admin action failed.');
        return payload;
      }
      async function postAdminCheck(path, body) {
        var response = await fetch(path, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json'
          },
          body: body ? JSON.stringify(body) : '{}'
        });
        var payload = await response.json().catch(function() { return null; });
        if (!response.ok) throw new Error((payload && payload.error) || 'Admin check failed.');
        return payload;
      }
      function setSsoBrokerCheckStatus(message, tone) {
        var status = byId('ssoBrokerCheckStatus');
        if (!status) return;
        status.className = 'row-sub ' + (tone || '');
        status.textContent = message || '';
      }
      function tagList(items) {
        return (items || []).map(function(item) {
          var tone = item.status === 'done' || item.status === 'ready' ? 'good' : 'warn';
          return '<span class="tag ' + tone + '">' + escapeHtml(item.label || item.status || item) + '</span>';
        }).join('');
      }
      function linkTags(links) {
        return (links || []).map(function(link) {
          return '<a class="tag good" href="' + escapeHtml(link.href) + '">' + escapeHtml(link.label || 'link') + '</a>';
        }).join('');
      }
      function businessRow(biz) {
        var sso = biz.sso || {};
        var sub = (biz.owner_email || 'owner unknown') + ' - ' + number(biz.member_count) + ' users - ' + number(biz.active_project_count) + ' projects - ' + number(biz.api_call_count) + ' API calls - created ' + rel(biz.created_at);
        var links = linkTags(biz.business_login_links || []);
        return '<div class="row"><div><div class="row-title">' + escapeHtml(biz.name || biz.slug || biz.id) + '</div><div class="row-sub">' + escapeHtml(sub) + '</div><div class="link-stack">' + links + '</div></div><div><span class="tag ' + (sso.status === 'configured' ? 'good' : 'warn') + '">' + escapeHtml(sso.status === 'configured' ? 'SSO ready' : 'SSO todo') + '</span><a class="tag" href="/orgs/' + encodeURIComponent(biz.id) + '">detail</a></div></div>';
      }
      function roleOptions(selected) {
        return ['viewer', 'member', 'developer', 'auditor', 'iam_admin', 'security_admin', 'platform_admin', 'admin'].map(function(role) {
          return '<option value="' + role + '"' + (role === selected ? ' selected' : '') + '>' + role + '</option>';
        }).join('');
      }
      function renderAdminActionForms(org, pendingInvitations, currentStatus) {
        var sso = org.sso || {};
        var provider = sso.sso_provider || 'microsoft-entra';
        var loginMode = sso.login_mode || 'sso-first';
        var ssoStatus = sso.status || 'requested';
        var resendRevoke = pendingInvitations.length ? pendingInvitations.map(function(invite) {
          return '<div class="row"><div><div class="row-title">' + escapeHtml(invite.email) + '</div><div class="row-sub">' + escapeHtml(invite.role + ' invite created ' + rel(invite.created_at)) + '</div><div class="inline-actions"><button type="button" data-invite-action="resend" data-invite-id="' + escapeHtml(invite.id) + '">record resend</button><button class="danger" type="button" data-invite-action="revoke" data-invite-id="' + escapeHtml(invite.id) + '">revoke invite</button></div></div><span class="tag warn">pending</span></div>';
        }).join('') : '<div class="empty">No pending invites to resend or revoke.</div>';
        return '<div class="admin-action-panel" data-internal-admin-action="org-account-management">'
          + '<div class="admin-actions-toolbar"><label class="field">approval secret<input id="adminApprovalSecret" type="password" autocomplete="off" placeholder="required for writes"></label><div><div class="row-title">Enterprise account administration</div><div class="row-sub">Use this staff-only page only in the configured VaultProof staff admin system to set SSO metadata, invite admins, record account status, and keep support notes. Secrets and IdP private material stay out of these forms.</div><div id="adminActionStatus" class="form-status"></div></div></div>'
          + '<div class="action-grid">'
          + '<form id="ssoSettingsForm" class="action-form"><h3>SSO settings</h3><label class="field">company domain<input name="company_domain" value="' + escapeHtml(sso.company_domain || '') + '" placeholder="customer.com"></label><div class="form-row"><label class="field">provider<select name="sso_provider"><option value="microsoft-entra"' + (provider === 'microsoft-entra' ? ' selected' : '') + '>microsoft-entra</option><option value="okta"' + (provider === 'okta' ? ' selected' : '') + '>okta</option><option value="google-workspace"' + (provider === 'google-workspace' ? ' selected' : '') + '>google-workspace</option><option value="generic-saml"' + (provider === 'generic-saml' ? ' selected' : '') + '>generic-saml</option><option value="supabase-saml"' + (provider === 'supabase-saml' ? ' selected' : '') + '>supabase-saml</option></select></label><label class="field">rollout status<select name="status"><option value="requested"' + (ssoStatus === 'requested' ? ' selected' : '') + '>requested</option><option value="configured"' + (ssoStatus === 'configured' ? ' selected' : '') + '>configured</option></select></label></div><label class="field">login mode<select name="login_mode"><option value="sso-first"' + (loginMode === 'sso-first' ? ' selected' : '') + '>sso-first</option><option value="assisted"' + (loginMode === 'assisted' ? ' selected' : '') + '>assisted</option></select></label><div class="row"><div><div class="row-title">Supabase SAML broker check</div><div class="row-sub" id="ssoBrokerCheckStatus">Checks whether the company domain returns a real SSO redirect. If Supabase SAML is disabled, this will show blocked.</div></div><button type="button" id="ssoBrokerCheckBtn">check SSO start</button></div><button class="primary" type="submit">save SSO</button></form>'
          + '<form id="inviteForm" class="action-form"><h3>Invite enterprise user</h3><label class="field">email<input name="email" type="email" placeholder="identity.owner@customer.com"></label><label class="field">role<select name="role">' + roleOptions('iam_admin') + '</select></label><button class="primary" type="submit">create invite</button></form>'
          + '<form id="businessStatusForm" class="action-form"><h3>Account status</h3><div class="form-row"><label class="field">status<select name="status"><option value="onboarding"' + (currentStatus && currentStatus.status === 'onboarding' ? ' selected' : '') + '>onboarding</option><option value="active"' + (currentStatus && currentStatus.status === 'active' ? ' selected' : '') + '>active</option><option value="at_risk"' + (currentStatus && currentStatus.status === 'at_risk' ? ' selected' : '') + '>at_risk</option><option value="paused"' + (currentStatus && currentStatus.status === 'paused' ? ' selected' : '') + '>paused</option><option value="offboarding"' + (currentStatus && currentStatus.status === 'offboarding' ? ' selected' : '') + '>offboarding</option></select></label><label class="field">plan label<input name="plan_label" value="' + escapeHtml(currentStatus && currentStatus.plan_label ? currentStatus.plan_label : '') + '" placeholder="Enterprise Pilot"></label></div><label class="field">summary<textarea name="summary" placeholder="Current account status">' + escapeHtml(currentStatus && currentStatus.summary ? currentStatus.summary : '') + '</textarea></label><label class="field">next step<input name="next_step" value="' + escapeHtml(currentStatus && currentStatus.next_step ? currentStatus.next_step : '') + '" placeholder="Next customer/admin action"></label><button class="primary" type="submit">record status</button></form>'
          + '<form id="supportNoteForm" class="action-form"><h3>Support note</h3><label class="field">note type<select name="note_type"><option value="support_note">support_note</option><option value="onboarding">onboarding</option><option value="security">security</option><option value="billing">billing</option><option value="go_live">go_live</option></select></label><label class="field">note<textarea name="body" placeholder="Customer-visible context, no secrets"></textarea></label><button class="primary" type="submit">add note</button></form>'
          + '</div><div><div class="section-title"><h2>Pending invite controls</h2><span class="mini">approval-gated</span></div>' + resendRevoke + '</div></div>';
      }
      function bindOrgAdminActions(org) {
        var orgId = org && org.id ? org.id : '';
        if (!orgId) return;
        var ssoForm = byId('ssoSettingsForm');
        if (ssoForm) ssoForm.addEventListener('submit', async function(event) {
          event.preventDefault();
          try {
            setActionStatus('Saving SSO settings...', '');
            await postAdminAction('/api/v1/internal-admin/orgs/' + encodeURIComponent(orgId) + '/sso-settings', {
              company_domain: formValue(ssoForm, 'company_domain'),
              sso_provider: formValue(ssoForm, 'sso_provider'),
              status: formValue(ssoForm, 'status'),
              login_mode: formValue(ssoForm, 'login_mode')
            });
            setActionStatus('SSO settings saved and audited.', 'good');
            renderOrgDetail(await fetchOrgDetail(orgId));
          } catch (error) {
            setActionStatus(error && error.message ? error.message : 'SSO update failed.', 'bad');
          }
        });
        var ssoBrokerCheckBtn = byId('ssoBrokerCheckBtn');
        if (ssoBrokerCheckBtn && ssoForm) ssoBrokerCheckBtn.addEventListener('click', async function() {
          try {
            ssoBrokerCheckBtn.disabled = true;
            setSsoBrokerCheckStatus('Checking Supabase SAML broker...', '');
            var payload = await postAdminCheck('/api/v1/internal-admin/orgs/' + encodeURIComponent(orgId) + '/sso-start-check', {
              company_domain: formValue(ssoForm, 'company_domain')
            });
            var check = payload.sso_start_check || {};
            if (check.broker_status === 'ready') {
              setSsoBrokerCheckStatus('Ready: Supabase returned an IdP redirect for ' + (check.company_domain || 'this domain') + '.', 'good');
            } else {
              setSsoBrokerCheckStatus('Blocked: ' + (check.error || 'Supabase did not return an SSO redirect.'), 'bad');
            }
          } catch (error) {
            setSsoBrokerCheckStatus(error && error.message ? error.message : 'SSO start check failed.', 'bad');
          } finally {
            ssoBrokerCheckBtn.disabled = false;
          }
        });
        var inviteForm = byId('inviteForm');
        if (inviteForm) inviteForm.addEventListener('submit', async function(event) {
          event.preventDefault();
          try {
            setActionStatus('Creating invite...', '');
            await postAdminAction('/api/v1/internal-admin/orgs/' + encodeURIComponent(orgId) + '/invitations', {
              email: formValue(inviteForm, 'email'),
              role: formValue(inviteForm, 'role')
            });
            setActionStatus('Invite created and audited.', 'good');
            renderOrgDetail(await fetchOrgDetail(orgId));
          } catch (error) {
            setActionStatus(error && error.message ? error.message : 'Invite creation failed.', 'bad');
          }
        });
        var statusForm = byId('businessStatusForm');
        if (statusForm) statusForm.addEventListener('submit', async function(event) {
          event.preventDefault();
          try {
            setActionStatus('Recording account status...', '');
            await postAdminAction('/api/v1/internal-admin/orgs/' + encodeURIComponent(orgId) + '/status', {
              status: formValue(statusForm, 'status'),
              plan_label: formValue(statusForm, 'plan_label'),
              summary: formValue(statusForm, 'summary'),
              next_step: formValue(statusForm, 'next_step')
            });
            setActionStatus('Account status recorded and audited.', 'good');
            renderOrgDetail(await fetchOrgDetail(orgId));
          } catch (error) {
            setActionStatus(error && error.message ? error.message : 'Status update failed.', 'bad');
          }
        });
        var noteForm = byId('supportNoteForm');
        if (noteForm) noteForm.addEventListener('submit', async function(event) {
          event.preventDefault();
          try {
            setActionStatus('Adding support note...', '');
            await postAdminAction('/api/v1/internal-admin/orgs/' + encodeURIComponent(orgId) + '/support-notes', {
              note_type: formValue(noteForm, 'note_type'),
              body: formValue(noteForm, 'body')
            });
            setActionStatus('Support note added and audited.', 'good');
            renderOrgDetail(await fetchOrgDetail(orgId));
          } catch (error) {
            setActionStatus(error && error.message ? error.message : 'Support note failed.', 'bad');
          }
        });
        Array.prototype.forEach.call(document.querySelectorAll('[data-invite-action]'), function(button) {
          button.addEventListener('click', async function() {
            var inviteId = button.getAttribute('data-invite-id') || '';
            var action = button.getAttribute('data-invite-action') || '';
            if (!inviteId || !action) return;
            try {
              setActionStatus((action === 'revoke' ? 'Revoking' : 'Recording resend for') + ' invite...', '');
              await postAdminAction('/api/v1/internal-admin/orgs/' + encodeURIComponent(orgId) + '/invitations/' + encodeURIComponent(inviteId) + '/' + action, {});
              setActionStatus(action === 'revoke' ? 'Invite revoked and audited.' : 'Invite resend request recorded and audited.', 'good');
              renderOrgDetail(await fetchOrgDetail(orgId));
            } catch (error) {
              setActionStatus(error && error.message ? error.message : 'Invite action failed.', 'bad');
            }
          });
        });
      }
      function bindCreateBusinessForm() {
        var createForm = byId('createBusinessForm');
        if (!createForm) return;
        createForm.addEventListener('submit', async function(event) {
          event.preventDefault();
          try {
            setCreateStatus('Creating business...', '');
            var payload = await postAdminAction('/api/v1/internal-admin/orgs', {
              name: formValue(createForm, 'name'),
              owner_email: formValue(createForm, 'owner_email'),
              company_domain: formValue(createForm, 'company_domain'),
              slug: formValue(createForm, 'slug'),
              sso_provider: formValue(createForm, 'sso_provider'),
              login_mode: 'sso-first',
              sso_status: 'requested'
            });
            var links = payload && payload.business && Array.isArray(payload.business.business_login_links)
              ? payload.business.business_login_links
              : [];
            setCreateStatus('Business created. ' + (links[0] ? links[0].href : 'Open it from the business list.'), 'good');
            createForm.reset();
            await load();
          } catch (error) {
            setCreateStatus(error && error.message ? error.message : 'Business creation failed.', 'bad');
          }
        });
      }
      function renderOrgDetail(payload) {
        var section = byId('org-detail');
        if (!section) return;
        section.style.display = 'block';
        var org = payload.business || {};
        text('orgDetailMeta', (org.name || org.slug || org.id || 'business') + ' - approval-gated actions');
        var ssoChecklist = Array.isArray(payload.sso_checklist) ? payload.sso_checklist : [];
        var timeline = Array.isArray(payload.member_timeline) ? payload.member_timeline : [];
        var supportNotes = Array.isArray(payload.support_notes) ? payload.support_notes : [];
        var evidenceLinks = Array.isArray(payload.evidence_links) ? payload.evidence_links : [];
        var businessLoginLinks = Array.isArray(org.business_login_links) ? org.business_login_links : [];
        var invitations = Array.isArray(payload.invitations) ? payload.invitations : [];
        var pendingInvitations = invitations.filter(function(invite) { return invite.status === 'pending'; });
        var statusUpdates = Array.isArray(payload.business_status_updates) ? payload.business_status_updates : [];
        var currentStatus = statusUpdates[0] || null;
        var actionRequests = Array.isArray(payload.action_requests) ? payload.action_requests : [];
        var executionRecords = Array.isArray(payload.execution_records) ? payload.execution_records : [];
        var html = '';
        html += row(org.name || org.slug || org.id || 'Business', (org.owner_email || 'owner unknown') + ' - ' + number(org.member_count) + ' users - ' + number(org.active_project_count) + ' active projects', org.sso && org.sso.status === 'configured' ? 'SSO ready' : 'SSO todo', org.sso && org.sso.status === 'configured' ? 'good' : 'warn');
        html += renderAdminActionForms(org, pendingInvitations, currentStatus);
        html += '<div class="row"><div><div class="row-title">Business plan and status</div><div class="row-sub">' + (currentStatus ? escapeHtml((currentStatus.plan_label || 'plan not set') + ' - ' + currentStatus.summary + (currentStatus.next_step ? ' - next: ' + currentStatus.next_step : '') + ' - ' + rel(currentStatus.created_at)) : (payload.business_status_schema_ready ? 'No business status has been recorded yet.' : 'Business status table is not applied yet.')) + '</div></div><span class="tag ' + (currentStatus && currentStatus.status === 'active' ? 'good' : 'warn') + '">' + escapeHtml(currentStatus ? currentStatus.status : (payload.business_status_schema_ready ? 'not set' : 'pending')) + '</span></div>';
        html += '<div class="row"><div><div class="row-title">SSO setup checklist</div><div class="row-sub">' + ssoChecklist.map(function(item) { return escapeHtml(item.label + ': ' + item.detail); }).join('<br>') + '</div></div><div>' + tagList(ssoChecklist) + '</div></div>';
        html += '<div class="row"><div><div class="row-title">User/member timeline</div><div class="row-sub">' + (timeline.length ? timeline.slice(0, 8).map(function(item) { return escapeHtml(item.label + ' - ' + (item.detail || '') + ' - ' + rel(item.created_at)); }).join('<br>') : 'No member timeline events yet.') + '</div></div><span class="tag">timeline</span></div>';
        html += '<div class="row"><div><div class="row-title">Pending invitation actions</div><div class="row-sub">' + (pendingInvitations.length ? pendingInvitations.map(function(invite) { return escapeHtml(invite.email + ' as ' + invite.role + ' - API: POST /api/v1/internal-admin/orgs/' + org.id + '/invitations/' + invite.id + '/resend or /revoke'); }).join('<br>') : 'No pending invites for this business.') + '</div></div><span class="tag warn">approval gated</span></div>';
        html += '<div class="row"><div><div class="row-title">Business login links</div><div class="row-sub">Use these links for this specific business. The customer-facing app stays on enterprise.vaultproof.dev.</div><div class="link-stack">' + linkTags(businessLoginLinks) + '</div></div><span class="tag good">per business</span></div>';
        html += '<div class="row"><div><div class="row-title">Support notes</div><div class="row-sub">' + (supportNotes.length ? supportNotes.map(function(note) { return escapeHtml(note.note_type + ': ' + note.body + ' - ' + (note.created_by_email || 'employee') + ' - ' + rel(note.created_at)); }).join('<br>') : (payload.support_notes_schema_ready ? 'No support notes yet.' : 'Support notes table is not applied yet.')) + '</div></div><span class="tag ' + (payload.support_notes_schema_ready ? 'good' : 'warn') + '">' + (payload.support_notes_schema_ready ? 'ready' : 'pending') + '</span></div>';
        html += '<div class="row"><div><div class="row-title">Destructive action approvals</div><div class="row-sub">' + (actionRequests.length ? actionRequests.map(function(action) { return escapeHtml(action.action_type + ' - ' + action.status + ' - requested by ' + action.requested_by_email + ' - ' + action.reason + ' - ' + rel(action.created_at)); }).join('<br>') : (payload.action_requests_schema_ready ? 'No destructive action requests yet.' : 'Action request table is not applied yet.')) + '</div></div><span class="tag ' + (payload.action_requests_schema_ready ? 'warn' : 'bad') + '">' + (payload.action_requests_schema_ready ? 'approval required' : 'pending') + '</span></div>';
        html += '<div class="row"><div><div class="row-title">Destructive execution and rollback ledger</div><div class="row-sub">' + (executionRecords.length ? executionRecords.map(function(record) { var direction = record.preflight_result && record.preflight_result.action_direction === 'rollback' ? 'rollback plan' : 'execution plan'; return escapeHtml(direction + ' - ' + record.action_type + ' - ' + record.execution_mode + ' - ' + record.status + ' - by ' + record.executed_by_email + ' - ' + rel(record.created_at)); }).join('<br>') : (payload.execution_records_schema_ready ? 'No execution or rollback plans have been recorded yet.' : 'Execution record table is not applied yet.')) + '</div></div><span class="tag ' + (payload.execution_records_schema_ready ? 'warn' : 'bad') + '">' + (payload.execution_records_schema_ready ? 'dry-run only' : 'pending') + '</span></div>';
        html += '<div class="row"><div><div class="row-title">Evidence links</div><div class="row-sub">' + evidenceLinks.map(function(link) { return '<a class="tag" href="' + escapeHtml(link.href) + '">' + escapeHtml(link.label) + '</a>'; }).join('') + '</div></div><span class="tag good">links</span></div>';
        byId('orgDetailContent').innerHTML = html;
        bindOrgAdminActions(org);
      }
      function render(payload) {
        var summary = payload.summary || {};
        renderControlCenter(payload);
        text('kpiBusinesses', number(summary.active_business_count));
        text('kpiUsers', number(summary.membership_count));
        text('kpiProjects', number(summary.active_project_count));
        text('kpiInvites', number(summary.pending_invitation_count));
        text('kpiSso', number(summary.sso_configured_count));
        text('businessMeta', number((payload.businesses || []).length) + ' businesses visible');
        text('userMeta', number(summary.admin_membership_count) + ' admins/owners');
        text('ssoMeta', number(summary.sso_configured_count) + ' configured');

        var businesses = Array.isArray(payload.businesses) ? payload.businesses : [];
        byId('businessList').innerHTML = businesses.length ? businesses.map(businessRow).join('') : '<div class="empty">No businesses found.</div>';

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
      bindCreateBusinessForm();
      load();
    })();
  </script>
</body>
</html>`, env, 'internal-admin');
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

  const ssoSchemaReady = !isMissingOrganizationSsoSettingsTable(ssoResult.error);
  if (ssoResult.error && !ssoSchemaReady) {
    console.warn(`internal admin SSO settings read skipped: ${ssoResult.error.message}`);
  }

  const firstError = orgResult.error || memberResult.error || projectResult.error || inviteResult.error || (ssoSchemaReady ? ssoResult.error : null) || auditResult.error;
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
  const sso = ssoSchemaReady ? normalizeRows(ssoResult.data as MaybeArray<{
    organization_id: string;
    company_domain: string | null;
    sso_provider: string | null;
    login_mode: string | null;
    status: string | null;
    updated_at: string | null;
  }>)[0] || null : null;
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
    admin_actions_enabled: env.internalAdminActionsEnabled === true,
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
      business_login_links: enterpriseBusinessLoginLinks(env, organization.id, sso?.company_domain || null),
    },
    sso_schema_ready: ssoSchemaReady,
    migration_required: ssoSchemaReady ? null : 'Apply supabase/migrations/20260419010000_organization_sso_settings.sql',
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
      'Org detail reads are available to allowlisted employees.',
      auditWriteSucceeded
        ? 'Employee org-detail views are recorded in the internal admin audit stream.'
        : 'Internal admin audit migration is pending; org-detail views are allowed but not yet persisted.',
      'Support notes, invitations, and business status updates require internal admin actions to be enabled plus the approval secret header.',
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

async function findInternalAdminAuthUserByEmail(
  env: EnterpriseControlPlaneEnv,
  email: string,
): Promise<{ user: InternalAdminAuthUser | null; error: Response | null }> {
  const supabase = getSupabase(env);
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) {
      return {
        user: null,
        error: Response.json({ error: `Internal admin auth user lookup failed: ${error.message}` }, { status: 500 }),
      };
    }

    const users = Array.isArray(data?.users) ? data.users as InternalAdminAuthUser[] : [];
    const found = users.find((user) => user.email?.trim().toLowerCase() === email) || null;
    if (found) return { user: found, error: null };
    if (users.length < 1000) return { user: null, error: null };
  }
  return { user: null, error: null };
}

async function ensureInternalAdminBusinessOwnerUser(
  env: EnterpriseControlPlaneEnv,
  email: string,
  businessName: string,
  companyDomain: string | null,
): Promise<{
  user: InternalAdminAuthUser | null;
  delivery: 'existing_user' | 'supabase_invite_email_sent';
  error: Response | null;
}> {
  const existing = await findInternalAdminAuthUserByEmail(env, email);
  if (existing.error) {
    return { user: null, delivery: 'existing_user', error: existing.error };
  }
  if (existing.user) {
    return { user: existing.user, delivery: 'existing_user', error: null };
  }

  const redirectTo = `https://${env.enterpriseHostname || 'enterprise.vaultproof.dev'}/app/login`;
  const { data, error } = await getSupabase(env).auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: {
      vaultproof_enterprise_admin_invite: true,
      vaultproof_business_name: businessName,
      vaultproof_company_domain: companyDomain,
    },
  });
  if (error || !data.user) {
    return {
      user: null,
      delivery: 'supabase_invite_email_sent',
      error: Response.json({
        error: `Supabase owner invite failed${error?.message ? `: ${error.message}` : '.'}`,
      }, { status: 400 }),
    };
  }

  return {
    user: data.user as InternalAdminAuthUser,
    delivery: 'supabase_invite_email_sent',
    error: null,
  };
}

async function handleCreateInternalAdminBusiness(
  request: Request,
  env: EnterpriseControlPlaneEnv,
): Promise<Response> {
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

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 2 || name.length > 120) {
    return Response.json({ error: 'Business name must be between 2 and 120 characters.' }, { status: 400 });
  }

  const ownerEmail = normalizeInternalAdminEmail(body.owner_email);
  if (!ownerEmail) {
    return Response.json({ error: 'owner_email must be a valid email address.' }, { status: 400 });
  }

  const requestedSlug = typeof body.slug === 'string' ? normalizeSlug(body.slug) : normalizeSlug(name);
  const slug = requestedSlug || null;
  const companyDomain = normalizeDomain(typeof body.company_domain === 'string' ? body.company_domain : emailDomain(ownerEmail));
  if (companyDomain && !isValidDomain(companyDomain)) {
    return Response.json({ error: 'company_domain must be a valid domain.' }, { status: 400 });
  }

  const ssoProvider = normalizeInternalAdminSsoProvider(body.sso_provider || 'microsoft-entra');
  if (ssoProvider instanceof Response) return ssoProvider;
  const loginMode = validateInternalAdminSsoLoginMode(body.login_mode || 'sso-first');
  if (!loginMode) {
    return Response.json({ error: 'login_mode must be assisted or sso-first.' }, { status: 400 });
  }
  const ssoStatus = validateInternalAdminSsoStatus(body.sso_status || 'requested');
  if (!ssoStatus) {
    return Response.json({ error: 'sso_status must be requested or configured.' }, { status: 400 });
  }

  const supabase = getSupabase(env);
  if (slug) {
    const slugResult = await supabase
      .from('organizations')
      .select('id')
      .eq('slug', slug)
      .limit(1);
    if (slugResult.error) {
      return Response.json({ error: `Internal admin business slug lookup failed: ${slugResult.error.message}` }, { status: 500 });
    }
    if (normalizeRows(slugResult.data as MaybeArray<{ id: string }>).length) {
      return Response.json({ error: 'That business slug is already taken.' }, { status: 400 });
    }
  }

  const owner = await ensureInternalAdminBusinessOwnerUser(env, ownerEmail, name, companyDomain || null);
  if (owner.error) return owner.error;
  if (!owner.user?.id) {
    return Response.json({ error: 'Could not create or find the owner user.' }, { status: 500 });
  }

  const now = new Date().toISOString();
  const orgResult = await supabase
    .from('organizations')
    .insert({
      name,
      slug,
      kind: 'team',
      owner_user_id: owner.user.id,
      created_at: now,
      updated_at: now,
    })
    .select('id, name, slug, kind, owner_user_id, created_at, updated_at, archived_at')
    .single();

  if (orgResult.error || !orgResult.data) {
    const message = orgResult.error?.message?.includes('organizations_slug_lower_uidx')
      ? 'That business slug is already taken.'
      : `Internal admin business create failed${orgResult.error?.message ? `: ${orgResult.error.message}` : '.'}`;
    return Response.json({ error: message }, { status: 400 });
  }

  const organization = orgResult.data as {
    id: string;
    name: string | null;
    slug: string | null;
    kind: string;
    owner_user_id: string;
    created_at: string;
    updated_at: string | null;
    archived_at: string | null;
  };

  const membershipResult = await supabase
    .from('organization_members')
    .upsert({
      organization_id: organization.id,
      user_id: owner.user.id,
      role: 'owner',
      invited_by: authorized.auth.userId,
    }, {
      onConflict: 'organization_id,user_id',
    });
  if (membershipResult.error) {
    return Response.json({ error: `Internal admin owner membership create failed: ${membershipResult.error.message}` }, { status: 500 });
  }

  let sso: Record<string, unknown> | null = null;
  if (companyDomain) {
    const ssoResult = await supabase
      .from('organization_sso_settings')
      .upsert({
        organization_id: organization.id,
        company_domain: companyDomain,
        sso_provider: ssoProvider,
        admin_email: ownerEmail,
        status: ssoStatus,
        login_mode: loginMode,
        updated_at: now,
      }, { onConflict: 'organization_id' })
      .select('organization_id, company_domain, sso_provider, login_mode, status, created_at, updated_at')
      .single();
    if (ssoResult.error) {
      return Response.json({ error: `Internal admin SSO seed failed: ${ssoResult.error.message}` }, { status: 400 });
    }
    sso = ssoResult.data as Record<string, unknown>;
  }

  await writeGovernanceAuditEvent(env, {
    organization_id: organization.id,
    actor_user_id: authorized.auth.userId,
    actor_email: authorized.auth.email,
    event_type: 'organization_created',
    target_type: 'organization',
    target_id: organization.id,
    description: `Created enterprise business ${organization.name}`,
    metadata: {
      name: organization.name,
      slug: organization.slug,
      kind: organization.kind,
      owner_email: ownerEmail,
      company_domain: companyDomain || null,
      created_via: 'internal_admin',
    },
  });

  await writeInternalAdminAuditEvent(
    env,
    authorized.auth,
    request,
    'internal_admin_business_created',
    {
      organization_id: organization.id,
      owner_email: ownerEmail,
      company_domain: companyDomain || null,
      owner_delivery: owner.delivery,
      slug: organization.slug,
    },
  );

  return Response.json({
    business: {
      ...organization,
      owner_email: ownerEmail,
      sso,
      business_login_links: enterpriseBusinessLoginLinks(env, organization.id, companyDomain || null),
    },
    owner: {
      id: owner.user.id,
      email: ownerEmail,
      delivery: owner.delivery,
    },
    guardrails: [
      'Business creation requires the internal admin action gate and approval secret.',
      'The owner receives a Supabase invite email when the account did not already exist.',
      'The browser response includes business login URLs, not service-role keys, OAuth secrets, SAML secrets, or invite tokens.',
    ],
  }, {
    status: 201,
    headers: {
      'cache-control': 'no-store',
    },
  });
}

async function handleUpdateInternalAdminSsoSettings(
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

  const companyDomain = normalizeDomain(typeof body.company_domain === 'string' ? body.company_domain : '');
  if (!companyDomain) {
    return Response.json({ error: 'company_domain is required.' }, { status: 400 });
  }
  if (!isValidDomain(companyDomain)) {
    return Response.json({ error: 'company_domain must be a valid domain.' }, { status: 400 });
  }

  const ssoProvider = normalizeInternalAdminSsoProvider(body.sso_provider);
  if (ssoProvider instanceof Response) return ssoProvider;

  const status = validateInternalAdminSsoStatus(body.status || 'requested');
  if (!status) {
    return Response.json({ error: 'status must be requested or configured.' }, { status: 400 });
  }

  const loginMode = validateInternalAdminSsoLoginMode(body.login_mode || 'sso-first');
  if (!loginMode) {
    return Response.json({ error: 'login_mode must be assisted or sso-first.' }, { status: 400 });
  }

  const supabase = getSupabase(env);
  const orgResult = await supabase
    .from('organizations')
    .select('id, kind')
    .eq('id', orgId)
    .limit(1);
  if (orgResult.error) {
    return Response.json({ error: `Internal admin org lookup failed: ${orgResult.error.message}` }, { status: 500 });
  }
  const organization = normalizeRows(orgResult.data as MaybeArray<{ id: string; kind: string }>)[0];
  if (!organization) {
    return Response.json({ error: 'Organization not found.' }, { status: 404 });
  }
  if (organization.kind !== 'team') {
    return Response.json({ error: 'SSO settings are only available on enterprise team organizations.' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('organization_sso_settings')
    .upsert({
      organization_id: orgId,
      company_domain: companyDomain,
      sso_provider: ssoProvider,
      admin_email: null,
      status,
      login_mode: loginMode,
      updated_at: now,
    }, { onConflict: 'organization_id' })
    .select('organization_id, company_domain, sso_provider, login_mode, status, created_at, updated_at')
    .single();

  if (error || !data) {
    const message = error?.message?.includes('organization_sso_settings_domain_lower_uidx')
      ? 'That company domain is already linked to another organization.'
      : `Internal admin SSO settings update failed${error?.message ? `: ${error.message}` : '.'}`;
    return Response.json({ error: message }, { status: 400 });
  }

  await writeGovernanceAuditEvent(env, {
    organization_id: orgId,
    actor_user_id: authorized.auth.userId,
    actor_email: authorized.auth.email,
    event_type: 'organization_sso_settings_updated',
    target_type: 'organization',
    target_id: orgId,
    description: `Updated SSO rollout settings for ${companyDomain}`,
    metadata: {
      company_domain: companyDomain,
      sso_provider: ssoProvider,
      login_mode: loginMode,
      status,
      updated_via: 'internal_admin',
    },
  });

  await writeInternalAdminAuditEvent(
    env,
    authorized.auth,
    request,
    'internal_admin_sso_settings_updated',
    {
      organization_id: orgId,
      company_domain: companyDomain,
      sso_provider: ssoProvider,
      login_mode: loginMode,
      status,
    },
  );

  return Response.json({
    sso_settings: data,
    guardrails: [
      'SSO settings updates require internal admin actions to be enabled.',
      'SSO settings updates require the approval secret header.',
      'This endpoint stores only provider metadata and rollout status. It does not accept OAuth client secrets, SAML metadata XML, certificates, or IdP private material.',
      'The customer organization audit and internal admin audit streams both record the change.',
    ],
  }, {
    headers: {
      'cache-control': 'no-store',
    },
  });
}

async function handleCheckInternalAdminSsoStart(
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

  let requestedDomain = '';
  if (request.method === 'POST') {
    try {
      const parsed = await request.json();
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        requestedDomain = typeof (parsed as Record<string, unknown>).company_domain === 'string'
          ? (parsed as Record<string, unknown>).company_domain as string
          : '';
      }
    } catch {
      return Response.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }
  }

  const supabase = getSupabase(env);
  const [orgResult, ssoResult] = await Promise.all([
    supabase
      .from('organizations')
      .select('id, kind')
      .eq('id', orgId)
      .limit(1),
    supabase
      .from('organization_sso_settings')
      .select('organization_id, company_domain, sso_provider, login_mode, status, updated_at')
      .eq('organization_id', orgId)
      .limit(1),
  ]);

  if (orgResult.error) {
    return Response.json({ error: `Internal admin org lookup failed: ${orgResult.error.message}` }, { status: 500 });
  }
  const organization = normalizeRows(orgResult.data as MaybeArray<{ id: string; kind: string }>)[0];
  if (!organization) {
    return Response.json({ error: 'Organization not found.' }, { status: 404 });
  }
  if (organization.kind !== 'team') {
    return Response.json({ error: 'SSO checks are only available on enterprise team organizations.' }, { status: 400 });
  }

  if (ssoResult.error) {
    const migrationRequired = isMissingOrganizationSsoSettingsTable(ssoResult.error)
      ? 'Apply supabase/migrations/20260419010000_organization_sso_settings.sql'
      : null;
    return Response.json({
      error: migrationRequired || `Internal admin SSO settings lookup failed: ${ssoResult.error.message}`,
      migration_required: migrationRequired,
    }, { status: migrationRequired ? 501 : 500 });
  }

  const sso = normalizeRows(ssoResult.data as MaybeArray<{
    organization_id: string;
    company_domain: string | null;
    sso_provider: string | null;
    login_mode: string | null;
    status: string | null;
    updated_at: string | null;
  }>)[0] || null;
  const companyDomain = normalizeDomain(requestedDomain || sso?.company_domain || '');
  if (!companyDomain) {
    return Response.json({ error: 'company_domain is required before checking SSO start.' }, { status: 400 });
  }
  if (!isValidDomain(companyDomain)) {
    return Response.json({ error: 'company_domain must be a valid domain.' }, { status: 400 });
  }

  const check = await checkSupabaseSsoStart(env, companyDomain);
  await writeInternalAdminAuditEvent(
    env,
    authorized.auth,
    request,
    'internal_admin_sso_start_checked',
    {
      organization_id: orgId,
      company_domain: companyDomain,
      broker_status: check.broker_status,
      supabase_status: check.supabase_status,
      redirect_host: check.redirect_host,
      error: truncateForAudit(check.error),
    },
  );

  return Response.json({
    sso_start_check: {
      ...check,
      organization_id: orgId,
      sso_provider: sso?.sso_provider || null,
      rollout_status: sso?.status || 'not_configured',
      login_mode: sso?.login_mode || null,
    },
    guardrails: [
      'This checks the public Supabase SAML broker start path for the configured company domain.',
      'A ready result means Supabase returned an IdP redirect URL; it does not complete the customer browser login.',
      'If the result says SAML 2.0 is disabled, enable/configure Supabase SAML before marking the business configured.',
    ],
  }, {
    headers: {
      'cache-control': 'no-store',
    },
  });
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
  if (role === 'owner') {
    return Response.json({ error: 'owner invitations must be handled through the customer ownership transfer flow.' }, { status: 400 });
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
  const breakGlassEvidence = validateBreakGlassEvidence(requestedPayload);
  if (breakGlassEvidence instanceof Response) return breakGlassEvidence;
  const safeRequestedPayload = {
    ...requestedPayload,
    ...breakGlassEvidence,
  };

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
      requested_payload: safeRequestedPayload,
      requested_by_user_id: authorized.auth.userId,
      requested_by_email: authorized.auth.email,
      metadata: {
        approval_header_present: true,
        break_glass_evidence_present: true,
        rollback_owner_email: breakGlassEvidence.rollback_owner_email,
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
      customer_authorization_ref: breakGlassEvidence.customer_authorization_ref,
      rollback_owner_email: breakGlassEvidence.rollback_owner_email,
    },
  );

  return Response.json({
    action_request: actionRequest,
    execution_enabled: false,
    guardrails: [
      'Destructive action requests require internal admin actions to be enabled.',
      'Destructive action requests require the approval secret header.',
      'Destructive action requests require customer authorization, rollback owner, rollback plan, and break-glass reason evidence.',
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
  const breakGlassEvidence = validateBreakGlassEvidence(actionRequest.requested_payload || {});
  const breakGlassBlockers = breakGlassEvidence instanceof Response
    ? ['action request is missing required break-glass evidence']
    : [];
  const preflightResult = {
    action_type: actionRequest.action_type,
    execution_mode: 'dry_run',
    execution_enabled: false,
    would_set_archived_at: !organization.archived_at,
    would_set_archived_by_user_id: authorized.auth.userId,
    blockers: [...blockers, ...breakGlassBlockers],
    break_glass_evidence: breakGlassEvidence instanceof Response ? null : breakGlassEvidence,
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
    && pathSegments.length === 1
    && pathSegments[0] === 'orgs'
  ) {
    return handleCreateInternalAdminBusiness(request, env);
  }

  if (
    request.method === 'POST'
    && pathSegments.length === 3
    && pathSegments[0] === 'orgs'
    && pathSegments[2] === 'sso-settings'
  ) {
    return handleUpdateInternalAdminSsoSettings(request, env, pathSegments[1] || '');
  }

  if (
    request.method === 'POST'
    && pathSegments.length === 3
    && pathSegments[0] === 'orgs'
    && pathSegments[2] === 'sso-start-check'
  ) {
    return handleCheckInternalAdminSsoStart(request, env, pathSegments[1] || '');
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

  const ssoSchemaReady = !isMissingOrganizationSsoSettingsTable(ssoResult.error);
  if (ssoResult.error && !ssoSchemaReady) {
    console.warn(`internal admin SSO settings read skipped: ${ssoResult.error.message}`);
  }

  const firstError = orgResult.error || memberResult.error || projectResult.error || inviteResult.error || (ssoSchemaReady ? ssoResult.error : null) || auditResult.error;
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
  const ssoRows = ssoSchemaReady ? normalizeRows(ssoResult.data as MaybeArray<{
    organization_id: string;
    company_domain: string | null;
    sso_provider: string | null;
    login_mode: string | null;
    status: string | null;
    updated_at: string | null;
  }>) : [];
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
  const apiCallAnalytics = await getInternalAdminApiCallAnalytics(
    env,
    activeProjects.map((project) => project.id),
  );
  const apiCallsByOrg = new Map<string, InternalAdminApiCallStats>();
  for (const project of activeProjects) {
    if (!project.organization_id) continue;
    const projectStats = apiCallAnalytics.byProjectId.get(project.id) || emptyApiCallStats();
    const orgStats = apiCallsByOrg.get(project.organization_id) || emptyApiCallStats();
    mergeApiCallStats(orgStats, projectStats);
    apiCallsByOrg.set(project.organization_id, orgStats);
  }

  const businesses = organizations.map((organization) => {
    const orgMembers = membersByOrg.get(organization.id) || [];
    const orgProjects = projectsByOrg.get(organization.id) || [];
    const orgInvitations = invitationsByOrg.get(organization.id) || [];
    const activeOrgProjects = orgProjects.filter((project) => !project.revoked_at);
    const pendingOrgInvitations = orgInvitations.filter((invitation) => invitation.status === 'pending');
    const sso = ssoByOrgId.get(organization.id) || null;
    const orgApiCallStats = apiCallsByOrg.get(organization.id) || emptyApiCallStats();
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
      api_call_count: orgApiCallStats.call_count,
      api_error_count: orgApiCallStats.error_count,
      api_denied_count: orgApiCallStats.denied_count,
      last_api_call_at: orgApiCallStats.last_api_call_at,
      sso,
      business_login_links: enterpriseBusinessLoginLinks(env, organization.id, sso?.company_domain || null),
    };
  });

  return Response.json({
    generated_at: new Date().toISOString(),
    mode: 'read_only',
    admin_actions_enabled: env.internalAdminActionsEnabled === true,
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
      total_api_call_count: apiCallAnalytics.totals.call_count,
      api_error_count: apiCallAnalytics.totals.error_count,
      api_denied_count: apiCallAnalytics.totals.denied_count,
      api_call_source: apiCallAnalytics.source,
      api_call_rollup_ready: apiCallAnalytics.schemaReady,
    },
    sso_schema_ready: ssoSchemaReady,
    migration_required: ssoSchemaReady ? null : 'Apply supabase/migrations/20260419010000_organization_sso_settings.sql',
    api_call_trend: apiCallAnalytics.dailyTotals,
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
      ssoSchemaReady
        ? 'SSO metadata is available for per-business login guidance.'
        : 'SSO metadata migration is pending; overview omits SSO settings until supabase/migrations/20260419010000_organization_sso_settings.sql is applied.',
      'Customer data views are read-only by default; safe employee writes require the disabled-by-default action gate and approval secret.',
    ],
  }, {
    headers: {
      'cache-control': 'no-store',
    },
  });
}
