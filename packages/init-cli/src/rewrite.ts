/**
 * .env rewriting — swap real keys for the VaultProof project ID, inject
 * provider BASE_URL lines where the SDK supports env-var override, and
 * create a timestamped backup first.
 *
 * Universal version: BASE_URL placement is driven by providers.json
 * (base_url_env_var + base_url_path_suffix). Providers without a base-URL
 * env var (e.g. GitHub, Linear, Resend) just get their key swapped — the
 * user manually points their client at `https://init.vaultproof.dev/p/:slug`.
 */
import fs from 'node:fs';
import type { Finding } from './scan.js';
import type { ProviderSpec } from './providers.js';

export interface RewriteOptions {
  projectId: string;
  proxyBaseUrl: string;
}

function backupPath(envPath: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `${envPath}.backup.${ts}`;
}

/**
 * Create a backup of the .env file with all detected key VALUES redacted.
 * The backup preserves variable names, comments, and structure so the
 * user can see what was there — but plaintext API keys are replaced with
 * a redaction marker. VaultProof must never write plaintext keys to disk.
 */
export function backupEnvFile(envPath: string, findings?: Finding[]): string {
  const dest = backupPath(envPath);
  const original = fs.readFileSync(envPath, 'utf-8');

  if (!findings || findings.length === 0) {
    fs.writeFileSync(dest, original);
    return dest;
  }

  // Build a set of values to redact (the plaintext keys we detected).
  const secretValues = new Set(
    findings.filter((f) => f.file === envPath).map((f) => f.value),
  );

  // Replace each secret value in every line.
  const lines = original.split('\n');
  const redacted = lines.map((line) => {
    for (const secret of secretValues) {
      if (line.includes(secret)) {
        return line.replace(secret, '[REDACTED — protected by VaultProof]');
      }
    }
    return line;
  });

  fs.writeFileSync(dest, redacted.join('\n'));
  return dest;
}

export function rewriteEnvFile(
  envPath: string,
  findings: Finding[],
  opts: RewriteOptions,
): { rewritten: number; backupPath: string; manualNotes: string[] } {
  if (!fs.existsSync(envPath)) return { rewritten: 0, backupPath: '', manualNotes: [] };

  const relevant = findings.filter((f) => f.file === envPath);
  if (relevant.length === 0) return { rewritten: 0, backupPath: '', manualNotes: [] };

  const backup = backupEnvFile(envPath, findings);
  const original = fs.readFileSync(envPath, 'utf-8');
  const lines = original.split('\n');

  const byLine = new Map<number, Finding>();
  for (const f of relevant) byLine.set(f.line, f);

  const providersToConfigure = new Map<string, ProviderSpec>();
  for (const f of relevant) providersToConfigure.set(f.provider.id, f.provider);

  // ── Drop stale VaultProof header block + any BASE_URL lines we manage ──
  const managedBaseUrlVars = new Set<string>();
  for (const p of providersToConfigure.values()) {
    if (p.base_url_env_var) managedBaseUrlVars.add(p.base_url_env_var);
  }
  managedBaseUrlVars.add('VAULTPROOF_PROJECT_ID');

  // ── Pass 1: swap key values on finding lines ──
  const swapped = lines.map((line, idx) => {
    const lineNo = idx + 1;
    const finding = byLine.get(lineNo);
    if (!finding) return line;
    return `${finding.varName}=${opts.projectId}`;
  });

  // ── Pass 2: drop stale managed vars so idempotent re-runs don't duplicate ──
  // Also drop any existing VaultProof header block.
  const cleaned: string[] = [];
  let inManagedBlock = false;
  for (const line of swapped) {
    if (line.startsWith('# ── VaultProof ──')) { inManagedBlock = true; continue; }
    if (inManagedBlock) {
      if (line.startsWith('# ────')) { inManagedBlock = false; continue; }
      if (line.startsWith('#') || line === '') continue;
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (m && managedBaseUrlVars.has(m[1])) continue;
      inManagedBlock = false;
    }
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && managedBaseUrlVars.has(m[1])) continue;
    cleaned.push(line);
  }

  // ── Pass 3: prepend fresh VaultProof block ──
  const manualNotes: string[] = [];
  const header = buildHeader(opts, providersToConfigure, manualNotes);
  const result = header + '\n' + cleaned.join('\n');

  fs.writeFileSync(envPath, result);
  return { rewritten: relevant.length, backupPath: backup, manualNotes };
}

/**
 * Migration-mode rewrite: explicit list of (envVar, provider) entries
 * that were obtained from user input (not from a prior .env scan).
 * Used by --check-legacy. The envPath may not exist — we create it.
 *
 * Replaces existing lines with matching var names; adds new ones.
 * Always writes a fresh VaultProof header block.
 */
export interface MigrationEntry {
  envVar: string;
  provider: ProviderSpec;
}

export function rewriteEnvFileForMigration(
  envPath: string,
  entries: MigrationEntry[],
  opts: RewriteOptions,
): { written: number; backupPath: string; manualNotes: string[] } {
  if (entries.length === 0) return { written: 0, backupPath: '', manualNotes: [] };

  let original = '';
  let backup = '';
  if (fs.existsSync(envPath)) {
    backup = backupEnvFile(envPath);
    original = fs.readFileSync(envPath, 'utf-8');
  }
  const lines = original.split('\n');

  // Providers to configure in the header block
  const providersToConfigure = new Map<string, ProviderSpec>();
  for (const e of entries) providersToConfigure.set(e.provider.id, e.provider);

  // Managed vars we'll overwrite:
  //   - The new entries (their envVar)
  //   - Any base_url_env_var for providers we're touching
  //   - VAULTPROOF_PROJECT_ID
  const managedVars = new Set<string>();
  for (const e of entries) managedVars.add(e.envVar);
  for (const p of providersToConfigure.values()) {
    if (p.base_url_env_var) managedVars.add(p.base_url_env_var);
  }
  managedVars.add('VAULTPROOF_PROJECT_ID');

  // Strip any prior VaultProof header + any managed vars from the body.
  const cleaned: string[] = [];
  let inManagedBlock = false;
  for (const line of lines) {
    if (line.startsWith('# ── VaultProof ──')) { inManagedBlock = true; continue; }
    if (inManagedBlock) {
      if (line.startsWith('# ────')) { inManagedBlock = false; continue; }
      if (line.startsWith('#') || line === '') continue;
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (m && managedVars.has(m[1])) continue;
      inManagedBlock = false;
    }
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && managedVars.has(m[1])) continue;
    cleaned.push(line);
  }

  // Build header with providers
  const manualNotes: string[] = [];
  const header = buildHeader(opts, providersToConfigure, manualNotes);

  // Append migrated key assignments BELOW the header block so they
  // stay grouped with their BASE_URL lines.
  const migrated: string[] = [];
  for (const e of entries) {
    migrated.push(`${e.envVar}=${opts.projectId}`);
  }

  const result = header + '\n' + migrated.join('\n') + '\n' + cleaned.join('\n');
  fs.writeFileSync(envPath, result);
  return { written: entries.length, backupPath: backup, manualNotes };
}

function buildHeader(
  opts: RewriteOptions,
  providers: Map<string, ProviderSpec>,
  manualNotes: string[],
): string {
  const out: string[] = [
    '# ── VaultProof ──────────────────────────────────────────────',
    '# One project ID for every protected key. Safe to commit.',
    '# Generated by `npx @vaultproof/init` — do not hand-edit values.',
    `VAULTPROOF_PROJECT_ID=${opts.projectId}`,
  ];
  for (const p of providers.values()) {
    if (p.base_url_env_var && p.base_url_path_suffix) {
      out.push(`${p.base_url_env_var}=${opts.proxyBaseUrl}${p.base_url_path_suffix}`);
    } else {
      manualNotes.push(
        `${p.label}: set your client's base URL to ${opts.proxyBaseUrl}/p/${p.id}`,
      );
    }
  }
  out.push('# ───────────────────────────────────────────────────────────');
  return out.join('\n');
}
