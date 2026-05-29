import type { EnterpriseControlPlaneEnv } from '../config.js';
import {
  type AccessibleProjectSummary,
  authenticateUser,
  getAccessibleProject,
  hasRequiredOrganizationRole,
  hasRequiredProjectRole,
  listAccessibleProjects,
  listOrganizationMemberships,
  type OrganizationMembershipContext,
  resolveOrganizationMembershipFromList,
} from '../auth.js';
import { writeGovernanceAuditEvent } from '../audit.js';
import { getSupabase } from '../supabase.js';

interface ProjectWriteBody {
  name?: string | null;
  allowed_origins?: string | null;
  strict_origin?: boolean;
  caller_lock_policy?: unknown;
}

interface RevokeProviderBody {
  reason?: string | null;
}

interface CreateProviderSlotBody {
  provider?: string | null;
  slug?: string | null;
  upstream_base_url?: string | null;
  auth_header_name?: string | null;
  auth_header_template?: string | null;
  extra_headers?: unknown;
  api_key?: string | null;
  provider_key?: string | null;
}

type ProviderMaterialMode = 'sealed-live' | 'demo-placeholder' | 'missing' | 'mixed';

type ProviderSlotSummary = {
  key_id: string;
  provider: string;
  slug: string;
  material_mode: ProviderMaterialMode;
  material_ready: boolean;
};

type ProjectBootstrapSummary = {
  id: string;
  organization_id: string | null;
  vp_proj_id: string;
  name: string | null;
  allowed_origins: string | null;
  strict_origin: boolean;
  caller_lock_policy: Record<string, unknown>;
  created_at: string;
  revoked_at: string | null;
  project_role: string;
  access_via: string;
  provider_slots: ProviderSlotSummary[];
};

type OrganizationBootstrapSummary = {
  id: string;
  name: string;
  kind: 'personal' | 'team';
  role: string;
  is_active: boolean;
};

type ProjectsBootstrapPayload = {
  organizations: OrganizationBootstrapSummary[];
  active_organization_id: string | null;
  projects: ProjectBootstrapSummary[];
  overview: Record<string, unknown>;
};

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
  allowed_email_sender_domains?: string[];
  allowed_email_recipient_domains?: string[];
  allowed_email_recipients?: string[];
  allowed_email_template_ids?: string[];
  require_email_template_id?: boolean;
  provider_overrides?: Record<string, CallerLockPolicy>;
};

function generateProjectId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `vp-proj-${hex}`;
}

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
    allowed_email_sender_domains: input.allowed_email_sender_domains,
    allowed_email_recipient_domains: input.allowed_email_recipient_domains,
    allowed_email_recipients: input.allowed_email_recipients,
    allowed_email_template_ids: input.allowed_email_template_ids,
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

  if (input.require_email_template_id !== undefined) {
    if (typeof input.require_email_template_id !== 'boolean') {
      return { ok: false, error: `${fieldPrefix}.require_email_template_id must be a boolean` };
    }
    policy.require_email_template_id = input.require_email_template_id;
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

function normalizeProviderSlug(raw: string | null | undefined, field: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = String(raw || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value)) {
    return { ok: false, error: `${field} must use lowercase letters, numbers, hyphens, or underscores` };
  }
  return { ok: true, value };
}

function isPrivateIpv4(hostname: string): boolean {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const parts = match.slice(1).map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || a === 0;
}

function normalizeHostnameLiteral(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = normalizeHostnameLiteral(hostname);
  if (!normalized.includes(':')) return false;
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('::ffff:')) {
    return isPrivateIpv4(normalized.slice('::ffff:'.length));
  }
  const firstHextet = Number.parseInt(normalized.split(':')[0] || '0', 16);
  if (!Number.isFinite(firstHextet)) return true;
  return (firstHextet >= 0xfc00 && firstHextet <= 0xfdff)
    || (firstHextet >= 0xfe80 && firstHextet <= 0xfebf);
}

function isBlockedMetadataHost(hostname: string): boolean {
  const normalized = normalizeHostnameLiteral(hostname);
  return normalized === 'metadata'
    || normalized === 'metadata.google.internal'
    || normalized === 'metadata.google'
    || normalized === '169.254.169.254';
}

function isBlockedProviderHostname(hostname: string): boolean {
  const normalized = normalizeHostnameLiteral(hostname);
  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized.endsWith('.local')
    || isPrivateIpv4(normalized)
    || isPrivateIpv6(normalized)
    || isBlockedMetadataHost(normalized);
}

function normalizeUpstreamBaseUrl(raw: string | null | undefined): { ok: true; value: string } | { ok: false; error: string } {
  const value = String(raw || '').trim();
  if (!value) return { ok: false, error: 'upstream_base_url is required' };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: 'upstream_base_url must be a valid URL' };
  }
  if (url.protocol !== 'https:') return { ok: false, error: 'upstream_base_url must use https' };
  if (url.username || url.password) return { ok: false, error: 'upstream_base_url cannot include credentials' };
  const hostname = url.hostname.toLowerCase();
  if (isBlockedProviderHostname(hostname)) {
    return { ok: false, error: 'upstream_base_url must point to a public provider host' };
  }
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
  return { ok: true, value: url.toString().replace(/\/$/, '') };
}

function normalizeHeaderName(raw: string | null | undefined, field: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = String(raw || '').trim().toLowerCase();
  if (!/^[!#$%&'*+\-.^_`|~0-9a-z]+$/.test(value)) {
    return { ok: false, error: `${field} must be a valid HTTP header name` };
  }
  return { ok: true, value };
}

function normalizeAuthHeaderTemplate(raw: string | null | undefined): { ok: true; value: string } | { ok: false; error: string } {
  const value = String(raw || '').trim();
  if (!value || value.length > 300) return { ok: false, error: 'auth_header_template is required' };
  if (!value.includes('{key}')) return { ok: false, error: 'auth_header_template must include {key}' };
  if (/[\r\n]/.test(value)) return { ok: false, error: 'auth_header_template cannot contain line breaks' };
  return { ok: true, value };
}

function extraHeaderValueLooksLikeSecret(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('{key}')) return false;
  if (/^(bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{16,}$/i.test(trimmed)) return true;
  if (/(?:sk-[A-Za-z0-9]|ghp_|github_pat_|xox[abprs]-|SG\.|re_[A-Za-z0-9]|glpat-|hf_|pcsk_|xkeysib-|secret_|ntn_|api[_-]?key|client[_-]?secret)/i.test(trimmed)) {
    return true;
  }
  return /^[A-Za-z0-9._~+/=-]{48,}$/.test(trimmed);
}

function normalizeExtraHeaders(raw: unknown): { ok: true; value: Record<string, string> } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: {} };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'extra_headers must be an object' };
  }

  const normalized: Record<string, string> = {};
  for (const [nameRaw, valueRaw] of Object.entries(raw as Record<string, unknown>)) {
    const name = normalizeHeaderName(nameRaw, 'extra_headers');
    if (!name.ok) return name;
    if (name.value === 'authorization' || name.value === 'proxy-authorization') {
      return { ok: false, error: 'extra_headers cannot override authorization headers' };
    }
    if (typeof valueRaw !== 'string' || valueRaw.length > 500 || /[\r\n]/.test(valueRaw)) {
      return { ok: false, error: `extra_headers.${name.value} must be a short string without line breaks` };
    }
    if (extraHeaderValueLooksLikeSecret(valueRaw)) {
      return { ok: false, error: `extra_headers.${name.value} must not contain raw secrets; use {key} for the protected provider key or store only non-secret fixed headers` };
    }
    normalized[name.value] = valueRaw;
  }

  return { ok: true, value: normalized };
}

async function parseOptionalRevokeBody(request: Request): Promise<RevokeProviderBody> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as RevokeProviderBody;
  } catch {
    return {};
  }
}

function isDeniedStatus(statusCode: number | null | undefined): boolean {
  return statusCode === 401 || statusCode === 403 || statusCode === 429;
}

type AccessLogRecentRow = {
  project_id: string | null;
  project_key_id: string | null;
  provider: string | null;
  slug: string | null;
  method: string | null;
  upstream_path: string | null;
  status_code: number | null;
  latency_ms: number | null;
  timestamp: string;
  metadata: unknown;
};

type ProjectHealthAggregate = {
  project_id: string;
  calls: number;
  errors: number;
  denied: number;
  lastActivity: string | null;
};

type DailyCallTrend = {
  day: string;
  calls: number;
  errors: number;
  denied: number;
};

type AccessLogOverview = {
  source: 'rollup_rpc' | 'raw_fallback';
  totalCalls: number;
  errorCalls: number;
  deniedCalls: number;
  projectHealth: ProjectHealthAggregate[];
  recentLogs: AccessLogRecentRow[];
  callTrend: DailyCallTrend[];
};

type OverviewProviderKey = {
  id: string;
  project_id?: string | null;
  provider: string;
  slug: string | null;
  material_mode?: ProviderMaterialMode;
  material_ready?: boolean;
};

const DASHBOARD_TRAFFIC_WINDOW_DAYS = 30;

function countValue(value: unknown): number {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeApiProtocol(value: unknown): 'rest' | 'graphql' | 'unknown' {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    value = (value as Record<string, unknown>).protocol;
  }
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'graphql' || normalized === 'gql') return 'graphql';
  if (normalized === 'rest' || normalized === 'http' || normalized === 'json') return 'rest';
  return 'unknown';
}

function inferApiProtocolFromPath(value: unknown): 'rest' | 'graphql' | 'unknown' {
  const path = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!path) return 'unknown';
  if (
    path === '/graphql'
    || path.endsWith('/graphql')
    || path.includes('/graphql/')
    || path === '/gql'
    || path.endsWith('/gql')
    || path.includes('/gql/')
  ) return 'graphql';
  return 'rest';
}

function getAccessLogApiProtocol(log: { upstream_path?: string | null; metadata?: unknown }): 'rest' | 'graphql' | 'unknown' {
  const metadata = objectOrEmpty(log.metadata);
  const fromMetadata = normalizeApiProtocol(metadata.api_protocol || metadata.api_interface);
  return fromMetadata !== 'unknown' ? fromMetadata : inferApiProtocolFromPath(log.upstream_path);
}

function isProviderMaterialMode(value: unknown): value is ProviderMaterialMode {
  return value === 'sealed-live'
    || value === 'demo-placeholder'
    || value === 'missing'
    || value === 'mixed';
}

function resolveProviderMaterialMode(row: {
  share1_encrypted?: string | null;
  share2_encrypted?: string | null;
}): ProviderMaterialMode {
  const share1 = String(row.share1_encrypted || '');
  const share2 = String(row.share2_encrypted || '');
  if (!share1 || !share2) return 'missing';
  const share1IsPlaceholder = share1.startsWith('demo-dashboard-placeholder');
  const share2IsPlaceholder = share2.startsWith('demo-dashboard-placeholder');
  if (share1IsPlaceholder && share2IsPlaceholder) return 'demo-placeholder';
  if (!share1IsPlaceholder && !share2IsPlaceholder) return 'sealed-live';
  return 'mixed';
}

function normalizeRecentAccessLogRows(value: unknown): AccessLogRecentRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const record = row as Record<string, unknown>;
      const timestamp = stringOrNull(record.timestamp);
      if (!timestamp) return null;
      return {
        project_id: stringOrNull(record.project_id),
        project_key_id: stringOrNull(record.project_key_id),
        provider: stringOrNull(record.provider),
        slug: stringOrNull(record.slug),
        method: stringOrNull(record.method),
        upstream_path: stringOrNull(record.upstream_path),
        status_code: record.status_code === null || record.status_code === undefined ? null : countValue(record.status_code),
        latency_ms: record.latency_ms === null || record.latency_ms === undefined ? null : countValue(record.latency_ms),
        timestamp,
        metadata: record.metadata,
      };
    })
    .filter((row): row is AccessLogRecentRow => Boolean(row));
}

function normalizeProjectHealthAggregates(value: unknown): ProjectHealthAggregate[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const record = row as Record<string, unknown>;
      const projectId = stringOrNull(record.project_id);
      if (!projectId) return null;
      return {
        project_id: projectId,
        calls: countValue(record.calls),
        errors: countValue(record.errors),
        denied: countValue(record.denied),
        lastActivity: stringOrNull(record.last_activity),
      };
    })
    .filter((row): row is ProjectHealthAggregate => Boolean(row));
}

function normalizeRollupOverviewPayload(payload: unknown): AccessLogOverview | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  return {
    source: 'rollup_rpc',
    totalCalls: countValue(record.total_calls),
    errorCalls: countValue(record.error_calls),
    deniedCalls: countValue(record.denied_calls),
    projectHealth: normalizeProjectHealthAggregates(record.project_health),
    recentLogs: normalizeRecentAccessLogRows(record.recent_activity),
    callTrend: [],
  };
}

function emptyAccessLogOverview(source: AccessLogOverview['source']): AccessLogOverview {
  return {
    source,
    totalCalls: 0,
    errorCalls: 0,
    deniedCalls: 0,
    projectHealth: [],
    recentLogs: [],
    callTrend: [],
  };
}

function trendStartDate(days = DASHBOARD_TRAFFIC_WINDOW_DAYS): Date {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - Math.max(days - 1, 0));
  return start;
}

function createTrendBuckets(days = DASHBOARD_TRAFFIC_WINDOW_DAYS): Map<string, DailyCallTrend> {
  const buckets = new Map<string, DailyCallTrend>();
  const start = trendStartDate(days);
  for (let index = 0; index < days; index += 1) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + index);
    const key = day.toISOString().slice(0, 10);
    buckets.set(key, { day: key, calls: 0, errors: 0, denied: 0 });
  }
  return buckets;
}

function addTrendCount(
  buckets: Map<string, DailyCallTrend>,
  dayValue: string | null | undefined,
  statusCode: number | null | undefined,
  count = 1,
): void {
  if (!dayValue) return;
  const parsed = dayValue.length === 10 ? new Date(`${dayValue}T00:00:00.000Z`) : new Date(dayValue);
  if (!Number.isFinite(parsed.getTime())) return;
  const day = parsed.toISOString().slice(0, 10);
  const bucket = buckets.get(day);
  if (!bucket) return;
  const safeCount = countValue(count);
  bucket.calls += safeCount;
  if ((statusCode || 0) >= 400) bucket.errors += safeCount;
  if (isDeniedStatus(statusCode || null)) bucket.denied += safeCount;
}

function addTrendBucketCount(
  buckets: Map<string, DailyCallTrend>,
  dayValue: string | null | undefined,
  statusBucket: string | null | undefined,
  count = 1,
): void {
  if (!dayValue) return;
  const bucket = buckets.get(String(dayValue).slice(0, 10));
  if (!bucket) return;
  const safeCount = countValue(count);
  bucket.calls += safeCount;
  if (statusBucket === 'error' || statusBucket === 'denied') bucket.errors += safeCount;
  if (statusBucket === 'denied') bucket.denied += safeCount;
}

function sortedTrend(buckets: Map<string, DailyCallTrend>): DailyCallTrend[] {
  return [...buckets.values()].sort((a, b) => a.day.localeCompare(b.day));
}

async function fetchRollupCallTrend(
  supabase: any,
  projectIds: string[],
  days = DASHBOARD_TRAFFIC_WINDOW_DAYS,
): Promise<DailyCallTrend[]> {
  if (projectIds.length === 0) return sortedTrend(createTrendBuckets(days));
  const buckets = createTrendBuckets(days);
  try {
    const since = trendStartDate(days).toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from('project_access_log_daily_rollups')
      .select('day, call_count, status_bucket')
      .in('project_id', projectIds)
      .gte('day', since)
      .limit(10000);
    if (error) return sortedTrend(buckets);
    for (const row of (data || []) as Array<{ day?: string | null; call_count?: number | null; status_bucket?: string | null }>) {
      addTrendBucketCount(buckets, row.day, row.status_bucket, row.call_count || 0);
    }
  } catch {
    return sortedTrend(buckets);
  }
  return sortedTrend(buckets);
}

function emptyKeyVisualSummary(totalProjects = 0): Record<string, unknown> {
  return {
    providerSlotSummary: {
      totalSlots: 0,
      liveSealedSlots: 0,
      placeholderSlots: 0,
      mixedSlots: 0,
      missingSlots: 0,
      materialReadySlots: 0,
      providerCount: 0,
      projectsWithSlots: 0,
      projectsWithoutSlots: totalProjects,
    },
    providerUsage: [],
    trafficBreakdown: {
      totalCalls: 0,
      okCalls: 0,
      deniedCalls: 0,
      otherErrorCalls: 0,
      errorCalls: 0,
    },
    apiProtocolBreakdown: {
      rest: 0,
      graphql: 0,
      unknown: 0,
    },
    projectCoverage: {
      totalProjects,
      withProviderSlots: 0,
      withoutProviderSlots: totalProjects,
      withTraffic: 0,
      needingAttention: 0,
    },
    callTrend: sortedTrend(createTrendBuckets(DASHBOARD_TRAFFIC_WINDOW_DAYS)),
  };
}

async function fetchRawAccessLogOverview(
  supabase: any,
  projectIds: string[],
  healthWindowSince: string,
  trendDays = DASHBOARD_TRAFFIC_WINDOW_DAYS,
): Promise<AccessLogOverview> {
  const [totalCallsRes, errorCallsRes, deniedCallsRes, recentLogsRes, projectHealthLogsRes] = await Promise.all([
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
      .select('id, project_id, project_key_id, provider, slug, method, upstream_path, status_code, latency_ms, timestamp, metadata')
      .in('project_id', projectIds)
      .order('timestamp', { ascending: false })
      .limit(20),
    supabase
      .from('project_access_logs')
      .select('project_id, status_code, timestamp')
      .in('project_id', projectIds)
      .gte('timestamp', healthWindowSince),
  ]);

  const projectHealthStats = new Map<string, ProjectHealthAggregate>();
  const trendBuckets = createTrendBuckets(trendDays);
  for (const log of (projectHealthLogsRes?.data || []) as Array<{ project_id: string; status_code: number | null; timestamp: string }>) {
    const existing = projectHealthStats.get(log.project_id) || {
      project_id: log.project_id,
      calls: 0,
      errors: 0,
      denied: 0,
      lastActivity: null,
    };
    existing.calls += 1;
    if ((log.status_code || 0) >= 400) existing.errors += 1;
    if (isDeniedStatus(log.status_code)) existing.denied += 1;
    addTrendCount(trendBuckets, log.timestamp, log.status_code, 1);
    if (!existing.lastActivity || log.timestamp > existing.lastActivity) existing.lastActivity = log.timestamp;
    projectHealthStats.set(log.project_id, existing);
  }

  return {
    source: 'raw_fallback',
    totalCalls: totalCallsRes?.count || 0,
    errorCalls: errorCallsRes?.count || 0,
    deniedCalls: deniedCallsRes?.count || 0,
    projectHealth: [...projectHealthStats.values()],
    recentLogs: normalizeRecentAccessLogRows(recentLogsRes?.data || []),
    callTrend: sortedTrend(trendBuckets),
  };
}

async function fetchAccessLogOverview(
  supabase: any,
  projectIds: string[],
  healthWindowSince: string,
  trendDays = DASHBOARD_TRAFFIC_WINDOW_DAYS,
): Promise<AccessLogOverview> {
  try {
    const { data, error } = await supabase.rpc('enterprise_project_access_overview', {
      project_ids: projectIds,
      health_window_since: healthWindowSince,
      recent_limit: 20,
    });
    if (!error) {
      const normalized = normalizeRollupOverviewPayload(Array.isArray(data) ? data[0] : data);
      if (normalized) {
        return {
          ...normalized,
          callTrend: await fetchRollupCallTrend(supabase, projectIds, trendDays),
        };
      }
    }
  } catch {
    // The migration may not be applied yet; fall back to the legacy raw-log path.
  }

  return fetchRawAccessLogOverview(supabase, projectIds, healthWindowSince, trendDays);
}

async function listActiveProjects(
  env: EnterpriseControlPlaneEnv,
  userId: string,
  organizationId?: string | null,
  activeMemberships?: OrganizationMembershipContext[],
): Promise<Array<{ id: string; vp_proj_id: string; name: string | null }>> {
  const projects = await listAccessibleProjects(env, userId, organizationId || null, activeMemberships);
  return projects.map((project) => ({
    id: project.id,
    vp_proj_id: project.vp_proj_id,
    name: project.name,
  }));
}

async function buildProjectsPayload(
  supabase: any,
  projects: AccessibleProjectSummary[],
): Promise<{ projects: Array<Record<string, unknown>> }> {
  const projectIds = projects.map((project) => project.id);
  const { data: keyRows } = projectIds.length
    ? await supabase
        .from('project_keys')
        .select('id, project_id, provider, slug, share1_encrypted, share2_encrypted')
        .in('project_id', projectIds)
        .is('revoked_at', null)
    : { data: [] };
  const providerSlotsByProject = ((keyRows || []) as Array<{
    id: string;
    project_id: string;
    provider: string;
    slug: string | null;
    share1_encrypted?: string | null;
    share2_encrypted?: string | null;
  }>).reduce<Map<string, Array<{
    key_id: string;
    provider: string;
    slug: string;
    material_mode: 'sealed-live' | 'demo-placeholder' | 'missing' | 'mixed';
    material_ready: boolean;
  }>>>((acc, row) => {
    const existing = acc.get(row.project_id) || [];
    const materialMode = resolveProviderMaterialMode(row);
    existing.push({
      key_id: row.id,
      provider: row.provider,
      slug: row.slug || row.provider,
      material_mode: materialMode,
      material_ready: materialMode === 'sealed-live',
    });
    acc.set(row.project_id, existing);
    return acc;
  }, new Map());

  return {
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
  };
}

function buildOverviewStatsFromAccess(
  projects: Array<{ id: string; vp_proj_id: string; name: string | null }>,
  keys: OverviewProviderKey[],
  accessOverview: AccessLogOverview,
  healthWindowDays: number,
  statsSourceOverride?: 'bootstrap_rpc',
): Record<string, unknown> {
  const projectIds = projects.map((p) => p.id);
  const keyVisualSummary = emptyKeyVisualSummary(projectIds.length);

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
      statsSource: statsSourceOverride || accessOverview.source,
      accessLogStatsSource: accessOverview.source,
      projectHealth: [],
      alerts: [{
        id: 'setup:no_projects',
        severity: 'info',
        title: 'No active projects yet',
        detail: 'Create one project and connect one provider to start a rollout review cycle.',
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
      ...keyVisualSummary,
    };
  }
  const providers = [...new Set(keys.map((k) => k.provider).filter(Boolean))];
  const keyMap = new Map<string, { provider: string; label: string; project_id: string | null }>();
  for (const key of keys) {
    keyMap.set(key.id, { provider: key.provider, label: key.slug || key.provider, project_id: key.project_id || null });
  }

  const totalCalls = accessOverview.totalCalls;
  const errorCalls = accessOverview.errorCalls;
  const deniedCalls = accessOverview.deniedCalls;
  const errorRate = totalCalls > 0 ? (errorCalls / totalCalls) * 100 : 0;
  const providerSlotSummary = {
    totalSlots: keys.length,
    liveSealedSlots: 0,
    placeholderSlots: 0,
    mixedSlots: 0,
    missingSlots: 0,
    materialReadySlots: 0,
    providerCount: providers.length,
    projectsWithSlots: 0,
    projectsWithoutSlots: 0,
  };
  const providerStats = new Map<string, {
    provider: string;
    slots: number;
    liveSealedSlots: number;
    placeholderSlots: number;
    mixedSlots: number;
    missingSlots: number;
    recentCalls: number;
    errors: number;
    denied: number;
    lastActivity: string | null;
    projectIds: Set<string>;
    labels: Set<string>;
  }>();
  const ensureProviderStat = (provider: string) => {
    const normalizedProvider = provider || 'unknown';
    const existing = providerStats.get(normalizedProvider);
    if (existing) return existing;
    const created = {
      provider: normalizedProvider,
      slots: 0,
      liveSealedSlots: 0,
      placeholderSlots: 0,
      mixedSlots: 0,
      missingSlots: 0,
      recentCalls: 0,
      errors: 0,
      denied: 0,
      lastActivity: null,
      projectIds: new Set<string>(),
      labels: new Set<string>(),
    };
    providerStats.set(normalizedProvider, created);
    return created;
  };

  const projectsWithSlots = new Set<string>();
  for (const key of keys) {
    const materialMode = isProviderMaterialMode(key.material_mode)
      ? key.material_mode
      : key.material_ready === true ? 'sealed-live' : 'missing';
    const provider = key.provider || 'unknown';
    const providerStat = ensureProviderStat(provider);
    providerStat.slots += 1;
    providerStat.labels.add(key.slug || provider);
    if (key.project_id) {
      providerStat.projectIds.add(key.project_id);
      projectsWithSlots.add(key.project_id);
    }
    if (materialMode === 'sealed-live') {
      providerSlotSummary.liveSealedSlots += 1;
      providerSlotSummary.materialReadySlots += 1;
      providerStat.liveSealedSlots += 1;
    } else if (materialMode === 'demo-placeholder') {
      providerSlotSummary.placeholderSlots += 1;
      providerStat.placeholderSlots += 1;
    } else if (materialMode === 'mixed') {
      providerSlotSummary.mixedSlots += 1;
      providerStat.mixedSlots += 1;
    } else {
      providerSlotSummary.missingSlots += 1;
      providerStat.missingSlots += 1;
    }
  }
  providerSlotSummary.projectsWithSlots = projectsWithSlots.size;
  providerSlotSummary.projectsWithoutSlots = Math.max(projectIds.length - projectsWithSlots.size, 0);

  for (const log of accessOverview.recentLogs) {
    const keyInfo = log.project_key_id ? keyMap.get(log.project_key_id) : null;
    const providerStat = ensureProviderStat(keyInfo?.provider || log.provider || log.slug || 'unknown');
    providerStat.recentCalls += 1;
    if ((log.status_code || 0) >= 400) providerStat.errors += 1;
    if (isDeniedStatus(log.status_code)) providerStat.denied += 1;
    if (log.project_id) providerStat.projectIds.add(log.project_id);
    if (keyInfo?.label || log.slug || log.provider) providerStat.labels.add(keyInfo?.label || log.slug || log.provider || 'unknown');
    if (!providerStat.lastActivity || log.timestamp > providerStat.lastActivity) providerStat.lastActivity = log.timestamp;
  }

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

  for (const aggregate of accessOverview.projectHealth) {
    const stat = projectHealthStats.get(aggregate.project_id);
    if (!stat) continue;
    stat.calls = aggregate.calls;
    stat.errors = aggregate.errors;
    stat.denied = aggregate.denied;
    stat.lastActivity = aggregate.lastActivity;
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
  const providerUsage = [...providerStats.values()]
    .map((stat) => ({
      provider: stat.provider,
      slots: stat.slots,
      liveSealedSlots: stat.liveSealedSlots,
      placeholderSlots: stat.placeholderSlots,
      mixedSlots: stat.mixedSlots,
      missingSlots: stat.missingSlots,
      recentCalls: stat.recentCalls,
      errors: stat.errors,
      denied: stat.denied,
      lastActivity: stat.lastActivity,
      projectCount: stat.projectIds.size,
      labels: [...stat.labels].slice(0, 5),
    }))
    .sort((a, b) => {
      if (b.recentCalls !== a.recentCalls) return b.recentCalls - a.recentCalls;
      if (b.slots !== a.slots) return b.slots - a.slots;
      return a.provider.localeCompare(b.provider);
    })
    .slice(0, 8);
  const trafficBreakdown = {
    totalCalls,
    okCalls: Math.max(totalCalls - errorCalls, 0),
    deniedCalls,
    otherErrorCalls: Math.max(errorCalls - deniedCalls, 0),
    errorCalls,
  };
  const apiProtocolBreakdown = accessOverview.recentLogs.reduce<Record<string, number>>((acc, log) => {
    const protocol = getAccessLogApiProtocol(log);
    acc[protocol] = (acc[protocol] || 0) + 1;
    return acc;
  }, { rest: 0, graphql: 0, unknown: 0 });
  const projectCoverage = {
    totalProjects: projectIds.length,
    withProviderSlots: providerSlotSummary.projectsWithSlots,
    withoutProviderSlots: providerSlotSummary.projectsWithoutSlots,
    withTraffic: projectsWithTraffic.length,
    needingAttention: projectsNeedingAttention.length,
  };

  const alerts: Array<Record<string, unknown>> = [];
  if (keys.length === 0) {
    alerts.push({
      id: 'setup:no_provider_keys',
      severity: 'info',
      title: 'No provider credentials connected',
      detail: 'Add one provider key to turn this organization into a protected workspace instead of a shell setup.',
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

  const recentActivity = accessOverview.recentLogs.map((log) => {
    const keyInfo = log.project_key_id ? keyMap.get(log.project_key_id) : null;
    const endpoint = log.upstream_path || '';
    const method = (log.method || '').toUpperCase();
    const description = [method, endpoint].filter(Boolean).join(' ').trim() || (log.provider || log.slug || 'Proxy request');
    const apiProtocol = getAccessLogApiProtocol(log);
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
        api_protocol: apiProtocol,
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
    providerSlotSummary,
    providerUsage,
    trafficBreakdown,
    apiProtocolBreakdown,
    projectCoverage,
    callTrend: accessOverview.callTrend,
    healthWindowDays,
    statsSource: statsSourceOverride || accessOverview.source,
    accessLogStatsSource: accessOverview.source,
    projectHealth,
    alerts: alerts.slice(0, 6),
    pilotReview: {
      status: totalCalls === 0 ? 'setup' : deniedCalls > 0 || errorRate >= 2 || projectsNeedingAttention.length > 0 ? 'watch' : 'healthy',
      headline: totalCalls === 0 ? 'Workspace is still in setup' : deniedCalls > 0 || errorRate >= 2 || projectsNeedingAttention.length > 0 ? 'Workspace is running, but keep it under watch' : 'Workspace looks healthy',
      recommendation: totalCalls === 0
        ? 'Route one real workflow through the proxy before expanding the rollout.'
        : deniedCalls > 0 || errorRate >= 2 || projectsNeedingAttention.length > 0
          ? 'Traffic is flowing, but there are still denial or error signals to clean up before expanding usage.'
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

async function buildInitOverviewStats(
  projects: Array<{ id: string; vp_proj_id: string; name: string | null }>,
  supabase: any,
): Promise<Record<string, unknown>> {
  const projectIds = projects.map((p) => p.id);
  const healthWindowDays = DASHBOARD_TRAFFIC_WINDOW_DAYS;
  const healthWindowSince = new Date(Date.now() - (healthWindowDays * 24 * 60 * 60 * 1000)).toISOString();

  if (projectIds.length === 0) {
    return buildOverviewStatsFromAccess(projects, [], emptyAccessLogOverview('rollup_rpc'), healthWindowDays);
  }

  const [{ data: keyRows }, accessOverview] = await Promise.all([
    supabase
      .from('project_keys')
      .select('id, project_id, provider, slug, share1_encrypted, share2_encrypted')
      .in('project_id', projectIds)
      .is('revoked_at', null),
    fetchAccessLogOverview(supabase, projectIds, healthWindowSince),
  ]);

  const keys = ((keyRows || []) as Array<{
    id: string;
    project_id: string | null;
    provider: string;
    slug: string | null;
    share1_encrypted?: string | null;
    share2_encrypted?: string | null;
  }>).map((row) => {
    const materialMode = resolveProviderMaterialMode(row);
    return {
      id: row.id,
      project_id: row.project_id,
      provider: row.provider,
      slug: row.slug,
      material_mode: materialMode,
      material_ready: materialMode === 'sealed-live',
    };
  });
  return buildOverviewStatsFromAccess(projects, keys, accessOverview, healthWindowDays);
}

function normalizeBootstrapProviderSlots(value: unknown): ProviderSlotSummary[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((slot) => {
      if (!slot || typeof slot !== 'object' || Array.isArray(slot)) return null;
      const record = slot as Record<string, unknown>;
      const keyId = stringOrNull(record.key_id);
      const provider = stringOrNull(record.provider);
      if (!keyId || !provider) return null;
      const materialMode = isProviderMaterialMode(record.material_mode) ? record.material_mode : 'missing';
      return {
        key_id: keyId,
        provider,
        slug: stringOrNull(record.slug) || provider,
        material_mode: materialMode,
        material_ready: typeof record.material_ready === 'boolean'
          ? record.material_ready
          : materialMode === 'sealed-live',
      };
    })
    .filter((slot): slot is ProviderSlotSummary => Boolean(slot));
}

function normalizeBootstrapProjects(value: unknown): ProjectBootstrapSummary[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((project) => {
      if (!project || typeof project !== 'object' || Array.isArray(project)) return null;
      const record = project as Record<string, unknown>;
      const id = stringOrNull(record.id);
      const vpProjId = stringOrNull(record.vp_proj_id);
      const createdAt = stringOrNull(record.created_at);
      if (!id || !vpProjId || !createdAt) return null;
      return {
        id,
        organization_id: stringOrNull(record.organization_id),
        vp_proj_id: vpProjId,
        name: stringOrNull(record.name),
        allowed_origins: stringOrNull(record.allowed_origins),
        strict_origin: record.strict_origin === true,
        caller_lock_policy: objectOrEmpty(record.caller_lock_policy),
        created_at: createdAt,
        revoked_at: stringOrNull(record.revoked_at),
        project_role: stringOrNull(record.project_role) || 'viewer',
        access_via: stringOrNull(record.access_via) || 'project',
        provider_slots: normalizeBootstrapProviderSlots(record.provider_slots),
      };
    })
    .filter((project): project is ProjectBootstrapSummary => Boolean(project));
}

function normalizeBootstrapOrganizations(value: unknown): OrganizationBootstrapSummary[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((organization) => {
      if (!organization || typeof organization !== 'object' || Array.isArray(organization)) return null;
      const record = organization as Record<string, unknown>;
      const id = stringOrNull(record.id);
      const name = stringOrNull(record.name);
      if (!id || !name) return null;
      const kind = record.kind === 'personal' ? 'personal' : 'team';
      return {
        id,
        name,
        kind,
        role: stringOrNull(record.role) || 'viewer',
        is_active: record.is_active === true,
      };
    })
    .filter((organization): organization is OrganizationBootstrapSummary => Boolean(organization));
}

async function fetchProjectsBootstrapRpc(
  supabase: any,
  userId: string,
  requestedOrganizationId: string | null,
): Promise<ProjectsBootstrapPayload | null> {
  const healthWindowDays = DASHBOARD_TRAFFIC_WINDOW_DAYS;
  const healthWindowSince = new Date(Date.now() - (healthWindowDays * 24 * 60 * 60 * 1000)).toISOString();

  try {
    const { data, error } = await supabase.rpc('enterprise_projects_bootstrap', {
      input_user_id: userId,
      input_organization_id: requestedOrganizationId || null,
      health_window_since: healthWindowSince,
      recent_limit: 20,
    });
    if (error) return null;

    const payload = Array.isArray(data) ? data[0] : data;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    const record = payload as Record<string, unknown>;
    const projects = normalizeBootstrapProjects(record.projects);
    const organizations = normalizeBootstrapOrganizations(record.organizations);
    const accessOverview = normalizeRollupOverviewPayload(record.access_overview)
      || emptyAccessLogOverview('rollup_rpc');
    const keys = projects.flatMap((project) => project.provider_slots.map((slot) => ({
      id: slot.key_id,
      project_id: project.id,
      provider: slot.provider,
      slug: slot.slug,
      material_mode: slot.material_mode,
      material_ready: slot.material_ready,
    })));

    return {
      organizations,
      active_organization_id: stringOrNull(record.active_organization_id),
      projects,
      overview: buildOverviewStatsFromAccess(
        projects.map((project) => ({
          id: project.id,
          vp_proj_id: project.vp_proj_id,
          name: project.name,
        })),
        keys,
        accessOverview,
        healthWindowDays,
        'bootstrap_rpc',
      ),
    };
  } catch {
    return null;
  }
}

export async function handleEnterpriseProjectRoutes(
  request: Request,
  env: EnterpriseControlPlaneEnv,
  pathSegments: string[],
): Promise<Response | null> {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) return null;
  if (
    request.method === 'POST'
    && pathSegments.length === 5
    && pathSegments[0] === 'projects'
    && pathSegments[2] === 'providers'
    && pathSegments[4] === 'execute'
  ) {
    return null;
  }

  const auth = await authenticateUser(request, env);
  if (!auth) {
    return Response.json(
      { error: 'Not authenticated. Sign in to VaultProof Enterprise.' },
      { status: 401 },
    );
  }

  const supabase = getSupabase(env);

  if (request.method === 'GET' && pathSegments.length === 2 && pathSegments[0] === 'projects' && pathSegments[1] === 'bootstrap') {
    const requestedOrganizationId = request.headers.get('x-vaultproof-organization')?.trim() || null;
    const rpcPayload = await fetchProjectsBootstrapRpc(supabase, auth.userId, requestedOrganizationId);
    if (rpcPayload) {
      return Response.json(rpcPayload);
    }

    const memberships = await listOrganizationMemberships(env, auth.userId);
    const membership = resolveOrganizationMembershipFromList(request, memberships);
    const organizationId = membership?.organization_id || null;
    const projects = await listAccessibleProjects(env, auth.userId, organizationId, memberships);
    const [projectsPayload, overview] = await Promise.all([
      buildProjectsPayload(supabase, projects),
      buildInitOverviewStats(
        projects.map((project) => ({
          id: project.id,
          vp_proj_id: project.vp_proj_id,
          name: project.name,
        })),
        supabase,
      ),
    ]);

    return Response.json({
      organizations: memberships.map((item) => ({
        id: item.organization_id,
        name: item.organization_name,
        kind: item.organization_kind,
        role: item.organization_role,
        is_active: item.organization_id === organizationId,
      })),
      active_organization_id: organizationId,
      ...projectsPayload,
      overview,
    });
  }

  const memberships = await listOrganizationMemberships(env, auth.userId);
  const membership = resolveOrganizationMembershipFromList(request, memberships);
  const organizationId = membership?.organization_id || null;

  if (request.method === 'GET' && pathSegments.length === 1 && pathSegments[0] === 'projects') {
    const projects = await listAccessibleProjects(env, auth.userId, organizationId, memberships);
    return Response.json(await buildProjectsPayload(supabase, projects));
  }

  if (request.method === 'POST' && pathSegments.length === 1 && pathSegments[0] === 'projects') {
    if (!membership) {
      return Response.json({ error: 'Organization not found' }, { status: 404 });
    }
    if (!hasRequiredOrganizationRole(membership.organization_role, 'admin')) {
      return Response.json({ error: 'Insufficient organization permissions' }, { status: 403 });
    }

    let body: ProjectWriteBody;
    try {
      body = (await request.json()) as ProjectWriteBody;
    } catch {
      body = {};
    }

    if (body.strict_origin !== undefined && typeof body.strict_origin !== 'boolean') {
      return Response.json({ error: 'strict_origin must be a boolean' }, { status: 400 });
    }

    const allowedOrigins = normalizeAllowedOrigins(body.allowed_origins);
    if (!allowedOrigins.ok) {
      return Response.json({ error: allowedOrigins.error }, { status: 400 });
    }
    if (body.strict_origin && !allowedOrigins.value) {
      return Response.json({ error: 'strict_origin requires allowed_origins' }, { status: 400 });
    }

    const callerLockPolicy = body.caller_lock_policy === undefined
      ? { ok: true as const, value: {} as CallerLockPolicy }
      : normalizeCallerLockPolicy(body.caller_lock_policy);
    if (!callerLockPolicy.ok) {
      return Response.json({ error: callerLockPolicy.error }, { status: 400 });
    }

    const vpProjId = generateProjectId();
    const { data, error } = await supabase
      .from('projects')
      .insert({
        user_id: auth.userId,
        organization_id: membership.organization_id,
        vp_proj_id: vpProjId,
        name: body.name || null,
        allowed_origins: allowedOrigins.value,
        strict_origin: body.strict_origin ?? false,
        caller_lock_policy: callerLockPolicy.value,
      })
      .select('id, organization_id, vp_proj_id, name, allowed_origins, strict_origin, caller_lock_policy, created_at, revoked_at')
      .single();

    if (error || !data) {
      return Response.json({ error: 'Failed to create workload' }, { status: 500 });
    }

    const { error: memberError } = await supabase
      .from('project_members')
      .insert({
        project_id: data.id,
        user_id: auth.userId,
        role: 'owner',
      });

    if (memberError) {
      return Response.json({ error: 'Failed to initialize workload access' }, { status: 500 });
    }

    await writeGovernanceAuditEvent(env, {
      organization_id: membership.organization_id,
      project_id: data.id,
      actor_user_id: auth.userId,
      actor_email: auth.email,
      event_type: 'project_created',
      target_type: 'project',
      target_id: data.id,
      description: `Created workload ${data.name || data.vp_proj_id}`,
      metadata: {
        vp_proj_id: data.vp_proj_id,
        allowed_origins: data.allowed_origins,
        strict_origin: data.strict_origin,
        caller_lock_policy: data.caller_lock_policy || {},
        created_via: 'enterprise_workloads_page',
      },
    });

    return Response.json({
      project: {
        id: data.id,
        organization_id: data.organization_id,
        vp_proj_id: data.vp_proj_id,
        name: data.name,
        allowed_origins: data.allowed_origins,
        strict_origin: data.strict_origin,
        caller_lock_policy: data.caller_lock_policy || {},
        created_at: data.created_at,
        revoked_at: data.revoked_at,
        project_role: 'owner',
        access_via: 'project',
        provider_slots: [],
      },
    }, { status: 201 });
  }

  if (
    request.method === 'GET' &&
    pathSegments.length === 3 &&
    pathSegments[0] === 'projects' &&
    pathSegments[1] === 'stats' &&
    pathSegments[2] === 'overview'
  ) {
    const projects = await listActiveProjects(env, auth.userId, organizationId, memberships);
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

  if (
    request.method === 'POST' &&
    pathSegments.length === 3 &&
    pathSegments[0] === 'projects' &&
    pathSegments[2] === 'providers'
  ) {
    const projectId = pathSegments[1];
    const project = await getAccessibleProject(env, auth.userId, projectId);
    if (!project) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }
    if (!hasRequiredProjectRole(project.project_role, 'admin')) {
      return Response.json({ error: 'Insufficient project permissions' }, { status: 403 });
    }

    let body: CreateProviderSlotBody;
    try {
      body = (await request.json()) as CreateProviderSlotBody;
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    if ((body.api_key && body.api_key.trim()) || (body.provider_key && body.provider_key.trim())) {
      return Response.json(
        { error: 'Live provider key ingest is not enabled in this dashboard build. Create a placeholder slot here, or use the sealed local seed flow for real key material.' },
        { status: 501 },
      );
    }

    const provider = normalizeProviderSlug(body.provider, 'provider');
    if (!provider.ok) return Response.json({ error: provider.error }, { status: 400 });
    const slug = normalizeProviderSlug(body.slug || provider.value, 'slug');
    if (!slug.ok) return Response.json({ error: slug.error }, { status: 400 });
    const upstreamBaseUrl = normalizeUpstreamBaseUrl(body.upstream_base_url);
    if (!upstreamBaseUrl.ok) return Response.json({ error: upstreamBaseUrl.error }, { status: 400 });
    const authHeaderName = normalizeHeaderName(body.auth_header_name || 'authorization', 'auth_header_name');
    if (!authHeaderName.ok) return Response.json({ error: authHeaderName.error }, { status: 400 });
    const authHeaderTemplate = normalizeAuthHeaderTemplate(body.auth_header_template || 'Bearer {key}');
    if (!authHeaderTemplate.ok) return Response.json({ error: authHeaderTemplate.error }, { status: 400 });
    const extraHeaders = normalizeExtraHeaders(body.extra_headers);
    if (!extraHeaders.ok) return Response.json({ error: extraHeaders.error }, { status: 400 });

    const placeholderSuffix = `${project.id}:${slug.value}`;
    const { data, error } = await supabase
      .from('project_keys')
      .upsert({
        project_id: project.id,
        provider: provider.value,
        slug: slug.value,
        env_var: `${provider.value.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`,
        upstream_base_url: upstreamBaseUrl.value,
        auth_header_name: authHeaderName.value,
        auth_header_template: authHeaderTemplate.value,
        share1_encrypted: `demo-dashboard-placeholder-share-1:${placeholderSuffix}`,
        share2_encrypted: `demo-dashboard-placeholder-share-2:${placeholderSuffix}`,
        extra_headers: extraHeaders.value,
        revoked_at: null,
      }, { onConflict: 'project_id,provider' })
      .select('id, project_id, provider, slug, upstream_base_url')
      .single();

    if (error || !data) {
      return Response.json({ error: 'Failed to create provider slot' }, { status: 500 });
    }

    if (project.organization_id || organizationId) {
      await writeGovernanceAuditEvent(env, {
        organization_id: project.organization_id || organizationId || '',
        project_id: project.id,
        actor_user_id: auth.userId,
        actor_email: auth.email,
        event_type: 'enterprise_provider_slot_created',
        target_type: 'project_key',
        target_id: data.id as string,
        description: `Created provider slot ${slug.value} for ${project.name || project.vp_proj_id}`,
        metadata: {
          provider: data.provider,
          slug: data.slug || slug.value,
          upstream_base_url: data.upstream_base_url,
          material_mode: 'demo-placeholder',
          created_via: 'enterprise_dashboard',
        },
      });
    }

    return Response.json({
      provider_slot: {
        key_id: data.id,
        project_id: data.project_id,
        provider: data.provider,
        slug: data.slug || slug.value,
        upstream_base_url: data.upstream_base_url,
        material_mode: 'demo-placeholder',
      },
    }, { status: 201 });
  }

  if (
    request.method === 'POST' &&
    pathSegments.length === 5 &&
    pathSegments[0] === 'projects' &&
    pathSegments[2] === 'providers' &&
    pathSegments[4] === 'revoke'
  ) {
    const projectId = pathSegments[1];
    const slug = pathSegments[3];
    const project = await getAccessibleProject(env, auth.userId, projectId);
    if (!project) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }
    if (!hasRequiredProjectRole(project.project_role, 'admin')) {
      return Response.json({ error: 'Insufficient project permissions' }, { status: 403 });
    }

    const body = await parseOptionalRevokeBody(request);
    const revokedAt = new Date().toISOString();
    const { data, error } = await supabase
      .from('project_keys')
      .update({ revoked_at: revokedAt })
      .eq('project_id', project.id)
      .eq('slug', slug)
      .is('revoked_at', null)
      .select('id, project_id, provider, slug, revoked_at')
      .maybeSingle();

    if (error) {
      return Response.json({ error: 'Failed to revoke provider slot' }, { status: 500 });
    }
    if (!data) {
      return Response.json({ error: 'Active provider slot not found' }, { status: 404 });
    }

    if (project.organization_id || organizationId) {
      await writeGovernanceAuditEvent(env, {
        organization_id: project.organization_id || organizationId || '',
        project_id: project.id,
        actor_user_id: auth.userId,
        actor_email: auth.email,
        event_type: 'enterprise_provider_key_revoked',
        target_type: 'project_key',
        target_id: data.id as string,
        description: `Revoked provider slot ${slug} for ${project.name || project.vp_proj_id}`,
        metadata: {
          provider: data.provider,
          slug: data.slug || slug,
          revoked_at: data.revoked_at || revokedAt,
          reason: typeof body.reason === 'string' ? body.reason.slice(0, 500) : null,
          revoked_via: 'enterprise_control_plane',
        },
      });
    }

    return Response.json({
      revoked: {
        key_id: data.id,
        project_id: data.project_id,
        provider: data.provider,
        slug: data.slug || slug,
        revoked_at: data.revoked_at || revokedAt,
      },
    });
  }

  return null;
}
