"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { AppShell } from "../../components/app-shell";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "https://api.vaultproof.dev";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

interface ReferralStats {
  source: string;
  period: string;
  summary: {
    totalAdClicks: number;
    uniqueAdClickers: number;
    totalLandingVisits: number;
    uniqueLandingVisitors: number;
    signupsFromReferral: number;
    conversionRate: string;
  };
  byVariant: Record<string, number>;
  daily: { date: string; clicks: number; visits: number; uniqueVisitors: number }[];
}

interface OverviewStats {
  viewsToday: number;
  viewsWeek: number;
  viewsMonth: number;
  visitorsToday: number;
  signupsToday: number;
  signupsWeek: number;
  signupsMonth: number;
  totalUsers: number;
}

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [referralStats, setReferralStats] = useState<ReferralStats | null>(null);
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [days, setDays] = useState(30);

  // Auth
  useEffect(() => {
    if (!supabase) {
      setError("Dashboard auth is not configured.");
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.access_token) {
        setToken(data.session.access_token);
      } else {
        setError("Not logged in. Sign in first.");
        setLoading(false);
      }
    });
  }, []);

  const fetchStats = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [refRes, overRes] = await Promise.all([
        fetch(`${BACKEND_URL}/admin/analytics/referral-stats?days=${days}&source=promptsforeveryone`, { headers }),
        fetch(`${BACKEND_URL}/admin/analytics/overview`, { headers }),
      ]);

      if (refRes.status === 403 || overRes.status === 403) {
        setError("Access denied. Admin only.");
        return;
      }
      if (!refRes.ok || !overRes.ok) {
        setError("Failed to fetch stats.");
        return;
      }

      setReferralStats(await refRes.json());
      setOverview(await overRes.json());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [token, days]);

  useEffect(() => {
    if (token) fetchStats();
  }, [token, fetchStats]);

  // Do not render any admin UI until the backend auth check has completed.
  // Rendering before the 403 check would expose the page shell to non-admins
  // for the duration of the in-flight request.
  if (loading && !overview && !referralStats) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-violet-500" />
      </div>
    );
  }

  if (error && !token) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <Link href="/" className="text-violet-400 hover:underline">Go to login</Link>
        </div>
      </div>
    );
  }

  // Show access-denied screen if the backend returned 403.
  if (error && !overview && !referralStats) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <Link href="/" className="text-violet-400 hover:underline">Go to dashboard</Link>
        </div>
      </div>
    );
  }

  return (
    <AppShell
      eyebrow="Internal Admin"
      title="Admin"
      description="Staff-only operating metrics for growth, referrals, account activity, and enterprise funnel review."
      actions={
        <div className="flex items-center gap-3">
          <select
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-300"
          >
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={60}>Last 60 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button
            onClick={fetchStats}
            className="rounded-full bg-sky-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-300"
          >
            Refresh
          </button>
        </div>
      }
    >
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-10">
          <h2 className="text-sm uppercase tracking-[0.18em] text-slate-500">Referral and growth analytics</h2>
        </div>

        {error && <p className="text-red-400 mb-6">{error}</p>}

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-violet-500" />
          </div>
        ) : (
          <>
            {/* Site-wide Overview */}
            {overview && (
              <section className="mb-12">
                <h2 className="text-lg font-semibold text-zinc-400 uppercase tracking-wider mb-4">Site Overview</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <StatCard label="Views Today" value={overview.viewsToday} />
                  <StatCard label="Views This Week" value={overview.viewsWeek} />
                  <StatCard label="Views This Month" value={overview.viewsMonth} />
                  <StatCard label="Visitors Today" value={overview.visitorsToday} />
                  <StatCard label="Signups Today" value={overview.signupsToday} />
                  <StatCard label="Signups This Week" value={overview.signupsWeek} />
                  <StatCard label="Signups This Month" value={overview.signupsMonth} />
                  <StatCard label="Total Users" value={overview.totalUsers} />
                </div>
              </section>
            )}

            {/* Referral Stats from promptsforeveryone */}
            {referralStats && (
              <section className="mb-12">
                <h2 className="text-lg font-semibold text-zinc-400 uppercase tracking-wider mb-1">
                  Referral: promptsforeveryone
                </h2>
                <p className="text-sm text-zinc-500 mb-4">{referralStats.period}</p>

                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
                  <StatCard label="Ad Clicks" value={referralStats.summary.totalAdClicks} accent="violet" />
                  <StatCard label="Unique Clickers" value={referralStats.summary.uniqueAdClickers} accent="violet" />
                  <StatCard label="Landing Visits" value={referralStats.summary.totalLandingVisits} accent="teal" />
                  <StatCard label="Unique Visitors" value={referralStats.summary.uniqueLandingVisitors} accent="teal" />
                  <StatCard label="Signups" value={referralStats.summary.signupsFromReferral} accent="green" />
                  <StatCard label="Conversion" value={referralStats.summary.conversionRate} accent="green" />
                </div>

                {/* By Variant */}
                {Object.keys(referralStats.byVariant).length > 0 && (
                  <div className="mb-8">
                    <h3 className="text-sm font-semibold text-zinc-400 mb-3">Clicks by Ad Variant</h3>
                    <div className="flex gap-3 flex-wrap">
                      {Object.entries(referralStats.byVariant).map(([variant, count]) => (
                        <div key={variant} className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3">
                          <p className="text-xs text-zinc-500 mb-1">{variant}</p>
                          <p className="text-xl font-bold text-violet-400">{count}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Daily Chart */}
                {referralStats.daily.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-400 mb-3">Daily Breakdown</h3>
                    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-zinc-800 text-zinc-500">
                            <th className="text-left px-4 py-3 font-medium">Date</th>
                            <th className="text-right px-4 py-3 font-medium">Ad Clicks</th>
                            <th className="text-right px-4 py-3 font-medium">Landing Visits</th>
                            <th className="text-right px-4 py-3 font-medium">Unique Visitors</th>
                          </tr>
                        </thead>
                        <tbody>
                          {referralStats.daily.map(row => (
                            <tr key={row.date} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                              <td className="px-4 py-2.5 text-zinc-300">{row.date}</td>
                              <td className="px-4 py-2.5 text-right text-violet-400 font-medium">{row.clicks}</td>
                              <td className="px-4 py-2.5 text-right text-teal-400 font-medium">{row.visits}</td>
                              <td className="px-4 py-2.5 text-right text-zinc-300">{row.uniqueVisitors}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-zinc-700 text-zinc-300 font-semibold">
                            <td className="px-4 py-3">Total</td>
                            <td className="px-4 py-3 text-right text-violet-400">
                              {referralStats.daily.reduce((s, r) => s + r.clicks, 0)}
                            </td>
                            <td className="px-4 py-3 text-right text-teal-400">
                              {referralStats.daily.reduce((s, r) => s + r.visits, 0)}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {referralStats.daily.reduce((s, r) => s + r.uniqueVisitors, 0)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}

                {referralStats.daily.length === 0 && (
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
                    <p className="text-zinc-500">No referral data yet for this period.</p>
                    <p className="text-zinc-600 text-sm mt-1">Clicks from promptsforeveryone ads will appear here.</p>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  const colorMap: Record<string, string> = {
    violet: 'text-violet-400',
    teal: 'text-teal-400',
    green: 'text-green-400',
  };
  const valueColor = accent ? colorMap[accent] || 'text-white' : 'text-white';

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <p className="text-xs text-zinc-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${valueColor}`}>{value}</p>
    </div>
  );
}
