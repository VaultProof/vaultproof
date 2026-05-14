import type { ProviderSpec } from './providers.js';

const MAX_URL_LENGTH = 500;
const MAX_HOSTNAME_LENGTH = 253;
const MAX_LABEL_LENGTH = 63;
const LABEL_REGEX = /^[A-Za-z](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,31}$/;
const HEADER_NAME_REGEX = /^[A-Za-z][A-Za-z0-9-]{0,63}$/;
const ENV_VAR_REGEX = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

const HOSTNAME_BLOCKLIST = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data.ec2.internal',
  'kubernetes.default',
  'kubernetes.default.svc',
]);

const HOSTNAME_SUFFIX_BLOCKLIST = [
  '.local',
  '.internal',
  '.localhost',
  '.localdomain',
  '.arpa',
  '.workers.dev',
  '.cloudflare.com',
  '.cloudflareaccess.com',
  '.cfargotunnel.com',
  '.svc.cluster.local',
];

const RESERVED_SLUGS = new Set(['api', 'health', 'admin', 'p']);

const SECRET_NAME_PATTERNS = [
  /(?:^|_)API_KEY$/,
  /(?:^|_)SECRET_KEY$/,
  /(?:^|_)ACCESS_TOKEN$/,
  /(?:^|_)AUTH_TOKEN$/,
  /(?:^|_)BEARER_TOKEN$/,
  /(?:^|_)SERVICE_TOKEN$/,
  /(?:^|_)PRIVATE_TOKEN$/,
  /(?:^|_)TOKEN$/,
];

const PUBLIC_NAME_PATTERNS = [
  /^NEXT_PUBLIC_/,
  /^VITE_/,
  /^PUBLIC_/,
  /(?:^|_)PUBLIC_KEY$/,
  /(?:^|_)PUBLISHABLE_KEY$/,
  /(?:^|_)ANON_KEY$/,
  /(?:^|_)WEBHOOK_SECRET$/,
  /(?:^|_)WEBHOOK$/,
  /(?:^|_)PRICE_ID$/,
  /(?:^|_)CLIENT_ID$/,
  /(?:^|_)BASE_URL$/,
  /(?:^|_)URL$/,
];

const NON_SECRET_VALUES = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'development',
  'production',
  'staging',
  'test',
]);

export interface EnvEntryLike {
  name: string;
  value: string;
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

export interface UpstreamValidationResult extends ValidationResult {
  normalizedUrl?: string;
}

export interface CustomProviderInput {
  id: string;
  label: string;
  envVar: string;
  upstreamBaseUrl: string;
  authHeaderName: string;
  authHeaderTemplate: string;
  baseUrlEnvVar: string;
}

export function isLikelyCustomSecretEntry(entry: EnvEntryLike): boolean {
  const name = entry.name.toUpperCase();
  const value = entry.value.trim();
  if (!value || value.startsWith('vp-proj-')) return false;
  if (name.startsWith('VAULTPROOF_')) return false;
  if (PUBLIC_NAME_PATTERNS.some((pattern) => pattern.test(name))) return false;
  if (!SECRET_NAME_PATTERNS.some((pattern) => pattern.test(name))) return false;
  if (value.length < 12) return false;
  if (NON_SECRET_VALUES.has(value.toLowerCase())) return false;
  if (/^https?:\/\//i.test(value)) return false;
  return true;
}

export function deriveCustomProviderId(envVar: string): string {
  const cleaned = envVar
    .toLowerCase()
    .replace(/(?:_api_key|_secret_key|_access_token|_auth_token|_bearer_token|_service_token|_private_token|_token)$/u, '')
    .replace(/_api$/u, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 32);
  return cleaned || 'custom-api';
}

export function deriveCustomLabel(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ') || 'Custom API';
}

export function deriveBaseUrlEnvVar(envVar: string): string {
  const upper = envVar.toUpperCase();
  if (upper.endsWith('_API_KEY')) return upper.replace(/_API_KEY$/u, '_API_BASE_URL');
  if (upper.endsWith('_SECRET_KEY')) return upper.replace(/_SECRET_KEY$/u, '_BASE_URL');
  if (upper.endsWith('_ACCESS_TOKEN')) return upper.replace(/_ACCESS_TOKEN$/u, '_BASE_URL');
  if (upper.endsWith('_AUTH_TOKEN')) return upper.replace(/_AUTH_TOKEN$/u, '_BASE_URL');
  if (upper.endsWith('_BEARER_TOKEN')) return upper.replace(/_BEARER_TOKEN$/u, '_BASE_URL');
  if (upper.endsWith('_SERVICE_TOKEN')) return upper.replace(/_SERVICE_TOKEN$/u, '_BASE_URL');
  if (upper.endsWith('_PRIVATE_TOKEN')) return upper.replace(/_PRIVATE_TOKEN$/u, '_BASE_URL');
  if (upper.endsWith('_TOKEN')) return upper.replace(/_TOKEN$/u, '_BASE_URL');
  return `${upper}_BASE_URL`;
}

export function validateProviderSlug(slug: string): ValidationResult {
  if (!SLUG_REGEX.test(slug)) {
    return { ok: false, error: 'Slug must be 1-32 chars: lowercase letters, numbers, and hyphens only' };
  }
  if (RESERVED_SLUGS.has(slug)) {
    return { ok: false, error: `Slug is reserved: ${slug}` };
  }
  if (slug.startsWith('vaultenv-')) {
    return { ok: false, error: 'Slug prefix is reserved for VaultProof env secrets' };
  }
  return { ok: true };
}

export function validateCustomUpstreamUrl(raw: string): UpstreamValidationResult {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, error: 'Upstream URL must be a non-empty string' };
  }
  if (raw.length > MAX_URL_LENGTH) {
    return { ok: false, error: `Upstream URL exceeds ${MAX_URL_LENGTH} characters` };
  }
  if (/[\r\n\t\0]/u.test(raw)) {
    return { ok: false, error: 'Upstream URL contains control characters' };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'Upstream URL is not a valid URL' };
  }

  if (url.protocol !== 'https:') {
    return { ok: false, error: `Scheme not allowed: ${url.protocol} (only https: is permitted)` };
  }
  if (url.username || url.password) {
    return { ok: false, error: 'Upstream URL must not contain embedded credentials' };
  }
  if (url.port && url.port !== '443') {
    return { ok: false, error: `Port not allowed: ${url.port} (only 443 is permitted)` };
  }

  const host = url.hostname.toLowerCase();
  if (host.length === 0 || host.length > MAX_HOSTNAME_LENGTH) {
    return { ok: false, error: 'Hostname length out of range' };
  }
  if (host.includes(':')) {
    return { ok: false, error: 'IPv6 hostnames are not allowed' };
  }
  if (/^[0-9a-fx.]+$/iu.test(host) && !/[a-wyz]/iu.test(host)) {
    return { ok: false, error: 'IP literal hostnames are not allowed' };
  }
  if (!host.includes('.')) {
    return { ok: false, error: 'Hostname must be a fully-qualified domain' };
  }
  if (HOSTNAME_BLOCKLIST.has(host)) {
    return { ok: false, error: `Hostname is blocked: ${host}` };
  }
  for (const suffix of HOSTNAME_SUFFIX_BLOCKLIST) {
    if (host === suffix.slice(1) || host.endsWith(suffix)) {
      return { ok: false, error: `Hostname suffix is blocked: ${suffix}` };
    }
  }

  const labels = host.split('.');
  for (const label of labels) {
    if (label.length === 0 || label.length > MAX_LABEL_LENGTH) {
      return { ok: false, error: 'Hostname label length out of range' };
    }
    if (!LABEL_REGEX.test(label)) {
      return { ok: false, error: `Invalid hostname label: ${label}` };
    }
    if (label.startsWith('xn--')) {
      return { ok: false, error: 'Punycode hostnames are not allowed' };
    }
  }

  const tld = labels[labels.length - 1];
  if (!/^[A-Za-z]{2,}$/u.test(tld)) {
    return { ok: false, error: 'TLD must be alphabetic' };
  }

  const normalizedUrl = `https://${host}${url.pathname === '/' ? '' : url.pathname.replace(/\/+$/u, '')}`;
  return { ok: true, normalizedUrl };
}

export function validateCustomHeaderName(name: string): ValidationResult {
  if (!HEADER_NAME_REGEX.test(name)) {
    return { ok: false, error: 'Header name must start with a letter and contain only letters, numbers, and hyphens' };
  }
  const lower = name.toLowerCase();
  if (new Set(['host', 'content-length', 'transfer-encoding', 'connection']).has(lower)) {
    return { ok: false, error: `Header name is reserved: ${name}` };
  }
  return { ok: true };
}

export function validateEnvVarName(name: string): ValidationResult {
  if (!ENV_VAR_REGEX.test(name)) {
    return { ok: false, error: 'Environment variable name must start with a letter or underscore and contain only letters, numbers, and underscores' };
  }
  return { ok: true };
}

export function validateCustomHeaderTemplate(template: string): ValidationResult {
  if (template.length === 0 || template.length > 256) {
    return { ok: false, error: 'Header template must be 1-256 characters' };
  }
  if (/[\r\n\0]/u.test(template) || /[\x00-\x1F\x7F]/u.test(template)) {
    return { ok: false, error: 'Header template contains control characters' };
  }
  if (!template.includes('{key}')) {
    return { ok: false, error: 'Header template must contain {key}' };
  }
  return { ok: true };
}

export function buildCustomProviderSpec(input: CustomProviderInput): ProviderSpec {
  return {
    id: input.id,
    label: input.label,
    upstream_base_url: input.upstreamBaseUrl,
    auth_header_name: input.authHeaderName,
    auth_header_template: input.authHeaderTemplate,
    env_var_default: input.envVar,
    base_url_env_var: input.baseUrlEnvVar,
    base_url_path_suffix: `/p/${input.id}`,
    detect: {
      regex: '^[\\s\\S]+$',
      var_hint: input.envVar,
    },
  };
}
