import { createDecipheriv, createHmac } from 'node:crypto';

const VERSION_FAST = 0x02;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SALT_LENGTH = 16;
const VERSION_LENGTH = 1;
const ALGORITHM = 'aes-256-gcm';

export interface Share {
  x: number;
  y: Uint8Array;
}

function getMasterKey(vaultEncryptionKey: string): Buffer {
  if (!vaultEncryptionKey) throw new Error('VAULT_ENCRYPTION_KEY not set');
  if (vaultEncryptionKey.length === 64) return Buffer.from(vaultEncryptionKey, 'hex');
  return Buffer.from(vaultEncryptionKey, 'base64');
}

function hkdfSha256(masterKey: Buffer, salt: Buffer, purpose: string): Buffer {
  const prk = createHmac('sha256', salt).update(masterKey).digest();
  const info = Buffer.from(purpose, 'utf8');
  return createHmac('sha256', prk).update(info).update(Buffer.from([0x01])).digest();
}

function decryptEncryptedShare(data: Uint8Array, vaultEncryptionKey: string, purpose: string): Uint8Array {
  const minLen = VERSION_LENGTH + SALT_LENGTH + IV_LENGTH + TAG_LENGTH + 1;
  if (data.length < minLen) {
    throw new Error('Invalid encrypted share: too short');
  }
  if (data[0] !== VERSION_FAST) {
    throw new Error('Unsupported encrypted share format');
  }

  const masterKey = getMasterKey(vaultEncryptionKey);
  const buf = Buffer.from(data);
  const salt = buf.subarray(VERSION_LENGTH, VERSION_LENGTH + SALT_LENGTH);
  const iv = buf.subarray(VERSION_LENGTH + SALT_LENGTH, VERSION_LENGTH + SALT_LENGTH + IV_LENGTH);
  const tag = buf.subarray(
    VERSION_LENGTH + SALT_LENGTH + IV_LENGTH,
    VERSION_LENGTH + SALT_LENGTH + IV_LENGTH + TAG_LENGTH,
  );
  const ciphertext = buf.subarray(VERSION_LENGTH + SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

  const derivedKey = hkdfSha256(masterKey, salt, purpose);
  const decipher = createDecipheriv(ALGORITHM, derivedKey, iv);
  decipher.setAuthTag(tag);
  return new Uint8Array(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
}

export function decryptShare1(data: Uint8Array, vaultEncryptionKey: string): Uint8Array {
  try {
    return decryptEncryptedShare(data, vaultEncryptionKey, 'vaultproof-enterprise-share1-v1');
  } catch {
    return decryptEncryptedShare(data, vaultEncryptionKey, 'vaultproof-init-v1');
  }
}

export function decryptShare2(data: Uint8Array, vaultEncryptionKey: string): Uint8Array {
  return decryptEncryptedShare(data, vaultEncryptionKey, 'vaultproof-enterprise-share2-v1');
}

export function deserializeShare(base64: string): Share {
  const bytes = new Uint8Array(Buffer.from(base64, 'base64'));
  return { x: bytes[0], y: bytes.slice(1) };
}

export function combineShares(shares: Share[]): Uint8Array {
  if (shares.length < 2) throw new Error('Need at least 2 shares');

  const xSeen = new Set<number>();
  for (const share of shares) {
    if (share.x === 0) throw new Error('Invalid share: x=0 is not a valid share index');
    if (xSeen.has(share.x)) throw new Error(`Invalid share: duplicate x value ${share.x}`);
    xSeen.add(share.x);
  }

  const len = shares[0].y.length;
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

export function zeroUint8Array(arr: Uint8Array): void {
  arr.fill(0);
}

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
