/**
 * Config loading.
 *
 * Reads the same `~/.vaultproof/config.json` the legacy CLI writes, so
 * a user who already ran `vaultproof login` gets zero-friction onboarding.
 * This is behavioral reuse only — no code imported from the legacy CLI.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CONFIG_DIR = path.join(os.homedir(), '.vaultproof');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export interface VaultProofConfig {
  apiUrl?: string;
  token?: string;
  email?: string;
}

export function readConfig(): VaultProofConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) as VaultProofConfig;
    }
  } catch {
    // corrupt or unreadable — treat as empty
  }
  return {};
}

export function getInitWorkerUrl(): string {
  return (
    process.env.VAULTPROOF_INIT_URL ||
    'https://init.vaultproof.dev'
  );
}

export function getProxyBaseUrl(): string {
  return (
    process.env.VAULTPROOF_PROXY_URL ||
    'https://init.vaultproof.dev'
  );
}

function isJwtExpired(token: string): boolean {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    return typeof payload.exp === 'number' && payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

export function getJwt(): string | undefined {
  const envJwt = process.env.VAULTPROOF_JWT;
  if (envJwt) return isJwtExpired(envJwt) ? undefined : envJwt;

  const token = readConfig().token;
  if (token && !isJwtExpired(token)) return token;

  return undefined;
}
