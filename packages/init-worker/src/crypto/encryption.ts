/**
 * Share 1 encryption at rest.
 *
 * New ciphertexts use the HKDF-based fast format (v0x02) which runs in
 * ~1-2ms. Legacy ciphertexts produced by scrypt-based encrypt() still
 * decrypt cleanly via the scryptDecrypt fallback — this keeps forward
 * compatibility with any data that predates the migration.
 *
 * See fast-crypt.ts for the threat-model discussion on why scrypt was
 * unnecessary for a 32-byte high-entropy master key.
 */
import { scryptSync, createDecipheriv } from 'node:crypto';
import { encryptFast, decryptFast, isFastCiphertext } from './fast-crypt.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SALT_LENGTH = 16;

function getMasterKey(env: { VAULT_ENCRYPTION_KEY: string }): Buffer {
  const key = env.VAULT_ENCRYPTION_KEY;
  if (!key) throw new Error('VAULT_ENCRYPTION_KEY not set');
  if (key.length === 64) return Buffer.from(key, 'hex');
  return Buffer.from(key, 'base64');
}

/** Encrypt: always uses the fast format for new data. */
export function encrypt(plaintext: Uint8Array, env: { VAULT_ENCRYPTION_KEY: string }): Uint8Array {
  return encryptFast(plaintext, env);
}

/** Decrypt: branches on the version byte. Fast path first. */
export function decrypt(data: Uint8Array, env: { VAULT_ENCRYPTION_KEY: string }): Uint8Array {
  if (isFastCiphertext(data)) {
    return decryptFast(data, env);
  }
  return scryptDecryptLegacy(data, env);
}

/**
 * Legacy scrypt-based decrypt. Kept for backward compatibility with
 * ciphertexts produced before the fast-crypt migration. The new init
 * system has no such ciphertexts (table was empty before this change),
 * so this path is cold.
 */
function scryptDecryptLegacy(data: Uint8Array, env: { VAULT_ENCRYPTION_KEY: string }): Uint8Array {
  if (data.length < SALT_LENGTH + IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error('Invalid encrypted data: too short');
  }
  const masterKey = getMasterKey(env);
  const buf = Buffer.from(data);
  const salt = buf.subarray(0, SALT_LENGTH);
  const iv = buf.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = buf.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const ciphertext = buf.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const derivedKey = scryptSync(masterKey, salt, 32);
  const decipher = createDecipheriv(ALGORITHM, derivedKey, iv);
  decipher.setAuthTag(tag);
  return new Uint8Array(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
}

export function zeroUint8Array(arr: Uint8Array): void {
  arr.fill(0);
}
