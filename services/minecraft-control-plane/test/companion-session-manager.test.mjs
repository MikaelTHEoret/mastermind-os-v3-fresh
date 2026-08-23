import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CompanionSessionError,
  CompanionSessionManager,
} from '../src/companion/session-manager.mjs';
import {
  FAMILY_BRIDGE_CAPABILITIES,
  FamilyBridgeProtocolError,
  createFamilyBridgeMessage,
  parseFamilyBridgeMessage,
} from '../src/companion/protocol.mjs';

const sessionId = '11111111-1111-4111-8111-111111111111';
const startedAt = Date.parse('2026-08-13T12:00:00.000Z');

class FakeSocket {
  sent = [];
  closes = [];
  throwOnSend = false;

  send(value) {
    if (this.throwOnSend) throw new Error('socket closed');
    this.sent.push(value);
  }

  close(code, reason) {
    this.closes.push({ code, reason });
  }
}

function clientMessage({ type, payload, seq, messageId, sentAt = '2026-08-13T12:00:00.000Z' }) {
  return JSON.stringify(createFamilyBridgeMessage({
    sessionId,
    seq,
    source: 'family-agent-bridge',
    type,
    payload,
    sentAt,
    messageId,
  }));
}

function hello(seq = 1, overrides = {}) {
  return clientMessage({
    type: 'bridge.hello',
    seq,
    messageId: '22222222-2222-4222-8222-222222222222',
    payload: {
      clientId: 'family-ai-client',
      pid: 4242,
      bridgeVersion: '0.1.0',
      minecraftVersion: '26.2',
      loaderVersion: '0.19.3',
      baritoneVersion: '1.12.0',
      capabilities: [...FAMILY_BRIDGE_CAPABILITIES],
      ...overrides,
    },
  });
}

async function readyManager(options = {}) {
  let now = options.now ?? startedAt;
  const manager = new CompanionSessionManager({
    now: () => now,
    helloTimeoutMs: 1_000,
    heartbeatIntervalMs: 250,
    heartbeatTimeoutMs: 750,
    snapshotIntervalMs: 250,
    verifyHello: async () => true,
    ...options.managerOptions,
  });
  const socket = new FakeSocket();
  manager.attachConnection(socket, { sessionId, expectedPid: 4242 });
  await manager.receive(hello());
  return { manager, socket, setNow(value) { now = value; } };
}

function controlMessages(socket) {
  return socket.sent.map((value) => parseFamilyBridgeMessage(value, { direction: 'control', expectedSessionId: sessionId }));
}

async function synchronizeInWorld(manager) {
  await manager.receive(clientMessage({
    type: 'bridge.heartbeat', seq: 2, messageId: '13131313-1313-4313-8313-131313131313',
    payload: { clientTick: 20, phase: 'in-world', activeActionId: null, killSwitch: false },
  }));
  await manager.receive(clientMessage({
    type: 'state.snapshot', seq: 3, messageId: '14141414-1414-4414-8414-141414141414',
    payload: {
      snapshotId: '15151515-1515-4515-8515-151515151515', clientTick: 20, phase: 'in-world',
      serverAlias: 'family-server',
      player: {
        position: { x: 1, y: 64, z: 2 }, velocity: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0,
        health: 20, maxHealth: 20, hunger: 20, armor: 0, dimension: 'minecraft:overworld',
      },
      world: { timeOfDay: 1000, weather: 'clear' },
      baritone: { state: 'idle', activeSkill: null, goal: null }, activeAction: null,
      safety: { killSwitch: false },
    },
  }));
}

test('handshake is server-led, verifies process/capabilities, and reaches one ready session', async () => {
  const verified = [];
  const manager = new CompanionSessionManager({
    now: () => startedAt,
    helloTimeoutMs: 1_000,
    heartbeatIntervalMs: 250,
    heartbeatTimeoutMs: 750,
    snapshotIntervalMs: 250,
    verifyHello: async (payload, context) => {
      verified.push({ payload, context });
      return true;
    },
  });
  const socket = new FakeSocket();
  assert.equal(manager.attachConnection(socket, { sessionId, expectedPid: 4242 }).state, 'handshaking');
  assert.equal(controlMessages(socket)[0].type, 'control.hello');

  const accepted = await manager.receive(hello());
  assert.deepEqual(accepted, { accepted: true, type: 'bridge.hello' });
  assert.equal(manager.status().state, 'syncing');
  assert.equal(controlMessages(socket)[1].type, 'control.ready');
  assert.equal(verified[0].context.expectedPid, 4242);
  assert.equal(verified[0].payload.clientId, 'family-ai-client');

  assert.throws(() => manager.attachConnection(new FakeSocket(), { sessionId }), (error) => (
    error instanceof CompanionSessionError && error.code === 'COMPANION_SESSION_ACTIVE'
  ));
});

test('handshake rejects wrong process identity, missing capabilities, and non-first hello', async () => {
  for (const input of [
    hello(1, { pid: 9999 }),
    hello(1, { capabilities: ['state.snapshot'] }),
    clientMessage({
      type: 'bridge.heartbeat', seq: 1, messageId: '99999999-9999-4999-8999-999999999999',
      payload: { clientTick: 0, phase: 'main-menu', activeActionId: null, killSwitch: false },
    }),
  ]) {
    const manager = new CompanionSessionManager({
      now: () => startedAt,
      helloTimeoutMs: 1_000,
      heartbeatIntervalMs: 250,
      heartbeatTimeoutMs: 750,
      snapshotIntervalMs: 250,
      verifyHello: async () => true,
    });
    manager.attachConnection(new FakeSocket(), { sessionId, expectedPid: 4242 });
    await assert.rejects(manager.receive(input), FamilyBridgeProtocolError);
  }
});

test('heartbeat and bounded state snapshots update the sanitized latest session state', async () => {
  const { manager } = await readyManager();
  await manager.receive(clientMessage({
    type: 'bridge.heartbeat', seq: 2, messageId: '33333333-3333-4333-8333-333333333333',
    payload: { clientTick: 20, phase: 'in-world', activeActionId: null, killSwitch: false },
  }));
  await manager.receive(clientMessage({
    type: 'state.snapshot', seq: 3, messageId: '44444444-4444-4444-8444-444444444444',
    payload: {
      snapshotId: '55555555-5555-4555-8555-555555555555',
      clientTick: 20,
      phase: 'in-world',
      serverAlias: 'family-server',
      player: {
        position: { x: 1, y: 64, z: 2 }, velocity: { x: 0, y: 0, z: 0 },
        yaw: 0, pitch: 0, health: 20, maxHealth: 20, hunger: 20, armor: 0,
        dimension: 'minecraft:overworld',
      },
      world: { timeOfDay: 1000, weather: 'clear' },
      baritone: { state: 'idle', activeSkill: null, goal: null },
      activeAction: null,
      safety: { killSwitch: false },
    },
  }));
  const status = manager.status();
  assert.equal(status.lastHeartbeatAt, '2026-08-13T12:00:00.000Z');
  assert.equal(status.latestSnapshot.player.dimension, 'minecraft:overworld');
  assert.equal(status.latestSnapshot.player.position.y, 64);
});

test('actions require synchronized Family Server state and the local kill switch closes the session', async () => {
  const { manager, socket } = await readyManager();
  assert.equal(manager.status().state, 'syncing');
  assert.throws(() => manager.dispatchAction({ kind: 'direct.jump', args: {} }), (error) => (
    error instanceof CompanionSessionError && error.code === 'COMPANION_NOT_SYNCHRONIZED'
  ));
  await synchronizeInWorld(manager);
  assert.equal(manager.status().state, 'ready');
  const action = manager.dispatchAction({ kind: 'direct.jump', args: {} });
  await manager.receive(clientMessage({
    type: 'bridge.heartbeat', seq: 4, messageId: '16161616-1616-4616-8616-161616161616',
    payload: { clientTick: 21, phase: 'in-world', activeActionId: action.actionId, killSwitch: true },
  }));
  assert.deepEqual(socket.closes, [{ code: 4403, reason: 'kill-switch-active' }]);
  assert.equal(manager.status().state, 'disconnected');
  assert.equal(manager.status().activeAction, null);
});

test('stale snapshots and leaving the managed server revoke action readiness', async () => {
  const { manager, setNow } = await readyManager();
  await synchronizeInWorld(manager);
  setNow(startedAt + 751);
  await manager.receive(clientMessage({
    type: 'bridge.heartbeat', seq: 4, messageId: '17171717-1717-4717-8717-171717171717',
    payload: { clientTick: 30, phase: 'in-world', activeActionId: null, killSwitch: false },
  }));
  assert.equal(manager.status().state, 'syncing');
  assert.throws(() => manager.dispatchAction({ kind: 'direct.jump', args: {} }), (error) => (
    error instanceof CompanionSessionError && error.code === 'COMPANION_NOT_SYNCHRONIZED'
  ));
  await manager.receive(clientMessage({
    type: 'state.snapshot', seq: 5, messageId: '18181818-1818-4818-8818-181818181818',
    payload: {
      snapshotId: '19191919-1919-4919-8919-191919191919', clientTick: 30, phase: 'main-menu',
      serverAlias: null, player: null, world: null,
      baritone: { state: 'idle', activeSkill: null, goal: null }, activeAction: null,
      safety: { killSwitch: false },
    },
  }));
  assert.equal(manager.status().state, 'syncing');
});

test('world exit or stale state terminates an already-running action session', async () => {
  for (const mode of ['world-exit', 'stale']) {
    const { manager, socket, setNow } = await readyManager({ managerOptions: { heartbeatTimeoutMs: 2_000 } });
    await synchronizeInWorld(manager);
    const action = manager.dispatchAction({ kind: 'skill.explore', args: { radius: 64 } });
    await manager.receive(clientMessage({
      type: 'action.status', seq: 4, messageId: '20202020-2020-4020-8020-202020202020',
      payload: { actionId: action.actionId, status: 'started' },
    }));
    if (mode === 'world-exit') {
      await manager.receive(clientMessage({
        type: 'bridge.heartbeat', seq: 5, messageId: '21212121-2121-4121-8121-212121212121',
        payload: { clientTick: 21, phase: 'main-menu', activeActionId: action.actionId, killSwitch: false },
      }));
    } else {
      setNow(startedAt + 751);
      manager.checkLiveness();
    }
    assert.deepEqual(socket.closes, [{ code: 4408, reason: 'family-state-lost' }]);
    assert.equal(manager.status().activeAction, null);
  }
});

test('respawn tolerates the expected world transition without weakening liveness', async () => {
  const { manager, socket, setNow } = await readyManager();
  await synchronizeInWorld(manager);
  const action = manager.dispatchAction({ kind: 'direct.respawn', args: {} });
  await manager.receive(clientMessage({
    type: 'action.status', seq: 4, messageId: '22222222-2222-4222-8222-222222222223',
    payload: { actionId: action.actionId, status: 'started' },
  }));
  await manager.receive(clientMessage({
    type: 'bridge.heartbeat', seq: 5, messageId: '22222222-2222-4222-8222-222222222224',
    payload: { clientTick: 21, phase: 'main-menu', activeActionId: action.actionId, killSwitch: false },
  }));
  await manager.receive(clientMessage({
    type: 'state.snapshot', seq: 6, messageId: '22222222-2222-4222-8222-222222222225',
    payload: {
      snapshotId: '22222222-2222-4222-8222-222222222226', clientTick: 21, phase: 'main-menu',
      serverAlias: null, player: null, world: null,
      baritone: { state: 'idle', activeSkill: null, goal: null }, activeAction: null,
      safety: { killSwitch: false },
    },
  }));
  assert.deepEqual(socket.closes, []);
  assert.equal(manager.status().state, 'syncing');
  assert.equal(manager.status().activeAction.actionId, action.actionId);

  await manager.receive(clientMessage({
    type: 'action.status', seq: 7, messageId: '22222222-2222-4222-8222-222222222227',
    payload: { actionId: action.actionId, status: 'succeeded', result: { code: 'respawned' } },
  }));
  assert.equal(manager.status().activeAction, null);
  setNow(startedAt + 750);
  manager.checkLiveness();
  assert.deepEqual(socket.closes, []);

  await manager.receive(clientMessage({
    type: 'bridge.heartbeat', seq: 8, messageId: '22222222-2222-4222-8222-222222222229',
    payload: { clientTick: 22, phase: 'in-world', activeActionId: null, killSwitch: false },
  }));
  await manager.receive(clientMessage({
    type: 'state.snapshot', seq: 9, messageId: '22222222-2222-4222-8222-222222222230',
    payload: {
      snapshotId: '22222222-2222-4222-8222-222222222231', clientTick: 22, phase: 'in-world',
      serverAlias: 'family-server',
      player: {
        position: { x: 1, y: 64, z: 2 }, velocity: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0,
        health: 20, maxHealth: 20, hunger: 20, armor: 0, dimension: 'minecraft:overworld',
      },
      world: { timeOfDay: 1000, weather: 'clear' },
      baritone: { state: 'idle', activeSkill: null, goal: null }, activeAction: null,
      safety: { killSwitch: false },
    },
  }));
  assert.equal(manager.status().state, 'ready');

  const stale = await readyManager();
  await synchronizeInWorld(stale.manager);
  const staleAction = stale.manager.dispatchAction({ kind: 'direct.respawn', args: {} });
  await stale.manager.receive(clientMessage({
    type: 'action.status', seq: 4, messageId: '22222222-2222-4222-8222-222222222228',
    payload: { actionId: staleAction.actionId, status: 'started' },
  }));
  stale.setNow(startedAt + 44_999);
  stale.manager.checkLiveness();
  assert.deepEqual(stale.socket.closes, []);
  stale.setNow(startedAt + 45_000);
  stale.manager.checkLiveness();
  assert.deepEqual(stale.socket.closes, [{ code: 4408, reason: 'heartbeat-timeout' }]);
  assert.equal(stale.manager.status().activeAction, null);
});

test('no new action can be dispatched after graceful shutdown begins', async () => {
  const { manager } = await readyManager();
  await synchronizeInWorld(manager);
  manager.requestShutdown(5_000);
  assert.throws(() => manager.dispatchAction({ kind: 'direct.jump', args: {} }), (error) => (
    error instanceof CompanionSessionError && error.code === 'SHUTDOWN_PENDING'
  ));
});

test('conversation remains a non-physical side channel while one foreground task runs', async () => {
  const { manager } = await readyManager();
  await synchronizeInWorld(manager);
  const physical = manager.dispatchAction({ kind: 'skill.explore', args: { radius: 64 } });
  const speech = manager.dispatchAction({ kind: 'direct.say', args: { text: 'I am still exploring.' } });
  assert.equal(manager.status().activeAction.actionId, physical.actionId);
  assert.equal(speech.kind, 'direct.say');
  assert.throws(() => manager.dispatchAction({ kind: 'direct.jump', args: {} }), (error) => (
    error instanceof CompanionSessionError && error.code === 'COMPANION_BUSY'
  ));
});

test('socket send failures cannot strand an action or shutdown mutation', async () => {
  const first = await readyManager();
  await synchronizeInWorld(first.manager);
  first.socket.throwOnSend = true;
  assert.throws(() => first.manager.dispatchAction({ kind: 'direct.jump', args: {} }), /socket closed/);
  assert.equal(first.manager.status().activeAction, null);

  const second = await readyManager();
  await synchronizeInWorld(second.manager);
  second.socket.throwOnSend = true;
  assert.throws(() => second.manager.requestShutdown(5_000), /socket closed/);
  assert.equal(second.manager.status().pendingShutdown, null);
});

test('one action runs at a time with strict started, progress, terminal, and cancellation transitions', async () => {
  const { manager, socket } = await readyManager();
  await synchronizeInWorld(manager);
  const action = manager.dispatchAction({
    kind: 'skill.navigateTo', args: { x: 10, y: 64, z: 20, tolerance: 2 },
  }, { timeoutMs: 5_000 });
  assert.equal(action.status, 'dispatched');
  assert.equal(controlMessages(socket).at(-1).type, 'action.execute');
  assert.throws(() => manager.dispatchAction({ kind: 'direct.jump', args: {} }), (error) => (
    error instanceof CompanionSessionError && error.code === 'COMPANION_BUSY'
  ));

  await manager.receive(clientMessage({
    type: 'action.status', seq: 4, messageId: '66666666-6666-4666-8666-666666666666',
    payload: { actionId: action.actionId, status: 'started' },
  }));
  await manager.receive(clientMessage({
    type: 'action.status', seq: 5, messageId: '77777777-7777-4777-8777-777777777777',
    payload: { actionId: action.actionId, status: 'progress', progress: { phase: 'pathing', percent: 30 } },
  }));

  const firstCancel = manager.cancelAction(action.actionId);
  const secondCancel = manager.cancelAction(action.actionId);
  assert.equal(firstCancel.alreadyRequested, false);
  assert.equal(secondCancel.alreadyRequested, true);
  assert.equal(controlMessages(socket).filter((message) => message.type === 'action.cancel').length, 1);

  await manager.receive(clientMessage({
    type: 'action.status', seq: 6, messageId: '88888888-8888-4888-8888-888888888888',
    payload: { actionId: action.actionId, status: 'cancelled', cancellation: { reason: 'operator' } },
  }));
  assert.equal(manager.status().activeAction, null);
  const terminalCancel = manager.cancelAction(action.actionId);
  assert.equal(terminalCancel.alreadyTerminal, true);
  assert.equal(manager.dispatchAction({ kind: 'direct.jump', args: {} }).kind, 'direct.jump');
});

test('action progress cannot reverse and terminal actions cannot transition twice', async () => {
  const { manager } = await readyManager();
  await synchronizeInWorld(manager);
  const action = manager.dispatchAction({ kind: 'direct.moveFor', args: {
    forward: 1, strafe: 0, durationMs: 100, sprint: false, sneak: false,
  } });
  await manager.receive(clientMessage({
    type: 'action.status', seq: 4, messageId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    payload: { actionId: action.actionId, status: 'started' },
  }));
  await manager.receive(clientMessage({
    type: 'action.status', seq: 5, messageId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    payload: { actionId: action.actionId, status: 'progress', progress: { phase: 'moving', percent: 60 } },
  }));
  await assert.rejects(manager.receive(clientMessage({
    type: 'action.status', seq: 6, messageId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    payload: { actionId: action.actionId, status: 'progress', progress: { phase: 'moving', percent: 20 } },
  })), (error) => error instanceof FamilyBridgeProtocolError && error.code === 'ACTION_PROGRESS_REVERSED');
});

test('deadlines request typed cancellation and disconnect makes the active action terminal without replay', async () => {
  const { manager, socket, setNow } = await readyManager();
  await synchronizeInWorld(manager);
  const action = manager.dispatchAction({ kind: 'direct.jump', args: {} }, { timeoutMs: 500 });
  await manager.receive(clientMessage({
    type: 'action.status', seq: 4, messageId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    payload: { actionId: action.actionId, status: 'started' },
  }));
  setNow(startedAt + 501);
  manager.checkLiveness();
  const cancel = controlMessages(socket).at(-1);
  assert.equal(cancel.type, 'action.cancel');
  assert.equal(cancel.payload.reason, 'deadline');

  manager.disconnect(socket, { code: 1006, reason: 'network-lost' });
  assert.equal(manager.status().activeAction, null);
  assert.equal(manager.status().state, 'disconnected');

  const replacement = new FakeSocket();
  manager.attachConnection(replacement, { sessionId, expectedPid: 4242 });
  await manager.receive(hello());
  assert.deepEqual(controlMessages(replacement).map((message) => message.type), ['control.hello', 'control.ready']);
});

test('an unacknowledged cancellation closes the session and cannot leave it permanently busy', async () => {
  const { manager, socket, setNow } = await readyManager({ managerOptions: { cancelAckTimeoutMs: 250 } });
  await synchronizeInWorld(manager);
  const action = manager.dispatchAction({ kind: 'direct.jump', args: {} });
  await manager.receive(clientMessage({
    type: 'action.status', seq: 4, messageId: 'abababab-abab-4bab-8bab-abababababab',
    payload: { actionId: action.actionId, status: 'started' },
  }));
  manager.cancelAction(action.actionId);
  setNow(startedAt + 251);
  manager.checkLiveness();
  assert.deepEqual(socket.closes, [{ code: 4408, reason: 'action-cancel-timeout' }]);
  assert.equal(manager.status().state, 'disconnected');
  assert.equal(manager.status().activeAction, null);
});

test('hello and heartbeat deadlines close stale sessions fail-closed', async () => {
  let now = startedAt;
  const handshaking = new CompanionSessionManager({
    now: () => now, helloTimeoutMs: 1_000, heartbeatIntervalMs: 250, heartbeatTimeoutMs: 750, snapshotIntervalMs: 250,
    verifyHello: async () => true,
  });
  const helloSocket = new FakeSocket();
  handshaking.attachConnection(helloSocket, { sessionId });
  now += 1_000;
  handshaking.checkLiveness();
  assert.deepEqual(helloSocket.closes, [{ code: 4408, reason: 'hello-timeout' }]);
  assert.equal(handshaking.status().state, 'disconnected');

  const ready = await readyManager();
  ready.setNow(startedAt + 750);
  ready.manager.checkLiveness();
  assert.deepEqual(ready.socket.closes, [{ code: 4408, reason: 'heartbeat-timeout' }]);
  assert.equal(ready.manager.status().state, 'disconnected');
});

test('message sequence is contiguous and shutdown is typed and acknowledged', async () => {
  const { manager, socket } = await readyManager();
  await assert.rejects(manager.receive(clientMessage({
    type: 'bridge.heartbeat', seq: 3, messageId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    payload: { clientTick: 1, phase: 'main-menu', activeActionId: null, killSwitch: false },
  })), (error) => error instanceof FamilyBridgeProtocolError && error.code === 'SEQUENCE_VIOLATION');

  const shutdown = manager.requestShutdown(5_000);
  assert.equal(controlMessages(socket).at(-1).type, 'client.shutdown');
  await manager.receive(clientMessage({
    type: 'client.shutdownAck', seq: 2, messageId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    payload: { shutdownId: shutdown.shutdownId, accepted: true },
  }));
  assert.equal(manager.status().pendingShutdown.acknowledgedAt, '2026-08-13T12:00:00.000Z');
});

test('shutdown deadline closes sessions that ignore or only acknowledge without exiting', async () => {
  for (const acknowledge of [false, true]) {
    const { manager, socket, setNow } = await readyManager({ managerOptions: { heartbeatTimeoutMs: 2_000 } });
    const shutdown = manager.requestShutdown(1_000);
    if (acknowledge) {
      await manager.receive(clientMessage({
        type: 'client.shutdownAck', seq: 2, messageId: '12121212-1212-4212-8212-121212121212',
        payload: { shutdownId: shutdown.shutdownId, accepted: true },
      }));
    }
    setNow(startedAt + 1_001);
    manager.checkLiveness();
    assert.deepEqual(socket.closes, [{ code: 4408, reason: 'client-shutdown-timeout' }]);
    assert.equal(manager.status().state, 'disconnected');
    assert.equal(manager.status().pendingShutdown, null);
  }
});
