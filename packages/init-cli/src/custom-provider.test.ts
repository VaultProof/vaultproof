#!/usr/bin/env tsx
import {
  buildCustomProviderSpec,
  deriveBaseUrlEnvVar,
  deriveCustomLabel,
  deriveCustomProviderId,
  isLikelyCustomSecretEntry,
  validateCustomHeaderName,
  validateCustomHeaderTemplate,
  validateCustomUpstreamUrl,
  validateEnvVarName,
  validateProviderSlug,
} from './custom-provider.js';

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  FAIL: ${name}${detail ? ' - ' + detail : ''}`);
  }
}

console.log('── derivation ──');
ok('derive provider id from internal key', deriveCustomProviderId('INTERNAL_API_KEY') === 'internal');
ok('derive provider id from partner token', deriveCustomProviderId('PARTNER_SERVICE_TOKEN') === 'partner');
ok('derive label', deriveCustomLabel('internal-billing') === 'Internal Billing');
ok('derive api base URL env', deriveBaseUrlEnvVar('INTERNAL_API_KEY') === 'INTERNAL_API_BASE_URL');
ok('derive token base URL env', deriveBaseUrlEnvVar('PARTNER_ACCESS_TOKEN') === 'PARTNER_BASE_URL');

console.log('── candidate filtering ──');
ok('internal api key candidate', isLikelyCustomSecretEntry({ name: 'INTERNAL_API_KEY', value: 'ik_' + 'a'.repeat(32) }));
ok('partner token candidate', isLikelyCustomSecretEntry({ name: 'PARTNER_ACCESS_TOKEN', value: 'tok_' + 'a'.repeat(32) }));
ok('skip public client key', !isLikelyCustomSecretEntry({ name: 'NEXT_PUBLIC_API_KEY', value: 'pk_' + 'a'.repeat(32) }));
ok('skip webhook secret', !isLikelyCustomSecretEntry({ name: 'STRIPE_WEBHOOK_SECRET', value: 'whsec_' + 'a'.repeat(32) }));
ok('skip URL value', !isLikelyCustomSecretEntry({ name: 'INTERNAL_API_KEY', value: 'https://api.example.com' }));
ok('skip project id', !isLikelyCustomSecretEntry({ name: 'INTERNAL_API_KEY', value: 'vp-proj-abc123' }));

console.log('── validation ──');
ok('allow valid slug', validateProviderSlug('internal-api').ok);
ok('reject uppercase slug', !validateProviderSlug('Internal').ok);
ok('reject reserved slug', !validateProviderSlug('api').ok);
ok('reject vault env slug prefix', !validateProviderSlug('vaultenv-database-url').ok);
ok('allow public HTTPS upstream', validateCustomUpstreamUrl('https://api.example.com/v1').ok);
ok('normalize upstream path', validateCustomUpstreamUrl('https://API.EXAMPLE.COM/v1/').normalizedUrl === 'https://api.example.com/v1');
ok('reject http upstream', !validateCustomUpstreamUrl('http://api.example.com').ok);
ok('reject private IP upstream', !validateCustomUpstreamUrl('https://10.0.0.1').ok);
ok('reject .internal upstream', !validateCustomUpstreamUrl('https://service.internal').ok);
ok('allow Authorization header', validateCustomHeaderName('Authorization').ok);
ok('allow X-Internal-Key header', validateCustomHeaderName('X-Internal-Key').ok);
ok('reject Host header', !validateCustomHeaderName('Host').ok);
ok('allow bearer template', validateCustomHeaderTemplate('Bearer {key}').ok);
ok('allow raw key template', validateCustomHeaderTemplate('{key}').ok);
ok('reject template without key', !validateCustomHeaderTemplate('Bearer secret').ok);
ok('allow env var name', validateEnvVarName('INTERNAL_API_BASE_URL').ok);
ok('reject env var with hyphen', !validateEnvVarName('INTERNAL-API-BASE-URL').ok);

console.log('── provider spec ──');
{
  const spec = buildCustomProviderSpec({
    id: 'internal',
    label: 'Internal',
    envVar: 'INTERNAL_API_KEY',
    upstreamBaseUrl: 'https://api.example.com',
    authHeaderName: 'Authorization',
    authHeaderTemplate: 'Bearer {key}',
    baseUrlEnvVar: 'INTERNAL_API_BASE_URL',
  });
  ok('spec id', spec.id === 'internal');
  ok('spec base url env', spec.base_url_env_var === 'INTERNAL_API_BASE_URL');
  ok('spec path suffix', spec.base_url_path_suffix === '/p/internal');
  ok('spec detect var hint', spec.detect.var_hint === 'INTERNAL_API_KEY');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
