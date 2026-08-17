// src/lib/mastermind-context/gateway.ts — public facade for the canonical embodiment gateway.
export type { EmbodimentRequest } from './common';
export { buildContextPack, createEmbodimentSession } from './context';
export { fetchArchive, pinnedContext, searchArchive, searchMemory } from './retrieval';
export { capabilityManifest, projectState, systemStatus } from './state';
