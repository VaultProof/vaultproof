/**
 * Share 2 Encryption — Encrypted with key derived from developer's vp_live_ key.
 *
 * Different from Share 1 encryption (which uses VAULT_ENCRYPTION_KEY).
 * This ensures Share 2 can only be decrypted by someone who has the vp_live_ key.
 * The server stores the hash of vp_live_, not the key itself, so the server
 * alone cannot decrypt Share 2 at rest.
 *
 * To decrypt Share 2, the developer must present their vp_live_ key at call time.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SALT_LENGTH = 16;

/**
 * Derive an encryption key from the developer's vp_live_ API key.
 * Uses scrypt with a salt for key derivation.
 */
function deriveKey(vpKey: string, salt: Buffer): Buffer {
  return scryptSync(vpKey, salt, 32) as Buffer;
}

/**
 * Encrypt Share 2 using a key derived from the developer's vp_live_ key.
 * Output: salt (16) + iv (12) + tag (16) + ciphertext
 */
export function encryptShare2(share2: string, vpKey: string): Buffer {
  const salt = randomBytes(SALT_LENGTH);
  const derivedKey = deriveKey(vpKey, salt);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, derivedKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(share2, 'utf-8')),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([salt, iv, tag, encrypted]);
}

/**
 * Decrypt Share 2 using the developer's vp_live_ key.
 * Input: salt (16) + iv (12) + tag (16) + ciphertext
 */
export function decryptShare2(data: Buffer, vpKey: string): string {
  if (data.length < SALT_LENGTH + IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error('Invalid encrypted Share 2: too short');
  }

  const salt = data.subarray(0, SALT_LENGTH);
  const iv = data.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = data.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

  const derivedKey = deriveKey(vpKey, Buffer.from(salt));
  const decipher = createDecipheriv(ALGORITHM, derivedKey, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf-8');
}
