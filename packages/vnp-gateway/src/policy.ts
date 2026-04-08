import type { VNPActionRequest, VNPActionResult } from '@vaultproof/vnp-sdk'

const ALLOWED_ACTIONS = new Set(['alert_team', 'log_only'])
const ALLOWED_SCOPES  = new Set(['local'])

export class PolicyEngine {
  async evaluate(req: VNPActionRequest): Promise<Pick<VNPActionResult, 'status' | 'execution'>> {
    if (!ALLOWED_SCOPES.has(req.scope)) {
      return { status: 'denied', execution: 'skipped' }
    }

    if (!ALLOWED_ACTIONS.has(req.action)) {
      return { status: 'denied', execution: 'skipped' }
    }

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
