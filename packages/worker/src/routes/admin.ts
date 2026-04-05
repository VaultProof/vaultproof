import type { Env } from '../types.js';
import { getSupabase } from '../lib/supabase.js';
import { authenticateAdmin } from '../lib/jwt-auth.js';

export async function handleAdmin(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  if (path === 'stats') return handleStats(request, env);
  if (path === 'analytics/overview') return handleOverview(request, env);
  if (path === 'analytics/referral-stats') return handleReferralStats(request, env);
  if (path === 'analytics/traffic') return handleTraffic(request, env);
  if (path === 'analytics/pages') return handlePages(request, env);
  if (path === 'analytics/referrers') return handleReferrers(request, env);
  if (path === 'analytics/signups') return handleSignups(request, env);
  if (path === 'promo/stats') return handlePromoStats(request, env);
  if (path === 'promo/users') return handlePromoUsers(request, env);
  if (path === 'promo/feedback') return handlePromoFeedback(request, env);
  if (path === 'users') return handleUsers(request, env);
  if (path === 'logs') return handleGlobalLogs(request, env);
  if (path === 'monitoring/dashboard') return handleMonitoringDashboard(request, env);
  if (path === 'monitoring/alerts') return handleMonitoringAlerts(request, env);
  // Dynamic user routes: users/:userId, users/:userId/stats, users/:userId/logs, users/:userId/ban, users/:userId/tier
  const userMatch = path.match(/^users\/([^/]+)(?:\/(.+))?$/);
  if (userMatch) {
    const userId = userMatch[1];
    const sub = userMatch[2] || '';
    if (sub === '') return handleUserDetail(request, env, userId);
    if (sub === 'stats') return handleUserStats(request, env, userId);
    if (sub === 'logs') return handleUserLogs(request, env, userId);
    if (sub === 'ban') return handleBanUser(request, env, userId);
    if (sub === 'tier') return handleChangeTier(request, env, userId);
  }
  return Response.json({ error: 'Not found' }, { status: 404 });
}

async function handleStats(request: Request, env: Env): Promise<Response> {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = getSupabase(env);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString();

  const [authUsers, totalKeys, totalDevKeys, callsToday, callsThisMonth, totalCallsAllTime] = await Promise.all([
    supabase.auth.admin.listUsers({ perPage: 1, page: 1 }),
    supabase.from('key_slots').select('*', { count: 'exact', head: true }).eq('status', 'ACTIVE'),
    supabase.from('developer_keys').select('*', { count: 'exact', head: true }).is('revoked_at', null),
    supabase.from('access_logs').select('*', { count: 'exact', head: true }).gte('timestamp', todayStart),
    supabase.from('access_logs').select('*', { count: 'exact', head: true }).gte('timestamp', monthStart),
    supabase.from('access_logs').select('*', { count: 'exact', head: true }),
  ]);
  const totalUserCount = authUsers.data?.users ? (await supabase.auth.admin.listUsers({ perPage: 1000, page: 1 })).data?.users?.length || 0 : 0;

  // Active users last 7 days
  const { data: recentLogs } = await supabase
    .from('access_logs')
    .select('key_slot_id')
    .gte('timestamp', weekAgo);

  let activeUserCount = 0;
  if (recentLogs && recentLogs.length > 0) {
    const keySlotIds = [...new Set(recentLogs.map((l: any) => l.key_slot_id))];
    const { data: slots } = await supabase
      .from('key_slots')
      .select('user_id')
      .in('id', keySlotIds);
    activeUserCount = new Set((slots || []).map((s: any) => s.user_id)).size;
  }

  // Tier breakdown
  const { data: users } = await supabase.from('users').select('tier');
  const tiers: Record<string, number> = {};
  for (const u of users || []) {
    tiers[u.tier] = (tiers[u.tier] || 0) + 1;
  }

  return Response.json({
    totalUsers: totalUserCount,
    totalKeys: totalKeys.count || 0,
    totalDevKeys: totalDevKeys.count || 0,
    callsToday: callsToday.count || 0,
    callsThisMonth: callsThisMonth.count || 0,
    totalCallsAllTime: totalCallsAllTime.count || 0,
    activeUsersLast7Days: activeUserCount,
    tiers,
  });
}


async function handleOverview(request: Request, env: Env): Promise<Response> {
  const admin = await authenticateAdmin(request, env);
  if (!admin) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (request.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const supabase = getSupabase(env);

  const [
    viewsTodayRes,
    viewsWeekRes,
    viewsMonthRes,
    signupsTodayRes,
    signupsWeekRes,
    signupsMonthRes,
    totalUsersRes,
    visitorsTodayRes,
  ] = await Promise.all([
    // 1. Views today
    supabase
      .from('analytics_events')
      .select('*', { count: 'exact', head: true })
      .eq('type', 'pageview')
      .gte('created_at', todayStart),
    // 2. Views this week
    supabase
      .from('analytics_events')
      .select('*', { count: 'exact', head: true })
      .eq('type', 'pageview')
      .gte('created_at', weekAgo),
    // 3. Views this month
    supabase
      .from('analytics_events')
      .select('*', { count: 'exact', head: true })
      .eq('type', 'pageview')
      .gte('created_at', monthAgo),
    // 4. Signups today
    supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', todayStart),
    // 5. Signups this week
    supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', weekAgo),
    // 6. Signups this month
    supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', monthAgo),
    // 7. Total users (from Supabase Auth)
    supabase.auth.admin.listUsers({ perPage: 1000, page: 1 }),
    // 8. Visitors today (need session_id for dedup)
    supabase
      .from('analytics_events')
      .select('session_id')
      .eq('type', 'pageview')
      .gte('created_at', todayStart),
  ]);

  const uniqueSessionIds = new Set(
    (visitorsTodayRes.data || [])
      .map((row: { session_id: string | null }) => row.session_id)
      .filter(Boolean),
  );

  return Response.json({
    viewsToday: viewsTodayRes.count ?? 0,
    viewsWeek: viewsWeekRes.count ?? 0,
    viewsMonth: viewsMonthRes.count ?? 0,
    visitorsToday: uniqueSessionIds.size,
    signupsToday: signupsTodayRes.count ?? 0,
    signupsWeek: signupsWeekRes.count ?? 0,
    signupsMonth: signupsMonthRes.count ?? 0,
    totalUsers: totalUsersRes.data?.users?.length ?? 0,
  });
}

async function handleReferralStats(request: Request, env: Env): Promise<Response> {
  const admin = await authenticateAdmin(request, env);
  if (!admin) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (request.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const url = new URL(request.url);
  const daysParam = parseInt(url.searchParams.get('days') || '30', 10);
  const days = Math.max(1, Math.min(90, isNaN(daysParam) ? 30 : daysParam));
  const source = url.searchParams.get('source') || 'promptsforeveryone';

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const supabase = getSupabase(env);

  const [clicksRes, visitsRes] = await Promise.all([
    // Ad clicks: pageviews on /ad-click/* pages
    supabase
      .from('analytics_events')
      .select('session_id, page, created_at')
      .eq('type', 'pageview')
      .like('page', '/ad-click/%')
      .gte('created_at', since),
    // Landing visits: pageviews referred from source, excluding ad-click pages
    supabase
      .from('analytics_events')
      .select('session_id, page, created_at')
      .eq('type', 'pageview')
      .like('referrer', `%${source}%`)
      .not('page', 'like', '/ad-click/%')
      .gte('created_at', since),
  ]);

  const clicks = clicksRes.data || [];
  const visits = visitsRes.data || [];

  // Collect all referral session IDs for signup attribution
  const referralSessionIds = new Set<string>();
  for (const row of clicks) {
    if (row.session_id) referralSessionIds.add(row.session_id);
  }
  for (const row of visits) {
    if (row.session_id) referralSessionIds.add(row.session_id);
  }

  // Count signups from referral sessions
  let signupsFromReferral = 0;
  if (referralSessionIds.size > 0) {
    const { count } = await supabase
      .from('analytics_events')
      .select('*', { count: 'exact', head: true })
      .eq('type', 'signup')
      .in('session_id', Array.from(referralSessionIds))
      .gte('created_at', since);
    signupsFromReferral = count ?? 0;
  }

  // Unique clickers and visitors
  const uniqueClickers = new Set(
    clicks.map((r: { session_id: string | null }) => r.session_id).filter(Boolean),
  );
  const uniqueVisitors = new Set(
    visits.map((r: { session_id: string | null }) => r.session_id).filter(Boolean),
  );

  // Group clicks by ad variant (extract from /ad-click/{variant})
  const byVariant: Record<string, number> = {};
  for (const row of clicks) {
    const match = (row.page as string)?.match(/^\/ad-click\/(.+)/);
    if (match) {
      const variant = match[1];
      byVariant[variant] = (byVariant[variant] || 0) + 1;
    }
  }

  // Group by day
  const dailyMap = new Map<string, { clicks: number; visits: number; sessions: Set<string> }>();

  for (const row of clicks) {
    const date = (row.created_at as string).slice(0, 10);
    if (!dailyMap.has(date)) {
      dailyMap.set(date, { clicks: 0, visits: 0, sessions: new Set() });
    }
    const day = dailyMap.get(date)!;
    day.clicks++;
    if (row.session_id) day.sessions.add(row.session_id);
  }

  for (const row of visits) {
    const date = (row.created_at as string).slice(0, 10);
    if (!dailyMap.has(date)) {
      dailyMap.set(date, { clicks: 0, visits: 0, sessions: new Set() });
    }
    const day = dailyMap.get(date)!;
    day.visits++;
    if (row.session_id) day.sessions.add(row.session_id);
  }

  const daily = Array.from(dailyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({
      date,
      clicks: data.clicks,
      visits: data.visits,
      uniqueVisitors: data.sessions.size,
    }));

  // Conversion rate: signups / unique referral sessions
  const totalUnique = referralSessionIds.size;
  const conversionRate = totalUnique > 0
    ? Math.round((signupsFromReferral / totalUnique) * 10000) / 100
    : 0;

  return Response.json({
    source,
    period: `${days} days`,
    summary: {
      totalAdClicks: clicks.length,
      uniqueAdClickers: uniqueClickers.size,
      totalLandingVisits: visits.length,
      uniqueLandingVisitors: uniqueVisitors.size,
      signupsFromReferral,
      conversionRate,
    },
    byVariant,
    daily,
  });
}

function getDaysParam(request: Request): number {
  const url = new URL(request.url);
  const d = parseInt(url.searchParams.get('days') || '30', 10);
  return Math.min(90, Math.max(1, isNaN(d) ? 30 : d));
}

async function handleTraffic(request: Request, env: Env): Promise<Response> {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = getSupabase(env);
  const numDays = getDaysParam(request);
  const since = new Date(Date.now() - numDays * 86400000).toISOString();

  const { data: events } = await supabase.from('analytics_events')
    .select('created_at, session_id')
    .eq('type', 'pageview').gte('created_at', since)
    .order('created_at', { ascending: true });

  const dailyMap: Record<string, { views: number; visitors: Set<string> }> = {};
  for (const e of events || []) {
    const day = e.created_at.slice(0, 10);
    if (!dailyMap[day]) dailyMap[day] = { views: 0, visitors: new Set() };
    dailyMap[day].views++;
    if (e.session_id) dailyMap[day].visitors.add(e.session_id);
  }

  const traffic = Object.entries(dailyMap).sort().map(([date, d]) => ({
    date, views: d.views, visitors: d.visitors.size,
  }));

  return Response.json({ traffic });
}

async function handlePages(request: Request, env: Env): Promise<Response> {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = getSupabase(env);
  const numDays = getDaysParam(request);
  const since = new Date(Date.now() - numDays * 86400000).toISOString();

  const { data: events } = await supabase.from('analytics_events')
    .select('page')
    .eq('type', 'pageview').gte('created_at', since);

  const pageCounts: Record<string, number> = {};
  for (const e of events || []) {
    if (e.page) pageCounts[e.page] = (pageCounts[e.page] || 0) + 1;
  }

  const pages = Object.entries(pageCounts)
    .map(([page, views]) => ({ page, views }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 20);

  return Response.json({ pages });
}

async function handleReferrers(request: Request, env: Env): Promise<Response> {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = getSupabase(env);
  const numDays = getDaysParam(request);
  const since = new Date(Date.now() - numDays * 86400000).toISOString();

  const { data: events } = await supabase.from('analytics_events')
    .select('referrer')
    .eq('type', 'pageview').not('referrer', 'is', null).gte('created_at', since);

  const refCounts: Record<string, number> = {};
  for (const e of events || []) {
    if (e.referrer) refCounts[e.referrer] = (refCounts[e.referrer] || 0) + 1;
  }

  const referrers = Object.entries(refCounts)
    .map(([referrer, count]) => ({ referrer, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  return Response.json({ referrers });
}

async function handleSignups(request: Request, env: Env): Promise<Response> {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = getSupabase(env);
  const numDays = getDaysParam(request);
  const since = new Date(Date.now() - numDays * 86400000).toISOString();

  const [usersRes, totalRes] = await Promise.all([
    supabase.from('users').select('created_at').gte('created_at', since).order('created_at', { ascending: true }),
    supabase.from('users').select('*', { count: 'exact', head: true }),
  ]);

  const dailyMap: Record<string, number> = {};
  for (const u of usersRes.data || []) {
    const day = u.created_at.slice(0, 10);
    dailyMap[day] = (dailyMap[day] || 0) + 1;
  }

  const signups = Object.entries(dailyMap).sort().map(([date, count]) => ({ date, count }));

  return Response.json({ signups, totalSignups: totalRes.count || 0 });
}

async function handlePromoStats(request: Request, env: Env): Promise<Response> {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = getSupabase(env);

  const [redeemedRes, feedbackRes, usersRes] = await Promise.all([
    supabase.from('users').select('*', { count: 'exact', head: true }).not('promo_code', 'is', null),
    supabase.from('promo_feedback').select('*', { count: 'exact', head: true }),
    supabase.from('users').select('promo_code').not('promo_code', 'is', null),
  ]);

  const byCode: Record<string, number> = {};
  for (const u of usersRes.data || []) {
    byCode[u.promo_code] = (byCode[u.promo_code] || 0) + 1;
  }

  return Response.json({
    totalRedeemed: redeemedRes.count || 0,
    totalFeedback: feedbackRes.count || 0,
    byCode: Object.entries(byCode).map(([promoCode, count]) => ({ promoCode, _count: { id: count } })),
  });
}

async function handlePromoUsers(request: Request, env: Env): Promise<Response> {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = getSupabase(env);
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)));
  const offset = (page - 1) * limit;

  const [usersRes, totalRes] = await Promise.all([
    supabase.from('users')
      .select('id, email, tier, promo_code, tier_expires_at, created_at')
      .not('promo_code', 'is', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1),
    supabase.from('users').select('*', { count: 'exact', head: true }).not('promo_code', 'is', null),
  ]);

  // Get feedback counts per user
  const userIds = (usersRes.data || []).map((u: any) => u.id);
  let feedbackCounts: Record<string, number> = {};
  if (userIds.length > 0) {
    const { data: fb } = await supabase.from('promo_feedback').select('user_id').in('user_id', userIds);
    for (const f of fb || []) {
      feedbackCounts[f.user_id] = (feedbackCounts[f.user_id] || 0) + 1;
    }
  }

  const users = (usersRes.data || []).map((u: any) => ({
    id: u.id, email: u.email, tier: u.tier, promoCode: u.promo_code,
    tierExpiresAt: u.tier_expires_at, createdAt: u.created_at,
    _count: { promoFeedback: feedbackCounts[u.id] || 0 },
  }));

  return Response.json({ users, total: totalRes.count || 0, page, limit });
}

async function handlePromoFeedback(request: Request, env: Env): Promise<Response> {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = getSupabase(env);
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)));
  const offset = (page - 1) * limit;

  const [fbRes, totalRes] = await Promise.all([
    supabase.from('promo_feedback')
      .select('id, feedback, created_at, user_id')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1),
    supabase.from('promo_feedback').select('*', { count: 'exact', head: true }),
  ]);

  // Get user emails
  const userIds = [...new Set((fbRes.data || []).map((f: any) => f.user_id))];
  let userMap: Record<string, { email: string; promo_code: string }> = {};
  if (userIds.length > 0) {
    const { data: users } = await supabase.from('users').select('id, email, promo_code').in('id', userIds);
    for (const u of users || []) userMap[u.id] = { email: u.email, promo_code: u.promo_code };
  }

  const feedback = (fbRes.data || []).map((f: any) => ({
    id: f.id, feedback: f.feedback, createdAt: f.created_at,
    user: userMap[f.user_id] || { email: 'unknown', promoCode: null },
  }));

  return Response.json({ feedback, total: totalRes.count || 0, page, limit });
}

async function handleUsers(request: Request, env: Env): Promise<Response> {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = getSupabase(env);
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)));
  const search = url.searchParams.get('search') || '';

  // Get users from Supabase Auth (source of truth)
  const { data: authData } = await supabase.auth.admin.listUsers({ perPage: 1000, page: 1 });
  let authUsers = authData?.users || [];

  // Filter by search
  if (search) {
    const s = search.toLowerCase();
    authUsers = authUsers.filter((u: any) => u.email?.toLowerCase().includes(s));
  }

  // Sort by created_at descending
  authUsers.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const total = authUsers.length;
  const offset = (page - 1) * limit;
  const pageUsers = authUsers.slice(offset, offset + limit);

  // Get tier info from public.users for these IDs
  const userIds = pageUsers.map((u: any) => u.id);
  const { data: publicUsers } = await supabase
    .from('users')
    .select('id, tier, kill_switch')
    .in('id', userIds);
  const publicMap = new Map((publicUsers || []).map((u: any) => [u.id, u]));

  // Enrich with key counts and total calls
  const enriched = await Promise.all(pageUsers.map(async (user: any) => {
    const pub = publicMap.get(user.id);
    const [keysRes, devKeysRes, slotsRes] = await Promise.all([
      supabase.from('key_slots').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
      supabase.from('developer_keys').select('*', { count: 'exact', head: true }).eq('user_id', user.id).is('revoked_at', null),
      supabase.from('key_slots').select('id').eq('user_id', user.id),
    ]);

    const keySlotIds = (slotsRes.data || []).map((k: any) => k.id);
    let totalCalls = 0;
    if (keySlotIds.length > 0) {
      const { count } = await supabase.from('access_logs').select('*', { count: 'exact', head: true }).in('key_slot_id', keySlotIds);
      totalCalls = count || 0;
    }

    return {
      id: user.id, email: user.email, tier: pub?.tier || 'free',
      createdAt: user.created_at, killSwitch: pub?.kill_switch || false,
      keyCount: keysRes.count || 0, devKeyCount: devKeysRes.count || 0, totalCalls,
    };
  }));

  return Response.json({ users: enriched, total, page, limit });
}

async function handleUserDetail(request: Request, env: Env, userId: string): Promise<Response> {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = getSupabase(env);
  // Get user from Supabase Auth
  const { data: authUser } = await supabase.auth.admin.getUserById(userId);
  if (!authUser?.user) return Response.json({ error: 'User not found' }, { status: 404 });
  // Get extra fields from public.users
  const { data: pubUser } = await supabase.from('users').select('*').eq('id', userId).single();
  const user = { ...pubUser, id: authUser.user.id, email: authUser.user.email, created_at: authUser.user.created_at };

  const [keySlotsRes, devKeysRes] = await Promise.all([
    supabase.from('key_slots')
      .select('id, provider, label, status, daily_limit, monthly_limit, created_at, rotated_at, expires_at')
      .eq('user_id', userId).order('created_at', { ascending: false }),
    supabase.from('developer_keys')
      .select('id, label, mode, allowed_ips, allowed_providers, allowed_endpoints, last_used, created_at, revoked_at')
      .eq('user_id', userId).order('created_at', { ascending: false }),
  ]);

  const keySlotIds = (keySlotsRes.data || []).map((k: any) => k.id);
  let totalCalls = 0;
  let recentActivity: any[] = [];

  if (keySlotIds.length > 0) {
    const [callsRes, logsRes] = await Promise.all([
      supabase.from('access_logs').select('*', { count: 'exact', head: true }).in('key_slot_id', keySlotIds),
      supabase.from('access_logs')
        .select('id, app_id, action, timestamp, metadata, key_slot_id')
        .in('key_slot_id', keySlotIds).order('timestamp', { ascending: false }).limit(50),
    ]);
    totalCalls = callsRes.count || 0;

    // Get key labels
    const keyMap: Record<string, { provider: string; label: string }> = {};
    for (const k of keySlotsRes.data || []) keyMap[k.id] = { provider: k.provider, label: k.label };

    recentActivity = (logsRes.data || []).map((l: any) => ({
      id: l.id, appId: l.app_id, action: l.action, timestamp: l.timestamp,
      metadata: l.metadata, keySlot: keyMap[l.key_slot_id] || { provider: 'unknown', label: 'unknown' },
    }));
  }

  return Response.json({
    id: user.id, email: user.email, tier: user.tier,
    stripeCustomerId: user.stripe_customer_id, stripeSubscriptionId: user.stripe_subscription_id,
    globalDailyLimit: user.global_daily_limit, globalMonthlyLimit: user.global_monthly_limit,
    killSwitch: user.kill_switch, createdAt: user.created_at,
    keySlots: (keySlotsRes.data || []).map((k: any) => ({
      id: k.id, provider: k.provider, label: k.label, status: k.status,
      dailyLimit: k.daily_limit, monthlyLimit: k.monthly_limit,
      createdAt: k.created_at, rotatedAt: k.rotated_at, expiresAt: k.expires_at,
    })),
    developerKeys: (devKeysRes.data || []).map((k: any) => ({
      id: k.id, label: k.label, mode: k.mode, allowedIps: k.allowed_ips,
      allowedProviders: k.allowed_providers, allowedEndpoints: k.allowed_endpoints,
      lastUsed: k.last_used, createdAt: k.created_at, revokedAt: k.revoked_at,
    })),
    totalCalls, recentActivity,
  });
}

async function handleUserStats(request: Request, env: Env, userId: string): Promise<Response> {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = getSupabase(env);
  const numDays = getDaysParam(request);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const startDate = new Date(now.getTime() - numDays * 86400000).toISOString();
  const CALL_ACTIONS = ['api_call', 'transparent_proxy', 'key_retrieval', 'key_retrieval_batch'];

  const { data: keySlots } = await supabase.from('key_slots')
    .select('id, provider, label, created_at')
    .eq('user_id', userId).eq('status', 'ACTIVE');

  const keySlotIds = (keySlots || []).map((k: any) => k.id);

  // Overview
  let totalCalls = 0, errorCalls = 0, activeAppsCount = 0;
  if (keySlotIds.length > 0) {
    const [callsRes, errorsRes, appsRes] = await Promise.all([
      supabase.from('access_logs').select('*', { count: 'exact', head: true }).in('key_slot_id', keySlotIds).in('action', CALL_ACTIONS).gte('timestamp', monthStart),
      supabase.from('access_logs').select('*', { count: 'exact', head: true }).in('key_slot_id', keySlotIds).in('action', CALL_ACTIONS).gte('timestamp', monthStart).like('metadata', '%"error":true%'),
      supabase.from('app_grants').select('app_id').in('key_slot_id', keySlotIds).is('revoked_at', null),
    ]);
    totalCalls = callsRes.count || 0;
    errorCalls = errorsRes.count || 0;
    activeAppsCount = new Set((appsRes.data || []).map((a: any) => a.app_id)).size;
  }

  // Usage chart
  let logs: any[] = [];
  if (keySlotIds.length > 0) {
    const { data } = await supabase.from('access_logs')
      .select('timestamp, metadata')
      .in('key_slot_id', keySlotIds).in('action', CALL_ACTIONS)
      .gte('timestamp', startDate).order('timestamp', { ascending: true });
    logs = data || [];
  }

  const dailyMap: Record<string, { calls: number; errors: number }> = {};
  for (let i = 0; i < numDays; i++) {
    const d = new Date(now.getTime() - (numDays - 1 - i) * 86400000);
    dailyMap[d.toISOString().slice(0, 10)] = { calls: 0, errors: 0 };
  }
  for (const log of logs) {
    const day = log.timestamp?.slice(0, 10);
    if (day && dailyMap[day]) {
      dailyMap[day].calls++;
      if (typeof log.metadata === 'string' && log.metadata.includes('"error":true')) dailyMap[day].errors++;
    }
  }

  // Per-key breakdown
  const keys = await Promise.all((keySlots || []).map(async (key: any) => {
    const [monthlyRes, dailyRes, errorRes, lastRes] = await Promise.all([
      supabase.from('access_logs').select('*', { count: 'exact', head: true }).eq('key_slot_id', key.id).in('action', CALL_ACTIONS).gte('timestamp', monthStart),
      supabase.from('access_logs').select('*', { count: 'exact', head: true }).eq('key_slot_id', key.id).in('action', CALL_ACTIONS).gte('timestamp', dayStart),
      supabase.from('access_logs').select('*', { count: 'exact', head: true }).eq('key_slot_id', key.id).in('action', CALL_ACTIONS).gte('timestamp', monthStart).like('metadata', '%"error":true%'),
      supabase.from('access_logs').select('timestamp').eq('key_slot_id', key.id).order('timestamp', { ascending: false }).limit(1),
    ]);
    // Get app grants
    const { data: grants } = await supabase.from('app_grants').select('app_id, app_name').eq('key_slot_id', key.id).is('revoked_at', null);
    return {
      id: key.id, provider: key.provider, label: key.label, createdAt: key.created_at,
      apps: (grants || []).map((g: any) => ({ appId: g.app_id, appName: g.app_name })),
      callsToday: dailyRes.count || 0, callsThisMonth: monthlyRes.count || 0,
      errorsThisMonth: errorRes.count || 0, lastUsed: lastRes.data?.[0]?.timestamp || null,
    };
  }));

  return Response.json({
    overview: {
      totalKeys: (keySlots || []).length, totalCalls, errorCalls,
      errorRate: totalCalls > 0 ? Math.round((errorCalls / totalCalls) * 100) : 0,
      activeApps: activeAppsCount,
    },
    usage: Object.entries(dailyMap).sort().map(([date, d]) => ({ date, ...d })),
    keys,
  });
}

async function handleUserLogs(request: Request, env: Env, userId: string): Promise<Response> {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = getSupabase(env);
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit') || '100', 10)));
  const offset = (page - 1) * limit;

  const { data: slots } = await supabase.from('key_slots').select('id, provider, label').eq('user_id', userId);
  const keySlotIds = (slots || []).map((k: any) => k.id);

  if (keySlotIds.length === 0) return Response.json({ logs: [], total: 0, page, limit });

  const keyMap: Record<string, { provider: string; label: string }> = {};
  for (const k of slots || []) keyMap[k.id] = { provider: k.provider, label: k.label };

  const [logsRes, totalRes] = await Promise.all([
    supabase.from('access_logs')
      .select('id, app_id, action, timestamp, metadata, key_slot_id')
      .in('key_slot_id', keySlotIds).order('timestamp', { ascending: false })
      .range(offset, offset + limit - 1),
    supabase.from('access_logs').select('*', { count: 'exact', head: true }).in('key_slot_id', keySlotIds),
  ]);

  const logs = (logsRes.data || []).map((l: any) => ({
    id: l.id, appId: l.app_id, action: l.action, timestamp: l.timestamp,
    metadata: l.metadata, keySlot: keyMap[l.key_slot_id] || { provider: 'unknown', label: 'unknown' },
  }));

  return Response.json({ logs, total: totalRes.count || 0, page, limit });
}

async function handleGlobalLogs(request: Request, env: Env): Promise<Response> {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = getSupabase(env);
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit') || '100', 10)));
  const action = url.searchParams.get('action') || '';
  const offset = (page - 1) * limit;

  let query = supabase.from('access_logs')
    .select('id, app_id, action, timestamp, metadata, key_slot_id', { count: 'exact' })
    .order('timestamp', { ascending: false })
    .range(offset, offset + limit - 1);

  if (action) query = query.eq('action', action);

  const { data: logs, count: total } = await query;

  // Get key slot details
  const keySlotIds = [...new Set((logs || []).map((l: any) => l.key_slot_id))];
  let keyMap: Record<string, { provider: string; label: string; userId: string; email: string }> = {};
  if (keySlotIds.length > 0) {
    const { data: slots } = await supabase.from('key_slots').select('id, provider, label, user_id').in('id', keySlotIds);
    const userIds = [...new Set((slots || []).map((s: any) => s.user_id))];
    let userMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: users } = await supabase.from('users').select('id, email').in('id', userIds);
      for (const u of users || []) userMap[u.id] = u.email;
    }
    for (const s of slots || []) {
      keyMap[s.id] = { provider: s.provider, label: s.label, userId: s.user_id, email: userMap[s.user_id] || 'unknown' };
    }
  }

  const enrichedLogs = (logs || []).map((l: any) => ({
    id: l.id, appId: l.app_id, action: l.action, timestamp: l.timestamp, metadata: l.metadata,
    keySlot: keyMap[l.key_slot_id] ? {
      provider: keyMap[l.key_slot_id].provider, label: keyMap[l.key_slot_id].label,
      userId: keyMap[l.key_slot_id].userId, user: { email: keyMap[l.key_slot_id].email },
    } : null,
  }));

  return Response.json({ logs: enrichedLogs, total: total || 0, page, limit });
}

async function handleBanUser(request: Request, env: Env, userId: string): Promise<Response> {
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
  const admin = await authenticateAdmin(request, env);
  if (!admin) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = getSupabase(env);
  const { data: user } = await supabase.from('users').select('id, email, tier').eq('id', userId).single();
  if (!user) return Response.json({ error: 'User not found' }, { status: 404 });
  if (user.tier === 'banned') return Response.json({ message: 'User is already banned', userId });

  const now = new Date().toISOString();
  await Promise.all([
    supabase.from('users').update({ tier: 'banned', kill_switch: true }).eq('id', userId),
    supabase.from('developer_keys').update({ revoked_at: now }).eq('user_id', userId).is('revoked_at', null),
  ]);

  return Response.json({ message: 'User banned and all developer keys revoked', userId, email: user.email });
}

async function handleChangeTier(request: Request, env: Env, userId: string): Promise<Response> {
  if (request.method !== 'PUT') return Response.json({ error: 'Method not allowed' }, { status: 405 });
  const admin = await authenticateAdmin(request, env);
  if (!admin) return Response.json({ error: 'Forbidden' }, { status: 403 });

  let body: any;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const validTiers = ['free', 'starter', 'pro', 'max', 'enterprise', 'banned'];
  if (!body.tier || !validTiers.includes(body.tier)) {
    return Response.json({ error: 'Invalid tier' }, { status: 400 });
  }

  const supabase = getSupabase(env);
  const { data: user } = await supabase.from('users').select('id, email').eq('id', userId).single();
  if (!user) return Response.json({ error: 'User not found' }, { status: 404 });

  await supabase.from('users').update({ tier: body.tier }).eq('id', userId);
  return Response.json({ message: 'Tier updated', userId, email: user.email, tier: body.tier });
}

async function handleMonitoringDashboard(request: Request, env: Env): Promise<Response> {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = getSupabase(env);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
  const dayAgo = new Date(now.getTime() - 86400000).toISOString();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthAgo = new Date(now.getTime() - 30 * 86400000).toISOString();
  const CALL_ACTIONS = ['api_call', 'transparent_proxy', 'key_retrieval', 'key_retrieval_batch'];

  const [callsTodayRes, callsWeekRes, callsMonthRes, errorMonthRes, recentLogsDay, recentLogs7d, recentLogs30d] = await Promise.all([
    supabase.from('access_logs').select('*', { count: 'exact', head: true }).in('action', CALL_ACTIONS).gte('timestamp', todayStart),
    supabase.from('access_logs').select('*', { count: 'exact', head: true }).in('action', CALL_ACTIONS).gte('timestamp', weekAgo),
    supabase.from('access_logs').select('*', { count: 'exact', head: true }).in('action', CALL_ACTIONS).gte('timestamp', monthStart),
    supabase.from('access_logs').select('*', { count: 'exact', head: true }).in('action', CALL_ACTIONS).gte('timestamp', monthStart).like('metadata', '%"error":true%'),
    supabase.from('access_logs').select('key_slot_id').in('action', CALL_ACTIONS).gte('timestamp', dayAgo),
    supabase.from('access_logs').select('key_slot_id').in('action', CALL_ACTIONS).gte('timestamp', weekAgo),
    supabase.from('access_logs').select('key_slot_id').in('action', CALL_ACTIONS).gte('timestamp', monthAgo),
  ]);

  // Count active users for each period
  async function countActiveUsers(logs: any[]): Promise<number> {
    if (!logs || logs.length === 0) return 0;
    const keySlotIds = [...new Set(logs.map((l: any) => l.key_slot_id))];
    const { data: slots } = await supabase.from('key_slots').select('user_id').in('id', keySlotIds.slice(0, 100));
    return new Set((slots || []).map((s: any) => s.user_id)).size;
  }

  const [activeUsers24h, activeUsers7d, activeUsers30d] = await Promise.all([
    countActiveUsers(recentLogsDay.data || []),
    countActiveUsers(recentLogs7d.data || []),
    countActiveUsers(recentLogs30d.data || []),
  ]);

  const callsMonth = callsMonthRes.count || 0;
  const errorsMonth = errorMonthRes.count || 0;
  const errorRate = callsMonth > 0 ? Math.round((errorsMonth / callsMonth) * 100) : 0;

  // Top endpoints: parse metadata from recent proxy calls
  const { data: recentProxyCalls } = await supabase
    .from('access_logs')
    .select('metadata')
    .eq('action', 'transparent_proxy')
    .gte('timestamp', monthStart)
    .limit(2000);

  const endpointCounts: Record<string, { provider: string; endpoint: string; count: number }> = {};
  for (const log of recentProxyCalls || []) {
    try {
      const meta = typeof log.metadata === 'string' ? JSON.parse(log.metadata) : log.metadata;
      if (meta?.provider && meta?.endpoint) {
        const key = `${meta.provider}:${meta.endpoint}`;
        if (!endpointCounts[key]) {
          endpointCounts[key] = { provider: meta.provider, endpoint: meta.endpoint, count: 0 };
        }
        endpointCounts[key].count++;
      }
    } catch { /* skip malformed metadata */ }
  }

  const topEndpoints = Object.values(endpointCounts)
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  // Users near rate limit: check tier limits vs usage
  const TIER_LIMITS: Record<string, number> = {
    free: 10000, starter: 50000, pro: 500000, max: 500000, enterprise: 999999999,
  };

  const { data: allUsers } = await supabase.from('users').select('id, tier');
  let usersNearLimit = 0;

  if (allUsers && allUsers.length > 0) {
    // Get all key slots and count monthly usage per user
    const { data: allSlots } = await supabase.from('key_slots').select('id, user_id').eq('status', 'ACTIVE');
    if (allSlots && allSlots.length > 0) {
      const userSlotMap: Record<string, string[]> = {};
      for (const s of allSlots) {
        if (!userSlotMap[s.user_id]) userSlotMap[s.user_id] = [];
        userSlotMap[s.user_id].push(s.id);
      }

      // Get monthly usage counts by key_slot_id
      const slotIds = allSlots.map((s: any) => s.id);
      const { data: monthlyLogs } = await supabase
        .from('access_logs')
        .select('key_slot_id')
        .in('key_slot_id', slotIds.slice(0, 200))
        .in('action', CALL_ACTIONS)
        .gte('timestamp', monthStart);

      const slotUsage: Record<string, number> = {};
      for (const log of monthlyLogs || []) {
        slotUsage[log.key_slot_id] = (slotUsage[log.key_slot_id] || 0) + 1;
      }

      for (const user of allUsers) {
        const limit = TIER_LIMITS[user.tier] || TIER_LIMITS.free;
        const userSlots = userSlotMap[user.id] || [];
        let userTotal = 0;
        for (const sid of userSlots) userTotal += slotUsage[sid] || 0;
        if (userTotal >= limit * 0.9) usersNearLimit++;
      }
    }
  }

  return Response.json({
    activeUsers24h,
    activeUsers7d,
    activeUsers30d,
    callsToday: callsTodayRes.count || 0,
    callsWeek: callsWeekRes.count || 0,
    callsMonth,
    errorRate,
    usersNearLimit,
    topEndpoints,
  });
}

async function handleMonitoringAlerts(request: Request, env: Env): Promise<Response> {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = getSupabase(env);
  const { data: alerts } = await supabase
    .from('scan_alerts')
    .select('id, repo_full_name, provider, file, masked_value, created_at, schedule_id, scan_id')
    .order('created_at', { ascending: false })
    .limit(50);

  return Response.json({ alerts: alerts || [] });
}
