import {
  buildSignedSecureExecutionEnvelope,
  type SecureExecutionAttestationEvidence,
  type SecureExecutionCallerLock,
  type SecureExecutionRequest,
  type SecureExecutionResult,
} from '@vaultproof/core';
import { createHmac, timingSafeEqual } from 'node:crypto';
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
  dry_run?: boolean;
  validate_only?: boolean;
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
  allowed_email_sender_domains?: string[];
  allowed_email_recipient_domains?: string[];
  allowed_email_recipients?: string[];
  allowed_email_template_ids?: string[];
  require_email_template_id?: boolean;
  provider_overrides?: Record<string, CallerLockPolicy>;
};

type ExecuteActor = {
  userId: string | null;
  email: string | null;
};

type ExecuteProjectContext = {
  id: string;
  organization_id: string | null;
  vp_proj_id: string;
  name: string | null;
  allowed_origins: string | null;
  strict_origin: boolean;
  caller_lock_policy?: Record<string, unknown> | null;
  created_at?: string | null;
  revoked_at?: string | null;
  project_role?: string;
  access_via?: string;
};

type ExecuteProviderContext = {
  id: string;
  provider: string | null;
  slug?: string | null;
  upstream_base_url?: string | null;
};

type EmailPolicyContext = {
  senderEmail: string | null;
  senderDomain: string | null;
  recipientEmails: string[];
  recipientDomains: string[];
  templateIds: string[];
  parseError: string | null;
};

type ExecuteContext = {
  project: ExecuteProjectContext;
  keyRow: ExecuteProviderContext;
  source: 'cache' | 'supabase';
};

type RuntimeTokenPayload = {
  v?: number;
  aud?: string;
  scope?: string;
  project_id?: string;
  exp?: number;
  nbf?: number;
  iat?: number;
  jti?: string;
  providers?: string[];
  slugs?: string[];
  methods?: string[];
  upstream_path_prefixes?: string[];
  customer_gateways?: string[];
};

type RuntimeTokenAuth = {
  payload: RuntimeTokenPayload;
  actor: ExecuteActor;
};

const executionRateLimitBuckets = new Map<string, { windowStart: number; count: number }>();
const executionContextCache = new Map<string, { expiresAt: number; context: ExecuteContext }>();

const RUNTIME_TOKEN_PREFIX = 'vp_exec_v1.';
const RUNTIME_TOKEN_AUDIENCE = 'vaultproof-enterprise-execute';
const RUNTIME_TOKEN_SCOPE = 'project:execute';
const RUNTIME_TOKEN_CLOCK_SKEW_SECONDS = 30;

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

const EMAIL_PROVIDER_SLUGS = new Set([
  'resend',
  'sendgrid',
  'mailgun',
  'postmark',
  'aws-ses',
  'aws_ses',
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

function constantTimeEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function extractBearerToken(request: Request): string {
  const authHeader = request.headers.get('authorization') || '';
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
}

function getRuntimeTokenSecret(env: EnterpriseControlPlaneEnv): string | null {
  const secret = env.enterpriseProxyTokenSecret?.trim() || '';
  return secret.length >= 32 ? secret : null;
}

function decodeRuntimeTokenPayload(encodedPayload: string): RuntimeTokenPayload | null {
  if (!encodedPayload || encodedPayload.length > 4096) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    return isRecord(parsed) ? parsed as RuntimeTokenPayload : null;
  } catch {
    return null;
  }
}

function signRuntimeTokenPayload(encodedPayload: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`${RUNTIME_TOKEN_PREFIX}${encodedPayload}`)
    .digest('base64url');
}

function getRuntimeTokenList(value: unknown, uppercase = false): string[] {
  const normalized = normalizePolicyList(value);
  return uppercase ? normalized.map((item) => item.toUpperCase()) : normalized;
}

function verifyEnterpriseRuntimeToken(
  request: Request,
  env: EnterpriseControlPlaneEnv,
  projectId: string,
): { status: 'none' } | { status: 'valid'; auth: RuntimeTokenAuth } | { status: 'invalid' } {
  const token = extractBearerToken(request);
  if (!token.startsWith(RUNTIME_TOKEN_PREFIX)) return { status: 'none' };
  if (token.length > 8192) return { status: 'invalid' };

  const secret = getRuntimeTokenSecret(env);
  if (!secret) return { status: 'invalid' };

  const remainder = token.slice(RUNTIME_TOKEN_PREFIX.length);
  const parts = remainder.split('.');
  if (parts.length !== 2) return { status: 'invalid' };

  const [encodedPayload, signature] = parts;
  if (!encodedPayload || !signature) return { status: 'invalid' };

  const expectedSignature = signRuntimeTokenPayload(encodedPayload, secret);
  if (!constantTimeEquals(signature, expectedSignature)) return { status: 'invalid' };

  const payload = decodeRuntimeTokenPayload(encodedPayload);
  if (!payload) return { status: 'invalid' };

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    payload.v !== 1
    || payload.aud !== RUNTIME_TOKEN_AUDIENCE
    || payload.scope !== RUNTIME_TOKEN_SCOPE
    || payload.project_id !== projectId
    || typeof payload.exp !== 'number'
    || !Number.isFinite(payload.exp)
    || payload.exp < nowSeconds - RUNTIME_TOKEN_CLOCK_SKEW_SECONDS
  ) {
    return { status: 'invalid' };
  }

  if (
    typeof payload.nbf === 'number'
    && Number.isFinite(payload.nbf)
    && payload.nbf > nowSeconds + RUNTIME_TOKEN_CLOCK_SKEW_SECONDS
  ) {
    return { status: 'invalid' };
  }

  const tokenId = typeof payload.jti === 'string' && payload.jti.trim()
    ? payload.jti.trim()
    : payload.project_id;
  return {
    status: 'valid',
    auth: {
      payload,
      actor: {
        userId: null,
        email: `runtime:${tokenId}`,
      },
    },
  };
}

function getSourceIp(request: Request, env: EnterpriseControlPlaneEnv): string | null {
  const expectedSecret = env.trustedSourceIpHeaderSecret?.trim();
  if (!expectedSecret) return null;

  const actualSecret = firstHeader(request, [
    'x-vaultproof-source-ip-secret',
    'x-vaultproof-client-ip-secret',
  ]);
  if (!actualSecret || !constantTimeEquals(actualSecret, expectedSecret)) return null;

  const sourceIp = firstHeader(request, [
    'x-vaultproof-source-ip',
    'x-vaultproof-client-ip',
  ]);
  return sourceIp?.split(',')[0]?.trim() || null;
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

async function buildCallerLock(request: Request, env: EnterpriseControlPlaneEnv): Promise<SecureExecutionCallerLock> {
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
    sourceIp: getSourceIp(request, env),
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
    allowed_providers: normalizePolicyList(raw.allowed_providers),
    allowed_methods: normalizePolicyList(raw.allowed_methods).map((method) => method.toUpperCase()),
    allowed_upstream_hosts: normalizePolicyList(raw.allowed_upstream_hosts).map((hostOrUrl) => {
      try {
        return new URL(hostOrUrl.includes('://') ? hostOrUrl : `https://${hostOrUrl}`).hostname.toLowerCase();
      } catch {
        return hostOrUrl;
      }
    }),
    allowed_upstream_path_prefixes: normalizePolicyList(raw.allowed_upstream_path_prefixes)
      .map((prefix) => prefix.startsWith('/') ? prefix : `/${prefix}`),
    rate_limit_per_minute: typeof raw.rate_limit_per_minute === 'number'
      && Number.isInteger(raw.rate_limit_per_minute)
      && raw.rate_limit_per_minute > 0
      ? raw.rate_limit_per_minute
      : undefined,
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
    allowed_email_sender_domains: normalizePolicyList(raw.allowed_email_sender_domains),
    allowed_email_recipient_domains: normalizePolicyList(raw.allowed_email_recipient_domains),
    allowed_email_recipients: normalizePolicyList(raw.allowed_email_recipients),
    allowed_email_template_ids: normalizePolicyList(raw.allowed_email_template_ids),
    require_email_template_id: raw.require_email_template_id === true,
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

function getUpstreamHost(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value.includes('://') ? value : `https://${value}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function classifyProtectedSecret(input: {
  provider: string;
  slug: string;
  upstreamBaseUrl?: string | null;
}): Record<string, unknown> {
  const provider = input.provider.trim().toLowerCase();
  const slug = input.slug.trim().toLowerCase();
  const upstreamHost = getUpstreamHost(input.upstreamBaseUrl);
  const emailHosts = [
    'api.resend.com',
    'api.sendgrid.com',
    'api.mailgun.net',
    'api.postmarkapp.com',
    'email.us-east-1.amazonaws.com',
  ];
  const isEmailProvider = EMAIL_PROVIDER_SLUGS.has(provider)
    || EMAIL_PROVIDER_SLUGS.has(slug)
    || Boolean(upstreamHost && emailHosts.includes(upstreamHost));

  return {
    protected_secret_kind: isEmailProvider ? 'email_api_key' : 'provider_api_key',
    protected_workflow: isEmailProvider ? 'email_provider_send' : 'provider_api_call',
  };
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
}

function normalizeEmailAddress(value: unknown): string | null {
  const raw = isRecord(value)
    ? String(value.email || value.Email || value.address || value.Address || '')
    : String(value || '');
  const match = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : null;
}

function extractEmailList(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return uniqueNonEmpty(value.flatMap((item) => extractEmailList(item)));
  if (isRecord(value)) {
    const direct = normalizeEmailAddress(value);
    return direct ? [direct] : [];
  }
  if (typeof value !== 'string') return [];
  return uniqueNonEmpty(value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []);
}

function getEmailDomain(email: string | null): string | null {
  if (!email || !email.includes('@')) return null;
  return email.split('@').pop()?.trim().toLowerCase() || null;
}

function extractTemplateId(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number') {
    const normalized = String(value).trim().toLowerCase();
    return normalized || null;
  }
  if (isRecord(value)) {
    return extractTemplateId(value.id || value.name || value.template_id || value.templateId || value.TemplateId);
  }
  return null;
}

function extractEmailTemplateIds(body: Record<string, unknown>): string[] {
  const directKeys = ['template_id', 'templateId', 'TemplateId', 'template', 'Template', 'TemplateName'];
  const values = directKeys
    .map((key) => extractTemplateId(body[key]))
    .filter(Boolean) as string[];

  for (const nestedKey of ['metadata', 'message', 'Message']) {
    const nested = body[nestedKey];
    if (!isRecord(nested)) continue;
    for (const key of directKeys) {
      const templateId = extractTemplateId(nested[key]);
      if (templateId) values.push(templateId);
    }
  }

  return uniqueNonEmpty(values);
}

function parseEmailPolicyBody(bodyBase64: string | null | undefined): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (!bodyBase64) return { ok: false, error: 'missing JSON email payload' };
  if (bodyBase64.length > 512_000) return { ok: false, error: 'email payload is too large to inspect' };
  try {
    const parsed = JSON.parse(Buffer.from(bodyBase64, 'base64').toString('utf8'));
    return isRecord(parsed)
      ? { ok: true, value: parsed }
      : { ok: false, error: 'email payload must be a JSON object' };
  } catch {
    return { ok: false, error: 'email payload could not be parsed as JSON' };
  }
}

function buildEmailPolicyContext(bodyBase64: string | null | undefined): EmailPolicyContext {
  const parsed = parseEmailPolicyBody(bodyBase64);
  if (!parsed.ok) {
    return {
      senderEmail: null,
      senderDomain: null,
      recipientEmails: [],
      recipientDomains: [],
      templateIds: [],
      parseError: parsed.error,
    };
  }

  const body = parsed.value;
  const senderEmail = extractEmailList(body.from || body.From || body.Source || body.sender || body.senderEmail)[0] || null;
  const recipientEmails = [
    ...extractEmailList(body.to),
    ...extractEmailList(body.To),
    ...extractEmailList(body.cc),
    ...extractEmailList(body.Cc),
    ...extractEmailList(body.bcc),
    ...extractEmailList(body.Bcc),
  ];

  const personalizations = body.personalizations;
  if (Array.isArray(personalizations)) {
    for (const personalization of personalizations) {
      if (!isRecord(personalization)) continue;
      recipientEmails.push(
        ...extractEmailList(personalization.to),
        ...extractEmailList(personalization.cc),
        ...extractEmailList(personalization.bcc),
      );
    }
  }

  const destination = body.Destination || body.destination;
  if (isRecord(destination)) {
    recipientEmails.push(
      ...extractEmailList(destination.ToAddresses),
      ...extractEmailList(destination.CcAddresses),
      ...extractEmailList(destination.BccAddresses),
      ...extractEmailList(destination.toAddresses),
      ...extractEmailList(destination.ccAddresses),
      ...extractEmailList(destination.bccAddresses),
    );
  }

  const normalizedRecipients = uniqueNonEmpty(recipientEmails);
  return {
    senderEmail,
    senderDomain: getEmailDomain(senderEmail),
    recipientEmails: normalizedRecipients,
    recipientDomains: uniqueNonEmpty(normalizedRecipients.map((email) => getEmailDomain(email) || '')),
    templateIds: extractEmailTemplateIds(body),
    parseError: null,
  };
}

function hasEmailPolicy(policy: CallerLockPolicy | null): boolean {
  return Boolean(
    policy?.allowed_email_sender_domains?.length
    || policy?.allowed_email_recipient_domains?.length
    || policy?.allowed_email_recipients?.length
    || policy?.allowed_email_template_ids?.length
    || policy?.require_email_template_id,
  );
}

function summarizeEmailPolicyForAudit(context: EmailPolicyContext): Record<string, unknown> {
  return {
    sender_domain: context.senderDomain,
    recipient_domains: context.recipientDomains,
    recipient_count: context.recipientEmails.length,
    template_ids: context.templateIds,
    parse_error: context.parseError,
  };
}

function buildEmailPolicyAuditMetadata(context: EmailPolicyContext | null): Record<string, unknown> {
  return context ? { email_policy: summarizeEmailPolicyForAudit(context) } : {};
}

function enforceEmailPolicyValue(
  policy: CallerLockPolicy,
  context: EmailPolicyContext,
  label = 'Email policy',
): string | null {
  if (!hasEmailPolicy(policy)) return null;
  if (context.parseError) {
    return `${label} rejected this request because ${context.parseError}.`;
  }

  if (policy.allowed_email_sender_domains?.length) {
    if (!context.senderDomain || !policy.allowed_email_sender_domains.includes(context.senderDomain)) {
      return `${label} rejected sender domain ${context.senderDomain || 'missing'}.`;
    }
  }

  if (policy.allowed_email_recipient_domains?.length) {
    if (!context.recipientDomains.length) {
      return `${label} rejected this request because no email recipients were found.`;
    }
    const deniedDomain = context.recipientDomains.find((domain) => !policy.allowed_email_recipient_domains?.includes(domain));
    if (deniedDomain) return `${label} rejected recipient domain ${deniedDomain}.`;
  }

  if (policy.allowed_email_recipients?.length) {
    if (!context.recipientEmails.length) {
      return `${label} rejected this request because no email recipients were found.`;
    }
    const deniedRecipient = context.recipientEmails.find((email) => !policy.allowed_email_recipients?.includes(email));
    if (deniedRecipient) return `${label} rejected recipient ${deniedRecipient}.`;
  }

  if (policy.require_email_template_id && !context.templateIds.length) {
    return `${label} rejected this request because template id is required.`;
  }

  if (policy.allowed_email_template_ids?.length) {
    if (!context.templateIds.length) {
      return `${label} rejected this request because no template id was found.`;
    }
    const deniedTemplate = context.templateIds.find((templateId) => !policy.allowed_email_template_ids?.includes(templateId));
    if (deniedTemplate) return `${label} rejected template ${deniedTemplate}.`;
  }

  return null;
}

function enforceExecutionPolicyValue(
  policy: CallerLockPolicy,
  input: {
    provider: string;
    slug: string;
    method: string;
    upstreamBaseUrl?: string | null;
    upstreamPath: string;
  },
  label = 'Execution policy',
): string | null {
  if (policy.allowed_providers?.length) {
    const providerCandidates = [input.provider, input.slug].map((value) => value.trim().toLowerCase()).filter(Boolean);
    if (!providerCandidates.some((candidate) => policy.allowed_providers?.includes(candidate))) {
      return `${label} rejected provider ${input.provider || input.slug || 'missing'}.`;
    }
  }

  if (policy.allowed_methods?.length) {
    const method = input.method.trim().toUpperCase();
    if (!policy.allowed_methods.includes(method)) {
      return `${label} rejected method ${method || 'missing'}.`;
    }
  }

  if (policy.allowed_upstream_hosts?.length) {
    const upstreamHost = getUpstreamHost(input.upstreamBaseUrl);
    if (!upstreamHost || !policy.allowed_upstream_hosts.includes(upstreamHost)) {
      return `${label} rejected upstream host ${upstreamHost || 'missing'}.`;
    }
  }

  if (policy.allowed_upstream_path_prefixes?.length) {
    const upstreamPath = input.upstreamPath.toLowerCase();
    if (!policy.allowed_upstream_path_prefixes.some((prefix) => upstreamPath.startsWith(prefix.toLowerCase()))) {
      return `${label} rejected upstream path ${input.upstreamPath || 'missing'}.`;
    }
  }

  return null;
}

function enforceExecutionPolicy(
  project: { caller_lock_policy?: Record<string, unknown> | null },
  input: Parameters<typeof enforceExecutionPolicyValue>[1],
): string | null {
  return enforceExecutionPolicyValue(getCallerLockPolicy(project), input);
}

function enforceRuntimeTokenScope(
  runtimeAuth: RuntimeTokenAuth | null,
  input: {
    provider: string;
    slug: string;
    method: string;
    upstreamPath: string;
    callerLock: SecureExecutionCallerLock;
  },
): string | null {
  if (!runtimeAuth) return null;
  const { payload } = runtimeAuth;

  const providers = getRuntimeTokenList(payload.providers);
  if (providers.length) {
    const candidates = [input.provider, input.slug].map((value) => value.trim().toLowerCase()).filter(Boolean);
    if (!candidates.some((candidate) => providers.includes(candidate))) {
      return `Runtime token scope rejected provider ${input.provider || input.slug || 'missing'}.`;
    }
  }

  const slugs = getRuntimeTokenList(payload.slugs);
  if (slugs.length && !slugs.includes(input.slug.trim().toLowerCase())) {
    return `Runtime token scope rejected slug ${input.slug || 'missing'}.`;
  }

  const methods = getRuntimeTokenList(payload.methods, true);
  if (methods.length && !methods.includes(input.method.trim().toUpperCase())) {
    return `Runtime token scope rejected method ${input.method || 'missing'}.`;
  }

  const upstreamPathPrefixes = getRuntimeTokenList(payload.upstream_path_prefixes)
    .map((prefix) => prefix.startsWith('/') ? prefix : `/${prefix}`);
  if (
    upstreamPathPrefixes.length
    && !upstreamPathPrefixes.some((prefix) => input.upstreamPath.toLowerCase().startsWith(prefix.toLowerCase()))
  ) {
    return `Runtime token scope rejected upstream path ${input.upstreamPath || 'missing'}.`;
  }

  const customerGateways = getRuntimeTokenList(payload.customer_gateways);
  if (customerGateways.length) {
    const gateway = input.callerLock.customerGateway?.trim().toLowerCase() || '';
    if (!gateway || !customerGateways.includes(gateway)) {
      return `Runtime token scope rejected gateway ${gateway || 'missing'}.`;
    }
  }

  return null;
}

function enforceRateLimit(policy: CallerLockPolicy | null, key: string, now = Date.now()): string | null {
  const limit = policy?.rate_limit_per_minute;
  if (!limit) return null;

  const windowMs = 60_000;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const existing = executionRateLimitBuckets.get(key);
  const bucket = existing?.windowStart === windowStart
    ? existing
    : { windowStart, count: 0 };
  bucket.count += 1;
  executionRateLimitBuckets.set(key, bucket);

  return bucket.count > limit
    ? `Rate limit exceeded for ${key}. Limit is ${limit} request(s) per minute.`
    : null;
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

function getExecutionContextCacheTtlMs(env: EnterpriseControlPlaneEnv): number {
  const rawTtl = env.enterpriseExecuteContextCacheTtlMs ?? 3000;
  if (!Number.isFinite(rawTtl) || rawTtl <= 0) return 0;
  return Math.min(Math.floor(rawTtl), 15_000);
}

function getExecutionContextCacheKey(env: EnterpriseControlPlaneEnv, projectId: string, slug: string): string {
  return `${env.supabaseUrl || 'supabase'}:${projectId}:${slug.trim().toLowerCase()}`;
}

function normalizeJoinedProject(value: unknown): ExecuteProjectContext | null {
  const project = Array.isArray(value) ? value[0] : value;
  if (!isRecord(project)) return null;
  if (typeof project.id !== 'string') return null;
  return {
    id: project.id,
    organization_id: typeof project.organization_id === 'string' ? project.organization_id : null,
    vp_proj_id: typeof project.vp_proj_id === 'string' ? project.vp_proj_id : project.id,
    name: typeof project.name === 'string' ? project.name : null,
    allowed_origins: typeof project.allowed_origins === 'string' ? project.allowed_origins : null,
    strict_origin: project.strict_origin === true,
    caller_lock_policy: isRecord(project.caller_lock_policy) ? project.caller_lock_policy : {},
    created_at: typeof project.created_at === 'string' ? project.created_at : null,
    revoked_at: typeof project.revoked_at === 'string' ? project.revoked_at : null,
  };
}

function normalizeExecuteKeyRow(value: unknown, slug: string): ExecuteProviderContext | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!isRecord(row)) return null;
  if (typeof row.id !== 'string') return null;
  return {
    id: row.id,
    provider: typeof row.provider === 'string' ? row.provider : slug,
    slug: typeof row.slug === 'string' ? row.slug : slug,
    upstream_base_url: typeof row.upstream_base_url === 'string' ? row.upstream_base_url : null,
  };
}

function normalizeExecuteContextFromJoinedRow(value: unknown, slug: string): ExecuteContext | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!isRecord(row)) return null;
  const keyRow = normalizeExecuteKeyRow(row, slug);
  const project = normalizeJoinedProject(row.projects);
  if (!keyRow || !project) return null;
  return {
    project,
    keyRow,
    source: 'supabase',
  };
}

async function fetchExecuteContextFallback(
  env: EnterpriseControlPlaneEnv,
  projectId: string,
  slug: string,
): Promise<ExecuteContext | null> {
  const supabase = getSupabase(env);
  const [{ data: keyData }, { data: projectData }] = await Promise.all([
    supabase
      .from('project_keys')
      .select('id, provider, slug, upstream_base_url')
      .eq('project_id', projectId)
      .eq('slug', slug)
      .is('revoked_at', null)
      .maybeSingle(),
    supabase
      .from('projects')
      .select('id, organization_id, vp_proj_id, name, allowed_origins, strict_origin, caller_lock_policy, created_at, revoked_at')
      .eq('id', projectId)
      .is('revoked_at', null)
      .maybeSingle(),
  ]);

  const keyRow = normalizeExecuteKeyRow(keyData, slug);
  const project = normalizeJoinedProject(projectData);
  if (!keyRow || !project) return null;

  return {
    project,
    keyRow,
    source: 'supabase',
  };
}

async function fetchExecuteContext(
  env: EnterpriseControlPlaneEnv,
  projectId: string,
  slug: string,
): Promise<ExecuteContext | null> {
  const supabase = getSupabase(env);
  const { data, error } = await supabase
    .from('project_keys')
    .select(`
      id,
      provider,
      slug,
      upstream_base_url,
      projects!inner (
        id,
        organization_id,
        vp_proj_id,
        name,
        allowed_origins,
        strict_origin,
        caller_lock_policy,
        created_at,
        revoked_at
      )
    `)
    .eq('project_id', projectId)
    .eq('slug', slug)
    .is('revoked_at', null)
    .is('projects.revoked_at', null)
    .maybeSingle();

  const context = !error ? normalizeExecuteContextFromJoinedRow(data, slug) : null;
  return context || fetchExecuteContextFallback(env, projectId, slug);
}

async function getExecuteContext(
  env: EnterpriseControlPlaneEnv,
  projectId: string,
  slug: string,
): Promise<ExecuteContext | null> {
  const ttlMs = getExecutionContextCacheTtlMs(env);
  const cacheKey = getExecutionContextCacheKey(env, projectId, slug);
  const now = Date.now();

  if (ttlMs > 0) {
    const cached = executionContextCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return {
        ...cached.context,
        source: 'cache',
      };
    }
  }

  const context = await fetchExecuteContext(env, projectId, slug);
  if (context && ttlMs > 0) {
    executionContextCache.set(cacheKey, {
      expiresAt: now + ttlMs,
      context,
    });
  }
  return context;
}

async function hashForAudit(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Buffer.from(digest).toString('base64url');
}

function generateRequestId(): string {
  return `exec_${crypto.randomUUID()}`;
}

function generateNonce(): string {
  return crypto.randomUUID();
}

function summarizeAttestationEvidence(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const evidence = value as Partial<SecureExecutionAttestationEvidence> & {
    attestationProviderUri?: string | null;
    attestationTokenHash?: string | null;
    keyReleasePolicyHash?: string | null;
    keyId?: string | null;
    keyVersion?: string | null;
    keyProtectionLevel?: string | null;
    projectId?: string | null;
    location?: string | null;
    executorBuildDigest?: string | null;
    confidentialVmResourceId?: string | null;
    claims?: unknown;
  };
  const claims = isRecord(evidence.claims)
    ? evidence.claims as {
        attestationType?: string | null;
        secureBoot?: boolean | null;
        vmIsolation?: string | null;
        measurementSummary?: string | null;
        imageDigest?: string | null;
        serviceAccountEmail?: string | null;
      }
    : {};
  return {
    provider: evidence.provider || null,
    attestation_provider_uri: evidence.attestationProviderUri || null,
    attestation_token_hash: evidence.attestationTokenHash || null,
    key_release_policy_hash: evidence.keyReleasePolicyHash || null,
    key_id: evidence.keyId || null,
    key_version: evidence.keyVersion || null,
    key_protection_level: evidence.keyProtectionLevel || null,
    gcp_project_id: evidence.projectId || null,
    gcp_location: evidence.location || null,
    executor_build_digest: evidence.executorBuildDigest || null,
    confidential_vm_resource_id: evidence.confidentialVmResourceId || null,
    claims: {
      attestation_type: claims.attestationType || null,
      secure_boot: claims.secureBoot ?? null,
      vm_isolation: claims.vmIsolation || null,
      measurement_summary: claims.measurementSummary || null,
      image_digest: claims.imageDigest || null,
      service_account_email: claims.serviceAccountEmail || null,
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
  actor: ExecuteActor,
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

async function auditExecutionRateLimited(
  env: EnterpriseControlPlaneEnv,
  project: {
    id: string;
    organization_id?: string | null;
  },
  actor: ExecuteActor,
  description: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  if (!project.organization_id) return;

  await writeGovernanceAuditEvent(env, {
    organization_id: project.organization_id,
    project_id: project.id,
    actor_user_id: actor.userId,
    actor_email: actor.email,
    event_type: 'enterprise_execution_rate_limited',
    target_type: 'project',
    target_id: project.id,
    description,
    metadata,
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

  const projectId = pathSegments[1];
  const slug = pathSegments[3];
  const runtimeVerification = verifyEnterpriseRuntimeToken(request, env, projectId);
  if (runtimeVerification.status === 'invalid') {
    return Response.json({ error: 'Invalid or expired runtime token.' }, { status: 401 });
  }

  const runtimeAuth = runtimeVerification.status === 'valid' ? runtimeVerification.auth : null;
  const dashboardAuth = runtimeAuth ? null : await authenticateUser(request, env);
  if (!runtimeAuth && !dashboardAuth) {
    return Response.json(
      { error: 'Not authenticated. Sign in to VaultProof Enterprise.' },
      { status: 401 },
    );
  }

  let project: ExecuteProjectContext | null = null;
  let keyRow: ExecuteProviderContext | null = null;
  let executeContextSource = runtimeAuth ? 'runtime_miss' : 'dashboard_session';

  if (dashboardAuth) {
    project = await getAccessibleProject(env, dashboardAuth.userId, projectId);
    if (!project) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }
    const projectRole = project.project_role as Parameters<typeof hasRequiredProjectRole>[0] | undefined;
    if (!projectRole || !hasRequiredProjectRole(projectRole, 'member')) {
      return Response.json({ error: 'Insufficient project permissions' }, { status: 403 });
    }
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

  if (runtimeAuth) {
    const context = await getExecuteContext(env, projectId, slug);
    if (!context) {
      return Response.json({ error: 'Project provider slot not found' }, { status: 404 });
    }
    project = context.project;
    keyRow = context.keyRow;
    executeContextSource = context.source;
  } else if (project) {
    const supabase = getSupabase(env);
    const { data: keyData } = await supabase
      .from('project_keys')
      .select('id, provider, slug, upstream_base_url')
      .eq('project_id', project.id)
      .eq('slug', slug)
      .is('revoked_at', null)
      .maybeSingle();

    keyRow = normalizeExecuteKeyRow(keyData, slug);
  }

  if (!project || !keyRow) {
    return Response.json({ error: 'Project provider slot not found' }, { status: 404 });
  }

  const actor = runtimeAuth?.actor || {
    userId: dashboardAuth?.userId || null,
    email: dashboardAuth?.email || null,
  };
  const authAuditMetadata = {
    auth_mode: runtimeAuth ? 'runtime_token' : 'dashboard_session',
    runtime_token_jti: runtimeAuth?.payload.jti || null,
    execute_context_source: executeContextSource,
  };
  const provider = keyRow.provider || slug;
  const upstreamBaseUrl = keyRow.upstream_base_url || null;
  const protectedSecret = classifyProtectedSecret({
    provider,
    slug,
    upstreamBaseUrl,
  });

  const callerLock = await buildCallerLock(request, env);
  const lockError = enforceOriginLock(project, callerLock) || enforceCallerLockPolicy(project, callerLock);
  if (lockError) {
    await auditCallerLockDenied(env, project, actor, lockError, callerLock, {
      policy_scope: 'project',
      provider,
      slug,
      ...protectedSecret,
      ...authAuditMetadata,
    });
    return Response.json({ error: lockError }, { status: 403 });
  }

  const runtimeScopeError = enforceRuntimeTokenScope(runtimeAuth, {
    provider,
    slug,
    method,
    upstreamPath,
    callerLock,
  });
  if (runtimeScopeError) {
    await auditCallerLockDenied(env, project, actor, runtimeScopeError, callerLock, {
      policy_scope: 'runtime_token',
      provider,
      slug,
      method,
      upstream_host: getUpstreamHost(upstreamBaseUrl),
      upstream_path: upstreamPath,
      ...protectedSecret,
      ...authAuditMetadata,
    });
    return Response.json({ error: runtimeScopeError }, { status: 403 });
  }

  const executionPolicyError = enforceExecutionPolicy(project, {
    provider,
    slug,
    method,
    upstreamBaseUrl,
    upstreamPath,
  });
  if (executionPolicyError) {
    await auditCallerLockDenied(env, project, actor, executionPolicyError, callerLock, {
      policy_scope: 'project_execution_policy',
      provider,
      slug,
      method,
      upstream_host: getUpstreamHost(upstreamBaseUrl),
      upstream_path: upstreamPath,
      ...protectedSecret,
      ...authAuditMetadata,
    });
    return Response.json({ error: executionPolicyError }, { status: 403 });
  }

  const providerLockPolicy = getProviderCallerLockPolicy(project, slug, provider);
  const providerLockError = providerLockPolicy
    ? enforceCallerLockPolicyValue(providerLockPolicy, callerLock, `Caller lock for ${slug}`)
    : null;
  if (providerLockError) {
    await auditCallerLockDenied(env, project, actor, providerLockError, callerLock, {
      policy_scope: 'provider',
      provider,
      slug,
      ...protectedSecret,
      ...authAuditMetadata,
    });
    return Response.json({ error: providerLockError }, { status: 403 });
  }

  const providerExecutionPolicyError = providerLockPolicy
    ? enforceExecutionPolicyValue(providerLockPolicy, {
        provider,
        slug,
        method,
        upstreamBaseUrl,
        upstreamPath,
      }, `Execution policy for ${slug}`)
    : null;
  if (providerExecutionPolicyError) {
    await auditCallerLockDenied(env, project, actor, providerExecutionPolicyError, callerLock, {
      policy_scope: 'provider_execution_policy',
      provider,
      slug,
      method,
      upstream_host: getUpstreamHost(upstreamBaseUrl),
      upstream_path: upstreamPath,
      ...protectedSecret,
      ...authAuditMetadata,
    });
    return Response.json({ error: providerExecutionPolicyError }, { status: 403 });
  }

  const projectPolicy = getCallerLockPolicy(project);
  const emailPolicyContext = protectedSecret.protected_secret_kind === 'email_api_key'
    ? buildEmailPolicyContext(parsedBody.value.body_base64)
    : null;
  const emailPolicyMetadata = buildEmailPolicyAuditMetadata(emailPolicyContext);
  const projectEmailPolicyError = emailPolicyContext
    ? enforceEmailPolicyValue(projectPolicy, emailPolicyContext)
    : null;
  if (projectEmailPolicyError) {
    await auditCallerLockDenied(env, project, actor, projectEmailPolicyError, callerLock, {
      policy_scope: 'project_email_policy',
      provider,
      slug,
      method,
      upstream_host: getUpstreamHost(upstreamBaseUrl),
      upstream_path: upstreamPath,
      ...protectedSecret,
      ...authAuditMetadata,
      ...emailPolicyMetadata,
    });
    return Response.json({ error: projectEmailPolicyError }, { status: 403 });
  }

  const providerEmailPolicyError = emailPolicyContext && providerLockPolicy
    ? enforceEmailPolicyValue(providerLockPolicy, emailPolicyContext, `Email policy for ${slug}`)
    : null;
  if (providerEmailPolicyError) {
    await auditCallerLockDenied(env, project, actor, providerEmailPolicyError, callerLock, {
      policy_scope: 'provider_email_policy',
      provider,
      slug,
      method,
      upstream_host: getUpstreamHost(upstreamBaseUrl),
      upstream_path: upstreamPath,
      ...protectedSecret,
      ...authAuditMetadata,
      ...emailPolicyMetadata,
    });
    return Response.json({ error: providerEmailPolicyError }, { status: 403 });
  }

  const projectRateLimitError = enforceRateLimit(projectPolicy, `project:${project.id}`);
  if (projectRateLimitError) {
    await auditExecutionRateLimited(env, project, actor, projectRateLimitError, {
      policy_scope: 'project_rate_limit',
      provider,
      slug,
      method,
      upstream_host: getUpstreamHost(upstreamBaseUrl),
      upstream_path: upstreamPath,
      rate_limit_per_minute: projectPolicy.rate_limit_per_minute,
      ...protectedSecret,
      ...authAuditMetadata,
      ...emailPolicyMetadata,
    });
    return Response.json({ error: projectRateLimitError }, { status: 429 });
  }

  const providerRateLimitError = enforceRateLimit(providerLockPolicy, `project:${project.id}:provider:${slug}`);
  if (providerRateLimitError) {
    await auditExecutionRateLimited(env, project, actor, providerRateLimitError, {
      policy_scope: 'provider_rate_limit',
      provider,
      slug,
      method,
      upstream_host: getUpstreamHost(upstreamBaseUrl),
      upstream_path: upstreamPath,
      rate_limit_per_minute: providerLockPolicy?.rate_limit_per_minute,
      ...protectedSecret,
      ...authAuditMetadata,
      ...emailPolicyMetadata,
    });
    return Response.json({ error: providerRateLimitError }, { status: 429 });
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

  const dryRun = parsedBody.value.dry_run === true || parsedBody.value.validate_only === true;
  if (dryRun) {
    const signatureHash = await hashForAudit(envelope.signature);
    const dryRunData = {
      requestId: executionRequest.requestId,
      status: 202,
      dryRun: true,
      message: 'Secure execution validated. Upstream provider dispatch was skipped.',
      signedEnvelope: {
        keyId: envelope.keyId,
        signatureHash,
        issuedAt: executionRequest.issuedAt,
        expiresAt: executionRequest.expiresAt,
      },
    };

    if (project.organization_id) {
      await writeGovernanceAuditEvent(env, {
        organization_id: project.organization_id,
        project_id: project.id,
        actor_user_id: actor.userId,
        actor_email: actor.email,
        event_type: 'enterprise_secure_execution_validated',
        target_type: 'project_key',
        target_id: keyRow.id,
        description: `Validated secure execution for ${slug} on ${project.name || project.vp_proj_id}`,
        metadata: {
          dry_run: true,
          signed_envelope: dryRunData.signedEnvelope,
          ...protectedSecret,
          ...authAuditMetadata,
          ...buildExecutionAuditMetadata(executionRequest, 202, dryRunData),
          ...emailPolicyMetadata,
        },
      });
    }

    return Response.json({
      execution: dryRunData,
      request: {
        request_id: executionRequest.requestId,
        project_id: executionRequest.projectId,
        project_key_id: executionRequest.projectKeyId,
        provider: executionRequest.provider,
        slug: executionRequest.slug,
        method: executionRequest.method,
        upstream_path: executionRequest.upstreamPath,
        caller_lock: callerLock,
        dry_run: true,
        auth_mode: authAuditMetadata.auth_mode,
        execute_context_source: executeContextSource,
      },
    }, { status: 202 });
  }

  const response = await dispatchToSecureExecutor({
    envelope,
    env,
  });

  const responseData = await response.json().catch(() => null);

  if (project.organization_id) {
    await writeGovernanceAuditEvent(env, {
      organization_id: project.organization_id,
      project_id: project.id,
      actor_user_id: actor.userId,
      actor_email: actor.email,
      event_type: response.ok ? 'enterprise_secure_execution_dispatched' : 'enterprise_secure_execution_failed',
      target_type: 'project_key',
      target_id: keyRow.id,
      description: response.ok
        ? `Dispatched secure execution for ${slug} on ${project.name || project.vp_proj_id}`
        : `Failed secure execution dispatch for ${slug} on ${project.name || project.vp_proj_id}`,
      metadata: {
        ...protectedSecret,
        ...authAuditMetadata,
        ...buildExecutionAuditMetadata(executionRequest, response.status, responseData),
        ...emailPolicyMetadata,
      },
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
      auth_mode: authAuditMetadata.auth_mode,
      execute_context_source: executeContextSource,
    },
  }, { status: response.status });
}
