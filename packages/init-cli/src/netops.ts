import fs from 'node:fs';
import path from 'node:path';
import {
  isVaultSecretPlaceholder,
  vaultSecretPlaceholder,
  type VaultSecretEntry,
} from './vault-secret.js';

export type NetOpsRewriteMode = 'env-placeholder' | 'ansible-env-lookup' | 'terraform-env-var' | 'none';

export interface NetOpsSecretEntry extends VaultSecretEntry {
  sourceKey: string;
  sourceKind: 'env' | 'ansible-yaml' | 'terraform-tfvars';
  rewriteMode: NetOpsRewriteMode;
  tool: 'env' | 'ansible' | 'terraform';
}

export interface NetOpsRewriteResult {
  file: string;
  rewritten: number;
}

const NETOPS_ENV_NAME_PATTERNS = [
  /^ANSIBLE_(?:PASSWORD|BECOME_PASSWORD|BECOME_PASS|SSH_PASS|NET_PASSWORD|HTTPAPI_PASSWORD)$/,
  /^ENABLE_(?:SECRET|PASSWORD)$/,
  /^DEVICE_(?:PASSWORD|SECRET)$/,
  /^NETOPS_(?:PASSWORD|SECRET|TOKEN)$/,
  /^NORNIR_(?:PASSWORD|SECRET|TOKEN)$/,
  /^NETCONF_(?:PASSWORD|SECRET|TOKEN)$/,
  /^RESTCONF_(?:PASSWORD|SECRET|TOKEN)$/,
  /^SNMP_(?:COMMUNITY|AUTH_KEY|PRIV_KEY|PRIVACY_KEY)$/,
  /^RADIUS_(?:SECRET|SHARED_SECRET)$/,
  /^TACACS_(?:SECRET|SHARED_SECRET)$/,
  /^MERAKI_DASHBOARD_API_KEY$/,
  /^(?:PALO_ALTO|PANOS|FORTINET|FORTIGATE|MERAKI|CISCO|JUNIPER|ARISTA|NETBOX)_(?:API_KEY|API_TOKEN|TOKEN|PASSWORD|SECRET)$/,
];

const ANSIBLE_KEY_TO_ENV_SUFFIX: Record<string, string> = {
  ansible_password: 'ANSIBLE_PASSWORD',
  ansible_ssh_pass: 'ANSIBLE_PASSWORD',
  ansible_become_password: 'ANSIBLE_BECOME_PASSWORD',
  ansible_become_pass: 'ANSIBLE_BECOME_PASSWORD',
  ansible_net_password: 'ANSIBLE_NET_PASSWORD',
  ansible_httpapi_password: 'ANSIBLE_HTTPAPI_PASSWORD',
  enable_secret: 'ENABLE_SECRET',
  enable_password: 'ENABLE_PASSWORD',
  device_password: 'DEVICE_PASSWORD',
  device_secret: 'DEVICE_SECRET',
  netconf_password: 'NETCONF_PASSWORD',
  restconf_password: 'RESTCONF_PASSWORD',
  snmp_community: 'SNMP_COMMUNITY',
  snmp_auth_key: 'SNMP_AUTH_KEY',
  snmp_priv_key: 'SNMP_PRIV_KEY',
  snmp_privacy_key: 'SNMP_PRIVACY_KEY',
  radius_secret: 'RADIUS_SHARED_SECRET',
  radius_shared_secret: 'RADIUS_SHARED_SECRET',
  tacacs_secret: 'TACACS_SECRET',
  tacacs_shared_secret: 'TACACS_SECRET',
  firewall_api_key: 'FIREWALL_API_KEY',
  panos_api_key: 'PANOS_API_KEY',
  palo_alto_api_key: 'PALO_ALTO_API_KEY',
  fortinet_api_token: 'FORTINET_API_TOKEN',
  fortigate_api_token: 'FORTIGATE_API_TOKEN',
  meraki_dashboard_api_key: 'MERAKI_DASHBOARD_API_KEY',
};

const TERRAFORM_SECRET_KEY_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /api_key/i,
  /community/i,
  /private_key/i,
  /shared_key/i,
];

const SKIP_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  'dist',
  'build',
  'coverage',
  'node_modules',
  'vendor',
]);

export function scanNetOpsSecrets(cwd: string): NetOpsSecretEntry[] {
  const files = collectNetOpsFiles(cwd);
  const findings: NetOpsSecretEntry[] = [];
  for (const file of files) {
    findings.push(...scanNetOpsFile(cwd, file));
  }
  return dedupeFindings(findings);
}

export function rewriteNetOpsSecretFiles(secrets: NetOpsSecretEntry[]): NetOpsRewriteResult[] {
  const byFile = new Map<string, NetOpsSecretEntry[]>();
  for (const secret of secrets) {
    if (secret.rewriteMode === 'none') continue;
    const list = byFile.get(secret.file) || [];
    list.push(secret);
    byFile.set(secret.file, list);
  }

  const results: NetOpsRewriteResult[] = [];
  for (const [file, fileSecrets] of byFile) {
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, 'utf-8').split('\n');
    const byLine = new Map<number, NetOpsSecretEntry>();
    for (const secret of fileSecrets) byLine.set(secret.line, secret);

    let rewritten = 0;
    const nextLines = lines.map((line, index) => {
      const secret = byLine.get(index + 1);
      if (!secret) return line;
      const replacement = rewriteLine(line, secret);
      if (replacement === line) return line;
      rewritten++;
      return replacement;
    });

    if (rewritten > 0) {
      fs.writeFileSync(file, nextLines.join('\n'));
      results.push({ file, rewritten });
    }
  }
  return results;
}

function collectNetOpsFiles(cwd: string): string[] {
  const files: string[] = [];
  walk(cwd, files);
  return files.filter((file) => isNetOpsFile(cwd, file));
}

function walk(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.env' && !entry.name.startsWith('.env.')) {
      if (entry.isDirectory()) continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(fullPath, out);
    } else if (entry.isFile()) {
      out.push(fullPath);
    }
  }
}

function isNetOpsFile(cwd: string, file: string): boolean {
  const relative = path.relative(cwd, file).replace(/\\/g, '/');
  const base = path.basename(file);
  if (base === '.env' || /^\.env\.(local|production|development|staging)$/u.test(base)) return true;
  if (/^(inventory|hosts)\.ya?ml$/u.test(base)) return true;
  if (/^(terraform|[^/]+\.auto)\.tfvars$/u.test(base)) return true;
  if (/^(group_vars|host_vars)\//u.test(relative) && /\.ya?ml$/u.test(base)) return true;
  return false;
}

function scanNetOpsFile(cwd: string, file: string): NetOpsSecretEntry[] {
  const relative = path.relative(cwd, file).replace(/\\/g, '/');
  const base = path.basename(file);
  const raw = fs.readFileSync(file, 'utf-8');
  const lines = raw.split('\n');
  const findings: NetOpsSecretEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim().startsWith('#')) continue;

    if (base === '.env' || base.startsWith('.env.')) {
      const entry = parseAssignment(line);
      if (!entry) continue;
      if (!isNetOpsEnvSecret(entry.key, entry.value)) continue;
      findings.push({
        file,
        line: i + 1,
        name: entry.key.toUpperCase(),
        value: entry.value,
        sourceKey: entry.key,
        sourceKind: 'env',
        rewriteMode: 'env-placeholder',
        tool: 'env',
      });
      continue;
    }

    if (/\.tfvars$/u.test(base)) {
      const entry = parseAssignment(line);
      if (!entry) continue;
      if (!isTerraformSecretKey(entry.key, entry.value)) continue;
      findings.push({
        file,
        line: i + 1,
        name: `TF_VAR_${entry.key}`,
        value: entry.value,
        sourceKey: entry.key,
        sourceKind: 'terraform-tfvars',
        rewriteMode: 'terraform-env-var',
        tool: 'terraform',
      });
      continue;
    }

    if (isAnsibleYamlPath(relative)) {
      const entry = parseYamlScalar(line);
      if (!entry) continue;
      const suffix = ANSIBLE_KEY_TO_ENV_SUFFIX[entry.key.toLowerCase()];
      if (!suffix || !isSecretValue(entry.value)) continue;
      findings.push({
        file,
        line: i + 1,
        name: deriveScopedEnvName(cwd, file, suffix),
        value: entry.value,
        sourceKey: entry.key,
        sourceKind: 'ansible-yaml',
        rewriteMode: 'ansible-env-lookup',
        tool: 'ansible',
      });
    }
  }

  return findings;
}

function parseAssignment(line: string): { key: string; value: string } | null {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/u);
  if (!match) return null;
  const value = stripInlineComment(stripQuotes(match[2].trim()));
  if (!isSecretValue(value)) return null;
  return { key: match[1], value };
}

function parseYamlScalar(line: string): { key: string; value: string; indent: string } | null {
  const match = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.+?)\s*$/u);
  if (!match) return null;
  const rawValue = stripInlineComment(match[3].trim());
  if (!rawValue || ['|', '>', '{}', '[]'].includes(rawValue)) return null;
  const value = stripQuotes(rawValue);
  if (!isSecretValue(value)) return null;
  return { indent: match[1], key: match[2], value };
}

function stripQuotes(raw: string): string {
  const trimmed = raw.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function stripInlineComment(raw: string): string {
  const single = raw.match(/^'[^']*'/u);
  if (single) return single[0];
  const double = raw.match(/^"[^"]*"/u);
  if (double) return double[0];
  return raw.replace(/\s+#.*$/u, '').trim();
}

function isSecretValue(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 4) return false;
  if (trimmed.startsWith('vp-proj-') || isVaultSecretPlaceholder(trimmed)) return false;
  if (/\{\{\s*lookup\(['"]env['"]/u.test(trimmed)) return false;
  if (/^(true|false|null|undefined|development|production|staging|test)$/iu.test(trimmed)) return false;
  return true;
}

function isNetOpsEnvSecret(name: string, value: string): boolean {
  if (!isSecretValue(value)) return false;
  const upper = name.toUpperCase();
  return NETOPS_ENV_NAME_PATTERNS.some((pattern) => pattern.test(upper));
}

function isTerraformSecretKey(key: string, value: string): boolean {
  if (!isSecretValue(value)) return false;
  return TERRAFORM_SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function isAnsibleYamlPath(relative: string): boolean {
  const base = path.basename(relative);
  return /^(inventory|hosts)\.ya?ml$/u.test(base) || /^(group_vars|host_vars)\//u.test(relative);
}

function deriveScopedEnvName(cwd: string, file: string, suffix: string): string {
  const relative = path.relative(cwd, file).replace(/\\/g, '/');
  const parts = relative.split('/');
  if (parts[0] === 'host_vars' && parts[1]) {
    return `${toEnvSegment(path.basename(parts[1], path.extname(parts[1])))}_${suffix}`;
  }
  if (parts[0] === 'group_vars' && parts[1]) {
    const group = path.basename(parts[1], path.extname(parts[1]));
    if (group.toLowerCase() === 'all') return suffix;
    return `${toEnvSegment(group)}_${suffix}`;
  }
  return `NETOPS_${suffix}`;
}

function toEnvSegment(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '') || 'NETOPS';
}

function rewriteLine(line: string, secret: NetOpsSecretEntry): string {
  if (secret.rewriteMode === 'env-placeholder') {
    return line.replace(/^(\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*).+?\s*$/u, `$1${vaultSecretPlaceholder(secret.name)}`);
  }

  if (secret.rewriteMode === 'ansible-env-lookup') {
    const match = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_-]*)\s*:/u);
    const indent = match?.[1] || '';
    const key = match?.[2] || secret.sourceKey;
    return `${indent}${key}: "{{ lookup('env', '${secret.name}') }}"`;
  }

  if (secret.rewriteMode === 'terraform-env-var') {
    const indent = line.match(/^(\s*)/u)?.[1] || '';
    return `${indent}# ${secret.sourceKey} managed by VaultProof via ${secret.name}`;
  }

  return line;
}

function dedupeFindings(findings: NetOpsSecretEntry[]): NetOpsSecretEntry[] {
  const seen = new Set<string>();
  const out: NetOpsSecretEntry[] = [];
  for (const finding of findings) {
    const key = `${finding.file}:${finding.line}:${finding.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(finding);
  }
  return out;
}
