import crypto from 'node:crypto';
import { fitContext } from './context-budget.mjs';
import { validatePermissionScope, permissionDigest, canonicalJson, permissionRevision, validateModuleAuthorization, authorizeModuleFromTask,
  validateCodingSourceCheck, codingSourceScopeFromTask } from './task-permissions.mjs';

import {
  ContextGatewayError,
  archiveAddress,
  boundedInteger,
  boundedText,
  exactObject,
  optionalString,
  patterns,
  projectId,
  sanitizeValue,
  searchQuery,
  sourceType,
  stringArray,
  taskState,
  uuid,
} from './validation.mjs';

const NAMESPACE = /^[a-z0-9][a-z0-9._:/-]{1,179}$/;

function cleanRows(rows, contentLimit = 4_000) {
  return rows.map((row) => {
    const clean = sanitizeValue(row);
    if (typeof clean.content === 'string') clean.content = boundedText(clean.content, contentLimit);
    return clean;
  });
}

function retrievalDetails(rows, embedding) {
  return rows.retrievalDetails ?? { lexical: 'strict', embeddingUsed: Boolean(embedding) };
}

function retrievalMode(rows, embedding, diverse = false) {
  return `${embedding ? 'hybrid' : 'lexical'}-rrf${diverse ? '-diverse' : ''}${rows.retrievalDetails?.lexical === 'term-or-fallback' ? '-fallback' : ''}`;
}

export class MastermindContextGateway {
  constructor({ store, embed, projectObsidian, minecraftStatus, identity }) {
    if (!store || typeof store.authorizeOperator !== 'function') throw new TypeError('A memory store is required.');
    this.store = store;
    this.embed = typeof embed === 'function' ? embed : async () => null;
    this.projectObsidian = typeof projectObsidian === 'function' ? projectObsidian : async () => ({ enabled: false });
    this.minecraftStatus = typeof minecraftStatus === 'function' ? minecraftStatus : async () => ({ configured: false });
    this.identity = Object.freeze({
      householdId: optionalString(identity?.householdId, 'householdId', 128, patterns.SAFE_ID),
      actorPlayerId: identity?.actorPlayerId ? uuid(identity.actorPlayerId, 'actorPlayerId') : null,
    });
  }

  async authorize() {
    if (!this.identity.householdId || !this.identity.actorPlayerId) {
      throw new ContextGatewayError(
        'IDENTITY_NOT_CONFIGURED',
        'Configure MASTERMIND_MEMORY_HOUSEHOLD_ID and MASTERMIND_MEMORY_OPERATOR_PLAYER_ID.',
        503,
      );
    }
    const allowed = await this.store.authorizeOperator(this.identity.householdId, this.identity.actorPlayerId);
    if (!allowed) throw new ContextGatewayError('MEMORY_ACCESS_DENIED', 'The configured actor is not an active parent operator.', 403);
  }

  async bootstrap(raw = {}) {
    const input = exactObject(raw, ['project', 'intent', 'requestedScopes', 'budget']);
    const project = projectId(input.project ?? 'mastermind');
    const intent = optionalString(input.intent, 'intent', 1_000);
    const budget = boundedInteger(input.budget, 'budget', 24_000, 4_000, 48_000);
    const requestedScopes = stringArray(input.requestedScopes, 'requestedScopes', 12, 180);
    for (const scope of requestedScopes) {
      if (!NAMESPACE.test(scope)) throw new ContextGatewayError('INVALID_ARGUMENT', 'requestedScopes contains an invalid namespace.');
    }
    await this.authorize();
    const [pinned, state, status] = await Promise.all([
      this.store.pinnedMemories(project),
      this.store.projectState(project, 20, this.identity),
      this.store.status(),
    ]);
    let relevant = [];
    let embedding = null;
    if (intent) {
      embedding = await this.embed(intent);
      relevant = await this.store.searchMemories(intent, { project, limit: 8, embedding });
    }
    return fitContext(sanitizeValue({
      schemaVersion: 1,
      project,
      intent,
      grantedScopes: requestedScopes.length > 0 ? requestedScopes : [`project/${project}`, 'system/technical'],
      identity: { householdId: this.identity.householdId, actorPlayerId: this.identity.actorPlayerId, role: 'parent' },
      pinned: cleanRows(pinned, 2_000),
      relevant: cleanRows(relevant, 2_000),
      retrieval: retrievalMode(relevant, embedding),
      retrievalDetails: retrievalDetails(relevant, embedding),
      projectState: state,
      substrate: status,
      policy: {
        authorityBeforeRanking: true,
        vectorsAreDerived: true,
        minecraftActionsEnabled: false,
        obsidianIsProjection: true,
      },
    }), budget);
  }

  async searchMemories(raw = {}) {
    const input = exactObject(raw, ['query', 'project', 'limit', 'includeInactive']);
    const query = searchQuery(input.query);
    const project = input.project ? projectId(input.project) : null;
    const limit = boundedInteger(input.limit, 'limit', 10, 1, 20);
    const includeInactive = input.includeInactive ?? false;
    if (typeof includeInactive !== 'boolean') throw new ContextGatewayError('INVALID_ARGUMENT', 'includeInactive must be a boolean.');
    await this.authorize();
    const embedding = await this.embed(query);
    const rows = await this.store.searchMemories(query, { project, limit, embedding, includeInactive });
    return { query, project, memoryLifecycle: includeInactive ? 'including-inactive' : 'active', retrieval: retrievalMode(rows, embedding), retrievalDetails: retrievalDetails(rows, embedding), results: cleanRows(rows, 4_000) };
  }

  async searchArchive(raw = {}) {
    const input = exactObject(raw, ['query', 'sourceType', 'limit']);
    const query = searchQuery(input.query);
    const filter = sourceType(input.sourceType);
    const limit = boundedInteger(input.limit, 'limit', 8, 1, 16);
    await this.authorize();
    const embedding = await this.embed(query);
    const rows = await this.store.searchArchive(query, { sourceType: filter, limit, embedding });
    return { query, sourceType: filter, retrieval: retrievalMode(rows, embedding, true), retrievalDetails: retrievalDetails(rows, embedding), results: cleanRows(rows, 5_000) };
  }

  async fetchArchive(raw = {}) {
    const input = exactObject(raw, ['address', 'contextWindow']);
    const address = archiveAddress(input.address);
    const contextWindow = boundedInteger(input.contextWindow, 'contextWindow', 1, 0, 3);
    await this.authorize();
    const result = await this.store.fetchArchive(address, contextWindow);
    if (!result) throw new ContextGatewayError('ARCHIVE_ADDRESS_NOT_FOUND', 'No archive chunk exists at that address.', 404);
    return { address, exact: cleanRows([result.exact], 12_000)[0], neighbors: cleanRows(result.neighbors, 8_000) };
  }

  async searchMinecraftMemories(raw = {}) {
    const input = exactObject(raw, ['query', 'limit']);
    const query = input.query === '' ? '' : searchQuery(input.query ?? '');
    const limit = boundedInteger(input.limit, 'limit', 10, 1, 20);
    await this.authorize();
    const results = await this.store.searchMinecraftMemories(
      this.identity.householdId,
      this.identity.actorPlayerId,
      query,
      limit,
    );
    return sanitizeValue({ query, authority: 'authorized-companion-session-rollup', results });
  }

  async projectState(raw = {}) {
    const input = exactObject(raw, ['project', 'limit']);
    const project = projectId(input.project ?? 'mastermind');
    const limit = boundedInteger(input.limit, 'limit', 20, 1, 50);
    await this.authorize();
    return sanitizeValue({ project, ...(await this.store.projectState(project, limit, this.identity)) });
  }

  async contextPack(raw = {}) {
    const input = exactObject(raw, ['project', 'intent', 'budget', 'memoryLimit', 'archiveLimit']);
    const project = projectId(input.project ?? 'mastermind');
    const intent = searchQuery(input.intent);
    const budget = boundedInteger(input.budget, 'budget', 24_000, 4_000, 48_000);
    const memoryLimit = boundedInteger(input.memoryLimit, 'memoryLimit', 10, 1, 20);
    const archiveLimit = boundedInteger(input.archiveLimit, 'archiveLimit', 8, 1, 16);
    await this.authorize();
    const embedding = await this.embed(intent);
    const includeMinecraft = project === 'minecraft' || /\bminecraft\b/i.test(intent);
    const [pinned, state, memories, archive, minecraftMemories] = await Promise.all([
      this.store.pinnedMemories(project, { identity: 6, toolbox: 6, project: 8 }),
      this.store.projectState(project, 12, this.identity),
      this.store.searchMemories(intent, { project, limit: memoryLimit, embedding }),
      this.store.searchArchive(intent, { limit: archiveLimit, embedding }),
      includeMinecraft
        ? this.store.searchMinecraftMemories(this.identity.householdId, this.identity.actorPlayerId, intent, 8)
        : Promise.resolve([]),
    ]);
    return fitContext(sanitizeValue({
      schemaVersion: 1,
      project,
      intent,
      generatedAt: new Date().toISOString(),
      retrieval: embedding ? 'hybrid-rrf' : 'lexical-rrf',
      retrievalDetails: { memories: retrievalDetails(memories, embedding), archive: retrievalDetails(archive, embedding) },
      pinned: cleanRows(pinned, 1_600),
      projectState: state,
      memories: cleanRows(memories, 2_400),
      archive: cleanRows(archive, 3_200),
      minecraftMemories: sanitizeValue(minecraftMemories),
      instructions: [
        'Treat task and identity records as canonical; treat vectors as derived retrieval aids.',
        'Cite harmonic memory IDs and transcript archive addresses when relying on them.',
        'Label inference separately from confirmed facts.',
      ],
    }), budget);
  }

  // Internal client adapter read: exact task, same operator authorization and project binding.
  // This does not add a new MCP tool or alter the existing tools/call contract.
  async clientTaskState(raw = {}) {
    const input = exactObject(raw, ['taskId', 'project']);
    const taskId = uuid(input.taskId, 'taskId');
    const project = projectId(input.project ?? 'mastermind');
    await this.authorize();
    return sanitizeValue(await this.store.taskById(taskId, project,
      this.identity.householdId, this.identity.actorPlayerId));
  }

  async clientAuthorizeModule(raw = {}) {
    const input = validateModuleAuthorization(raw);
    const task = await this.clientTaskState({ taskId: input.taskId, project: input.project });
    return authorizeModuleFromTask(task, input);
  }

  // Host-only eligibility check. No MCP/HTTP tool, account assertion or scope write.
  async clientCheckCodingSource(raw = {}) {
    const input = validateCodingSourceCheck(raw);
    const task = await this.clientTaskState({ taskId: input.taskId, project: input.project });
    return codingSourceScopeFromTask(task, input);
  }

  // Owner administration only: intentionally absent from MCP and the native publisher CLI.
  async clientSetTaskPermissions(raw = {}) {
    const input = exactObject(raw, ['taskId', 'project', 'checkpointId', 'expectedRevision', 'expectedPermissionRevision', 'scope']);
    const scope = validatePermissionScope(input.scope);
    const command = { taskId: uuid(input.taskId, 'taskId'), project: projectId(input.project ?? 'mastermind'),
      checkpointId: uuid(input.checkpointId, 'checkpointId'),
      expectedRevision: permissionRevision(input.expectedRevision, 'expectedRevision'),
      expectedPermissionRevision: permissionRevision(input.expectedPermissionRevision, 'expectedPermissionRevision'),
      scopeCanonical: canonicalJson(scope), scopeSha256: permissionDigest(scope),
      householdId: this.identity.householdId, actorPlayerId: this.identity.actorPlayerId };
    await this.authorize();
    return sanitizeValue(await this.store.setTaskPermissions(command));
  }

  async checkpoint(raw = {}) {
    const input = exactObject(raw, [
      'taskId', 'checkpointId', 'project', 'intent', 'summary', 'state', 'completedItems', 'openItems', 'blockers',
      'expectedRevision',
    ]);
    const taskId = input.taskId ? uuid(input.taskId, 'taskId') : crypto.randomUUID();
    const checkpointId = input.checkpointId ? uuid(input.checkpointId, 'checkpointId') : crypto.randomUUID();
    const project = projectId(input.project ?? 'mastermind');
    let intent = optionalString(input.intent, 'intent', 2_000);
    const summary = optionalString(input.summary, 'summary', 4_096) ?? 'Checkpoint recorded.';
    const state = taskState(input.state);
    const completedItems = stringArray(input.completedItems, 'completedItems', 32, 512);
    const openItems = stringArray(input.openItems, 'openItems', 32, 512);
    const blockers = stringArray(input.blockers, 'blockers', 32, 512);
    if (input.expectedRevision !== undefined && (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0)) {
      throw new ContextGatewayError('INVALID_ARGUMENT', 'expectedRevision must be a non-negative safe integer.');
    }
    await this.authorize();
    if (intent === null && input.taskId) {
      const existing = await this.store.taskById(taskId, project, this.identity.householdId, this.identity.actorPlayerId);
      intent = existing?.intent ?? null;
    }
    intent ??= 'Persistent Mastermind task';
    return this.store.appendCheckpoint({
      taskId,
      checkpointId,
      householdId: this.identity.householdId,
      actorPlayerId: this.identity.actorPlayerId,
      project,
      intent,
      summary,
      state,
      completedItems,
      openItems,
      blockers,
      ...(input.expectedRevision !== undefined ? { expectedRevision: input.expectedRevision } : {}),
    });
  }

  async obsidianExport(raw = {}) {
    const input = exactObject(raw, ['project', 'confirm']);
    if (input.confirm !== true) throw new ContextGatewayError('CONFIRMATION_REQUIRED', 'Set confirm to true to write the generated Obsidian projection.', 409);
    const project = projectId(input.project ?? 'mastermind');
    await this.authorize();
    const data = await this.store.projectionData(project, 200, 100, this.identity);
    return this.projectObsidian({ project, memories: cleanRows(data.memories, 16_000), tasks: sanitizeValue(data.tasks) });
  }

  async getMinecraftStatus(raw = {}) {
    exactObject(raw, []);
    await this.authorize();
    return this.minecraftStatus();
  }

  async systemStatus(raw = {}) {
    exactObject(raw, []);
    await this.authorize();
    const [memory, minecraft] = await Promise.all([this.store.status(), this.minecraftStatus()]);
    return sanitizeValue({ memory, minecraft, gateway: { version: '0.1.0', writeCapabilities: ['task_checkpoint', 'obsidian_export'], minecraftActionsEnabled: false } });
  }
}
