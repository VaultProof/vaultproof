const VAULT_SECRET_PROVIDER_PREFIX = 'vaultenv-';
const PLACEHOLDER_PREFIX = 'vaultproof://';
const MAX_PROVIDER_ID_LENGTH = 32;

const PUBLIC_NAME_PATTERNS = [
  /^NEXT_PUBLIC_/,
  /^VITE_/,
  /^PUBLIC_/,
  /(?:^|_)PUBLIC_KEY$/,
  /(?:^|_)PUBLISHABLE_KEY$/,
  /(?:^|_)ANON_KEY$/,
  /(?:^|_)PRICE_ID$/,
  /(?:^|_)CLIENT_ID$/,
];

const PROXYABLE_NAME_PATTERNS = [
  /(?:^|_)API_KEY$/,
  /(?:^|_)ACCESS_TOKEN$/,
  /(?:^|_)AUTH_TOKEN$/,
  /(?:^|_)BEARER_TOKEN$/,
  /(?:^|_)SERVICE_TOKEN$/,
  /(?:^|_)PRIVATE_TOKEN$/,
  /(?:^|_)TOKEN$/,
];

const VAULT_SECRET_NAME_PATTERNS = [
  /^DATABASE_URL$/,
  /^POSTGRES(?:QL)?_URL$/,
  /^POSTGRES_PRISMA_URL$/,
  /^MYSQL_URL$/,
  /^MARIADB_URL$/,
  /^MONGODB_URI$/,
  /^MONGO_URI$/,
  /^REDIS_URL$/,
  /^UPSTASH_REDIS_REST_TOKEN$/,
  /^JWT_SECRET$/,
  /^SESSION_SECRET$/,
  /^AUTH_SECRET$/,
  /^NEXTAUTH_SECRET$/,
  /^ENCRYPTION_KEY$/,
  /^SIGNING_KEY$/,
  /(?:^|_)DATABASE_URL$/,
  /(?:^|_)DB_URL$/,
  /(?:^|_)POSTGRES(?:QL)?_URL$/,
  /(?:^|_)MYSQL_URL$/,
  /(?:^|_)MONGODB_URI$/,
  /(?:^|_)MONGO_URI$/,
  /(?:^|_)REDIS_URL$/,
  /(?:^|_)JWT_SECRET$/,
  /(?:^|_)SESSION_SECRET$/,
  /(?:^|_)AUTH_SECRET$/,
  /(?:^|_)COOKIE_SECRET$/,
  /(?:^|_)CSRF_SECRET$/,
  /(?:^|_)WEBHOOK_SECRET$/,
  /(?:^|_)SIGNING_SECRET$/,
  /(?:^|_)CLIENT_SECRET$/,
  /(?:^|_)ENCRYPTION_KEY$/,
  /(?:^|_)SIGNING_KEY$/,
  /(?:^|_)PRIVATE_KEY$/,
  /(?:^|_)SECRET$/,
];

const NON_SECRET_VALUES = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'development',
  'production',
  'staging',
  'test',
]);

export interface EnvEntryLike {
  name: string;
  value: string;
}

export interface VaultSecretEntry {
  file: string;
  line: number;
  name: string;
  value: string;
}

export interface VaultSecretRewriteOptions {
  projectId: string;
}

export function isVaultSecretProviderId(provider: string): boolean {
  return provider.startsWith(VAULT_SECRET_PROVIDER_PREFIX);
}

export function isVaultSecretPlaceholder(value: string): boolean {
  return value.trim().startsWith(PLACEHOLDER_PREFIX);
}

export function vaultSecretPlaceholder(envVar: string): string {
  return `${PLACEHOLDER_PREFIX}${envVar}`;
}

export function isLikelyVaultSecretEntry(entry: EnvEntryLike): boolean {
  const name = entry.name.toUpperCase();
  const value = entry.value.trim();

  if (!value || value.length < 8) return false;
  if (isVaultSecretPlaceholder(value)) return false;
  if (value.startsWith('vp-proj-')) return false;
  if (name.startsWith('VAULTPROOF_')) return false;
  if (NON_SECRET_VALUES.has(value.toLowerCase())) return false;

  const isVaultName = VAULT_SECRET_NAME_PATTERNS.some((pattern) => pattern.test(name));
  if (!isVaultName) return false;
  if (PUBLIC_NAME_PATTERNS.some((pattern) => pattern.test(name))) return false;

  // Let proxy/custom flows own obvious outbound API tokens. A few well-known
  // runtime secrets, like Redis REST tokens, are intentionally allowed above.
  if (
    PROXYABLE_NAME_PATTERNS.some((pattern) => pattern.test(name))
    && name !== 'UPSTASH_REDIS_REST_TOKEN'
  ) {
    return false;
  }

  return true;
}

export function deriveVaultSecretProviderId(envVar: string): string {
  const slug = envVar
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '') || 'secret';
  const hash = stableHash(envVar).slice(0, 6);
  const maxSlugLength = MAX_PROVIDER_ID_LENGTH - VAULT_SECRET_PROVIDER_PREFIX.length - hash.length - 1;
  return `${VAULT_SECRET_PROVIDER_PREFIX}${slug.slice(0, maxSlugLength).replace(/-+$/u, '')}-${hash}`;
}

export function formatDotEnvValue(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/u.test(value)) return value;
  return JSON.stringify(value);
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(6, '0');
}
