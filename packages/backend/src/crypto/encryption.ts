/**
 * AES-256-GCM encryption for Share 1 at rest.
 *
 * Share 1 is encrypted before storage and decrypted only during
 * ephemeral reconstruction. The encryption key is derived from
 * VAULT_ENCRYPTION_KEY env var (32 bytes hex or base64).
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM standard
const TAG_LENGTH = 16; // GCM auth tag
const SALT_LENGTH = 16;

function getMasterKey(): Buffer {
  const envKey = process.env.VAULT_ENCRYPTION_KEY;
  if (!envKey) {
    throw new Error(
      'VAULT_ENCRYPTION_KEY not set. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  // Accept hex (64 chars) or base64 (44 chars)
  if (envKey.length === 64) return Buffer.from(envKey, 'hex');
  return Buffer.from(envKey, 'base64');
}

/**
 * Encrypt data using AES-256-GCM with a random IV and salt-derived key.
 * Output format: salt (16) + iv (12) + tag (16) + ciphertext
 */
export function encrypt(plaintext: Buffer): Buffer {
  const masterKey = getMasterKey();
  const salt = randomBytes(SALT_LENGTH);
  const derivedKey = scryptSync(masterKey, salt, 32);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, derivedKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  // salt + iv + tag + ciphertext
  return Buffer.concat([salt, iv, tag, encrypted]);
}

/**
 * Decrypt AES-256-GCM encrypted data.
 * Input format: salt (16) + iv (12) + tag (16) + ciphertext
 */
export function decrypt(data: Buffer): Buffer {
  if (data.length < SALT_LENGTH + IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error('Invalid encrypted data: too short');
  }

  const masterKey = getMasterKey();
  const salt = data.subarray(0, SALT_LENGTH);
  const iv = data.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = data.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

  const derivedKey = scryptSync(masterKey, salt, 32);
  const decipher = createDecipheriv(ALGORITHM, derivedKey, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted;
}

/**
 * Zero a buffer's contents (best-effort memory zeroing).
 */
export function zeroBuffer(buf: Buffer): void {
  buf.fill(0);
}
