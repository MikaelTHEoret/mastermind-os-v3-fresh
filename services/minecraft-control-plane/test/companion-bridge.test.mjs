import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { WebSocket } from 'ws';
import {
  CompanionBridgeServer,
  createSha256BridgeAuthenticator,
  safeProtocolDiagnostic,
  sha256BridgeToken,
} from '../src/companion/bridge-server.mjs';
import { CompanionSessionManager } from '../src/companion/session-manager.mjs';
import {
  FAMILY_BRIDGE_CAPABILITIES,
  FAMILY_BRIDGE_MAX_PAYLOAD_BYTES,
  FAMILY_BRIDGE_SUBPROTOCOL,
  createFamilyBridgeMessage,
  FamilyBridgeProtocolError,
  parseFamilyBridgeMessage,
} from '../src/companion/protocol.mjs';

const token = 'a'.repeat(64);
const sessionId = '11111111-1111-4111-8111-111111111111';

test('protocol diagnostics expose only a bounded schema location and field', () => {
  const missing = new FamilyBridgeProtocolError('MISSING_FIELD', "bridge.hello.payload omitted required field 'clientId'");
  assert.equal(
    safeProtocolDiagnostic(missing),
    'Family AI bridge rejected a client frame (missing_field; location=bridge.hello.payload; field=clientId).',
  );
  const unsafe = new FamilyBridgeProtocolError('INVALID_MESSAGE', 'secret=do-not-log');
  assert.equal(safeProtocolDiagnostic(unsafe), 'Family AI bridge rejected a client frame (invalid_message).');
  assert.equal(safeProtocolDiagnostic(new Error('secret=do-not-log')), null);
});

function waitForOpen(webSocket) {
  return new Promise((resolve, reject) => {
    webSocket.once('open', resolve);
    webSocket.once('error', reject);
  });
}

function waitForClose(webSocket) {
  return new Promise((resolve) => webSocket.once('close', (code, reason) => resolve({ code, reason: reason.toString('utf8') })));
}

function inbox(webSocket) {
  const queued = [];
  const waiting = [];
  webSocket.on('message', (data) => {
    const value = data.toString('utf8');
    if (waiting.length) waiting.shift()(value);
    else queued.push(value);
  });
  return {
    next() {
      if (queued.length) return Promise.resolve(queued.shift());
      return new Promise((resolve) => waiting.push(resolve));
    },
  };
}

function clientMessage(type, payload, seq, messageId) {
  return JSON.stringify(createFamilyBridgeMessage({
    sessionId,
    seq,
    source: 'family-agent-bridge',
    type,
    payload,
    messageId,
  }));
}

function hello() {
  return clientMessage('bridge.hello', {
    clientId: 'family-ai-client',
    pid: 4242,
    bridgeVersion: '0.1.0',
    minecraftVersion: '26.2',
    loaderVersion: '0.19.3',
    baritoneVersion: '1.12.0',
    capabilities: [...FAMILY_BRIDGE_CAPABILITIES],
  }, 1, '22222222-2222-4222-8222-222222222222');
}

async function createHarness(t, options = {}) {
  const server = http.createServer((_request, response) => {
    response.writeHead(404, { 'Content-Length': '0' });
    response.end();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const manager = new CompanionSessionManager({
    helloTimeoutMs: 1_000,
    heartbeatIntervalMs: 250,
    heartbeatTimeoutMs: 750,
    snapshotIntervalMs: 250,
    verifyHello: async (hello) => hello.bridgeVersion === '0.1.0'
      && hello.minecraftVersion === '26.2'
      && hello.loaderVersion === '0.19.3',
  });
  const bridge = new CompanionBridgeServer({
    httpServer: server,
    sessionManager: manager,
    authenticate: options.authenticate ?? createSha256BridgeAuthenticator({
      sessionId,
      tokenSha256: sha256BridgeToken(token),
      expectedPid: 4242,
    }),
    livenessPollMs: 50,
    websocketPingMs: 1_000,
  }).start();
  const address = server.address();
  const baseUrl = `ws://127.0.0.1:${address.port}`;
  t.after(async () => {
    await bridge.close();
    await new Promise((resolve) => server.close(resolve));
  });
  return { server, manager, bridge, baseUrl };
}

function connect(baseUrl, { bearer = token, protocol = FAMILY_BRIDGE_SUBPROTOCOL, path = '/v1/companion/bridge', headers = {} } = {}) {
  return new WebSocket(`${baseUrl}${path}`, protocol, {
    headers: {
      ...(bearer === null ? {} : { Authorization: `Bearer ${bearer}` }),
      ...headers,
    },
    perMessageDeflate: false,
  });
}

function rejectedUpgrade(baseUrl, options) {
  return new Promise((resolve, reject) => {
    const webSocket = connect(baseUrl, options);
    webSocket.once('unexpected-response', (_request, response) => {
      resolve(response.statusCode);
      response.resume();
    });
    webSocket.once('open', () => reject(new Error('WebSocket upgrade unexpectedly succeeded')));
    webSocket.once('error', () => {});
  });
}

async function connectReady(baseUrl, manager) {
  const webSocket = connect(baseUrl);
  const messages = inbox(webSocket);
  await waitForOpen(webSocket);
  const controlHello = parseFamilyBridgeMessage(await messages.next(), { direction: 'control', expectedSessionId: sessionId });
  assert.equal(controlHello.type, 'control.hello');
  webSocket.send(hello());
  const ready = parseFamilyBridgeMessage(await messages.next(), { direction: 'control', expectedSessionId: sessionId });
  assert.equal(ready.type, 'control.ready');
  const synchronized = new Promise((resolve) => manager.once('snapshot', resolve));
  webSocket.send(clientMessage('bridge.heartbeat', {
    clientTick: 20, phase: 'in-world', activeActionId: null, killSwitch: false,
  }, 2, '13131313-1313-4313-8313-131313131313'));
  webSocket.send(clientMessage('state.snapshot', {
    snapshotId: '15151515-1515-4515-8515-151515151515', clientTick: 20, phase: 'in-world',
    serverAlias: 'family-server',
    player: {
      position: { x: 1, y: 64, z: 2 }, velocity: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0,
      health: 20, maxHealth: 20, hunger: 20, armor: 0, dimension: 'minecraft:overworld',
    },
    world: { timeOfDay: 1000, weather: 'clear' },
    baritone: { state: 'idle', activeSkill: null, goal: null }, activeAction: null,
    safety: { killSwitch: false },
  }, 3, '14141414-1414-4414-8414-141414141414'));
  await synchronized;
  return { webSocket, messages };
}

test('hashed bridge authenticator never needs the raw token in persisted configuration', async () => {
  const digest = sha256BridgeToken(token);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.notEqual(digest, token);
  const authenticate = createSha256BridgeAuthenticator({ sessionId, tokenSha256: digest, expectedPid: 4242 });
  assert.deepEqual(await authenticate({ token }), { sessionId, expectedPid: 4242 });
  assert.equal(await authenticate({ token: 'b'.repeat(64) }), null);
  assert.throws(() => sha256BridgeToken('short'));
});

test('upgrade is exact-loopback, bearer-authenticated, originless, and subprotocol-pinned', async (t) => {
  const { baseUrl } = await createHarness(t);
  assert.equal(await rejectedUpgrade(baseUrl, { bearer: null }), 401);
  assert.equal(await rejectedUpgrade(baseUrl, { bearer: 'b'.repeat(64) }), 401);
  assert.equal(await rejectedUpgrade(baseUrl, { headers: { Origin: 'http://127.0.0.1:3000' } }), 403);
  assert.equal(await rejectedUpgrade(baseUrl, { headers: { 'X-Forwarded-For': '127.0.0.1' } }), 403);
  assert.equal(await rejectedUpgrade(baseUrl, { protocol: 'mastermind.family.v2' }), 426);
  assert.equal(await rejectedUpgrade(baseUrl, { path: '/v1/companion/bridge?token=unsafe' }), 404);
});

test('successful bridge handshake carries actions and idempotent cancellation over one session', async (t) => {
  const { baseUrl, manager } = await createHarness(t);
  const { webSocket, messages } = await connectReady(baseUrl, manager);
  t.after(() => webSocket.close());
  assert.equal(manager.status().state, 'ready');

  const action = manager.dispatchAction({ kind: 'direct.moveFor', args: {
    forward: 1, strafe: 0, durationMs: 250, sprint: false, sneak: false,
  } });
  const execute = parseFamilyBridgeMessage(await messages.next(), { direction: 'control', expectedSessionId: sessionId });
  assert.equal(execute.type, 'action.execute');
  assert.equal(execute.payload.actionId, action.actionId);
  assert.equal(execute.payload.action.kind, 'direct.moveFor');

  webSocket.send(clientMessage('action.status', {
    actionId: action.actionId, status: 'started',
  }, 4, '33333333-3333-4333-8333-333333333333'));
  await new Promise((resolve) => manager.once('actionStatus', resolve));
  assert.equal(manager.cancelAction(action.actionId).alreadyRequested, false);
  assert.equal(manager.cancelAction(action.actionId).alreadyRequested, true);
  const cancel = parseFamilyBridgeMessage(await messages.next(), { direction: 'control', expectedSessionId: sessionId });
  assert.equal(cancel.type, 'action.cancel');
  assert.equal(cancel.payload.reason, 'operator');
});

test('a second authenticated connection is rejected while the single bridge session is active', async (t) => {
  const { baseUrl, manager } = await createHarness(t);
  const first = await connectReady(baseUrl, manager);
  t.after(() => first.webSocket.close());
  assert.equal(await rejectedUpgrade(baseUrl, {}), 409);
});

test('binary and malformed client messages close the session as protocol violations', async (t) => {
  const { baseUrl, manager } = await createHarness(t);
  const first = await connectReady(baseUrl, manager);
  const binaryClose = waitForClose(first.webSocket);
  first.webSocket.send(Buffer.from([1, 2, 3]), { binary: true });
  assert.equal((await binaryClose).code, 1003);
  assert.equal(manager.status().state, 'disconnected');

  const second = await connectReady(baseUrl, manager);
  const malformedClose = waitForClose(second.webSocket);
  second.webSocket.send('{');
  assert.equal((await malformedClose).code, 4400);
  assert.equal(manager.status().state, 'disconnected');
});

test('the WebSocket parser enforces the 64 KiB frame ceiling', async (t) => {
  const { baseUrl, manager } = await createHarness(t);
  const { webSocket } = await connectReady(baseUrl, manager);
  const closed = waitForClose(webSocket);
  webSocket.send('x'.repeat(FAMILY_BRIDGE_MAX_PAYLOAD_BYTES + 1));
  assert.equal((await closed).code, 1009);
  assert.equal(manager.status().state, 'disconnected');
});

test('bridge close removes the HTTP upgrade listener, clears timers, and disconnects its session', async (t) => {
  const { server, bridge, baseUrl, manager } = await createHarness(t);
  const listenerCount = server.listenerCount('upgrade');
  const { webSocket } = await connectReady(baseUrl, manager);
  assert.equal(manager.status().state, 'ready');
  const closed = waitForClose(webSocket);
  await bridge.close();
  assert.equal((await closed).code, 1001);
  assert.equal(server.listenerCount('upgrade'), listenerCount - 1);
  assert.equal(bridge.livenessTimer, null);
  assert.equal(bridge.pingTimer, null);
  assert.equal(bridge.started, false);
  assert.equal(manager.status().state, 'disconnected');
});
