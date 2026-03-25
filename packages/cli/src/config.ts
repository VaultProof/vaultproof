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

export function getApiUrl(): string {
  return (
    process.env.VAULTPROOF_API_URL ||
    readConfig().apiUrl ||
    "https://api.vaultproof.dev"
  );
}

export function getToken(): string | undefined {
  return readConfig().token;
}

export function getApiKey(): string | undefined {
  return process.env.VAULTPROOF_API_KEY;
}
