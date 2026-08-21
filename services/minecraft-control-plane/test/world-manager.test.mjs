import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import { FamilyWorldManager, removeManagedFabricRuntimeCache } from '../src/world-manager.mjs';
import { acquireWindowsDirectoryGuard, acquireWindowsFileGuard } from '../src/windows-filesystem-safety.mjs';

const FAMILY_ID = 'family-server';
const BACKUP_ID = `bkp-${'a'.repeat(32)}`;
const WORLD_DATA_VERSION = 4903;

test('guardedly removes only the fixed Fabric runtime cache and its interrupted tombstone', async (t) => {
  const managedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-fabric-cache-cleanup-'));
  t.after(() => fs.rm(managedRoot, { recursive: true, force: true }));
  const directory = path.join(managedRoot, 'servers', FAMILY_ID);
  const cache = path.join(directory, '.fabric');
  await fs.mkdir(path.join(cache, 'processedMods', 'nested'), { recursive: true });
  await fs.writeFile(path.join(cache, 'processedMods', 'nested', 'generated.jar'), 'generated');
  assert.equal(await removeManagedFabricRuntimeCache(managedRoot, { directory }), true);
  await assert.rejects(() => fs.lstat(cache), (error) => error?.code === 'ENOENT');

  const tombstone = path.join(directory, '.delete-.fabric');
  await fs.mkdir(tombstone, { recursive: true });
  await fs.writeFile(path.join(tombstone, 'interrupted.jar'), 'interrupted');
  assert.equal(await removeManagedFabricRuntimeCache(managedRoot, { directory }), true);
  await assert.rejects(() => fs.lstat(tombstone), (error) => error?.code === 'ENOENT');
  assert.equal(await removeManagedFabricRuntimeCache(managedRoot, { directory }), false);
});

function serverCompatibilityBinding(worldDataVersion = WORLD_DATA_VERSION) {
  return {
    worldDataVersion,
    minecraftServerArtifact: {
      minecraftVersion: '26.2', worldDataVersion,
      relativePath: 'versions/26.2/server-26.2.jar', size: 1024,
      sha1: 'a'.repeat(40), sha256: 'b'.repeat(64),
    },
  };
}

async function renameCrashImage(source, destination) {
  const retryable = new Set(['EPERM', 'EBUSY']);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await fs.rename(source, destination);
      return;
    } catch (error) {
      if (!retryable.has(error?.code) || attempt === 9) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(100, 10 * (attempt + 1))));
    }
  }
}

class MemoryStore {
  constructor(record) { this.record = structuredClone(record); }
  async get(id) { return id === this.record.id ? structuredClone(this.record) : null; }
  async list() { return [structuredClone(this.record)]; }
  async update(id, patch) {
    if (id !== this.record.id) throw new Error('not found');
    this.record = { ...this.record, ...structuredClone(patch) };
    return structuredClone(this.record);
  }
}

function uuid(index) {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

function nbtString(value) {
  const bytes = Buffer.from(value, 'utf8');
  const length = Buffer.alloc(2);
  length.writeUInt16BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

function modifiedUtf8String(value) {
  const encoded = [];
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0x0001 && unit <= 0x007f) encoded.push(unit);
    else if (unit <= 0x07ff) encoded.push(0xc0 | (unit >> 6), 0x80 | (unit & 0x3f));
    else encoded.push(0xe0 | (unit >> 12), 0x80 | ((unit >> 6) & 0x3f), 0x80 | (unit & 0x3f));
  }
  const bytes = Buffer.from(encoded); const length = Buffer.alloc(2); length.writeUInt16BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

function validLevelDat({ dataVersion = 4440, levelName = 'Family Realm' } = {}) {
  const version = Buffer.alloc(4);
  version.writeInt32BE(dataVersion);
  const root = Buffer.concat([
    Buffer.from([10]), nbtString(''),
    Buffer.from([10]), nbtString('Data'),
    Buffer.from([3]), nbtString('DataVersion'), version,
    Buffer.from([8]), nbtString('LevelName'), nbtString(levelName),
    Buffer.from([0]),
    Buffer.from([0]),
  ]);
  return zlib.gzipSync(root);
}

function duplicateDataVersionLevelDat() {
  const first = Buffer.alloc(4);
  const second = Buffer.alloc(4);
  first.writeInt32BE(4440);
  second.writeInt32BE(4441);
  return zlib.gzipSync(Buffer.concat([
    Buffer.from([10]), nbtString(''),
    Buffer.from([10]), nbtString('Data'),
    Buffer.from([3]), nbtString('DataVersion'), first,
    Buffer.from([3]), nbtString('DataVersion'), second,
    Buffer.from([8]), nbtString('LevelName'), nbtString('Ambiguous Realm'),
    Buffer.from([0, 0]),
  ]));
}

function modifiedUtfLevelDat() {
  const version = Buffer.alloc(4); version.writeInt32BE(4440);
  return zlib.gzipSync(Buffer.concat([
    Buffer.from([10]), nbtString(''),
    Buffer.from([10]), nbtString('Data'),
    Buffer.from([3]), nbtString('DataVersion'), version,
    Buffer.from([8]), nbtString('LevelName'), modifiedUtf8String('Realm\0😀'),
    Buffer.from([0, 0]),
  ]));
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(algorithm, bytes) {
  return crypto.createHash(algorithm).update(bytes).digest('hex');
}

function signRecord(key, value) {
  const unsigned = structuredClone(value);
  delete unsigned.mac;
  const mac = crypto.createHmac('sha256', key).update(canonical(unsigned)).digest('hex');
  return { ...unsigned, mac };
}

async function treeSnapshot(root) {
  try { await fs.lstat(root); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
  const snapshot = [];
  const visit = async (directory, relativeRoot = '') => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en-US'));
    for (const entry of entries) {
      const relative = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        snapshot.push(['directory', relative]);
        await visit(target, relative);
      } else if (entry.isFile() && !entry.isSymbolicLink()) {
        const bytes = await fs.readFile(target);
        snapshot.push(['file', relative, bytes.length, digest('sha256', bytes)]);
      } else snapshot.push(['unsafe', relative]);
    }
  };
  await visit(root);
  return snapshot;
}

async function writeUnfinishedMarker(value, suffix, requestIndex) {
  const key = await fs.readFile(path.join(value.managedRoot, 'state', 'family-worlds', 'hmac.key'));
  const signedCatalog = JSON.parse(await fs.readFile(path.join(
    value.directory, '.mastermind', 'worlds', 'catalog.json',
  ), 'utf8'));
  const catalog = structuredClone(signedCatalog); delete catalog.mac;
  const transactionRef = `worldtx-${suffix.repeat(64)}`;
  const marker = signRecord(key, {
    schemaVersion: 1,
    instanceId: FAMILY_ID,
    transactionRef,
    requestId: uuid(requestIndex),
    planId: `worldplan-${suffix.repeat(64)}`,
    planDigest: suffix.repeat(64),
    operation: 'create',
    phase: 'intent',
    sourceWorldRef: null,
    targetWorldRef: `world-${suffix.repeat(64)}`,
    rescueBackupId: null,
    beforeCatalog: catalog,
    afterCatalog: null,
    expectedTargetDigest: null,
    expectedTargetBytes: null,
    createdAt: '2026-08-13T12:00:00.000Z',
    updatedAt: '2026-08-13T12:00:00.000Z',
    failureCode: null,
  });
  await fs.writeFile(path.join(
    value.directory, '.mastermind', 'worlds', 'transactions', `${transactionRef}.json`,
  ), `${JSON.stringify(marker)}\n`);
  return transactionRef;
}

async function fixture(t, options = {}) {
  const managedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-worlds-'));
  t.after(() => fs.rm(managedRoot, { recursive: true, force: true }));
  const directory = path.join(managedRoot, 'servers', FAMILY_ID);
  const activeRoot = path.join(directory, 'world');
  await fs.mkdir(path.join(activeRoot, 'region'), { recursive: true });
  await fs.writeFile(path.join(directory, 'server.properties'), options.properties ?? 'level-name=world\nserver-port=25565\n');
  if (options.levelDat !== false) {
    await fs.writeFile(path.join(activeRoot, 'level.dat'), options.levelDat ?? validLevelDat(options.levelMetadata));
  }
  await fs.writeFile(path.join(activeRoot, 'identity.txt'), options.identity ?? 'original-world');
  await fs.writeFile(path.join(activeRoot, 'region', 'r.0.0.mca'), 'region-data');

  const timestamp = '2026-08-13T12:00:00.000Z';
  const store = new MemoryStore({
    id: FAMILY_ID,
    displayName: 'Family Server',
    projectId: FAMILY_ID,
    kind: 'server',
    directory,
    status: 'stopped',
    pid: null,
    managedProcess: null,
    provisioningStatus: 'ready',
    minecraftVersion: '26.2',
    ...(options.legacyMetadata ? {} : serverCompatibilityBinding(options.worldDataVersion)),
    loader: 'fabric',
    loaderVersion: '0.19.3',
    installerVersion: '1.1.2',
    requiredJavaMajor: 25,
    javaPort: 25565,
    bedrockPort: 19132,
    artifacts: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const state = {
    nowMs: Date.parse(timestamp),
    randomSequence: 0,
    lockDepth: 0,
    quiescentCalls: 0,
    rescueCalls: 0,
    lifecycleMutationCalls: 0,
    events: [],
    onPhase: null,
    onRescue: null,
    onLifecycleMutation: null,
    lockQueue: Promise.resolve(),
    stackBinding: {
      generation: '1'.repeat(64),
      inventoryDigest: '2'.repeat(64),
    },
  };
  state.withInstanceLock = async (instanceId, operation) => {
    assert.equal(instanceId, FAMILY_ID);
    let release;
    const previous = state.lockQueue;
    state.lockQueue = new Promise((resolve) => { release = resolve; });
    await previous;
    state.lockDepth += 1;
    try { return await operation(); } finally { state.lockDepth -= 1; release(); }
  };

  const makeManager = (overrides = {}) => new FamilyWorldManager(managedRoot, store, {
    withInstanceLock: state.withInstanceLock,
    assertQuiescentWithinInstanceLock: async (instanceId) => {
      assert.equal(state.lockDepth, 1, 'quiescence must be checked under the exact instance lock');
      state.quiescentCalls += 1;
      const instance = await store.get(instanceId);
      if (instance.status !== 'stopped' || instance.pid !== null || instance.managedProcess != null) {
        throw Object.assign(new Error('not quiescent'), { code: 'WORLD_SERVER_NOT_QUIESCENT', statusCode: 409 });
      }
      return instance;
    },
    assertCompanionInactiveWithinInstanceLock: async () => {
      assert.equal(state.lockDepth, 1, 'companion state must be checked under the exact instance lock');
      return true;
    },
    createRescueWithinInstanceLock: async (instanceId) => {
      assert.equal(instanceId, FAMILY_ID);
      assert.equal(state.lockDepth, 1, 'rescue must be created under the exact instance lock');
      state.rescueCalls += 1;
      state.events.push('rescue');
      await state.onRescue?.();
      return { backupId: BACKUP_ID, integrity: 'verified' };
    },
    verifyInstall: async (instance) => ({
      ok: true, minecraftVersion: instance.minecraftVersion,
      worldDataVersion: instance.worldDataVersion,
    }),
    currentStackBindingWithinInstanceLock: async () => structuredClone(state.stackBinding),
    assertLifecycleMutationAllowedWithinInstanceLock: async (instanceId) => {
      assert.equal(instanceId, FAMILY_ID);
      assert.equal(state.lockDepth, 1, 'the external lifecycle interlock must run under the exact instance lock');
      state.lifecycleMutationCalls += 1;
      await state.onLifecycleMutation?.(instanceId);
      return true;
    },
    filesystemTreeVerifier: async () => ({ ok: true, checked: false }),
    directoryGuard: async (directory) => ({
      assertHeld() {},
      async release() {},
      async rename(destination) { await fs.rename(directory, destination); },
      async delete() { await fs.rmdir(directory); },
    }),
    fileGuard: async (file) => ({
      assertHeld() {},
      async release() {},
      async delete() { await fs.unlink(file); },
      async replace(destination) { await fs.rename(file, destination); },
    }),
    filesystemEntryVerifier: async () => ({ ok: true, checked: false }),
    now: () => new Date(state.nowMs).toISOString(),
    randomBytes: (size) => Buffer.alloc(size, ++state.randomSequence),
    onPhase: async (marker) => {
      state.events.push(`phase:${marker.phase}`);
      await state.onPhase?.(marker);
    },
    ...overrides,
  });

  let manager = makeManager();
  if (options.initialize !== false) await manager.initialize();
  return {
    activeRoot,
    directory,
    managedRoot,
    manager,
    makeManager,
    state,
    store,
    async restart(overrides = {}) {
      manager = makeManager(overrides);
      await manager.initialize();
      this.manager = manager;
      return manager;
    },
  };
}

async function executePlan(manager, plan, confirmation = plan.requiredConfirmation) {
  return manager.execute(FAMILY_ID, {
    requestId: plan.requestId,
    planId: plan.planId,
    planDigest: plan.planDigest,
    confirmation,
  });
}

async function planCreate(manager, index, displayLabel) {
  return manager.createPlan(FAMILY_ID, { requestId: uuid(index), operation: 'create', displayLabel });
}

async function planClone(manager, index, sourceWorldRef, displayLabel) {
  return manager.createPlan(FAMILY_ID, {
    requestId: uuid(index), operation: 'clone', targetWorldRef: sourceWorldRef, displayLabel,
  });
}

test('bootstraps an authenticated family-only inventory from bounded level.dat metadata', async (t) => {
  const value = await fixture(t, { levelMetadata: { dataVersion: 4440, levelName: 'Original Realm' } });
  const inventory = await value.manager.inventory(FAMILY_ID);
  assert.match(inventory.generation, /^[a-f0-9]{64}$/);
  assert.match(inventory.inventoryDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(inventory.recovery, { required: false, state: null, transactionRef: null });
  assert.equal(inventory.worlds.length, 1);
  assert.deepEqual(inventory.worlds[0], {
    ...inventory.worlds[0],
    displayLabel: 'Original Realm',
    state: 'active',
    pendingGeneration: false,
    minecraftVersion: '26.2',
    dataVersion: 4440,
    integrity: 'verified',
  });
  assert.equal(inventory.activeWorldRef, inventory.worlds[0].worldRef);
  assert.deepEqual(inventory.limits, {
    maxWorlds: 12,
    maxWorldBytes: 17_179_869_184,
    maxTotalBytes: 68_719_476_736,
  });
  assert.equal(JSON.stringify(inventory).includes(value.managedRoot), false);
  assert.equal(await fs.stat(path.join(value.managedRoot, 'state', 'family-worlds', 'hmac.key')).then((stat) => stat.size), 32);
  await assert.rejects(
    () => fs.lstat(path.join(value.directory, '.mastermind', 'worlds', 'hmac.key')),
    (error) => error.code === 'ENOENT',
  );
  await assert.rejects(() => value.manager.inventory('some-other-server'), (error) => error.code === 'WORLD_INVALID_INSTANCE');
});

test('accepts strict Java modified UTF-8 strings in otherwise valid NBT', async (t) => {
  const value = await fixture(t, { levelDat: modifiedUtfLevelDat() });
  const inventory = await value.manager.inventory(FAMILY_ID);
  assert.equal(inventory.worlds[0].dataVersion, 4440);
  assert.equal(inventory.worlds[0].displayLabel, 'Family World', 'unsafe embedded NUL is not reused as a public label');
});

test('a restarted running server cannot bootstrap or mutate missing private world state', async (t) => {
  const value = await fixture(t, { initialize: false });
  await value.store.update(FAMILY_ID, {
    status: 'running', pid: 4242,
    managedProcess: { pid: 4242, launchId: 'running-world-bootstrap-test' },
  });
  assert.deepEqual(await value.manager.initialize(), [{ instanceId: FAMILY_ID, action: 'deferred-running' }]);
  await assert.rejects(
    () => value.manager.inventory(),
    (error) => error.code === 'WORLD_SERVER_NOT_QUIESCENT',
  );
  await assert.rejects(
    () => fs.access(path.join(value.directory, '.mastermind')),
    (error) => error.code === 'ENOENT',
  );
});

test('startup re-authenticates stopped active-world gameplay changes after journal recovery', async (t) => {
  const value = await fixture(t);
  const catalogFile = path.join(value.directory, '.mastermind', 'worlds', 'catalog.json');
  const before = JSON.parse(await fs.readFile(catalogFile, 'utf8'));

  await fs.writeFile(path.join(value.activeRoot, 'identity.txt'), 'ordinary-gameplay-save');
  await fs.writeFile(path.join(value.activeRoot, 'region', 'r.0.1.mca'), 'new-region-data');

  const restarted = value.makeManager();
  assert.deepEqual(await restarted.initialize(), []);
  const after = JSON.parse(await fs.readFile(catalogFile, 'utf8'));
  assert.equal(after.revision, before.revision + 1);
  assert.notEqual(after.worlds[0].treeDigest, before.worlds[0].treeDigest);
  assert.equal((await restarted.inventory()).worlds[0].state, 'active');
});

test('recovery preflight is read-only and does not bootstrap instance world state', async (t) => {
  const value = await fixture(t, { initialize: false });
  const instanceEntriesBefore = await fs.readdir(value.directory);
  await value.manager.prepareRestoreValidation();
  assert.deepEqual(await value.manager.preflightRecoveryEvidence(), { domain: 'world', instances: [] });
  assert.deepEqual(await fs.readdir(value.directory), instanceEntriesBefore);
  await assert.rejects(
    () => fs.access(path.join(value.directory, '.mastermind')),
    (error) => error.code === 'ENOENT',
  );
});

test('recovery preflight returns only bounded authenticated unfinished transaction evidence', async (t) => {
  const value = await fixture(t);
  const transactionRef = await writeUnfinishedMarker(value, 'a', 601);
  const worldsRoot = path.join(value.directory, '.mastermind', 'worlds');
  const before = await treeSnapshot(worldsRoot);
  const preflight = value.makeManager();
  await preflight.prepareRestoreValidation();
  assert.deepEqual(await preflight.preflightRecoveryEvidence(), {
    domain: 'world', instances: [{ instanceId: FAMILY_ID, transactionRef }],
  });
  assert.deepEqual(await treeSnapshot(worldsRoot), before, 'preflight must not repair or rewrite recovery evidence');
});

test('recovery preflight rejects invalid or multiple marker and operation namespaces without mutation', async (t) => {
  await t.test('invalid operation namespace', async (st) => {
    const value = await fixture(st);
    const operations = path.join(value.directory, '.mastermind', 'worlds', 'operations');
    await fs.writeFile(path.join(operations, '.tmp-untrusted'), 'not a journal record');
    const worldsRoot = path.join(value.directory, '.mastermind', 'worlds');
    const before = await treeSnapshot(worldsRoot);
    const preflight = value.makeManager(); await preflight.prepareRestoreValidation();
    await assert.rejects(() => preflight.preflightRecoveryEvidence(), (error) => error.code === 'WORLD_STATE_UNAVAILABLE');
    assert.deepEqual(await treeSnapshot(worldsRoot), before);
  });

  await t.test('multiple unfinished authenticated markers', async (st) => {
    const value = await fixture(st);
    await writeUnfinishedMarker(value, 'b', 602);
    await writeUnfinishedMarker(value, 'c', 603);
    const worldsRoot = path.join(value.directory, '.mastermind', 'worlds');
    const before = await treeSnapshot(worldsRoot);
    const preflight = value.makeManager(); await preflight.prepareRestoreValidation();
    await assert.rejects(() => preflight.preflightRecoveryEvidence(), (error) => error.code === 'WORLD_STATE_UNAVAILABLE');
    assert.deepEqual(await treeSnapshot(worldsRoot), before);
  });
});

test('the required external lifecycle interlock fails plan and action paths before world-state mutation', async (t) => {
  const value = await fixture(t);
  assert.throws(
    () => value.makeManager({ assertLifecycleMutationAllowedWithinInstanceLock: undefined }),
    /assertLifecycleMutationAllowedWithinInstanceLock is required/,
  );
  const worldsRoot = path.join(value.directory, '.mastermind', 'worlds');
  const blocked = Object.assign(new Error('unfinished update recovery'), {
    code: 'UPDATE_RECOVERY_REQUIRED', statusCode: 409,
  });
  value.state.onLifecycleMutation = async () => { throw blocked; };
  const beforePlan = await treeSnapshot(worldsRoot);
  const quiescentBeforePlan = value.state.quiescentCalls;
  await assert.rejects(() => planCreate(value.manager, 604, 'Blocked Plan'), (error) => error === blocked);
  assert.deepEqual(await treeSnapshot(worldsRoot), beforePlan);
  assert.equal(value.state.quiescentCalls, quiescentBeforePlan, 'the lifecycle fence must precede quiescent world preparation');

  value.state.onLifecycleMutation = null;
  const plan = await planCreate(value.manager, 605, 'Blocked Action');
  value.state.onLifecycleMutation = async () => { throw blocked; };
  const beforeAction = await treeSnapshot(worldsRoot);
  const quiescentBeforeAction = value.state.quiescentCalls;
  await assert.rejects(() => executePlan(value.manager, plan), (error) => error === blocked);
  assert.deepEqual(await treeSnapshot(worldsRoot), beforeAction);
  assert.equal(value.state.quiescentCalls, quiescentBeforeAction, 'the lifecycle fence must precede action recovery or mutation');
});

test('parses Java Properties escapes and continuations but rejects duplicate or noncanonical effective level-name values', async (t) => {
  await t.test('escaped canonical key and continued canonical value are accepted', async (st) => {
    const value = await fixture(st, {
      initialize: false,
      properties: 'level\\u002dname = wo\\\n        rld\nserver-port=25565\n',
    });
    await value.manager.initialize();
    assert.equal((await value.manager.inventory()).worlds.length, 1);
  });

  for (const [name, properties] of [
    ['duplicate definitions', 'level-name=world\nlevel-name=world\n'],
    ['escaped duplicate definitions', 'level\\u002dname=world\nlevel-name=world\n'],
    ['path-like value', 'level-name=../victim\n'],
    ['continued noncanonical value', 'level-name=world\\\n  -evil\n'],
    ['case-changed key', 'Level-Name=world\n'],
  ]) {
    await t.test(name, async (st) => {
      const value = await fixture(st, { initialize: false, properties });
      await assert.rejects(() => value.manager.initialize(), (error) => error.code === 'WORLD_INTEGRITY_FAILED');
    });
  }
});

test('create, clone, rename, archive, and compatible archived switch preserve the catalog state machine', async (t) => {
  const value = await fixture(t);
  const initial = await value.manager.inventory();
  const original = initial.worlds[0];

  const create = await planCreate(value.manager, 1, 'Blank Adventure');
  assert.equal(create.source, null);
  assert.equal(create.target.state, 'inactive');
  assert.deepEqual(create.safety, { requiresStopped: true, rescueBackupRequired: false, destructive: false });
  const created = await executePlan(value.manager, create);
  assert.equal(created.state, 'committed');
  assert.equal(created.application, 'verified');
  assert.equal(created.result.pendingGeneration, true);
  const blankRef = created.result.worldRef;
  assert.deepEqual(
    await fs.readdir(path.join(value.directory, '.mastermind', 'worlds', 'storage', blankRef)),
    [],
    'a pending blank world must not forge level.dat or any generated game state',
  );

  const clone = await planClone(value.manager, 2, original.worldRef, 'Original Copy');
  assert.deepEqual(clone.source, { worldRef: original.worldRef, displayLabel: original.displayLabel, state: 'active' });
  const cloned = await executePlan(value.manager, clone);
  assert.equal(cloned.state, 'committed');
  assert.equal(cloned.result.pendingGeneration, false);
  const cloneRef = cloned.result.worldRef;

  const rename = await value.manager.createPlan(FAMILY_ID, {
    requestId: uuid(3), operation: 'rename', targetWorldRef: cloneRef, displayLabel: 'Archived Copy',
  });
  assert.equal((await executePlan(value.manager, rename)).result.displayLabel, 'Archived Copy');

  const archive = await value.manager.createPlan(FAMILY_ID, {
    requestId: uuid(4), operation: 'archive', targetWorldRef: cloneRef,
  });
  assert.equal((await executePlan(value.manager, archive)).result.state, 'archived');

  value.state.events.length = 0;
  const transactionsBeforeRescue = await fs.readdir(path.join(value.directory, '.mastermind', 'worlds', 'transactions'));
  value.state.onRescue = async () => {
    assert.equal(await fs.readFile(path.join(value.activeRoot, 'identity.txt'), 'utf8'), 'original-world');
    const admitted = (await fs.readdir(path.join(value.directory, '.mastermind', 'worlds', 'transactions')))
      .filter((name) => !transactionsBeforeRescue.includes(name));
    assert.equal(admitted.length, 1, 'the action must be durably admitted before rescue starts');
    assert.equal(JSON.parse(await fs.readFile(path.join(
      value.directory, '.mastermind', 'worlds', 'transactions', admitted[0],
    ), 'utf8')).phase, 'admitted');
    assert.equal(await value.manager.assertMutationAllowedWithinInstanceLock(FAMILY_ID), true,
      'the backup rescue may enter only through the exact owned admission capability');
    assert.equal(await value.manager.operation(FAMILY_ID, switchPlan.requestId, { allowMissing: true }), null,
      'the recursive backup interlock must not reconcile its owning switch as rejected');
  };
  const switchPlan = await value.manager.createPlan(FAMILY_ID, {
    requestId: uuid(5), operation: 'switch', targetWorldRef: cloneRef,
  });
  assert.equal(switchPlan.safety.rescueBackupRequired, true);
  assert.deepEqual(switchPlan.source, { worldRef: original.worldRef, displayLabel: original.displayLabel, state: 'active' });
  const switched = await executePlan(value.manager, switchPlan);
  assert.equal(switched.state, 'committed', JSON.stringify(switched));
  assert.equal(switched.result.activeWorldRef, cloneRef);
  assert.equal(switched.result.previousWorldRef, original.worldRef);
  assert.equal(switched.result.rescueVerified, true);
  assert.equal(JSON.stringify(switched).includes(BACKUP_ID), false, 'the private rescue backup id must never escape');
  assert.equal(value.state.events[0], 'rescue', 'rescue verification must precede every transaction phase and rename');

  const finalInventory = await value.manager.inventory();
  assert.equal(finalInventory.activeWorldRef, cloneRef);
  assert.equal(finalInventory.worlds.find((world) => world.worldRef === cloneRef).state, 'active');
  assert.equal(finalInventory.worlds.find((world) => world.worldRef === original.worldRef).state, 'inactive');
  assert.equal(finalInventory.worlds.find((world) => world.worldRef === blankRef).integrity, 'pending-generation');
  assert.equal(await fs.readFile(path.join(value.directory, '.mastermind', 'worlds', 'storage', original.worldRef, 'identity.txt'), 'utf8'), 'original-world');
});

test('switch rescue failure is durably rejected from its pre-rescue admission without a rename', async (t) => {
  const value = await fixture(t);
  const original = (await value.manager.inventory()).activeWorldRef;
  const clone = await executePlan(value.manager, await planClone(value.manager, 370, original, 'Rescue Failure Target'));
  const manager = await value.restart({
    createRescueWithinInstanceLock: async () => { throw new Error('simulated rescue failure'); },
  });
  const transactions = path.join(value.directory, '.mastermind', 'worlds', 'transactions');
  const before = await fs.readdir(transactions);
  const plan = await manager.createPlan(FAMILY_ID, {
    requestId: uuid(371), operation: 'switch', targetWorldRef: clone.result.worldRef,
  });
  const result = await executePlan(manager, plan);
  assert.equal(result.state, 'rejected-before-mutation');
  assert.equal(result.failureCode, 'WORLD_SNAPSHOT_FAILED');
  const after = await fs.readdir(transactions);
  assert.equal(after.length, before.length + 1);
  assert.equal(JSON.parse(await fs.readFile(path.join(transactions, after.find((name) => !before.includes(name))), 'utf8')).phase, 'rejected-before-mutation');
  assert.equal((await manager.inventory()).activeWorldRef, original);
});

test('a crash during switch rescue recovers the admitted request to an exact terminal GET', async (t) => {
  const value = await fixture(t);
  const original = (await value.manager.inventory()).activeWorldRef;
  const clone = await executePlan(value.manager, await planClone(value.manager, 374, original, 'Admission Crash Target'));
  const crashImage = path.join(value.managedRoot, 'admission-crash-image');
  value.state.onRescue = async () => {
    await fs.cp(value.directory, crashImage, { recursive: true, errorOnExist: true });
    throw new Error('simulated process loss during rescue');
  };
  const plan = await value.manager.createPlan(FAMILY_ID, {
    requestId: uuid(375), operation: 'switch', targetWorldRef: clone.result.worldRef,
  });
  await executePlan(value.manager, plan);
  value.state.onRescue = null;
  await fs.rm(value.directory, { recursive: true, force: false });
  await renameCrashImage(crashImage, value.directory);
  const restarted = await value.restart();
  const operation = await restarted.operation(FAMILY_ID, plan.requestId);
  assert.equal(operation.state, 'rejected-before-mutation');
  assert.equal(operation.failureCode, 'WORLD_SNAPSHOT_FAILED');
  assert.equal((await restarted.inventory()).activeWorldRef, original);
});

test('switch revalidates quiescence and inventory after rescue before writing intent', async (t) => {
  const value = await fixture(t);
  const original = (await value.manager.inventory()).activeWorldRef;
  const clone = await executePlan(value.manager, await planClone(value.manager, 372, original, 'Post-Rescue Fence Target'));
  const transactions = path.join(value.directory, '.mastermind', 'worlds', 'transactions');
  const before = await fs.readdir(transactions);
  value.state.onRescue = async () => {
    await fs.writeFile(path.join(value.activeRoot, 'identity.txt'), 'changed-during-rescue');
  };
  const plan = await value.manager.createPlan(FAMILY_ID, {
    requestId: uuid(373), operation: 'switch', targetWorldRef: clone.result.worldRef,
  });
  const result = await executePlan(value.manager, plan);
  assert.equal(result.state, 'rejected-before-mutation');
  assert.equal(result.failureCode, 'WORLD_PLAN_STALE');
  const after = await fs.readdir(transactions);
  assert.equal(after.length, before.length + 1);
  assert.equal(JSON.parse(await fs.readFile(path.join(transactions, after.find((name) => !before.includes(name))), 'utf8')).phase, 'rejected-before-mutation');
  assert.equal((await value.manager.inventory()).activeWorldRef, original);
  assert.equal(await fs.readFile(path.join(value.activeRoot, 'identity.txt'), 'utf8'), 'changed-during-rescue');
});

test('a blank world becomes generated only after structurally valid level.dat is observed', async (t) => {
  const value = await fixture(t);
  const created = await executePlan(value.manager, await planCreate(value.manager, 6, 'Generate Me'));
  const worldRef = created.result.worldRef;
  const switchPlan = await value.manager.createPlan(FAMILY_ID, {
    requestId: uuid(7), operation: 'switch', targetWorldRef: worldRef,
  });
  assert.equal((await executePlan(value.manager, switchPlan)).state, 'committed');
  await assert.rejects(
    () => value.state.withInstanceLock(FAMILY_ID, () => value.manager.reconcileGeneratedWorldWithinInstanceLock(FAMILY_ID)),
    (error) => error.code === 'WORLD_INTEGRITY_FAILED',
  );
  assert.equal((await value.manager.inventory()).worlds.find((world) => world.worldRef === worldRef).pendingGeneration, true);
  await fs.writeFile(path.join(value.activeRoot, 'level.dat'), validLevelDat({ dataVersion: 4550, levelName: 'Generated World' }));
  assert.equal(await value.state.withInstanceLock(
    FAMILY_ID, () => value.manager.reconcileGeneratedWorldWithinInstanceLock(FAMILY_ID),
  ), true);
  const reconciled = (await value.manager.inventory()).worlds.find((world) => world.worldRef === worldRef);
  assert.equal(reconciled.pendingGeneration, false);
  assert.equal(reconciled.dataVersion, 4550);
  assert.equal(reconciled.integrity, 'verified');
});

test('durable request idempotency returns the same plan and operation and rejects semantic conflicts', async (t) => {
  const value = await fixture(t);
  const request = { requestId: uuid(10), operation: 'create', displayLabel: 'Retry Safe' };
  const firstPlan = await value.manager.createPlan(FAMILY_ID, request);
  assert.deepEqual(await value.manager.createPlan(FAMILY_ID, structuredClone(request)), firstPlan);
  await assert.rejects(
    () => value.manager.createPlan(FAMILY_ID, { ...request, displayLabel: 'Conflicting Retry' }),
    (error) => error.code === 'WORLD_REQUEST_ID_CONFLICT',
  );

  const first = await executePlan(value.manager, firstPlan);
  assert.equal(first.state, 'committed');
  assert.deepEqual(await executePlan(value.manager, firstPlan), first);
  assert.deepEqual(await value.manager.operation(FAMILY_ID, request.requestId), first);
  await assert.rejects(
    () => executePlan(value.manager, firstPlan, 'CREATE A WORLD'),
    (error) => error.code === 'WORLD_REQUEST_ID_CONFLICT',
  );
  assert.deepEqual(await value.manager.createPlan(FAMILY_ID, request), firstPlan);
});

test('concurrent duplicate execution cannot correlate one requestId to two action approvals', async (t) => {
  const value = await fixture(t);
  const plan = await planCreate(value.manager, 15, 'Concurrent Retry');
  const good = {
    requestId: plan.requestId,
    planId: plan.planId,
    planDigest: plan.planDigest,
    confirmation: plan.requiredConfirmation,
  };
  const conflicting = { ...good, planDigest: 'f'.repeat(64) };
  const outcomes = await Promise.allSettled([
    value.manager.execute(FAMILY_ID, good),
    value.manager.execute(FAMILY_ID, conflicting),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
  const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
  assert.ok(['WORLD_PLAN_STALE', 'WORLD_REQUEST_ID_CONFLICT'].includes(rejected.reason.code));
  assert.equal((await value.manager.inventory()).worlds.filter((world) => world.displayLabel === 'Concurrent Retry').length, 1);
});

test('labels reject separator confusables after NFKC normalization', async (t) => {
  const value = await fixture(t);
  for (const [index, displayLabel] of ['world／victim', 'world：victim'].entries()) {
    await assert.rejects(
      () => planCreate(value.manager, 30 + index, displayLabel),
      (error) => error.code === 'WORLD_INVALID_LABEL',
    );
  }
});

test('expired and inventory-stale approvals are durably rejected before mutation', async (t) => {
  const value = await fixture(t);
  const expiredPlan = await planCreate(value.manager, 20, 'Expired');
  value.state.nowMs = Date.parse(expiredPlan.expiresAt) + 1;
  const expired = await executePlan(value.manager, expiredPlan);
  assert.equal(expired.state, 'rejected-before-mutation');
  assert.equal(expired.application, 'not-applied');
  assert.equal(expired.failureCode, 'WORLD_PLAN_STALE');
  assert.equal((await value.manager.inventory()).worlds.length, 1);

  value.state.nowMs += 1;
  const stalePlan = await planCreate(value.manager, 21, 'Stale');
  const intervening = await planCreate(value.manager, 22, 'Intervening');
  await executePlan(value.manager, intervening);
  const stale = await executePlan(value.manager, stalePlan);
  assert.equal(stale.state, 'rejected-before-mutation');
  assert.equal(stale.failureCode, 'WORLD_PLAN_STALE');
  assert.equal((await value.manager.inventory()).worlds.some((world) => world.displayLabel === 'Stale'), false);
});

test('enforces the twelve-world catalog quota before allocating a thirteenth world', async (t) => {
  const value = await fixture(t);
  for (let index = 0; index < 11; index += 1) {
    const plan = await planCreate(value.manager, 100 + index, `World ${index + 2}`);
    assert.equal((await executePlan(value.manager, plan)).state, 'committed');
  }
  assert.equal((await value.manager.inventory()).worlds.length, 12);
  await assert.rejects(
    () => planCreate(value.manager, 111, 'World 13'),
    (error) => error.code === 'WORLD_QUOTA_EXCEEDED' && error.statusCode === 507,
  );
});

test('rejects bounded-gzip expansion bombs and over-limit sparse world files before hashing content', async (t) => {
  await t.test('gzip expansion limit', async (st) => {
    const bomb = zlib.gzipSync(Buffer.alloc(32 * 1024 * 1024 + 1));
    const value = await fixture(st, { initialize: false, levelDat: bomb });
    await assert.rejects(() => value.manager.initialize(), (error) => error.code === 'WORLD_INTEGRITY_FAILED');
  });

  await t.test('duplicate DataVersion metadata is ambiguous', async (st) => {
    const value = await fixture(st, { initialize: false, levelDat: duplicateDataVersionLevelDat() });
    await assert.rejects(() => value.manager.initialize(), (error) => error.code === 'WORLD_INTEGRITY_FAILED');
  });

  await t.test('per-world byte limit', async (st) => {
    const value = await fixture(st, { initialize: false });
    const huge = path.join(value.activeRoot, 'huge.bin');
    try {
      await fs.writeFile(huge, '');
      await fs.truncate(huge, 16 * 1024 * 1024 * 1024 + 1);
    } catch (error) {
      st.skip(`sparse files are unavailable on this filesystem: ${error.code ?? error.message}`);
      return;
    }
    await assert.rejects(() => value.manager.initialize(), (error) => error.code === 'WORLD_QUOTA_EXCEEDED');
  });
});

test('session.lock cannot smuggle links or hard-linked victim data through clone', async (t) => {
  await t.test('modern snowman marker is accepted', async (st) => {
    const value = await fixture(st, { initialize: false });
    await fs.writeFile(path.join(value.activeRoot, 'session.lock'), Buffer.from([0xe2, 0x98, 0x83]));
    assert.deepEqual(await value.manager.initialize(), []);
  });

  await t.test('arbitrary three-byte marker is rejected', async (st) => {
    const value = await fixture(st, { initialize: false });
    await fs.writeFile(path.join(value.activeRoot, 'session.lock'), Buffer.from('bad'));
    await assert.rejects(
      () => value.manager.initialize(),
      (error) => error.code === 'WORLD_INTEGRITY_FAILED',
    );
  });

  await t.test('oversized regular file', async (st) => {
    const value = await fixture(st);
    await fs.writeFile(path.join(value.activeRoot, 'session.lock'), Buffer.alloc(9));
    await assert.rejects(
      () => value.manager.inventory(),
      (error) => error.code === 'WORLD_INTEGRITY_FAILED',
    );
  });

  await t.test('symbolic link', async (st) => {
    const value = await fixture(st);
    const victim = path.join(value.managedRoot, 'victim.txt');
    await fs.writeFile(victim, 'do-not-copy');
    const lock = path.join(value.activeRoot, 'session.lock');
    try { await fs.symlink(victim, lock, 'file'); } catch (error) {
      st.skip(`file symlinks are unavailable: ${error.code ?? error.message}`);
      return;
    }
    const source = (await value.manager.inventory()).activeWorldRef;
    const result = await executePlan(value.manager, await planClone(value.manager, 350, source, 'No Link Clone'));
    assert.equal(result.state, 'committed');
    const destination = path.join(value.directory, '.mastermind', 'worlds', 'storage', result.result.worldRef);
    await assert.rejects(() => fs.lstat(path.join(destination, 'session.lock')), (error) => error.code === 'ENOENT');
    assert.equal(await fs.readFile(victim, 'utf8'), 'do-not-copy');
  });

  await t.test('hard link', async (st) => {
    const value = await fixture(st);
    const victim = path.join(value.managedRoot, 'victim.txt');
    await fs.writeFile(victim, 'do-not-copy');
    const lock = path.join(value.activeRoot, 'session.lock');
    try { await fs.link(victim, lock); } catch (error) {
      st.skip(`hard links are unavailable: ${error.code ?? error.message}`);
      return;
    }
    await assert.rejects(
      () => value.manager.inventory(),
      (error) => error.code === 'WORLD_INTEGRITY_FAILED',
    );
    assert.equal(await fs.readFile(victim, 'utf8'), 'do-not-copy');
  });
});

test('unexpected atomic-write remnants fail startup closed without touching world data', async (t) => {
  const value = await fixture(t);
  const operations = path.join(value.directory, '.mastermind', 'worlds', 'operations');
  await fs.writeFile(path.join(operations, '.tmp-attacker-remnant'), 'partial-state');
  await assert.rejects(() => value.restart(), (error) => error.code === 'WORLD_RECOVERY_REQUIRED');
  assert.equal(await fs.readFile(path.join(value.activeRoot, 'identity.txt'), 'utf8'), 'original-world');
});

test('post-create authentication-key replacement is rejected before attacker bytes become trusted', async (t) => {
  const managedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-world-key-race-'));
  t.after(() => fs.rm(managedRoot, { recursive: true, force: true }));
  const directory = path.join(managedRoot, 'servers', FAMILY_ID);
  await fs.mkdir(path.join(directory, 'world'), { recursive: true });
  await fs.writeFile(path.join(directory, 'server.properties'), 'level-name=world\n');
  await fs.writeFile(path.join(directory, 'world', 'level.dat'), validLevelDat());
  await fs.writeFile(path.join(directory, 'world', 'identity.txt'), 'world');
  const store = new MemoryStore({
    id: FAMILY_ID, projectId: FAMILY_ID, kind: 'server', directory, status: 'stopped', pid: null,
    managedProcess: null, provisioningStatus: 'ready', minecraftVersion: '26.2', ...serverCompatibilityBinding(),
  });
  let swapped = false;
  const manager = new FamilyWorldManager(managedRoot, store, {
    withInstanceLock: async (_id, operation) => operation(),
    assertQuiescentWithinInstanceLock: async () => store.get(FAMILY_ID),
    assertCompanionInactiveWithinInstanceLock: async () => true,
    createRescueWithinInstanceLock: async () => ({ backupId: BACKUP_ID, integrity: 'verified' }),
    currentStackBindingWithinInstanceLock: async () => ({ generation: '1'.repeat(64), inventoryDigest: '2'.repeat(64) }),
    assertLifecycleMutationAllowedWithinInstanceLock: async () => true,
    verifyInstall: async (instance) => ({ ok: true, minecraftVersion: instance.minecraftVersion, worldDataVersion: instance.worldDataVersion }),
    filesystemTreeVerifier: async () => ({ ok: true, checked: false }),
    directoryGuard: async (target) => ({ assertHeld() {}, async release() {}, async rename(destination) { await fs.rename(target, destination); }, async delete() { await fs.rmdir(target); } }),
    fileGuard: async (target) => ({ assertHeld() {}, async release() {}, async delete() { await fs.unlink(target); }, async replace(destination) { await fs.rename(target, destination); } }),
    filesystemEntryVerifier: async (target) => {
      if (!swapped && target.endsWith(path.join('family-worlds', 'hmac.key'))) {
        swapped = true;
        await fs.rename(target, `${target}.original`);
        await fs.writeFile(target, Buffer.alloc(32, 0x61));
      }
      return { ok: true, checked: false };
    },
  });
  await assert.rejects(() => manager.prepareRestoreValidation(), (error) => error.code === 'WORLD_STATE_UNAVAILABLE');
  assert.equal(swapped, true);
});

test('a same-process authentication-key discontinuity fails before lifecycle or plan mutation', async (t) => {
  await t.test('deleted named key', async (st) => {
    const value = await fixture(st);
    const keyFile = path.join(value.managedRoot, 'state', 'family-worlds', 'hmac.key');
    const parkedKey = `${keyFile}.continuity-original`;
    const worldsRoot = path.join(value.directory, '.mastermind', 'worlds');
    const before = await treeSnapshot(worldsRoot);
    await fs.rename(keyFile, parkedKey);

    await assert.rejects(
      () => planCreate(value.manager, 2001, 'Missing Key'),
      (error) => error.code === 'WORLD_STATE_UNAVAILABLE',
    );
    await assert.rejects(
      () => value.manager.assertSafeForLifecycle({ instanceId: FAMILY_ID }),
      (error) => error.code === 'WORLD_STATE_UNAVAILABLE',
    );
    assert.deepEqual(await treeSnapshot(worldsRoot), before);

    await fs.rename(parkedKey, keyFile);
    const recovered = value.makeManager();
    await recovered.initialize();
    assert.equal((await recovered.inventory()).worlds[0].state, 'active');
  });

  await t.test('different-byte named key', async (st) => {
    const value = await fixture(st);
    const keyFile = path.join(value.managedRoot, 'state', 'family-worlds', 'hmac.key');
    const parkedKey = `${keyFile}.continuity-original`;
    const originalKey = await fs.readFile(keyFile);
    const worldsRoot = path.join(value.directory, '.mastermind', 'worlds');
    const before = await treeSnapshot(worldsRoot);
    await fs.rename(keyFile, parkedKey);
    await fs.writeFile(keyFile, Buffer.alloc(32, originalKey[0] ^ 0xff));

    await assert.rejects(
      () => value.manager.assertSafeForLifecycle({ instanceId: FAMILY_ID }),
      (error) => error.code === 'WORLD_STATE_UNAVAILABLE',
    );
    await assert.rejects(
      () => planCreate(value.manager, 2002, 'Changed Key'),
      (error) => error.code === 'WORLD_STATE_UNAVAILABLE',
    );
    assert.deepEqual(await treeSnapshot(worldsRoot), before);

    const mismatched = value.makeManager();
    await assert.rejects(
      () => mismatched.initialize(),
      (error) => error.code === 'WORLD_STATE_UNAVAILABLE',
    );
    assert.deepEqual(await treeSnapshot(worldsRoot), before);

    await fs.unlink(keyFile);
    await fs.rename(parkedKey, keyFile);
    const recovered = value.makeManager();
    await recovered.initialize();
    assert.equal((await recovered.inventory()).worlds[0].state, 'active');
  });

  await t.test('exact-byte named-key replacement', async (st) => {
    const value = await fixture(st);
    const keyFile = path.join(value.managedRoot, 'state', 'family-worlds', 'hmac.key');
    const parkedKey = `${keyFile}.continuity-original`;
    const originalKey = await fs.readFile(keyFile);
    await fs.rename(keyFile, parkedKey);
    await fs.writeFile(keyFile, originalKey);
    await fs.unlink(parkedKey);

    assert.equal(await value.manager.assertSafeForLifecycle({ instanceId: FAMILY_ID }), true);
    assert.match((await planCreate(value.manager, 2003, 'Same Key')).planId, /^worldplan-[a-f0-9]{64}$/);
  });
});

test('a mid-action key swap cannot publish the next phase and remains recoverable with the original key', async (t) => {
  const value = await fixture(t);
  const keyFile = path.join(value.managedRoot, 'state', 'family-worlds', 'hmac.key');
  const parkedKey = `${keyFile}.continuity-original`;
  const originalKey = await fs.readFile(keyFile);
  const plan = await planCreate(value.manager, 2004, 'Continuity Race');
  let swapped = false;
  value.state.onPhase = async (marker) => {
    if (!swapped && marker.phase === 'candidate-ready') {
      swapped = true;
      await fs.rename(keyFile, parkedKey);
      await fs.writeFile(keyFile, Buffer.alloc(32, originalKey[0] ^ 0xff));
    }
  };

  await assert.rejects(
    () => executePlan(value.manager, plan),
    (error) => error.code === 'WORLD_RECOVERY_REQUIRED',
  );
  value.state.onPhase = null;
  assert.equal(swapped, true);
  const transactions = path.join(value.directory, '.mastermind', 'worlds', 'transactions');
  const [markerName] = await fs.readdir(transactions);
  const persisted = JSON.parse(await fs.readFile(path.join(transactions, markerName), 'utf8'));
  assert.equal(persisted.phase, 'candidate-ready');
  assert.equal(persisted.mac, signRecord(originalKey, persisted).mac);
  assert.equal(await fs.readFile(path.join(value.activeRoot, 'identity.txt'), 'utf8'), 'original-world');

  await fs.unlink(keyFile);
  await fs.rename(parkedKey, keyFile);
  const recovered = value.makeManager();
  const recovery = await recovered.initialize();
  assert.equal(recovery.some((entry) => entry.action === 'reconciled'), true);
  assert.equal((await fs.readdir(path.join(value.directory, '.mastermind', 'worlds', 'storage')))
    .some((entry) => entry.startsWith('.staging-')), false);
  assert.equal(await fs.readFile(path.join(value.activeRoot, 'identity.txt'), 'utf8'), 'original-world');
});

test('catalog publication rejects a sibling namespace substitution before subsequent world mutation', async (t) => {
  const value = await fixture(t);
  const worldsRoot = path.join(value.directory, '.mastermind', 'worlds');
  const storage = path.join(worldsRoot, 'storage');
  const parkedStorage = path.join(worldsRoot, 'storage-parked');
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-catalog-leaf-victim-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.writeFile(path.join(outside, 'victim.txt'), 'do-not-touch');
  const probe = path.join(value.managedRoot, 'catalog-leaf-link-probe');
  try {
    await fs.symlink(outside, probe, process.platform === 'win32' ? 'junction' : 'dir');
    await fs.unlink(probe);
  } catch (error) {
    t.skip(`directory links are unavailable: ${error.code ?? error.message}`);
    return;
  }

  let swapped = false;
  const directoryGuard = async (directory) => ({
    assertHeld() {},
    async release() {
      if (swapped || path.resolve(directory) !== path.resolve(worldsRoot)) return;
      const entries = await fs.readdir(worldsRoot);
      if (!entries.some((entry) => entry.startsWith('.tmp-'))) return;
      swapped = true;
      await fs.rename(storage, parkedStorage);
      await fs.symlink(outside, storage, process.platform === 'win32' ? 'junction' : 'dir');
    },
    async rename(destination) { await fs.rename(directory, destination); },
    async delete() { await fs.rmdir(directory); },
  });
  const manager = value.makeManager({ directoryGuard });
  await manager.initialize();
  const activeWorldRef = (await manager.inventory()).activeWorldRef;
  const plan = await manager.createPlan(FAMILY_ID, {
    requestId: uuid(2006), operation: 'rename', targetWorldRef: activeWorldRef, displayLabel: 'Blocked Catalog Swap',
  });
  await assert.rejects(
    () => executePlan(manager, plan),
    (error) => error.code === 'WORLD_RECOVERY_REQUIRED',
  );
  assert.equal(swapped, true);
  assert.deepEqual(await fs.readdir(outside), ['victim.txt']);
  assert.equal(await fs.readFile(path.join(outside, 'victim.txt'), 'utf8'), 'do-not-touch');
  assert.deepEqual(await fs.readdir(path.join(worldsRoot, 'operations')), []);
});

test('native guards publish authenticated plan, marker, catalog, and operation records', { skip: process.platform !== 'win32' }, async (t) => {
  const value = await fixture(t);
  const plansRoot = path.resolve(value.directory, '.mastermind', 'worlds', 'plans');
  const worldsRoot = path.resolve(value.directory, '.mastermind', 'worlds');
  const storageRoot = path.join(worldsRoot, 'storage');
  let blockedLeafSwap = null;
  let blockedSiblingSwap = null;
  const manager = value.makeManager({
    directoryGuard: async (target) => {
      const guard = await acquireWindowsDirectoryGuard(target);
      const resolved = path.resolve(target);
      if (resolved !== plansRoot && resolved !== worldsRoot) return guard;
      return {
        assertHeld: () => guard.assertHeld(),
        delete: () => guard.delete(),
        rename: (destination) => guard.rename(destination),
        async release() {
          await guard.release();
          if (!(await fs.readdir(target)).some((entry) => entry.startsWith('.tmp-'))) return;
          if (resolved === plansRoot && blockedLeafSwap === null) {
            try {
              await fs.rename(target, `${target}.swap-attempt`);
              blockedLeafSwap = 'unexpected-success';
            } catch (error) { blockedLeafSwap = error.code; }
          }
          if (resolved === worldsRoot && blockedSiblingSwap === null) {
            try {
              await fs.rename(storageRoot, `${storageRoot}.swap-attempt`);
              blockedSiblingSwap = 'unexpected-success';
            } catch (error) { blockedSiblingSwap = error.code; }
          }
        },
      };
    },
    fileGuard: undefined,
  });
  await manager.initialize();
  const activeWorldRef = (await manager.inventory()).activeWorldRef;
  const requestId = uuid(2005);
  const plan = await manager.createPlan(FAMILY_ID, {
    requestId, operation: 'rename', targetWorldRef: activeWorldRef, displayLabel: 'Native Continuity',
  });
  assert.match(plan.planId, /^worldplan-[a-f0-9]{64}$/);
  const result = await executePlan(manager, plan);
  assert.equal(result.state, 'committed');
  assert.equal(result.result.displayLabel, 'Native Continuity');
  assert.ok(['EBUSY', 'EPERM'].includes(blockedLeafSwap), `unexpected native leaf-swap result: ${blockedLeafSwap}`);
  assert.ok(['EBUSY', 'EPERM'].includes(blockedSiblingSwap), `unexpected native sibling-swap result: ${blockedSiblingSwap}`);

  const transactionEntries = await fs.readdir(path.join(worldsRoot, 'transactions'));
  assert.equal(transactionEntries.length, 1);
  for (const file of [
    path.join(worldsRoot, 'plans', `${requestId}.json`),
    path.join(worldsRoot, 'transactions', transactionEntries[0]),
    path.join(worldsRoot, 'catalog.json'),
    path.join(worldsRoot, 'operations', `${requestId}.json`),
  ]) {
    const persisted = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.match(persisted.mac, /^[a-f0-9]{64}$/);
  }
});

test('canonical persisted JSON rejects otherwise valid authenticated whitespace padding', async (t) => {
  const value = await fixture(t);
  const catalog = path.join(value.directory, '.mastermind', 'worlds', 'catalog.json');
  const bytes = await fs.readFile(catalog);
  await fs.writeFile(catalog, Buffer.concat([Buffer.from(' '), bytes]));
  await assert.rejects(() => value.manager.inventory(), (error) => error.code === 'WORLD_STATE_UNAVAILABLE');
});

test('private journal enforces exact record-count and aggregate-byte bounds', async (t) => {
  await t.test('4096 existing operations reject a new operation', async (st) => {
    const value = await fixture(st);
    const operations = path.join(value.directory, '.mastermind', 'worlds', 'operations');
    const key = await fs.readFile(path.join(value.managedRoot, 'state', 'family-worlds', 'hmac.key'));
    const timestamp = '2026-08-13T12:00:00.000Z';
    for (let start = 0; start < 4096; start += 128) {
      await Promise.all(Array.from({ length: Math.min(128, 4096 - start) }, async (_, offset) => {
        const requestId = uuid(10_000 + start + offset);
        const record = signRecord(key, {
          schemaVersion: 1, instanceId: FAMILY_ID, requestId,
          planId: `worldplan-${'a'.repeat(64)}`, planDigest: 'b'.repeat(64), operation: 'create',
          state: 'rejected-before-mutation', transactionRef: `worldtx-${(10_000 + start + offset).toString(16).padStart(64, '0')}`,
          failureCode: 'WORLD_PLAN_STALE', result: null, startedAt: timestamp, updatedAt: timestamp,
        });
        await fs.writeFile(path.join(operations, `${requestId}.json`), `${JSON.stringify(record)}\n`);
      }));
    }
    const plan = await planCreate(value.manager, 885, 'Journal Full');
    value.state.nowMs = Date.parse(plan.expiresAt) + 1;
    await assert.rejects(() => executePlan(value.manager, plan), (error) => error.code === 'WORLD_QUOTA_EXCEEDED' && error.statusCode === 507);
  });

  await t.test('post-publication admission rechecks sibling journal count under rebound guards', async (st) => {
    const value = await fixture(st);
    const plans = path.join(value.directory, '.mastermind', 'worlds', 'plans');
    const operations = path.join(value.directory, '.mastermind', 'worlds', 'operations');
    let inserted = false;
    const directoryGuard = async (directory) => ({
      assertHeld() {},
      async release() {
        if (inserted || path.resolve(directory) !== path.resolve(plans)) return;
        if (!(await fs.readdir(plans)).some((entry) => entry.startsWith('.tmp-'))) return;
        inserted = true;
        await fs.writeFile(path.join(operations, `${uuid(30_000)}.json`), '{}');
      },
      async rename(destination) { await fs.rename(directory, destination); },
      async delete() { await fs.rmdir(directory); },
    });
    const manager = value.makeManager({ directoryGuard });
    await manager.initialize();
    const key = await fs.readFile(path.join(value.managedRoot, 'state', 'family-worlds', 'hmac.key'));
    const timestamp = '2026-08-13T12:00:00.000Z';
    for (let start = 0; start < 4096; start += 128) {
      await Promise.all(Array.from({ length: Math.min(128, 4096 - start) }, async (_, offset) => {
        const requestId = uuid(40_000 + start + offset);
        const record = signRecord(key, {
          schemaVersion: 1, instanceId: FAMILY_ID, requestId,
          planId: `worldplan-${'a'.repeat(64)}`, planDigest: 'b'.repeat(64), operation: 'create',
          state: 'rejected-before-mutation', transactionRef: `worldtx-${(40_000 + start + offset).toString(16).padStart(64, '0')}`,
          failureCode: 'WORLD_PLAN_STALE', result: null, startedAt: timestamp, updatedAt: timestamp,
        });
        await fs.writeFile(path.join(operations, `${requestId}.json`), `${JSON.stringify(record)}\n`);
      }));
    }
    await assert.rejects(
      () => planCreate(manager, 886, 'Concurrent Journal Growth'),
      (error) => error.code === 'WORLD_QUOTA_EXCEEDED' && error.statusCode === 507,
    );
    assert.equal(inserted, true);
  });

  await t.test('post-publication admission rejects a low-count malformed sibling record', async (st) => {
    const value = await fixture(st);
    const plans = path.join(value.directory, '.mastermind', 'worlds', 'plans');
    const operations = path.join(value.directory, '.mastermind', 'worlds', 'operations');
    let inserted = false;
    const directoryGuard = async (directory) => ({
      assertHeld() {},
      async release() {
        if (inserted || path.resolve(directory) !== path.resolve(plans)) return;
        if (!(await fs.readdir(plans)).some((entry) => entry.startsWith('.tmp-'))) return;
        inserted = true;
        await fs.writeFile(path.join(operations, `${uuid(50_000)}.json`), '{}\n');
      },
      async rename(destination) { await fs.rename(directory, destination); },
      async delete() { await fs.rmdir(directory); },
    });
    const manager = value.makeManager({ directoryGuard });
    await manager.initialize();
    const catalogFile = path.join(value.directory, '.mastermind', 'worlds', 'catalog.json');
    const beforeRevision = JSON.parse(await fs.readFile(catalogFile, 'utf8')).revision;
    await assert.rejects(
      () => planCreate(manager, 887, 'Malformed Sibling'),
      (error) => error.code === 'WORLD_STATE_UNAVAILABLE',
    );
    const catalog = JSON.parse(await fs.readFile(catalogFile, 'utf8'));
    assert.equal(catalog.revision, beforeRevision);
    assert.equal(inserted, true);
  });

  await t.test('aggregate bytes', async (st) => {
    const value = await fixture(st);
    const operations = path.join(value.directory, '.mastermind', 'worlds', 'operations');
    try {
      for (let index = 0; index < 5; index += 1) {
        const file = path.join(operations, `${uuid(20_000 + index)}.json`);
        await fs.writeFile(file, '{}');
        await fs.truncate(file, 16 * 1024 * 1024);
      }
    } catch (error) {
      st.skip(`bounded sparse journal fixtures are unavailable: ${error.code ?? error.message}`);
      return;
    }
    await assert.rejects(() => value.restart(), (error) => error.code === 'WORLD_STATE_UNAVAILABLE');
  });
});

test('worlds-root atomic remnants and missing catalogs with managed history fail closed', async (t) => {
  await t.test('root temporary', async (st) => {
    const value = await fixture(st);
    await fs.writeFile(path.join(value.directory, '.mastermind', 'worlds', '.tmp-attacker'), '{}\n');
    await assert.rejects(() => value.restart(), (error) => error.code === 'WORLD_STATE_UNAVAILABLE');
  });
  for (const [name, seed] of [
    ['stored world', async (value) => {
      const active = (await value.manager.inventory()).activeWorldRef;
      await executePlan(value.manager, await planClone(value.manager, 880, active, 'Catalog Orphan'));
    }],
    ['terminal journal', async (value) => { await executePlan(value.manager, await planCreate(value.manager, 881, 'Journal Orphan')); }],
  ]) {
    await t.test(name, async (st) => {
      const value = await fixture(st);
      await seed(value);
      await fs.unlink(path.join(value.directory, '.mastermind', 'worlds', 'catalog.json'));
      await assert.rejects(() => value.restart(), (error) => ['WORLD_RECOVERY_REQUIRED', 'WORLD_STATE_UNAVAILABLE'].includes(error.code));
    });
  }
});

test('an inactive world blocks Minecraft and component stack mutations', async (t) => {
  const value = await fixture(t);
  await executePlan(value.manager, await planCreate(value.manager, 360, 'Inactive Version Fence'));
  await assert.rejects(
    () => value.state.withInstanceLock(FAMILY_ID, () => value.manager.assertStackUpdateAllowedWithinInstanceLock(FAMILY_ID, { minecraftVersion: '26.3' })),
    (error) => error.code === 'WORLDS_BLOCK_MINECRAFT_UPDATE',
  );
  await assert.rejects(
    () => value.state.withInstanceLock(FAMILY_ID, () => value.manager.assertStackUpdateAllowedWithinInstanceLock(FAMILY_ID, { minecraftVersion: '26.2', loaderVersion: '0.20.0' })),
    (error) => error.code === 'WORLDS_BLOCK_STACK_UPDATE',
  );
});

test('archiving the only stored world permits a Minecraft-version update but still blocks component-only drift', async (t) => {
  const value = await fixture(t);
  const created = await executePlan(value.manager, await planCreate(value.manager, 361, 'Archived Version Fence'));
  const archive = await value.manager.createPlan(FAMILY_ID, {
    requestId: uuid(362), operation: 'archive', targetWorldRef: created.result.worldRef,
  });
  await executePlan(value.manager, archive);
  assert.equal(
    await value.state.withInstanceLock(FAMILY_ID, () => value.manager.assertStackUpdateAllowedWithinInstanceLock(FAMILY_ID, { minecraftVersion: '26.3', loaderVersion: '0.20.0' })),
    true,
  );
  await assert.rejects(
    () => value.state.withInstanceLock(FAMILY_ID, () => value.manager.assertStackUpdateAllowedWithinInstanceLock(FAMILY_ID, { minecraftVersion: '26.2', loaderVersion: '0.20.0' })),
    (error) => error.code === 'WORLDS_BLOCK_STACK_UPDATE',
  );
});

test('trusted world DataVersion ceiling accepts older worlds and rejects future worlds before bootstrap', async (t) => {
  const older = await fixture(t, { levelMetadata: { dataVersion: WORLD_DATA_VERSION - 1, levelName: 'Older Realm' } });
  assert.equal((await older.manager.inventory()).worlds[0].dataVersion, WORLD_DATA_VERSION - 1);

  await t.test('future bootstrap', async (st) => {
    const future = await fixture(st, {
      initialize: false,
      levelMetadata: { dataVersion: WORLD_DATA_VERSION + 1, levelName: 'Future Realm' },
    });
    await assert.rejects(
      () => future.manager.initialize(),
      (error) => error.code === 'WORLD_VERSION_INCOMPATIBLE',
    );
    await assert.rejects(
      () => fs.access(path.join(future.directory, '.mastermind', 'worlds', 'catalog.json')),
      (error) => error.code === 'ENOENT',
    );
  });
});

test('stack-update interlock rejects a candidate DataVersion ceiling below any non-archived world', async (t) => {
  const value = await fixture(t, { levelMetadata: { dataVersion: WORLD_DATA_VERSION, levelName: 'Ceiling Realm' } });
  await assert.rejects(
    () => value.state.withInstanceLock(FAMILY_ID, () => value.manager.assertStackUpdateAllowedWithinInstanceLock(FAMILY_ID, {
      minecraftVersion: '26.3', worldDataVersion: WORLD_DATA_VERSION - 1,
      minecraftServerArtifact: { worldDataVersion: WORLD_DATA_VERSION - 1 },
    })),
    (error) => error.code === 'WORLD_VERSION_INCOMPATIBLE',
  );
  assert.equal(await value.state.withInstanceLock(FAMILY_ID, () => value.manager.assertStackUpdateAllowedWithinInstanceLock(FAMILY_ID, {
    minecraftVersion: '26.3', worldDataVersion: WORLD_DATA_VERSION,
    minecraftServerArtifact: { worldDataVersion: WORLD_DATA_VERSION },
  })), true);
});

test('restored candidates reject future DataVersion before the restored layout is admitted', async (t) => {
  const value = await fixture(t);
  const candidate = path.join(value.managedRoot, 'servers', `.family-server.rtx-${'a'.repeat(32)}.candidate`);
  await fs.cp(value.directory, candidate, { recursive: true, errorOnExist: true });
  await fs.writeFile(path.join(candidate, 'world', 'level.dat'), validLevelDat({
    dataVersion: WORLD_DATA_VERSION + 1, levelName: 'Future Restore',
  }));
  await assert.rejects(
    () => value.state.withInstanceLock(FAMILY_ID, () => value.manager.validateRestoredStateWithinInstanceLock(
      FAMILY_ID, structuredClone(value.state.stackBinding), { directory: candidate },
    )),
    (error) => error.code === 'WORLD_VERSION_INCOMPATIBLE',
  );
});

test('restored candidates reject stale inactive stack bindings while permitting archived history', async (t) => {
  const value = await fixture(t);
  const original = (await value.manager.inventory()).activeWorldRef;
  const cloned = await executePlan(value.manager, await planClone(value.manager, 882, original, 'Restore Binding'));
  const catalogFile = path.join(value.directory, '.mastermind', 'worlds', 'catalog.json');
  const key = await fs.readFile(path.join(value.managedRoot, 'state', 'family-worlds', 'hmac.key'));
  const signed = JSON.parse(await fs.readFile(catalogFile, 'utf8'));
  const catalog = structuredClone(signed); delete catalog.mac;
  const inactive = catalog.worlds.find((world) => world.worldRef === cloned.result.worldRef);
  inactive.stackGeneration = '9'.repeat(64);
  await fs.writeFile(catalogFile, `${JSON.stringify(signRecord(key, catalog))}\n`);
  await assert.rejects(
    () => value.state.withInstanceLock(FAMILY_ID, () => value.manager.validateRestoredStateWithinInstanceLock(
      FAMILY_ID, structuredClone(value.state.stackBinding),
    )),
    (error) => error.code === 'WORLD_VERSION_INCOMPATIBLE',
  );
  inactive.state = 'archived';
  await fs.writeFile(catalogFile, `${JSON.stringify(signRecord(key, catalog))}\n`);
  assert.deepEqual(await value.state.withInstanceLock(FAMILY_ID, () => value.manager.validateRestoredStateWithinInstanceLock(
    FAMILY_ID, structuredClone(value.state.stackBinding),
  )), value.state.stackBinding);
});

test('same-Minecraft server artifact binding changes stale outstanding world plans', async (t) => {
  const value = await fixture(t);
  const plan = await planCreate(value.manager, 365, 'Artifact-Stale Plan');
  const current = await value.store.get(FAMILY_ID);
  await value.store.update(FAMILY_ID, {
    minecraftServerArtifact: {
      ...current.minecraftServerArtifact,
      sha1: 'c'.repeat(40),
      sha256: 'd'.repeat(64),
    },
  });
  value.state.stackBinding.generation = '3'.repeat(64);
  const result = await executePlan(value.manager, plan);
  assert.equal(result.state, 'rejected-before-mutation');
  assert.equal(result.failureCode, 'WORLD_PLAN_STALE');
  assert.equal((await value.manager.inventory()).worlds.some((world) => world.displayLabel === 'Artifact-Stale Plan'), false);
});

test('legacy installs defer world initialization and allow only a hash-bound same-version metadata migration', async (t) => {
  const value = await fixture(t, { initialize: false, legacyMetadata: true });
  assert.deepEqual(await value.manager.initialize(), [{
    instanceId: FAMILY_ID, action: 'deferred-version-metadata-migration',
  }]);
  await assert.rejects(
    () => value.manager.inventory(),
    (error) => error.code === 'WORLD_VERSION_METADATA_REQUIRED',
  );
  await assert.rejects(
    () => value.state.withInstanceLock(FAMILY_ID, () => value.manager.assertStackUpdateAllowedWithinInstanceLock(FAMILY_ID, {
      minecraftVersion: '26.2', loaderVersion: '0.20.0',
    })),
    (error) => error.code === 'WORLD_VERSION_METADATA_REQUIRED',
  );
  assert.equal(await value.state.withInstanceLock(FAMILY_ID, () => value.manager.assertStackUpdateAllowedWithinInstanceLock(FAMILY_ID, {
    minecraftVersion: '26.2',
    minecraftServerArtifact: {
      minecraftVersion: '26.2', relativePath: 'versions/26.2/server-26.2.jar',
      size: 1024, sha1: 'c'.repeat(40),
    },
  })), true);
  assert.equal(await value.state.withInstanceLock(FAMILY_ID, () => value.manager.assertStackUpdateAllowedWithinInstanceLock(FAMILY_ID, {
    minecraftVersion: '26.2', worldDataVersion: WORLD_DATA_VERSION,
    minecraftServerArtifact: {
      minecraftVersion: '26.2', relativePath: 'versions/26.2/server-26.2.jar',
      size: 1024, sha1: 'c'.repeat(40), sha256: 'd'.repeat(64), worldDataVersion: WORLD_DATA_VERSION,
    },
  })), true);
  await assert.rejects(
    () => value.state.withInstanceLock(FAMILY_ID, () => value.manager.assertStackUpdateAllowedWithinInstanceLock(FAMILY_ID, {
      minecraftVersion: '26.2', worldDataVersion: WORLD_DATA_VERSION - 1,
      minecraftServerArtifact: {
        minecraftVersion: '26.2', relativePath: 'versions/26.2/server-26.2.jar',
        size: 1024, sha1: 'c'.repeat(40), sha256: 'd'.repeat(64), worldDataVersion: WORLD_DATA_VERSION,
      },
    })),
    (error) => error.code === 'WORLD_VERSION_METADATA_REQUIRED',
  );
  await assert.rejects(
    () => fs.access(path.join(value.directory, '.mastermind', 'worlds')),
    (error) => error.code === 'ENOENT',
  );

  await t.test('unfinished private state blocks migration', async (st) => {
    const blocked = await fixture(st, { initialize: false, legacyMetadata: true });
    const transactionRoot = path.join(blocked.directory, '.mastermind', 'worlds', 'transactions');
    await fs.mkdir(transactionRoot, { recursive: true });
    for (const name of ['storage', 'plans', 'operations']) {
      await fs.mkdir(path.join(blocked.directory, '.mastermind', 'worlds', name), { recursive: true });
    }
    await fs.writeFile(path.join(transactionRoot, 'unfinished.json'), '{}\n');
    await assert.rejects(
      () => blocked.state.withInstanceLock(FAMILY_ID, () => blocked.manager.assertStackUpdateAllowedWithinInstanceLock(FAMILY_ID, {
        minecraftVersion: '26.2',
        minecraftServerArtifact: {
          minecraftVersion: '26.2', relativePath: 'versions/26.2/server-26.2.jar',
          size: 1024, sha1: 'c'.repeat(40),
        },
      })),
      (error) => error.code === 'WORLD_STATE_UNAVAILABLE',
    );
  });
});

test('startup recovery cleans a create crash after publication and resolves its completion-unknown operation', async (t) => {
  const value = await fixture(t);
  const plan = await planCreate(value.manager, 200, 'Crash Candidate');
  const crashImage = path.join(value.managedRoot, 'create-crash-image');
  let captured = false;
  value.state.onPhase = async (marker) => {
    if (marker.phase !== 'target-published' || captured) return;
    captured = true;
    await fs.cp(value.directory, crashImage, { recursive: true, errorOnExist: true });
    throw new Error('simulated abrupt process loss');
  };
  const localOutcome = await executePlan(value.manager, plan);
  assert.equal(localOutcome.state, 'rolled-back');
  assert.equal(captured, true, `observed phases: ${JSON.stringify(value.state.events)}`);
  value.state.onPhase = null;

  const resolvedDirectory = path.resolve(value.directory);
  assert.ok(resolvedDirectory.startsWith(path.resolve(value.managedRoot) + path.sep));
  await fs.rm(resolvedDirectory, { recursive: true, force: false });
  await renameCrashImage(crashImage, resolvedDirectory);

  const restarted = await value.restart();
  const inventory = await restarted.inventory();
  assert.deepEqual(inventory.recovery, { required: false, state: null, transactionRef: null });
  assert.equal(inventory.worlds.length, 1);
  const storageEntries = await fs.readdir(path.join(value.directory, '.mastermind', 'worlds', 'storage'));
  assert.deepEqual(storageEntries, [], 'recovery must not retain an unreferenced published world');
  const operation = await restarted.operation(FAMILY_ID, plan.requestId);
  assert.equal(operation.state, 'rolled-back');
  assert.equal(operation.application, 'rolled-back-verified');
  assert.equal(operation.failureCode, null);
  assert.equal(operation.result, null);
  const marker = JSON.parse(await fs.readFile(path.join(
    value.directory, '.mastermind', 'worlds', 'transactions', `${operation.transactionRef}.json`,
  ), 'utf8'));
  assert.equal(marker.phase, 'rolled-back');
});

test('private world-root initialization holds an anchored lease before creating descendants', async (t) => {
  for (const targetKind of ['instance-root', 'private-root']) {
    await t.test(targetKind, async (st) => {
      const value = await fixture(st, { initialize: false });
      const outside = await fs.mkdtemp(path.join(os.tmpdir(), `mastermind-world-init-${targetKind}-`));
      st.after(() => fs.rm(outside, { recursive: true, force: true }));
      await fs.writeFile(path.join(outside, 'victim.txt'), 'do-not-touch');
      const probe = path.join(value.managedRoot, `init-link-probe-${targetKind}`);
      try {
        await fs.symlink(outside, probe, process.platform === 'win32' ? 'junction' : 'dir');
        await fs.unlink(probe);
      } catch (error) {
        st.skip(`directory links are unavailable: ${error.code ?? error.message}`);
        return;
      }
      const target = targetKind === 'instance-root'
        ? value.directory
        : path.join(value.directory, '.mastermind');
      const parked = `${target}-parked`;
      let swapped = false;
      const directoryGuard = async (directory) => {
        if (!swapped && path.resolve(directory) === path.resolve(target)) {
          swapped = true;
          await fs.rename(target, parked);
          await fs.symlink(outside, target, process.platform === 'win32' ? 'junction' : 'dir');
        }
        return {
          assertHeld() {}, async release() {},
          async rename(destination) { await fs.rename(directory, destination); },
          async delete() { await fs.rmdir(directory); },
        };
      };
      const manager = value.makeManager({ directoryGuard });
      await assert.rejects(() => manager.initialize(), (error) => error.code === 'WORLD_INTEGRITY_FAILED');
      assert.equal(swapped, true);
      assert.deepEqual(await fs.readdir(outside), ['victim.txt']);
      assert.equal(await fs.readFile(path.join(outside, 'victim.txt'), 'utf8'), 'do-not-touch');
    });
  }
});

test('startup recovery removes a clone published before afterCatalog becomes durable', async (t) => {
  const value = await fixture(t);
  const original = (await value.manager.inventory()).activeWorldRef;
  const plan = await planClone(value.manager, 225, original, 'Clone Crash Candidate');
  const crashImage = path.join(value.managedRoot, 'clone-crash-image');
  let captured = false;
  value.state.onPhase = async (marker) => {
    if (marker.phase !== 'target-published' || captured) return;
    captured = true;
    assert.equal(marker.afterCatalog, null, 'this fixture must exercise the publish-before-afterCatalog crash window');
    await fs.cp(value.directory, crashImage, { recursive: true, errorOnExist: true });
    throw new Error('simulated abrupt process loss');
  };
  await executePlan(value.manager, plan).catch(() => null);
  assert.equal(captured, true);
  value.state.onPhase = null;
  const resolvedDirectory = path.resolve(value.directory);
  assert.ok(resolvedDirectory.startsWith(path.resolve(value.managedRoot) + path.sep));
  await fs.rm(resolvedDirectory, { recursive: true, force: false });
  await renameCrashImage(crashImage, resolvedDirectory);

  const restarted = await value.restart();
  const inventory = await restarted.inventory();
  assert.equal(inventory.worlds.length, 1);
  assert.deepEqual(await fs.readdir(path.join(value.directory, '.mastermind', 'worlds', 'storage')), []);
  const operation = await restarted.operation(FAMILY_ID, plan.requestId);
  assert.equal(operation.state, 'rolled-back');
  assert.equal(operation.application, 'rolled-back-verified');
  assert.equal(operation.failureCode, null);
  assert.equal(operation.result, null);
  assert.equal(JSON.parse(await fs.readFile(path.join(
    value.directory, '.mastermind', 'worlds', 'transactions', `${operation.transactionRef}.json`,
  ), 'utf8')).phase, 'rolled-back');
});

test('startup treats terminal markers as history instead of replaying stale catalogs', async (t) => {
  const value = await fixture(t);
  const original = (await value.manager.inventory()).activeWorldRef;
  assert.equal((await executePlan(value.manager, await planClone(value.manager, 250, original, 'Historical Clone One'))).state, 'committed');
  assert.equal((await executePlan(value.manager, await planClone(value.manager, 251, original, 'Historical Clone Two'))).state, 'committed');
  const restarted = await value.restart();
  const inventory = await restarted.inventory();
  assert.equal(inventory.worlds.length, 3);
  assert.deepEqual(inventory.recovery, { required: false, state: null, transactionRef: null });
});

test('switch crash recovery identifies the exact target even when another inactive world sorts first', async (t) => {
  const value = await fixture(t);
  const original = (await value.manager.inventory()).activeWorldRef;
  const firstClone = await executePlan(value.manager, await planClone(value.manager, 300, original, 'First Clone'));
  const secondClone = await executePlan(value.manager, await planClone(value.manager, 301, original, 'Second Clone'));
  assert.equal(firstClone.state, 'committed', JSON.stringify(firstClone));
  assert.equal(secondClone.state, 'committed', JSON.stringify(secondClone));
  const firstRef = firstClone.result.worldRef;
  const targetRef = secondClone.result.worldRef;
  const plan = await value.manager.createPlan(FAMILY_ID, {
    requestId: uuid(302), operation: 'switch', targetWorldRef: targetRef,
  });
  const crashImage = path.join(value.managedRoot, 'switch-crash-image');
  let captured = false;
  value.state.onPhase = async (marker) => {
    if (marker.phase !== 'target-live' || captured) return;
    captured = true;
    await fs.cp(value.directory, crashImage, { recursive: true, errorOnExist: true });
    throw new Error('simulated abrupt process loss');
  };
  await executePlan(value.manager, plan).catch(() => null);
  assert.equal(captured, true, `observed phases: ${JSON.stringify(value.state.events)}`);
  value.state.onPhase = null;

  const resolvedDirectory = path.resolve(value.directory);
  assert.ok(resolvedDirectory.startsWith(path.resolve(value.managedRoot) + path.sep));
  await fs.rm(resolvedDirectory, { recursive: true, force: false });
  await renameCrashImage(crashImage, resolvedDirectory);

  const restarted = await value.restart();
  const inventory = await restarted.inventory();
  assert.equal(inventory.activeWorldRef, original);
  assert.equal(inventory.worlds.find((world) => world.worldRef === firstRef).state, 'inactive');
  assert.equal(inventory.worlds.find((world) => world.worldRef === targetRef).state, 'inactive');
  assert.equal(await fs.readFile(path.join(value.activeRoot, 'identity.txt'), 'utf8'), 'original-world');
  assert.ok((await fs.readdir(path.join(value.directory, '.mastermind', 'worlds', 'storage'))).includes(targetRef));
  assert.equal((await restarted.operation(FAMILY_ID, plan.requestId)).state, 'rolled-back');
});

test('switch recovery reaches one canonical layout across every durable rename phase', async (t) => {
  const phases = [
    'intent-live-to-temp',
    'live-in-temp',
    'intent-target-to-live',
    'target-live',
    'intent-temp-to-storage',
    'previous-stored',
    'intent-catalog',
    'catalog-committed',
    'committed',
  ];
  for (const [index, phase] of phases.entries()) {
    await t.test(phase, async (st) => {
      const value = await fixture(st);
      const original = (await value.manager.inventory()).activeWorldRef;
      const targetOperation = await executePlan(
        value.manager,
        await planClone(value.manager, 600 + index * 3, original, `Target ${phase}`),
      );
      assert.equal(targetOperation.state, 'committed');
      const target = targetOperation.result.worldRef;
      const plan = await value.manager.createPlan(FAMILY_ID, {
        requestId: uuid(601 + index * 3), operation: 'switch', targetWorldRef: target,
      });
      const crashImage = path.join(value.managedRoot, `switch-${phase}-crash`);
      let captured = false;
      value.state.onPhase = async (marker) => {
        if (marker.phase !== phase || captured) return;
        captured = true;
        await fs.cp(value.directory, crashImage, { recursive: true, errorOnExist: true });
        // The directory copy is the crash image. Let the local in-memory manager
        // finish against its disposable source tree so Windows copy-on-open
        // behavior cannot race the snapshot and make this test flaky.
      };
      const localOutcome = await executePlan(value.manager, plan);
      assert.equal(captured, true, `phase hook ${phase} was not reached; local outcome=${JSON.stringify(localOutcome)}`);
      value.state.onPhase = null;
      const resolvedDirectory = path.resolve(value.directory);
      assert.ok(resolvedDirectory.startsWith(path.resolve(value.managedRoot) + path.sep));
      await fs.rm(resolvedDirectory, { recursive: true, force: false });
      await renameCrashImage(crashImage, resolvedDirectory);

      const restarted = await value.restart();
      const inventory = await restarted.inventory();
      const shouldCommit = phase === 'intent-catalog' || phase === 'catalog-committed' || phase === 'committed';
      assert.equal(inventory.activeWorldRef, shouldCommit ? target : original);
      assert.equal(inventory.worlds.find((world) => world.worldRef === original).state, shouldCommit ? 'inactive' : 'active');
      assert.equal(inventory.worlds.find((world) => world.worldRef === target).state, shouldCommit ? 'active' : 'inactive');
      assert.deepEqual(inventory.recovery, { required: false, state: null, transactionRef: null });
      const operation = await restarted.operation(FAMILY_ID, plan.requestId);
      assert.equal(operation.state, shouldCommit ? 'committed' : 'rolled-back');
      assert.equal(operation.application, shouldCommit ? 'verified' : 'rolled-back-verified');
      assert.equal(operation.failureCode, null);
      assert.equal(operation.result === null, !shouldCommit);
      assert.equal(JSON.parse(await fs.readFile(path.join(
        value.directory, '.mastermind', 'worlds', 'transactions', `${operation.transactionRef}.json`,
      ), 'utf8')).phase, shouldCommit ? 'committed' : 'rolled-back');
      const storageEntries = await fs.readdir(path.join(value.directory, '.mastermind', 'worlds', 'storage'));
      assert.deepEqual(storageEntries, [shouldCommit ? original : target]);
    });
  }
});

test('a storage-root junction cannot write staging data into an outside victim directory', { skip: process.platform !== 'win32' }, async (t) => {
  const value = await fixture(t);
  const storage = path.join(value.directory, '.mastermind', 'worlds', 'storage');
  const displaced = path.join(value.directory, '.mastermind', 'worlds', 'storage-real');
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-world-victim-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.writeFile(path.join(outside, 'victim.txt'), 'do-not-touch');
  await fs.rename(storage, displaced);
  try {
    await fs.symlink(outside, storage, 'junction');
  } catch (error) {
    t.skip(`directory junctions are unavailable: ${error.code ?? error.message}`);
    return;
  }
  await assert.rejects(
    () => planCreate(value.manager, 400, 'Outside Escape'),
    (error) => error.code === 'WORLD_INTEGRITY_FAILED',
  );
  assert.deepEqual(await fs.readdir(outside), ['victim.txt']);
  assert.equal(await fs.readFile(path.join(outside, 'victim.txt'), 'utf8'), 'do-not-touch');
});

test('an active-world junction swap is rejected without reading or changing the outside victim', { skip: process.platform !== 'win32' }, async (t) => {
  const value = await fixture(t);
  const displaced = path.join(value.directory, 'world-real');
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-active-world-victim-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.writeFile(path.join(outside, 'victim.txt'), 'do-not-touch');
  await fs.rename(value.activeRoot, displaced);
  try {
    await fs.symlink(outside, value.activeRoot, 'junction');
  } catch (error) {
    t.skip(`directory junctions are unavailable: ${error.code ?? error.message}`);
    return;
  }
  await assert.rejects(() => value.manager.inventory(), (error) => error.code === 'WORLD_INTEGRITY_FAILED');
  assert.deepEqual(await fs.readdir(outside), ['victim.txt']);
  assert.equal(await fs.readFile(path.join(outside, 'victim.txt'), 'utf8'), 'do-not-touch');
});

test('an intermediate private-root swap cannot redirect staging publication into an outside victim', async (t) => {
  const value = await fixture(t);
  const privateRoot = path.join(value.directory, '.mastermind');
  const displaced = path.join(value.directory, '.mastermind-displaced');
  const storage = path.join(privateRoot, 'worlds', 'storage');
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-world-ancestor-victim-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.mkdir(path.join(outside, 'worlds', 'storage'), { recursive: true });
  for (const name of ['plans', 'transactions', 'operations']) await fs.mkdir(path.join(outside, 'worlds', name));
  await fs.writeFile(path.join(outside, 'victim.txt'), 'do-not-touch');
  const probe = path.join(value.managedRoot, 'link-probe');
  try {
    await fs.symlink(outside, probe, process.platform === 'win32' ? 'junction' : 'dir');
    await fs.unlink(probe);
  } catch (error) {
    t.skip(`directory links are unavailable: ${error.code ?? error.message}`);
    return;
  }
  let swapped = false;
  const directoryGuard = async (directory) => {
    if (!swapped && path.resolve(directory) === path.resolve(storage)) {
      swapped = true;
      await fs.rename(privateRoot, displaced);
      await fs.symlink(outside, privateRoot, process.platform === 'win32' ? 'junction' : 'dir');
    }
    return {
      assertHeld() {}, async release() {},
      async rename(destination) { await fs.rename(directory, destination); },
      async delete() { await fs.rmdir(directory); },
    };
  };
  await assert.rejects(
    () => value.restart({ directoryGuard }),
    (error) => error.code === 'WORLD_INTEGRITY_FAILED',
  );
  assert.equal(swapped, true);
  assert.equal(await fs.readFile(path.join(outside, 'victim.txt'), 'utf8'), 'do-not-touch');
  assert.deepEqual(await fs.readdir(path.join(outside, 'worlds', 'storage')), []);
  assert.deepEqual(await fs.readdir(path.join(outside, 'worlds', 'operations')), []);
});

test('rollback deletes the exact guarded tombstone instead of a swapped empty outside victim', async (t) => {
  const value = await fixture(t);
  const storage = path.join(value.directory, '.mastermind', 'worlds', 'storage');
  const outsideParent = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-world-delete-victim-'));
  t.after(() => fs.rm(outsideParent, { recursive: true, force: true }));
  const outsideVictim = path.join(outsideParent, 'empty-victim');
  await fs.mkdir(outsideVictim);
  await fs.writeFile(path.join(outsideParent, 'victim-marker.txt'), 'do-not-touch');
  let swapObserved = false;
  const directoryGuard = async (directory) => ({
    assertHeld() {}, async release() {},
    async rename(destination) { await fs.rename(directory, destination); },
    async delete() {
      if (!swapObserved && path.dirname(directory) === storage && path.basename(directory).startsWith('.delete-')) {
        swapObserved = true;
        const heldOriginal = `${directory}.held-original`;
        await fs.rename(directory, heldOriginal);
        await fs.rename(outsideVictim, directory);
        await fs.rmdir(heldOriginal);
        await fs.rename(directory, outsideVictim);
        return;
      }
      await fs.rmdir(directory);
    },
  });
  const manager = await value.restart({ directoryGuard });
  value.state.onPhase = async (marker) => {
    if (marker.phase === 'target-published') throw new Error('force verified rollback cleanup');
  };
  const outcome = await executePlan(manager, await planCreate(manager, 884, 'Delete Isolation'));
  value.state.onPhase = null;
  assert.equal(outcome.state, 'rolled-back');
  assert.equal(swapObserved, true);
  assert.deepEqual(await fs.readdir(outsideVictim), []);
  assert.equal(await fs.readFile(path.join(outsideParent, 'victim-marker.txt'), 'utf8'), 'do-not-touch');
});

test('deterministic world cleanup tombstones resume after isolation and nested-file crash points', async (t) => {
  for (const crashPoint of ['after-isolation', 'after-child-delete']) {
    await t.test(crashPoint, async (st) => {
      const value = await fixture(st);
      const active = (await value.manager.inventory()).activeWorldRef;
      let crashed = false;
      let activeGuards = 0;
      const directoryGuard = async (directory) => {
        activeGuards += 1;
        let held = true;
        const finish = () => { if (held) { held = false; activeGuards -= 1; } };
        return {
          assertHeld() { if (!held) throw new Error(`directory guard for ${directory} was released`); },
          async release() { finish(); },
          async rename(destination) {
            await fs.rename(directory, destination);
            finish();
            if (!crashed && crashPoint === 'after-isolation' && path.basename(destination).startsWith('.delete-world-')) {
              crashed = true;
              throw new Error('simulated crash after cleanup isolation');
            }
          },
          async delete() { await fs.rmdir(directory); finish(); },
        };
      };
      const fileGuard = async (file) => {
        activeGuards += 1;
        let held = true;
        const finish = () => { if (held) { held = false; activeGuards -= 1; } };
        return {
          assertHeld() { if (!held) throw new Error(`file guard for ${file} was released`); },
          async release() { finish(); },
          async delete() {
            await fs.unlink(file);
            finish();
            if (!crashed && crashPoint === 'after-child-delete' && file.includes(`${path.sep}.delete-world-`)) {
              crashed = true;
              throw new Error('simulated crash after nested cleanup deletion');
            }
          },
          async replace(destination) { await fs.rename(file, destination); finish(); },
        };
      };
      const manager = await value.restart({ directoryGuard, fileGuard });
      value.state.onPhase = async (marker) => {
        if (marker.phase === 'target-published') throw new Error('force rollback cleanup');
      };
      const plan = await planClone(manager, 60_000 + (crashPoint === 'after-child-delete' ? 1 : 0), active, `Crash ${crashPoint}`);
      await assert.rejects(() => executePlan(manager, plan), (error) => error.code === 'WORLD_RECOVERY_REQUIRED');
      assert.equal(crashed, true);
      assert.equal(activeGuards, 0, 'cleanup failure must release every rebound and peer guard');
      // The production crash boundary stops the process before the outer HTTP
      // handler can persist its best-effort manual-recovery operation record.
      await fs.rm(path.join(
        value.directory, '.mastermind', 'worlds', 'operations', `${plan.requestId}.json`,
      ), { force: true });
      value.state.onPhase = null;
      const restarted = await value.restart();
      const operation = await restarted.operation(FAMILY_ID, plan.requestId);
      assert.equal(operation.state, 'rolled-back');
      const storageEntries = await fs.readdir(path.join(value.directory, '.mastermind', 'worlds', 'storage'));
      assert.equal(storageEntries.some((entry) => entry.startsWith('.delete-') || entry.startsWith('.staging-')), false);
      assert.equal(await fs.readFile(path.join(value.activeRoot, 'identity.txt'), 'utf8'), 'original-world');
    });
  }
});

test('native Windows guards complete a nonempty clone rollback cleanup', { skip: process.platform !== 'win32' }, async (t) => {
  const value = await fixture(t);
  const activeGuards = new Map();
  const trackGuard = (target, guard) => {
    const key = path.resolve(target);
    activeGuards.set(key, (activeGuards.get(key) ?? 0) + 1);
    let consumed = false;
    const finish = () => {
      if (consumed) return;
      consumed = true;
      const remaining = (activeGuards.get(key) ?? 1) - 1;
      if (remaining === 0) activeGuards.delete(key); else activeGuards.set(key, remaining);
    };
    const invoke = (name) => async (...args) => {
      try { return await guard[name](...args); } finally { finish(); }
    };
    return {
      assertHeld: () => guard.assertHeld(),
      release: invoke('release'),
      ...(typeof guard.delete === 'function' ? { delete: invoke('delete') } : {}),
      ...(typeof guard.rename === 'function' ? { rename: invoke('rename') } : {}),
      ...(typeof guard.replace === 'function' ? { replace: invoke('replace') } : {}),
    };
  };
  const trackedDirectoryGuard = async (directory) => {
    try { return trackGuard(directory, await acquireWindowsDirectoryGuard(directory)); }
    catch (error) { throw new Error(`native directory guard failed for ${directory}`, { cause: error }); }
  };
  trackedDirectoryGuard.batch = async (directories) => {
    try {
      const guards = await acquireWindowsDirectoryGuard.batch(directories);
      return guards.map((guard, index) => trackGuard(directories[index], guard));
    } catch (error) {
      throw new Error(`native directory guard batch failed for ${directories.join(', ')}`, { cause: error });
    }
  };
  const trackedFileGuard = async (file) => {
    try { return trackGuard(file, await acquireWindowsFileGuard(file, { unlink: fs.unlink, rename: fs.rename })); }
    catch (error) { throw new Error(`native file guard failed for ${file}`, { cause: error }); }
  };
  trackedFileGuard.batch = async (files) => {
    try {
      const guards = await acquireWindowsFileGuard.batch(files, { unlink: fs.unlink, rename: fs.rename });
      return guards.map((guard, index) => trackGuard(files[index], guard));
    } catch (error) {
      throw new Error(`native file guard batch failed for ${files.join(', ')}`, { cause: error });
    }
  };
  const manager = await value.restart({
    directoryGuard: trackedDirectoryGuard,
    fileGuard: trackedFileGuard,
  });
  assert.deepEqual([...activeGuards], [], `native initialization leaked guards: ${JSON.stringify([...activeGuards])}`);
  const active = (await manager.inventory()).activeWorldRef;
  value.state.onPhase = async (marker) => {
    if (marker.phase === 'target-published') throw new Error('force native rollback cleanup');
  };
  const outcome = await executePlan(manager, await planClone(manager, 60_100, active, 'Native Cleanup'));
  value.state.onPhase = null;
  assert.equal(outcome.state, 'rolled-back');
  const storageEntries = await fs.readdir(path.join(value.directory, '.mastermind', 'worlds', 'storage'));
  assert.equal(storageEntries.some((entry) => entry.startsWith('.delete-') || entry.startsWith('.staging-')), false);
  assert.equal(await fs.readFile(path.join(value.activeRoot, 'identity.txt'), 'utf8'), 'original-world');
  assert.deepEqual([...activeGuards], [], `native rollback cleanup leaked guards: ${JSON.stringify([...activeGuards])}`);
});

test('uses batched directory chains while preserving injected single-guard fallbacks', async (t) => {
  const value = await fixture(t);
  let batchCalls = 0;
  let singleCalls = 0;
  let active = 0;
  const makeGuard = (target) => {
    active += 1;
    let held = true;
    const finish = () => { if (held) { held = false; active -= 1; } };
    return {
      assertHeld() { if (!held) throw new Error(`guard for ${target} was released`); },
      async release() { finish(); },
      async rename(destination) { await fs.rename(target, destination); finish(); },
      async delete() { await fs.rmdir(target); finish(); },
    };
  };
  const directoryGuard = async (target) => { singleCalls += 1; return makeGuard(target); };
  directoryGuard.batch = async (targets) => {
    batchCalls += 1;
    return targets.map((target) => makeGuard(target));
  };
  const manager = await value.restart({ directoryGuard });
  await manager.inventory();
  assert.ok(batchCalls > 0, 'multi-directory ancestor chains should use the shared batch capability');
  assert.ok(singleCalls > 0, 'newly admitted leaf directories retain the single-guard dependency contract');
  assert.equal(active, 0, 'every batched and single directory guard must be released');
});

test('uses batched file guards for bounded rollback cleanup', async (t) => {
  const value = await fixture(t);
  let fileBatchCalls = 0;
  let activeGuards = 0;
  const makeDirectoryGuard = (target) => {
    activeGuards += 1;
    let held = true;
    const finish = () => { if (held) { held = false; activeGuards -= 1; } };
    return {
      assertHeld() { if (!held) throw new Error(`directory guard for ${target} was released`); },
      async release() { finish(); },
      async rename(destination) { await fs.rename(target, destination); finish(); },
      async delete() { await fs.rmdir(target); finish(); },
    };
  };
  const makeFileGuard = (target) => {
    activeGuards += 1;
    let held = true;
    const finish = () => { if (held) { held = false; activeGuards -= 1; } };
    return {
      assertHeld() { if (!held) throw new Error(`file guard for ${target} was released`); },
      async release() { finish(); },
      async delete() { await fs.unlink(target); finish(); },
      async replace(destination) { await fs.rename(target, destination); finish(); },
    };
  };
  const directoryGuard = async (target) => makeDirectoryGuard(target);
  directoryGuard.batch = async (targets) => targets.map((target) => makeDirectoryGuard(target));
  const fileGuard = async (target) => makeFileGuard(target);
  fileGuard.batch = async (targets) => {
    fileBatchCalls += 1;
    return targets.map((target) => makeFileGuard(target));
  };
  const manager = await value.restart({ directoryGuard, fileGuard });
  const active = (await manager.inventory()).activeWorldRef;
  value.state.onPhase = async (marker) => {
    if (marker.phase === 'target-published') throw new Error('force batched rollback cleanup');
  };
  const outcome = await executePlan(manager, await planClone(manager, 60_101, active, 'Batched Cleanup'));
  value.state.onPhase = null;
  assert.equal(outcome.state, 'rolled-back');
  assert.ok(fileBatchCalls > 0, 'sibling cleanup files should use the shared file batch capability');
  assert.equal(activeGuards, 0, 'every batched cleanup guard must be terminally consumed or released');
});

test('tampering with an authenticated catalog fails closed and cannot be repaired from attacker-controlled data', async (t) => {
  const value = await fixture(t);
  const catalogFile = path.join(value.directory, '.mastermind', 'worlds', 'catalog.json');
  const signed = JSON.parse(await fs.readFile(catalogFile, 'utf8'));
  signed.worlds[0].displayLabel = 'Attacker Label';
  await fs.writeFile(catalogFile, `${JSON.stringify(signed)}\n`);
  await assert.rejects(() => value.manager.inventory(), (error) => error.code === 'WORLD_STATE_UNAVAILABLE');
});

test('a syntactically valid but unauthenticated recovery marker is never used to rename world paths', async (t) => {
  const value = await fixture(t);
  const transactionRef = `worldtx-${'b'.repeat(64)}`;
  const transactionFile = path.join(value.directory, '.mastermind', 'worlds', 'transactions', `${transactionRef}.json`);
  const key = await fs.readFile(path.join(value.managedRoot, 'state', 'family-worlds', 'hmac.key'));
  const catalogSigned = JSON.parse(await fs.readFile(path.join(value.directory, '.mastermind', 'worlds', 'catalog.json'), 'utf8'));
  const catalog = structuredClone(catalogSigned);
  delete catalog.mac;
  const marker = signRecord(key, {
    schemaVersion: 1,
    instanceId: FAMILY_ID,
    transactionRef,
    requestId: uuid(500),
    planId: `worldplan-${'c'.repeat(64)}`,
    planDigest: 'd'.repeat(64),
    operation: 'create',
    phase: 'intent',
    rescueBackupId: null,
    beforeCatalog: catalog,
    afterCatalog: null,
    expectedTargetDigest: null,
    createdAt: '2026-08-13T12:00:00.000Z',
    updatedAt: '2026-08-13T12:00:00.000Z',
    failureCode: null,
  });
  marker.mac = '0'.repeat(64);
  await fs.writeFile(transactionFile, `${JSON.stringify(marker)}\n`);
  await assert.rejects(() => value.restart(), (error) => error.code === 'WORLD_STATE_UNAVAILABLE');
  assert.equal(await fs.readFile(path.join(value.activeRoot, 'identity.txt'), 'utf8'), 'original-world');
});
