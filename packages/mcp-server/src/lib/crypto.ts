/**
 * Cryptographic primitives for the MCP server.
 *
 * All operations use the Web Crypto API (crypto.subtle) which is available
 * natively in Cloudflare Workers — no Node.js imports needed.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Convert a Uint8Array to a lowercase hex string. */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Convert a hex string to a Uint8Array. Throws on invalid input. */
function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex string: odd length');
  if (!/^[0-9a-fA-F]*$/.test(hex)) throw new Error('Invalid hex string: non-hex characters');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/** Convert a Uint8Array to a BASE64URL string (no padding). */
function toBase64Url(bytes: Uint8Array): string {
  // Loop instead of spread to avoid hitting the V8 argument count limit on large inputs
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Generate a cryptographically random 32-byte opaque token.
 * Returns a 64-character lowercase hex string.
 */
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

/**
 * Compute the SHA-256 hash of a UTF-8 string.
 * Returns a 64-character lowercase hex string.
 */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return toHex(new Uint8Array(digest));
}

/**
 * Sign a payload with HMAC-SHA256 using a UTF-8 secret.
 * Returns a 64-character lowercase hex string.
 * Used for signing backend proxy requests.
 */
export async function hmacSign(payload: string, secret: string): Promise<string> {
  if (!secret) throw new Error('HMAC secret must not be empty');
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return toHex(new Uint8Array(sig));
}

/**
 * Compute the PKCE S256 code challenge from a verifier string.
 * Returns BASE64URL(SHA-256(verifier)) — no padding.
 * Per RFC 7636 §4.2.
 */
export async function generatePkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(verifier));
  return toBase64Url(new Uint8Array(digest));
}

/**
 * Constant-time string comparison using XOR over bytes.
 * Prevents timing attacks when comparing secrets or signatures.
 * Returns true only if both strings are identical.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const bytesA = enc.encode(a);
  const bytesB = enc.encode(b);
  // Always iterate over the longer length to avoid short-circuit leaks
  const len = Math.max(bytesA.length, bytesB.length);
  let diff = bytesA.length ^ bytesB.length; // non-zero if lengths differ
  for (let i = 0; i < len; i++) {
    diff |= (bytesA[i] ?? 0) ^ (bytesB[i] ?? 0);
  }
  return diff === 0;
}

/**
 * Encrypt a plaintext string with AES-256-GCM.
 *
 * @param plaintext - UTF-8 string to encrypt
 * @param keyHex    - 64-character hex string (32 bytes)
 * @returns Base64 string of [12-byte IV || ciphertext+tag]
 */
export async function encryptAesGcm(plaintext: string, keyHex: string): Promise<string> {
  const rawKey = fromHex(keyHex);
  if (rawKey.length !== 32) throw new Error('AES-GCM key must be 32 bytes (64 hex chars)');

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);

  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    enc.encode(plaintext)
  );

  // Prepend IV to ciphertext for storage
  const combined = new Uint8Array(iv.byteLength + cipherBuf.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuf), iv.byteLength);

  // Loop instead of spread — same guard as toBase64Url (avoids V8 argument count limit)
  let binary = '';
  for (let i = 0; i < combined.length; i++) binary += String.fromCharCode(combined[i]!);
  return btoa(binary);
}

/**
 * Decrypt an AES-256-GCM ciphertext produced by encryptAesGcm.
 *
 * @param ciphertext - Base64 string of [12-byte IV || ciphertext+tag]
 * @param keyHex     - 64-character hex string (32 bytes)
 * @returns Decrypted plaintext string
 */
export async function decryptAesGcm(ciphertext: string, keyHex: string): Promise<string> {
  const rawKey = fromHex(keyHex);
  if (rawKey.length !== 32) throw new Error('AES-GCM key must be 32 bytes (64 hex chars)');

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  const combined = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
  if (combined.length < 12) throw new Error('Ciphertext too short');

  const iv = combined.slice(0, 12);
  const data = combined.slice(12);

  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    data
  );

  return dec.decode(plainBuf);
}
