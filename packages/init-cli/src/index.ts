#!/usr/bin/env node
/**
 * @vaultproof/init
 *
 * One command: scan → split → upload → rewrite. Zero code changes.
 *
 * Usage:
 *   vaultproof-init            # interactive
 *   vaultproof-init --yes      # auto-confirm
 *   vaultproof-init --dry-run  # scan only, no upload, no rewrite
 *   vaultproof-init custom     # protect a custom/internal API key
 *   vaultproof-init secrets add
 *   vaultproof-init netops
 *   vaultproof-init run -- npm run dev
 *   vaultproof-init migrate-from-legacy
 *   vaultproof-init doctor
 */
import chalk from 'chalk';
import ora from 'ora';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { splitString, serializeShare } from '@vaultproof/shamir';
import { scanDirectory, truncateKey, type Finding } from './scan.js';
import { rewriteEnvFile, rewriteEnvFileForMigration, rewriteEnvFileForVaultSecrets, type MigrationEntry } from './rewrite.js';
import { getJwt, getInitWorkerUrl, getProxyBaseUrl } from './config.js';
import { loadProviders, type ProviderSpec } from './providers.js';
import { listLegacyKeys, type LegacyKey } from './legacy.js';
import { confirm, prompt, promptHidden } from './prompts.js';
import { browserLogin } from './login.js';
import { findStripeConstructors } from './stripe-helper.js';
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
import {
  deriveVaultSecretProviderId,
  formatDotEnvValue,
  isLikelyVaultSecretEntry,
  vaultSecretPlaceholder,
  type VaultSecretEntry,
} from './vault-secret.js';
import {
  rewriteNetOpsSecretFiles,
  scanNetOpsSecrets,
  type NetOpsSecretEntry,
} from './netops.js';

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
  const version   = chalk.dim('  v0.1.1');

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

function parseArgs(argv: string[]): { cmd: string; flags: Set<string>; positionals: string[]; passthrough: string[] } {
  const args = argv.slice(2);
  const flags = new Set<string>();
  const positionals: string[] = [];
  const passthroughIndex = args.indexOf('--');
  const cliArgs = passthroughIndex >= 0 ? args.slice(0, passthroughIndex) : args;
  const passthrough = passthroughIndex >= 0 ? args.slice(passthroughIndex + 1) : [];
  let cmd = 'init';
  for (const a of cliArgs) {
    if (a.startsWith('-')) flags.add(a);
    else if (!a.startsWith('-')) positionals.push(a);
  }
  if (positionals.length > 0) cmd = positionals[0];
  return { cmd, flags, positionals, passthrough };
}

function printUsage(): void {
  console.log(chalk.dim('Usage:'));
  console.log(chalk.dim('  vaultproof-init [--yes|-y] [--dry-run] [--check-legacy]'));
  console.log(chalk.dim('  vaultproof-init [--custom]'));
  console.log(chalk.dim('  vaultproof-init custom'));
  console.log(chalk.dim('  vaultproof-init secrets add'));
  console.log(chalk.dim('  vaultproof-init secrets pull [--stdout]'));
  console.log(chalk.dim('  vaultproof-init netops'));
  console.log(chalk.dim('  vaultproof-init netops run -- <command>'));
  console.log(chalk.dim('  vaultproof-init run -- <command>'));
  console.log(chalk.dim('  vaultproof-init migrate-from-legacy'));
  console.log(chalk.dim('  vaultproof-init doctor'));
}

function readLegacyVpLiveKeyFromConfig(): string | null {
  const configPath = path.join(os.homedir(), '.vaultproof', 'config.json');
  try {
    if (!fs.existsSync(configPath)) return null;
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as { apiKey?: string };
    if (raw.apiKey && raw.apiKey.startsWith('vp_live_')) return raw.apiKey;
  } catch {
    // unreadable config
  }
  return null;
}

function readLegacyVpLiveKey(): string | null {
  const fromConfig = readLegacyVpLiveKeyFromConfig();
  if (fromConfig) return fromConfig;

  // Also check env
  if (process.env.VAULTPROOF_API_KEY?.startsWith('vp_live_')) return process.env.VAULTPROOF_API_KEY;
  return null;
}

const ENV_SCAN_FILES = ['.env', '.env.local', '.env.production', '.env.development'];

interface EnvFileStatus {
  file: string;
  exists: boolean;
  absolutePath: string;
}

interface EnvEntry {
  file: string;
  line: number;
  name: string;
  value: string;
}

interface VaultProofMarker {
  source: 'file' | 'process-env' | 'legacy-config';
  name: string;
  value: string;
  reason: string;
  file?: string;
  line?: number;
}

function getEnvFileStatuses(cwd: string): EnvFileStatus[] {
  return ENV_SCAN_FILES.map((name) => {
    const absolutePath = path.join(cwd, name);
    return {
      file: name,
      absolutePath,
      exists: fs.existsSync(absolutePath),
    };
  });
}

function parseEnvEntries(filePath: string): EnvEntry[] {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
  const out: EnvEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (!m) continue;
    const [, name, rawValue] = m;
    const value = rawValue.trim().replace(/^["']|["']$/g, '');
    out.push({ file: filePath, line: i + 1, name, value });
  }
  return out;
}

function classifyVaultProofMarker(name: string, value: string): string | null {
  if (name === 'VAULTPROOF_PROJECT_ID' && value.startsWith('vp-proj-')) {
    return 'project ID already configured';
  }
  if (name === 'VAULTPROOF_API_KEY' && (value.startsWith('vp_live_') || value.startsWith('vp_test_'))) {
    return 'legacy VaultProof API key configured';
  }
  if (name === 'VAULTPROOF_JWT' && value.length > 20) {
    return 'JWT auth token present';
  }
  if (name.endsWith('_BASE_URL') && /(?:^https:\/\/)?(?:init|api)\.vaultproof\.dev/i.test(value)) {
    return 'provider base URL already routed through VaultProof';
  }
  if ((name.endsWith('_API_KEY') || name.endsWith('_SECRET_KEY') || name.endsWith('_TOKEN')) && value.startsWith('vp-proj-')) {
    return 'provider key already replaced with project ID';
  }
  if (value.startsWith('vaultproof://')) {
    return 'vault-only secret placeholder';
  }
  return null;
}

function collectVaultProofMarkers(cwd: string, statuses: EnvFileStatus[]): VaultProofMarker[] {
  const markers: VaultProofMarker[] = [];

  for (const status of statuses) {
    if (!status.exists) continue;
    const entries = parseEnvEntries(status.absolutePath);
    for (const e of entries) {
      const reason = classifyVaultProofMarker(e.name, e.value);
      if (!reason) continue;
      markers.push({
        source: 'file',
        name: e.name,
        value: e.value,
        reason,
        file: status.file,
        line: e.line,
      });
    }
  }

  const processEnvCandidates = ['VAULTPROOF_PROJECT_ID', 'VAULTPROOF_API_KEY', 'VAULTPROOF_JWT'];
  for (const key of processEnvCandidates) {
    const value = process.env[key];
    if (!value) continue;
    const reason = classifyVaultProofMarker(key, value);
    if (!reason) continue;
    markers.push({
      source: 'process-env',
      name: key,
      value,
      reason,
    });
  }

  const legacyVpLive = readLegacyVpLiveKeyFromConfig();
  if (legacyVpLive) {
    markers.push({
      source: 'legacy-config',
      name: 'VAULTPROOF_API_KEY',
      value: legacyVpLive,
      reason: 'legacy VaultProof API key found in ~/.vaultproof/config.json',
      file: '~/.vaultproof/config.json',
    });
  }

  return markers;
}

function displayMarkerValue(name: string, value: string): string {
  if (name === 'VAULTPROOF_JWT') return '<present>';
  if (name.endsWith('_BASE_URL')) return value;
  return truncateKey(value);
}

function printScanReport(statuses: EnvFileStatus[], providerCount: number, markers: VaultProofMarker[]): void {
  console.log(chalk.bold('Scan checks:\n'));
  console.log(chalk.dim('  Files checked for env keys:'));
  for (const s of statuses) {
    const icon = s.exists ? chalk.green('✓') : chalk.dim('•');
    const state = s.exists ? chalk.white('found') : chalk.dim('not found');
    console.log(`  ${icon} ${s.file.padEnd(18)} ${state}`);
  }

  console.log(chalk.dim('\n  Detection performed:'));
  console.log(chalk.dim(`  • API key pattern matching against ${providerCount} provider signatures`));
  console.log(chalk.dim('  • Existing VaultProof markers (project ID, legacy key, routed base URLs)'));

  if (markers.length === 0) {
    console.log(chalk.dim('\n  Existing VaultProof config: none detected\n'));
    return;
  }

  console.log(chalk.yellow('\n  Existing VaultProof config detected:'));
  for (const m of markers) {
    if (m.source === 'file') {
      console.log(
        `  ${chalk.yellow('•')} ${m.name}=${chalk.white(displayMarkerValue(m.name, m.value))} ` +
        chalk.dim(`(${m.reason}; ${m.file}:${m.line})`),
      );
    } else if (m.source === 'process-env') {
      console.log(
        `  ${chalk.yellow('•')} ${m.name}=${chalk.white(displayMarkerValue(m.name, m.value))} ` +
        chalk.dim(`(${m.reason}; process env)`),
      );
    } else {
      console.log(
        `  ${chalk.yellow('•')} ${m.name}=${chalk.white(displayMarkerValue(m.name, m.value))} ` +
        chalk.dim(`(${m.reason}; ${m.file})`),
      );
    }
  }
  console.log();
}

function envEntryKey(entry: EnvEntry): string {
  return `${entry.file}:${entry.name}`;
}

function findingEntryKey(finding: Finding): string {
  return `${finding.file}:${finding.varName}`;
}

function formatEnvEntrySource(cwd: string, entry: EnvEntry): string {
  const relative = path.relative(cwd, entry.file) || path.basename(entry.file);
  return `${relative}:${entry.line}`;
}

function allEnvEntries(statuses: EnvFileStatus[]): EnvEntry[] {
  const entries: EnvEntry[] = [];
  for (const status of statuses) {
    if (!status.exists) continue;
    entries.push(...parseEnvEntries(status.absolutePath));
  }
  return entries;
}

function readEnvValue(cwd: string, name: string): string {
  const fromProcess = process.env[name];
  if (fromProcess) return fromProcess;
  for (const status of getEnvFileStatuses(cwd)) {
    if (!status.exists) continue;
    const entry = parseEnvEntries(status.absolutePath).find((item) => item.name === name);
    if (entry?.value) return entry.value;
  }
  return '';
}

function envFileValues(cwd: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const status of getEnvFileStatuses(cwd)) {
    if (!status.exists) continue;
    for (const entry of parseEnvEntries(status.absolutePath)) {
      values[entry.name] = entry.value;
    }
  }
  return values;
}

async function ensureJwt(): Promise<string> {
  let jwt = getJwt();
  if (jwt) return jwt;

  console.log(chalk.dim('\nOpening browser to log in...\n'));
  const loginSpinner = ora('Waiting for login...').start();
  const result = await browserLogin();
  if (!result) {
    loginSpinner.fail('Login timed out or was cancelled.');
    process.exit(1);
  }
  loginSpinner.succeed(`Logged in as ${chalk.bold(result.email)}`);
  jwt = result.token;
  return jwt;
}

interface ProjectChoice {
  id: string;
  vp_proj_id: string;
  name: string | null;
}

async function listProjects(jwt: string, apiUrl: string): Promise<ProjectChoice[]> {
  const res = await fetch(`${apiUrl}/api/v1/init/projects`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Could not list projects: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { projects?: ProjectChoice[] };
  return data.projects || [];
}

async function createProject(jwt: string, apiUrl: string, name: string): Promise<ProjectChoice> {
  const res = await fetch(`${apiUrl}/api/v1/init/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Project creation failed: ${res.status} ${text}`);
  }
  return (await res.json()) as ProjectChoice;
}

async function chooseProject(jwt: string, apiUrl: string, opts: { autoYes: boolean; preferredProjectId?: string; createName: string }): Promise<ProjectChoice> {
  const projects = await listProjects(jwt, apiUrl);
  if (opts.preferredProjectId) {
    const found = projects.find((project) => project.vp_proj_id === opts.preferredProjectId);
    if (found) return found;
    console.log(chalk.yellow(`Configured VAULTPROOF_PROJECT_ID ${opts.preferredProjectId} was not found on this account.`));
  }

  if (projects.length === 0) {
    return await createProject(jwt, apiUrl, opts.createName);
  }
  if (projects.length === 1 || opts.autoYes) {
    return projects[0];
  }

  console.log(chalk.bold('You have existing projects:\n'));
  projects.forEach((project, index) => {
    console.log(`  ${chalk.bold(String(index + 1))}. ${project.name || '(unnamed)'} ${chalk.dim(project.vp_proj_id)}`);
  });
  console.log(`  ${chalk.bold(String(projects.length + 1))}. ${chalk.dim('Create a new project')}`);
  console.log();

  const choice = await prompt(`Use which project? (1-${projects.length + 1}) `);
  const idx = Number.parseInt(choice, 10);
  if (Number.isInteger(idx) && idx >= 1 && idx <= projects.length) return projects[idx - 1];
  return await createProject(jwt, apiUrl, opts.createName);
}

function promptWithDefault(question: string, defaultValue: string): Promise<string> {
  return prompt(`${question} ${chalk.dim(`(${defaultValue})`)} `).then((answer) => answer || defaultValue);
}

async function promptValidated(
  question: string,
  defaultValue: string,
  validate: (value: string) => { ok: boolean; error?: string },
): Promise<string> {
  while (true) {
    const value = await promptWithDefault(question, defaultValue);
    const result = validate(value);
    if (result.ok) return value;
    console.log(chalk.yellow(`  ${result.error || 'Invalid value'}`));
  }
}

async function promptCustomProviderForEntry(
  entry: EnvEntry,
  cwd: string,
  existingProviderIds: Set<string>,
): Promise<Finding | null> {
  console.log(chalk.bold(`\nCustom provider for ${entry.name}`));
  console.log(chalk.dim(`  Source: ${formatEnvEntrySource(cwd, entry)}`));
  console.log(chalk.dim('  Upstream must be a public HTTPS hostname. Private IPs, .internal, localhost, and custom ports are blocked.\n'));

  const defaultSlug = deriveCustomProviderId(entry.name);
  let slug = '';
  while (!slug) {
    const candidate = await promptValidated('Provider slug', defaultSlug, validateProviderSlug);
    if (existingProviderIds.has(candidate)) {
      console.log(chalk.yellow(`  "${candidate}" is already in the provider catalog. Choose a unique slug for this custom API.`));
      continue;
    }
    slug = candidate;
  }

  const label = await promptWithDefault('Display name', deriveCustomLabel(slug));

  let upstreamBaseUrl = '';
  while (!upstreamBaseUrl) {
    const raw = await prompt('Upstream base URL (for example https://api.yourcompany.com) ');
    const checked = validateCustomUpstreamUrl(raw);
    if (!checked.ok || !checked.normalizedUrl) {
      console.log(chalk.yellow(`  ${checked.error || 'Invalid upstream URL'}`));
      continue;
    }
    upstreamBaseUrl = checked.normalizedUrl;
  }

  const authHeaderName = await promptValidated(
    'Auth header name',
    'Authorization',
    validateCustomHeaderName,
  );
  const authHeaderTemplate = await promptValidated(
    'Auth header template, using {key}',
    authHeaderName.toLowerCase() === 'authorization' ? 'Bearer {key}' : '{key}',
    validateCustomHeaderTemplate,
  );
  const baseUrlEnvVar = await promptValidated(
    'Base URL env var to add',
    deriveBaseUrlEnvVar(entry.name),
    (value) => {
      const result = validateEnvVarName(value);
      if (!result.ok) return result;
      if (value.toUpperCase() === entry.name.toUpperCase()) {
        return { ok: false, error: 'Base URL env var must be different from the API key env var' };
      }
      return { ok: true };
    },
  );

  const provider = buildCustomProviderSpec({
    id: slug,
    label,
    envVar: entry.name,
    upstreamBaseUrl,
    authHeaderName,
    authHeaderTemplate,
    baseUrlEnvVar,
  });

  return {
    file: entry.file,
    line: entry.line,
    varName: entry.name,
    value: entry.value,
    provider,
  };
}

async function collectCustomFindings(
  cwd: string,
  statuses: EnvFileStatus[],
  existingFindings: Finding[],
  catalogProviders: ProviderSpec[],
  opts: { autoYes: boolean; forceCustom: boolean; customOnly: boolean },
): Promise<Finding[]> {
  if (!opts.forceCustom && opts.autoYes) return [];

  const promptForCustom = opts.forceCustom
    ? true
    : await confirm(
      existingFindings.length > 0
        ? 'Add a custom/internal API key that was not auto-detected?'
        : 'Add a custom/internal API key from your .env?',
      false,
    );
  if (!promptForCustom) return [];

  const matched = new Set(existingFindings.map(findingEntryKey));
  const selected = new Set<string>();
  const existingProviderIds = new Set(catalogProviders.map((provider) => provider.id));
  const entries = allEnvEntries(statuses);
  const customFindings: Finding[] = [];

  while (true) {
    const candidates = entries.filter((entry) => (
      !matched.has(envEntryKey(entry))
      && !selected.has(envEntryKey(entry))
      && isLikelyCustomSecretEntry({ name: entry.name, value: entry.value })
    ));

    if (candidates.length === 0) {
      console.log(chalk.yellow('\nNo obvious custom/internal API key candidates found in checked .env files.'));
      console.log(chalk.dim('Add a NAME=plaintext-key entry such as INTERNAL_API_KEY=... to .env, then rerun `vaultproof-init custom`.'));
      break;
    }

    console.log(chalk.bold('\nPossible custom/internal keys:\n'));
    candidates.forEach((entry, index) => {
      console.log(
        `  ${chalk.bold(String(index + 1).padStart(2))}. ${entry.name.padEnd(30)} ` +
        `${chalk.dim(truncateKey(entry.value).padEnd(18))} ${chalk.dim(formatEnvEntrySource(cwd, entry))}`,
      );
    });
    console.log();

    const answer = await prompt('Choose a key number or env var name (blank to finish): ');
    if (!answer) break;

    const index = Number.parseInt(answer, 10);
    const entry = Number.isInteger(index) && index >= 1 && index <= candidates.length
      ? candidates[index - 1]
      : candidates.find((candidate) => candidate.name.toUpperCase() === answer.toUpperCase());

    if (!entry) {
      console.log(chalk.yellow('  No matching key. Choose one of the listed numbers or names.'));
      continue;
    }

    const customFinding = await promptCustomProviderForEntry(entry, cwd, existingProviderIds);
    if (customFinding) {
      customFindings.push(customFinding);
      selected.add(envEntryKey(entry));
      existingProviderIds.add(customFinding.provider.id);
    }

    if (!await confirm('Add another custom/internal API key?', false)) break;
  }

  return customFindings;
}

async function collectVaultSecretFindings(
  cwd: string,
  statuses: EnvFileStatus[],
  opts: { autoYes: boolean; force: boolean },
): Promise<VaultSecretEntry[]> {
  if (!opts.force && opts.autoYes) return [];

  const promptForVaultSecrets = opts.force
    ? true
    : await confirm('Protect vault-only secrets like DATABASE_URL, JWT_SECRET, and WEBHOOK_SECRET?', false);
  if (!promptForVaultSecrets) return [];

  const selected = new Set<string>();
  const entries = allEnvEntries(statuses);
  const vaultSecrets: VaultSecretEntry[] = [];

  while (true) {
    const candidates = entries.filter((entry) => (
      !selected.has(envEntryKey(entry))
      && isLikelyVaultSecretEntry({ name: entry.name, value: entry.value })
    ));

    if (candidates.length === 0) {
      console.log(chalk.yellow('\nNo vault-only secret candidates found in checked .env files.'));
      console.log(chalk.dim('Examples: DATABASE_URL=..., JWT_SECRET=..., SESSION_SECRET=..., WEBHOOK_SECRET=...'));
      break;
    }

    if (opts.autoYes) {
      for (const entry of candidates) {
        vaultSecrets.push(entry);
        selected.add(envEntryKey(entry));
      }
      break;
    }

    console.log(chalk.bold('\nPossible vault-only secrets:\n'));
    candidates.forEach((entry, index) => {
      console.log(
        `  ${chalk.bold(String(index + 1).padStart(2))}. ${entry.name.padEnd(30)} ` +
        `${chalk.dim(truncateKey(entry.value).padEnd(18))} ${chalk.dim(formatEnvEntrySource(cwd, entry))}`,
      );
    });
    console.log();

    const answer = await prompt('Choose a secret number or env var name (blank to finish, "all" for all): ');
    if (!answer) break;

    if (answer.toLowerCase() === 'all') {
      for (const entry of candidates) {
        vaultSecrets.push(entry);
        selected.add(envEntryKey(entry));
      }
      break;
    }

    const index = Number.parseInt(answer, 10);
    const entry = Number.isInteger(index) && index >= 1 && index <= candidates.length
      ? candidates[index - 1]
      : candidates.find((candidate) => candidate.name.toUpperCase() === answer.toUpperCase());

    if (!entry) {
      console.log(chalk.yellow('  No matching secret. Choose one of the listed numbers or names.'));
      continue;
    }

    vaultSecrets.push(entry);
    selected.add(envEntryKey(entry));

    if (!await confirm('Add another vault-only secret?', false)) break;
  }

  return vaultSecrets;
}

async function uploadVaultSecret(
  apiUrl: string,
  jwt: string,
  projectRowId: string,
  secret: VaultSecretEntry,
): Promise<void> {
  const shares = splitString(secret.value, 2, 2);
  const provider = deriveVaultSecretProviderId(secret.name);
  const res = await fetch(`${apiUrl}/api/v1/init/projects/${projectRowId}/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({
      provider,
      slug: provider,
      share1: serializeShare(shares[0]),
      share2: serializeShare(shares[1]),
      env_var: secret.name,
      upstream_base_url: 'https://vaultproof.dev',
      auth_header_name: 'Authorization',
      auth_header_template: '{key}',
      extra_headers: { 'x-vaultproof-kind': 'env-secret' },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed for ${secret.name}: ${res.status} ${text}`);
  }
}

interface PulledVaultSecret {
  env_var: string;
  value: string;
}

async function fetchVaultSecrets(apiUrl: string, jwt: string, projectRowId: string): Promise<PulledVaultSecret[]> {
  const res = await fetch(`${apiUrl}/api/v1/init/projects/${projectRowId}/secrets`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Could not fetch vault-only secrets: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { secrets?: PulledVaultSecret[] };
  return data.secrets || [];
}

async function runInit(opts: { autoYes: boolean; dryRun: boolean; forceCustom?: boolean; customOnly?: boolean }): Promise<void> {
  printBanner();

  const catalog = await loadProviders();
  const envStatuses = getEnvFileStatuses(process.cwd());
  const vaultProofMarkers = collectVaultProofMarkers(process.cwd(), envStatuses);
  printScanReport(envStatuses, catalog.providers.length, vaultProofMarkers);

  const detectedFindings: Finding[] = opts.customOnly ? [] : scanDirectory(process.cwd(), catalog.providers);
  const customFindings = await collectCustomFindings(
    process.cwd(),
    envStatuses,
    detectedFindings,
    catalog.providers,
    {
      autoYes: opts.autoYes,
      forceCustom: Boolean(opts.forceCustom || opts.customOnly),
      customOnly: Boolean(opts.customOnly),
    },
  );
  const findings: Finding[] = [...detectedFindings, ...customFindings];
  const vaultSecretFindings = await collectVaultSecretFindings(
    process.cwd(),
    envStatuses,
    { autoYes: opts.autoYes, force: false },
  );

  if (findings.length === 0 && vaultSecretFindings.length === 0) {
    console.log(chalk.yellow('No plaintext API keys or vault-only secrets detected.'));
    if (vaultProofMarkers.length > 0) {
      console.log(chalk.dim('This environment already appears to be configured for VaultProof.'));
    } else {
      console.log(chalk.dim('No provider key patterns or vault-only secret candidates were found in checked .env files.'));
    }
    console.log(chalk.dim(`Provider catalog: ${catalog.providers.length} providers, version ${catalog.version}`));
    process.exit(0);
  }

  if (findings.length > 0) {
    console.log(chalk.bold(`Found ${findings.length} proxy API key${findings.length === 1 ? '' : 's'}:\n`));
    for (const f of findings) {
      console.log(
        `  ${chalk.green('✓')} ${f.varName.padEnd(26)} ${chalk.dim(truncateKey(f.value).padEnd(22))} ${chalk.dim('(' + f.provider.label + ')')}`,
      );
    }
  }

  if (vaultSecretFindings.length > 0) {
    console.log(chalk.bold(`\nFound ${vaultSecretFindings.length} vault-only secret${vaultSecretFindings.length === 1 ? '' : 's'}:\n`));
    for (const secret of vaultSecretFindings) {
      console.log(
        `  ${chalk.green('✓')} ${secret.name.padEnd(26)} ${chalk.dim(truncateKey(secret.value).padEnd(22))} ${chalk.dim('(runtime injection)')}`,
      );
    }
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
      if (vaultSecretFindings.some((secret) => secret.name === varName)) continue;
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
    const total = findings.length + vaultSecretFindings.length;
    const ok = await confirm(`Protect ${total} secret${total === 1 ? '' : 's'} via Shamir splitting?`);
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
  console.log(chalk.dim('─'.repeat(60)));
  console.log(chalk.bold('How VaultProof protects your keys:'));
  console.log(`  ${chalk.cyan('→')} Your key is split into 2 shares ${chalk.bold('on this machine')}`);
  console.log(`  ${chalk.cyan('→')} Each share is useless without the other`);
  console.log(`  ${chalk.cyan('→')} VaultProof never receives your full key`);
  console.log(chalk.dim('─'.repeat(60)) + '\n');

  for (const f of findings) {
    const s = ora(`Splitting ${f.varName} (${f.provider.label})...`).start();

    // Some providers combine the protected secret before splitting it. Examples:
    // Langfuse/Twilio/Jira use base64(public-or-user-id:secret), while
    // Chargebee/Freshdesk use base64(secret:) or base64(secret:X).
    let keyToSplit = f.value;
    if (f.provider.combine_format) {
      let otherVal = '';
      if (f.provider.combine_with_env) {
        otherVal = process.env[f.provider.combine_with_env] || (() => {
          try {
            const envContent = fs.readFileSync(f.file, 'utf-8');
            const match = envContent.match(new RegExp(`^${f.provider.combine_with_env}\\s*=\\s*(.+)$`, 'm'));
            return match ? match[1].trim().replace(/^["']|["']$/g, '') : '';
          } catch { return ''; }
        })();
        if (!otherVal && f.provider.combine_format.includes('{env}')) {
          s.fail(`${f.provider.label}: could not find ${f.provider.combine_with_env} in your .env. Add it and try again.`);
          continue;
        }
      }
      const combined = f.provider.combine_format
        .replace('{env}', otherVal)
        .replace('{key}', f.value);
      keyToSplit = f.provider.combine_encoding === 'base64'
        ? Buffer.from(combined).toString('base64')
        : combined;
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
    s.succeed(`${chalk.bold(f.varName)} ${chalk.dim('(' + f.provider.label + ')')}`);
    console.log(chalk.dim(`    Split locally on your machine`));
    console.log(chalk.dim(`    Share 1 → VaultProof (encrypted with VaultProof's key)`));
    console.log(chalk.dim(`    Share 2 → VaultProof (encrypted with a different key)`));
    console.log(chalk.dim(`    A breach of VaultProof cannot expose this key`));
  }

  for (const secret of vaultSecretFindings) {
    const s = ora(`Splitting ${secret.name} (vault-only)...`).start();
    try {
      await uploadVaultSecret(apiUrl, jwt, projectRowId, secret);
    } catch (err) {
      s.fail(String(err));
      process.exit(1);
    }
    s.succeed(`${chalk.bold(secret.name)} ${chalk.dim('(vault-only secret)')}`);
    console.log(chalk.dim('    Stored for authenticated CLI retrieval and runtime injection'));
    console.log(chalk.dim(`    Use: vaultproof-init run -- <command>`));
  }
  console.log();

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

  const vaultSecretFilesToRewrite = Array.from(new Set(vaultSecretFindings.map((secret) => secret.file)));
  for (const file of vaultSecretFilesToRewrite) {
    const { rewritten } = rewriteEnvFileForVaultSecrets(file, vaultSecretFindings, { projectId, proxyBaseUrl });
    if (rewritten > 0) {
      console.log(`\n${chalk.green('✓')} Rewrote ${chalk.bold(file)} (${rewritten} vault-only secret${rewritten === 1 ? '' : 's'})`);
    }
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
      '// Generated by vaultproof-init — do not edit manually.',
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
  for (const secret of vaultSecretFindings) {
    deployVars.push({ name: secret.name, value: vaultSecretPlaceholder(secret.name) });
  }

  console.log(chalk.bold('\n── Deploy to production ──\n'));
  console.log(chalk.dim('Set these env vars on your hosting platform (Vercel, Railway, Netlify, etc.):\n'));
  for (const v of deployVars) {
    console.log(`  ${chalk.white(v.name)}=${chalk.dim(v.value)}`);
  }

  console.log(chalk.dim('\nThese are identifiers or VaultProof placeholders, not plaintext secrets.\n'));
  if (vaultSecretFindings.length > 0) {
    console.log(chalk.dim('For vault-only secrets, start your app with:'));
    console.log(chalk.white('  vaultproof-init run -- <your start command>\n'));
  }

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
    console.log(chalk.dim('If you never used the legacy system, just run: vaultproof-init'));
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
    console.log(chalk.dim('Nothing to migrate. Run `vaultproof-init` on your current .env if you have plaintext keys there.'));
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
    console.log(chalk.dim('When you are ready, rotate them and re-run `vaultproof-init --check-legacy`.'));
  }
  process.exit(0);
}

async function runSecretsAdd(opts: { autoYes: boolean; dryRun: boolean }): Promise<void> {
  printBanner();

  const catalog = await loadProviders();
  const cwd = process.cwd();
  const envStatuses = getEnvFileStatuses(cwd);
  const markers = collectVaultProofMarkers(cwd, envStatuses);
  printScanReport(envStatuses, catalog.providers.length, markers);

  const vaultSecrets = await collectVaultSecretFindings(cwd, envStatuses, {
    autoYes: opts.autoYes,
    force: true,
  });

  if (vaultSecrets.length === 0) {
    console.log(chalk.yellow('No vault-only secrets selected.'));
    process.exit(0);
  }

  console.log(chalk.bold(`\nSelected ${vaultSecrets.length} vault-only secret${vaultSecrets.length === 1 ? '' : 's'}:\n`));
  for (const secret of vaultSecrets) {
    console.log(`  ${chalk.green('✓')} ${secret.name.padEnd(26)} ${chalk.dim(truncateKey(secret.value).padEnd(22))} ${chalk.dim(formatEnvEntrySource(cwd, secret))}`);
  }

  if (opts.dryRun) {
    console.log(chalk.dim('\n(dry run — not uploading or rewriting)'));
    process.exit(0);
  }

  if (!opts.autoYes) {
    const ok = await confirm(`Protect ${vaultSecrets.length} vault-only secret${vaultSecrets.length === 1 ? '' : 's'}?`);
    if (!ok) {
      console.log(chalk.dim('Cancelled.'));
      process.exit(0);
    }
  }

  const jwt = await ensureJwt();
  const apiUrl = getInitWorkerUrl();
  const preferredProjectId = readEnvValue(cwd, 'VAULTPROOF_PROJECT_ID');
  const project = await chooseProject(jwt, apiUrl, {
    autoYes: opts.autoYes,
    preferredProjectId: preferredProjectId || undefined,
    createName: path.basename(cwd) || 'vaultproof-project',
  });

  for (const secret of vaultSecrets) {
    const spinner = ora(`Splitting + uploading ${secret.name}...`).start();
    try {
      await uploadVaultSecret(apiUrl, jwt, project.id, secret);
      spinner.succeed(`Protected ${chalk.bold(secret.name)}`);
    } catch (err) {
      spinner.fail(String(err));
      process.exit(1);
    }
  }

  const proxyBaseUrl = getProxyBaseUrl();
  for (const file of Array.from(new Set(vaultSecrets.map((secret) => secret.file)))) {
    const { rewritten } = rewriteEnvFileForVaultSecrets(file, vaultSecrets, {
      projectId: project.vp_proj_id,
      proxyBaseUrl,
    });
    if (rewritten > 0) {
      console.log(`${chalk.green('✓')} Rewrote ${chalk.bold(file)} (${rewritten} vault-only secret${rewritten === 1 ? '' : 's'})`);
    }
  }

  console.log(`\n${chalk.bold.green('Done.')} Vault-only secrets are stored for project ${chalk.bold(project.vp_proj_id)}.`);
  console.log(chalk.dim('Run with injected secrets:'));
  console.log(chalk.white('  vaultproof-init run -- <your start command>'));
}

async function selectNetOpsSecrets(
  cwd: string,
  candidates: NetOpsSecretEntry[],
  opts: { autoYes: boolean },
): Promise<NetOpsSecretEntry[]> {
  if (opts.autoYes) return candidates;

  const selected = new Set<string>();
  const out: NetOpsSecretEntry[] = [];

  while (true) {
    const remaining = candidates.filter((entry) => !selected.has(`${entry.file}:${entry.line}:${entry.name}`));
    if (remaining.length === 0) break;

    console.log(chalk.bold('\nPossible NetOps secrets:\n'));
    remaining.forEach((entry, index) => {
      const label = `${entry.sourceKey} → ${entry.name}`;
      console.log(
        `  ${chalk.bold(String(index + 1).padStart(2))}. ${label.padEnd(44)} ` +
        `${chalk.dim(truncateKey(entry.value).padEnd(18))} ${chalk.dim(formatEnvEntrySource(cwd, entry))}`,
      );
    });
    console.log();

    const answer = await prompt('Choose a secret number (blank to finish, "all" for all): ');
    if (!answer) break;

    if (answer.toLowerCase() === 'all') {
      for (const entry of remaining) {
        out.push(entry);
        selected.add(`${entry.file}:${entry.line}:${entry.name}`);
      }
      break;
    }

    const index = Number.parseInt(answer, 10);
    const entry = Number.isInteger(index) && index >= 1 && index <= remaining.length
      ? remaining[index - 1]
      : null;
    if (!entry) {
      console.log(chalk.yellow('  No matching secret. Choose one of the listed numbers.'));
      continue;
    }

    out.push(entry);
    selected.add(`${entry.file}:${entry.line}:${entry.name}`);

    if (!await confirm('Add another NetOps secret?', false)) break;
  }

  return out;
}

async function runNetOpsAdd(opts: { autoYes: boolean; dryRun: boolean }): Promise<void> {
  printBanner();
  const cwd = process.cwd();
  console.log(chalk.bold('VaultProof NetOps — Ansible and Terraform secret cleanup\n'));
  console.log(chalk.dim('Scanning .env, inventory.yml, hosts.yml, group_vars, host_vars, terraform.tfvars, and *.auto.tfvars.\n'));

  const candidates = scanNetOpsSecrets(cwd);
  if (candidates.length === 0) {
    console.log(chalk.yellow('No NetOps secret candidates found.'));
    console.log(chalk.dim('Try names like ANSIBLE_PASSWORD, ansible_password, enable_secret, snmp_community, or device_password.'));
    process.exit(0);
  }

  const selectedSecrets = await selectNetOpsSecrets(cwd, candidates, opts);
  if (selectedSecrets.length === 0) {
    console.log(chalk.yellow('No NetOps secrets selected.'));
    process.exit(0);
  }

  console.log(chalk.bold(`\nSelected ${selectedSecrets.length} NetOps secret${selectedSecrets.length === 1 ? '' : 's'}:\n`));
  for (const secret of selectedSecrets) {
    console.log(`  ${chalk.green('✓')} ${secret.name.padEnd(34)} ${chalk.dim(secret.tool.padEnd(10))} ${chalk.dim(formatEnvEntrySource(cwd, secret))}`);
  }

  if (opts.dryRun) {
    console.log(chalk.dim('\n(dry run — not uploading or rewriting)'));
    process.exit(0);
  }

  if (!opts.autoYes) {
    const ok = await confirm(`Protect ${selectedSecrets.length} NetOps secret${selectedSecrets.length === 1 ? '' : 's'}?`);
    if (!ok) {
      console.log(chalk.dim('Cancelled.'));
      process.exit(0);
    }
  }

  const jwt = await ensureJwt();
  const apiUrl = getInitWorkerUrl();
  const preferredProjectId = readEnvValue(cwd, 'VAULTPROOF_PROJECT_ID');
  const project = await chooseProject(jwt, apiUrl, {
    autoYes: opts.autoYes,
    preferredProjectId: preferredProjectId || undefined,
    createName: `${path.basename(cwd) || 'vaultproof'}-netops`,
  });

  for (const secret of selectedSecrets) {
    const spinner = ora(`Splitting + uploading ${secret.name}...`).start();
    try {
      await uploadVaultSecret(apiUrl, jwt, project.id, secret);
      spinner.succeed(`Protected ${chalk.bold(secret.name)}`);
    } catch (err) {
      spinner.fail(String(err));
      process.exit(1);
    }
  }

  const rewriteResults = rewriteNetOpsSecretFiles(selectedSecrets);
  for (const result of rewriteResults) {
    console.log(`${chalk.green('✓')} Rewrote ${chalk.bold(result.file)} (${result.rewritten} secret${result.rewritten === 1 ? '' : 's'})`);
  }

  if (rewriteResults.length === 0) {
    console.log(chalk.dim('No files were rewritten. Secrets are stored and can be injected with netops run.'));
  }

  console.log(`\n${chalk.bold.green('Done.')} NetOps secrets are stored for project ${chalk.bold(project.vp_proj_id)}.`);
  console.log(chalk.dim('Run automation with injected secrets:'));
  console.log(chalk.white('  vaultproof-init netops run -- ansible-playbook site.yml'));
  console.log(chalk.white('  vaultproof-init netops run -- terraform plan'));
}

async function resolveProjectForVaultSecretRead(jwt: string, apiUrl: string, opts: { autoYes: boolean }): Promise<ProjectChoice> {
  const preferredProjectId = readEnvValue(process.cwd(), 'VAULTPROOF_PROJECT_ID');
  return await chooseProject(jwt, apiUrl, {
    autoYes: opts.autoYes,
    preferredProjectId: preferredProjectId || undefined,
    createName: path.basename(process.cwd()) || 'vaultproof-project',
  });
}

async function runSecretsPull(opts: { autoYes: boolean; stdout: boolean }): Promise<void> {
  const jwt = await ensureJwt();
  const apiUrl = getInitWorkerUrl();
  const project = await resolveProjectForVaultSecretRead(jwt, apiUrl, opts);
  const secrets = await fetchVaultSecrets(apiUrl, jwt, project.id);

  if (secrets.length === 0) {
    console.log(chalk.yellow('No vault-only secrets found for this project.'));
    process.exit(0);
  }

  const lines = secrets
    .sort((a, b) => a.env_var.localeCompare(b.env_var))
    .map((secret) => `${secret.env_var}=${formatDotEnvValue(secret.value)}`);

  if (opts.stdout) {
    console.log(lines.join('\n'));
    return;
  }

  const outPath = path.join(process.cwd(), '.env.vaultproof.local');
  fs.writeFileSync(outPath, lines.join('\n') + '\n', { mode: 0o600 });
  try { fs.chmodSync(outPath, 0o600); } catch { /* best effort */ }
  console.log(`${chalk.green('✓')} Wrote ${secrets.length} secret${secrets.length === 1 ? '' : 's'} to ${chalk.bold(outPath)}`);
  console.log(chalk.dim('This file contains plaintext secrets. Keep it out of git.'));
}

async function runWithVaultSecrets(opts: { autoYes: boolean; passthrough: string[] }): Promise<void> {
  if (opts.passthrough.length === 0) {
    console.error(chalk.red('Missing command. Usage: vaultproof-init run -- <command>'));
    process.exit(1);
  }

  const jwt = await ensureJwt();
  const apiUrl = getInitWorkerUrl();
  const project = await resolveProjectForVaultSecretRead(jwt, apiUrl, opts);
  const secrets = await fetchVaultSecrets(apiUrl, jwt, project.id);

  const localEnv = envFileValues(process.cwd());
  const secretEnv: Record<string, string> = {};
  for (const secret of secrets) secretEnv[secret.env_var] = secret.value;

  const childEnv = {
    ...localEnv,
    ...process.env,
    ...secretEnv,
    VAULTPROOF_PROJECT_ID: project.vp_proj_id,
  };

  console.log(chalk.dim(`Injecting ${secrets.length} vault-only secret${secrets.length === 1 ? '' : 's'} for ${project.vp_proj_id}.`));
  const child = spawn(opts.passthrough[0], opts.passthrough.slice(1), {
    cwd: process.cwd(),
    env: childEnv,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
  child.on('error', (err) => {
    console.error(chalk.red(`Failed to start command: ${err.message}`));
    process.exit(1);
  });
}

async function runDoctor(): Promise<void> {
  printBanner();
  console.log(chalk.bold('VaultProof — health check\n'));

  const apiUrl = getInitWorkerUrl();
  const proxyBaseUrl = getProxyBaseUrl();
  const TIMEOUT_MS = 5_000;

  let issues = 0;

  async function check(
    label: string,
    fn: () => Promise<{ ok: boolean; detail: string }>,
  ): Promise<void> {
    const spinner = ora(label).start();
    try {
      const start = Date.now();
      const result = await Promise.race([
        fn(),
        new Promise<{ ok: boolean; detail: string }>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS),
        ),
      ]);
      const ms = Date.now() - start;
      if (result.ok) {
        spinner.succeed(`${label.padEnd(30)} ${chalk.dim(result.detail)} ${chalk.dim(`(${ms}ms)`)}`);
      } else {
        spinner.fail(`${label.padEnd(30)} ${chalk.red(result.detail)}`);
        issues++;
      }
    } catch (err: any) {
      spinner.fail(`${label.padEnd(30)} ${chalk.red(err?.message === 'timeout' ? 'timeout (5s)' : String(err))}`);
      issues++;
    }
  }

  // Check 1: Worker reachability
  await check('Worker reachability', async () => {
    const res = await fetch(`${apiUrl}/health`);
    return res.ok
      ? { ok: true, detail: 'connected' }
      : { ok: false, detail: `HTTP ${res.status}` };
  });

  // Check 2: Auth validity
  const jwt = getJwt();
  await check('Auth validity', async () => {
    if (!jwt) return { ok: false, detail: 'not logged in — run vaultproof-init first' };
    const res = await fetch(`${apiUrl}/api/v1/init/projects`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const email = (() => {
      try { return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString()).email || ''; } catch { return ''; }
    })();
    return { ok: true, detail: email || 'valid' };
  });

  // Check 3: Share integrity
  let projectId: string | null = null;
  await check('Share integrity', async () => {
    if (!jwt) return { ok: false, detail: 'skipped (not logged in)' };
    const res = await fetch(`${apiUrl}/api/v1/init/projects`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const data = (await res.json()) as { projects: Array<{ id: string; vp_proj_id: string; name: string | null }> };
    const projects = data.projects || [];
    if (projects.length === 0) return { ok: false, detail: 'no projects found' };
    projectId = projects[0].vp_proj_id;
    return { ok: true, detail: `${projects.length} project${projects.length === 1 ? '' : 's'} found` };
  });

  // Check 4: Proxy reachability
  if (projectId) {
    await check('Proxy reachability', async () => {
      const testUrl = `${proxyBaseUrl}/p/openai/`;
      const res = await fetch(testUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${projectId}` },
      });
      if ([200, 401, 404, 405].includes(res.status)) {
        return { ok: true, detail: 'proxy chain connected' };
      }
      return { ok: false, detail: `HTTP ${res.status}` };
    });
  } else {
    console.log(chalk.dim('  Proxy test skipped — no projects found'));
  }

  // Summary
  console.log();
  if (issues === 0) {
    console.log(chalk.bold.green('✓ All checks passed.'));
  } else {
    console.log(chalk.bold.red(`✗ ${issues} issue${issues === 1 ? '' : 's'} found.`));
    console.log(chalk.dim('  See https://vaultproof.dev/status for live uptime data.'));
  }
  console.log();

  process.exit(issues > 0 ? 1 : 0);
}

async function main(): Promise<void> {
  const { cmd, flags, positionals, passthrough } = parseArgs(process.argv);
  const autoYes = flags.has('--yes') || flags.has('-y');
  const dryRun = flags.has('--dry-run');
  const checkLegacy = flags.has('--check-legacy');
  const forceCustom = flags.has('--custom');
  const showHelp = flags.has('--help') || flags.has('-h') || cmd === 'help';

  if (showHelp) {
    printBanner();
    printUsage();
    return;
  }

  if (cmd === 'doctor') {
    await runDoctor();
    return;
  }

  if (cmd === 'migrate-from-legacy') {
    await runCheckLegacy();
    return;
  }

  if (cmd === 'custom') {
    await runInit({ autoYes, dryRun, forceCustom: true, customOnly: true });
    return;
  }

  if (cmd === 'secrets') {
    const subcommand = positionals[1] || 'add';
    if (subcommand === 'add') {
      await runSecretsAdd({ autoYes, dryRun });
      return;
    }
    if (subcommand === 'pull') {
      await runSecretsPull({ autoYes, stdout: flags.has('--stdout') });
      return;
    }
    console.error(chalk.red(`Unknown secrets command: ${subcommand}`));
    printUsage();
    process.exit(1);
  }

  if (cmd === 'netops') {
    const subcommand = positionals[1] || 'add';
    if (subcommand === 'add') {
      await runNetOpsAdd({ autoYes, dryRun });
      return;
    }
    if (subcommand === 'run') {
      await runWithVaultSecrets({ autoYes, passthrough });
      return;
    }
    if (subcommand === 'pull') {
      await runSecretsPull({ autoYes, stdout: flags.has('--stdout') });
      return;
    }
    console.error(chalk.red(`Unknown netops command: ${subcommand}`));
    printUsage();
    process.exit(1);
  }

  if (cmd === 'run') {
    await runWithVaultSecrets({ autoYes, passthrough });
    return;
  }

  if (cmd !== 'init') {
    console.error(chalk.red(`Unknown command: ${cmd}`));
    printUsage();
    process.exit(1);
  }

  if (checkLegacy) {
    await runCheckLegacy();
    return;
  }

  await runInit({ autoYes, dryRun, forceCustom });
}

main().catch((err) => {
  console.error(chalk.red(`Unexpected error: ${String(err)}`));
  process.exit(1);
});
