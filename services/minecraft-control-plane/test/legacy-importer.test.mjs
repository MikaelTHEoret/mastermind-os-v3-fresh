import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { discoverLegacyFamilyInstances, importLegacyFamilyInstance } from '../src/legacy-importer.mjs';
import { InstanceStore } from '../src/store.mjs';

async function fixture(t, overrides = {}) {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-legacy-import-'));
  const instanceId = overrides.instanceId ?? 'family-home';
  const levelName = overrides.levelName ?? 'world';
  const source = path.join(dataRoot, 'servers', instanceId);
  const legacyRecord = {
    id: instanceId,
    displayName: 'Family Home',
    kind: 'server',
    minecraftVersion: '1.21.4',
    loader: 'fabric',
    loaderVersion: '0.16.10',
    memoryMb: 4096,
    serverPort: 25565,
    status: 'stopped',
    directory: 'C:\\legacy\\path-that-must-not-be-trusted',
    createdAt: '2025-01-02T03:04:05.000Z',
    ...overrides.record,
  };
  await fs.mkdir(path.join(source, levelName, 'region'), { recursive: true });
  await fs.mkdir(path.join(source, 'mods'), { recursive: true });
  await fs.writeFile(path.join(source, levelName, 'level.dat'), Buffer.from([0, 1, 2, 3, 255, 254, 10]));
  await fs.writeFile(path.join(source, levelName, 'region', 'r.0.0.mca'), Buffer.from('region-bytes\0more', 'utf8'));
  await fs.writeFile(path.join(source, 'mods', 'custom-family-mod.jar'), Buffer.from([80, 75, 3, 4, 20, 0, 9, 8, 7]));
  await fs.writeFile(path.join(source, 'server.properties'), `server-port=25565\nlevel-name=${levelName}\n`, 'utf8');
  await fs.mkdir(path.join(dataRoot, 'state'), { recursive: true });
  await fs.writeFile(path.join(dataRoot, 'state', 'instances.json'), `${JSON.stringify({ schemaVersion: 1, instances: [legacyRecord] }, null, 2)}\n`);

  const managedRoot = path.join(dataRoot, 'projects', 'family-server');
  const store = new InstanceStore(managedRoot);
  if (overrides.initializeStore !== false) await store.initialize();
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  return { dataRoot, instanceId, source, managedRoot, store, legacyRecord };
}

async function snapshot(root) {
  const result = new Map();
  async function walk(directory, prefix = '') {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relative = prefix ? path.join(prefix, entry.name) : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute, relative);
      else result.set(relative, await fs.readFile(absolute));
    }
  }
  await walk(root);
  return result;
}

function assertSnapshotEqual(expected, actual) {
  assert.deepEqual([...actual.keys()], [...expected.keys()]);
  for (const [name, contents] of expected) assert.deepEqual(actual.get(name), contents, name);
}

test('discovers a legacy Family Server without writing or exposing a local path', async (t) => {
  const { dataRoot, source } = await fixture(t, { initializeStore: false });
  const before = await snapshot(source);
  const candidates = await discoverLegacyFamilyInstances(dataRoot);
  assert.deepEqual(candidates, [{
    id: 'family-home', displayName: 'Family Home', kind: 'server', minecraftVersion: '1.21.4', memoryMb: 4096, serverPort: 25565,
  }]);
  assert.equal(JSON.stringify(candidates).includes(dataRoot), false);
  assertSnapshotEqual(before, await snapshot(source));
  assert.equal(await fs.stat(path.join(dataRoot, 'projects')).then(() => true, () => false), false);
});

test('imports the full instance and verifies its world while leaving the legacy source untouched', async (t) => {
  const { dataRoot, instanceId, source, managedRoot, store } = await fixture(t);
  const before = await snapshot(source);
  const result = await importLegacyFamilyInstance({ dataRoot, store, instanceId });
  assert.equal(result.imported, true);

  const destination = path.join(managedRoot, 'servers', instanceId);
  const after = await snapshot(source);
  assertSnapshotEqual(before, after);
  const copied = await snapshot(destination);
  copied.delete(path.join('.mastermind', 'legacy-source.json'));
  assertSnapshotEqual(before, copied);

  const record = await store.get(instanceId);
  assert.equal(record.projectId, 'family-server');
  assert.equal(record.status, 'stopped');
  assert.equal(record.pid, null);
  assert.equal(record.provisioningStatus, 'legacy-update-required');
  assert.equal(record.minecraftVersion, '1.21.4');
  assert.equal(record.javaPort, 25565);
  assert.equal(record.serverPort, 25565);
  assert.equal(record.bedrockPort, 19132);
  assert.equal(record.update.state, 'minecraft-update-approval-required');
  assert.equal(record.updateState, 'minecraft-update-approval-required');
  assert.equal(record.directory, destination);
  assert.equal(JSON.stringify(record).includes('path-that-must-not-be-trusted'), false);
  assert.equal(JSON.stringify(record).includes(source), false);

  const marker = JSON.parse(await fs.readFile(path.join(destination, '.mastermind', 'legacy-source.json'), 'utf8'));
  assert.equal(marker.sourceDirectory, source);
  assert.match(marker.worldSha256, /^[a-f0-9]{64}$/);
  assert.match(marker.sourceTreeSha256, /^[a-f0-9]{64}$/);
  assert.equal(marker.levelName, 'world');
  assert.equal(record.migration.levelName, 'world');
});

test('discovers and imports the level-name world instead of assuming the folder is world', async (t) => {
  const value = await fixture(t, { levelName: 'family-map' });
  assert.equal((await discoverLegacyFamilyInstances(value.dataRoot)).length, 1);
  const result = await importLegacyFamilyInstance({
    dataRoot: value.dataRoot,
    store: value.store,
    instanceId: value.instanceId,
  });
  assert.equal(result.imported, true);
  assert.equal(result.instance.migration.levelName, 'family-map');
  assert.deepEqual(
    await fs.readFile(path.join(value.managedRoot, 'servers', value.instanceId, 'family-map', 'level.dat')),
    Buffer.from([0, 1, 2, 3, 255, 254, 10]),
  );
});

test('refuses to copy a legacy server that is recorded active or still owns its Java port', async (t) => {
  const recordedActive = await fixture(t, { instanceId: 'recorded-active', record: { status: 'running' } });
  await assert.rejects(
    () => importLegacyFamilyInstance({
      dataRoot: recordedActive.dataRoot,
      store: recordedActive.store,
      instanceId: recordedActive.instanceId,
    }),
    /must be stopped/,
  );

  const livePort = await fixture(t, { instanceId: 'live-port' });
  await assert.rejects(
    () => importLegacyFamilyInstance({
      dataRoot: livePort.dataRoot,
      store: livePort.store,
      instanceId: livePort.instanceId,
      isLegacyActive: async ({ id, serverPort, status }) => (
        id === livePort.instanceId && serverPort === 25565 && status === 'stopped'
      ),
    }),
    /still owns its Java server port/,
  );
});

test('rejects traversal IDs from both requested input and legacy state', async (t) => {
  const { dataRoot, store } = await fixture(t);
  await assert.rejects(
    () => importLegacyFamilyInstance({ dataRoot, store, instanceId: '../escape' }),
    /Invalid legacy instance id/,
  );
  await fs.writeFile(path.join(dataRoot, 'state', 'instances.json'), JSON.stringify({ instances: [{ id: '../escape', kind: 'server' }] }));
  await assert.rejects(() => discoverLegacyFamilyInstances(dataRoot), /invalid/);
  assert.equal(await fs.stat(path.join(dataRoot, 'escape')).then(() => true, () => false), false);
});

test('is idempotent and does not overwrite a duplicate import or an existing destination', async (t) => {
  const first = await fixture(t);
  const imported = await importLegacyFamilyInstance({ dataRoot: first.dataRoot, store: first.store, instanceId: first.instanceId });
  assert.equal(imported.imported, true);
  const duplicate = await importLegacyFamilyInstance({ dataRoot: first.dataRoot, store: first.store, instanceId: first.instanceId });
  assert.deepEqual(duplicate, { imported: false, reason: 'managed-store-not-empty', instance: null });

  const second = await fixture(t, { instanceId: 'existing-family' });
  const destination = path.join(second.managedRoot, 'servers', second.instanceId);
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(path.join(destination, 'do-not-overwrite.txt'), 'kept');
  const noOp = await importLegacyFamilyInstance({ dataRoot: second.dataRoot, store: second.store, instanceId: second.instanceId });
  assert.deepEqual(noOp, { imported: false, reason: 'destination-exists', instance: null });
  assert.equal(await fs.readFile(path.join(destination, 'do-not-overwrite.txt'), 'utf8'), 'kept');
  assert.equal((await second.store.list()).length, 0);
});

test('rolls back the copied destination if the managed store commit fails', async (t) => {
  const { dataRoot, instanceId, source, managedRoot } = await fixture(t);
  const before = await snapshot(source);
  const failingStore = {
    async list() { return []; },
    async create() { throw new Error('simulated store failure'); },
  };
  await assert.rejects(
    () => importLegacyFamilyInstance({ dataRoot, store: failingStore, instanceId }),
    /simulated store failure/,
  );
  assert.equal(await fs.stat(path.join(managedRoot, 'servers', instanceId)).then(() => true, () => false), false);
  assertSnapshotEqual(before, await snapshot(source));
  const serverEntries = await fs.readdir(path.join(managedRoot, 'servers'));
  assert.deepEqual(serverEntries, []);
});
