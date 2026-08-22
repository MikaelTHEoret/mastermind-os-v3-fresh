import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  composeWorldStackBinding,
  createControlPlane,
  formatBackupInitializationDiagnostic,
  formatLifecycleFailureDiagnostic,
  formatUpdateLifecycleFailureDiagnostic,
  formatWorldInitializationFailureDiagnostic,
  publicBackupInitializationFailure,
  publicBackupRecoveryOverview,
} from '../src/agent.mjs';
import { readConfig, validateProvisionRequest } from '../src/config.mjs';

const token = 'test-control-token-0123456789-abcdef';
const memoryEventPlayerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

async function freeTcpPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function freeUdpPort() {
  const socket = dgram.createSocket('udp4');
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(0, '127.0.0.1', resolve);
  });
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

async function fixture(t, extra = {}) {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-minecraft-'));
  const worlds = extra.useProductionWorlds === true ? undefined : extra.worlds ?? {
    async preflightRecoveryEvidence() { return { domain: 'world', instances: [] }; },
    async initialize() { return []; },
    async assertMutationAllowedWithinInstanceLock() { return true; },
    async assertStackUpdateAllowedWithinInstanceLock() { return true; },
    async assertModMutationAllowedWithinInstanceLock() { return true; },
    async reconcileGeneratedWorldWithinInstanceLock() { return false; },
  };
  const preparedExtra = { ...extra };
  delete preparedExtra.config;
  for (const [name, domain] of [['backups', 'backup'], ['mods', 'mods'], ['worlds', 'world'], ['updater', 'update']]) {
    const manager = name === 'worlds' ? worlds : preparedExtra[name];
    if (manager && typeof manager.preflightRecoveryEvidence !== 'function') {
      manager.preflightRecoveryEvidence = async () => ({ domain, instances: [] });
    }
  }
  const app = await createControlPlane({
    config: {
      host: '127.0.0.1', port: 43100, token, dataRoot, javaExecutable: process.execPath,
      ...(extra.config ?? {}),
    },
    verifyInstall: async () => ({ ok: true }),
    inspectProcessState: async ({ pid }) => ({
      process: Number.isInteger(pid) ? {
        pid,
        processName: 'node',
        executablePath: process.execPath,
        commandLine: `"${process.execPath}" mastermind-test-child-${pid}`,
        creationTime: '2026-08-13T00:00:00.000Z',
      } : null,
      tcp: { known: true, occupied: false, owner: null },
    }),
    launchIntegrityKeyAcquirer: async () => ({ async release() {} }),
    worlds,
    ...preparedExtra,
  });
  const address = await app.listen(0);
  t.after(async () => { await app.close(); await fs.rm(dataRoot, { recursive: true, force: true }); });
  return { app, dataRoot, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('world stack generation binds both authenticated launch-trust digests', () => {
  const stack = { generation: '1'.repeat(64), inventoryDigest: '2'.repeat(64) };
  const instance = {
    minecraftVersion: '26.2',
    worldDataVersion: 4440,
    minecraftServerArtifact: {
      minecraftVersion: '26.2', relativePath: 'versions/26.2/server-26.2.jar',
      size: 1, sha1: '3'.repeat(40), sha256: '4'.repeat(64), worldDataVersion: 4440,
    },
    javaRuntime: {
      launchAssetDigest: '5'.repeat(64),
      launchInventoryDigest: '6'.repeat(64),
    },
  };
  const baseline = composeWorldStackBinding(instance, stack);
  assert.equal(baseline.inventoryDigest, stack.inventoryDigest);
  assert.match(baseline.generation, /^[a-f0-9]{64}$/);
  assert.notEqual(composeWorldStackBinding({
    ...instance, javaRuntime: { ...instance.javaRuntime, launchAssetDigest: '7'.repeat(64) },
  }, stack).generation, baseline.generation);
  assert.notEqual(composeWorldStackBinding({
    ...instance, javaRuntime: { ...instance.javaRuntime, launchInventoryDigest: '8'.repeat(64) },
  }, stack).generation, baseline.generation);
  assert.throws(
    () => composeWorldStackBinding({ ...instance, javaRuntime: {} }, stack, 'BACKUP_STACK_UNAVAILABLE'),
    (error) => error?.code === 'BACKUP_STACK_UNAVAILABLE' && error?.statusCode === 503,
  );
});

test('formats only closed world initialization stages and error codes', () => {
  assert.equal(formatWorldInitializationFailureDiagnostic({
    name: 'Error', code: 'WORLD_INTEGRITY_FAILED', worldInitializationStage: 'catalog-initialization',
  }), 'Family Server world manager initialization failed at catalog-initialization (WORLD_INTEGRITY_FAILED; ERROR).');
  assert.equal(formatWorldInitializationFailureDiagnostic({
    name: 'Error', code: 'EBUSY', worldInitializationStage: 'store-read',
  }), 'Family Server world manager initialization failed at store-read (EBUSY; ERROR).');
  assert.equal(formatWorldInitializationFailureDiagnostic({
    name: 'TypeError', code: 'C:\\private\\secret', worldInitializationStage: 'C:\\private\\secret',
  }), 'Family Server world manager initialization failed at unknown (WORLD_INITIALIZATION_FAILED; TYPE_ERROR).');
});

test('startup unconditionally establishes the external launch-integrity key boundary', async (t) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-launch-key-pin-'));
  const managedRoot = path.join(dataRoot, 'projects', 'family-server');
  await fs.mkdir(path.join(managedRoot, 'state'), { recursive: true });
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const store = {
    async initialize() {},
    async list() { return []; },
  };
  let acquisitions = 0;
  await assert.rejects(() => createControlPlane({
    config: { host: '127.0.0.1', port: 43100, token, dataRoot, javaExecutable: process.execPath },
    managedRoot,
    store,
    launchIntegrityKeyAcquirer: async () => {
      acquisitions += 1;
      throw Object.assign(new Error('launch key boundary unavailable'), { code: 'LAUNCH_INTEGRITY_UNAVAILABLE', statusCode: 503 });
    },
  }), (error) => error?.code === 'LAUNCH_INTEGRITY_UNAVAILABLE' && error?.statusCode === 503);
  assert.equal(acquisitions, 1);
});

test('requires the management token and rejects browser-direct calls', async (t) => {
  const { baseUrl } = await fixture(t);
  const health = await fetch(`${baseUrl}/healthz`);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('access-control-allow-origin'), null);

  const missing = await fetch(`${baseUrl}/v1/instances`);
  assert.equal(missing.status, 401);
  const browser = await fetch(`${baseUrl}/v1/instances`, { headers: { Authorization: `Bearer ${token}`, Origin: 'http://evil.invalid' } });
  assert.equal(browser.status, 403);
});

test('memory identity configuration is canonical and required only for opt-in synchronization', () => {
  const configured = readConfig({
    MASTERMIND_CONTROL_TOKEN: token,
    MASTERMIND_MEMORY_EVENT_SYNC_ENABLED: 'true',
    MASTERMIND_MEMORY_PLAYER_ID: memoryEventPlayerId,
  });
  assert.equal(configured.memoryEventSyncEnabled, true);
  assert.equal(configured.memoryEventPlayerId, memoryEventPlayerId);

  for (const playerId of [undefined, memoryEventPlayerId.toUpperCase(), 'not-a-player-id']) {
    assert.throws(
      () => readConfig({
        MASTERMIND_CONTROL_TOKEN: token,
        MASTERMIND_MEMORY_EVENT_SYNC_ENABLED: 'true',
        ...(playerId === undefined ? {} : { MASTERMIND_MEMORY_PLAYER_ID: playerId }),
      }),
      (error) => error?.code === 'MEMORY_IDENTITY_REQUIRED'
        && error.message === 'Memory event synchronization requires a configured family player identity.',
    );
  }

  const disabled = readConfig({
    MASTERMIND_CONTROL_TOKEN: token,
    MASTERMIND_MEMORY_EVENT_SYNC_ENABLED: 'false',
    MASTERMIND_MEMORY_PLAYER_ID: 'not-a-player-id',
  });
  assert.equal(disabled.memoryEventSyncEnabled, false);
  assert.equal(disabled.memoryEventPlayerId, null);
});

test('enabled memory synchronization without identity fails before the consumer starts', async () => {
  let syncStarts = 0;
  await assert.rejects(
    () => createControlPlane({
      config: {
        host: '127.0.0.1', port: 43100, token, dataRoot: 'not-used', javaExecutable: process.execPath,
        memoryEventSyncEnabled: true,
      },
      memoryEventSync: {
        start() { syncStarts += 1; },
        async finalDrain() {},
        async close() {},
      },
    }),
    (error) => error?.code === 'MEMORY_IDENTITY_REQUIRED'
      && error.message === 'Memory event synchronization requires a configured family player identity.',
  );
  assert.equal(syncStarts, 0);
});

test('an unbound control plane never creates a playerless memory-event backlog', async (t) => {
  let initialized = 0;
  let enqueued = 0;
  const backups = {
    async preflightRecoveryEvidence() { return { domain: 'backup', instances: [] }; },
    setWorldInterlock() {}, setWorldRestoreValidator() {},
    async initialize() { return []; },
    recoveryStatus() { return { manualRecoveryRequired: 0, global: false, instanceIds: [] }; },
    async assertSafeForLifecycle() { return true; },
  };
  const mods = {
    async prepareStackValidation() {},
    async preflightRecoveryEvidence() { return { domain: 'mods', instances: [] }; },
    setWorldInterlock() {}, setLifecycleLock() {},
    async initialize() { return []; },
    async assertSafeForLifecycle() { return true; },
    async assertStackUpdateAllowedWithinInstanceLock() { return true; },
  };
  const updater = {
    async preflightRecoveryEvidence() { return { domain: 'update', instances: [] }; },
    setStackInterlock() {},
    async reconcileInterruptedTransactions() { return []; },
    async assertSafeForLifecycle() { return true; },
  };
  const { app } = await fixture(t, {
    backups, mods, updater, administration: { async initialize() {} },
    domainEventOutbox: {
      async initialize() { initialized += 1; },
      async enqueue() { enqueued += 1; },
    },
  });
  assert.equal(app.domainEventOutbox, null);
  assert.equal(app.companionDomainEvents, null);
  app.companionSessions.emit('ready', {
    sessionId: '22222222-2222-4222-8222-222222222222',
    connectedAt: '2026-08-14T12:00:00.000Z',
  });
  assert.equal(initialized, 0);
  assert.equal(enqueued, 0);
});

test('wires the durable shared-memory outbox after recovery and keeps companion payloads bounded', async (t) => {
  const events = [];
  let initialized = 0;
  let disabledSyncStarts = 0;
  const domainEventOutbox = {
    async initialize() { initialized += 1; },
    async assertNoUnboundCompanionEvents() {},
    async enqueue(event) { events.push(event); },
  };
  const memoryEventSync = {
    start() { disabledSyncStarts += 1; },
    async finalDrain() {},
    async close() {},
  };
  const backups = {
    async preflightRecoveryEvidence() { return { domain: 'backup', instances: [] }; },
    setWorldInterlock() {}, setWorldRestoreValidator() {},
    async initialize() { return []; },
    recoveryStatus() { return { manualRecoveryRequired: 0, global: false, instanceIds: [] }; },
    async assertSafeForLifecycle() { return true; },
  };
  const mods = {
    async prepareStackValidation() {},
    async preflightRecoveryEvidence() { return { domain: 'mods', instances: [] }; },
    setWorldInterlock() {}, setLifecycleLock() {},
    async initialize() { return []; },
    async assertSafeForLifecycle() { return true; },
    async assertStackUpdateAllowedWithinInstanceLock() { return true; },
  };
  const updater = {
    async preflightRecoveryEvidence() { return { domain: 'update', instances: [] }; },
    setStackInterlock() {},
    async reconcileInterruptedTransactions() { return []; },
    async assertSafeForLifecycle() { return true; },
  };
  const administration = { async initialize() {} };
  const { app } = await fixture(t, {
    config: { memoryEventSyncEnabled: false, memoryEventPlayerId },
    domainEventOutbox, memoryEventSync, backups, mods, updater, administration,
  });
  const sessionId = '22222222-2222-4222-8222-222222222222';
  const actionId = '33333333-3333-4333-8333-333333333333';
  app.companionSessions.emit('ready', {
    sessionId, connectedAt: '2026-08-14T12:00:00.000Z', client: { credential: 'must-not-persist' },
  });
  app.companionSessions.emit('actionDispatched', {
    actionId, kind: 'skill.navigateTo', status: 'dispatched',
    dispatchedAt: '2026-08-14T12:00:01.000Z', deadlineAt: '2026-08-14T12:05:01.000Z',
    action: { args: { x: 1, y: 64, z: 2 } },
  });
  app.companionSessions.emit('actionStatus', {
    actionId, status: 'succeeded', result: { code: 'arrived', detail: 'must-not-persist' },
  }, { actionId, kind: 'skill.navigateTo', status: 'succeeded' });
  await app.companionDomainEvents.flush();
  assert.equal(initialized, 1);
  assert.equal(app.domainEventOutbox, domainEventOutbox);
  assert.equal(app.memoryEventSync, null);
  assert.equal(disabledSyncStarts, 0);
  assert.deepEqual(events.map((event) => event.kind), ['session.started', 'action.requested', 'action.completed']);
  assert.doesNotMatch(JSON.stringify(events), /credential|must-not-persist|"x"|"y"|"z"/);
});

test('opt-in memory sync starts safely and shutdown flushes its producer before the final drain and close', async (t) => {
  const trace = [];
  const captured = [];
  let bridgeClosed = false;
  let finalDrained = false;
  let syncClosed = false;
  const domainEventOutbox = {
    async initialize() {},
    async assertNoUnboundCompanionEvents() {},
    async enqueue(value) {
      trace.push('producer-flush');
      captured.push(value);
    },
  };
  const memoryEventSync = {
    start() { trace.push('sync-start'); },
    async finalDrain() {
      if (finalDrained) return;
      finalDrained = true;
      assert.equal(captured.length, 1);
      trace.push('sync-final-drain');
    },
    async close() {
      if (syncClosed) return;
      syncClosed = true;
      trace.push('sync-close');
    },
  };
  const companionBridge = {
    start() { trace.push('bridge-start'); },
    async close() {
      if (bridgeClosed) return;
      bridgeClosed = true;
      trace.push('bridge-close');
    },
  };
  const backups = {
    async preflightRecoveryEvidence() { return { domain: 'backup', instances: [] }; },
    setWorldInterlock() {}, setWorldRestoreValidator() {},
    async initialize() { return []; },
    recoveryStatus() { return { manualRecoveryRequired: 0, global: false, instanceIds: [] }; },
    async assertSafeForLifecycle() { return true; },
  };
  const mods = {
    async prepareStackValidation() {},
    async preflightRecoveryEvidence() { return { domain: 'mods', instances: [] }; },
    setWorldInterlock() {}, setLifecycleLock() {},
    async initialize() { return []; },
    async assertSafeForLifecycle() { return true; },
    async assertStackUpdateAllowedWithinInstanceLock() { return true; },
  };
  const updater = {
    async preflightRecoveryEvidence() { return { domain: 'update', instances: [] }; },
    setStackInterlock() {},
    async reconcileInterruptedTransactions() { return []; },
    async assertSafeForLifecycle() { return true; },
  };
  const administration = { async initialize() {} };
  const { app } = await fixture(t, {
    config: { memoryEventSyncEnabled: true, memoryEventPlayerId },
    domainEventOutbox,
    memoryEventSync,
    companionBridge,
    backups,
    mods,
    updater,
    administration,
  });
  assert.equal(app.memoryEventSync, memoryEventSync);
  app.companionSessions.emit('ready', {
    sessionId: '22222222-2222-4222-8222-222222222222',
    connectedAt: '2026-08-14T12:00:00.000Z',
  });
  await app.close();
  assert.deepEqual(captured.map((value) => value.kind), ['session.started']);
  assert.deepEqual(trace, [
    'sync-start',
    'bridge-start',
    'bridge-close',
    'producer-flush',
    'sync-final-drain',
    'sync-close',
  ]);
});

test('wires read-only world restore validation before backup recovery and world initialization', async (t) => {
  const events = [];
  let restoreValidator = null;
  const mods = {
    async prepareStackValidation() { events.push('mod-key-ready'); },
    async acquireLaunchBindingWithinInstanceLock(instanceId) { return { instanceId, source: 'authenticated-mod-manager' }; },
    setWorldInterlock() { events.push('mod-world-interlock'); },
    async initialize() { events.push('mod-initialize'); return []; },
    async assertStackUpdateAllowedWithinInstanceLock() { return true; },
  };
  const updater = {
    setStackInterlock() { events.push('update-stack-interlock'); },
    async reconcileInterruptedTransactions() { events.push('update-reconcile'); return []; },
  };
  const worlds = {
    async prepareRestoreValidation() { events.push('world-key-ready'); },
    async initialize() { events.push('world-initialize'); return []; },
    async validateRestoredStateWithinInstanceLock(id, binding, options) {
      events.push('world-validate'); assert.equal(id, 'family-server'); assert.equal(typeof options.directory, 'string'); return binding;
    },
    async assertMutationAllowedWithinInstanceLock() { return true; },
    async assertStackUpdateAllowedWithinInstanceLock() { return true; },
    async assertModMutationAllowedWithinInstanceLock() { return true; },
    async reconcileGeneratedWorldWithinInstanceLock() { return false; },
  };
  const backups = {
    setWorldInterlock() { events.push('backup-world-interlock'); },
    setWorldRestoreValidator(callback) { restoreValidator = callback; events.push('backup-validator-wired'); },
    async initialize() {
      events.push('backup-initialize');
      assert.equal(typeof restoreValidator, 'function');
      await restoreValidator('family-server', { generation: 'a'.repeat(64), inventoryDigest: 'b'.repeat(64) }, { directory: 'trusted-candidate' });
      return [];
    },
    recoveryStatus() { return { manualRecoveryRequired: 0, global: false, instanceIds: [] }; },
  };
  const { app } = await fixture(t, { worlds, backups, mods, updater });
  assert.deepEqual(events, [
    'world-key-ready', 'mod-key-ready', 'backup-world-interlock', 'backup-validator-wired',
    'mod-world-interlock', 'update-stack-interlock', 'backup-initialize', 'world-validate',
    'mod-initialize', 'world-initialize', 'update-reconcile',
  ]);
  assert.deepEqual(await app.processes.launchModBindingProvider('family-server'), {
    instanceId: 'family-server', source: 'authenticated-mod-manager',
  });
  delete mods.acquireLaunchBindingWithinInstanceLock;
  assert.throws(
    () => app.processes.launchModBindingProvider('family-server'),
    (error) => error?.code === 'LAUNCH_TRUST_UNAVAILABLE' && error?.statusCode === 503,
  );
});

test('constructs the production world manager with its fail-closed lifecycle callback installed', async (t) => {
  const mods = {
    async prepareStackValidation() {},
    async preflightRecoveryEvidence() { return { domain: 'mods', instances: [] }; },
    setWorldInterlock() {},
    async initialize() { return []; },
    async assertStackUpdateAllowedWithinInstanceLock() { return true; },
    assertSafeForLifecycle() {},
  };
  const backups = {
    async preflightRecoveryEvidence() { return { domain: 'backup', instances: [] }; },
    setWorldInterlock() {}, setWorldRestoreValidator() {},
    async initialize() { return []; },
    recoveryStatus() { return { manualRecoveryRequired: 0, global: false, instanceIds: [] }; },
  };
  const updater = {
    async preflightRecoveryEvidence() { return { domain: 'update', instances: [] }; },
    setStackInterlock() {},
    async reconcileInterruptedTransactions() { return []; },
    async assertSafeForLifecycle() { return true; },
  };
  const { app } = await fixture(t, { useProductionWorlds: true, mods, backups, updater });
  assert.ok(app.worlds);
});

for (const interruptedPhase of ['original-backed-up', 'candidate-published']) {
  test(`reconciles sole ${interruptedPhase} update evidence before mod and world initialization`, async (t) => {
    const events = [];
    let updatePending = true;
    let preflightPasses = 0;
    const backups = {
      async preflightRecoveryEvidence() { preflightPasses += 1; return { domain: 'backup', instances: [] }; },
      setWorldInterlock() {}, setWorldRestoreValidator() {},
      async initialize() { events.push('backup-initialize'); return []; },
      recoveryStatus() { return { manualRecoveryRequired: 0, global: false, instanceIds: [] }; },
    };
    const mods = {
      async prepareStackValidation() {}, setWorldInterlock() {},
      async preflightRecoveryEvidence() { preflightPasses += 1; return { domain: 'mods', instances: [] }; },
      async initialize() { events.push('mod-initialize'); return []; },
      async assertStackUpdateAllowedWithinInstanceLock() { return true; },
    };
    const worlds = {
      async prepareRestoreValidation() {},
      async preflightRecoveryEvidence() { preflightPasses += 1; return { domain: 'world', instances: [] }; },
      async initialize() { events.push('world-initialize'); return []; },
      async assertMutationAllowedWithinInstanceLock() { return true; },
      async assertStackUpdateAllowedWithinInstanceLock() { return true; },
      async assertModMutationAllowedWithinInstanceLock() { return true; },
      async reconcileGeneratedWorldWithinInstanceLock() { return false; },
    };
    const updater = {
      setStackInterlock() {},
      async preflightRecoveryEvidence() {
        preflightPasses += 1;
        return { domain: 'update', instances: updatePending
          ? [{ instanceId: 'family-server', transactionRef: '123e4567-e89b-42d3-a456-426614174000' }]
          : [] };
      },
      async reconcileInterruptedTransactions() {
        assert.deepEqual(events, ['backup-initialize']);
        events.push(`update-${interruptedPhase}`);
        updatePending = false;
        return [{ instanceId: 'family-server', action: 'rolled-back' }];
      },
      async assertSafeForLifecycle() { return true; },
    };
    await fixture(t, { backups, mods, worlds, updater });
    assert.deepEqual(events, ['backup-initialize', `update-${interruptedPhase}`, 'mod-initialize', 'world-initialize']);
    assert.ok(preflightPasses >= 8, 'all four recovery domains were rechecked after update recovery');
  });
}

test('admits only authenticated pending-readiness update evidence after recovery', async (t) => {
  const events = [];
  let lifecycleLock = null;
  const pending = [{
    instanceId: 'family-server', transactionRef: '123e4567-e89b-42d3-a456-426614174000',
  }];
  const backups = {
    async preflightRecoveryEvidence() { return { domain: 'backup', instances: [] }; },
    setWorldInterlock() {}, setWorldRestoreValidator() {},
    async initialize() { events.push('backup-initialize'); return []; },
    recoveryStatus() { return { manualRecoveryRequired: 0, global: false, instanceIds: [] }; },
  };
  const mods = {
    async prepareStackValidation() {}, setWorldInterlock() {},
    setLifecycleLock(callback) { lifecycleLock = callback; },
    async preflightRecoveryEvidence() { return { domain: 'mods', instances: [] }; },
    async initialize() { events.push('mod-initialize'); return []; },
    async assertStackUpdateAllowedWithinInstanceLock() { return true; },
  };
  const worlds = {
    async prepareRestoreValidation() {},
    async preflightRecoveryEvidence() { return { domain: 'world', instances: [] }; },
    async initialize() {
      assert.equal(typeof lifecycleLock, 'function');
      await lifecycleLock('family-server', async () => { events.push('world-lifecycle-lock'); });
      events.push('world-initialize');
      return [];
    },
    async assertMutationAllowedWithinInstanceLock() { return true; },
    async assertStackUpdateAllowedWithinInstanceLock() { return true; },
    async assertModMutationAllowedWithinInstanceLock() { return true; },
    async reconcileGeneratedWorldWithinInstanceLock() { return false; },
  };
  const updater = {
    setStackInterlock() {},
    async preflightRecoveryEvidence() { return { domain: 'update', instances: pending }; },
    async reconcileInterruptedTransactions() {
      events.push('update-reconcile');
      return [{ instanceId: 'family-server', phase: 'pending-readiness', action: 'awaiting-readiness' }];
    },
    async assertSafeForLifecycle(instanceId, options) {
      assert.equal(instanceId, 'family-server');
      assert.deepEqual(options, { allowPendingReadiness: true });
      events.push('update-pending-receipt-verified');
      return true;
    },
  };
  await fixture(t, { backups, mods, worlds, updater });
  assert.deepEqual(events, [
    'backup-initialize', 'update-reconcile', 'update-pending-receipt-verified',
    'mod-initialize', 'update-pending-receipt-verified', 'world-lifecycle-lock', 'world-initialize',
  ]);
});

test('keeps update recovery globally fenced when persistent evidence was not reconciled to readiness', async (t) => {
  const calls = { mods: 0, worlds: 0 };
  const pending = [{
    instanceId: 'family-server', transactionRef: '123e4567-e89b-42d3-a456-426614174000',
  }];
  const backups = {
    async preflightRecoveryEvidence() { return { domain: 'backup', instances: [] }; },
    setWorldInterlock() {}, setWorldRestoreValidator() {}, async initialize() { return []; },
    recoveryStatus() { return { manualRecoveryRequired: 0, global: false, instanceIds: [] }; },
  };
  const mods = {
    async prepareStackValidation() {}, setWorldInterlock() {},
    async preflightRecoveryEvidence() { return { domain: 'mods', instances: [] }; },
    async initialize() { calls.mods += 1; return []; }, async assertStackUpdateAllowedWithinInstanceLock() {},
  };
  const worlds = {
    async prepareRestoreValidation() {},
    async preflightRecoveryEvidence() { return { domain: 'world', instances: [] }; },
    async initialize() { calls.worlds += 1; return []; }, async assertMutationAllowedWithinInstanceLock() {},
    async assertStackUpdateAllowedWithinInstanceLock() {}, async assertModMutationAllowedWithinInstanceLock() {},
    async reconcileGeneratedWorldWithinInstanceLock() {},
  };
  const updater = {
    setStackInterlock() {},
    async preflightRecoveryEvidence() { return { domain: 'update', instances: pending }; },
    async reconcileInterruptedTransactions() { return []; },
    async assertSafeForLifecycle() { throw new Error('must not waive unmatched evidence'); },
  };
  const { baseUrl } = await fixture(t, { backups, mods, worlds, updater });
  assert.deepEqual(calls, { mods: 0, worlds: 0 });
  const response = await fetch(`${baseUrl}/v1/instances/family-server/start`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'UPDATE_RECOVERY_REQUIRED');
});

test('fences globally when a post-recovery preflight reveals another unfinished domain', async (t) => {
  const calls = { backup: 0, mods: 0, worlds: 0, updater: 0 };
  let updatePending = true;
  let hiddenModEvidence = false;
  const backups = {
    async preflightRecoveryEvidence() { return { domain: 'backup', instances: [] }; },
    setWorldInterlock() {}, setWorldRestoreValidator() {},
    async initialize() { calls.backup += 1; return []; },
    recoveryStatus() { return { manualRecoveryRequired: 0, global: false, instanceIds: [] }; },
  };
  const mods = {
    async prepareStackValidation() {}, setWorldInterlock() {},
    async preflightRecoveryEvidence() { return { domain: 'mods', instances: hiddenModEvidence
      ? [{ instanceId: 'family-server', transactionRef: `modtx-${'a'.repeat(64)}` }] : [] }; },
    async initialize() { calls.mods += 1; return []; },
    async assertStackUpdateAllowedWithinInstanceLock() { return true; },
  };
  const worlds = {
    async prepareRestoreValidation() {},
    async preflightRecoveryEvidence() { return { domain: 'world', instances: [] }; },
    async initialize() { calls.worlds += 1; return []; },
    async assertMutationAllowedWithinInstanceLock() { return true; },
    async assertStackUpdateAllowedWithinInstanceLock() { return true; },
    async assertModMutationAllowedWithinInstanceLock() { return true; },
    async reconcileGeneratedWorldWithinInstanceLock() { calls.worlds += 10; return false; },
  };
  const updater = {
    setStackInterlock() {},
    async preflightRecoveryEvidence() { return { domain: 'update', instances: updatePending
      ? [{ instanceId: 'family-server', transactionRef: '123e4567-e89b-42d3-a456-426614174000' }] : [] }; },
    async reconcileInterruptedTransactions() {
      calls.updater += 1; updatePending = false; hiddenModEvidence = true; return [];
    },
    async assertSafeForLifecycle() { return true; },
  };
  const { baseUrl } = await fixture(t, { backups, mods, worlds, updater });
  assert.deepEqual(calls, { backup: 1, mods: 0, worlds: 0, updater: 1 });
  const response = await fetch(`${baseUrl}/v1/instances/family-server/start`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    ok: false, code: 'CONTROL_RECOVERY_REQUIRED',
    message: 'Managed recovery evidence requires verified repair before local mutations can continue.',
  });
});

test('does not enable all-manager lifecycle checks until active world recovery and later managers initialize', async (t) => {
  const events = [];
  let lifecycleLock = null;
  let worldPending = true;
  let modsInitialized = false;
  let worldsInitialized = false;
  const processes = {
    async withInstanceLock(_id, operation) { return operation(); },
    async isActive() { return false; }, async shutdown() {},
  };
  const backups = {
    async preflightRecoveryEvidence() { return { domain: 'backup', instances: [] }; },
    setWorldInterlock() {}, setWorldRestoreValidator() {}, async initialize() { events.push('backup'); return []; },
    recoveryStatus() { return { manualRecoveryRequired: 0, global: false, instanceIds: [] }; },
    async assertSafeForLifecycle() { events.push('backup-fence'); },
  };
  const mods = {
    async preflightRecoveryEvidence() { return { domain: 'mods', instances: [] }; },
    async prepareStackValidation() {}, setWorldInterlock() {}, setLifecycleLock(callback) { lifecycleLock = callback; },
    async initialize() { events.push('mods'); modsInitialized = true; return []; },
    async assertStackUpdateAllowedWithinInstanceLock() {},
    async assertSafeForLifecycle() {
      assert.equal(modsInitialized, true, 'the mod fence must not run before mod initialization');
    },
  };
  const worlds = {
    async preflightRecoveryEvidence() { return { domain: 'world', instances: worldPending ? [{
      instanceId: 'family-server', transactionRef: `worldtx-${'b'.repeat(64)}`,
    }] : [] }; },
    async prepareRestoreValidation() {},
    async initialize() {
      events.push('world');
      await lifecycleLock('family-server', async () => { events.push('world-locked-recovery'); });
      worldPending = false;
      worldsInitialized = true;
      return [{ instanceId: 'family-server', action: 'reconciled' }];
    },
    async assertSafeForLifecycle() {
      assert.equal(worldsInitialized, true, 'the world fence must not run during its own initialization');
    },
    async assertMutationAllowedWithinInstanceLock() {}, async assertStackUpdateAllowedWithinInstanceLock() {},
    async assertModMutationAllowedWithinInstanceLock() {}, async reconcileGeneratedWorldWithinInstanceLock() {},
  };
  const updater = {
    async preflightRecoveryEvidence() { return { domain: 'update', instances: [] }; },
    setStackInterlock() {}, async reconcileInterruptedTransactions() { events.push('update'); return []; },
    async assertSafeForLifecycle() { events.push('update-fence'); },
  };
  const { baseUrl } = await fixture(t, {
    processes, processRecovery: [], backups, mods, worlds, updater,
  });
  assert.deepEqual(events, [
    'backup', 'update', 'world', 'update-fence', 'backup-fence', 'world-locked-recovery', 'mods',
  ]);
  const response = await fetch(`${baseUrl}/v1/instances`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 200);
});

test('multiple-domain preflight enters sanitized read-only mode without running any recovery', async (t) => {
  const calls = { backup: 0, mods: 0, worlds: 0, updater: 0 };
  const pending = { instanceId: 'family-server' };
  const backups = {
    async preflightRecoveryEvidence() { return { domain: 'backup', instances: [{ ...pending, transactionRef: `rtx-${'a'.repeat(32)}` }] }; },
    setWorldInterlock() {}, setWorldRestoreValidator() {},
    async initialize() { calls.backup += 1; return []; },
    recoveryStatus() { return { manualRecoveryRequired: 0, global: false, instanceIds: [] }; },
  };
  const mods = {
    async prepareStackValidation() {}, setWorldInterlock() {},
    async preflightRecoveryEvidence() { return { domain: 'mods', instances: [{ ...pending, transactionRef: `modtx-${'b'.repeat(64)}` }] }; },
    async initialize() { calls.mods += 1; return []; }, async assertStackUpdateAllowedWithinInstanceLock() {},
  };
  const worlds = {
    async prepareRestoreValidation() {}, async preflightRecoveryEvidence() { return { domain: 'world', instances: [] }; },
    async initialize() { calls.worlds += 1; return []; }, async assertMutationAllowedWithinInstanceLock() {},
    async assertStackUpdateAllowedWithinInstanceLock() {}, async assertModMutationAllowedWithinInstanceLock() {},
    async reconcileGeneratedWorldWithinInstanceLock() { calls.worlds += 10; return false; },
  };
  const updater = {
    setStackInterlock() {}, async preflightRecoveryEvidence() { return { domain: 'update', instances: [] }; },
    async reconcileInterruptedTransactions() { calls.updater += 1; return []; }, async assertSafeForLifecycle() {},
  };
  const stopped = { id: 'family-server', displayName: 'Family Server', projectId: 'family-server', kind: 'server', minecraftVersion: '26.2', status: 'stopped', pid: null };
  const processes = {
    async withInstanceLock(_id, operation) { return operation(); }, async stopWithinInstanceLock() { return stopped; },
    async isActive() { return false; }, async shutdown() {},
  };
  const { baseUrl } = await fixture(t, { backups, mods, worlds, updater, processes, processRecovery: [] });
  assert.deepEqual(calls, { backup: 0, mods: 0, worlds: 0, updater: 0 });
  const headers = { Authorization: `Bearer ${token}` };
  const blocked = await fetch(`${baseUrl}/v1/provision`, { method: 'POST', headers });
  assert.equal(blocked.status, 409);
  const blockedBody = await blocked.json();
  assert.equal(blockedBody.code, 'CONTROL_RECOVERY_REQUIRED');
  assert.equal(JSON.stringify(blockedBody).includes('modtx-'), false);
  const stop = await fetch(`${baseUrl}/v1/instances/family-server/stop`, { method: 'POST', headers });
  assert.equal(stop.status, 200);
  assert.equal(calls.worlds, 0, 'fenced stop did not reconcile or mutate world state');
});

test('serves recovery truth and stop only when backup recovery globally fences later managers', async (t) => {
  const calls = { mods: 0, worlds: 0, updater: 0 };
  const stopped = {
    id: 'family-server', displayName: 'Family Server', projectId: 'family-server', kind: 'server',
    minecraftVersion: '26.2', status: 'stopped', pid: null,
  };
  const processes = {
    async withInstanceLock(_id, operation) { return operation(); },
    async stopWithinInstanceLock() { return structuredClone(stopped); },
    async isActive() { return false; },
    async shutdown() {},
  };
  const mods = {
    async prepareStackValidation() {}, setWorldInterlock() {},
    async initialize() { calls.mods += 1; return []; },
    async assertStackUpdateAllowedWithinInstanceLock() { return true; },
  };
  const worlds = {
    async prepareRestoreValidation() {},
    async initialize() { calls.worlds += 1; return []; },
    async assertMutationAllowedWithinInstanceLock() { return true; },
    async assertStackUpdateAllowedWithinInstanceLock() { return true; },
    async assertModMutationAllowedWithinInstanceLock() { return true; },
    async reconcileGeneratedWorldWithinInstanceLock() { calls.worlds += 10; return false; },
  };
  const backups = {
    setWorldInterlock() {}, setWorldRestoreValidator() {},
    async initialize() { return [{ action: 'manual-recovery-required', code: 'BACKUP_RECOVERY_INVALID' }]; },
    recoveryStatus() { return { manualRecoveryRequired: 1, global: true, instanceIds: [] }; },
  };
  const updater = {
    setStackInterlock() {},
    async reconcileInterruptedTransactions() { calls.updater += 1; return []; },
  };
  const { baseUrl } = await fixture(t, { processes, processRecovery: [], mods, worlds, backups, updater });
  assert.deepEqual(calls, { mods: 0, worlds: 0, updater: 0 });
  const headers = { Authorization: `Bearer ${token}` };
  assert.equal((await fetch(`${baseUrl}/v1/instances`, { headers })).status, 200);
  for (const endpoint of ['mods/installed', 'worlds']) {
    const response = await fetch(`${baseUrl}/v1/instances/family-server/${endpoint}`, { headers });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'BACKUP_MANUAL_RECOVERY_REQUIRED');
  }
  const start = await fetch(`${baseUrl}/v1/instances/family-server/start`, { method: 'POST', headers });
  assert.equal(start.status, 409);
  assert.equal((await start.json()).code, 'BACKUP_MANUAL_RECOVERY_REQUIRED');
  const stop = await fetch(`${baseUrl}/v1/instances/family-server/stop`, { method: 'POST', headers });
  assert.equal(stop.status, 200);
  assert.equal((await stop.json()).instance.status, 'stopped');
  assert.equal(calls.worlds, 0, 'fenced stop remains process-only');
});

test('formats only bounded backup initialization diagnostics', () => {
  const error = Object.assign(new Error('private C:\\live\\world detail'), {
    code: 'BACKUP_STORAGE_FAILED', statusCode: 500,
  });
  Object.defineProperty(error, 'backupInitializationStage', { value: 'storage-roots' });
  Object.defineProperty(error, 'cause', {
    value: Object.assign(new Error('private helper detail'), { code: 'WORLD_INTEGRITY_FAILED' }),
  });
  const diagnostic = formatBackupInitializationDiagnostic(error);
  assert.equal(
    diagnostic,
    'Family Server backup initialization fenced mutations safely '
      + '(stage=storage-roots, code=BACKUP_STORAGE_FAILED, cause=WORLD_INTEGRITY_FAILED).',
  );
  assert.equal(diagnostic.includes('C:\\live'), false);
  assert.equal(diagnostic.includes('helper detail'), false);
  assert.deepEqual(publicBackupInitializationFailure(error), {
    stage: 'storage-roots', code: 'BACKUP_STORAGE_FAILED', cause: 'WORLD_INTEGRITY_FAILED',
  });
  assert.deepEqual(publicBackupInitializationFailure(Object.assign(
    new Error('private fallback'),
    { code: 'not-public', backupInitializationStage: 'private-stage', cause: { code: 'also-private' } },
  )), {
    stage: 'unknown', code: 'BACKUP_INITIALIZATION_FAILED', cause: 'UNAVAILABLE',
  });
});

test('formats only bounded launch lifecycle diagnostics', () => {
  const error = Object.assign(new Error('private C:\\live\\server detail'), {
    code: 'not-public', launchVerificationStage: 'lease-acquire', privatePath: 'C:\\live\\server',
  });
  assert.equal(
    formatLifecycleFailureDiagnostic(error),
    'Family Server lifecycle action failed at lease-acquire (CONTROL_ACTION_FAILED).',
  );
  assert.equal(formatLifecycleFailureDiagnostic(error).includes('C:\\live'), false);
  assert.equal(
    formatLifecycleFailureDiagnostic({ code: 'LAUNCH_TRUST_UNAVAILABLE', launchVerificationStage: 'private-stage' }),
    'Family Server lifecycle action failed (LAUNCH_TRUST_UNAVAILABLE).',
  );
});

test('formats only closed update lifecycle fence stages', () => {
  const error = Object.assign(new Error('C:\\private\\state'), {
    code: 'UPDATE_RECOVERY_REQUIRED',
    updateLifecycleStage: 'store-receipt',
  });
  assert.equal(
    formatUpdateLifecycleFailureDiagnostic(error),
    'Family Server update lifecycle fence failed at store-receipt (UPDATE_RECOVERY_REQUIRED).',
  );
  assert.equal(formatUpdateLifecycleFailureDiagnostic(error).includes('C:\\private'), false);
  assert.equal(
    formatUpdateLifecycleFailureDiagnostic({ updateLifecycleStage: 'private-stage' }),
    'Family Server update lifecycle fence failed at unknown (UPDATE_RECOVERY_REQUIRED).',
  );
});

test('exposes only the bounded backup initialization failure in overview', () => {
  const initializationFailure = {
    stage: 'storage-roots', code: 'BACKUP_STORAGE_FAILED', cause: 'WORLD_INTEGRITY_FAILED',
    privatePath: 'C:\\live\\world', privateMessage: 'helper detail',
  };
  const overview = publicBackupRecoveryOverview({
    reconciled: 1,
    manualRecoveryRequired: 0,
    globalRecoveryRequired: 1,
    initializationFailure,
  });
  assert.deepEqual(overview, {
    reconciled: 1, manualRecoveryRequired: 0, globalRecoveryRequired: 1,
    initializationFailure: {
      stage: 'storage-roots', code: 'BACKUP_STORAGE_FAILED', cause: 'WORLD_INTEGRITY_FAILED',
    },
  });
  assert.equal(JSON.stringify(overview).includes('C:\\live'), false);
  assert.equal(JSON.stringify(overview).includes('helper detail'), false);
  assert.deepEqual(publicBackupRecoveryOverview({
    reconciled: 0, manualRecoveryRequired: 0, globalRecoveryRequired: 0,
  }), {
    reconciled: 0, manualRecoveryRequired: 0, globalRecoveryRequired: 0,
  });
});

test('leaves isolated Microsoft account operations available behind a global backup recovery fence', async (t) => {
  const calls = { start: 0, poll: 0, refresh: 0, signout: 0, registrations: [], newAuthInitializations: 0 };
  const accountStatus = {
    provider: 'microsoft', configured: true, signedIn: false, sessionReady: false, status: 'signed-out', account: null,
  };
  const flow = {
    flowId: '00000000-0000-4000-8000-000000000123', user_code: 'ABCD-EFGH',
    verification_uri: 'https://microsoft.com/devicelogin', expiry: '2026-08-13T00:10:00.000Z', status: 'pending',
  };
  const minecraftAuth = {
    async initialize() {},
    status() { return structuredClone(accountStatus); },
    async startDeviceFlow() { calls.start += 1; return structuredClone(flow); },
    async pollDeviceFlow() { calls.poll += 1; return structuredClone(flow); },
    async silentRefresh() { calls.refresh += 1; return structuredClone(accountStatus); },
    async signOut() { calls.signout += 1; return structuredClone(accountStatus); },
  };
  let stored = { clientId: '11111111-1111-4111-8111-111111111111' };
  const accountRegistration = {
    async load() { return stored; },
    async save(clientId) { calls.registrations.push(clientId); stored = { clientId }; },
  };
  const authFactory = () => ({
    async initialize() { calls.newAuthInitializations += 1; },
    status() { return structuredClone(accountStatus); },
  });
  const backups = {
    setWorldInterlock() {}, setWorldRestoreValidator() {},
    async initialize() { return [{ action: 'manual-recovery-required', code: 'BACKUP_RECOVERY_INVALID' }]; },
    recoveryStatus() { return { manualRecoveryRequired: 1, global: true, instanceIds: [] }; },
  };
  const mods = {
    async prepareStackValidation() {}, setWorldInterlock() {},
    async initialize() { throw new Error('global recovery must defer mod initialization'); },
  };
  const worlds = {
    async prepareRestoreValidation() {},
    async initialize() { throw new Error('global recovery must defer world initialization'); },
  };
  const updater = {
    setStackInterlock() {},
    async reconcileInterruptedTransactions() { throw new Error('global recovery must defer update initialization'); },
  };
  const { baseUrl } = await fixture(t, {
    backups, mods, worlds, updater, processRecovery: [], minecraftAuth, accountRegistration,
    accountConfig: stored, authFactory,
  });
  const requestHeaders = { Authorization: `Bearer ${token}` };

  for (const pathname of [
    '/v1/account/device/start',
    `/v1/account/device/${flow.flowId}/poll`,
    '/v1/account/refresh',
    '/v1/account/signout',
  ]) {
    const response = await fetch(`${baseUrl}${pathname}`, { method: 'POST', headers: requestHeaders });
    assert.equal(response.status, 200, pathname);
  }
  const replacementId = '22222222-2222-4222-8222-222222222222';
  const registration = await fetch(`${baseUrl}/v1/account/registration`, {
    method: 'POST',
    headers: { ...requestHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: replacementId }),
  });
  assert.equal(registration.status, 200);
  assert.deepEqual(calls, {
    start: 1, poll: 1, refresh: 1, signout: 2, registrations: [replacementId], newAuthInitializations: 1,
  });

  const clientProvision = await fetch(`${baseUrl}/v1/client/provision`, { method: 'POST', headers: requestHeaders });
  assert.equal(clientProvision.status, 409);
  assert.equal((await clientProvision.json()).code, 'BACKUP_MANUAL_RECOVERY_REQUIRED');
});

test('prepares authenticated supervisor shutdown, drains owned processes, and gates later mutations', async (t) => {
  const supervisorId = 'a'.repeat(32);
  const shutdownTimeouts = [];
  const processes = {
    async shutdown(timeoutMs) { shutdownTimeouts.push(timeoutMs); },
    async isActive() { return false; },
    async withInstanceLock(_id, operation) { return operation(); },
  };
  const { baseUrl } = await fixture(t, { supervisorId, processes, processRecovery: [] });
  const headers = { Authorization: `Bearer ${token}`, 'X-Mastermind-Supervisor-Id': supervisorId };

  const missingSupervisor = await fetch(`${baseUrl}/v1/control/prepare-shutdown`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(missingSupervisor.status, 403);
  assert.equal((await missingSupervisor.json()).code, 'SUPERVISOR_ID_MISMATCH');

  const withBody = await fetch(`${baseUrl}/v1/control/prepare-shutdown`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(withBody.status, 400);
  assert.equal((await withBody.json()).code, 'UNEXPECTED_BODY');

  const prepared = await fetch(`${baseUrl}/v1/control/prepare-shutdown`, { method: 'POST', headers });
  assert.equal(prepared.status, 200);
  assert.deepEqual(await prepared.json(), { ok: true, prepared: true, draining: true });
  assert.deepEqual(shutdownTimeouts, [30_000]);

  const blocked = await fetch(`${baseUrl}/v1/provision`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(blocked.status, 503);
  assert.equal((await blocked.json()).code, 'CONTROL_PLANE_DRAINING');
  const adminBlocked = await fetch(`${baseUrl}/v1/instances/family-server/admin/actions`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: '123e4567-e89b-42d3-a456-426614174000', kind: 'players.refresh' }),
  });
  assert.equal(adminBlocked.status, 503);
  assert.equal((await adminBlocked.json()).code, 'CONTROL_PLANE_DRAINING');
  assert.equal((await fetch(`${baseUrl}/v1/overview`, { headers: { Authorization: `Bearer ${token}` } })).status, 200);
});

test('failed supervisor shutdown reopens the HTTP mutation gate', async (t) => {
  const supervisorId = 'b'.repeat(32);
  let attempts = 0;
  const processes = {
    async shutdown() {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error('safe drain failed'), { statusCode: 409, code: 'SAFE_DRAIN_FAILED' });
    },
    async isActive() { return false; },
    async withInstanceLock(_id, operation) { return operation(); },
  };
  const { baseUrl } = await fixture(t, { supervisorId, processes, processRecovery: [] });
  const headers = { Authorization: `Bearer ${token}`, 'X-Mastermind-Supervisor-Id': supervisorId };
  const failed = await fetch(`${baseUrl}/v1/control/prepare-shutdown`, { method: 'POST', headers });
  assert.equal(failed.status, 409);
  assert.equal((await failed.json()).code, 'SAFE_DRAIN_FAILED');
  const retried = await fetch(`${baseUrl}/v1/control/prepare-shutdown`, { method: 'POST', headers });
  assert.equal(retried.status, 200);
  assert.equal(attempts, 2);
});

test('automatically imports one legacy Family Server into the isolated project inventory', async (t) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-minecraft-legacy-startup-'));
  const legacyDirectory = path.join(dataRoot, 'servers', 'family-server');
  await fs.mkdir(path.join(legacyDirectory, 'world'), { recursive: true });
  await fs.mkdir(path.join(dataRoot, 'state'), { recursive: true });
  await fs.writeFile(path.join(legacyDirectory, 'world', 'level.dat'), 'legacy-world-stays-safe');
  await fs.writeFile(path.join(legacyDirectory, 'server.properties'), 'server-port=25565\n');
  await fs.writeFile(path.join(dataRoot, 'state', 'instances.json'), JSON.stringify({
    schemaVersion: 1,
    instances: [{
      id: 'family-server', displayName: 'Family Server', kind: 'server', minecraftVersion: '1.21.4',
      loader: 'fabric', loaderVersion: '0.19.3', memoryMb: 4096, serverPort: 25565,
      provisioningStatus: 'ready', status: 'stopped', pid: null,
      createdAt: '2026-08-13T01:19:16.333Z', updatedAt: '2026-08-13T02:25:41.310Z',
    }],
  }));
  const app = await createControlPlane({
    config: { host: '127.0.0.1', port: 43100, token, dataRoot, javaExecutable: process.execPath },
    isLegacyActive: async () => false,
    launchIntegrityKeyAcquirer: async () => ({ async release() {} }),
  });
  const address = await app.listen(0);
  t.after(async () => { await app.close(); await fs.rm(dataRoot, { recursive: true, force: true }); });

  assert.deepEqual(app.legacyMigration, {
    state: 'imported-update-required', candidateCount: 1, instanceId: 'family-server',
  });
  const imported = await app.store.get('family-server');
  assert.equal(imported.projectId, 'family-server');
  assert.equal(imported.provisioningStatus, 'legacy-update-required');
  assert.equal(imported.status, 'stopped');
  assert.equal(await fs.readFile(path.join(legacyDirectory, 'world', 'level.dat'), 'utf8'), 'legacy-world-stays-safe');
  assert.equal(
    await fs.readFile(path.join(dataRoot, 'projects', 'family-server', 'servers', 'family-server', 'world', 'level.dat'), 'utf8'),
    'legacy-world-stays-safe',
  );

  const response = await fetch(`http://127.0.0.1:${address.port}/v1/overview`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json();
  assert.deepEqual(body.legacyMigration, app.legacyMigration);
  assert.equal(JSON.stringify(body).includes(dataRoot), false);
});

test('does not expose raw executable or working-directory provisioning', () => {
  assert.throws(() => validateProvisionRequest({
    kind: 'family-server', instanceId: 'safe-server', displayName: 'Safe', memoryMb: 2048,
    eulaAccepted: true, javaExecutable: 'powershell.exe',
  }), /Unsupported provisioning field/);
  assert.throws(() => validateProvisionRequest({
    kind: 'family-server', instanceId: 'safe-server', displayName: 'Safe', minecraftVersion: '1.21.4', memoryMb: 2048,
    eulaAccepted: true,
  }), /Unsupported provisioning field: minecraftVersion/);
});

test('validates IDs before lifecycle and log access', async (t) => {
  const { baseUrl } = await fixture(t);
  const headers = { Authorization: `Bearer ${token}` };
  assert.equal((await fetch(`${baseUrl}/v1/instances/%2e%2e/logs`, { headers })).status, 404);
  assert.equal((await fetch(`${baseUrl}/v1/instances/not-there/start`, { method: 'POST', headers })).status, 404);
  assert.equal((await fetch(`${baseUrl}/v1/instances`, { method: 'POST', headers })).status, 404);
});

test('exposes only typed administration status, plans, actions, and operation reconciliation', async (t) => {
  const calls = [];
  const administration = {
    async initialize() { calls.push(['initialize']); },
    async status(id) {
      calls.push(['status', id]);
      return { available: true, reason: 'ready', running: true, playerVisibility: 'unavailable', onlinePlayers: null,
        whitelist: { enabled: null, players: null }, checkedAt: '2026-08-13T12:00:00.000Z' };
    },
    async createPlan(id, input) {
      calls.push(['plan', id, input]);
      return { planId: `admplan-${'a'.repeat(64)}`, requestId: input.requestId, actionDigest: 'b'.repeat(64),
        launchGeneration: 'c'.repeat(64), confirmation: 'CONFIRM OPERATOR CHANGE', expiresAt: '2026-08-13T12:05:00.000Z' };
    },
    async execute(id, input) {
      calls.push(['execute', id, input]);
      return { requestId: input.requestId, kind: input.kind, state: 'delivered-unconfirmed', application: 'unconfirmed', updatedAt: '2026-08-13T12:00:00.000Z' };
    },
    async operation(id, idempotencyKey) {
      calls.push(['operation', id, idempotencyKey]);
      return { requestId: idempotencyKey.toLowerCase(), kind: 'broadcast', state: 'delivery-unknown', application: 'unconfirmed', updatedAt: '2026-08-13T12:00:00.000Z' };
    },
  };
  const { baseUrl } = await fixture(t, { administration });
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const id = '123e4567-e89b-42d3-a456-426614174000';

  const status = await fetch(`${baseUrl}/v1/instances/family-server/admin`, { headers });
  assert.equal(status.status, 200);
  assert.equal((await status.json()).administration.onlinePlayers, null);

  const plan = await fetch(`${baseUrl}/v1/instances/family-server/admin/plans`, {
    method: 'POST', headers, body: JSON.stringify({ requestId: id, action: { kind: 'player.op', player: 'Java_User' } }),
  });
  assert.equal(plan.status, 201);
  assert.match((await plan.json()).plan.planId, /^admplan-[a-f0-9]{64}$/);

  const action = await fetch(`${baseUrl}/v1/instances/family-server/admin/actions`, {
    method: 'POST', headers, body: JSON.stringify({ requestId: id, kind: 'broadcast', message: 'Hello' }),
  });
  assert.equal(action.status, 202);
  assert.equal((await action.json()).operation.state, 'delivered-unconfirmed');

  const operation = await fetch(`${baseUrl}/v1/instances/family-server/admin/operations/${id}`, { headers });
  assert.equal(operation.status, 200);
  assert.equal((await operation.json()).operation.state, 'delivery-unknown');
  assert.deepEqual(calls.map((item) => item[0]), ['initialize', 'status', 'plan', 'execute', 'operation']);
});

test('exposes Family-only opaque Modrinth catalog, inventory, plan, action, and reconciliation routes', async (t) => {
  const requestId = '123e4567-e89b-42d3-a456-426614174000';
  const planId = `modplan-${'a'.repeat(64)}`; const planDigest = 'b'.repeat(64); const tx = `modtx-${'c'.repeat(64)}`;
  const stack = { minecraftVersion: '26.2', loader: 'fabric', loaderVersion: '0.19.3', generation: 'd'.repeat(64), inventoryDigest: 'e'.repeat(64) };
  const operation = { requestId, planId, planDigest, operation: 'install', state: 'committed', application: 'verified', transactionRef: tx,
    stackBefore: { generation: stack.generation, inventoryDigest: stack.inventoryDigest }, stackAfter: { generation: 'f'.repeat(64), inventoryDigest: '1'.repeat(64) },
    rollbackSnapshot: { snapshotRef: `modsnap-${'2'.repeat(64)}`, state: 'verified' }, summary: { installedCount: 1, updatedCount: 0, removedCount: 0 },
    startedAt: '2026-08-13T12:00:00.000Z', updatedAt: '2026-08-13T12:00:01.000Z' };
  const mods = {
    async initialize() { return []; },
    async search() { return { stack, catalog: { query: 'map', offset: 0, limit: 20, totalHits: 1, candidates: [{ catalogRef: `modref-${'3'.repeat(64)}`, title: 'Map', summary: '', author: 'Safe', compatibility: 'provisional' }] } }; },
    async detail(_id, catalogRef) { return { catalogRef, title: 'Map', summary: '', author: 'Safe', licenseId: 'MIT' }; },
    async inventory() { return { stack, recovery: { required: false, transactionRef: null, state: null }, installed: [], unmanaged: { present: false, count: 0 } }; },
    async createPlan(_id, input) { return { planId, planDigest, requestId: input.requestId, operation: input.operation }; },
    async execute() { return operation; }, async operation() { return operation; },
    async assertStackUpdateAllowedWithinInstanceLock() {}, async assertStartAllowedWithinInstanceLock() {},
  };
  const { baseUrl } = await fixture(t, { mods, modRecovery: [] }); const headers = { Authorization: `Bearer ${token}` };
  const search = await fetch(`${baseUrl}/v1/instances/family-server/mods/catalog/search?q=map&offset=0&limit=20`, { headers });
  assert.equal(search.status, 200); assert.equal((await search.json()).catalog.candidates.length, 1);
  const duplicate = await fetch(`${baseUrl}/v1/instances/family-server/mods/catalog/search?q=map&q=other&offset=0&limit=20`, { headers });
  assert.equal(duplicate.status, 400);
  const wrong = await fetch(`${baseUrl}/v1/instances/2b2t/mods/installed`, { headers }); assert.equal(wrong.status, 400);
  const inventory = await fetch(`${baseUrl}/v1/instances/family-server/mods/installed`, { headers }); assert.deepEqual((await inventory.json()).unmanaged, { present: false, count: 0 });
  const planned = await fetch(`${baseUrl}/v1/instances/family-server/mods/plans`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, operation: 'install', catalogRef: `modref-${'3'.repeat(64)}` }) });
  assert.equal(planned.status, 201);
  const applied = await fetch(`${baseUrl}/v1/instances/family-server/mods/actions`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, planId, confirmation: 'INSTALL THIRD-PARTY MOD CODE' }) });
  assert.equal(applied.status, 200); assert.equal((await applied.json()).operation.state, 'committed');
  const reconciled = await fetch(`${baseUrl}/v1/instances/family-server/mods/operations/${requestId}`, { headers }); assert.equal(reconciled.status, 200);
});

test('maps the exact stored-world mod fence to the safe public mod error', async (t) => {
  let worldInterlock = null;
  const mods = {
    setWorldInterlock(callback) { worldInterlock = callback; },
    async createPlan() { return worldInterlock('family-server'); },
    async assertStackUpdateAllowedWithinInstanceLock() {}, async assertStartAllowedWithinInstanceLock() {},
  };
  const worlds = {
    async assertMutationAllowedWithinInstanceLock() { return true; },
    async assertStackUpdateAllowedWithinInstanceLock() { return true; },
    async assertModMutationAllowedWithinInstanceLock() {
      throw Object.assign(new Error('private world catalog detail'), { code: 'WORLDS_BLOCK_MOD_MUTATION', statusCode: 409 });
    },
    async reconcileGeneratedWorldWithinInstanceLock() { return false; },
  };
  const { baseUrl } = await fixture(t, { mods, modRecovery: [], worlds, worldRecovery: [] });
  const response = await fetch(`${baseUrl}/v1/instances/family-server/mods/plans`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestId: '123e4567-e89b-42d3-a456-426614174000', operation: 'install', catalogRef: `modref-${'3'.repeat(64)}`,
    }),
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    ok: false, code: 'MOD_WORLD_STATE_BLOCKED', message: 'Stored Family Server worlds block this managed mod change.',
  });
});

test('sanitizes unexpected mod-manager filesystem errors', async (t) => {
  const secret = 'C:\\private\\family-server\\mods\\secret.jar';
  const mods = { async inventory() { throw new Error(`EACCES ${secret}`); }, async assertStackUpdateAllowedWithinInstanceLock() {}, async assertStartAllowedWithinInstanceLock() {} };
  const { baseUrl } = await fixture(t, { mods, modRecovery: [] });
  const response = await fetch(`${baseUrl}/v1/instances/family-server/mods/installed`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 500); const body = await response.json(); assert.equal(body.code, 'MOD_OPERATION_FAILED'); assert.equal(JSON.stringify(body).includes(secret), false);
});

test('sanitizes unexpected administration errors and never returns local paths or raw commands', async (t) => {
  const administration = {
    async initialize() {},
    async status() { throw new Error('EACCES C:\\Users\\Private\\server.properties say secret'); },
  };
  const { baseUrl } = await fixture(t, { administration });
  const response = await fetch(`${baseUrl}/v1/instances/family-server/admin`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json();
  assert.equal(response.status, 500);
  assert.equal(body.code, 'ADMIN_OPERATION_FAILED');
  assert.equal(JSON.stringify(body).includes('Private'), false);
  assert.equal(JSON.stringify(body).includes('say secret'), false);
});

test('reports the isolated family catalog without source URLs or local paths', async (t) => {
  const { baseUrl } = await fixture(t, {
    provisioner: {
      async catalog() {
        return {
          projectId: 'family-server',
          updateChannel: 'latest-compatible-stable',
          latestMinecraftVersion: '26.2',
          minecraftVersion: '26.2',
          isLatestRelease: true,
          components: { geyser: { version: '2.11.1-b1219' }, floodgate: { version: '2.2.6-b67' } },
        };
      },
    },
  });
  const response = await fetch(`${baseUrl}/v1/catalog`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.catalog.projectId, 'family-server');
  assert.equal(JSON.stringify(body).includes('https://'), false);
  assert.equal(JSON.stringify(body).includes('directory'), false);
});

test('reports sanitized read-only LAN status without exposing an executable path', async (t) => {
  const { baseUrl } = await fixture(t, {
    lanStatus: async () => ({
      bindAddress: 'unsafe', addresses: ['192.168.1.25', '8.8.8.8'], bedrockPort: 1234,
      portStatus: 'occupied', owner: { pid: 19656, processName: 'bedrock_server', path: 'C:\\private\\server.exe' },
      firewallRulesPresent: false, localSubnetOnly: false, checkedAt: '2026-08-12T00:00:00.000Z',
    }),
  });
  const response = await fetch(`${baseUrl}/v1/lan`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.lan.addresses, ['192.168.1.25']);
  assert.equal(body.lan.bindAddress, '0.0.0.0');
  assert.equal(body.lan.bedrockPort, 19132);
  assert.equal(body.lan.firewallRulesPresent, false);
  assert.equal(body.lan.localSubnetOnly, false);
  assert.equal(body.lan.owner.processName, 'bedrock_server');
  assert.equal(body.lan.owner.path, undefined);
  assert.equal(JSON.stringify(body).includes('private'), false);
});

test('recognizes UDP 19132 as a managed Geyser listener only when its PID matches a running Family Server', async (t) => {
  const managedPid = 42420;
  let lanOptions;
  const { app, baseUrl, dataRoot } = await fixture(t, {
    lanStatus: async (options) => {
      lanOptions = options;
      return {
      addresses: ['10.10.10.39'], portStatus: 'occupied',
      owner: { pid: managedPid, processName: 'java' }, checkedAt: new Date().toISOString(),
      };
    },
  });
  const now = new Date().toISOString();
  await app.store.create({
    id: 'lan-family', displayName: 'LAN Family', projectId: 'family-server', kind: 'server',
    minecraftVersion: '26.2', memoryMb: 4096, javaPort: 25565, bedrockPort: 19132,
    directory: path.join(dataRoot, 'servers', 'lan-family'), provisioningStatus: 'ready',
    status: 'running', pid: managedPid, createdAt: now, updatedAt: now,
  });
  const response = await fetch(`${baseUrl}/v1/lan`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.lan.portStatus, 'geyser-listening');
  assert.equal(body.lan.owner, undefined);
  assert.deepEqual(body.lan.addresses, ['10.10.10.39']);
  assert.deepEqual(lanOptions, { javaPorts: [25565] });
});

test('enables home-LAN firewall access through the fixed trusted action without browser-supplied ports', async (t) => {
  let invocation = null;
  const { app, baseUrl, dataRoot } = await fixture(t, {
    lanFirewall: async (instance, script, action) => {
      invocation = { instance, script, action };
      return { action, status: 'completed', javaPort: instance.javaPort, bedrockPort: 19132 };
    },
  });
  const now = new Date().toISOString();
  await app.store.create({
    id: 'lan-enable', displayName: 'LAN Enable', projectId: 'family-server', kind: 'server',
    minecraftVersion: '26.2', memoryMb: 4096, javaPort: 25567, bedrockPort: 19132,
    directory: path.join(dataRoot, 'servers', 'lan-enable'), provisioningStatus: 'ready',
    status: 'stopped', pid: null, createdAt: now, updatedAt: now,
  });
  const response = await fetch(`${baseUrl}/v1/instances/lan-enable/lan/enable`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.lanFirewall.status, 'completed');
  assert.equal(invocation.instance.javaPort, 25567);
  assert.equal(invocation.instance.bedrockPort, 19132);
  assert.equal(invocation.action, 'Enable');
  assert.equal(path.basename(invocation.script), 'configure-family-server-lan.ps1');
  assert.equal(JSON.stringify(body).includes(invocation.script), false);

  const rejected = await fetch(`${baseUrl}/v1/instances/lan-enable/lan/enable`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ javaPort: 9, command: 'ignored' }),
  });
  assert.equal(rejected.status, 400);
  assert.equal((await rejected.json()).code, 'UNEXPECTED_BODY');
});

test('reports update availability without mutating or launching an instance', async (t) => {
  const { app, baseUrl, dataRoot } = await fixture(t, {
    updater: {
      async reconcileInterruptedTransactions() { return []; },
      async check() {
        return {
          state: 'minecraft-update-approval-required', updateKind: 'upgrade', planId: 'a'.repeat(64),
          currentMinecraftVersion: '1.21', targetMinecraftVersion: '26.2', requiresApproval: true,
        };
      },
      async markReady() {},
    },
  });
  const now = new Date().toISOString();
  await app.store.create({
    id: 'old-family', displayName: 'Old Family', projectId: 'family-server', kind: 'server', minecraftVersion: '1.21',
    memoryMb: 1024, directory: path.join(dataRoot, 'servers', 'old-family'), provisioningStatus: 'ready',
    status: 'stopped', pid: null, createdAt: now, updatedAt: now,
  });
  const response = await fetch(`${baseUrl}/v1/instances/old-family/update-status`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.update.state, 'minecraft-update-approval-required');
  assert.equal(body.update.currentMinecraft, '1.21');
  assert.equal(body.update.targetMinecraft, '26.2');
  assert.equal((await app.store.get('old-family')).status, 'stopped');
});

test('redacts unknown update-status failures and process ownership metadata', async (t) => {
  const { app, baseUrl, dataRoot } = await fixture(t, {
    updater: {
      async reconcileInterruptedTransactions() { return []; },
      async check() {
        throw Object.assign(new Error('C:\\private\\release-catalog.json'), {
          owner: { pid: 4242, processName: 'private-updater.exe' },
        });
      },
      async markReady() {},
    },
  });
  const now = new Date().toISOString();
  await app.store.create({
    id: 'status-family', displayName: 'Status Family', projectId: 'family-server', kind: 'server', minecraftVersion: '1.21',
    memoryMb: 1024, directory: path.join(dataRoot, 'servers', 'status-family'), provisioningStatus: 'ready',
    status: 'stopped', pid: null, createdAt: now, updatedAt: now,
  });
  const response = await fetch(`${baseUrl}/v1/instances/status-family/update-status`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json();
  assert.equal(response.status, 500);
  assert.deepEqual(body, {
    ok: false,
    code: 'UPDATE_STATUS_FAILED',
    message: 'The Family Server update status is unavailable.',
  });
});

test('applies only a typed owner-approved update plan and keeps private paths out of the response', async (t) => {
  let received = null;
  const planId = 'b'.repeat(64);
  const { app, baseUrl, dataRoot } = await fixture(t, {
    updater: {
      async reconcileInterruptedTransactions() { return []; },
      async check() { return { state: 'minecraft-update-approval-required', requiresApproval: true }; },
      async markReady() {},
      async update(input) {
        received = input;
        return {
          action: 'updated', readiness: 'pending-unverified',
          instance: {
            id: input.instanceId, displayName: 'Approved Family', projectId: 'family-server', kind: 'server',
            status: 'stopped', pid: null, minecraftVersion: '26.2',
            javaExecutable: 'C:\\private\\java.exe', directory: 'C:\\private\\server',
          },
          plan: { state: 'minecraft-update-approval-required', updateKind: 'upgrade', planId, requiresApproval: true, currentMinecraftVersion: '1.21.4', targetMinecraftVersion: '26.2' },
          transaction: { transactionId: '00000000-0000-4000-8000-000000000001', phase: 'pending-readiness', backupAvailable: true },
        };
      },
    },
  });
  const now = new Date().toISOString();
  await app.store.create({
    id: 'approved-family', displayName: 'Approved Family', projectId: 'family-server', kind: 'server',
    minecraftVersion: '1.21.4', memoryMb: 4096, javaPort: 25565, bedrockPort: 19132,
    directory: path.join(dataRoot, 'projects', 'family-server', 'servers', 'approved-family'),
    provisioningStatus: 'legacy-update-required', status: 'stopped', pid: null, createdAt: now, updatedAt: now,
  });
  const response = await fetch(`${baseUrl}/v1/instances/approved-family/update`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ approval: { planId, minecraftVersionChange: true } }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.deepEqual(received, { instanceId: 'approved-family', approval: { planId, minecraftVersionChange: true } });
  assert.equal(body.updateResult.readiness, 'pending-unverified');
  assert.equal(body.updateResult.instance.javaExecutable, undefined);
  assert.equal(body.updateResult.instance.directory, undefined);
  assert.equal(JSON.stringify(body).includes('private'), false);
});

test('returns the unavailable legacy migration as a fixed sanitized update error', async (t) => {
  const updater = {
    async reconcileInterruptedTransactions() { return []; },
    async markReady() {},
    async update() {
      throw Object.assign(new Error('C:\\private\\legacy\\libraries contains an internal path'), {
        code: 'UPDATE_LEGACY_MIGRATION_UNAVAILABLE',
        statusCode: 409,
      });
    },
  };
  const backups = {
    setWorldInterlock() {},
    setWorldRestoreValidator() {},
    async initialize() { return []; },
    recoveryStatus() { return { manualRecoveryRequired: 0, global: false, instanceIds: [] }; },
    async assertSafeForLifecycle() {},
  };
  const mods = {
    async prepareStackValidation() {},
    setWorldInterlock() {},
    async initialize() { return []; },
    async assertStackUpdateAllowedWithinInstanceLock() {},
  };
  const { baseUrl } = await fixture(t, { updater, backups, mods });
  const response = await fetch(`${baseUrl}/v1/instances/legacy-family/update`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: 'UPDATE_LEGACY_MIGRATION_UNAVAILABLE',
    message: 'The authenticated legacy launch migration is unavailable until its cleanup boundary is explicitly authorized.',
  });
});

test('exposes retired-version purge only as an authenticated typed bodyless local action', async (t) => {
  let received = null;
  const updater = {
    async reconcileInterruptedTransactions() { return []; },
    async markReady() {},
    async purgeRetiredVersionWithinInstanceLock(input) {
      received = input;
      return {
        action: 'retired-version-purged', instanceId: input.instanceId,
        transactionId: '00000000-0000-4000-8000-000000000001',
        retiredMinecraftVersion: '1.21.4', currentMinecraftVersion: '26.2',
        backupAvailable: false, cacheEntriesPurged: 2, purgedAt: '2026-08-13T00:00:00.000Z',
      };
    },
  };
  const { baseUrl } = await fixture(t, { updater });
  const endpoint = `${baseUrl}/v1/instances/family-server/retired-version/purge`;
  assert.equal((await fetch(endpoint, { method: 'POST' })).status, 401);
  const withBody = await fetch(endpoint, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(withBody.status, 400);
  assert.equal((await withBody.json()).code, 'UNEXPECTED_BODY');
  assert.equal(received, null);

  const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(received, { instanceId: 'family-server' });
  assert.deepEqual(body.cleanup, {
    action: 'retired-version-purged', instanceId: 'family-server',
    transactionId: '00000000-0000-4000-8000-000000000001',
    retiredMinecraftVersion: '1.21.4', currentMinecraftVersion: '26.2',
    backupAvailable: false, cacheEntriesPurged: 2, purgedAt: '2026-08-13T00:00:00.000Z',
  });
});

test('checks backup recovery inside the shared instance lock before retired-version purge mutates state', async (t) => {
  const events = [];
  let insideLock = false;
  const processes = {
    async isActive() { return false; },
    async withInstanceLock(instanceId, operation) {
      assert.equal(instanceId, 'family-server');
      assert.equal(insideLock, false, 'the route must acquire the lifecycle lock exactly once');
      events.push('lock-enter');
      insideLock = true;
      try { return await operation(); }
      finally { insideLock = false; events.push('lock-exit'); }
    },
  };
  const backups = {
    assertSafeForLifecycle(input) {
      assert.deepEqual(input, { instanceId: 'family-server' });
      assert.equal(insideLock, true, 'the restore-recovery fence must run inside the lifecycle lock');
      events.push('backup-fence');
    },
    recoveryStatus() { return { manualRecoveryRequired: 0, global: false, instanceIds: [] }; },
  };
  const updater = {
    async reconcileInterruptedTransactions() { return []; },
    async markReady() {},
    async purgeRetiredVersionWithinInstanceLock(input) {
      assert.deepEqual(input, { instanceId: 'family-server' });
      assert.equal(insideLock, true);
      assert.deepEqual(events, ['lock-enter', 'backup-fence']);
      events.push('purge');
      return { action: 'retired-version-purged', instanceId: input.instanceId };
    },
  };
  const { baseUrl } = await fixture(t, {
    processes, processRecovery: [], updater, backups, backupRecovery: [],
  });
  const response = await fetch(`${baseUrl}/v1/instances/family-server/retired-version/purge`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).cleanup, {
    action: 'retired-version-purged', instanceId: 'family-server',
  });
  assert.deepEqual(events, ['lock-enter', 'backup-fence', 'purge', 'lock-exit']);
});

test('exposes backups only through typed path-free create, verify, plan, restore, policy, and purge actions', async (t) => {
  const backupId = `bkp-${'a'.repeat(32)}`;
  const planId = `rst-${'b'.repeat(64)}`;
  const record = {
    backupId, kind: 'manual', createdAt: '2026-08-13T12:00:00.000Z', minecraftVersion: '26.2',
    files: 12, bytes: 4096, integrity: 'verified', verifiedAt: '2026-08-13T12:01:00.000Z',
    restorable: true, purgeable: false,
  };
  const policy = { enabled: true, intervalHours: 24, retentionCount: 7 };
  const status = {
    state: 'idle', due: false, deferred: false, lastAutomaticAttemptAt: null,
    lastAutomaticResult: null, nextDueAt: '2026-08-14T12:00:00.000Z', lastError: null,
  };
  const calls = [];
  const backups = {
    async list(input) { calls.push(['list', input]); return { instanceId: 'family-server', policy, status, backups: [record] }; },
    async create(input) { calls.push(['create', input]); return record; },
    async verify(input) { calls.push(['verify', input]); return record; },
    async createRestorePlan(input) {
      calls.push(['plan', input]);
      return { planId, backupId, expiresAt: '2026-08-13T12:05:00.000Z', minecraftVersion: '26.2', currentMinecraftVersion: '26.2', safetySnapshotRequired: true };
    },
    async restore(input) {
      calls.push(['restore', input]);
      return { backupId, rescueBackupId: `bkp-${'c'.repeat(32)}`, safetySnapshotVerified: true, stackPreserved: true, minecraftVersion: '26.2', restoredAt: '2026-08-13T12:02:00.000Z' };
    },
    async setPolicy(input) { calls.push(['policy', input]); return { instanceId: input.instanceId, policy, status }; },
    async purge(input) { calls.push(['purge', input]); return { backupId, purgedAt: '2026-08-13T12:03:00.000Z' }; },
  };
  const { baseUrl } = await fixture(t, { backups, backupRecovery: [] });
  const headers = { Authorization: `Bearer ${token}` };

  const listed = await fetch(`${baseUrl}/v1/instances/family-server/backups`, { headers });
  assert.equal(listed.status, 200);
  assert.deepEqual(await listed.json(), { ok: true, instanceId: 'family-server', policy, status, backups: [record] });

  const rejectedBody = await fetch(`${baseUrl}/v1/instances/family-server/backups`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(rejectedBody.status, 400);
  assert.equal((await rejectedBody.json()).code, 'UNEXPECTED_BODY');
  assert.equal((await fetch(`${baseUrl}/v1/instances/family-server/backups`, { method: 'POST', headers })).status, 201);

  assert.equal((await fetch(`${baseUrl}/v1/instances/family-server/backups/${backupId}/verify`, { method: 'POST', headers })).status, 200);
  const plan = await fetch(`${baseUrl}/v1/instances/family-server/backups/${backupId}/restore-plan`, { method: 'POST', headers });
  assert.equal(plan.status, 200);
  assert.equal((await plan.json()).plan.planId, planId);
  const restore = await fetch(`${baseUrl}/v1/instances/family-server/backups/${backupId}/restore`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ approval: { planId } }),
  });
  assert.equal(restore.status, 200);
  assert.equal((await restore.json()).restoration.safetySnapshotVerified, true);
  const savedPolicy = await fetch(`${baseUrl}/v1/instances/family-server/backups/policy`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(policy),
  });
  assert.equal(savedPolicy.status, 200);
  const purge = await fetch(`${baseUrl}/v1/instances/family-server/backups/${backupId}/purge`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmation: 'PURGE' }),
  });
  assert.equal(purge.status, 200);

  const invalidRestore = await fetch(`${baseUrl}/v1/instances/family-server/backups/${backupId}/restore`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ approval: { planId }, path: 'C:\\unsafe' }),
  });
  assert.equal(invalidRestore.status, 400);
  assert.equal((await invalidRestore.json()).code, 'INVALID_BACKUP_APPROVAL');
  assert.deepEqual(calls, [
    ['list', { instanceId: 'family-server' }],
    ['create', { instanceId: 'family-server' }],
    ['verify', { instanceId: 'family-server', backupId }],
    ['plan', { instanceId: 'family-server', backupId }],
    ['restore', { instanceId: 'family-server', backupId, planId }],
    ['policy', { instanceId: 'family-server', ...policy }],
    ['purge', { instanceId: 'family-server', backupId, confirmation: 'PURGE' }],
  ]);
});

test('fences destructive Family Server lifecycle actions after unresolved backup recovery while leaving stop available', async (t) => {
  const calls = { start: 0, stop: 0, update: 0, purge: 0, check: 0 };
  const stoppedInstance = {
    id: 'family-server', displayName: 'Family Server', projectId: 'family-server', kind: 'server',
    minecraftVersion: '26.2', status: 'stopped', pid: null,
  };
  const processes = {
    async isActive() { return false; },
    async withInstanceLock(_id, operation) { return operation(); },
    async startWithinInstanceLock() { calls.start += 1; return { ...stoppedInstance, status: 'running' }; },
    async stopWithinInstanceLock() { calls.stop += 1; return stoppedInstance; },
    async stop() { calls.stop += 1; return stoppedInstance; },
    async shutdown() {},
  };
  const updater = {
    async reconcileInterruptedTransactions() { return []; },
    async markReady() {},
    async check() { calls.check += 1; return { state: 'current', requiresApproval: false }; },
    async updateWithinInstanceLock() { calls.update += 1; return { action: 'updated' }; },
    async purgeRetiredVersionWithinInstanceLock() { calls.purge += 1; return { action: 'retired-version-purged' }; },
  };
  const backupRecovery = [{
    instanceId: 'family-server', transactionId: `rtx-${'d'.repeat(32)}`,
    action: 'manual-recovery-required', code: 'BACKUP_MANUAL_RECOVERY_REQUIRED',
  }];
  const backups = {
    recoveryStatus() { return { manualRecoveryRequired: 2, global: true, instanceIds: ['family-server'] }; },
  };
  const { baseUrl } = await fixture(t, { processes, processRecovery: [], updater, backups, backupRecovery });
  const headers = { Authorization: `Bearer ${token}` };

  const overview = await (await fetch(`${baseUrl}/v1/overview`, { headers })).json();
  assert.deepEqual(overview.backupRecovery, {
    reconciled: 1, manualRecoveryRequired: 2, globalRecoveryRequired: 1,
  });

  const start = await fetch(`${baseUrl}/v1/instances/family-server/start`, { method: 'POST', headers });
  const update = await fetch(`${baseUrl}/v1/instances/family-server/update`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}',
  });
  const purge = await fetch(`${baseUrl}/v1/instances/family-server/retired-version/purge`, { method: 'POST', headers });
  for (const response of [start, update, purge]) {
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'BACKUP_MANUAL_RECOVERY_REQUIRED');
  }
  assert.deepEqual(calls, { start: 0, stop: 0, update: 0, purge: 0, check: 0 });

  const stop = await fetch(`${baseUrl}/v1/instances/family-server/stop`, { method: 'POST', headers });
  assert.equal(stop.status, 200);
  assert.equal((await stop.json()).instance.status, 'stopped');
  assert.equal(calls.stop, 1);
});

test('redacts raw backup filesystem failures while preserving fixed backup-domain errors', async (t) => {
  const secretPath = 'C:\\Users\\Mik\\private-world\\level.dat';
  const backups = {
    async list() { throw Object.assign(new Error(`EACCES: permission denied, open '${secretPath}'`), { code: 'EACCES' }); },
    async create() { throw Object.assign(new Error(`ENOSPC: no space left on device, copyfile '${secretPath}'`), { code: 'ENOSPC' }); },
    async verify() {
      throw Object.assign(new Error('Backup integrity verification failed.'), {
        code: 'BACKUP_INTEGRITY_FAILED', statusCode: 409,
      });
    },
  };
  const { baseUrl } = await fixture(t, { backups, backupRecovery: [] });
  const headers = { Authorization: `Bearer ${token}` };
  const backupId = `bkp-${'e'.repeat(32)}`;

  const unknown = await fetch(`${baseUrl}/v1/instances/family-server/backups`, { headers });
  const unknownBody = await unknown.json();
  assert.equal(unknown.status, 500);
  assert.deepEqual(unknownBody, {
    ok: false, code: 'BACKUP_OPERATION_FAILED', message: 'The Family Server backup operation failed safely.',
  });
  assert.equal(JSON.stringify(unknownBody).includes(secretPath), false);

  const full = await fetch(`${baseUrl}/v1/instances/family-server/backups`, { method: 'POST', headers });
  const fullBody = await full.json();
  assert.equal(full.status, 507);
  assert.deepEqual(fullBody, {
    ok: false, code: 'BACKUP_STORAGE_FULL', message: 'Family Server backup storage is full.',
  });
  assert.equal(JSON.stringify(fullBody).includes(secretPath), false);

  const known = await fetch(`${baseUrl}/v1/instances/family-server/backups/${backupId}/verify`, { method: 'POST', headers });
  assert.equal(known.status, 409);
  assert.deepEqual(await known.json(), {
    ok: false, code: 'BACKUP_INTEGRITY_FAILED', message: 'Backup integrity verification failed.',
  });
});

test('does not overlap scheduled backup runs and records a top-level scheduler failure by code only', async (t) => {
  const warnings = [];
  t.mock.method(console, 'warn', (message) => warnings.push(message));
  let calls = 0;
  let lockCalls = 0;
  let rejectRun;
  const pendingRun = new Promise((_resolve, reject) => { rejectRun = reject; });
  const recorded = [];
  const backups = {
    async runDueBackups() { calls += 1; return pendingRun; },
    async recordSchedulerFailure(input) { recorded.push(input); },
    recoveryStatus() { return { manualRecoveryRequired: 0, global: false, instanceIds: [] }; },
    async assertSafeForLifecycle() {},
  };
  const processes = {
    async withInstanceLock(_id, operation) { lockCalls += 1; return operation(); },
    async isActive() { return false; }, async shutdown() {},
  };
  const mods = {
    async prepareStackValidation() {}, async initialize() { return []; }, setWorldInterlock() {},
    async assertStackUpdateAllowedWithinInstanceLock() {}, async assertSafeForLifecycle() {},
  };
  const worlds = {
    async prepareRestoreValidation() {}, async initialize() { return []; },
    async assertSafeForLifecycle() {}, async assertMutationAllowedWithinInstanceLock() {},
    async assertStackUpdateAllowedWithinInstanceLock() {}, async assertModMutationAllowedWithinInstanceLock() {},
    async reconcileGeneratedWorldWithinInstanceLock() { return false; },
  };
  const updater = {
    setStackInterlock() {}, async reconcileInterruptedTransactions() { return []; },
    async assertSafeForLifecycle() {},
  };
  await fixture(t, {
    processes, processRecovery: [], backups, backupRecovery: [], mods, worlds, updater, backupTimerMs: 1_000,
  });
  const startupLockCalls = lockCalls;

  await new Promise((resolve) => setTimeout(resolve, 2_150));
  assert.equal(calls, 1, 'a second timer tick must not overlap the in-flight run');
  assert.equal(lockCalls, startupLockCalls, 'the scheduler must let a disabled policy skip lifecycle proof work');
  rejectRun(Object.assign(new Error('EIO at C:\\Users\\Mik\\private-world'), {
    code: 'EIO', schedulerStage: 'backup-list',
  }));
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(recorded, [{ code: 'EIO' }]);
  assert.ok(warnings.includes('Family Server backup scheduler failed at backup-list (EIO).'));
  assert.equal(warnings.some((message) => message.includes('private-world')), false);
});

test('does not start the scheduled backup scanner while a managed server start is in flight', async (t) => {
  let scheduledRuns = 0;
  let releaseScheduledRun;
  let releaseStart;
  let markStartEntered;
  let startWasEntered = false;
  const scheduledRunRelease = new Promise((resolve) => { releaseScheduledRun = resolve; });
  const startEntered = new Promise((resolve) => { markStartEntered = resolve; });
  const startRelease = new Promise((resolve) => { releaseStart = resolve; });
  const stopped = {
    id: 'family-server', displayName: 'Family Server', projectId: 'family-server', kind: 'server',
    minecraftVersion: '26.2', status: 'stopped', pid: null,
  };
  const store = {
    async initialize() {}, async list() { return [structuredClone(stopped)]; },
    async get(id) { return id === stopped.id ? structuredClone(stopped) : null; },
  };
  const processes = {
    async withInstanceLock(_id, operation) { return operation(); },
    async isActive() { return false; },
    async startWithinInstanceLock() {
      startWasEntered = true;
      markStartEntered();
      await startRelease;
      return { ...stopped, status: 'running', pid: 4545 };
    },
    async shutdown() {},
  };
  const backups = {
    async preflightRecoveryEvidence() { return { domain: 'backup', instances: [] }; },
    recoveryStatus() { return { manualRecoveryRequired: 0, global: false, instanceIds: [] }; },
    async assertSafeForLifecycle() {},
    async runDueBackups() { scheduledRuns += 1; await scheduledRunRelease; return []; },
  };
  const updater = {
    async preflightRecoveryEvidence() { return { domain: 'update', instances: [] }; },
    async reconcileInterruptedTransactions() { return []; }, async assertSafeForLifecycle() {},
    async check() { return { state: 'current', requiresApproval: false }; },
    setStackInterlock() {}, async markReady() {},
  };
  const mods = {
    async preflightRecoveryEvidence() { return { domain: 'mods', instances: [] }; },
    async prepareStackValidation() {}, async initialize() { return []; }, setWorldInterlock() {},
    async assertStackUpdateAllowedWithinInstanceLock() {}, async assertSafeForLifecycle() {},
    async assertStartAllowedWithinInstanceLock() {},
  };
  const worlds = {
    async preflightRecoveryEvidence() { return { domain: 'world', instances: [] }; },
    async prepareRestoreValidation() {}, async initialize() { return []; },
    async assertSafeForLifecycle() {}, async assertMutationAllowedWithinInstanceLock() {},
    async assertStackUpdateAllowedWithinInstanceLock() {}, async assertModMutationAllowedWithinInstanceLock() {},
    async reconcileGeneratedWorldWithinInstanceLock() { return false; },
  };
  const { baseUrl } = await fixture(t, {
    store, processes, processRecovery: [], backups, backupRecovery: [], updater, updateRecovery: [],
    mods, modRecovery: [], worlds, worldRecovery: [], backupTimerMs: 1_000,
    administration: { async initialize() {} },
  });

  await new Promise((resolve) => setTimeout(resolve, 1_100));
  assert.equal(scheduledRuns, 1, 'the fixture must establish one scheduler run before lifecycle admission');
  const start = fetch(`${baseUrl}/v1/instances/family-server/start`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(startWasEntered, false, 'start must wait for the exact in-flight scheduler run to close');
  releaseScheduledRun();
  await startEntered;
  await new Promise((resolve) => setTimeout(resolve, 2_150));
  assert.equal(scheduledRuns, 1, 'the scheduler must not contend with a managed start');
  releaseStart();
  const response = await start;
  assert.equal(response.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  assert.ok(scheduledRuns >= 2, 'the scheduler may resume after the managed start leaves its lifecycle scope');
});

test('rechecks the live backup recovery fence inside the mod mutation lock', async (t) => {
  const warnings = [];
  t.mock.method(console, 'warn', (message) => warnings.push(message));
  let lifecycleLock = null;
  let lockDepth = 0;
  let backupBlocked = false;
  let mutations = 0;
  const processes = {
    async withInstanceLock(id, operation) {
      assert.equal(id, 'family-server');
      assert.equal(lockDepth, 0);
      lockDepth += 1;
      try { return await operation(); }
      finally { lockDepth -= 1; }
    },
    async isActive() { return false; },
    async shutdown() {},
  };
  const backups = {
    async preflightRecoveryEvidence() { return { domain: 'backup', instances: [] }; },
    setWorldInterlock() {}, setWorldRestoreValidator() {},
    async initialize() { return []; },
    recoveryStatus() { return { manualRecoveryRequired: 0, global: false, instanceIds: [] }; },
    async assertSafeForLifecycle({ instanceId }) {
      assert.equal(instanceId, 'family-server');
      assert.equal(lockDepth, 1);
      if (backupBlocked) {
        throw Object.assign(new Error('backup recovery became manual'), {
          code: 'BACKUP_MANUAL_RECOVERY_REQUIRED', statusCode: 409,
        });
      }
    },
  };
  const mods = {
    async preflightRecoveryEvidence() { return { domain: 'mods', instances: [] }; },
    async prepareStackValidation() {}, async initialize() { return []; },
    setWorldInterlock() {}, setLifecycleLock(callback) { lifecycleLock = callback; },
    async assertStackUpdateAllowedWithinInstanceLock() {}, async assertSafeForLifecycle() {},
    async execute(id) {
      return lifecycleLock(id, async () => {
        mutations += 1;
        return { state: 'completed' };
      });
    },
  };
  const worlds = {
    async preflightRecoveryEvidence() { return { domain: 'world', instances: [] }; },
    async prepareRestoreValidation() {}, async initialize() { return []; },
    async assertSafeForLifecycle() {}, async assertMutationAllowedWithinInstanceLock() {},
    async assertStackUpdateAllowedWithinInstanceLock() {}, async assertModMutationAllowedWithinInstanceLock() {},
    async reconcileGeneratedWorldWithinInstanceLock() { return false; },
  };
  const updater = {
    async preflightRecoveryEvidence() { return { domain: 'update', instances: [] }; },
    setStackInterlock() {}, async reconcileInterruptedTransactions() { return []; },
    async assertSafeForLifecycle() {},
  };
  const { baseUrl } = await fixture(t, {
    processes, processRecovery: [], backups, mods, worlds, updater,
  });
  assert.equal(typeof lifecycleLock, 'function');
  backupBlocked = true;
  const response = await fetch(`${baseUrl}/v1/instances/family-server/mods/actions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    ok: false,
    code: 'BACKUP_MANUAL_RECOVERY_REQUIRED',
    message: 'Backup recovery requires verified manual repair before local mutations can continue.',
  });
  assert.equal(mutations, 0);
  assert.equal(lockDepth, 0);
});

test('latches runtime world recovery before stop reconciliation and scheduled backup work', async (t) => {
  let worldBlocked = false;
  let lockDepth = 0;
  const lockPriorities = [];
  let reconciliations = 0;
  let inventories = 0;
  let scheduledRuns = 0;
  let schedulerRecords = 0;
  const stopped = {
    id: 'family-server', displayName: 'Family Server', projectId: 'family-server', kind: 'server',
    minecraftVersion: '26.2', status: 'stopped', pid: null, managedProcess: null,
  };
  const processes = {
    async withInstanceLock(id, operation, options) {
      assert.equal(id, 'family-server');
      assert.equal(lockDepth, 0);
      lockPriorities.push(options?.priority ?? 'normal');
      lockDepth += 1;
      try { return await operation(); }
      finally { lockDepth -= 1; }
    },
    async stopWithinInstanceLock() { assert.equal(lockDepth, 1); return structuredClone(stopped); },
    async isActive() { return false; }, async shutdown() {},
  };
  const backups = {
    async preflightRecoveryEvidence() { return { domain: 'backup', instances: [] }; },
    setWorldInterlock() {}, setWorldRestoreValidator() {}, async initialize() { return []; },
    recoveryStatus() { return { manualRecoveryRequired: 0, global: false, instanceIds: [] }; },
    async assertSafeForLifecycle() {},
    async runDueBackups() { scheduledRuns += 1; return []; },
    async recordSchedulerFailure() { schedulerRecords += 1; },
  };
  const mods = {
    async preflightRecoveryEvidence() { return { domain: 'mods', instances: [] }; },
    async prepareStackValidation() {}, async initialize() { return []; }, setWorldInterlock() {},
    async assertStackUpdateAllowedWithinInstanceLock() {}, async assertSafeForLifecycle() {},
  };
  const worlds = {
    async preflightRecoveryEvidence() { return { domain: 'world', instances: [] }; },
    async prepareRestoreValidation() {}, async initialize() { return []; },
    async assertSafeForLifecycle() {
      if (worldBlocked) throw Object.assign(new Error('world recovery became unfinished'), {
        code: 'WORLD_RECOVERY_REQUIRED', statusCode: 409,
      });
    },
    async inventory() { inventories += 1; return { worlds: [] }; },
    async assertMutationAllowedWithinInstanceLock() {}, async assertStackUpdateAllowedWithinInstanceLock() {},
    async assertModMutationAllowedWithinInstanceLock() {},
    async reconcileGeneratedWorldWithinInstanceLock() { reconciliations += 1; return false; },
  };
  const updater = {
    async preflightRecoveryEvidence() { return { domain: 'update', instances: [] }; },
    setStackInterlock() {}, async reconcileInterruptedTransactions() { return []; },
    async assertSafeForLifecycle() {},
  };
  const { baseUrl } = await fixture(t, {
    processes, processRecovery: [], backups, mods, worlds, updater, backupTimerMs: 1_000,
  });
  lockPriorities.length = 0;
  worldBlocked = true;
  const headers = { Authorization: `Bearer ${token}` };
  const stop = await fetch(`${baseUrl}/v1/instances/family-server/stop`, { method: 'POST', headers });
  assert.equal(stop.status, 200);
  assert.equal((await stop.json()).instance.status, 'stopped');
  assert.deepEqual(lockPriorities, ['lifecycle']);
  assert.equal(reconciliations, 0);
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  assert.equal(scheduledRuns, 0);
  assert.equal(schedulerRecords, 0);
  const inventory = await fetch(`${baseUrl}/v1/instances/family-server/worlds`, { headers });
  assert.equal(inventory.status, 409);
  assert.equal((await inventory.json()).code, 'WORLD_RECOVERY_REQUIRED');
  assert.equal(inventories, 0);
});

test('probes and latches recovery after an untyped update failure before unrelated mutations', async (t) => {
  let updateRecoveryRequired = false;
  let provisions = 0;
  const processes = {
    async withInstanceLock(_id, operation) { return operation(); },
    async isActive() { return false; }, async shutdown() {},
  };
  const backups = {
    async preflightRecoveryEvidence() { return { domain: 'backup', instances: [] }; },
    setWorldInterlock() {}, setWorldRestoreValidator() {}, async initialize() { return []; },
    recoveryStatus() { return { manualRecoveryRequired: 0, global: false, instanceIds: [] }; },
    async assertSafeForLifecycle() {},
  };
  const mods = {
    async preflightRecoveryEvidence() { return { domain: 'mods', instances: [] }; },
    async prepareStackValidation() {}, async initialize() { return []; }, setWorldInterlock() {},
    async assertStackUpdateAllowedWithinInstanceLock() {}, async assertSafeForLifecycle() {},
  };
  const worlds = {
    async preflightRecoveryEvidence() { return { domain: 'world', instances: [] }; },
    async prepareRestoreValidation() {}, async initialize() { return []; }, async assertSafeForLifecycle() {},
    async assertMutationAllowedWithinInstanceLock() {}, async assertStackUpdateAllowedWithinInstanceLock() {},
    async assertModMutationAllowedWithinInstanceLock() {}, async reconcileGeneratedWorldWithinInstanceLock() {},
  };
  const updater = {
    async preflightRecoveryEvidence() { return { domain: 'update', instances: [] }; },
    setStackInterlock() {}, async reconcileInterruptedTransactions() { return []; },
    async assertSafeForLifecycle() {
      if (updateRecoveryRequired) throw Object.assign(new Error('update recovery is unfinished'), {
        code: 'UPDATE_RECOVERY_REQUIRED', statusCode: 409,
      });
    },
    async updateWithinInstanceLock() {
      updateRecoveryRequired = true;
      throw new AggregateError([new Error('publication failed'), new Error('rollback failed')], 'update failed');
    },
  };
  const provisioner = {
    async provision() { provisions += 1; return {}; },
  };
  const { baseUrl } = await fixture(t, {
    processes, processRecovery: [], backups, mods, worlds, updater, provisioner,
  });
  const headers = { Authorization: `Bearer ${token}` };
  const update = await fetch(`${baseUrl}/v1/instances/family-server/update`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(update.status, 500);
  assert.equal((await update.json()).code, 'CONTROL_ACTION_FAILED');
  assert.ok(warnings.includes('Family Server lifecycle action failed (CONTROL_ACTION_FAILED).'));
  const provision = await fetch(`${baseUrl}/v1/provision`, { method: 'POST', headers });
  assert.equal(provision.status, 409);
  assert.equal((await provision.json()).code, 'UPDATE_RECOVERY_REQUIRED');
  assert.equal(provisions, 0);
});

test('defers legacy import until authenticated recovery evidence is clean', async (t) => {
  let discoveries = 0;
  let imports = 0;
  const backups = {
    async preflightRecoveryEvidence() { return { domain: 'backup', instances: [] }; },
    setWorldInterlock() {}, setWorldRestoreValidator() {},
    recoveryStatus() { return { manualRecoveryRequired: 0, global: false, instanceIds: [] }; },
  };
  const mods = {
    async preflightRecoveryEvidence() { return { domain: 'mods', instances: [] }; },
    setWorldInterlock() {}, async assertStackUpdateAllowedWithinInstanceLock() {},
  };
  const worlds = {
    async preflightRecoveryEvidence() {
      return { domain: 'world', instances: [{
        instanceId: 'family-server', transactionRef: `worldtx-${'a'.repeat(64)}`,
      }] };
    },
    async assertMutationAllowedWithinInstanceLock() {}, async assertStackUpdateAllowedWithinInstanceLock() {},
    async assertModMutationAllowedWithinInstanceLock() {}, async reconcileGeneratedWorldWithinInstanceLock() {},
  };
  const updater = {
    async preflightRecoveryEvidence() { return { domain: 'update', instances: [] }; },
    setStackInterlock() {}, async assertSafeForLifecycle() {},
  };
  const { app } = await fixture(t, {
    backups, mods, worlds, updater,
    backupRecovery: [], modRecovery: [], worldRecovery: [], updateRecovery: [],
    discoverLegacy: async () => { discoveries += 1; return []; },
    importLegacy: async () => { imports += 1; return { imported: true }; },
  });
  assert.deepEqual(app.legacyMigration, { state: 'deferred-managed-recovery', candidateCount: 0 });
  assert.equal(discoveries, 0);
  assert.equal(imports, 0);
});

test('never returns the private managed Java executable path to the UI', async (t) => {
  const { app, baseUrl, dataRoot } = await fixture(t);
  const now = new Date().toISOString();
  await app.store.create({
    id: 'private-runtime', displayName: 'Private Runtime', projectId: 'family-server', kind: 'server',
    minecraftVersion: '26.2', memoryMb: 1024, javaPort: 41231, serverPort: 41231, bedrockPort: 41232,
    directory: path.join(dataRoot, 'servers', 'private-runtime'), javaExecutable: 'C:\\private\\runtime\\bin\\java.exe',
    artifacts: [{ relativePath: 'private/server.jar', sourceUrl: 'https://private.invalid/server.jar' }],
    minecraftServerArtifact: { relativePath: 'private/server.jar', sha256: 'a'.repeat(64) },
    managedProcess: { executablePath: 'C:\\private\\runtime\\bin\\java.exe', token: 'private-token' },
    internalSecret: 'must-not-cross-public-boundary',
    provisioningStatus: 'ready', status: 'stopped', pid: null, createdAt: now, updatedAt: now,
  });
  const response = await fetch(`${baseUrl}/v1/instances`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(body.instances[0]).sort(), [
    'bedrockPort', 'displayName', 'id', 'javaPort', 'kind', 'minecraftVersion', 'pid', 'projectId',
    'provisioningStatus', 'serverPort', 'status',
  ]);
  assert.equal(JSON.stringify(body).includes('C:\\private'), false);
  assert.equal(JSON.stringify(body).includes('private.invalid'), false);
  assert.equal(JSON.stringify(body).includes('must-not-cross'), false);
});

test('refuses to launch a record from the separate 2b2t project', async (t) => {
  const { app, dataRoot } = await fixture(t);
  const directory = path.join(dataRoot, 'servers', 'wrong-project');
  await fs.mkdir(directory, { recursive: true });
  const now = new Date().toISOString();
  await app.store.create({
    id: 'wrong-project', displayName: 'Wrong Project', projectId: '2b2t', kind: 'server', minecraftVersion: '1.21.4',
    memoryMb: 1024, directory, provisioningStatus: 'ready', status: 'stopped', pid: null, createdAt: now, updatedAt: now,
  });
  await assert.rejects(() => app.processes.start('wrong-project'), /not an isolated ready family server/);
});

test('starts, logs, and gracefully stops a registered trusted instance', async (t) => {
  const fake = fileURLToPath(new URL('./fake-server.mjs', import.meta.url));
  const managedJava = path.join(os.tmpdir(), 'mastermind-managed-java-for-test.exe');
  let selectedJava = null;
  const previousSecret = process.env.MASTERMIND_TEST_SECRET;
  process.env.MASTERMIND_TEST_SECRET = 'must-not-reach-minecraft';
  t.after(() => {
    if (previousSecret === undefined) delete process.env.MASTERMIND_TEST_SECRET;
    else process.env.MASTERMIND_TEST_SECRET = previousSecret;
  });
  const { app, dataRoot } = await fixture(t, {
    commandFactory: (_instance, javaExecutable) => {
      selectedJava = javaExecutable;
      return { executable: process.execPath, args: [fake] };
    },
  });
  const directory = path.join(dataRoot, 'servers', 'fixture');
  await fs.mkdir(directory, { recursive: true });
  const [javaPort, bedrockPort] = await Promise.all([freeTcpPort(), freeUdpPort()]);
  const now = new Date().toISOString();
  await app.store.create({
    id: 'fixture', displayName: 'Fixture', projectId: 'family-server', kind: 'server', minecraftVersion: '26.2', loader: 'fabric', loaderVersion: 'test',
    memoryMb: 1024, javaExecutable: managedJava, javaPort, bedrockPort, directory,
    provisioningStatus: 'ready', status: 'stopped', pid: null, lastError: null, createdAt: now, updatedAt: now,
  });
  assert.equal((await app.processes.start('fixture')).status, 'running');
  assert.equal(selectedJava, managedJava);
  assert.equal((await app.processes.stop('fixture', 2_000)).status, 'stopped');
  const logs = await app.logs.tail('fixture');
  assert.ok(logs.some((entry) => entry.line.includes('Fake Minecraft server ready')));
  assert.ok(logs.some((entry) => entry.line.includes('secret=absent')));
  assert.ok(logs.some((entry) => entry.line.includes('path=present')));
  assert.ok(logs.some((entry) => entry.line.includes('readiness have not yet been verified')));
});

test('applies an automatic component update inside the lifecycle lock before starting', async (t) => {
  const fake = fileURLToPath(new URL('./fake-server.mjs', import.meta.url));
  let componentUpdated = false;
  const updater = {
    async reconcileInterruptedTransactions() { return []; },
    async check() {
      return { state: 'component-update-available', updateKind: 'component', requiresApproval: false };
    },
    async updateWithinInstanceLock(input) {
      assert.deepEqual(input, { instanceId: 'component-start' });
      componentUpdated = true;
      return { action: 'updated' };
    },
    async markReady() {},
  };
  const { app, baseUrl, dataRoot } = await fixture(t, {
    updater,
    commandFactory: () => {
      assert.equal(componentUpdated, true, 'the component update must complete before process spawn');
      return { executable: process.execPath, args: [fake] };
    },
  });
  const directory = path.join(dataRoot, 'projects', 'family-server', 'servers', 'component-start');
  await fs.mkdir(directory, { recursive: true });
  const [javaPort, bedrockPort] = await Promise.all([freeTcpPort(), freeUdpPort()]);
  const now = new Date().toISOString();
  await app.store.create({
    id: 'component-start', displayName: 'Component Start', projectId: 'family-server', kind: 'server',
    minecraftVersion: '26.2', memoryMb: 1024, javaExecutable: process.execPath, javaPort, bedrockPort,
    directory, provisioningStatus: 'ready', status: 'stopped', pid: null, createdAt: now, updatedAt: now,
  });

  const response = await fetch(`${baseUrl}/v1/instances/component-start/start`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.instance.status, 'running');
  assert.equal(componentUpdated, true);
  await app.processes.stop('component-start', 2_000);
});

test('Family Server start runs the async mod integrity fence inside the lifecycle lock before update check and spawn', async (t) => {
  const events = []; let insideLock = false;
  const processes = {
    async withInstanceLock(id, operation, options) { assert.equal(id, 'family-server'); assert.deepEqual(options, { priority: 'lifecycle' }); insideLock = true; events.push('lock'); try { return await operation(); } finally { insideLock = false; } },
    async startWithinInstanceLock() { assert.equal(insideLock, true); events.push('spawn'); return {
      id: 'family-server', displayName: 'Family Server', projectId: 'family-server', kind: 'server',
      minecraftVersion: '26.2', status: 'running', pid: 1234,
    }; },
    async isActive() { return false; }, async shutdown() {},
  };
  const updater = { async check() { assert.equal(insideLock, true); events.push('update-check'); return { state: 'current', requiresApproval: false }; },
    async assertSafeForLifecycle(id, options) { assert.equal(id, 'family-server'); assert.equal(insideLock, true); assert.deepEqual(options, { allowPendingReadiness: true }); events.push('update-fence'); },
    async reconcileInterruptedTransactions() { return []; }, setModInterlock() {}, async markReady() {} };
  const mods = { async assertStartAllowedWithinInstanceLock() { assert.equal(insideLock, true); events.push('mod-fence'); },
    async assertStackUpdateAllowedWithinInstanceLock() {}, async initialize() { return []; } };
  const backups = { async preflightRecoveryEvidence() { return { domain: 'backup', instances: [] }; },
    recoveryStatus() { return { manualRecoveryRequired: 0, global: false, instanceIds: [] }; }, assertSafeForLifecycle() {} };
  const { baseUrl } = await fixture(t, { processes, processRecovery: [], updater, updateRecovery: [], mods, modRecovery: [], backupRecovery: [],
    backups, administration: { async initialize() {} } });
  const response = await fetch(`${baseUrl}/v1/instances/family-server/start`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200); assert.deepEqual(events, ['lock', 'update-fence', 'mod-fence', 'update-check', 'spawn']);
});

test('Family Server ensure-running is effect-idempotent and never restarts an active server', async (t) => {
  const events = [];
  const instance = {
    id: 'family-server', displayName: 'Family Server', projectId: 'family-server', kind: 'server',
    minecraftVersion: '26.2', status: 'running', pid: 4242,
  };
  const store = {
    async initialize() {},
    async list() { return [structuredClone(instance)]; },
    async get(id) { return id === instance.id ? structuredClone(instance) : null; },
  };
  const processes = {
    async withInstanceLock(id, operation, options) { assert.equal(id, 'family-server'); assert.deepEqual(options, { priority: 'lifecycle' }); events.push('lock'); return operation(); },
    async isActive(id) { assert.equal(id, 'family-server'); events.push('active-check'); return true; },
    async startWithinInstanceLock() { events.push('unexpected-spawn'); throw new Error('active server was restarted'); },
    async shutdown() {},
  };
  const updater = {
    async check() { events.push('unexpected-update-check'); throw new Error('active server reached updater'); },
    async reconcileInterruptedTransactions() { return []; }, setModInterlock() {}, async markReady() {},
  };
  const mods = {
    async assertStartAllowedWithinInstanceLock() { events.push('unexpected-mod-fence'); throw new Error('active server reached mod fence'); },
    async assertStackUpdateAllowedWithinInstanceLock() {}, async initialize() { return []; },
  };
  const backups = {
    async preflightRecoveryEvidence() { return { domain: 'backup', instances: [] }; },
    recoveryStatus() { return { manualRecoveryRequired: 0, global: false, instanceIds: [] }; },
    async assertSafeForLifecycle() { events.push('unexpected-backup-fence'); throw new Error('active server reached backup fence'); },
  };
  const { baseUrl } = await fixture(t, {
    store, processes, processRecovery: [], updater, updateRecovery: [], mods, modRecovery: [], backups, backupRecovery: [],
    administration: { async initialize() {} },
  });
  events.length = 0;

  const response = await fetch(`${baseUrl}/v1/instances/family-server/ensure-running`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    action: 'already-running',
    instance: {
      id: 'family-server', displayName: 'Family Server', projectId: 'family-server', kind: 'server',
      minecraftVersion: '26.2', status: 'running', pid: 4242,
    },
  });
  assert.deepEqual(events, ['lock', 'active-check']);
});

test('Family Server ensure-running starts a stopped server through the existing fenced lifecycle path', async (t) => {
  const events = [];
  const stopped = {
    id: 'family-server', displayName: 'Family Server', projectId: 'family-server', kind: 'server',
    minecraftVersion: '26.2', status: 'stopped', pid: null,
  };
  const store = {
    async initialize() {},
    async list() { return [structuredClone(stopped)]; },
    async get(id) { return id === stopped.id ? structuredClone(stopped) : null; },
  };
  const processes = {
    async withInstanceLock(id, operation) { assert.equal(id, 'family-server'); events.push('lock'); return operation(); },
    async isActive() { events.push('active-check'); return false; },
    async startWithinInstanceLock() { events.push('spawn'); return { ...stopped, status: 'running', pid: 4343 }; },
    async shutdown() {},
  };
  const updater = {
    async assertSafeForLifecycle(_id, options) { assert.deepEqual(options, { allowPendingReadiness: true }); events.push('update-fence'); },
    async check() { events.push('update-check'); return { state: 'current', requiresApproval: false }; },
    async reconcileInterruptedTransactions() { return []; }, setModInterlock() {}, async markReady() {},
  };
  const mods = {
    async assertStartAllowedWithinInstanceLock() { events.push('mod-fence'); },
    async assertStackUpdateAllowedWithinInstanceLock() {}, async initialize() { return []; },
  };
  const backups = {
    async preflightRecoveryEvidence() { return { domain: 'backup', instances: [] }; },
    recoveryStatus() { return { manualRecoveryRequired: 0, global: false, instanceIds: [] }; },
    async assertSafeForLifecycle() { events.push('backup-fence'); },
  };
  const worlds = {
    async preflightRecoveryEvidence() { return { domain: 'world', instances: [] }; },
    async initialize() { return []; },
    async assertMutationAllowedWithinInstanceLock() { events.push('world-fence'); },
    async assertStackUpdateAllowedWithinInstanceLock() {}, async assertModMutationAllowedWithinInstanceLock() {},
    async reconcileGeneratedWorldWithinInstanceLock() {},
  };
  const { baseUrl } = await fixture(t, {
    store, processes, processRecovery: [], updater, updateRecovery: [], mods, modRecovery: [], backups, backupRecovery: [], worlds,
    administration: { async initialize() {} },
  });
  events.length = 0;

  const response = await fetch(`${baseUrl}/v1/instances/family-server/ensure-running`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.action, 'started');
  assert.equal(body.instance.status, 'running');
  assert.equal(body.instance.pid, 4343);
  assert.deepEqual(events, [
    'lock', 'active-check', 'update-fence', 'backup-fence', 'mod-fence', 'update-check', 'world-fence', 'spawn',
  ]);
});

test('a failed Family mod fence blocks start before update or spawn', async (t) => {
  const events = [];
  const processes = { async withInstanceLock(_id, operation) { events.push('lock'); return operation(); }, async startWithinInstanceLock() { events.push('spawn'); }, async isActive() { return false; }, async shutdown() {} };
  const updater = { async assertSafeForLifecycle() { events.push('update-fence'); }, async check() { events.push('update'); return { state: 'current', requiresApproval: false }; }, async reconcileInterruptedTransactions() { return []; }, setModInterlock() {}, async markReady() {} };
  const mods = { async assertStartAllowedWithinInstanceLock() { events.push('mod-fence'); throw Object.assign(new Error('Managed mod integrity failed.'), { code: 'MOD_INTEGRITY_FAILED', statusCode: 409 }); },
    async assertStackUpdateAllowedWithinInstanceLock() {}, async initialize() { return []; } };
  const backups = { async preflightRecoveryEvidence() { return { domain: 'backup', instances: [] }; },
    recoveryStatus() { return { manualRecoveryRequired: 0, global: false, instanceIds: [] }; }, assertSafeForLifecycle() {} };
  const { baseUrl } = await fixture(t, { processes, processRecovery: [], updater, updateRecovery: [], mods, modRecovery: [], backups, backupRecovery: [], administration: { async initialize() {} } });
  const response = await fetch(`${baseUrl}/v1/instances/family-server/start`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 409); assert.equal((await response.json()).code, 'MOD_INTEGRITY_FAILED');
  assert.deepEqual(events, ['lock', 'update-fence', 'mod-fence']);
});

test('intentional launch-trust refusal is returned as a fixed sanitized lifecycle error', async (t) => {
  const processes = {
    async withInstanceLock(_id, operation) { return operation(); },
    async startWithinInstanceLock() {
      throw Object.assign(new Error('C:\\secret\\launch-helper.ps1 exposed internal path'), {
        code: 'LAUNCH_TRUST_UNAVAILABLE', statusCode: 503,
      });
    },
    async isActive() { return false; }, async shutdown() {},
  };
  const updater = {
    async assertSafeForLifecycle() {}, async check() { return { state: 'current', requiresApproval: false }; },
    async reconcileInterruptedTransactions() { return []; }, setModInterlock() {}, async markReady() {},
  };
  const mods = {
    async assertStartAllowedWithinInstanceLock() {}, async assertStackUpdateAllowedWithinInstanceLock() {},
    async initialize() { return []; },
  };
  const backups = {
    async preflightRecoveryEvidence() { return { domain: 'backup', instances: [] }; },
    recoveryStatus() { return { manualRecoveryRequired: 0, global: false, instanceIds: [] }; },
    async assertSafeForLifecycle() {},
  };
  const { baseUrl } = await fixture(t, {
    processes, processRecovery: [], updater, updateRecovery: [], mods, modRecovery: [], backups, backupRecovery: [],
    administration: { async initialize() {} },
  });
  const response = await fetch(`${baseUrl}/v1/instances/family-server/start`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false, code: 'LAUNCH_TRUST_UNAVAILABLE',
    message: 'The authenticated launch boundary is unavailable on this system.',
  });
});

test('marks a pending update ready only after both Minecraft and Geyser readiness lines are observed', async (t) => {
  const fake = fileURLToPath(new URL('./fake-server.mjs', import.meta.url));
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  const updater = {
    async reconcileInterruptedTransactions() { return []; },
    async check() { return { state: 'current', requiresApproval: false }; },
    async markReady(input) { resolveReady(input); },
  };
  const { app, dataRoot } = await fixture(t, {
    updater,
    commandFactory: () => ({ executable: process.execPath, args: [fake] }),
    readinessStabilityMs: 0,
  });
  const directory = path.join(dataRoot, 'projects', 'family-server', 'servers', 'readiness');
  await fs.mkdir(directory, { recursive: true });
  const [javaPort, bedrockPort] = await Promise.all([freeTcpPort(), freeUdpPort()]);
  const transactionId = '00000000-0000-4000-8000-000000000002';
  const now = new Date().toISOString();
  await app.store.create({
    id: 'readiness', displayName: 'Readiness', projectId: 'family-server', kind: 'server',
    minecraftVersion: '26.2', memoryMb: 1024, javaExecutable: process.execPath, javaPort, bedrockPort,
    directory, provisioningStatus: 'ready', status: 'stopped', pid: null,
    updateStatus: { state: 'pending-unverified', transactionId }, createdAt: now, updatedAt: now,
  });
  await app.processes.start('readiness');
  assert.deepEqual(await Promise.race([
    ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error('readiness timed out')), 2_000)),
  ]), { instanceId: 'readiness', transactionId });
  await app.processes.stop('readiness', 2_000);
});

test('requires valid Java and Bedrock ports before spawning', async (t) => {
  let commandFactoryCalled = false;
  const { app, dataRoot } = await fixture(t, {
    commandFactory: () => {
      commandFactoryCalled = true;
      return { executable: process.execPath, args: [] };
    },
  });
  const directory = path.join(dataRoot, 'servers', 'invalid-ports');
  await fs.mkdir(directory, { recursive: true });
  const now = new Date().toISOString();
  const bedrockPort = await freeUdpPort();
  await app.store.create({
    id: 'invalid-java-port', displayName: 'Invalid Java Port', projectId: 'family-server', kind: 'server',
    minecraftVersion: '26.2', memoryMb: 1024, javaExecutable: process.execPath, javaPort: 0, bedrockPort,
    directory, provisioningStatus: 'ready', status: 'stopped', pid: null, createdAt: now, updatedAt: now,
  });
  await assert.rejects(() => app.processes.start('invalid-java-port'), /javaPort must be an integer between 1 and 65535/);

  const javaPort = await freeTcpPort();
  await app.store.create({
    id: 'invalid-bedrock-port', displayName: 'Invalid Bedrock Port', projectId: 'family-server', kind: 'server',
    minecraftVersion: '26.2', memoryMb: 1024, javaExecutable: process.execPath, javaPort, bedrockPort: 65536,
    directory, provisioningStatus: 'ready', status: 'stopped', pid: null, createdAt: now, updatedAt: now,
  });
  await assert.rejects(() => app.processes.start('invalid-bedrock-port'), /bedrockPort must be an integer between 1 and 65535/);
  assert.equal(commandFactoryCalled, false);
});

test('verifies the managed install immediately before spawn and refuses a failed check', async (t) => {
  let commandFactoryCalled = false;
  const { app, dataRoot } = await fixture(t, {
    verifyInstall: async () => { throw new Error('Managed artifact failed integrity verification'); },
    commandFactory: () => {
      commandFactoryCalled = true;
      return { executable: process.execPath, args: [] };
    },
  });
  const directory = path.join(dataRoot, 'servers', 'tampered-install');
  await fs.mkdir(directory, { recursive: true });
  const [javaPort, bedrockPort] = await Promise.all([freeTcpPort(), freeUdpPort()]);
  const now = new Date().toISOString();
  await app.store.create({
    id: 'tampered-install', displayName: 'Tampered Install', projectId: 'family-server', kind: 'server',
    minecraftVersion: '26.2', memoryMb: 1024, javaExecutable: process.execPath, javaPort, bedrockPort,
    directory, provisioningStatus: 'ready', status: 'stopped', pid: null, createdAt: now, updatedAt: now,
  });
  await assert.rejects(() => app.processes.start('tampered-install'), /integrity verification/);
  assert.equal(commandFactoryCalled, false);
  assert.equal((await app.store.get('tampered-install')).status, 'stopped');
});

test('rejects an occupied Bedrock UDP port and releases its probe', async (t) => {
  const occupied = dgram.createSocket({ type: 'udp4', reuseAddr: false });
  await new Promise((resolve, reject) => {
    occupied.once('error', reject);
    occupied.bind(0, '0.0.0.0', resolve);
  });
  t.after(() => new Promise((resolve) => occupied.close(resolve)));

  const { app, dataRoot } = await fixture(t);
  const directory = path.join(dataRoot, 'servers', 'occupied-bedrock');
  await fs.mkdir(directory, { recursive: true });
  const now = new Date().toISOString();
  await app.store.create({
    id: 'occupied-bedrock', displayName: 'Occupied Bedrock', projectId: 'family-server', kind: 'server',
    minecraftVersion: '26.2', memoryMb: 1024, javaExecutable: process.execPath,
    javaPort: await freeTcpPort(), bedrockPort: occupied.address().port, directory,
    provisioningStatus: 'ready', status: 'stopped', pid: null, createdAt: now, updatedAt: now,
  });
  await assert.rejects(() => app.processes.start('occupied-bedrock'), /Bedrock UDP port .* occupied/);
});
