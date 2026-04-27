import type { EnterpriseControlPlaneEnv } from '../config.js';
import {
  authenticateUser,
  getAccessibleProject,
  hasRequiredProjectRole,
  listAccessibleProjects,
  resolveOrganizationMembership,
} from '../auth.js';
import { writeGovernanceAuditEvent } from '../audit.js';
import { getSupabase } from '../supabase.js';

interface ProjectWriteBody {
  name?: string | null;
  allowed_origins?: string | null;
  strict_origin?: boolean;
  caller_lock_policy?: unknown;
}

type CallerLockPolicy = {
  allowed_providers?: string[];
  allowed_methods?: string[];
  allowed_upstream_hosts?: string[];
  allowed_upstream_path_prefixes?: string[];
  rate_limit_per_minute?: number;
  allowed_customer_gateways?: string[];
  allowed_client_classes?: string[];
  allowed_fleet_ids?: string[];
  allowed_firmware_versions?: string[];
  allowed_ip_cidrs?: string[];
  allowed_client_certificate_thumbprints?: string[];
  allowed_client_certificate_subjects?: string[];
  require_device_id?: boolean;
  provider_overrides?: Record<string, CallerLockPolicy>;
};

function normalizeAllowedOrigins(raw: string | null | undefined): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw.trim() === '') {
    return { ok: true, value: null };
  }

  const normalized = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      try {
        return new URL(origin).origin.toLowerCase();
      } catch {
        return null;
      }
    });

  if (normalized.some((origin) => origin === null)) {
    return { ok: false, error: 'allowed_origins must be a comma-separated list of valid origins' };
  }

  return { ok: true, value: [...new Set(normalized)].join(',') };
}

function normalizeStringList(value: unknown, field: string): { ok: true; value: string[] | undefined } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, error: `${field} must be an array of strings` };

  const normalized = value
    .map((item) => typeof item === 'string' ? item.trim().toLowerCase() : '')
    .filter(Boolean);
  if (normalized.length !== value.filter((item) => typeof item === 'string' && item.trim()).length) {
    return { ok: false, error: `${field} must contain only non-empty strings` };
  }

  return { ok: true, value: [...new Set(normalized)] };
}

function normalizeMethodList(value: unknown, field: string): { ok: true; value: string[] | undefined } | { ok: false; error: string } {
  const normalized = normalizeStringList(value, field);
  if (!normalized.ok || normalized.value === undefined) return normalized;
  const methods = normalized.value.map((method) => method.toUpperCase());
  if (methods.some((method) => !/^[A-Z]+$/.test(method))) {
    return { ok: false, error: `${field} must contain HTTP method names` };
  }
  return { ok: true, value: [...new Set(methods)] };
}

function normalizeHostList(value: unknown, field: string): { ok: true; value: string[] | undefined } | { ok: false; error: string } {
  const normalized = normalizeStringList(value, field);
  if (!normalized.ok || normalized.value === undefined) return normalized;

  const hosts = normalized.value.map((hostOrUrl) => {
    try {
      return new URL(hostOrUrl.includes('://') ? hostOrUrl : `https://${hostOrUrl}`).hostname.toLowerCase();
    } catch {
      return null;
    }
  });
  if (hosts.some((host) => !host)) {
    return { ok: false, error: `${field} must contain valid hostnames or URLs` };
  }
  return { ok: true, value: [...new Set(hosts as string[])] };
}

function normalizePathPrefixList(value: unknown, field: string): { ok: true; value: string[] | undefined } | { ok: false; error: string } {
  const normalized = normalizeStringList(value, field);
  if (!normalized.ok || normalized.value === undefined) return normalized;
  const prefixes = normalized.value.map((prefix) => prefix.startsWith('/') ? prefix : `/${prefix}`);
  return { ok: true, value: [...new Set(prefixes)] };
}

function normalizeRateLimit(value: unknown, field: string): { ok: true; value: number | undefined } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null) return { ok: true, value: undefined };
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 60000) {
    return { ok: false, error: `${field} must be an integer between 1 and 60000` };
  }
  return { ok: true, value };
}

function normalizeCallerLockPolicyObject(
  input: Record<string, unknown>,
  fieldPrefix: string,
  allowProviderOverrides: boolean,
): { ok: true; value: CallerLockPolicy } | { ok: false; error: string } {
  const policy: CallerLockPolicy = {};

  const allowedProviders = normalizeStringList(input.allowed_providers, `${fieldPrefix}.allowed_providers`);
  if (!allowedProviders.ok) return allowedProviders;
  if (allowedProviders.value !== undefined) policy.allowed_providers = allowedProviders.value;

  const allowedMethods = normalizeMethodList(input.allowed_methods, `${fieldPrefix}.allowed_methods`);
  if (!allowedMethods.ok) return allowedMethods;
  if (allowedMethods.value !== undefined) policy.allowed_methods = allowedMethods.value;

  const allowedUpstreamHosts = normalizeHostList(input.allowed_upstream_hosts, `${fieldPrefix}.allowed_upstream_hosts`);
  if (!allowedUpstreamHosts.ok) return allowedUpstreamHosts;
  if (allowedUpstreamHosts.value !== undefined) policy.allowed_upstream_hosts = allowedUpstreamHosts.value;

  const allowedUpstreamPathPrefixes = normalizePathPrefixList(input.allowed_upstream_path_prefixes, `${fieldPrefix}.allowed_upstream_path_prefixes`);
  if (!allowedUpstreamPathPrefixes.ok) return allowedUpstreamPathPrefixes;
  if (allowedUpstreamPathPrefixes.value !== undefined) {
    policy.allowed_upstream_path_prefixes = allowedUpstreamPathPrefixes.value;
  }

  const rateLimit = normalizeRateLimit(input.rate_limit_per_minute, `${fieldPrefix}.rate_limit_per_minute`);
  if (!rateLimit.ok) return rateLimit;
  if (rateLimit.value !== undefined) policy.rate_limit_per_minute = rateLimit.value;

  for (const [field, value] of Object.entries({
    allowed_customer_gateways: input.allowed_customer_gateways,
    allowed_client_classes: input.allowed_client_classes,
    allowed_fleet_ids: input.allowed_fleet_ids,
    allowed_firmware_versions: input.allowed_firmware_versions,
    allowed_ip_cidrs: input.allowed_ip_cidrs,
    allowed_client_certificate_thumbprints: input.allowed_client_certificate_thumbprints,
    allowed_client_certificate_subjects: input.allowed_client_certificate_subjects,
  })) {
    const normalized = normalizeStringList(value, `${fieldPrefix}.${field}`);
    if (!normalized.ok) return normalized;
    if (normalized.value !== undefined) {
      (policy as Record<string, unknown>)[field] = normalized.value;
    }
  }

  if (input.require_device_id !== undefined) {
    if (typeof input.require_device_id !== 'boolean') {
      return { ok: false, error: `${fieldPrefix}.require_device_id must be a boolean` };
    }
    policy.require_device_id = input.require_device_id;
  }

  if (input.provider_overrides !== undefined) {
    if (!allowProviderOverrides) {
      return { ok: false, error: `${fieldPrefix}.provider_overrides cannot contain nested provider_overrides` };
    }
    if (
      typeof input.provider_overrides !== 'object'
      || input.provider_overrides === null
      || Array.isArray(input.provider_overrides)
    ) {
      return { ok: false, error: `${fieldPrefix}.provider_overrides must be an object keyed by provider slug` };
    }

    const overrides: Record<string, CallerLockPolicy> = {};
    for (const [providerKeyRaw, overrideRaw] of Object.entries(input.provider_overrides as Record<string, unknown>)) {
      const providerKey = providerKeyRaw.trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(providerKey)) {
        return { ok: false, error: `${fieldPrefix}.provider_overrides keys must be provider slugs using lowercase letters, numbers, hyphen, or underscore` };
      }
      if (
        typeof overrideRaw !== 'object'
        || overrideRaw === null
        || Array.isArray(overrideRaw)
      ) {
        return { ok: false, error: `${fieldPrefix}.provider_overrides.${providerKey} must be an object` };
      }

      const normalizedOverride = normalizeCallerLockPolicyObject(
        overrideRaw as Record<string, unknown>,
        `${fieldPrefix}.provider_overrides.${providerKey}`,
        false,
      );
      if (!normalizedOverride.ok) return normalizedOverride;
      overrides[providerKey] = normalizedOverride.value;
    }
    policy.provider_overrides = overrides;
  }

  return { ok: true, value: policy };
}

function normalizeCallerLockPolicy(raw: unknown): { ok: true; value: CallerLockPolicy } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: {} };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'caller_lock_policy must be an object' };
  }

  return normalizeCallerLockPolicyObject(raw as Record<string, unknown>, 'caller_lock_policy', true);
}

function isDeniedStatus(statusCode: number | null | undefined): boolean {
  return statusCode === 401 || statusCode === 403 || statusCode === 429;
}

async function listActiveProjects(
  env: EnterpriseControlPlaneEnv,
  userId: string,
  organizationId?: string | null,
): Promise<Array<{ id: string; vp_proj_id: string; name: string | null }>> {
  const projects = await listAccessibleProjects(env, userId, organizationId || null);
  return projects.map((project) => ({
    id: project.id,
    vp_proj_id: project.vp_proj_id,
    name: project.name,
  }));
}

async function buildInitOverviewStats(
  projects: Array<{ id: string; vp_proj_id: string; name: string | null }>,
  supabase: any,
): Promise<Record<string, unknown>> {
  const projectIds = projects.map((p) => p.id);
  const healthWindowDays = 7;
  const healthWindowSince = new Date(Date.now() - (healthWindowDays * 24 * 60 * 60 * 1000)).toISOString();

  if (projectIds.length === 0) {
    return {
      totalProjects: 0,
      totalKeys: 0,
      providers: [],
      providerCount: 0,
      activeApps: 0,
      totalCalls: 0,
      errorCalls: 0,
      deniedCalls: 0,
      errorRate: 0,
      healthWindowDays,
      projectHealth: [],
      alerts: [{
        id: 'setup:no_projects',
        severity: 'info',
        title: 'No active projects yet',
        detail: 'Create one project and connect one provider to start a pilot review cycle.',
        project_id: null,
        project_name: null,
      }],
      pilotReview: {
        status: 'setup',
        headline: 'No active projects yet',
        recommendation: 'Create one team project, connect one provider, and route a small amount of traffic through VaultProof first.',
        evaluationWindowDays: healthWindowDays,
        projectsWithTraffic: 0,
        projectsNeedingAttention: 0,
        topProject: null,
      },
      recentActivity: [],
    };
  }

  const [{ data: keyRows }, totalCallsRes, errorCallsRes, deniedCallsRes, recentLogsRes, projectHealthLogsRes] = await Promise.all([
    supabase
      .from('project_keys')
      .select('id, project_id, provider, slug')
      .in('project_id', projectIds)
      .is('revoked_at', null),
    supabase
      .from('project_access_logs')
      .select('id', { count: 'exact', head: true })
      .in('project_id', projectIds),
    supabase
      .from('project_access_logs')
      .select('id', { count: 'exact', head: true })
      .in('project_id', projectIds)
      .gte('status_code', 400),
    supabase
      .from('project_access_logs')
      .select('id', { count: 'exact', head: true })
      .in('project_id', projectIds)
      .in('status_code', [401, 403, 429]),
    supabase
      .from('project_access_logs')
      .select('id, project_key_id, provider, slug, method, upstream_path, status_code, latency_ms, timestamp, metadata')
      .in('project_id', projectIds)
      .order('timestamp', { ascending: false })
      .limit(20),
    supabase
      .from('project_access_logs')
      .select('project_id, status_code, timestamp')
      .in('project_id', projectIds)
      .gte('timestamp', healthWindowSince),
  ]);

  const keys = (keyRows || []) as Array<{ id: string; provider: string; slug: string | null }>;
  const providers = [...new Set(keys.map((k) => k.provider).filter(Boolean))];
  const keyMap = new Map<string, { provider: string; label: string }>();
  for (const key of keys) {
    keyMap.set(key.id, { provider: key.provider, label: key.slug || key.provider });
  }

  const totalCalls = totalCallsRes?.count || 0;
  const errorCalls = errorCallsRes?.count || 0;
  const deniedCalls = deniedCallsRes?.count || 0;
  const errorRate = totalCalls > 0 ? (errorCalls / totalCalls) * 100 : 0;

  const projectHealthStats = new Map<string, {
    project_id: string;
    name: string | null;
    vp_proj_id: string;
    calls: number;
    errors: number;
    denied: number;
    lastActivity: string | null;
  }>();
  for (const project of projects) {
    projectHealthStats.set(project.id, {
      project_id: project.id,
      name: project.name,
      vp_proj_id: project.vp_proj_id,
      calls: 0,
      errors: 0,
      denied: 0,
      lastActivity: null,
    });
  }

  for (const log of (projectHealthLogsRes?.data || []) as Array<{ project_id: string; status_code: number | null; timestamp: string }>) {
    const stat = projectHealthStats.get(log.project_id);
    if (!stat) continue;
    stat.calls += 1;
    if ((log.status_code || 0) >= 400) stat.errors += 1;
    if (isDeniedStatus(log.status_code)) stat.denied += 1;
    if (!stat.lastActivity || log.timestamp > stat.lastActivity) stat.lastActivity = log.timestamp;
  }

  const projectHealth = [...projectHealthStats.values()].sort((a, b) => {
    if (b.denied !== a.denied) return b.denied - a.denied;
    if (b.errors !== a.errors) return b.errors - a.errors;
    if (b.calls !== a.calls) return b.calls - a.calls;
    return a.project_id.localeCompare(b.project_id);
  });

  const projectsWithTraffic = projectHealth.filter((project) => project.calls > 0);
  const projectsNeedingAttention = projectHealth.filter((project) => project.denied > 0 || project.errors > 0);
  const topProject = projectHealth.find((project) => project.calls > 0) || null;

  const alerts: Array<Record<string, unknown>> = [];
  if (keys.length === 0) {
    alerts.push({
      id: 'setup:no_provider_keys',
      severity: 'info',
      title: 'No provider credentials connected',
      detail: 'Add one provider key to turn this organization into a real pilot instead of a shell setup.',
      project_id: null,
      project_name: null,
    });
  }
  if (keys.length > 0 && totalCalls === 0) {
    alerts.push({
      id: 'setup:no_traffic',
      severity: 'info',
      title: 'No runtime traffic observed yet',
      detail: 'A provider is configured, but the current project set has not sent traffic through VaultProof yet.',
      project_id: null,
      project_name: null,
    });
  }
  if (deniedCalls > 0) {
    alerts.push({
      id: 'traffic:denied_present',
      severity: deniedCalls >= 10 ? 'critical' : 'warning',
      title: deniedCalls >= 10 ? 'Denied request spike detected' : 'Denied requests need review',
      detail: `${deniedCalls} denied requests were observed in the current traffic set.`,
      project_id: null,
      project_name: null,
    });
  }

  const recentLogs = (recentLogsRes?.data || []) as Array<{
    project_key_id: string | null;
    provider: string | null;
    slug: string | null;
    method: string | null;
    upstream_path: string | null;
    status_code: number | null;
    latency_ms: number | null;
    timestamp: string;
  }>;

  const recentActivity = recentLogs.map((log) => {
    const keyInfo = log.project_key_id ? keyMap.get(log.project_key_id) : null;
    const endpoint = log.upstream_path || '';
    const method = (log.method || '').toUpperCase();
    const description = [method, endpoint].filter(Boolean).join(' ').trim() || (log.provider || log.slug || 'Proxy request');
    return {
      action: 'transparent_proxy',
      timestamp: log.timestamp,
      description,
      keySlot: {
        provider: keyInfo?.provider || log.provider || 'unknown',
        label: keyInfo?.label || log.slug || log.provider || 'unknown',
      },
      metadata: {
        status_code: log.status_code,
        endpoint,
        latency_ms: log.latency_ms,
      },
    };
  });

  return {
    totalProjects: projectIds.length,
    totalKeys: keys.length,
    providers,
    providerCount: providers.length,
    activeApps: providers.length,
    totalCalls,
    errorCalls,
    deniedCalls,
    errorRate,
    healthWindowDays,
    projectHealth,
    alerts: alerts.slice(0, 6),
    pilotReview: {
      status: totalCalls === 0 ? 'setup' : deniedCalls > 0 || errorRate >= 2 || projectsNeedingAttention.length > 0 ? 'watch' : 'healthy',
      headline: totalCalls === 0 ? 'Pilot is still in setup' : deniedCalls > 0 || errorRate >= 2 || projectsNeedingAttention.length > 0 ? 'Pilot is running, but keep it under watch' : 'Pilot looks healthy',
      recommendation: totalCalls === 0
        ? 'Route one real workflow through the proxy before expanding the rollout.'
        : deniedCalls > 0 || errorRate >= 2 || projectsNeedingAttention.length > 0
          ? 'Traffic is flowing, but there are still denial or error signals to clean up before using the pilot as a sales proof point.'
          : 'Traffic is flowing without meaningful denial or error pressure.',
      evaluationWindowDays: healthWindowDays,
      projectsWithTraffic: projectsWithTraffic.length,
      projectsNeedingAttention: projectsNeedingAttention.length,
      topProject: topProject ? {
        project_id: topProject.project_id,
        name: topProject.name,
        vp_proj_id: topProject.vp_proj_id,
        calls: topProject.calls,
        denied: topProject.denied,
        errors: topProject.errors,
      } : null,
    },
    recentActivity,
  };
}

export async function handleEnterpriseProjectRoutes(
  request: Request,
  env: EnterpriseControlPlaneEnv,
  pathSegments: string[],
): Promise<Response | null> {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) return null;

  const auth = await authenticateUser(request, env);
  if (!auth) {
    return Response.json(
      { error: 'Not authenticated. Pass Authorization: Bearer <supabase jwt>' },
      { status: 401 },
    );
  }

  const membership = await resolveOrganizationMembership(request, env, auth.userId);
  const organizationId = membership?.organization_id || null;
  const supabase = getSupabase(env);

  if (request.method === 'GET' && pathSegments.length === 1 && pathSegments[0] === 'projects') {
    const projects = await listAccessibleProjects(env, auth.userId, organizationId);
    const projectIds = projects.map((project) => project.id);
    const { data: keyRows } = projectIds.length
      ? await supabase
          .from('project_keys')
          .select('id, project_id, provider, slug')
          .in('project_id', projectIds)
          .is('revoked_at', null)
      : { data: [] };
    const providerSlotsByProject = ((keyRows || []) as Array<{
      id: string;
      project_id: string;
      provider: string;
      slug: string | null;
    }>).reduce<Map<string, Array<{
      key_id: string;
      provider: string;
      slug: string;
    }>>>((acc, row) => {
      const existing = acc.get(row.project_id) || [];
      existing.push({
        key_id: row.id,
        provider: row.provider,
        slug: row.slug || row.provider,
      });
      acc.set(row.project_id, existing);
      return acc;
    }, new Map());

    return Response.json({
      projects: projects.map((project) => ({
        id: project.id,
        vp_proj_id: project.vp_proj_id,
        name: project.name,
        allowed_origins: project.allowed_origins,
        strict_origin: project.strict_origin,
        caller_lock_policy: project.caller_lock_policy || {},
        created_at: project.created_at,
        revoked_at: project.revoked_at,
        project_role: project.project_role,
        access_via: project.access_via,
        provider_slots: providerSlotsByProject.get(project.id) || [],
      })),
    });
  }

  if (
    request.method === 'GET' &&
    pathSegments.length === 3 &&
    pathSegments[0] === 'projects' &&
    pathSegments[1] === 'stats' &&
    pathSegments[2] === 'overview'
  ) {
    const projects = await listActiveProjects(env, auth.userId, organizationId);
    const overview = await buildInitOverviewStats(projects, supabase);
    return Response.json(overview);
  }

  if (request.method === 'PUT' && pathSegments.length === 2 && pathSegments[0] === 'projects') {
    const projectId = pathSegments[1];
    const project = await getAccessibleProject(env, auth.userId, projectId);
    if (!project) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }
    if (!hasRequiredProjectRole(project.project_role, 'admin')) {
      return Response.json({ error: 'Insufficient project permissions' }, { status: 403 });
    }

    const { data: existingProject } = await supabase
      .from('projects')
      .select('id, allowed_origins, strict_origin, caller_lock_policy')
      .eq('id', projectId)
      .is('revoked_at', null)
      .maybeSingle();

    if (!existingProject) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }

    let body: ProjectWriteBody;
    try {
      body = (await request.json()) as ProjectWriteBody;
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    if (body.strict_origin !== undefined && typeof body.strict_origin !== 'boolean') {
      return Response.json({ error: 'strict_origin must be a boolean' }, { status: 400 });
    }

    const effectiveAllowedOrigins = body.allowed_origins ?? existingProject.allowed_origins ?? null;
    const allowedOrigins = normalizeAllowedOrigins(effectiveAllowedOrigins);
    if (!allowedOrigins.ok) {
      return Response.json({ error: allowedOrigins.error }, { status: 400 });
    }

    const effectiveStrictOrigin = body.strict_origin ?? existingProject.strict_origin;
    if (effectiveStrictOrigin && !allowedOrigins.value) {
      return Response.json({ error: 'strict_origin requires allowed_origins' }, { status: 400 });
    }

    const updates: {
      name?: string | null;
      allowed_origins?: string | null;
      strict_origin?: boolean;
      caller_lock_policy?: CallerLockPolicy;
      updated_at: string;
    } = {
      updated_at: new Date().toISOString(),
    };

    const callerLockPolicy = body.caller_lock_policy === undefined
      ? null
      : normalizeCallerLockPolicy(body.caller_lock_policy);
    if (callerLockPolicy && !callerLockPolicy.ok) {
      return Response.json({ error: callerLockPolicy.error }, { status: 400 });
    }

    if (body.name !== undefined) updates.name = body.name || null;
    if (body.allowed_origins !== undefined) updates.allowed_origins = allowedOrigins.value;
    if (body.strict_origin !== undefined) updates.strict_origin = body.strict_origin;
    if (callerLockPolicy?.ok) updates.caller_lock_policy = callerLockPolicy.value;

    const { data, error } = await supabase
      .from('projects')
      .update(updates)
      .eq('id', projectId)
      .is('revoked_at', null)
      .select('id, vp_proj_id, name, allowed_origins, strict_origin, caller_lock_policy, created_at')
      .single();

    if (error || !data) {
      return Response.json({ error: 'Failed to update project' }, { status: 500 });
    }

    if (project.organization_id || organizationId) {
      await writeGovernanceAuditEvent(env, {
        organization_id: project.organization_id || organizationId || '',
        project_id: project.id,
        actor_user_id: auth.userId,
        actor_email: auth.email,
        event_type: 'project_policy_updated',
        target_type: 'project',
        target_id: project.id,
        description: `Updated project policy for ${data.name || data.vp_proj_id}`,
        metadata: {
          allowed_origins: data.allowed_origins,
          strict_origin: data.strict_origin,
          caller_lock_policy: data.caller_lock_policy || {},
          updated_via: 'enterprise_control_plane',
        },
      });
    }

    return Response.json({
      project: {
        id: data.id,
        vp_proj_id: data.vp_proj_id,
        name: data.name,
        allowed_origins: data.allowed_origins,
        strict_origin: data.strict_origin,
        caller_lock_policy: data.caller_lock_policy || {},
        created_at: data.created_at,
      },
    });
  }

  return null;
}
