import type { SecureExecutionCallerLock } from '@vaultproof/core';
import type { EnterpriseControlPlaneEnv } from './config.js';
import { getSupabase } from './supabase.js';

export type ProxyAccessTier = 'basic' | 'recommended' | 'high_security';
export type ProxyAccessEnforcementMode = 'monitor' | 'enforce' | 'paused';
export type ProxyAccessScopeMode = 'project_policy' | 'deny_unscoped';
export type ProxyAccessFreezeState = 'active' | 'frozen' | 'thaw_pending';

export interface OrganizationProxyAccessPolicyRow {
  organization_id: string;
  tier: ProxyAccessTier;
  enforcement_mode: ProxyAccessEnforcementMode;
  allowed_egress_cidrs: string[];
  require_mtls: boolean;
  require_private_connectivity: boolean;
  anomaly_auto_freeze_enabled: boolean;
  default_rate_limit_per_minute: number | null;
  default_provider_scope_mode: ProxyAccessScopeMode;
  freeze_state: ProxyAccessFreezeState;
  freeze_reason: string | null;
  frozen_at: string | null;
  notes?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ProxyAccessChecklistItem {
  label: string;
  status: 'done' | 'todo';
  detail: string;
}

export interface ProxyAccessPolicyInput {
  tier?: unknown;
  enforcement_mode?: unknown;
  allowed_egress_cidrs?: unknown;
  require_mtls?: unknown;
  require_private_connectivity?: unknown;
  anomaly_auto_freeze_enabled?: unknown;
  default_rate_limit_per_minute?: unknown;
  default_provider_scope_mode?: unknown;
  freeze_state?: unknown;
  freeze_reason?: unknown;
  notes?: unknown;
}

export interface ProxyAccessPolicyEnforcementResult {
  blockingError: string | null;
  monitorFindings: string[];
  metadata: Record<string, unknown>;
}

export function isMissingOrganizationProxyAccessPoliciesTable(error: { code?: string; message?: string } | null | undefined): boolean {
  const message = String(error?.message || '').toLowerCase();
  return error?.code === '42P01'
    || error?.code === 'PGRST205'
    || (message.includes('organization_proxy_access_policies') && (
      message.includes('schema cache')
      || message.includes('does not exist')
      || message.includes('could not find')
    ));
}

export function defaultProxyAccessPolicy(organizationId: string): OrganizationProxyAccessPolicyRow {
  return {
    organization_id: organizationId,
    tier: 'basic',
    enforcement_mode: 'monitor',
    allowed_egress_cidrs: [],
    require_mtls: false,
    require_private_connectivity: false,
    anomaly_auto_freeze_enabled: true,
    default_rate_limit_per_minute: null,
    default_provider_scope_mode: 'project_policy',
    freeze_state: 'active',
    freeze_reason: null,
    frozen_at: null,
    notes: null,
    created_by: null,
    updated_by: null,
    created_at: null,
    updated_at: null,
  };
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => normalizeString(item)).filter(Boolean))];
  }
  return [...new Set(normalizeString(value)
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean))];
}

export function normalizeProxyAccessTier(value: unknown, fallback: ProxyAccessTier = 'basic'): ProxyAccessTier | null {
  const normalized = normalizeString(value || fallback).toLowerCase();
  if (normalized === 'basic' || normalized === 'recommended' || normalized === 'high_security') return normalized;
  return null;
}

export function normalizeProxyAccessEnforcementMode(
  value: unknown,
  fallback: ProxyAccessEnforcementMode = 'monitor',
): ProxyAccessEnforcementMode | null {
  const normalized = normalizeString(value || fallback).toLowerCase();
  if (normalized === 'monitor' || normalized === 'enforce' || normalized === 'paused') return normalized;
  return null;
}

export function normalizeProxyAccessScopeMode(
  value: unknown,
  fallback: ProxyAccessScopeMode = 'project_policy',
): ProxyAccessScopeMode | null {
  const normalized = normalizeString(value || fallback).toLowerCase();
  if (normalized === 'project_policy' || normalized === 'deny_unscoped') return normalized;
  return null;
}

export function normalizeProxyAccessFreezeState(
  value: unknown,
  fallback: ProxyAccessFreezeState = 'active',
): ProxyAccessFreezeState | null {
  const normalized = normalizeString(value || fallback).toLowerCase();
  if (normalized === 'active' || normalized === 'frozen' || normalized === 'thaw_pending') return normalized;
  return null;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeRateLimit(value: unknown, fallback: number | null): number | null {
  if (value === null || value === '') return null;
  if (value === undefined) return fallback;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 60000) return Number.NaN;
  return numeric;
}

function isValidCidr(value: string): boolean {
  const [ip, prefixRaw] = value.split('/');
  const bytes = ipToBytes(ip || '');
  if (!bytes) return false;
  if (prefixRaw === undefined) return true;
  const prefix = Number(prefixRaw);
  return Number.isInteger(prefix) && prefix >= 0 && prefix <= bytes.length * 8;
}

export function normalizeProxyAccessPolicyRow(
  raw: Partial<OrganizationProxyAccessPolicyRow> | Record<string, unknown> | null | undefined,
  organizationId: string,
): OrganizationProxyAccessPolicyRow {
  const fallback = defaultProxyAccessPolicy(organizationId);
  const tier = normalizeProxyAccessTier(raw?.tier, fallback.tier) || fallback.tier;
  const enforcementMode = normalizeProxyAccessEnforcementMode(raw?.enforcement_mode, fallback.enforcement_mode) || fallback.enforcement_mode;
  const scopeMode = normalizeProxyAccessScopeMode(raw?.default_provider_scope_mode, fallback.default_provider_scope_mode) || fallback.default_provider_scope_mode;
  const freezeState = normalizeProxyAccessFreezeState(raw?.freeze_state, fallback.freeze_state) || fallback.freeze_state;
  const rateLimit = normalizeRateLimit(raw?.default_rate_limit_per_minute, fallback.default_rate_limit_per_minute);

  return {
    organization_id: normalizeString(raw?.organization_id) || organizationId,
    tier,
    enforcement_mode: enforcementMode,
    allowed_egress_cidrs: normalizeStringArray(raw?.allowed_egress_cidrs).filter(isValidCidr),
    require_mtls: normalizeBoolean(raw?.require_mtls, fallback.require_mtls),
    require_private_connectivity: normalizeBoolean(raw?.require_private_connectivity, fallback.require_private_connectivity),
    anomaly_auto_freeze_enabled: normalizeBoolean(raw?.anomaly_auto_freeze_enabled, fallback.anomaly_auto_freeze_enabled),
    default_rate_limit_per_minute: Number.isNaN(rateLimit) ? fallback.default_rate_limit_per_minute : rateLimit,
    default_provider_scope_mode: scopeMode,
    freeze_state: freezeState,
    freeze_reason: normalizeString(raw?.freeze_reason) || null,
    frozen_at: normalizeString(raw?.frozen_at) || null,
    notes: normalizeString(raw?.notes) || null,
    created_by: normalizeString(raw?.created_by) || null,
    updated_by: normalizeString(raw?.updated_by) || null,
    created_at: normalizeString(raw?.created_at) || null,
    updated_at: normalizeString(raw?.updated_at) || null,
  };
}

export function normalizeProxyAccessPolicyInput(
  input: ProxyAccessPolicyInput,
  existing: OrganizationProxyAccessPolicyRow,
): { ok: true; value: OrganizationProxyAccessPolicyRow } | { ok: false; error: string } {
  const tier = normalizeProxyAccessTier(input.tier, existing.tier);
  if (!tier) return { ok: false, error: 'tier must be basic, recommended, or high_security.' };

  const enforcementMode = normalizeProxyAccessEnforcementMode(input.enforcement_mode, existing.enforcement_mode);
  if (!enforcementMode) return { ok: false, error: 'enforcement_mode must be monitor, enforce, or paused.' };

  const scopeMode = normalizeProxyAccessScopeMode(input.default_provider_scope_mode, existing.default_provider_scope_mode);
  if (!scopeMode) return { ok: false, error: 'default_provider_scope_mode must be project_policy or deny_unscoped.' };

  const freezeState = normalizeProxyAccessFreezeState(input.freeze_state, existing.freeze_state);
  if (!freezeState) return { ok: false, error: 'freeze_state must be active, frozen, or thaw_pending.' };

  const rateLimit = normalizeRateLimit(input.default_rate_limit_per_minute, existing.default_rate_limit_per_minute);
  if (Number.isNaN(rateLimit)) {
    return { ok: false, error: 'default_rate_limit_per_minute must be an integer between 1 and 60000, or blank.' };
  }

  const cidrs = input.allowed_egress_cidrs === undefined
    ? existing.allowed_egress_cidrs
    : normalizeStringArray(input.allowed_egress_cidrs);
  const invalidCidr = cidrs.find((cidr) => !isValidCidr(cidr));
  if (invalidCidr) return { ok: false, error: `allowed_egress_cidrs contains invalid CIDR ${invalidCidr}.` };

  const notes = input.notes === undefined ? existing.notes : normalizeString(input.notes) || null;
  if (notes && notes.length > 2000) return { ok: false, error: 'notes must be 2000 characters or fewer.' };

  const freezeReason = input.freeze_reason === undefined
    ? existing.freeze_reason
    : normalizeString(input.freeze_reason) || null;
  if (freezeReason && freezeReason.length > 1000) return { ok: false, error: 'freeze_reason must be 1000 characters or fewer.' };

  return {
    ok: true,
    value: {
      ...existing,
      tier,
      enforcement_mode: enforcementMode,
      allowed_egress_cidrs: cidrs,
      require_mtls: normalizeBoolean(input.require_mtls, existing.require_mtls),
      require_private_connectivity: normalizeBoolean(input.require_private_connectivity, existing.require_private_connectivity),
      anomaly_auto_freeze_enabled: normalizeBoolean(input.anomaly_auto_freeze_enabled, existing.anomaly_auto_freeze_enabled),
      default_rate_limit_per_minute: rateLimit,
      default_provider_scope_mode: scopeMode,
      freeze_state: freezeState,
      freeze_reason: freezeReason,
      notes,
    },
  };
}

export async function readOrganizationProxyAccessPolicy(
  env: EnterpriseControlPlaneEnv,
  organizationId: string | null | undefined,
): Promise<{ policy: OrganizationProxyAccessPolicyRow | null; schemaReady: boolean; error?: string }> {
  const orgId = normalizeString(organizationId);
  if (!orgId) return { policy: null, schemaReady: true };

  try {
    const { data, error } = await getSupabase(env)
      .from('organization_proxy_access_policies')
      .select('organization_id, tier, enforcement_mode, allowed_egress_cidrs, require_mtls, require_private_connectivity, anomaly_auto_freeze_enabled, default_rate_limit_per_minute, default_provider_scope_mode, freeze_state, freeze_reason, frozen_at, notes, created_by, updated_by, created_at, updated_at')
      .eq('organization_id', orgId)
      .limit(1);

    if (error) {
      if (isMissingOrganizationProxyAccessPoliciesTable(error)) {
        return { policy: defaultProxyAccessPolicy(orgId), schemaReady: false };
      }
      return { policy: defaultProxyAccessPolicy(orgId), schemaReady: false, error: error.message };
    }

    const row = Array.isArray(data) ? data[0] : data;
    return {
      policy: normalizeProxyAccessPolicyRow(row || null, orgId),
      schemaReady: true,
    };
  } catch (error) {
    return {
      policy: defaultProxyAccessPolicy(orgId),
      schemaReady: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function proxyAccessChecklist(policy: OrganizationProxyAccessPolicyRow | null): ProxyAccessChecklistItem[] {
  const p = policy || defaultProxyAccessPolicy('');
  return [{
    label: 'Proxy access tier',
    status: p.tier ? 'done' : 'todo',
    detail: p.tier || 'Choose basic, recommended, or high security.',
  }, {
    label: 'Enforcement mode',
    status: p.enforcement_mode === 'enforce' ? 'done' : 'todo',
    detail: p.enforcement_mode === 'enforce'
      ? 'Blocking enforcement is active.'
      : `Current mode is ${p.enforcement_mode}. Use enforce after customer prerequisites are ready.`,
  }, {
    label: 'Egress source',
    status: p.tier === 'basic' || p.allowed_egress_cidrs.length > 0 ? 'done' : 'todo',
    detail: p.tier === 'basic'
      ? 'Not required for Basic.'
      : p.allowed_egress_cidrs.length
        ? `${p.allowed_egress_cidrs.length} CIDR${p.allowed_egress_cidrs.length === 1 ? '' : 's'} configured.`
        : 'Recommended and High Security should include customer egress CIDRs or trusted gateway facts.',
  }, {
    label: 'mTLS/private connectivity',
    status: p.tier !== 'high_security' || p.require_mtls || p.require_private_connectivity ? 'done' : 'todo',
    detail: p.tier !== 'high_security'
      ? 'Not required for this tier.'
      : p.require_mtls || p.require_private_connectivity
        ? `${p.require_mtls ? 'mTLS required' : ''}${p.require_mtls && p.require_private_connectivity ? ' and ' : ''}${p.require_private_connectivity ? 'private connectivity required' : ''}.`
        : 'High Security should require mTLS, private connectivity, or both.',
  }, {
    label: 'Auto-freeze',
    status: p.anomaly_auto_freeze_enabled ? 'done' : 'todo',
    detail: p.anomaly_auto_freeze_enabled ? 'Anomaly auto-freeze is enabled.' : 'Enable auto-freeze before production.',
  }];
}

export function proxyAccessCustomerSummary(policy: OrganizationProxyAccessPolicyRow | null): Record<string, unknown> {
  const p = policy || defaultProxyAccessPolicy('');
  return {
    tier: p.tier,
    enforcement_mode: p.enforcement_mode,
    freeze_state: p.freeze_state,
    frozen_at: p.frozen_at,
    require_mtls: p.require_mtls,
    require_private_connectivity: p.require_private_connectivity,
    allowed_egress_cidr_count: p.allowed_egress_cidrs.length,
    anomaly_auto_freeze_enabled: p.anomaly_auto_freeze_enabled,
    default_rate_limit_per_minute: p.default_rate_limit_per_minute,
    default_provider_scope_mode: p.default_provider_scope_mode,
  };
}

function hasProjectExecutionScope(policy: Record<string, unknown> | null | undefined): boolean {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return false;
  const record = policy as Record<string, unknown>;
  for (const key of ['allowed_providers', 'allowed_methods', 'allowed_upstream_hosts', 'allowed_upstream_path_prefixes']) {
    if (Array.isArray(record[key]) && (record[key] as unknown[]).length > 0) return true;
  }
  const overrides = record.provider_overrides;
  if (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) {
    return Object.values(overrides).some((value) => hasProjectExecutionScope(value as Record<string, unknown>));
  }
  return false;
}

export function enforceProxyAccessPolicy(input: {
  policy: OrganizationProxyAccessPolicyRow | null;
  callerLock: SecureExecutionCallerLock;
  projectCallerLockPolicy?: Record<string, unknown> | null;
  privateConnectivityVerified?: boolean;
}): ProxyAccessPolicyEnforcementResult {
  const policy = input.policy || defaultProxyAccessPolicy('');
  const findings: string[] = [];

  if (policy.freeze_state === 'frozen') {
    return {
      blockingError: `Proxy access is frozen for this organization${policy.freeze_reason ? `: ${policy.freeze_reason}` : '.'}`,
      monitorFindings: findings,
      metadata: proxyAccessCustomerSummary(policy),
    };
  }

  if (policy.enforcement_mode === 'paused') {
    return {
      blockingError: null,
      monitorFindings: ['Proxy access tier enforcement is paused.'],
      metadata: proxyAccessCustomerSummary(policy),
    };
  }

  if (policy.default_provider_scope_mode === 'deny_unscoped' && !hasProjectExecutionScope(input.projectCallerLockPolicy)) {
    findings.push('Project has no provider, method, host, or path scope.');
  }

  if ((policy.tier === 'recommended' || policy.tier === 'high_security') && policy.allowed_egress_cidrs.length) {
    const sourceIp = input.callerLock.sourceIp?.trim() || '';
    if (!sourceIp || !policy.allowed_egress_cidrs.some((cidr) => ipMatchesCidr(sourceIp, cidr))) {
      findings.push(`Source IP ${sourceIp || 'missing'} is outside the organization egress allowlist.`);
    }
  }

  if (policy.tier === 'high_security') {
    if (policy.require_mtls && !input.callerLock.clientCertificateThumbprint && !input.callerLock.clientCertificateSubject) {
      findings.push('High Security requires a trusted mTLS client certificate signal.');
    }
    if (policy.require_private_connectivity && !input.privateConnectivityVerified) {
      findings.push('High Security requires verified private connectivity.');
    }
  }

  return {
    blockingError: policy.enforcement_mode === 'enforce' && findings.length ? findings[0] : null,
    monitorFindings: findings,
    metadata: {
      ...proxyAccessCustomerSummary(policy),
      monitor_findings: findings,
    },
  };
}

function ipv4ToBytes(ip: string): number[] | null {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    bytes.push(octet);
  }
  return bytes;
}

function ipv6ToBytes(ip: string): number[] | null {
  const normalized = ip.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '').split('%')[0] || '';
  if (!normalized.includes(':')) return null;

  const parts = normalized.split('::');
  if (parts.length > 2) return null;

  const parseGroups = (value: string): number[] | null => {
    if (!value) return [];
    const groups = value.split(':');
    const parsed: number[] = [];
    for (const group of groups) {
      if (!group) return null;
      if (group.includes('.')) {
        const ipv4Bytes = ipv4ToBytes(group);
        if (!ipv4Bytes) return null;
        parsed.push((ipv4Bytes[0] << 8) + ipv4Bytes[1]);
        parsed.push((ipv4Bytes[2] << 8) + ipv4Bytes[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      parsed.push(Number.parseInt(group, 16));
    }
    return parsed;
  };

  const left = parseGroups(parts[0]);
  const right = parseGroups(parts[1] || '');
  if (!left || !right) return null;

  const missing = parts.length === 2 ? 8 - left.length - right.length : 0;
  if (missing < 0) return null;

  const groups = parts.length === 2
    ? [...left, ...Array.from({ length: missing }, () => 0), ...right]
    : left;
  if (groups.length !== 8 || groups.some((group) => group < 0 || group > 0xffff)) return null;

  return groups.flatMap((group) => [(group >> 8) & 0xff, group & 0xff]);
}

function ipToBytes(ip: string): number[] | null {
  const normalized = ip.trim().replace(/^\[/, '').replace(/\]$/, '').split('%')[0] || '';
  return ipv4ToBytes(normalized) || ipv6ToBytes(normalized);
}

export function ipMatchesCidr(ip: string, cidr: string): boolean {
  const [range, prefixRaw] = cidr.split('/');
  const ipBytes = ipToBytes(ip);
  const rangeBytes = ipToBytes(range || '');
  if (!ipBytes || !rangeBytes || ipBytes.length !== rangeBytes.length) return false;

  const maxPrefix = ipBytes.length * 8;
  const prefix = prefixRaw === undefined ? maxPrefix : Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) return false;

  let remainingBits = prefix;
  for (let index = 0; index < ipBytes.length; index += 1) {
    if (remainingBits >= 8) {
      if (ipBytes[index] !== rangeBytes[index]) return false;
      remainingBits -= 8;
      continue;
    }
    if (remainingBits === 0) return true;
    const mask = (0xff << (8 - remainingBits)) & 0xff;
    return (ipBytes[index] & mask) === (rangeBytes[index] & mask);
  }

  return true;
}

