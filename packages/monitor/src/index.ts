interface Env { ENDPOINTS: string; ALERT_EMAIL: string; RESEND_API_KEY: string }
type Status = { status: 'up' | 'down'; code?: number; error?: string; ms?: number; checkedAt: string }

const state = new Map<string, 'up' | 'down'>()
const lastCheck = new Map<string, Status>()

async function checkEndpoint(url: string): Promise<Status> {
  const start = Date.now()
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    const ms = Date.now() - start
    const status = res.status === 200 ? 'up' : 'down' as const
    return { status, code: res.status, ms, checkedAt: new Date().toISOString() }
  } catch (e: any) {
    return { status: 'down', error: e.message, ms: Date.now() - start, checkedAt: new Date().toISOString() }
  }
}

function emailHtml(host: string, result: Status, recovered: boolean): string {
  const color = recovered ? '#22c55e' : '#ef4444'
  const label = recovered ? 'RECOVERED' : 'DOWN'
  const detail = result.error ? `Error: ${result.error}` : `Status: ${result.code}`
  return `
<div style="background:#111;padding:40px 0;font-family:system-ui,sans-serif">
  <div style="max-width:480px;margin:0 auto;background:#1a1a2e;border-radius:12px;overflow:hidden">
    <div style="padding:24px;text-align:center;background:#16213e">
      <h1 style="color:#e2e8f0;margin:0;font-size:20px">VaultProof Monitor</h1>
    </div>
    <div style="padding:32px 24px">
      <div style="background:${color}22;border-left:4px solid ${color};padding:16px;border-radius:0 8px 8px 0;margin-bottom:24px">
        <strong style="color:${color};font-size:16px">${label}: ${host}</strong>
      </div>
      <table style="width:100%;color:#94a3b8;font-size:14px">
        <tr><td style="padding:8px 0">Endpoint</td><td style="color:#e2e8f0">${result.checkedAt ? `<a href="${host}" style="color:#60a5fa">${host}</a>` : host}</td></tr>
        <tr><td style="padding:8px 0">${result.error ? 'Error' : 'Status Code'}</td><td style="color:#e2e8f0">${detail}</td></tr>
        <tr><td style="padding:8px 0">Response Time</td><td style="color:#e2e8f0">${result.ms}ms</td></tr>
        <tr><td style="padding:8px 0">Checked At</td><td style="color:#e2e8f0">${result.checkedAt}</td></tr>
      </table>
    </div>
  </div>
</div>`
}

async function sendAlert(env: Env, url: string, result: Status, recovered: boolean) {
  if (!env.RESEND_API_KEY || !env.ALERT_EMAIL) return
  const host = new URL(url).host
  const tag = recovered ? 'RECOVERED' : 'DOWN'
  const subject = `[${tag}] ${host} ${recovered ? 'is back up' : 'is not responding'}`
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'VaultProof Monitor <noreply@vaultproof.dev>',
      to: env.ALERT_EMAIL, subject, html: emailHtml(url, result, recovered),
    }),
  })
}

async function runChecks(env: Env) {
  const urls = env.ENDPOINTS.split(',').map(u => u.trim()).filter(Boolean)
  await Promise.all(urls.map(async (url) => {
    const result = await checkEndpoint(url)
    const prev = state.get(url) ?? 'up'
    lastCheck.set(url, result)
    if (result.status === 'down' && prev !== 'down') {
      console.log(`[DOWN] ${url} — ${result.error ?? result.code}`)
      await sendAlert(env, url, result, false)
    } else if (result.status === 'up' && prev === 'down') {
      console.log(`[RECOVERED] ${url}`)
      await sendAlert(env, url, result, true)
    }
    state.set(url, result.status)
  }))
}

export default {
  async fetch(_req: Request, env: Env): Promise<Response> {
    if (!lastCheck.size) await runChecks(env)
    const data = Object.fromEntries([...lastCheck.entries()])
    return new Response(JSON.stringify(data, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    })
  },
  async scheduled(_event: ScheduledEvent, env: Env) { await runChecks(env) },
}
