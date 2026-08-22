import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WebSocket } from 'ws';

import {
  FAMILY_CORE_SUBPROTOCOL,
  FamilyCoreBridgeServer,
  FamilyCoreCredentialManager,
  FamilyCoreSessionManager,
  createFamilyCoreMessage,
  createSha256FamilyCoreAuthenticator,
  parseFamilyCoreMessage,
  sha256FamilyCoreToken,
} from '../src/family-core/index.mjs';

const TOKEN = 'family_core_test_token_abcdefghijklmnopqrstuvwxyz012345';

function waitFor(target, event) {
  return new Promise((resolve, reject) => {
    const onEvent = (...args) => { cleanup(); resolve(args); };
    const onError = (error) => { cleanup(); reject(error); };
    const cleanup = () => {
      target.off(event, onEvent);
      target.off('error', onError);
    };
    target.once(event, onEvent);
    target.once('error', onError);
  });
}

async function fixture(t, options = {}) {
  const sessionId = crypto.randomUUID();
  const manager = new FamilyCoreSessionManager({
    verifyHello: options.verifyHello ?? (async () => true),
    now: options.now,
    helloTimeoutMs: options.helloTimeoutMs,
    heartbeatTimeoutMs: options.heartbeatTimeoutMs,
    resolvePlayer: options.resolvePlayer,
    onChatReceived: options.onChatReceived,
  });
  const server = http.createServer((request, response) => {
    response.writeHead(404).end();
  });
  const bridge = new FamilyCoreBridgeServer({
    httpServer: server,
    sessionManager: manager,
    authenticate: createSha256FamilyCoreAuthenticator({
      sessionId,
      tokenSha256: sha256FamilyCoreToken(TOKEN),
    }),
    livenessPollMs: 50,
    websocketPingMs: 250,
  });
  bridge.start();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  t.after(async () => {
    await bridge.close();
    await new Promise((resolve) => server.close(resolve));
  });
  return { manager, sessionId, port };
}

function connect(port, token = TOKEN, options = {}) {
  return new WebSocket(`ws://127.0.0.1:${port}/v1/family-core/bridge`, FAMILY_CORE_SUBPROTOCOL, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });
}

function serverMessage(sessionId, seq, type, payload, overrides = {}) {
  return createFamilyCoreMessage({
    sessionId,
    seq,
    source: 'family-core',
    type,
    payload,
    ...overrides,
  });
}

function helloPayload(overrides = {}) {
  return {
    serverId: 'family-server',
    instanceId: crypto.randomUUID(),
    modVersion: '0.3.0',
    minecraftVersion: '26.2',
    capabilities: [],
    commandEnabled: false,
    ...overrides,
  };
}

test('Family Core bridge authenticates a loopback server and enforces hello first', async (t) => {
  const { manager, sessionId, port } = await fixture(t);
  const socket = connect(port);
  await waitFor(socket, 'open');
  const ready = waitFor(manager, 'ready');
  socket.send(JSON.stringify(serverMessage(sessionId, 1, 'server.hello', helloPayload())));
  await ready;
  assert.equal(manager.status().state, 'ready');
  assert.equal(manager.status().server.commandEnabled, false);
  socket.close();
});

test('isolated launch credential authenticates only its exact generated server hello', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-family-core-socket-stage-'));
  const managedRoot = path.join(root, 'managed');
  const directory = path.join(root, 'server');
  await fs.mkdir(directory, { recursive: true });
  const sessionId = '44444444-4444-4444-8444-444444444444';
  const serverInstanceId = '55555555-5555-4555-8555-555555555555';
  const uuids = [sessionId, serverInstanceId];
  const credentials = new FamilyCoreCredentialManager(managedRoot, {
    integrityKey: Buffer.alloc(32, 0x73),
    randomBytes: () => Buffer.alloc(48, 0x41),
    randomUUID: () => uuids.shift(),
  });
  await credentials.initialize();
  const lease = await credentials.prepareLaunch({ id: 'family-server', directory });
  const token = (await fs.readFile(path.join(managedRoot, 'state', 'family-core-bridge', 'server.token'), 'ascii')).trim();
  const manager = new FamilyCoreSessionManager({
    verifyHello: (payload, context) => credentials.verifyHello(payload, context),
  });
  const server = http.createServer((_request, response) => response.writeHead(404).end());
  const bridge = new FamilyCoreBridgeServer({
    httpServer: server,
    sessionManager: manager,
    authenticate: (input) => credentials.authenticate(input),
  });
  bridge.start();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    await bridge.close();
    await new Promise((resolve) => server.close(resolve));
    await lease.release();
    await fs.rm(root, { recursive: true, force: true });
  });

  const socket = connect(server.address().port, token);
  await waitFor(socket, 'open');
  socket.send(JSON.stringify(serverMessage(sessionId, 1, 'server.hello', {
    serverId: 'family-server',
    instanceId: serverInstanceId,
    modVersion: '0.3.0',
    minecraftVersion: '26.2',
    capabilities: [],
    commandEnabled: false,
  })));
  await new Promise((resolve) => manager.once('ready', resolve));
  assert.equal(manager.status().state, 'ready');
  socket.close();
  await waitFor(socket, 'close');
});

test('Family Core bridge rejects invalid bearer credentials and browser origins', async (t) => {
  const { port } = await fixture(t);
  for (const createSocket of [
    () => connect(port, 'wrong_token_that_is_still_long_enough_1234567890'),
    () => connect(port, TOKEN, { headers: { Origin: 'http://127.0.0.1:3000' } }),
  ]) {
    const socket = createSocket();
    const [, response] = await waitFor(socket, 'unexpected-response');
    assert.ok([401, 403].includes(response.statusCode));
    socket.on('error', () => {});
    response.resume();
  }
});

test('Family Core session requires contiguous sequencing and rejects duplicate hello', async (t) => {
  const { manager, sessionId, port } = await fixture(t);
  const socket = connect(port);
  await waitFor(socket, 'open');
  const ready = waitFor(manager, 'ready');
  socket.send(JSON.stringify(serverMessage(sessionId, 1, 'server.hello', helloPayload())));
  await ready;
  const closed = waitFor(socket, 'close');
  socket.send(JSON.stringify(serverMessage(sessionId, 3, 'server.heartbeat', {
    uptimeMs: 1,
    playerCount: 0,
    lastControlSeq: 0,
  })));
  const [code] = await closed;
  assert.equal(code, 4409);
  assert.equal(manager.status().state, 'disconnected');
});

test('unimplemented Computer requests receive explicit private and status rejection frames', async (t) => {
  const { manager, sessionId, port } = await fixture(t);
  const socket = connect(port);
  await waitFor(socket, 'open');
  const ready = waitFor(manager, 'ready');
  socket.send(JSON.stringify(serverMessage(sessionId, 1, 'server.hello', helloPayload({
    capabilities: ['computer.request'],
    commandEnabled: true,
  }))));
  await ready;
  const playerId = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  const frames = [];
  const complete = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for Computer rejection frames')), 2_000);
    socket.on('message', (data) => {
      frames.push(parseFamilyCoreMessage(data, { direction: 'control', expectedSessionId: sessionId }));
      if (frames.length === 2) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
  socket.send(JSON.stringify(serverMessage(sessionId, 2, 'computer.requested', {
    player: { minecraftUuid: playerId, displayName: 'Kid_Player', role: 'guest', identityBound: false },
    text: 'Can you build something?',
  }, { messageId: requestId })));
  await complete;
  assert.deepEqual(frames.map((frame) => frame.type), ['computer.requestStatus', 'computer.private']);
  assert.ok(frames.every((frame) => frame.correlationId === requestId));
  assert.equal(frames[0].payload.status, 'rejected');
  assert.equal(frames[0].payload.message, 'Computer reasoning is not enabled yet.');
  assert.equal(frames[1].payload.text, '[Computer] Help and status are available. Other requests are not enabled yet.');
  socket.close();
});

test('identity events discard server role claims and resolve the authenticated UUID centrally', async (t) => {
  const parentId = crypto.randomUUID();
  const minecraftUuid = crypto.randomUUID();
  const { manager, sessionId, port } = await fixture(t, {
    resolvePlayer: (player) => ({ ...player, playerId: parentId, role: 'parent', identityBound: true }),
  });
  const socket = connect(port);
  await waitFor(socket, 'open');
  const ready = waitFor(manager, 'ready');
  socket.send(JSON.stringify(serverMessage(sessionId, 1, 'server.hello', helloPayload({
    capabilities: ['identity.events'],
  }))));
  await ready;
  const event = waitFor(manager, 'identity-event');
  socket.send(JSON.stringify(serverMessage(sessionId, 2, 'player.joined', {
    player: { minecraftUuid, displayName: 'MISS_LENKA', role: 'guest', identityBound: false },
  })));
  const [joined] = await event;
  assert.equal(joined.type, 'player.joined');
  assert.deepEqual(joined.player, {
    minecraftUuid, displayName: 'MISS_LENKA', playerId: parentId, role: 'parent', identityBound: true,
  });
  assert.equal(manager.status().identities.present, 1);
  assert.equal(manager.status().identities.roles.parent, 1);
  socket.close();
});

test('identity events reject any role asserted by the server mod', async (t) => {
  const { manager, sessionId, port } = await fixture(t);
  const socket = connect(port);
  await waitFor(socket, 'open');
  const ready = waitFor(manager, 'ready');
  socket.send(JSON.stringify(serverMessage(sessionId, 1, 'server.hello', helloPayload({ capabilities: ['identity.events'] }))));
  await ready;
  const closed = waitFor(socket, 'close');
  socket.send(JSON.stringify(serverMessage(sessionId, 2, 'player.joined', {
    player: { minecraftUuid: crypto.randomUUID(), displayName: 'Impostor', role: 'parent', identityBound: true },
  })));
  const [code] = await closed;
  assert.equal(code, 4409);
});

test('chat capture resolves the player centrally and emits no model or response action', async (t) => {
  const parentId = crypto.randomUUID();
  const minecraftUuid = crypto.randomUUID();
  const captured = [];
  const { manager, sessionId, port } = await fixture(t, {
    resolvePlayer: (player) => ({ ...player, playerId: parentId, role: 'parent', identityBound: true }),
    onChatReceived: (event) => { captured.push(event); },
  });
  const socket = connect(port);
  await waitFor(socket, 'open');
  const ready = waitFor(manager, 'ready');
  socket.send(JSON.stringify(serverMessage(sessionId, 1, 'server.hello', helloPayload({
    capabilities: ['chat.capture'],
  }))));
  await ready;
  const received = waitFor(manager, 'chat-received');
  socket.send(JSON.stringify(serverMessage(sessionId, 2, 'chat.received', {
    player: { minecraftUuid, displayName: 'MISS_LENKA', role: 'guest', identityBound: false },
    channel: 'public',
    text: 'Hello Alchemist',
  })));
  const [event] = await received;
  assert.equal(event.text, 'Hello Alchemist');
  assert.equal(event.channel, 'public');
  assert.equal(event.player.playerId, parentId);
  assert.equal(event.player.role, 'parent');
  assert.equal(captured.length, 1);
  assert.equal(manager.status().identities.present, 0);
  socket.close();
});

test('server messages fail closed when their capability was not advertised', async (t) => {
  const { manager, sessionId, port } = await fixture(t);
  const socket = connect(port);
  await waitFor(socket, 'open');
  const ready = waitFor(manager, 'ready');
  socket.send(JSON.stringify(serverMessage(sessionId, 1, 'server.hello', helloPayload())));
  await ready;
  const closed = waitFor(socket, 'close');
  socket.send(JSON.stringify(serverMessage(sessionId, 2, 'chat.received', {
    player: { minecraftUuid: crypto.randomUUID(), displayName: 'Player', role: 'guest', identityBound: false },
    channel: 'public',
    text: 'This must be rejected',
  })));
  const [code] = await closed;
  assert.equal(code, 4409);
});

test('liveness closes a ready Family Core session that stops heartbeating', async (t) => {
  let now = 1_000;
  const { manager, sessionId, port } = await fixture(t, {
    now: () => now,
    heartbeatTimeoutMs: 2_000,
  });
  const socket = connect(port);
  await waitFor(socket, 'open');
  const ready = waitFor(manager, 'ready');
  socket.send(JSON.stringify(serverMessage(sessionId, 1, 'server.hello', helloPayload(), {
    sentAt: new Date(now).toISOString(),
  })));
  await ready;
  const closed = waitFor(socket, 'close');
  now += 2_001;
  manager.checkLiveness();
  const [code] = await closed;
  assert.equal(code, 4408);
});
