import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface VaultProofConfig {
  apiUrl?: string;
  token?: string;
  email?: string;
}

const CONFIG_DIR = path.join(os.homedir(), ".vaultproof");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

export function readConfig(): VaultProofConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
      return JSON.parse(raw) as VaultProofConfig;
    }
  } catch {
    // Corrupted config — return empty
  }
  return {};
}

export function writeConfig(config: VaultProofConfig): void {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", {
    mode: 0o600,
  });
}

export function updateConfig(partial: Partial<VaultProofConfig>): void {
  const existing = readConfig();
  writeConfig({ ...existing, ...partial });
}

export function clearConfig(): void {
  if (fs.existsSync(CONFIG_FILE)) {
    fs.unlinkSync(CONFIG_FILE);
  }
}

export function getApiUrl(): string | undefined {
  return process.env.VAULTPROOF_API_URL || readConfig().apiUrl || undefined;
}

/** Direct backend URL — skips the CF Worker for SDK-authenticated calls. */
export function getDirectUrl(): string | undefined {
  return process.env.VAULTPROOF_DIRECT_URL || undefined;
}

export function getToken(): string | undefined {
  return readConfig().token;
}

export function getApiKey(): string | undefined {
  // Environment variable always wins
  if (process.env.VAULTPROOF_API_KEY) return process.env.VAULTPROOF_API_KEY;

  // Fall back to dotenv files in cwd
  const dotenvFiles = ['.env', '.env.local', '.env.development', '.env.development.local'];
  for (const file of dotenvFiles) {
    const filePath = path.join(process.cwd(), file);
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const match = content.match(/^VAULTPROOF_API_KEY\s*=\s*["']?([^\s"'#]+)["']?/m);
        if (match) return match[1];
      }
    } catch {
      // Unreadable file — skip
    }
  }

  return undefined;
}
