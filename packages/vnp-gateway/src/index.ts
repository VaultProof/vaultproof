import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import path from 'node:path'
import fs from 'node:fs/promises'
import { isVNPEvent, makeEventId } from '@vaultproof/vnp-sdk'
import type { VNPSummary, VNPActionRequest, VNPActionResult } from '@vaultproof/vnp-sdk'
import { NDJSONStore } from './storage.js'
import { PolicyEngine } from './policy.js'
import { LLMAnalyzer } from './llm.js'

const PORT          = parseInt(process.env['PORT']           ?? '3001', 10)
const DATA_DIR      = process.env['VNP_DATA_DIR']            ?? path.join(process.cwd(), 'data')
const ANTHROPIC_KEY = process.env['ANTHROPIC_API_KEY']       ?? ''

// Ensure data directory exists
await fs.mkdir(DATA_DIR, { recursive: true })

const store  = new NDJSONStore(DATA_DIR)
const policy = new PolicyEngine()
const llm    = new LLMAnalyzer(ANTHROPIC_KEY)

const app = new Hono()

app.get('/', c => c.json({ ok: true, service: 'vnp-gateway', v: '1.0' }))

app.post('/vnp/events', async c => {
  const body = await c.req.json()
  if (!isVNPEvent(body)) return c.json({ error: 'invalid VNP event' }, 400)

  await store.append('events', body)
  console.log(`[gateway] event: ${body.event.name} (${body.event.severity}) from ${body.source.device_id}`)

  if (body.event.severity === 'high' || body.event.severity === 'critical') {
    llm.addEvent(body)
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

app.post('/vnp/summaries', async c => {
  const body: VNPSummary = await c.req.json()
  await store.append('summaries', body)
  llm.updateSummary(body)
  return c.json({ ok: true })
})

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
