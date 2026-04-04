/**
 * Shamir Secret Sharing — GF(256) split + combine.
 *
 * Compatible with @vaultproof/shamir share format:
 * serializeShare encodes as: [x_byte, ...y_bytes] → base64
 * deserializeShare decodes: base64 → { x, y }
 */

export interface Share {
  x: number;
  y: Uint8Array;
}

export function deserializeShare(base64: string): Share {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)!;
  return { x: bytes[0]!, y: bytes.slice(1) };
}

export function serializeShare(share: Share): string {
  const buf = new Uint8Array(1 + share.y.length);
  buf[0] = share.x;
  buf.set(share.y, 1);
  // Use btoa for CF Worker compatibility (no Buffer dependency)
  let binary = '';
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]!);
  return btoa(binary);
}

/** Evaluate polynomial at point x in GF(256) */
function evalPoly(coeffs: Uint8Array, x: number): number {
  let result = 0;
  for (let i = coeffs.length - 1; i >= 0; i--) {
    result = gf256Mul(result, x) ^ coeffs[i]!;
  }
  return result;
}

/**
 * Split a secret into n shares requiring k to reconstruct.
 */
export function split(secret: Uint8Array, n: number, k: number): Share[] {
  if (typeof crypto === 'undefined' || !crypto.getRandomValues) {
    throw new Error('CSPRNG required: crypto.getRandomValues not available');
  }
  if (k < 2) throw new Error('Threshold k must be >= 2');
  if (n < k) throw new Error('Total shares n must be >= threshold k');
  if (n > 255) throw new Error('Maximum 255 shares');
  if (secret.length === 0) throw new Error('Secret must not be empty');

  const shares: Share[] = Array.from({ length: n }, (_, i) => ({
    x: i + 1,
    y: new Uint8Array(secret.length),
  }));

  for (let byteIdx = 0; byteIdx < secret.length; byteIdx++) {
    const coeffs = new Uint8Array(k);
    coeffs[0] = secret[byteIdx]!;

    // Random coefficients for higher-degree terms
    const rand = crypto.getRandomValues(new Uint8Array(k - 1));
    for (let i = 1; i < k; i++) {
      coeffs[i] = rand[i - 1]!;
    }

    for (let i = 0; i < n; i++) {
      shares[i]!.y[byteIdx] = evalPoly(coeffs, shares[i]!.x);
    }
  }

  return shares;
}

/** Split a UTF-8 string secret (e.g., an API key) into n shares requiring k */
export function splitString(secret: string, n: number, k: number): Share[] {
  return split(new TextEncoder().encode(secret), n, k);
}

export function combineShares(shares: Share[]): Uint8Array {
  if (shares.length < 2) throw new Error('Need at least 2 shares');
  const len = shares[0]!.y.length;
  const result = new Uint8Array(len);

  for (let i = 0; i < len; i++) {
    let value = 0;
    for (let j = 0; j < shares.length; j++) {
      let basis = 1;
      for (let k = 0; k < shares.length; k++) {
        if (j === k) continue;
        const num = shares[k]!.x;
        const den = shares[k]!.x ^ shares[j]!.x;
        basis = gf256Mul(basis, gf256Mul(num, gf256Inv(den)));
      }
      value ^= gf256Mul(shares[j]!.y[i]!, basis);
    }
    result[i] = value;
  }

  return result;
}

// GF(256) with irreducible polynomial x^8 + x^4 + x^3 + x + 1 (0x11b)
// Constant-time: loop-based multiplication avoids lookup tables (CVE-2023-25000 mitigation)
function gf256Mul(a: number, b: number): number {
  let result = 0;
  let aa = a;
  let bb = b;
  for (let i = 0; i < 8; i++) {
    if (bb & 1) result ^= aa;
    const hi = aa & 0x80;
    aa = (aa << 1) & 0xff;
    if (hi) aa ^= 0x1b;
    bb >>= 1;
  }
  return result;
}

function gf256Inv(a: number): number {
  if (a === 0) throw new Error('Cannot invert zero in GF(256)');
  // Fermat's little theorem: a^254 = a^(-1) in GF(256)
  let result = a;
  for (let i = 0; i < 6; i++) {
    result = gf256Mul(result, result);
    result = gf256Mul(result, a);
  }
  result = gf256Mul(result, result);
  return result;
}
