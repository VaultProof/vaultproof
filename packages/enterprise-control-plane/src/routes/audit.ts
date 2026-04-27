import type { EnterpriseControlPlaneEnv } from '../config.js';
import {
  authenticateUser,
  resolveOrganizationMembership,
} from '../auth.js';
import { getSupabase } from '../supabase.js';

function parseDays(request: Request, fallback = 30): number {
  const raw = Number(new URL(request.url).searchParams.get('days'));
  if (!Number.isFinite(raw)) return fallback;
  const days = Math.floor(raw);
  if (days < 1) return 1;
  if (days > 90) return 90;
  return days;
}

function parseLimit(request: Request, fallback = 100): number {
  const raw = Number(new URL(request.url).searchParams.get('limit'));
  if (!Number.isFinite(raw)) return fallback;
  const limit = Math.floor(raw);
  if (limit < 1) return 1;
  if (limit > 500) return 500;
  return limit;
}

function parseSourceFilter(request: Request): 'all' | 'governance' | 'proxy' {
  const raw = new URL(request.url).searchParams.get('source');
  if (raw === 'governance' || raw === 'proxy') return raw;
  return 'all';
}

function parseProjectFilter(request: Request): string | null {
  const raw = new URL(request.url).searchParams.get('project_id');
  return raw?.trim() || null;
}

function parseEventTypeFilter(request: Request): string | null {
  const raw = new URL(request.url).searchParams.get('event_type');
  return raw?.trim() || null;
}

function parseBefore(request: Request): string | null {
  const raw = new URL(request.url).searchParams.get('before');
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function parseQuery(request: Request): string | null {
  const raw = new URL(request.url).searchParams.get('q');
  const normalized = raw?.trim();
  return normalized ? normalized.slice(0, 120) : null;
}

function parseFormat(request: Request): 'json' | 'csv' {
  const raw = new URL(request.url).searchParams.get('format')?.trim().toLowerCase();
  return raw === 'csv' ? 'csv' : 'json';
}

function csvCell(value: unknown): string {
  const raw = value === undefined || value === null
    ? ''
    : typeof value === 'string'
      ? value
      : JSON.stringify(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

function auditEventsToCsv(events: Array<{
  timestamp: string;
  source: string;
  event_type: string;
  actor: string;
  description: string;
  project: { id: string; name: string | null; vp_proj_id: string } | null;
  status: number | null;
  metadata: Record<string, unknown>;
}>): string {
  const headers = [
    'timestamp',
    'source',
    'event_type',
    'actor',
    'project_id',
    'project_name',
    'project_ref',
    'status',
    'description',
    'metadata_json',
  ];
  const rows = events.map((event) => [
    event.timestamp,
    event.source,
    event.event_type,
    event.actor,
    event.project?.id || '',
    event.project?.name || '',
    event.project?.vp_proj_id || '',
    event.status ?? '',
    event.description,
    event.metadata,
  ]);
  return [
    headers.map(csvCell).join(','),
    ...rows.map((row) => row.map(csvCell).join(',')),
  ].join('\n') + '\n';
}

export async function handleEnterpriseAuditRoutes(
  request: Request,
  env: EnterpriseControlPlaneEnv,
  pathSegments: string[],
): Promise<Response | null> {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) return null;
  if (!(request.method === 'GET' && pathSegments.length === 1 && pathSegments[0] === 'audit')) {
    return null;
  }

  const auth = await authenticateUser(request, env);
  if (!auth) {
    return Response.json(
      { error: 'Not authenticated. Pass Authorization: Bearer <supabase jwt>' },
      { status: 401 },
    );
  }

  const membership = await resolveOrganizationMembership(request, env, auth.userId);
  if (!membership) {
    return Response.json({
      organization: null,
      summary: { governanceEvents: 0, proxyEvents: 0, totalEvents: 0 },
      events: [],
    });
  }

  const supabase = getSupabase(env);
  const days = parseDays(request, 30);
  const limit = parseLimit(request, 100);
  const fetchLimit = limit + 1;
  const sourceFilter = parseSourceFilter(request);
  const projectFilter = parseProjectFilter(request);
  const eventTypeFilter = parseEventTypeFilter(request);
  const before = parseBefore(request);
  const searchQuery = parseQuery(request);
  const format = parseFormat(request);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data: projectRows } = await supabase
    .from('projects')
    .select('id, name, vp_proj_id')
    .eq('organization_id', membership.organization_id)
    .is('revoked_at', null);

  const projects = (projectRows || []) as Array<{
    id: string;
    name: string | null;
    vp_proj_id: string;
  }>;
  const projectIds = projects.map((project) => project.id);
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const filteredProjectIds = projectFilter
    ? projectIds.filter((projectId) => projectId === projectFilter)
    : projectIds;

  const governancePromise = sourceFilter !== 'proxy'
    ? (() => {
        let qb = supabase
          .from('organization_audit_events')
          .select('id, organization_id, project_id, actor_user_id, actor_email, event_type, target_type, target_id, description, metadata, created_at')
          .eq('organization_id', membership.organization_id)
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(fetchLimit);

        if (before) qb = qb.lt('created_at', before);
        if (projectFilter) qb = qb.eq('project_id', projectFilter);
        if (eventTypeFilter && eventTypeFilter !== 'proxy_request' && eventTypeFilter !== 'proxy_error') {
          qb = qb.eq('event_type', eventTypeFilter);
        }
        if (searchQuery) {
          const escaped = searchQuery.replace(/[%_,]/g, '\\$&');
          qb = qb.or([
            `event_type.ilike.%${escaped}%`,
            `actor_email.ilike.%${escaped}%`,
            `description.ilike.%${escaped}%`,
            `target_type.ilike.%${escaped}%`,
            `target_id.ilike.%${escaped}%`,
          ].join(','));
        }
        return qb;
      })()
    : Promise.resolve({ data: [] });

  const proxyPromise = sourceFilter !== 'governance' && filteredProjectIds.length
    ? (() => {
        let qb = supabase
          .from('project_access_logs')
          .select('id, project_id, project_key_id, provider, slug, method, upstream_path, status_code, latency_ms, error, metadata, timestamp')
          .in('project_id', filteredProjectIds)
          .gte('timestamp', since)
          .order('timestamp', { ascending: false })
          .limit(fetchLimit);

        if (before) qb = qb.lt('timestamp', before);
        if (searchQuery) {
          const escaped = searchQuery.replace(/[%_,]/g, '\\$&');
          qb = qb.or([
            `provider.ilike.%${escaped}%`,
            `slug.ilike.%${escaped}%`,
            `method.ilike.%${escaped}%`,
            `upstream_path.ilike.%${escaped}%`,
            `error.ilike.%${escaped}%`,
          ].join(','));
        }
        return qb;
      })()
    : Promise.resolve({ data: [] });

  const keyPromise = filteredProjectIds.length
    ? supabase
        .from('project_keys')
        .select('id, project_id, provider, slug')
        .in('project_id', filteredProjectIds)
    : Promise.resolve({ data: [] });

  const [{ data: governanceRows }, { data: proxyRows }, { data: keyRows }] = await Promise.all([
    governancePromise,
    proxyPromise,
    keyPromise,
  ]);

  const keyById = new Map(((keyRows || []) as Array<{
    id: string;
    project_id: string;
    provider: string;
    slug: string | null;
  }>).map((key) => [key.id, key]));

  const governanceEvents = ((governanceRows || []) as Array<{
    id: string;
    project_id: string | null;
    actor_email: string | null;
    event_type: string;
    target_type: string;
    target_id: string | null;
    description: string;
    metadata: Record<string, unknown> | null;
    created_at: string;
  }>).map((event) => {
    const project = event.project_id ? projectById.get(event.project_id) : null;
    return {
      id: `governance:${event.id}`,
      source: 'governance' as const,
      timestamp: event.created_at,
      event_type: event.event_type,
      actor: event.actor_email || 'system',
      description: event.description,
      project: project
        ? {
            id: project.id,
            name: project.name,
            vp_proj_id: project.vp_proj_id,
          }
        : null,
      status: null,
      metadata: {
        target_type: event.target_type,
        target_id: event.target_id,
        ...(event.metadata || {}),
      },
    };
  });

  const proxyEvents = ((proxyRows || []) as Array<{
    id: string;
    project_id: string;
    project_key_id: string | null;
    provider: string | null;
    slug: string | null;
    method: string | null;
    upstream_path: string | null;
    status_code: number | null;
    latency_ms: number | null;
    error: string | null;
    metadata: Record<string, unknown> | null;
    timestamp: string;
  }>).map((event) => {
    const project = projectById.get(event.project_id) || null;
    const key = event.project_key_id ? keyById.get(event.project_key_id) : null;
    const method = (event.method || '').toUpperCase();
    const endpoint = event.upstream_path || '/';
    const provider = key?.provider || event.provider || 'unknown';
    const label = key?.slug || event.slug || provider;
    return {
      id: `proxy:${event.id}`,
      source: 'proxy' as const,
      timestamp: event.timestamp,
      event_type: (event.status_code || 0) >= 400 || event.error ? 'proxy_error' : 'proxy_request',
      actor: 'system',
      description: [method, endpoint].filter(Boolean).join(' ').trim() || `Proxy request via ${label}`,
      project: project
        ? {
            id: project.id,
            name: project.name,
            vp_proj_id: project.vp_proj_id,
          }
        : null,
      status: event.status_code ?? (event.error ? 0 : 200),
      metadata: {
        provider,
        slug: label,
        endpoint,
        method,
        latency_ms: event.latency_ms,
        error: event.error,
        ...(event.metadata || {}),
      },
    };
  }).filter((event) => {
    if (!eventTypeFilter) return true;
    return event.event_type === eventTypeFilter;
  });

  const combinedEvents = [...governanceEvents, ...proxyEvents];
  const events = combinedEvents
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
  const hasMore = governanceEvents.length > limit || proxyEvents.length > limit || combinedEvents.length > limit;
  const nextBefore = hasMore && events.length ? events[events.length - 1].timestamp : null;

  if (format === 'csv') {
    const filename = `vaultproof-enterprise-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    return new Response(auditEventsToCsv(events), {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
      },
    });
  }

  return Response.json({
    organization: {
      id: membership.organization_id,
      name: membership.organization_name,
      kind: membership.organization_kind,
      current_role: membership.organization_role,
    },
    summary: {
      governanceEvents: Math.min(governanceEvents.length, limit),
      proxyEvents: Math.min(proxyEvents.length, limit),
      totalEvents: events.length,
    },
    filters: {
      source: sourceFilter,
      project_id: projectFilter,
      event_type: eventTypeFilter,
      before,
      q: searchQuery,
      format,
      days,
      limit,
    },
    has_more: hasMore,
    next_before: nextBefore,
    events,
  });
}
