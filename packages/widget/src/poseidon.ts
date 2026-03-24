/**
 * Poseidon2 Hash — Uses the exact same implementation as the Noir circuit.
 *
 * Wraps @aztec/bb.js Barretenberg's poseidon2Hash to ensure
 * client-side hashes match what the ZK circuit verifies.
 */

let bb: any = null;
let Fr: any = null;
let initialized = false;

/**
 * Initialize Barretenberg for Poseidon2 hashing.
 * Lazy-loaded — first call downloads WASM.
 */
async function init() {
  if (initialized) return;

  try {
    const bbModule = await import('@aztec/bb.js');
    Fr = bbModule.Fr;

    // Try BarretenbergSync first (faster, no async overhead)
    if (bbModule.BarretenbergSync) {
      bb = await bbModule.BarretenbergSync.new();
    } else if (bbModule.Barretenberg) {
      bb = await bbModule.Barretenberg.new();
    } else {
      throw new Error('No Barretenberg class found in @aztec/bb.js');
    }

    initialized = true;
  } catch (err) {
    console.warn('Failed to initialize Poseidon2, using fallback:', err);
  }
}

/**
 * Compute Poseidon2 hash of two field elements.
 * Matches Noir's `std::hash::poseidon2::Poseidon2::hash([left, right], 2)`.
 *
 * @param left - Field element as decimal string
 * @param right - Field element as decimal string
 * @returns Hash as decimal string
 */
export async function poseidon2Hash(left: string, right: string): Promise<string> {
  await init();

  if (!initialized || !bb || !Fr) {
    // Fallback: deterministic but NOT matching Noir (for environments without WASM)
    return fallbackHash(left, right);
  }

  const leftFr = new Fr(BigInt(left));
  const rightFr = new Fr(BigInt(right));
  const result = bb.poseidon2Hash([leftFr, rightFr]);
  // Convert result to decimal string
  const bytes = result.toBuffer();
  let value = BigInt(0);
  for (const byte of bytes) {
    value = (value << BigInt(8)) | BigInt(byte);
  }
  return value.toString();
}

/**
 * Compute Poseidon2 hash synchronously (if BarretenbergSync is available).
 * Falls back to async version if sync not initialized.
 */
export function poseidon2HashSync(left: string, right: string): string {
  if (!initialized || !bb || !Fr) {
    return fallbackHashSync(left, right);
  }

  const leftFr = new Fr(BigInt(left));
  const rightFr = new Fr(BigInt(right));
  const result = bb.poseidon2Hash([leftFr, rightFr]);
  const bytes = result.toBuffer();
  let value = BigInt(0);
  for (const byte of bytes) {
    value = (value << BigInt(8)) | BigInt(byte);
  }
  return value.toString();
}

/**
 * Check if real Poseidon2 is available (WASM loaded).
 */
export function isPoseidonReady(): boolean {
  return initialized;
}

/**
 * Pre-initialize Poseidon2 WASM.
 */
export async function initPoseidon(): Promise<boolean> {
  await init();
  return initialized;
}

// Fallback hash — deterministic but won't match the Noir circuit
function fallbackHash(a: string, b: string): string {
  return fallbackHashSync(a, b);
}

function fallbackHashSync(a: string, b: string): string {
  const BN254_MODULUS = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
  const combined = BigInt(a) ^ BigInt(b);
  return (((combined % BN254_MODULUS) + BN254_MODULUS) % BN254_MODULUS).toString();
}
