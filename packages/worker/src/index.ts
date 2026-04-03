import type { Env } from './types.js';
import { handleTransparentProxy } from './routes/transparent-proxy.js';
import { handleAnalyticsEvent } from './routes/analytics.js';
import { handleStats } from './routes/stats.js';
import { handleDevKeys } from './routes/dev-keys.js';
import { handlePromo } from './routes/promo.js';
import { handleAdmin } from './routes/admin.js';
import { handleScanner } from './routes/scanner.js';
import { handleKeys } from './routes/keys.js';
import { handleBilling } from './routes/billing.js';
import { handleAuth } from './routes/auth.js';
import { checkPublicIpRateLimit } from './lib/rate-limit.js';
import { getSupabase } from './lib/supabase.js';
import { getGhToken } from './lib/github.js';
import { executeScan } from './lib/scheduled-scan.js';

function corsHeaders(origin: string, allowedOrigins: string[]): Record<string, string> {
  const isAllowed = allowedOrigins.includes('*') || allowedOrigins.includes(origin);
  return {
    ...(isAllowed ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-VaultProof-Session',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };
}

function addCors(response: Response, origin: string, allowedOrigins: string[]): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders(origin, allowedOrigins))) {
    headers.set(k, v);
  }
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil((async () => {
      try {
        const supabase = getSupabase(env);

        // 1. Query schedules that are due
        const now = new Date().toISOString();
        const { data: schedules, error } = await supabase
          .from('scan_schedules')
          .select('*')
          .eq('enabled', true)
          .lte('next_run_at', now)
          .order('next_run_at', { ascending: true })
          .limit(10);

        if (error || !schedules || schedules.length === 0) return;

        for (const schedule of schedules) {
          try {
            // 2a. Get user's GitHub token
            const gh = await getGhToken(env, schedule.user_id);
            if (!gh) {
              console.error(`Scheduled scan: no GitHub token for user ${schedule.user_id}`);
              continue;
            }

            // 2b. Create scan record
            const scanId = crypto.randomUUID();
            const scanNow = new Date().toISOString();
            await supabase.from('scan_results').insert({
              id: scanId,
              user_id: schedule.user_id,
              repo_full_name: schedule.repo_full_name,
              branch: 'default',
              status: 'in_progress',
              started_at: scanNow,
              keys_found: 0,
              keys_active: 0,
              keys_revoked: 0,
              platforms: [],
            });

            // 2c. Execute scan
            const result = await executeScan(
              env,
              schedule.user_id,
              gh.token,
              schedule.repo_full_name,
              undefined,
              scanId,
            );

            // 2d. Compare findings with previous scan to detect new ones
            if (schedule.last_scan_id) {
              const { data: prevFindings } = await supabase
                .from('scan_findings')
                .select('masked_value, file, provider')
                .eq('scan_id', schedule.last_scan_id);

              const prevSet = new Set(
                (prevFindings || []).map(
                  (f: any) => `${f.masked_value}|${f.file}|${f.provider}`,
                ),
              );

              const newFindings = result.findings.filter(
                (f) => !prevSet.has(`${f.maskedValue}|${f.file}|${f.provider}`),
              );

              // 2e. Insert alerts for new findings
              if (newFindings.length > 0) {
                for (const f of newFindings) {
                  await supabase.from('scan_alerts').insert({
                    id: crypto.randomUUID(),
                    user_id: schedule.user_id,
                    schedule_id: schedule.id,
                    scan_id: scanId,
                    repo_full_name: schedule.repo_full_name,
                    provider: f.provider,
                    file: f.file,
                    masked_value: f.maskedValue,
                    created_at: new Date().toISOString(),
                  });
                }
              }
            }

            // 2f. Update schedule: last_run_at, next_run_at, last_scan_id
            const nextRun = new Date();
            if (schedule.frequency === 'daily') {
              nextRun.setDate(nextRun.getDate() + 1);
            } else {
              nextRun.setDate(nextRun.getDate() + 7);
            }

            await supabase
              .from('scan_schedules')
              .update({
                last_run_at: new Date().toISOString(),
                next_run_at: nextRun.toISOString(),
                last_scan_id: scanId,
                updated_at: new Date().toISOString(),
              })
              .eq('id', schedule.id);
          } catch (err) {
            console.error(
              `Scheduled scan failed for ${schedule.repo_full_name}:`,
              err instanceof Error ? err.message : err,
            );
          }
        }
      } catch (err) {
        console.error('Cron handler error:', err instanceof Error ? err.message : err);
      }
    })());
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // Normalize trailing slashes
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1);
    }
    const allowedOrigins = (env.ALLOWED_ORIGINS || 'https://vaultproof.dev').split(',').map(s => s.trim());
    const origin = request.headers.get('Origin') || '';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin, allowedOrigins) });
    }

    // Health check
    if (url.pathname === '/health') {
      return addCors(
        Response.json({ status: 'ok', service: 'vaultproof-edge', edge: true }),
        origin, allowedOrigins
      );
    }

    // Backend health
    if (url.pathname === '/backend-health') {
      return addCors(
        Response.json({ status: 'ok', service: 'vaultproof' }),
        origin, allowedOrigins
      );
    }

    // Analytics event (public, no auth — IP rate limited)
    if (url.pathname === '/analytics/event') {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const rl = await checkPublicIpRateLimit(env, ip);
      if (!rl.allowed) {
        return addCors(Response.json({ error: 'Rate limited — try again in a moment' }, { status: 429 }), origin, allowedOrigins);
      }
      try {
        const response = await handleAnalyticsEvent(request, env);
        return addCors(response, origin, allowedOrigins);
      } catch {
        return addCors(Response.json({ error: 'Service temporarily unavailable' }, { status: 503 }), origin, allowedOrigins);
      }
    }

    // Auth routes
    if (url.pathname.startsWith('/api/v1/auth/')) {
      try {
        const path = url.pathname.slice('/api/v1/auth/'.length);
        const response = await handleAuth(request, env, path);
        return addCors(response, origin, allowedOrigins);
      } catch {
        return addCors(Response.json({ error: 'Service temporarily unavailable' }, { status: 503 }), origin, allowedOrigins);
      }
    }

    // Stats routes
    if (url.pathname.startsWith('/api/v1/stats/')) {
      try {
        const path = url.pathname.slice('/api/v1/stats/'.length);
        const response = await handleStats(request, env, path);
        return addCors(response, origin, allowedOrigins);
      } catch {
        return addCors(Response.json({ error: 'Service temporarily unavailable' }, { status: 503 }), origin, allowedOrigins);
      }
    }

    // Dev keys routes
    if (url.pathname.startsWith('/api/v1/dev-keys/')) {
      try {
        const path = url.pathname.slice('/api/v1/dev-keys/'.length);
        const response = await handleDevKeys(request, env, path);
        return addCors(response, origin, allowedOrigins);
      } catch {
        return addCors(Response.json({ error: 'Service temporarily unavailable' }, { status: 503 }), origin, allowedOrigins);
      }
    }

    // Billing routes
    if (url.pathname.startsWith('/api/v1/billing/')) {
      try {
        const path = url.pathname.slice('/api/v1/billing/'.length);
        const response = await handleBilling(request, env, path);
        return addCors(response, origin, allowedOrigins);
      } catch {
        return addCors(Response.json({ error: 'Service temporarily unavailable' }, { status: 503 }), origin, allowedOrigins);
      }
    }

    // Promo routes
    if (url.pathname.startsWith('/api/v1/promo/')) {
      try {
        const path = url.pathname.slice('/api/v1/promo/'.length);
        const response = await handlePromo(request, env, path);
        return addCors(response, origin, allowedOrigins);
      } catch {
        return addCors(Response.json({ error: 'Service temporarily unavailable' }, { status: 503 }), origin, allowedOrigins);
      }
    }

    // Keys routes
    if (url.pathname.startsWith('/api/v1/keys/')) {
      try {
        const path = url.pathname.slice('/api/v1/keys/'.length);
        const response = await handleKeys(request, env, path);
        return addCors(response, origin, allowedOrigins);
      } catch {
        return addCors(Response.json({ error: 'Service temporarily unavailable' }, { status: 503 }), origin, allowedOrigins);
      }
    }

    // Scanner routes
    if (url.pathname.startsWith('/api/v1/scanner/')) {
      try {
        const path = url.pathname.slice('/api/v1/scanner/'.length);
        const response = await handleScanner(request, env, path);
        return addCors(response, origin, allowedOrigins);
      } catch {
        return addCors(Response.json({ error: 'Service temporarily unavailable' }, { status: 503 }), origin, allowedOrigins);
      }
    }

    // Admin routes
    if (url.pathname.startsWith('/admin/')) {
      try {
        const path = url.pathname.slice('/admin/'.length);
        const response = await handleAdmin(request, env, path);
        return addCors(response, origin, allowedOrigins);
      } catch {
        return addCors(Response.json({ error: 'Service temporarily unavailable' }, { status: 503 }), origin, allowedOrigins);
      }
    }

    // Transparent proxy: /v1/*
    if (url.pathname.startsWith('/v1/')) {
      try {
        const path = url.pathname.slice(4);
        const response = await handleTransparentProxy(request, env, path);
        return addCors(response, origin, allowedOrigins);
      } catch {
        return addCors(Response.json({ error: 'Service temporarily unavailable' }, { status: 503 }), origin, allowedOrigins);
      }
    }

    return addCors(Response.json({ error: 'Not found' }, { status: 404 }), origin, allowedOrigins);
  },
};
