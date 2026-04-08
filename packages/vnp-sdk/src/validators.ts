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
