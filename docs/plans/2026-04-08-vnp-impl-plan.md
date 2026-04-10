# VNP (Vaultproof Network Protocol) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a local end-to-end pipeline: syslog → VNP edge agent → local gateway → Claude LLM → policy-gated action.

**Architecture:** Three new packages in the monorepo — `vnp-sdk` (shared types), `vnp-agent` (syslog parser + anomaly detector), `vnp-gateway` (Hono local server + LLM integration). Local only — no CF Workers, no database, NDJSON file storage.

**Tech Stack:** TypeScript, Node.js ESM, `node:test` (native test runner), `node:dgram` (UDP syslog), Hono (HTTP server), `@anthropic-ai/sdk` (Claude), `nanoid` (event IDs).

---

## Task 1: vnp-sdk — Package scaffold

**Files:**
- Create: `packages/vnp-sdk/package.json`
- Create: `packages/vnp-sdk/tsconfig.json`
- Create: `packages/vnp-sdk/src/index.ts`

**Step 1: Create package.json**

```json
// packages/vnp-sdk/package.json
{
  "name": "@vaultproof/vnp-sdk",
  "version": "0.1.0",
  "description": "VNP (Vaultproof Network Protocol) — shared types and validators",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "test": "tsc && node --test dist/types.test.js"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "@types/node": "^22.0.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
// packages/vnp-sdk/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"]
}
```

**Step 3: Create empty src/index.ts**

```typescript
// packages/vnp-sdk/src/index.ts
export * from './types.js'
export * from './validators.js'
```

**Step 4: Install deps and verify scaffold builds**

```bash
cd /Users/nelson/projects/zkvault
npm install
cd packages/vnp-sdk && npm run build 2>&1 | head -5
```

Expected: build error about missing files (types.ts, validators.ts) — that's fine, scaffold is confirmed.

**Step 5: Commit**

```bash
git add packages/vnp-sdk/
git commit -m "feat(vnp-sdk): scaffold package"
```

---

## Task 2: vnp-sdk — Types

**Files:**
- Create: `packages/vnp-sdk/src/types.ts`

**Step 1: Write the types**

```typescript
// packages/vnp-sdk/src/types.ts

export type Severity = 'low' | 'medium' | 'high' | 'critical'

export interface VNPSource {
  device_id: string
  ip: string
  region?: string
}

export interface VNPEvent {
  v: '1.0'
  type: 'EVENT'
  id: string
  ts: number
  source: VNPSource
  event: {
    category: string
    name: string
    severity: Severity
  }
  metrics: Record<string, number>
  context: Record<string, unknown>
}

export interface VNPSummary {
  v: '1.0'
  type: 'SUMMARY'
  ts: number
  window_sec: number
  source: Pick<VNPSource, 'device_id'>
  stats: Record<string, number>
}

export interface VNPAlert {
  v: '1.0'
  type: 'ALERT'
  id: string
  ts: number
  severity: Severity
  message: string
  event_ref: string
}

export type ActionType = 'block_ip' | 'alert_team' | 'throttle_ip' | 'log_only'
export type ActionScope = 'local' | 'gateway' | 'global'

export interface VNPActionRequest {
  v: '1.0'
  type: 'ACTION_REQUEST'
  id: string
  ts: number
  action: ActionType
  target: string
  scope: ActionScope
  reason: string
}

export interface VNPActionResult {
  v: '1.0'
  type: 'ACTION_RESULT'
  id: string
  ts: number
  request_id: string
  status: 'approved' | 'denied' | 'error'
  execution: 'success' | 'failed' | 'skipped'
  latency_ms: number
}

export type VNPMessage =
  | VNPEvent
  | VNPSummary
  | VNPAlert
  | VNPActionRequest
  | VNPActionResult
```

**Step 2: Build to verify types compile**

```bash
cd /Users/nelson/projects/zkvault/packages/vnp-sdk
npm run build 2>&1
```

Expected: error only about missing `validators.ts` — types.ts compiles cleanly.

**Step 3: Commit**

```bash
git add packages/vnp-sdk/src/types.ts
git commit -m "feat(vnp-sdk): add VNP message type definitions"
```

---

## Task 3: vnp-sdk — Validators + tests

**Files:**
- Create: `packages/vnp-sdk/src/validators.ts`
- Create: `packages/vnp-sdk/src/types.test.ts`

**Step 1: Write the failing test first**

```typescript
// packages/vnp-sdk/src/types.test.ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isVNPEvent, isVNPActionRequest, makeEventId } from './validators.js'

describe('@vaultproof/vnp-sdk validators', () => {
  it('makeEventId returns evt_ prefixed string', () => {
    const id = makeEventId()
    assert.ok(id.startsWith('evt_'), `expected evt_ prefix, got: ${id}`)
    assert.ok(id.length > 8)
  })

  it('isVNPEvent returns true for valid event', () => {
    const event = {
      v: '1.0',
      type: 'EVENT',
      id: 'evt_abc123',
      ts: 1712600000,
      source: { device_id: 'router-1', ip: '192.168.1.1' },
      event: { category: 'network.anomaly', name: 'traffic_spike', severity: 'high' },
      metrics: { connections_per_sec: 12000 },
      context: { top_ip: '45.33.12.1' }
    }
    assert.equal(isVNPEvent(event), true)
  })

  it('isVNPEvent returns false for missing fields', () => {
    assert.equal(isVNPEvent({ type: 'EVENT' }), false)
    assert.equal(isVNPEvent(null), false)
    assert.equal(isVNPEvent({}), false)
  })

  it('isVNPActionRequest validates scope and action', () => {
    const req = {
      v: '1.0',
      type: 'ACTION_REQUEST',
      id: 'evt_xyz',
      ts: Date.now(),
      action: 'alert_team',
      target: '45.33.12.1',
      scope: 'local',
      reason: 'traffic spike detected'
    }
    assert.equal(isVNPActionRequest(req), true)
  })

  it('isVNPActionRequest rejects invalid action', () => {
    const req = {
      v: '1.0', type: 'ACTION_REQUEST', id: 'evt_xyz', ts: Date.now(),
      action: 'nuke_everything', target: '1.1.1.1', scope: 'local', reason: 'bad'
    }
    assert.equal(isVNPActionRequest(req), false)
  })
})
```

**Step 2: Run test — verify it fails**

```bash
cd /Users/nelson/projects/zkvault/packages/vnp-sdk
npm run build 2>&1 | tail -5
```

Expected: TypeScript compile error — `validators.ts` not found.

**Step 3: Write validators implementation**

```typescript
// packages/vnp-sdk/src/validators.ts
import type { VNPEvent, VNPActionRequest, ActionType, ActionScope } from './types.js'

const VALID_ACTIONS: ActionType[] = ['block_ip', 'alert_team', 'throttle_ip', 'log_only']
const VALID_SCOPES: ActionScope[] = ['local', 'gateway', 'global']
const VALID_SEVERITIES = ['low', 'medium', 'high', 'critical']

export function makeEventId(): string {
  const rand = Math.random().toString(36).slice(2, 10)
  return `evt_${rand}`
}

export function isVNPEvent(msg: unknown): msg is VNPEvent {
  if (!msg || typeof msg !== 'object') return false
  const m = msg as Record<string, unknown>
  return (
    m['v'] === '1.0' &&
    m['type'] === 'EVENT' &&
    typeof m['id'] === 'string' &&
    typeof m['ts'] === 'number' &&
    isSource(m['source']) &&
    isEventBody(m['event']) &&
    typeof m['metrics'] === 'object' &&
    typeof m['context'] === 'object'
  )
}

export function isVNPActionRequest(msg: unknown): msg is VNPActionRequest {
  if (!msg || typeof msg !== 'object') return false
  const m = msg as Record<string, unknown>
  return (
    m['v'] === '1.0' &&
    m['type'] === 'ACTION_REQUEST' &&
    typeof m['id'] === 'string' &&
    typeof m['ts'] === 'number' &&
    VALID_ACTIONS.includes(m['action'] as ActionType) &&
    typeof m['target'] === 'string' &&
    VALID_SCOPES.includes(m['scope'] as ActionScope) &&
    typeof m['reason'] === 'string'
  )
}

function isSource(s: unknown): boolean {
  if (!s || typeof s !== 'object') return false
  const src = s as Record<string, unknown>
  return typeof src['device_id'] === 'string' && typeof src['ip'] === 'string'
}

function isEventBody(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  const ev = e as Record<string, unknown>
  return (
    typeof ev['category'] === 'string' &&
    typeof ev['name'] === 'string' &&
    VALID_SEVERITIES.includes(ev['severity'] as string)
  )
}
```

**Step 4: Build and run tests**

```bash
cd /Users/nelson/projects/zkvault/packages/vnp-sdk
npm run build && node --test dist/types.test.js
```

Expected: all 5 tests pass.

**Step 5: Commit**

```bash
git add packages/vnp-sdk/src/validators.ts packages/vnp-sdk/src/types.test.ts
git commit -m "feat(vnp-sdk): add validators and type guards"
```

---

## Task 4: vnp-agent — Package scaffold

**Files:**
- Create: `packages/vnp-agent/package.json`
- Create: `packages/vnp-agent/tsconfig.json`

**Step 1: Create package.json**

```json
// packages/vnp-agent/package.json
{
  "name": "@vaultproof/vnp-agent",
  "version": "0.1.0",
  "description": "VNP edge agent — parse syslog, detect anomalies, emit VNP events",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "tsc && node --test dist/detector.test.js dist/syslog.test.js",
    "dev": "node --watch dist/index.js"
  },
  "dependencies": {
    "@vaultproof/vnp-sdk": "*"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "@types/node": "^22.0.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
// packages/vnp-agent/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"]
}
```

**Step 3: Install and verify**

```bash
cd /Users/nelson/projects/zkvault
npm install
```

Expected: workspace links `@vaultproof/vnp-sdk` correctly.

**Step 4: Commit**

```bash
git add packages/vnp-agent/
git commit -m "feat(vnp-agent): scaffold package"
```

---

## Task 5: vnp-agent — Syslog parser

**Files:**
- Create: `packages/vnp-agent/src/syslog.ts`
- Create: `packages/vnp-agent/src/syslog.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/vnp-agent/src/syslog.test.ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseSyslog } from './syslog.js'

describe('syslog parser', () => {
  it('parses a standard syslog line with IP and message', () => {
    const line = '<14>Apr  8 12:00:01 router-1 kernel: connection from 192.168.1.50 port 22'
    const result = parseSyslog(line, 'router-1')
    assert.equal(result.device_id, 'router-1')
    assert.ok(result.raw.includes('connection from'))
    assert.equal(result.src_ip, '192.168.1.50')
  })

  it('parses failed login message', () => {
    const line = '<14>Apr  8 12:00:01 router-1 sshd: Failed password for root from 10.0.0.5 port 22 ssh2'
    const result = parseSyslog(line, 'router-1')
    assert.equal(result.src_ip, '10.0.0.5')
    assert.equal(result.is_auth_failure, true)
  })

  it('extracts port number when present', () => {
    const line = '<14>Apr  8 12:00:01 host sshd: Received connection from 1.2.3.4 port 443'
    const result = parseSyslog(line, 'host')
    assert.equal(result.port, 443)
  })

  it('returns null src_ip when no IP found', () => {
    const line = '<14>Apr  8 12:00:01 host kernel: system startup complete'
    const result = parseSyslog(line, 'host')
    assert.equal(result.src_ip, null)
    assert.equal(result.is_auth_failure, false)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
cd /Users/nelson/projects/zkvault/packages/vnp-agent
npx tsc 2>&1 | head -5
```

Expected: compile error — `syslog.ts` not found.

**Step 3: Write syslog parser**

```typescript
// packages/vnp-agent/src/syslog.ts

export interface ParsedSyslog {
  device_id: string
  raw: string
  src_ip: string | null
  port: number | null
  is_auth_failure: boolean
  ts: number
}

const IP_RE = /(\d{1,3}(?:\.\d{1,3}){3})/
const PORT_RE = /port\s+(\d+)/i
const AUTH_FAIL_RE = /failed password|authentication failure|invalid user/i

export function parseSyslog(line: string, device_id: string): ParsedSyslog {
  const ipMatch = line.match(IP_RE)
  const portMatch = line.match(PORT_RE)

  return {
    device_id,
    raw: line,
    src_ip: ipMatch ? ipMatch[1] : null,
    port: portMatch ? parseInt(portMatch[1], 10) : null,
    is_auth_failure: AUTH_FAIL_RE.test(line),
    ts: Math.floor(Date.now() / 1000)
  }
}
```

**Step 4: Build and run tests**

```bash
cd /Users/nelson/projects/zkvault/packages/vnp-agent
npm run build && node --test dist/syslog.test.js
```

Expected: 4 tests pass.

**Step 5: Commit**

```bash
git add packages/vnp-agent/src/syslog.ts packages/vnp-agent/src/syslog.test.ts
git commit -m "feat(vnp-agent): add syslog parser"
```

---

## Task 6: vnp-agent — Anomaly detector

**Files:**
- Create: `packages/vnp-agent/src/detector.ts`
- Create: `packages/vnp-agent/src/detector.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/vnp-agent/src/detector.test.ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AnomalyDetector } from './detector.js'
import type { ParsedSyslog } from './syslog.js'

function makeSyslog(src_ip: string, is_auth_failure = false): ParsedSyslog {
  return { device_id: 'router-1', raw: '', src_ip, port: 22, is_auth_failure, ts: Math.floor(Date.now() / 1000) }
}

describe('AnomalyDetector', () => {
  it('emits no event below threshold', () => {
    const detector = new AnomalyDetector('router-1', '192.168.1.1')
    const events: unknown[] = []
    detector.on('event', e => events.push(e))

    // 5 connections — well below 10x baseline (baseline starts at 10)
    for (let i = 0; i < 5; i++) detector.ingest(makeSyslog('10.0.0.1'))
    assert.equal(events.length, 0)
  })

  it('emits traffic_spike when connections exceed 10x baseline', () => {
    const detector = new AnomalyDetector('router-1', '192.168.1.1')
    const events: unknown[] = []
    detector.on('event', e => events.push(e))

    // Establish baseline: 10 connections
    for (let i = 0; i < 10; i++) detector.ingest(makeSyslog('10.0.0.1'))
    detector.flushWindow() // force baseline snapshot

    // Now spike: 200 connections in new window (20x baseline)
    for (let i = 0; i < 200; i++) detector.ingest(makeSyslog('45.33.12.1'))
    detector.checkThresholds()

    assert.equal(events.length, 1)
    const ev = events[0] as { event: { name: string; severity: string } }
    assert.equal(ev.event.name, 'traffic_spike')
    assert.equal(ev.event.severity, 'high')
  })

  it('emits auth_failure_burst after 20 failures from same IP in window', () => {
    const detector = new AnomalyDetector('router-1', '192.168.1.1')
    const events: unknown[] = []
    detector.on('event', e => events.push(e))

    for (let i = 0; i < 21; i++) detector.ingest(makeSyslog('10.0.0.5', true))
    detector.checkThresholds()

    const burst = (events as Array<{ event: { name: string } }>).find(e => e.event.name === 'auth_failure_burst')
    assert.ok(burst, 'expected auth_failure_burst event')
  })

  it('emits port_scan after 15 unique ports from same IP', () => {
    const detector = new AnomalyDetector('router-1', '192.168.1.1')
    const events: unknown[] = []
    detector.on('event', e => events.push(e))

    for (let port = 1; port <= 16; port++) {
      detector.ingest({ device_id: 'router-1', raw: '', src_ip: '10.0.0.9', port, is_auth_failure: false, ts: Date.now() })
    }
    detector.checkThresholds()

    const scan = (events as Array<{ event: { name: string } }>).find(e => e.event.name === 'port_scan')
    assert.ok(scan, 'expected port_scan event')
  })
})
```

**Step 2: Run test to verify it fails**

```bash
cd /Users/nelson/projects/zkvault/packages/vnp-agent
npx tsc 2>&1 | head -5
```

Expected: compile error — `detector.ts` not found.

**Step 3: Write the detector**

```typescript
// packages/vnp-agent/src/detector.ts
import { EventEmitter } from 'node:events'
import { makeEventId } from '@vaultproof/vnp-sdk'
import type { VNPEvent } from '@vaultproof/vnp-sdk'
import type { ParsedSyslog } from './syslog.js'

export class AnomalyDetector extends EventEmitter {
  private deviceId: string
  private deviceIp: string

  // Sliding window: connection counts per window
  private windowCounts: number[] = []
  private currentWindowCount = 0
  private baseline = 10 // default baseline connections/window

  // Auth failure tracking: ip -> count
  private authFailures = new Map<string, number>()

  // Port scan tracking: ip -> Set<port>
  private portsByIp = new Map<string, Set<number>>()

  constructor(deviceId: string, deviceIp: string) {
    super()
    this.deviceId = deviceId
    this.deviceIp = deviceIp
  }

  ingest(entry: ParsedSyslog): void {
    this.currentWindowCount++

    if (entry.is_auth_failure && entry.src_ip) {
      const count = (this.authFailures.get(entry.src_ip) ?? 0) + 1
      this.authFailures.set(entry.src_ip, count)
    }

    if (entry.src_ip && entry.port) {
      const ports = this.portsByIp.get(entry.src_ip) ?? new Set()
      ports.add(entry.port)
      this.portsByIp.set(entry.src_ip, ports)
    }
  }

  flushWindow(): void {
    if (this.currentWindowCount > 0) {
      this.windowCounts.push(this.currentWindowCount)
      if (this.windowCounts.length > 5) this.windowCounts.shift()
      this.baseline = Math.floor(this.windowCounts.reduce((a, b) => a + b, 0) / this.windowCounts.length)
    }
    this.currentWindowCount = 0
    this.authFailures.clear()
    this.portsByIp.clear()
  }

  checkThresholds(): void {
    // Traffic spike
    if (this.currentWindowCount > this.baseline * 10) {
      const severity = this.currentWindowCount > this.baseline * 50 ? 'critical' : 'high'
      this.emitEvent('network.anomaly', 'traffic_spike', severity, {
        connections_per_sec: this.currentWindowCount,
        baseline: this.baseline
      }, {})
    }

    // Auth failure burst
    for (const [ip, count] of this.authFailures) {
      if (count > 20) {
        this.emitEvent('auth.failure', 'auth_failure_burst', 'high',
          { failure_count: count }, { src_ip: ip })
      }
    }

    // Port scan
    for (const [ip, ports] of this.portsByIp) {
      if (ports.size > 15) {
        this.emitEvent('network.scan', 'port_scan', 'medium',
          { unique_ports: ports.size }, { src_ip: ip, ports: [...ports].slice(0, 10) })
      }
    }
  }

  private emitEvent(
    category: string,
    name: string,
    severity: VNPEvent['event']['severity'],
    metrics: Record<string, number>,
    context: Record<string, unknown>
  ): void {
    const event: VNPEvent = {
      v: '1.0',
      type: 'EVENT',
      id: makeEventId(),
      ts: Math.floor(Date.now() / 1000),
      source: { device_id: this.deviceId, ip: this.deviceIp },
      event: { category, name, severity },
      metrics,
      context
    }
    this.emit('event', event)
  }
}
```

**Step 4: Build and run tests**

```bash
cd /Users/nelson/projects/zkvault/packages/vnp-agent
npm run build && node --test dist/detector.test.js
```

Expected: 4 tests pass.

**Step 5: Commit**

```bash
git add packages/vnp-agent/src/detector.ts packages/vnp-agent/src/detector.test.ts
git commit -m "feat(vnp-agent): add anomaly detector with traffic spike, auth burst, port scan rules"
```

---

## Task 7: vnp-agent — Emitter + main entry point

**Files:**
- Create: `packages/vnp-agent/src/emitter.ts`
- Create: `packages/vnp-agent/src/index.ts`

**Step 1: Write emitter**

```typescript
// packages/vnp-agent/src/emitter.ts
import type { VNPEvent, VNPSummary } from '@vaultproof/vnp-sdk'

export class VNPEmitter {
  constructor(private gatewayUrl: string) {}

  async sendEvent(event: VNPEvent): Promise<void> {
    await this.post('/vnp/events', event)
  }

  async sendSummary(summary: VNPSummary): Promise<void> {
    await this.post('/vnp/summaries', summary)
  }

  private async post(path: string, body: unknown): Promise<void> {
    const res = await fetch(`${this.gatewayUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!res.ok) {
      console.error(`[vnp-agent] gateway ${path} returned ${res.status}`)
    }
  }
}
```

**Step 2: Write main index**

```typescript
// packages/vnp-agent/src/index.ts
import dgram from 'node:dgram'
import { AnomalyDetector } from './detector.js'
import { parseSyslog } from './syslog.js'
import { VNPEmitter } from './emitter.js'
import type { VNPSummary } from '@vaultproof/vnp-sdk'

const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:3001'
const DEVICE_ID   = process.env['DEVICE_ID']   ?? 'agent-1'
const DEVICE_IP   = process.env['DEVICE_IP']   ?? '127.0.0.1'
const SYSLOG_PORT = parseInt(process.env['SYSLOG_PORT'] ?? '5140', 10)
// Note: 5140 for local dev (not 514 which requires root). Use 514 in production.

const emitter  = new VNPEmitter(GATEWAY_URL)
const detector = new AnomalyDetector(DEVICE_ID, DEVICE_IP)

// Forward detected events to gateway
detector.on('event', async (event) => {
  console.log(`[vnp-agent] event: ${event.event.name} (${event.event.severity})`)
  await emitter.sendEvent(event)
})

// Check thresholds every 10s, flush window every 60s
setInterval(() => detector.checkThresholds(), 10_000)
setInterval(() => {
  detector.flushWindow()
  const summary: VNPSummary = {
    v: '1.0',
    type: 'SUMMARY',
    ts: Math.floor(Date.now() / 1000),
    window_sec: 60,
    source: { device_id: DEVICE_ID },
    stats: {} // extended in future with real metrics
  }
  emitter.sendSummary(summary).catch(console.error)
}, 60_000)

// Listen for syslog on UDP
const socket = dgram.createSocket('udp4')
socket.on('message', (msg) => {
  const line = msg.toString().trim()
  const parsed = parseSyslog(line, DEVICE_ID)
  detector.ingest(parsed)
})

socket.bind(SYSLOG_PORT, () => {
  console.log(`[vnp-agent] listening for syslog on UDP :${SYSLOG_PORT}`)
  console.log(`[vnp-agent] gateway: ${GATEWAY_URL}`)
  console.log(`[vnp-agent] device: ${DEVICE_ID} (${DEVICE_IP})`)
})
```

**Step 3: Build**

```bash
cd /Users/nelson/projects/zkvault/packages/vnp-agent
npm run build 2>&1
```

Expected: clean build, no errors.

**Step 4: Commit**

```bash
git add packages/vnp-agent/src/emitter.ts packages/vnp-agent/src/index.ts
git commit -m "feat(vnp-agent): add emitter and main entry point"
```

---

## Task 8: vnp-gateway — Package scaffold + Hono server

**Files:**
- Create: `packages/vnp-gateway/package.json`
- Create: `packages/vnp-gateway/tsconfig.json`
- Create: `packages/vnp-gateway/src/index.ts`

**Step 1: Create package.json**

```json
// packages/vnp-gateway/package.json
{
  "name": "@vaultproof/vnp-gateway",
  "version": "0.1.0",
  "description": "VNP gateway — receive events, route to LLM, enforce policy",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "tsc && node --test dist/policy.test.js dist/storage.test.js",
    "dev": "node --watch dist/index.js"
  },
  "dependencies": {
    "@vaultproof/vnp-sdk": "*",
    "@anthropic-ai/sdk": "^0.54.0",
    "hono": "^4.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "@types/node": "^22.0.0"
  }
}
```

**Step 2: Create tsconfig.json**

Same as vnp-agent:

```json
// packages/vnp-gateway/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"]
}
```

**Step 3: Install deps**

```bash
cd /Users/nelson/projects/zkvault
npm install
```

**Step 4: Commit scaffold**

```bash
git add packages/vnp-gateway/
git commit -m "feat(vnp-gateway): scaffold package"
```

---

## Task 9: vnp-gateway — Storage

**Files:**
- Create: `packages/vnp-gateway/src/storage.ts`
- Create: `packages/vnp-gateway/src/storage.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/vnp-gateway/src/storage.test.ts
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { NDJSONStore } from './storage.js'

describe('NDJSONStore', () => {
  let dir: string
  let store: NDJSONStore

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vnp-test-'))
    store = new NDJSONStore(dir)
  })

  after(async () => {
    await fs.rm(dir, { recursive: true })
  })

  it('appends and reads back an event', async () => {
    const event = { v: '1.0', type: 'EVENT', id: 'evt_abc', ts: 1000 }
    await store.append('events', event)
    const lines = await store.readAll('events')
    assert.equal(lines.length, 1)
    assert.deepEqual(lines[0], event)
  })

  it('appends multiple records', async () => {
    const store2 = new NDJSONStore(dir)
    await store2.append('multi', { a: 1 })
    await store2.append('multi', { a: 2 })
    await store2.append('multi', { a: 3 })
    const lines = await store2.readAll('multi')
    assert.equal(lines.length, 3)
  })
})
```

**Step 2: Run to verify fail**

```bash
cd /Users/nelson/projects/zkvault/packages/vnp-gateway
npx tsc 2>&1 | head -5
```

Expected: compile error — `storage.ts` not found.

**Step 3: Write storage**

```typescript
// packages/vnp-gateway/src/storage.ts
import fs from 'node:fs/promises'
import path from 'node:path'

export class NDJSONStore {
  constructor(private dir: string) {}

  async append(collection: string, record: unknown): Promise<void> {
    const file = path.join(this.dir, `${collection}.ndjson`)
    await fs.appendFile(file, JSON.stringify(record) + '\n', 'utf8')
  }

  async readAll(collection: string): Promise<unknown[]> {
    const file = path.join(this.dir, `${collection}.ndjson`)
    try {
      const content = await fs.readFile(file, 'utf8')
      return content.trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
    } catch {
      return []
    }
  }
}
```

**Step 4: Build and run tests**

```bash
cd /Users/nelson/projects/zkvault/packages/vnp-gateway
npm run build && node --test dist/storage.test.js
```

Expected: 2 tests pass.

**Step 5: Commit**

```bash
git add packages/vnp-gateway/src/storage.ts packages/vnp-gateway/src/storage.test.ts
git commit -m "feat(vnp-gateway): add NDJSON file storage"
```

---

## Task 10: vnp-gateway — Policy engine

**Files:**
- Create: `packages/vnp-gateway/src/policy.ts`
- Create: `packages/vnp-gateway/src/policy.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/vnp-gateway/src/policy.test.ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PolicyEngine } from './policy.js'
import type { VNPActionRequest, VNPActionResult } from '@vaultproof/vnp-sdk'

function makeReq(action: string, scope: string): VNPActionRequest {
  return {
    v: '1.0', type: 'ACTION_REQUEST',
    id: 'evt_test', ts: Date.now(),
    action: action as VNPActionRequest['action'],
    target: '10.0.0.1',
    scope: scope as VNPActionRequest['scope'],
    reason: 'test'
  }
}

describe('PolicyEngine', () => {
  const policy = new PolicyEngine()

  it('approves alert_team with local scope', async () => {
    const result = await policy.evaluate(makeReq('alert_team', 'local'))
    assert.equal(result.status, 'approved')
  })

  it('approves log_only with local scope', async () => {
    const result = await policy.evaluate(makeReq('log_only', 'local'))
    assert.equal(result.status, 'approved')
  })

  it('denies block_ip in v1', async () => {
    const result = await policy.evaluate(makeReq('block_ip', 'local'))
    assert.equal(result.status, 'denied')
  })

  it('denies any action with global scope', async () => {
    const result = await policy.evaluate(makeReq('alert_team', 'global'))
    assert.equal(result.status, 'denied')
  })

  it('denies any action with gateway scope', async () => {
    const result = await policy.evaluate(makeReq('log_only', 'gateway'))
    assert.equal(result.status, 'denied')
  })
})
```

**Step 2: Run to verify fail**

```bash
npx tsc 2>&1 | head -5
```

Expected: compile error — `policy.ts` not found.

**Step 3: Write policy engine**

```typescript
// packages/vnp-gateway/src/policy.ts
import type { VNPActionRequest, VNPActionResult } from '@vaultproof/vnp-sdk'

// v1 allowlist: only safe, local, non-destructive actions
const ALLOWED_ACTIONS = new Set(['alert_team', 'log_only'])
const ALLOWED_SCOPES  = new Set(['local'])

export class PolicyEngine {
  async evaluate(req: VNPActionRequest): Promise<Pick<VNPActionResult, 'status' | 'execution'>> {
    const start = Date.now()

    if (!ALLOWED_SCOPES.has(req.scope)) {
      return { status: 'denied', execution: 'skipped' }
    }

    if (!ALLOWED_ACTIONS.has(req.action)) {
      return { status: 'denied', execution: 'skipped' }
    }

    // Execute approved action
    await this.execute(req)
    return { status: 'approved', execution: 'success' }
  }

  private async execute(req: VNPActionRequest): Promise<void> {
    switch (req.action) {
      case 'alert_team':
        console.log(`[policy] ALERT: ${req.reason} — target: ${req.target}`)
        break
      case 'log_only':
        console.log(`[policy] LOG: ${req.reason} — target: ${req.target}`)
        break
    }
  }
}
```

**Step 4: Build and run tests**

```bash
cd /Users/nelson/projects/zkvault/packages/vnp-gateway
npm run build && node --test dist/policy.test.js
```

Expected: 5 tests pass.

**Step 5: Commit**

```bash
git add packages/vnp-gateway/src/policy.ts packages/vnp-gateway/src/policy.test.ts
git commit -m "feat(vnp-gateway): add policy engine with v1 action allowlist"
```

---

## Task 11: vnp-gateway — LLM integration

**Files:**
- Create: `packages/vnp-gateway/src/llm.ts`

**Step 1: Write LLM module**

```typescript
// packages/vnp-gateway/src/llm.ts
import Anthropic from '@anthropic-ai/sdk'
import type { VNPEvent, VNPSummary, VNPAlert, VNPActionRequest } from '@vaultproof/vnp-sdk'
import { makeEventId, isVNPActionRequest } from '@vaultproof/vnp-sdk'

const SYSTEM = `You are a network security analyst. You receive structured network events in JSON.
Your job: decide if action is needed.

Respond with EXACTLY ONE of:
1. A VNPAlert JSON object if the events indicate a threat worth logging
2. A VNPActionRequest JSON object if an automated response is warranted
3. The string "null" if the events are noise and no action is needed

VNPAlert shape: { "v":"1.0","type":"ALERT","id":"evt_xxx","ts":0,"severity":"low|medium|high|critical","message":"...","event_ref":"evt_xxx" }
VNPActionRequest shape: { "v":"1.0","type":"ACTION_REQUEST","id":"evt_xxx","ts":0,"action":"alert_team|log_only","target":"...","scope":"local","reason":"..." }

Rules:
- scope MUST always be "local"
- action MUST be "alert_team" or "log_only" only
- Respond with raw JSON only. No prose, no markdown, no code fences.`

export class LLMAnalyzer {
  private client: Anthropic
  private queue: VNPEvent[] = []
  private lastFlush = Date.now()
  private latestSummary: VNPSummary | null = null

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey })
  }

  addEvent(event: VNPEvent): void {
    this.queue.push(event)
    const shouldFlush = this.queue.length >= 5 || Date.now() - this.lastFlush > 30_000
    if (shouldFlush) this.flush().catch(console.error)
  }

  updateSummary(summary: VNPSummary): void {
    this.latestSummary = summary
  }

  async flush(): Promise<VNPAlert | VNPActionRequest | null> {
    if (this.queue.length === 0) return null
    const events = this.queue.splice(0)
    this.lastFlush = Date.now()

    const input = {
      events: events.map(e => ({
        id: e.id,
        name: e.event.name,
        severity: e.event.severity,
        metrics: e.metrics,
        context: e.context,
        ts: e.ts
      })),
      summary: this.latestSummary?.stats ?? null
    }

    try {
      const stream = this.client.messages.stream({
        model: 'claude-opus-4-6',
        max_tokens: 512,
        thinking: { type: 'adaptive' },
        system: SYSTEM,
        messages: [{ role: 'user', content: JSON.stringify(input) }]
      })

      const response = await stream.finalMessage()
      const text = response.content.find(b => b.type === 'text')?.text?.trim()
      if (!text || text === 'null') return null

      const parsed = JSON.parse(text)

      if (parsed.type === 'ALERT') {
        return { ...parsed, id: makeEventId(), ts: Math.floor(Date.now() / 1000) } as VNPAlert
      }
      if (isVNPActionRequest(parsed)) {
        return { ...parsed, id: makeEventId(), ts: Math.floor(Date.now() / 1000) }
      }

      return null
    } catch (err) {
      console.error('[llm] analysis failed:', err)
      return null
    }
  }
}
```

**Step 2: Build**

```bash
cd /Users/nelson/projects/zkvault/packages/vnp-gateway
npm run build 2>&1
```

Expected: clean build.

**Step 3: Commit**

```bash
git add packages/vnp-gateway/src/llm.ts
git commit -m "feat(vnp-gateway): add Claude LLM analyzer with event batching"
```

---

## Task 12: vnp-gateway — Hono server (wires everything together)

**Files:**
- Create: `packages/vnp-gateway/src/index.ts`

**Step 1: Write the server**

```typescript
// packages/vnp-gateway/src/index.ts
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import path from 'node:path'
import { isVNPEvent } from '@vaultproof/vnp-sdk'
import type { VNPSummary, VNPActionRequest, VNPActionResult } from '@vaultproof/vnp-sdk'
import { NDJSONStore } from './storage.js'
import { PolicyEngine } from './policy.js'
import { LLMAnalyzer } from './llm.js'
import { makeEventId } from '@vaultproof/vnp-sdk'

const PORT        = parseInt(process.env['PORT']           ?? '3001', 10)
const DATA_DIR    = process.env['VNP_DATA_DIR']            ?? path.join(process.cwd(), 'data')
const ANTHROPIC_KEY = process.env['ANTHROPIC_API_KEY']     ?? ''

const store   = new NDJSONStore(DATA_DIR)
const policy  = new PolicyEngine()
const llm     = new LLMAnalyzer(ANTHROPIC_KEY)

const app = new Hono()

// Health check
app.get('/', c => c.json({ ok: true, service: 'vnp-gateway', v: '1.0' }))

// Receive events from edge agents
app.post('/vnp/events', async c => {
  const body = await c.req.json()
  if (!isVNPEvent(body)) return c.json({ error: 'invalid VNP event' }, 400)

  await store.append('events', body)
  console.log(`[gateway] event: ${body.event.name} (${body.event.severity}) from ${body.source.device_id}`)

  if (body.event.severity === 'high' || body.event.severity === 'critical') {
    llm.addEvent(body)

    // Check if LLM has a pending response to process
    const result = await llm.flush()
    if (result) {
      await store.append(result.type === 'ALERT' ? 'alerts' : 'actions', result)
      console.log(`[gateway] LLM response: ${result.type}`)

      if (result.type === 'ACTION_REQUEST') {
        const policyResult = await policy.evaluate(result)
        const actionResult: VNPActionResult = {
          v: '1.0',
          type: 'ACTION_RESULT',
          id: makeEventId(),
          ts: Math.floor(Date.now() / 1000),
          request_id: result.id,
          status: policyResult.status,
          execution: policyResult.execution,
          latency_ms: 0
        }
        await store.append('action_results', actionResult)
      }
    }
  }

  return c.json({ ok: true })
})

// Receive summaries
app.post('/vnp/summaries', async c => {
  const body: VNPSummary = await c.req.json()
  await store.append('summaries', body)
  llm.updateSummary(body)
  return c.json({ ok: true })
})

// Manual action request endpoint (for testing)
app.post('/vnp/actions', async c => {
  const req: VNPActionRequest = await c.req.json()
  const start = Date.now()
  const result = await policy.evaluate(req)
  const actionResult: VNPActionResult = {
    v: '1.0', type: 'ACTION_RESULT',
    id: makeEventId(),
    ts: Math.floor(Date.now() / 1000),
    request_id: req.id,
    status: result.status,
    execution: result.execution,
    latency_ms: Date.now() - start
  }
  await store.append('action_results', actionResult)
  return c.json(actionResult)
})

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`[vnp-gateway] running on http://localhost:${PORT}`)
  console.log(`[vnp-gateway] data dir: ${DATA_DIR}`)
  console.log(`[vnp-gateway] LLM: ${ANTHROPIC_KEY ? 'enabled' : 'DISABLED (no API key)'}`)
})
```

**Step 2: Install `@hono/node-server`**

```bash
cd /Users/nelson/projects/zkvault/packages/vnp-gateway
npm install @hono/node-server
```

**Step 3: Build**

```bash
npm run build 2>&1
```

Expected: clean build.

**Step 4: Smoke test — start the gateway**

```bash
ANTHROPIC_API_KEY=your_key node dist/index.js
# In another terminal:
curl http://localhost:3001/
```

Expected: `{"ok":true,"service":"vnp-gateway","v":"1.0"}`

**Step 5: Commit**

```bash
git add packages/vnp-gateway/src/index.ts packages/vnp-gateway/package.json
git commit -m "feat(vnp-gateway): add Hono server wiring events, storage, policy, and LLM"
```

---

## Task 13: End-to-end test script

**Files:**
- Create: `packages/vnp-gateway/src/e2e-test.ts`

This script simulates what the edge agent sends — run it while the gateway is running to verify the full loop.

**Step 1: Write the test script**

```typescript
// packages/vnp-gateway/src/e2e-test.ts
// Run: node dist/e2e-test.js
// Requires: gateway running on localhost:3001

const GW = 'http://localhost:3001'

async function post(path: string, body: unknown) {
  const res = await fetch(`${GW}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const data = await res.json()
  console.log(`POST ${path} → ${res.status}`, JSON.stringify(data))
  return data
}

// 1. Send a high-severity traffic spike event
await post('/vnp/events', {
  v: '1.0', type: 'EVENT',
  id: 'evt_test1',
  ts: Math.floor(Date.now() / 1000),
  source: { device_id: 'router-1', ip: '192.168.1.1', region: 'us-west' },
  event: { category: 'network.anomaly', name: 'traffic_spike', severity: 'high' },
  metrics: { connections_per_sec: 12000, baseline: 200 },
  context: { top_ip: '45.33.12.1', port: 443 }
})

// 2. Send a summary
await post('/vnp/summaries', {
  v: '1.0', type: 'SUMMARY',
  ts: Math.floor(Date.now() / 1000),
  window_sec: 60,
  source: { device_id: 'router-1' },
  stats: { avg_latency_ms: 12, packet_loss: 0.02, throughput_mb: 120 }
})

// 3. Test policy engine directly
await post('/vnp/actions', {
  v: '1.0', type: 'ACTION_REQUEST',
  id: 'evt_test2',
  ts: Math.floor(Date.now() / 1000),
  action: 'alert_team',
  target: '45.33.12.1',
  scope: 'local',
  reason: 'Simulated DDoS test'
})

// 4. Verify block_ip is denied
await post('/vnp/actions', {
  v: '1.0', type: 'ACTION_REQUEST',
  id: 'evt_test3',
  ts: Math.floor(Date.now() / 1000),
  action: 'block_ip',
  target: '45.33.12.1',
  scope: 'local',
  reason: 'Should be denied in v1'
})

console.log('\n✓ E2E test complete. Check gateway logs and data/ directory.')
```

**Step 2: Build and run (gateway must be running)**

Terminal 1:
```bash
cd /Users/nelson/projects/zkvault/packages/vnp-gateway
ANTHROPIC_API_KEY=your_key VNP_DATA_DIR=./data node dist/index.js
```

Terminal 2:
```bash
node dist/e2e-test.js
```

Expected output:
```
POST /vnp/events → 200 {"ok":true}
POST /vnp/summaries → 200 {"ok":true}
POST /vnp/actions → 200 {"status":"approved","execution":"success",...}
POST /vnp/actions → 200 {"status":"denied","execution":"skipped",...}
✓ E2E test complete.
```

**Step 3: Commit**

```bash
git add packages/vnp-gateway/src/e2e-test.ts
git commit -m "test(vnp-gateway): add end-to-end test script"
```

---

## Task 14: Dockerfile for edge agent

**Files:**
- Create: `packages/vnp-agent/Dockerfile`
- Create: `packages/vnp-agent/.env.example`

**Step 1: Write Dockerfile**

```dockerfile
# packages/vnp-agent/Dockerfile
FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY ../../package-lock.json ./
RUN npm install --omit=dev

COPY dist/ ./dist/

ENV GATEWAY_URL=http://localhost:3001
ENV DEVICE_ID=agent-1
ENV DEVICE_IP=127.0.0.1
ENV SYSLOG_PORT=5140

EXPOSE 5140/udp

CMD ["node", "dist/index.js"]
```

**Step 2: Write .env.example**

```bash
# packages/vnp-agent/.env.example
GATEWAY_URL=http://localhost:3001
DEVICE_ID=my-router
DEVICE_IP=192.168.1.1
SYSLOG_PORT=5140
```

**Step 3: Commit**

```bash
git add packages/vnp-agent/Dockerfile packages/vnp-agent/.env.example
git commit -m "feat(vnp-agent): add Dockerfile and env example"
```

---

## Task 15: Final wiring check + README

**Files:**
- Create: `packages/vnp-gateway/.env.example`
- Modify: `packages/vnp-sdk/package.json` — add to turbo build pipeline

**Step 1: Gateway env example**

```bash
# packages/vnp-gateway/.env.example
PORT=3001
VNP_DATA_DIR=./data
ANTHROPIC_API_KEY=sk-ant-...
```

**Step 2: Full build check from monorepo root**

```bash
cd /Users/nelson/projects/zkvault
npm run build 2>&1 | tail -20
```

Expected: `vnp-sdk`, `vnp-agent`, `vnp-gateway` all build successfully.

**Step 3: Run all package tests**

```bash
cd packages/vnp-sdk && npm test
cd ../vnp-agent && npm test
cd ../vnp-gateway && npm test
```

Expected: all tests pass.

**Step 4: Final commit**

```bash
git add packages/vnp-gateway/.env.example
git commit -m "feat(vnp): complete v1 local implementation — sdk, agent, gateway, LLM loop"
```

---

## Summary

| Package | What it does | Key files |
|---|---|---|
| `vnp-sdk` | Shared types + validators (the open spec) | `types.ts`, `validators.ts` |
| `vnp-agent` | Reads syslog UDP, detects anomalies, emits events | `syslog.ts`, `detector.ts`, `emitter.ts` |
| `vnp-gateway` | Receives events, stores to NDJSON, routes to Claude, enforces policy | `storage.ts`, `policy.ts`, `llm.ts`, `index.ts` |

**To run the full stack locally:**

```bash
# Terminal 1 — gateway
cd packages/vnp-gateway
ANTHROPIC_API_KEY=your_key VNP_DATA_DIR=./data node dist/index.js

# Terminal 2 — agent (fires at local gateway)
cd packages/vnp-agent
GATEWAY_URL=http://localhost:3001 DEVICE_ID=test-router node dist/index.js

# Terminal 3 — send test syslog (simulates a router)
echo "Failed password for root from 10.0.0.5 port 22 ssh2" | nc -u 127.0.0.1 5140
```
