import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
  FAMILY_CORE_MAX_PAYLOAD_BYTES,
  FamilyCoreProtocolError,
  FamilyCoreSequenceGuard,
  createFamilyCoreMessage,
  parseFamilyCoreMessage,
  validateFamilyCoreMessage,
} from '../src/family-core/index.mjs';

const IDS = Object.freeze({
  message: '01919a62-8e84-7c6b-8eb0-4f79592f3abe',
  session: '01919a62-8e84-7c6b-8eb0-4f79592f3abf',
  instance: '01919a62-8e84-7c6b-8eb0-4f79592f3ac0',
  player: '01919a62-8e84-7c6b-8eb0-4f79592f3ac1',
  correlation: '01919a62-8e84-7c6b-8eb0-4f79592f3ac2',
});

function serverMessage(overrides = {}) {
  return {
    protocol: 'mastermind.family-core',
    version: 1,
    messageId: IDS.message,
    sessionId: IDS.session,
    seq: 1,
    sentAt: '2026-08-21T12:00:00.000Z',
    source: 'family-core',
    type: 'server.hello',
    correlationId: null,
    payload: {
      serverId: 'family-server',
      instanceId: IDS.instance,
      modVersion: '0.1.0',
      minecraftVersion: '26.2',
      capabilities: [],
      commandEnabled: false,
    },
    ...overrides,
  };
}

test('validates server hello with the skeleton command explicitly disabled', () => {
  const message = validateFamilyCoreMessage(serverMessage(), { direction: 'server', expectedSessionId: IDS.session });
  assert.equal(message.payload.commandEnabled, false);
  assert.deepEqual(message.payload.capabilities, []);
});

test('shared protocol fixtures parse in their declared directions', async () => {
  const fixtureRoot = new URL('../../../protocol/family-core/fixtures/', import.meta.url);
  for (const [name, direction] of [
    ['server-hello.json', 'server'],
    ['chat-received.json', 'server'],
    ['computer-private.json', 'control'],
  ]) {
    const raw = await fs.readFile(new URL(name, fixtureRoot), 'utf8');
    assert.equal(parseFamilyCoreMessage(raw, { direction }).protocol, 'mastermind.family-core');
  }
});

test('validates bounded untrusted chat and normalized identity', () => {
  const message = serverMessage({
    type: 'chat.received',
    payload: {
      player: { minecraftUuid: IDS.player, displayName: 'Kid_Player', role: 'child', identityBound: true },
      channel: 'public',
      text: 'Alchemist, can you help me?',
    },
  });
  assert.equal(validateFamilyCoreMessage(message, { direction: 'server' }).payload.player.role, 'child');
  assert.throws(
    () => validateFamilyCoreMessage({ ...message, payload: { ...message.payload, text: 'x'.repeat(513) } }, { direction: 'server' }),
    (error) => error instanceof FamilyCoreProtocolError && error.code === 'INVALID_MESSAGE',
  );
});

test('enforces direction, source, session, and unknown-field boundaries', () => {
  assert.throws(
    () => validateFamilyCoreMessage(serverMessage(), { direction: 'control' }),
    (error) => error instanceof FamilyCoreProtocolError && error.code === 'INVALID_SOURCE',
  );
  assert.throws(
    () => validateFamilyCoreMessage(serverMessage(), { direction: 'server', expectedSessionId: IDS.player }),
    (error) => error instanceof FamilyCoreProtocolError && error.code === 'SESSION_MISMATCH',
  );
  assert.throws(
    () => validateFamilyCoreMessage({ ...serverMessage(), extra: true }, { direction: 'server' }),
    (error) => error instanceof FamilyCoreProtocolError && error.code === 'UNKNOWN_FIELD',
  );
});

test('strict parser rejects duplicate JSON keys and oversized wire payloads', () => {
  const valid = JSON.stringify(serverMessage());
  const duplicate = valid.replace('"version":1', '"version":1,"version":1');
  assert.throws(
    () => parseFamilyCoreMessage(duplicate, { direction: 'server' }),
    (error) => error instanceof FamilyCoreProtocolError && error.code === 'DUPLICATE_FIELD',
  );
  assert.throws(
    () => parseFamilyCoreMessage(' '.repeat(FAMILY_CORE_MAX_PAYLOAD_BYTES + 1), { direction: 'server' }),
    (error) => error instanceof FamilyCoreProtocolError && error.code === 'PAYLOAD_TOO_LARGE' && error.closeCode === 1009,
  );
});

test('sequence guard rejects replay and reordering', () => {
  const guard = new FamilyCoreSequenceGuard();
  guard.accept(serverMessage({ seq: 1 }));
  guard.accept(serverMessage({ seq: 3 }));
  assert.throws(
    () => guard.accept(serverMessage({ seq: 2 })),
    (error) => error instanceof FamilyCoreProtocolError && error.code === 'REPLAY_OR_REORDER',
  );
});

test('creates private Computer messages with correlation and bounded content', () => {
  const message = createFamilyCoreMessage({
    sessionId: IDS.session,
    seq: 2,
    source: 'control-plane',
    type: 'computer.private',
    correlationId: IDS.correlation,
    messageId: IDS.message,
    sentAt: '2026-08-21T12:00:01.000Z',
    payload: { minecraftUuid: IDS.player, text: 'Approval details remain private.' },
  });
  assert.equal(message.type, 'computer.private');
  assert.equal(message.correlationId, IDS.correlation);
});

test('admin operations are allowlisted and digest-bound', () => {
  const base = {
    protocol: 'mastermind.family-core',
    version: 1,
    messageId: IDS.message,
    sessionId: IDS.session,
    seq: 1,
    sentAt: '2026-08-21T12:00:00.000Z',
    source: 'control-plane',
    type: 'admin.execute',
    correlationId: IDS.correlation,
    payload: {
      operationId: IDS.instance,
      operation: 'status.query',
      arguments: {},
      approvalDigest: 'a'.repeat(64),
      expiresAt: '2026-08-21T12:05:00.000Z',
    },
  };
  assert.equal(validateFamilyCoreMessage(base, { direction: 'control' }).payload.operation, 'status.query');
  assert.throws(
    () => validateFamilyCoreMessage({ ...base, payload: { ...base.payload, operation: 'command.raw' } }, { direction: 'control' }),
    (error) => error instanceof FamilyCoreProtocolError && error.code === 'INVALID_MESSAGE',
  );
});
