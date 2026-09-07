import assert from 'node:assert/strict';
import test from 'node:test';
import { NeonMemoryStore } from '../src/neon-store.mjs';
import { MastermindContextGateway } from '../src/context-gateway.mjs';
import { sanitizeValue } from '../src/validation.mjs';

const ACTOR = '00000000-0000-8000-8000-000000000001';
const TASK = '00000000-0000-8000-8000-000000000002';
const CHECKPOINT = '00000000-0000-8000-8000-000000000003';
const IDENTITY = Object.freeze({ householdId: 'family-local', actorPlayerId: ACTOR });
function mockStore(replies = []) {
  const store = Object.create(NeonMemoryStore.prototype);
  const calls = [];
  store.sql = { async query(statement, parameters) { calls.push({ statement, parameters });
    const result = replies.shift(); if (result instanceof Error) throw result; return result ?? []; } };
  return { store, calls };
}

test('active-memory predicate precedes lexical and vector candidate limits, including the empty-query fallback', async () => {
  const { store, calls } = mockStore([[], [], []]);
  await store.searchMemories('hydration continuity', { embedding: [0, 1], project: 'mastermind' });
  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.match(call.statement, /WHERE[\s\S]+\(\$4::boolean OR COALESCE\(memory_status, 'active'\) = 'active'\)[\s\S]+ORDER BY[\s\S]+LIMIT/);
    assert.equal(call.parameters[3], false);
    assert.equal(call.parameters[1], 'mastermind');
  }
  assert.equal(calls[0].statement, calls[1].statement);
});

test('historical memory review is explicit and retains supersession provenance', async () => {
  const row = { id: 'old', memoryStatus: 'superseded', supersededByMemoryId: 'new', canonicalKey: 'design', rowVersion: '2' };
  const { store, calls } = mockStore([[row]]);
  const results = await store.searchMemories('hydration', { includeInactive: true });
  assert.equal(calls[0].parameters[3], true);
  assert.equal(results[0].supersededByMemoryId, 'new');
  assert.match(calls[0].statement, /superseded_by_memory_id AS "supersededByMemoryId"/);
  await assert.rejects(store.searchMemories('hydration', { includeInactive: 'true' }), { code: 'INVALID_ARGUMENT' });
  assert.equal(calls.length, 1);
});

test('pinned layers and projections exclude inactive records before ranking', async () => {
  const { store, calls } = mockStore();
  await store.pinnedMemories('mastermind');
  await store.projectionData('mastermind', 200, 100, IDENTITY);
  for (const call of calls.filter((call) => call.statement.includes('FROM public.harmonic_memories'))) {
    assert.match(call.statement, /WHERE[\s\S]+COALESCE\(memory_status, 'active'\) = 'active'[\s\S]+ORDER BY/);
  }
  assert.match(calls[0].statement, /AND \(layer IN[\s\S]+OR \(layer = 'project'/);
});

test('canonical project reads bind both household and operator; missing scope performs no SQL', async () => {
  const { store, calls } = mockStore([[{ taskId: TASK }], [{ taskId: TASK, checkpointId: CHECKPOINT }]]);
  await assert.rejects(store.projectState('mastermind'), { code: 'IDENTITY_NOT_CONFIGURED' });
  await assert.rejects(store.projectionData('mastermind'), { code: 'IDENTITY_NOT_CONFIGURED' });
  assert.equal(calls.length, 0);
  const result = await store.projectState('mastermind', 20, IDENTITY);
  assert.match(calls[0].statement, /project_id = \$1::text AND household_id = \$3::text AND actor_player_id = \$4::uuid/);
  assert.deepEqual(calls[0].parameters, ['mastermind', 20, 'family-local', ACTOR]);
  assert.deepEqual(calls[1].parameters, [[TASK]]);
  assert.equal(result.tasks[0].checkpoint.checkpointId, CHECKPOINT);
});

test('every context entry point forwards the same immutable task scope', async () => {
  const scopes = [];
  const store = { authorizeOperator: async () => true, pinnedMemories: async () => [], status: async () => ({}),
    searchMemories: async () => [], searchArchive: async () => [],
    projectState: async (_project, _limit, identity) => { scopes.push(identity); return { tasks: [] }; },
    projectionData: async (_project, _mem, _task, identity) => { scopes.push(identity); return { memories: [], tasks: [] }; } };
  const gateway = new MastermindContextGateway({ store, identity: IDENTITY });
  await gateway.bootstrap({ intent: 'hydrate' });
  await gateway.contextPack({ intent: 'hydrate' });
  await gateway.projectState({});
  await gateway.obsidianExport({ confirm: true });
  assert.equal(scopes.length, 4);
  for (const scope of scopes) { assert.deepEqual(scope, IDENTITY); assert.equal(Object.isFrozen(scope), true); }
});

test('Clerk mapping uses an exact bound subject and operator verification, never an email or caller-supplied scope', async () => {
  const { store, calls } = mockStore([[IDENTITY]]);
  assert.deepEqual(await store.resolveClerkOperator('user_owner', IDENTITY), IDENTITY);
  assert.match(calls[0].statement, /provider = 'clerk' AND provider_subject = \$1::text/);
  assert.match(calls[0].statement, /verify_mastermind_memory_operator_v1/);
  assert.deepEqual(calls[0].parameters, ['user_owner', 'family-local', ACTOR]);
  await assert.rejects(store.resolveClerkOperator('owner@example.com', IDENTITY), { code: 'INVALID_ARGUMENT' });
  assert.equal(calls.length, 1);
  for (const rows of [[], [IDENTITY, IDENTITY], [{ ...IDENTITY, householdId: 'other' }]]) {
    await assert.rejects(mockStore([rows]).store.resolveClerkOperator('user_owner', IDENTITY), { code: 'OWNER_BINDING_REQUIRED' });
  }
});

test('checkpoint omission of intent recovers the owned immutable intent and retains replay identifiers', async () => {
  const writes = []; const reads = [];
  const store = { authorizeOperator: async () => true,
    taskById: async (...args) => { reads.push(args); return { intent: 'Original authorized task' }; },
    appendCheckpoint: async (value) => { writes.push(value); return value; } };
  const gateway = new MastermindContextGateway({ store, identity: IDENTITY });
  const input = { taskId: TASK, checkpointId: CHECKPOINT, summary: 'Build stage accepted' };
  await gateway.checkpoint(input); await gateway.checkpoint(input);
  assert.deepEqual(writes[0], writes[1]);
  assert.equal(writes[0].intent, 'Original authorized task');
  assert.deepEqual(reads[0], [TASK, 'mastermind', 'family-local', ACTOR]);
});

test('checkpoint identity and authorization errors are typed without leaking database detail', async () => {
  for (const [code, message, expected] of [
    ['22023', 'context task identity is immutable', 'TASK_IDENTITY_CONFLICT'],
    ['42501', 'private database detail', 'MEMORY_ACCESS_DENIED'],
  ]) {
    const error = Object.assign(new Error(message), { code });
    const { store } = mockStore([error]);
    await assert.rejects(store.appendCheckpoint({}), { code: expected });
  }
});

test('exact task reads retain existing progress arrays for a native publisher', async () => {
  const row = { taskId: TASK, revision: '5', completedItems: ['Existing accepted work'], openItems: ['Independent open work'], blockers: ['Existing blocker'] };
  const { store, calls } = mockStore([[row]]);
  assert.deepEqual(await store.taskById(TASK, 'mastermind', 'family-local', ACTOR), row);
  for (const field of ['completed_items', 'open_items', 'blockers']) assert.match(calls[0].statement, new RegExp(field));
  assert.match(calls[0].statement, /t.household_id=\$3::text AND t.actor_player_id=\$4::uuid/);
});

test('optional revision checks retain the exact retry payload and use the guarded function only when requested', async () => {
  const reply = { status: 'applied', taskId: TASK, checkpointId: CHECKPOINT, revision: '6' };
  const { store, calls } = mockStore([[reply], [{ ...reply, status: 'duplicate' }], [reply]]);
  const input = { taskId: TASK, checkpointId: CHECKPOINT, householdId: 'family-local', actorPlayerId: ACTOR,
    project: 'mastermind', intent: 'Original task', summary: 'Candidate tested', state: 'active', completedItems: [], openItems: [], blockers: [], expectedRevision: 5 };
  await store.appendCheckpoint(input); await store.appendCheckpoint(input);
  assert.match(calls[0].statement, /append_mastermind_context_checkpoint_v2\(/);
  assert.equal(calls[0].parameters[12], 5);
  assert.deepEqual(calls[0], calls[1]);
  const { expectedRevision, ...legacy } = input;
  await store.appendCheckpoint(legacy);
  assert.match(calls[2].statement, /append_mastermind_context_checkpoint_v1\(/);
  assert.equal(calls[2].parameters.length, 12);
  const absent = mockStore([Object.assign(new Error('function does not exist'), { code: '42883' })]);
  await assert.rejects(absent.store.appendCheckpoint(input), { code: 'CHECKPOINT_REVISION_UNAVAILABLE' });
  const stale = mockStore([Object.assign(new Error('private stale database detail'), { code: '40001' })]);
  await assert.rejects(stale.store.appendCheckpoint(input), { code: 'TASK_REVISION_CONFLICT' });
});

test('invalid revision guards do not authorize or append anything', async () => {
  let calls = 0;
  const gateway = new MastermindContextGateway({ identity: IDENTITY, store: { authorizeOperator: async () => { calls++; return true; } } });
  for (const expectedRevision of [-1, null, '5', 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(gateway.checkpoint({ expectedRevision }), { code: 'INVALID_ARGUMENT' });
  }
  assert.equal(calls, 0);
});

test('credential-shaped source material is redacted consistently before either transport returns it', () => {
  const input = { content: `ghp_${'x'.repeat(30)} github_pat_${'y'.repeat(35)} npg_${'z'.repeat(20)}`, authorization: 'fixture', cookie: 'fixture' };
  const clean = sanitizeValue(input);
  assert.doesNotMatch(JSON.stringify(clean), /x{20}|y{20}|z{12}|fixture/);
  assert.match(clean.content, /REDACTED_GITHUB_TOKEN/);
});
