/**
 * Shamir Secret Sharing over GF(256)
 *
 * Splits a secret (arbitrary byte array) into n shares where any k shares
 * can reconstruct the original. Each byte of the secret is independently
 * shared using polynomial interpolation over GF(256).
 *
 * For VaultProof:
 * - Solo users: 2-of-2 (vault + device)
 * - Teams: 2-of-n (vault + any team member)
 */

import { randomBytes } from 'crypto';

// GF(256) arithmetic using AES irreducible polynomial x^8 + x^4 + x^3 + x + 1
const EXP_TABLE = new Uint8Array(512);
const LOG_TABLE = new Uint8Array(256);

// Initialize lookup tables for GF(256)
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP_TABLE[i] = x;
    LOG_TABLE[x] = i;
    x = x ^ (x << 1) ^ (x >= 128 ? 0x11b : 0);
    x &= 0xff;
  }
  for (let i = 255; i < 512; i++) {
    EXP_TABLE[i] = EXP_TABLE[i - 255];
  }
})();

function gf256Add(a: number, b: number): number {
  return a ^ b;
}

function gf256Mul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP_TABLE[LOG_TABLE[a] + LOG_TABLE[b]];
}

function gf256Div(a: number, b: number): number {
  if (b === 0) throw new Error('Division by zero in GF(256)');
  if (a === 0) return 0;
  return EXP_TABLE[(LOG_TABLE[a] + 255 - LOG_TABLE[b]) % 255];
}

/** Evaluate polynomial at point x in GF(256) */
function evalPoly(coeffs: Uint8Array, x: number): number {
  let result = 0;
  for (let i = coeffs.length - 1; i >= 0; i--) {
    result = gf256Add(gf256Mul(result, x), coeffs[i]);
  }
  return result;
}

export interface Share {
  /** Share index (1-based, never 0) */
  x: number;
  /** Share data — same length as the original secret */
  y: Uint8Array;
}

/**
 * Split a secret into n shares requiring k to reconstruct.
 *
 * @param secret - The secret bytes to split (e.g., an API key encoded as UTF-8)
 * @param n - Total number of shares to generate (2-255)
 * @param k - Minimum shares needed to reconstruct (2-n)
 * @returns Array of n shares
 */
export function split(secret: Uint8Array, n: number, k: number): Share[] {
  if (k < 2) throw new Error('Threshold k must be >= 2');
  if (n < k) throw new Error('Total shares n must be >= threshold k');
  if (n > 255) throw new Error('Maximum 255 shares');
  if (secret.length === 0) throw new Error('Secret must not be empty');

  const shares: Share[] = Array.from({ length: n }, (_, i) => ({
    x: i + 1,
    y: new Uint8Array(secret.length),
  }));

  // For each byte of the secret, create a random polynomial of degree k-1
  // where the constant term is the secret byte
  for (let byteIdx = 0; byteIdx < secret.length; byteIdx++) {
    const coeffs = new Uint8Array(k);
    coeffs[0] = secret[byteIdx]; // constant term = secret byte

    // Random coefficients for higher-degree terms
    const rand = randomBytes(k - 1);
    for (let i = 1; i < k; i++) {
      coeffs[i] = rand[i - 1];
    }

    // Evaluate polynomial at each share's x value
    for (let i = 0; i < n; i++) {
      shares[i].y[byteIdx] = evalPoly(coeffs, shares[i].x);
    }
  }

  return shares;
}

/**
 * Reconstruct a secret from k or more shares using Lagrange interpolation.
 *
 * @param shares - Array of k or more shares
 * @returns The reconstructed secret bytes
 */
export function combine(shares: Share[]): Uint8Array {
  if (shares.length < 2) throw new Error('Need at least 2 shares to reconstruct');

  const secretLen = shares[0].y.length;
  if (!shares.every((s) => s.y.length === secretLen)) {
    throw new Error('All shares must have the same length');
  }

  const secret = new Uint8Array(secretLen);

  for (let byteIdx = 0; byteIdx < secretLen; byteIdx++) {
    // Lagrange interpolation at x=0 to recover the constant term
    let value = 0;

    for (let i = 0; i < shares.length; i++) {
      let basis = 1; // Lagrange basis polynomial evaluated at x=0

      for (let j = 0; j < shares.length; j++) {
        if (i === j) continue;
        // basis *= (0 - x_j) / (x_i - x_j)
        //        = x_j / (x_i ^ x_j)  [in GF(256), subtraction = XOR = addition]
        basis = gf256Mul(
          basis,
          gf256Div(shares[j].x, gf256Add(shares[i].x, shares[j].x))
        );
      }

      value = gf256Add(value, gf256Mul(shares[i].y[byteIdx], basis));
    }

    secret[byteIdx] = value;
  }

  return secret;
}

// --- Convenience helpers ---

/** Split a UTF-8 string secret (e.g., an API key) */
export function splitString(secret: string, n: number, k: number): Share[] {
  return split(new TextEncoder().encode(secret), n, k);
}

/** Reconstruct and return as UTF-8 string */
export function combineToString(shares: Share[]): string {
  return new TextDecoder().decode(combine(shares));
}

/** Serialize a share to a base64 string for storage/transport */
export function serializeShare(share: Share): string {
  const buf = new Uint8Array(1 + share.y.length);
  buf[0] = share.x;
  buf.set(share.y, 1);
  return Buffer.from(buf).toString('base64');
}

/** Deserialize a share from a base64 string */
export function deserializeShare(encoded: string): Share {
  const buf = Buffer.from(encoded, 'base64');
  return {
    x: buf[0],
    y: new Uint8Array(buf.slice(1)),
  };
}
