# VaultProof Scanner — Dashboard Feature Design

**Date:** 2026-03-30
**Status:** Approved

---

## Problem

Developers have API keys scattered across their repos — in `.env` files, source code, configs, and worst of all, in git history. They don't know which keys are exposed, which are still active, or where they all are. The CLI `vaultproof migrate` helps locally, but there's no way to scan remote repos from the dashboard.

## Solution

A "Scanner" page in the VaultProof dashboard. Users connect their GitHub account, pick a repo, and VaultProof scans it for exposed API keys via the GitHub API (no cloning). Per-key actions: store in VaultProof, create a PR to remove the key, or ignore. Pro plan only.

---

## User Flow

```
1. User clicks "Scanner" in sidebar (after Agents)
2. First time → "Connect GitHub" button + disclaimer
3. After connecting → sees list of their repos
4. User picks a repo → scan runs via GitHub API
5. Results show: found keys with file:line, provider, active/revoked status
6. Per-key actions:
   - "Store in VaultProof" → stores key in vault
   - "Create PR" → shows diff preview, user approves, PR is created
   - "Ignore" → marks finding as dismissed
7. Scan history saved — user can view past scans
```

---

## GitHub OAuth

**Separate GitHub OAuth app** — not the Supabase login app. This keeps the login flow clean (no scary `repo` scope on signup) and makes scanning opt-in.

- **Scopes requested:** `repo` (read files + create PRs on private repos)
- **Token storage:** encrypted in `github_connections` table, server-side only
- **Lifecycle:** user can disconnect at any time from Settings or Scanner page

**Why separate from login:**
- Login uses Supabase OAuth with `user:email` scope only
- Scanner needs `repo` scope — requesting this at login would scare away signups
- Users who never use the scanner never see the `repo` permission

---

## Disclaimer (shown before first connect)

> **By connecting GitHub, you authorize VaultProof to:**
> - Read your repository contents to scan for exposed secrets
> - Create pull requests on your behalf (only with your explicit approval)
>
> VaultProof will never modify your default branch directly. You are responsible for reviewing and merging any changes.
>
> **Only scan repositories you own or have permission to scan.**

---

## Scanning — What and How

When the user picks a repo, the backend:

1. **Lists files** via GitHub API — `.env*`, source code (`*.ts`, `*.js`, `*.py`, etc.), config files
2. **Reads file contents** via GitHub API — no cloning, reads individual files
3. **Scans git history** via GitHub API — commit diffs to find deleted keys
4. **Runs detection** — same 55 prefix patterns + Shannon entropy filter + provider classification as CLI
5. **Verifies keys** — calls provider APIs to check active vs revoked (same as CLI `--verify`)

**Files scanned:**
- `.env`, `.env.*`
- Source: `*.ts`, `*.js`, `*.jsx`, `*.tsx`, `*.py`, `*.go`, `*.rb`, `*.java`, `*.php`
- Config: `docker-compose.yml`, `vercel.json`, `railway.json`, `fly.toml`, `Dockerfile`
- CI: `.github/workflows/*.yml`, `.gitlab-ci.yml`

**Files skipped:**
- `node_modules/`, `dist/`, `build/`, `.next/`, `vendor/`
- Binary files, lock files

**Rate limits:** GitHub API allows 5,000 requests/hour per OAuth token. A typical repo scan uses ~50-200 requests. Users can scan ~25 repos per hour.

---

## Scan Results — Per-Key Actions

Each found key shows:
- Env var name, masked value, file:line
- Provider (auto-detected from prefix)
- Status: `active` / `revoked` / `unknown`
- Source: `current` (in working tree) or `git history` (deleted but in commits)

**User chooses per key:**

### Store in VaultProof
- One-click stores the key in VaultProof (Shamir split, encrypted)
- Key is now managed — available via proxy or `vaultproof exec`

### Create PR to Remove
- User chooses per key:
  - **Replace with VaultProof** — `process.env.VAR_NAME` + adds `VAR_BASE_URL` for proxy-mode keys
  - **Just remove + TODO** — `process.env.VAR_NAME` + comment `// TODO: Set this in your environment`
  - **Cancel**
- Shows exact diff before creating
- User must click "Approve & Create PR" — nothing happens without approval

### Ignore
- Marks finding as dismissed
- Won't show in future scans of the same repo (unless key changes)

---

## PR Creation

When the user approves, backend uses GitHub API to:

1. Create branch `vaultproof/scan-{timestamp}` from default branch
2. Commit changes (one commit, all approved key removals bundled)
3. Open PR with:
   - **Title:** `fix: remove exposed API keys (VaultProof Scanner)`
   - **Body:** list of removed keys, setup instructions, disclaimer

**PR body template:**

```markdown
## Removed Exposed Keys

This PR removes hardcoded API keys found by [VaultProof Scanner](https://vaultproof.dev).

| Key | File | Action |
|-----|------|--------|
| `OPENAI_API_KEY` | src/lib/ai.ts:2 | Replaced with `process.env.OPENAI_API_KEY` |
| `STRIPE_SECRET_KEY` | src/config.ts:14 | Replaced with `process.env.STRIPE_SECRET_KEY` |

## Git History Warning

The following keys were also found in git commit history. Removing them from
source code does not remove them from history. Anyone who clones this repo
can still find them.

**Action required — rotate these keys immediately:**
- `STRIPE_SECRET_KEY` (sk_live_...) — [Rotate in Stripe Dashboard](https://dashboard.stripe.com/apikeys)
- `OPENAI_API_KEY` (sk-proj-...) — [Rotate in OpenAI](https://platform.openai.com/api-keys)

## Setup

Set these environment variables in your hosting provider:
- `OPENAI_API_KEY` — your OpenAI key (or VaultProof `vp_live_` key with `OPENAI_BASE_URL`)
- `STRIPE_SECRET_KEY` — your Stripe key

---
*This PR was created by VaultProof Scanner with your approval.
VaultProof is not responsible for code modifications you approve and merge.*
```

**Revert:** Close the PR without merging, or revert the merge commit on GitHub. Standard Git workflow.

**Safety rules:**
- Never push to default branch directly
- Never force push
- Never touch protected branches
- If PR creation fails, fail gracefully — don't retry
- Branch name is always obvious: `vaultproof/scan-*`

---

## Logging

### User-facing (visible in Scanner dashboard)

- Scan date, repo name, branch scanned
- Number of keys found, by severity (active/revoked/unknown)
- Actions taken per key (stored/PR created/ignored)
- PR links (clickable)
- Scan duration

### Admin-facing (visible in admin panel)

- Everything above, plus:
- Which user scanned which repo
- GitHub usernames connected
- Scan duration, API calls consumed
- Errors, failures, rate limit hits
- PR creation success/failure

### Audit trail (stored in `scan_audit_log`)

Every action logged with timestamp:
- `connected_github` — user connected GitHub OAuth
- `disconnected_github` — user disconnected
- `started_scan` — scan initiated on repo X
- `completed_scan` — scan finished, N keys found
- `failed_scan` — scan errored, reason
- `verified_key` — called provider API, result
- `stored_key` — key saved to VaultProof vault
- `created_pr` — PR opened on repo, PR URL
- `ignored_key` — user dismissed a finding

---

## Tier Gating

| Feature | Free | Starter | Pro |
|---|---|---|---|
| Scanner page | View only | View only | Full access |
| Connect GitHub | No | No | Yes |
| Scan repos | No | No | Yes |
| Store found keys | No | No | Yes |
| Create PRs | No | No | Yes |

Free/Starter users see the Scanner page with an upgrade prompt.

---

## Database Schema

### `github_connections`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| userId | UUID | FK → User |
| githubUsername | String | GitHub login |
| accessToken | String | Encrypted (AES-256-GCM) |
| scopes | String | Comma-separated scopes granted |
| connectedAt | DateTime | |
| disconnectedAt | DateTime? | Null if still connected |

### `scan_results`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| userId | UUID | FK → User |
| repoFullName | String | e.g. "user/repo" |
| branch | String | Branch scanned |
| keysFound | Int | Total keys detected |
| keysActive | Int | Keys verified as active |
| keysRevoked | Int | Keys verified as revoked |
| status | Enum | completed / failed / in_progress |
| startedAt | DateTime | |
| completedAt | DateTime? | |
| errorMessage | String? | If failed |

### `scan_findings`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| scanId | UUID | FK → scan_results |
| envName | String | e.g. "OPENAI_API_KEY" |
| provider | String | e.g. "openai" |
| file | String | File path |
| line | Int? | Line number |
| mode | Enum | proxy / env-injection |
| verified | Enum | active / revoked / unknown |
| source | Enum | current / git-history |
| action | Enum | pending / stored / pr-created / ignored |
| prUrl | String? | GitHub PR URL if created |
| maskedValue | String | e.g. "sk-pro...01yz" |
| createdAt | DateTime | |

### `scan_audit_log`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| userId | UUID | FK → User |
| scanId | UUID? | FK → scan_results (null for connect/disconnect) |
| action | String | connected_github, started_scan, etc. |
| metadata | JSON | Additional context |
| createdAt | DateTime | |

**No raw key values are ever stored** — only masked values (`sk-pro...01yz`).

---

## Sidebar

New item after Agents, before Access Logs:

```
Dashboard
API Keys
Agents
Scanner    ← NEW
Access Logs
Settings
```

---

## API Endpoints Needed

### GitHub OAuth
- `GET /api/v1/scanner/github/connect` — redirects to GitHub OAuth
- `GET /api/v1/scanner/github/callback` — handles OAuth callback, stores token
- `DELETE /api/v1/scanner/github/disconnect` — revokes token, deletes connection

### Scanner
- `GET /api/v1/scanner/repos` — lists user's GitHub repos
- `POST /api/v1/scanner/scan` — starts a scan on a repo `{ repoFullName, branch? }`
- `GET /api/v1/scanner/scans` — lists past scans
- `GET /api/v1/scanner/scans/:scanId` — get scan results with findings
- `POST /api/v1/scanner/findings/:findingId/store` — store key in VaultProof
- `POST /api/v1/scanner/findings/:findingId/ignore` — dismiss finding
- `POST /api/v1/scanner/scans/:scanId/create-pr` — create PR for approved findings `{ findings: [{ findingId, action: "vaultproof" | "todo" }] }`

### Admin
- `GET /admin/scanner/stats` — scan counts, PR counts, connected users
- `GET /admin/scanner/audit-log` — full audit trail
