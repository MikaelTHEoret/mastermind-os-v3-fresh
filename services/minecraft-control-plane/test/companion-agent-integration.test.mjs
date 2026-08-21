import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createControlPlane } from '../src/agent.mjs';
import { encodeMinecraftCredentialFrame } from '../src/companion/credential-frame.mjs';

const controlToken = 'companion-agent-control-token-0123456789';
const actionId = '00000000-0000-4000-8000-000000000091';

function trustedLaunchSpecification() {
  return {
    familyServerInstanceId: 'family-server',
    command: { executable: 'C:\\managed\\java.exe', args: ['trusted'], cwd: 'C:\\managed\\client' },
    manifest: {
      clientId: 'family-ai-client', bridgeVersion: '0.1.0', minecraftVersion: '26.2',
      loaderVersion: '0.19.3', baritoneVersion: '1.18.0',
    },
  };
}

async function createRunningFamilyServer(app, dataRoot, { pid = 4000, javaPort = 25579 } = {}) {
  const now = new Date().toISOString();
  await app.store.create({
    id: 'family-server', displayName: 'Family Server', projectId: 'family-server', kind: 'server',
    minecraftVersion: '26.2', memoryMb: 4096, javaPort, bedrockPort: 19132,
    directory: path.join(dataRoot, 'projects', 'family-server', 'servers', 'family-server'),
    provisioningStatus: 'ready', status: 'running', pid, createdAt: now, updatedAt: now,
  });
}

function lifecycleFixture(overrides = {}) {
  const calls = [];
  return {
    calls,
    async initialize() { calls.push('initialize'); return this.status(); },
    status() {
      return {
        state: 'stopped', launchId: 'private-launch', sessionId: 'private-session', pid: 49152,
        bridgeTokenSha256: 'f'.repeat(64), processIdentity: { privatePath: 'C:\\private\\java.exe' },
        versionManifest: null, startedAt: null, stoppedAt: null,
        updatedAt: '2026-08-13T00:00:00.000Z', lastExit: null, lastError: null,
      };
    },
    async authenticateBridgeToken(credentials) { calls.push(['authenticate', credentials]); return null; },
    async verifyHello(payload, context) { calls.push(['verifyHello', payload, context]); return true; },
    async launch(specification) { calls.push(['launch', specification]); return this.status(); },
    async stop(options = {}) { calls.push(['stop', options]); return this.status(); },
    ...overrides,
  };
}

function sessionFixture(overrides = {}) {
  const calls = [];
  return {
    calls,
    status() {
      return {
        state: 'ready', sessionId: 'private-session', connectedAt: '2026-08-13T00:00:01.000Z',
        lastHeartbeatAt: '2026-08-13T00:00:02.000Z', lastSnapshotAt: '2026-08-13T00:00:02.000Z',
        client: {
          clientId: 'family-ai-client', pid: 49152, bridgeVersion: '0.1.0', minecraftVersion: '26.2',
          loaderVersion: '0.19.3', baritoneVersion: '1.18.0', capabilities: ['state.snapshot', 'direct.jump'],
        },
        killSwitch: false,
        activeAction: null,
        latestSnapshot: {
          snapshotId: '00000000-0000-4000-8000-000000000092', clientTick: 10, phase: 'in-world',
          serverAlias: 'family-server', player: null, world: null,
          baritone: { state: 'idle', activeSkill: null, goal: null }, activeAction: null,
          safety: { killSwitch: false },
        },
        pendingShutdown: null, lastDisconnect: null,
      };
    },
    dispatchAction(action, options) {
      calls.push(['dispatch', action, options]);
      return {
        actionId, kind: action.kind, status: 'dispatched', dispatchedAt: '2026-08-13T00:00:03.000Z',
        deadlineAt: '2026-08-13T00:00:08.000Z', cancelRequestedAt: null, cancelReason: null, terminal: null,
      };
    },
    cancelAction(id, reason) {
      calls.push(['cancel', id, reason]);
      return { action: { actionId: id, kind: 'direct.jump', status: 'dispatched' }, alreadyTerminal: false, alreadyRequested: false };
    },
    closeConnection(code, reason) { calls.push(['close', code, reason]); return true; },
    ...overrides,
  };
}

async function fixture(t, options = {}) {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-companion-agent-'));
  const lifecycle = options.lifecycle ?? lifecycleFixture();
  const sessions = options.sessions ?? sessionFixture();
  const bridgeCalls = [];
  const bridge = options.realBridge ? undefined : {
    start() { bridgeCalls.push('start'); return this; },
    async close() { bridgeCalls.push('close'); },
  };
  const processCalls = [];
  const processes = options.processes ?? {
    async shutdown(timeoutMs) { processCalls.push(['shutdown', timeoutMs]); },
    async isActive() { return false; },
    async withInstanceLock(_id, operation) { return operation(); },
  };
  const trustedCompanionLaunchFactory = options.trustedCompanionLaunchSpecification ? {
    familyServerInstanceId: options.trustedCompanionLaunchSpecification.familyServerInstanceId,
    async create() {
      const session = options.testMinecraftSession ?? {
        username: 'FamilyAgent', uuid: '00112233445566778899aabbccddeeff',
        accessToken: 'private-minecraft-access-token-1234567890', xuid: '281474976710655',
        clientId: '01234567-89ab-4def-8123-456789abcdef',
      };
      return {
        ...structuredClone(options.trustedCompanionLaunchSpecification),
        credentialFrame: encodeMinecraftCredentialFrame(session),
      };
    },
  } : options.trustedCompanionLaunchFactory;
  const app = await createControlPlane({
    config: { host: '127.0.0.1', port: 43100, token: controlToken, dataRoot, javaExecutable: process.execPath },
    legacyMigration: { state: 'not-found', candidateCount: 0 }, processRecovery: [], updateRecovery: [],
    processes,
    updater: options.updater ?? {
      async check() { return { state: 'current', requiresApproval: false }; },
      async update() { throw new Error('not used'); },
      async markReady() {},
    },
    companionLifecycle: lifecycle,
    ...(options.realSessions ? {} : { companionSessions: sessions }),
    ...(bridge ? { companionBridge: bridge } : {}),
    ...(trustedCompanionLaunchFactory
      ? { trustedCompanionLaunchFactory }
      : {}),
    ...(options.clientProvisioner ? { clientProvisioner: options.clientProvisioner } : {}),
    ...(options.accountVault ? { accountVault: options.accountVault } : {}),
    ...(options.accountRegistration ? { accountRegistration: options.accountRegistration } : {}),
    ...(options.accountConfig !== undefined ? { accountConfig: options.accountConfig } : {}),
    ...(options.authFactory ? { authFactory: options.authFactory } : {}),
    ...(options.minecraftAuth ? { minecraftAuth: options.minecraftAuth } : {}),
    ...(options.supervisorId ? { supervisorId: options.supervisorId } : {}),
  });
  const address = await app.listen(0);
  let closed = false;
  t.after(async () => {
    if (!closed) await app.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  });
  return {
    app, lifecycle, sessions: options.realSessions ? app.companionSessions : sessions,
    bridgeCalls, processCalls, dataRoot,
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() { if (!closed) { closed = true; await app.close(); } },
  };
}

function headers(extra = {}) {
  return { Authorization: `Bearer ${controlToken}`, ...extra };
}

test('reports only sanitized companion lifecycle and bridge state', async (t) => {
  const { baseUrl } = await fixture(t);
  const response = await fetch(`${baseUrl}/v1/companion/status`, { headers: headers() });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.companion.projectId, 'family-server');
  assert.equal(body.companion.launchAvailable, true);
  assert.equal(body.companion.targetInstanceId, 'family-server');
  assert.equal(body.companion.lifecycle.state, 'stopped');
  assert.equal(body.companion.lifecycle.pid, undefined);
  assert.equal(body.companion.lifecycle.sessionId, undefined);
  assert.equal(body.companion.bridge.client.pid, undefined);
  assert.equal(body.companion.bridge.sessionId, undefined);
  assert.deepEqual(body.companion.bridge.capabilities, ['state.snapshot', 'direct.jump']);
  assert.equal(body.companion.bridge.ready, true);
  assert.equal(body.companion.bridge.snapshot.serverAlias, 'family-server');
  assert.equal(JSON.stringify(body).includes('private'), false);
  assert.equal((await fetch(`${baseUrl}/v1/companion/status?detail=private`, { headers: headers() })).status, 404);
});

test('accepts only the strict typed companion action and cancel routes', async (t) => {
  const trustedProcesses = {
    async shutdown() {},
    async isActive() { return true; },
    async ownsActiveChild(id, pid) { return id === 'family-server' && pid === 4000; },
    async withInstanceLock(_id, operation) { return operation(); },
  };
  const { app, baseUrl, sessions, dataRoot } = await fixture(t, {
    trustedCompanionLaunchSpecification: trustedLaunchSpecification(),
    processes: trustedProcesses,
  });
  await createRunningFamilyServer(app, dataRoot);
  const valid = await fetch(`${baseUrl}/v1/companion/actions`, {
    method: 'POST', headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ action: { kind: 'direct.jump', args: {} }, timeoutMs: 5_000 }),
  });
  assert.equal(valid.status, 200);
  assert.equal((await valid.json()).action.actionId, actionId);
  assert.deepEqual(sessions.calls[0], ['dispatch', { kind: 'direct.jump', args: {} }, { timeoutMs: 5_000 }]);

  const rawCommand = await fetch(`${baseUrl}/v1/companion/actions`, {
    method: 'POST', headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ action: { kind: 'direct.jump', args: {} }, command: 'powershell.exe' }),
  });
  assert.equal(rawCommand.status, 400);
  assert.equal((await rawCommand.json()).code, 'INVALID_REQUEST');

  const minecraftCommand = await fetch(`${baseUrl}/v1/companion/actions`, {
    method: 'POST', headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ action: { kind: 'direct.say', args: { text: '/op player' } } }),
  });
  assert.equal(minecraftCommand.status, 400);
  assert.equal((await minecraftCommand.json()).code, 'UNSAFE_ACTION');

  assert.equal((await fetch(`${baseUrl}/v1/companion/actions/not-a-uuid/cancel`, {
    method: 'POST', headers: headers(),
  })).status, 400);
  const cancelled = await fetch(`${baseUrl}/v1/companion/actions/${actionId}/cancel`, {
    method: 'POST', headers: headers(),
  });
  assert.equal(cancelled.status, 200);
  assert.equal((await cancelled.json()).cancellation.action.actionId, actionId);
  assert.deepEqual(sessions.calls.at(-1), ['cancel', actionId, 'operator']);
});

test('rejects action dispatch and closes the bridge when the Family Server port is no longer owned by the exact managed child', async (t) => {
  const processes = {
    async shutdown() {},
    async isActive() { return true; },
    async ownsActiveChild() { return false; },
    async withInstanceLock(_id, operation) { return operation(); },
  };
  const { app, baseUrl, sessions, dataRoot } = await fixture(t, {
    trustedCompanionLaunchSpecification: trustedLaunchSpecification(),
    processes,
  });
  await createRunningFamilyServer(app, dataRoot, { pid: 4000, javaPort: 25579 });

  const response = await fetch(`${baseUrl}/v1/companion/actions`, {
    method: 'POST', headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ action: { kind: 'direct.jump', args: {} } }),
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'COMPANION_SERVER_NOT_READY');
  assert.equal(sessions.calls.some((entry) => Array.isArray(entry) && entry[0] === 'dispatch'), false);
  assert.deepEqual(sessions.calls.at(-1), ['close', 4408, 'family-server-ownership-lost']);
});

test('requires the exact owned Family Server and refuses browser-supplied launch material', async (t) => {
  const { baseUrl, lifecycle } = await fixture(t);
  const unavailable = await fetch(`${baseUrl}/v1/companion/start`, { method: 'POST', headers: headers() });
  assert.equal(unavailable.status, 409);
  assert.equal((await unavailable.json()).code, 'COMPANION_SERVER_NOT_READY');
  const injected = await fetch(`${baseUrl}/v1/companion/start`, {
    method: 'POST', headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ executable: 'C:\\unsafe\\java.exe', args: ['-jar', 'unsafe.jar'] }),
  });
  assert.equal(injected.status, 400);
  assert.equal((await injected.json()).code, 'UNEXPECTED_BODY');
  assert.equal(lifecycle.calls.some((entry) => Array.isArray(entry) && entry[0] === 'launch'), false);
});

test('exposes companion stop only as a bodyless typed lifecycle action', async (t) => {
  const { baseUrl, lifecycle, sessions } = await fixture(t);
  const withBody = await fetch(`${baseUrl}/v1/companion/stop`, {
    method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: '{}',
  });
  assert.equal(withBody.status, 400);
  assert.equal((await withBody.json()).code, 'UNEXPECTED_BODY');
  assert.equal(lifecycle.calls.some((entry) => Array.isArray(entry) && entry[0] === 'stop'), false);

  const stopped = await fetch(`${baseUrl}/v1/companion/stop`, { method: 'POST', headers: headers() });
  assert.equal(stopped.status, 200);
  assert.equal((await stopped.json()).companion.lifecycle.state, 'stopped');
  assert.ok(lifecycle.calls.some((entry) => Array.isArray(entry) && entry[0] === 'stop'));
  assert.deepEqual(sessions.calls.at(-1), ['close', 1001, 'companion-stopped']);
});

test('derives the Family Server port for an internally trusted launch specification', async (t) => {
  const trusted = trustedLaunchSpecification();
  const trustedProcesses = {
    async shutdown() {},
    async isActive() { return true; },
    async ownsActiveChild(id, pid) { return id === 'family-server' && pid === 4000; },
    async withInstanceLock(_id, operation) { return operation(); },
  };
  const { app, baseUrl, lifecycle, dataRoot } = await fixture(t, {
    trustedCompanionLaunchSpecification: trusted,
    testMinecraftSession: {
      username: 'FamilyAgent', uuid: '00112233445566778899aabbccddeeff',
      accessToken: 'private-minecraft-access-token-1234567890', xuid: '281474976710655',
      clientId: '01234567-89ab-4def-8123-456789abcdef',
    },
    processes: trustedProcesses,
  });
  await createRunningFamilyServer(app, dataRoot);
  const response = await fetch(`${baseUrl}/v1/companion/start`, { method: 'POST', headers: headers() });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).companion.launchAvailable, true);
  const launch = lifecycle.calls.find((entry) => Array.isArray(entry) && entry[0] === 'launch');
  assert.equal(launch[1].familyServerPort, 25579);
  assert.deepEqual(launch[1].command, trusted.command);
  assert.equal(JSON.stringify(await (await fetch(`${baseUrl}/v1/companion/status`, { headers: headers() })).json()).includes('managed'), false);
});

test('revalidates exact Family Server ownership after trusted profile and auth preparation', async (t) => {
  let owned = true;
  let credentialFrame;
  const lifecycle = lifecycleFixture();
  const processes = {
    async shutdown() {},
    async isActive() { return owned; },
    async ownsActiveChild(id, pid) { return owned && id === 'family-server' && pid === 4000; },
    async withInstanceLock(_id, operation) { return operation(); },
  };
  const launchFactory = {
    familyServerInstanceId: 'family-server',
    async create() {
      credentialFrame = encodeMinecraftCredentialFrame({
        username: 'FamilyAgent', uuid: '00112233445566778899aabbccddeeff',
        accessToken: 'private-minecraft-access-token-ownership-race', xuid: '281474976710655',
        clientId: '01234567-89ab-4def-8123-456789abcdef',
      });
      owned = false;
      return { ...trustedLaunchSpecification(), credentialFrame };
    },
  };
  const { app, baseUrl, dataRoot } = await fixture(t, {
    lifecycle, processes, trustedCompanionLaunchFactory: launchFactory,
  });
  await createRunningFamilyServer(app, dataRoot);

  const response = await fetch(`${baseUrl}/v1/companion/start`, { method: 'POST', headers: headers() });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'COMPANION_SERVER_NOT_READY');
  assert.equal(lifecycle.calls.some((entry) => Array.isArray(entry) && entry[0] === 'launch'), false);
  assert.equal(credentialFrame.every((byte) => byte === 0), true);
});

test('rejects a verified client whose Minecraft version differs from the exact running Family Server', async (t) => {
  let credentialFrame;
  const lifecycle = lifecycleFixture();
  const processes = {
    async shutdown() {},
    async isActive() { return true; },
    async ownsActiveChild(id, pid) { return id === 'family-server' && pid === 4000; },
    async withInstanceLock(_id, operation) { return operation(); },
  };
  const launchFactory = {
    familyServerInstanceId: 'family-server',
    async create() {
      credentialFrame = encodeMinecraftCredentialFrame({
        username: 'FamilyAgent', uuid: '00112233445566778899aabbccddeeff',
        accessToken: 'private-minecraft-access-token-version-mismatch', xuid: '281474976710655',
        clientId: '01234567-89ab-4def-8123-456789abcdef',
      });
      const specification = trustedLaunchSpecification();
      return {
        ...specification,
        manifest: { ...specification.manifest, minecraftVersion: '26.3' },
        credentialFrame,
      };
    },
  };
  const { app, baseUrl, dataRoot } = await fixture(t, {
    lifecycle, processes, trustedCompanionLaunchFactory: launchFactory,
  });
  await createRunningFamilyServer(app, dataRoot);

  const response = await fetch(`${baseUrl}/v1/companion/start`, { method: 'POST', headers: headers() });
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, 'COMPANION_VERSION_MISMATCH');
  assert.equal(body.message, 'The verified Family AI client version does not match the running Family Server version.');
  assert.equal(JSON.stringify(body).includes('version-mismatch'), false);
  assert.equal(lifecycle.calls.some((entry) => Array.isArray(entry) && entry[0] === 'launch'), false);
  assert.equal(credentialFrame.every((byte) => byte === 0), true);
});

test('normal Family Server stop drains and verifies the companion before stopping the server under the shared lock', async (t) => {
  const order = [];
  const lifecycle = lifecycleFixture({
    async stop() { order.push('companion'); return this.status(); },
  });
  const sessions = sessionFixture({
    closeConnection(code, reason) { order.push(`bridge:${code}:${reason}`); return true; },
  });
  const processes = {
    async shutdown() {},
    async isActive() { return true; },
    async withInstanceLock(id, operation) {
      assert.equal(id, 'family-server');
      return operation();
    },
    async stopWithinInstanceLock(id) {
      order.push('server');
      return { id, projectId: 'family-server', kind: 'server', status: 'stopped' };
    },
  };
  const { baseUrl } = await fixture(t, {
    lifecycle, sessions, processes,
    trustedCompanionLaunchSpecification: trustedLaunchSpecification(),
  });

  const response = await fetch(`${baseUrl}/v1/instances/family-server/stop`, { method: 'POST', headers: headers() });
  assert.equal(response.status, 200);
  assert.deepEqual(order, ['companion', 'bridge:1001:family-server-stopping', 'server']);
});

test('Family Server update drains and verifies the companion before entering the updater under the shared lock', async (t) => {
  const order = [];
  const lifecycle = lifecycleFixture({
    async stop() { order.push('companion'); return this.status(); },
  });
  const sessions = sessionFixture({
    closeConnection(code, reason) { order.push(`bridge:${code}:${reason}`); return true; },
  });
  const processes = {
    async shutdown() {},
    async isActive() { return false; },
    async withInstanceLock(id, operation) {
      assert.equal(id, 'family-server');
      return operation();
    },
  };
  const updater = {
    async check() { return { state: 'current', requiresApproval: false }; },
    async markReady() {},
    async updateWithinInstanceLock(input) {
      order.push('update');
      assert.deepEqual(input, { instanceId: 'family-server' });
      return { action: 'current' };
    },
  };
  const { baseUrl } = await fixture(t, {
    lifecycle, sessions, processes, updater,
    trustedCompanionLaunchSpecification: trustedLaunchSpecification(),
  });

  const response = await fetch(`${baseUrl}/v1/instances/family-server/update`, {
    method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: '{}',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(order, ['companion', 'bridge:1001:family-server-updating', 'update']);
});

test('stops the companion before the Family Server during supervisor drain', async (t) => {
  const order = [];
  const lifecycle = lifecycleFixture({
    async stop(options = {}) { order.push(['companion', options.gracefulTimeoutMs ?? null]); return this.status(); },
  });
  const processes = {
    async shutdown(timeoutMs) { order.push(['server', timeoutMs]); },
    async isActive() { return false; },
    async withInstanceLock(_id, operation) { return operation(); },
  };
  const supervisorId = 'a'.repeat(32);
  const { baseUrl } = await fixture(t, { lifecycle, processes, supervisorId });
  const prepared = await fetch(`${baseUrl}/v1/control/prepare-shutdown`, {
    method: 'POST', headers: headers({ 'X-Mastermind-Supervisor-Id': supervisorId }),
  });
  assert.equal(prepared.status, 200);
  assert.deepEqual(order, [['companion', 30_000], ['server', 30_000]]);
});

test('wires lifecycle authentication and hello verification into the real bridge/session pair', async (t) => {
  const authenticated = { sessionId: '00000000-0000-4000-8000-000000000099', expectedPid: 12345 };
  const lifecycle = lifecycleFixture({
    async authenticateBridgeToken(credentials) { this.calls.push(['authenticate', credentials]); return authenticated; },
    async verifyHello(payload, context) { this.calls.push(['verifyHello', payload, context]); return true; },
  });
  const { app } = await fixture(t, { lifecycle, realSessions: true, realBridge: true });
  assert.deepEqual(await app.companionBridge.authenticate({ token: 'x'.repeat(43) }), authenticated);
  assert.equal(await app.companionSessions.verifyHello({ clientId: 'family-ai-client' }, authenticated), true);
  assert.deepEqual(lifecycle.calls.slice(-2), [
    ['authenticate', { token: 'x'.repeat(43) }],
    ['verifyHello', { clientId: 'family-ai-client' }, authenticated],
  ]);
});

test('closes the companion bridge when the control plane closes', async (t) => {
  const { close, bridgeCalls } = await fixture(t);
  assert.deepEqual(bridgeCalls, ['start']);
  await close();
  assert.deepEqual(bridgeCalls, ['start', 'close']);
});

test('exposes verified managed-client state and provisions only through a bodyless internal plan', async (t) => {
  const calls = [];
  const installed = {
    projectId: 'family-ai-client', kind: 'client', state: 'installed', integrity: 'verified',
    minecraftVersion: '26.2', loader: { name: 'Fabric Loader', version: '0.19.3' }, requiredJavaMajor: 25,
    installedAt: '2026-08-13T00:00:00.000Z', artifactCount: 149, nativeFiles: 3,
  };
  const clientProvisioner = {
    async status() { calls.push('status'); return installed; },
    async resolve() { calls.push('resolve'); return { privateResolvedPlan: true }; },
    async provision(plan) { calls.push(['provision', plan]); return installed; },
    async internalLaunchProfile() { throw new Error('not launched'); },
  };
  const minecraftAuth = {
    async initialize() {},
    status() { return { provider: 'microsoft', configured: true, signedIn: true, sessionReady: true, status: 'signed-in', account: { name: 'FamilyAgent' } }; },
    async signOut() {}, async silentRefresh() {}, minecraftSession() { throw new Error('not launched'); },
  };
  const { baseUrl } = await fixture(t, { clientProvisioner, minecraftAuth });
  const [statusResponse, duplicateStatusResponse] = await Promise.all([
    fetch(`${baseUrl}/v1/client/status`, { headers: headers() }),
    fetch(`${baseUrl}/v1/client/status`, { headers: headers() }),
  ]);
  assert.equal(statusResponse.status, 200);
  assert.equal(duplicateStatusResponse.status, 200);
  assert.deepEqual((await statusResponse.json()).client, {
    projectId: 'family-ai-client', targetInstanceId: 'family-server', state: 'installed', integrity: 'verified', installed: true,
    minecraftVersion: '26.2', loader: { name: 'Fabric Loader', version: '0.19.3' }, requiredJavaMajor: 25,
    installedAt: '2026-08-13T00:00:00.000Z', artifactCount: 149, nativeFiles: 3,
    launchReady: true, authenticationConfigured: true,
  });
  const injected = await fetch(`${baseUrl}/v1/client/provision`, {
    method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ url: 'https://evil.invalid/client.jar' }),
  });
  assert.equal(injected.status, 400);
  assert.equal((await injected.json()).code, 'UNEXPECTED_BODY');
  const provisioned = await fetch(`${baseUrl}/v1/client/provision`, { method: 'POST', headers: headers() });
  assert.equal(provisioned.status, 201);
  assert.equal((await provisioned.json()).client.installed, true);
  const refreshed = await fetch(`${baseUrl}/v1/client/status`, { headers: headers() });
  assert.equal(refreshed.status, 200);
  assert.equal((await refreshed.json()).client.installed, true);
  assert.deepEqual(calls, ['status', 'resolve', ['provision', { privateResolvedPlan: true }], 'status']);
});

test('registration replacement clears the old account before rebuilding auth and never echoes the public client id', async (t) => {
  const oldId = '11111111-1111-4111-8111-111111111111';
  const newId = '22222222-2222-4222-8222-222222222222';
  const events = [];
  let stored = { clientId: oldId };
  const oldAuth = {
    async initialize() { events.push('old:init'); },
    status() { return { provider: 'microsoft', configured: true, signedIn: true, sessionReady: true, status: 'signed-in', account: { name: 'OldAgent' } }; },
    async signOut() { events.push('old:signout'); },
  };
  const accountRegistration = {
    async load() { events.push('registration:load'); return stored; },
    async save(clientId) { events.push(`registration:save:${clientId}`); stored = { clientId }; return { configured: true }; },
  };
  const authFactory = (config) => ({
    async initialize() { events.push(`new:init:${config.clientId}`); },
    status() { return { provider: 'microsoft', configured: true, signedIn: false, sessionReady: false, status: 'signed-out', account: null }; },
    async signOut() { events.push('new:signout'); },
    async startDeviceFlow() { return { flowId: '00000000-0000-4000-8000-000000000123', user_code: 'ABCD-EFGH', verification_uri: 'https://microsoft.com/devicelogin', expiry: '2026-08-13T00:10:00.000Z', status: 'pending' }; },
    async pollDeviceFlow() { throw new Error('not used'); }, async silentRefresh() {}, minecraftSession() { throw new Error('not used'); },
  });
  const { baseUrl } = await fixture(t, { accountConfig: stored, accountRegistration, minecraftAuth: oldAuth, authFactory });
  events.length = 0;
  const invalid = await fetch(`${baseUrl}/v1/account/registration`, {
    method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ clientId: 'invalid' }),
  });
  assert.equal(invalid.status, 400);
  assert.equal(events.includes('old:signout'), false);
  const configured = await fetch(`${baseUrl}/v1/account/registration`, {
    method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ clientId: newId }),
  });
  assert.equal(configured.status, 200);
  const configuredText = await configured.text();
  assert.equal(configuredText.includes(newId), false);
  assert.deepEqual(events, ['old:signout', `registration:save:${newId}`, 'registration:load', `new:init:${newId}`]);
  const started = await fetch(`${baseUrl}/v1/account/device/start`, { method: 'POST', headers: headers() });
  assert.equal(started.status, 200);
  assert.equal((await started.json()).flow.status, 'pending');
});

test('account mutation is blocked while the exact companion lifecycle is active', async (t) => {
  let signedOut = false;
  let deviceCalls = 0;
  const lifecycle = lifecycleFixture({
    status() { return { state: 'running', updatedAt: '2026-08-13T00:00:00.000Z' }; },
  });
  const minecraftAuth = {
    async initialize() {},
    status() { return { provider: 'microsoft', configured: true, signedIn: true, sessionReady: true, status: 'signed-in', account: { name: 'FamilyAgent' } }; },
    async signOut() { signedOut = true; },
    async startDeviceFlow() { deviceCalls += 1; },
    async pollDeviceFlow() { deviceCalls += 1; },
  };
  const accountRegistration = { async load() { return { clientId: '11111111-1111-4111-8111-111111111111' }; }, async save() { throw new Error('must not save'); } };
  const { baseUrl } = await fixture(t, { lifecycle, minecraftAuth, accountRegistration, accountConfig: await accountRegistration.load() });
  for (const [url, body] of [
    ['/v1/account/signout', undefined],
    ['/v1/account/registration', JSON.stringify({ clientId: '22222222-2222-4222-8222-222222222222' })],
    ['/v1/account/device/start', undefined],
    ['/v1/account/device/00000000-0000-4000-8000-000000000123/poll', undefined],
  ]) {
    const response = await fetch(`${baseUrl}${url}`, {
      method: 'POST', headers: headers(body ? { 'Content-Type': 'application/json' } : {}), ...(body ? { body } : {}),
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'COMPANION_ALREADY_ACTIVE');
  }
  assert.equal(signedOut, false);
  assert.equal(deviceCalls, 0);
});
