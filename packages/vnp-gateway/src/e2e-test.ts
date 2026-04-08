// Run: node dist/e2e-test.js
// Requires: gateway running on localhost:3001
export {}

const GW = 'http://localhost:3001'

async function post(path: string, body: unknown) {
  const res = await fetch(`${GW}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const data = await res.json()
  console.log(`POST ${path} → ${res.status}`, JSON.stringify(data))
  return data
}

// 1. Send a high-severity traffic spike event
await post('/vnp/events', {
  v: '1.0', type: 'EVENT',
  id: 'evt_test1',
  ts: Math.floor(Date.now() / 1000),
  source: { device_id: 'router-1', ip: '192.168.1.1', region: 'us-west' },
  event: { category: 'network.anomaly', name: 'traffic_spike', severity: 'high' },
  metrics: { connections_per_sec: 12000, baseline: 200 },
  context: { top_ip: '45.33.12.1', port: 443 }
})

// 2. Send a summary
await post('/vnp/summaries', {
  v: '1.0', type: 'SUMMARY',
  ts: Math.floor(Date.now() / 1000),
  window_sec: 60,
  source: { device_id: 'router-1' },
  stats: { avg_latency_ms: 12, packet_loss: 0.02, throughput_mb: 120 }
})

// 3. Test policy engine — approved action
await post('/vnp/actions', {
  v: '1.0', type: 'ACTION_REQUEST',
  id: 'evt_test2',
  ts: Math.floor(Date.now() / 1000),
  action: 'alert_team',
  target: '45.33.12.1',
  scope: 'local',
  reason: 'Simulated DDoS test'
})

// 4. Test policy engine — denied action (block_ip not allowed in v1)
await post('/vnp/actions', {
  v: '1.0', type: 'ACTION_REQUEST',
  id: 'evt_test3',
  ts: Math.floor(Date.now() / 1000),
  action: 'block_ip',
  target: '45.33.12.1',
  scope: 'local',
  reason: 'Should be denied in v1'
})

console.log('\n✓ E2E test complete. Check gateway logs and data/ directory.')
