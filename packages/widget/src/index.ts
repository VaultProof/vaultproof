// @zkvault/connect — Drop-in React widget for zero-knowledge API key storage

export { ZKKeyConnect } from './ZKKeyConnect.js';
export { VaultClient } from './vault-client.js';
export { initZKEngine, isZKReady, generateZKProof, randomField, buildAppMerkleTree } from './zk-engine.js';
export { poseidon2Hash, initPoseidon, isPoseidonReady } from './poseidon.js';
export { PROVIDERS } from './types.js';
export type {
  Provider,
  ProviderInfo,
  ZKKeyConnectProps,
  WidgetStatus,
} from './types.js';
export type { VaultConfig, StoredKeyInfo, ProxyCallOptions } from './vault-client.js';
export type { ProofInputs, GeneratedProof } from './zk-engine.js';
