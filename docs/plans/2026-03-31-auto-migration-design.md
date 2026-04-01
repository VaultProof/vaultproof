# Auto-Migration Tool — Design Document

**Date:** 2026-03-31
**Status:** Approved
**Feature:** Guided auto-migration from raw API keys to VaultProof proxy

---

## Overview

The auto-migration tool scans a user's GitHub repo, finds all API keys and provider calls, stores the keys securely (Shamir split — same core process), and creates a PR that rewrites the code to use VaultProof's transparent proxy. The user reviews and approves every change before anything is modified.

**Goal:** Reduce migration from 16 manual steps to 3 user actions: connect repo, review changes, add one env var.

---

## Decisions

- **Location:** Extends existing scanner page (`/app/scanner`), not a new page
- **Input:** GitHub-only for now. Paste support can be added later without reworking anything.
- **Pricing:** Free — removes friction on the thing that gets users actually using the product
- **Rewriting approach:** Simple regex find-and-replace. Handles 80% of cases, flags the rest for manual review. No AST parsing.
- **User approval:** Show every change before creating the PR. User checks off each change they want.
- **Git history:** Scanner checks last 30 commits for deleted keys. Warns user but can't erase history.

---

## Section 1: User Flow

1. **Connect GitHub** (already exists)
2. **Pick a repo** (already exists)
3. **Scan completes** — shows findings grouped:
   - "Keys found: 2 in .env, 1 hardcoded in src/api.js"
   - "SDK inits found: 3 (OpenAI in 2 files, Anthropic in 1)"
   - "Raw HTTP calls: 2 (fetch to api.openai.com)"
4. **"Migrate to VaultProof" button** — new, replaces current "Create PR" flow
5. **Review changes** — shows each file with before/after diff. User checks off each change they approve. Can uncheck any they want to skip.
6. **Confirm** — VaultProof stores the found keys (Shamir split), auto-creates `vp_live_` key if user doesn't have one, creates the PR with only approved changes
7. **Env var checklist** — "Before you merge, update these in your hosting" (see Section 4)
8. **Merge** — user merges the PR
9. **Verify** — VaultProof makes a test proxy call to confirm it works

**Git history findings** show as a warning: "These keys were found in your git history — they may still be exposed even though they've been removed from current code. We recommend rotating them with your provider."

---

## Section 2: What the Scanner Detects & Rewrites

### Type 1: .env files

```
# Found in .env
OPENAI_API_KEY=sk-proj-abc123

# Rewritten to
VAULTPROOF_API_KEY=vp_live_xxx
# OPENAI_API_KEY — secured by VaultProof proxy
```

### Type 2: SDK initializations

```js
// Found
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// Rewritten to
const openai = new OpenAI({
  apiKey: process.env.VAULTPROOF_API_KEY,
  baseURL: 'https://api.vaultproof.dev/v1/openai'
})
```

Patterns detected:
- JS/TS: `new OpenAI({`, `new Anthropic({`, `new GoogleGenerativeAI(`
- Python: `OpenAI(`, `Anthropic(`, `genai.configure(`

### Type 3: Raw HTTP calls

```js
// Found
fetch('https://api.openai.com/v1/chat/completions', {
  headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }
})

// Rewritten to
fetch('https://api.vaultproof.dev/v1/openai/v1/chat/completions', {
  headers: { Authorization: `Bearer ${process.env.VAULTPROOF_API_KEY}` }
})
```

### URL replacement map

| Find | Replace with |
|---|---|
| `https://api.openai.com` | `https://api.vaultproof.dev/v1/openai` |
| `https://api.anthropic.com` | `https://api.vaultproof.dev/v1/anthropic` |
| `https://generativelanguage.googleapis.com` | `https://api.vaultproof.dev/v1/google` |
| `https://api.together.xyz` | `https://api.vaultproof.dev/v1/together` |
| `https://api.mistral.ai` | `https://api.vaultproof.dev/v1/mistral` |
| `https://api.cohere.ai` | `https://api.vaultproof.dev/v1/cohere` |
| `https://api.groq.com` | `https://api.vaultproof.dev/v1/groq` |
| `https://api.perplexity.ai` | `https://api.vaultproof.dev/v1/perplexity` |
| `https://api.fireworks.ai` | `https://api.vaultproof.dev/v1/fireworks` |
| `https://api.deepseek.com` | `https://api.vaultproof.dev/v1/deepseek` |

### Env var replacement

| Find | Replace with |
|---|---|
| `process.env.OPENAI_API_KEY` | `process.env.VAULTPROOF_API_KEY` |
| `process.env.ANTHROPIC_API_KEY` | `process.env.VAULTPROOF_API_KEY` |
| `os.environ["OPENAI_API_KEY"]` | `os.environ["VAULTPROOF_API_KEY"]` |
| `os.environ["ANTHROPIC_API_KEY"]` | `os.environ["VAULTPROOF_API_KEY"]` |

### What it flags but doesn't auto-rewrite (needs manual review):
- Dynamic URL construction: `const url = baseUrl + '/v1/chat'`
- Custom wrapper functions that hide the provider URL
- Keys in YAML/JSON config files
- Keys in Docker/K8s configs

---

## Section 3: Progress Animations

### During scan (after user picks a repo):
- Animated progress bar
- Live status text updates:
  - "Scanning .env files..."
  - "Scanning source code for API keys..."
  - "Scanning git history..."
  - "Detecting SDK initializations..."
  - "Detecting raw HTTP calls..."
- Each finding appears in real-time as it's discovered (card slides in)
- Counter updates: "Found 3 keys, 2 SDK inits, 1 raw HTTP call"

### During migration (after user approves changes):
- Step-by-step progress with checkmarks:
  - ☐ Storing API keys securely... → ✓ 3 keys stored
  - ☐ Creating developer key... → ✓ vp_live_xxx created
  - ☐ Generating code changes... → ✓ 8 files updated
  - ☐ Creating pull request... → ✓ PR #42 created
- Each step animates from loading spinner to green checkmark
- Final state: big green success with link to the PR

---

## Section 4: Env Var Checklist (Post-PR)

After the PR is created, before the user merges:

### "Update your environment variables"

VaultProof knows which keys were stored, so it generates a personalized checklist.

**Remove these** (now handled by VaultProof proxy):
- ☐ `OPENAI_API_KEY` — remove from hosting
- ☐ `ANTHROPIC_API_KEY` — remove from hosting

**Add this** (your VaultProof key):
- ☐ `VAULTPROOF_API_KEY=vp_live_xxx` — copy button

**Keep these** (not affected — VaultProof doesn't proxy these):
- `DATABASE_URL` — database connection
- `STRIPE_SECRET_KEY` — payment processor
- `NEXT_PUBLIC_SUPABASE_URL` — public config

### Platform detection

If the repo has config files, show specific instructions:

| Config file found | Instructions |
|---|---|
| `vercel.json` | "Go to Vercel → Settings → Environment Variables" |
| `railway.toml` | "Go to Railway → Variables" |
| `fly.toml` | "Go to Fly.io → Secrets" |
| `Dockerfile` | "Pass as `-e VAULTPROOF_API_KEY=vp_live_xxx` at runtime" |
| `.github/workflows/` | "Go to GitHub → Settings → Secrets and variables" |
| `render.yaml` | "Go to Render → Environment" |
| `netlify.toml` | "Go to Netlify → Site settings → Environment variables" |

User checks each one off. Once all checked:
- "Ready to merge" button enables
- Links to the PR

---

## Security Notes

- **Core process unchanged**: Shamir 2-of-2 split, proxy reconstruction, ~100ms key exposure on server only
- **Keys in transit over TLS**: Keys are read from the repo and stored via same `/sdk/store` endpoint
- **Keys already exposed**: The keys are already in plaintext in the user's repo — that's the problem we're solving
- **PR removes keys**: The PR replaces raw keys with proxy references
- **User reviews everything**: No auto-merge, no changes without explicit approval
- **GitHub token**: Encrypted at rest (AES-256-GCM), scoped to repos user selected
