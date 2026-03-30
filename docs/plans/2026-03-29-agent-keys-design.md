# Agent Keys Design

**Goal:** Scoped, time-limited API credentials for AI agents with spend caps and endpoint restrictions, enforced transparently at the VaultProof proxy.

**Approved:** 2026-03-29

---

## Data Model

Extend the existing `DeveloperKey` table with 4 new fields (no new table):

| Field | Type | Purpose |
|---|---|---|
| `isAgentKey` | `Boolean` | Distinguishes agent keys from regular dev keys |
| `expiresAt` | `DateTime?` | Set at creation: `now + ttl`. Null = no expiry |
| `budgetCents` | `Int?` | Spend cap in cents ($1.00 = 100). Null = no limit |
| `spentCents` | `Int` | Running total spent. Incremented after each proxy call |

Agent keys use prefix `vp_agent_*` (distinct from `vp_live_*`).

**Spend tracking:** After each proxy call, the response body is read for `usage` (OpenAI: `prompt_tokens + completion_tokens`, Anthropic: `input_tokens + output_tokens`). Static pricing table covers top ~12 models. Unknown models default to $0.001/1K tokens. `spentCents` updated in one DB write post-call. Non-LLM providers (Stripe, etc.) record $0 — call goes through, budget unaffected.

---

## Proxy Enforcement

Two checks added after `authenticateDevKey()`:

1. **TTL check** — if `expiresAt < now`, reject with `401: Agent key expired`
2. **Budget check** — if `spentCents >= budgetCents`, reject with `429: Agent budget exceeded`

After successful call: background write increments `spentCents`.

---

## API Endpoints

All under `/api/agent-keys`:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/create` | JWT or `vp_live_` | Create agent key |
| `GET` | `/list` | JWT | List all agent keys |
| `DELETE` | `/:id/revoke` | JWT | Revoke a key |

`POST /create` body:
```json
{
  "label": "eval-run-42",
  "ttlSeconds": 600,
  "budgetCents": 100,
  "allowedEndpoints": "openai/v1/chat/completions",
  "keySlotId": "abc"
}
```

---

## Dashboard UI

New "Agent Keys" tab in `app/keys.html` alongside existing "API Keys" tab.

Table columns: Label, Status (Active / Expired / Budget hit), Spent (progress bar), Expires (live countdown), Key (masked + copy), Actions (revoke).

"New Agent Key" modal fields:
- Label
- TTL: 10m / 1h / 24h / custom
- Budget: $0.25 / $1 / $5 / no limit
- Endpoint restriction (optional)
- Key slot (dropdown of user's stored keys)

---

## SDK Method

```ts
const agentKey = await vault.createAgentKey({
  label: 'eval-run-42',
  ttlSeconds: 600,
  budgetCents: 100,
  allowedEndpoints: ['openai/v1/chat/completions'],
  keySlotId: 'abc123'
});
// agentKey.key = "vp_agent_..."
// agentKey.expiresAt = Date
```

Agent uses it as a regular dev key: `Authorization: Bearer vp_agent_...`

---

## Files to Touch

- `packages/backend/prisma/schema.prisma` — add 4 fields to `DeveloperKey`
- `packages/backend/src/routes/agent-keys.ts` — new route file
- `packages/backend/src/routes/transparent-proxy.ts` — TTL + budget checks, spend tracking
- `packages/backend/src/index.ts` — register agent-keys routes
- `packages/sdk/src/index.ts` — add `createAgentKey()` method
- `apps/site/app/keys.html` — Agent Keys tab + modal
