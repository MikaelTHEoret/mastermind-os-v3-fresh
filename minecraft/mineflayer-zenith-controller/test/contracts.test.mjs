import assert from 'node:assert/strict';
import test from 'node:test';

import { ControllerContractError, parseControllerCommand, parseLaunchEnvelope } from '../src/contracts.mjs';

const UUID = '11111111-1111-4111-8111-111111111111';

test('launch accepts only a loopback pinned-protocol session supplied in memory', () => {
  const launch = parseLaunchEnvelope(JSON.stringify({
    schemaVersion: 1,
    host: '127.0.0.1',
    port: 25568,
    protocolVersion: '1.21.11',
    profile: { name: 'ServicePilot', uuid: UUID },
    accessToken: 'short-lived-test-token',
    holdMillis: 60_000,
  }));
  assert.equal(launch.port, 25568);
  assert.throws(() => parseLaunchEnvelope(JSON.stringify({ ...launch, host: '192.168.1.2' })), ControllerContractError);
  assert.throws(() => parseLaunchEnvelope(JSON.stringify({ ...launch, protocolVersion: '26.2' })), (error) => error.code === 'UNSUPPORTED_PROTOCOL_VERSION');
});

test('controller exposes typed general primitives and rejects arbitrary code or commands', () => {
  assert.equal(parseControllerCommand(JSON.stringify({
    schemaVersion: 1, commandId: UUID, kind: 'container.open',
    args: { x: 1, y: 64, z: 2, expectedBlockId: 'minecraft:furnace' },
  })).kind, 'container.open');
  assert.equal(parseControllerCommand(JSON.stringify({
    schemaVersion: 1, commandId: UUID, kind: 'inventory.transfer',
    args: { direction: 'player-to-container', slotRole: 'fuel', itemId: 'minecraft:coal', count: 2 },
  })).args.slotRole, 'fuel');
  assert.equal(parseControllerCommand(JSON.stringify({
    schemaVersion: 1, commandId: UUID, kind: 'direct.interactBlock',
    args: { blockId: 'minecraft:furnace', x: 1, y: 64, z: 2, hand: 'main' },
  })).args.blockId, 'minecraft:furnace');
  assert.equal(parseControllerCommand(JSON.stringify({
    schemaVersion: 1, commandId: UUID, kind: 'direct.placeBlock',
    args: { blockId: 'minecraft:oak_planks', x: 2, y: 64, z: 2 },
  })).kind, 'direct.placeBlock');
  assert.equal(parseControllerCommand(JSON.stringify({
    schemaVersion: 1, commandId: UUID, kind: 'direct.transferContainer',
    args: {
      blockId: 'minecraft:chest', x: 1, y: 64, z: 2,
      direction: 'player-to-container', slotRole: 'storage', itemId: 'minecraft:coal', count: 1,
    },
  })).kind, 'direct.transferContainer');
  assert.throws(() => parseControllerCommand(JSON.stringify({
    schemaVersion: 1, commandId: UUID, kind: 'javascript.execute', args: { code: 'process.exit()' },
  })), (error) => error.code === 'UNSUPPORTED_CONTROLLER_COMMAND');
  assert.throws(() => parseControllerCommand(JSON.stringify({
    schemaVersion: 1, commandId: UUID, kind: 'direct.say', args: { text: '/op ServicePilot' },
  })), (error) => error.code === 'UNSAFE_CHAT');
});

test('unknown fields and unbounded transfers fail closed', () => {
  assert.throws(() => parseControllerCommand(JSON.stringify({
    schemaVersion: 1, commandId: UUID, kind: 'observe.snapshot', args: {}, surprise: true,
  })), (error) => error.code === 'UNKNOWN_FIELD');
  assert.throws(() => parseControllerCommand(JSON.stringify({
    schemaVersion: 1, commandId: UUID, kind: 'inventory.transfer',
    args: { direction: 'container-to-player', slotRole: 'storage', itemId: 'minecraft:coal', count: 9999 },
  })), (error) => error.code === 'INVALID_NUMBER');
  assert.throws(() => parseControllerCommand(JSON.stringify({
    schemaVersion: 1, commandId: UUID, kind: 'direct.interactBlock',
    args: { blockId: 'minecraft:furnace', x: 1, y: 64, z: 2, hand: 'third' },
  })), (error) => error.code === 'INVALID_HAND');
  assert.throws(() => parseControllerCommand(JSON.stringify({
    schemaVersion: 1, commandId: UUID, kind: 'direct.moveFor',
    args: { forward: 1, strafe: 0, durationMs: 100, sprint: true, sneak: true },
  })), (error) => error.code === 'INVALID_MOVEMENT');
  assert.throws(() => parseControllerCommand(JSON.stringify({
    schemaVersion: 1, commandId: UUID, kind: 'direct.transferContainer',
    args: {
      blockId: 'minecraft:chest', x: 1, y: 64, z: 2,
      direction: 'player-to-container', slotRole: 'storage', itemId: 'minecraft:coal', count: 65,
    },
  })), (error) => error.code === 'INVALID_NUMBER');
});
