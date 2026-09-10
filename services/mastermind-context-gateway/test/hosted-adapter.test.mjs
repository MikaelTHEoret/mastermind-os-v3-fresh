import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { z } from 'zod';
import { TOOLS } from '../src/tool-catalog.mjs';
import { HOSTED_TOOLS, canonicalHostedConfiguration, createHostedGateway, callHostedTool, hostedToolEnvelope, hostedToolFailure } from '../src/hosted-adapter.mjs';
import { CANONICAL_COLUMNS, inspectCanonicalSchema } from '../src/schema-preflight.mjs';

const ACTOR = '00000000-0000-8000-8000-000000000001';
const ENV = { OWNER_CLERK_USER_ID: 'user_owner', MASTERMIND_MEMORY_HOUSEHOLD_ID: 'family-local', MASTERMIND_MEMORY_OPERATOR_PLAYER_ID: ACTOR };

test('hosted catalog is exactly seven read-only projections of the canonical catalog', () => {
  assert.equal(HOSTED_TOOLS.length, 7);
  for (const tool of HOSTED_TOOLS) {
    assert.equal(tool.annotations.readOnlyHint, true);
    const original = TOOLS.find((value) => value.name === tool.name);
    assert.equal(tool.description, original.description);
    const schema = z.fromJSONSchema(tool.inputSchema);
    assert.equal(schema.safeParse({ householdId: 'attacker' }).success, false);
  }
  assert.equal(HOSTED_TOOLS.some((tool) => /checkpoint|export|minecraft/.test(tool.name)), false);
});

test('hosted configuration has no principal fallback or silent alias translation', () => {
  assert.equal(canonicalHostedConfiguration(ENV).ownerSubject, 'user_owner');
  assert.throws(() => canonicalHostedConfiguration({ ...ENV, OWNER_CLERK_USER_ID: undefined }), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => canonicalHostedConfiguration({ ...ENV, MASTERMIND_OWNER_ID: 'user_other' }), { code: 'OWNER_CONFIGURATION_CONFLICT' });
  assert.throws(() => canonicalHostedConfiguration({ ...ENV, MASTERMIND_MEMORY_OPERATOR_PLAYER_ID: undefined }), { code: 'INVALID_ARGUMENT' });
});

test('authenticated subject and canonical binding are both required before retrieval', async () => {
  const configuration = canonicalHostedConfiguration(ENV);
  const calls = [];
  const store = { authorizeOperator: async () => { calls.push('operator'); return true; },
    resolveClerkOperator: async (subject, identity) => { calls.push(['bind', subject]); return identity; },
    searchMemories: async (_query, options) => { calls.push(['search', options.includeInactive]); return []; } };
  await assert.rejects(createHostedGateway({ store, authenticatedSubject: 'user_other', configuration }), { code: 'OWNER_REQUIRED' });
  assert.deepEqual(calls, []);
  const gateway = await createHostedGateway({ store, authenticatedSubject: 'user_owner', configuration });
  const result = await callHostedTool(gateway, 'mastermind_memory_search', { query: 'hydrate' });
  assert.deepEqual(calls, [['bind', 'user_owner'], 'operator', ['search', false]]);
  assert.equal(result.memoryLifecycle, 'active');
  assert.equal(result.retrieval, 'lexical-rrf');
  await assert.rejects(callHostedTool(gateway, 'mastermind_task_checkpoint', {}), { code: 'TOOL_NOT_AVAILABLE' });
  assert.equal(calls.length, 3);
});

test('hosted calls preserve canonical behavior while bounding only the transport-specific context budget', async () => {
  const calls = [];
  const gateway = { bootstrap: async (input) => { calls.push(input); return input; },
    systemStatus: async () => ({ gateway: { version: 'test', writeCapabilities: ['task_checkpoint'] } }) };
  assert.equal((await callHostedTool(gateway, 'mastermind_bootstrap', { intent: 'hydrate' })).budget, 6000);
  for (const budget of [3999, 12001, '6000']) {
    await assert.rejects(callHostedTool(gateway, 'mastermind_bootstrap', { budget }), { code: 'INVALID_ARGUMENT' });
  }
  assert.equal(calls.length, 1);
  const status = await callHostedTool(gateway, 'mastermind_system_status', {});
  assert.deepEqual(status.gateway.writeCapabilities, []);
  assert.equal(status.gateway.availableTools.length, 7);
});

test('UTF-8 and duplicated compatibility text are byte-bounded; errors never return partial previews or secrets', () => {
  const value = { updatedAt: new Date('2026-09-06T00:00:00Z'), content: 'memory source evidence' };
  const envelope = hostedToolEnvelope(value);
  assert.deepEqual(JSON.parse(envelope.content[0].text), envelope.structuredContent);
  assert.equal(envelope.structuredContent.updatedAt, '2026-09-06T00:00:00.000Z');
  assert.ok(Buffer.byteLength(JSON.stringify(envelope)) < 65536);
  assert.throws(() => hostedToolEnvelope({ content: '😀'.repeat(6100) }), { code: 'RESPONSE_TOO_LARGE' });
  const failure = hostedToolFailure(new Error('database password or OAuth token must stay private'));
  assert.equal(failure.isError, true);
  assert.doesNotMatch(JSON.stringify(failure), /password|OAuth token|preview/);
});

test('preflight reports exact missing canonical fields and legacy stores without migrating or reading private content', async () => {
  const rows = Object.entries(CANONICAL_COLUMNS).flatMap(([tableName, fields]) => fields.map((columnName) => ({ tableName, columnName })));
  const calls = [];
  const sql = { query: async (statement, params) => { calls.push({ statement, params }); return [...rows, { tableName: 'mastermind_tasks', columnName: 'id' }]; } };
  const ready = await inspectCanonicalSchema(sql);
  assert.equal(ready.ready, true);
  assert.equal(ready.migrationApplied, false);
  assert.deepEqual(ready.legacyTaskTablesPresent, ['mastermind_tasks']);
  assert.doesNotMatch(calls[0].statement, /INSERT|UPDATE|DELETE|CREATE|ALTER/i);
  const missing = await inspectCanonicalSchema({ query: async () => rows.filter((row) => row.columnName !== 'memory_status') });
  assert.equal(missing.ready, false);
  assert.deepEqual(missing.missing, ['harmonic_memories.memory_status']);
});

test('prepared replay hardening scopes duplicate receipts before exposing metadata and retains the established function API', async () => {
  const sql = await readFile(new URL('../migrations/owner-replay-v1.sql', import.meta.url), 'utf8');
  const duplicate = sql.slice(sql.indexOf('IF FOUND THEN'), sql.indexOf('  SELECT * INTO v_task', sql.indexOf('    RETURN;')));
  assert.match(duplicate, /v_task.household_id <> p_household_id/);
  assert.match(duplicate, /v_task.actor_player_id <> p_actor_player_id/);
  assert.match(duplicate, /v_task.project_id <> p_project_id/);
  assert.match(duplicate, /v_task.intent <> p_intent/);
  assert.ok(duplicate.indexOf("ERRCODE = '42501'") < duplicate.indexOf('RETURN QUERY SELECT'));
  assert.match(sql, /context-checkpoint\//);
  assert.doesNotMatch(sql, /CREATE TABLE|DROP TABLE|harmonic_memories|transcript_archive/);
});
