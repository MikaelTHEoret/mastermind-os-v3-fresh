import assert from 'node:assert/strict';
import test from 'node:test';

import { fitContext } from '../src/context-budget.mjs';
import { MastermindContextGateway } from '../src/context-gateway.mjs';
import { toolEnvelope } from '../src/mcp-server.mjs';
import { lexicalFallback, NeonMemoryStore } from '../src/neon-store.mjs';
import { sanitizeValue } from '../src/validation.mjs';

const ACTOR = '00000000-0000-8000-8000-000000000001';
const TASK = '00000000-0000-8000-8000-000000000002';
const CHECKPOINT = '00000000-0000-8000-8000-000000000003';
const LARGE = 'Hydration evidence with quotes " and newlines\n'.repeat(150);

function fullPacket() {
  return {
    project: 'mastermind', intent: 'recover the original hydration design',
    pinned: ['identity', 'toolbox', 'project'].flatMap((layer) => Array.from({ length: 8 }, (_, index) => ({
      id: `${layer}-${index}`, layer, project: 'mastermind', content: LARGE,
    }))),
    projectState: { migrationRequired: false, tasks: [{
      taskId: TASK, intent: LARGE, state: 'blocked', revision: '2', updatedAt: '2026-08-16T08:28:10.740Z',
      checkpoint: { checkpointId: CHECKPOINT, summary: LARGE,
        completedItems: Array(32).fill(LARGE), openItems: Array(32).fill(LARGE), blockers: Array(32).fill(LARGE) },
    }] },
    memories: Array.from({ length: 8 }, (_, index) => ({ id: `memory-${index}`, content: LARGE })),
    archive: Array.from({ length: 8 }, (_, index) => ({ address: `claude/original#chunk-${index}`, docId: 'claude/original', content: LARGE })),
    minecraftMemories: [{ memoryKey: 'companion-session/v1/example', summary: LARGE }],
  };
}

test('dates survive nested sanitization and invalid dates become null', () => {
  const date = new Date('2026-08-16T04:28:10.740-04:00');
  assert.deepEqual(sanitizeValue({ updatedAt: date, tasks: [{ checkpoint: { createdAt: date } }], bad: new Date(NaN) }), {
    updatedAt: '2026-08-16T08:28:10.740Z', tasks: [{ checkpoint: { createdAt: '2026-08-16T08:28:10.740Z' } }], bad: null,
  });
});

for (const budget of [4000, 6000, 24000, 48000]) {
  test(`final JSON fits ${budget} characters and retains every context layer and source reference`, () => {
    const packet = fullPacket();
    const original = structuredClone(packet);
    const result = fitContext(packet, budget);
    const serialized = JSON.stringify(result);
    assert.ok(serialized.length <= budget, `${serialized.length} exceeds ${budget}`);
    assert.equal(result.contextBudget.actualCharacters, serialized.length);
    assert.equal(result.contextBudget.truncated, true);
    assert.deepEqual(new Set(result.pinned.map((row) => row.layer)), new Set(['identity', 'toolbox', 'project']));
    assert.equal(result.projectState.tasks[0].taskId, TASK);
    assert.equal(result.projectState.tasks[0].checkpoint.checkpointId, CHECKPOINT);
    assert.equal(result.memories[0].id, 'memory-0');
    assert.equal(result.archive[0].address, 'claude/original#chunk-0');
    assert.equal(result.minecraftMemories[0].memoryKey, 'companion-session/v1/example');
    assert.deepEqual(packet, original);
    assert.deepEqual(fitContext(packet, budget), result);
  });
}

test('bootstrap remains structured under its default budget with task and intent evidence', async () => {
  const packet = fullPacket();
  packet.projectState.tasks[0].updatedAt = new Date('2026-08-16T08:28:10.740Z');
  const gateway = new MastermindContextGateway({
    store: {
      authorizeOperator: async () => true,
      pinnedMemories: async () => packet.pinned,
      projectState: async () => packet.projectState,
      status: async () => ({ harmonicMemories: '1346' }),
      searchMemories: async () => packet.memories,
    },
    identity: { householdId: 'family-local', actorPlayerId: ACTOR },
  });
  const result = await gateway.bootstrap({ project: 'mastermind', intent: 'recover hydration' });
  assert.equal(result.contextBudget.maximumCharacters, 24000);
  assert.equal(result.contextBudget.actualCharacters, JSON.stringify(result).length);
  assert.ok(result.contextBudget.actualCharacters <= 24000);
  assert.equal(result.relevant[0].id, 'memory-0');
  assert.equal(result.projectState.tasks[0].updatedAt, '2026-08-16T08:28:10.740Z');
  assert.deepEqual(new Set(result.pinned.map((row) => row.layer)), new Set(['identity', 'toolbox', 'project']));
  const envelope = toolEnvelope(result);
  assert.deepEqual(JSON.parse(envelope.content[0].text), envelope.structuredContent);
  assert.equal(envelope.isError, false);
  assert.equal(envelope.structuredContent.preview, undefined);
});

test('oversized non-context responses fail explicitly instead of producing invalid JSON previews', () => {
  assert.throws(() => toolEnvelope({ content: 'x'.repeat(65536) }), { code: 'RESPONSE_TOO_LARGE' });
});

test('current continuation stays complete before extra generic pins consume the budget', () => {
  const packet = fullPacket();
  packet.projectState.tasks[0].intent = 'Finish the approved persistent modular system';
  packet.projectState.tasks[0].checkpoint = {
    checkpointId: CHECKPOINT, sequence: '40', summary: 'Current decisions and next authorized work. '.repeat(65),
    completedItems: ['Accepted source and isolated tests'],
    openItems: ['Finish remote identity', 'Retain the preceding release'], blockers: [],
  };
  const result = fitContext(packet, 24000);
  assert.deepEqual(result.projectState.tasks[0], packet.projectState.tasks[0]);
  assert.equal(result.contextBudget.taskContinuity[0].complete, true);
  assert.equal(result.contextBudget.taskContinuity[0].summaryComplete, true);
  assert.ok(JSON.stringify(result).length <= 24000);
  assert.equal(result.archive[0].address, 'claude/original#chunk-0');
});

test('oversized continuation reports partial state and retains an exact recovery reference', () => {
  const packet = fullPacket();
  const result = fitContext(packet, 4000);
  const continuity = result.contextBudget.taskContinuity[0];
  assert.equal(continuity.taskId, TASK);
  assert.equal(continuity.checkpointId, CHECKPOINT);
  assert.equal(continuity.complete, false);
  assert.equal(continuity.summaryComplete, false);
  assert.equal(continuity.fullStateTool, 'mastermind_project_state');
  assert.ok(JSON.stringify(result).length <= 4000);
});

function mockStore(replies) {
  const store = Object.create(NeonMemoryStore.prototype);
  const calls = [];
  store.sql = { async query(statement, parameters) { calls.push({ statement, parameters }); return replies.shift() ?? []; } };
  return { store, calls };
}

for (const [method, options, row, scope] of [
  ['searchMemories', { project: 'mastermind', limit: 3 }, { id: 'hydration-1', content: 'hydration checkpoint' }, 'mastermind'],
  ['searchArchive', { sourceType: 'transcript', limit: 3 }, { address: 'claude/design#chunk-1', docId: 'claude/design', content: 'hydration checkpoint' }, 'transcript'],
]) {
  test(`${method} uses a scoped, parameterized keyword fallback only after an empty strict search`, async () => {
    const { store, calls } = mockStore([[], [row]]);
    const result = await store[method]('How does the hydration checkpoint work?', options);
    assert.equal(result.length, 1);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].statement, calls[1].statement);
    assert.equal(calls[1].parameters[0], '"hydration" OR "checkpoint" OR "work"');
    assert.equal(calls[1].parameters[1], scope);
    assert.deepEqual(calls[0].parameters.slice(1), calls[1].parameters.slice(1));
    assert.equal(result.retrievalDetails.lexical, 'term-or-fallback');
    assert.equal(result.retrievalDetails.embeddingUsed, false);
    assert.deepEqual(JSON.parse(JSON.stringify(result)).length, 1);
    const strict = mockStore([[row]]);
    assert.equal((await strict.store[method]('hydration checkpoint', options)).retrievalDetails.lexical, 'strict');
    assert.equal(strict.calls.length, 1);
  });
}

test('explicit search semantics and single useful terms are never broadened', () => {
  for (const query of ['"context hydration"', 'hydration -minecraft', 'hydration OR checkpoint', 'the hydration', 'hydration']) {
    assert.equal(lexicalFallback(query), null, query);
  }
  assert.deepEqual(lexicalFallback('Comment fonctionne la mémoire persistante?').terms, ['fonctionne', 'mémoire', 'persistante']);
});

test('safe checkpoint retries retain caller IDs and payload; missing IDs create distinct requests', async () => {
  const calls = [];
  const gateway = new MastermindContextGateway({
    store: { authorizeOperator: async () => true, appendCheckpoint: async (input) => { calls.push(input); return input; } },
    identity: { householdId: 'family-local', actorPlayerId: ACTOR },
  });
  const payload = { taskId: TASK, checkpointId: CHECKPOINT, project: 'mastermind', intent: 'Recover context', summary: 'Read primary sources' };
  await gateway.checkpoint(payload);
  await gateway.checkpoint(payload);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].taskId, TASK);
  assert.equal(calls[0].checkpointId, CHECKPOINT);
  await gateway.checkpoint({ summary: 'Fresh request' });
  await gateway.checkpoint({ summary: 'Fresh request' });
  assert.notEqual(calls[2].taskId, calls[3].taskId);
  assert.notEqual(calls[2].checkpointId, calls[3].checkpointId);
});
