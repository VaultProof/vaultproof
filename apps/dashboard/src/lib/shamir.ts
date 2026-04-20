export interface Share {
  x: number;
  y: Uint8Array;
}

const EXP_TABLE = new Uint8Array(512);
const LOG_TABLE = new Uint8Array(256);

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

function evalPoly(coeffs: Uint8Array, x: number): number {
  let result = 0;
  for (let i = coeffs.length - 1; i >= 0; i--) {
    result = gf256Add(gf256Mul(result, x), coeffs[i]);
  }
  return result;
}

function split(secret: Uint8Array, n: number, k: number): Share[] {
  if (k < 2) throw new Error("Threshold k must be >= 2");
  if (n < k) throw new Error("Total shares n must be >= threshold k");
  if (n > 255) throw new Error("Maximum 255 shares");
  if (secret.length === 0) throw new Error("Secret must not be empty");

  const shares: Share[] = Array.from({ length: n }, (_, i) => ({
    x: i + 1,
    y: new Uint8Array(secret.length),
  }));

  for (let byteIdx = 0; byteIdx < secret.length; byteIdx++) {
    const coeffs = new Uint8Array(k);
    coeffs[0] = secret[byteIdx];

    const rand = new Uint8Array(k - 1);
    crypto.getRandomValues(rand);
    for (let i = 1; i < k; i++) {
      coeffs[i] = rand[i - 1];
    }

    for (let i = 0; i < n; i++) {
      shares[i].y[byteIdx] = evalPoly(coeffs, shares[i].x);
    }

    coeffs.fill(0);
    rand.fill(0);
  }

  return shares;
}

export function splitString(secret: string, n: number, k: number): Share[] {
  return split(new TextEncoder().encode(secret), n, k);
}

export function serializeShare(share: Share): string {
  const buf = new Uint8Array(1 + share.y.length);
  buf[0] = share.x;
  buf.set(share.y, 1);
  let binary = "";
  for (const byte of buf) binary += String.fromCharCode(byte);
  return btoa(binary);
}
