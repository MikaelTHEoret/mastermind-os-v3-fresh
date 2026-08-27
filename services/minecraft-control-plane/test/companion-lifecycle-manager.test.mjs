import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import test from 'node:test';
import {
  CompanionLifecycleError,
  CompanionLifecycleManager,
} from '../src/companion/lifecycle-manager.mjs';
import { encodeMinecraftCredentialFrame } from '../src/companion/credential-frame.mjs';

const executable = path.resolve('C:/Mastermind/Java/bin/javaw.exe');
const workingDirectory = path.resolve('C:/Mastermind/clients/family-ai');
const commandArgs = ['-Xmx2G', '-jar', 'family-ai-client.jar'];
const creationTime = '2026-08-13T12:00:00.000Z';
const privateSession = Object.freeze({
  username: 'FamilyAgent', uuid: '00112233445566778899aabbccddeeff',
  accessToken: 'private-minecraft-access-token-1234567890', xuid: '281474976710655',
  clientId: '01234567-89ab-4def-8123-456789abcdef',
});
const manifest = Object.freeze({
  clientId: 'family-ai-client',
  bridgeVersion: '0.1.0',
  minecraftVersion: '26.2',
  loaderVersion: '0.19.3',
  baritoneVersion: '1.18.0',
});

function quoteWindowsArg(value) {
  if (!/[\s"]/u.test(value)) return value;
  return `"${value.replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\+)$/u, '$1$1')}"`;
}

function exactProcessInfo(pid = 4242) {
  const argv = [executable, ...commandArgs];
  return {
    pid,
    processName: 'javaw.exe',
    executablePath: executable,
    commandLine: process.platform === 'win32'
      ? argv.map(quoteWindowsArg).join(' ')
      : argv.join('\\u0000'),
    creationTime,
    workingDirectory,
  };
}

class FakeChild extends EventEmitter {
  constructor(pid = 4242) {
    super();
    this.pid = pid;
    this.exitCode = null;
    this.signalCode = null;
    this.killCalls = [];
    this.stdinBytes = [];
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        this.stdinBytes.push(Buffer.from(chunk));
        callback();
      },
    });
  }

  start() {
    queueMicrotask(() => this.emit('spawn'));
  }

  finish(code = 0, signal = null) {
    if (this.exitCode !== null || this.signalCode !== null) return;
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
  }

  kill(signal = 'SIGTERM') {
    this.killCalls.push(signal);
    queueMicrotask(() => this.finish(null, signal));
    return true;
  }
}

async function fixture(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-companion-lifecycle-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const stateFile = path.join(directory, 'companion.json');
  const children = [];
  const spawns = [];
  const spawnProcess = overrides.spawnProcess ?? ((command, args, options) => {
    const child = new FakeChild();
    children.push(child);
    spawns.push({ command, args, options });
    child.start();
    return child;
  });
  const inspectProcessState = overrides.inspectProcessState ?? (async ({ pid }) => ({
    process: exactProcessInfo(pid), tcp: { known: false, occupied: false, owner: null },
    udp: { known: false, occupied: false, owner: null },
  }));
  const manager = new CompanionLifecycleManager({
    stateFile,
    spawnProcess,
    inspectProcessState,
    captureTimeoutMs: 50,
    inspectPollMs: 1,
    ...overrides.options,
  });
  await manager.initialize();
  return { manager, stateFile, children, spawns };
}

async function launch(manager, overrides = {}) {
  return manager.launch({
    command: {
      executable,
      args: commandArgs,
      cwd: workingDirectory,
      env: { MASTERMIND_FAMILY_CLIENT_PROFILE: 'family' },
    },
    manifest,
    familyServerPort: 25565,
    credentialFrame: encodeMinecraftCredentialFrame(privateSession),
    ...overrides,
  });
}

test('launch gives the bearer only to the child environment and persists a sanitized exact launch record', async (t) => {
  const { manager, stateFile, spawns } = await fixture(t);
  const status = await launch(manager);
  assert.equal(status.state, 'running');
  assert.equal(status.pid, 4242);
  assert.match(status.sessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);
  assert.deepEqual(status.versionManifest, manifest);
  assert.equal(Object.hasOwn(status, 'bridgeTokenSha256'), false);
  assert.equal(Object.hasOwn(status, 'processIdentity'), false);

  assert.deepEqual(spawns[0].args, commandArgs);
  assert.equal(spawns[0].options.shell, false);
  assert.equal(spawns[0].options.cwd, process.platform === 'win32' ? workingDirectory.toLowerCase() : workingDirectory);
  const rawToken = spawns[0].options.env.MASTERMIND_COMPANION_BRIDGE_TOKEN;
  assert.match(rawToken, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(spawns[0].options.env.MASTERMIND_FAMILY_BRIDGE_SESSION_ID, status.sessionId);
  assert.equal(spawns[0].options.env.MASTERMIND_FAMILY_SERVER_PORT, '25565');
  assert.equal(spawns[0].options.env.MASTERMIND_FAMILY_CLIENT_PROFILE, 'family');
  assert.deepEqual(spawns[0].options.stdio, ['pipe', 'ignore', 'ignore']);
  assert.equal(JSON.stringify(spawns[0]).includes(privateSession.accessToken), false);
  assert.equal(JSON.stringify(status).includes(rawToken), false);

  const persisted = await fs.readFile(stateFile, 'utf8');
  const privateRecord = JSON.parse(persisted).companion;
  assert.equal(persisted.includes(rawToken), false);
  assert.equal(persisted.includes('MASTERMIND_COMPANION_BRIDGE_TOKEN'), false);
  assert.match(privateRecord.bridgeTokenSha256, /^[0-9a-f]{64}$/u);
  assert.equal(privateRecord.processIdentity.owner, 'mastermind-family-companion');
  assert.equal(privateRecord.processIdentity.pid, 4242);
  assert.match(privateRecord.processIdentity.spawnSpecSha256, /^[0-9a-f]{64}$/u);
  assert.equal(persisted.includes(commandArgs.join(' ')), false);
  assert.equal(persisted.includes(privateSession.accessToken), false);
});

test('writes the exact private credential frame once and closes child stdin before identity admission', async (t) => {
  const { manager, children } = await fixture(t);
  await launch(manager);
  const received = Buffer.concat(children[0].stdinBytes);
  const expected = encodeMinecraftCredentialFrame(privateSession);
  assert.deepEqual(received, expected);
  assert.equal(children[0].stdin.writableEnded, true);
  received.fill(0);
  expected.fill(0);
});

test('credential stdin failure kills the exact child and never admits it as running', async (t) => {
  let child;
  const { manager } = await fixture(t, {
    spawnProcess() {
      child = new FakeChild();
      child.stdin = new Writable({
        write(_chunk, _encoding, callback) { callback(); },
        final(callback) { callback(new Error('private pipe failed')); },
      });
      child.start();
      return child;
    },
  });
  await assert.rejects(launch(manager), (error) => (
    error instanceof CompanionLifecycleError
    && error.code === 'COMPANION_CREDENTIAL_PIPE_FAILED'
    && !error.message.includes(privateSession.accessToken)
  ));
  assert.deepEqual(child.killCalls, ['SIGTERM']);
  assert.equal(manager.status().state, 'failed');
  assert.equal(manager.status().pid, null);
  assert.equal(manager.isActive(), false);
});

test('a failed credential channel still reports active when its exact child rejects termination', async (t) => {
  let child;
  const { manager } = await fixture(t, {
    spawnProcess() {
      child = new FakeChild();
      child.stdin = new Writable({
        write(_chunk, _encoding, callback) { callback(); },
        final(callback) { callback(new Error('private pipe failed')); },
      });
      child.kill = (signal) => { child.killCalls.push(signal); return false; };
      child.start();
      return child;
    },
  });
  await assert.rejects(launch(manager), (error) => error.code === 'COMPANION_CREDENTIAL_PIPE_FAILED');
  assert.equal(manager.status().state, 'failed');
  assert.equal(manager.isActive(), true);
  assert.deepEqual(child.killCalls, ['SIGTERM']);
});

test('post-transfer lifecycle persistence failure terminates the exact child and leaves no live untracked companion', async (t) => {
  let persistCalls = 0;
  let child;
  const privateFailure = String.raw`C:\private\state\credential-${privateSession.accessToken}`;
  const { manager } = await fixture(t, {
    spawnProcess() {
      child = new FakeChild();
      child.start();
      return child;
    },
    options: {
      async persistRecord() {
        persistCalls += 1;
        if (persistCalls === 2) throw new Error(privateFailure);
      },
    },
  });
  await assert.rejects(launch(manager), (error) => (
    error instanceof CompanionLifecycleError
    && error.code === 'COMPANION_STATE_PERSIST_FAILED'
    && error.statusCode === 500
    && error.message === 'The managed companion launch was aborted because lifecycle state could not be committed.'
    && !error.message.includes(privateSession.accessToken)
    && !error.message.includes(privateFailure)
  ));
  assert.equal(Buffer.concat(child.stdinBytes).includes(Buffer.from(privateSession.accessToken)), true);
  assert.deepEqual(child.killCalls, ['SIGTERM']);
  assert.equal(manager.isActive(), false);
  assert.equal(manager.status().state, 'failed');
  assert.equal(JSON.stringify(manager.publicStatus()).includes(privateSession.accessToken), false);
  assert.equal(JSON.stringify(manager.publicStatus()).includes(privateFailure), false);
});

test('persistence failure retains exact-child tracking when that child rejects termination', async (t) => {
  let persistCalls = 0;
  let child;
  const { manager } = await fixture(t, {
    spawnProcess() {
      child = new FakeChild();
      child.kill = (signal) => { child.killCalls.push(signal); return false; };
      child.start();
      return child;
    },
    options: {
      async persistRecord() {
        persistCalls += 1;
        if (persistCalls === 2) throw new Error('private state path');
      },
    },
  });
  await assert.rejects(launch(manager), (error) => error.code === 'COMPANION_STATE_PERSIST_FAILED');
  assert.deepEqual(child.killCalls, ['SIGTERM']);
  assert.equal(manager.status().state, 'failed');
  assert.equal(manager.isActive(), true);
});

test('bridge token authentication is constant-record scoped and never returns the bearer', async (t) => {
  const { manager, spawns } = await fixture(t);
  const status = await launch(manager);
  const token = spawns[0].options.env.MASTERMIND_COMPANION_BRIDGE_TOKEN;
  assert.deepEqual(await manager.authenticateBridgeToken({ token }), {
    sessionId: status.sessionId,
    expectedPid: 4242,
  });
  assert.equal(await manager.authenticateBridgeToken({ token: 'wrong-token' }), null);
  assert.equal(await manager.authenticateBridgeToken({ token: '' }), null);
  assert.equal(JSON.stringify(await manager.authenticateBridgeToken({ token })).includes(token), false);
  await assert.rejects(launch(manager), (error) => (
    error instanceof CompanionLifecycleError && error.code === 'COMPANION_ALREADY_ACTIVE'
  ));
});

test('verifyHello requires the authenticated session, exact manifest, PID, and live process identity', async (t) => {
  let processInfo = exactProcessInfo();
  const { manager, spawns } = await fixture(t, {
    inspectProcessState: async () => ({ process: processInfo }),
  });
  const status = await launch(manager);
  const auth = await manager.authenticateBridgeToken({ token: spawns[0].options.env.MASTERMIND_COMPANION_BRIDGE_TOKEN });
  const hello = { ...manifest, pid: 4242, capabilities: ['state.snapshot', 'action.cancel'] };
  assert.equal(await manager.verifyHello(hello, auth), true);
  assert.equal(await manager.verifyHello({ ...hello, minecraftVersion: '1.21.4' }, auth), false);
  assert.equal(await manager.verifyHello({ ...hello, pid: 9999 }, auth), false);
  assert.equal(await manager.verifyHello(hello, { ...auth, sessionId: crypto.randomUUID() }), false);
  processInfo = { ...processInfo, creationTime: '2026-08-13T12:00:01.000Z' };
  assert.equal(await manager.verifyHello(hello, auth), false);
  assert.equal(status.pid, 4242);
});

test('graceful bridge shutdown is attempted before exact child-handle termination fallback', async (t) => {
  const events = [];
  let child;
  const bridgeControl = {
    requestShutdown(timeoutMs) {
      events.push(`bridge:${timeoutMs}`);
      return { shutdownId: crypto.randomUUID() };
    },
  };
  const { manager, children } = await fixture(t, {
    options: { bridgeControl },
  });
  await launch(manager);
  child = children[0];
  const originalKill = child.kill.bind(child);
  child.kill = (signal) => {
    events.push(`kill:${signal}`);
    return originalKill(signal);
  };
  const status = await manager.stop({ gracefulTimeoutMs: 5, terminationTimeoutMs: 50 });
  assert.deepEqual(events, ['bridge:5', 'kill:SIGTERM']);
  assert.deepEqual(child.killCalls, ['SIGTERM']);
  assert.equal(status.state, 'stopped');
  assert.equal(status.pid, null);
  assert.equal(await manager.authenticateBridgeToken({ token: 'anything' }), null);
});

test('an exiting client completes graceful shutdown without any termination signal', async (t) => {
  let child;
  const bridgeControl = {
    requestShutdown() {
      queueMicrotask(() => child.finish(0, null));
      return { shutdownId: crypto.randomUUID() };
    },
  };
  const { manager, children } = await fixture(t, { options: { bridgeControl } });
  await launch(manager);
  child = children[0];
  const status = await manager.stop({ gracefulTimeoutMs: 50, terminationTimeoutMs: 50 });
  assert.deepEqual(child.killCalls, []);
  assert.equal(status.state, 'stopped');
  assert.equal(status.lastExit.code, 0);
});

test('an asynchronously rejected bridge shutdown request is observed before child fallback', async (t) => {
  const bridgeControl = {
    async requestShutdown() {
      throw new Error('bridge disconnected');
    },
  };
  const { manager, children } = await fixture(t, { options: { bridgeControl } });
  await launch(manager);
  const status = await manager.stop({ gracefulTimeoutMs: 5, terminationTimeoutMs: 50 });
  assert.deepEqual(children[0].killCalls, ['SIGTERM']);
  assert.equal(status.state, 'stopped');
});

test('spawn identity mismatch is killed through the owned handle and never becomes bridge-authenticatable', async (t) => {
  const { manager, children, spawns } = await fixture(t, {
    inspectProcessState: async () => ({
      process: { ...exactProcessInfo(), executablePath: path.resolve('C:/Other/javaw.exe') },
    }),
  });
  await assert.rejects(launch(manager), (error) => (
    error instanceof CompanionLifecycleError && error.code === 'COMPANION_IDENTITY_UNVERIFIED'
  ));
  assert.deepEqual(children[0].killCalls, ['SIGTERM']);
  assert.equal(manager.status().state, 'failed');
  assert.equal(await manager.authenticateBridgeToken({ token: spawns[0].options.env.MASTERMIND_COMPANION_BRIDGE_TOKEN }), null);
});

test('manager restart keeps sanitized evidence but fails closed as an orphan without an exact child handle', async (t) => {
  const first = await fixture(t);
  const running = await launch(first.manager);
  const persisted = JSON.parse(await fs.readFile(first.stateFile, 'utf8'));

  const secondManager = new CompanionLifecycleManager({
    stateFile: first.stateFile,
    spawnProcess() { throw new Error('must not spawn'); },
    inspectProcessState: async () => ({ process: exactProcessInfo() }),
  });
  await secondManager.initialize();
  const restarted = secondManager.status();
  assert.equal(restarted.state, 'orphaned');
  assert.equal(restarted.pid, running.pid);
  assert.equal(restarted.sessionId, running.sessionId);
  assert.equal(await secondManager.authenticateBridgeToken({ token: 'not-known-after-restart' }), null);
  assert.equal(Object.hasOwn(persisted, 'rawBridgeToken'), false);
  await assert.rejects(secondManager.stop(), (error) => (
    error instanceof CompanionLifecycleError && error.code === 'COMPANION_CHILD_HANDLE_UNAVAILABLE'
  ));
});

test('reserved bridge credential environment keys cannot be overridden by a launch specification', async (t) => {
  const { manager } = await fixture(t);
  await assert.rejects(launch(manager, {
    command: {
      executable,
      args: commandArgs,
      cwd: workingDirectory,
      env: { MASTERMIND_COMPANION_BRIDGE_TOKEN: 'attacker-selected' },
    },
  }), (error) => error instanceof TypeError && /reserved/u.test(error.message));
});

test('Family Server port is required as a typed launch field and cannot be overridden through generic env', async (t) => {
  const { manager } = await fixture(t);
  await assert.rejects(launch(manager, { familyServerPort: 0 }), (error) => (
    error instanceof TypeError && /familyServerPort/u.test(error.message)
  ));
  await assert.rejects(launch(manager, {
    command: {
      executable,
      args: commandArgs,
      cwd: workingDirectory,
      env: { MASTERMIND_FAMILY_SERVER_PORT: '25566' },
    },
  }), (error) => error instanceof TypeError && /reserved/u.test(error.message));
});

test('public status and persisted errors never reveal token hashes, process fingerprints, or failure paths', async (t) => {
  const privatePath = String.raw`C:\Users\Mik\Secret\javaw.exe`;
  const { manager, stateFile } = await fixture(t, {
    spawnProcess() { throw new Error(`ENOENT ${privatePath}`); },
  });
  await assert.rejects(launch(manager), (error) => (
    error instanceof CompanionLifecycleError && error.code === 'COMPANION_SPAWN_FAILED'
  ));
  const status = manager.publicStatus();
  assert.equal(Object.hasOwn(status, 'bridgeTokenSha256'), false);
  assert.equal(Object.hasOwn(status, 'processIdentity'), false);
  assert.equal(JSON.stringify(status).includes(privatePath), false);
  const persisted = await fs.readFile(stateFile, 'utf8');
  assert.equal(persisted.includes(privatePath), false);
  assert.equal(JSON.parse(persisted).companion.lastError, 'The managed companion process could not be spawned.');
});
