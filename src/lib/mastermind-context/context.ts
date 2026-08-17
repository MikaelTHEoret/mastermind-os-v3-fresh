// src/lib/mastermind-context/context.ts — layered context packing and embodiment-session assembly.
import { randomUUID } from 'node:crypto';
import { boundPayload, GatewayPrincipal } from './security';
import {
  EmbodimentRequest,
  MAX_BUDGET_TOKENS,
  archiveResult,
  memoryResult,
  projectId,
  queryText,
  validatedScopes,
} from './common';
import { pinnedContext, searchArchive, searchMemory } from './retrieval';
import { capabilityManifest, projectState, ProjectStateResult, systemStatus } from './state';

function latestContinuity(state: ProjectStateResult) {
  const task = state.tasks?.[0];
  const checkpoint = task?.checkpoints?.[0];
  return {
    activeTaskId: task?.id || null,
    taskStatus: task?.status || null,
    currentRevision: task?.revision ?? null,
    latestCheckpoint: checkpoint || null,
    recoveryInstructions: checkpoint?.recovery || null,
  };
}

function serializedSize(value: unknown): number {
  return JSON.stringify(value).length;
}

function compactLayerValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    const limit = depth <= 1 ? 1_200 : 700;
    return value.length > limit ? `${value.slice(0, limit)}\n[…truncated…]` : value;
  }
  if (Array.isArray(value)) {
    const limit = depth <= 1 ? 8 : 5;
    return value.slice(0, limit).map((item) => compactLayerValue(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 24)
        .map(([key, item]) => [key, compactLayerValue(item, depth + 1)]),
    );
  }
  return value;
}

function packLayer(value: unknown, allocation: number) {
  if (value === null || value === undefined) return { value, used: 0, truncated: false };
  if (!Array.isArray(value)) {
    const compacted = compactLayerValue(value);
    const used = Math.min(allocation, serializedSize(compacted));
    return { value: compacted, used, truncated: serializedSize(value) > allocation };
  }

  const accepted: unknown[] = [];
  let used = 0;
  let truncated = false;
  for (const item of value) {
    const remaining = allocation - used;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    let candidate = item;
    let size = serializedSize(candidate);
    if (size > remaining) {
      candidate = compactLayerValue(item);
      size = serializedSize(candidate);
    }
    if (size > remaining) {
      truncated = true;
      continue;
    }
    accepted.push(candidate);
    used += size;
  }
  if (accepted.length < value.length) truncated = true;
  return { value: accepted, used, truncated };
}

function fitLayers(layers: Record<string, unknown>, tokens: number) {
  const characterBudget = Math.max(4_000, Math.min(MAX_BUDGET_TOKENS, tokens) * 4);
  const baseWeights: Record<string, number> = {
    L0_identity_toolbox_and_principles: 0.18,
    L1_project_context: 0.18,
    L2_active_tasks_and_checkpoints: 0.20,
    L3_relevant_curated_memories: 0.20,
    L4_archive_evidence: 0.20,
    L5_live_external_state: 0.04,
  };
  const populated = Object.entries(layers).filter(([, value]) =>
    Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined,
  );
  const totalWeight = populated.reduce((sum, [name]) => sum + (baseWeights[name] || 0.1), 0) || 1;
  const sections: Record<string, unknown> = {};
  const truncatedLayers: string[] = [];
  let used = 0;

  for (const [name, value] of Object.entries(layers)) {
    const populatedLayer = Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined;
    if (!populatedLayer) {
      sections[name] = value;
      continue;
    }
    const allocation = Math.max(900, Math.floor(characterBudget * ((baseWeights[name] || 0.1) / totalWeight)));
    const packed = packLayer(value, allocation);
    sections[name] = packed.value;
    used += packed.used;
    if (packed.truncated) truncatedLayers.push(name);
  }

  return {
    sections,
    approximateCharacters: used,
    characterBudget,
    contextBudgetExhausted: truncatedLayers.length > 0,
    truncatedLayers,
  };
}

export async function buildContextPack(principal: GatewayPrincipal, request: EmbodimentRequest) {
  const intent = queryText(request.intent);
  const project = projectId(request.project);
  const scopes = validatedScopes(request.scopes);
  const budget = Math.max(1_000, Math.min(MAX_BUDGET_TOKENS, Math.floor(request.budget || 6_000)));
  const emptyState: ProjectStateResult = { available: true, project, taskCount: 0, tasks: [], warnings: [] };
  const emptyMemory = { available: true, project, query: intent, retrievalMode: 'not-requested', resultCount: 0, results: [] as ReturnType<typeof memoryResult>[], warnings: [] as string[] };
  const emptyArchive = { available: true, query: intent, retrievalMode: 'not-requested', resultCount: 0, results: [] as ReturnType<typeof archiveResult>[], warnings: [] as string[] };
  const [pinned, state, memories, archive] = await Promise.all([
    pinnedContext(principal, project, scopes),
    scopes.includes('task') ? projectState(principal, { project, limit: 10 }) : Promise.resolve(emptyState),
    scopes.includes('memory') ? searchMemory(principal, { query: intent, project, limit: 10 }) : Promise.resolve(emptyMemory),
    scopes.includes('archive') ? searchArchive(principal, { query: intent, limit: 10 }) : Promise.resolve(emptyArchive),
  ]);
  const layers = {
    L0_identity_toolbox_and_principles: pinned.filter((item) => item.layer === 'identity' || item.layer === 'toolbox'),
    L1_project_context: pinned.filter((item) => item.layer === 'project'),
    L2_active_tasks_and_checkpoints: state.tasks || [],
    L3_relevant_curated_memories: memories.results,
    L4_archive_evidence: archive.results,
    L5_live_external_state: scopes.includes('minecraft-status') ? { surface: 'read-only', actionsExposed: false, liveBridgeStatus: 'not exposed by this Vercel slice' } : null,
  };
  const packed = fitLayers(layers, budget);
  return boundPayload({
    ok: true,
    project,
    intent,
    scopes,
    host: principal.host,
    authority: { canonicalState: 'Neon', vectorIndexes: 'derived-rebuildable', modelOutputs: 'interpretation-not-authority' },
    continuity: latestContinuity(state),
    retrievalSummary: {
      pinned: {
        total: pinned.length,
        identityToolbox: pinned.filter((item) => item.layer === 'identity' || item.layer === 'toolbox').length,
        project: pinned.filter((item) => item.layer === 'project').length,
      },
      tasks: { available: state.available, resultCount: state.taskCount },
      memory: { available: memories.available, resultCount: memories.resultCount, mode: memories.retrievalMode },
      archive: { available: archive.available, resultCount: archive.resultCount, mode: archive.retrievalMode },
    },
    ...packed,
    sourceRefs: [...pinned.map((item) => item.sourceRef), ...memories.results.map((item) => item.sourceRef), ...archive.results.map((item) => item.sourceRef)].filter(Boolean),
    warnings: [...(state.warnings || []), ...memories.warnings, ...archive.warnings],
  });
}

export async function createEmbodimentSession(principal: GatewayPrincipal, request: EmbodimentRequest) {
  const project = projectId(request.project);
  const intent = queryText(request.intent);
  const scopes = validatedScopes(request.scopes);
  const [status, contextPack] = await Promise.all([
    systemStatus(principal),
    buildContextPack(principal, { ...request, project, intent, scopes }),
  ]);
  const continuity = (contextPack.continuity || {}) as Record<string, unknown>;
  return boundPayload({
    ok: true,
    session: { id: randomUUID(), host: principal.host, startedAt: new Date().toISOString(), transport: principal.authMode === 'bearer' ? 'remote-gateway' : 'web-session' },
    identity: { canonicalName: 'Mastermind', actorId: principal.actorId, roles: principal.roles, scopes: principal.scopes, providerIndependent: true },
    persona: {
      operatingPrinciples: [
        'Search durable memory before assuming.',
        'Distinguish canonical fact, source evidence, and model inference.',
        'Preserve stable source references.',
        'Propose consequential action before execution.',
        'Never request or reveal secrets.',
      ],
    },
    project: { id: project, intent },
    continuity,
    contextPack,
    capabilities: capabilityManifest(principal),
    status,
  });
}
