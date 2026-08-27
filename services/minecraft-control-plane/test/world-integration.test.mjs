import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createControlPlane } from '../src/agent.mjs';
import { FamilyServerBackupManager } from '../src/backup-manager.mjs';
import { FamilyModManager } from '../src/family-mod-manager.mjs';
import { ServerProvisioner } from '../src/provisioner.mjs';
import { InstanceStore } from '../src/store.mjs';
import { FamilyServerUpdateManager } from '../src/update-manager.mjs';
import { minecraftServerJar } from './server-jar-fixture.mjs';

const TOKEN = 'world-integration-token-0123456789-abcdef';
const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';

function defaultWorlds() {
  return {
    async initialize() { return []; },
    async assertMutationAllowedWithinInstanceLock() { return true; },
    async assertStackUpdateAllowedWithinInstanceLock() { return true; },
    async assertModMutationAllowedWithinInstanceLock() { return true; },
    async reconcileGeneratedWorldWithinInstanceLock() { return false; },
  };
}

async function controlPlaneFixture(t, extra = {}) {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-world-integration-agent-'));
  const app = await createControlPlane({
    config: { host: '127.0.0.1', port: 43100, token: TOKEN, dataRoot, javaExecutable: process.execPath },
    verifyInstall: async () => ({ ok: true }),
    inspectProcessState: async () => ({ process: null, tcp: { known: true, occupied: false, owner: null } }),
    worlds: extra.worlds ?? defaultWorlds(),
    worldRecovery: [],
    ...extra,
  });
  const address = await app.listen(0);
  t.after(async () => {
    await app.close();
    await fs.rm(dataRoot, { recursive: true, force: true });
  });
  return { app, dataRoot, baseUrl: `http://127.0.0.1:${address.port}` };
}

test('agent exposes exact Family-only world routes and redacts unexpected manager failures', async (t) => {
  const worldRef = `world-${'a'.repeat(64)}`;
  const planId = `worldplan-${'b'.repeat(64)}`;
  const calls = [];
  let inventoryFailure = null;
  const inventory = {
    generation: 'c'.repeat(64),
    inventoryDigest: 'd'.repeat(64),
    recovery: { required: false, state: null, transactionRef: null },
    activeWorldRef: worldRef,
    worlds: [{ worldRef, displayLabel: 'Family World', state: 'active' }],
    limits: { maxWorlds: 12, maxWorldBytes: 17_179_869_184, maxTotalBytes: 68_719_476_736 },
  };
  const operation = {
    requestId: REQUEST_ID,
    planId,
    operation: 'create',
    state: 'completion-unknown',
    application: 'unknown',
  };
  const worlds = {
    ...defaultWorlds(),
    async inventory(id) {
      calls.push(['inventory', id]);
      if (inventoryFailure) throw inventoryFailure;
      return inventory;
    },
    async operation(id, requestId) { calls.push(['operation', id, requestId]); return operation; },
    async createPlan(id, input) { calls.push(['plan', id, input]); return { planId, requestId: input.requestId, operation: input.operation }; },
    async execute(id, input) { calls.push(['execute', id, input]); return operation; },
  };
  const { baseUrl } = await controlPlaneFixture(t, { worlds });
  const headers = { Authorization: `Bearer ${TOKEN}` };

  const listed = await fetch(`${baseUrl}/v1/instances/family-server/worlds`, { headers });
  assert.equal(listed.status, 200);
  assert.deepEqual(await listed.json(), { ok: true, instanceId: 'family-server', ...inventory });

  const wrongInstance = await fetch(`${baseUrl}/v1/instances/other-server/worlds`, { headers });
  assert.equal(wrongInstance.status, 400);
  assert.equal((await wrongInstance.json()).code, 'WORLD_INVALID_INSTANCE');

  const planInput = { requestId: REQUEST_ID, operation: 'create', displayLabel: 'Fresh World' };
  const planned = await fetch(`${baseUrl}/v1/instances/family-server/worlds/plans`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(planInput),
  });
  assert.equal(planned.status, 201);
  assert.equal((await planned.json()).plan.planId, planId);

  const actionInput = { requestId: REQUEST_ID, planId, confirmation: 'CREATE NEW WORLD' };
  const executed = await fetch(`${baseUrl}/v1/instances/family-server/worlds/actions`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(actionInput),
  });
  assert.equal(executed.status, 202);
  assert.equal((await executed.json()).operation.state, 'completion-unknown');

  const reconciled = await fetch(`${baseUrl}/v1/instances/family-server/worlds/operations/${REQUEST_ID}`, { headers });
  assert.equal(reconciled.status, 200);
  assert.equal((await reconciled.json()).operation.requestId, REQUEST_ID);

  const uppercaseRef = await fetch(`${baseUrl}/v1/instances/family-server/worlds/operations/${REQUEST_ID.toUpperCase()}`, { headers });
  assert.equal(uppercaseRef.status, 400);
  assert.equal((await uppercaseRef.json()).code, 'WORLD_INVALID_REQUEST');

  const secretPath = 'C:\\Users\\Private\\family-world\\level.dat';
  inventoryFailure = Object.assign(new Error(`EACCES ${secretPath}`), { code: 'EACCES' });
  const unexpected = await fetch(`${baseUrl}/v1/instances/family-server/worlds`, { headers });
  assert.equal(unexpected.status, 500);
  const unexpectedBody = await unexpected.json();
  assert.deepEqual(unexpectedBody, {
    ok: false,
    code: 'WORLD_OPERATION_FAILED',
    message: 'The Family Server world request failed safely.',
  });
  assert.equal(JSON.stringify(unexpectedBody).includes(secretPath), false);

  inventoryFailure = Object.assign(new Error('The active world changed after planning.'), {
    code: 'WORLD_INVALID_STATE', statusCode: 409,
  });
  const aliased = await fetch(`${baseUrl}/v1/instances/family-server/worlds`, { headers });
  assert.equal(aliased.status, 409);
  assert.deepEqual(await aliased.json(), {
    ok: false,
    code: 'WORLD_SOURCE_CHANGED',
    message: 'The active world changed after planning.',
  });

  assert.deepEqual(calls.slice(0, 4), [
    ['inventory', 'family-server'],
    ['plan', 'family-server', planInput],
    ['execute', 'family-server', actionInput],
    ['operation', 'family-server', REQUEST_ID],
  ]);
});

test('Family Server start runs the world fence inside the lifecycle lock after update checks and before spawn', async (t) => {
  const events = [];
  let insideLock = false;
  const processes = {
    async withInstanceLock(id, operation) {
      assert.equal(id, 'family-server');
      insideLock = true;
      events.push('lock');
      try { return await operation(); } finally { insideLock = false; }
    },
    async startWithinInstanceLock() {
      assert.equal(insideLock, true);
      events.push('spawn');
      return { id: 'family-server', projectId: 'family-server', kind: 'server', status: 'running', pid: 42 };
    },
    async isActive() { return false; },
    async shutdown() {},
  };
  const updater = {
    async check() { assert.equal(insideLock, true); events.push('update-check'); return { state: 'current', requiresApproval: false }; },
    async reconcileInterruptedTransactions() { return []; },
    setModInterlock() {},
    setStackInterlock() {},
    async markReady() {},
  };
  const mods = {
    async initialize() { return []; },
    async assertStartAllowedWithinInstanceLock() { assert.equal(insideLock, true); events.push('mod-fence'); },
    async assertStackUpdateAllowedWithinInstanceLock() {},
  };
  const worlds = {
    ...defaultWorlds(),
    async assertMutationAllowedWithinInstanceLock() { assert.equal(insideLock, true); events.push('world-fence'); },
  };
  const { baseUrl } = await controlPlaneFixture(t, {
    processes,
    processRecovery: [],
    updater,
    updateRecovery: [],
    mods,
    modRecovery: [],
    worlds,
    backups: {},
    backupRecovery: [],
    administration: { async initialize() {} },
  });

  const response = await fetch(`${baseUrl}/v1/instances/family-server/start`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(events, ['lock', 'mod-fence', 'update-check', 'world-fence', 'spawn']);
});

test('legacy world metadata defers startup initialization, then migrates before the start world fence', async (t) => {
  const events = [];
  let insideLock = false;
  let metadataReady = false;
  const processes = {
    async withInstanceLock(id, operation) {
      assert.equal(id, 'family-server'); insideLock = true; events.push('lock');
      try { return await operation(); } finally { insideLock = false; }
    },
    async startWithinInstanceLock() {
      assert.equal(insideLock, true); assert.equal(metadataReady, true); events.push('spawn');
      return { id: 'family-server', projectId: 'family-server', kind: 'server', status: 'running', pid: 42 };
    },
    async isActive() { return false; },
    async shutdown() {},
  };
  const updater = {
    async check() { assert.equal(insideLock, true); events.push('update-check'); return { state: 'component-update-available', requiresApproval: false }; },
    async updateWithinInstanceLock() { assert.equal(insideLock, true); metadataReady = true; events.push('metadata-migration'); return { action: 'updated' }; },
    async reconcileInterruptedTransactions() { return []; }, setModInterlock() {}, setStackInterlock() {}, async markReady() {},
  };
  const mods = {
    async initialize() { return []; },
    async assertStartAllowedWithinInstanceLock() { assert.equal(insideLock, true); events.push('mod-fence'); },
    async assertStackUpdateAllowedWithinInstanceLock() {},
  };
  const worlds = {
    ...defaultWorlds(),
    async initialize() { events.push('world-init-deferred'); return [{ instanceId: 'family-server', action: 'deferred-version-metadata-migration' }]; },
    async assertMutationAllowedWithinInstanceLock() {
      assert.equal(insideLock, true); assert.equal(metadataReady, true); events.push('world-fence');
    },
  };
  const { baseUrl } = await controlPlaneFixture(t, {
    processes, processRecovery: [], updater, updateRecovery: [], mods, modRecovery: [], worlds,
    worldRecovery: undefined, backups: {}, backupRecovery: [], administration: { async initialize() {} },
  });
  const response = await fetch(`${baseUrl}/v1/instances/family-server/start`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(events, [
    'world-init-deferred', 'lock', 'mod-fence', 'update-check', 'metadata-migration', 'world-fence', 'spawn',
  ]);
});

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

test('backup rescue stays inside the caller lock, captures private world state, and excludes the external world key', async (t) => {
  const managedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-world-integration-backup-'));
  t.after(() => fs.rm(managedRoot, { recursive: true, force: true }));
  const directory = path.join(managedRoot, 'servers', 'family-server');
  await fs.mkdir(path.join(directory, 'world'), { recursive: true });
  await fs.mkdir(path.join(directory, '.mastermind', 'worlds'), { recursive: true });
  await fs.mkdir(path.join(directory, 'mods'), { recursive: true });
  await fs.mkdir(path.join(directory, 'config', 'Geyser-Fabric'), { recursive: true });
  await fs.mkdir(path.join(managedRoot, 'state', 'family-worlds'), { recursive: true });
  await fs.writeFile(path.join(directory, 'world', 'level.dat'), 'world-data');
  await fs.writeFile(path.join(directory, 'world', 'session.lock'), 'volatile');
  await fs.writeFile(path.join(directory, '.mastermind', 'worlds', 'catalog.json'), '{"private":"catalog"}\n');
  await fs.writeFile(path.join(directory, 'server.properties'), 'online-mode=true\nlevel-name=world\nserver-port=25565\n');
  await fs.writeFile(path.join(managedRoot, 'state', 'family-worlds', 'hmac.key'), 'external-world-hmac-key-material');
  const managedFiles = [
    'fabric-server-launch.jar',
    'mods/fabric-api.jar',
    'mods/geyser-fabric.jar',
    'mods/floodgate-fabric.jar',
    'config/Geyser-Fabric/config.yml',
  ];
  for (const relative of managedFiles) {
    const file = path.join(directory, ...relative.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `managed:${relative}`);
  }
  await fs.writeFile(path.join(directory, 'instance.json'), `${JSON.stringify({
    schemaVersion: 3,
    artifacts: managedFiles.map((fileName) => ({ fileName })),
  })}\n`);
  const store = new MemoryStore({
    id: 'family-server',
    displayName: 'Family Server',
    projectId: 'family-server',
    kind: 'server',
    directory,
    status: 'stopped',
    pid: null,
    managedProcess: null,
    provisioningStatus: 'ready',
    minecraftVersion: '26.2',
    worldDataVersion: 4550,
    minecraftServerArtifact: {
      minecraftVersion: '26.2', worldDataVersion: 4550,
      relativePath: 'versions/26.2/server-26.2.jar', size: 1024,
      sha1: 'a'.repeat(40), sha256: 'b'.repeat(64),
    },
    loader: 'fabric',
    loaderVersion: '0.19.3',
    installerVersion: '1.1.2',
    requiredJavaMajor: 25,
    artifacts: managedFiles.map((fileName) => ({ fileName })),
  });
  let insideCallerLock = false;
  let nestedLockCalls = 0;
  let worldFenceCalls = 0;
  const manager = new FamilyServerBackupManager(managedRoot, store, {
    withInstanceLock: async () => {
      nestedLockCalls += 1;
      throw new Error('rescue attempted to reacquire the lifecycle lock');
    },
    assertQuiescentWithinInstanceLock: async (id) => {
      assert.equal(insideCallerLock, true);
      return store.get(id);
    },
    assertWorldMutationAllowedWithinInstanceLock: async (id) => {
      assert.equal(id, 'family-server');
      assert.equal(insideCallerLock, true);
      worldFenceCalls += 1;
    },
    verifyInstall: async () => ({ ok: true }),
    currentWorldStackBindingWithinInstanceLock: async () => ({ generation: 'a'.repeat(64), inventoryDigest: 'b'.repeat(64) }),
    validateRestoredWorldWithinInstanceLock: async (_id, expected) => structuredClone(expected),
    filesystemTreeVerifier: async () => ({ ok: true, checked: false }),
    directoryGuard: async (directory) => ({
      assertHeld() {}, async release() {}, async rename(destination) { await fs.rename(directory, destination); },
    }),
    fileGuard: async (file) => ({
      assertHeld() {},
      async delete() { await fs.unlink(file); },
      async rename(destination) { await fs.rename(file, destination); },
      async replace(destination) { await fs.rename(file, destination); },
      async release() {},
    }),
    now: () => '2026-08-13T12:00:00.000Z',
    randomBytes: (size) => Buffer.alloc(size, 9),
  });
  await manager.initialize();

  insideCallerLock = true;
  let rescue;
  try { rescue = await manager.createRescueWithinInstanceLock('family-server'); }
  finally { insideCallerLock = false; }

  assert.equal(nestedLockCalls, 0);
  assert.equal(worldFenceCalls, 1);
  assert.equal(rescue.kind, 'rescue');
  const payload = path.join(managedRoot, 'operator-backups', 'snapshots', 'family-server', rescue.backupId, 'payload');
  assert.equal(await fs.readFile(path.join(payload, '.mastermind', 'worlds', 'catalog.json'), 'utf8'), '{"private":"catalog"}\n');
  await assert.rejects(() => fs.access(path.join(payload, 'state', 'family-worlds', 'hmac.key')), (error) => error.code === 'ENOENT');
  await assert.rejects(() => fs.access(path.join(payload, 'world', 'session.lock')), (error) => error.code === 'ENOENT');
});

function updateComponents(label, hashByte) {
  return Object.fromEntries(['fabricApi', 'geyser', 'floodgate'].map((name) => [name, {
    versionId: `${label}-${name}`,
    versionNumber: `${label}-${name}`,
    versionType: name === 'geyser' ? 'beta' : 'release',
    sourceHash: { algorithm: 'sha512', value: hashByte.repeat(128) },
  }]));
}

test('updater passes the exact target stack identity to the world interlock under lock before staging or publish', async (t) => {
  const managedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-world-integration-update-'));
  t.after(() => fs.rm(managedRoot, { recursive: true, force: true }));
  const directory = path.join(managedRoot, 'servers', 'family-server');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'sentinel.txt'), 'live-instance');
  const oldComponents = updateComponents('old', 'a');
  const targetComponents = updateComponents('new', 'b');
  const targetServer = minecraftServerJar({ minecraftVersion: '26.3', worldDataVersion: 5000 });
  const store = new MemoryStore({
    id: 'family-server',
    displayName: 'Family Server',
    projectId: 'family-server',
    kind: 'server',
    updateChannel: 'latest-compatible',
    minecraftVersion: '26.2',
    latestMinecraftVersion: '26.2',
    minecraftReleaseTime: '2026-08-01T00:00:00.000Z',
    requiredJavaMajor: 25,
    javaRuntimeComponent: 'java-runtime-epsilon',
    loader: 'fabric',
    loaderVersion: '0.19.3',
    installerVersion: '1.1.2',
    components: oldComponents,
    directory,
    status: 'stopped',
    pid: null,
    managedProcess: null,
    provisioningStatus: 'ready',
  });
  const rawTarget = {
    projectId: 'family-server',
    updateChannel: 'latest-compatible',
    minecraftVersion: '26.3',
    latestMinecraftVersion: '26.3',
    minecraftReleaseTime: '2026-09-01T00:00:00.000Z',
    minecraftDirection: 'upgrade',
    requiredJavaMajor: 25,
    javaRuntimeComponent: 'java-runtime-epsilon',
    loaderVersion: '0.19.4',
    installerVersion: '1.1.3',
    minecraftServerArtifact: {
      minecraftVersion: '26.3', relativePath: 'versions/26.3/server-26.3.jar',
      size: targetServer.length, sha1: crypto.createHash('sha1').update(targetServer).digest('hex'),
    },
    components: targetComponents,
  };
  let insideLock = false;
  let prepareCalls = 0;
  const captured = [];
  const manager = new FamilyServerUpdateManager(managedRoot, store, {
    resolveTarget: async () => structuredClone(rawTarget),
    prepareCandidate: async () => { prepareCalls += 1; throw new Error('candidate staging must not start'); },
    isInstanceActive: async () => false,
    assertQuiescentWithinInstanceLock: async () => true,
    withInstanceLock: async (id, operation) => {
      assert.equal(id, 'family-server');
      insideLock = true;
      try { return await operation(); } finally { insideLock = false; }
    },
    assertStackUpdateAllowedWithinInstanceLock: async (id, target) => {
      assert.equal(insideLock, true);
      captured.push([id, structuredClone(target)]);
      throw Object.assign(new Error('Archived worlds block this stack update.'), {
        code: 'WORLDS_BLOCK_MINECRAFT_UPDATE', statusCode: 409,
      });
    },
  });
  const checked = await manager.check({ instanceId: 'family-server' });
  await assert.rejects(
    () => manager.update({
      instanceId: 'family-server',
      approval: { minecraftVersionChange: true, planId: checked.planId },
    }),
    (error) => error.code === 'WORLDS_BLOCK_MINECRAFT_UPDATE',
  );

  const expectedTarget = structuredClone(rawTarget);
  delete expectedTarget.minecraftDirection;
  assert.deepEqual(captured, [['family-server', expectedTarget]]);
  assert.equal(prepareCalls, 0);
  assert.equal(await fs.readFile(path.join(directory, 'sentinel.txt'), 'utf8'), 'live-instance');
  assert.deepEqual(await fs.readdir(path.join(managedRoot, 'backups')).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error)), []);
});

test('mod plan and action mutations invoke the world fence under the same instance lock', async (t) => {
  const managedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-world-integration-mods-'));
  t.after(() => fs.rm(managedRoot, { recursive: true, force: true }));
  const instance = {
    id: 'family-server',
    projectId: 'family-server',
    kind: 'server',
    loader: 'fabric',
    minecraftVersion: '26.2',
    loaderVersion: '0.19.3',
    directory: path.join(managedRoot, 'servers', 'family-server'),
    status: 'stopped',
    pid: null,
    managedProcess: null,
  };
  const store = new MemoryStore(instance);
  const client = {
    async search() { throw new Error('catalog must not run after the world fence'); },
    async resolveGraph() { throw new Error('resolution must not run after the world fence'); },
    async download() { throw new Error('download must not run after the world fence'); },
  };
  let lockDepth = 0;
  const events = [];
  const manager = new FamilyModManager(managedRoot, store, client, {
    platform: 'linux',
    withInstanceLock: async (id, operation) => {
      assert.equal(id, 'family-server');
      assert.equal(lockDepth, 0);
      lockDepth += 1;
      events.push('lock');
      try { return await operation(); } finally { lockDepth -= 1; }
    },
    assertQuiescentWithinInstanceLock: async (id) => {
      assert.equal(id, 'family-server');
      assert.equal(lockDepth, 1);
      events.push('quiescent');
      return store.get(id);
    },
    assertWorldMutationAllowedWithinInstanceLock: async (id) => {
      assert.equal(id, 'family-server');
      assert.equal(lockDepth, 1);
      events.push('world-fence');
      throw Object.assign(new Error('Stored worlds block mod mutation.'), {
        code: 'WORLDS_BLOCK_MOD_MUTATION', statusCode: 409,
      });
    },
    randomBytes: (size) => Buffer.alloc(size, 7),
  });
  await manager.initialize();

  await assert.rejects(
    () => manager.createPlan('family-server', {
      requestId: REQUEST_ID,
      operation: 'install',
      catalogRef: `modref-${'a'.repeat(64)}`,
    }),
    (error) => error.code === 'WORLDS_BLOCK_MOD_MUTATION',
  );
  await assert.rejects(
    () => manager.execute('family-server', {
      requestId: REQUEST_ID,
      planId: `modplan-${'b'.repeat(64)}`,
      confirmation: 'INSTALL THIRD-PARTY MOD CODE',
    }),
    (error) => error.code === 'WORLDS_BLOCK_MOD_MUTATION',
  );
  assert.deepEqual(events, [
    'lock', 'quiescent', 'world-fence',
    'lock', 'quiescent', 'world-fence',
  ]);
  assert.equal(lockDepth, 0);
});

function provisionVersion(name, bytes, versionNumber) {
  return [{
    id: `${name}-version`,
    version_number: versionNumber,
    version_type: name === 'geyser' ? 'beta' : 'release',
    files: [{
      primary: true,
      filename: `${name}.jar`,
      url: `https://cdn.modrinth.com/data/test/versions/${name}.jar`,
      size: bytes.length,
      hashes: { sha512: crypto.createHash('sha512').update(bytes).digest('hex') },
    }],
  }];
}

function provisioningFetcher() {
  const bytes = {
    fabricApi: Buffer.from('fabric-api-world-integration'),
    geyser: Buffer.from('geyser-world-integration'),
    floodgate: Buffer.from('floodgate-world-integration'),
    server: Buffer.from('fabric-server-world-integration'),
    officialServer: minecraftServerJar({ minecraftVersion: '26.2', worldDataVersion: 4903 }),
  };
  const officialSha1 = crypto.createHash('sha1').update(bytes.officialServer).digest('hex');
  return async (input) => {
    const url = String(input);
    if (url.includes('version_manifest_v2.json')) {
      return Response.json({
        latest: { release: '26.2' },
        versions: [{ id: '26.2', type: 'release', url: 'https://piston-meta.mojang.com/v1/packages/26.2.json' }],
      });
    }
    if (url === 'https://piston-meta.mojang.com/v1/packages/26.2.json') {
      return Response.json({ id: '26.2', downloads: { server: {
        url: `https://piston-data.mojang.com/v1/objects/${officialSha1}/server.jar`, sha1: officialSha1, size: bytes.officialServer.length,
      } }, javaVersion: { component: 'java-runtime-epsilon', majorVersion: 25 } });
    }
    if (url.includes('/versions/loader/') && !url.endsWith('/server/jar')) {
      return Response.json([{ loader: { version: '0.19.3', stable: true } }]);
    }
    if (url.endsWith('/versions/installer')) return Response.json([{ version: '1.1.2', stable: true }]);
    if (url.includes('/project/P7dR8mSH/version')) return Response.json(provisionVersion('fabricApi', bytes.fabricApi, '0.157.0+26.2'));
    if (url.includes('/project/wKkoqHrH/version')) return Response.json(provisionVersion('geyser', bytes.geyser, '2.11.1-b1219'));
    if (url.includes('/project/bWrNNfkb/version')) return Response.json(provisionVersion('floodgate', bytes.floodgate, '2.2.6-b67'));
    if (url === 'https://cdn.modrinth.com/data/test/versions/fabricApi.jar') return new Response(bytes.fabricApi);
    if (url === 'https://cdn.modrinth.com/data/test/versions/geyser.jar') return new Response(bytes.geyser);
    if (url === 'https://cdn.modrinth.com/data/test/versions/floodgate.jar') return new Response(bytes.floodgate);
    if (url.endsWith('/server/jar')) return new Response(bytes.server);
    if (url === `https://piston-data.mojang.com/v1/objects/${officialSha1}/server.jar`) return new Response(bytes.officialServer);
    return new Response('not found', { status: 404 });
  };
}

test('provisioning pins exactly level-name=world and publishes an empty physical world directory', async (t) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-world-integration-provision-'));
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const store = new InstanceStore(dataRoot);
  await store.initialize();
  const runtimeManager = {
    async ensure(major, component) {
      return {
        executable: path.join(dataRoot, 'runtimes', component, 'bin', 'java.exe'),
        component,
        major,
        version: '25.0.1',
        vendor: 'Mojang launcher runtime',
        managed: true,
        source: 'piston-meta.mojang.com',
        platform: 'windows-x64',
        manifestSha1: 'a'.repeat(40),
        executableRelativePath: 'bin/java.exe',
        installedAt: '2026-08-13T00:00:00.000Z',
      };
    },
  };
  const provisioner = new ServerProvisioner(dataRoot, store, provisioningFetcher(), { runtimeManager });
  const instance = await provisioner.provision({
    kind: 'family-server',
    projectId: 'family-server',
    instanceId: 'family-server',
    displayName: 'Family Server',
    memoryMb: 4096,
    eulaAccepted: true,
  });
  const properties = await fs.readFile(path.join(instance.directory, 'server.properties'), 'utf8');
  assert.deepEqual(properties.split(/\r?\n/).filter((line) => /^level-name\s*[=:]/.test(line)), ['level-name=world']);
  assert.deepEqual(await fs.readdir(path.join(instance.directory, 'world')), []);
  const worldStat = await fs.lstat(path.join(instance.directory, 'world'));
  assert.equal(worldStat.isDirectory(), true);
  assert.equal(worldStat.isSymbolicLink(), false);
});
