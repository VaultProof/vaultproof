/**
 * AES-256-GCM encryption for Share 1 at rest.
 * Uses scrypt via nodejs_compat — identical to the original Node.js backend.
 * No migration needed.
 */
import { scryptSync, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

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

export function encrypt(plaintext: Uint8Array, env: { VAULT_ENCRYPTION_KEY: string }): Uint8Array {
  const masterKey = getMasterKey(env);
  const salt = randomBytes(SALT_LENGTH);
  const derivedKey = scryptSync(masterKey, salt, 32);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, derivedKey, iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return new Uint8Array(Buffer.concat([salt, iv, tag, encrypted]));
}

export function decrypt(data: Uint8Array, env: { VAULT_ENCRYPTION_KEY: string }): Uint8Array {
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
