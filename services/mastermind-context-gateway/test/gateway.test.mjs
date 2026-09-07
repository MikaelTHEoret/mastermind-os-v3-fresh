import assert from 'node:assert/strict';
import test from 'node:test';

import { MastermindContextGateway } from '../src/context-gateway.mjs';
import { reciprocalRankFusion, diversifyByDocument } from '../src/ranking.mjs';
import { redactText, sanitizeValue } from '../src/validation.mjs';

const ACTOR = '00000000-0000-8000-8000-000000000001';

function fakeStore({ allowed = true } = {}) {
  const calls = [];
  return {
    calls,
    async authorizeOperator() { calls.push('authorize'); return allowed; },
    async pinnedMemories() { calls.push('pinned'); return [{ id: '1', layer: 'identity', content: 'Owner context' }]; },
    async projectState() { calls.push('state'); return { migrationRequired: false, tasks: [] }; },
    async status() { calls.push('status'); return { harmonicMemories: '1301' }; },
    async searchMemories() { calls.push('memory-search'); return [{ id: '2', content: 'Relevant memory' }]; },
    async searchArchive() { calls.push('archive-search'); return [{ address: 'gpt/example#chunk-1', docId: 'gpt/example', content: 'Archive evidence' }]; },
    async searchMinecraftMemories() { calls.push('minecraft-memory-search'); return [{ memoryKey: 'companion-session/v1/example', summary: 'Gathered wood' }]; },
    async fetchArchive() { calls.push('archive-fetch'); return { exact: { address: 'gpt/example#chunk-1', content: 'Exact' }, neighbors: [] }; },
    async appendCheckpoint(input) { calls.push('checkpoint'); return { status: 'applied', taskId: input.taskId, checkpointId: input.checkpointId }; },
    async projectionData() { calls.push('projection'); return { memories: [], tasks: [] }; },
  };
}

function gateway(store) {
  return new MastermindContextGateway({
    store,
    embed: async () => Array.from({ length: 768 }, () => 0),
    projectObsidian: async () => ({ enabled: true, written: 1 }),
    minecraftStatus: async () => ({ reachable: false, actionsEnabled: false }),
    identity: { householdId: 'family-local', actorPlayerId: ACTOR },
  });
}

test('authorization happens before memory candidates are requested', async () => {
  const store = fakeStore({ allowed: false });
  await assert.rejects(gateway(store).searchMemories({ query: 'mastermind' }), { code: 'MEMORY_ACCESS_DENIED' });
  assert.deepEqual(store.calls, ['authorize']);
});

test('context pack is bounded and retains citations', async () => {
  const store = fakeStore();
  const result = await gateway(store).contextPack({ project: 'mastermind', intent: 'resume work', budget: 4000 });
  assert.equal(result.project, 'mastermind');
  assert.equal(result.memories[0].id, '2');
  assert.equal(result.archive[0].address, 'gpt/example#chunk-1');
  assert.ok(result.contextBudget.actualCharacters <= 4000);
  assert.equal(store.calls[0], 'authorize');
});

test('checkpoint generates stable UUID-shaped identifiers and never invokes an action surface', async () => {
  const store = fakeStore();
  const result = await gateway(store).checkpoint({
    project: 'mastermind',
    intent: 'Build persistent context',
    summary: 'Gateway implemented',
    completedItems: ['read path'],
    openItems: ['migration'],
  });
  assert.match(result.taskId, /^[0-9a-f-]{36}$/);
  assert.match(result.checkpointId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(store.calls, ['authorize', 'checkpoint']);
});

test('Minecraft memory search uses authorized semantic rollups, not live snapshots', async () => {
  const store = fakeStore();
  const result = await gateway(store).searchMinecraftMemories({ query: 'gathered wood' });
  assert.equal(result.results[0].memoryKey, 'companion-session/v1/example');
  assert.deepEqual(store.calls, ['authorize', 'minecraft-memory-search']);
});

test('rank fusion combines lexical and dense rankings and document diversity caps repeats', () => {
  const fused = reciprocalRankFusion([
    [{ address: 'a', docId: 'one' }, { address: 'b', docId: 'one' }],
    [{ address: 'b', docId: 'one' }, { address: 'c', docId: 'two' }],
  ], { key: 'address', limit: 3 });
  assert.equal(fused[0].address, 'b');
  assert.deepEqual(diversifyByDocument(fused, 2, 1).map((row) => row.address), ['b', 'c']);
});

test('redaction removes database URLs, API keys, tokens, and secret-valued fields', () => {
  const text = redactText('postgresql://user:pass@example/db sk-proj-abcdefghijklmnop Bearer abcdefghijklmnopqrstuvwxyz');
  assert.doesNotMatch(text, /user:pass|sk-proj|abcdefghijklmnopqrstuvwxyz/);
  const object = sanitizeValue({ apiKey: 'value', nested: { password: 'value' } });
  assert.deepEqual(object, { apiKey: '[REDACTED]', nested: { password: '[REDACTED]' } });
});
