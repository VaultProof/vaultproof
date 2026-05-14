import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { combineToString, deserializeShare, serializeShare, splitString } from '@vaultproof/shamir';

export const SHARE1_PURPOSE = 'vaultproof-enterprise-share1-v1';
export const SHARE2_PURPOSE = 'vaultproof-enterprise-share2-v1';

const VERSION_FAST = 0x02;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SALT_LENGTH = 16;
const VERSION_LENGTH = 1;
const ALGORITHM = 'aes-256-gcm';

function hkdfSha256(masterKey, salt, purpose) {
  const prk = createHmac('sha256', salt).update(masterKey).digest();
  const info = Buffer.from(purpose, 'utf8');
  return createHmac('sha256', prk).update(info).update(Buffer.from([0x01])).digest();
}

export function getVaultUnwrapKeyBytes(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    throw new Error('Vault unwrap key material is required.');
  }

  if (/^[a-f0-9]{64}$/i.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  const base64Decoded = Buffer.from(trimmed, 'base64');
  if (base64Decoded.length === 32) {
    return base64Decoded;
  }

  const utf8Decoded = Buffer.from(trimmed, 'utf8');
  if (utf8Decoded.length === 32) {
    return utf8Decoded;
  }

  throw new Error('Vault unwrap key must decode to exactly 32 bytes.');
}

export function encryptSerializedShare(serializedShare, vaultUnwrapKey, purpose) {
  const plaintext = Buffer.from(serializedShare, 'base64');
  const masterKey = getVaultUnwrapKeyBytes(vaultUnwrapKey);
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const derivedKey = hkdfSha256(masterKey, salt, purpose);
  const cipher = createCipheriv(ALGORITHM, derivedKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([VERSION_FAST]), salt, iv, tag, encrypted]).toString('base64');
}

export function decryptSerializedShare(encryptedShare, vaultUnwrapKey, purpose) {
  const data = Buffer.from(String(encryptedShare || ''), 'base64');
  const minLen = VERSION_LENGTH + SALT_LENGTH + IV_LENGTH + TAG_LENGTH + 1;
  if (data.length < minLen) {
    throw new Error('Invalid encrypted share: too short.');
  }
  if (data[0] !== VERSION_FAST) {
    throw new Error('Unsupported encrypted share format.');
  }

  const masterKey = getVaultUnwrapKeyBytes(vaultUnwrapKey);
  const salt = data.subarray(VERSION_LENGTH, VERSION_LENGTH + SALT_LENGTH);
  const iv = data.subarray(VERSION_LENGTH + SALT_LENGTH, VERSION_LENGTH + SALT_LENGTH + IV_LENGTH);
  const tag = data.subarray(
    VERSION_LENGTH + SALT_LENGTH + IV_LENGTH,
    VERSION_LENGTH + SALT_LENGTH + IV_LENGTH + TAG_LENGTH,
  );
  const ciphertext = data.subarray(VERSION_LENGTH + SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const derivedKey = hkdfSha256(masterKey, salt, purpose);
  const decipher = createDecipheriv(ALGORITHM, derivedKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('base64');
}

export function sealProviderApiKey(apiKey, vaultUnwrapKey) {
  const key = String(apiKey || '').trim();
  if (!key) {
    throw new Error('Provider API key is required.');
  }
  if (key.length > 20000) {
    throw new Error('Provider API key is unexpectedly long.');
  }

  const shares = splitString(key, 2, 2).map((share) => serializeShare(share));
  const share1Encrypted = encryptSerializedShare(shares[0], vaultUnwrapKey, SHARE1_PURPOSE);
  const share2Encrypted = encryptSerializedShare(shares[1], vaultUnwrapKey, SHARE2_PURPOSE);

  return {
    share1_encrypted: share1Encrypted,
    share2_encrypted: share2Encrypted,
    fingerprint: fingerprintSealedShares(share1Encrypted, share2Encrypted),
    share_lengths: {
      share1_encrypted: share1Encrypted.length,
      share2_encrypted: share2Encrypted.length,
    },
  };
}

export function verifySealedProviderApiKey(apiKey, vaultUnwrapKey, material) {
  const share1 = deserializeShare(
    decryptSerializedShare(material.share1_encrypted, vaultUnwrapKey, SHARE1_PURPOSE),
  );
  const share2 = deserializeShare(
    decryptSerializedShare(material.share2_encrypted, vaultUnwrapKey, SHARE2_PURPOSE),
  );
  return combineToString([share1, share2]) === String(apiKey || '').trim();
}

export function fingerprintSealedShares(share1Encrypted, share2Encrypted) {
  return createHash('sha256')
    .update(String(share1Encrypted || ''))
    .update('\n')
    .update(String(share2Encrypted || ''))
    .digest('hex')
    .slice(0, 16);
}

export function normalizeProviderSlug(raw, field = 'provider') {
  const value = String(raw || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value)) {
    throw new Error(`${field} must use lowercase letters, numbers, hyphens, or underscores.`);
  }
  return value;
}

function isPrivateIpv4(hostname) {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const parts = match.slice(1).map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || a === 0;
}

export function normalizeUpstreamBaseUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) throw new Error('UPSTREAM_BASE_URL is required.');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('UPSTREAM_BASE_URL must be a valid URL.');
  }
  if (url.protocol !== 'https:') throw new Error('UPSTREAM_BASE_URL must use https.');
  if (url.username || url.password) throw new Error('UPSTREAM_BASE_URL cannot include credentials.');
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.local') || isPrivateIpv4(hostname)) {
    throw new Error('UPSTREAM_BASE_URL must point to a public provider host.');
  }
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

export function normalizeHeaderName(raw, field = 'AUTH_HEADER_NAME') {
  const value = String(raw || '').trim().toLowerCase();
  if (!/^[!#$%&'*+\-.^_`|~0-9a-z]+$/.test(value)) {
    throw new Error(`${field} must be a valid HTTP header name.`);
  }
  return value;
}

export function normalizeAuthHeaderTemplate(raw) {
  const value = String(raw || '').trim();
  if (!value || value.length > 300) throw new Error('AUTH_HEADER_TEMPLATE is required.');
  if (!value.includes('{key}')) throw new Error('AUTH_HEADER_TEMPLATE must include {key}.');
  if (/[\r\n]/.test(value)) throw new Error('AUTH_HEADER_TEMPLATE cannot contain line breaks.');
  return value;
}

function extraHeaderValueLooksLikeSecret(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed || trimmed.includes('{key}')) return false;
  if (/^(bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{16,}$/i.test(trimmed)) return true;
  if (/(?:sk-[A-Za-z0-9]|ghp_|github_pat_|xox[abprs]-|SG\.|re_[A-Za-z0-9]|glpat-|hf_|pcsk_|xkeysib-|secret_|ntn_|api[_-]?key|client[_-]?secret)/i.test(trimmed)) {
    return true;
  }
  return /^[A-Za-z0-9._~+/=-]{48,}$/.test(trimmed);
}

export function normalizeExtraHeaders(raw) {
  if (raw === undefined || raw === null || raw === '') return {};
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('EXTRA_HEADERS_JSON must be a JSON object.');
  }

  const normalized = {};
  for (const [nameRaw, valueRaw] of Object.entries(parsed)) {
    const name = normalizeHeaderName(nameRaw, 'EXTRA_HEADERS_JSON header');
    if (name === 'authorization' || name === 'proxy-authorization') {
      throw new Error('EXTRA_HEADERS_JSON cannot override authorization headers.');
    }
    if (typeof valueRaw !== 'string' || valueRaw.length > 500 || /[\r\n]/.test(valueRaw)) {
      throw new Error(`EXTRA_HEADERS_JSON.${name} must be a short string without line breaks.`);
    }
    if (extraHeaderValueLooksLikeSecret(valueRaw)) {
      throw new Error(`EXTRA_HEADERS_JSON.${name} must not contain raw secrets; use {key} for the protected provider key or store only non-secret fixed headers.`);
    }
    normalized[name] = valueRaw;
  }
  return normalized;
}
