# VaultProof Growth Marketing Plan: 1000 Users in 2 Weeks

**Goal:** 1000 registered users on vaultproof.dev by 2026-04-18
**Budget:** $0 (organic only)
**Starting point:** <10 users, PH already launched, MCP server live in production
**Strategy:** MCP-first developer marketing + subversive tactics from "Just Evil Enough"

---

## Core Narrative

**One-liner:** "The first secret vault with a live MCP server — AI agents proxy API calls without ever seeing your keys."

**Key talking points:**
- AI agents need API keys to be useful, but giving them your keys is a security nightmare
- VaultProof splits your keys so no single system holds the full secret
- The MCP server lets Claude (and other agents) make API calls through a secure proxy — the agent never touches the raw key
- Free to start, works with any API that uses header-based auth

**Target audience:** AI developers building with Claude, GPT, or local LLMs who need to give agents API access safely.

---

## Subversive Tactics (from "Just Evil Enough" by Alistair Croll)

### 1. Reframing
Don't sell "secret management." Lead with the problem:
> "Every AI agent tutorial tells you to paste your API key into the prompt. That's insane."

Position env vars, .env files, pasting keys as the reckless default. VaultProof is the obvious fix.

### 2. Turning Bugs into Features
Small and new = fast and focused:
> "We're not AWS Secrets Manager. We're the 5-minute setup that actually works with AI agents."

Big players don't have MCP servers. VaultProof does.

### 3. Aggregation
Become the default result for "MCP secret management." Submit to every MCP directory, AI tool list, and "awesome-mcp" repo. Own the search results.

### 4. Bait and Switch (ethical)
Create a free "AI Agent Security Checklist" — a short guide on safely giving agents API access. VaultProof is naturally the answer to half the items. People share checklists.

### 5. Access
The MCP community is small and tight. Get into Discord servers, Slack groups, GitHub discussions. Be helpful first, become known.

### 6. Combination
Bundle VaultProof + a working demo. Ship a ready-to-use Claude Desktop MCP config:
> "Copy-paste this config. Claude can now call the OpenAI API through VaultProof without ever seeing your key. 2 minutes."

A config file > a landing page.

---

## Channel Plan

### Hacker News — The Big Swing
- **Post:** "Show HN: VaultProof — MCP server that lets AI agents proxy API calls without seeing your keys"
- **Timing:** Tuesday or Wednesday, 8-9am ET
- **Comment:** Immediately post top-level comment explaining architecture (split keys, proxy flow, MCP protocol)
- **Prep:** Landing page must clearly show MCP use case front and center

### Reddit — Multi-Subreddit Blitz
Stagger across 2 weeks, don't spam same day:

| Subreddit | Angle | Format |
|-----------|-------|--------|
| r/ClaudeAI | "I built an MCP server so Claude can use my APIs without seeing keys" | Demo + discussion |
| r/ChatGPTCoding | "How I give AI agents API access without exposing secrets" | Tutorial-style |
| r/LocalLLaMA | "Secret management for AI agents — works with any LLM" | Technical |
| r/MCP | Direct MCP server showcase | Show & tell |
| r/selfhosted | "Open proxy for API keys — AI agents never see the secret" | Architecture post |
| r/cybersecurity | "Novel approach to secret management for AI agents" | Security angle |

### Twitter/X — Daily Content
- Days 1-3: Short video/GIF of Claude using VaultProof MCP to call an API
- Days 4-7: Thread on why AI agents shouldn't hold API keys
- Days 8-14: Share engagement from HN/Reddit, respond to questions, post follow-up demos
- Tag @AnthropicAI, MCP-focused accounts

### Integration Listings (Background)
- Submit to MCP directories (mcp.so, mcphub, Smithery, etc.)
- Submit to Anthropic's community MCP server list
- Reach out to 3-5 AI newsletters (Ben's Bites, The Neuron, TLDR AI)

---

## Execution Timeline

| Day | Action | Tactic |
|-----|--------|--------|
| 1-2 | Write "AI Agent Security Checklist" blog post | Bait & Switch |
| 1-2 | Create copy-paste Claude Desktop MCP config example | Combination |
| 3 | Post checklist to r/ClaudeAI, r/ChatGPTCoding | Reframing |
| 4 | Submit to every MCP directory | Aggregation |
| 5 | Show HN post — lead with the problem, not the product | Reframing |
| 6-7 | Engage in MCP Discord/Slack communities | Access |
| 8-10 | Reddit posts in r/cybersecurity, r/selfhosted, r/LocalLLaMA | Reframing |
| 8-10 | Twitter threads + demo videos | Combination |
| 11-14 | Follow up on engagement, respond to every comment, iterate | Access |

## The "50% Disapproval" Test

Per Croll: messaging should make some people uncomfortable. "Stop pasting API keys into ChatGPT" will get pushback. That friction = engagement = visibility.

---

## Content Deliverables

1. **AI Agent Security Checklist** — blog post / PDF, 10-15 items
2. **Claude Desktop MCP config** — copy-paste JSON config + 2-minute setup guide
3. **HN Show post** — title + top-level architecture comment
4. **6 Reddit posts** — tailored per subreddit (see table above)
5. **Demo video/GIF** — Claude calling an API through VaultProof MCP
6. **Newsletter pitch** — 2-sentence cold outreach for AI newsletters

## Realistic Expectations

- HN front page: 500-2000 signups possible
- Reddit viral post: 200-1000 signups per post
- Directories + newsletters: 100-300 signups over 2 weeks
- **Best case:** 1000+ if HN or Reddit hits
- **Likely case:** 300-800 with consistent execution
- **Worst case:** 100-200 if nothing goes viral

Key insight: you only need ONE post to go viral. The blitz approach maximizes your shots on goal.
