/**
 * ClawPowers Skills — Memory Module Re-exports
 */

export { WorkingMemoryManager } from './working.js';
export { EpisodicMemory } from './episodic.js';
export { ProceduralMemory } from './procedural.js';
export { CheckpointManager } from './checkpoint.js';
export { ContextInjector } from './context-injector.js';
export {
  getNativeCanonicalStore,
  getNativeCanonicalStoreInMemory,
  getWasmCanonicalStore,
  getBestCanonicalStore,
  compressVector,
  decompressVector,
  approximateDistance,
  evaluateWriteSecurity,
  computeSha256,
} from './native-store.js';
export type { CompressionResult } from './native-store.js';
