import type { SignedSecureExecutionEnvelope } from '@vaultproof/core';
import { timingSafeEqual } from 'node:crypto';
import { assertEnterpriseHostname, dispatchToSecureExecutor, type EnterpriseControlPlaneEnv } from './config.js';
import { renderEnterpriseControlPage, renderEnterpriseOrgPage } from './app-pages.js';
import { renderEnterpriseLoginPage } from './login-page.js';
import { handleEnterpriseAlertRoutes } from './routes/alerts.js';
import { handleEnterpriseAuditRoutes } from './routes/audit.js';
import { handleEnterpriseExecuteRoutes } from './routes/execute.js';
import { handleEnterpriseMemberRoutes } from './routes/members.js';
import { handleEnterpriseOrganizationRoutes } from './routes/orgs.js';
import { handleEnterpriseProjectRoutes } from './routes/projects.js';

async function parseEnvelope(request: Request): Promise<SignedSecureExecutionEnvelope | null> {
  try {
    return (await request.json()) as SignedSecureExecutionEnvelope;
  } catch {
    return null;
  }
}

function getRequestHostname(request: Request, url: URL): string {
  const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('x-original-host');
  const host = forwardedHost || request.headers.get('host') || url.hostname;
  return host.split(',')[0]?.trim().split(':')[0]?.toLowerCase() || url.hostname.toLowerCase();
}

function normalizeOriginLockHeaderName(headerName?: string): string {
  return (headerName || 'x-vaultproof-origin-lock').trim().toLowerCase();
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function verifyOriginLock(request: Request, env: EnterpriseControlPlaneEnv): Response | null {
  const expectedSecret = env.originLockSecret?.trim();
  if (!expectedSecret) return null;

  if (request.headers.get('x-vaultproof-local-loopback') === 'true') return null;

  const headerName = normalizeOriginLockHeaderName(env.originLockHeaderName);
  const actualSecret = request.headers.get(headerName) || '';
  if (constantTimeEquals(actualSecret, expectedSecret)) return null;

  return Response.json(
    {
      error: 'Front Door origin lock rejected this request.',
    },
    {
      status: 403,
      headers: {
        'cache-control': 'no-store',
      },
    },
  );
}

async function fetchExecutorHealth(env: EnterpriseControlPlaneEnv): Promise<{
  reachable: boolean;
  status: number | null;
  health: Record<string, unknown> | null;
  error: string | null;
}> {
  if (!env.executorBaseUrl) {
    return {
      reachable: false,
      status: null,
      health: null,
      error: 'executor base URL is not configured',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`${env.executorBaseUrl.replace(/\/+$/, '')}/health`, {
      signal: controller.signal,
    });
    const health = await response.json().catch(() => null);
    return {
      reachable: response.ok,
      status: response.status,
      health: health && typeof health === 'object' && !Array.isArray(health)
        ? health as Record<string, unknown>
        : null,
      error: response.ok ? null : `executor health returned ${response.status}`,
    };
  } catch (error) {
    return {
      reachable: false,
      status: null,
      health: null,
      error: error instanceof Error ? error.message : 'failed to reach executor health',
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function buildEnterpriseReadiness(
  hostname: string,
  env: EnterpriseControlPlaneEnv,
): Promise<Record<string, unknown>> {
  const productionBlockers: string[] = [];
  const demoBlockers: string[] = [];

  const supabaseConfigured = Boolean(env.supabaseUrl && env.supabaseServiceRoleKey);
  const executorConfigured = Boolean(env.executorBaseUrl);
  const signingConfigured = Boolean(env.executorSigningKeyId && env.executorSigningSecret);
  const originLockConfigured = Boolean(env.originLockSecret?.trim());

  if (!supabaseConfigured) {
    productionBlockers.push('Supabase service role is not configured');
    demoBlockers.push('Supabase service role is not configured');
  }
  if (!executorConfigured) {
    productionBlockers.push('secure executor base URL is not configured');
    demoBlockers.push('secure executor base URL is not configured');
  }
  if (!signingConfigured) {
    productionBlockers.push('control-plane-to-executor signing is not configured');
    demoBlockers.push('control-plane-to-executor signing is not configured');
  }
  if (env.originLockRequired && !originLockConfigured) {
    productionBlockers.push('Front Door origin lock is not configured');
  }

  const executor = await fetchExecutorHealth(env);
  const executorHealth = executor.health || {};
  const executorProductionBlockers = Array.isArray(executorHealth.production_blockers)
    ? executorHealth.production_blockers.map((item) => String(item)).filter(Boolean)
    : [];

  if (!executor.reachable) {
    productionBlockers.push(`secure executor health is not reachable: ${executor.error || 'unknown error'}`);
    demoBlockers.push(`secure executor health is not reachable: ${executor.error || 'unknown error'}`);
  }

  if (executor.reachable && executorHealth.secure_execution_ready !== true) {
    productionBlockers.push('secure executor is not execution-ready');
    demoBlockers.push('secure executor is not execution-ready');
  }
  if (executor.reachable && executorHealth.signature_verification_ready !== true) {
    productionBlockers.push('secure executor signature verification is not ready');
    demoBlockers.push('secure executor signature verification is not ready');
  }
  if (executor.reachable && executorHealth.execution_material_resolver_ready !== true) {
    productionBlockers.push('secure executor material resolver is not ready');
    demoBlockers.push('secure executor material resolver is not ready');
  }
  if (executor.reachable && executorHealth.replay_protection_ready !== true) {
    productionBlockers.push('secure executor replay protection is not ready');
    demoBlockers.push('secure executor replay protection is not ready');
  }
  if (executor.reachable && executorHealth.production_ready !== true) {
    productionBlockers.push(...executorProductionBlockers.map((blocker) => `executor: ${blocker}`));
    if (!executorProductionBlockers.length) {
      productionBlockers.push('secure executor is not production-confidential ready');
    }
  }

  const demoReady = demoBlockers.length === 0;
  const productionReady = productionBlockers.length === 0;

  return {
    status: demoReady ? 'ok' : 'degraded',
    service: 'vaultproof-enterprise-control-plane',
    hostname,
    demo_ready: demoReady,
    production_ready: productionReady,
    security_profile: productionReady ? 'azure-confidential-production' : demoReady ? 'demo-or-incomplete' : 'not-ready',
    control_plane: {
      executor_configured: executorConfigured,
      supabase_configured: supabaseConfigured,
      signing_configured: signingConfigured,
      origin_lock_configured: originLockConfigured,
      origin_lock_required: env.originLockRequired === true,
    },
    executor: {
      reachable: executor.reachable,
      status: executor.status,
      health: executor.health,
      error: executor.error,
    },
    demo_blockers: demoBlockers,
    production_blockers: [...new Set(productionBlockers)],
  };
}

export async function handleEnterpriseControlPlaneRequest(
  request: Request,
  env: EnterpriseControlPlaneEnv = {},
): Promise<Response> {
  const url = new URL(request.url);
  const hostname = getRequestHostname(request, url);

  try {
    assertEnterpriseHostname(hostname, env);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Invalid enterprise hostname.' },
      { status: 400 },
    );
  }

  const originLockResponse = verifyOriginLock(request, env);
  if (originLockResponse) return originLockResponse;

  if (request.method === 'GET' && url.pathname === '/') {
    return Response.redirect(`${url.origin}/app/login${url.search}`, 302);
  }

  if (request.method === 'GET' && url.pathname === '/app/login') {
    return new Response(renderEnterpriseLoginPage(), {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex',
      },
    });
  }

  if (request.method === 'GET' && (url.pathname === '/app/control' || url.pathname === '/app/control.html')) {
    return new Response(renderEnterpriseControlPage(), {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex',
      },
    });
  }

  if (request.method === 'GET' && (url.pathname === '/app/org' || url.pathname === '/app/org.html')) {
    return new Response(renderEnterpriseOrgPage(), {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex',
      },
    });
  }

  if (request.method === 'GET' && url.pathname === '/health') {
    return Response.json({
      status: 'ok',
      service: 'vaultproof-enterprise-control-plane',
      hostname,
      path: url.pathname,
      executor_configured: Boolean(env.executorBaseUrl),
      supabase_configured: Boolean(env.supabaseUrl && env.supabaseServiceRoleKey),
      origin_lock_configured: Boolean(env.originLockSecret?.trim()),
      origin_lock_required: env.originLockRequired === true,
    });
  }

  if (request.method === 'GET' && url.pathname === '/readiness') {
    return Response.json(await buildEnterpriseReadiness(hostname, env), {
      headers: {
        'cache-control': 'no-store',
      },
    });
  }

  const pathSegments = url.pathname.split('/').filter(Boolean);
  if (pathSegments[0] === 'api' && pathSegments[1] === 'v1' && pathSegments[2] === 'enterprise') {
    const enterpriseRouteResponse = await handleEnterpriseOrganizationRoutes(request, env, pathSegments.slice(3));
    if (enterpriseRouteResponse) return enterpriseRouteResponse;
    const enterpriseMemberResponse = await handleEnterpriseMemberRoutes(request, env, pathSegments.slice(3));
    if (enterpriseMemberResponse) return enterpriseMemberResponse;
    const enterpriseProjectResponse = await handleEnterpriseProjectRoutes(request, env, pathSegments.slice(3));
    if (enterpriseProjectResponse) return enterpriseProjectResponse;
    const enterpriseAuditResponse = await handleEnterpriseAuditRoutes(request, env, pathSegments.slice(3));
    if (enterpriseAuditResponse) return enterpriseAuditResponse;
    const enterpriseAlertResponse = await handleEnterpriseAlertRoutes(request, env, pathSegments.slice(3));
    if (enterpriseAlertResponse) return enterpriseAlertResponse;
    const enterpriseExecuteResponse = await handleEnterpriseExecuteRoutes(request, env, pathSegments.slice(3));
    if (enterpriseExecuteResponse) return enterpriseExecuteResponse;
  }

  if (request.method === 'POST' && url.pathname === '/execute') {
    const envelope = await parseEnvelope(request);
    if (!envelope) {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    return dispatchToSecureExecutor({ envelope, env });
  }

  return Response.json(
    {
      error: 'Not found',
      service: 'vaultproof-enterprise-control-plane',
    },
    { status: 404 },
  );
}

export type { EnterpriseControlPlaneEnv } from './config.js';
