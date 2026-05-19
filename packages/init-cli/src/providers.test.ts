/**
 * Provider detection test — validates each regex in providers.json matches
 * representative keys, and confirms no cross-matching between providers.
 */
import { scanDirectory } from './scan.js';
import type { ProviderSpec } from './providers.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const catalogPath = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'providers.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8')) as { providers: ProviderSpec[] };

interface Sample {
  providerId: string;
  varName: string;
  value: string;
}

// One representative sample per provider. If a pattern has a `var_hint`, the
// varName must include it (that's the disambiguation signal).
const SAMPLES: Sample[] = [
  { providerId: 'anthropic', varName: 'ANTHROPIC_API_KEY', value: 'sk-ant-api03-' + 'a'.repeat(90) },
  { providerId: 'groq', varName: 'GROQ_API_KEY', value: 'gsk_' + 'a'.repeat(48) },
  { providerId: 'xai', varName: 'XAI_API_KEY', value: 'xai-' + 'a'.repeat(80) },
  { providerId: 'openrouter', varName: 'OPENROUTER_API_KEY', value: 'sk-or-v1-' + 'a'.repeat(60) },
  { providerId: 'deepseek', varName: 'DEEPSEEK_API_KEY', value: 'sk-' + 'a'.repeat(32) },
  { providerId: 'openai', varName: 'OPENAI_API_KEY', value: 'sk-proj-' + 'a'.repeat(40) },
  { providerId: 'openai', varName: 'OPENAI_API_KEY', value: 'sk-' + 'a'.repeat(48) },
  { providerId: 'stripe', varName: 'STRIPE_SECRET_KEY', value: 'sk_live_' + 'a'.repeat(24) },
  { providerId: 'stripe', varName: 'STRIPE_SECRET_KEY', value: 'sk_test_' + 'a'.repeat(24) },
  { providerId: 'mistral', varName: 'MISTRAL_API_KEY', value: 'a'.repeat(32) },
  { providerId: 'together', varName: 'TOGETHER_API_KEY', value: 'f'.repeat(64) },
  { providerId: 'fireworks', varName: 'FIREWORKS_API_KEY', value: 'fw_' + 'a'.repeat(32) },
  { providerId: 'resend', varName: 'RESEND_API_KEY', value: 're_' + 'a'.repeat(32) },
  { providerId: 'sendgrid', varName: 'SENDGRID_API_KEY', value: 'SG.' + 'a'.repeat(22) + '.' + 'b'.repeat(42) },
  { providerId: 'brevo', varName: 'BREVO_API_KEY', value: 'xkeysib-' + 'a'.repeat(40) },
  { providerId: 'sendinblue', varName: 'SENDINBLUE_API_KEY', value: 'xkeysib-' + 'b'.repeat(40) },
  { providerId: 'sparkpost', varName: 'SPARKPOST_API_KEY', value: 'c'.repeat(40) },
  { providerId: 'mailersend', varName: 'MAILERSEND_API_KEY', value: 'mlsn.' + 'd'.repeat(32) },
  { providerId: 'elasticemail', varName: 'ELASTICEMAIL_API_KEY', value: 'e'.repeat(32) },
  { providerId: 'mailjet', varName: 'MAILJET_API_KEY', value: 'f'.repeat(24) },
  { providerId: 'zeptomail', varName: 'ZEPTOMAIL_API_KEY', value: 'z'.repeat(40) },
  { providerId: 'smtp2go', varName: 'SMTP2GO_API_KEY', value: 's'.repeat(40) },
  { providerId: 'mailtrap', varName: 'MAILTRAP_API_TOKEN', value: 'm'.repeat(40) },
  { providerId: 'mailerlite', varName: 'MAILERLITE_API_KEY', value: 'l'.repeat(40) },
  { providerId: 'loops', varName: 'LOOPS_API_KEY', value: 'o'.repeat(40) },
  { providerId: 'courier', varName: 'COURIER_API_KEY', value: 'u'.repeat(40) },
  { providerId: 'customerio', varName: 'CUSTOMERIO_API_KEY', value: 'i'.repeat(40) },
  { providerId: 'postageapp', varName: 'POSTAGEAPP_API_KEY', value: 'p'.repeat(40) },
  { providerId: 'sender', varName: 'SENDER_API_KEY', value: 'n'.repeat(40) },
  { providerId: 'sendlayer', varName: 'SENDLAYER_API_KEY', value: 'y'.repeat(40) },
  { providerId: 'ahasend', varName: 'AHASEND_API_KEY', value: 'h'.repeat(40) },
  { providerId: 'linear', varName: 'LINEAR_API_KEY', value: 'lin_api_' + 'a'.repeat(40) },
  { providerId: 'notion', varName: 'NOTION_API_KEY', value: 'secret_' + 'a'.repeat(42) },
  { providerId: 'notion', varName: 'NOTION_API_KEY', value: 'ntn_' + 'a'.repeat(42) },
  { providerId: 'github', varName: 'GITHUB_TOKEN', value: 'ghp_' + 'a'.repeat(40) },
  { providerId: 'github', varName: 'GITHUB_TOKEN', value: 'github_pat_' + 'a'.repeat(82) },
  { providerId: 'minimax', varName: 'MINIMAX_API_KEY', value: 'sk-cp-' + 'a'.repeat(48) },
  { providerId: 'voyage', varName: 'VOYAGE_API_KEY', value: 'pa-' + 'a'.repeat(48) },
  { providerId: 'jina', varName: 'JINA_API_KEY', value: 'jina_' + 'a'.repeat(48) },
  { providerId: 'ai21', varName: 'AI21_API_KEY', value: 'a'.repeat(48) },
  { providerId: 'assemblyai', varName: 'ASSEMBLYAI_API_KEY', value: 'A'.repeat(32) },
  { providerId: 'gitlab', varName: 'GITLAB_TOKEN', value: 'glpat-' + 'a'.repeat(32) },
  { providerId: 'deepl', varName: 'DEEPL_API_KEY', value: '279a2e9d-83b3-c416-7e2d-f721593e42a0:fx' },
  { providerId: 'deepl-pro', varName: 'DEEPL_API_KEY', value: '279a2e9d-83b3-c416-7e2d-f721593e42a0' },
  { providerId: 'launchdarkly', varName: 'LAUNCHDARKLY_ACCESS_TOKEN', value: 'api-' + 'a'.repeat(48) },
  { providerId: 'snyk', varName: 'SNYK_TOKEN', value: 'a'.repeat(40) },
  { providerId: 'pagerduty', varName: 'PAGERDUTY_API_KEY', value: 'p'.repeat(40) },
  { providerId: 'honeycomb', varName: 'HONEYCOMB_API_KEY', value: 'h'.repeat(40) },
  { providerId: 'weaviate', varName: 'WEAVIATE_API_KEY', value: 'w'.repeat(40) },
  { providerId: 'grafana', varName: 'GRAFANA_SERVICE_ACCOUNT_TOKEN', value: 'glsa_' + 'g'.repeat(40) },
];

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) passed++;
  else { failed++; console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`); }
}

// Build a temp .env with ONE sample at a time, scan it, verify the right provider.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-regex-test-'));

console.log('── positive tests (each sample matches its intended provider) ──');
for (const sample of SAMPLES) {
  const envPath = path.join(tmpDir, '.env');
  fs.writeFileSync(envPath, `${sample.varName}=${sample.value}\n`);
  const findings = scanDirectory(tmpDir, catalog.providers);
  ok(
    `${sample.providerId} matches ${sample.varName}`,
    findings.length === 1 && findings[0].provider.id === sample.providerId,
    findings.length === 0 ? 'no match' : findings[0].provider.id,
  );
}

console.log('── cross-contamination tests (each sample should NOT match other providers) ──');
for (const sample of SAMPLES) {
  const envPath = path.join(tmpDir, '.env');
  fs.writeFileSync(envPath, `${sample.varName}=${sample.value}\n`);
  const findings = scanDirectory(tmpDir, catalog.providers);
  if (findings.length !== 1) continue;
  const matched = findings[0].provider.id;
  ok(
    `no cross-match ${sample.providerId} → something else`,
    matched === sample.providerId,
    `got ${matched}`,
  );
}

console.log('── negative tests (non-key values must not match) ──');
const NEGATIVES = [
  ['DATABASE_URL', 'postgres://user:pass@host/db'],
  ['NODE_ENV', 'production'],
  ['JSON', '{"foo":"bar"}'],
  ['BASE64', 'aGVsbG8gd29ybGQ='],
  ['UUID', '550e8400-e29b-41d4-a716-446655440000'],
  ['HEX_SHORT', 'abcdef1234567890'],
  ['RANDOM_WORD', 'password123'],
  ['SHA256', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'], // 64 hex — must NOT match together (no var_hint)
  ['PASSWORD_32', 'MySuperSecretPasswordNeverGuess!'], // 32 printable — must NOT match mistral (no var_hint)
];
for (const [name, val] of NEGATIVES) {
  const envPath = path.join(tmpDir, '.env');
  fs.writeFileSync(envPath, `${name}=${val}\n`);
  const findings = scanDirectory(tmpDir, catalog.providers);
  ok(`negative: ${name}`, findings.length === 0, findings.length ? `matched ${findings[0].provider.id}` : '');
}

console.log('── var_hint tests (generic patterns must require hint in var name) ──');
// Mistral has pattern /^[A-Za-z0-9]{32}$/ with var_hint "MISTRAL"
// Together has pattern /^[a-f0-9]{64}$/ with var_hint "TOGETHER"
const hintTests: Array<[string, string, string, string | null]> = [
  ['MISTRAL_KEY',    'a'.repeat(32),          'mistral',     'mistral'],
  ['SECRET_TOKEN',   'a'.repeat(32),          'no-match',    null],     // 32 chars, no hint
  ['TOGETHER_KEY',   'f'.repeat(64),          'together',    'together'],
  ['SHA_HASH',       'f'.repeat(64),          'no-match',    null],     // 64 hex, no hint
  ['ASSEMBLYAI_API_KEY', 'A'.repeat(32),      'assemblyai',  'assemblyai'],
  ['RANDOM_API_KEY',     'A'.repeat(32),      'no-match',    null],     // same shape, no hint
];
for (const [name, val, label, expected] of hintTests) {
  const envPath = path.join(tmpDir, '.env');
  fs.writeFileSync(envPath, `${name}=${val}\n`);
  const findings = scanDirectory(tmpDir, catalog.providers);
  const actual = findings.length ? findings[0].provider.id : null;
  ok(`hint: ${name} → ${label}`, actual === expected, `got ${actual}`);
}

fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
