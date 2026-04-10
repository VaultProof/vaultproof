import type { Env } from '../types.js';
import { getSupabase } from './supabase.js';

// ── Constants ───────────────────────────────────────────────────────
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// ── UA Parsing (lightweight, no library) ────────────────────────────
export interface ParsedUA {
  deviceType: 'desktop' | 'mobile' | 'tablet';
  browser: string;
  os: string;
}

export function parseUserAgent(ua: string): ParsedUA {
  // Device type
  let deviceType: ParsedUA['deviceType'] = 'desktop';
  if (/ipad|tablet|playbook|silk/i.test(ua)) deviceType = 'tablet';
  else if (/mobile|iphone|ipod|android.*mobile|windows phone/i.test(ua)) deviceType = 'mobile';

  // Browser
  let browser = 'Other';
  if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/opr\/|opera/i.test(ua)) browser = 'Opera';
  else if (/chrome\/.*safari/i.test(ua)) browser = 'Chrome';
  else if (/safari\//i.test(ua) && !/chrome/i.test(ua)) browser = 'Safari';
  else if (/firefox\//i.test(ua)) browser = 'Firefox';

  // OS
  let os = 'Other';
  if (/windows/i.test(ua)) os = 'Windows';
  else if (/macintosh|mac os x/i.test(ua)) os = 'macOS';
  else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/linux/i.test(ua)) os = 'Linux';
  else if (/cros/i.test(ua)) os = 'ChromeOS';

  return { deviceType, browser, os };
}

// ── IP Hashing ──────────────────────────────────────────────────────
export async function hashIp(ip: string, date: string): Promise<string> {
  const data = new TextEncoder().encode(`${ip}:${date}`);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

// ── Session Upsert ──────────────────────────────────────────────────
interface SessionUpsertInput {
  sessionId: string;
  visitorId: string;
  ipHash: string;
  userId?: string | null;
  ua: ParsedUA;
  country: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  referrer?: string | null;
  page?: string | null;
}

/**
 * Find or create a session. If the existing session's last event was >30 min ago,
 * create a new session. Returns the active session ID.
 */
export async function upsertSession(env: Env, input: SessionUpsertInput): Promise<string> {
  const supabase = getSupabase(env);

  // Look up existing session
  const { data: existing } = await supabase
    .from('sessions')
    .select('id, ended_at, event_count')
    .eq('id', input.sessionId)
    .maybeSingle();

  const now = new Date().toISOString();

  if (existing) {
    const lastEvent = new Date(existing.ended_at).getTime();
    const elapsed = Date.now() - lastEvent;

    if (elapsed < SESSION_TIMEOUT_MS) {
      // Update existing session
      const newCount = (existing.event_count || 0) + 1;
      await supabase.from('sessions').update({
        ended_at: now,
        event_count: newCount,
        is_bounce: newCount <= 1,
        ...(input.userId ? { user_id: input.userId } : {}),
      }).eq('id', existing.id);
      return existing.id;
    }
  }

  // Create new session (either no existing, or timed out)
  const newId = input.sessionId || crypto.randomUUID();
  await supabase.from('sessions').insert({
    id: newId,
    visitor_id: input.visitorId,
    ip_hash: input.ipHash,
    user_id: input.userId || null,
    device_type: input.ua.deviceType,
    browser: input.ua.browser,
    os: input.ua.os,
    country: input.country,
    utm_source: input.utmSource || null,
    utm_medium: input.utmMedium || null,
    utm_campaign: input.utmCampaign || null,
    referrer: input.referrer || null,
    landing_page: input.page || null,
    started_at: now,
    ended_at: now,
    is_bounce: true,
    event_count: 1,
  });
  return newId;
}

// ── Record Event ────────────────────────────────────────────────────
interface RecordEventInput {
  sessionId?: string | null;
  userId?: string | null;
  type: string;
  page?: string | null;
  referrer?: string | null;
  properties?: Record<string, unknown> | null;
}

/**
 * Insert an event into the events table. Used for both client-side
 * (via /analytics/event) and server-side product events.
 */
export async function recordEvent(env: Env, input: RecordEventInput): Promise<void> {
  const supabase = getSupabase(env);
  await supabase.from('events').insert({
    id: crypto.randomUUID(),
    session_id: input.sessionId || null,
    user_id: input.userId || null,
    type: input.type,
    page: input.page || null,
    referrer: input.referrer || null,
    properties: input.properties || null,
    created_at: new Date().toISOString(),
  });
}
