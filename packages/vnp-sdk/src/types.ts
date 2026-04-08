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
