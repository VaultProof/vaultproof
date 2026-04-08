import { EventEmitter } from 'node:events'
import { makeEventId } from '@vaultproof/vnp-sdk'
import type { VNPEvent } from '@vaultproof/vnp-sdk'
import type { ParsedSyslog } from './syslog.js'

export class AnomalyDetector extends EventEmitter {
  private deviceId: string
  private deviceIp: string
  private windowCounts: number[] = []
  private currentWindowCount = 0
  private baseline = 10
  private authFailures = new Map<string, number>()
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
    if (this.currentWindowCount > this.baseline * 10) {
      const severity = this.currentWindowCount > this.baseline * 50 ? 'critical' : 'high'
      this.emitEvent('network.anomaly', 'traffic_spike', severity, {
        connections_per_sec: this.currentWindowCount,
        baseline: this.baseline
      }, {})
    }

    for (const [ip, count] of this.authFailures) {
      if (count > 20) {
        this.emitEvent('auth.failure', 'auth_failure_burst', 'high',
          { failure_count: count }, { src_ip: ip })
      }
    }

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
