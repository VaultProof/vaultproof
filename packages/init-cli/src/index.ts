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
import readline from 'node:readline';
import { splitString, serializeShare } from '@vaultproof/shamir';
import { scanDirectory, truncateKey, type Finding } from './scan.js';
import { rewriteEnvFile } from './rewrite.js';
import { getJwt, getInitWorkerUrl, getProxyBaseUrl } from './config.js';
import { loadProviders } from './providers.js';

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

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(`${question} ${chalk.dim('(y/N)')} `, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      resolve(a === 'y' || a === 'yes');
    });
  });
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

  const jwt = getJwt();
  if (!jwt) {
    console.log(chalk.red('\nNot authenticated.'));
    console.log(chalk.dim('Run `vaultproof login` first (from the legacy CLI) — or set VAULTPROOF_JWT.'));
    process.exit(1);
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
          upstream_base_url: f.provider.upstream_base_url,
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
    const { rewritten, backupPath, manualNotes } = rewriteEnvFile(file, findings, { projectId, proxyBaseUrl });
    if (rewritten > 0) {
      console.log(`\n${chalk.green('✓')} Rewrote ${chalk.bold(file)} (${rewritten} key${rewritten === 1 ? '' : 's'})`);
      console.log(chalk.dim(`  Backup: ${backupPath}`));
    }
    allManualNotes.push(...manualNotes);
  }

  // ── Done ──
  console.log(`\n${chalk.bold.green('Done.')} Your .env uses one project ID for everything:`);
  console.log(`  ${chalk.bold(projectId)}\n`);

  if (allManualNotes.length > 0) {
    console.log(chalk.bold('A few providers need a one-line client change:'));
    for (const note of allManualNotes) console.log(`  ${chalk.yellow('•')} ${note}`);
    console.log();
  }

  console.log(chalk.dim('Run: ') + chalk.white('source .env'));
}

async function runMigrateFromLegacy(): Promise<void> {
  console.log(chalk.bold('\nVaultProof — migrate from legacy\n'));
  console.log(chalk.yellow('Not implemented yet. This command will:'));
  console.log(chalk.dim('  1. Read your vp_live_ key from ~/.vaultproof/config.json'));
  console.log(chalk.dim('  2. Call the legacy API to list stored keys'));
  console.log(chalk.dim('  3. Create a VaultProof init project'));
  console.log(chalk.dim('  4. Copy stored keys into the new projects system'));
  console.log(chalk.dim('  5. Rewrite your .env with the new project ID'));
  console.log();
  process.exit(0);
}

async function main(): Promise<void> {
  const { cmd, flags } = parseArgs(process.argv);
  const autoYes = flags.has('--yes') || flags.has('-y');
  const dryRun = flags.has('--dry-run');

  if (cmd === 'migrate-from-legacy') {
    await runMigrateFromLegacy();
    return;
  }
  if (cmd !== 'init') {
    console.error(chalk.red(`Unknown command: ${cmd}`));
    console.error(chalk.dim('Usage: npx @vaultproof/init [--yes] [--dry-run]'));
    console.error(chalk.dim('       npx @vaultproof/init migrate-from-legacy'));
    process.exit(1);
  }

  await runInit({ autoYes, dryRun });
}

main().catch((err) => {
  console.error(chalk.red(`Unexpected error: ${String(err)}`));
  process.exit(1);
});
