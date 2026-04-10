# Analytics Schema Design — GA-Style In-App Product Analytics

**Date:** 2026-04-09
**Status:** Approved

## Goal

Replace the flat `analytics_events` table with a normalized, GA-style analytics schema. Provides full funnel tracking, retention cohorts, investor KPIs, and real-time dashboard — all on the admin panel. Runs alongside Google Analytics (GA stays as-is).

## Requirements

- In-app product analytics (not just marketing site pageviews)
- Full GA-style metrics: DAU/WAU/MAU, funnels, retention, bounce rate, session duration
- Investor-ready KPIs: activation rate, DAU/MAU ratio, MRR, churn, time to activation
- Keep raw event data forever
- Real-time "today" stats via 30-second auto-poll
- Historical data via pre-aggregated daily rollups

## Database Schema

### `sessions` table

Tracks browser sessions. New session starts on first visit or after 30 min of inactivity.

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | UUID |
| `visitor_id` | TEXT NOT NULL | from localStorage (persists across sessions) |
| `ip_hash` | TEXT | daily-rotated SHA-256 hash |
| `user_id` | TEXT | set when logged in, NULL for anonymous |
| `device_type` | TEXT | `desktop`, `mobile`, `tablet` |
| `browser` | TEXT | `Chrome`, `Safari`, `Firefox`, etc. |
| `os` | TEXT | `macOS`, `Windows`, `iOS`, `Android`, etc. |
| `country` | TEXT | from CF-IPCountry |
| `utm_source` | TEXT | |
| `utm_medium` | TEXT | |
| `utm_campaign` | TEXT | |
| `referrer` | TEXT | first referrer of the session |
| `landing_page` | TEXT | first page of the session |
| `started_at` | TIMESTAMPTZ | |
| `ended_at` | TIMESTAMPTZ | updated on each event |
| `is_bounce` | BOOLEAN | true if only 1 pageview in session |
| `event_count` | INT DEFAULT 0 | rolling count |

### `events` table

Every tracked action — pageviews and product events.

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | UUID |
| `session_id` | TEXT FK → sessions | |
| `user_id` | TEXT | NULL for anonymous |
| `type` | TEXT NOT NULL | see event taxonomy |
| `page` | TEXT | current page path |
| `referrer` | TEXT | page-level referrer |
| `properties` | JSONB | event-specific data |
| `created_at` | TIMESTAMPTZ DEFAULT now() | |

### `daily_metrics` table

Pre-aggregated daily rollups, computed by cron at 00:05 UTC.

| Column | Type | Notes |
|--------|------|-------|
| `date` | DATE PK | |
| `visitors` | INT | unique visitor_ids |
| `unique_ips` | INT | unique ip_hashes |
| `sessions` | INT | session count |
| `pageviews` | INT | |
| `signups` | INT | |
| `keys_stored` | INT | |
| `dev_keys_created` | INT | |
| `proxy_calls` | INT | |
| `scans` | INT | |
| `upgrades` | INT | |
| `bounces` | INT | |
| `avg_session_duration_s` | FLOAT | |
| `avg_events_per_session` | FLOAT | |

### `weekly_cohorts` table

Retention cohort data for investor heatmap.

| Column | Type | Notes |
|--------|------|-------|
| `cohort_week` | DATE | Monday of signup week |
| `week_number` | INT | 0, 1, 2, ... weeks since signup |
| `cohort_size` | INT | users who signed up that week |
| `active_count` | INT | users from cohort active in week N |

### Event Taxonomy

| Event type | When fired | Source | Properties |
|------------|-----------|--------|------------|
| `pageview` | Every page load | Client | — |
| `signup` | User completes registration | Server | `{method: "github"\|"google"\|"email"}` |
| `login` | User logs in | Server | `{method}` |
| `key_store` | API key stored in vault | Server | `{provider: "openai"\|"anthropic"\|...}` |
| `dev_key_create` | Developer key created | Server | — |
| `proxy_call` | Proxied API call made | Server | `{provider, status}` |
| `scan_start` | Scanner scan initiated | Client | `{scan_type: "repo"\|"snippet"}` |
| `scan_complete` | Scanner scan finished | Server | `{findings_count}` |
| `plan_upgrade` | User upgrades tier | Server | `{from, to}` |
| `plan_downgrade` | User downgrades tier | Server | `{from, to}` |

### Indexes

```sql
-- Sessions
CREATE INDEX sessions_started_at_idx ON sessions(started_at);
CREATE INDEX sessions_visitor_id_idx ON sessions(visitor_id);
CREATE INDEX sessions_user_id_idx ON sessions(user_id) WHERE user_id IS NOT NULL;

-- Events
CREATE INDEX events_session_id_idx ON events(session_id);
CREATE INDEX events_type_created_at_idx ON events(type, created_at);
CREATE INDEX events_user_id_idx ON events(user_id) WHERE user_id IS NOT NULL;
```

## Tracking & Collection

### Client-side

Single `analytics.js` script replaces per-page inline snippets:

- `visitor_id` in localStorage (persists across sessions, equivalent to GA client_id)
- `session_id` in sessionStorage + 30-min inactivity timeout via `last_active` timestamp
- UTM params parsed from URL on first page load of session
- Sends POST to `/analytics/event` on every page load
- Exposes `window.vp.track('event_type', {properties})` for client-side product events

### Server-side (CF Worker)

- Updated `/analytics/event` endpoint: receives event, bot-filters, computes ip_hash, parses UA, upserts session, inserts event
- Product events (proxy_call, signup, login, key_store, dev_key_create, plan_upgrade/downgrade, scan_complete) recorded directly by the Worker — no client call
- Session upsert: look up by session_id; if not found or last event >30 min ago, create new session; otherwise update ended_at, increment event_count, recalculate is_bounce

### Cron Trigger (daily at 00:05 UTC)

- Aggregates yesterday's sessions + events → upserts `daily_metrics` row
- Computes `weekly_cohorts` from auth.users signup dates + events

## Admin Dashboard

### Real-time overview (30s auto-poll, queries live tables)

| Card | Query |
|------|-------|
| Visitors Today | `COUNT(DISTINCT visitor_id)` from sessions |
| Unique IPs Today | `COUNT(DISTINCT ip_hash)` from sessions |
| Sessions Today | `COUNT(*)` from sessions |
| Pageviews Today | `COUNT(*)` from events WHERE type = 'pageview' |
| Signups Today | `COUNT(*)` from events WHERE type = 'signup' |
| Bounce Rate Today | `AVG(is_bounce::int)` from sessions |
| Avg Session Duration | `AVG(ended_at - started_at)` from non-bounce sessions |
| Active Right Now | sessions with ended_at within last 5 minutes |

### Funnel view

```
pageview → signup → key_store → dev_key_create → proxy_call → plan_upgrade
```

Each step: count unique user_ids. Displayed as horizontal funnel with drop-off percentages.

### Investor Metrics tab

| Metric | Computation |
|--------|------------|
| Total registered users | COUNT from auth.users |
| Activated users | distinct user_ids with key_store event |
| Activation rate | activated / registered |
| WAU / MAU | unique user_ids in rolling 7d / 30d |
| DAU/MAU ratio | stickiness indicator (>20% is good) |
| Retention heatmap | weekly cohort grid from weekly_cohorts |
| Proxy calls (total + trend) | sum of proxy_call events |
| API calls per active user | proxy_calls / active users |
| Free → Paid conversion | plan_upgrade events / total users |
| MRR | sum of active paid tiers x price |
| Signup source breakdown | utm_source on signup sessions |
| Time to activation | median time from signup to first key_store |
| Churn rate | active last month but not this month / last month MAU |

### Traffic breakdown (from sessions)

- By source (utm_source / referrer domain)
- By country
- By device type
- By browser / OS
- Top pages

### Existing tabs preserved

Current admin analytics tabs stay — re-pointed to new tables.

## Migration Strategy

1. Create new tables alongside existing `analytics_events` — no drop
2. One-time backfill script:
   - Group existing pageviews by session_id into sessions (estimate boundaries via 30-min gaps)
   - Copy events into new events table
   - Compute daily_metrics for all historical dates
   - Build weekly_cohorts from auth.users + access_logs
3. Cut over tracking endpoint and admin queries to new tables
4. Keep `analytics_events` as read-only archive — drop later once confident

### Known limitations of backfill

- Historical sessions are approximate (inferred from event timestamp gaps)
- Only `pageview` events exist historically — product events start fresh after deploy
- Acceptable: investors care about trends going forward
