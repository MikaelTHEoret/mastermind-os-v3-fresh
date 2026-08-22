import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createManagedProcessIdentity } from '../src/process-identity.mjs';
import { ProcessManager } from '../src/process-manager.mjs';
import { InstanceStore } from '../src/store.mjs';

const fakeServer = fileURLToPath(new URL('./fake-server.mjs', import.meta.url));

function deferred() {
  let resolve;
  const promise = new Promise((release) => { resolve = release; });
  return { promise, resolve };
}

test('queued lifecycle work passes queued normal work without overtaking the active operation', async () => {
  const manager = new ProcessManager({}, {}, process.execPath);
  const active = deferred();
  const activeStarted = deferred();
  const events = [];
  let operations = 0;
  let peakOperations = 0;
  const operation = (name, waitFor = null) => async () => {
    operations += 1;
    peakOperations = Math.max(peakOperations, operations);
    events.push(`${name}:start`);
    if (waitFor) await waitFor;
    events.push(`${name}:end`);
    operations -= 1;
    return name;
  };

  const activeWork = manager.withInstanceLock('family-server', async () => {
    activeStarted.resolve();
    return operation('active', active.promise)();
  });
  await activeStarted.promise;
  const normalOne = manager.withInstanceLock('family-server', operation('normal-1'));
  const lifecycleOne = manager.withInstanceLock('family-server', operation('lifecycle-1'), { priority: 'lifecycle' });
  const normalTwo = manager.withInstanceLock('family-server', operation('normal-2'));
  const lifecycleTwo = manager.withInstanceLock('family-server', operation('lifecycle-2'), { priority: 'lifecycle' });

  await Promise.resolve();
  assert.deepEqual(events, ['active:start']);
  active.resolve();
  assert.deepEqual(await Promise.all([activeWork, normalOne, lifecycleOne, normalTwo, lifecycleTwo]), [
    'active', 'normal-1', 'lifecycle-1', 'normal-2', 'lifecycle-2',
  ]);
  assert.deepEqual(events, [
    'active:start', 'active:end',
    'lifecycle-1:start', 'lifecycle-1:end',
    'lifecycle-2:start', 'lifecycle-2:end',
    'normal-1:start', 'normal-1:end',
    'normal-2:start', 'normal-2:end',
  ]);
  assert.equal(peakOperations, 1);
});

test('ordinary instance-lock work remains FIFO', async () => {
  const manager = new ProcessManager({}, {}, process.execPath);
  const events = [];
  await Promise.all([
    manager.withInstanceLock('family-server', async () => { events.push('normal-1'); }),
    manager.withInstanceLock('family-server', async () => { events.push('normal-2'); }),
    manager.withInstanceLock('family-server', async () => { events.push('normal-3'); }),
  ]);
  assert.deepEqual(events, ['normal-1', 'normal-2', 'normal-3']);
});

async function bindTcp(port = 0) {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(port, '0.0.0.0', resolve);
  });
  return listener;
}

async function bindUdp(port = 0) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: false });
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(port, '0.0.0.0', resolve);
  });
  return socket;
}

function closeTcp(listener) {
  return new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
}

function closeUdp(socket) {
  return new Promise((resolve) => socket.close(resolve));
}

function observedCommand(executable, args) {
  if (process.platform !== 'win32') return [executable, ...args].join('\\u0000');
  return [executable, ...args].map((value) => `"${value.replaceAll('"', '\\"')}"`).join(' ');
}

function processSnapshot(pid, directory, executable, args, creationTime = '2026-08-13T04:00:00.000Z') {
  return {
    pid,
    processName: path.basename(executable),
    executablePath: executable,
    commandLine: observedCommand(executable, args),
    creationTime,
    workingDirectory: directory,
  };
}

test('exact-child ownership requires the same live child handle and PID', () => {
  const manager = new ProcessManager({}, {}, process.execPath);
  const child = { pid: 49152, exitCode: null, signalCode: null };
  manager.children.set('family-server', { child });

  assert.equal(manager.ownsActiveChild('family-server', 49152), true);
  assert.equal(manager.ownsActiveChild('family-server', 49153), false);
  assert.equal(manager.ownsActiveChild('other-server', 49152), false);
  child.exitCode = 0;
  assert.equal(manager.ownsActiveChild('family-server', 49152), false);
});

function adminInstance(overrides = {}) {
  return {
    id: 'family-server', projectId: 'family-server', kind: 'server', status: 'running', pid: 49152,
    managedProcess: { schemaVersion: 1, owner: 'mastermind-family-server', instanceId: 'family-server', pid: 49152,
      creationTime: '2026-08-13T04:00:00.000Z', executablePathSha256: 'a'.repeat(64), commandLineSha256: 'b'.repeat(64),
      workingDirectorySha256: 'c'.repeat(64), spawnSpecSha256: 'd'.repeat(64), capturedAt: '2026-08-13T04:00:00.000Z' },
    ...overrides,
  };
}

test('typed administration requires exact ready owned generation and writes exactly one LF', async () => {
  const instance = adminInstance();
  const writes = [];
  const child = {
    pid: instance.pid, exitCode: null, signalCode: null,
    stdin: { destroyed: false, writable: true, once() {}, off() {}, write(value, callback) { writes.push(value); callback(); } },
  };
  const manager = new ProcessManager({ async get() { return instance; } }, { async append() {} }, process.execPath, undefined, {
    now: () => '2026-08-13T12:00:00.000Z',
  });
  const crypto = await import('node:crypto');
  const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
    : value && typeof value === 'object' ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
      : JSON.stringify(value);
  const generation = crypto.createHash('sha256').update(canonical(instance.managedProcess), 'utf8').digest('hex');
  manager.children.set('family-server', { child, readiness: { java: true }, launchGeneration: generation });

  const result = await manager.executeTypedAdminActionWithinInstanceLock('family-server', {
    requestId: '123e4567-e89b-42d3-a456-426614174000', kind: 'whitelist.add', player: 'Java_User',
  });
  assert.deepEqual(writes, ['whitelist add Java_User\n']);
  assert.equal(result.launchGeneration, generation);

  manager.children.get('family-server').readiness.java = false;
  await assert.rejects(() => manager.executeTypedAdminActionWithinInstanceLock('family-server', {
    requestId: '223e4567-e89b-42d3-a456-426614174000', kind: 'players.refresh',
  }), (error) => error.code === 'ADMIN_PROCESS_UNAVAILABLE');
  assert.equal(writes.length, 1);
  manager.children.get('family-server').readiness.java = true;
  manager.children.get('family-server').launchGeneration = 'f'.repeat(64);
  await assert.rejects(() => manager.executeTypedAdminActionWithinInstanceLock('family-server', {
    requestId: '323e4567-e89b-42d3-a456-426614174000', kind: 'players.refresh',
  }), (error) => error.code === 'ADMIN_PROCESS_UNAVAILABLE');
  manager.children.get('family-server').launchGeneration = generation;
  manager.children.get('family-server').child.pid += 1;
  await assert.rejects(() => manager.executeTypedAdminActionWithinInstanceLock('family-server', {
    requestId: '423e4567-e89b-42d3-a456-426614174000', kind: 'players.refresh',
  }), (error) => error.code === 'ADMIN_PROCESS_UNAVAILABLE');
  assert.equal(writes.length, 1);
});

test('typed administration treats write throw and callback failure as completion unknown', async () => {
  const instance = adminInstance();
  const manager = new ProcessManager({ async get() { return instance; } }, { async append() {} }, process.execPath);
  const crypto = await import('node:crypto');
  const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
    : value && typeof value === 'object' ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
      : JSON.stringify(value);
  const generation = crypto.createHash('sha256').update(canonical(instance.managedProcess), 'utf8').digest('hex');
  const action = { requestId: '123e4567-e89b-42d3-a456-426614174000', kind: 'players.refresh' };
  for (const stdin of [
    { destroyed: false, writable: true, once() {}, off() {}, write() { throw new Error('write failed'); } },
    { destroyed: false, writable: true, once() {}, off() {}, write(_value, callback) { callback(new Error('callback failed')); } },
  ]) {
    manager.children.set('family-server', { child: { pid: instance.pid, exitCode: null, signalCode: null, stdin }, readiness: { java: true }, launchGeneration: generation });
    await assert.rejects(() => manager.executeTypedAdminActionWithinInstanceLock('family-server', action), (error) => error.code === 'ADMIN_COMPLETION_UNKNOWN');
  }
});

test('typed administration treats a missing stdin callback as completion unknown', async () => {
  const instance = adminInstance();
  const manager = new ProcessManager({ async get() { return instance; } }, { async append() {} }, process.execPath, undefined, { adminStdinTimeoutMs: 5 });
  const crypto = await import('node:crypto');
  const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
    : value && typeof value === 'object' ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
      : JSON.stringify(value);
  const generation = crypto.createHash('sha256').update(canonical(instance.managedProcess), 'utf8').digest('hex');
  const stdin = { destroyed: false, writable: true, once() {}, off() {}, write() {} };
  manager.children.set('family-server', { child: { pid: instance.pid, exitCode: null, signalCode: null, stdin }, readiness: { java: true }, launchGeneration: generation });
  await assert.rejects(() => manager.executeTypedAdminActionWithinInstanceLock('family-server', {
    requestId: '123e4567-e89b-42d3-a456-426614174000', kind: 'players.refresh',
  }), (error) => error.code === 'ADMIN_COMPLETION_UNKNOWN');
});

test('manager restart preserves an orphan listener and never reports it stopped', async (t) => {
  const managedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-process-recovery-'));
  t.after(() => fs.rm(managedRoot, { recursive: true, force: true }));

  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '0.0.0.0', resolve);
  });
  let listenerOpen = true;
  t.after(() => listenerOpen && new Promise((resolve) => listener.close(resolve)));
  const javaPort = listener.address().port;

  const originalStore = new InstanceStore(managedRoot);
  await originalStore.initialize();
  const now = new Date().toISOString();
  await originalStore.create({
    id: 'orphan-server',
    displayName: 'Orphan Server',
    projectId: 'family-server',
    kind: 'server',
    provisioningStatus: 'ready',
    status: 'running',
    pid: null,
    javaPort,
    bedrockPort: 19132,
    memoryMb: 1024,
    directory: path.join(managedRoot, 'servers', 'orphan-server'),
    createdAt: now,
    updatedAt: now,
  });

  const restartedStore = new InstanceStore(managedRoot);
  await restartedStore.initialize();
  assert.equal((await restartedStore.get('orphan-server')).status, 'running', 'store initialization must not erase active state');

  const manager = new ProcessManager(restartedStore, { async append() {} }, process.execPath, undefined, {
    inspectProcessState: async () => ({
      process: null,
      tcp: { known: true, occupied: listenerOpen, owner: listenerOpen ? { pid: process.pid, processName: 'node' } : null },
      udp: { known: true, occupied: false, owner: null },
    }),
  });
  const recovery = await manager.reconcilePersistedState();
  assert.equal(recovery[0].action, 'preserved-unmanaged-active');
  assert.equal(recovery[0].portOccupied, true);
  assert.equal((await restartedStore.get('orphan-server')).status, 'running');
  assert.equal(await manager.isActive('orphan-server'), true);
  await assert.rejects(() => manager.stop('orphan-server'), /not owned by this manager/);
  assert.equal((await restartedStore.get('orphan-server')).status, 'running');

  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  listenerOpen = false;
  const afterExit = await manager.reconcilePersistedState();
  assert.equal(afterExit[0].action, 'reset-inactive');
  assert.equal((await restartedStore.get('orphan-server')).status, 'stopped');
  assert.equal(await manager.isActive('orphan-server'), false);
});

test('a stopped record with an occupied Java port is still treated as active', async (t) => {
  const managedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-process-port-'));
  t.after(() => fs.rm(managedRoot, { recursive: true, force: true }));
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '0.0.0.0', resolve);
  });
  t.after(() => new Promise((resolve) => listener.close(resolve)));

  const store = new InstanceStore(managedRoot);
  await store.initialize();
  const now = new Date().toISOString();
  await store.create({
    id: 'stale-stopped', displayName: 'Stale Stopped', projectId: 'family-server', kind: 'server',
    provisioningStatus: 'ready', status: 'stopped', pid: null, javaPort: listener.address().port,
    bedrockPort: 19132, memoryMb: 1024, directory: path.join(managedRoot, 'servers', 'stale-stopped'),
    createdAt: now, updatedAt: now,
  });
  const manager = new ProcessManager(store, { async append() {} }, process.execPath, undefined, {
    inspectProcessState: async () => ({
      process: null,
      tcp: { known: true, occupied: true, owner: { pid: process.pid, processName: 'node' } },
      udp: { known: true, occupied: false, owner: null },
    }),
  });
  assert.equal(await manager.isActive('stale-stopped'), true);
  await assert.rejects(() => manager.start('stale-stopped'), /Java server port .* occupied.*nothing was terminated/);
});

test('restart reconciliation preserves a starting record whose persisted PID is still live', async (t) => {
  const managedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-process-pid-'));
  t.after(() => fs.rm(managedRoot, { recursive: true, force: true }));
  const portProbe = net.createServer();
  await new Promise((resolve, reject) => {
    portProbe.once('error', reject);
    portProbe.listen(0, '127.0.0.1', resolve);
  });
  const javaPort = portProbe.address().port;
  await new Promise((resolve, reject) => portProbe.close((error) => error ? reject(error) : resolve()));

  const store = new InstanceStore(managedRoot);
  await store.initialize();
  const now = new Date().toISOString();
  await store.create({
    id: 'starting-pid', displayName: 'Starting PID', projectId: 'family-server', kind: 'server',
    provisioningStatus: 'ready', status: 'starting', pid: process.pid, javaPort, bedrockPort: 19132,
    memoryMb: 1024, directory: path.join(managedRoot, 'servers', 'starting-pid'), createdAt: now, updatedAt: now,
  });
  const manager = new ProcessManager(store, { async append() {} }, process.execPath, undefined, {
    inspectProcessState: async () => ({
      process: processSnapshot(process.pid, path.join(managedRoot, 'servers', 'starting-pid'), process.execPath, ['unrelated']),
      tcp: { known: true, occupied: false, owner: null },
      udp: { known: true, occupied: false, owner: null },
    }),
  });
  const recovery = await manager.reconcilePersistedState();
  assert.equal(recovery[0].action, 'preserved-unmanaged-active');
  assert.equal(recovery[0].pidAlive, true);
  assert.equal(recovery[0].portOccupied, false);
  assert.equal((await store.get('starting-pid')).status, 'running');
});

async function legacyAdoptionFixture(t, changes = {}) {
  const managedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-process-adoption-'));
  t.after(() => fs.rm(managedRoot, { recursive: true, force: true }));
  const [tcp, udp] = await Promise.all([bindTcp(), bindUdp()]);
  let socketsOpen = true;
  t.after(async () => {
    if (!socketsOpen) return;
    await Promise.all([closeTcp(tcp), closeUdp(udp)]);
  });
  const id = `adoption-${changes.label ?? 'valid'}`;
  const directory = path.join(managedRoot, 'servers', id);
  await fs.mkdir(directory, { recursive: true });
  const args = ['-Xms1024M', '-Xmx2048M', '-jar', 'fabric-server-launch.jar', 'nogui'];
  const updatedAt = '2026-08-13T04:00:05.000Z';
  const baseSnapshot = processSnapshot(process.pid, directory, process.execPath, args, '2026-08-13T04:00:00.000Z');
  const snapshot = {
    ...baseSnapshot,
    ...(changes.workingDirectory ? { workingDirectory: changes.workingDirectory } : {}),
    ...(changes.creationTime ? { creationTime: changes.creationTime } : {}),
    ...(changes.commandArgs ? { commandLine: observedCommand(process.execPath, changes.commandArgs) } : {}),
  };
  const ownerPid = changes.ownerPid ?? process.pid;
  const store = new InstanceStore(managedRoot);
  await store.initialize();
  await store.create({
    id, displayName: 'Legacy Adoption', projectId: 'family-server', kind: 'server', provisioningStatus: 'ready',
    status: 'running', pid: process.pid, javaPort: tcp.address().port, bedrockPort: udp.address().port,
    memoryMb: 2048, directory, javaExecutable: process.execPath,
    createdAt: '2026-08-13T03:59:00.000Z', updatedAt,
  });
  const manager = new ProcessManager(store, { async append() {} }, process.execPath, (_instance, executable) => ({ executable, args }), {
    verifyInstall: async () => ({ ok: true }),
    inspectProcessState: async () => ({
      process: snapshot,
      tcp: { known: true, occupied: true, owner: { pid: ownerPid, processName: ownerPid === process.pid ? 'java' : 'foreign-java' } },
      udp: { known: true, occupied: true, owner: { pid: ownerPid, processName: ownerPid === process.pid ? 'java' : 'foreign-java' } },
    }),
  });
  return {
    id, manager, store,
    async closeSockets() {
      if (!socketsOpen) return;
      socketsOpen = false;
      await Promise.all([closeTcp(tcp), closeUdp(udp)]);
    },
  };
}

test('one-time adoption records an exact pre-identity Mastermind Java process without stopping it', async (t) => {
  const value = await legacyAdoptionFixture(t);
  const recovery = await value.manager.reconcilePersistedState();
  assert.equal(recovery[0].action, 'adopted-pre-identity-process');
  assert.equal(recovery[0].ownership, 'verified');
  const adopted = await value.store.get(value.id);
  assert.equal(adopted.status, 'running');
  assert.equal(adopted.managedProcess.owner, 'mastermind-family-server');
  assert.equal(adopted.managedProcess.pid, process.pid);
  assert.match(adopted.managedProcess.executablePathSha256, /^[a-f0-9]{64}$/);
  assert.match(adopted.managedProcess.commandLineSha256, /^[a-f0-9]{64}$/);
  assert.match(adopted.managedProcess.workingDirectorySha256, /^[a-f0-9]{64}$/);
  await assert.rejects(() => value.manager.start(value.id), (error) => {
    assert.equal(error.code, 'SAFE_STOP_REQUIRED');
    assert.equal(error.statusCode, 409);
    assert.match(error.message, /authenticated Minecraft stdin.*no PID termination/i);
    return true;
  });
  await value.closeSockets();
});

test('legacy adoption and Start refuse foreign, wrong-cwd, wrong-command, and PID-reuse identities without termination', async (t) => {
  const cases = [
    { label: 'foreign', ownerPid: 19656 },
    { label: 'wrong-cwd', workingDirectory: path.join(os.tmpdir(), 'wrong-family-directory') },
    { label: 'wrong-command', commandArgs: ['-jar', 'untrusted.jar', 'nogui'] },
    { label: 'pid-reuse', creationTime: '2026-08-13T05:00:00.000Z' },
  ];
  for (const entry of cases) {
    const value = await legacyAdoptionFixture(t, entry);
    const recovery = await value.manager.reconcilePersistedState();
    assert.equal(recovery[0].action, 'preserved-unmanaged-active', entry.label);
    assert.equal((await value.store.get(value.id)).managedProcess, undefined, entry.label);
    await assert.rejects(() => value.manager.start(value.id), (error) => {
      assert.equal(error.statusCode, 409);
      assert.match(error.message, /nothing was terminated|no PID termination was attempted/);
      return true;
    }, entry.label);
    await value.closeSockets();
  }
});

test('Start preserves an exact persisted orphan and requires a safe control channel without PID termination', async (t) => {
  const managedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-process-reclaim-'));
  t.after(() => fs.rm(managedRoot, { recursive: true, force: true }));
  const [tcp, udp] = await Promise.all([bindTcp(), bindUdp()]);
  let tcpOpen = true;
  let udpOpen = true;
  t.after(async () => {
    if (tcpOpen) await closeTcp(tcp);
    if (udpOpen) await closeUdp(udp);
  });
  const id = 'exact-reclaim';
  const directory = path.join(managedRoot, 'servers', id);
  await fs.mkdir(directory, { recursive: true });
  const oldPid = 424242;
  const args = [fakeServer];
  const oldSnapshot = processSnapshot(oldPid, directory, process.execPath, args, '2026-08-13T04:00:00.000Z');
  const identity = createManagedProcessIdentity(oldSnapshot, {
    instanceId: id, executable: process.execPath, args, cwd: directory, capturedAt: '2026-08-13T04:00:01.000Z',
  });
  const store = new InstanceStore(managedRoot);
  await store.initialize();
  const now = new Date().toISOString();
  await store.create({
    id, displayName: 'Exact Reclaim', projectId: 'family-server', kind: 'server', provisioningStatus: 'ready',
    status: 'running', pid: oldPid, managedProcess: identity, javaPort: tcp.address().port, bedrockPort: udp.address().port,
    memoryMb: 1024, directory, javaExecutable: process.execPath, createdAt: now, updatedAt: now,
  });
  const manager = new ProcessManager(store, { async append() {} }, process.execPath, () => {
    throw new Error('an orphan without stdin must never reach process spawn');
  }, {
    verifyInstall: async () => ({ ok: true }),
    inspectProcessState: async () => ({
      process: oldSnapshot,
      tcp: { known: true, occupied: true, owner: { pid: oldPid, processName: 'java' } },
      udp: { known: true, occupied: true, owner: { pid: oldPid, processName: 'java' } },
    }),
  });

  await assert.rejects(() => manager.start(id), (error) => {
    assert.equal(error.code, 'SAFE_STOP_REQUIRED');
    assert.equal(error.owner.pid, oldPid);
    return true;
  });
  assert.equal(tcpOpen, true);
  assert.equal(udpOpen, true);
  assert.equal((await store.get(id)).status, 'running');
});

test('Start restarts an agent-owned child through stdin and waits for both TCP and UDP release', async (t) => {
  const managedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-owned-restart-'));
  t.after(() => fs.rm(managedRoot, { recursive: true, force: true }));
  const store = new InstanceStore(managedRoot);
  await store.initialize();
  const id = 'owned-restart';
  const directory = path.join(managedRoot, 'servers', id);
  await fs.mkdir(directory, { recursive: true });
  const portProbe = await bindTcp();
  const javaPort = portProbe.address().port;
  await closeTcp(portProbe);
  const udpProbe = await bindUdp();
  const bedrockPort = udpProbe.address().port;
  await closeUdp(udpProbe);
  const args = [fakeServer];
  const now = new Date().toISOString();
  await store.create({
    id, displayName: 'Owned Restart', projectId: 'family-server', kind: 'server', provisioningStatus: 'ready',
    status: 'stopped', pid: null, javaPort, bedrockPort, memoryMb: 1024, directory,
    javaExecutable: process.execPath, createdAt: now, updatedAt: now,
  });
  let commandCalls = 0;
  let udpReleased = false;
  const manager = new ProcessManager(store, { async append() {} }, process.execPath, (_instance, executable) => {
    commandCalls += 1;
    if (commandCalls === 2) assert.equal(udpReleased, true, 'replacement spawn must wait for Bedrock UDP release');
    return { executable, args };
  }, {
    verifyInstall: async () => ({ ok: true }),
    portReleasePollMs: 10,
    inspectProcessState: async ({ pid }) => ({
      process: Number.isInteger(pid) ? processSnapshot(pid, directory, process.execPath, args) : null,
      tcp: { known: true, occupied: false, owner: null },
      udp: { known: true, occupied: false, owner: null },
    }),
  });
  const first = await manager.start(id);
  const [tcp, udp] = await Promise.all([bindTcp(javaPort), bindUdp(bedrockPort)]);
  let tcpOpen = true;
  let udpOpen = true;
  t.after(async () => {
    if (tcpOpen) await closeTcp(tcp);
    if (udpOpen) await closeUdp(udp);
  });
  setTimeout(() => closeTcp(tcp).then(() => { tcpOpen = false; }), 25);
  setTimeout(() => closeUdp(udp).then(() => { udpOpen = false; udpReleased = true; }), 125);
  const restarted = await manager.start(id);
  assert.notEqual(restarted.pid, first.pid);
  assert.equal(commandCalls, 2);
  assert.equal(udpReleased, true);
  await manager.stop(id, 2_000);
});

test('graceful stop timeout leaves the owned child running and never falls back to PID termination', async (t) => {
  const managedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-no-pid-stop-'));
  t.after(() => fs.rm(managedRoot, { recursive: true, force: true }));
  const store = new InstanceStore(managedRoot);
  await store.initialize();
  const id = 'no-pid-stop';
  const directory = path.join(managedRoot, 'servers', id);
  await fs.mkdir(directory, { recursive: true });
  const tcpProbe = await bindTcp();
  const javaPort = tcpProbe.address().port;
  await closeTcp(tcpProbe);
  const udpProbe = await bindUdp();
  const bedrockPort = udpProbe.address().port;
  await closeUdp(udpProbe);
  const args = [fakeServer, '--ignore-first-stop'];
  const now = new Date().toISOString();
  await store.create({
    id, displayName: 'No PID Stop', projectId: 'family-server', kind: 'server', provisioningStatus: 'ready',
    status: 'stopped', pid: null, javaPort, bedrockPort, memoryMb: 1024, directory,
    javaExecutable: process.execPath, createdAt: now, updatedAt: now,
  });
  const manager = new ProcessManager(store, { async append() {} }, process.execPath, (_instance, executable) => ({ executable, args }), {
    verifyInstall: async () => ({ ok: true }),
    inspectProcessState: async ({ pid }) => ({
      process: Number.isInteger(pid) ? processSnapshot(pid, directory, process.execPath, args) : null,
      tcp: { known: true, occupied: false, owner: null },
      udp: { known: true, occupied: false, owner: null },
    }),
  });
  const started = await manager.start(id);
  await assert.rejects(() => manager.stop(id, 100), (error) => {
    assert.equal(error.code, 'MANAGED_GRACEFUL_STOP_TIMEOUT');
    assert.match(error.message, /left running.*no PID termination fallback/i);
    return true;
  });
  assert.equal((await store.get(id)).pid, started.pid);
  assert.doesNotThrow(() => process.kill(started.pid, 0));
  assert.equal((await manager.stop(id, 2_000)).status, 'stopped');
});

test('shutdown locks every Family Server, reports safe-stop failures, and reopens starts after failure', async () => {
  const store = {
    async list() { return [{ id: 'owned-child', projectId: 'family-server', kind: 'server' }]; },
  };
  const manager = new ProcessManager(store, { async append() {} }, process.execPath);
  const locked = [];
  manager.withInstanceLock = async (id) => {
    locked.push(id);
    throw Object.assign(new Error('graceful stop timed out'), { code: 'MANAGED_GRACEFUL_STOP_TIMEOUT' });
  };
  await assert.rejects(() => manager.shutdown(), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors[0].code, 'MANAGED_GRACEFUL_STOP_TIMEOUT');
    return true;
  });
  assert.deepEqual(locked, ['owned-child']);
  assert.equal(manager.draining, false);
});

test('shutdown closes the in-flight Start race before spawn and drains under the instance lock', async (t) => {
  const managedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-drain-race-'));
  t.after(() => fs.rm(managedRoot, { recursive: true, force: true }));
  const store = new InstanceStore(managedRoot);
  await store.initialize();
  const id = 'drain-race';
  const directory = path.join(managedRoot, 'servers', id);
  await fs.mkdir(directory, { recursive: true });
  const tcpProbe = await bindTcp();
  const javaPort = tcpProbe.address().port;
  await closeTcp(tcpProbe);
  const udpProbe = await bindUdp();
  const bedrockPort = udpProbe.address().port;
  await closeUdp(udpProbe);
  const now = new Date().toISOString();
  await store.create({
    id, displayName: 'Drain Race', projectId: 'family-server', kind: 'server', provisioningStatus: 'ready',
    status: 'stopped', pid: null, javaPort, bedrockPort, memoryMb: 1024, directory,
    javaExecutable: process.execPath, createdAt: now, updatedAt: now,
  });
  let releaseVerification;
  const verificationReleased = new Promise((resolve) => { releaseVerification = resolve; });
  let verificationStarted;
  const atVerification = new Promise((resolve) => { verificationStarted = resolve; });
  let spawnCommands = 0;
  const manager = new ProcessManager(store, { async append() {} }, process.execPath, () => {
    spawnCommands += 1;
    return { executable: process.execPath, args: [fakeServer] };
  }, {
    verifyInstall: async () => {
      verificationStarted();
      await verificationReleased;
    },
  });

  const start = manager.start(id);
  await atVerification;
  const shutdown = manager.shutdown();
  releaseVerification();
  await assert.rejects(() => start, (error) => {
    assert.equal(error.code, 'CONTROL_PLANE_DRAINING');
    return true;
  });
  await shutdown;
  assert.equal(spawnCommands, 0);
  assert.equal(manager.draining, true);
  assert.equal((await store.get(id)).status, 'stopped');
});

async function capabilityFixture(t, id) {
  const managedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-process-capability-'));
  t.after(() => fs.rm(managedRoot, { recursive: true, force: true }));
  const store = new InstanceStore(managedRoot);
  await store.initialize();
  const directory = path.join(managedRoot, 'servers', id);
  await fs.mkdir(directory, { recursive: true });
  const tcp = await bindTcp(); const javaPort = tcp.address().port; await closeTcp(tcp);
  const udp = await bindUdp(); const bedrockPort = udp.address().port; await closeUdp(udp);
  const now = new Date().toISOString();
  await store.create({
    id, displayName: id, projectId: 'family-server', kind: 'server', provisioningStatus: 'ready',
    status: 'stopped', pid: null, javaPort, bedrockPort, memoryMb: 1024, directory,
    javaExecutable: process.execPath, createdAt: now, updatedAt: now,
  });
  return { store, directory, args: [fakeServer] };
}

test('Start consumes only the verified command and holds its launch lease through child exit', async (t) => {
  const id = 'capability-command';
  const value = await capabilityFixture(t, id);
  let commandFactoryCalls = 0;
  let assertCalls = 0;
  let releaseCalls = 0;
  const manager = new ProcessManager(value.store, { async append() {} }, 'C:\\untrusted\\java.exe', () => {
    commandFactoryCalls += 1;
    throw new Error('unverified command factory must not run');
  }, {
    verifyInstall: async () => ({
      ok: true,
      command: { executable: process.execPath, args: value.args, cwd: value.directory },
      lease: {
        async assertHeld() { assertCalls += 1; },
        async release() { releaseCalls += 1; },
      },
    }),
    inspectProcessState: async ({ pid }) => ({
      process: Number.isInteger(pid) ? processSnapshot(pid, value.directory, process.execPath, value.args) : null,
      tcp: { known: true, occupied: false, owner: null },
      udp: { known: true, occupied: false, owner: null },
    }),
  });
  await manager.start(id);
  assert.equal(commandFactoryCalls, 0);
  assert.ok(assertCalls >= 1);
  assert.equal(releaseCalls, 0);
  await manager.stop(id, 2_000);
  assert.equal(releaseCalls, 1);
});

test('readiness acknowledgement borrows the held launch directory guards without releasing the lease', async (t) => {
  const id = 'readiness-guard-context';
  const value = await capabilityFixture(t, id);
  const acknowledged = deferred();
  let guardContext = false;
  let contextCalls = 0;
  let releaseCalls = 0;
  const manager = new ProcessManager(value.store, { async append() {} }, process.execPath, undefined, {
    verifyInstall: async () => ({
      command: { executable: process.execPath, args: value.args, cwd: value.directory },
      lease: {
        async assertHeld() {},
        async withHeldDirectoryGuards(operation) {
          contextCalls += 1;
          guardContext = true;
          try { return await operation(); } finally { guardContext = false; }
        },
        async release() { releaseCalls += 1; },
      },
    }),
    inspectProcessState: async ({ pid }) => ({
      process: Number.isInteger(pid) ? processSnapshot(pid, value.directory, process.execPath, value.args) : null,
      tcp: { known: true, occupied: false, owner: null },
      udp: { known: true, occupied: false, owner: null },
    }),
    readinessStabilityMs: 0,
    async onReady(instanceId, evidence) {
      assert.equal(instanceId, id);
      assert.equal(guardContext, true);
      assert.deepEqual(evidence, { javaReady: true, geyserReady: true, stableForMs: 0 });
      acknowledged.resolve();
    },
  });
  await manager.start(id);
  await Promise.race([
    acknowledged.promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('readiness acknowledgement timed out')), 2_000)),
  ]);
  assert.equal(contextCalls, 1);
  assert.equal(releaseCalls, 0);
  await manager.stop(id, 2_000);
  assert.equal(releaseCalls, 1);
});

test('a pre-spawn lease substitution failure prevents process creation and releases the capability', async (t) => {
  const id = 'capability-substitution';
  const value = await capabilityFixture(t, id);
  let commandFactoryCalls = 0;
  let releaseCalls = 0;
  const manager = new ProcessManager(value.store, { async append() {} }, process.execPath, () => {
    commandFactoryCalls += 1;
    throw new Error('command factory must not run');
  }, {
    verifyInstall: async () => ({
      ok: true,
      command: { executable: process.execPath, args: value.args, cwd: value.directory },
      lease: {
        async assertHeld() { throw new Error('injected pre-spawn substitution'); },
        async release() { releaseCalls += 1; },
      },
    }),
  });
  await assert.rejects(() => manager.start(id), /pre-spawn substitution/);
  assert.equal(commandFactoryCalls, 0);
  assert.equal(releaseCalls, 1);
  assert.equal(manager.children.has(id), false);
  assert.equal((await value.store.get(id)).status, 'failed');
});

test('the default verifier receives exact mod and first-party core launch bindings under the instance lock', async (t) => {
  const id = 'default-mod-binding';
  const value = await capabilityFixture(t, id);
  let providerCalls = 0;
  let bindingReleases = 0;
  let coreProviderCalls = 0;
  let coreBindingReleases = 0;
  const modLaunchBinding = {
    binding: { schemaVersion: 1, instanceId: id, generation: 'a'.repeat(64), inventoryDigest: 'b'.repeat(64), mods: [] },
    async assertHeld() { return true; },
    async release() { bindingReleases += 1; },
  };
  const firstPartyCoreLaunchBinding = {
    binding: { schemaVersion: 2, instanceId: id, generation: 'c'.repeat(64), artifacts: [] },
    async assertHeld() { return true; },
    async release() { coreBindingReleases += 1; },
  };
  const manager = new ProcessManager(value.store, { async append() {} }, process.execPath, undefined, {
    defaultInstallVerifier: async (instance, options) => {
      assert.equal(instance.id, id);
      assert.equal(options.requireLaunchCapability, true);
      assert.equal(options.modLaunchBinding, modLaunchBinding);
      assert.equal(options.firstPartyCoreLaunchBinding, firstPartyCoreLaunchBinding);
      return {
        command: { executable: process.execPath, args: value.args, cwd: value.directory },
        lease: {
          async assertHeld() { await modLaunchBinding.assertHeld(); await firstPartyCoreLaunchBinding.assertHeld(); },
          async release() { await modLaunchBinding.release(); await firstPartyCoreLaunchBinding.release(); },
        },
      };
    },
    inspectProcessState: async ({ pid }) => ({
      process: Number.isInteger(pid) ? processSnapshot(pid, value.directory, process.execPath, value.args) : null,
      tcp: { known: true, occupied: false, owner: null },
      udp: { known: true, occupied: false, owner: null },
    }),
  });
  manager.setLaunchModBindingProvider(async (instanceId) => {
    providerCalls += 1;
    assert.equal(instanceId, id);
    return modLaunchBinding;
  });
  manager.setFirstPartyCoreLaunchBindingProvider(async (instanceId) => {
    coreProviderCalls += 1;
    assert.equal(instanceId, id);
    return firstPartyCoreLaunchBinding;
  });
  await manager.start(id);
  assert.equal(providerCalls, 1);
  assert.equal(coreProviderCalls, 1);
  assert.equal(bindingReleases, 0);
  assert.equal(coreBindingReleases, 0);
  await manager.stop(id, 2_000);
  assert.equal(bindingReleases, 1);
  assert.equal(coreBindingReleases, 1);
});

test('a malformed partial custom capability releases its lease before command construction', async (t) => {
  const id = 'partial-capability';
  const value = await capabilityFixture(t, id);
  let releaseCalls = 0;
  let commandFactoryCalls = 0;
  const manager = new ProcessManager(value.store, { async append() {} }, process.execPath, () => {
    commandFactoryCalls += 1;
    return { executable: process.execPath, args: value.args };
  }, {
    verifyInstall: async () => ({
      lease: { async assertHeld() {}, async release() { releaseCalls += 1; } },
    }),
  });
  await assert.rejects(() => manager.start(id), /incomplete launch capability/i);
  assert.equal(releaseCalls, 1);
  assert.equal(commandFactoryCalls, 0);
});

test('backup quiescence requires stopped inventory and both Java TCP and Bedrock UDP release', async (t) => {
  const managedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-backup-quiescence-'));
  t.after(() => fs.rm(managedRoot, { recursive: true, force: true }));
  const store = new InstanceStore(managedRoot);
  await store.initialize();
  const id = 'backup-quiescence';
  const directory = path.join(managedRoot, 'servers', id);
  await fs.mkdir(directory, { recursive: true });
  const tcpProbe = await bindTcp();
  const javaPort = tcpProbe.address().port;
  await closeTcp(tcpProbe);
  const udpProbe = await bindUdp();
  const bedrockPort = udpProbe.address().port;
  await closeUdp(udpProbe);
  const now = new Date().toISOString();
  await store.create({
    id, displayName: 'Backup Quiescence', projectId: 'family-server', kind: 'server', provisioningStatus: 'ready',
    status: 'stopped', pid: null, managedProcess: null, javaPort, bedrockPort, memoryMb: 1024, directory,
    createdAt: now, updatedAt: now,
  });
  const manager = new ProcessManager(store, { async append() {} }, process.execPath);
  assert.equal((await manager.assertQuiescent(id)).id, id);

  await store.update(id, { status: 'running', pid: 123 });
  await assert.rejects(() => manager.assertQuiescent(id), (error) => error.code === 'BACKUP_SERVER_NOT_QUIESCENT');
  await store.update(id, { status: 'stopped', pid: null, managedProcess: null });

  const occupiedUdp = await bindUdp(bedrockPort);
  t.after(() => closeUdp(occupiedUdp));
  await assert.rejects(() => manager.assertQuiescent(id), (error) => {
    assert.equal(error.code, 'BACKUP_SERVER_NOT_QUIESCENT');
    assert.match(error.message, /Bedrock UDP port/);
    return true;
  });
});
