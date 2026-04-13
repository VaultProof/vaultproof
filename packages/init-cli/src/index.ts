#!/usr/bin/env node
/**
 * @vaultproof/init
 *
 * One command: scan → split → upload → rewrite. Zero code changes.
 *
 * Usage:
 *   npx @vaultproof/init            # interactive
 *   npx @vaultproof/init --yes      # auto-confirm
 *   npx @vaultproof/init --dry-run  # scan only, no upload, no rewrite
 *   npx @vaultproof/init migrate-from-legacy
 */
import chalk from 'chalk';
import ora from 'ora';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { splitString, serializeShare } from '@vaultproof/shamir';
import { scanDirectory, truncateKey, type Finding } from './scan.js';
import { rewriteEnvFile, rewriteEnvFileForMigration, type MigrationEntry } from './rewrite.js';
import { getJwt, getInitWorkerUrl, getProxyBaseUrl } from './config.js';
import { loadProviders, type ProviderSpec } from './providers.js';
import { listLegacyKeys, type LegacyKey } from './legacy.js';
import { confirm, promptHidden } from './prompts.js';
import { browserLogin } from './login.js';
import { findStripeConstructors } from './stripe-helper.js';

function parseArgs(argv: string[]): { cmd: string; flags: Set<string> } {
  const args = argv.slice(2);
  const flags = new Set<string>();
  let cmd = 'init';
  for (const a of args) {
    if (a.startsWith('--')) flags.add(a);
    else if (!a.startsWith('-')) cmd = a;
  }
  return { cmd, flags };
}

function readLegacyVpLiveKey(): string | null {
  const configPath = path.join(os.homedir(), '.vaultproof', 'config.json');
  try {
    if (!fs.existsSync(configPath)) return null;
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as { apiKey?: string };
    if (raw.apiKey && raw.apiKey.startsWith('vp_live_')) return raw.apiKey;
  } catch {
    // unreadable config
  }
  // Also check env
  if (process.env.VAULTPROOF_API_KEY?.startsWith('vp_live_')) return process.env.VAULTPROOF_API_KEY;
  return null;
}

async function runInit(opts: { autoYes: boolean; dryRun: boolean }): Promise<void> {
  console.log(chalk.bold('\nVaultProof — scanning .env...\n'));

  const catalog = await loadProviders();
  const findings: Finding[] = scanDirectory(process.cwd(), catalog.providers);

  if (findings.length === 0) {
    console.log(chalk.yellow('No API keys detected.'));
    console.log(chalk.dim(`Provider catalog: ${catalog.providers.length} providers, version ${catalog.version}`));
    process.exit(0);
  }

  console.log(chalk.bold(`Found ${findings.length} API key${findings.length === 1 ? '' : 's'}:\n`));
  for (const f of findings) {
    console.log(
      `  ${chalk.green('✓')} ${f.varName.padEnd(26)} ${chalk.dim(truncateKey(f.value).padEnd(22))} ${chalk.dim('(' + f.provider.label + ')')}`,
    );
  }

  // Detect skipped keys and explain why
  const skippedNotes: string[] = [];
  const envFiles = ['.env', '.env.local', '.env.production', '.env.development'];
  for (const name of envFiles) {
    const filePath = path.join(process.cwd(), name);
    if (!fs.existsSync(filePath)) continue;
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    for (const line of lines) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/);
      if (!m) continue;
      const [, varName, rawValue] = m;
      const value = rawValue.replace(/^["']|["']$/g, '');
      if (findings.some((f) => f.varName === varName)) continue;
      if (varName.match(/WEBHOOK_SECRET|_WEBHOOK/) && value.startsWith('whsec_')) {
        skippedNotes.push(`${varName} — webhook secret (used locally for signature verification, not sent to Stripe)`);
      } else if (varName.match(/PRICE_ID|_PRICE_/) && value.startsWith('price_')) {
        skippedNotes.push(`${varName} — public price ID (not a secret)`);
      }
    }
  }
  if (skippedNotes.length > 0) {
    console.log(chalk.dim('\n  Skipped (no proxy protection needed):'));
    for (const note of skippedNotes) console.log(chalk.dim(`  ⊘ ${note}`));
  }
  console.log();

  if (opts.dryRun) {
    console.log(chalk.dim('(dry run — not uploading or rewriting)'));
    process.exit(0);
  }

  if (!opts.autoYes) {
    const ok = await confirm(`Protect ${findings.length} key${findings.length === 1 ? '' : 's'} via Shamir splitting?`);
    if (!ok) {
      console.log(chalk.dim('Cancelled.'));
      process.exit(0);
    }
  }

  let jwt = getJwt();
  if (!jwt) {
    console.log(chalk.dim('\nOpening browser to log in...\n'));
    const loginSpinner = ora('Waiting for login...').start();
    const result = await browserLogin();
    if (!result) {
      loginSpinner.fail('Login timed out or was cancelled.');
      console.log(chalk.dim('\nAlternatively, set VAULTPROOF_JWT manually:'));
      console.log(chalk.dim('  1. Log in at ') + chalk.white('https://vaultproof.dev/app/login'));
      console.log(chalk.dim('  2. Copy access_token from DevTools → Application → Local Storage'));
      console.log(chalk.dim('  3. Run: ') + chalk.white('export VAULTPROOF_JWT="<token>"'));
      process.exit(1);
    }
    loginSpinner.succeed(`Logged in as ${chalk.bold(result.email)}`);
    jwt = result.token;
  }

  const apiUrl = getInitWorkerUrl();
  const proxyBaseUrl = getProxyBaseUrl();

  // ── Create a project ──
  const createSpinner = ora('Creating VaultProof project...').start();
  let projectRowId: string;
  let projectId: string;
  try {
    const res = await fetch(`${apiUrl}/api/v1/init/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const text = await res.text();
      createSpinner.fail(`Project creation failed: ${res.status} ${text}`);
      process.exit(1);
    }
    const data = (await res.json()) as { vp_proj_id: string; id: string };
    projectRowId = data.id;
    projectId = data.vp_proj_id;
  } catch (err) {
    createSpinner.fail(`Could not reach VaultProof API at ${apiUrl}`);
    console.error(chalk.dim(String(err)));
    process.exit(1);
  }
  createSpinner.succeed(`Project created: ${chalk.bold(projectId)}`);

  // ── Split and upload each key ──
  for (const f of findings) {
    const s = ora(`Splitting ${f.varName} (${f.provider.label})...`).start();
    const shares = splitString(f.value, 2, 2);
    const share1 = serializeShare(shares[0]);
    const share2 = serializeShare(shares[1]);

    // Resolve dynamic upstream URLs (e.g. Supabase reads URL from another env var)
    let upstreamUrl = f.provider.upstream_base_url;
    if (upstreamUrl === 'dynamic' && f.provider.upstream_from_env) {
      // Read from process.env (dotenv may have loaded it) or parse the .env file directly
      upstreamUrl = process.env[f.provider.upstream_from_env] || '';
      if (!upstreamUrl) {
        // Parse from the same .env file where we found the key
        try {
          const envContent = fs.readFileSync(f.file, 'utf-8');
          const match = envContent.match(new RegExp(`^${f.provider.upstream_from_env}\\s*=\\s*(.+)$`, 'm'));
          if (match) upstreamUrl = match[1].trim().replace(/^["']|["']$/g, '');
        } catch { /* ignore */ }
      }
      if (!upstreamUrl) {
        s.fail(`${f.provider.label}: could not find ${f.provider.upstream_from_env} in your environment. Set it in your .env and try again.`);
        continue;
      }
    }

    try {
      const res = await fetch(`${apiUrl}/api/v1/init/projects/${projectRowId}/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({
          provider: f.provider.id,
          slug: f.provider.id,
          share1,
          share2,
          env_var: f.varName,
          upstream_base_url: upstreamUrl,
          auth_header_name: f.provider.auth_header_name,
          auth_header_template: f.provider.auth_header_template,
          extra_headers: f.provider.extra_headers ?? null,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        s.fail(`Upload failed for ${f.varName}: ${res.status} ${text}`);
        process.exit(1);
      }
    } catch (err) {
      s.fail(`Network error uploading ${f.varName}: ${String(err)}`);
      process.exit(1);
    }
    s.succeed(`Protected ${chalk.bold(f.varName)} ${chalk.dim('(' + f.provider.label + ')')}`);
  }

  // ── Rewrite .env files ──
  const filesToRewrite = Array.from(new Set(findings.map((f) => f.file)));
  const allManualNotes: string[] = [];
  for (const file of filesToRewrite) {
    const { rewritten, manualNotes } = rewriteEnvFile(file, findings, { projectId, proxyBaseUrl });
    if (rewritten > 0) {
      console.log(`\n${chalk.green('✓')} Rewrote ${chalk.bold(file)} (${rewritten} key${rewritten === 1 ? '' : 's'})`);
    }
    allManualNotes.push(...manualNotes);
  }

  // ── Done ──
  console.log(`\n${chalk.bold.green('Done.')} Your .env uses one project ID for everything:`);
  console.log(`  ${chalk.bold(projectId)}\n`);

  // ── Stripe SDK helper ──
  const hasStripe = findings.some((f) => f.provider.id === 'stripe');
  if (hasStripe) {
    const stripeFindings = findStripeConstructors(process.cwd());
    if (stripeFindings.length > 0) {
      const unpatched = stripeFindings.filter((f) => !f.alreadyPatched);
      if (unpatched.length > 0) {
        console.log(chalk.bold('\n⚠ Stripe needs one line of code:'));
        for (const sf of unpatched) {
          console.log(chalk.dim(`\n  ${sf.file}:${sf.line}`));
          console.log(chalk.red(`  - ${sf.content}`));
          // Build the suggested replacement
          if (sf.content.includes('{')) {
            // Has options object: new Stripe(key, { apiVersion: '...' })
            const patched = sf.content.replace('{', `{ host: 'init.vaultproof.dev',`);
            console.log(chalk.green(`  + ${patched}`));
          } else if (sf.content.includes(')')) {
            // No options: new Stripe(key)
            const patched = sf.content.replace(')', `, { host: 'init.vaultproof.dev' })`);
            console.log(chalk.green(`  + ${patched}`));
          } else {
            console.log(chalk.green(`  + Add: { host: 'init.vaultproof.dev' } to the Stripe constructor`));
          }
        }
        console.log(chalk.dim('\n  This tells the Stripe SDK to route through VaultProof.'));
        console.log(chalk.dim('  Every other provider works without code changes.\n'));
      } else {
        console.log(chalk.green('\n✓ Stripe constructor already configured for VaultProof.'));
      }
    }
  }

  // ── Other manual notes (non-Stripe providers without BASE_URL env var) ──
  const nonStripeNotes = allManualNotes.filter((n) => !n.startsWith('Stripe:'));
  if (nonStripeNotes.length > 0) {
    console.log(chalk.bold('A few providers need a one-line client change:'));
    for (const note of nonStripeNotes) console.log(`  ${chalk.yellow('•')} ${note}`);
    console.log();
  }

  console.log(chalk.bold('What\'s next:'));
  console.log(`  ${chalk.green('•')} Run your app normally — your code doesn't change`);
  console.log(`  ${chalk.green('•')} Dashboard: ${chalk.white('https://vaultproof.dev/app')}`);
  console.log(`  ${chalk.green('•')} Docs: ${chalk.white('https://vaultproof.dev/docs')}`);
}

/**
 * --check-legacy flow:
 *   1. Read legacy vp_live_ from config
 *   2. List legacy keys via GET /api/v1/sdk/keys (metadata only)
 *   3. For each legacy key, prompt the user to paste a freshly rotated key
 *      (plaintext is not recoverable from the legacy system)
 *   4. Shamir-split client-side, upload to the new init-worker
 *   5. Rewrite .env with one project ID covering all migrated keys
 */
async function runCheckLegacy(): Promise<void> {
  console.log(chalk.bold('\nVaultProof — legacy audit & migration\n'));

  const vpLive = readLegacyVpLiveKey();
  if (!vpLive) {
    console.log(chalk.yellow('No legacy vp_live_ key found in ~/.vaultproof/config.json.'));
    console.log(chalk.dim('If you never used the legacy system, just run: npx @vaultproof/init'));
    process.exit(0);
  }

  let jwt = getJwt();
  if (!jwt) {
    console.log(chalk.dim('\nOpening browser to log in...\n'));
    const loginSpinner = ora('Waiting for login...').start();
    const result = await browserLogin();
    if (!result) {
      loginSpinner.fail('Login timed out or was cancelled.');
      process.exit(1);
    }
    loginSpinner.succeed(`Logged in as ${chalk.bold(result.email)}`);
    jwt = result.token;
  }

  // ── List legacy keys ──
  const listSpinner = ora('Fetching legacy key list...').start();
  const legacy = await listLegacyKeys(vpLive);
  listSpinner.stop();

  if (legacy.keys.length === 0) {
    console.log(chalk.yellow('No keys found in the legacy system.'));
    console.log(chalk.dim('Nothing to migrate. Run `npx @vaultproof/init` on your current .env if you have plaintext keys there.'));
    process.exit(0);
  }

  // ── Match each legacy key to a provider spec ──
  const catalog = await loadProviders();
  const providerById = new Map<string, ProviderSpec>();
  for (const p of catalog.providers) providerById.set(p.id, p);

  interface LegacyEntry {
    legacy: LegacyKey;
    provider: ProviderSpec | null;
    defaultEnvVar: string;
  }
  const entries: LegacyEntry[] = legacy.keys.map((k) => {
    const provider = providerById.get(k.provider.toLowerCase()) || null;
    const defaultEnvVar = k.envVar || provider?.env_var_default || `${k.provider.toUpperCase()}_API_KEY`;
    return { legacy: k, provider, defaultEnvVar };
  });

  console.log(chalk.bold(`Found ${entries.length} key${entries.length === 1 ? '' : 's'} in the legacy system:\n`));
  for (const e of entries) {
    const label = e.provider ? e.provider.label : chalk.yellow(`${e.legacy.provider} (unsupported)`);
    const when = e.legacy.createdAt ? chalk.dim(`(stored ${e.legacy.createdAt.slice(0, 10)})`) : '';
    console.log(`  • ${e.defaultEnvVar.padEnd(26)} ${chalk.dim(label.padEnd(18))} ${when}`);
  }

  console.log();
  console.log(chalk.dim('Plaintext values are not recoverable from the legacy system — by design.'));
  console.log(chalk.dim('For each key you want to migrate, you will paste a freshly ROTATED value.'));
  console.log(chalk.dim('If you haven\'t rotated yet, exit now, rotate in the provider dashboard, then re-run.'));
  console.log();

  const proceed = await confirm('Start migration?');
  if (!proceed) {
    console.log(chalk.dim('Cancelled.'));
    process.exit(0);
  }

  const apiUrl = getInitWorkerUrl();
  const proxyBaseUrl = getProxyBaseUrl();

  // ── Create a project ──
  const createSpinner = ora('Creating VaultProof project...').start();
  let projectRowId: string;
  let projectId: string;
  try {
    const res = await fetch(`${apiUrl}/api/v1/init/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ name: 'migrated-from-legacy' }),
    });
    if (!res.ok) {
      const text = await res.text();
      createSpinner.fail(`Project creation failed: ${res.status} ${text}`);
      process.exit(1);
    }
    const data = (await res.json()) as { id: string; vp_proj_id: string };
    projectRowId = data.id;
    projectId = data.vp_proj_id;
  } catch (err) {
    createSpinner.fail(`Could not reach VaultProof API at ${apiUrl}`);
    console.error(chalk.dim(String(err)));
    process.exit(1);
  }
  createSpinner.succeed(`Project created: ${chalk.bold(projectId)}`);
  console.log();

  // ── Per-key prompt + upload ──
  const migrated: MigrationEntry[] = [];
  const skipped: string[] = [];

  for (const e of entries) {
    if (!e.provider) {
      console.log(chalk.yellow(`⊘ Skipping ${e.defaultEnvVar} — provider "${e.legacy.provider}" not supported by the new system yet.`));
      skipped.push(e.defaultEnvVar);
      continue;
    }

    console.log(chalk.bold(`\n${e.defaultEnvVar} (${e.provider.label})`));
    const doThisOne = await confirm('  Migrate this key?', true);
    if (!doThisOne) {
      skipped.push(e.defaultEnvVar);
      continue;
    }

    const newKey = await promptHidden(`  Paste freshly rotated ${e.provider.label} key: `);
    if (!newKey) {
      console.log(chalk.yellow('  Empty input — skipping.'));
      skipped.push(e.defaultEnvVar);
      continue;
    }

    // Validate against the provider regex
    let re: RegExp;
    try { re = new RegExp(e.provider.detect.regex); } catch { re = /.*/; }
    if (!re.test(newKey)) {
      console.log(chalk.yellow(`  Warning: key does not match ${e.provider.label} pattern.`));
      const keepGoing = await confirm('  Upload it anyway?', false);
      if (!keepGoing) {
        skipped.push(e.defaultEnvVar);
        continue;
      }
    }

    const s = ora(`  Splitting + uploading ${e.defaultEnvVar}...`).start();
    const shares = splitString(newKey, 2, 2);
    try {
      const res = await fetch(`${apiUrl}/api/v1/init/projects/${projectRowId}/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({
          provider: e.provider.id,
          slug: e.provider.id,
          share1: serializeShare(shares[0]),
          share2: serializeShare(shares[1]),
          env_var: e.defaultEnvVar,
          upstream_base_url: e.provider.upstream_base_url,
          auth_header_name: e.provider.auth_header_name,
          auth_header_template: e.provider.auth_header_template,
          extra_headers: e.provider.extra_headers ?? null,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        s.fail(`  Upload failed: ${res.status} ${text}`);
        skipped.push(e.defaultEnvVar);
        continue;
      }
    } catch (err) {
      s.fail(`  Network error: ${String(err)}`);
      skipped.push(e.defaultEnvVar);
      continue;
    }
    s.succeed(`  Protected ${chalk.bold(e.defaultEnvVar)}`);
    migrated.push({ envVar: e.defaultEnvVar, provider: e.provider });
  }

  // ── Rewrite .env if anything was migrated ──
  if (migrated.length > 0) {
    const envPath = path.join(process.cwd(), '.env');
    const { written, manualNotes } = rewriteEnvFileForMigration(envPath, migrated, { projectId, proxyBaseUrl });
    console.log(`\n${chalk.green('✓')} Wrote ${written} entries to ${chalk.bold(envPath)}`);
    if (manualNotes.length > 0) {
      console.log(chalk.bold('\nA few providers need a one-line client change:'));
      for (const n of manualNotes) console.log(`  ${chalk.yellow('•')} ${n}`);
    }
  }

  // ── Summary ──
  console.log(`\n${chalk.bold.green('Migration complete.')}`);
  console.log(`  ${chalk.green(migrated.length)} migrated, ${chalk.dim(skipped.length + ' skipped')}`);
  console.log(`  Project ID: ${chalk.bold(projectId)}`);
  if (skipped.length > 0) {
    console.log(chalk.dim('\nSkipped keys still live in the legacy system.'));
    console.log(chalk.dim('When you are ready, rotate them and re-run `npx @vaultproof/init --check-legacy`.'));
  }
  process.exit(0);
}

async function main(): Promise<void> {
  const { cmd, flags } = parseArgs(process.argv);
  const autoYes = flags.has('--yes') || flags.has('-y');
  const dryRun = flags.has('--dry-run');
  const checkLegacy = flags.has('--check-legacy');

  if (cmd !== 'init') {
    console.error(chalk.red(`Unknown command: ${cmd}`));
    console.error(chalk.dim('Usage: npx @vaultproof/init [--yes] [--dry-run] [--check-legacy]'));
    process.exit(1);
  }

  if (checkLegacy) {
    await runCheckLegacy();
    return;
  }

  await runInit({ autoYes, dryRun });
}

main().catch((err) => {
  console.error(chalk.red(`Unexpected error: ${String(err)}`));
  process.exit(1);
});
