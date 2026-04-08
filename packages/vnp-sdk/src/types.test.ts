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
