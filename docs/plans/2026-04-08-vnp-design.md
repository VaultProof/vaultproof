# VNP (Vaultproof Network Protocol) — Design v0.1

**Date:** 2026-04-08
**Status:** Approved
**Author:** Nelson

---

## Problem

Network monitoring tools (Darktrace, Vectra, Kentik) solve LLM-over-telemetry internally, but all of them are:
- Closed, proprietary protocols — vendor lock-in
- Enterprise-priced ($50–200K/year)
- Built for human SOC dashboards, not LLM consumption

No open protocol spec exists for the telemetry-to-LLM handoff. VNP fills that gap: an open, event-driven protocol that compresses raw network logs into structured, LLM-ready events.

## Approach

Option B (code-first): build the working edge agent + gateway + LLM loop first. Extract and publish the spec once validated against real network data.

**v1 is local only** — no cloud deployment, no vendor relationships needed. Edge agent reads syslog, gateway runs as a local Node.js server.

---

## Architecture

```
syslog (UDP 514)
      │
      ▼
┌─────────────────────┐
│  VNP Edge Agent     │  packages/vnp-agent (Node.js/TS)
│  - parse syslog     │
│  - threshold detect │
│  - emit VNP events  │
└────────┬────────────┘
         │ HTTP POST (VNP JSON)
         ▼
┌─────────────────────┐
│  VNP Gateway        │  packages/vnp-gateway (Node.js/Hono, local)
│  - receive events   │
│  - store to disk    │
│  - route to LLM     │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  LLM Layer          │  Claude claude-opus-4-6
│  - reason over      │
│    events/alerts    │
│  - emit ACTION_REQ  │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  Policy Engine      │  rule check (inside gateway)
│  - approve/deny     │
│  - execute action   │
└─────────────────────┘
```

**Three new packages:**
- `packages/vnp-sdk` — shared TypeScript types (the open spec artifact)
- `packages/vnp-agent` — edge agent, runs wherever the logs are
- `packages/vnp-gateway` — local Node.js server, receives events, calls LLM

---

## Message Schema

```typescript
// packages/vnp-sdk/src/types.ts

type Severity = 'low' | 'medium' | 'high' | 'critical'

interface VNPEvent {
  v: '1.0'
  type: 'EVENT'
  id: string            // evt_{nanoid}
  ts: number            // unix epoch seconds
  source: {
    device_id: string
    ip: string
    region?: string
  }
  event: {
    category: string    // 'network.anomaly' | 'auth.failure' | 'port.scan'
    name: string        // 'traffic_spike' | 'brute_force' | 'port_scan'
    severity: Severity
  }
  metrics: Record<string, number>
  context: Record<string, unknown>
}

interface VNPSummary {
  v: '1.0'
  type: 'SUMMARY'
  ts: number
  window_sec: number
  source: { device_id: string }
  stats: Record<string, number>
}

interface VNPAlert {
  v: '1.0'
  type: 'ALERT'
  id: string
  ts: number
  severity: Severity
  message: string
  event_ref: string
}

interface VNPActionRequest {
  v: '1.0'
  type: 'ACTION_REQUEST'
  id: string
  ts: number
  action: 'block_ip' | 'alert_team' | 'throttle_ip' | 'log_only'
  target: string
  scope: 'local' | 'gateway' | 'global'
  reason: string
}

interface VNPActionResult {
  v: '1.0'
  type: 'ACTION_RESULT'
  id: string
  ts: number
  request_id: string
  status: 'approved' | 'denied' | 'error'
  execution: 'success' | 'failed' | 'skipped'
  latency_ms: number
}
```

---

## Edge Agent

**Responsibilities:** parse syslog → detect anomalies → emit VNP events via HTTP POST

**Detection rules (v1):**

| Rule | Trigger | Severity |
|---|---|---|
| `traffic_spike` | connections > 10x 60s baseline | high |
| `traffic_spike` | connections > 50x baseline | critical |
| `auth_failure_burst` | >20 failed logins in 30s from same IP | high |
| `port_scan` | >15 unique ports hit in 10s | medium |

**Config:** env vars — `GATEWAY_URL`, `DEVICE_ID`, `REGION`, `SYSLOG_PORT` (default 514)

**Deploy:** Docker container or `npm start`

**Compression:** 10,000 raw syslog lines → 1 VNP EVENT (~300 bytes). ~95–99% reduction.

---

## Gateway

**Local Node.js/Hono server.** Three routes:

- `POST /vnp/events` — receive events, store to local NDJSON file, forward high/critical to LLM queue
- `POST /vnp/summaries` — receive periodic summaries, store
- `POST /vnp/actions` — receive LLM ACTION_REQUESTs, run policy check, execute if approved

**Storage (v1):** local NDJSON files (`events.ndjson`, `summaries.ndjson`, `actions.ndjson`) — no database dependency for local dev.

**Policy engine (v1 allowlist):**
- Scope must be `local`
- Allowed actions: `alert_team`, `log_only` only
- `block_ip` and `throttle_ip` gated to v2

---

## LLM Integration

**Model:** `claude-opus-4-6` with `thinking: { type: 'adaptive' }`

**Input to LLM** (never raw logs):
```json
{
  "events": [{ "name": "traffic_spike", "severity": "high", "metrics": {...}, "ts": 1712600000 }],
  "summary": { "avg_latency_ms": 12, "packet_loss": 0.02 }
}
```

**Output:** `VNPAlert` or `VNPActionRequest` JSON only (no prose)

**Batching:** flush when 5+ events queued OR 30s elapsed since last call

**Cost estimate:** ~800 tokens in / ~200 tokens out per call → ~$2.15/day at 1 call/30s

---

## MVP Build Order

**Phase 1 — vnp-sdk:** TypeScript types for all 5 message types. npm-publishable.

**Phase 2 — vnp-agent:** syslog UDP listener + 3 detection rules + HTTP emitter + Dockerfile.

**Phase 3 — vnp-gateway:** Hono server + NDJSON storage + policy engine.

**Phase 4 — LLM layer:** Claude integration with batching, alert + ACTION_REQUEST output. End-to-end test.

---

## Explicitly Out of Scope (v1)

- ZK attestation → v2
- ed25519 message signing → v2
- NetFlow / SNMP parsers → v2
- `block_ip` / `throttle_ip` actions → v2 (safety)
- Dashboard UI → v2
- Cloud deployment (CF Workers) → v2
- Binary/protobuf format → v3
- Vendor / IETF standardization → after proven in production

---

## Competitive Position

| | VNP | Darktrace | Kentik | OTel |
|---|---|---|---|---|
| Open spec | ✅ | ❌ | ❌ | ✅ |
| LLM-native schema | ✅ | ❌ | ❌ | ❌ |
| Edge compression | ✅ | partial | ❌ | partial |
| Self-hostable | ✅ | ❌ | ❌ | ✅ |
| ZK attestation | v2 | ❌ | ❌ | ❌ |
| Price | free/OSS | $50-200K/yr | $50K+/yr | free |

**Real moat:** open spec + ZK attestation (v2) + VaultProof key security integration. No one else has all three.
