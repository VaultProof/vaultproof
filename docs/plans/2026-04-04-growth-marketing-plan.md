# VaultProof Growth Marketing — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create all content deliverables for the 2-week growth blitz targeting 1000 registered users.

**Architecture:** 6 deliverables — blog post, MCP config guide, HN post draft, 6 Reddit posts, demo script, newsletter pitch. All content lives in `docs/marketing/` in the repo. Nelson handles posting and video recording.

**Tech Stack:** Markdown, JSON (MCP config)

---

## Task 1: Create Marketing Content Directory

**Files:**
- Create: `docs/marketing/README.md`

**Step 1: Create the directory and index**

```markdown
# VaultProof Growth Marketing Content

Content for the 2-week growth blitz (2026-04-04 to 2026-04-18).

## Deliverables
- [AI Agent Security Checklist](ai-agent-security-checklist.md)
- [MCP Quick Start Guide](mcp-quick-start.md)
- [Hacker News Post](hn-post.md)
- [Reddit Posts](reddit-posts.md)
- [Newsletter Pitch](newsletter-pitch.md)
- [Demo Script](demo-script.md)
```

**Step 2: Commit**

```bash
git add docs/marketing/README.md
git commit -m "docs: add marketing content directory"
```

---

## Task 2: Write AI Agent Security Checklist (Blog Post)

**Files:**
- Create: `docs/marketing/ai-agent-security-checklist.md`

**Context:** This is the "bait and switch" content piece. It's a genuinely useful checklist that developers will share. VaultProof is the natural answer to ~half the items, but the post isn't a sales pitch — it's a resource. Lead with the problem (Reframing tactic). Tone: direct, technical, slightly provocative. No jargon (no "Shamir", no "GF(256)").

**Step 1: Write the checklist**

The post should follow this structure:

```markdown
# Stop Pasting API Keys into ChatGPT: An AI Agent Security Checklist

You're building AI agents. They need API keys to do anything useful. But how you give
them access matters — a lot.

Most tutorials tell you to drop your key into the system prompt or an .env file and move
on. That works until it doesn't: a leaked prompt, a compromised plugin, or an agent that
logs your key to a third-party service.

Here's a checklist for doing it right.

## The Checklist

### Before You Start
- [ ] **Inventory your keys.** List every API key your agent needs. For each one: what
  does it access? What's the blast radius if it leaks?
- [ ] **Use separate keys for dev and prod.** Never give an agent your personal API key.
  Create a dedicated key with only the permissions it needs.
- [ ] **Set spend limits.** Most API providers let you cap monthly spend. Do it before
  you give the key to an agent.

### How You Store Keys
- [ ] **Never hardcode keys in source code.** This is table stakes, but still happens
  constantly. Check your git history too — a deleted key is still in your commits.
- [ ] **Don't trust .env files alone.** They're unencrypted plaintext on disk. Better
  than hardcoding, but not a security solution.
- [ ] **Use a secret manager that encrypts at rest.** Your keys should be encrypted,
  not just hidden. VaultProof splits keys using secret sharing so no single system
  holds the complete key.
- [ ] **Rotate keys on a schedule.** If a key has been active for 90+ days, rotate it.
  Automate this if possible.

### How Agents Access Keys
- [ ] **Never pass raw keys to the agent.** The agent's context window is not secure.
  Keys in prompts can leak through logs, prompt injection, or API responses.
- [ ] **Use a proxy instead.** The agent sends the request, a proxy injects the real key,
  and the agent never sees it. VaultProof's MCP server does exactly this — Claude
  calls `proxy-request` and the key is injected server-side.
- [ ] **Scope access per agent.** Each agent should only access the keys it needs.
  Don't give your coding agent access to your payment processor key.
- [ ] **Lock keys to specific domains.** If your key only needs to call api.openai.com,
  restrict it. VaultProof supports origin locking out of the box.

### Monitoring
- [ ] **Log every key usage.** Know which agent used which key, when, and for what.
- [ ] **Set up alerts for anomalies.** Unexpected spikes in API calls = potential
  compromise.
- [ ] **Have a revocation plan.** If a key leaks, can you rotate it in under 5 minutes?
  Practice this before you need it.

## The Quick Version

| Risk | Bad Practice | Better Practice |
|------|-------------|----------------|
| Key exposure | Paste in prompt | Proxy through a vault |
| Key storage | .env file | Encrypted secret manager |
| Key scope | One key for everything | Scoped keys per agent |
| Key lifetime | Never rotated | 90-day rotation |
| Monitoring | None | Log + alert on every use |

## Getting Started

The fastest way to check most of these boxes:

1. Sign up at [vaultproof.dev](https://vaultproof.dev)
2. Store your API key (it's split and encrypted automatically)
3. Add VaultProof's MCP server to Claude:
   ```json
   {
     "mcpServers": {
       "vaultproof": {
         "url": "https://mcp.vaultproof.dev/mcp"
       }
     }
   }
   ```
4. Ask Claude to make an API call — it goes through VaultProof's proxy. Claude never
   sees the key.

Free to start. Takes about 2 minutes.
```

**Step 2: Review and commit**

```bash
git add docs/marketing/ai-agent-security-checklist.md
git commit -m "docs: add AI agent security checklist blog post"
```

---

## Task 3: Write MCP Quick Start Guide

**Files:**
- Create: `docs/marketing/mcp-quick-start.md`

**Context:** This is the "Combination" tactic — bundle VaultProof + a working config people can copy-paste. This should be dead simple, 2-minute setup. Will be linked from Reddit posts and the checklist.

**Step 1: Write the guide**

```markdown
# VaultProof MCP Server — 2-Minute Setup

Give Claude secure API access without exposing your keys.

## Step 1: Sign up

Go to [vaultproof.dev](https://vaultproof.dev) and create a free account.

## Step 2: Store a key

After signing in, store an API key (e.g., your OpenAI key). VaultProof splits and
encrypts it automatically.

## Step 3: Connect to Claude

### Claude Desktop

Add this to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on Mac):

```json
{
  "mcpServers": {
    "vaultproof": {
      "url": "https://mcp.vaultproof.dev/mcp"
    }
  }
}
```

Restart Claude Desktop. You'll be prompted to authorize VaultProof on first use.

### Claude Code

Add to your Claude Code MCP settings:

```json
{
  "mcpServers": {
    "vaultproof": {
      "url": "https://mcp.vaultproof.dev/mcp"
    }
  }
}
```

## Step 4: Use it

Ask Claude to make an API call:

> "Use VaultProof to call the OpenAI API and list my models"

Claude will use the `proxy-request` tool. Your API key is injected server-side — Claude
never sees it.

## Available MCP Tools

| Tool | What it does |
|------|-------------|
| `list-keys` | See your stored keys (provider, label, status) |
| `store-key` | Store a new API key (split-key encrypted) |
| `get-usage` | Check usage stats (calls, errors, limits) |
| `proxy-request` | Make API calls through VaultProof's secure proxy |

## How it works

1. You store your API key → VaultProof splits it using secret sharing
2. Claude calls `proxy-request` with the URL and headers (no key)
3. VaultProof reassembles the key server-side, injects it, makes the call
4. Response comes back to Claude — the key never entered Claude's context

That's it. Your agent is useful. Your keys are safe.
```

**Step 2: Commit**

```bash
git add docs/marketing/mcp-quick-start.md
git commit -m "docs: add MCP quick start guide for marketing"
```

---

## Task 4: Draft Hacker News Post

**Files:**
- Create: `docs/marketing/hn-post.md`

**Context:** HN is the big swing. The post title uses the Reframing tactic — lead with the problem. The top-level comment provides technical depth (HN loves this). Keep it honest, no hype.

**Step 1: Write the HN post and comment**

```markdown
# Hacker News Post

## Title (pick one)

**Option A (recommended):** Show HN: VaultProof – MCP server that lets AI agents proxy API calls without seeing your keys

**Option B:** Show HN: I built a secret vault with an MCP server so Claude can call APIs without touching my keys

**Option C:** Show HN: VaultProof – Split-key secret manager with a live MCP server for AI agents

## URL

https://vaultproof.dev

## Top-Level Comment (post immediately after submitting)

Hey HN — I built VaultProof because I kept running into the same problem: I want AI
agents to call APIs on my behalf, but I don't want to paste my API keys into a prompt
or leave them in .env files.

**How it works:**

1. You store your API key on VaultProof. It's split using secret sharing — no single
   system holds the complete key.

2. VaultProof has a live MCP server at mcp.vaultproof.dev. You add it to Claude Desktop
   or Claude Code with a one-line config.

3. When Claude needs to call an API, it uses the `proxy-request` tool. VaultProof
   reassembles the key server-side, injects it into the request, and forwards it to the
   target API. Claude never sees the raw key.

**Stack:** Cloudflare Workers (proxy + MCP server), Supabase (auth + data), OAuth 2.1
with PKCE for the MCP connection.

**What's live today:**
- MCP server with 4 tools: store-key, list-keys, get-usage, proxy-request
- Origin/domain locking (restrict keys to specific APIs)
- Works with any API that uses header-based auth (OpenAI, Anthropic, Stripe, etc.)

Free to use. I'd love feedback on the approach — especially from anyone thinking about
how to safely give agents access to sensitive credentials.

## Timing

Post Tuesday or Wednesday, 8-9am ET (peak HN traffic).

## Rules

- Don't ask for upvotes anywhere — HN will penalize this
- Respond to every comment thoughtfully
- Be honest about limitations (e.g., KV race conditions, early stage)
- If someone asks about the "split key" approach, explain Shamir in plain terms
```

**Step 2: Commit**

```bash
git add docs/marketing/hn-post.md
git commit -m "docs: add Hacker News post draft"
```

---

## Task 5: Draft Reddit Posts

**Files:**
- Create: `docs/marketing/reddit-posts.md`

**Context:** 6 posts tailored per subreddit. Each uses the Reframing tactic — lead with the problem, not the product. Different angle per community. Tone: casual, helpful, not salesy.

**Step 1: Write all 6 posts**

```markdown
# Reddit Posts

## Post 1: r/ClaudeAI

**Title:** I built an MCP server so Claude can use my APIs without seeing my keys

**Body:**

I've been building AI agent workflows and kept hitting the same issue — Claude needs
API keys to be useful, but I don't love pasting them into prompts or .env files.

So I built VaultProof — it's a secret vault with a live MCP server. Here's how it works:

1. Store your API key on VaultProof (it's split and encrypted)
2. Add one line to your Claude config:
```json
{"mcpServers": {"vaultproof": {"url": "https://mcp.vaultproof.dev/mcp"}}}
```
3. Ask Claude to make an API call — it uses `proxy-request` and VaultProof injects the
   key server-side. Claude never sees it.

Works with Claude Desktop and Claude Code. Free to use.

Would love to hear how others are handling API key security with Claude. What's your
current setup?

---

## Post 2: r/ChatGPTCoding

**Title:** How I give AI agents API access without exposing my secrets

**Body:**

Quick writeup on a problem I kept running into with AI coding agents.

The problem: agents need API keys to call external services. Most people either paste
the key in the prompt (bad) or use .env files (slightly less bad, still plaintext on
disk).

My solution: I built a proxy that sits between the agent and the API. The agent says
"call this endpoint" and the proxy injects the real key server-side. The agent never
touches the raw secret.

It's called VaultProof and it has an MCP server, so Claude can use it natively. But
the proxy concept works with any LLM — the agent just needs to make HTTP requests
through the proxy URL instead of directly.

Setup takes about 2 minutes: https://vaultproof.dev

Curious if anyone else has thought about this. How are you handling secrets in your
agent workflows?

---

## Post 3: r/LocalLLaMA

**Title:** Secret management for AI agents — works with any LLM, not just Claude

**Body:**

Building a lot of agent workflows lately and wanted to share a tool I built for the
secret management side of things.

The core idea: your LLM agent shouldn't hold your API keys. Instead, it sends requests
through a proxy that injects the key server-side.

I built VaultProof for this. It has an MCP server (so it works natively with Claude),
but the proxy endpoint works with anything — you just need to route your HTTP calls
through it. Any framework that lets you set a base URL or custom headers can use it.

Keys are split using secret sharing before storage, so even a database breach doesn't
expose the complete key.

Free at vaultproof.dev. Curious how people in the local LLM space are handling secrets
for agent workflows — especially for self-hosted setups.

---

## Post 4: r/MCP

**Title:** VaultProof MCP Server — secure API key proxy for AI agents

**Body:**

Sharing an MCP server I built and deployed: VaultProof at mcp.vaultproof.dev

**Tools:**
- `store-key` — store API keys with split-key encryption
- `list-keys` — view stored keys
- `get-usage` — usage statistics
- `proxy-request` — proxy API calls (key injected server-side, never in agent context)

**Setup:**
```json
{"mcpServers": {"vaultproof": {"url": "https://mcp.vaultproof.dev/mcp"}}}
```

Auth is OAuth 2.1 with PKCE. Runs on Cloudflare Workers.

The main use case: give Claude (or any MCP client) the ability to call external APIs
without exposing your keys. The `proxy-request` tool handles key injection at the edge.

Free to use. Feedback welcome — especially on the tool design and auth flow.

---

## Post 5: r/selfhosted

**Title:** Open proxy for API keys — AI agents never see the secret

**Body:**

I built a secret manager designed for AI agent workflows and wanted to share the
architecture for anyone interested.

**The problem:** AI agents need API keys, but their context windows aren't secure.
Keys in prompts can leak through logs, prompt injection, or third-party plugins.

**The approach:**
1. Keys are split using secret sharing before storage (think RAID for secrets — you
   need multiple shares to reconstruct)
2. Agents make API calls through a proxy endpoint
3. The proxy reconstructs the key, injects it into the request header, and forwards
   to the target API
4. The agent only sees the API response — never the key

Built on Cloudflare Workers (proxy + MCP server) and Supabase (auth + data).

It's a hosted service at vaultproof.dev, but I'm interested in hearing from the
self-hosted community — would a self-hostable version of this be useful? What would
you want from it?

---

## Post 6: r/cybersecurity

**Title:** Novel approach to secret management for AI agent workflows

**Body:**

Security engineer here. Wanted to get this community's take on an approach I've been
working on for managing secrets in AI agent workflows.

**The threat model:** AI agents (Claude, GPT, etc.) need API keys to call external
services. Current practice is to put keys in system prompts or environment variables.
Both expose the plaintext key to the agent's context, which is vulnerable to prompt
injection, log exfiltration, and plugin/tool data leakage.

**The approach (VaultProof):**
- Keys are split using Shamir's Secret Sharing before storage
- Agents never receive the raw key
- API calls go through a proxy that reconstructs the key server-side and injects it
  into the outbound request header
- Origin locking restricts which domains a key can be used with
- OAuth 2.1 + PKCE for agent authentication
- Per-user rate limiting on proxy calls

**What I'd love feedback on:**
- Is the proxy-based approach sufficient, or are there attack vectors I'm not
  considering?
- How do you think about secret management for AI agents in enterprise environments?
- Any concerns with the Shamir approach for this use case?

Live at vaultproof.dev. The MCP server is at mcp.vaultproof.dev for anyone who wants
to test it with Claude.
```

**Note:** For r/cybersecurity, it's OK to use "Shamir's Secret Sharing" since that audience expects technical terminology.

**Step 2: Commit**

```bash
git add docs/marketing/reddit-posts.md
git commit -m "docs: add 6 Reddit post drafts"
```

---

## Task 6: Write Newsletter Pitch

**Files:**
- Create: `docs/marketing/newsletter-pitch.md`

**Step 1: Write the pitch**

```markdown
# Newsletter Pitch

Short cold outreach for AI newsletters. Personalize the opening per newsletter.

## Target Newsletters

1. **TLDR AI** — daily AI news digest
2. **Ben's Bites** — AI tools and startups
3. **The Neuron** — AI news for non-technical readers
4. **Superhuman AI** — AI tools and productivity
5. **AI Tool Report** — weekly AI tool roundups

## Pitch Template

Subject: First MCP server for secret management — VaultProof

Hi [name],

VaultProof is the first secret vault with a live MCP server. AI agents can
proxy API calls through it without ever seeing the raw key — the key is
injected server-side.

One-line config, free to use, works with Claude Desktop and Claude Code
today: vaultproof.dev

Happy to share more details or a demo if it's a fit for [newsletter name].

[Nelson]

## Shorter Version (for submission forms)

VaultProof — secret vault with a live MCP server. AI agents proxy API calls
without seeing your keys. Split-key encryption, origin locking, free to use.
vaultproof.dev
```

**Step 2: Commit**

```bash
git add docs/marketing/newsletter-pitch.md
git commit -m "docs: add newsletter pitch template"
```

---

## Task 7: Write Demo Script

**Files:**
- Create: `docs/marketing/demo-script.md`

**Context:** Nelson will record the screen. This script tells him exactly what to show and say/type. Keep it under 60 seconds for social media.

**Step 1: Write the script**

```markdown
# VaultProof MCP Demo Script (60 seconds)

## What You Need Before Recording
- Claude Desktop with VaultProof MCP server configured
- At least one API key stored in VaultProof (e.g., OpenAI)
- Screen recording tool (QuickTime, OBS, or similar)
- Record at 1080p or higher

## The Script

### Scene 1: The Problem (0-10s)

*Show a terminal or code editor with a .env file containing API keys*

**Text overlay:** "This is how most people give AI agents API access."

*Highlight the plaintext key*

**Text overlay:** "The agent sees your raw key. That's a problem."

### Scene 2: The Setup (10-25s)

*Show Claude Desktop settings → MCP config*

**Text overlay:** "VaultProof MCP server. One line to add."

*Show the config:*
```json
{"mcpServers": {"vaultproof": {"url": "https://mcp.vaultproof.dev/mcp"}}}
```

**Text overlay:** "That's it."

### Scene 3: The Demo (25-50s)

*In Claude Desktop, type:*

> "Use VaultProof to list my stored keys"

*Show Claude calling `list-keys` and returning results*

*Then type:*

> "Use VaultProof to call the OpenAI API and list my available models"

*Show Claude calling `proxy-request`, getting back the model list*

**Text overlay:** "Claude called the OpenAI API. It never saw the key."

### Scene 4: The CTA (50-60s)

**Text overlay:**
"VaultProof — API key security for AI agents"
"Free at vaultproof.dev"

## Output Formats
- Full 60s video → Twitter/X, LinkedIn
- 30s cut (Scene 2+3 only) → Reddit, short-form
- GIF of Scene 3 → HN comment, GitHub README
```

**Step 2: Commit**

```bash
git add docs/marketing/demo-script.md
git commit -m "docs: add demo recording script"
```

---

## Task 8: Update Marketing README and Final Commit

**Step 1: Verify all files exist in docs/marketing/**

```bash
ls docs/marketing/
```

Expected:
```
README.md
ai-agent-security-checklist.md
demo-script.md
hn-post.md
mcp-quick-start.md
newsletter-pitch.md
reddit-posts.md
```

**Step 2: Final commit if any updates needed**

```bash
git add docs/marketing/
git commit -m "docs: complete marketing content for growth blitz"
```
