import {
  buildSignedSecureExecutionEnvelope,
  type AzureSecureExecutionAttestationEvidence,
  type SecureExecutionCallerLock,
  type SecureExecutionRequest,
  type SecureExecutionResult,
} from '@vaultproof/core';
import type { EnterpriseControlPlaneEnv } from '../config.js';
import { dispatchToSecureExecutor } from '../config.js';
import {
  authenticateUser,
  getAccessibleProject,
  hasRequiredProjectRole,
} from '../auth.js';
import { writeGovernanceAuditEvent } from '../audit.js';
import { getSupabase } from '../supabase.js';

interface ExecuteBody {
  method?: string;
  upstream_path?: string;
  query?: string;
  headers?: Record<string, string>;
  body_base64?: string | null;
}

type CallerLockPolicy = {
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

const SAFE_EXECUTION_HEADERS = new Set([
  'content-type',
  'accept',
  'accept-encoding',
  'accept-language',
  'cache-control',
  'user-agent',
  'openai-beta',
  'stripe-version',
  'idempotency-key',
  'prefer',
  'anthropic-version',
  'anthropic-beta',
]);

function normalizeMethod(value: string | undefined): string {
  const method = (value || 'POST').trim().toUpperCase();
  return method || 'POST';
}

function normalizeUpstreamPath(value: string | undefined): string | null {
  const trimmed = (value || '').trim();
  if (!trimmed) return null;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function normalizeQuery(value: string | undefined): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('?') ? trimmed.slice(1) : trimmed;
}

function sanitizeHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  if (!headers) return {};

  return Object.entries(headers).reduce<Record<string, string>>((acc, [key, value]) => {
    if (!SAFE_EXECUTION_HEADERS.has(key.toLowerCase())) return acc;
    acc[key] = value;
    return acc;
  }, {});
}

function normalizeOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return null;
  }
}

function getRefererOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return null;
  }
}

function getAllowedOrigins(value: string | null | undefined): string[] {
  return String(value || '')
    .split(',')
    .map((origin) => origin.trim().toLowerCase())
    .filter(Boolean);
}

function firstHeader(request: Request, names: string[]): string | null {
  for (const name of names) {
    const value = request.headers.get(name);
    if (value) return value.trim();
  }
  return null;
}

function getSourceIp(request: Request): string | null {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }
  return firstHeader(request, ['x-real-ip', 'x-client-ip', 'cf-connecting-ip']);
}

function normalizeThumbprint(value: string | null): string | null {
  const normalized = String(value || '').trim().toLowerCase().replace(/[^a-f0-9]/g, '');
  return normalized || null;
}

async function hashIdentifier(value: string | null): Promise<string | null> {
  if (!value) return null;
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Buffer.from(digest).toString('base64url');
}

function normalizeClientClass(value: string | null): SecureExecutionCallerLock['clientClass'] {
  const normalized = String(value || '').trim().toLowerCase();
  if (['browser', 'server', 'device', 'iot', 'gateway'].includes(normalized)) {
    return normalized as SecureExecutionCallerLock['clientClass'];
  }
  return normalized ? 'unknown' : undefined;
}

async function buildCallerLock(request: Request): Promise<SecureExecutionCallerLock> {
  const origin = normalizeOrigin(request.headers.get('origin'));
  const refererOrigin = getRefererOrigin(request.headers.get('referer'));
  const rawDeviceId = firstHeader(request, ['x-vaultproof-device-id', 'x-device-id']);
  return {
    origin,
    refererOrigin,
    customerGateway: firstHeader(request, ['x-vaultproof-customer-gateway']),
    clientClass: normalizeClientClass(firstHeader(request, ['x-vaultproof-client-class'])),
    deviceIdHash: await hashIdentifier(rawDeviceId),
    fleetId: firstHeader(request, ['x-vaultproof-fleet-id', 'x-fleet-id']),
    firmwareVersion: firstHeader(request, ['x-vaultproof-firmware-version', 'x-firmware-version']),
    sourceIp: getSourceIp(request),
    clientCertificateThumbprint: normalizeThumbprint(firstHeader(request, [
      'x-vaultproof-client-cert-thumbprint',
      'x-client-cert-thumbprint',
      'x-arr-clientcert-thumbprint',
    ])),
    clientCertificateSubject: firstHeader(request, [
      'x-vaultproof-client-cert-subject',
      'x-client-cert-subject',
    ]),
  };
}

function enforceOriginLock(project: { allowed_origins: string | null; strict_origin: boolean }, callerLock: SecureExecutionCallerLock): string | null {
  if (!project.strict_origin) return null;
  const allowedOrigins = getAllowedOrigins(project.allowed_origins);
  if (!allowedOrigins.length) return 'Project strict origin lock is enabled but no origins are configured.';

  const requestOrigin = callerLock.origin || callerLock.refererOrigin || null;
  if (!requestOrigin) return 'Origin lock rejected this request because no Origin or Referer origin was present.';
  if (!allowedOrigins.includes(requestOrigin.toLowerCase())) {
    return `Origin lock rejected ${requestOrigin}.`;
  }
  return null;
}

function normalizePolicyList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => typeof item === 'string' ? item.trim().toLowerCase() : '').filter(Boolean)
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getCallerLockPolicyFromRaw(raw: Record<string, unknown>): CallerLockPolicy {
  return {
    allowed_customer_gateways: normalizePolicyList(raw.allowed_customer_gateways),
    allowed_client_classes: normalizePolicyList(raw.allowed_client_classes),
    allowed_fleet_ids: normalizePolicyList(raw.allowed_fleet_ids),
    allowed_firmware_versions: normalizePolicyList(raw.allowed_firmware_versions),
    allowed_ip_cidrs: normalizePolicyList(raw.allowed_ip_cidrs),
    allowed_client_certificate_thumbprints: normalizePolicyList(raw.allowed_client_certificate_thumbprints)
      .map((thumbprint) => normalizeThumbprint(thumbprint))
      .filter(Boolean) as string[],
    allowed_client_certificate_subjects: normalizePolicyList(raw.allowed_client_certificate_subjects),
    require_device_id: raw.require_device_id === true,
  };
}

function getCallerLockPolicy(project: { caller_lock_policy?: Record<string, unknown> | null }): CallerLockPolicy {
  return getCallerLockPolicyFromRaw(project.caller_lock_policy || {});
}

function getProviderCallerLockPolicy(
  project: { caller_lock_policy?: Record<string, unknown> | null },
  slug: string,
  provider: string,
): CallerLockPolicy | null {
  const overrides = project.caller_lock_policy?.provider_overrides;
  if (!isRecord(overrides)) return null;

  const candidates = [
    slug.trim().toLowerCase(),
    provider.trim().toLowerCase(),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const rawOverride = overrides[candidate];
    if (isRecord(rawOverride)) {
      return getCallerLockPolicyFromRaw(rawOverride);
    }
  }

  return null;
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

function ipMatchesCidr(ip: string, cidr: string): boolean {
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

function enforceCallerLockPolicyValue(
  policy: CallerLockPolicy,
  callerLock: SecureExecutionCallerLock,
  label = 'Caller lock',
): string | null {
  if (policy.require_device_id && !callerLock.deviceIdHash) {
    return `${label} rejected this request because device identity is required.`;
  }

  if (policy.allowed_customer_gateways?.length) {
    const gateway = callerLock.customerGateway?.trim().toLowerCase() || '';
    if (!gateway || !policy.allowed_customer_gateways.includes(gateway)) {
      return `${label} rejected gateway ${gateway || 'missing'}.`;
    }
  }

  if (policy.allowed_client_classes?.length) {
    const clientClass = callerLock.clientClass?.trim().toLowerCase() || '';
    if (!clientClass || !policy.allowed_client_classes.includes(clientClass)) {
      return `${label} rejected client class ${clientClass || 'missing'}.`;
    }
  }

  if (policy.allowed_fleet_ids?.length) {
    const fleetId = callerLock.fleetId?.trim().toLowerCase() || '';
    if (!fleetId || !policy.allowed_fleet_ids.includes(fleetId)) {
      return `${label} rejected fleet ${fleetId || 'missing'}.`;
    }
  }

  if (policy.allowed_firmware_versions?.length) {
    const firmwareVersion = callerLock.firmwareVersion?.trim().toLowerCase() || '';
    if (!firmwareVersion || !policy.allowed_firmware_versions.includes(firmwareVersion)) {
      return `${label} rejected firmware ${firmwareVersion || 'missing'}.`;
    }
  }

  if (policy.allowed_ip_cidrs?.length) {
    const sourceIp = callerLock.sourceIp?.trim() || '';
    if (!sourceIp || !policy.allowed_ip_cidrs.some((cidr) => ipMatchesCidr(sourceIp, cidr))) {
      return `${label} rejected source IP ${sourceIp || 'missing'}.`;
    }
  }

  if (policy.allowed_client_certificate_thumbprints?.length) {
    const thumbprint = callerLock.clientCertificateThumbprint || '';
    if (!thumbprint || !policy.allowed_client_certificate_thumbprints.includes(thumbprint)) {
      return `${label} rejected client certificate thumbprint ${thumbprint || 'missing'}.`;
    }
  }

  if (policy.allowed_client_certificate_subjects?.length) {
    const subject = callerLock.clientCertificateSubject?.trim().toLowerCase() || '';
    if (!subject || !policy.allowed_client_certificate_subjects.some((allowed) => subject.includes(allowed))) {
      return `${label} rejected client certificate subject ${subject || 'missing'}.`;
    }
  }

  return null;
}

function enforceCallerLockPolicy(project: { caller_lock_policy?: Record<string, unknown> | null }, callerLock: SecureExecutionCallerLock): string | null {
  return enforceCallerLockPolicyValue(getCallerLockPolicy(project), callerLock);
}

function isBase64(value: string): boolean {
  try {
    return Buffer.from(value, 'base64').toString('base64').replace(/=+$/, '') === value.replace(/=+$/, '');
  } catch {
    return false;
  }
}

async function parseExecuteBody(request: Request): Promise<{ ok: true; value: ExecuteBody } | { ok: false; error: string }> {
  try {
    const body = (await request.json()) as ExecuteBody;
    return { ok: true, value: body };
  } catch {
    return { ok: false, error: 'Invalid JSON' };
  }
}

function generateRequestId(): string {
  return `exec_${crypto.randomUUID()}`;
}

function generateNonce(): string {
  return crypto.randomUUID();
}

function summarizeAttestationEvidence(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const evidence = value as Partial<AzureSecureExecutionAttestationEvidence>;
  const claims = isRecord(evidence.claims) ? evidence.claims : {};
  return {
    provider: evidence.provider || null,
    attestation_provider_uri: evidence.attestationProviderUri || null,
    attestation_token_hash: evidence.attestationTokenHash || null,
    key_release_policy_hash: evidence.keyReleasePolicyHash || null,
    key_id: evidence.keyId || null,
    key_version: evidence.keyVersion || null,
    executor_build_digest: evidence.executorBuildDigest || null,
    confidential_vm_resource_id: evidence.confidentialVmResourceId || null,
    claims: {
      attestation_type: claims.attestationType || null,
      secure_boot: claims.secureBoot ?? null,
      vm_isolation: claims.vmIsolation || null,
      measurement_summary: claims.measurementSummary || null,
    },
  };
}

function buildExecutionAuditMetadata(
  executionRequest: SecureExecutionRequest,
  responseStatus: number,
  responseData: unknown,
): Record<string, unknown> {
  const result = isRecord(responseData) ? responseData as Partial<SecureExecutionResult> : {};
  const attestation = summarizeAttestationEvidence(result.attestation);
  return {
    request_id: executionRequest.requestId,
    provider: executionRequest.provider,
    method: executionRequest.method,
    upstream_path: executionRequest.upstreamPath,
    executor_status: responseStatus,
    secure_execution: {
      request_id: result.requestId || executionRequest.requestId,
      status: typeof result.status === 'number' ? result.status : null,
      provider_request_id: result.providerRequestId || null,
      error: result.error || null,
      attestation,
    },
    attestation,
    caller_lock: executionRequest.callerLock || null,
  };
}

async function auditCallerLockDenied(
  env: EnterpriseControlPlaneEnv,
  project: {
    id: string;
    organization_id?: string | null;
    caller_lock_policy?: Record<string, unknown> | null;
  },
  actor: { userId: string; email: string | null },
  lockError: string,
  callerLock: SecureExecutionCallerLock,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  if (!project.organization_id) return;

  await writeGovernanceAuditEvent(env, {
    organization_id: project.organization_id,
    project_id: project.id,
    actor_user_id: actor.userId,
    actor_email: actor.email,
    event_type: 'enterprise_caller_lock_denied',
    target_type: 'project',
    target_id: project.id,
    description: lockError,
    metadata: {
      origin: callerLock.origin,
      referer_origin: callerLock.refererOrigin,
      customer_gateway: callerLock.customerGateway,
      client_class: callerLock.clientClass,
      fleet_id: callerLock.fleetId,
      firmware_version: callerLock.firmwareVersion,
      source_ip: callerLock.sourceIp,
      client_certificate_thumbprint: callerLock.clientCertificateThumbprint,
      client_certificate_subject: callerLock.clientCertificateSubject,
      policy: project.caller_lock_policy || {},
      ...metadata,
    },
  });
}

export async function handleEnterpriseExecuteRoutes(
  request: Request,
  env: EnterpriseControlPlaneEnv,
  pathSegments: string[],
): Promise<Response | null> {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) return null;
  if (
    !(request.method === 'POST'
      && pathSegments.length === 5
      && pathSegments[0] === 'projects'
      && pathSegments[2] === 'providers'
      && pathSegments[4] === 'execute')
  ) {
    return null;
  }

  if (!env.executorSigningKeyId || !env.executorSigningSecret) {
    return Response.json({ error: 'Secure executor signing is not configured yet.' }, { status: 501 });
  }

  const auth = await authenticateUser(request, env);
  if (!auth) {
    return Response.json(
      { error: 'Not authenticated. Pass Authorization: Bearer <supabase jwt>' },
      { status: 401 },
    );
  }

  const projectId = pathSegments[1];
  const slug = pathSegments[3];
  const project = await getAccessibleProject(env, auth.userId, projectId);
  if (!project) {
    return Response.json({ error: 'Project not found' }, { status: 404 });
  }
  if (!hasRequiredProjectRole(project.project_role, 'member')) {
    return Response.json({ error: 'Insufficient project permissions' }, { status: 403 });
  }

  const parsedBody = await parseExecuteBody(request);
  if (!parsedBody.ok) {
    return Response.json({ error: parsedBody.error }, { status: 400 });
  }

  const method = normalizeMethod(parsedBody.value.method);
  const upstreamPath = normalizeUpstreamPath(parsedBody.value.upstream_path);
  if (!upstreamPath) {
    return Response.json({ error: 'upstream_path is required' }, { status: 400 });
  }

  if (parsedBody.value.body_base64 && !isBase64(parsedBody.value.body_base64)) {
    return Response.json({ error: 'body_base64 must be valid base64' }, { status: 400 });
  }

  const callerLock = await buildCallerLock(request);
  const lockError = enforceOriginLock(project, callerLock) || enforceCallerLockPolicy(project, callerLock);
  if (lockError) {
    await auditCallerLockDenied(env, project, auth, lockError, callerLock, {
      policy_scope: 'project',
    });
    return Response.json({ error: lockError }, { status: 403 });
  }

  const supabase = getSupabase(env);
  const { data: keyRow } = await supabase
    .from('project_keys')
    .select('id, provider')
    .eq('project_id', project.id)
    .eq('slug', slug)
    .is('revoked_at', null)
    .maybeSingle();

  if (!keyRow) {
    return Response.json({ error: 'Project provider slot not found' }, { status: 404 });
  }

  const provider = (keyRow.provider as string) || slug;
  const providerLockPolicy = getProviderCallerLockPolicy(project, slug, provider);
  const providerLockError = providerLockPolicy
    ? enforceCallerLockPolicyValue(providerLockPolicy, callerLock, `Caller lock for ${slug}`)
    : null;
  if (providerLockError) {
    await auditCallerLockDenied(env, project, auth, providerLockError, callerLock, {
      policy_scope: 'provider',
      provider,
      slug,
    });
    return Response.json({ error: providerLockError }, { status: 403 });
  }

  const now = Date.now();
  const executionRequest: SecureExecutionRequest = {
    requestId: generateRequestId(),
    projectId: project.id,
    projectKeyId: keyRow.id as string,
    organizationId: project.organization_id,
    provider,
    slug,
    method,
    upstreamPath,
    query: normalizeQuery(parsedBody.value.query),
    headers: sanitizeHeaders(parsedBody.value.headers),
    bodyBase64: parsedBody.value.body_base64 || null,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    nonce: generateNonce(),
    callerLock,
  };

  const envelope = await buildSignedSecureExecutionEnvelope({
    keyId: env.executorSigningKeyId,
    secret: env.executorSigningSecret,
    request: executionRequest,
  });

  const response = await dispatchToSecureExecutor({
    envelope,
    env,
  });

  const responseData = await response.json().catch(() => null);

  if (project.organization_id) {
    await writeGovernanceAuditEvent(env, {
      organization_id: project.organization_id,
      project_id: project.id,
      actor_user_id: auth.userId,
      actor_email: auth.email,
      event_type: response.ok ? 'enterprise_secure_execution_dispatched' : 'enterprise_secure_execution_failed',
      target_type: 'project_key',
      target_id: keyRow.id as string,
      description: response.ok
        ? `Dispatched secure execution for ${slug} on ${project.name || project.vp_proj_id}`
        : `Failed secure execution dispatch for ${slug} on ${project.name || project.vp_proj_id}`,
      metadata: buildExecutionAuditMetadata(executionRequest, response.status, responseData),
    });
  }

  return Response.json({
    execution: responseData,
    request: {
      request_id: executionRequest.requestId,
      project_id: executionRequest.projectId,
      project_key_id: executionRequest.projectKeyId,
      provider: executionRequest.provider,
      slug: executionRequest.slug,
      method: executionRequest.method,
      upstream_path: executionRequest.upstreamPath,
      caller_lock: callerLock,
    },
  }, { status: response.status });
}
