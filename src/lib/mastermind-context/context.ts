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

function fitLayers(layers: Record<string, unknown>, tokens: number) {
  const characterBudget = Math.max(4_000, Math.min(MAX_BUDGET_TOKENS, tokens) * 4);
  const sections: Record<string, unknown> = {};
  let used = 0;
  for (const [name, value] of Object.entries(layers)) {
    const serialized = JSON.stringify(value);
    if (used + serialized.length <= characterBudget) {
      sections[name] = value;
      used += serialized.length;
      continue;
    }
    if (Array.isArray(value)) {
      const accepted: unknown[] = [];
      for (const item of value) {
        const size = JSON.stringify(item).length;
        if (used + size > characterBudget) break;
        accepted.push(item);
        used += size;
      }
      sections[name] = accepted;
    }
    sections.contextBudgetExhausted = true;
    break;
  }
  return { sections, approximateCharacters: used, characterBudget };
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
