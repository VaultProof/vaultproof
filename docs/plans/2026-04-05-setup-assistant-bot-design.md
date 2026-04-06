# VaultProof Setup Assistant Bot — Design

**Date:** 2026-04-05
**Status:** Approved

## Overview

A floating chat widget on vaultproof.dev that guides new users through VaultProof setup and provides ongoing VaultProof-specific help. Powered by Minimax (LLM), with Hindsight (vectorize-io/hindsight) for persistent memory across sessions. Available to everyone — no auth required.

## Architecture

```
┌─────────────────────────────────────┐
│  vaultproof.dev (all pages)         │
│  ┌───────────────────────────────┐  │
│  │  Floating Chat Widget (JS)    │  │
│  │  Bottom-right bubble          │  │
│  └───────────┬───────────────────┘  │
└──────────────┼──────────────────────┘
               │ POST /api/v1/chat/message
               ▼
┌──────────────────────────────────────┐
│  CF Worker (packages/worker)         │
│  routes/chat.ts                      │
│  - Rate-limited (IP-based, no auth)  │
│  - Builds system prompt from docs    │
│  - Calls Minimax for response        │
│  - Calls Hindsight retain/recall     │
└──────┬────────────────┬──────────────┘
       │                │
       ▼                ▼
┌────────────┐  ┌──────────────────┐
│  Minimax   │  │  Hindsight       │
│  (LLM)     │  │  (Railway/Docker)│
│            │  │  PostgreSQL =    │
│            │  │  Supabase        │
└────────────┘  └──────────────────┘
```

## Components

### 1. Chat Widget (Frontend)

- Vanilla JS — injected into both `apps/site` (static HTML) and `apps/dashboard` (Next.js)
- Matches existing design: dark glassmorphism card, indigo accent, Inter/JetBrains Mono fonts
- Bottom-right floating bubble with expand/collapse
- Generates a random `session_id` stored in `localStorage` for memory continuity
- Streams responses for better UX

### 2. Chat API (CF Worker route)

- New `routes/chat.ts` in `packages/worker`
- `POST /api/v1/chat/message` — sends message, returns bot response
- No auth required (open to everyone), IP-based rate limiting
- System prompt loaded with VaultProof docs/setup guides as context
- Calls Minimax API for conversation, Hindsight for memory

### 3. Hindsight (Memory)

- Self-hosted on Railway via Docker
- Uses Supabase PostgreSQL as its database (no new infra)
- Configured with Minimax as its LLM provider
- `bank_id` = user's `session_id` from localStorage
- Retains: what the user has set up, what they're trying to do, what issues they hit
- Recalls: prior context at start of each conversation turn

### 4. System Prompt & Knowledge

- VaultProof-only scope — politely redirects off-topic questions
- Knowledge base: existing docs (setup guides, SDK docs, CLI docs, proxy docs)
- Persona: helpful, concise, technical but not jargon-heavy

## Data Flow (per message)

1. User types message → widget sends `POST /api/v1/chat/message` with `{ session_id, message }`
2. Worker calls Hindsight `recall(bank_id=session_id, query=message)` to get prior context
3. Worker builds prompt: system prompt + recalled memories + current message
4. Worker calls Minimax API, streams response back to widget
5. Worker calls Hindsight `retain(bank_id=session_id, content=message+response)` to save the exchange

## Rate Limiting & Abuse Prevention

- IP-based rate limit: 10 messages/minute, 50 messages/hour
- Max message length: 500 characters
- No auth required, but `session_id` is validated (UUID format)
- Hindsight memory auto-expires after 30 days of inactivity

## Widget UX

- **Collapsed state:** Small indigo bubble with chat icon, subtle pulse animation on first visit
- **Expanded state:** 380px wide x 500px tall glassmorphism card, rounded corners, blurred backdrop
- **Header:** "VaultProof Assistant" with minimize button
- **Input:** Single text field with send button, disabled while streaming
- **Messages:** Bot messages in dark card style, user messages right-aligned in indigo
- **First message:** Bot greets with "Hi! I can help you set up VaultProof. What are you working on?"
- **Persists open/closed state** in localStorage

## Estimated Costs

| Scale | Minimax (bot) | Minimax (Hindsight) | Railway | Total |
|-------|--------------|---------------------|---------|-------|
| 100 users/mo | ~$1 | ~$0.50 | $5 | ~$7 |
| 1,000 users/mo | ~$5 | ~$3 | $5 | ~$13 |
| 10,000 users/mo | ~$50 | ~$30 | $10 | ~$90 |

## Technology

- **LLM:** Minimax API (proxied through VaultProof)
- **Memory:** [Hindsight](https://github.com/vectorize-io/hindsight) (MIT license, self-hosted)
- **Database:** Supabase PostgreSQL (existing)
- **Hosting:** Cloudflare Worker (chat API), Railway (Hindsight Docker)
- **Frontend:** Vanilla JS widget (no framework dependency)
