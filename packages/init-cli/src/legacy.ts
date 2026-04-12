/**
 * Legacy API client — lists keys stored in the original VaultProof system
 * (the `vp_live_`-authenticated worker at api.vaultproof.dev).
 *
 * This module exists solely to help users audit and migrate away from
 * the legacy system. It does not write to the legacy worker — read-only.
 *
 * Metadata only: we list `{provider, envVar, createdAt}`. Plaintext keys
 * are NOT recoverable from the legacy system by design. Users must
 * re-enter rotated keys during --check-legacy.
 */

export interface LegacyKey {
  id: string;
  provider: string;
  label: string | null;
  envVar: string | null;
  createdAt: string;
}

export interface LegacyListResponse {
  keys: LegacyKey[];
}

const DEFAULT_LEGACY_API = 'https://api.vaultproof.dev';

export function getLegacyApiUrl(): string {
  return process.env.VAULTPROOF_LEGACY_API_URL || DEFAULT_LEGACY_API;
}

/**
 * Parse a raw legacy list response. Exported for testing.
 * Tolerant of missing fields — the legacy schema has been stable but
 * label/envVar may be null on older rows.
 */
export function parseLegacyList(raw: unknown): LegacyListResponse {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { keys?: unknown }).keys)) {
    return { keys: [] };
  }
  const rawKeys = (raw as { keys: unknown[] }).keys;
  const keys: LegacyKey[] = [];
  for (const r of rawKeys) {
    if (!r || typeof r !== 'object') continue;
    const k = r as Record<string, unknown>;
    if (typeof k.id !== 'string' || typeof k.provider !== 'string') continue;
    keys.push({
      id: k.id,
      provider: k.provider,
      label: typeof k.label === 'string' ? k.label : null,
      envVar: typeof k.envVar === 'string' ? k.envVar : null,
      createdAt: typeof k.createdAt === 'string' ? k.createdAt : '',
    });
  }
  return { keys };
}

/**
 * Fetch the list of keys currently stored in the legacy system for
 * the authenticated user. Returns [] if the legacy worker is unreachable
 * or the key is invalid.
 */
export async function listLegacyKeys(vpLiveKey: string): Promise<LegacyListResponse> {
  if (!vpLiveKey || !vpLiveKey.startsWith('vp_live_')) {
    return { keys: [] };
  }
  const url = `${getLegacyApiUrl()}/api/v1/sdk/keys`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'X-API-Key': vpLiveKey },
    });
    if (!res.ok) return { keys: [] };
    const raw = await res.json();
    return parseLegacyList(raw);
  } catch {
    return { keys: [] };
  }
}
