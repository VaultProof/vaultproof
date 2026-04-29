import { randomUUID } from 'node:crypto';
import type { EnterpriseControlPlaneEnv } from '../config.js';
import {
  authenticateUser,
  hasRequiredOrganizationRole,
  resolveOrganizationMembership,
} from '../auth.js';
import { getSupabase } from '../supabase.js';

type AlertChannelType = 'email' | 'webhook';
type AlertDeliveryStatus = 'delivered' | 'failed' | 'skipped';
type AlertDeliveryKind = 'test_send' | 'policy_dispatch';
type AlertSeverity = 'info' | 'warning' | 'critical';
type AlertDispatchTriggerSource = 'manual' | 'scheduled';
type AlertActivityWindow = 'all' | '24h' | '7d' | '30d';

type DestinationRow = {
  id: string;
  channel_type: AlertChannelType;
  label: string;
  target: string;
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
};

type TestSendResult = {
  status: AlertDeliveryStatus;
  detail: string;
  responseStatus: number | null;
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

async function parseJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function deliverTestAlert(destination: DestinationRow, organizationName: string): Promise<TestSendResult> {
  if (destination.channel_type === 'email') {
    return {
      status: 'skipped',
      detail: `Email test-send for ${destination.label || destination.id} was recorded; outbound email transport is not configured yet.`,
      responseStatus: null,
    };
  }

  try {
    const response = await fetch(destination.target, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'VaultProof Enterprise Alerts',
      },
      body: JSON.stringify({
        event: 'vaultproof.enterprise.alert.test',
        organization: organizationName,
        destination_id: destination.id,
        sent_at: new Date().toISOString(),
      }),
    });

    return {
      status: response.ok ? 'delivered' : 'failed',
      detail: `Webhook test-send to ${destination.label || destination.id} returned HTTP ${response.status}.`,
      responseStatus: response.status,
    };
  } catch (error) {
    return {
      status: 'failed',
      detail: `Webhook test-send to ${destination.label || destination.id} failed: ${error instanceof Error ? error.message : 'unknown error'}.`,
      responseStatus: null,
    };
  }
}

async function recordDelivery(
  supabase: ReturnType<typeof getSupabase>,
  input: {
    organizationId: string;
    destination: DestinationRow;
    result: TestSendResult;
    deliveredAt: string;
  },
): Promise<void> {
  const { error } = await supabase
    .from('organization_alert_deliveries')
    .insert({
      organization_id: input.organizationId,
      destination_id: input.destination.id,
      channel_type: input.destination.channel_type,
      delivery_kind: 'test_send',
      status: input.result.status,
      detail: input.result.detail,
      response_status: input.result.responseStatus,
      delivered_at: input.deliveredAt,
    });

  if (error) throw new Error(`Failed to record alert delivery: ${error.message}`);
}

async function recordDispatchRun(
  supabase: ReturnType<typeof getSupabase>,
  input: {
    organizationId: string;
    result: TestSendResult;
    checkedAt: string;
  },
): Promise<void> {
  const { error } = await supabase
    .from('organization_alert_dispatch_runs')
    .insert({
      organization_id: input.organizationId,
      trigger_source: 'manual',
      status: input.result.status === 'delivered' ? 'dispatched' : input.result.status === 'failed' ? 'failed' : 'skipped',
      reason: 'manual test send',
      dispatched_alert_count: 1,
      destination_count: 1,
      delivered_count: input.result.status === 'delivered' ? 1 : 0,
      failed_count: input.result.status === 'failed' ? 1 : 0,
      skipped_count: input.result.status === 'skipped' ? 1 : 0,
      next_eligible_at: null,
      checked_at: input.checkedAt,
    });

  if (error) throw new Error(`Failed to record alert dispatch run: ${error.message}`);
}

async function loadPolicy(env: EnterpriseControlPlaneEnv, organizationId: string): Promise<{
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

export async function handleEnterpriseAlertRoutes(
  request: Request,
  env: EnterpriseControlPlaneEnv,
  pathSegments: string[],
): Promise<Response | null> {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) return null;
  const isListRoute = request.method === 'GET' && pathSegments.length === 1 && pathSegments[0] === 'alerts';
  const isTestSendRoute = request.method === 'POST'
    && pathSegments.length === 2
    && pathSegments[0] === 'alerts'
    && pathSegments[1] === 'test-send';
  if (!isListRoute && !isTestSendRoute) {
    return null;
  }

  const auth = await authenticateUser(request, env);
  if (!auth) {
    return Response.json(
      { error: 'Not authenticated. Sign in to VaultProof Enterprise.' },
      { status: 401 },
    );
  }

  const membership = await resolveOrganizationMembership(request, env, auth.userId);
  if (!membership) {
    return Response.json({ error: 'Organization not found' }, { status: 404 });
  }

  const supabase = getSupabase(env);
  const canManage = hasRequiredOrganizationRole(membership.organization_role, 'admin');
  if (isTestSendRoute) {
    if (!canManage) {
      return Response.json({ error: 'Only organization admins can send alert tests.' }, { status: 403 });
    }

    const body = await parseJsonBody(request);
    const requestedDestinationId = typeof body.destination_id === 'string' ? body.destination_id.trim() : '';
    const { data: destinationRows } = await supabase
      .from('organization_alert_destinations')
      .select('id, channel_type, label, target, enabled, created_at, updated_at')
      .eq('organization_id', membership.organization_id)
      .order('created_at', { ascending: false });

    const destinations = ((destinationRows || []) as DestinationRow[]);
    const destination = destinations.find((item) => item.enabled && item.id === requestedDestinationId)
      || (!requestedDestinationId ? destinations.find((item) => item.enabled) : null);
    if (!destination) {
      return Response.json(
        {
          error: requestedDestinationId
            ? 'Alert destination is not enabled or does not exist.'
            : 'No enabled alert destination is available for test-send.',
        },
        { status: 400 },
      );
    }

    const deliveredAt = new Date().toISOString();
    const result = await deliverTestAlert(destination, membership.organization_name);
    await recordDelivery(supabase, {
      organizationId: membership.organization_id,
      destination,
      result,
      deliveredAt,
    });
    await recordDispatchRun(supabase, {
      organizationId: membership.organization_id,
      result,
      checkedAt: deliveredAt,
    });

    return Response.json({
      id: randomUUID(),
      status: result.status,
      delivery_kind: 'test_send',
      detail: result.detail,
      response_status: result.responseStatus,
      delivered_at: deliveredAt,
      destination: {
        id: destination.id,
        channel_type: destination.channel_type,
        label: destination.label,
        target_masked: maskTarget(destination.channel_type, destination.target),
      },
    });
  }

  const queryFilters = parseAlertsQueryFilters(request);
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
