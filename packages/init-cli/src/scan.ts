/**
 * .env scanning — finds API keys by shape against the provider catalog.
 * Universal version: detection is driven by providers.json, not hardcoded.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ProviderSpec } from './providers.js';

export interface Finding {
  file: string;
  line: number;
  varName: string;
  value: string;
  provider: ProviderSpec;
}

const DEFAULT_FILES = ['.env', '.env.local', '.env.production', '.env.development'];

function stripQuotes(raw: string): string {
  const t = raw.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

/**
 * Pick the best provider match for a value. Providers with a `var_hint`
 * require the variable name to contain the hint as a substring — this
 * disambiguates generic patterns (e.g. a 32-char hex string could match
 * several APIs).
 */
function detectProvider(varName: string, value: string, providers: ProviderSpec[]): ProviderSpec | null {
  const normalizedVar = varName.toUpperCase();
  for (const p of providers) {
    let re: RegExp;
    try {
      re = new RegExp(p.detect.regex);
    } catch {
      continue; // skip invalid regex
    }
    if (!re.test(value)) continue;
    if (p.detect.var_hint && !normalizedVar.includes(p.detect.var_hint.toUpperCase())) continue;
    return p;
  }
  return null;
}

export function scanEnvFile(filePath: string, providers: ProviderSpec[]): Finding[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n');
  const findings: Finding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (!m) continue;
    const [, varName, rawValue] = m;
    const value = stripQuotes(rawValue);
    const provider = detectProvider(varName, value, providers);
    if (provider) {
      findings.push({ file: filePath, line: i + 1, varName, value, provider });
    }
  }

  return findings;
}

export function scanDirectory(dir: string, providers: ProviderSpec[]): Finding[] {
  const findings: Finding[] = [];
  for (const name of DEFAULT_FILES) {
    findings.push(...scanEnvFile(path.join(dir, name), providers));
  }
  return findings;
}

export function truncateKey(value: string): string {
  if (value.length <= 12) return value;
  return value.slice(0, 8) + '...' + value.slice(-4);
}
