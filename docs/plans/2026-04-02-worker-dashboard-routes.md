# Worker Dashboard Routes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate 8 dashboard API routes from Railway backend to CF Worker, querying Supabase directly.

**Architecture:** New route files in `packages/worker/src/routes/` with a shared JWT auth helper. Routes use `getSupabase(env)` to query PostgREST. Worker `index.ts` routes requests to handlers.

**Tech Stack:** Cloudflare Workers, Supabase PostgREST, TypeScript

---

### Task 1: JWT Auth Helper

**Files:**
- Create: `packages/worker/src/lib/jwt-auth.ts`

**Step 1: Write the auth helper**

```typescript
import type { Env } from '../types.js';
import { getSupabase } from './supabase.js';

export interface AuthUser {
  userId: string;
  email: string;
}

export async function authenticateUser(request: Request, env: Env): Promise<AuthUser | null> {
  const authHeader = request.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  if (token.startsWith('vp_')) return null; // dev key, not JWT

  const supabase = getSupabase(env);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;

  return { userId: data.user.id, email: data.user.email || '' };
}

export async function authenticateAdmin(request: Request, env: Env): Promise<AuthUser | null> {
  const user = await authenticateUser(request, env);
  if (!user) return null;
  const adminEmails = (env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase());
  if (!adminEmails.includes(user.email.toLowerCase())) return null;
  return user;
}
```

**Step 2: Add ADMIN_EMAILS to Env type**

In `packages/worker/src/types.ts`, add `ADMIN_EMAILS: string;` to Env interface.

**Step 3: Commit**

```bash
git add packages/worker/src/lib/jwt-auth.ts packages/worker/src/types.ts
git commit -m "feat: add JWT auth helper for worker routes"
```

---

### Task 2: Analytics Event Route (simplest, public)

**Files:**
- Create: `packages/worker/src/routes/analytics.ts`

**Step 1: Write the route**

```typescript
import type { Env } from '../types.js';
import { getSupabase } from '../lib/supabase.js';

export async function handleAnalyticsEvent(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { type, page, referrer, sessionId } = body;
  if (type !== 'pageview') {
    return Response.json({ error: 'Invalid type' }, { status: 400 });
  }

  const supabase = getSupabase(env);
  await supabase.from('analytics_events').insert({
    type: 'pageview',
    page: page?.slice(0, 500) || null,
    referrer: referrer?.slice(0, 200) || null,
    session_id: sessionId?.slice(0, 100) || null,
  });

  return Response.json({ ok: true });
}
```

**Step 2: Commit**

```bash
git add packages/worker/src/routes/analytics.ts
git commit -m "feat: add analytics event route to worker"
```

---

### Task 3: Stats Routes

**Files:**
- Create: `packages/worker/src/routes/stats.ts`

**Step 1: Write the stats route file**

```typescript
import type { Env } from '../types.js';
import { getSupabase } from '../lib/supabase.js';
import { authenticateUser } from '../lib/jwt-auth.js';

const CALL_ACTIONS = ['api_call', 'transparent_proxy', 'key_retrieval', 'key_retrieval_batch'];

export async function handleStats(request: Request, env: Env, path: string): Promise<Response> {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const user = await authenticateUser(request, env);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);

  if (path === 'overview') return handleOverview(env, user.userId);
  if (path === 'usage') return handleUsage(env, user.userId, url);
  if (path === 'by-key') return handleByKey(env, user.userId);

  return Response.json({ error: 'Not found' }, { status: 404 });
}

async function handleOverview(env: Env, userId: string): Promise<Response> {
  const supabase = getSupabase(env);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  // Get active key slots
  const { data: keys } = await supabase
    .from('key_slots')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'ACTIVE');

  const keySlotIds = (keys || []).map((k: any) => k.id);

  if (keySlotIds.length === 0) {
    return Response.json({
      totalKeys: 0, totalCalls: 0, errorCalls: 0, errorRate: 0,
      activeApps: 0, recentActivity: [],
    });
  }

  // Run queries in parallel
  const [totalRes, errorRes, appsRes, recentRes] = await Promise.all([
    supabase.from('access_logs').select('*', { count: 'exact', head: true })
      .in('key_slot_id', keySlotIds).in('action', CALL_ACTIONS).gte('timestamp', monthStart),
    supabase.from('access_logs').select('*', { count: 'exact', head: true })
      .in('key_slot_id', keySlotIds).in('action', CALL_ACTIONS).gte('timestamp', monthStart)
      .like('metadata', '%"error":true%'),
    supabase.from('app_grants').select('app_id')
      .in('key_slot_id', keySlotIds).is('revoked_at', null),
    supabase.from('access_logs').select('id, app_id, action, timestamp, metadata, key_slot_id')
      .in('key_slot_id', keySlotIds).order('timestamp', { ascending: false }).limit(20),
  ]);

  const totalCalls = totalRes.count || 0;
  const errorCalls = errorRes.count || 0;
  const uniqueApps = new Set((appsRes.data || []).map((a: any) => a.app_id));

  // Get key labels for recent activity
  const recentKeyIds = [...new Set((recentRes.data || []).map((r: any) => r.key_slot_id))];
  let keyMap: Record<string, { provider: string; label: string }> = {};
  if (recentKeyIds.length > 0) {
    const { data: keyData } = await supabase
      .from('key_slots').select('id, provider, label').in('id', recentKeyIds);
    for (const k of keyData || []) keyMap[k.id] = { provider: k.provider, label: k.label };
  }

  return Response.json({
    totalKeys: keySlotIds.length,
    totalCalls,
    errorCalls,
    errorRate: totalCalls > 0 ? Math.round((errorCalls / totalCalls) * 1000) / 10 : 0,
    activeApps: uniqueApps.size,
    recentActivity: (recentRes.data || []).map((r: any) => ({
      id: r.id, appId: r.app_id, action: r.action, timestamp: r.timestamp,
      metadata: r.metadata, keySlot: keyMap[r.key_slot_id] || { provider: 'unknown', label: 'unknown' },
    })),
  });
}

async function handleUsage(env: Env, userId: string, url: URL): Promise<Response> {
  const supabase = getSupabase(env);
  const numDays = Math.min(90, Math.max(1, parseInt(url.searchParams.get('days') || '30', 10) || 30));
  const now = new Date();
  const startDate = new Date(now.getTime() - numDays * 86400000).toISOString();

  const { data: keys } = await supabase.from('key_slots').select('id').eq('user_id', userId);
  const keySlotIds = (keys || []).map((k: any) => k.id);

  if (keySlotIds.length === 0) return Response.json({ usage: [] });

  const { data: logs } = await supabase.from('access_logs')
    .select('timestamp, metadata')
    .in('key_slot_id', keySlotIds).in('action', CALL_ACTIONS)
    .gte('timestamp', startDate).order('timestamp', { ascending: true });

  // Group by day
  const dailyMap: Record<string, { calls: number; errors: number }> = {};
  for (let i = 0; i < numDays; i++) {
    const d = new Date(now.getTime() - (numDays - 1 - i) * 86400000);
    dailyMap[d.toISOString().slice(0, 10)] = { calls: 0, errors: 0 };
  }

  for (const log of logs || []) {
    const day = log.timestamp.slice(0, 10);
    if (!dailyMap[day]) dailyMap[day] = { calls: 0, errors: 0 };
    dailyMap[day].calls++;
    try {
      const meta = typeof log.metadata === 'string' ? JSON.parse(log.metadata) : log.metadata;
      if (meta?.error === true) dailyMap[day].errors++;
    } catch {}
  }

  return Response.json({
    usage: Object.entries(dailyMap).sort().map(([date, v]) => ({ date, ...v })),
  });
}

async function handleByKey(env: Env, userId: string): Promise<Response> {
  const supabase = getSupabase(env);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

  const { data: keys } = await supabase.from('key_slots')
    .select('id, provider, label, created_at')
    .eq('user_id', userId).eq('status', 'ACTIVE');

  if (!keys || keys.length === 0) return Response.json({ keys: [] });

  // Get grants for all keys
  const keyIds = keys.map((k: any) => k.id);
  const { data: grants } = await supabase.from('app_grants')
    .select('key_slot_id, app_id, app_name').in('key_slot_id', keyIds).is('revoked_at', null);

  const grantMap: Record<string, { appId: string; appName: string }[]> = {};
  for (const g of grants || []) {
    if (!grantMap[g.key_slot_id]) grantMap[g.key_slot_id] = [];
    grantMap[g.key_slot_id].push({ appId: g.app_id, appName: g.app_name });
  }

  // Per-key stats in parallel
  const keyStats = await Promise.all(keys.map(async (key: any) => {
    const [monthlyRes, dailyRes, errorRes, lastRes] = await Promise.all([
      supabase.from('access_logs').select('*', { count: 'exact', head: true })
        .eq('key_slot_id', key.id).in('action', CALL_ACTIONS).gte('timestamp', monthStart),
      supabase.from('access_logs').select('*', { count: 'exact', head: true })
        .eq('key_slot_id', key.id).in('action', CALL_ACTIONS).gte('timestamp', dayStart),
      supabase.from('access_logs').select('*', { count: 'exact', head: true })
        .eq('key_slot_id', key.id).in('action', CALL_ACTIONS).gte('timestamp', monthStart)
        .like('metadata', '%"error":true%'),
      supabase.from('access_logs').select('timestamp')
        .eq('key_slot_id', key.id).in('action', CALL_ACTIONS)
        .order('timestamp', { ascending: false }).limit(1),
    ]);

    return {
      id: key.id, provider: key.provider, label: key.label, createdAt: key.created_at,
      apps: grantMap[key.id] || [],
      callsThisMonth: monthlyRes.count || 0, dailyUsed: dailyRes.count || 0,
      monthlyUsed: monthlyRes.count || 0, errorsThisMonth: errorRes.count || 0,
      lastUsed: lastRes.data?.[0]?.timestamp || null,
    };
  }));

  return Response.json({ keys: keyStats });
}
```

**Step 2: Commit**

```bash
git add packages/worker/src/routes/stats.ts
git commit -m "feat: add stats routes to worker (overview, usage, by-key)"
```

---

### Task 4: Dev Keys List Route

**Files:**
- Create: `packages/worker/src/routes/dev-keys.ts`

**Step 1: Write the route**

```typescript
import type { Env } from '../types.js';
import { getSupabase } from '../lib/supabase.js';
import { authenticateUser } from '../lib/jwt-auth.js';

export async function handleDevKeys(request: Request, env: Env, path: string): Promise<Response> {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const user = await authenticateUser(request, env);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  if (path === 'list') return handleList(env, user.userId);

  return Response.json({ error: 'Not found' }, { status: 404 });
}

async function handleList(env: Env, userId: string): Promise<Response> {
  const supabase = getSupabase(env);
  const { data } = await supabase.from('developer_keys')
    .select('id, key, label, mode, last_used, created_at, webhook_url, allowed_key_slot_ids')
    .eq('user_id', userId).is('revoked_at', null);

  const keys = (data || []).map((k: any) => ({
    id: k.id,
    key: k.key.slice(0, 12) + '...' + k.key.slice(-4),
    label: k.label,
    mode: k.mode,
    lastUsed: k.last_used,
    createdAt: k.created_at,
    webhookUrl: k.webhook_url,
  }));

  return Response.json({ keys });
}
```

**Step 2: Commit**

```bash
git add packages/worker/src/routes/dev-keys.ts
git commit -m "feat: add dev-keys list route to worker"
```

---

### Task 5: Promo Feedback Status Route

**Files:**
- Create: `packages/worker/src/routes/promo.ts`

**Step 1: Write the route**

```typescript
import type { Env } from '../types.js';
import { getSupabase } from '../lib/supabase.js';
import { authenticateUser } from '../lib/jwt-auth.js';

export async function handlePromo(request: Request, env: Env, path: string): Promise<Response> {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const user = await authenticateUser(request, env);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  if (path === 'feedback/status') return handleFeedbackStatus(env, user.userId);

  return Response.json({ error: 'Not found' }, { status: 404 });
}

async function handleFeedbackStatus(env: Env, userId: string): Promise<Response> {
  const supabase = getSupabase(env);

  const { data: userData } = await supabase.from('users')
    .select('id, promo_code, tier, tier_expires_at')
    .eq('id', userId).single();

  if (!userData) return Response.json({ error: 'User not found' }, { status: 404 });

  // Calculate week start (Monday 00:00 UTC)
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(now);
  weekStart.setUTCDate(weekStart.getUTCDate() - mondayOffset);
  weekStart.setUTCHours(0, 0, 0, 0);

  const { count } = await supabase.from('promo_feedback')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId).gte('created_at', weekStart.toISOString());

  return Response.json({
    isPromo: !!userData.promo_code,
    submittedThisWeek: (count || 0) > 0,
    promoCode: userData.promo_code,
    tierExpiresAt: userData.tier_expires_at,
  });
}
```

**Step 2: Commit**

```bash
git add packages/worker/src/routes/promo.ts
git commit -m "feat: add promo feedback status route to worker"
```

---

### Task 6: Admin Analytics Routes

**Files:**
- Create: `packages/worker/src/routes/admin.ts`

**Step 1: Write the route**

```typescript
import type { Env } from '../types.js';
import { getSupabase } from '../lib/supabase.js';
import { authenticateAdmin } from '../lib/jwt-auth.js';

export async function handleAdmin(request: Request, env: Env, path: string): Promise<Response> {
  if (request.method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const admin = await authenticateAdmin(request, env);
  if (!admin) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(request.url);

  if (path === 'analytics/overview') return handleOverview(env);
  if (path === 'analytics/referral-stats') return handleReferralStats(env, url);

  return Response.json({ error: 'Not found' }, { status: 404 });
}

async function handleOverview(env: Env): Promise<Response> {
  const supabase = getSupabase(env);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
  const monthAgo = new Date(now.getTime() - 30 * 86400000).toISOString();

  const [vToday, vWeek, vMonth, sToday, sWeek, sMonth, sTotal, visitorsToday] = await Promise.all([
    supabase.from('analytics_events').select('*', { count: 'exact', head: true }).eq('type', 'pageview').gte('created_at', todayStart),
    supabase.from('analytics_events').select('*', { count: 'exact', head: true }).eq('type', 'pageview').gte('created_at', weekAgo),
    supabase.from('analytics_events').select('*', { count: 'exact', head: true }).eq('type', 'pageview').gte('created_at', monthAgo),
    supabase.from('users').select('*', { count: 'exact', head: true }).gte('created_at', todayStart),
    supabase.from('users').select('*', { count: 'exact', head: true }).gte('created_at', weekAgo),
    supabase.from('users').select('*', { count: 'exact', head: true }).gte('created_at', monthAgo),
    supabase.from('users').select('*', { count: 'exact', head: true }),
    supabase.from('analytics_events').select('session_id').eq('type', 'pageview').gte('created_at', todayStart),
  ]);

  const uniqueVisitors = new Set((visitorsToday.data || []).map((e: any) => e.session_id).filter(Boolean));

  return Response.json({
    viewsToday: vToday.count || 0,
    viewsWeek: vWeek.count || 0,
    viewsMonth: vMonth.count || 0,
    visitorsToday: uniqueVisitors.size,
    signupsToday: sToday.count || 0,
    signupsWeek: sWeek.count || 0,
    signupsMonth: sMonth.count || 0,
    totalUsers: sTotal.count || 0,
  });
}

async function handleReferralStats(env: Env, url: URL): Promise<Response> {
  const supabase = getSupabase(env);
  const numDays = Math.min(90, Math.max(1, parseInt(url.searchParams.get('days') || '30', 10) || 30));
  const source = url.searchParams.get('source') || 'promptsforeveryone';
  const since = new Date(Date.now() - numDays * 86400000).toISOString();

  const [clicksRes, visitsRes] = await Promise.all([
    supabase.from('analytics_events').select('page, session_id, created_at')
      .eq('type', 'pageview').like('page', '/ad-click/%').gte('created_at', since)
      .order('created_at', { ascending: true }),
    supabase.from('analytics_events').select('page, session_id, created_at')
      .eq('type', 'pageview').like('referrer', `%${source}%`)
      .not('page', 'like', '/ad-click/%').gte('created_at', since)
      .order('created_at', { ascending: true }),
  ]);

  const clicks = clicksRes.data || [];
  const visits = visitsRes.data || [];

  // Collect referral session IDs
  const referralSessionIds = new Set<string>();
  for (const c of clicks) if (c.session_id) referralSessionIds.add(c.session_id);
  for (const v of visits) if (v.session_id) referralSessionIds.add(v.session_id);

  // Count signups from referral sessions
  let signupsFromReferral = 0;
  if (referralSessionIds.size > 0) {
    const { count } = await supabase.from('analytics_events')
      .select('*', { count: 'exact', head: true })
      .eq('type', 'signup').in('session_id', Array.from(referralSessionIds))
      .gte('created_at', since);
    signupsFromReferral = count || 0;
  }

  // Aggregate
  const uniqueClickers = new Set(clicks.map(c => c.session_id).filter(Boolean));
  const uniqueVisitors = new Set(visits.map(v => v.session_id).filter(Boolean));

  // By variant
  const byVariant: Record<string, number> = {};
  for (const c of clicks) {
    const variant = c.page?.replace('/ad-click/', '').split('/')[0] || 'unknown';
    byVariant[variant] = (byVariant[variant] || 0) + 1;
  }

  // Daily breakdown
  const dailyMap: Record<string, { clicks: number; visits: number; visitors: Set<string> }> = {};
  for (const c of clicks) {
    const day = c.created_at.slice(0, 10);
    if (!dailyMap[day]) dailyMap[day] = { clicks: 0, visits: 0, visitors: new Set() };
    dailyMap[day].clicks++;
    if (c.session_id) dailyMap[day].visitors.add(c.session_id);
  }
  for (const v of visits) {
    const day = v.created_at.slice(0, 10);
    if (!dailyMap[day]) dailyMap[day] = { clicks: 0, visits: 0, visitors: new Set() };
    dailyMap[day].visits++;
    if (v.session_id) dailyMap[day].visitors.add(v.session_id);
  }

  const daily = Object.entries(dailyMap).sort().map(([date, v]) => ({
    date, clicks: v.clicks, visits: v.visits, uniqueVisitors: v.visitors.size,
  }));

  const totalLandingVisits = visits.length;
  const conversionRate = uniqueClickers.size + uniqueVisitors.size > 0
    ? ((signupsFromReferral / (uniqueClickers.size + uniqueVisitors.size)) * 100).toFixed(1) + '%'
    : '0%';

  const sinceDate = new Date(since);
  const period = `${sinceDate.toISOString().slice(0, 10)} to ${new Date().toISOString().slice(0, 10)}`;

  return Response.json({
    source, period,
    summary: {
      totalAdClicks: clicks.length,
      uniqueAdClickers: uniqueClickers.size,
      totalLandingVisits,
      uniqueLandingVisitors: uniqueVisitors.size,
      signupsFromReferral,
      conversionRate,
    },
    byVariant, daily,
  });
}
```

**Step 2: Commit**

```bash
git add packages/worker/src/routes/admin.ts
git commit -m "feat: add admin analytics routes to worker"
```

---

### Task 7: Wire Routes in index.ts

**Files:**
- Modify: `packages/worker/src/index.ts`

**Step 1: Update index.ts to route to new handlers**

Add imports and route matching between the health checks and `/v1/*` block. See design doc for routing structure:

- `/analytics/event` -> `handleAnalyticsEvent`
- `/api/v1/stats/*` -> `handleStats` with sub-path
- `/api/v1/dev-keys/*` -> `handleDevKeys` with sub-path
- `/api/v1/promo/*` -> `handlePromo` with sub-path
- `/admin/analytics/*` -> `handleAdmin` with sub-path

All responses wrapped with `addCors()`.

**Step 2: Commit**

```bash
git add packages/worker/src/index.ts
git commit -m "feat: wire dashboard routes in worker index"
```

---

### Task 8: Add ADMIN_EMAILS to wrangler.toml and Deploy

**Files:**
- Modify: `packages/worker/wrangler.toml`

**Step 1: Add ADMIN_EMAILS env var**

Add to `[vars]` section:
```toml
ADMIN_EMAILS = "yee.nelsonk@gmail.com"
```

**Step 2: Build and type-check**

```bash
cd packages/worker && npx tsc --noEmit
```

**Step 3: Deploy**

```bash
cd packages/worker && npx wrangler deploy
```

**Step 4: Test endpoints**

```bash
curl -s https://api.vaultproof.dev/analytics/event -X POST -H 'Content-Type: application/json' -d '{"type":"pageview","page":"/test"}'
curl -s https://api.vaultproof.dev/api/v1/stats/overview -H 'Authorization: Bearer <token>'
```

**Step 5: Commit**

```bash
git add packages/worker/wrangler.toml
git commit -m "feat: add admin emails config, deploy worker with dashboard routes"
```
