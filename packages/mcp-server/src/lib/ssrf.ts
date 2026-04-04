/**
 * SSRF protection helpers.
 *
 * Ported from packages/backend/src/routes/developer-keys.ts
 * Adapted to use Web-compatible APIs (no Node `net` module).
 */

/**
 * Return true if the given IPv4 address string (dotted-decimal) falls within
 * a private or reserved range.
 */
function isPrivateIpv4(ip: string): boolean {
  return /^(127\.|0\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[0-2]\d))/.test(ip);
}

/**
 * Return true if `s` looks like a dotted-decimal IPv4 address.
 * We accept the same set that Node's `isIP(h) === 4` would accept.
 */
function isDottedIpv4(s: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(s);
}

/**
 * Return true if `s` is a plain decimal integer (alternative IPv4 notation).
 */
function isPureDecimal(s: string): boolean {
  return /^\d+$/.test(s);
}

/**
 * Return true if `s` looks like an IPv6 address (with or without brackets).
 */
function isIpv6(s: string): boolean {
  // Bracketed form used in URLs: [::1]
  if (s.startsWith('[') && s.endsWith(']')) return true;
  // Bare IPv6 (contains at least two colons)
  return (s.match(/:/g) || []).length >= 2;
}

/**
 * Validate that a URL targets a public HTTPS endpoint.
 *
 * Blocks:
 * - Non-HTTPS schemes (http is only allowed in a non-production environment —
 *   since Workers have no NODE_ENV, we always require HTTPS here)
 * - localhost / ::1
 * - IPv4 private/reserved ranges, including decimal/octal notation
 * - IPv6 private/link-local/ULA ranges
 * - URLs containing credentials (user:pass@host)
 *
 * Ported from packages/backend/src/routes/developer-keys.ts lines 15–51,
 * replacing Node's `isIP` (from `net`) with regex-based equivalents.
 */
export function isPublicUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();

    // Must be HTTPS
    if (u.protocol !== 'https:') return false;

    // Block localhost variants
    if (h === 'localhost' || h === '[::1]' || h === '::1') return false;

    // Block IPv4 private/reserved ranges (including decimal notation)
    if (isDottedIpv4(h) || isPureDecimal(h)) {
      let ip = h;
      if (isPureDecimal(h)) {
        const num = parseInt(h, 10);
        if (num >= 0 && num <= 0xffffffff) {
          ip = `${(num >>> 24) & 0xff}.${(num >>> 16) & 0xff}.${(num >>> 8) & 0xff}.${num & 0xff}`;
        }
      }
      if (isPrivateIpv4(ip)) return false;
    }

    // Block IPv6 private/reserved
    if (isIpv6(h)) {
      const v6 = h.replace(/^\[|\]$/g, '');
      if (
        /^(::1|fe80:|fc00:|fd00:|::ffff:(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.))/.test(
          v6.toLowerCase()
        )
      )
        return false;
    }

    // Block URL credentials (user:pass@host)
    if (u.username || u.password) return false;

    return true;
  } catch {
    return false;
  }
}
