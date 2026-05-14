#!/usr/bin/env tsx
import {
  deriveVaultSecretProviderId,
  formatDotEnvValue,
  isLikelyVaultSecretEntry,
  isVaultSecretPlaceholder,
  isVaultSecretProviderId,
  vaultSecretPlaceholder,
} from './vault-secret.js';

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  FAIL: ${name}${detail ? ' - ' + detail : ''}`);
  }
}

console.log('── vault-only detection ──');
ok('detect database url', isLikelyVaultSecretEntry({ name: 'DATABASE_URL', value: 'postgres://user:pw@example.com/db' }));
ok('detect jwt secret', isLikelyVaultSecretEntry({ name: 'JWT_SECRET', value: 'super-secret-value' }));
ok('detect webhook secret', isLikelyVaultSecretEntry({ name: 'STRIPE_WEBHOOK_SECRET', value: 'whsec_' + 'a'.repeat(32) }));
ok('skip public key', !isLikelyVaultSecretEntry({ name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', value: 'x'.repeat(32) }));
ok('skip provider api key', !isLikelyVaultSecretEntry({ name: 'OPENAI_API_KEY', value: 'sk-' + 'a'.repeat(32) }));
ok('skip placeholder', !isLikelyVaultSecretEntry({ name: 'DATABASE_URL', value: 'vaultproof://DATABASE_URL' }));

console.log('── provider id and placeholder ──');
const providerId = deriveVaultSecretProviderId('DATABASE_URL');
ok('provider id uses reserved prefix', isVaultSecretProviderId(providerId), providerId);
ok('provider id length', providerId.length <= 32, providerId);
ok('placeholder format', vaultSecretPlaceholder('DATABASE_URL') === 'vaultproof://DATABASE_URL');
ok('placeholder detection', isVaultSecretPlaceholder('vaultproof://DATABASE_URL'));

console.log('── .env formatting ──');
ok('plain value stays plain', formatDotEnvValue('vaultproof://DATABASE_URL') === 'vaultproof://DATABASE_URL');
ok('spaced value gets quoted', formatDotEnvValue('hello world') === '"hello world"');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
