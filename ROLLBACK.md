# Rollback Guide

How to revert each part of VaultProof if something breaks in production.

## Zero-downtime architecture

VaultProof is designed so that no deploy or rollback causes downtime:

| Layer | How it stays up |
|-------|----------------|
| **Cloudflare Workers** | Atomic edge deploys — old version serves until new version is fully deployed worldwide. No gap. |
| **Railway backend** | Rolling deploy with health check (`/health`). New instance must pass health check before Railway routes traffic to it. Old instance stays alive until handoff is complete. |
| **Graceful shutdown** | On SIGTERM (Railway sends this before killing), the backend finishes all in-flight requests before exiting. No dropped connections. |
| **Database** | Supabase Postgres — always on, no deploy involved. Migrations should be additive (add columns, don't drop or rename). |
| **npm packages** | Users pin versions. A bad publish doesn't affect anyone until they explicitly upgrade. |

**Rule: never make breaking database migrations.** Always:
- Add new columns (with defaults), don't rename or drop
- Deploy code that handles both old and new schema first
- Only remove old columns after all instances run the new code

---

## 1. Backend (Railway)

The backend auto-deploys from `main`. Two ways to rollback:

**Option A: Railway dashboard (fastest)**
1. Go to https://railway.app → VaultProof project → Backend service
2. Click "Deployments" → find the last working deployment → click "Redeploy"

**Option B: Git revert**
```bash
# Revert the broken commit (creates a new commit, safe for shared branches)
git revert <broken-commit-hash>
git push
# Railway auto-deploys the revert
```

**Known safe commit:** `fc655de` (security fixes, all tests pass)

---

## 2. Cloudflare Workers

### Edge proxy (packages/worker)
```bash
cd packages/worker

# Rollback to previous version
npx wrangler rollback

# Or deploy a specific version
npx wrangler deploy --var BACKEND_URL:https://your-backend.railway.app
```

### Monitor (packages/monitor)
```bash
cd packages/monitor
npx wrangler rollback
```

**Dashboard alternative:** https://dash.cloudflare.com → Workers → select worker → Deployments → "Rollback to this version"

---

## 3. npm packages

Previous versions stay on the registry forever. Users can pin to any prior version.

### SDK
```bash
# Current: @vaultproof/sdk@2.1.0 (adds vault.retrieve())
# Safe rollback: @vaultproof/sdk@2.0.0 (proxy, store, keys, revoke)
npm install @vaultproof/sdk@2.0.0
```

### CLI
```bash
# Current: @vaultproof/cli@1.4.1 (env-vars extraction + tests)
# Safe rollback: @vaultproof/cli@1.4.0 (security fixes)
npm install -g @vaultproof/cli@1.4.0
```

### Unpublish (nuclear option, use only if a version is dangerously broken)
```bash
# npm allows unpublish within 72 hours of publish
npm unpublish @vaultproof/sdk@2.1.0
npm unpublish @vaultproof/cli@1.4.1
```

### Deprecate (softer — warns users but doesn't remove)
```bash
npm deprecate @vaultproof/sdk@2.1.0 "Bug in retrieve(), use 2.0.0"
npm deprecate @vaultproof/cli@1.4.1 "Use 1.4.0 instead"
```

---

## 4. Site / docs (static HTML)

The site is static files in `apps/site/`. Revert the commit and redeploy:

```bash
git revert <commit-with-bad-docs>
git push
```

If hosted on Cloudflare Pages or similar, the redeploy is automatic.

---

## 5. Database (Prisma / Supabase)

Schema changes are the hardest to rollback. Before any migration:

```bash
# Backup first
pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql

# If a migration breaks, restore
psql $DATABASE_URL < backup-20260327.sql
```

For Prisma specifically:
```bash
# Check migration status
npx prisma migrate status

# Revert a migration (creates a new down-migration)
npx prisma migrate resolve --rolled-back <migration-name>
```

---

## 6. Supabase Auth

Auth is managed by Supabase — no rollback needed on our side. If auth breaks:
1. Check https://status.supabase.com
2. Check the Supabase dashboard for auth config changes
3. Verify `SUPABASE_URL` and `SUPABASE_ANON_KEY` env vars are correct in Railway

---

## Quick decision tree

```
Something broke → what layer?

├── Users can't log in
│   → Check Supabase status page
│   → Check Railway backend logs for auth route errors
│   → Rollback backend on Railway dashboard
│
├── API calls failing (proxy/retrieve)
│   → Check Railway backend logs
│   → Check Cloudflare Worker logs (edge proxy)
│   → Rollback backend, then worker if needed
│
├── CLI broken after update
│   → npm install -g @vaultproof/cli@1.4.0
│   → npm deprecate the broken version
│
├── SDK broken after update
│   → Pin users to previous version in docs
│   → npm deprecate the broken version
│
├── Docs showing wrong info
│   → git revert the docs commit, push
│
└── Database schema broke something
    → Restore from pg_dump backup
    → Revert Prisma migration
```

---

## Version history (safe rollback targets)

| Package | Version | Status | Notes |
|---------|---------|--------|-------|
| SDK | 2.1.0 | Current | Adds retrieve() |
| SDK | 2.0.0 | Safe | Session tokens, no retrieve |
| CLI | 1.4.1 | Current | Env-vars extraction |
| CLI | 1.4.0 | Safe | Security fixes |
| CLI | 1.3.0 | Safe | Env var collision fix |
| Backend | `fc655de` | Safe | All 15 security fixes |
| Backend | `eed74f8` | Safe | Session tokens |
