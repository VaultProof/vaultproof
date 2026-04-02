# Migrate Dashboard Routes from Railway to CF Worker

**Date:** 2026-04-02
**Status:** Approved

## Problem

Railway backend is down. The dashboard makes ~8 API calls that all forward through the CF Worker to Railway, causing 502s. The worker already has Supabase client, auth, and KV cache infrastructure — but the route handlers were never migrated.

## Routes to Migrate

### User Auth (Supabase JWT via `auth.getUser()`)

1. **GET /api/v1/stats/overview** — total keys, calls, errors, error rate, active apps, recent activity
2. **GET /api/v1/stats/usage?days=N** — daily call/error breakdown (1-90 days)
3. **GET /api/v1/stats/by-key** — per-key usage stats with app grants
4. **GET /api/v1/dev-keys/list** — list developer keys (masked, first 12 + last 4 chars)
5. **GET /api/v1/promo/feedback/status** — is promo user, submitted feedback this week?

### Admin Auth (JWT + email in ADMIN_EMAILS env var)

6. **GET /admin/analytics/overview** — views/signups/visitors today/week/month
7. **GET /admin/analytics/referral-stats?days=N&source=S** — referral funnel stats

### Public (no auth)

8. **POST /analytics/event** — insert pageview into analytics_events table

## File Structure

```
packages/worker/src/
├── index.ts              (update routing)
├── routes/
│   ├── transparent-proxy.ts  (exists)
│   ├── stats.ts              (new — routes 1-3)
│   ├── dev-keys.ts           (new — route 4)
│   ├── promo.ts              (new — route 5)
│   ├── admin.ts              (new — routes 6-7)
│   └── analytics.ts          (new — route 8)
└── lib/
    ├── supabase.ts       (exists)
    ├── auth.ts           (exists — dev key auth)
    └── jwt-auth.ts       (new — Supabase JWT user auth + admin check)
```

## Auth Helpers (jwt-auth.ts)

- `authenticateUser(request, env)` — extract Bearer token, call `supabase.auth.getUser()`, return user ID and email
- `authenticateAdmin(request, env)` — same as user auth + check email against `ADMIN_EMAILS`

## Query Approach

All queries use Supabase PostgREST via `getSupabase(env).from('table')`. No Prisma. Same database, same tables.

## Env Vars Needed

- `ADMIN_EMAILS` — comma-separated admin email allowlist (add to wrangler.toml or CF dashboard)
- All others already exist: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CACHE`
