/**
 * Fast AES-256-GCM encryption for Share 1 at rest.
 *
 * Replaces scrypt-based key derivation with HKDF-SHA256. Scrypt is a
 * password KDF — it makes brute-forcing low-entropy passwords expensive.
 * Our VAULT_ENCRYPTION_KEY is already 32 bytes of high-entropy random
 * data, so scrypt added ~60-100ms of CPU per request with zero marginal
 * security. HKDF on a random 32-byte key is <1ms and cryptographically
 * appropriate.
 *
 * Ciphertext format (version byte distinguishes from legacy scrypt):
 *   [0x02][salt:16][iv:12][tag:16][ciphertext:N]
 *
 * The decrypt function in encryption.ts branches on the first byte,
 * falling back to the legacy scrypt-based decrypt for ciphertexts that
 * start with anything other than 0x02. This lets existing data keep
 * working without a re-encryption migration — though the new init
 * system has no pre-existing rows so in practice every ciphertext is
 * fast from day one.
 */
import { createCipheriv, createDecipheriv, randomBytes, createHmac } from 'node:crypto';

const VERSION_FAST = 0x02;

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;
const VERSION_LENGTH = 1;

function getMasterKey(env: { VAULT_ENCRYPTION_KEY: string }): Buffer {
  const key = env.VAULT_ENCRYPTION_KEY;
  if (!key) throw new Error('VAULT_ENCRYPTION_KEY not set');
  if (key.length === 64) return Buffer.from(key, 'hex');
  return Buffer.from(key, 'base64');
}

/**
 * HKDF-SHA256 extract-and-expand.
 * RFC 5869. Derives a fresh 32-byte key from (masterKey, salt).
 * Info is fixed to "vaultproof-init-v1" so this key is domain-separated
 * from any other use of the same master secret.
 */
function hkdfSha256(masterKey: Buffer, salt: Buffer): Buffer {
  // Extract: PRK = HMAC-SHA256(salt, IKM)
  const prk = createHmac('sha256', salt).update(masterKey).digest();

  // Expand (one block is enough for 32 bytes, since SHA256 output = 32 bytes)
  // T(1) = HMAC-SHA256(PRK, info || 0x01)
  const info = Buffer.from('vaultproof-init-v1', 'utf8');
  const t1 = createHmac('sha256', prk).update(info).update(Buffer.from([0x01])).digest();

  return t1; // 32 bytes — exactly the AES-256 key size
}

export function encryptFast(plaintext: Uint8Array, env: { VAULT_ENCRYPTION_KEY: string }): Uint8Array {
  const masterKey = getMasterKey(env);
  const salt = randomBytes(SALT_LENGTH);
  const derivedKey = hkdfSha256(masterKey, salt);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, derivedKey, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  const tag = cipher.getAuthTag();

  return new Uint8Array(
    Buffer.concat([Buffer.from([VERSION_FAST]), salt, iv, tag, encrypted]),
  );
}

export function decryptFast(data: Uint8Array, env: { VAULT_ENCRYPTION_KEY: string }): Uint8Array {
  const minLen = VERSION_LENGTH + SALT_LENGTH + IV_LENGTH + TAG_LENGTH + 1;
  if (data.length < minLen) {
    throw new Error('Invalid fast ciphertext: too short');
  }
  if (data[0] !== VERSION_FAST) {
    throw new Error('Invalid fast ciphertext: wrong version byte');
  }

  const masterKey = getMasterKey(env);
  const buf = Buffer.from(data);
  const salt = buf.subarray(VERSION_LENGTH, VERSION_LENGTH + SALT_LENGTH);
  const iv = buf.subarray(VERSION_LENGTH + SALT_LENGTH, VERSION_LENGTH + SALT_LENGTH + IV_LENGTH);
  const tag = buf.subarray(
    VERSION_LENGTH + SALT_LENGTH + IV_LENGTH,
    VERSION_LENGTH + SALT_LENGTH + IV_LENGTH + TAG_LENGTH,
  );
  const ciphertext = buf.subarray(VERSION_LENGTH + SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

  const derivedKey = hkdfSha256(masterKey, salt);
  const decipher = createDecipheriv(ALGORITHM, derivedKey, iv);
  decipher.setAuthTag(tag);
  return new Uint8Array(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
}

/** Quick check: is this ciphertext using the fast format? */
export function isFastCiphertext(data: Uint8Array): boolean {
  return data.length > 0 && data[0] === VERSION_FAST;
}
