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
