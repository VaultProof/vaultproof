# VaultProof Migrate — Design Document

**Date:** 2026-03-30
**Status:** Approved

---

## Problem

Switching to VaultProof today requires developers to manually find every API key in their project, store each one, rewrite env files, change SDK base URLs, update CI/CD configs, and update deploy targets. For a project with dozens of keys across multiple files, this is a migration nightmare.

## Solution

A single CLI command — `vaultproof migrate` — that scans a project, finds every API key, stores them in VaultProof, and rewrites the project files. Interactive, per-key approval. Pro plan only.

---

## Command Flow

```
$ vaultproof migrate

⚠  WARNING: This command will modify files in your project.
   Back up your project or commit your changes before proceeding.
   VaultProof will also create a local backup in .vaultproof/backup/

Continue? [y/n]
> y

Checking account... Pro plan (47/100 key slots used, 53 available)

Scanning project...

Found 8 API keys across 6 files:

  .env
    OPENAI_API_KEY=sk-proj-abc...def     → proxy (recommended)
    STRIPE_SECRET_KEY=sk_live_xyz...123   → env-injection (recommended)
    SUPABASE_ANON_KEY=eyJhbG...          → env-injection (recommended)

  .env.production
    OPENAI_API_KEY=sk-proj-ghi...jkl     → proxy (recommended)

  src/lib/openai.ts:5
    hardcoded "sk-proj-mno...pqr"        → proxy (recommended)

  docker-compose.yml
    OPENAI_API_KEY (references .env)     → will update with .env

  .github/workflows/deploy.yml
    uses: OPENAI_API_KEY secret          → reminder to update GitHub secret

  vercel.json
    STRIPE_SECRET_KEY env var            → reminder to update Vercel env

Backing up 4 files to .vaultproof/backup/2026-03-30T12-00-00/
  ✓ .env
  ✓ .env.production
  ✓ src/lib/openai.ts
  ✓ vaultproof.json (new file, will be deleted on revert)

Step 1 of 8: Store OPENAI_API_KEY (sk-proj-abc...def) in VaultProof?
  Provider: openai
  Mode: proxy (change baseURL, key never leaves VaultProof)
  [y]es / [n]o / [e]nv-injection instead / [s]kip all openai keys
> y

  ✓ Stored as "openai-production" (keyId: abc123)

Step 2 of 8: Rewrite .env OPENAI_API_KEY?
  Before: OPENAI_API_KEY=sk-proj-abc...def
  After:  OPENAI_API_KEY=vp_live_your_key_here
          OPENAI_BASE_URL=https://api.vaultproof.dev/v1/openai
  [y]es / [n]o / [p]review diff
> y

...continues for each key...

Summary:
  ✓ 5 keys stored in VaultProof
  ✓ 3 files rewritten (.env, .env.production, src/lib/openai.ts)
  ⚠ 2 files need manual updates:
    • GitHub Actions: update OPENAI_API_KEY secret → set to your vp_live_ key
    • Vercel: update STRIPE_SECRET_KEY env var → will be injected by vaultproof exec

  ⚠ Remember to set VAULTPROOF_API_KEY in:
    • Your local .env (already done ✓)
    • GitHub Actions secrets
    • Vercel environment variables
    • Any other deploy targets

  To undo: vaultproof migrate --revert
  Run your app locally to test before pushing.
```

---

## Tier Gating

| Feature | Free | Starter | Pro |
|---|---|---|---|
| `vaultproof migrate` | No | No | Yes |
| Key storage limit | 3 | 10 | 100 |

The migrate command calls `GET /api/v1/sdk/limits` at runtime to check the user's current tier and remaining key slots. No limits are hardcoded in the CLI — they may change.

If the scan finds more keys than slots available:

```
Found 12 API keys, but only 3 slots available.
Choose which keys to migrate, or upgrade your plan.
```

---

## Key Detection

### Known Prefixes (high confidence — auto-classify)

| Provider | Pattern |
|---|---|
| OpenAI | `sk-proj-`, `sk-` followed by 48+ chars |
| Anthropic | `sk-ant-` |
| Stripe | `sk_live_`, `sk_test_`, `pk_live_`, `pk_test_` |
| Google/Firebase | `AIza` followed by 35 chars |
| Supabase | `eyJhbG` (JWT in `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`) |
| Together | `tog_` |
| AWS | `AKIA` followed by 16 chars |
| Twilio | `SK` followed by 32 hex chars |
| SendGrid | `SG.` followed by base64 |
| Resend | `re_` |

### Env Var Name Matching (medium confidence — ask to confirm)

Any env var with `_KEY`, `_SECRET`, `_TOKEN`, `_API_KEY` in the name that has a value longer than 16 characters.

### Files Scanned

**Always scan:**
- `.env`, `.env.*` (production, staging, local, etc.)
- Source: `*.ts`, `*.js`, `*.py`, `*.go`, `*.rb` (hardcoded strings only)
- Config: `docker-compose.yml`, `vercel.json`, `railway.json`, `fly.toml`
- CI: `.github/workflows/*.yml`, `.gitlab-ci.yml`, `.circleci/config.yml`

**Always skip:**
- `node_modules/`, `.git/`, `dist/`, `build/`, `.vaultproof/`
- Binary files
- Lock files (`package-lock.json`, `yarn.lock`, etc.)

---

## Mode Classification

Each key is classified as either **proxy** or **env-injection**:

**Proxy mode** — key never leaves VaultProof. Developer changes base URL, passes `vp_live_` key:
- OpenAI, Anthropic, Google, Together, Mistral, Cohere, Groq, Perplexity, Fireworks, DeepSeek, Replicate

**Env-injection mode** — real key injected at runtime via `vaultproof exec`. For providers whose SDKs don't support custom base URLs, use webhooks, or need the key client-side:
- Stripe, AWS, Supabase, Twilio, SendGrid, Firebase, Resend, SMTP, GitHub

The developer can override the recommendation per key during the interactive flow.

---

## File Rewriting

### Proxy mode

`.env` before:
```
OPENAI_API_KEY=sk-proj-abc123...
```

`.env` after:
```
OPENAI_API_KEY=vp_live_xyz789...
OPENAI_BASE_URL=https://api.vaultproof.dev/v1/openai
```

Most SDKs read `*_BASE_URL` env vars automatically (OpenAI reads `OPENAI_BASE_URL`, Anthropic reads `ANTHROPIC_BASE_URL`). Zero code changes in many cases.

### Env-injection mode

The real key value is removed from `.env`. A `vaultproof.json` config maps env vars to VaultProof key IDs. At runtime, `vaultproof exec -- npm start` resolves and injects the real values.

### Hardcoded keys in source code

```typescript
// Before
const client = new Stripe("sk_live_abc123...");

// After
const client = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

The key gets added to `.env` + `vaultproof.json`.

### CI/configs (no rewrite — reminders only)

For files like `.github/workflows/deploy.yml` or `vercel.json`, the scanner does not rewrite them. It prints reminders:

```
⚠ Update GitHub Actions secret OPENAI_API_KEY → set to your vp_live_ key
⚠ Update Vercel env var STRIPE_SECRET_KEY → will be injected by vaultproof exec
```

---

## vaultproof.json

Generated during migration. Maps keys to VaultProof:

```json
{
  "keys": {
    "STRIPE_SECRET_KEY": {
      "keyId": "abc123",
      "provider": "stripe",
      "mode": "env-injection"
    },
    "OPENAI_API_KEY": {
      "keyId": "def456",
      "provider": "openai",
      "mode": "proxy"
    }
  }
}
```

Used by `vaultproof exec` to resolve env-injection keys at runtime.

---

## Backup & Revert

### Before migration

1. Print warning: "Back up your project or commit your changes before proceeding."
2. Copy every file that will be modified into `.vaultproof/backup/<timestamp>/`
3. Add `.vaultproof/` to `.gitignore` (if not already there)

### Revert

```
$ vaultproof migrate --revert

Restoring from backup (2026-03-30T12-00-00)...
  ✓ .env restored
  ✓ .env.production restored
  ✓ src/lib/openai.ts restored
  ✓ vaultproof.json removed

⚠ Keys stored in VaultProof were NOT deleted.
  Run `vaultproof revoke <keyId>` to remove them if needed.
```

Keys stay in VaultProof after revert. Deleting keys is a separate explicit action.

### Multiple backups

Each migration creates a new timestamped backup. `--revert` restores from the most recent. `--revert <timestamp>` restores from a specific backup.

---

## API Endpoint Needed

`GET /api/v1/sdk/limits` — returns current tier limits dynamically:

```json
{
  "tier": "pro",
  "keySlots": { "used": 47, "limit": 100, "available": 53 },
  "features": { "migrate": true }
}
```

The CLI checks this before scanning. If `features.migrate` is `false`, print:

```
vaultproof migrate is available on the Pro plan.
Upgrade at https://vaultproof.dev/app/settings
```
