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

    for (let i = 0; i < 5; i++) detector.ingest(makeSyslog('10.0.0.1'))
    assert.equal(events.length, 0)
  })

  it('emits traffic_spike when connections exceed 10x baseline', () => {
    const detector = new AnomalyDetector('router-1', '192.168.1.1')
    const events: unknown[] = []
    detector.on('event', e => events.push(e))

    for (let i = 0; i < 10; i++) detector.ingest(makeSyslog('10.0.0.1'))
    detector.flushWindow()

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
