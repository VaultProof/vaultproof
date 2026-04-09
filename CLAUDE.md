# VaultProof — Claude Code Guide

Private repo: `windsurftemplate/vaultproof` · Local: `/Users/nelson/projects/zkvault`

## Repo Structure

```
packages/
  worker/     — CF Workers primary backend (TypeScript + Wrangler)
               CF Worker name: zkvault (prod), vaultproof-staging (staging)
  backend/    — Legacy Express backend (Railway, backup only since 2026-04-02)
  shamir/     — Shamir secret sharing library (GF(256), 2-of-2)
  sdk/        — Developer SDK (@vaultproof/sdk)
  cli/        — CLI tool
  circuits/   — Noir ZK proof circuits
  widget/     — React embed widget
  mcp-server/ — MCP server (branch feature/mcp-server, on hold)
apps/
  site/       — Static HTML frontend (CF Pages)
  dashboard/  — Next.js dashboard (CF Pages)
docs/
  compliance/ — SOC 2 readiness docs (PRIVATE — never push to vaultproof-open)
  plans/      — Design docs and pentest reports
scripts/
  deploy-worker.sh — Production deploy with health check + auto-rollback
```

## Three Repos — Never Mix Them

| Repo | Local path | Purpose |
|------|-----------|---------|
| `windsurftemplate/vaultproof` (private) | `/Users/nelson/projects/zkvault` | Full product (this repo) |
| `VaultProof/vaultproof` (public) | `/Users/nelson/projects/vaultproof-open` | Open source core |
| `VaultProof/vaultproof-open` (public) | `/Users/nelson/projects/zk-mcp-demo` | ZK-auth MCP demo |

Public repo git identity: `name="VaultProof", email="hello@vaultproof.dev"` — never use Nelson Yee there.

## Key Commands

```bash
# Dev
npm run dev                          # all packages (turbo)
cd packages/worker && npm run dev    # worker only (wrangler dev)

# Test
npm run test                         # all packages
cd packages/shamir && npm run test   # shamir only

# Deploy
bash scripts/deploy-worker.sh        # production (health check + auto-rollback)
cd packages/worker && npx wrangler deploy --env staging   # staging only

# DB (run from repo root)
prisma migrate dev --schema=packages/backend/prisma/schema.prisma

# SOC 2 compliance check
export SUPABASE_PROJECT_REF=gwzkjiomemjlhtrdrlan
export SUPABASE_SERVICE_KEY=...
export SUPABASE_ACCESS_TOKEN=...     # from supabase.com/dashboard/account/tokens
bash docs/compliance/scripts/compliance-check.sh
```

## Architecture

**Primary backend:** CF Worker (`packages/worker`) — all production traffic goes here. Railway backend is backup/inactive.

**Key security flow:**
1. SDK Shamir-splits key client-side (key never transmitted whole)
2. Share 1 → AES-256-GCM encrypted with `VAULT_ENCRYPTION_KEY` (CF secret) → Supabase
3. Share 2 → AES-256-GCM encrypted with developer's `vp_live_` key (scrypt KDF) → Supabase
4. On proxy call: shares reconstructed in CF Worker RAM for ~100ms, then zeroed
5. CF Worker → Railway: HMAC-SHA256 signed (30s replay window)

**Auth:**
- Users: Supabase Auth (JWT) — source of truth is `auth.users`, NOT `public.users`
- Developer API keys: `vp_live_` prefix, stored in `developer_keys` table
- Admin panel: email allowlist (yee.nelsonk@gmail.com)

**Infra:**
- Prod: `api.vaultproof.dev` (CF Worker `zkvault`)
- Staging: `staging-api.vaultproof.dev` (CF Worker `vaultproof-staging`)
- Frontend: `vaultproof.dev` (CF Pages, `main` branch)
- Supabase: `gwzkjiomemjlhtrdrlan.supabase.co`
- GitHub OAuth app name: `zkproof` (not `zkvault`)
- CF Workers subdomain: `vaultproof.workers.dev`

## Critical Rules

**DO NOT:**
- Use `public.users` for user counts — use `auth.users` or `supabase.auth.admin.listUsers()`
- Cache reconstructed API keys in KV (was CRITICAL security finding C2, fixed 2026-04-01)
- Set KV `expirationTtl` below 60s — KV minimum is 60s. Use soft-expiry envelope pattern for sub-60s logical TTLs
- Write user-facing copy with crypto jargon: Shamir, HMAC, GF(256), Noir, Poseidon2, AES-256-GCM, JWT, X-Proxy-Signature
- Claim "zero-knowledge encryption", "never sees your keys", "mathematically impossible", or any uncertified compliance claim
- Push compliance docs (`docs/compliance/`) to `vaultproof-open` — SOC 2 docs stay in this private repo only
- Describe the VaultProof migration as "a one line change" — it touches URLs, keys, headers, env vars across many files

**DO:**
- Always update `docs/` when adding new commands, methods, or endpoints
- Use soft-expiry envelope pattern for logical sub-60s TTLs in KV
- Use `auth.uid()::text` for RLS policies (user_id columns are TEXT)
- Keep staging and production workers using different names (`vaultproof-staging` vs `zkvault`)

## Environment Variables

**CF Worker secrets** (set via `wrangler secret put`):
- `VAULT_ENCRYPTION_KEY` — AES-256-GCM key for Share 1 encryption
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` — Supabase connection
- `JWT_SECRET` — for legacy token validation
- `HMAC_SECRET` — Worker → Backend authentication

**Local dev** (`.env` at repo root, never committed):
- `SUPABASE_PROJECT_REF=gwzkjiomemjlhtrdrlan`
- `SUPABASE_SERVICE_KEY=...`
- `SUPABASE_ACCESS_TOKEN=...` (for compliance check script)

## SOC 2 Status

Work in progress — all 10 controls filled in at `docs/compliance/controls/`. Current compliance check: 6/9 PASS.

**Open blocker:** Branch protection configured on `main` but GitHub Free org doesn't enforce it on private repos. Must upgrade to GitHub Team ($4/mo) or transfer repo to personal account before engaging a SOC 2 auditor.

Compliance check script: `docs/compliance/scripts/compliance-check.sh`
