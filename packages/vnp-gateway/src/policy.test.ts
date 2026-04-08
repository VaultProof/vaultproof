import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PolicyEngine } from './policy.js'
import type { VNPActionRequest } from '@vaultproof/vnp-sdk'

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
