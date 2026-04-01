const ALGORITHM = 'AES-GCM';
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const PBKDF2_ITERATIONS = 100000;

function getMasterKey(env: { VAULT_ENCRYPTION_KEY: string }): Uint8Array {
  const key = env.VAULT_ENCRYPTION_KEY;
  if (!key) throw new Error('VAULT_ENCRYPTION_KEY not set');
  if (key.length === 64) {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 64; i += 2) {
      bytes[i / 2] = parseInt(key.substring(i, i + 2), 16);
    }
    return bytes;
  }
  const binary = atob(key);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(masterKey: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey('raw', masterKey, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: ALGORITHM, length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encrypt(plaintext: Uint8Array, env: { VAULT_ENCRYPTION_KEY: string }): Promise<Uint8Array> {
  const masterKey = getMasterKey(env);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const derivedKey = await deriveKey(masterKey, salt);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: ALGORITHM, iv }, derivedKey, plaintext));
  const result = new Uint8Array(SALT_LENGTH + IV_LENGTH + encrypted.length);
  result.set(salt, 0);
  result.set(iv, SALT_LENGTH);
  result.set(encrypted, SALT_LENGTH + IV_LENGTH);
  return result;
}

export async function decrypt(data: Uint8Array, env: { VAULT_ENCRYPTION_KEY: string }): Promise<Uint8Array> {
  const masterKey = getMasterKey(env);
  const salt = data.slice(0, SALT_LENGTH);
  const iv = data.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = data.slice(SALT_LENGTH + IV_LENGTH);
  const derivedKey = await deriveKey(masterKey, salt);
  const decrypted = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, derivedKey, ciphertext);
  return new Uint8Array(decrypted);
}

export function zeroUint8Array(arr: Uint8Array): void {
  arr.fill(0);
}
