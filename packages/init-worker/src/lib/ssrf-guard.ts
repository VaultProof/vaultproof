/**
 * SSRF guard for user-declared upstream URLs.
 *
 * Threat model: a compromised or malicious user account registers an upstream
 * URL that points at internal infrastructure (cloud metadata, loopback,
 * private networks, Cloudflare-internal hosts, etc.). Our worker would fetch
 * it and return the response to the attacker.
 *
 * Defenses (deny-list model per Nelson's choice):
 *   1. Scheme: must be `https:`. No http/file/data/gopher/javascript/ftp.
 *   2. No embedded credentials in URL.
 *   3. Port: empty or :443 only.
 *   4. Hostname format: must be a registrable domain (≥ 1 dot, alphabetic
 *      labels, no numeric literals, no IPv4/IPv6, RFC-1035 label rules).
 *   5. Hostname blocklist: loopback names, cloud metadata, `.local`/`.internal`
 *      suffixes, Cloudflare-internal suffixes.
 *   6. Length limits: ≤500 URL chars, ≤253 hostname chars, ≤63 per label.
 *   7. No punycode (`xn--` labels) — they enable homograph confusion.
 *
 * Redirects are handled separately by passing `redirect: 'manual'` to fetch,
 * so this module doesn't need to worry about redirect-based pivots.
 *
 * DNS rebinding is mitigated by Cloudflare's Workers runtime, which refuses
 * to fetch RFC-1918 addresses regardless of what a hostname resolves to.
 */

const MAX_URL_LENGTH = 500;
const MAX_HOSTNAME_LENGTH = 253;
const MAX_LABEL_LENGTH = 63;

// RFC-1035 label: letter-start, letter/digit/hyphen, letter/digit-end.
// Length check is applied separately (regex uses {1,63} but we also cap total).
const LABEL_REGEX = /^[A-Za-z](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

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

export interface UpstreamValidationResult {
  ok: boolean;
  error?: string;
  normalizedUrl?: string;
}

export function validateUpstreamUrl(raw: string): UpstreamValidationResult {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, error: 'Upstream URL must be a non-empty string' };
  }
  if (raw.length > MAX_URL_LENGTH) {
    return { ok: false, error: `Upstream URL exceeds ${MAX_URL_LENGTH} characters` };
  }
  if (/[\r\n\t\0]/.test(raw)) {
    return { ok: false, error: 'Upstream URL contains control characters' };
  }

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, error: 'Upstream URL is not a valid URL' };
  }

  // Scheme
  if (u.protocol !== 'https:') {
    return { ok: false, error: `Scheme not allowed: ${u.protocol} (only https: is permitted)` };
  }

  // Embedded credentials
  if (u.username || u.password) {
    return { ok: false, error: 'Upstream URL must not contain embedded credentials' };
  }

  // Port: empty or 443
  if (u.port && u.port !== '443') {
    return { ok: false, error: `Port not allowed: ${u.port} (only 443 is permitted)` };
  }

  // Hostname
  const host = u.hostname.toLowerCase();
  if (host.length === 0 || host.length > MAX_HOSTNAME_LENGTH) {
    return { ok: false, error: 'Hostname length out of range' };
  }

  // Reject IPv6 literals (URL parser strips brackets but keeps colons in hostname).
  if (host.includes(':')) {
    return { ok: false, error: 'IPv6 hostnames are not allowed' };
  }

  // Reject raw IPv4 literals including obfuscated forms.
  // This matches dotted, dotless decimal, hex, and octal encodings.
  if (/^[0-9a-fx.]+$/i.test(host) && !/[a-wyz]/i.test(host)) {
    // No alphabetic chars other than hex digits — treat as numeric literal.
    // (Real domains have at least one letter in the TLD.)
    return { ok: false, error: 'IP literal hostnames are not allowed' };
  }

  // Hostname must contain at least one dot (reject bare hostnames like `router`).
  if (!host.includes('.')) {
    return { ok: false, error: 'Hostname must be a fully-qualified domain' };
  }

  // Exact blocklist
  if (HOSTNAME_BLOCKLIST.has(host)) {
    return { ok: false, error: `Hostname is blocked: ${host}` };
  }

  // Suffix blocklist
  for (const suffix of HOSTNAME_SUFFIX_BLOCKLIST) {
    if (host === suffix.slice(1) || host.endsWith(suffix)) {
      return { ok: false, error: `Hostname suffix is blocked: ${suffix}` };
    }
  }

  // Per-label validation
  const labels = host.split('.');
  for (const label of labels) {
    if (label.length === 0 || label.length > MAX_LABEL_LENGTH) {
      return { ok: false, error: 'Hostname label length out of range' };
    }
    if (!LABEL_REGEX.test(label)) {
      return { ok: false, error: `Invalid hostname label: ${label}` };
    }
    if (label.startsWith('xn--')) {
      return { ok: false, error: 'Punycode hostnames are not allowed (homograph risk)' };
    }
  }

  // TLD must be alphabetic (reject things like `1.2.3.4` that slip past IP check).
  const tld = labels[labels.length - 1];
  if (!/^[A-Za-z]{2,}$/.test(tld)) {
    return { ok: false, error: 'TLD must be alphabetic' };
  }

  // Normalize: no trailing slash on base URL (we append paths later).
  const normalized = `https://${host}${u.pathname === '/' ? '' : u.pathname.replace(/\/+$/, '')}`;

  return { ok: true, normalizedUrl: normalized };
}

// ── Header validation ──────────────────────────────────────────────────────

const HEADER_NAME_REGEX = /^[A-Za-z][A-Za-z0-9-]{0,63}$/;

export function validateHeaderName(name: string): { ok: boolean; error?: string } {
  if (typeof name !== 'string' || !HEADER_NAME_REGEX.test(name)) {
    return { ok: false, error: 'Header name must match /^[A-Za-z][A-Za-z0-9-]{0,63}$/' };
  }
  const lower = name.toLowerCase();
  // Block headers the worker injects itself or that would confuse the fetch runtime.
  const forbidden = new Set(['host', 'content-length', 'transfer-encoding', 'connection']);
  if (forbidden.has(lower)) {
    return { ok: false, error: `Header name is reserved: ${name}` };
  }
  return { ok: true };
}

export function validateHeaderTemplate(template: string): { ok: boolean; error?: string } {
  if (typeof template !== 'string' || template.length === 0 || template.length > 256) {
    return { ok: false, error: 'Header template must be a 1–256 char string' };
  }
  if (/[\r\n\0]/.test(template)) {
    return { ok: false, error: 'Header template contains control characters' };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(template)) {
    return { ok: false, error: 'Header template contains non-printable characters' };
  }
  if (!template.includes('{key}')) {
    return { ok: false, error: 'Header template must contain the {key} placeholder' };
  }
  return { ok: true };
}

export function validateExtraHeaders(extras: unknown): { ok: boolean; error?: string } {
  if (extras === null || extras === undefined) return { ok: true };
  if (typeof extras !== 'object' || Array.isArray(extras)) {
    return { ok: false, error: 'extra_headers must be an object' };
  }
  const entries = Object.entries(extras as Record<string, unknown>);
  if (entries.length > 10) {
    return { ok: false, error: 'extra_headers may contain at most 10 entries' };
  }
  for (const [k, v] of entries) {
    const nameCheck = validateHeaderName(k);
    if (!nameCheck.ok) return nameCheck;
    if (typeof v !== 'string' || v.length === 0 || v.length > 256) {
      return { ok: false, error: `extra_headers[${k}] must be a 1–256 char string` };
    }
    if (/[\r\n\0]/.test(v)) {
      return { ok: false, error: `extra_headers[${k}] contains control characters` };
    }
  }
  return { ok: true };
}

// ── Slug validation ────────────────────────────────────────────────────────

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,31}$/;

export function validateSlug(slug: string): { ok: boolean; error?: string } {
  if (typeof slug !== 'string' || !SLUG_REGEX.test(slug)) {
    return { ok: false, error: 'Slug must match /^[a-z0-9][a-z0-9-]{0,31}$/' };
  }
  // Reserve short/ambiguous slugs.
  const reserved = new Set(['api', 'health', 'admin', 'p']);
  if (reserved.has(slug)) {
    return { ok: false, error: `Slug is reserved: ${slug}` };
  }
  return { ok: true };
}
