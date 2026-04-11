/**
 * Provider catalog loader.
 *
 * Source of truth is apps/site/providers.json, served at
 * https://vaultproof.dev/providers.json. The CLI fetches it on every run,
 * falling back to a copy bundled at build time if the fetch fails.
 *
 * This lets us add support for new APIs without shipping a new CLI version.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ProviderSpec {
  id: string;
  label: string;
  upstream_base_url: string;
  auth_header_name: string;
  auth_header_template: string;
  extra_headers?: Record<string, string>;
  env_var_default: string;
  base_url_env_var?: string;
  base_url_path_suffix?: string;
  detect: {
    regex: string;
    var_hint?: string;
  };
}

export interface ProviderCatalog {
  version: number;
  updated: string;
  providers: ProviderSpec[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REMOTE_URL =
  process.env.VAULTPROOF_PROVIDERS_URL ||
  'https://vaultproof.dev/providers.json';

const FETCH_TIMEOUT_MS = 2000;

/**
 * Load the provider catalog. Tries the remote URL first, falls back to the
 * bundled copy if the fetch fails or times out.
 */
export async function loadProviders(): Promise<ProviderCatalog> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(REMOTE_URL, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      const data = (await res.json()) as ProviderCatalog;
      if (isValidCatalog(data)) return data;
    }
  } catch {
    // network failure / timeout — fall through to bundled
  }
  return loadBundled();
}

function loadBundled(): ProviderCatalog {
  // dist/providers.ts → dist/providers.js — the bundled JSON is one level up
  // in the package root (copied by the build script).
  const candidates = [
    path.join(__dirname, '..', 'providers.json'),
    path.join(__dirname, 'providers.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf-8')) as ProviderCatalog;
      if (isValidCatalog(data)) return data;
    }
  }
  throw new Error(
    'Could not load providers.json from remote or bundled fallback. ' +
      'Check your network or reinstall @vaultproof/init.',
  );
}

function isValidCatalog(v: unknown): v is ProviderCatalog {
  if (!v || typeof v !== 'object') return false;
  const c = v as ProviderCatalog;
  return typeof c.version === 'number' && Array.isArray(c.providers);
}
