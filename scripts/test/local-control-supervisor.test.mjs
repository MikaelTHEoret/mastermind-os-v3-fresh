import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  SupervisorStateStore,
  createInitialState,
  identityMatches,
  processIdentity,
  stopPreviousSupervisor,
} from '../lib/local-control-supervisor.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-local-supervisor-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace');
  await fs.mkdir(workspace, { recursive: true });
  const store = new SupervisorStateStore(path.join(root, 'data'));
  await store.initialize();
  const snapshot = (pid, commandLine, parentPid = 1, startFileTime = `${133000000000000000n + BigInt(pid)}`, args = null) => ({
    pid,
    parentPid,
    startFileTime,
    executablePath: process.execPath,
    commandLine,
    workingDirectory: workspace,
    arguments: args,
  });
  const supervisorSnapshot = snapshot(101, 'node scripts/run-local-control.mjs');
  const supervisor = processIdentity(
    'supervisor',
    path.join(workspace, 'scripts', 'run-local-control.mjs'),
    supervisorSnapshot,
  );
  const agentSnapshot = snapshot(102, 'node services/minecraft-control-plane/src/agent.mjs', 101);
  const nextSnapshot = snapshot(103, 'node node_modules/next/dist/bin/next dev --port 3000', 101);
  const agent = {
    ...processIdentity(
      'minecraft-control-agent',
      path.join(workspace, 'services', 'minecraft-control-plane', 'src', 'agent.mjs'),
      agentSnapshot,
    ),
    port: 43100,
  };
  const next = {
    ...processIdentity(
      'next-web',
      path.join(workspace, 'node_modules', 'next', 'dist', 'bin', 'next'),
      nextSnapshot,
    ),
    port: 3000,
  };
  const state = createInitialState({
    workspace,
    mode: 'development',
    supervisor,
    pipeName: `\\\\.\\pipe\\mastermind-local-control-${'a'.repeat(32)}`,
  });
  state.children = [agent, next];
  await store.write(state, workspace);
  return {
    workspace,
    store,
    state,
    snapshots: new Map([[101, supervisorSnapshot], [102, agentSnapshot], [103, nextSnapshot]]),
  };
}

test('leaves exact signed children running when their supervisor cannot confirm a safe drain', async (t) => {
  const context = await fixture(t);
  await assert.rejects(stopPreviousSupervisor({
    store: context.store,
    workspace: context.workspace,
    inspect: async (pid) => context.snapshots.get(pid) ?? null,
    checkPort: async () => true,
  }), /incomplete starting inventory|did not confirm a safe Minecraft drain/);
  assert.notEqual(await context.store.read(context.workspace), null);
});

test('uses the graceful ownership channel without forced termination', async (t) => {
  const context = await fixture(t);
  let requested;
  let gracefulRequested = false;
  const result = await stopPreviousSupervisor({
    store: context.store,
    workspace: context.workspace,
    inspect: async (pid) => gracefulRequested ? null : context.snapshots.get(pid) ?? null,
    checkPort: async () => true,
    requestGracefulTakeover: async (state) => {
      requested = state.supervisorId;
      gracefulRequested = true;
      return true;
    },
  });
  assert.equal(result.action, 'graceful-takeover');
  assert.equal(requested, context.state.supervisorId);
});

test('reads and gracefully replaces a signed schema-1 two-child supervisor after upgrade', async (t) => {
  const context = await fixture(t);
  await context.store.write({ ...context.state, schemaVersion: 1 }, context.workspace);
  const legacy = await context.store.read(context.workspace);
  assert.equal(legacy.schemaVersion, 1);
  assert.deepEqual(legacy.children.map(({ role }) => role), [
    'minecraft-control-agent',
    'next-web',
  ]);

  let accepted = false;
  const result = await stopPreviousSupervisor({
    store: context.store,
    workspace: context.workspace,
    inspect: async (pid) => accepted ? null : context.snapshots.get(pid) ?? null,
    checkPort: async () => true,
    requestGracefulTakeover: async () => { accepted = true; return true; },
  });
  assert.equal(result.action, 'graceful-takeover');
});

test('schema-2 state accepts only the frozen portless node-link identity', async (t) => {
  const context = await fixture(t);
  const nodeSnapshot = {
    pid: 104,
    parentPid: context.state.supervisor.pid,
    startFileTime: '133000000000000104',
    executablePath: process.execPath,
    commandLine: 'node services/mastermind-node-link/src/run-worker.mjs',
    arguments: [process.execPath, 'services/mastermind-node-link/src/run-worker.mjs'],
    workingDirectory: context.workspace,
  };
  const nodeLink = {
    ...processIdentity(
      'mastermind-node-link',
      path.join(context.workspace, 'services', 'mastermind-node-link', 'src', 'run-worker.mjs'),
      nodeSnapshot,
    ),
    port: null,
  };
  await context.store.write({ ...context.state, children: [...context.state.children, nodeLink] }, context.workspace);
  const stored = await context.store.read(context.workspace);
  assert.equal(stored.schemaVersion, 2);
  assert.equal(stored.children.at(-1).role, 'mastermind-node-link');
  assert.equal(stored.children.at(-1).port, null);

  await assert.rejects(
    context.store.write({
      ...context.state,
      children: [...context.state.children, { ...nodeLink, port: 43101 }],
    }, context.workspace),
    /unexpected child identity/,
  );
  await assert.rejects(
    context.store.write({ ...context.state, schemaVersion: 1, children: [...context.state.children, nodeLink] }, context.workspace),
    /does not belong|unexpected child identity/,
  );
});

test('graceful takeover waits for the exact prior supervisor to exit after its ports are free', async (t) => {
  const context = await fixture(t);
  let handoffAccepted = false;
  let supervisorInspections = 0;
  const result = await stopPreviousSupervisor({
    store: context.store,
    workspace: context.workspace,
    inspect: async (pid) => {
      if (pid !== context.state.supervisor.pid) {
        return handoffAccepted ? null : context.snapshots.get(pid) ?? null;
      }
      supervisorInspections += 1;
      // The ports and children disappear immediately, while the exact old
      // supervisor remains alive for one more observation before exiting.
      if (handoffAccepted && supervisorInspections >= 3) return null;
      return context.snapshots.get(pid) ?? null;
    },
    checkPort: async () => true,
    requestGracefulTakeover: async () => {
      handoffAccepted = true;
      return true;
    },
  });
  assert.equal(result.action, 'graceful-takeover');
  assert.ok(
    supervisorInspections >= 3,
    'success must follow a fresh observation that the exact prior supervisor exited, not merely free ports',
  );
});

test('PID reuse protection refuses to kill a different process', async (t) => {
  const context = await fixture(t);
  const reused = { ...context.snapshots.get(102), startFileTime: '133999999999999999', commandLine: 'node unrelated.mjs' };
  context.snapshots.set(102, reused);
  await assert.rejects(
    stopPreviousSupervisor({
      store: context.store,
      workspace: context.workspace,
      inspect: async (pid) => context.snapshots.get(pid) ?? null,
      checkPort: async (port) => port !== 3000,
    }),
    /PID reuse protection refused/,
  );
});

test('cleans a signed stale record when every recorded process is gone', async (t) => {
  const context = await fixture(t);
  const result = await stopPreviousSupervisor({
    store: context.store,
    workspace: context.workspace,
    inspect: async () => null,
    checkPort: async () => true,
  });
  assert.equal(result.action, 'cleaned-stale');
  assert.equal(await context.store.read(context.workspace), null);
});

test('never treats a busy unrecorded port as permission to kill', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-local-unowned-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace');
  await fs.mkdir(workspace);
  const store = new SupervisorStateStore(path.join(root, 'data'));
  await store.initialize();
  await assert.rejects(
    stopPreviousSupervisor({
      store,
      workspace,
      inspect: async () => null,
      checkPort: async (port) => port !== 3000,
    }),
    /unsupervised local command center or another process.*Nothing was terminated/,
  );
});

test('a partial signed startup record cannot authorize forced takeover of an unrecorded child', async (t) => {
  const context = await fixture(t);
  const startingState = { ...context.state, children: [] };
  await context.store.write(startingState, context.workspace);

  const agentEntrypoint = path.join(
    context.workspace,
    'services',
    'minecraft-control-plane',
    'src',
    'agent.mjs',
  );
  const unrecordedAgent = {
    pid: 104,
    parentPid: context.state.supervisor.pid,
    startFileTime: '133000000000000104',
    executablePath: process.execPath,
    commandLine: `node ${agentEntrypoint}`,
    arguments: [process.execPath, agentEntrypoint],
    workingDirectory: context.workspace,
  };
  const snapshots = new Map([
    [context.state.supervisor.pid, context.snapshots.get(context.state.supervisor.pid)],
    [unrecordedAgent.pid, unrecordedAgent],
  ]);
  const owners = new Map([[43100, unrecordedAgent.pid]]);

  await assert.rejects(stopPreviousSupervisor({
    store: context.store,
    workspace: context.workspace,
    inspect: async (pid) => snapshots.get(pid) ?? null,
    checkPort: async (port) => !owners.has(port),
    requestGracefulTakeover: async () => false,
  }));
  assert.notEqual(await context.store.read(context.workspace), null);
});

test('a responsive signed supervisor may gracefully hand off while its agent is intentionally offline', async (t) => {
  const context = await fixture(t);
  const nextOnly = {
    ...context.state,
    children: context.state.children.filter((record) => record.role === 'next-web'),
  };
  await context.store.write(nextOnly, context.workspace);
  let accepted = false;
  const result = await stopPreviousSupervisor({
    store: context.store,
    workspace: context.workspace,
    inspect: async (pid) => accepted ? null : context.snapshots.get(pid) ?? null,
    checkPort: async () => true,
    requestGracefulTakeover: async () => { accepted = true; return true; },
  });
  assert.equal(result.action, 'graceful-takeover');
});

test('first upgraded launch recognizes exact legacy owners but requires manual shutdown', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-local-bootstrap-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace');
  await fs.mkdir(workspace);
  const store = new SupervisorStateStore(path.join(root, 'data'));
  await store.initialize();
  const owners = new Map([[3000, 202], [43100, 201]]);
  await assert.rejects(stopPreviousSupervisor({
    store,
    workspace,
    checkPort: async (port) => !owners.has(port),
  }), (error) => error?.code === 'LEGACY_MANUAL_SHUTDOWN_REQUIRED');
});

test('first upgraded launch rejects a foreign port owner without termination', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-local-bootstrap-foreign-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace');
  await fs.mkdir(workspace);
  const store = new SupervisorStateStore(path.join(root, 'data'));
  await store.initialize();
  await assert.rejects(stopPreviousSupervisor({
    store,
    workspace,
    checkPort: async (port) => port !== 3000,
  }), /unsupervised local command center or another process.*Nothing was terminated/);
});

test('an unauthenticated ownership record can never authorize termination', async (t) => {
  const context = await fixture(t);
  const raw = JSON.parse(await fs.readFile(context.store.stateFile, 'utf8'));
  raw.children[0].pid = 999;
  await fs.writeFile(context.store.stateFile, JSON.stringify(raw));
  const result = await stopPreviousSupervisor({
    store: context.store,
    workspace: context.workspace,
    inspect: async (pid) => context.snapshots.get(pid) ?? null,
    checkPort: async () => true,
  });
  assert.equal(result.action, 'cleaned-invalid-state');
  assert.match(result.warning, /failed authentication/);
  assert.equal(await fs.stat(context.store.stateFile).catch(() => null), null, 'safe stale state should be removed');
});

test('signed child identities require both a command fingerprint and exact parent identity', async (t) => {
  for (const [name, field] of [
    ['command fingerprint', 'commandLineSha256'],
    ['parent identity', 'parentPid'],
  ]) {
    await t.test(name, async (subtest) => {
      const context = await fixture(subtest);
      const incomplete = structuredClone(context.state);
      incomplete.children[0][field] = null;
      assert.equal(
        identityMatches(incomplete.children[0], context.snapshots.get(incomplete.children[0].pid)),
        false,
        `a child without its ${name} must never be considered an exact process match`,
      );
      await assert.rejects(
        context.store.write(incomplete, context.workspace),
        /identity|fingerprint|parent/i,
        `a child without its ${name} must never be accepted into signed ownership state`,
      );
    });
  }
});

test('old supervisor close cleanup cannot start a fresh ownership scan that could target a replacement generation', async () => {
  const source = await fs.readFile(new URL('../run-local-control.mjs', import.meta.url), 'utf8');
  const closeStart = source.indexOf('async function close(');
  const closeEnd = source.indexOf("\nprocess.on('SIGINT'", closeStart);
  assert.notEqual(closeStart, -1, 'the local-control close routine must remain inspectable');
  assert.notEqual(closeEnd, -1, 'the local-control close routine boundary must remain inspectable');
  const closeSource = source.slice(closeStart, closeEnd);
  assert.doesNotMatch(
    closeSource,
    /\btakeOverLegacyLocalControl\s*\(/,
    'an old generation may clean only identities it already recorded; rescanning ports can discover and kill its replacement',
  );
});
