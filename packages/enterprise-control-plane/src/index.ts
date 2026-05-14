import type { SignedSecureExecutionEnvelope } from '@vaultproof/core';
import { timingSafeEqual } from 'node:crypto';
import {
  assertControlPlaneHostname,
  dispatchToSecureExecutor,
  getEnterpriseRuntimeTier,
  isInternalAdminHostname,
  type EnterpriseControlPlaneEnv,
} from './config.js';
import { renderEnterpriseControlPage, renderEnterpriseOrgPage, renderEnterprisePlannedAppPage } from './app-pages.js';
import { renderEnterpriseDashboardPage } from './dashboard-page.js';
import { renderEnterpriseHomepage } from './homepage-page.js';
import {
  authorizeInternalAdmin,
  clearInternalAdminSessionCookie,
  handleInternalAdminRoutes,
  renderInternalAdminPage,
} from './internal-admin.js';
import {
  renderEnterpriseLoginPage,
  renderEnterpriseLoginScript,
  renderEnterpriseLogoutPage,
  renderInternalAdminLoginPage,
} from './login-page.js';
import { handleEnterpriseAlertRoutes } from './routes/alerts.js';
import { handleEnterpriseAuditRoutes } from './routes/audit.js';
import { handleEnterpriseExecuteRoutes } from './routes/execute.js';
import { handleEnterpriseMemberRoutes } from './routes/members.js';
import { handleEnterpriseOrganizationRoutes } from './routes/orgs.js';
import { handleEnterpriseProjectRoutes } from './routes/projects.js';
import { handleEnterpriseVerifierRoutes } from './routes/verifier.js';
import { withEnterpriseSecurityHeaders } from './security-headers.js';

async function parseEnvelope(request: Request): Promise<SignedSecureExecutionEnvelope | null> {
  try {
    return (await request.json()) as SignedSecureExecutionEnvelope;
  } catch {
    return null;
  }
}

function getRequestHostname(request: Request, url: URL): string {
  const host = request.headers.get('host') || url.host || url.hostname;
  const normalized = host.split(',')[0]?.trim().toLowerCase() || url.hostname.toLowerCase();
  const ipv6Match = normalized.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (ipv6Match?.[1]) return ipv6Match[1];
  return normalized.replace(/:\d+$/, '') || url.hostname.toLowerCase();
}

function redirectToInternalAdminLogin(url: URL): Response {
  const loginUrl = new URL('/app/login', url);
  return new Response(null, {
    status: 302,
    headers: {
      location: loginUrl.pathname,
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex,nofollow',
    },
  });
}

function normalizeOriginLockHeaderName(headerName?: string): string {
  return (headerName || 'x-vaultproof-origin-lock').trim().toLowerCase();
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

let executorHealthCache: {
  key: string;
  expiresAt: number;
  value: {
    reachable: boolean;
    status: number | null;
    health: Record<string, unknown> | null;
    error: string | null;
  };
} | null = null;

function verifyOriginLock(request: Request, env: EnterpriseControlPlaneEnv): Response | null {
  const expectedSecret = env.originLockSecret?.trim();
  const expectedFrontDoorId = env.azureFrontDoorId?.trim();
  if (!expectedSecret && !expectedFrontDoorId) return null;

  if (request.headers.get('x-vaultproof-local-loopback') === 'true') return null;

  if (expectedFrontDoorId) {
    const actualFrontDoorId = request.headers.get('x-azure-fdid') || '';
    if (constantTimeEquals(actualFrontDoorId, expectedFrontDoorId)) return null;
  }

  if (expectedSecret) {
    const headerName = normalizeOriginLockHeaderName(env.originLockHeaderName);
    const actualSecret = request.headers.get(headerName) || '';
    if (constantTimeEquals(actualSecret, expectedSecret)) return null;
  }

  return Response.json(
    {
      error: 'Enterprise edge origin lock rejected this request.',
    },
    {
      status: 403,
      headers: {
        'cache-control': 'no-store',
      },
    },
  );
}

function buildHealthResponse(hostname: string, url: URL, env: EnterpriseControlPlaneEnv): Response {
  return Response.json({
    status: 'ok',
    service: 'vaultproof-enterprise-control-plane',
    hostname,
    path: url.pathname,
    executor_configured: Boolean(env.executorBaseUrl),
    supabase_configured: Boolean(env.supabaseUrl && env.supabaseServiceRoleKey),
    origin_lock_configured: Boolean(env.azureFrontDoorId?.trim() || env.originLockSecret?.trim()),
    origin_lock_required: env.originLockRequired === true,
  });
}

function isInternalAdminPreviewPath(url: URL, env: EnterpriseControlPlaneEnv): boolean {
  return env.internalAdminPreviewEnabled === true && url.pathname.startsWith('/internal/');
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

  const cacheKey = env.executorBaseUrl.replace(/\/+$/, '');
  const cached = executorHealthCache && executorHealthCache.key === cacheKey && executorHealthCache.expiresAt > Date.now()
    ? executorHealthCache.value
    : null;
  if (cached) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`${cacheKey}/health`, {
      signal: controller.signal,
    });
    const health = await response.json().catch(() => null);
    const result = {
      reachable: response.ok,
      status: response.status,
      health: health && typeof health === 'object' && !Array.isArray(health)
        ? health as Record<string, unknown>
        : null,
      error: response.ok ? null : `executor health returned ${response.status}`,
    };
    executorHealthCache = {
      key: cacheKey,
      expiresAt: Date.now() + 5000,
      value: result,
    };
    return result;
  } catch (error) {
    const result = {
      reachable: false,
      status: null,
      health: null,
      error: error instanceof Error ? error.message : 'failed to reach executor health',
    };
    executorHealthCache = {
      key: cacheKey,
      expiresAt: Date.now() + 5000,
      value: result,
    };
    return result;
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
  const runtimeTier = getEnterpriseRuntimeTier(env);

  const supabaseConfigured = Boolean(env.supabaseUrl && env.supabaseServiceRoleKey);
  const executorConfigured = Boolean(env.executorBaseUrl);
  const signingConfigured = Boolean(env.executorSigningKeyId && env.executorSigningSecret);
  const frontDoorIdConfigured = Boolean(env.azureFrontDoorId?.trim());
  const customOriginLockConfigured = Boolean(env.originLockSecret?.trim());
  const originLockConfigured = frontDoorIdConfigured || customOriginLockConfigured;

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
    productionBlockers.push('Enterprise edge origin lock is not configured');
  }

  const executor = await fetchExecutorHealth(env);
  const executorHealth = executor.health || {};
  const executorSecurityProfile = typeof executorHealth.security_profile === 'string'
    ? executorHealth.security_profile
    : null;
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
    runtime_tier: runtimeTier,
    customer_dedicated_runtime: runtimeTier === 'dedicated-production',
    demo_ready: demoReady,
    production_ready: productionReady,
    security_profile: productionReady ? executorSecurityProfile || 'confidential-production' : demoReady ? 'demo-or-incomplete' : 'not-ready',
    control_plane: {
      cloud_provider: env.enterpriseCloudProvider || 'azure',
      executor_configured: executorConfigured,
      supabase_configured: supabaseConfigured,
      signing_configured: signingConfigured,
      origin_lock_configured: originLockConfigured,
      origin_lock_required: env.originLockRequired === true,
      azure_front_door_id_configured: frontDoorIdConfigured,
      custom_origin_lock_configured: customOriginLockConfigured,
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

function summarizeExecutorHealth(health: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!health) return null;
  return {
    status: health.status,
    service: health.service,
    secure_execution_ready: health.secure_execution_ready,
    signature_verification_ready: health.signature_verification_ready,
    execution_material_resolver_ready: health.execution_material_resolver_ready,
    key_release_ready: health.key_release_ready,
    key_release_mode: health.key_release_mode,
    attestation_evidence_ready: health.attestation_evidence_ready,
    replay_protection_ready: health.replay_protection_ready,
    production_ready: health.production_ready,
    security_profile: health.security_profile,
    production_blocker_count: Array.isArray(health.production_blockers) ? health.production_blockers.length : 0,
  };
}

function buildPublicEnterpriseReadiness(readiness: Record<string, unknown>): Record<string, unknown> {
  const controlPlane = readiness.control_plane && typeof readiness.control_plane === 'object'
    ? readiness.control_plane as Record<string, unknown>
    : {};
  const executor = readiness.executor && typeof readiness.executor === 'object'
    ? readiness.executor as Record<string, unknown>
    : {};
  const executorHealth = executor.health && typeof executor.health === 'object'
    ? executor.health as Record<string, unknown>
    : null;

  return {
    status: readiness.status,
    service: readiness.service,
    hostname: readiness.hostname,
    runtime_tier: readiness.runtime_tier,
    customer_dedicated_runtime: readiness.customer_dedicated_runtime,
    demo_ready: readiness.demo_ready,
    production_ready: readiness.production_ready,
    security_profile: readiness.security_profile,
    detail: 'summary',
    control_plane: {
      cloud_provider: controlPlane.cloud_provider,
      executor_configured: controlPlane.executor_configured,
      supabase_configured: controlPlane.supabase_configured,
      signing_configured: controlPlane.signing_configured,
      origin_lock_configured: controlPlane.origin_lock_configured,
      origin_lock_required: controlPlane.origin_lock_required,
      custom_origin_lock_configured: controlPlane.custom_origin_lock_configured,
    },
    executor: {
      reachable: executor.reachable,
      status: executor.status,
      health: summarizeExecutorHealth(executorHealth),
      error: executor.error ? 'executor health unavailable' : null,
    },
    demo_blockers: readiness.demo_blockers,
    production_blockers: readiness.production_blockers,
  };
}

async function handleEnterpriseControlPlaneRequestInner(
  request: Request,
  env: EnterpriseControlPlaneEnv = {},
): Promise<Response> {
  const url = new URL(request.url);
  const hostname = getRequestHostname(request, url);
  const isReadRequest = request.method === 'GET' || request.method === 'HEAD';

  try {
    assertControlPlaneHostname(hostname, env);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Invalid enterprise hostname.' },
      { status: 400 },
    );
  }

  const internalAdminSurface = isInternalAdminHostname(hostname, env) || isInternalAdminPreviewPath(url, env);

  if (isReadRequest && url.pathname === '/health') {
    return buildHealthResponse(hostname, url, env);
  }

  const originLockResponse = verifyOriginLock(request, env);
  if (originLockResponse) return originLockResponse;

  if (
    internalAdminSurface &&
    isReadRequest &&
    (url.pathname === '/'
      || url.pathname === '/admin'
      || url.pathname === '/admin/'
      || url.pathname === '/internal/admin'
      || /^\/orgs\/[^/]+\/?$/.test(url.pathname)
      || /^\/internal\/admin\/orgs\/[^/]+\/?$/.test(url.pathname))
  ) {
    const authorized = await authorizeInternalAdmin(request, env);
    if (authorized instanceof Response) {
      return redirectToInternalAdminLogin(url);
    }
    return new Response(renderInternalAdminPage(), {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex,nofollow',
      },
    });
  }

  if (isReadRequest && url.pathname === '/') {
    return new Response(renderEnterpriseHomepage(env), {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  }

  if (
    isReadRequest &&
    (url.pathname === '/app' || url.pathname === '/app/' || url.pathname === '/app/dashboard' || url.pathname === '/app/dashboard.html')
  ) {
    return new Response(renderEnterpriseDashboardPage(env), {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex',
      },
    });
  }

  if (isReadRequest && url.pathname === '/app/login') {
    return new Response(internalAdminSurface
      ? renderInternalAdminLoginPage(env)
      : renderEnterpriseLoginPage(env), {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex',
      },
    });
  }

  if (isReadRequest && (url.pathname === '/app/logout' || url.pathname === '/app/logout.html')) {
    return new Response(renderEnterpriseLogoutPage(), {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex',
        'set-cookie': clearInternalAdminSessionCookie(),
      },
    });
  }

  if (isReadRequest && url.pathname === '/app/enterprise-login.js') {
    return new Response(renderEnterpriseLoginScript(env), {
      status: 200,
      headers: {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex',
      },
    });
  }

  if (isReadRequest && (url.pathname === '/app/launch' || url.pathname === '/app/launch.html')) {
    if (!internalAdminSurface) {
      return Response.json(
        {
          error: 'Launch board is available only on the VaultProof internal admin host.',
        },
        {
          status: 404,
          headers: {
            'cache-control': 'no-store',
            'x-robots-tag': 'noindex,nofollow',
          },
        },
      );
    }

    const authorized = await authorizeInternalAdmin(request, env);
    if (authorized instanceof Response) {
      return redirectToInternalAdminLogin(url);
    }

    return new Response(renderEnterprisePlannedAppPage('launch', env), {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex,nofollow',
      },
    });
  }

  if (isReadRequest && (url.pathname === '/app/control' || url.pathname === '/app/control.html')) {
    return new Response(renderEnterpriseControlPage(env), {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex',
      },
    });
  }

  if (isReadRequest && (url.pathname === '/app/org' || url.pathname === '/app/org.html')) {
    return new Response(renderEnterpriseOrgPage(env), {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex',
      },
    });
  }

  if (isReadRequest && url.pathname.startsWith('/app/')) {
    const plannedPageName = url.pathname
      .replace(/^\/app\//, '')
      .replace(/\.html$/, '')
      .replace(/\/+$/, '');
    const plannedPage = renderEnterprisePlannedAppPage(plannedPageName, env);
    if (plannedPage) {
      return new Response(plannedPage, {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'x-robots-tag': 'noindex',
        },
      });
    }
  }

  if (isReadRequest && url.pathname === '/readiness') {
    const readiness = await buildEnterpriseReadiness(hostname, env);
    return Response.json(buildPublicEnterpriseReadiness(readiness), {
      headers: {
        'cache-control': 'no-store',
      },
    });
  }

  const pathSegments = url.pathname.split('/').filter(Boolean);
  if (pathSegments[0] === 'api' && pathSegments[1] === 'v1' && pathSegments[2] === 'internal-admin') {
    if (!internalAdminSurface) {
      return Response.json({ error: 'Internal admin console is not available on this host.' }, { status: 404 });
    }
    const internalAdminResponse = await handleInternalAdminRoutes(request, env, pathSegments.slice(3));
    if (internalAdminResponse) return internalAdminResponse;
  }

  if (pathSegments[0] === 'api' && pathSegments[1] === 'v1' && pathSegments[2] === 'enterprise') {
    const enterpriseExecuteResponse = await handleEnterpriseExecuteRoutes(request, env, pathSegments.slice(3));
    if (enterpriseExecuteResponse) return enterpriseExecuteResponse;
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
    const enterpriseVerifierResponse = await handleEnterpriseVerifierRoutes(request, env, pathSegments.slice(3));
    if (enterpriseVerifierResponse) return enterpriseVerifierResponse;
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

export async function handleEnterpriseControlPlaneRequest(
  request: Request,
  env: EnterpriseControlPlaneEnv = {},
): Promise<Response> {
  const response = await handleEnterpriseControlPlaneRequestInner(request, env);
  return withEnterpriseSecurityHeaders(response);
}

export type { EnterpriseControlPlaneEnv } from './config.js';
