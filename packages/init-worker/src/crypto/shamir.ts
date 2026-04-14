/**
 * Shamir Secret Sharing — GF(256) reconstruction only.
 *
 * Matches the serialization format of @vaultproof/shamir:
 *   serializeShare: base64([x_byte, ...y_bytes])
 *
 * Used by the init-worker to combine Share 1 (decrypted with VAULT_ENCRYPTION_KEY)
 * and Share 2 (stored as-is, split client-side by @vaultproof/init) into the
 * full API key for the proxy call window.
 */

export interface Share {
  x: number;
  y: Uint8Array;
}

export function deserializeShare(base64: string): Share {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { x: bytes[0], y: bytes.slice(1) };
}

export function combineShares(shares: Share[]): Uint8Array {
  if (shares.length < 2) throw new Error('Need at least 2 shares');

  // Validate: no x=0 (reserved/degenerate) and no duplicate x values
  const xSeen = new Set<number>();
  for (const share of shares) {
    if (share.x === 0) throw new Error('Invalid share: x=0 is not a valid share index');
    if (xSeen.has(share.x)) throw new Error(`Invalid share: duplicate x value ${share.x}`);
    xSeen.add(share.x);
  }

  const len = shares[0].y.length;

  // Validate: all shares must have the same y length
  for (let i = 1; i < shares.length; i++) {
    if (shares[i].y.length !== len) {
      throw new Error(`Invalid share: y length mismatch (expected ${len}, got ${shares[i].y.length})`);
    }
  }

  const result = new Uint8Array(len);

  for (let i = 0; i < len; i++) {
    let value = 0;
    for (let j = 0; j < shares.length; j++) {
      let basis = 1;
      for (let k = 0; k < shares.length; k++) {
        if (j === k) continue;
        const num = shares[k].x;
        const den = shares[k].x ^ shares[j].x;
        basis = gf256Mul(basis, gf256Mul(num, gf256Inv(den)));
      }
      value ^= gf256Mul(shares[j].y[i], basis);
    }
    result[i] = value;
  }

  return result;
}

// GF(256) with irreducible polynomial x^8 + x^4 + x^3 + x + 1 (0x11b)
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
  let result = a;
  for (let i = 0; i < 6; i++) {
    result = gf256Mul(result, result);
    result = gf256Mul(result, a);
  }
  result = gf256Mul(result, result);
  return result;
}
