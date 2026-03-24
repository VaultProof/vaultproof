/**
 * ZK Proof Engine — Browser-side Noir proof generation
 *
 * Lazily loads ~11MB Barretenberg WASM on first use.
 * Generates real ZK proofs for the key_auth circuit.
 */

// Circuit artifact (14KB) — imported at build time
import circuitJson from './key_auth.json' with { type: 'json' };

let noir: any = null;
let backend: any = null;
let initialized = false;
let initializing = false;

/**
 * Lazily initialize the Noir prover + Barretenberg backend.
 * First call downloads ~11MB WASM. Subsequent calls are instant.
 */
export async function initZKEngine(): Promise<boolean> {
  if (initialized) return true;
  if (initializing) {
    // Wait for in-progress initialization
    while (initializing) {
      await new Promise((r) => setTimeout(r, 100));
    }
    return initialized;
  }

  initializing = true;
  try {
    const { Noir } = await import('@noir-lang/noir_js');
    const { BarretenbergBackend } = await import('@noir-lang/backend_barretenberg');

    backend = new BarretenbergBackend(circuitJson as any);
    noir = new Noir(circuitJson as any);
    initialized = true;
    return true;
  } catch (err) {
    console.error('Failed to initialize ZK engine:', err);
    return false;
  } finally {
    initializing = false;
  }
}

/**
 * Check if the ZK engine is ready.
 */
export function isZKReady(): boolean {
  return initialized;
}

export interface ProofInputs {
  // Private (client knows, not revealed)
  slotSecret: string;
  shareHash: string;
  appAuthPath: string[];     // 10 elements
  appAuthIndices: number[];  // 10 elements (0 or 1)
  nonce: string;

  // Public (sent to server for verification)
  vaultCommitment: string;
  appIdHash: string;
  authorizedAppsRoot: string;
  treeDepth: number;
  nullifier: string;
}

export interface GeneratedProof {
  proofHex: string;
  publicInputs: string[];
}

/**
 * Generate a real Noir ZK proof.
 *
 * @param inputs - All private and public inputs for the circuit
 * @returns The serialized proof + public inputs
 */
export async function generateZKProof(inputs: ProofInputs): Promise<GeneratedProof> {
  if (!initialized) {
    const ok = await initZKEngine();
    if (!ok) throw new Error('ZK engine failed to initialize');
  }

  // Map inputs to circuit parameter names
  const circuitInputs: Record<string, string | string[] | number[]> = {
    // Private
    slot_secret: inputs.slotSecret,
    share_hash: inputs.shareHash,
    app_auth_path: inputs.appAuthPath,
    app_auth_indices: inputs.appAuthIndices,
    nonce: inputs.nonce,

    // Public
    vault_commitment: inputs.vaultCommitment,
    app_id_hash: inputs.appIdHash,
    authorized_apps_root: inputs.authorizedAppsRoot,
    tree_depth: inputs.treeDepth.toString(),
    nullifier: inputs.nullifier,
  };

  // Generate witness from inputs
  const { witness } = await noir.execute(circuitInputs);

  // Generate proof from witness
  const proof = await backend.generateProof(witness);

  return {
    proofHex: bytesToHex(proof.proof),
    publicInputs: proof.publicInputs,
  };
}

/**
 * Compute Poseidon2 hash of two field elements.
 * Uses the SAME Poseidon2 implementation as the Noir circuit via @aztec/bb.js.
 *
 * IMPORTANT: This is async because it may need to initialize WASM on first call.
 * Use fieldHashSync() only after initPoseidon() has been called.
 */
export { poseidon2Hash as fieldHashAsync, poseidon2HashSync as fieldHash, initPoseidon, isPoseidonReady } from './poseidon.js';

/**
 * Generate a random field element suitable for Noir circuits.
 */
export function randomField(): string {
  const bytes = new Uint8Array(31); // 31 bytes to stay under BN254 modulus
  crypto.getRandomValues(bytes);
  let value = BigInt(0);
  for (let i = 0; i < bytes.length; i++) {
    value = (value << BigInt(8)) | BigInt(bytes[i]);
  }
  const BN254_MODULUS = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
  return (value % BN254_MODULUS).toString();
}

/**
 * Build a Merkle tree for authorized apps using real Poseidon2 hashes.
 * Returns the root and the membership proof for a given app.
 */
export async function buildAppMerkleTree(appIds: string[], targetAppId: string): Promise<{
  root: string;
  path: string[];
  indices: number[];
}> {
  const { poseidon2Hash } = await import('./poseidon.js');

  // Hash each app ID to get leaf
  const leaves: string[] = [];
  for (const id of appIds) {
    leaves.push(await poseidon2Hash(id, '0'));
  }

  // Pad to power of 2
  const depth = Math.max(1, Math.ceil(Math.log2(Math.max(leaves.length, 2))));
  const paddedLeaves = [...leaves];
  while (paddedLeaves.length < Math.pow(2, depth)) {
    paddedLeaves.push('0');
  }

  // Find target index
  const targetLeaf = await poseidon2Hash(targetAppId, '0');
  let targetIdx = paddedLeaves.indexOf(targetLeaf);
  if (targetIdx === -1) throw new Error('App not in authorized list');

  // Build tree bottom-up, collecting proof
  const path: string[] = [];
  const indices: number[] = [];
  let currentLevel = paddedLeaves;

  for (let d = 0; d < depth; d++) {
    const siblingIdx = targetIdx % 2 === 0 ? targetIdx + 1 : targetIdx - 1;
    path.push(currentLevel[siblingIdx] || '0');
    indices.push(targetIdx % 2 === 0 ? 0 : 1);

    // Build next level
    const nextLevel: string[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      nextLevel.push(await poseidon2Hash(currentLevel[i], currentLevel[i + 1] || '0'));
    }
    currentLevel = nextLevel;
    targetIdx = Math.floor(targetIdx / 2);
  }

  // Pad path/indices to 10 elements (circuit expects fixed size)
  while (path.length < 10) {
    path.push('0');
    indices.push(0);
  }

  return { root: currentLevel[0], path, indices };
}

// --- Helpers ---

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
