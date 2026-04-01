const ALGORITHM = 'AES-GCM';
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const PBKDF2_ITERATIONS = 100000;

async function deriveKeyFromVpKey(vpKey: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', encoder.encode(vpKey), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: ALGORITHM, length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptShare2(share2: string, vpKey: string): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const derivedKey = await deriveKeyFromVpKey(vpKey, salt);
  const encoder = new TextEncoder();
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: ALGORITHM, iv }, derivedKey, encoder.encode(share2)));
  const result = new Uint8Array(SALT_LENGTH + IV_LENGTH + encrypted.length);
  result.set(salt, 0);
  result.set(iv, SALT_LENGTH);
  result.set(encrypted, SALT_LENGTH + IV_LENGTH);
  return result;
}

export async function decryptShare2(data: Uint8Array, vpKey: string): Promise<string> {
  const salt = data.slice(0, SALT_LENGTH);
  const iv = data.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = data.slice(SALT_LENGTH + IV_LENGTH);
  const derivedKey = await deriveKeyFromVpKey(vpKey, salt);
  const decrypted = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, derivedKey, ciphertext);
  return new TextDecoder().decode(decrypted);
}

// Legacy scrypt decryption for existing Share 2 data.
// Uses node:crypto compat layer (requires nodejs_compat flag in wrangler.toml).
// The old format is: salt (16) + iv (12) + tag (16) + ciphertext
import { scryptSync, createDecipheriv } from 'node:crypto';

export function decryptShare2Legacy(data: Uint8Array, vpKey: string): string {
  const TAG_LENGTH = 16;
  if (data.length < SALT_LENGTH + IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error('Invalid encrypted Share 2: too short');
  }
  const buf = Buffer.from(data);
  const salt = buf.subarray(0, SALT_LENGTH);
  const iv = buf.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = buf.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const ciphertext = buf.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const derivedKey = scryptSync(vpKey, salt, 32);
  const decipher = createDecipheriv('aes-256-gcm', derivedKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
}
