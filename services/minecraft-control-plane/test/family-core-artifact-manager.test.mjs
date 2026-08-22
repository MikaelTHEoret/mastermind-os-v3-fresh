import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  FamilyCoreArtifactManager,
  FAMILY_CORE_PROMOTION_CONFIRMATION,
  FAMILY_CORE_ROLLBACK_CONFIRMATION,
} from '../src/family-core-artifact-manager.mjs';

const BACKUP_ID = 'bkp-0123456789abcdef0123456789abcdef';

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'family-core-artifact-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const managedRoot = path.join(root, 'managed');
  const serverRoot = path.join(managedRoot, 'servers', 'family-server');
  const mods = path.join(serverRoot, 'mods');
  const buildRoot = path.join(root, 'build');
  await fs.mkdir(mods, { recursive: true });
  await fs.mkdir(buildRoot, { recursive: true });
  for (const name of ['fabric-api.jar', 'geyser-fabric.jar', 'floodgate-fabric.jar']) {
    await fs.writeFile(path.join(mods, name), Buffer.alloc(32, name.charCodeAt(0)));
  }
  const instance = {
    id: 'family-server', projectId: 'family-server', kind: 'server', directory: serverRoot,
    minecraftVersion: '26.2', loaderVersion: '0.19.3', javaRuntime: { major: 25 },
  };
  const key = Buffer.alloc(32, 7);
  const store = { async get(id) { return id === instance.id ? structuredClone(instance) : null; } };
  let quiescenceChecks = 0;
  let locks = 0;
  const managerOptions = {
    withInstanceLock: async (id, operation) => {
      assert.equal(id, instance.id); locks += 1;
      try { return await operation(); } finally { locks -= 1; }
    },
    assertQuiescentWithinInstanceLock: async (id) => {
      assert.equal(id, instance.id); assert.equal(locks, 1); quiescenceChecks += 1; return true;
    },
    assertVerifiedBackupWithinInstanceLock: async (id, backupId) => {
      assert.equal(id, instance.id); assert.equal(backupId, BACKUP_ID); assert.equal(locks, 1);
      return { backupId, integrity: 'verified' };
    },
    acquireIntegrityKey: async () => ({ key, assertHeld: async () => true, release: async () => undefined }),
    inspectArtifact: async (file) => path.basename(file) === 'family-core.jar'
      ? [{ ids: ['mastermind-family-core'], version: '0.2.0', depends: {}, breaks: {}, conflicts: {} }]
      : [{ ids: [path.basename(file, '.jar')], version: '1.0.0', depends: {}, breaks: {}, conflicts: {} }],
    validateGraph: ({ artifacts, coreMetadata, minecraftVersion, loaderVersion, javaMajor }) => {
      assert.equal(artifacts[0].metadata[0].ids[0], 'mastermind-family-core');
      assert.equal(coreMetadata.length, 3);
      assert.equal(minecraftVersion, '26.2'); assert.equal(loaderVersion, '0.19.3'); assert.equal(javaMajor, 25);
      return true;
    },
    now: (() => {
      let tick = 0;
      return () => new Date(Date.UTC(2026, 7, 21, 12, 0, tick++)).toISOString();
    })(),
  };
  const makeManager = () => new FamilyCoreArtifactManager(managedRoot, store, managerOptions);
  const manager = makeManager();
  await manager.initialize();
  const candidate = path.join(buildRoot, 'family-core.jar');
  const bytes = Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(60, 3)]);
  await fs.writeFile(candidate, bytes);
  return { manager, managedRoot, mods, candidate, bytes, key, makeManager, getQuiescenceChecks: () => quiescenceChecks };
}

test('promotes a pinned Family Core artifact and exposes a schema-v2 launch binding', async (t) => {
  const value = await fixture(t);
  const result = await value.manager.promote({
    sourcePath: value.candidate,
    expectedSha256: sha256(value.bytes),
    expectedSize: value.bytes.length,
    backupId: BACKUP_ID,
    confirmation: FAMILY_CORE_PROMOTION_CONFIRMATION,
  });
  assert.equal(result.action, 'promoted');
  assert.equal(value.getQuiescenceChecks(), 1);
  assert.deepEqual(await fs.readFile(path.join(value.mods, 'mastermind-family-core.jar')), value.bytes);
  const status = await value.manager.status();
  assert.equal(status.state, 'installed');
  assert.equal(status.artifact.sha256, sha256(value.bytes));
  assert.equal(status.rollbackAvailable, false);
  const capability = await value.manager.acquireLaunchBindingWithinInstanceLock();
  assert.equal(capability.binding.schemaVersion, 2);
  assert.equal(capability.binding.artifacts.length, 1);
  assert.equal(capability.binding.artifacts[0].fileName, 'mastermind-family-core.jar');
  await capability.assertHeld();
  await capability.release();
  await assert.rejects(() => capability.assertHeld(), { code: 'FAMILY_CORE_STATE_UNAVAILABLE' });
});

test('rejects a candidate whose bytes do not match the pinned identity before mutation', async (t) => {
  const value = await fixture(t);
  await assert.rejects(() => value.manager.promote({
    sourcePath: value.candidate,
    expectedSha256: '0'.repeat(64),
    expectedSize: value.bytes.length,
    backupId: BACKUP_ID,
    confirmation: FAMILY_CORE_PROMOTION_CONFIRMATION,
  }), { code: 'FAMILY_CORE_ARTIFACT_INVALID' });
  await assert.rejects(() => fs.lstat(path.join(value.mods, 'mastermind-family-core.jar')), { code: 'ENOENT' });
  assert.equal(value.getQuiescenceChecks(), 0);
});

test('rolls the first promotion back to the disabled state with generation binding', async (t) => {
  const value = await fixture(t);
  const promoted = await value.manager.promote({
    sourcePath: value.candidate,
    expectedSha256: sha256(value.bytes),
    expectedSize: value.bytes.length,
    backupId: BACKUP_ID,
    confirmation: FAMILY_CORE_PROMOTION_CONFIRMATION,
  });
  await assert.rejects(() => value.manager.rollback({
    expectedGeneration: 'f'.repeat(64), confirmation: FAMILY_CORE_ROLLBACK_CONFIRMATION,
  }), { code: 'FAMILY_CORE_STATE_CHANGED' });
  const rolledBack = await value.manager.rollback({
    expectedGeneration: promoted.manifest.generation,
    confirmation: FAMILY_CORE_ROLLBACK_CONFIRMATION,
  });
  assert.equal(rolledBack.action, 'disabled');
  assert.equal((await value.manager.status()).state, 'disabled');
  await assert.rejects(() => fs.lstat(path.join(value.mods, 'mastermind-family-core.jar')), { code: 'ENOENT' });
});

test('fails closed when an unmanaged Family Core JAR appears', async (t) => {
  const value = await fixture(t);
  await fs.writeFile(path.join(value.mods, 'mastermind-family-core.jar'), value.bytes);
  await assert.rejects(() => value.manager.status(), { code: 'FAMILY_CORE_UNMANAGED' });
  await assert.rejects(() => value.manager.acquireLaunchBindingWithinInstanceLock(), { code: 'FAMILY_CORE_UNMANAGED' });
});

test('reconciles a crash after candidate publication from the authenticated transaction marker', async (t) => {
  const value = await fixture(t);
  await value.manager.promote({
    sourcePath: value.candidate,
    expectedSha256: sha256(value.bytes),
    expectedSize: value.bytes.length,
    backupId: BACKUP_ID,
    confirmation: FAMILY_CORE_PROMOTION_CONFIRMATION,
  });
  const manifestFile = path.join(value.managedRoot, 'state', 'first-party-core', 'manifests', 'family-server.v2.json');
  const wrapper = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  const previousManifest = wrapper.manifest;
  const nextBytes = Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(64, 8)]);
  const nextSha256 = sha256(nextBytes);
  const registry = path.join(value.managedRoot, 'state', 'first-party-core', 'artifacts', `${nextSha256}.jar`);
  await fs.writeFile(registry, nextBytes);
  const active = {
    ...previousManifest.active,
    sha256: nextSha256,
    size: nextBytes.length,
    version: '0.2.1',
    registryRelativePath: `state/first-party-core/artifacts/${nextSha256}.jar`,
    promotedAt: '2026-08-21T13:00:00.000Z',
  };
  const identity = {
    schemaVersion: 2,
    instanceId: 'family-server',
    active,
    previous: previousManifest.active,
    updatedAt: '2026-08-21T13:00:01.000Z',
  };
  const nextManifest = { ...identity, generation: sha256(Buffer.from(canonical(identity))) };
  const transactionId = '12345678-1234-4123-8123-123456789abc';
  const transaction = {
    schemaVersion: 2,
    transactionId,
    instanceId: 'family-server',
    phase: 'prepared',
    previousManifest,
    nextManifest,
    temporaryFileName: `.mastermind-family-core.jar.${transactionId}.tmp`,
    previousFileName: `${transactionId}.previous.jar`,
    createdAt: '2026-08-21T13:00:02.000Z',
    updatedAt: '2026-08-21T13:00:02.000Z',
  };
  const transactionRoot = path.join(value.managedRoot, 'state', 'first-party-core', 'transactions');
  const target = path.join(value.mods, 'mastermind-family-core.jar');
  await fs.rename(target, path.join(transactionRoot, transaction.previousFileName));
  await fs.writeFile(target, nextBytes);
  await fs.writeFile(path.join(transactionRoot, `${transactionId}.v2.json`), JSON.stringify({
    schemaVersion: 2,
    transaction,
    mac: crypto.createHmac('sha256', value.key)
      .update(`family-core-transaction-v2\n${canonical(transaction)}`).digest('hex'),
  }));
  const recreated = value.makeManager();
  const recovered = await recreated.initialize();
  assert.equal(recovered.state, 'installed');
  assert.equal(recovered.artifact.sha256, nextSha256);
  assert.deepEqual(await fs.readFile(target), nextBytes);
  assert.deepEqual(await fs.readdir(transactionRoot), []);
});
