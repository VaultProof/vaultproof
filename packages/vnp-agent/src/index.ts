import dgram from 'node:dgram'
import { AnomalyDetector } from './detector.js'
import { parseSyslog } from './syslog.js'
import { VNPEmitter } from './emitter.js'
import type { VNPSummary } from '@vaultproof/vnp-sdk'

const GATEWAY_URL = process.env['GATEWAY_URL'] ?? 'http://localhost:3001'
const DEVICE_ID   = process.env['DEVICE_ID']   ?? 'agent-1'
const DEVICE_IP   = process.env['DEVICE_IP']   ?? '127.0.0.1'
const SYSLOG_PORT = parseInt(process.env['SYSLOG_PORT'] ?? '5140', 10)

const emitter  = new VNPEmitter(GATEWAY_URL)
const detector = new AnomalyDetector(DEVICE_ID, DEVICE_IP)

detector.on('event', async (event) => {
  console.log(`[vnp-agent] event: ${event.event.name} (${event.event.severity})`)
  await emitter.sendEvent(event)
})

setInterval(() => detector.checkThresholds(), 10_000)
setInterval(() => {
  detector.flushWindow()
  const summary: VNPSummary = {
    v: '1.0',
    type: 'SUMMARY',
    ts: Math.floor(Date.now() / 1000),
    window_sec: 60,
    source: { device_id: DEVICE_ID },
    stats: {}
  }
  emitter.sendSummary(summary).catch(console.error)
}, 60_000)

const socket = dgram.createSocket('udp4')
socket.on('message', (msg) => {
  const line = msg.toString().trim()
  const parsed = parseSyslog(line, DEVICE_ID)
  detector.ingest(parsed)
})

socket.bind(SYSLOG_PORT, () => {
  console.log(`[vnp-agent] listening for syslog on UDP :${SYSLOG_PORT}`)
  console.log(`[vnp-agent] gateway: ${GATEWAY_URL}`)
  console.log(`[vnp-agent] device: ${DEVICE_ID} (${DEVICE_IP})`)
})
