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

  const [totalUsers, totalKeys, totalDevKeys, callsToday, callsThisMonth, totalCallsAllTime] = await Promise.all([
    supabase.from('users').select('*', { count: 'exact', head: true }),
    supabase.from('key_slots').select('*', { count: 'exact', head: true }).eq('status', 'ACTIVE'),
    supabase.from('developer_keys').select('*', { count: 'exact', head: true }).is('revoked_at', null),
    supabase.from('access_logs').select('*', { count: 'exact', head: true }).gte('timestamp', todayStart),
    supabase.from('access_logs').select('*', { count: 'exact', head: true }).gte('timestamp', monthStart),
    supabase.from('access_logs').select('*', { count: 'exact', head: true }),
  ]);

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
    totalUsers: totalUsers.count || 0,
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
    // 7. Total users
    supabase
      .from('users')
      .select('*', { count: 'exact', head: true }),
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
    totalUsers: totalUsersRes.count ?? 0,
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
