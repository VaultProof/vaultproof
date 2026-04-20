/**
 * Share 1 encryption at rest.
 *
 * The init worker stores Share 1 using the HKDF-based fast format.
 */
import { encryptFast, decryptFast } from './fast-crypt.js';

/** Encrypt: always uses the fast format for new data. */
export function encrypt(plaintext: Uint8Array, env: { VAULT_ENCRYPTION_KEY: string }): Uint8Array {
  return encryptFast(plaintext, env);
}

/** Decrypt: Share 1 is always stored in the fast format. */
export function decrypt(data: Uint8Array, env: { VAULT_ENCRYPTION_KEY: string }): Uint8Array {
  return decryptFast(data, env);
}

export function zeroUint8Array(arr: Uint8Array): void {
  arr.fill(0);
}
