import type { Env } from '../types.js';
import { getSupabase } from '../lib/supabase.js';
import { parseUserAgent, hashIp, upsertSession, recordEvent } from '../lib/analytics.js';

// Known bot user-agent patterns
const BOT_PATTERNS = [
  /bot\b/i, /crawl/i, /spider/i, /slurp/i, /mediapartners/i,
  /feedfetcher/i, /facebookexternalhit/i, /twitterbot/i, /linkedinbot/i,
  /whatsapp/i, /telegrambot/i, /discordbot/i, /slackbot/i,
  /pingdom/i, /uptimerobot/i, /monitoring/i, /healthcheck/i,
  /lighthouse/i, /pagespeed/i, /gtmetrix/i, /semrush/i, /ahref/i,
  /bytespider/i, /gptbot/i, /claudebot/i, /anthropic/i, /openai/i,
  /headless/i, /phantom/i, /selenium/i, /puppeteer/i, /playwright/i,
  /wget/i, /curl/i, /httpie/i, /python-requests/i, /axios/i, /node-fetch/i,
];

function isBot(userAgent: string): boolean {
  if (!userAgent) return true;
  return BOT_PATTERNS.some(p => p.test(userAgent));
}

export async function handleAnalyticsEvent(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const userAgent = request.headers.get('user-agent') || '';
  if (isBot(userAgent)) {
    return Response.json({ ok: true }); // Silent drop
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const data = body as Record<string, unknown>;
  const eventType = typeof data.type === 'string' ? data.type : null;
  if (!eventType) {
    return Response.json({ error: 'Missing event type' }, { status: 400 });
  }

  const supabase = getSupabase(env);

  const page = typeof data.page === 'string' ? data.page.slice(0, 500) : null;
  const sessionId = typeof data.sessionId === 'string' ? data.sessionId.slice(0, 100) : crypto.randomUUID();
  const visitorId = typeof data.visitorId === 'string' ? data.visitorId.slice(0, 100) : sessionId;

  // Sanitize referrer
  let referrer: string | null = null;
  let isMalicious = false;
  if (typeof data.referrer === 'string' && data.referrer.length > 0) {
    const raw = data.referrer.slice(0, 200);
    if (/^https?:\/\/[a-zA-Z0-9]/.test(raw) && !/<|>|javascript:|data:|onerror|onclick|169\.254/i.test(raw)) {
      referrer = raw;
    } else {
      isMalicious = true;
    }
  }

  // Log security probes (fire and forget)
  if (isMalicious) {
    const clientIp = request.headers.get('cf-connecting-ip') || 'unknown';
    supabase.from('analytics_events').insert({
      id: crypto.randomUUID(),
      type: 'security_probe',
      page,
      referrer: (typeof data.referrer === 'string' ? data.referrer : '').slice(0, 500),
      session_id: sessionId,
      metadata: JSON.stringify({
        ip: clientIp,
        ua: userAgent.slice(0, 200),
        probe_type: /<|>/i.test(String(data.referrer)) ? 'xss' : /169\.254/i.test(String(data.referrer)) ? 'ssrf' : 'other',
      }),
    }).then(() => {}, () => {});
    return Response.json({ ok: true });
  }

  // Compute IP hash and parse UA
  const clientIp = request.headers.get('cf-connecting-ip') || 'unknown';
  const today = new Date().toISOString().slice(0, 10);
  const ipHash = await hashIp(clientIp, today);
  const country = request.headers.get('cf-ipcountry') || null;
  const ua = parseUserAgent(userAgent);

  // UTM params
  const utmSource = typeof data.utmSource === 'string' ? data.utmSource.slice(0, 200) : null;
  const utmMedium = typeof data.utmMedium === 'string' ? data.utmMedium.slice(0, 200) : null;
  const utmCampaign = typeof data.utmCampaign === 'string' ? data.utmCampaign.slice(0, 200) : null;

  // Event properties
  const properties = (data.properties && typeof data.properties === 'object')
    ? data.properties as Record<string, unknown>
    : null;

  // Upsert session + record event
  const activeSessionId = await upsertSession(env, {
    sessionId,
    visitorId,
    ipHash,
    ua,
    country,
    utmSource,
    utmMedium,
    utmCampaign,
    referrer,
    page,
  });

  await recordEvent(env, {
    sessionId: activeSessionId,
    type: eventType,
    page,
    referrer,
    properties,
  });

  // Dual-write to legacy analytics_events (remove after migration validated)
  supabase.from('analytics_events').insert({
    id: crypto.randomUUID(),
    type: eventType,
    page,
    referrer,
    session_id: sessionId,
    metadata: JSON.stringify({ ip_hash: ipHash, ua: userAgent.slice(0, 200), country }),
  }).then(() => {}, () => {});

  return Response.json({ ok: true });
}
