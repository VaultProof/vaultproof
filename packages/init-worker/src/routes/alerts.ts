import type { Env } from '../types.js';
import {
  authenticateUser,
  hasRequiredOrganizationRole,
  resolveOrganizationMembership,
} from '../lib/user-auth.js';
import { getSupabase } from '../lib/supabase.js';
import { writeGovernanceAuditEvent } from '../lib/audit.js';
import { getInitOverviewStats, getInitOverviewStatsForOrganization } from './projects.js';

interface CreateAlertDestinationBody {
  channel_type?: 'email' | 'webhook';
  label?: string;
  target?: string;
}

interface UpdateAlertDestinationBody {
  label?: string;
  enabled?: boolean;
}

interface TestSendBody {
  destination_id?: string;
}

interface UpdateAlertPolicyBody {
  dispatch_enabled?: boolean;
  minimum_severity?: 'info' | 'warning' | 'critical';
  min_interval_minutes?: number;
}

type AlertChannelType = 'email' | 'webhook';
type AlertDeliveryStatus = 'delivered' | 'failed' | 'skipped';
type AlertDeliveryKind = 'test_send' | 'policy_dispatch';
type AlertSeverity = 'info' | 'warning' | 'critical';
type AlertDispatchTriggerSource = 'manual' | 'scheduled';
type AlertActivityWindow = 'all' | '24h' | '7d' | '30d';

type Overview = Awaited<ReturnType<typeof getInitOverviewStats>>;

type DestinationRow = {
  id: string;
  channel_type: AlertChannelType;
  label: string;
  target: string;
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
};

type AlertsQueryFilters = {
  activityWindow: AlertActivityWindow;
  deliveryStatus: AlertDeliveryStatus | 'all';
  deliveryChannel: AlertChannelType | 'all';
  deliveryKind: AlertDeliveryKind | 'all';
  deliverySearch: string;
  deliveryLimit: number;
  deliveryBefore: string | null;
  runStatus: 'dispatched' | 'skipped' | 'failed' | 'all';
  runTrigger: AlertDispatchTriggerSource | 'all';
  runSearch: string;
  runLimit: number;
  runBefore: string | null;
};

const ALERT_SEVERITY_RANK: Record<AlertSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

function normalizeChannelType(value: unknown): AlertChannelType | null {
  if (value === 'email' || value === 'webhook') return value;
  return null;
}

function normalizeSeverity(value: unknown): AlertSeverity | null {
  if (value === 'info' || value === 'warning' || value === 'critical') return value;
  return null;
}

function normalizeActivityWindow(value: string | null): AlertActivityWindow {
  return value === '24h' || value === '7d' || value === '30d' || value === 'all' ? value : '7d';
}

function normalizeDeliveryStatus(value: string | null): AlertDeliveryStatus | 'all' {
  return value === 'delivered' || value === 'failed' || value === 'skipped' || value === 'all' ? value : 'all';
}

function normalizeDeliveryKind(value: string | null): AlertDeliveryKind | 'all' {
  return value === 'test_send' || value === 'policy_dispatch' || value === 'all' ? value : 'all';
}

function normalizeRunStatus(value: string | null): 'dispatched' | 'skipped' | 'failed' | 'all' {
  return value === 'dispatched' || value === 'skipped' || value === 'failed' || value === 'all' ? value : 'all';
}

function normalizeRunTrigger(value: string | null): AlertDispatchTriggerSource | 'all' {
  return value === 'manual' || value === 'scheduled' || value === 'all' ? value : 'all';
}

function normalizePositiveLimit(value: string | null, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(100, Math.floor(parsed)));
}

function normalizeSearch(value: string | null): string {
  return (value || '').trim().slice(0, 100);
}

function normalizeIsoCursor(value: string | null): string | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString();
}

function getActivityWindowStart(activityWindow: AlertActivityWindow): string | null {
  if (activityWindow === 'all') return null;
  const now = Date.now();
  const diffMs = activityWindow === '24h'
    ? 24 * 60 * 60 * 1000
    : activityWindow === '7d'
      ? 7 * 24 * 60 * 60 * 1000
      : 30 * 24 * 60 * 60 * 1000;
  return new Date(now - diffMs).toISOString();
}

function parseAlertsQueryFilters(request: Request): AlertsQueryFilters {
  const url = new URL(request.url);
  return {
    activityWindow: normalizeActivityWindow(url.searchParams.get('activity_window')),
    deliveryStatus: normalizeDeliveryStatus(url.searchParams.get('delivery_status')),
    deliveryChannel: normalizeChannelType(url.searchParams.get('delivery_channel')) ?? 'all',
    deliveryKind: normalizeDeliveryKind(url.searchParams.get('delivery_kind')),
    deliverySearch: normalizeSearch(url.searchParams.get('delivery_q')),
    deliveryLimit: normalizePositiveLimit(url.searchParams.get('delivery_limit'), 20),
    deliveryBefore: normalizeIsoCursor(url.searchParams.get('delivery_before')),
    runStatus: normalizeRunStatus(url.searchParams.get('run_status')),
    runTrigger: normalizeRunTrigger(url.searchParams.get('run_trigger')),
    runSearch: normalizeSearch(url.searchParams.get('run_q')),
    runLimit: normalizePositiveLimit(url.searchParams.get('run_limit'), 20),
    runBefore: normalizeIsoCursor(url.searchParams.get('run_before')),
  };
}

function applyDeliveryLogFilters(query: any, organizationId: string, filters: AlertsQueryFilters): any {
  let qb = query.eq('organization_id', organizationId);
  const windowStart = getActivityWindowStart(filters.activityWindow);
  if (windowStart) qb = qb.gte('delivered_at', windowStart);
  if (filters.deliveryBefore) qb = qb.lt('delivered_at', filters.deliveryBefore);
  if (filters.deliveryStatus !== 'all') qb = qb.eq('status', filters.deliveryStatus);
  if (filters.deliveryChannel !== 'all') qb = qb.eq('channel_type', filters.deliveryChannel);
  if (filters.deliveryKind !== 'all') qb = qb.eq('delivery_kind', filters.deliveryKind);
  if (filters.deliverySearch) qb = qb.ilike('detail', `%${filters.deliverySearch}%`);
  return qb;
}

function applyDispatchRunFilters(query: any, organizationId: string, filters: AlertsQueryFilters): any {
  let qb = query.eq('organization_id', organizationId);
  const windowStart = getActivityWindowStart(filters.activityWindow);
  if (windowStart) qb = qb.gte('checked_at', windowStart);
  if (filters.runBefore) qb = qb.lt('checked_at', filters.runBefore);
  if (filters.runStatus !== 'all') qb = qb.eq('status', filters.runStatus);
  if (filters.runTrigger !== 'all') qb = qb.eq('trigger_source', filters.runTrigger);
  if (filters.runSearch) qb = qb.ilike('reason', `%${filters.runSearch}%`);
  return qb;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeWebhookTarget(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function maskTarget(channelType: AlertChannelType, target: string): string {
  if (channelType === 'email') {
    const [local, domain] = target.split('@');
    if (!local || !domain) return target;
    const visible = local.length <= 2 ? local[0] || '*' : `${local.slice(0, 2)}***`;
    return `${visible}@${domain}`;
  }

  try {
    const url = new URL(target);
    return `${url.origin}${url.pathname}`;
  } catch {
    return target;
  }
}

function isEmailDeliveryConfigured(env: Env): boolean {
  return Boolean(env.RESEND_API_KEY && env.ALERTS_FROM_EMAIL);
}

function buildAlertEmailSubject(
  payload: Record<string, unknown>,
  deliveryKind: AlertDeliveryKind,
): string {
  const organization = (payload.organization || {}) as { name?: string };
  const pilotReview = (payload.pilot_review || {}) as { status?: string };
  const orgName = organization.name || 'VaultProof workspace';
  const status = pilotReview.status || 'update';
  return deliveryKind === 'test_send'
    ? `[VaultProof] Test alert for ${orgName}`
    : `[VaultProof] ${orgName} alert dispatch (${status})`;
}

function buildAlertEmailText(
  payload: Record<string, unknown>,
  deliveryKind: AlertDeliveryKind,
): string {
  const organization = (payload.organization || {}) as { name?: string; kind?: string };
  const policy = (payload.policy || {}) as { minimum_severity?: string; min_interval_minutes?: number };
  const pilotReview = (payload.pilot_review || {}) as {
    status?: string;
    headline?: string;
    recommendation?: string;
    window_days?: number;
  };
  const metrics = (payload.metrics || {}) as {
    total_calls?: number;
    denied_calls?: number;
    error_calls?: number;
    error_rate?: number;
  };
  const alerts = Array.isArray(payload.alerts) ? payload.alerts as Array<{ severity?: string; title?: string; detail?: string }> : [];

  return [
    `VaultProof ${deliveryKind === 'test_send' ? 'test alert' : 'alert dispatch'}`,
    '',
    `Organization: ${organization.name || 'Unknown org'}`,
    `Workspace type: ${organization.kind || 'unknown'}`,
    `Generated: ${String(payload.generated_at || new Date().toISOString())}`,
    `Minimum severity: ${policy.minimum_severity || 'warning'}`,
    `Dispatch cooldown: ${String(policy.min_interval_minutes || 0)} minutes`,
    '',
    `Pilot status: ${pilotReview.status || 'unknown'}`,
    `Headline: ${pilotReview.headline || 'No pilot summary available'}`,
    `Recommendation: ${pilotReview.recommendation || 'No recommendation available'}`,
    `Review window: ${String(pilotReview.window_days || 0)} days`,
    '',
    `Total calls: ${String(metrics.total_calls || 0)}`,
    `Denied calls: ${String(metrics.denied_calls || 0)}`,
    `Error calls: ${String(metrics.error_calls || 0)}`,
    `Error rate: ${String(metrics.error_rate || 0)}`,
    '',
    'Active alerts:',
    ...(alerts.length
      ? alerts.map((alert) => `- [${alert.severity || 'info'}] ${alert.title || 'Alert'}${alert.detail ? ` — ${alert.detail}` : ''}`)
      : ['- No alerts matched the current threshold.']),
  ].join('\n');
}

async function deliverEmailViaResend(
  env: Env,
  destination: DestinationRow,
  payload: Record<string, unknown>,
  deliveryKind: AlertDeliveryKind,
): Promise<{
  status: AlertDeliveryStatus;
  detail: string;
  response_status: number | null;
}> {
  if (!isEmailDeliveryConfigured(env)) {
    return {
      status: 'skipped',
      detail: 'Email destination saved, but Resend is not configured. Set RESEND_API_KEY and ALERTS_FROM_EMAIL in the worker environment.',
      response_status: null,
    };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: env.ALERTS_FROM_EMAIL,
        to: [destination.target],
        subject: buildAlertEmailSubject(payload, deliveryKind),
        text: buildAlertEmailText(payload, deliveryKind),
        ...(env.ALERTS_REPLY_TO_EMAIL ? { reply_to: env.ALERTS_REPLY_TO_EMAIL } : {}),
      }),
    });

    if (response.ok) {
      return {
        status: 'delivered',
        detail: `Delivered ${deliveryKind === 'test_send' ? 'test' : 'policy'} email to ${maskTarget('email', destination.target)}`,
        response_status: response.status,
      };
    }

    return {
      status: 'failed',
      detail: `Email provider responded with status ${response.status}`,
      response_status: response.status,
    };
  } catch (error) {
    return {
      status: 'failed',
      detail: error instanceof Error ? error.message : 'Email request failed',
      response_status: null,
    };
  }
}

function buildAlertPayload(
  organization: {
    id: string;
    name: string;
    kind: 'personal' | 'team';
    current_role: 'owner' | 'admin' | 'member' | 'viewer' | null;
  },
  overview: Overview,
  source: AlertDeliveryKind,
  minimumSeverity: AlertSeverity,
  minIntervalMinutes: number,
) {
  return {
    source,
    generated_at: new Date().toISOString(),
    organization,
    policy: {
      minimum_severity: minimumSeverity,
      min_interval_minutes: minIntervalMinutes,
    },
    pilot_review: overview.pilotReview,
    metrics: {
      total_calls: overview.totalCalls,
      denied_calls: overview.deniedCalls,
      error_calls: overview.errorCalls,
      error_rate: overview.errorRate,
      providers: overview.providers,
    },
    alerts: overview.alerts.filter((alert) => ALERT_SEVERITY_RANK[alert.severity] >= ALERT_SEVERITY_RANK[minimumSeverity]),
  };
}

async function writeDeliveryLog(
  env: Env,
  input: {
    organization_id: string;
    destination_id: string;
    channel_type: AlertChannelType;
    delivery_kind: AlertDeliveryKind;
    status: AlertDeliveryStatus;
    detail: string;
    response_status?: number | null;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  try {
    const supabase = getSupabase(env);
    const { error } = await supabase.from('organization_alert_deliveries').insert({
      organization_id: input.organization_id,
      destination_id: input.destination_id,
      channel_type: input.channel_type,
      delivery_kind: input.delivery_kind,
      status: input.status,
      detail: input.detail,
      response_status: input.response_status ?? null,
      payload: input.payload,
    });

    if (error) {
      console.error('Failed to write alert delivery log:', error.message);
    }
  } catch (error) {
    console.error('Failed to write alert delivery log:', error);
  }
}

async function writeDispatchRun(
  env: Env,
  input: {
    organization_id: string;
    trigger_source: AlertDispatchTriggerSource;
    status: 'dispatched' | 'skipped' | 'failed';
    reason?: string | null;
    dispatched_alert_count?: number;
    destination_count?: number;
    delivered_count?: number;
    failed_count?: number;
    skipped_count?: number;
    next_eligible_at?: string | null;
  },
): Promise<void> {
  try {
    const supabase = getSupabase(env);
    const { error } = await supabase.from('organization_alert_dispatch_runs').insert({
      organization_id: input.organization_id,
      trigger_source: input.trigger_source,
      status: input.status,
      reason: input.reason ?? null,
      dispatched_alert_count: input.dispatched_alert_count ?? 0,
      destination_count: input.destination_count ?? 0,
      delivered_count: input.delivered_count ?? 0,
      failed_count: input.failed_count ?? 0,
      skipped_count: input.skipped_count ?? 0,
      next_eligible_at: input.next_eligible_at ?? null,
    });

    if (error) {
      console.error('Failed to write alert dispatch run:', error.message);
    }
  } catch (error) {
    console.error('Failed to write alert dispatch run:', error);
  }
}

async function loadPolicy(env: Env, organizationId: string): Promise<{
  dispatch_enabled: boolean;
  minimum_severity: AlertSeverity;
  min_interval_minutes: number;
}> {
  const supabase = getSupabase(env);
  const { data } = await supabase
    .from('organization_alert_policies')
    .select('dispatch_enabled, minimum_severity, min_interval_minutes')
    .eq('organization_id', organizationId)
    .maybeSingle();

  return {
    dispatch_enabled: data?.dispatch_enabled ?? false,
    minimum_severity: normalizeSeverity(data?.minimum_severity) ?? 'warning',
    min_interval_minutes: typeof data?.min_interval_minutes === 'number' ? data.min_interval_minutes : 60,
  };
}

async function upsertPolicy(
  env: Env,
  organizationId: string,
  updates: { dispatch_enabled?: boolean; minimum_severity?: AlertSeverity; min_interval_minutes?: number },
): Promise<{ dispatch_enabled: boolean; minimum_severity: AlertSeverity; min_interval_minutes: number } | null> {
  const supabase = getSupabase(env);
  const { data, error } = await supabase
    .from('organization_alert_policies')
    .upsert({
      organization_id: organizationId,
      ...updates,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'organization_id' })
    .select('dispatch_enabled, minimum_severity, min_interval_minutes')
    .single();

  if (error || !data) return null;
  return {
    dispatch_enabled: data.dispatch_enabled,
    minimum_severity: normalizeSeverity(data.minimum_severity) ?? 'warning',
    min_interval_minutes: typeof data.min_interval_minutes === 'number' ? data.min_interval_minutes : 60,
  };
}

async function getLastPolicyDispatchAt(
  supabase: ReturnType<typeof getSupabase>,
  organizationId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('organization_alert_deliveries')
    .select('delivered_at')
    .eq('organization_id', organizationId)
    .eq('delivery_kind', 'policy_dispatch')
    .order('delivered_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.delivered_at || null;
}

function getNextEligibleAt(lastPolicyDispatchAt: string | null, minIntervalMinutes: number): string | null {
  if (!lastPolicyDispatchAt) return null;
  const lastDispatchMs = new Date(lastPolicyDispatchAt).getTime();
  if (!Number.isFinite(lastDispatchMs)) return null;
  return new Date(lastDispatchMs + (minIntervalMinutes * 60 * 1000)).toISOString();
}

async function loadOrganizationSummary(
  supabase: ReturnType<typeof getSupabase>,
  organizationId: string,
): Promise<{
  id: string;
  name: string;
  kind: 'personal' | 'team';
} | null> {
  const { data } = await supabase
    .from('organizations')
    .select('id, name, kind')
    .eq('id', organizationId)
    .is('archived_at', null)
    .maybeSingle();

  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    kind: data.kind,
  };
}

async function listEnabledDestinations(
  supabase: ReturnType<typeof getSupabase>,
  organizationId: string,
  destinationId?: string,
): Promise<DestinationRow[]> {
  let qb = supabase
    .from('organization_alert_destinations')
    .select('id, channel_type, label, target, enabled')
    .eq('organization_id', organizationId)
    .eq('enabled', true);

  if (destinationId) qb = qb.eq('id', destinationId);
  const { data } = await qb;
  return (data || []) as DestinationRow[];
}

async function deliverPayload(
  env: Env,
  input: {
    organization_id: string;
    destinations: DestinationRow[];
    payload: Record<string, unknown>;
    delivery_kind: AlertDeliveryKind;
  },
): Promise<Array<{
    destination_id: string;
    label: string;
    channel_type: AlertChannelType;
    status: AlertDeliveryStatus;
    detail: string;
    response_status: number | null;
  }>> {
  const results: Array<{
    destination_id: string;
    label: string;
    channel_type: AlertChannelType;
    status: AlertDeliveryStatus;
    detail: string;
    response_status: number | null;
  }> = [];

  for (const destination of input.destinations) {
    if (destination.channel_type === 'email') {
      const emailResult = await deliverEmailViaResend(env, destination, input.payload, input.delivery_kind);
      await writeDeliveryLog(env, {
        organization_id: input.organization_id,
        destination_id: destination.id,
        channel_type: destination.channel_type,
        delivery_kind: input.delivery_kind,
        status: emailResult.status,
        detail: emailResult.detail,
        response_status: emailResult.response_status,
        payload: input.payload,
      });
      results.push({
        destination_id: destination.id,
        label: destination.label,
        channel_type: destination.channel_type,
        status: emailResult.status,
        detail: emailResult.detail,
        response_status: emailResult.response_status,
      });
      continue;
    }

    try {
      const response = await fetch(destination.target, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'vaultproof-alerts/1.0',
          'x-vaultproof-event': input.delivery_kind === 'test_send' ? 'alert.test_send' : 'alert.policy_dispatch',
          'x-vaultproof-organization': input.organization_id,
        },
        body: JSON.stringify(input.payload),
      });

      const ok = response.ok;
      const detail = ok
        ? `Delivered ${input.delivery_kind === 'test_send' ? 'test' : 'policy'} alert payload to ${maskTarget(destination.channel_type, destination.target)}`
        : `Webhook responded with status ${response.status}`;

      await writeDeliveryLog(env, {
        organization_id: input.organization_id,
        destination_id: destination.id,
        channel_type: destination.channel_type,
        delivery_kind: input.delivery_kind,
        status: ok ? 'delivered' : 'failed',
        detail,
        response_status: response.status,
        payload: input.payload,
      });

      results.push({
        destination_id: destination.id,
        label: destination.label,
        channel_type: destination.channel_type,
        status: ok ? 'delivered' : 'failed',
        detail,
        response_status: response.status,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Webhook request failed';
      await writeDeliveryLog(env, {
        organization_id: input.organization_id,
        destination_id: destination.id,
        channel_type: destination.channel_type,
        delivery_kind: input.delivery_kind,
        status: 'failed',
        detail,
        response_status: null,
        payload: input.payload,
      });
      results.push({
        destination_id: destination.id,
        label: destination.label,
        channel_type: destination.channel_type,
        status: 'failed',
        detail,
        response_status: null,
      });
    }
  }

  return results;
}

export async function dispatchPolicyAlertsForOrganization(
  env: Env,
  organizationId: string,
  triggerSource: AlertDispatchTriggerSource = 'manual',
): Promise<{
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  next_eligible_at?: string;
  policy?: {
    dispatch_enabled: boolean;
    minimum_severity: AlertSeverity;
    min_interval_minutes: number;
  };
  results: Array<{
    destination_id: string;
    label: string;
    channel_type: AlertChannelType;
    status: AlertDeliveryStatus;
    detail: string;
    response_status: number | null;
  }>;
  payload?: Record<string, unknown>;
  dispatched_alert_count?: number;
}> {
  const supabase = getSupabase(env);
  const policy = await loadPolicy(env, organizationId);
  if (!policy.dispatch_enabled) {
    await writeDispatchRun(env, {
      organization_id: organizationId,
      trigger_source: triggerSource,
      status: 'skipped',
      reason: 'Alert dispatch is disabled in policy',
    });
    return {
      ok: false,
      skipped: true,
      reason: 'Alert dispatch is disabled in policy',
      policy,
      results: [],
    };
  }

  const lastPolicyDispatchAt = await getLastPolicyDispatchAt(supabase, organizationId);
  if (lastPolicyDispatchAt) {
    const lastDispatchMs = new Date(lastPolicyDispatchAt).getTime();
    const cooldownMs = policy.min_interval_minutes * 60 * 1000;
    if (Number.isFinite(lastDispatchMs) && Date.now() - lastDispatchMs < cooldownMs) {
      const nextEligibleAt = new Date(lastDispatchMs + cooldownMs).toISOString();
      await writeDispatchRun(env, {
        organization_id: organizationId,
        trigger_source: triggerSource,
        status: 'skipped',
        reason: `Policy dispatch cooldown is active until ${nextEligibleAt}.`,
        next_eligible_at: nextEligibleAt,
      });
      return {
        ok: true,
        skipped: true,
        reason: `Policy dispatch cooldown is active until ${nextEligibleAt}.`,
        next_eligible_at: nextEligibleAt,
        policy,
        results: [],
      };
    }
  }

  const destinations = await listEnabledDestinations(supabase, organizationId);
  if (destinations.length === 0) {
    await writeDispatchRun(env, {
      organization_id: organizationId,
      trigger_source: triggerSource,
      status: 'failed',
      reason: 'No enabled destinations available for policy dispatch',
    });
    return {
      ok: false,
      skipped: true,
      reason: 'No enabled destinations available for policy dispatch',
      policy,
      results: [],
    };
  }

  const organization = await loadOrganizationSummary(supabase, organizationId);
  if (!organization) {
    await writeDispatchRun(env, {
      organization_id: organizationId,
      trigger_source: triggerSource,
      status: 'failed',
      reason: 'Organization not found',
    });
    return {
      ok: false,
      skipped: true,
      reason: 'Organization not found',
      policy,
      results: [],
    };
  }

  const overview = await getInitOverviewStatsForOrganization(supabase, organizationId);
  const payload = buildAlertPayload({
    id: organization.id,
    name: organization.name,
    kind: organization.kind,
    current_role: null,
  }, overview, 'policy_dispatch', policy.minimum_severity, policy.min_interval_minutes);

  const filteredAlerts = payload.alerts as Array<{ severity: AlertSeverity }>;
  if (filteredAlerts.length === 0) {
    await writeDispatchRun(env, {
      organization_id: organizationId,
      trigger_source: triggerSource,
      status: 'skipped',
      reason: `No current alerts meet the ${policy.minimum_severity} threshold.`,
      next_eligible_at: getNextEligibleAt(new Date().toISOString(), policy.min_interval_minutes),
    });
    return {
      ok: true,
      skipped: true,
      reason: `No current alerts meet the ${policy.minimum_severity} threshold.`,
      payload,
      policy,
      results: [],
    };
  }

  const results = await deliverPayload(env, {
    organization_id: organizationId,
    destinations,
    payload,
    delivery_kind: 'policy_dispatch',
  });

  await writeGovernanceAuditEvent(env, {
    organization_id: organizationId,
    actor_user_id: null,
    actor_email: 'system@vaultproof.dev',
    event_type: 'organization_alert_policy_dispatched',
    target_type: 'organization_alert_policy',
    target_id: organizationId,
    description: `Dispatched current alerts using ${policy.minimum_severity} policy threshold`,
    metadata: {
      minimum_severity: policy.minimum_severity,
      min_interval_minutes: policy.min_interval_minutes,
      alert_count: filteredAlerts.length,
      destination_count: results.length,
      delivered_count: results.filter((result) => result.status === 'delivered').length,
      failed_count: results.filter((result) => result.status === 'failed').length,
      skipped_count: results.filter((result) => result.status === 'skipped').length,
      dispatched_by: 'system',
    },
  });

  await writeDispatchRun(env, {
    organization_id: organizationId,
    trigger_source: triggerSource,
    status: 'dispatched',
    reason: `Dispatched current alerts using ${policy.minimum_severity} policy threshold`,
    dispatched_alert_count: filteredAlerts.length,
    destination_count: results.length,
    delivered_count: results.filter((result) => result.status === 'delivered').length,
    failed_count: results.filter((result) => result.status === 'failed').length,
    skipped_count: results.filter((result) => result.status === 'skipped').length,
    next_eligible_at: getNextEligibleAt(new Date().toISOString(), policy.min_interval_minutes),
  });

  return {
    ok: true,
    payload,
    results,
    dispatched_alert_count: filteredAlerts.length,
    policy,
  };
}

export async function handleAlerts(
  request: Request,
  env: Env,
  pathSegments: string[],
): Promise<Response> {
  const auth = await authenticateUser(request, env);
  if (!auth) {
    return Response.json(
      { error: 'Not authenticated. Pass Authorization: Bearer <supabase jwt>' },
      { status: 401 },
    );
  }

  const membership = await resolveOrganizationMembership(request, env, auth.userId);
  if (!membership) {
    return Response.json({ error: 'Organization not found' }, { status: 404 });
  }

  const supabase = getSupabase(env);
  const method = request.method;
  const canManage = hasRequiredOrganizationRole(membership.organization_role, 'admin');
  const queryFilters = parseAlertsQueryFilters(request);

  if (method === 'GET' && pathSegments.length === 0) {
    const policy = await loadPolicy(env, membership.organization_id);
    const lastPolicyDispatchAt = await getLastPolicyDispatchAt(supabase, membership.organization_id);
    const nextEligibleAt = getNextEligibleAt(lastPolicyDispatchAt, policy.min_interval_minutes);
    const [
      { data: destinations },
      { data: deliveries },
      { count: deliveryCount },
      { data: dispatchRuns },
      { count: dispatchRunCount },
    ] = await Promise.all([
      supabase
        .from('organization_alert_destinations')
        .select('id, channel_type, label, target, enabled, created_at, updated_at')
        .eq('organization_id', membership.organization_id)
        .order('created_at', { ascending: false }),
      applyDeliveryLogFilters(
        supabase
          .from('organization_alert_deliveries')
          .select('id, destination_id, channel_type, delivery_kind, status, detail, response_status, delivered_at'),
        membership.organization_id,
        queryFilters,
      )
        .order('delivered_at', { ascending: false })
        .limit(queryFilters.deliveryLimit + 1),
      applyDeliveryLogFilters(
        supabase
          .from('organization_alert_deliveries')
          .select('id', { count: 'exact', head: true }),
        membership.organization_id,
        { ...queryFilters, deliveryBefore: null },
      ),
      applyDispatchRunFilters(
        supabase
          .from('organization_alert_dispatch_runs')
          .select('id, trigger_source, status, reason, dispatched_alert_count, destination_count, delivered_count, failed_count, skipped_count, next_eligible_at, checked_at'),
        membership.organization_id,
        queryFilters,
      )
        .order('checked_at', { ascending: false })
        .limit(queryFilters.runLimit + 1),
      applyDispatchRunFilters(
        supabase
          .from('organization_alert_dispatch_runs')
          .select('id', { count: 'exact', head: true }),
        membership.organization_id,
        { ...queryFilters, runBefore: null },
      ),
    ]);

    const deliveryRows = ((deliveries || []) as Array<{
      id: string;
      destination_id: string;
      channel_type: AlertChannelType;
      delivery_kind: AlertDeliveryKind;
      status: AlertDeliveryStatus;
      detail: string;
      response_status: number | null;
      delivered_at: string;
    }>);
    const dispatchRunRows = ((dispatchRuns || []) as Array<{
      id: string;
      trigger_source: AlertDispatchTriggerSource;
      status: 'dispatched' | 'skipped' | 'failed';
      reason: string | null;
      dispatched_alert_count: number;
      destination_count: number;
      delivered_count: number;
      failed_count: number;
      skipped_count: number;
      next_eligible_at: string | null;
      checked_at: string;
    }>);

    const pagedDeliveries = deliveryRows.slice(0, queryFilters.deliveryLimit);
    const pagedDispatchRuns = dispatchRunRows.slice(0, queryFilters.runLimit);
    const deliveryHasMore = deliveryRows.length > queryFilters.deliveryLimit;
    const runHasMore = dispatchRunRows.length > queryFilters.runLimit;

    return Response.json({
      organization: {
        id: membership.organization_id,
        name: membership.organization_name,
        kind: membership.organization_kind,
        current_role: membership.organization_role,
      },
      can_manage: canManage,
      policy,
      dispatch_status: {
        last_policy_dispatch_at: lastPolicyDispatchAt,
        next_eligible_at: nextEligibleAt,
        cooldown_active: !!(nextEligibleAt && Date.now() < new Date(nextEligibleAt).getTime()),
      },
      destinations: ((destinations || []) as DestinationRow[]).map((destination) => ({
        id: destination.id,
        channel_type: destination.channel_type,
        label: destination.label,
        target_masked: maskTarget(destination.channel_type, destination.target),
        enabled: destination.enabled,
        created_at: destination.created_at,
        updated_at: destination.updated_at,
      })),
      delivery_logs: pagedDeliveries,
      delivery_logs_meta: {
        total: deliveryCount ?? pagedDeliveries.length,
        limit: queryFilters.deliveryLimit,
        has_more: deliveryHasMore,
        next_before: deliveryHasMore ? pagedDeliveries[pagedDeliveries.length - 1]?.delivered_at || null : null,
        filters: {
          activity_window: queryFilters.activityWindow,
          status: queryFilters.deliveryStatus,
          channel_type: queryFilters.deliveryChannel,
          delivery_kind: queryFilters.deliveryKind,
          q: queryFilters.deliverySearch || null,
        },
      },
      dispatch_runs: pagedDispatchRuns,
      dispatch_runs_meta: {
        total: dispatchRunCount ?? pagedDispatchRuns.length,
        limit: queryFilters.runLimit,
        has_more: runHasMore,
        next_before: runHasMore ? pagedDispatchRuns[pagedDispatchRuns.length - 1]?.checked_at || null : null,
        filters: {
          activity_window: queryFilters.activityWindow,
          status: queryFilters.runStatus,
          trigger_source: queryFilters.runTrigger,
          q: queryFilters.runSearch || null,
        },
      },
    });
  }

  if (method === 'POST' && pathSegments.length === 0) {
    if (!canManage) {
      return Response.json({ error: 'Insufficient organization permissions' }, { status: 403 });
    }

    let body: CreateAlertDestinationBody;
    try {
      body = (await request.json()) as CreateAlertDestinationBody;
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const channelType = normalizeChannelType(body.channel_type);
    if (!channelType) {
      return Response.json({ error: 'channel_type must be email or webhook' }, { status: 400 });
    }

    const label = body.label?.trim();
    if (!label || label.length < 2) {
      return Response.json({ error: 'A label is required' }, { status: 400 });
    }

    let normalizedTarget = '';
    if (channelType === 'email') {
      const email = normalizeEmail(body.target || '');
      if (!email || !isValidEmail(email)) {
        return Response.json({ error: 'A valid email target is required' }, { status: 400 });
      }
      normalizedTarget = email;
    } else {
      const webhook = normalizeWebhookTarget(body.target || '');
      if (!webhook) {
        return Response.json({ error: 'A valid https webhook URL is required' }, { status: 400 });
      }
      normalizedTarget = webhook;
    }

    const { data, error } = await supabase
      .from('organization_alert_destinations')
      .insert({
        organization_id: membership.organization_id,
        channel_type: channelType,
        label,
        target: normalizedTarget,
        enabled: true,
        created_by_user_id: auth.userId,
      })
      .select('id, channel_type, label, target, enabled, created_at, updated_at')
      .single();

    if (error || !data) {
      const message = error?.message?.includes('organization_alert_destinations_org_channel_target_uidx')
        ? 'That destination already exists for this organization'
        : 'Failed to create alert destination';
      return Response.json({ error: message }, { status: 400 });
    }

    await writeGovernanceAuditEvent(env, {
      organization_id: membership.organization_id,
      actor_user_id: auth.userId,
      actor_email: auth.email,
      event_type: 'organization_alert_destination_created',
      target_type: 'organization_alert_destination',
      target_id: data.id,
      description: `Added ${channelType} alert destination ${label}`,
      metadata: {
        channel_type: channelType,
        label,
        target_masked: maskTarget(channelType, normalizedTarget),
      },
    });

    return Response.json({
      destination: {
        id: data.id,
        channel_type: data.channel_type,
        label: data.label,
        target_masked: maskTarget(data.channel_type, data.target),
        enabled: data.enabled,
        created_at: data.created_at,
        updated_at: data.updated_at,
      },
    }, { status: 201 });
  }

  if (method === 'PUT' && pathSegments.length === 1 && pathSegments[0] === 'policy') {
    if (!canManage) {
      return Response.json({ error: 'Insufficient organization permissions' }, { status: 403 });
    }

    const currentPolicy = await loadPolicy(env, membership.organization_id);
    let body: UpdateAlertPolicyBody;
    try {
      body = (await request.json()) as UpdateAlertPolicyBody;
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const updates: { dispatch_enabled?: boolean; minimum_severity?: AlertSeverity; min_interval_minutes?: number } = {};
    if (body.dispatch_enabled !== undefined) {
      if (typeof body.dispatch_enabled !== 'boolean') {
        return Response.json({ error: 'dispatch_enabled must be boolean' }, { status: 400 });
      }
      updates.dispatch_enabled = body.dispatch_enabled;
    }
    if (body.minimum_severity !== undefined) {
      const severity = normalizeSeverity(body.minimum_severity);
      if (!severity) {
        return Response.json({ error: 'minimum_severity must be info, warning, or critical' }, { status: 400 });
      }
      updates.minimum_severity = severity;
    }
    if (body.min_interval_minutes !== undefined) {
      if (!Number.isFinite(body.min_interval_minutes)) {
        return Response.json({ error: 'min_interval_minutes must be a number' }, { status: 400 });
      }
      const interval = Math.floor(body.min_interval_minutes);
      if (interval < 5 || interval > 10080) {
        return Response.json({ error: 'min_interval_minutes must be between 5 and 10080' }, { status: 400 });
      }
      updates.min_interval_minutes = interval;
    }
    if (!Object.keys(updates).length) {
      return Response.json({ error: 'No policy updates provided' }, { status: 400 });
    }

    const nextPolicy = await upsertPolicy(env, membership.organization_id, updates);
    if (!nextPolicy) {
      return Response.json({ error: 'Failed to update alert policy' }, { status: 500 });
    }

    await writeGovernanceAuditEvent(env, {
      organization_id: membership.organization_id,
      actor_user_id: auth.userId,
      actor_email: auth.email,
      event_type: 'organization_alert_policy_updated',
      target_type: 'organization_alert_policy',
      target_id: membership.organization_id,
      description: `Updated alert delivery policy for ${membership.organization_name}`,
      metadata: {
        previous_dispatch_enabled: currentPolicy.dispatch_enabled,
        dispatch_enabled: nextPolicy.dispatch_enabled,
        previous_minimum_severity: currentPolicy.minimum_severity,
        minimum_severity: nextPolicy.minimum_severity,
        previous_min_interval_minutes: currentPolicy.min_interval_minutes,
        min_interval_minutes: nextPolicy.min_interval_minutes,
      },
    });

    return Response.json({ policy: nextPolicy });
  }

  if (method === 'POST' && pathSegments.length === 1 && pathSegments[0] === 'test-send') {
    if (!canManage) {
      return Response.json({ error: 'Insufficient organization permissions' }, { status: 403 });
    }

    let body: TestSendBody = {};
    try {
      body = (await request.json()) as TestSendBody;
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const destinations = await listEnabledDestinations(supabase, membership.organization_id, body.destination_id);
    if (destinations.length === 0) {
      return Response.json({ error: 'No enabled destinations available for test send' }, { status: 400 });
    }

    const overview = await getInitOverviewStats(env, supabase, auth.userId, membership.organization_id);
    const payload = buildAlertPayload({
      id: membership.organization_id,
      name: membership.organization_name,
      kind: membership.organization_kind,
      current_role: membership.organization_role,
    }, overview, 'test_send', 'info', 0);

    const results = await deliverPayload(env, {
      organization_id: membership.organization_id,
      destinations,
      payload,
      delivery_kind: 'test_send',
    });

    await writeGovernanceAuditEvent(env, {
      organization_id: membership.organization_id,
      actor_user_id: auth.userId,
      actor_email: auth.email,
      event_type: 'organization_alert_test_sent',
      target_type: 'organization',
      target_id: membership.organization_id,
      description: `Triggered alert test send across ${results.length} destination${results.length === 1 ? '' : 's'}`,
      metadata: {
        destination_count: results.length,
        delivered_count: results.filter((result) => result.status === 'delivered').length,
        failed_count: results.filter((result) => result.status === 'failed').length,
        skipped_count: results.filter((result) => result.status === 'skipped').length,
      },
    });

    return Response.json({ ok: true, payload, results });
  }

  if (method === 'POST' && pathSegments.length === 1 && pathSegments[0] === 'dispatch-current') {
    if (!canManage) {
      return Response.json({ error: 'Insufficient organization permissions' }, { status: 403 });
    }

    const result = await dispatchPolicyAlertsForOrganization(env, membership.organization_id);

    if (!result.ok && !result.skipped) {
      return Response.json({ error: result.reason || 'Failed to dispatch current alerts.' }, { status: 400 });
    }

    if (!result.skipped) {
      await writeGovernanceAuditEvent(env, {
        organization_id: membership.organization_id,
        actor_user_id: auth.userId,
        actor_email: auth.email,
        event_type: 'organization_alert_policy_dispatch_requested',
        target_type: 'organization_alert_policy',
        target_id: membership.organization_id,
        description: `Requested manual policy dispatch for ${membership.organization_name}`,
        metadata: {
          dispatched_alert_count: result.dispatched_alert_count ?? 0,
          destination_count: result.results.length,
        },
      });
    }

    return Response.json(result);
  }

  if (method === 'PUT' && pathSegments.length === 1) {
    if (!canManage) {
      return Response.json({ error: 'Insufficient organization permissions' }, { status: 403 });
    }

    const destinationId = pathSegments[0];
    let body: UpdateAlertDestinationBody;
    try {
      body = (await request.json()) as UpdateAlertDestinationBody;
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const updates: { label?: string; enabled?: boolean; updated_at?: string } = {};
    if (body.label !== undefined) {
      const label = body.label.trim();
      if (label.length < 2) {
        return Response.json({ error: 'A label is required' }, { status: 400 });
      }
      updates.label = label;
    }
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') {
        return Response.json({ error: 'enabled must be boolean' }, { status: 400 });
      }
      updates.enabled = body.enabled;
    }
    if (!Object.keys(updates).length) {
      return Response.json({ error: 'No destination updates provided' }, { status: 400 });
    }
    updates.updated_at = new Date().toISOString();

    const { data: existing } = await supabase
      .from('organization_alert_destinations')
      .select('id, channel_type, label, target, enabled')
      .eq('id', destinationId)
      .eq('organization_id', membership.organization_id)
      .maybeSingle();

    if (!existing) {
      return Response.json({ error: 'Alert destination not found' }, { status: 404 });
    }

    const { data, error } = await supabase
      .from('organization_alert_destinations')
      .update(updates)
      .eq('id', destinationId)
      .eq('organization_id', membership.organization_id)
      .select('id, channel_type, label, target, enabled, created_at, updated_at')
      .single();

    if (error || !data) {
      return Response.json({ error: 'Failed to update alert destination' }, { status: 500 });
    }

    await writeGovernanceAuditEvent(env, {
      organization_id: membership.organization_id,
      actor_user_id: auth.userId,
      actor_email: auth.email,
      event_type: 'organization_alert_destination_updated',
      target_type: 'organization_alert_destination',
      target_id: data.id,
      description: `Updated ${data.channel_type} alert destination ${data.label}`,
      metadata: {
        channel_type: data.channel_type,
        previous_label: existing.label,
        label: data.label,
        previous_enabled: existing.enabled,
        enabled: data.enabled,
        target_masked: maskTarget(data.channel_type, data.target),
      },
    });

    return Response.json({
      destination: {
        id: data.id,
        channel_type: data.channel_type,
        label: data.label,
        target_masked: maskTarget(data.channel_type, data.target),
        enabled: data.enabled,
        created_at: data.created_at,
        updated_at: data.updated_at,
      },
    });
  }

  if (method === 'DELETE' && pathSegments.length === 1) {
    if (!canManage) {
      return Response.json({ error: 'Insufficient organization permissions' }, { status: 403 });
    }

    const destinationId = pathSegments[0];
    const { data: existing } = await supabase
      .from('organization_alert_destinations')
      .select('id, channel_type, label, target')
      .eq('id', destinationId)
      .eq('organization_id', membership.organization_id)
      .maybeSingle();

    if (!existing) {
      return Response.json({ error: 'Alert destination not found' }, { status: 404 });
    }

    const { error } = await supabase
      .from('organization_alert_destinations')
      .delete()
      .eq('id', destinationId)
      .eq('organization_id', membership.organization_id);

    if (error) {
      return Response.json({ error: 'Failed to delete alert destination' }, { status: 500 });
    }

    await writeGovernanceAuditEvent(env, {
      organization_id: membership.organization_id,
      actor_user_id: auth.userId,
      actor_email: auth.email,
      event_type: 'organization_alert_destination_deleted',
      target_type: 'organization_alert_destination',
      target_id: existing.id,
      description: `Removed ${existing.channel_type} alert destination ${existing.label}`,
      metadata: {
        channel_type: existing.channel_type,
        label: existing.label,
        target_masked: maskTarget(existing.channel_type, existing.target),
      },
    });

    return Response.json({ ok: true, id: destinationId });
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}
