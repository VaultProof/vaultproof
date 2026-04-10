# Dashboard Keys Page — Real Data Integration

**Date:** 2026-04-04
**Status:** Approved

## Problem

The keys dashboard at `/keys` uses hardcoded demo data (`DEMO_KEYS`) and `Math.floor(Math.random() * 500)` for call counts. It never calls the real stats API. The backend endpoints (`/api/v1/keys/list`, `/api/v1/stats/by-key`) exist and work but the frontend ignores them.

## Design

### Auth Flow

Reuse the pattern from `admin/page.tsx`:
- Init Supabase client with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Call `supabase.auth.getSession()` on mount
- No session → show sign-in prompt
- Session → use `access_token` as `Authorization: Bearer` header

### Data Fetching

Two parallel `fetch()` calls on mount:
1. `GET {BACKEND_URL}/api/v1/keys/list` → real keys with provider, label, status, app grants
2. `GET {BACKEND_URL}/api/v1/stats/by-key` → per-key stats: callsThisMonth, dailyUsed, errorsThisMonth, lastUsed

Merge stats into keys by matching on `key.id`.

### UI Changes

- Remove `DEMO_KEYS` array and `Math.random()` call counts
- "Calls (24h)" → `dailyUsed` from stats
- "Last Used" → `lastUsed` formatted as relative time
- "ZK Proofs" → show error count from `errorsThisMonth`, or "All verified" if 0
- Add loading spinner while fetching
- Add empty state ("No keys yet") if user has no keys
- Add error state if API call fails

### What Stays the Same

- All existing UI styling and layout
- Provider color mapping
- Add Key form placeholder
- Revoke / Grant Access button placeholders

### API Response Shapes

**GET /api/v1/keys/list:**
```json
{
  "keySlots": [{
    "id": "ks_001",
    "provider": "openai",
    "label": "Production GPT-4",
    "status": "ACTIVE",
    "created_at": "2026-03-20T10:00:00Z",
    "app_grants": [{ "id": "g1", "app_name": "My AI Chat", "granted_at": "..." }]
  }]
}
```

**GET /api/v1/stats/by-key:**
```json
{
  "keys": [{
    "id": "ks_001",
    "dailyUsed": 42,
    "callsThisMonth": 1200,
    "errorsThisMonth": 3,
    "lastUsed": "2026-04-04T10:30:00Z"
  }]
}
```

## Files Modified

- `apps/dashboard/src/app/keys/page.tsx` — replace demo data with real API calls
