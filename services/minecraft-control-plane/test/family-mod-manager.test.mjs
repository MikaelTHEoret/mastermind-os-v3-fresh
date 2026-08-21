import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FamilyModManager, FAMILY_MOD_CONFIRMATIONS } from '../src/family-mod-manager.mjs';

const FAMILY_ID = 'family-server';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) { let value = index; for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1); table[index] = value >>> 0; }
  return table;
})();
function crc32(bytes) { let value = 0xffffffff; for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8); return (value ^ 0xffffffff) >>> 0; }
function zip(entries) {
  const locals = []; const centrals = []; let offset = 0;
  for (const [name, content] of entries) {
    const n = Buffer.from(name); const bytes = Buffer.from(content); const crc = crc32(bytes);
    const local = Buffer.alloc(30 + n.length + bytes.length); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt32LE(crc, 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(n.length, 26); n.copy(local, 30); bytes.copy(local, 30 + n.length);
    const central = Buffer.alloc(46 + n.length); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x314, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt32LE(crc, 16); central.writeUInt32LE(bytes.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE((0x81a4 << 16) >>> 0, 38); central.writeUInt32LE(offset, 42); n.copy(central, 46);
    locals.push(local); centrals.push(central); offset += local.length;
  }
  const directory = Buffer.concat(centrals); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
function jar(id, version, depends = {}) { return zip([['fabric.mod.json', JSON.stringify({ schemaVersion: 1, id, version, environment: 'server', depends })]]); }
function sha512(bytes) { return crypto.createHash('sha512').update(bytes).digest('hex'); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

async function snapshotTree(root) {
  const rows = [];
  const visit = async (directory, prefix = '') => {
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error?.code === 'ENOENT') return; throw error; }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const target = path.join(directory, entry.name);
      const stat = await fs.lstat(target);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        rows.push({ relative, kind: 'directory' });
        await visit(target, relative);
      } else if (entry.isFile() && !entry.isSymbolicLink()) {
        rows.push({ relative, kind: 'file', size: stat.size, digest: sha512(await fs.readFile(target)) });
      } else rows.push({ relative, kind: 'unsupported' });
    }
  };
  await visit(root);
  return rows;
}

class MemoryStore {
  constructor(value) { this.value = structuredClone(value); }
  async get(id) { return id === this.value.id ? structuredClone(this.value) : null; }
}

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-family-mods-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'servers', 'family-server'); const mods = path.join(directory, 'mods');
  await fs.mkdir(mods, { recursive: true });
  const core = {
    fabricApi: jar('fabric-api', '0.157.0+26.2'),
    geyser: jar('geyser-fabric', '2.11.1-SNAPSHOT', { 'fabric-api': '*' }),
    floodgate: jar('floodgate', '2.2.6-SNAPSHOT', { 'fabric-api': '*' }),
  };
  await fs.writeFile(path.join(mods, 'fabric-api.jar'), core.fabricApi);
  await fs.writeFile(path.join(mods, 'geyser-fabric.jar'), core.geyser);
  await fs.writeFile(path.join(mods, 'floodgate-fabric.jar'), core.floodgate);
  const component = (versionId, versionNumber, bytes) => ({ versionId, versionNumber, sourceHash: { algorithm: 'sha512', value: sha512(bytes) } });
  const instance = {
    id: 'family-server', projectId: 'family-server', kind: 'server', loader: 'fabric', minecraftVersion: '26.2', loaderVersion: '0.19.3', requiredJavaMajor: 25,
    components: { fabricApi: component('FAPI0001', '0.157.0+26.2', core.fabricApi), geyser: component('GEYS0001', '2.11.1-SNAPSHOT', core.geyser), floodgate: component('FLOD0001', '2.2.6-SNAPSHOT', core.floodgate) },
    directory, status: 'stopped', pid: null, managedProcess: null,
  };
  const artifact = jar('examplemod', '1.0.0', { 'fabric-api': '*' });
  const state = { locks: 0, lockDepth: 0, downloads: 0 };
  const client = {
    async search() { return { totalHits: 1, items: [{ projectId: 'AAAABBBB', title: 'Example Mod', description: 'Safe fixture', author: 'Fixture' }] }; },
    async project() { return { projectId: 'AAAABBBB', title: 'Example Mod', description: 'Safe fixture', author: 'Fixture', license: 'MIT' }; },
    async resolveGraph() { return { totalBytes: artifact.length, nodes: [{
      projectId: 'AAAABBBB', versionId: 'VER00001', title: 'Example Mod', version: '1.0.0', environment: 'server_only',
      publishedAt: '2026-08-01T00:00:00.000Z', relationship: 'requested', requiredProjectIds: [],
      file: { size: artifact.length, sha512: sha512(artifact), sourceUrl: 'private-test-value' },
    }] }; },
    async download(_node, target) { state.downloads += 1; await fs.writeFile(target, artifact, { flag: 'wx', mode: 0o600 }); },
  };
  const store = new MemoryStore(instance);
  const makeManager = (overrides = {}) => new FamilyModManager(root, store, client, {
    withInstanceLock: async (_id, operation) => {
      state.locks += 1; state.lockDepth += 1;
      try { return await operation(); } finally { state.lockDepth -= 1; }
    },
    assertQuiescentWithinInstanceLock: async () => structuredClone(instance),
    assertWorldMutationAllowedWithinInstanceLock: options.assertWorldMutationAllowedWithinInstanceLock ?? (async () => true),
    randomBytes: (size) => Buffer.alloc(size, 7),
    now: options.now ?? (() => '2026-08-13T12:00:00.000Z'), onPhase: options.onPhase, statfs: options.statfs,
    platform: 'linux',
    filesystemEntryVerifier: async () => ({ ok: true, checked: false }),
    directoryGuard: async (directory) => ({ assertHeld() {}, async release() {}, async rename(target) { await fs.rename(directory, target); } }),
    fileGuard: async (file) => ({ assertHeld() {}, async release() {}, async delete() { await fs.unlink(file); }, async rename(target) { await fs.rename(file, target); }, async replace(target) { await fs.rename(file, target); } }),
    ...overrides,
  });
  const manager = makeManager();
  if (options.initialize !== false) await manager.initialize();
  return { root, directory, mods, instance, manager, state, makeManager };
}

async function installPlan(value, requestId = '11111111-1111-4111-8111-111111111111') {
  const search = await value.manager.search('family-server', { query: 'map', offset: 0, limit: 20 });
  return value.manager.createPlan('family-server', { requestId, operation: 'install', catalogRef: search.catalog.candidates[0].catalogRef });
}

async function writeEmptyFiles(directory, prefix, count) {
  for (let offset = 0; offset < count; offset += 64) {
    await Promise.all(Array.from({ length: Math.min(64, count - offset) }, (_, index) => (
      fs.writeFile(path.join(directory, `${prefix}-${String(offset + index).padStart(4, '0')}.jar`), '')
    )));
  }
}

test('prepares only the authenticated stack verifier before recovery initialization', async (t) => {
  const value = await fixture(t, { initialize: false });
  await value.manager.prepareStackValidation();
  const stateRoot = path.join(value.root, 'state', 'family-mods');
  assert.deepEqual(await fs.readdir(path.join(stateRoot, 'manifests')), []);
  assert.deepEqual(await fs.readdir(path.join(stateRoot, 'plans')), []);
  assert.deepEqual(await fs.readdir(path.join(stateRoot, 'transactions')), []);
  assert.deepEqual(await value.manager.preflightRecoveryEvidence(), { domain: 'mods', instances: [] });
  await assert.rejects(() => value.makeManager({ assertWorldMutationAllowedWithinInstanceLock: null }).initialize(),
    (error) => error.code === 'MOD_STATE_UNAVAILABLE');
  assert.deepEqual(await fs.readdir(path.join(stateRoot, 'plans')), []);
});

test('Windows rejects every managed mod mutation before lock, download, or durable state changes', async (t) => {
  const value = await fixture(t, { initialize: false });
  const manager = value.makeManager({ platform: 'win32' });
  await manager.initialize();
  const stateRoot = path.join(value.root, 'state', 'family-mods');
  const before = await snapshotTree(stateRoot);
  await assert.rejects(() => manager.createPlan(FAMILY_ID, {
    requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    operation: 'install',
    catalogRef: `modref-${'a'.repeat(64)}`,
  }), (error) => error.code === 'MOD_MUTATION_UNAVAILABLE');
  await assert.rejects(() => manager.execute(FAMILY_ID, {
    requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    planId: `modplan-${'b'.repeat(64)}`,
    confirmation: FAMILY_MOD_CONFIRMATIONS.install,
  }), (error) => error.code === 'MOD_MUTATION_UNAVAILABLE');
  assert.deepEqual(await snapshotTree(stateRoot), before);
  assert.equal(value.state.locks, 0);
  assert.equal(value.state.downloads, 0);
});

test('a missing core-only manifest does not require a native file guard', async (t) => {
  const value = await fixture(t, { initialize: false });
  const bootstrap = value.makeManager();
  await bootstrap.initialize();
  let missingFileGuardCalls = 0;
  const manager = value.makeManager({
    fileGuard: async (file) => {
      try { await fs.lstat(file); }
      catch (error) {
        if (error?.code === 'ENOENT') {
          missingFileGuardCalls += 1;
          throw Object.assign(new Error('native file guard cannot acquire an absent file'), {
            code: 'WORLD_INTEGRITY_FAILED', statusCode: 409,
          });
        }
        throw error;
      }
      return { assertHeld() {}, async release() {} };
    },
  });
  await manager.initialize();
  const capability = await manager.acquireLaunchBindingWithinInstanceLock(FAMILY_ID);
  assert.deepEqual(capability.binding.mods, []);
  assert.equal(missingFileGuardCalls, 0);
  await capability.assertHeld();
  await capability.release();
});

test('post-initialization key replacement fences lifecycle and start before live mod reads', async (t) => {
  const value = await fixture(t);
  const before = (await fs.readdir(value.mods)).sort();
  await fs.writeFile(path.join(value.root, 'state', 'family-mods', 'hmac.key'), Buffer.alloc(32, 31));
  await assert.rejects(() => value.manager.assertSafeForLifecycle({ instanceId: FAMILY_ID }),
    (error) => error.code === 'MOD_STATE_UNAVAILABLE');
  await assert.rejects(() => value.manager.assertStartAllowedWithinInstanceLock(FAMILY_ID),
    (error) => error.code === 'MOD_STATE_UNAVAILABLE');
  assert.deepEqual((await fs.readdir(value.mods)).sort(), before);
});

test('post-initialization key deletion fences lifecycle and inventory before managed state reads', async (t) => {
  const value = await fixture(t);
  const before = (await fs.readdir(value.mods)).sort();
  await fs.rm(path.join(value.root, 'state', 'family-mods', 'hmac.key'));
  await assert.rejects(() => value.manager.assertSafeForLifecycle({ instanceId: FAMILY_ID }),
    (error) => error.code === 'MOD_STATE_UNAVAILABLE');
  await assert.rejects(() => value.manager.inventory(FAMILY_ID),
    (error) => error.code === 'MOD_STATE_UNAVAILABLE');
  assert.deepEqual((await fs.readdir(value.mods)).sort(), before);
});

test('launch binding rejects a coordinated key, manifest, and managed user-JAR replacement', async (t) => {
  const value = await fixture(t);
  const plan = await installPlan(value);
  await value.manager.execute(FAMILY_ID, {
    requestId: plan.requestId, planId: plan.planId, confirmation: FAMILY_MOD_CONFIRMATIONS.install,
  });
  const capability = await value.manager.acquireLaunchBindingWithinInstanceLock(FAMILY_ID);
  assert.equal(capability.binding.mods.length, 1);
  await capability.assertHeld();

  const replacement = jar('replacement', '9.9.9', { 'fabric-api': '*' });
  const mod = capability.binding.mods[0];
  await fs.writeFile(path.join(value.mods, mod.fileName), replacement);
  const newKey = Buffer.alloc(32, 0x5a);
  const keyFile = path.join(value.root, 'state', 'family-mods', 'hmac.key');
  await fs.writeFile(keyFile, newKey);
  const manifestFile = path.join(value.root, 'state', 'family-mods', 'manifests', `${FAMILY_ID}.json`);
  const wrapper = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  Object.assign(wrapper.manifest.mods[0], { sha512: sha512(replacement), size: replacement.length });
  wrapper.manifest.generation = crypto.createHash('sha256').update('coordinated replacement').digest('hex');
  wrapper.mac = crypto.createHmac('sha256', newKey).update(canonical(wrapper.manifest)).digest('hex');
  await fs.writeFile(manifestFile, JSON.stringify(wrapper));

  await assert.rejects(() => capability.assertHeld(), (error) => error.code === 'MOD_STATE_UNAVAILABLE');
  await capability.release();
});

test('recovery preflight keeps every ancestor guard held during authenticated file reads and releases on failure', async (t) => {
  const value = await fixture(t, { initialize: false });
  const activeDirectories = new Map();
  let guardedFileReads = 0;
  const normalize = (target) => path.resolve(target).toLocaleLowerCase('en-US');
  const directoryGuard = async (directory) => {
    const key = normalize(directory);
    assert.equal(activeDirectories.has(key), false, `duplicate guard acquisition for ${directory}`);
    let held = true;
    activeDirectories.set(key, directory);
    return {
      assertHeld() { assert.equal(held, true); assert.equal(activeDirectories.has(key), true); },
      async release() { assert.equal(held, true); held = false; activeDirectories.delete(key); },
      async rename(target) { assert.equal(held, true); await fs.rename(directory, target); },
    };
  };
  const fileGuard = async (file) => {
    const parent = normalize(path.dirname(file));
    assert.equal(activeDirectories.has(parent), true, `file parent was not guarded: ${file}`);
    guardedFileReads += 1;
    let held = true;
    return {
      assertHeld() { assert.equal(held, true); },
      async release() { assert.equal(held, true); held = false; },
      async delete() { assert.equal(held, true); await fs.unlink(file); },
      async rename(target) { assert.equal(held, true); await fs.rename(file, target); },
      async replace(target) { assert.equal(held, true); await fs.rename(file, target); },
    };
  };
  const filesystemEntryVerifier = async (target) => {
    const resolved = normalize(target);
    assert.equal([...activeDirectories.keys()].some((directory) => resolved === directory || resolved.startsWith(`${directory}${path.sep}`)), true,
      `entry verification escaped held ancestors: ${target}`);
    return { ok: true, checked: true };
  };
  const manager = value.makeManager({ directoryGuard, fileGuard, filesystemEntryVerifier });
  await manager.prepareStackValidation();
  assert.deepEqual(await manager.preflightRecoveryEvidence(), { domain: 'mods', instances: [] });
  const transaction = path.join(value.root, 'state', 'family-mods', 'transactions', FAMILY_ID, `modtx-${'c'.repeat(64)}`);
  await fs.mkdir(transaction, { recursive: true });
  await fs.writeFile(path.join(transaction, 'marker.json'), '{}');
  await assert.rejects(() => manager.preflightRecoveryEvidence(), /Invalid mod transaction marker/);
  assert.ok(guardedFileReads >= 2, 'the key and marker must both be read through file guards');
  assert.equal(activeDirectories.size, 0, 'every directory guard must be released after rejection');
});

test('creates a verified install plan idempotently and rejects request-id payload conflicts', async (t) => {
  const value = await fixture(t);
  const search = await value.manager.search('family-server', { query: 'map', offset: 0, limit: 20 });
  const request = { requestId: '11111111-1111-4111-8111-111111111111', operation: 'install', catalogRef: search.catalog.candidates[0].catalogRef };
  const plan = await value.manager.createPlan('family-server', request);
  assert.match(plan.planId, /^modplan-[a-f0-9]{64}$/); assert.equal(plan.changes.install[0].versionNumber, '1.0.0');
  assert.deepEqual(await value.manager.createPlan('family-server', request), plan);
  await assert.rejects(() => value.manager.createPlan('family-server', {
    requestId: plan.requestId, operation: 'rollback', transactionRef: `modtx-${'a'.repeat(64)}`,
  }), /requestId|different mod plan/i);
});

test('refuses plan staging when free-space reservation cannot be proven', async (t) => {
  const value = await fixture(t, { statfs: async () => ({ bavail: 1, bsize: 4096 }) });
  const search = await value.manager.search('family-server', { query: 'map', offset: 0, limit: 20 });
  await assert.rejects(() => value.manager.createPlan('family-server', {
    requestId: '44444444-4444-4444-8444-444444444444', operation: 'install', catalogRef: search.catalog.candidates[0].catalogRef,
  }), (error) => error.code === 'MOD_PLAN_QUOTA_EXCEEDED');
  assert.deepEqual((await fs.readdir(path.join(value.root, 'state', 'family-mods', 'plans', 'family-server'))).sort(), ['requests']);
});

test('bounded active-plan quota rejects the ninth plan before another staging directory is made', async (t) => {
  const value = await fixture(t);
  const planRoot = path.join(value.root, 'state', 'family-mods', 'plans', 'family-server');
  let search;
  for (let index = 0; index < 8; index += 1) {
    search = await value.manager.search('family-server', { query: 'map', offset: 0, limit: 20 });
    await value.manager.createPlan('family-server', {
      requestId: `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`, operation: 'install', catalogRef: search.catalog.candidates[0].catalogRef,
    });
  }
  search = await value.manager.search('family-server', { query: 'map', offset: 0, limit: 20 });
  await assert.rejects(() => value.manager.createPlan('family-server', {
    requestId: '55555555-5555-4555-8555-555555555555', operation: 'install', catalogRef: search.catalog.candidates[0].catalogRef,
  }), (error) => error.code === 'MOD_PLAN_QUOTA_EXCEEDED');
  assert.equal((await fs.readdir(planRoot)).length, 9);
  assert.equal((await fs.readdir(planRoot)).includes('55555555-5555-4555-8555-555555555555'), false);
});

test('expired action is durably reconciled as rejected before mutation', async (t) => {
  let current = '2026-08-13T12:00:00.000Z';
  const value = await fixture(t, { now: () => current }); const plan = await installPlan(value);
  current = '2026-08-13T12:11:00.000Z';
  await assert.rejects(() => value.manager.execute('family-server', {
    requestId: plan.requestId, planId: plan.planId, confirmation: FAMILY_MOD_CONFIRMATIONS.install,
  }), (error) => error.code === 'MOD_PLAN_EXPIRED');
  const operation = await value.manager.operation('family-server', plan.requestId);
  assert.equal(operation.state, 'rejected-before-mutation'); assert.equal(operation.application, 'not-applied');
});

test('unmanaged JARs block plans and Minecraft stack updates', async (t) => {
  const value = await fixture(t); await fs.writeFile(path.join(value.mods, 'operator.jar'), jar('operator', '1.0.0'));
  const search = await value.manager.search('family-server', { query: 'map', offset: 0, limit: 20 });
  await assert.rejects(() => value.manager.createPlan('family-server', { requestId: '22222222-2222-4222-8222-222222222222', operation: 'install', catalogRef: search.catalog.candidates[0].catalogRef }), /Unmanaged/i);
  await assert.rejects(() => value.manager.assertStackUpdateAllowedWithinInstanceLock(), (error) => error.code === 'MODS_BLOCK_MINECRAFT_UPDATE');
});

test('the launch mod scan rejects limit-plus-one entries before hashing attacker files', async (t) => {
  const value = await fixture(t);
  await writeEmptyFiles(value.mods, 'attacker', 498);
  await assert.rejects(() => value.manager.acquireLaunchBindingWithinInstanceLock(FAMILY_ID), (error) => {
    assert.equal(error.code, 'MOD_INTEGRITY_FAILED');
    assert.match(error.message, /safe entry limit/i);
    return true;
  });
});

test('zero-byte staging entries cannot bypass the recursive plan-tree quota', async (t) => {
  const value = await fixture(t);
  const rogue = path.join(
    value.root, 'state', 'family-mods', 'plans', FAMILY_ID, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  );
  const left = path.join(rogue, 'left');
  const right = path.join(rogue, 'right');
  await fs.mkdir(left, { recursive: true });
  await fs.mkdir(right);
  await writeEmptyFiles(left, 'zero-byte-left', 500);
  await writeEmptyFiles(right, 'zero-byte-right', 501);
  await assert.rejects(() => installPlan(value), (error) => {
    assert.equal(error.code, 'MOD_STATE_UNAVAILABLE');
    assert.match(error.message, /safe entry bound/i);
    return true;
  });
  assert.equal((await fs.readdir(left)).length + (await fs.readdir(right)).length, 1001);
});

test('commits an exact stopped-only install once under concurrent execute replay', async (t) => {
  const value = await fixture(t); const plan = await installPlan(value);
  const input = { requestId: plan.requestId, planId: plan.planId, confirmation: FAMILY_MOD_CONFIRMATIONS.install };
  const [left, right] = await Promise.all([value.manager.execute('family-server', input), value.manager.execute('family-server', input)]);
  assert.equal(left.state, 'committed'); assert.deepEqual(right, left);
  const inventory = await value.manager.inventory('family-server');
  assert.equal(inventory.installed.length, 1); assert.equal(inventory.installed[0].role, 'explicit'); assert.equal(inventory.unmanaged.count, 0);
  assert.equal(value.state.downloads, 1);
});

test('restores the verified pre-transaction snapshot when publication phase fails', async (t) => {
  let failed = false;
  const value = await fixture(t, { onPhase: async (phase) => { if (phase === 'candidate-published' && !failed) { failed = true; throw new Error('simulated crash'); } } });
  const plan = await installPlan(value);
  const result = await value.manager.execute('family-server', { requestId: plan.requestId, planId: plan.planId, confirmation: FAMILY_MOD_CONFIRMATIONS.install });
  assert.equal(result.state, 'rolled-back');
  assert.deepEqual((await fs.readdir(value.mods)).sort(), ['fabric-api.jar', 'floodgate-fabric.jar', 'geyser-fabric.jar']);
});

test('a committed install can be rolled back only from its unchanged post-transaction stack', async (t) => {
  const value = await fixture(t); const install = await installPlan(value);
  const committed = await value.manager.execute('family-server', { requestId: install.requestId, planId: install.planId, confirmation: FAMILY_MOD_CONFIRMATIONS.install });
  const rollback = await value.manager.createPlan('family-server', { requestId: '33333333-3333-4333-8333-333333333333', operation: 'rollback', transactionRef: committed.transactionRef });
  const restored = await value.manager.execute('family-server', { requestId: rollback.requestId, planId: rollback.planId, confirmation: FAMILY_MOD_CONFIRMATIONS.rollback });
  assert.equal(restored.state, 'committed'); assert.equal((await value.manager.inventory('family-server')).installed.length, 0);
});

test('prewrite audit failure causes zero live mutation', async (t) => {
  const value = await fixture(t); const plan = await installPlan(value);
  const before = (await fs.readdir(value.mods)).sort();
  const audit = path.join(value.root, 'state', 'family-mods', 'audit.jsonl');
  await fs.rm(audit); await fs.mkdir(audit);
  await assert.rejects(() => value.manager.execute('family-server', {
    requestId: plan.requestId, planId: plan.planId, confirmation: FAMILY_MOD_CONFIRMATIONS.install,
  }), (error) => error.code === 'MOD_AUDIT_UNAVAILABLE');
  assert.deepEqual((await fs.readdir(value.mods)).sort(), before);
});

test('restart reconciles a committed marker over a durable completion-unknown operation', async (t) => {
  let crash = true;
  const value = await fixture(t, { onPhase: async (phase) => { if (phase === 'committed' && crash) { crash = false; throw new Error('crash after committed marker'); } } });
  const plan = await installPlan(value);
  await assert.rejects(() => value.manager.execute('family-server', {
    requestId: plan.requestId, planId: plan.planId, confirmation: FAMILY_MOD_CONFIRMATIONS.install,
  }), (error) => error.code === 'MOD_COMPLETION_UNKNOWN');
  const restarted = value.makeManager({ onPhase: async () => undefined });
  const recovery = await restarted.initialize();
  assert.equal(recovery[0].action, 'committed');
  assert.equal((await restarted.operation('family-server', plan.requestId)).state, 'committed');
});

test('startup recovery checks the world interlock under the instance lock before touching a nonterminal transaction', async (t) => {
  let crash = true;
  const value = await fixture(t, {
    onPhase: async (phase) => {
      if (phase === 'committed' && crash) { crash = false; throw new Error('simulated crash after durable commit'); }
    },
  });
  const plan = await installPlan(value);
  await assert.rejects(() => value.manager.execute('family-server', {
    requestId: plan.requestId, planId: plan.planId, confirmation: FAMILY_MOD_CONFIRMATIONS.install,
  }), (error) => error.code === 'MOD_COMPLETION_UNKNOWN');
  const transactionRoot = path.join(value.root, 'state', 'family-mods', 'transactions', 'family-server');
  const transactionRef = (await fs.readdir(transactionRoot)).find((name) => name.startsWith('modtx-'));
  assert.ok(transactionRef);
  const markerFile = path.join(transactionRoot, transactionRef, 'marker.json');
  const marker = JSON.parse(await fs.readFile(markerFile, 'utf8'));
  marker.phase = 'manifest-committed';
  const unsigned = structuredClone(marker); delete unsigned.mac;
  const key = await fs.readFile(path.join(value.root, 'state', 'family-mods', 'hmac.key'));
  marker.mac = crypto.createHmac('sha256', key).update(canonical(unsigned)).digest('hex');
  await fs.writeFile(markerFile, `${JSON.stringify(marker)}\n`);
  const markerBefore = await fs.readFile(markerFile);
  const liveBefore = (await fs.readdir(value.mods)).sort();
  let checkedInsideLock = false;
  const restarted = value.makeManager({
    onPhase: async () => undefined,
    assertWorldMutationAllowedWithinInstanceLock: async () => {
      checkedInsideLock = value.state.lockDepth > 0;
      throw Object.assign(new Error('An inactive or recovery-fenced world blocks mod recovery.'), {
        code: 'MOD_WORLD_STATE_BLOCKED', statusCode: 409,
      });
    },
  });
  await restarted.prepareStackValidation();
  assert.deepEqual(await restarted.preflightRecoveryEvidence(), {
    domain: 'mods', instances: [{ instanceId: 'family-server', transactionRef }],
  });
  assert.deepEqual(await fs.readFile(markerFile), markerBefore);
  const recovery = await restarted.initialize();
  assert.equal(checkedInsideLock, true);
  assert.equal(recovery[0].action, 'manual-recovery-required');
  assert.deepEqual(await fs.readFile(markerFile), markerBefore);
  assert.deepEqual((await fs.readdir(value.mods)).sort(), liveBefore);
  await assert.rejects(() => restarted.assertSafeForLifecycle({ instanceId: 'family-server' }),
    (error) => error.code === 'MOD_MANUAL_RECOVERY_REQUIRED');
});

test('corrupt audit chain fences initialization and leaves outside files untouched', async (t) => {
  const value = await fixture(t); const plan = await installPlan(value);
  await value.manager.execute('family-server', { requestId: plan.requestId, planId: plan.planId, confirmation: FAMILY_MOD_CONFIRMATIONS.install });
  const victim = path.join(value.root, 'victim.txt'); await fs.writeFile(victim, 'unchanged');
  const audit = path.join(value.root, 'state', 'family-mods', 'audit.jsonl');
  const bytes = await fs.readFile(audit); bytes[Math.floor(bytes.length / 2)] ^= 1; await fs.writeFile(audit, bytes);
  await assert.rejects(() => value.makeManager({ onPhase: async () => undefined }).initialize(), (error) => error.code === 'MOD_AUDIT_UNAVAILABLE');
  assert.equal(await fs.readFile(victim, 'utf8'), 'unchanged');
});

test('key symlink is rejected and never reads or changes the outside victim', async (t) => {
  const value = await fixture(t); const stateRoot = path.join(value.root, 'state', 'family-mods');
  const key = path.join(stateRoot, 'hmac.key'); const victim = path.join(value.root, 'victim.key');
  await fs.writeFile(victim, Buffer.alloc(32, 9)); await fs.rm(key);
  try { await fs.symlink(victim, key, 'file'); } catch (error) { if (['EPERM', 'EACCES'].includes(error?.code)) return t.skip('symlink creation unavailable'); throw error; }
  await assert.rejects(() => value.makeManager().initialize(), (error) => error.code === 'MOD_STATE_UNAVAILABLE');
  assert.deepEqual(await fs.readFile(victim), Buffer.alloc(32, 9));
});
