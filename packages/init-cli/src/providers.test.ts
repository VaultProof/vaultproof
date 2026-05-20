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
  { providerId: 'azure-openai', varName: 'AZURE_OPENAI_API_KEY', value: 'a'.repeat(48) },
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
  { providerId: 'netlify', varName: 'NETLIFY_AUTH_TOKEN', value: 'n'.repeat(40) },
  { providerId: 'render', varName: 'RENDER_API_KEY', value: 'r'.repeat(40) },
  { providerId: 'heroku', varName: 'HEROKU_API_KEY', value: 'HRKU-' + 'h'.repeat(40) },
  { providerId: 'digitalocean', varName: 'DIGITALOCEAN_TOKEN', value: 'dop_v1_' + 'd'.repeat(48) },
  { providerId: 'fastly', varName: 'FASTLY_API_TOKEN', value: 'f'.repeat(40) },
  { providerId: 'terraform-cloud', varName: 'TERRAFORM_CLOUD_TOKEN', value: 't'.repeat(40) },
  { providerId: 'pulumi', varName: 'PULUMI_ACCESS_TOKEN', value: 'p'.repeat(40) },
  { providerId: 'chargebee', varName: 'CHARGEBEE_API_KEY', value: 'c'.repeat(40) },
  { providerId: 'adyen', varName: 'ADYEN_API_KEY', value: 'a'.repeat(40) },
  { providerId: 'twilio', varName: 'TWILIO_API_KEY_SECRET', value: 'twilio_' + 's'.repeat(32) },
  { providerId: 'jira', varName: 'JIRA_API_TOKEN', value: 'j'.repeat(40) },
  { providerId: 'zendesk', varName: 'ZENDESK_API_TOKEN', value: 'z'.repeat(40) },
  { providerId: 'freshdesk', varName: 'FRESHDESK_API_KEY', value: 'f'.repeat(40) },
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
  { providerId: 'npm-registry', varName: 'NPM_TOKEN', value: 'npm_' + 'n'.repeat(40) },
  { providerId: 'qdrant', varName: 'QDRANT_API_KEY', value: 'q'.repeat(40) },
  { providerId: 'turso', varName: 'TURSO_API_TOKEN', value: 't'.repeat(40) },
  { providerId: 'meilisearch', varName: 'MEILISEARCH_API_KEY', value: 'm'.repeat(40) },
  { providerId: 'typesense', varName: 'TYPESENSE_API_KEY', value: 't'.repeat(40) },
  { providerId: 'elasticsearch', varName: 'ELASTICSEARCH_API_KEY', value: 'e'.repeat(40) },
  { providerId: 'railway', varName: 'RAILWAY_API_TOKEN', value: 'r'.repeat(40) },
  { providerId: 'fly', varName: 'FLY_API_TOKEN', value: 'FlyV1 ' + 'f'.repeat(40) },
  { providerId: 'circleci', varName: 'CIRCLE_TOKEN', value: 'c'.repeat(40) },
  { providerId: 'buildkite', varName: 'BUILDKITE_API_TOKEN', value: 'b'.repeat(40) },
  { providerId: 'bitbucket', varName: 'BITBUCKET_APP_PASSWORD', value: 'b'.repeat(40) },
  { providerId: 'semgrep', varName: 'SEMGREP_APP_TOKEN', value: 's'.repeat(40) },
  { providerId: 'sonarcloud', varName: 'SONAR_TOKEN', value: 's'.repeat(40) },
  { providerId: 'betterstack', varName: 'BETTERSTACK_API_TOKEN', value: 'b'.repeat(40) },
  { providerId: 'logsnag', varName: 'LOGSNAG_API_TOKEN', value: 'l'.repeat(40) },
  { providerId: 'raygun', varName: 'RAYGUN_PAT', value: 'r'.repeat(40) },
  { providerId: 'doppler', varName: 'DOPPLER_TOKEN', value: 'dp.' + 'd'.repeat(40) },
  { providerId: 'segment', varName: 'SEGMENT_WRITE_KEY', value: 's'.repeat(40) },
  { providerId: 'plausible', varName: 'PLAUSIBLE_API_KEY', value: 'p'.repeat(40) },
  { providerId: 'webflow', varName: 'WEBFLOW_API_TOKEN', value: 'w'.repeat(40) },
  { providerId: 'svix', varName: 'SVIX_AUTH_TOKEN', value: 'sk_' + 's'.repeat(40) },
  { providerId: 'knock', varName: 'KNOCK_API_KEY', value: 'knock_' + 'k'.repeat(40) },
  { providerId: 'hume', varName: 'HUME_API_KEY', value: 'h'.repeat(40) },
  { providerId: 'runpod', varName: 'RUNPOD_API_KEY', value: 'r'.repeat(40) },
  { providerId: 'browserbase', varName: 'BROWSERBASE_API_KEY', value: 'b'.repeat(40) },
  { providerId: 'paystack', varName: 'PAYSTACK_SECRET_KEY', value: 'sk_live_' + 'p'.repeat(32) },
  { providerId: 'lemonsqueezy', varName: 'LEMONSQUEEZY_API_KEY', value: 'l'.repeat(40) },
  { providerId: 'okta', varName: 'OKTA_API_TOKEN', value: 'o'.repeat(40) },
  { providerId: 'stytch', varName: 'STYTCH_SECRET', value: 'secret-' + 's'.repeat(40) },
  { providerId: 'figma', varName: 'FIGMA_TOKEN', value: 'figd_' + 'f'.repeat(40) },
  { providerId: 'asana', varName: 'ASANA_ACCESS_TOKEN', value: 'a'.repeat(40) },
  { providerId: 'clickup', varName: 'CLICKUP_API_TOKEN', value: 'pk_' + 'c'.repeat(40) },
  { providerId: 'monday', varName: 'MONDAY_API_KEY', value: 'm'.repeat(40) },
  { providerId: 'todoist', varName: 'TODOIST_API_TOKEN', value: 't'.repeat(40) },
  { providerId: 'coda', varName: 'CODA_API_TOKEN', value: 'c'.repeat(40) },
  { providerId: 'shortcut', varName: 'SHORTCUT_API_TOKEN', value: 's'.repeat(40) },
  { providerId: 'activecampaign', varName: 'ACTIVECAMPAIGN_API_KEY', value: 'a'.repeat(40) },
  { providerId: 'klaviyo', varName: 'KLAVIYO_PRIVATE_API_KEY', value: 'pk_' + 'k'.repeat(40) },
  { providerId: 'iterable', varName: 'ITERABLE_API_KEY', value: 'i'.repeat(40) },
  { providerId: 'braze', varName: 'BRAZE_API_KEY', value: 'b'.repeat(40) },
  { providerId: 'onesignal', varName: 'ONESIGNAL_REST_API_KEY', value: 'o'.repeat(40) },
  { providerId: 'novu', varName: 'NOVU_SECRET_KEY', value: 'n'.repeat(40) },
  { providerId: 'opsgenie', varName: 'OPSGENIE_API_KEY', value: 'o'.repeat(40) },
  { providerId: 'statuspage', varName: 'STATUSPAGE_API_KEY', value: 's'.repeat(40) },
  { providerId: 'telnyx', varName: 'TELNYX_API_KEY', value: 't'.repeat(40) },
  { providerId: 'vonage', varName: 'VONAGE_API_SECRET', value: 'v'.repeat(40) },
  { providerId: 'messagebird', varName: 'MESSAGEBIRD_ACCESS_KEY', value: 'm'.repeat(40) },
  { providerId: 'plivo', varName: 'PLIVO_AUTH_TOKEN', value: 'p'.repeat(40) },
  { providerId: 'directus', varName: 'DIRECTUS_TOKEN', value: 'd'.repeat(40) },
  { providerId: 'strapi', varName: 'STRAPI_API_TOKEN', value: 's'.repeat(40) },
  { providerId: 'hygraph', varName: 'HYGRAPH_TOKEN', value: 'h'.repeat(40) },
  { providerId: 'datocms', varName: 'DATOCMS_API_TOKEN', value: 'd'.repeat(40) },
  { providerId: 'contentstack', varName: 'CONTENTSTACK_MANAGEMENT_TOKEN', value: 'c'.repeat(40) },
  { providerId: 'storyblok', varName: 'STORYBLOK_PERSONAL_TOKEN', value: 's'.repeat(40) },
  { providerId: 'hashicorp-vault', varName: 'VAULT_TOKEN', value: 'hvs.' + 'v'.repeat(40) },
  { providerId: 'onepassword-connect', varName: 'OP_CONNECT_TOKEN', value: 'o'.repeat(40) },
  { providerId: 'linode', varName: 'LINODE_TOKEN', value: 'l'.repeat(40) },
  { providerId: 'vultr', varName: 'VULTR_API_KEY', value: 'v'.repeat(40) },
  { providerId: 'hetzner', varName: 'HCLOUD_TOKEN', value: 'h'.repeat(40) },
  { providerId: 'scaleway', varName: 'SCW_SECRET_KEY', value: 's'.repeat(40) },
  { providerId: 'brave-search', varName: 'BRAVE_SEARCH_API_KEY', value: 'b'.repeat(40) },
  { providerId: 'apify', varName: 'APIFY_TOKEN', value: 'a'.repeat(40) },
  { providerId: 'flagsmith', varName: 'FLAGSMITH_API_KEY', value: 'f'.repeat(40) },
  { providerId: 'splitio', varName: 'SPLIT_API_KEY', value: 's'.repeat(40) },
  { providerId: 'fal-ai', varName: 'FAL_KEY', value: 'f'.repeat(40) },
  { providerId: 'serper', varName: 'SERPER_API_KEY', value: 's'.repeat(40) },
  { providerId: 'make', varName: 'MAKE_API_TOKEN', value: '12345678-12ef-abcd-1234-1234567890ab' },
  { providerId: 'n8n', varName: 'N8N_API_KEY', value: 'n'.repeat(40) },
  { providerId: 'axiom', varName: 'AXIOM_TOKEN', value: 'a'.repeat(40) },
  { providerId: 'influxdb', varName: 'INFLUX_API_TOKEN', value: 'i'.repeat(40) },
  { providerId: 'rollbar', varName: 'ROLLBAR_ACCESS_TOKEN', value: 'r'.repeat(40) },
  { providerId: 'bugsnag', varName: 'BUGSNAG_AUTH_TOKEN', value: 'b'.repeat(40) },
  { providerId: 'codecov', varName: 'CODECOV_TOKEN', value: 'c'.repeat(40) },
  { providerId: 'browserstack', varName: 'BROWSERSTACK_ACCESS_KEY', value: 'b'.repeat(40) },
  { providerId: 'auth0', varName: 'AUTH0_MANAGEMENT_TOKEN', value: 'a'.repeat(40) },
  { providerId: 'fusionauth', varName: 'FUSIONAUTH_API_KEY', value: 'f'.repeat(40) },
  { providerId: 'aiven', varName: 'AIVEN_TOKEN', value: 'a'.repeat(40) },
  { providerId: 'cockroachdb', varName: 'COCKROACHDB_CLOUD_API_KEY', value: 'c'.repeat(40) },
  { providerId: 'datastax-astra', varName: 'ASTRA_DB_APPLICATION_TOKEN', value: 'AstraCS:' + 'a'.repeat(40) },
  { providerId: 'redis-cloud', varName: 'REDIS_CLOUD_USER_KEY', value: 'r'.repeat(40) },
  { providerId: 'clickhouse', varName: 'CLICKHOUSE_API_KEY_SECRET', value: 'c'.repeat(40) },
  { providerId: 'razorpay', varName: 'RAZORPAY_KEY_SECRET', value: 'r'.repeat(40) },
  { providerId: 'mollie', varName: 'MOLLIE_API_KEY', value: 'live_' + 'm'.repeat(40) },
  { providerId: 'gocardless', varName: 'GOCARDLESS_ACCESS_TOKEN', value: 'g'.repeat(40) },
  { providerId: 'mercadopago', varName: 'MERCADOPAGO_ACCESS_TOKEN', value: 'm'.repeat(40) },
  { providerId: 'wise', varName: 'WISE_API_TOKEN', value: 'w'.repeat(40) },
  { providerId: 'shippo', varName: 'SHIPPO_API_TOKEN', value: 's'.repeat(40) },
  { providerId: 'easypost', varName: 'EASYPOST_API_KEY', value: 'e'.repeat(40) },
  { providerId: 'shipengine', varName: 'SHIPENGINE_API_KEY', value: 's'.repeat(40) },
  { providerId: 'front', varName: 'FRONT_API_TOKEN', value: 'f'.repeat(40) },
  { providerId: 'helpscout', varName: 'HELPSCOUT_ACCESS_TOKEN', value: 'h'.repeat(40) },
  { providerId: 'calendly', varName: 'CALENDLY_ACCESS_TOKEN', value: 'c'.repeat(40) },
  { providerId: 'typeform', varName: 'TYPEFORM_PERSONAL_TOKEN', value: 't'.repeat(40) },
  { providerId: 'productboard', varName: 'PRODUCTBOARD_ACCESS_TOKEN', value: 'p'.repeat(40) },
  { providerId: 'dropbox', varName: 'DROPBOX_ACCESS_TOKEN', value: 'd'.repeat(40) },
  { providerId: 'box', varName: 'BOX_ACCESS_TOKEN', value: 'b'.repeat(40) },
  { providerId: 'pinata', varName: 'PINATA_JWT', value: 'eyJ' + 'p'.repeat(40) },
  { providerId: 'deepinfra', varName: 'DEEPINFRA_API_KEY', value: 'd'.repeat(40) },
  { providerId: 'baseten', varName: 'BASETEN_API_KEY', value: 'b'.repeat(40) },
  { providerId: 'cartesia', varName: 'CARTESIA_API_KEY', value: 'sk_car_' + 'c'.repeat(40) },
  { providerId: 'unstructured', varName: 'UNSTRUCTURED_API_KEY', value: 'u'.repeat(40) },
  { providerId: 'luma-ai', varName: 'LUMA_AGENTS_API_KEY', value: 'l'.repeat(40) },
  { providerId: 'portkey', varName: 'PORTKEY_API_KEY', value: 'p'.repeat(40) },
  { providerId: 'scale', varName: 'SCALE_API_KEY', value: 's'.repeat(40) },
  { providerId: 'braintrust', varName: 'BRAINTRUST_API_KEY', value: 'b'.repeat(40) },
  { providerId: 'edenai', varName: 'EDENAI_API_KEY', value: 'e'.repeat(40) },
  { providerId: 'virustotal', varName: 'VIRUSTOTAL_API_KEY', value: 'v'.repeat(40) },
  { providerId: 'ipinfo', varName: 'IPINFO_TOKEN', value: 'i'.repeat(40) },
  { providerId: 'apollo', varName: 'APOLLO_API_KEY', value: 'a'.repeat(40) },
  { providerId: 'buttondown', varName: 'BUTTONDOWN_API_KEY', value: 'api_key_' + 'b'.repeat(40) },
  { providerId: 'close', varName: 'CLOSE_API_KEY', value: 'c'.repeat(40) },
  { providerId: 'greenhouse', varName: 'GREENHOUSE_HARVEST_API_KEY', value: 'g'.repeat(40) },
  { providerId: 'xendit', varName: 'XENDIT_SECRET_KEY', value: 'xnd_' + 'x'.repeat(40) },
  { providerId: 'midtrans', varName: 'MIDTRANS_SERVER_KEY', value: 'Mid-server-' + 'm'.repeat(40) },
  { providerId: 'coinbase-commerce', varName: 'COINBASE_COMMERCE_API_KEY', value: 'c'.repeat(40) },
  { providerId: 'lokalise', varName: 'LOKALISE_API_TOKEN', value: 'l'.repeat(40) },
  { providerId: 'crowdin', varName: 'CROWDIN_PERSONAL_TOKEN', value: 'c'.repeat(40) },
  { providerId: 'sendbird', varName: 'SENDBIRD_API_TOKEN', value: 's'.repeat(40) },
  { providerId: 'mux', varName: 'MUX_TOKEN_SECRET', value: 'm'.repeat(40) },
  { providerId: 'bunny', varName: 'BUNNY_API_KEY', value: 'b'.repeat(40) },
  { providerId: 'prerender', varName: 'PRERENDER_TOKEN', value: 'p'.repeat(40) },
  { providerId: 'imagekit', varName: 'IMAGEKIT_PRIVATE_KEY', value: 'private_' + 'i'.repeat(40) },
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
