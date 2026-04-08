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
