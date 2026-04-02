import type { Env } from '../types.js';
import { getSupabase } from '../lib/supabase.js';
import { authenticateAdmin } from '../lib/jwt-auth.js';

export async function handleAdmin(
  request: Request,
  env: Env,
  path: string,
): Promise<Response> {
  if (path === 'analytics/overview') {
    return handleOverview(request, env);
  }
  if (path === 'analytics/referral-stats') {
    return handleReferralStats(request, env);
  }
  return Response.json({ error: 'Not found' }, { status: 404 });
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
