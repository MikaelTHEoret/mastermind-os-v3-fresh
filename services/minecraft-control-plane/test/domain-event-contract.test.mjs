import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as serviceContract from '../src/domain-events/contract.mjs';
import * as sharedContract from '../../../protocol/mastermind-domain-event/contract.mjs';
import {
  MastermindDomainEventError,
  canonicalMastermindDomainEvent,
  createMastermindDomainEvent,
  deterministicMastermindEventId,
  validateMastermindDomainEvent,
} from '../src/domain-events/contract.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(testDirectory, '../../../protocol/mastermind-domain-event/v1.schema.json');
const fixturePath = path.resolve(testDirectory, '../../../protocol/mastermind-domain-event/fixtures/companion-action-completed.v1.json');

async function fixture() {
  return JSON.parse(await fs.readFile(fixturePath, 'utf8'));
}

test('service contract is an identity-preserving re-export of the shared protocol module', async () => {
  assert.deepEqual(Object.keys(serviceContract).sort(), Object.keys(sharedContract).sort());
  for (const name of Object.keys(sharedContract)) {
    assert.strictEqual(serviceContract[name], sharedContract[name], name);
  }
  const value = await fixture();
  assert.deepEqual(sharedContract.validateMastermindDomainEvent(value), value);
  assert.deepEqual(serviceContract.validateMastermindDomainEvent(value), value);
});

function eventError(operation, code) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof MastermindDomainEventError);
    assert.equal(error.code, code);
    return true;
  });
}

test('canonical v1 schema and companion fixture are present and validate strictly', async () => {
  const schema = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
  assert.equal(schema.$id, 'https://mastermind-core.com/protocol/mastermind-domain-event/v1.schema.json');
  assert.match(schema.$schema, /2020-12/);
  assert.match(schema.$comment, /runtime additionally enforces namespace\/reference equality/);
  assert.equal(new RegExp(schema.$defs.payloadPropertyName.allOf[0].pattern).test('resultCode'), true);
  assert.equal(new RegExp(schema.$defs.payloadPropertyName.allOf[0].pattern).test('invalid-key'), false);
  assert.equal(schema.$defs.payloadPropertyName.allOf[1].not.enum.includes('accessToken'), true);
  assert.deepEqual(schema.allOf.map((entry) => entry.then.required[0]), ['sessionId', 'worldRef', 'playerId']);
  const value = await fixture();
  assert.deepEqual(validateMastermindDomainEvent(value), value);
});

test('creator injects deterministic time and id without mutating caller data', () => {
  const input = {
    producer: 'minecraft-control-plane', domain: 'companion', kind: 'session.started',
    namespace: 'session/22222222-2222-4222-8222-222222222222', householdId: 'family-local',
    sessionId: '22222222-2222-4222-8222-222222222222', visibility: 'private', payload: { state: 'ready' },
  };
  const original = structuredClone(input);
  const value = createMastermindDomainEvent(input, {
    now: () => Date.parse('2026-08-14T12:01:02.003Z'),
    randomUUID: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  });
  assert.equal(value.eventId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal(value.occurredAt, '2026-08-14T12:01:02.003Z');
  assert.equal(value.schemaVersion, 1);
  assert.deepEqual(input, original);
});

test('deterministic ids are stable, UUID-shaped, and length-delimited', () => {
  const first = deterministicMastermindEventId(['minecraft-control-plane', 'session', 'action']);
  assert.equal(first, deterministicMastermindEventId(['minecraft-control-plane', 'session', 'action']));
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(first, deterministicMastermindEventId(['minecraft-control-plane', 'session-action']));
  assert.notEqual(deterministicMastermindEventId(['ab', 'c']), deterministicMastermindEventId(['a', 'bc']));
});

test('envelope rejects missing, unknown, malformed, and unsupported fields', async () => {
  const value = await fixture();
  const { producer: _producer, ...missing } = value;
  eventError(() => validateMastermindDomainEvent(missing), 'EVENT_MISSING_FIELD');
  eventError(() => validateMastermindDomainEvent({ ...value, unexpected: true }), 'EVENT_UNKNOWN_FIELD');
  eventError(() => validateMastermindDomainEvent({ ...value, schemaVersion: 2 }), 'EVENT_UNSUPPORTED_VERSION');
  eventError(() => createMastermindDomainEvent({ ...value, schemaVersion: 2 }), 'EVENT_UNSUPPORTED_VERSION');
  eventError(() => validateMastermindDomainEvent({ ...value, occurredAt: '2026-08-14T12:00:00Z' }), 'EVENT_INVALID');
  eventError(() => validateMastermindDomainEvent({ ...value, eventId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' }), 'EVENT_INVALID');
  eventError(() => validateMastermindDomainEvent({ ...value, namespace: 'player/kid' }), 'EVENT_INVALID');
  eventError(() => validateMastermindDomainEvent({ ...value, worldRef: 'world-unsafe' }), 'EVENT_INVALID');
  eventError(() => validateMastermindDomainEvent({ ...value, sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }), 'EVENT_SCOPE_MISMATCH');
  const { sessionId: _sessionId, ...withoutSession } = value;
  eventError(() => validateMastermindDomainEvent({
    ...withoutSession, namespace: 'player/kid/private', playerId: 'someone-else',
  }), 'EVENT_SCOPE_MISMATCH');
});

test('payload accepts bounded JSON but rejects secrets, cycles, non-finite values, and excessive depth or size', async () => {
  const value = await fixture();
  assert.equal(validateMastermindDomainEvent({
    ...value, payload: { nested: { count: 2, values: [true, null, 'ok'] } },
  }).payload.nested.count, 2);
  eventError(() => validateMastermindDomainEvent({ ...value, payload: { accessToken: 'do-not-store' } }), 'EVENT_SENSITIVE_FIELD');
  eventError(() => validateMastermindDomainEvent({ ...value, payload: { api_key: 'do-not-store' } }), 'EVENT_SENSITIVE_FIELD');
  eventError(() => validateMastermindDomainEvent({ ...value, payload: { count: Number.NaN } }), 'EVENT_INVALID');
  const cyclic = {}; cyclic.self = cyclic;
  eventError(() => validateMastermindDomainEvent({ ...value, payload: cyclic }), 'EVENT_INVALID');
  let deep = { value: true };
  for (let index = 0; index < 10; index += 1) deep = { nested: deep };
  eventError(() => validateMastermindDomainEvent({ ...value, payload: deep }), 'EVENT_PAYLOAD_TOO_DEEP');
  const oversized = {};
  for (let index = 0; index < 20; index += 1) oversized[`field${index}`] = 'x'.repeat(4_000);
  eventError(() => validateMastermindDomainEvent({ ...value, payload: oversized }), 'EVENT_TOO_LARGE');
});

test('canonical serialization is stable across caller key ordering', async () => {
  const value = await fixture();
  const reordered = {
    payload: { status: 'succeeded', actionKind: 'skill.navigateTo', resultCode: 'arrived', actionId: value.payload.actionId },
    visibility: value.visibility, correlationId: value.correlationId, sessionId: value.sessionId,
    householdId: value.householdId, namespace: value.namespace, kind: value.kind, domain: value.domain,
    producer: value.producer, occurredAt: value.occurredAt, schemaVersion: value.schemaVersion, eventId: value.eventId,
  };
  assert.equal(canonicalMastermindDomainEvent(value), canonicalMastermindDomainEvent(reordered));
});
