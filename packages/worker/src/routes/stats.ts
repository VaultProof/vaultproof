import type { Env } from '../types.js';
import { getSupabase } from '../lib/supabase.js';
import { authenticateUser } from '../lib/jwt-auth.js';
import { authenticateDevKey } from '../lib/auth.js';

const CALL_ACTIONS = ['api_call', 'transparent_proxy', 'key_retrieval', 'key_retrieval_batch'];

function getMonthStart(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

export async function handleStats(request: Request, env: Env, path: string, ctx?: ExecutionContext): Promise<Response> {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  // Try JWT auth first, fall back to dev-key auth (for MCP server)
  let userId: string;
  const auth = await authenticateUser(request, env);
  if (auth) {
    userId = auth.userId;
  } else {
    const devAuth = await authenticateDevKey(request, env, ctx);
    if (!devAuth) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    userId = devAuth.userId;
  }

  switch (path) {
    case 'overview':
      return handleOverview(userId, env);
    case 'usage':
      return handleUsage(userId, env, request);
    case 'by-key':
      return handleByKey(userId, env);
    default:
      return Response.json({ error: 'Not found' }, { status: 404 });
  }
}

async function handleOverview(userId: string, env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const monthStart = getMonthStart();

  // 1. Get active key slots
  const { data: keySlots } = await supabase
    .from('key_slots')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'ACTIVE');

  const keySlotIds = keySlots?.map((k) => k.id) ?? [];
  const totalKeys = keySlotIds.length;

  if (totalKeys === 0) {
    return Response.json({
      totalKeys: 0,
      totalCalls: 0,
      errorCalls: 0,
      errorRate: 0,
      activeApps: 0,
      recentActivity: [],
    });
  }

  // 2. Parallel queries
  const [callsResult, errorsResult, grantsResult, recentResult] = await Promise.all([
    supabase
      .from('access_logs')
      .select('*', { count: 'exact', head: true })
      .in('key_slot_id', keySlotIds)
      .in('action', CALL_ACTIONS)
      .gte('timestamp', monthStart),
    supabase
      .from('access_logs')
      .select('*', { count: 'exact', head: true })
      .in('key_slot_id', keySlotIds)
      .in('action', CALL_ACTIONS)
      .gte('timestamp', monthStart)
      .like('metadata', '%"error":true%'),
    supabase
      .from('app_grants')
      .select('app_id')
      .in('key_slot_id', keySlotIds)
      .is('revoked_at', null),
    supabase
      .from('access_logs')
      .select('id, app_id, action, timestamp, metadata, key_slot_id')
      .in('key_slot_id', keySlotIds)
      .order('timestamp', { ascending: false })
      .limit(20),
  ]);

  const totalCalls = callsResult.count ?? 0;
  const errorCalls = errorsResult.count ?? 0;
  const errorRate = totalCalls > 0 ? errorCalls / totalCalls : 0;
  const activeApps = new Set(grantsResult.data?.map((g) => g.app_id) ?? []).size;
  const recentLogs = recentResult.data ?? [];

  // 3. Fetch key labels for recent logs
  const recentKeyIds = [...new Set(recentLogs.map((l) => l.key_slot_id))];
  let keyLabels: Record<string, string> = {};
  if (recentKeyIds.length > 0) {
    const { data: keys } = await supabase
      .from('key_slots')
      .select('id, label')
      .in('id', recentKeyIds);
    keyLabels = Object.fromEntries((keys ?? []).map((k) => [k.id, k.label]));
  }

  const recentActivity = recentLogs.map((log) => ({
    id: log.id,
    appId: log.app_id,
    action: log.action,
    timestamp: log.timestamp,
    metadata: log.metadata,
    keySlotId: log.key_slot_id,
    keyLabel: keyLabels[log.key_slot_id] ?? null,
  }));

  return Response.json({
    totalKeys,
    totalCalls,
    errorCalls,
    errorRate,
    activeApps,
    recentActivity,
  });
}

async function handleUsage(userId: string, env: Env, request: Request): Promise<Response> {
  const supabase = getSupabase(env);
  const url = new URL(request.url);
  const daysParam = parseInt(url.searchParams.get('days') ?? '30', 10);
  const days = Math.max(1, Math.min(90, isNaN(daysParam) ? 30 : daysParam));

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  const startIso = startDate.toISOString();

  // 1. Get all key slots for user (not just active)
  const { data: keySlots } = await supabase
    .from('key_slots')
    .select('id')
    .eq('user_id', userId);

  const keySlotIds = keySlots?.map((k) => k.id) ?? [];

  if (keySlotIds.length === 0) {
    return Response.json({ usage: [] });
  }

  // 2. Get logs since startDate (paginate to avoid PostgREST 1000-row default limit)
  let logs: any[] = [];
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const { data } = await supabase
      .from('access_logs')
      .select('timestamp, metadata')
      .in('key_slot_id', keySlotIds)
      .in('action', CALL_ACTIONS)
      .gte('timestamp', startIso)
      .order('timestamp', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (!data || data.length === 0) break;
    logs = logs.concat(data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  // 3. Pre-populate all days in range
  const dayMap: Record<string, { calls: number; errors: number }> = {};
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1 - i));
    const key = d.toISOString().slice(0, 10);
    dayMap[key] = { calls: 0, errors: 0 };
  }

  // 4. Group by day
  for (const log of logs) {
    const day = log.timestamp?.slice(0, 10);
    if (!day || !dayMap[day]) continue;
    dayMap[day].calls++;
    if (typeof log.metadata === 'string' && log.metadata.includes('"error":true')) {
      dayMap[day].errors++;
    } else if (typeof log.metadata === 'object' && log.metadata !== null && (log.metadata as Record<string, unknown>).error === true) {
      dayMap[day].errors++;
    }
  }

  const usage = Object.entries(dayMap).map(([date, data]) => ({
    date,
    calls: data.calls,
    errors: data.errors,
  }));

  return Response.json({ usage });
}

async function handleByKey(userId: string, env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const monthStart = getMonthStart();
  const todayStart = new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z';

  // 1. Get active key slots
  const { data: keySlots } = await supabase
    .from('key_slots')
    .select('id, provider, label, created_at')
    .eq('user_id', userId)
    .eq('status', 'ACTIVE');

  if (!keySlots || keySlots.length === 0) {
    return Response.json({ keys: [] });
  }

  const keyIds = keySlots.map((k) => k.id);

  // 2. Get app_grants for all keys
  const { data: grants } = await supabase
    .from('app_grants')
    .select('key_slot_id, app_id')
    .in('key_slot_id', keyIds)
    .is('revoked_at', null);

  const grantsByKey: Record<string, string[]> = {};
  for (const g of grants ?? []) {
    if (!grantsByKey[g.key_slot_id]) grantsByKey[g.key_slot_id] = [];
    grantsByKey[g.key_slot_id].push(g.app_id);
  }

  // 3. Per-key stats in parallel
  const keyStats = await Promise.all(
    keySlots.map(async (key) => {
      const [monthCalls, dailyCalls, monthErrors, lastLog] = await Promise.all([
        supabase
          .from('access_logs')
          .select('*', { count: 'exact', head: true })
          .eq('key_slot_id', key.id)
          .in('action', CALL_ACTIONS)
          .gte('timestamp', monthStart),
        supabase
          .from('access_logs')
          .select('*', { count: 'exact', head: true })
          .eq('key_slot_id', key.id)
          .in('action', CALL_ACTIONS)
          .gte('timestamp', todayStart),
        supabase
          .from('access_logs')
          .select('*', { count: 'exact', head: true })
          .eq('key_slot_id', key.id)
          .in('action', CALL_ACTIONS)
          .gte('timestamp', monthStart)
          .like('metadata', '%"error":true%'),
        supabase
          .from('access_logs')
          .select('timestamp')
          .eq('key_slot_id', key.id)
          .order('timestamp', { ascending: false })
          .limit(1),
      ]);

      return {
        id: key.id,
        provider: key.provider,
        label: key.label,
        createdAt: key.created_at,
        apps: grantsByKey[key.id] ?? [],
        callsThisMonth: monthCalls.count ?? 0,
        dailyUsed: dailyCalls.count ?? 0,
        monthlyUsed: monthCalls.count ?? 0,
        errorsThisMonth: monthErrors.count ?? 0,
        lastUsed: lastLog.data?.[0]?.timestamp ?? null,
      };
    }),
  );

  return Response.json({ keys: keyStats });
}
