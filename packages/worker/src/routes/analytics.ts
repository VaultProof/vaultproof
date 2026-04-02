import type { Env } from '../types.js';
import { getSupabase } from '../lib/supabase.js';

export async function handleAnalyticsEvent(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
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
  const referrer = typeof data.referrer === 'string' ? data.referrer.slice(0, 200) : null;
  const session_id = typeof data.sessionId === 'string' ? data.sessionId.slice(0, 100) : null;

  const supabase = getSupabase(env);
  const { error } = await supabase.from('analytics_events').insert({
    id: crypto.randomUUID(),
    type: 'pageview',
    page,
    referrer,
    session_id,
  });

  if (error) {
    return Response.json({ error: 'Failed to record event' }, { status: 500 });
  }

  return Response.json({ ok: true });
}
