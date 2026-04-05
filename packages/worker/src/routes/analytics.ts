import type { Env } from '../types.js';
import { getSupabase } from '../lib/supabase.js';

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

async function hashIp(ip: string, date: string): Promise<string> {
  // Hash IP + date so we can dedup daily visitors without storing raw IPs
  const data = new TextEncoder().encode(`${ip}:${date}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

export async function handleAnalyticsEvent(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  // Bot filtering
  const userAgent = request.headers.get('user-agent') || '';
  if (isBot(userAgent)) {
    return Response.json({ ok: true }); // Silent drop — don't tell bots they're filtered
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const data = body as Record<string, unknown>;

  if (data.type !== 'pageview') {
    return Response.json({ error: 'Invalid event type' }, { status: 400 });
  }

  const page = typeof data.page === 'string' ? data.page.slice(0, 500) : null;
  const session_id = typeof data.sessionId === 'string' ? data.sessionId.slice(0, 100) : null;

  // Sanitize referrer — drop XSS probes, SSRF attempts, and non-HTTP URLs
  let referrer: string | null = null;
  if (typeof data.referrer === 'string' && data.referrer.length > 0) {
    const raw = data.referrer.slice(0, 200);
    if (/^https?:\/\/[a-zA-Z0-9]/.test(raw) && !/<|>|javascript:|data:|onerror|onclick|169\.254/i.test(raw)) {
      referrer = raw;
    }
  }

  // IP-based visitor dedup — hash IP + date for privacy
  const clientIp = request.headers.get('cf-connecting-ip') || 'unknown';
  const today = new Date().toISOString().slice(0, 10);
  const ip_hash = await hashIp(clientIp, today);

  const supabase = getSupabase(env);
  const { error } = await supabase.from('analytics_events').insert({
    id: crypto.randomUUID(),
    type: 'pageview',
    page,
    referrer,
    session_id,
    metadata: JSON.stringify({ ip_hash, ua: userAgent.slice(0, 200) }),
  });

  if (error) {
    return Response.json({ error: 'Failed to record event' }, { status: 500 });
  }

  return Response.json({ ok: true });
}
