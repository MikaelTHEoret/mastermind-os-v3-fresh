import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import { WebSocket } from 'ws';

import {
  FAMILY_CORE_SUBPROTOCOL,
  FamilyCoreBridgeServer,
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
    player: { minecraftUuid: playerId, displayName: 'Kid_Player', role: 'child', identityBound: true },
    text: 'Can you build something?',
  }, { messageId: requestId })));
  await complete;
  assert.deepEqual(frames.map((frame) => frame.type), ['computer.requestStatus', 'computer.private']);
  assert.ok(frames.every((frame) => frame.correlationId === requestId));
  assert.equal(frames[0].payload.status, 'rejected');
  assert.match(frames[1].payload.text, /not enabled/i);
  socket.close();
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
