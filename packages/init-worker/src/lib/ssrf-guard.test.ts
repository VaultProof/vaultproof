/**
 * SSRF guard unit tests.
 *
 * Run: npx tsx src/lib/ssrf-guard.test.ts
 */
import {
  validateUpstreamUrl,
  validateHeaderName,
  validateHeaderTemplate,
  validateExtraHeaders,
  validateSlug,
} from './ssrf-guard.js';

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function expectAllow(url: string): void {
  const r = validateUpstreamUrl(url);
  ok(`allow ${url}`, r.ok, r.error);
}

function expectReject(url: string, reasonSubstr?: string): void {
  const r = validateUpstreamUrl(url);
  const okReason = reasonSubstr ? r.error?.includes(reasonSubstr) ?? false : true;
  ok(`reject ${url}`, !r.ok && okReason, r.error || 'allowed but should reject');
}

console.log('── upstream URL ──────────────────────────────────────────');

// ── Allow: real provider hosts ──
expectAllow('https://api.openai.com');
expectAllow('https://api.stripe.com');
expectAllow('https://api.anthropic.com/');
expectAllow('https://openrouter.ai/api');
expectAllow('https://api.x.ai');
expectAllow('https://gwzkjiomemjlhtrdrlan.supabase.co');
expectAllow('https://api.openai.com:443');

// ── Reject: schemes ──
expectReject('http://api.openai.com', 'Scheme');
expectReject('file:///etc/passwd', 'Scheme');
expectReject('data:text/plain,hello', 'Scheme');
expectReject('gopher://example.com/', 'Scheme');
expectReject('javascript:alert(1)', 'Scheme');
expectReject('ftp://example.com/', 'Scheme');
expectReject('ws://example.com/', 'Scheme');
expectReject('ssh://example.com/', 'Scheme');

// ── Reject: embedded credentials ──
expectReject('https://user:pass@api.openai.com/', 'credentials');
expectReject('https://admin@api.openai.com/', 'credentials');

// ── Reject: non-443 ports ──
expectReject('https://api.openai.com:80/', 'Port');
expectReject('https://api.openai.com:8080/', 'Port');
expectReject('https://api.openai.com:22/', 'Port');
expectReject('https://api.openai.com:25565/', 'Port');

// ── Reject: IP literals ──
expectReject('https://127.0.0.1/', 'IP literal');
expectReject('https://1.2.3.4/', 'IP literal');
expectReject('https://169.254.169.254/', 'IP literal');
expectReject('https://10.0.0.1/', 'IP literal');
expectReject('https://192.168.1.1/', 'IP literal');

// ── Reject: IPv6 literals ──
expectReject('https://[::1]/');
expectReject('https://[fe80::1]/');
expectReject('https://[2001:db8::1]/');

// ── Reject: loopback/metadata names ──
// Bare `localhost` has no dot, so it's rejected by FQDN check before the blocklist.
// Either error is fine — the URL is rejected.
expectReject('https://localhost/');
expectReject('https://localhost.localdomain/', 'blocked');
expectReject('https://metadata.google.internal/', 'blocked');
expectReject('https://instance-data.ec2.internal/', 'blocked');

// ── Reject: .local / .internal / .arpa suffixes ──
expectReject('https://my-service.local/', 'suffix');
expectReject('https://backend.internal/', 'suffix');
expectReject('https://something.localhost/', 'suffix');
expectReject('https://host.svc.cluster.local/', 'suffix');
expectReject('https://something.arpa/', 'suffix');

// ── Reject: Cloudflare-internal suffixes ──
expectReject('https://evil.workers.dev/', 'suffix');
expectReject('https://attacker.cloudflare.com/', 'suffix');
expectReject('https://something.cfargotunnel.com/', 'suffix');

// ── Reject: bare hostnames (no dot) ──
expectReject('https://router/', 'fully-qualified');
expectReject('https://localhost'); // caught by FQDN or blocklist — either is fine

// ── Reject: punycode ──
expectReject('https://xn--google-com.evil.com/', 'Punycode');

// ── Reject: invalid characters ──
expectReject('https://api_example.com/', 'Invalid hostname label');
expectReject('https://-lead.example.com/', 'Invalid hostname label');
expectReject('https://trail-.example.com/', 'Invalid hostname label');

// ── Reject: length ──
expectReject('https://' + 'a'.repeat(260) + '.com/', 'length');
const huge = 'https://api.openai.com/' + 'x'.repeat(600);
expectReject(huge, 'exceeds');

// ── Reject: control characters ──
expectReject('https://api.openai.com/\r\nHost: evil.com', 'control');
expectReject('https://api.openai.com/\x00', 'control');

// ── Reject: numeric TLD ──
// URL parser itself rejects numeric-only TLDs in most cases; we just want
// to confirm the combined validator refuses them.
expectReject('https://example.123/');

console.log('── header name ───────────────────────────────────────────');
ok('allow Authorization', validateHeaderName('Authorization').ok);
ok('allow x-api-key', validateHeaderName('x-api-key').ok);
ok('allow X-Custom-Header', validateHeaderName('X-Custom-Header').ok);
ok('reject Host', !validateHeaderName('Host').ok);
ok('reject Content-Length', !validateHeaderName('Content-Length').ok);
ok('reject empty', !validateHeaderName('').ok);
ok('reject with space', !validateHeaderName('X Api').ok);
ok('reject with newline', !validateHeaderName('X\r\nEvil').ok);

console.log('── header template ───────────────────────────────────────');
ok('allow Bearer {key}', validateHeaderTemplate('Bearer {key}').ok);
ok('allow {key}', validateHeaderTemplate('{key}').ok);
ok('allow token {key}', validateHeaderTemplate('token {key}').ok);
ok('reject missing placeholder', !validateHeaderTemplate('Bearer xxx').ok);
ok('reject newline injection', !validateHeaderTemplate('Bearer {key}\r\nX-Evil: 1').ok);
ok('reject empty', !validateHeaderTemplate('').ok);
ok('reject oversized', !validateHeaderTemplate('{key}' + 'a'.repeat(300)).ok);

console.log('── extra headers ─────────────────────────────────────────');
ok('allow null', validateExtraHeaders(null).ok);
ok('allow empty object', validateExtraHeaders({}).ok);
ok('allow one entry', validateExtraHeaders({ 'X-Version': '2026-01-01' }).ok);
ok('reject array', !validateExtraHeaders(['not', 'an', 'object']).ok);
ok('reject Host override', !validateExtraHeaders({ Host: 'evil.com' }).ok);
ok('reject newline injection', !validateExtraHeaders({ 'X-Version': '2026\r\nX-Evil: 1' }).ok);
ok('reject too many', !validateExtraHeaders(Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`X-H-${i}`, 'v']))).ok);

console.log('── slug ──────────────────────────────────────────────────');
ok('allow openai', validateSlug('openai').ok);
ok('allow stripe-test', validateSlug('stripe-test').ok);
ok('allow 1234', validateSlug('1234').ok);
ok('reject uppercase', !validateSlug('OpenAI').ok);
ok('reject underscore', !validateSlug('open_ai').ok);
ok('reject leading hyphen', !validateSlug('-openai').ok);
ok('reject empty', !validateSlug('').ok);
ok('reject reserved api', !validateSlug('api').ok);
ok('reject reserved health', !validateSlug('health').ok);
ok('reject reserved p', !validateSlug('p').ok);
ok('reject too long', !validateSlug('a'.repeat(40)).ok);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
