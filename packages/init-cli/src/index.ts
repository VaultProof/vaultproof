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

function printBanner(): void {
  const lines = [
    '██╗   ██╗ █████╗ ██╗   ██╗██╗  ████████╗██████╗ ██████╗  ██████╗  ██████╗ ███████╗',
    '██║   ██║██╔══██╗██║   ██║██║  ╚══██╔══╝██╔══██╗██╔══██╗██╔═══██╗██╔═══██╗██╔════╝',
    '██║   ██║███████║██║   ██║██║     ██║   ██████╔╝██████╔╝██║   ██║██║   ██║█████╗  ',
    '╚██╗ ██╔╝██╔══██║██║   ██║██║     ██║   ██╔═══╝ ██╔══██╗██║   ██║██║   ██║██╔══╝  ',
    ' ╚████╔╝ ██║  ██║╚██████╔╝███████╗██║   ██║     ██║  ██║╚██████╔╝╚██████╔╝██║     ',
    '  ╚═══╝  ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝   ╚═╝     ╚═╝  ╚═╝ ╚═════╝  ╚═════╝ ╚═╝     ',
  ];

  // "VAULT" ends ~col 50, "PROOF" runs from ~col 50 onward
  // Gradient: steel grey → cyan
  const SPLIT = 50;
  const grey = chalk.rgb(180, 180, 190);
  const cyan = chalk.rgb(0, 210, 210);
  const border = chalk.rgb(80, 120, 200);
  const width = lines[0].length + 4; // padding

  const topBar    = border('╔' + '═'.repeat(width) + '╗');
  const emptyRow  = border('║') + ' '.repeat(width) + border('║');
  const bottomBar = border('╚' + '═'.repeat(width) + '╝');
  const version   = chalk.dim('  v0.1.0');

  console.log('\n' + topBar);
  console.log(emptyRow);
  for (const line of lines) {
    const left  = grey.bold(line.slice(0, SPLIT));
    const right = cyan.bold(line.slice(SPLIT));
    const padded = left + right;
    console.log(border('║') + '  ' + padded + '  ' + border('║'));
  }
  console.log(emptyRow);
  console.log(bottomBar);
  console.log(version + '\n');
}

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
  printBanner();

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

  // ── Check for existing projects ──
  let projectRowId: string;
  let projectId: string;

  try {
    const listRes = await fetch(`${apiUrl}/api/v1/init/projects`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${jwt}` },
    });

    const existingProjects: Array<{ id: string; vp_proj_id: string; name: string | null }> =
      listRes.ok ? ((await listRes.json()) as { projects: any[] }).projects || [] : [];

    if (existingProjects.length > 0) {
      // Show existing projects and let user choose
      console.log(chalk.bold('You have existing projects:\n'));
      for (let i = 0; i < existingProjects.length; i++) {
        const p = existingProjects[i];
        const label = p.name ? `${p.vp_proj_id} (${p.name})` : p.vp_proj_id;
        console.log(`  ${chalk.bold(String(i + 1))}. ${chalk.white(label)}`);
      }
      console.log(`  ${chalk.bold(String(existingProjects.length + 1))}. ${chalk.dim('Create a new project')}`);
      console.log();

      const { prompt: promptInput } = await import('./prompts.js');
      const choice = await promptInput(`Add keys to which project? (1-${existingProjects.length + 1}) `);
      const choiceNum = parseInt(choice, 10);

      if (choiceNum >= 1 && choiceNum <= existingProjects.length) {
        // Use existing project
        const selected = existingProjects[choiceNum - 1];
        projectRowId = selected.id;
        projectId = selected.vp_proj_id;
        console.log(chalk.green(`\n✓ Using project: ${chalk.bold(projectId)}`));
      } else {
        // Create new
        const createSpinner = ora('Creating new project...').start();
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
        createSpinner.succeed(`Project created: ${chalk.bold(projectId)}`);
      }
    } else {
      // No existing projects — create first one
      const createSpinner = ora('Creating VaultProof project...').start();
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
      createSpinner.succeed(`Project created: ${chalk.bold(projectId)}`);
    }
  } catch (err) {
    console.error(chalk.red(`Could not reach VaultProof API at ${apiUrl}`));
    console.error(chalk.dim(String(err)));
    process.exit(1);
  }

  // ── Split and upload each key ──
  for (const f of findings) {
    const s = ora(`Splitting ${f.varName} (${f.provider.label})...`).start();

    // Some providers (e.g. Langfuse) combine the secret with another env var
    // before protecting (e.g. base64(publicKey:secretKey))
    let keyToSplit = f.value;
    if (f.provider.combine_with_env && f.provider.combine_format) {
      const otherVal = process.env[f.provider.combine_with_env] || (() => {
        try {
          const envContent = fs.readFileSync(f.file, 'utf-8');
          const match = envContent.match(new RegExp(`^${f.provider.combine_with_env}\\s*=\\s*(.+)$`, 'm'));
          return match ? match[1].trim().replace(/^["']|["']$/g, '') : '';
        } catch { return ''; }
      })();
      if (otherVal) {
        const combined = f.provider.combine_format
          .replace('{env}', otherVal)
          .replace('{key}', f.value);
        keyToSplit = f.provider.combine_encoding === 'base64'
          ? Buffer.from(combined).toString('base64')
          : combined;
      }
    }

    const shares = splitString(keyToSplit, 2, 2);
    const share1 = serializeShare(shares[0]);
    const share2 = serializeShare(shares[1]);

    // Helper: read an env var from process.env or the .env file directly
    const readEnvVar = (varName: string): string => {
      const fromEnv = process.env[varName] || '';
      if (fromEnv) return fromEnv;
      try {
        const envContent = fs.readFileSync(f.file, 'utf-8');
        const match = envContent.match(new RegExp(`^${varName}\\s*=\\s*(.+)$`, 'm'));
        if (match) return match[1].trim().replace(/^["']|["']$/g, '');
      } catch { /* ignore */ }
      return '';
    };

    // Resolve dynamic upstream URLs (e.g. Supabase, Algolia, Shopify)
    let upstreamUrl = f.provider.upstream_base_url;
    if (upstreamUrl === 'dynamic' && f.provider.upstream_from_env) {
      upstreamUrl = readEnvVar(f.provider.upstream_from_env);
      if (!upstreamUrl) {
        s.fail(`${f.provider.label}: could not find ${f.provider.upstream_from_env} in your .env. Add it and try again.`);
        continue;
      }
      // Algolia: upstream_from_env is the App ID — build the DSN URL from it
      if (f.provider.id === 'algolia') {
        upstreamUrl = `https://${upstreamUrl}-dsn.algolia.net`;
      }
    }

    // Resolve extra_headers: replace {env:VAR_NAME} placeholders with literal values
    // This lets providers inject non-secret values (like Algolia's App ID) as headers
    let resolvedExtraHeaders = f.provider.extra_headers ? { ...f.provider.extra_headers } : null;
    if (resolvedExtraHeaders) {
      for (const [k, v] of Object.entries(resolvedExtraHeaders)) {
        const envMatch = v.match(/^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/);
        if (envMatch) {
          const val = readEnvVar(envMatch[1]);
          if (val) resolvedExtraHeaders[k] = val;
          else delete resolvedExtraHeaders[k]; // skip if not found
        }
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
          extra_headers: resolvedExtraHeaders ?? null,
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

  // ── Generate helper file for providers that need code-level config ──
  const hasStripe = findings.some((f) => f.provider.id === 'stripe');
  const hasSupabase = findings.some((f) => f.provider.id === 'supabase');
  const hasGoogle = findings.some((f) => f.provider.id === 'google');

  if (hasStripe || hasSupabase || hasGoogle) {
    const configLines: string[] = [
      '// Generated by npx @vaultproof/init — do not edit manually.',
      '// Import from this file instead of constructing clients directly.',
      '',
    ];
    const importHints: string[] = [];

    if (hasGoogle) {
      configLines.push(
        `// Google / Gemini`,
        `// Supports both @google/genai (new) and @google/generative-ai (legacy)`,
        `const GOOGLE_PROXY = 'https://init.vaultproof.dev/p/google';`,
        `const GOOGLE_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';`,
        ``,
        `// @google/genai (new SDK, recommended)`,
        `let genai: any = null;`,
        `try {`,
        `  const { GoogleGenAI } = await import('@google/genai');`,
        `  genai = new GoogleGenAI({ apiKey: GOOGLE_KEY, httpOptions: { baseUrl: GOOGLE_PROXY } });`,
        `} catch {}`,
        `export { genai };`,
        ``,
        `// @google/generative-ai (legacy SDK)`,
        `let GoogleGenerativeAI: any = null;`,
        `let genAI: any = null;`,
        `try {`,
        `  const m = await import('@google/generative-ai');`,
        `  GoogleGenerativeAI = m.GoogleGenerativeAI;`,
        `  genAI = new GoogleGenerativeAI(GOOGLE_KEY, { baseUrl: GOOGLE_PROXY });`,
        `} catch {}`,
        `export { genAI };`,
        ``,
      );
      importHints.push(`    import { genai } from './vaultproof.config'; // @google/genai`);
      importHints.push(`    import { genAI } from './vaultproof.config'; // @google/generative-ai`);
    }

    if (hasStripe) {
      configLines.push(
        `import Stripe from 'stripe';`,
        ``,
        `export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {`,
        `  host: 'init.vaultproof.dev',`,
        `  apiVersion: '2023-10-16',`,
        `});`,
        ``,
      );
      importHints.push(`    import { stripe } from './vaultproof.config';`);
    }

    if (hasSupabase) {
      configLines.push(
        `import { createClient } from '@supabase/supabase-js';`,
        ``,
        `export const supabaseService = createClient(`,
        `  process.env.SUPABASE_PROXY_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,`,
        `  process.env.SUPABASE_SERVICE_ROLE_KEY!,`,
        `  { auth: { autoRefreshToken: false, persistSession: false } }`,
        `);`,
        ``,
      );
      importHints.push(`    import { supabaseService } from './vaultproof.config';`);
    }

    // Detect if project uses TypeScript
    const hasTsConfig = fs.existsSync(path.join(process.cwd(), 'tsconfig.json'));
    const ext = hasTsConfig ? 'ts' : 'js';
    const configPath = path.join(process.cwd(), `vaultproof.config.${ext}`);

    // Only write if file doesn't already exist
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, configLines.join('\n'));
      console.log(`\n${chalk.green('✓')} Created ${chalk.bold(`vaultproof.config.${ext}`)}`);
      console.log(chalk.dim('  Import from this file instead of constructing clients directly:'));
      for (const hint of importHints) console.log(chalk.dim(hint));
    } else {
      console.log(chalk.dim(`\n  vaultproof.config.${ext} already exists — skipped.`));
    }
    console.log();
  }

  // ── Deploy checklist ──
  // Build the list of env vars the user needs to set on their hosting platform
  const deployVars: Array<{ name: string; value: string }> = [
    { name: 'VAULTPROOF_PROJECT_ID', value: projectId },
  ];
  for (const f of findings) {
    deployVars.push({ name: f.varName, value: projectId });
    if (f.provider.base_url_env_var && f.provider.base_url_path_suffix) {
      deployVars.push({
        name: f.provider.base_url_env_var,
        value: `${proxyBaseUrl}${f.provider.base_url_path_suffix}`,
      });
    }
  }

  console.log(chalk.bold('\n── Deploy to production ──\n'));
  console.log(chalk.dim('Set these env vars on your hosting platform (Vercel, Railway, Netlify, etc.):\n'));
  for (const v of deployVars) {
    console.log(`  ${chalk.white(v.name)}=${chalk.dim(v.value)}`);
  }

  console.log(chalk.dim('\nNone of these are secrets — safe to commit.\n'));

  const { prompt: promptInput } = await import('./prompts.js');
  const deployed = await confirm('Have you set these on your hosting platform?');

  if (deployed) {
    // Quick proxy test for each provider
    console.log();
    for (const f of findings) {
      const testSpinner = ora(`Testing ${f.provider.label} proxy...`).start();
      try {
        const testUrl = f.provider.id === 'stripe'
          ? `${proxyBaseUrl}/v1/customers?limit=1`
          : `${proxyBaseUrl}/p/${f.provider.id}/`;
        const testRes = await fetch(testUrl, {
          method: 'GET',
          headers: { Authorization: `Bearer ${projectId}` },
        });
        if (testRes.status === 401 || testRes.status === 200) {
          // 401 from upstream = proxy chain works (key reconstructed, upstream rejected the fake path)
          // 200 = proxy chain works and upstream responded
          testSpinner.succeed(`${f.provider.label} proxy: ${chalk.green('connected')}`);
        } else if (testRes.status === 404 || testRes.status === 405) {
          // 404/405 from upstream = proxy reached the upstream, path just isn't valid for GET
          testSpinner.succeed(`${f.provider.label} proxy: ${chalk.green('connected')}`);
        } else {
          testSpinner.warn(`${f.provider.label} proxy: status ${testRes.status} — check your deployment`);
        }
      } catch (err) {
        testSpinner.fail(`${f.provider.label} proxy: ${chalk.red('could not connect')}`);
      }
    }
  }

  console.log(chalk.bold('\n✓ All done.\n'));
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
