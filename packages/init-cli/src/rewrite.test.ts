#!/usr/bin/env tsx
/**
 * Unit tests for rewrite.ts — specifically rewriteEnvFileForMigration
 * which is used by --check-legacy.
 *
 * The existing scan-based rewriteEnvFile was tested manually in earlier
 * sessions. This file adds coverage for the new migration-mode function.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { rewriteEnvFileForMigration, type MigrationEntry } from './rewrite.js';
import type { ProviderSpec } from './providers.js';

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) passed++;
  else { failed++; console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`); }
}

// Provider fixtures
const OPENAI: ProviderSpec = {
  id: 'openai', label: 'OpenAI',
  upstream_base_url: 'https://api.openai.com',
  auth_header_name: 'Authorization', auth_header_template: 'Bearer {key}',
  env_var_default: 'OPENAI_API_KEY',
  base_url_env_var: 'OPENAI_BASE_URL', base_url_path_suffix: '/p/openai/v1',
  detect: { regex: '^sk-.*$' },
};

const STRIPE: ProviderSpec = {
  id: 'stripe', label: 'Stripe',
  upstream_base_url: 'https://api.stripe.com',
  auth_header_name: 'Authorization', auth_header_template: 'Bearer {key}',
  env_var_default: 'STRIPE_SECRET_KEY',
  base_url_env_var: 'STRIPE_BASE_URL', base_url_path_suffix: '/p/stripe/v1',
  detect: { regex: '^sk_.*$' },
};

// Provider without a base_url_env_var — needs a manual note
const GITHUB: ProviderSpec = {
  id: 'github', label: 'GitHub',
  upstream_base_url: 'https://api.github.com',
  auth_header_name: 'Authorization', auth_header_template: 'Bearer {key}',
  env_var_default: 'GITHUB_TOKEN',
  detect: { regex: '^ghp_.*$' },
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-rewrite-test-'));

function resetEnv(content: string): string {
  const p = path.join(tmp, '.env');
  if (fs.existsSync(p)) fs.unlinkSync(p);
  fs.writeFileSync(p, content);
  return p;
}

// ── Creates file if missing ──────────────────────────────────────────────
console.log('── creates .env when missing ──');
{
  const envPath = path.join(tmp, '.env');
  if (fs.existsSync(envPath)) fs.unlinkSync(envPath);

  const entries: MigrationEntry[] = [{ envVar: 'OPENAI_API_KEY', provider: OPENAI }];
  const result = rewriteEnvFileForMigration(envPath, entries, {
    projectId: 'vp-proj-test123',
    proxyBaseUrl: 'https://init.vaultproof.dev',
  });

  ok('written count = 1', result.written === 1);
  // No backup files created (VaultProof never writes keys to disk)
  ok('file exists', fs.existsSync(envPath));

  const written = fs.readFileSync(envPath, 'utf-8');
  ok('contains VAULTPROOF_PROJECT_ID', written.includes('VAULTPROOF_PROJECT_ID=vp-proj-test123'));
  ok('contains OPENAI_BASE_URL', written.includes('OPENAI_BASE_URL=https://init.vaultproof.dev/p/openai/v1'));
  ok('contains OPENAI_API_KEY=<project id>', written.includes('OPENAI_API_KEY=vp-proj-test123'));
  ok('contains VaultProof header', written.includes('# ── VaultProof ──'));
}

// ── Preserves unrelated lines ────────────────────────────────────────────
console.log('── preserves unrelated content ──');
{
  const envPath = resetEnv(`# my config
NODE_ENV=development
DATABASE_URL=postgres://user:pw@host/db
MYSTERIOUS_SETTING=xyz
`);

  rewriteEnvFileForMigration(
    envPath,
    [{ envVar: 'OPENAI_API_KEY', provider: OPENAI }],
    { projectId: 'vp-proj-abc', proxyBaseUrl: 'https://init.vaultproof.dev' },
  );

  const content = fs.readFileSync(envPath, 'utf-8');
  ok('keeps NODE_ENV', content.includes('NODE_ENV=development'));
  ok('keeps DATABASE_URL', content.includes('DATABASE_URL=postgres://user:pw@host/db'));
  ok('keeps MYSTERIOUS_SETTING', content.includes('MYSTERIOUS_SETTING=xyz'));
  ok('adds project id', content.includes('VAULTPROOF_PROJECT_ID=vp-proj-abc'));
}

// ── Replaces existing key with same var name ─────────────────────────────
console.log('── replaces existing matching var ──');
{
  const envPath = resetEnv(`OPENAI_API_KEY=sk-proj-oldoldold
NODE_ENV=prod
`);

  rewriteEnvFileForMigration(
    envPath,
    [{ envVar: 'OPENAI_API_KEY', provider: OPENAI }],
    { projectId: 'vp-proj-new', proxyBaseUrl: 'https://init.vaultproof.dev' },
  );

  const content = fs.readFileSync(envPath, 'utf-8');
  ok('old OPENAI value removed', !content.includes('sk-proj-oldoldold'));
  ok('new OPENAI value present', content.includes('OPENAI_API_KEY=vp-proj-new'));
  ok('NODE_ENV preserved', content.includes('NODE_ENV=prod'));
}

// ── No backup files created ──────────────────────────────────────────────
console.log('── no backup files ──');
{
  const envPath = resetEnv(`SOMETHING=yes\n`);
  rewriteEnvFileForMigration(
    envPath,
    [{ envVar: 'OPENAI_API_KEY', provider: OPENAI }],
    { projectId: 'vp-proj-a', proxyBaseUrl: 'https://init.vaultproof.dev' },
  );
  const files = fs.readdirSync(tmp).filter(f => f.includes('backup'));
  ok('no backup files created', files.length === 0);
}

// ── Multiple providers → multiple BASE_URL lines ─────────────────────────
console.log('── multiple providers ──');
{
  const envPath = resetEnv('');

  rewriteEnvFileForMigration(
    envPath,
    [
      { envVar: 'OPENAI_API_KEY', provider: OPENAI },
      { envVar: 'STRIPE_SECRET_KEY', provider: STRIPE },
    ],
    { projectId: 'vp-proj-multi', proxyBaseUrl: 'https://init.vaultproof.dev' },
  );

  const content = fs.readFileSync(envPath, 'utf-8');
  ok('OPENAI base url', content.includes('OPENAI_BASE_URL=https://init.vaultproof.dev/p/openai/v1'));
  ok('STRIPE base url', content.includes('STRIPE_BASE_URL=https://init.vaultproof.dev/p/stripe/v1'));
  ok('OPENAI_API_KEY line', content.includes('OPENAI_API_KEY=vp-proj-multi'));
  ok('STRIPE_SECRET_KEY line', content.includes('STRIPE_SECRET_KEY=vp-proj-multi'));
  ok('one VAULTPROOF_PROJECT_ID', content.match(/VAULTPROOF_PROJECT_ID=/g)?.length === 1);
}

// ── Provider without base_url_env_var emits a manual note ────────────────
console.log('── manual notes for providers without BASE_URL env var ──');
{
  const envPath = resetEnv('');
  const result = rewriteEnvFileForMigration(
    envPath,
    [{ envVar: 'GITHUB_TOKEN', provider: GITHUB }],
    { projectId: 'vp-proj-gh', proxyBaseUrl: 'https://init.vaultproof.dev' },
  );
  ok('one manual note', result.manualNotes.length === 1);
  ok('note mentions GitHub', result.manualNotes[0].includes('GitHub'));
  ok('note mentions /p/github', result.manualNotes[0].includes('/p/github'));

  const content = fs.readFileSync(envPath, 'utf-8');
  ok('no GITHUB_BASE_URL line', !content.includes('GITHUB_BASE_URL'));
  ok('GITHUB_TOKEN key present', content.includes('GITHUB_TOKEN=vp-proj-gh'));
}

// ── Idempotent re-run: running twice produces same result ───────────────
console.log('── idempotent re-run ──');
{
  const envPath = resetEnv('DATABASE_URL=postgres://x\n');

  const entries: MigrationEntry[] = [{ envVar: 'OPENAI_API_KEY', provider: OPENAI }];
  const opts = { projectId: 'vp-proj-idem', proxyBaseUrl: 'https://init.vaultproof.dev' };

  rewriteEnvFileForMigration(envPath, entries, opts);
  const after1 = fs.readFileSync(envPath, 'utf-8');

  rewriteEnvFileForMigration(envPath, entries, opts);
  const after2 = fs.readFileSync(envPath, 'utf-8');

  ok('second run equals first', after1 === after2, `diff: ${after1.length} vs ${after2.length}`);
  // Must still have the key exactly once
  ok('OPENAI_API_KEY appears once', after2.match(/OPENAI_API_KEY=/g)?.length === 1);
  ok('VAULTPROOF_PROJECT_ID once', after2.match(/VAULTPROOF_PROJECT_ID=/g)?.length === 1);
}

// ── Empty entries returns zero-op ────────────────────────────────────────
console.log('── empty entries ──');
{
  const envPath = resetEnv('X=y\n');
  const result = rewriteEnvFileForMigration(
    envPath,
    [],
    { projectId: 'vp-proj-noop', proxyBaseUrl: 'https://init.vaultproof.dev' },
  );
  ok('written = 0', result.written === 0);
  // no backup files
  const content = fs.readFileSync(envPath, 'utf-8');
  ok('file unchanged', content === 'X=y\n');
}

// ── VaultProof never writes key files to disk ───────────────────────────
console.log('── no key files written to disk ──');
{
  const envPath = resetEnv(`OPENAI_API_KEY=sk-proj-test123
DATABASE_URL=postgres://safe
`);

  const { rewriteEnvFile } = await import('./rewrite.js');
  const { scanEnvFile } = await import('./scan.js');
  const catalog = [OPENAI, STRIPE];
  const findings = scanEnvFile(envPath, catalog);

  rewriteEnvFile(envPath, findings, { projectId: 'vp-proj-test', proxyBaseUrl: 'https://init.vaultproof.dev' });

  const allFiles = fs.readdirSync(tmp);
  const backupFiles = allFiles.filter(f => f.includes('backup'));
  ok('zero backup files after rewrite', backupFiles.length === 0);
}

// ── Cleanup ──────────────────────────────────────────────────────────────
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
