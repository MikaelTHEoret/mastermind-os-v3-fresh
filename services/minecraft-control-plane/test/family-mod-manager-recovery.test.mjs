import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FamilyModManager, FAMILY_MOD_CONFIRMATIONS } from '../src/family-mod-manager.mjs';

const FAMILY_ID = 'family-server';
const CORE_FILE_NAMES = ['fabric-api.jar', 'floodgate-fabric.jar', 'geyser-fabric.jar'];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const encodedName = Buffer.from(name);
    const bytes = Buffer.from(content);
    const checksum = crc32(bytes);
    const local = Buffer.alloc(30 + encodedName.length + bytes.length);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(encodedName.length, 26);
    encodedName.copy(local, 30);
    bytes.copy(local, 30 + encodedName.length);

    const central = Buffer.alloc(46 + encodedName.length);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(0x314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(encodedName.length, 28);
    central.writeUInt32LE((0x81a4 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    encodedName.copy(central, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function jar(id, version, depends = {}) {
  return zip([['fabric.mod.json', JSON.stringify({ schemaVersion: 1, id, version, environment: 'server', depends })]]);
}

function sha512(bytes) {
  return crypto.createHash('sha512').update(bytes).digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function pathExists(target) {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

class MemoryStore {
  constructor(value) {
    this.value = structuredClone(value);
  }

  async get(id) {
    return id === this.value.id ? structuredClone(this.value) : null;
  }
}

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-family-mod-recovery-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'servers', FAMILY_ID);
  const mods = path.join(directory, 'mods');
  await fs.mkdir(mods, { recursive: true });

  const core = {
    fabricApi: jar('fabric-api', '0.157.0+26.2'),
    geyser: jar('geyser-fabric', '2.11.1-SNAPSHOT', { 'fabric-api': '*' }),
    floodgate: jar('floodgate', '2.2.6-SNAPSHOT', { 'fabric-api': '*' }),
  };
  await fs.writeFile(path.join(mods, 'fabric-api.jar'), core.fabricApi);
  await fs.writeFile(path.join(mods, 'geyser-fabric.jar'), core.geyser);
  await fs.writeFile(path.join(mods, 'floodgate-fabric.jar'), core.floodgate);

  const component = (versionId, versionNumber, bytes) => ({
    versionId,
    versionNumber,
    sourceHash: { algorithm: 'sha512', value: sha512(bytes) },
  });
  const instance = {
    id: FAMILY_ID,
    projectId: FAMILY_ID,
    kind: 'server',
    loader: 'fabric',
    minecraftVersion: '26.2',
    loaderVersion: '0.19.3',
    requiredJavaMajor: 25,
    components: {
      fabricApi: component('FAPI0001', '0.157.0+26.2', core.fabricApi),
      geyser: component('GEYS0001', '2.11.1-SNAPSHOT', core.geyser),
      floodgate: component('FLOD0001', '2.2.6-SNAPSHOT', core.floodgate),
    },
    directory,
    status: 'stopped',
    pid: null,
    managedProcess: null,
  };
  const artifact = jar('examplemod', '1.0.0', { 'fabric-api': '*' });
  const state = { locks: 0, downloads: 0 };
  const client = {
    async search() {
      return { totalHits: 1, items: [{ projectId: 'AAAABBBB', title: 'Example Mod', description: 'Fixture', author: 'Fixture' }] };
    },
    async project() {
      return { projectId: 'AAAABBBB', title: 'Example Mod', description: 'Fixture', author: 'Fixture', license: 'MIT' };
    },
    async resolveGraph() {
      return {
        totalBytes: artifact.length,
        nodes: [{
          projectId: 'AAAABBBB',
          versionId: 'VER00001',
          title: 'Example Mod',
          version: '1.0.0',
          environment: 'server_only',
          publishedAt: '2026-08-01T00:00:00.000Z',
          relationship: 'requested',
          requiredProjectIds: [],
          file: { size: artifact.length, sha512: sha512(artifact), sourceUrl: 'private-test-value' },
        }],
      };
    },
    async download(_node, target) {
      state.downloads += 1;
      await fs.writeFile(target, artifact, { flag: 'wx', mode: 0o600 });
    },
  };
  const store = new MemoryStore(instance);
  const makeManager = (overrides = {}) => new FamilyModManager(root, store, client, {
    withInstanceLock: async (_id, operation) => {
      state.locks += 1;
      return operation();
    },
    assertQuiescentWithinInstanceLock: async () => structuredClone(instance),
    assertWorldMutationAllowedWithinInstanceLock: async () => true,
    randomBytes: (size) => Buffer.alloc(size, 7),
    now: options.now ?? (() => '2026-08-13T12:00:00.000Z'),
    onPhase: options.onPhase,
    statfs: options.statfs,
    platform: 'linux',
    filesystemEntryVerifier: async () => ({ ok: true, checked: false }),
    directoryGuard: async (directory) => ({ assertHeld() {}, async release() {}, async rename(target) { await fs.rename(directory, target); } }),
    fileGuard: async (file) => ({ assertHeld() {}, async release() {}, async delete() { await fs.unlink(file); }, async rename(target) { await fs.rename(file, target); }, async replace(target) { await fs.rename(file, target); } }),
    ...overrides,
  });
  const manager = makeManager();
  await manager.initialize();
  return { root, directory, mods, manager, makeManager };
}

async function installPlan(value, requestId = '11111111-1111-4111-8111-111111111111') {
  const search = await value.manager.search(FAMILY_ID, { query: 'map', offset: 0, limit: 20 });
  return value.manager.createPlan(FAMILY_ID, {
    requestId,
    operation: 'install',
    catalogRef: search.catalog.candidates[0].catalogRef,
  });
}

function requestId(index) {
  const prefix = index.toString(16).padStart(8, '0');
  const suffix = index.toString(16).padStart(12, '0');
  return `${prefix}-0000-4000-8000-${suffix}`;
}

async function leaveCommittedCompletionUnknown(t) {
  let crash = true;
  const value = await fixture(t, {
    onPhase: async (phase) => {
      if (phase === 'committed' && crash) {
        crash = false;
        throw new Error('simulated process loss after committed marker');
      }
    },
  });
  const plan = await installPlan(value);
  await assert.rejects(() => value.manager.execute(FAMILY_ID, {
    requestId: plan.requestId,
    planId: plan.planId,
    confirmation: FAMILY_MOD_CONFIRMATIONS.install,
  }), (error) => error.code === 'MOD_COMPLETION_UNKNOWN');
  const operation = await value.manager.operation(FAMILY_ID, plan.requestId);
  assert.equal(operation.state, 'completion-unknown');
  return { ...value, plan, operation };
}

async function resignMarker(value, phase) {
  const transactionDirectory = path.join(value.root, 'state', 'family-mods', 'transactions', FAMILY_ID, value.operation.transactionRef);
  const markerFile = path.join(transactionDirectory, 'marker.json');
  const marker = JSON.parse(await fs.readFile(markerFile, 'utf8'));
  marker.phase = phase;
  marker.failureCode = null;
  delete marker.mac;
  const key = await fs.readFile(path.join(value.root, 'state', 'family-mods', 'hmac.key'));
  marker.mac = crypto.createHmac('sha256', key).update(canonical(marker)).digest('hex');
  await fs.writeFile(markerFile, `${JSON.stringify(marker)}\n`);
  return { marker, transactionDirectory };
}

async function auditEntries(root) {
  const text = await fs.readFile(path.join(root, 'state', 'family-mods', 'audit.jsonl'), 'utf8');
  return text ? text.trimEnd().split('\n').map((line) => JSON.parse(line)) : [];
}

async function assertLifecycleFenced(manager) {
  await assert.rejects(() => manager.assertSafeForLifecycle({ instanceId: FAMILY_ID }), (error) => error.code === 'MOD_MANUAL_RECOVERY_REQUIRED');
}

test('restart completes rollback after a crash between live-to-failed-live and displaced-to-live renames', async (t) => {
  const value = await leaveCommittedCompletionUnknown(t);
  const { transactionDirectory } = await resignMarker(value, 'candidate-published');
  const failedLive = path.join(transactionDirectory, 'failed-live');
  const displaced = path.join(transactionDirectory, 'displaced');
  assert.equal(await pathExists(displaced), true);
  await fs.rename(value.mods, failedLive);
  assert.equal(await pathExists(value.mods), false);

  const restarted = value.makeManager({ onPhase: async () => undefined });
  const recovery = await restarted.initialize();
  assert.deepEqual(recovery, [{ instanceId: FAMILY_ID, transactionRef: value.operation.transactionRef, action: 'rolled-back' }]);
  assert.deepEqual((await fs.readdir(value.mods)).sort(), CORE_FILE_NAMES);
  const operation = await restarted.operation(FAMILY_ID, value.plan.requestId);
  assert.equal(operation.state, 'rolled-back');
  assert.equal(operation.application, 'rolled-back-verified');
  assert.equal(operation.rollbackSnapshot.state, 'restored-verified');
  assert.deepEqual(await fs.readdir(transactionDirectory), ['marker.json'], 'recovered rollback must compact terminal transaction evidence');
  await restarted.assertStartAllowedWithinInstanceLock();
});

test('restart verifies an already restored live directory after a crash immediately after displaced-to-live', async (t) => {
  const value = await leaveCommittedCompletionUnknown(t);
  const { transactionDirectory } = await resignMarker(value, 'candidate-published');
  const failedLive = path.join(transactionDirectory, 'failed-live');
  const displaced = path.join(transactionDirectory, 'displaced');
  await fs.rename(value.mods, failedLive);
  await fs.rename(displaced, value.mods);
  assert.equal(await pathExists(failedLive), true);
  assert.equal(await pathExists(displaced), false);

  const restarted = value.makeManager({ onPhase: async () => undefined });
  const recovery = await restarted.initialize();
  assert.deepEqual(recovery, [{ instanceId: FAMILY_ID, transactionRef: value.operation.transactionRef, action: 'rolled-back' }]);
  assert.deepEqual((await fs.readdir(value.mods)).sort(), CORE_FILE_NAMES);
  const operation = await restarted.operation(FAMILY_ID, value.plan.requestId);
  assert.equal(operation.state, 'rolled-back');
  assert.equal(operation.application, 'rolled-back-verified');
  assert.equal(operation.rollbackSnapshot.state, 'restored-verified');
  assert.deepEqual(await fs.readdir(transactionDirectory), ['marker.json'], 'recovered rollback must remove its rescue payload');
  await restarted.assertStartAllowedWithinInstanceLock();
});

test('terminal restart reconciliation rewrites completion-unknown and appends one terminal audit record', async (t) => {
  const value = await leaveCommittedCompletionUnknown(t);
  const operationFile = path.join(value.root, 'state', 'family-mods', 'transactions', FAMILY_ID, 'operations', `${value.plan.requestId}.json`);
  assert.equal(JSON.parse(await fs.readFile(operationFile, 'utf8')).state, 'completion-unknown');
  assert.deepEqual((await auditEntries(value.root)).map((entry) => entry.event), ['prewrite']);

  const restarted = value.makeManager({ onPhase: async () => undefined });
  const recovery = await restarted.initialize();
  assert.equal(recovery[0].action, 'committed');
  assert.equal(JSON.parse(await fs.readFile(operationFile, 'utf8')).state, 'committed');
  const entries = await auditEntries(value.root);
  assert.equal(entries.length, 2);
  assert.equal(entries[1].event, 'terminal');
  assert.equal(entries[1].state, 'committed');
  assert.equal(entries[1].transactionRef, value.operation.transactionRef);
  const transactionDirectory = path.join(value.root, 'state', 'family-mods', 'transactions', FAMILY_ID, value.operation.transactionRef);
  assert.deepEqual(await fs.readdir(transactionDirectory), ['marker.json'], 'terminal restart reconciliation must compact displaced payload');

  const secondRestart = value.makeManager({ onPhase: async () => undefined });
  await secondRestart.initialize();
  assert.equal((await auditEntries(value.root)).length, 2, 'terminal reconciliation must be audit-idempotent');
});

test('restart resumes terminal cleanup after the payload was renamed to its cleanup tombstone', async (t) => {
  const value = await leaveCommittedCompletionUnknown(t);
  const transactionDirectory = path.join(value.root, 'state', 'family-mods', 'transactions', FAMILY_ID, value.operation.transactionRef);
  await fs.rename(path.join(transactionDirectory, 'displaced'), path.join(transactionDirectory, '.cleanup-displaced'));

  const restarted = value.makeManager({ onPhase: async () => undefined });
  const recovery = await restarted.initialize();
  assert.equal(recovery[0].action, 'committed');
  assert.deepEqual(await fs.readdir(transactionDirectory), ['marker.json']);
  assert.equal((await restarted.operation(FAMILY_ID, value.plan.requestId)).state, 'committed');
});

test('cleanup-tombstone junction fences recovery without traversing or changing its outside victim', async (t) => {
  const value = await leaveCommittedCompletionUnknown(t);
  const victim = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-mod-cleanup-victim-'));
  t.after(() => fs.rm(victim, { recursive: true, force: true }));
  const sentinel = path.join(victim, 'sentinel.txt');
  await fs.writeFile(sentinel, 'unchanged');
  const transactionDirectory = path.join(value.root, 'state', 'family-mods', 'transactions', FAMILY_ID, value.operation.transactionRef);
  const tombstone = path.join(transactionDirectory, '.cleanup-displaced');
  try {
    await fs.symlink(victim, tombstone, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'EINVAL'].includes(error?.code)) return t.skip('directory link creation is unavailable');
    throw error;
  }

  const restarted = value.makeManager({ onPhase: async () => undefined });
  const recovery = await restarted.initialize();
  assert.equal(recovery[0].action, 'manual-recovery-required');
  await assertLifecycleFenced(restarted);
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'unchanged');
});

test('orphan completion-unknown operation with no transaction directory fences startup and stack updates', async (t) => {
  const value = await leaveCommittedCompletionUnknown(t);
  const transactionDirectory = path.join(value.root, 'state', 'family-mods', 'transactions', FAMILY_ID, value.operation.transactionRef);
  await fs.rm(transactionDirectory, { recursive: true, force: false });

  const restarted = value.makeManager({ onPhase: async () => undefined });
  await assert.rejects(() => restarted.initialize(), (error) => error.code === 'MOD_STATE_UNAVAILABLE');
  await assertLifecycleFenced(restarted);
  await assert.rejects(() => restarted.assertStartAllowedWithinInstanceLock(), (error) => error.code === 'MOD_MANUAL_RECOVERY_REQUIRED');
  await assert.rejects(() => restarted.assertStackUpdateAllowedWithinInstanceLock(), (error) => error.code === 'MOD_MANUAL_RECOVERY_REQUIRED');
});

test('unexpected transaction entry fences initialization and the server lifecycle', async (t) => {
  const value = await fixture(t);
  const unexpected = path.join(value.root, 'state', 'family-mods', 'transactions', FAMILY_ID, 'unexpected.txt');
  await fs.writeFile(unexpected, 'do not interpret');
  const restarted = value.makeManager();
  await assert.rejects(() => restarted.initialize(), (error) => error.code === 'MOD_STATE_UNAVAILABLE');
  await assertLifecycleFenced(restarted);
});

test('valid-looking orphan transaction directory records manual recovery and fences lifecycle', async (t) => {
  const value = await fixture(t);
  const transactionRef = `modtx-${'b'.repeat(64)}`;
  await fs.mkdir(path.join(value.root, 'state', 'family-mods', 'transactions', FAMILY_ID, transactionRef));
  const restarted = value.makeManager();
  await restarted.initialize();
  await assertLifecycleFenced(restarted);
  const inventory = await restarted.inventory(FAMILY_ID);
  assert.deepEqual(inventory.recovery, { required: true, transactionRef, state: 'manual-recovery-required' });
});

test('unexpected operation-journal entry fences initialization and the server lifecycle', async (t) => {
  const value = await fixture(t);
  const operations = path.join(value.root, 'state', 'family-mods', 'transactions', FAMILY_ID, 'operations');
  await fs.writeFile(path.join(operations, 'unexpected.txt'), 'do not interpret');
  const restarted = value.makeManager();
  await assert.rejects(() => restarted.initialize(), (error) => error.code === 'MOD_STATE_UNAVAILABLE');
  await assertLifecycleFenced(restarted);
});

test('transaction-directory junction is fenced without following or changing its victim', async (t) => {
  const value = await fixture(t);
  const victim = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-mod-tx-victim-'));
  t.after(() => fs.rm(victim, { recursive: true, force: true }));
  const sentinel = path.join(victim, 'sentinel.txt');
  await fs.writeFile(sentinel, 'unchanged');
  const link = path.join(value.root, 'state', 'family-mods', 'transactions', FAMILY_ID, `modtx-${'a'.repeat(64)}`);
  try {
    await fs.symlink(victim, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'EINVAL'].includes(error?.code)) return t.skip('directory link creation is unavailable');
    throw error;
  }
  const restarted = value.makeManager();
  await assert.rejects(() => restarted.initialize(), (error) => error.code === 'MOD_STATE_UNAVAILABLE');
  await assertLifecycleFenced(restarted);
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'unchanged');
});

test('HMAC key file symlink is rejected without reading or changing its victim', async (t) => {
  const value = await fixture(t);
  const victimRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-mod-key-victim-'));
  t.after(() => fs.rm(victimRoot, { recursive: true, force: true }));
  const victim = path.join(victimRoot, 'victim.key');
  const expected = Buffer.alloc(32, 19);
  await fs.writeFile(victim, expected);
  const key = path.join(value.root, 'state', 'family-mods', 'hmac.key');
  await fs.rm(key);
  try {
    await fs.symlink(victim, key, 'file');
  } catch (error) {
    if (['EPERM', 'EACCES', 'EINVAL'].includes(error?.code)) return t.skip('file symlink creation is unavailable');
    throw error;
  }
  await assert.rejects(() => value.makeManager().initialize(), (error) => error.code === 'MOD_STATE_UNAVAILABLE');
  assert.deepEqual(await fs.readFile(victim), expected);
});

test('HMAC key junction is rejected without traversing or changing its victim directory', async (t) => {
  const value = await fixture(t);
  const victim = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-mod-key-junction-victim-'));
  t.after(() => fs.rm(victim, { recursive: true, force: true }));
  const sentinel = path.join(victim, 'sentinel.txt');
  await fs.writeFile(sentinel, 'unchanged');
  const key = path.join(value.root, 'state', 'family-mods', 'hmac.key');
  await fs.rm(key);
  try {
    await fs.symlink(victim, key, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'EINVAL'].includes(error?.code)) return t.skip('directory link creation is unavailable');
    throw error;
  }
  await assert.rejects(() => value.makeManager().initialize(), (error) => error.code === 'MOD_STATE_UNAVAILABLE');
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'unchanged');
});

test('expired complete plan reservation is garbage-collected before admitting a replacement', async (t) => {
  let current = '2026-08-13T12:00:00.000Z';
  const value = await fixture(t, { now: () => current });
  const expired = await installPlan(value);
  const planRoot = path.join(value.root, 'state', 'family-mods', 'plans', FAMILY_ID);
  const expiredDirectory = path.join(planRoot, expired.requestId);
  const expiredRequest = path.join(planRoot, 'requests', `${expired.requestId}.json`);
  assert.equal(await pathExists(expiredDirectory), true);
  current = '2026-08-13T12:11:00.000Z';

  const search = await value.manager.search(FAMILY_ID, { query: 'map', offset: 0, limit: 20 });
  await value.manager.createPlan(FAMILY_ID, {
    requestId: '22222222-2222-4222-8222-222222222222',
    operation: 'install',
    catalogRef: search.catalog.candidates[0].catalogRef,
  });
  assert.equal(await pathExists(expiredDirectory), false);
  assert.equal(await pathExists(expiredRequest), false);
});

test('orphan incomplete plan staging is garbage-collected before admitting a new plan', async (t) => {
  const value = await fixture(t);
  const orphanId = '99999999-9999-4999-8999-999999999999';
  const orphan = path.join(value.root, 'state', 'family-mods', 'plans', FAMILY_ID, orphanId);
  const tombstone = path.join(value.root, 'state', 'family-mods', 'plans', FAMILY_ID, `.gc-${'8'.repeat(8)}-${'8'.repeat(4)}-4888-8888-${'8'.repeat(12)}`);
  await fs.mkdir(path.join(orphan, 'stage'), { recursive: true });
  await fs.writeFile(path.join(orphan, 'stage', 'partial-download.jar'), Buffer.alloc(4096, 3));
  await fs.mkdir(tombstone);
  await fs.writeFile(path.join(tombstone, 'interrupted-cleanup.bin'), Buffer.alloc(1024, 4));

  const search = await value.manager.search(FAMILY_ID, { query: 'map', offset: 0, limit: 20 });
  await value.manager.createPlan(FAMILY_ID, {
    requestId: '22222222-2222-4222-8222-222222222222',
    operation: 'install',
    catalogRef: search.catalog.candidates[0].catalogRef,
  });
  assert.equal(await pathExists(orphan), false, 'unreferenced crash staging must not consume quota indefinitely');
  assert.equal(await pathExists(tombstone), false, 'an interrupted GC tombstone must be completed safely');
});

test('expired terminal plans retain only a bounded rollback window and compact transaction evidence', async (t) => {
  let currentMs = Date.parse('2026-08-13T12:00:00.000Z');
  const value = await fixture(t, { now: () => new Date(currentMs).toISOString() });
  let latestOperation;
  for (let index = 1; index <= 12; index += 1) {
    const inventory = await value.manager.inventory(FAMILY_ID);
    let plan;
    if (inventory.installed.length === 0) {
      plan = await installPlan(value, requestId(index));
    } else {
      plan = await value.manager.createPlan(FAMILY_ID, {
        requestId: requestId(index),
        operation: 'remove',
        installedRef: inventory.installed[0].installedRef,
      });
    }
    latestOperation = await value.manager.execute(FAMILY_ID, {
      requestId: plan.requestId,
      planId: plan.planId,
      confirmation: FAMILY_MOD_CONFIRMATIONS[plan.operation],
    });
    assert.equal(latestOperation.state, 'committed', `terminal retention cycle operation ${index} unexpectedly rolled back`);
    const transactionDirectory = path.join(value.root, 'state', 'family-mods', 'transactions', FAMILY_ID, latestOperation.transactionRef);
    assert.deepEqual(await fs.readdir(transactionDirectory), ['marker.json'], 'terminal transaction evidence must not retain working directories');
    currentMs += 11 * 60 * 1000;
  }

  const planRoot = path.join(value.root, 'state', 'family-mods', 'plans', FAMILY_ID);
  const retainedPlanDirectories = (await fs.readdir(planRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name !== 'requests');
  const retainedRequests = await fs.readdir(path.join(planRoot, 'requests'));
  assert.ok(retainedPlanDirectories.length <= 4,
    `expected at most four rollback reservations, found ${retainedPlanDirectories.length}: ${retainedPlanDirectories.map((entry) => entry.name).join(', ')}`);
  assert.ok(retainedRequests.length <= 4, `expected at most four retained plan journals, found ${retainedRequests.length}`);

  const rollback = await value.manager.createPlan(FAMILY_ID, {
    requestId: requestId(13),
    operation: 'rollback',
    transactionRef: latestOperation.transactionRef,
  });
  assert.equal(rollback.operation, 'rollback', 'the newest retained snapshot must remain usable');
});

test('transaction-state byte quota rejects a new mutation before creating transaction evidence', async (t) => {
  const value = await fixture(t);
  const install = await installPlan(value);
  const committed = await value.manager.execute(FAMILY_ID, {
    requestId: install.requestId,
    planId: install.planId,
    confirmation: FAMILY_MOD_CONFIRMATIONS.install,
  });
  assert.equal(committed.state, 'committed');

  const inventory = await value.manager.inventory(FAMILY_ID);
  const removal = await value.manager.createPlan(FAMILY_ID, {
    requestId: '22222222-2222-4222-8222-222222222222',
    operation: 'remove',
    installedRef: inventory.installed[0].installedRef,
  });
  const transactionRoot = path.join(value.root, 'state', 'family-mods', 'transactions', FAMILY_ID);
  const retainedTransaction = path.join(transactionRoot, committed.transactionRef);
  const padding = await fs.open(path.join(retainedTransaction, 'bounded-padding.bin'), 'wx');
  try {
    await padding.truncate(65 * 1024 * 1024);
  } finally {
    await padding.close();
  }
  const beforeTransactions = (await fs.readdir(transactionRoot)).sort();

  await assert.rejects(() => value.manager.execute(FAMILY_ID, {
    requestId: removal.requestId,
    planId: removal.planId,
    confirmation: FAMILY_MOD_CONFIRMATIONS.remove,
  }), (error) => error.code === 'MOD_PLAN_QUOTA_EXCEEDED');
  assert.deepEqual((await fs.readdir(transactionRoot)).sort(), beforeTransactions, 'quota rejection must not allocate another transaction');
  assert.equal((await value.manager.inventory(FAMILY_ID)).installed.length, 1, 'quota rejection must not mutate the live mods directory');
});
