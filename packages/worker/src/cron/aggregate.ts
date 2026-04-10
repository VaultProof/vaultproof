import type { Env } from '../types.js';
import { getSupabase } from '../lib/supabase.js';

/**
 * Runs daily at 00:05 UTC. Aggregates yesterday's sessions + events
 * into daily_metrics, and computes weekly_cohorts.
 */
export async function aggregateDaily(env: Env): Promise<void> {
  const supabase = getSupabase(env);
  const yesterday = new Date(Date.now() - 86400000);
  const dateStr = yesterday.toISOString().slice(0, 10);
  const dayStart = `${dateStr}T00:00:00Z`;
  const dayEnd = `${dateStr}T23:59:59.999Z`;

  // ── Daily Metrics ─────────────────────────────────────────────
  const [sessionsRes, eventsRes] = await Promise.all([
    supabase.from('sessions')
      .select('visitor_id, ip_hash, is_bounce, started_at, ended_at, event_count')
      .gte('started_at', dayStart)
      .lte('started_at', dayEnd),
    supabase.from('events')
      .select('type')
      .gte('created_at', dayStart)
      .lte('created_at', dayEnd),
  ]);

  const sessions = (sessionsRes.data || []) as Array<{
    visitor_id: string;
    ip_hash: string | null;
    is_bounce: boolean;
    started_at: string;
    ended_at: string;
    event_count: number;
  }>;
  const events = (eventsRes.data || []) as Array<{ type: string }>;

  const visitors = new Set(sessions.map(s => s.visitor_id)).size;
  const uniqueIps = new Set(sessions.filter(s => s.ip_hash).map(s => s.ip_hash as string)).size;
  const sessionCount = sessions.length;
  const bounces = sessions.filter(s => s.is_bounce).length;

  const durations = sessions
    .filter(s => !s.is_bounce && s.started_at && s.ended_at)
    .map(s => (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 1000);
  const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

  const eventCounts = sessions.map(s => s.event_count || 0);
  const avgEvents = eventCounts.length > 0 ? eventCounts.reduce((a, b) => a + b, 0) / eventCounts.length : 0;

  const typeCounts: Record<string, number> = {};
  for (const e of events) {
    typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
  }

  await supabase.from('daily_metrics').upsert({
    date: dateStr,
    visitors,
    unique_ips: uniqueIps,
    sessions: sessionCount,
    pageviews: typeCounts['pageview'] || 0,
    signups: typeCounts['signup'] || 0,
    keys_stored: typeCounts['key_store'] || 0,
    dev_keys_created: typeCounts['dev_key_create'] || 0,
    proxy_calls: typeCounts['proxy_call'] || 0,
    scans: typeCounts['scan_start'] || 0,
    upgrades: typeCounts['plan_upgrade'] || 0,
    bounces,
    avg_session_duration_s: Math.round(avgDuration * 100) / 100,
    avg_events_per_session: Math.round(avgEvents * 100) / 100,
  });

  // ── Weekly Cohorts ────────────────────────────────────────────
  const { data: authUsersRes } = await supabase.auth.admin.listUsers({ perPage: 1000, page: 1 });
  const authUsers = authUsersRes?.users || [];

  function getMonday(d: Date): string {
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d);
    monday.setDate(diff);
    return monday.toISOString().slice(0, 10);
  }

  const cohorts: Record<string, string[]> = {};
  for (const u of authUsers) {
    if (!u.created_at) continue;
    const week = getMonday(new Date(u.created_at));
    if (!cohorts[week]) cohorts[week] = [];
    cohorts[week].push(u.id);
  }

  const currentWeek = getMonday(yesterday);
  const upserts: Array<{ cohort_week: string; week_number: number; cohort_size: number; active_count: number }> = [];

  for (const [cohortWeek, userIds] of Object.entries(cohorts)) {
    const cohortStart = new Date(cohortWeek);
    const weeksSince = Math.floor((new Date(currentWeek).getTime() - cohortStart.getTime()) / (7 * 86400000));
    if (weeksSince < 0) continue;

    const weekStart = new Date(cohortStart.getTime() + weeksSince * 7 * 86400000).toISOString();
    const weekEnd = new Date(cohortStart.getTime() + (weeksSince + 1) * 7 * 86400000).toISOString();

    const { data: activeEvents } = await supabase.from('events')
      .select('user_id')
      .in('user_id', userIds)
      .gte('created_at', weekStart)
      .lt('created_at', weekEnd);

    const activeCount = new Set(((activeEvents || []) as Array<{ user_id: string | null }>)
      .filter(e => e.user_id)
      .map(e => e.user_id as string)).size;

    upserts.push({
      cohort_week: cohortWeek,
      week_number: weeksSince,
      cohort_size: userIds.length,
      active_count: activeCount,
    });
  }

  if (upserts.length > 0) {
    await supabase.from('weekly_cohorts').upsert(upserts);
  }
}
