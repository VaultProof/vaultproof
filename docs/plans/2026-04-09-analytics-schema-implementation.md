# Analytics Schema Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the flat `analytics_events` table with a normalized GA-style analytics schema, add product event tracking, cron-based aggregation, and a full investor-ready admin dashboard.

**Architecture:** New `sessions`, `events`, `daily_metrics`, and `weekly_cohorts` tables in Supabase. CF Worker handles session upsert + event insert on each tracking call. A daily cron trigger aggregates into rollup tables. Admin dashboard queries live tables for "today" (30s auto-poll) and rollup tables for historical data.

**Tech Stack:** Supabase (Postgres), CF Workers (TypeScript), Chart.js, Tailwind CSS

**Design doc:** `docs/plans/2026-04-09-analytics-schema-design.md`

---

## Task 1: Database Migration — Create New Tables

**Files:**
- Create: `packages/worker/migrations/0001_analytics_schema.sql`

**Step 1: Write the migration SQL**

```sql
-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  ip_hash TEXT,
  user_id TEXT,
  device_type TEXT,
  browser TEXT,
  os TEXT,
  country TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  referrer TEXT,
  landing_page TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_bounce BOOLEAN NOT NULL DEFAULT true,
  event_count INT NOT NULL DEFAULT 0
);

CREATE INDEX sessions_started_at_idx ON sessions(started_at);
CREATE INDEX sessions_visitor_id_idx ON sessions(visitor_id);
CREATE INDEX sessions_user_id_idx ON sessions(user_id) WHERE user_id IS NOT NULL;

-- Events table
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  user_id TEXT,
  type TEXT NOT NULL,
  page TEXT,
  referrer TEXT,
  properties JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX events_session_id_idx ON events(session_id);
CREATE INDEX events_type_created_at_idx ON events(type, created_at);
CREATE INDEX events_user_id_idx ON events(user_id) WHERE user_id IS NOT NULL;

-- Daily metrics (pre-aggregated)
CREATE TABLE IF NOT EXISTS daily_metrics (
  date DATE PRIMARY KEY,
  visitors INT NOT NULL DEFAULT 0,
  unique_ips INT NOT NULL DEFAULT 0,
  sessions INT NOT NULL DEFAULT 0,
  pageviews INT NOT NULL DEFAULT 0,
  signups INT NOT NULL DEFAULT 0,
  keys_stored INT NOT NULL DEFAULT 0,
  dev_keys_created INT NOT NULL DEFAULT 0,
  proxy_calls INT NOT NULL DEFAULT 0,
  scans INT NOT NULL DEFAULT 0,
  upgrades INT NOT NULL DEFAULT 0,
  bounces INT NOT NULL DEFAULT 0,
  avg_session_duration_s FLOAT NOT NULL DEFAULT 0,
  avg_events_per_session FLOAT NOT NULL DEFAULT 0
);

-- Weekly cohorts (retention data)
CREATE TABLE IF NOT EXISTS weekly_cohorts (
  cohort_week DATE NOT NULL,
  week_number INT NOT NULL,
  cohort_size INT NOT NULL DEFAULT 0,
  active_count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (cohort_week, week_number)
);

-- RLS: admin-only access (service role key bypasses RLS, so these tables
-- are effectively admin-only since only the Worker writes/reads them)
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_cohorts ENABLE ROW LEVEL SECURITY;
```

**Step 2: Apply the migration**

Run this SQL in Supabase SQL Editor (Dashboard → SQL Editor → paste and run).

**Step 3: Verify tables exist**

In Supabase Table Editor, confirm all 4 tables appear: `sessions`, `events`, `daily_metrics`, `weekly_cohorts`.

**Step 4: Commit**

```bash
git add packages/worker/migrations/0001_analytics_schema.sql
git commit -m "feat: add analytics schema migration (sessions, events, daily_metrics, weekly_cohorts)"
```

---

## Task 2: Analytics Helper Library — UA Parser + Event Recorder

**Files:**
- Create: `packages/worker/src/lib/analytics.ts`
- Modify: `packages/worker/src/types.ts`

**Step 1: Add session timeout constant to types**

In `packages/worker/src/types.ts`, no changes needed to the interfaces — the helper will use its own types.

**Step 2: Create the analytics helper**

Create `packages/worker/src/lib/analytics.ts`:

```typescript
import type { Env } from '../types.js';
import { getSupabase } from './supabase.js';

// ── Constants ───────────────────────────────────────────────────────
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// ── UA Parsing (lightweight, no library) ────────────────────────────
interface ParsedUA {
  deviceType: 'desktop' | 'mobile' | 'tablet';
  browser: string;
  os: string;
}

export function parseUserAgent(ua: string): ParsedUA {
  const lower = ua.toLowerCase();

  // Device type
  let deviceType: ParsedUA['deviceType'] = 'desktop';
  if (/ipad|tablet|playbook|silk/i.test(ua)) deviceType = 'tablet';
  else if (/mobile|iphone|ipod|android.*mobile|windows phone/i.test(ua)) deviceType = 'mobile';

  // Browser
  let browser = 'Other';
  if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/opr\/|opera/i.test(ua)) browser = 'Opera';
  else if (/chrome\/.*safari/i.test(ua)) browser = 'Chrome';
  else if (/safari\//i.test(ua) && !/chrome/i.test(ua)) browser = 'Safari';
  else if (/firefox\//i.test(ua)) browser = 'Firefox';

  // OS
  let os = 'Other';
  if (/windows/i.test(ua)) os = 'Windows';
  else if (/macintosh|mac os x/i.test(ua)) os = 'macOS';
  else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/linux/i.test(ua)) os = 'Linux';
  else if (/cros/i.test(ua)) os = 'ChromeOS';

  return { deviceType, browser, os };
}

// ── IP Hashing ──────────────────────────────────────────────────────
export async function hashIp(ip: string, date: string): Promise<string> {
  const data = new TextEncoder().encode(`${ip}:${date}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

// ── Session Upsert ──────────────────────────────────────────────────
interface SessionUpsertInput {
  sessionId: string;
  visitorId: string;
  ipHash: string;
  userId?: string | null;
  ua: ParsedUA;
  country: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  referrer?: string | null;
  page?: string | null;
}

/**
 * Find or create a session. If the existing session's last event was >30 min ago,
 * create a new session. Returns the active session ID.
 */
export async function upsertSession(env: Env, input: SessionUpsertInput): Promise<string> {
  const supabase = getSupabase(env);

  // Look up existing session
  const { data: existing } = await supabase
    .from('sessions')
    .select('id, ended_at, event_count')
    .eq('id', input.sessionId)
    .single();

  const now = new Date().toISOString();

  if (existing) {
    const lastEvent = new Date(existing.ended_at).getTime();
    const elapsed = Date.now() - lastEvent;

    if (elapsed < SESSION_TIMEOUT_MS) {
      // Update existing session
      const newCount = (existing.event_count || 0) + 1;
      await supabase.from('sessions').update({
        ended_at: now,
        event_count: newCount,
        is_bounce: newCount <= 1,
        ...(input.userId ? { user_id: input.userId } : {}),
      }).eq('id', existing.id);
      return existing.id;
    }
  }

  // Create new session (either no existing, or timed out)
  const newId = input.sessionId || crypto.randomUUID();
  await supabase.from('sessions').insert({
    id: newId,
    visitor_id: input.visitorId,
    ip_hash: input.ipHash,
    user_id: input.userId || null,
    device_type: input.ua.deviceType,
    browser: input.ua.browser,
    os: input.ua.os,
    country: input.country,
    utm_source: input.utmSource || null,
    utm_medium: input.utmMedium || null,
    utm_campaign: input.utmCampaign || null,
    referrer: input.referrer || null,
    landing_page: input.page || null,
    started_at: now,
    ended_at: now,
    is_bounce: true,
    event_count: 1,
  });
  return newId;
}

// ── Record Event ────────────────────────────────────────────────────
interface RecordEventInput {
  sessionId?: string | null;
  userId?: string | null;
  type: string;
  page?: string | null;
  referrer?: string | null;
  properties?: Record<string, unknown> | null;
}

/**
 * Insert an event into the events table. Used for both client-side
 * (via /analytics/event) and server-side product events.
 */
export async function recordEvent(env: Env, input: RecordEventInput): Promise<void> {
  const supabase = getSupabase(env);
  await supabase.from('events').insert({
    id: crypto.randomUUID(),
    session_id: input.sessionId || null,
    user_id: input.userId || null,
    type: input.type,
    page: input.page || null,
    referrer: input.referrer || null,
    properties: input.properties || null,
    created_at: new Date().toISOString(),
  });
}
```

**Step 3: Verify build**

Run: `cd packages/worker && npx tsc --noEmit`
Expected: no errors

**Step 4: Commit**

```bash
git add packages/worker/src/lib/analytics.ts
git commit -m "feat: add analytics helper library (UA parser, session upsert, event recorder)"
```

---

## Task 3: Update Tracking Endpoint — Session-Aware `/analytics/event`

**Files:**
- Modify: `packages/worker/src/routes/analytics.ts`

**Step 1: Rewrite analytics.ts**

Replace the entire file. The new version:
- Accepts additional fields: `visitorId`, `utmSource`, `utmMedium`, `utmCampaign`, and arbitrary `type`
- Delegates to `upsertSession()` and `recordEvent()` from the analytics helper
- Keeps existing bot filtering and referrer sanitization
- Still writes to `analytics_events` too (dual-write during migration period)

```typescript
import type { Env } from '../types.js';
import { getSupabase } from '../lib/supabase.js';
import { parseUserAgent, hashIp, upsertSession, recordEvent } from '../lib/analytics.js';

// Known bot user-agent patterns
const BOT_PATTERNS = [
  /bot\b/i, /crawl/i, /spider/i, /slurp/i, /mediapartners/i,
  /feedfetcher/i, /facebookexternalhit/i, /twitterbot/i, /linkedinbot/i,
  /whatsapp/i, /telegrambot/i, /discordbot/i, /slackbot/i,
  /pingdom/i, /uptimerobot/i, /monitoring/i, /healthcheck/i,
  /lighthouse/i, /pagespeed/i, /gtmetrix/i, /semrush/i, /ahref/i,
  /bytespider/i, /gptbot/i, /claudebot/i, /anthropic/i, /openai/i,
  /headless/i, /phantom/i, /selenium/i, /puppeteer/i, /playwright/i,
  /wget/i, /curl/i, /httpie/i, /python-requests/i, /axios/i, /node-fetch/i,
];

function isBot(userAgent: string): boolean {
  if (!userAgent) return true;
  return BOT_PATTERNS.some(p => p.test(userAgent));
}

export async function handleAnalyticsEvent(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const userAgent = request.headers.get('user-agent') || '';
  if (isBot(userAgent)) {
    return Response.json({ ok: true }); // Silent drop
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const data = body as Record<string, unknown>;
  const eventType = typeof data.type === 'string' ? data.type : null;
  if (!eventType) {
    return Response.json({ error: 'Missing event type' }, { status: 400 });
  }

  const page = typeof data.page === 'string' ? data.page.slice(0, 500) : null;
  const sessionId = typeof data.sessionId === 'string' ? data.sessionId.slice(0, 100) : crypto.randomUUID();
  const visitorId = typeof data.visitorId === 'string' ? data.visitorId.slice(0, 100) : sessionId;

  // Sanitize referrer
  let referrer: string | null = null;
  let isMalicious = false;
  if (typeof data.referrer === 'string' && data.referrer.length > 0) {
    const raw = data.referrer.slice(0, 200);
    if (/^https?:\/\/[a-zA-Z0-9]/.test(raw) && !/<|>|javascript:|data:|onerror|onclick|169\.254/i.test(raw)) {
      referrer = raw;
    } else {
      isMalicious = true;
    }
  }

  // Log security probes (fire and forget)
  if (isMalicious) {
    const clientIp = request.headers.get('cf-connecting-ip') || 'unknown';
    const supabase = getSupabase(env);
    supabase.from('analytics_events').insert({
      id: crypto.randomUUID(),
      type: 'security_probe',
      page,
      referrer: (typeof data.referrer === 'string' ? data.referrer : '').slice(0, 500),
      session_id: sessionId,
      metadata: JSON.stringify({
        ip: clientIp,
        ua: userAgent.slice(0, 200),
        probe_type: /<|>/i.test(String(data.referrer)) ? 'xss' : /169\.254/i.test(String(data.referrer)) ? 'ssrf' : 'other',
      }),
    }).then(() => {}).catch(() => {});
    return Response.json({ ok: true });
  }

  // Compute IP hash and parse UA
  const clientIp = request.headers.get('cf-connecting-ip') || 'unknown';
  const today = new Date().toISOString().slice(0, 10);
  const ipHash = await hashIp(clientIp, today);
  const country = request.headers.get('cf-ipcountry') || null;
  const ua = parseUserAgent(userAgent);

  // UTM params
  const utmSource = typeof data.utmSource === 'string' ? data.utmSource.slice(0, 200) : null;
  const utmMedium = typeof data.utmMedium === 'string' ? data.utmMedium.slice(0, 200) : null;
  const utmCampaign = typeof data.utmCampaign === 'string' ? data.utmCampaign.slice(0, 200) : null;

  // Event properties
  const properties = (data.properties && typeof data.properties === 'object')
    ? data.properties as Record<string, unknown>
    : null;

  // Upsert session + record event
  const activeSessionId = await upsertSession(env, {
    sessionId,
    visitorId,
    ipHash,
    ua,
    country,
    utmSource,
    utmMedium,
    utmCampaign,
    referrer,
    page,
  });

  await recordEvent(env, {
    sessionId: activeSessionId,
    type: eventType,
    page,
    referrer,
    properties,
  });

  // Dual-write to legacy analytics_events (remove after migration is validated)
  const supabase = getSupabase(env);
  supabase.from('analytics_events').insert({
    id: crypto.randomUUID(),
    type: eventType,
    page,
    referrer,
    session_id: sessionId,
    metadata: JSON.stringify({ ip_hash: ipHash, ua: userAgent.slice(0, 200), country }),
  }).then(() => {}).catch(() => {});

  return Response.json({ ok: true });
}
```

**Step 2: Verify build**

Run: `cd packages/worker && npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add packages/worker/src/routes/analytics.ts
git commit -m "feat: update analytics endpoint with session upsert and multi-event support"
```

---

## Task 4: Client-Side Analytics Script

**Files:**
- Create: `apps/site/js/analytics.js`
- Modify: `apps/site/index.html` (and all other HTML pages — replace inline snippet)

**Step 1: Create the shared analytics script**

Create `apps/site/js/analytics.js`:

```javascript
(function () {
  'use strict';

  var API = 'https://api.vaultproof.dev/analytics/event';

  // ── Visitor ID (persists forever in localStorage) ───────────────
  var visitorId = localStorage.getItem('vp_vid');
  if (!visitorId) {
    visitorId = crypto.randomUUID ? crypto.randomUUID() : (Math.random().toString(36).slice(2) + Date.now().toString(36));
    localStorage.setItem('vp_vid', visitorId);
  }

  // ── Session ID (sessionStorage + 30-min timeout) ───────────────
  var SESSION_TIMEOUT = 30 * 60 * 1000;
  var now = Date.now();
  var lastActive = parseInt(sessionStorage.getItem('vp_last_active') || '0', 10);
  var sessionId = sessionStorage.getItem('vp_sid');

  if (!sessionId || (now - lastActive) > SESSION_TIMEOUT) {
    sessionId = crypto.randomUUID ? crypto.randomUUID() : (Math.random().toString(36).slice(2) + Date.now().toString(36));
    sessionStorage.setItem('vp_sid', sessionId);
  }
  sessionStorage.setItem('vp_last_active', String(now));

  // ── UTM params (captured once per session) ─────────────────────
  var params = new URLSearchParams(location.search);
  var utmSource = params.get('utm_source') || sessionStorage.getItem('vp_utm_source') || null;
  var utmMedium = params.get('utm_medium') || sessionStorage.getItem('vp_utm_medium') || null;
  var utmCampaign = params.get('utm_campaign') || sessionStorage.getItem('vp_utm_campaign') || null;
  if (utmSource) sessionStorage.setItem('vp_utm_source', utmSource);
  if (utmMedium) sessionStorage.setItem('vp_utm_medium', utmMedium);
  if (utmCampaign) sessionStorage.setItem('vp_utm_campaign', utmCampaign);

  // ── Referrer (external only) ───────────────────────────────────
  var ref = null;
  if (document.referrer) {
    try {
      var refHost = new URL(document.referrer).hostname;
      if (refHost !== location.hostname) ref = document.referrer;
    } catch (e) {}
  }

  // ── Send event helper ─────────────────────────────────────────
  function send(type, properties) {
    var payload = {
      type: type,
      page: location.pathname,
      referrer: ref,
      sessionId: sessionId,
      visitorId: visitorId,
      utmSource: utmSource,
      utmMedium: utmMedium,
      utmCampaign: utmCampaign,
    };
    if (properties) payload.properties = properties;

    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(function () {});

    // Update last active on every event
    sessionStorage.setItem('vp_last_active', String(Date.now()));
  }

  // ── Auto-track pageview ────────────────────────────────────────
  send('pageview');

  // ── Expose global tracker for product events ───────────────────
  window.vp = window.vp || {};
  window.vp.track = function (type, properties) {
    send(type, properties);
  };
})();
```

**Step 2: Update HTML pages**

In every HTML page that currently has an inline analytics snippet, replace the inline `<script>(function(){ var sid = localStorage... })();</script>` block with:

```html
<script src="/js/analytics.js" defer></script>
```

Pages to update (search for `vp_sid` in `apps/site/`):
- `index.html`, `docs.html`, `guides.html`, `compare.html`, `security.html`
- `status.html`, `changelog.html`, `privacy.html`, `verify.html`, `demo.html`
- `scan.html`, `agents.html`, `abuse.html`, `terms.html`, `pitchdeck.html`, `mcp-auth.html`, `v2.html`
- `app/index.html`, `app/login.html`, `app/keys.html`, `app/settings.html`, `app/logs.html`, `app/plans.html`
- `app/scanner.html`, `app/agents.html`
- `blog/*.html`

Also remove the old `vp_sid` localStorage key reference — the new script uses `vp_vid` (visitor) + `vp_sid` (session) in sessionStorage.

**Step 3: Verify locally**

Open any page in browser → check Network tab → confirm POST to `/analytics/event` includes `visitorId`, `sessionId`, `utmSource` fields.

**Step 4: Commit**

```bash
git add apps/site/js/analytics.js
git add apps/site/*.html apps/site/app/*.html apps/site/blog/*.html
git commit -m "feat: add shared analytics.js with session tracking, UTM params, and product event API"
```

---

## Task 5: Server-Side Product Event Injection

**Files:**
- Modify: `packages/worker/src/routes/transparent-proxy.ts` (proxy_call events)
- Modify: `packages/worker/src/routes/keys.ts` (key_store events)
- Modify: `packages/worker/src/routes/dev-keys.ts` (dev_key_create events)
- Modify: `packages/worker/src/routes/billing.ts` (plan_upgrade/downgrade events)

**Step 1: Add proxy_call event to transparent-proxy.ts**

After the existing `access_logs` insert (around line 393), add:

```typescript
import { recordEvent } from '../lib/analytics.js';

// After the logPromise block:
const analyticsPromise = recordEvent(env, {
  userId: auth.userId,
  type: 'proxy_call',
  properties: { provider, status: upstreamResponse.status },
}).catch(() => {});
if (ctx) ctx.waitUntil(analyticsPromise);
```

**Step 2: Add key_store event to keys.ts**

In the key store handler (after successful `key_slots` insert), add:

```typescript
import { recordEvent } from '../lib/analytics.js';

// After successful insert:
recordEvent(env, {
  userId: user.userId,
  type: 'key_store',
  properties: { provider },
}).catch(() => {});
```

**Step 3: Add dev_key_create event to dev-keys.ts**

In `handleCreate` (after successful `developer_keys` insert), add:

```typescript
import { recordEvent } from '../lib/analytics.js';

// After successful insert:
recordEvent(env, {
  userId: auth.userId,
  type: 'dev_key_create',
}).catch(() => {});
```

**Step 4: Add plan_upgrade event to billing.ts**

In the checkout/tier change handler, after the tier is updated, add:

```typescript
import { recordEvent } from '../lib/analytics.js';

// After tier update:
recordEvent(env, {
  userId: user.userId,
  type: oldTier && tier > oldTier ? 'plan_upgrade' : 'plan_downgrade',
  properties: { from: oldTier || 'free', to: tier },
}).catch(() => {});
```

Note: Capture the user's current tier before the update to determine `from`.

**Step 5: Verify build**

Run: `cd packages/worker && npx tsc --noEmit`
Expected: no errors

**Step 6: Commit**

```bash
git add packages/worker/src/routes/transparent-proxy.ts
git add packages/worker/src/routes/keys.ts
git add packages/worker/src/routes/dev-keys.ts
git add packages/worker/src/routes/billing.ts
git commit -m "feat: inject product analytics events (proxy_call, key_store, dev_key_create, plan_upgrade)"
```

---

## Task 6: Cron Trigger — Daily Aggregation

**Files:**
- Create: `packages/worker/src/cron/aggregate.ts`
- Modify: `packages/worker/src/index.ts` (add scheduled handler)
- Modify: `packages/worker/wrangler.toml` (add cron trigger)

**Step 1: Create the aggregation handler**

Create `packages/worker/src/cron/aggregate.ts`:

```typescript
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

  const sessions = sessionsRes.data || [];
  const events = eventsRes.data || [];

  const visitors = new Set(sessions.map(s => s.visitor_id)).size;
  const uniqueIps = new Set(sessions.filter(s => s.ip_hash).map(s => s.ip_hash)).size;
  const sessionCount = sessions.length;
  const bounces = sessions.filter(s => s.is_bounce).length;

  // Durations (non-bounce sessions only)
  const durations = sessions
    .filter(s => !s.is_bounce && s.started_at && s.ended_at)
    .map(s => (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 1000);
  const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

  const eventCounts = sessions.map(s => s.event_count || 0);
  const avgEvents = eventCounts.length > 0 ? eventCounts.reduce((a, b) => a + b, 0) / eventCounts.length : 0;

  // Count by event type
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
    scans: (typeCounts['scan_start'] || 0),
    upgrades: typeCounts['plan_upgrade'] || 0,
    bounces,
    avg_session_duration_s: Math.round(avgDuration * 100) / 100,
    avg_events_per_session: Math.round(avgEvents * 100) / 100,
  });

  // ── Weekly Cohorts ────────────────────────────────────────────
  // Get all users with signup dates
  const { data: authUsersRes } = await supabase.auth.admin.listUsers({ perPage: 1000, page: 1 });
  const authUsers = authUsersRes?.users || [];

  // Group users by signup week (Monday)
  function getMonday(d: Date): string {
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d);
    monday.setDate(diff);
    return monday.toISOString().slice(0, 10);
  }

  const cohorts: Record<string, string[]> = {};
  for (const u of authUsers) {
    const week = getMonday(new Date(u.created_at));
    if (!cohorts[week]) cohorts[week] = [];
    cohorts[week].push(u.id);
  }

  // For each cohort, check how many were active in each subsequent week
  const currentWeek = getMonday(yesterday);
  const upserts: Array<{ cohort_week: string; week_number: number; cohort_size: number; active_count: number }> = [];

  for (const [cohortWeek, userIds] of Object.entries(cohorts)) {
    const cohortStart = new Date(cohortWeek);
    const weeksSince = Math.floor((new Date(currentWeek).getTime() - cohortStart.getTime()) / (7 * 86400000));

    // Only compute for the current week number (incremental)
    if (weeksSince < 0) continue;

    const weekStart = new Date(cohortStart.getTime() + weeksSince * 7 * 86400000).toISOString();
    const weekEnd = new Date(cohortStart.getTime() + (weeksSince + 1) * 7 * 86400000).toISOString();

    const { data: activeEvents } = await supabase.from('events')
      .select('user_id')
      .in('user_id', userIds)
      .gte('created_at', weekStart)
      .lt('created_at', weekEnd);

    const activeCount = new Set((activeEvents || []).map(e => e.user_id)).size;

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
```

**Step 2: Wire up the scheduled handler in index.ts**

Add to `packages/worker/src/index.ts`:

```typescript
import { aggregateDaily } from './cron/aggregate.js';

// Add after the existing default export's fetch handler:
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // ... existing code ...
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(aggregateDaily(env));
  },
};
```

**Step 3: Add cron trigger to wrangler.toml**

Add to `packages/worker/wrangler.toml`:

```toml
[triggers]
crons = ["5 0 * * *"]
```

This fires daily at 00:05 UTC.

**Step 4: Verify build**

Run: `cd packages/worker && npx tsc --noEmit`
Expected: no errors

**Step 5: Commit**

```bash
git add packages/worker/src/cron/aggregate.ts
git add packages/worker/src/index.ts
git add packages/worker/wrangler.toml
git commit -m "feat: add daily cron aggregation for daily_metrics and weekly_cohorts"
```

---

## Task 7: Admin API — New Analytics Endpoints

**Files:**
- Modify: `packages/worker/src/routes/admin.ts`

This is the largest task. Add these new endpoints alongside existing ones:

**Step 1: Add route dispatch entries**

At the top of `handleAdmin`, add new routes:

```typescript
if (path === 'analytics/overview-v2') return handleOverviewV2(request, env);
if (path === 'analytics/funnel') return handleFunnel(request, env);
if (path === 'analytics/investor') return handleInvestor(request, env);
if (path === 'analytics/retention') return handleRetention(request, env);
if (path === 'analytics/traffic-v2') return handleTrafficV2(request, env);
if (path === 'analytics/devices') return handleDevices(request, env);
```

**Step 2: Implement handleOverviewV2 (real-time "today" stats)**

```typescript
async function handleOverviewV2(request: Request, env: Env): Promise<Response> {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = getSupabase(env);
  const todayStart = new Date(new Date().setUTCHours(0,0,0,0)).toISOString();
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const [sessionsToday, eventsToday, activeNow] = await Promise.all([
    supabase.from('sessions')
      .select('visitor_id, ip_hash, is_bounce, started_at, ended_at, event_count')
      .gte('started_at', todayStart),
    supabase.from('events')
      .select('type')
      .gte('created_at', todayStart),
    supabase.from('sessions')
      .select('id', { count: 'exact', head: true })
      .gte('ended_at', fiveMinAgo),
  ]);

  const sessions = sessionsToday.data || [];
  const events = eventsToday.data || [];

  const visitors = new Set(sessions.map(s => s.visitor_id)).size;
  const uniqueIps = new Set(sessions.filter(s => s.ip_hash).map(s => s.ip_hash)).size;
  const bounces = sessions.filter(s => s.is_bounce).length;
  const bounceRate = sessions.length > 0 ? bounces / sessions.length : 0;

  const durations = sessions
    .filter(s => !s.is_bounce && s.ended_at && s.started_at)
    .map(s => (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 1000);
  const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

  const typeCounts: Record<string, number> = {};
  for (const e of events) typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;

  return Response.json({
    visitors,
    uniqueIps,
    sessions: sessions.length,
    pageviews: typeCounts['pageview'] || 0,
    signups: typeCounts['signup'] || 0,
    bounceRate: Math.round(bounceRate * 1000) / 10,
    avgSessionDurationS: Math.round(avgDuration),
    activeNow: activeNow.count || 0,
    proxyCallsToday: typeCounts['proxy_call'] || 0,
    keysStoredToday: typeCounts['key_store'] || 0,
  });
}
```

**Step 3: Implement handleFunnel**

```typescript
async function handleFunnel(request: Request, env: Env): Promise<Response> {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = getSupabase(env);
  const numDays = getDaysParam(request);
  const since = new Date(Date.now() - numDays * 86400000).toISOString();

  // Count unique visitors (sessions)
  const { data: sessionData } = await supabase.from('sessions')
    .select('visitor_id')
    .gte('started_at', since);
  const totalVisitors = new Set((sessionData || []).map(s => s.visitor_id)).size;

  // Count unique user_ids for each funnel step
  const steps = ['signup', 'key_store', 'dev_key_create', 'proxy_call', 'plan_upgrade'];
  const counts: Record<string, number> = { visit: totalVisitors };

  for (const step of steps) {
    const { data } = await supabase.from('events')
      .select('user_id')
      .eq('type', step)
      .gte('created_at', since);
    counts[step] = new Set((data || []).filter(e => e.user_id).map(e => e.user_id)).size;
  }

  const funnel = [
    { step: 'Visit', count: counts.visit },
    { step: 'Signup', count: counts.signup },
    { step: 'Store Key', count: counts.key_store },
    { step: 'Create Dev Key', count: counts.dev_key_create },
    { step: 'Proxy Call', count: counts.proxy_call },
    { step: 'Upgrade', count: counts.plan_upgrade },
  ];

  return Response.json({ funnel });
}
```

**Step 4: Implement handleInvestor**

```typescript
async function handleInvestor(request: Request, env: Env): Promise<Response> {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = getSupabase(env);
  const now = Date.now();
  const day7 = new Date(now - 7 * 86400000).toISOString();
  const day30 = new Date(now - 30 * 86400000).toISOString();
  const day60 = new Date(now - 60 * 86400000).toISOString();

  // Total registered users
  const { data: authData } = await supabase.auth.admin.listUsers({ perPage: 1000, page: 1 });
  const totalUsers = authData?.users?.length || 0;

  // Activated users (have at least one key_store event)
  const { data: activatedData } = await supabase.from('events')
    .select('user_id')
    .eq('type', 'key_store');
  const activatedUsers = new Set((activatedData || []).filter(e => e.user_id).map(e => e.user_id)).size;
  const activationRate = totalUsers > 0 ? activatedUsers / totalUsers : 0;

  // WAU: unique user_ids with any event in last 7 days
  const { data: wauData } = await supabase.from('events')
    .select('user_id')
    .gte('created_at', day7);
  const wau = new Set((wauData || []).filter(e => e.user_id).map(e => e.user_id)).size;

  // MAU: unique user_ids with any event in last 30 days
  const { data: mauData } = await supabase.from('events')
    .select('user_id')
    .gte('created_at', day30);
  const mau = new Set((mauData || []).filter(e => e.user_id).map(e => e.user_id)).size;

  // DAU (today)
  const todayStart = new Date(new Date().setUTCHours(0,0,0,0)).toISOString();
  const { data: dauData } = await supabase.from('events')
    .select('user_id')
    .gte('created_at', todayStart);
  const dau = new Set((dauData || []).filter(e => e.user_id).map(e => e.user_id)).size;

  const dauMauRatio = mau > 0 ? dau / mau : 0;

  // Proxy calls total + last 30d
  const { count: proxyTotal } = await supabase.from('events')
    .select('*', { count: 'exact', head: true })
    .eq('type', 'proxy_call');
  const { count: proxy30d } = await supabase.from('events')
    .select('*', { count: 'exact', head: true })
    .eq('type', 'proxy_call')
    .gte('created_at', day30);

  // Free → Paid conversion
  const { data: upgradeData } = await supabase.from('events')
    .select('user_id')
    .eq('type', 'plan_upgrade');
  const paidConversions = new Set((upgradeData || []).filter(e => e.user_id).map(e => e.user_id)).size;
  const conversionRate = totalUsers > 0 ? paidConversions / totalUsers : 0;

  // MRR from tier data
  const TIER_PRICES: Record<string, number> = { starter: 5, pro: 20, max: 50, enterprise: 200 };
  const { data: tierData } = await supabase.from('users').select('tier');
  let mrr = 0;
  for (const u of tierData || []) {
    mrr += TIER_PRICES[u.tier] || 0;
  }

  // Time to activation: median time from signup to first key_store
  const { data: activationTimes } = await supabase.from('events')
    .select('user_id, created_at')
    .eq('type', 'key_store')
    .order('created_at', { ascending: true });

  const userFirstActivation = new Map<string, string>();
  for (const e of activationTimes || []) {
    if (e.user_id && !userFirstActivation.has(e.user_id)) {
      userFirstActivation.set(e.user_id, e.created_at);
    }
  }

  const activationDelays: number[] = [];
  for (const user of authData?.users || []) {
    const firstKey = userFirstActivation.get(user.id);
    if (firstKey) {
      activationDelays.push(
        (new Date(firstKey).getTime() - new Date(user.created_at).getTime()) / 3600000
      );
    }
  }
  activationDelays.sort((a, b) => a - b);
  const medianActivationHrs = activationDelays.length > 0
    ? activationDelays[Math.floor(activationDelays.length / 2)]
    : null;

  // Churn: active last month (30-60d ago) but not this month (last 30d)
  const { data: prevMonthData } = await supabase.from('events')
    .select('user_id')
    .gte('created_at', day60)
    .lt('created_at', day30);
  const prevMonthUsers = new Set((prevMonthData || []).filter(e => e.user_id).map(e => e.user_id));
  const currentMonthUsers = new Set((mauData || []).filter(e => e.user_id).map(e => e.user_id));
  const churned = [...prevMonthUsers].filter(u => !currentMonthUsers.has(u)).length;
  const churnRate = prevMonthUsers.size > 0 ? churned / prevMonthUsers.size : 0;

  // Growth: daily_metrics last 30 days
  const { data: growthData } = await supabase.from('daily_metrics')
    .select('date, visitors, signups, proxy_calls')
    .gte('date', day30.slice(0, 10))
    .order('date', { ascending: true });

  return Response.json({
    totalUsers,
    activatedUsers,
    activationRate: Math.round(activationRate * 1000) / 10,
    dau, wau, mau,
    dauMauRatio: Math.round(dauMauRatio * 1000) / 10,
    proxyCallsTotal: proxyTotal || 0,
    proxyCalls30d: proxy30d || 0,
    apiCallsPerActiveUser: mau > 0 ? Math.round((proxy30d || 0) / mau) : 0,
    conversionRate: Math.round(conversionRate * 1000) / 10,
    mrr,
    medianActivationHrs: medianActivationHrs !== null ? Math.round(medianActivationHrs * 10) / 10 : null,
    churnRate: Math.round(churnRate * 1000) / 10,
    growth: growthData || [],
  });
}
```

**Step 5: Implement handleRetention**

```typescript
async function handleRetention(request: Request, env: Env): Promise<Response> {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = getSupabase(env);
  const { data } = await supabase.from('weekly_cohorts')
    .select('*')
    .order('cohort_week', { ascending: true })
    .order('week_number', { ascending: true });

  return Response.json({ cohorts: data || [] });
}
```

**Step 6: Implement handleTrafficV2 and handleDevices**

```typescript
async function handleTrafficV2(request: Request, env: Env): Promise<Response> {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const numDays = getDaysParam(request);
  const supabase = getSupabase(env);
  const { data } = await supabase.from('daily_metrics')
    .select('*')
    .gte('date', new Date(Date.now() - numDays * 86400000).toISOString().slice(0, 10))
    .order('date', { ascending: true });

  return Response.json({ metrics: data || [] });
}

async function handleDevices(request: Request, env: Env): Promise<Response> {
  const admin = await authenticateAdmin(request, env);
  if (!admin) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const supabase = getSupabase(env);
  const numDays = getDaysParam(request);
  const since = new Date(Date.now() - numDays * 86400000).toISOString();

  const { data } = await supabase.from('sessions')
    .select('device_type, browser, os')
    .gte('started_at', since);

  const devices: Record<string, number> = {};
  const browsers: Record<string, number> = {};
  const oses: Record<string, number> = {};

  for (const s of data || []) {
    if (s.device_type) devices[s.device_type] = (devices[s.device_type] || 0) + 1;
    if (s.browser) browsers[s.browser] = (browsers[s.browser] || 0) + 1;
    if (s.os) oses[s.os] = (oses[s.os] || 0) + 1;
  }

  return Response.json({
    devices: Object.entries(devices).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    browsers: Object.entries(browsers).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    oses: Object.entries(oses).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  });
}
```

**Step 7: Verify build**

Run: `cd packages/worker && npx tsc --noEmit`

**Step 8: Commit**

```bash
git add packages/worker/src/routes/admin.ts
git commit -m "feat: add admin API endpoints for funnel, investor metrics, retention, devices"
```

---

## Task 8: Admin Frontend — New Tabs and Auto-Poll

**Files:**
- Modify: `apps/site/vp-admin.html`

This is a large frontend task. Add three new tabs: **Overview v2** (replaces current overview), **Funnel**, and **Investor Metrics** (with retention heatmap).

**Step 1: Add tab buttons**

Add new tabs to the analytics tab bar:

```html
<div class="tab active" onclick="switchAnalyticsTab('overview')">Overview</div>
<div class="tab" onclick="switchAnalyticsTab('funnel')">Funnel</div>
<div class="tab" onclick="switchAnalyticsTab('investor')">Investor</div>
<div class="tab" onclick="switchAnalyticsTab('devices')">Devices</div>
```

**Step 2: Add Overview v2 panel with auto-poll**

Replace the current overview cards with the new real-time cards:

Cards: Visitors Today, Unique IPs, Sessions, Pageviews, Signups, Bounce Rate, Avg Duration, Active Now, Proxy Calls, Keys Stored

Add 30-second auto-poll:

```javascript
let overviewPollInterval = null;

async function loadOverviewV2() {
  const data = await apiFetch('/analytics/overview-v2');
  document.getElementById('ov2-visitors').textContent = data.visitors.toLocaleString();
  document.getElementById('ov2-ips').textContent = data.uniqueIps.toLocaleString();
  document.getElementById('ov2-sessions').textContent = data.sessions.toLocaleString();
  document.getElementById('ov2-pageviews').textContent = data.pageviews.toLocaleString();
  document.getElementById('ov2-signups').textContent = data.signups.toLocaleString();
  document.getElementById('ov2-bounce').textContent = data.bounceRate + '%';
  document.getElementById('ov2-duration').textContent = data.avgSessionDurationS + 's';
  document.getElementById('ov2-active').textContent = data.activeNow.toLocaleString();
  document.getElementById('ov2-proxy').textContent = data.proxyCallsToday.toLocaleString();
  document.getElementById('ov2-keys').textContent = data.keysStoredToday.toLocaleString();
}

function startOverviewPoll() {
  loadOverviewV2();
  overviewPollInterval = setInterval(loadOverviewV2, 30000);
}

function stopOverviewPoll() {
  if (overviewPollInterval) { clearInterval(overviewPollInterval); overviewPollInterval = null; }
}
```

**Step 3: Add Funnel panel**

Horizontal funnel bars with drop-off percentages:

```javascript
async function loadFunnel() {
  const days = currentAnalyticsDays || 30;
  const { funnel } = await apiFetch('/analytics/funnel?days=' + days);
  const container = document.getElementById('funnel-bars');
  const maxCount = funnel[0]?.count || 1;
  container.innerHTML = funnel.map((step, i) => {
    const pct = maxCount > 0 ? (step.count / maxCount * 100) : 0;
    const dropoff = i > 0 && funnel[i-1].count > 0
      ? Math.round((1 - step.count / funnel[i-1].count) * 100) + '% drop'
      : '';
    return `<div class="mb-3">
      <div class="flex justify-between text-xs mb-1">
        <span>${step.step}</span>
        <span class="text-gray-400">${step.count.toLocaleString()} ${dropoff ? '(' + dropoff + ')' : ''}</span>
      </div>
      <div class="w-full bg-gray-800 rounded h-6">
        <div class="bg-brand rounded h-6" style="width:${pct}%"></div>
      </div>
    </div>`;
  }).join('');
}
```

**Step 4: Add Investor Metrics panel**

Top-line number cards + growth chart + retention heatmap:

```javascript
async function loadInvestor() {
  const data = await apiFetch('/analytics/investor');
  // Top-line cards
  document.getElementById('inv-total').textContent = data.totalUsers.toLocaleString();
  document.getElementById('inv-activated').textContent = data.activatedUsers.toLocaleString();
  document.getElementById('inv-activation-rate').textContent = data.activationRate + '%';
  document.getElementById('inv-dau').textContent = data.dau.toLocaleString();
  document.getElementById('inv-wau').textContent = data.wau.toLocaleString();
  document.getElementById('inv-mau').textContent = data.mau.toLocaleString();
  document.getElementById('inv-stickiness').textContent = data.dauMauRatio + '%';
  document.getElementById('inv-mrr').textContent = '$' + data.mrr;
  document.getElementById('inv-conversion').textContent = data.conversionRate + '%';
  document.getElementById('inv-activation-time').textContent = data.medianActivationHrs !== null ? data.medianActivationHrs + 'h' : 'N/A';
  document.getElementById('inv-churn').textContent = data.churnRate + '%';
  document.getElementById('inv-proxy-total').textContent = data.proxyCallsTotal.toLocaleString();
  document.getElementById('inv-api-per-user').textContent = data.apiCallsPerActiveUser.toLocaleString();

  // Growth chart
  if (data.growth && data.growth.length > 0) {
    renderGrowthChart(data.growth);
  }

  // Retention heatmap
  const retData = await apiFetch('/analytics/retention');
  if (retData.cohorts && retData.cohorts.length > 0) {
    renderRetentionHeatmap(retData.cohorts);
  }
}
```

**Step 5: Add retention heatmap renderer**

```javascript
function renderRetentionHeatmap(cohorts) {
  // Group by cohort_week
  const weeks = {};
  for (const c of cohorts) {
    if (!weeks[c.cohort_week]) weeks[c.cohort_week] = { size: c.cohort_size, weeks: {} };
    weeks[c.cohort_week].weeks[c.week_number] = c.active_count;
  }

  const cohortWeeks = Object.keys(weeks).sort();
  const maxWeekNum = Math.max(...cohorts.map(c => c.week_number), 0);
  const numCols = Math.min(maxWeekNum + 1, 12); // cap at 12 weeks

  let html = '<table><thead><tr><th>Cohort</th><th>Size</th>';
  for (let w = 0; w < numCols; w++) html += '<th>W' + w + '</th>';
  html += '</tr></thead><tbody>';

  for (const week of cohortWeeks.slice(-12)) { // last 12 cohorts
    const c = weeks[week];
    html += '<tr><td class="mono text-xs">' + week + '</td><td>' + c.size + '</td>';
    for (let w = 0; w < numCols; w++) {
      const active = c.weeks[w] ?? 0;
      const pct = c.size > 0 ? Math.round(active / c.size * 100) : 0;
      const intensity = Math.min(pct / 100, 1);
      const bg = 'rgba(99,102,241,' + (0.1 + intensity * 0.7) + ')';
      html += '<td style="background:' + bg + ';text-align:center;font-size:11px">' + pct + '%</td>';
    }
    html += '</tr>';
  }

  html += '</tbody></table>';
  document.getElementById('retention-heatmap').innerHTML = html;
}
```

**Step 6: Add Devices panel**

```javascript
async function loadDevices() {
  const days = currentAnalyticsDays || 30;
  const data = await apiFetch('/analytics/devices?days=' + days);

  function renderPieList(containerId, items) {
    const total = items.reduce((s, i) => s + i.count, 0);
    document.getElementById(containerId).innerHTML = items.map(i => {
      const pct = total > 0 ? Math.round(i.count / total * 100) : 0;
      return '<div class="flex justify-between text-sm py-1"><span>' + i.name + '</span><span class="text-gray-400">' + pct + '% (' + i.count + ')</span></div>';
    }).join('');
  }

  renderPieList('devices-list', data.devices);
  renderPieList('browsers-list', data.browsers);
  renderPieList('oses-list', data.oses);
}
```

**Step 7: Wire tab switching**

```javascript
function switchAnalyticsTab(tab) {
  stopOverviewPoll();
  document.querySelectorAll('.analytics-panel').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.analytics-tab').forEach(t => t.classList.remove('active'));

  document.getElementById('panel-' + tab).classList.remove('hidden');
  document.querySelector('[data-tab="' + tab + '"]').classList.add('active');

  if (tab === 'overview') startOverviewPoll();
  else if (tab === 'funnel') loadFunnel();
  else if (tab === 'investor') loadInvestor();
  else if (tab === 'devices') loadDevices();
}
```

Note: The exact HTML structure (card layout, panel divs, id attributes) should be implemented inline in the file following the existing patterns. The JavaScript above shows the logic; the HTML cards follow the same `stat-card`, `stat-value`, `stat-label` pattern already used.

**Step 8: Commit**

```bash
git add apps/site/vp-admin.html
git commit -m "feat: add funnel, investor metrics, retention heatmap, and devices tabs to admin"
```

---

## Task 9: Backfill Historical Data

**Files:**
- Create: `scripts/backfill-analytics.ts`

**Step 1: Create the backfill script**

This is a one-time script that reads existing `analytics_events` rows and populates the new `sessions` and `events` tables. Run it via `npx tsx scripts/backfill-analytics.ts`.

```typescript
// scripts/backfill-analytics.ts
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/backfill-analytics.ts

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

async function backfill() {
  console.log('Fetching all analytics_events...');

  let allEvents: any[] = [];
  let page = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('analytics_events')
      .select('*')
      .eq('type', 'pageview')
      .order('created_at', { ascending: true })
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) { console.error('Fetch error:', error); break; }
    if (!data || data.length === 0) break;
    allEvents = allEvents.concat(data);
    page++;
    console.log(`  Fetched ${allEvents.length} events...`);
  }

  console.log(`Total events: ${allEvents.length}`);

  // Group events into sessions by session_id with 30-min gap detection
  const sessionMap = new Map<string, any[]>();
  for (const e of allEvents) {
    const sid = e.session_id || 'unknown';
    if (!sessionMap.has(sid)) sessionMap.set(sid, []);
    sessionMap.get(sid)!.push(e);
  }

  const sessionsToInsert: any[] = [];
  const eventsToInsert: any[] = [];
  let sessionCounter = 0;

  for (const [visitorId, events] of sessionMap) {
    events.sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    let currentSession: any = null;

    for (const e of events) {
      const ts = new Date(e.created_at).getTime();

      if (!currentSession || (ts - new Date(currentSession.ended_at).getTime() > SESSION_TIMEOUT_MS)) {
        // Start new session
        if (currentSession) sessionsToInsert.push(currentSession);
        sessionCounter++;
        const meta = typeof e.metadata === 'string' ? JSON.parse(e.metadata || '{}') : (e.metadata || {});
        currentSession = {
          id: crypto.randomUUID(),
          visitor_id: visitorId,
          ip_hash: meta.ip_hash || null,
          user_id: e.user_id || null,
          country: meta.country || null,
          referrer: e.referrer || null,
          landing_page: e.page || null,
          started_at: e.created_at,
          ended_at: e.created_at,
          is_bounce: true,
          event_count: 0,
        };
      }

      currentSession.ended_at = e.created_at;
      currentSession.event_count++;
      currentSession.is_bounce = currentSession.event_count <= 1;
      if (e.user_id) currentSession.user_id = e.user_id;

      eventsToInsert.push({
        id: crypto.randomUUID(),
        session_id: currentSession.id,
        user_id: e.user_id || null,
        type: 'pageview',
        page: e.page || null,
        referrer: e.referrer || null,
        properties: null,
        created_at: e.created_at,
      });
    }

    if (currentSession) sessionsToInsert.push(currentSession);
  }

  console.log(`Sessions to create: ${sessionsToInsert.length}`);
  console.log(`Events to create: ${eventsToInsert.length}`);

  // Batch insert sessions
  for (let i = 0; i < sessionsToInsert.length; i += 500) {
    const batch = sessionsToInsert.slice(i, i + 500);
    const { error } = await supabase.from('sessions').upsert(batch);
    if (error) console.error(`Session batch ${i} error:`, error.message);
    else console.log(`  Sessions: ${Math.min(i + 500, sessionsToInsert.length)}/${sessionsToInsert.length}`);
  }

  // Batch insert events
  for (let i = 0; i < eventsToInsert.length; i += 500) {
    const batch = eventsToInsert.slice(i, i + 500);
    const { error } = await supabase.from('events').upsert(batch);
    if (error) console.error(`Event batch ${i} error:`, error.message);
    else console.log(`  Events: ${Math.min(i + 500, eventsToInsert.length)}/${eventsToInsert.length}`);
  }

  // Compute daily_metrics for each historical day
  console.log('Computing daily_metrics...');
  const daySet = new Set<string>();
  for (const s of sessionsToInsert) {
    daySet.add(s.started_at.slice(0, 10));
  }

  for (const dateStr of [...daySet].sort()) {
    const dayStart = `${dateStr}T00:00:00Z`;
    const dayEnd = `${dateStr}T23:59:59.999Z`;

    const daySessions = sessionsToInsert.filter(s => s.started_at >= dayStart && s.started_at <= dayEnd);
    const dayEvents = eventsToInsert.filter(e => e.created_at >= dayStart && e.created_at <= dayEnd);

    const visitors = new Set(daySessions.map(s => s.visitor_id)).size;
    const uniqueIps = new Set(daySessions.filter(s => s.ip_hash).map(s => s.ip_hash)).size;
    const bounces = daySessions.filter(s => s.is_bounce).length;

    const durations = daySessions
      .filter(s => !s.is_bounce)
      .map(s => (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 1000);
    const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    const eventCounts = daySessions.map(s => s.event_count);
    const avgEvents = eventCounts.length > 0 ? eventCounts.reduce((a, b) => a + b, 0) / eventCounts.length : 0;

    await supabase.from('daily_metrics').upsert({
      date: dateStr,
      visitors, unique_ips: uniqueIps,
      sessions: daySessions.length,
      pageviews: dayEvents.length,
      signups: 0, keys_stored: 0, dev_keys_created: 0,
      proxy_calls: 0, scans: 0, upgrades: 0,
      bounces,
      avg_session_duration_s: Math.round(avgDuration * 100) / 100,
      avg_events_per_session: Math.round(avgEvents * 100) / 100,
    });
  }

  console.log('Backfill complete!');
}

backfill().catch(console.error);
```

**Step 2: Run the backfill**

```bash
SUPABASE_URL=https://gwzkjiomemjlhtrdrlan.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<key> \
npx tsx scripts/backfill-analytics.ts
```

**Step 3: Verify in Supabase Table Editor**

Confirm rows exist in `sessions`, `events`, and `daily_metrics`.

**Step 4: Commit**

```bash
git add scripts/backfill-analytics.ts
git commit -m "feat: add one-time backfill script for analytics migration"
```

---

## Task 10: Deploy and Validate

**Step 1: Deploy the worker**

```bash
bash scripts/deploy-worker.sh
```

**Step 2: Verify the admin dashboard**

- Open `vaultproof.dev/vp-admin.html`
- Check Overview tab shows real-time numbers updating every 30s
- Check Funnel tab shows the conversion funnel
- Check Investor tab shows KPIs and retention heatmap
- Check Devices tab shows device/browser/OS breakdown

**Step 3: Verify client-side tracking**

- Visit `vaultproof.dev` in a fresh incognito window
- Check Network tab for POST to `/analytics/event` with `visitorId`, `sessionId`, `utmSource` fields
- Confirm the session and event appear in Supabase `sessions` and `events` tables

**Step 4: Verify product events**

- Store a test key → confirm `key_store` event in `events` table
- Make a proxy call → confirm `proxy_call` event in `events` table

**Step 5: Remove dual-write (after 1 week of validation)**

Once confident the new tables are working correctly, remove the legacy `analytics_events` insert from `packages/worker/src/routes/analytics.ts` (the "Dual-write" block). Keep the `analytics_events` table itself as read-only archive.

**Step 6: Final commit**

```bash
git add -A
git commit -m "chore: post-deploy validation complete for analytics schema"
```
