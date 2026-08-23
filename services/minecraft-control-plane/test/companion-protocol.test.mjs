import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  FAMILY_BRIDGE_ACTION_KINDS,
  FAMILY_BRIDGE_MAX_PAYLOAD_BYTES,
  FamilyBridgeProtocolError,
  createFamilyBridgeMessage,
  parseFamilyBridgeMessage,
  validateFamilyBridgeAction,
  validateFamilyBridgeMessage,
} from '../src/companion/protocol.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixtureDirectory = path.resolve(testDirectory, '../../../protocol/family-bridge/fixtures');
const schemaPath = path.resolve(testDirectory, '../../../protocol/family-bridge/v1.schema.json');
const sessionId = '11111111-1111-4111-8111-111111111111';

async function fixture(name) {
  return JSON.parse(await fs.readFile(path.join(fixtureDirectory, name), 'utf8'));
}

function expectProtocolError(operation, code) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof FamilyBridgeProtocolError);
    assert.equal(error.code, code);
    return true;
  });
}

test('canonical v1 schema and cross-runtime fixtures are present and parse strictly', async () => {
  const schema = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
  assert.equal(schema.$id, 'https://mastermind-core.com/protocol/family-bridge/v1.schema.json');
  assert.match(schema.$schema, /2020-12/);

  const hello = await fixture('bridge-hello.v1.json');
  const snapshot = await fixture('state-snapshot.v1.json');
  const action = await fixture('action-execute.v1.json');
  assert.equal(validateFamilyBridgeMessage(hello, { direction: 'client', expectedSessionId: sessionId }).type, 'bridge.hello');
  assert.equal(parseFamilyBridgeMessage(JSON.stringify(snapshot), { direction: 'client', expectedSessionId: sessionId }).type, 'state.snapshot');
  assert.equal(parseFamilyBridgeMessage(Buffer.from(JSON.stringify(action)), { direction: 'control', expectedSessionId: sessionId }).type, 'action.execute');
});

test('envelopes reject unknown fields, wrong direction, session mismatch, and unsupported versions', async () => {
  const source = await fixture('bridge-hello.v1.json');
  expectProtocolError(() => validateFamilyBridgeMessage({ ...source, unexpected: true }, { direction: 'client' }), 'UNKNOWN_FIELD');
  expectProtocolError(() => validateFamilyBridgeMessage(source, { direction: 'control' }), 'INVALID_SOURCE');
  expectProtocolError(() => validateFamilyBridgeMessage(source, {
    direction: 'client', expectedSessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  }), 'SESSION_MISMATCH');
  expectProtocolError(() => validateFamilyBridgeMessage({ ...source, version: 2 }, { direction: 'client' }), 'UNSUPPORTED_VERSION');
  expectProtocolError(() => validateFamilyBridgeMessage({
    ...source, payload: { ...source.payload, executable: 'java.exe' },
  }, { direction: 'client' }), 'UNKNOWN_FIELD');
});

test('wire parsing rejects invalid JSON and oversized payloads before decoding', () => {
  expectProtocolError(() => parseFamilyBridgeMessage('{', { direction: 'client' }), 'INVALID_JSON');
  const duplicate = '{"protocol":"mastermind.family-bridge","version":1,"messageId":"22222222-2222-4222-8222-222222222222","sessionId":"11111111-1111-4111-8111-111111111111","seq":1,"sentAt":"2026-08-13T12:00:00.000Z","source":"family-agent-bridge","type":"bridge.hello","payload":{"clientId":"family-ai-client","clientId":"family-ai-client"}}';
  expectProtocolError(() => parseFamilyBridgeMessage(duplicate, { direction: 'client' }), 'DUPLICATE_FIELD');
  const escapedDuplicate = '{"protocol":"mastermind.family-bridge","vers\\u0069on":1,"version":1}';
  expectProtocolError(() => parseFamilyBridgeMessage(escapedDuplicate, { direction: 'client' }), 'DUPLICATE_FIELD');
  expectProtocolError(() => parseFamilyBridgeMessage(Buffer.alloc(FAMILY_BRIDGE_MAX_PAYLOAD_BYTES + 1, 0x20), {
    direction: 'client',
  }), 'PAYLOAD_TOO_LARGE');
});

test('the action union accepts only bounded typed direct actions and Baritone skills', () => {
  const actions = [
    { kind: 'direct.say', args: { text: 'Hello family' } },
    { kind: 'direct.respawn', args: {} },
    { kind: 'direct.lookAt', args: { x: 1, y: 64, z: 2, durationMs: 250 } },
    { kind: 'direct.lookDelta', args: { yawDelta: 15, pitchDelta: -4, durationMs: 100 } },
    { kind: 'direct.moveFor', args: { forward: 1, strafe: 0, durationMs: 500, sprint: true, sneak: false } },
    { kind: 'direct.jump', args: {} },
    { kind: 'direct.attack', args: {} },
    { kind: 'skill.navigateTo', args: { x: 10, y: 64, z: 20, tolerance: 2 } },
    { kind: 'skill.followPlayer', args: { playerUuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', distance: 4 } },
    { kind: 'skill.gatherBlock', args: { blockId: 'minecraft:oak_log', count: 10, maxDistance: 64 } },
    { kind: 'skill.explore', args: { radius: 128 } },
    { kind: 'skill.escapeDanger', args: {} },
    { kind: 'skill.returnToKnownSafePoint', args: { safePointId: 'family-home' } },
  ];
  assert.deepEqual(actions.map((action) => validateFamilyBridgeAction(action).kind), FAMILY_BRIDGE_ACTION_KINDS);
});

test('actions cannot smuggle commands, paths, URLs, raw key names, or unbounded controls', () => {
  const unsafe = [
    { value: { kind: 'direct.say', args: { text: '/op FamilyBot' } }, code: 'UNSAFE_ACTION' },
    { value: { kind: 'direct.moveFor', args: { forward: 1, strafe: 0, durationMs: 60_000, sprint: false, sneak: false } }, code: 'INVALID_MESSAGE' },
    { value: { kind: 'direct.moveFor', args: { forward: 1, strafe: 0, durationMs: 100, sprint: true, sneak: true } }, code: 'INVALID_ACTION' },
    { value: { kind: 'skill.navigateTo', args: { x: 1, y: 2, z: 3, tolerance: 1, command: '#goto 1 2 3' } }, code: 'UNKNOWN_FIELD' },
    { value: { kind: 'skill.gatherBlock', args: { blockId: 'https://example.test/a.jar', count: 1, maxDistance: 8 } }, code: 'INVALID_MESSAGE' },
    { value: { kind: 'direct.jump', args: { key: 'space' } }, code: 'UNKNOWN_FIELD' },
    { value: { kind: 'baritone.command', args: { command: '#mine diamond_ore' } }, code: 'INVALID_MESSAGE' },
  ];
  for (const entry of unsafe) expectProtocolError(() => validateFamilyBridgeAction(entry.value), entry.code);
});

test('action status variants are exact and terminal payloads cannot be ambiguous', () => {
  const base = {
    protocol: 'mastermind.family-bridge', version: 1,
    messageId: '77777777-7777-4777-8777-777777777777', sessionId, seq: 3,
    sentAt: '2026-08-13T12:00:03.000Z', source: 'family-agent-bridge', type: 'action.status',
  };
  const actionId = '66666666-6666-4666-8666-666666666666';
  for (const payload of [
    { actionId, status: 'started' },
    { actionId, status: 'progress', progress: { phase: 'pathing', percent: 25 } },
    { actionId, status: 'succeeded', result: { code: 'arrived' } },
    { actionId, status: 'failed', error: { code: 'path-unavailable', message: 'No safe path was found.' } },
    { actionId, status: 'cancelled', cancellation: { reason: 'operator' } },
  ]) assert.equal(validateFamilyBridgeMessage({ ...base, payload }, { direction: 'client' }).payload.status, payload.status);

  expectProtocolError(() => validateFamilyBridgeMessage({
    ...base, payload: { actionId, status: 'succeeded', result: { code: 'arrived' }, error: { code: 'x', message: 'x' } },
  }, { direction: 'client' }), 'UNKNOWN_FIELD');
});

test('inventory snapshots accept bounded totals and reject duplicates or excess entries', async () => {
  const source = await fixture('state-snapshot.v1.json');
  const withInventory = {
    ...source,
    payload: {
      ...source.payload,
      inventory: { items: [{ itemId: 'minecraft:oak_log', count: 4 }] },
    },
  };
  assert.equal(validateFamilyBridgeMessage(withInventory, {
    direction: 'client', expectedSessionId: sessionId,
  }).payload.inventory.items[0].count, 4);
  expectProtocolError(() => validateFamilyBridgeMessage({
    ...withInventory,
    payload: {
      ...withInventory.payload,
      inventory: { items: [
        { itemId: 'minecraft:oak_log', count: 1 },
        { itemId: 'minecraft:oak_log', count: 2 },
      ] },
    },
  }, { direction: 'client', expectedSessionId: sessionId }), 'INVALID_MESSAGE');
  expectProtocolError(() => validateFamilyBridgeMessage({
    ...withInventory,
    payload: {
      ...withInventory.payload,
      inventory: { items: Array.from({ length: 65 }, (_, index) => ({ itemId: `test:item_${index}`, count: 1 })) },
    },
  }, { direction: 'client', expectedSessionId: sessionId }), 'INVALID_MESSAGE');
});

test('control-plane messages are generated with validated strict payloads', () => {
  const message = createFamilyBridgeMessage({
    sessionId,
    seq: 1,
    source: 'control-plane',
    type: 'control.hello',
    sentAt: '2026-08-13T12:00:00.000Z',
    messageId: '88888888-8888-4888-8888-888888888888',
    payload: {
      supportedVersions: [1],
      helloTimeoutMs: 5_000,
      heartbeatIntervalMs: 2_000,
      heartbeatTimeoutMs: 6_000,
      maxPayloadBytes: 65_536,
    },
  });
  assert.equal(message.type, 'control.hello');
  assert.equal(message.payload.maxPayloadBytes, 65_536);
});
