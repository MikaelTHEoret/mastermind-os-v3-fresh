import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FamilyServerUpdateManager, FAMILY_SERVER_MANAGED_ARTIFACTS } from '../src/update-manager.mjs';
import {
  createLegacyUpdateTerminalAttestation,
  LEGACY_TERMINAL_INSTANCE_RECORD_SHA256,
  LEGACY_TERMINAL_INSTANCE_STORE_SHA256,
  LEGACY_TERMINAL_MARKER_SHA256,
  LEGACY_TERMINAL_TRANSACTION_ID,
} from '../src/legacy-update-terminal-attestation.mjs';
import { minecraftServerJar } from './server-jar-fixture.mjs';

const OLD_ARTIFACT = Buffer.from('old-managed-artifact');
const NEW_ARTIFACT = Buffer.from('new-managed-artifact');
const UPDATE_MARKER_KEY = Buffer.alloc(32, 0x5a);
const OLD_LAUNCH_ASSET_DIGEST = '1'.repeat(64);
const OLD_LAUNCH_INVENTORY_DIGEST = '2'.repeat(64);
const NEW_LAUNCH_ASSET_DIGEST = '3'.repeat(64);
const NEW_LAUNCH_INVENTORY_DIGEST = '4'.repeat(64);

class MemoryStore {
  constructor(record) {
    this.records = new Map([[record.id, clone(record)]]);
    this.failUpdates = 0;
  }

  async get(id) {
    return this.records.has(id) ? clone(this.records.get(id)) : null;
  }

  async list() {
    return [...this.records.values()].map(clone);
  }

  async update(id, patch) {
    if (this.failUpdates > 0) {
      this.failUpdates -= 1;
      throw new Error('simulated store commit failure');
    }
    const current = this.records.get(id);
    if (!current) throw new Error(`Instance '${id}' was not found`);
    const next = { ...current, ...patch, id, updatedAt: new Date().toISOString() };
    // Match InstanceStore persistence: undefined properties disappear in JSON.
    this.records.set(id, clone(next));
    return clone(next);
  }
}

async function fixture(t, options = {}) {
  const managedRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-update-'));
  t.after(() => fs.rm(managedRoot, { recursive: true, force: true }));
  const id = 'family-server';
  const instanceDirectory = path.join(managedRoot, 'servers', id);
  await fs.mkdir(path.join(instanceDirectory, 'world', 'region'), { recursive: true });
  await fs.mkdir(path.join(instanceDirectory, 'config', 'floodgate'), { recursive: true });
  await fs.mkdir(path.join(instanceDirectory, 'mods'), { recursive: true });
  await fs.writeFile(path.join(instanceDirectory, 'server.properties'), 'level-name=world\nserver-port=25565\nmotd=Our Family World\n');
  await fs.writeFile(path.join(instanceDirectory, 'world', 'level.dat'), 'irreplaceable-world-metadata');
  await fs.writeFile(path.join(instanceDirectory, 'world', 'region', 'r.0.0.mca'), 'irreplaceable-region-data');
  await fs.writeFile(path.join(instanceDirectory, 'config', 'floodgate', 'key.pem'), 'private-floodgate-key');
  await fs.writeFile(path.join(instanceDirectory, 'ops.json'), '[{"uuid":"family-admin"}]\n');
  for (const relative of FAMILY_SERVER_MANAGED_ARTIFACTS) {
    await fs.mkdir(path.dirname(path.join(instanceDirectory, ...relative.split('/'))), { recursive: true });
    await fs.writeFile(path.join(instanceDirectory, ...relative.split('/')), OLD_ARTIFACT);
  }
  await fs.writeFile(path.join(instanceDirectory, 'instance.json'), '{"private":"old"}\n');

  const now = '2026-08-12T00:00:00.000Z';
  const record = {
    id,
    displayName: 'Family Server',
    projectId: 'family-server',
    kind: 'server',
    updateChannel: 'latest-compatible',
    minecraftVersion: '26.2',
    latestMinecraftVersion: '26.2',
    minecraftReleaseTime: '2026-08-01T00:00:00.000Z',
    requiredJavaMajor: 25,
    javaRuntimeComponent: 'java-runtime-epsilon',
    javaRuntime: {
      launchAssetDigest: OLD_LAUNCH_ASSET_DIGEST,
      launchInventoryDigest: OLD_LAUNCH_INVENTORY_DIGEST,
    },
    loader: 'fabric',
    loaderVersion: '0.19.3',
    installerVersion: '1.1.2',
    components: components('old'),
    memoryMb: 4096,
    javaPort: 25565,
    bedrockPort: 19132,
    directory: instanceDirectory,
    provisioningStatus: 'ready',
    status: options.status ?? 'stopped',
    pid: options.status === 'running' ? 1234 : null,
    createdAt: now,
    updatedAt: now,
  };
  const store = new MemoryStore(record);
  const state = {
    active: options.active ?? false,
    prepareCalls: 0,
    lockCalls: 0,
    interlockCalls: 0,
    candidateReady: false,
    sourceMutatedDuringPublication: false,
    sourceReplacedDuringPublication: false,
    parkedSourceDirectory: null,
  };
  let target = options.target ?? targetPlan();
  const prepareCandidate = options.prepareCandidate ?? (async ({ candidateDirectory, target: preparedTarget }) => {
    state.prepareCalls += 1;
    return writeCandidateArtifacts(candidateDirectory, NEW_ARTIFACT, preparedTarget);
  });
  const manager = new FamilyServerUpdateManager(managedRoot, store, {
    resolveTarget: async () => clone(target),
    prepareCandidate,
    isInstanceActive: async () => state.active,
    assertQuiescentWithinInstanceLock: async () => options.quiescent !== false,
    withInstanceLock: async (_instanceId, operation) => {
      state.lockCalls += 1;
      return options.withInstanceLock
        ? options.withInstanceLock(_instanceId, operation)
        : operation();
    },
    assertStackUpdateAllowedWithinInstanceLock: async () => {
      state.interlockCalls += 1;
      if (options.modsBlockUpdate) throw Object.assign(new Error('Managed add-on mods block Minecraft/Fabric stack updates.'), {
        code: 'MODS_BLOCK_MINECRAFT_UPDATE', statusCode: 409,
      });
    },
    onPhase: async (event) => {
      if (event.phase === 'candidate-ready') state.candidateReady = true;
      await options.onPhase?.(event);
    },
    filesystemTreeVerifier: options.filesystemTreeVerifier
      ?? ((options.mutateSourceDuringFinalCandidateVerification || options.replaceSourceDuringFinalCandidateVerification)
      ? async (target) => {
          if (options.mutateSourceDuringFinalCandidateVerification
            && state.candidateReady && !state.sourceMutatedDuringPublication
            && path.basename(target).startsWith(`.${id}-candidate-`)) {
            state.sourceMutatedDuringPublication = true;
            await fs.writeFile(path.join(instanceDirectory, 'ops.json'), '[{"uuid":"late-family-admin"}]\n');
          }
          if (options.replaceSourceDuringFinalCandidateVerification
            && state.candidateReady && !state.sourceReplacedDuringPublication
            && path.basename(target).startsWith(`.${id}-candidate-`)) {
            state.sourceReplacedDuringPublication = true;
            state.parkedSourceDirectory = path.join(path.dirname(instanceDirectory), `.${id}-original-parked`);
            await fs.rename(instanceDirectory, state.parkedSourceDirectory);
            await fs.cp(state.parkedSourceDirectory, instanceDirectory, { recursive: true });
          }
          return { ok: true, checked: true };
        }
      : undefined),
    filesystemEntryVerifier: options.filesystemEntryVerifier,
    directoryGuard: options.directoryGuard,
    fileGuard: options.fileGuard,
    filesystemSafetyBroker: options.filesystemSafetyBroker,
    nativeFilesystemGuards: options.nativeFilesystemGuards ?? false,
    markerAuthenticationKey: UPDATE_MARKER_KEY,
  });
  return {
    id,
    managedRoot,
    instanceDirectory,
    manager,
    state,
    store,
    get target() { return target; },
    setTarget(next) { target = next; },
  };
}

test('mod-manager interlock blocks stack updates before any candidate or transaction mutation', async (t) => {
  const value = await fixture(t, { modsBlockUpdate: true, target: targetPlan({ minecraftVersion: '26.3', minecraftDirection: 'upgrade' }) });
  await assert.rejects(() => value.manager.update({ instanceId: value.id }), (error) => error.code === 'MODS_BLOCK_MINECRAFT_UPDATE');
  assert.equal(value.state.prepareCalls, 0);
  assert.equal(value.state.interlockCalls, 1);
  assert.deepEqual(await fs.readdir(path.join(value.managedRoot, 'state', 'update-transactions')).catch(() => []), []);
});

test('recovery preflight is strictly read-only and reports unfinished evidence', async (t) => {
  await t.test('pristine state', async (child) => {
    const value = await fixture(child);
    const transactionRoot = path.join(value.managedRoot, 'state', 'update-transactions');
    const keyPath = path.join(value.managedRoot, 'state', 'update-transactions.hmac.key');
    assert.equal(await fileExists(transactionRoot), false);
    assert.deepEqual(await value.manager.preflightRecoveryEvidence(), { domain: 'update', instances: [] });
    assert.equal(await fileExists(transactionRoot), false);
    assert.equal(await fileExists(keyPath), false);
  });

  await t.test('unfinished authenticated marker', async (child) => {
    const value = await fixture(child);
    const result = await value.manager.update({ instanceId: value.id });
    const [markerPath] = await transactionFiles(value);
    const beforeBytes = await fs.readFile(markerPath);
    const beforeStore = await value.store.get(value.id);
    assert.deepEqual(await value.manager.preflightRecoveryEvidence(), {
      domain: 'update',
      instances: [{ instanceId: value.id, transactionRef: result.transaction.transactionId }],
    });
    assert.deepEqual(await fs.readFile(markerPath), beforeBytes);
    assert.deepEqual(await value.store.get(value.id), beforeStore);
  });
});

function targetPlan(overrides = {}) {
  const minecraftVersion = overrides.minecraftVersion ?? '26.2';
  const officialServer = minecraftServerJar({ minecraftVersion, worldDataVersion: overrides.worldDataVersion ?? (minecraftVersion === '26.2' ? 4903 : 5000) });
  return {
    projectId: 'family-server',
    updateChannel: 'latest-compatible',
    minecraftVersion,
    latestMinecraftVersion: overrides.latestMinecraftVersion ?? minecraftVersion,
    minecraftReleaseTime: overrides.minecraftReleaseTime ?? (minecraftVersion === '26.2' ? '2026-08-01T00:00:00.000Z' : '2026-09-01T00:00:00.000Z'),
    minecraftDirection: overrides.minecraftDirection ?? (minecraftVersion === '26.2' ? 'same' : 'upgrade'),
    requiredJavaMajor: overrides.requiredJavaMajor ?? 25,
    javaRuntimeComponent: overrides.javaRuntimeComponent ?? 'java-runtime-epsilon',
    loaderVersion: overrides.loaderVersion ?? '0.19.4',
    installerVersion: overrides.installerVersion ?? '1.1.2',
    minecraftServerArtifact: overrides.minecraftServerArtifact ?? {
      minecraftVersion,
      relativePath: `versions/${minecraftVersion}/server-${minecraftVersion}.jar`,
      size: officialServer.length,
      sha1: crypto.createHash('sha1').update(officialServer).digest('hex'),
    },
    components: overrides.components ?? components('new'),
  };
}

function components(label) {
  const seed = label === 'old' ? 'a' : 'b';
  return {
    fabricApi: component(`${label}-fabric-api`, seed),
    geyser: component(`${label}-geyser`, seed),
    floodgate: component(`${label}-floodgate`, seed),
  };
}

function component(version, seed) {
  return {
    versionId: `${version}-id`,
    versionNumber: version,
    versionType: version.includes('geyser') ? 'beta' : 'release',
    sourceHash: { algorithm: 'sha512', value: seed.repeat(128) },
  };
}

async function writeCandidateArtifacts(candidateDirectory, bytes, target = targetPlan()) {
  const managedArtifacts = [];
  for (const relativePath of FAMILY_SERVER_MANAGED_ARTIFACTS) {
    const target = path.join(candidateDirectory, ...relativePath.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
    managedArtifacts.push({ relativePath, sha256: sha256(bytes) });
  }
  const worldDataVersion = target.minecraftVersion === '26.2' ? 4903 : 5000;
  const officialServer = minecraftServerJar({ minecraftVersion: target.minecraftVersion, worldDataVersion });
  const official = target.minecraftServerArtifact;
  const officialPath = path.join(candidateDirectory, ...official.relativePath.split('/'));
  await fs.mkdir(path.dirname(officialPath), { recursive: true });
  await fs.writeFile(officialPath, officialServer);
  await fs.writeFile(path.join(candidateDirectory, 'instance.json'), '{"private":"new"}\n');
  return { recordPatch: {
    javaRuntime: {
      launchAssetDigest: NEW_LAUNCH_ASSET_DIGEST,
      launchInventoryDigest: NEW_LAUNCH_INVENTORY_DIGEST,
    },
    worldDataVersion,
    minecraftServerArtifact: { ...official, sha256: sha256(officialServer), worldDataVersion },
  }, managedArtifacts };
}

async function applyReadyVersionUpgrade(value) {
  const plan = await value.manager.check({ instanceId: value.id });
  const result = await value.manager.update({
    instanceId: value.id,
    approval: { minecraftVersionChange: true, planId: plan.planId },
  });
  await value.manager.markReady({ instanceId: value.id, transactionId: result.transaction.transactionId });
  return result;
}

test('blocks both persisted and live running instances before staging', async (t) => {
  const persisted = await fixture(t, { status: 'running' });
  await assert.rejects(() => persisted.manager.update({ instanceId: persisted.id }), /fully stopped/);
  assert.equal(persisted.state.prepareCalls, 0);

  const live = await fixture(t, { active: true });
  await assert.rejects(() => live.manager.update({ instanceId: live.id }), /fully stopped/);
  assert.equal(live.state.prepareCalls, 0);

  const portOccupied = await fixture(t, { quiescent: false });
  await assert.rejects(
    () => portOccupied.manager.update({ instanceId: portOccupied.id }),
    /not exactly quiescent/,
  );
  assert.equal(portOccupied.state.prepareCalls, 0);
  assert.deepEqual(
    await fs.readdir(path.join(portOccupied.managedRoot, 'state', 'update-transactions')).catch(() => []),
    [],
  );
});

test('a fallible read-only source check fails before allocating any transaction namespace', async (t) => {
  const value = await fixture(t);
  await fs.writeFile(path.join(value.instanceDirectory, 'server.properties'), 'level-name=../outside\n');
  await assert.rejects(() => value.manager.update({ instanceId: value.id }), /level-name|outside|safe/i);
  assert.deepEqual(
    await fs.readdir(path.join(value.managedRoot, 'state', 'update-transactions')).catch(() => []),
    [],
  );
  assert.deepEqual(await fs.readdir(path.join(value.managedRoot, 'backups')).catch(() => []), []);
  assert.deepEqual(
    (await fs.readdir(path.join(value.managedRoot, 'servers')))
      .filter((name) => name.startsWith(`.${value.id}-candidate-`)),
    [],
  );
});

test('requires a matching explicit approval for every Minecraft version upgrade', async (t) => {
  const value = await fixture(t, { target: targetPlan({ minecraftVersion: '26.3', minecraftDirection: 'upgrade' }) });
  const checked = await value.manager.check({ instanceId: value.id });
  assert.equal(checked.state, 'minecraft-update-approval-required');
  assert.equal(checked.requiresApproval, true);

  const withheld = await value.manager.update({ instanceId: value.id });
  assert.equal(withheld.action, 'approval-required');
  assert.equal(value.state.prepareCalls, 0);
  assert.equal((await value.store.get(value.id)).minecraftVersion, '26.2');

  await assert.rejects(() => value.manager.update({
    instanceId: value.id,
    approval: { minecraftVersionChange: true, planId: '0'.repeat(64) },
  }), (error) => error.code === 'UPDATE_PLAN_CHANGED');

  const applied = await value.manager.update({
    instanceId: value.id,
    approval: { minecraftVersionChange: true, planId: checked.planId },
  });
  assert.equal(applied.action, 'updated');
  assert.equal(applied.instance.minecraftVersion, '26.3');
  assert.equal(applied.instance.worldDataVersion, 5000);
  assert.deepEqual(applied.instance.minecraftServerArtifact, {
    minecraftVersion: '26.3', worldDataVersion: 5000,
    relativePath: 'versions/26.3/server-26.3.jar',
    size: value.target.minecraftServerArtifact.size,
    sha1: value.target.minecraftServerArtifact.sha1,
    sha256: sha256(minecraftServerJar({ minecraftVersion: '26.3', worldDataVersion: 5000 })),
  });
  assert.equal(applied.readiness, 'pending-unverified');
});

test('binds Minecraft approval to the current source inventory and migration identity', async (t) => {
  const value = await fixture(t, { target: targetPlan({ minecraftVersion: '26.3', minecraftDirection: 'upgrade' }) });
  await value.store.update(value.id, {
    migration: { worldSha256: 'c'.repeat(64), sourceTreeSha256: 'd'.repeat(64) },
  });
  const checked = await value.manager.check({ instanceId: value.id });
  await value.store.update(value.id, {
    migration: { worldSha256: 'e'.repeat(64), sourceTreeSha256: 'd'.repeat(64) },
  });
  await assert.rejects(() => value.manager.update({
    instanceId: value.id,
    approval: { minecraftVersionChange: true, planId: checked.planId },
  }), (error) => error.code === 'UPDATE_PLAN_CHANGED');
  assert.equal(value.state.prepareCalls, 0);
});

test('binds update approval to the trusted Mojang server artifact identity', async (t) => {
  const value = await fixture(t, { target: targetPlan({ minecraftVersion: '26.3', minecraftDirection: 'upgrade' }) });
  const checked = await value.manager.check({ instanceId: value.id });
  value.setTarget({ ...value.target, minecraftServerArtifact: { ...value.target.minecraftServerArtifact, sha1: 'c'.repeat(40) } });
  await assert.rejects(() => value.manager.update({
    instanceId: value.id,
    approval: { minecraftVersionChange: true, planId: checked.planId },
  }), (error) => error.code === 'UPDATE_PLAN_CHANGED');
  assert.equal(value.state.prepareCalls, 0);
});

test('rejects forged world compatibility metadata after candidate preparation', async (t) => {
  const target = targetPlan({ minecraftVersion: '26.3', minecraftDirection: 'upgrade' });
  const value = await fixture(t, {
    target,
    prepareCandidate: async ({ candidateDirectory, target: preparedTarget }) => {
      const result = await writeCandidateArtifacts(candidateDirectory, NEW_ARTIFACT, preparedTarget);
      result.recordPatch.worldDataVersion += 1;
      result.recordPatch.minecraftServerArtifact.worldDataVersion += 1;
      return result;
    },
  });
  const checked = await value.manager.check({ instanceId: value.id });
  await assert.rejects(() => value.manager.update({
    instanceId: value.id,
    approval: { minecraftVersionChange: true, planId: checked.planId },
  }), /compatibility metadata failed verification/);
  assert.equal((await value.store.get(value.id)).minecraftVersion, '26.2');
});

test('rejects downgrade and unknown release ordering even when approval is supplied', async (t) => {
  for (const minecraftDirection of ['downgrade', 'unknown']) {
    const value = await fixture(t, { target: targetPlan({ minecraftVersion: '26.1', minecraftDirection }) });
    const plan = await value.manager.check({ instanceId: value.id });
    await assert.rejects(() => value.manager.update({
      instanceId: value.id,
      approval: { minecraftVersionChange: true, planId: plan.planId },
    }), /downgrade|ordering|verified Minecraft upgrade/);
    assert.equal(value.state.prepareCalls, 0);
  }
});

test('automatically stages a same-Minecraft component update, preserves mutable state, and retains a full backup', async (t) => {
  const value = await fixture(t);
  const checked = await value.manager.check({ instanceId: value.id });
  assert.equal(checked.state, 'component-update-available');
  assert.equal(checked.requiresApproval, false);

  const result = await value.manager.update({ instanceId: value.id });
  assert.equal(result.action, 'updated');
  assert.equal(result.readiness, 'pending-unverified');
  assert.equal(result.transaction.phase, 'pending-readiness');
  assert.equal((await value.store.get(value.id)).updateStatus.state, 'pending-unverified');
  assert.equal(await fs.readFile(path.join(value.instanceDirectory, 'world', 'level.dat'), 'utf8'), 'irreplaceable-world-metadata');
  assert.equal(await fs.readFile(path.join(value.instanceDirectory, 'world', 'region', 'r.0.0.mca'), 'utf8'), 'irreplaceable-region-data');
  assert.equal(await fs.readFile(path.join(value.instanceDirectory, 'config', 'floodgate', 'key.pem'), 'utf8'), 'private-floodgate-key');
  assert.equal(await fs.readFile(path.join(value.instanceDirectory, 'ops.json'), 'utf8'), '[{"uuid":"family-admin"}]\n');
  assert.deepEqual(await fs.readFile(path.join(value.instanceDirectory, 'fabric-server-launch.jar')), NEW_ARTIFACT);

  const backup = path.join(value.managedRoot, 'backups', value.id, result.transaction.transactionId, 'instance');
  assert.equal(await fs.readFile(path.join(backup, 'world', 'level.dat'), 'utf8'), 'irreplaceable-world-metadata');
  assert.deepEqual(await fs.readFile(path.join(backup, 'fabric-server-launch.jar')), OLD_ARTIFACT);
  const marker = JSON.parse(await fs.readFile(path.join(value.managedRoot, 'state', 'update-transactions', value.id, `${result.transaction.transactionId}.json`), 'utf8'));
  assert.equal(marker.phase, 'pending-readiness');
  assert.equal(marker.worldBefore.digest, marker.worldAfter.digest);
  assert.equal(marker.mutableBefore.digest, marker.mutableAfter.digest);
  assert.equal(marker.artifacts.length, 5);

  const ready = await value.manager.markReady({ instanceId: value.id, transactionId: result.transaction.transactionId });
  assert.equal(ready.transaction.phase, 'ready');
  assert.equal((await value.store.get(value.id)).updateStatus.state, 'verified');
  assert.equal(await fileExists(backup), true, 'readiness must not silently delete the rollback backup');
});

test('same-version migrated records backfill launch trust without copying legacy executable roots', async (t) => {
  const value = await fixture(t);
  const legacyFiles = new Map([
    ['.fabric/server/26.2-server.jar', Buffer.from('authenticated-legacy-fabric-cache')],
    ['libraries/net/fabricmc/legacy-library.jar', Buffer.from('authenticated-legacy-library')],
    ['versions/1.21.4/server-1.21.4.jar', Buffer.from('authenticated-retired-version')],
    ['versions/26.2/server-26.2.jar', Buffer.from('legacy-inner-game-jar')],
  ]);
  for (const [relativePath, bytes] of legacyFiles) {
    const file = path.join(value.instanceDirectory, ...relativePath.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, bytes);
  }
  await value.store.update(value.id, {
    javaRuntime: {
      managed: true,
      component: 'java-runtime-epsilon',
      major: 25,
      version: '25.0.1',
    },
    minecraftServerArtifact: undefined,
    worldDataVersion: undefined,
    provisioningStatus: 'ready',
    updateState: undefined,
  });

  const checked = await value.manager.check({ instanceId: value.id });
  assert.equal(checked.state, 'component-update-available');
  assert.equal(checked.requiresApproval, false);

  const result = await value.manager.update({ instanceId: value.id });
  assert.equal(result.action, 'updated');
  assert.equal(result.readiness, 'pending-unverified');
  assert.equal(await fileExists(path.join(value.instanceDirectory, '.fabric')), false);
  assert.equal(await fileExists(path.join(value.instanceDirectory, 'libraries')), false);
  assert.deepEqual(await fs.readdir(path.join(value.instanceDirectory, 'versions')), ['26.2']);
  assert.deepEqual(
    await fs.readdir(path.join(value.instanceDirectory, 'versions', '26.2')),
    ['server-26.2.jar'],
  );
  assert.deepEqual(
    await fs.readFile(path.join(value.instanceDirectory, 'versions', '26.2', 'server-26.2.jar')),
    minecraftServerJar({ minecraftVersion: '26.2', worldDataVersion: 4903 }),
  );
  assert.equal(await fs.readFile(path.join(value.instanceDirectory, 'world', 'level.dat'), 'utf8'), 'irreplaceable-world-metadata');

  const backup = path.join(
    value.managedRoot,
    'backups',
    value.id,
    result.transaction.transactionId,
    'instance',
  );
  for (const [relativePath, bytes] of legacyFiles) {
    assert.deepEqual(await fs.readFile(path.join(backup, ...relativePath.split('/'))), bytes);
  }
  const marker = JSON.parse(await fs.readFile(path.join(
    value.managedRoot,
    'state',
    'update-transactions',
    value.id,
    `${result.transaction.transactionId}.json`,
  ), 'utf8'));
  assert.deepEqual(
    marker.legacyLaunchMigration.roots.map((root) => root.relativePath),
    ['.fabric', 'libraries', 'versions'],
  );
  assert.equal(marker.legacyLaunchMigration.state, 'candidate-pruned');
  assert.match(result.instance.javaRuntime.launchAssetDigest, /^[a-f0-9]{64}$/);
  assert.match(result.instance.javaRuntime.launchInventoryDigest, /^[a-f0-9]{64}$/);
  assert.equal(result.instance.minecraftServerArtifact.minecraftVersion, '26.2');
  assert.equal(result.instance.worldDataVersion, 4903);
});

test('batches bounded directory and file custody while preserving injected single-guard fallback', async (t) => {
  const counters = {
    active: 0,
    directoryBatches: 0,
    fileBatches: 0,
    directorySingles: 0,
    fileSingles: 0,
    maximumBatch: 0,
  };
  const activePaths = new Set();
  const terminalGuard = (kind, target) => {
    const activePath = `${kind}:${path.resolve(target).toLowerCase()}`;
    assert.equal(activePaths.has(activePath), false, `non-reentrant guard path was acquired twice: ${target}`);
    activePaths.add(activePath);
    counters.active += 1;
    let terminal = false;
    const finish = async (operation) => {
      if (terminal) return;
      terminal = true;
      try { await operation?.(); } finally { counters.active -= 1; activePaths.delete(activePath); }
    };
    return {
      assertHeld() { if (terminal) throw new Error('test guard was used after terminal completion'); },
      release: () => finish(),
      delete: () => finish(() => kind === 'directory' ? fs.rmdir(target) : fs.unlink(target)),
      rename: (destination) => finish(() => fs.rename(target, destination)),
      replace: (destination) => finish(async () => {
        await fs.rm(destination, { force: true });
        await fs.rename(target, destination);
      }),
    };
  };
  const directoryGuard = async (target) => {
    counters.directorySingles += 1;
    return terminalGuard('directory', target);
  };
  directoryGuard.batch = async (targets) => {
    counters.directoryBatches += 1;
    counters.maximumBatch = Math.max(counters.maximumBatch, targets.length);
    return targets.map((target) => terminalGuard('directory', target));
  };
  const fileGuard = async (target) => {
    counters.fileSingles += 1;
    return terminalGuard('file', target);
  };
  fileGuard.batch = async (targets) => {
    counters.fileBatches += 1;
    counters.maximumBatch = Math.max(counters.maximumBatch, targets.length);
    return targets.map((target) => terminalGuard('file', target));
  };
  const value = await fixture(t, {
    nativeFilesystemGuards: true,
    directoryGuard,
    fileGuard,
    filesystemTreeVerifier: async () => ({ ok: true, checked: false }),
    filesystemEntryVerifier: async () => ({ ok: true, checked: false }),
  });
  const result = await value.manager.update({ instanceId: value.id });
  assert.equal(result.action, 'updated');
  assert.equal(counters.directoryBatches > 0, true);
  assert.equal(counters.fileBatches > 0, true);
  assert.equal(counters.directorySingles > 0, true, 'one-path mutations must retain the injected fallback');
  assert.equal(counters.fileSingles > 0, true, 'one-path marker operations must retain the injected fallback');
  assert.equal(counters.maximumBatch <= 256, true);
  assert.equal(counters.active, 0, 'every peer in every injected batch must reach terminal completion');
  assert.equal(activePaths.size, 0, 'every non-reentrant path guard must be terminally released');
});

test('legacy launch migration stays fail-closed before candidate mutation without explicit cleanup authorization', async (t) => {
  const value = await fixture(t, { target: targetPlan({ minecraftVersion: '26.3', minecraftDirection: 'upgrade' }) });
  const legacyFabric = 'fabric-api-0.119.4+1.21.4.jar';
  const customMod = 'family-custom-mod-1.0.jar';
  await fs.writeFile(path.join(value.instanceDirectory, 'instance.json'), `${JSON.stringify({
    schemaVersion: 1,
    artifacts: [{ fileName: legacyFabric }],
  }, null, 2)}\n`);
  await fs.writeFile(path.join(value.instanceDirectory, 'mods', legacyFabric), 'legacy-versioned-fabric-api');
  await fs.writeFile(path.join(value.instanceDirectory, 'mods', customMod), 'custom-mod-must-survive');
  await value.store.update(value.id, {
    javaRuntime: { launchAssetDigest: OLD_LAUNCH_ASSET_DIGEST },
    provisioningStatus: 'legacy-update-required',
    updateState: 'minecraft-update-approval-required',
    update: { state: 'minecraft-update-approval-required', currentMinecraft: '26.2', requiresApproval: true },
    migration: { kind: 'legacy-v1', sourceTreeSha256: 'c'.repeat(64), importedAt: '2026-08-12T00:00:00.000Z' },
  });

  value.manager.prepareCandidate = async ({ candidateDirectory, target: preparedTarget }) => {
    value.state.prepareCalls += 1;
    await fs.rm(path.join(candidateDirectory, 'mods', legacyFabric));
    return writeCandidateArtifacts(candidateDirectory, NEW_ARTIFACT, preparedTarget);
  };
  const plan = await value.manager.check({ instanceId: value.id });
  assert.equal(plan.state, 'minecraft-update-approval-required');
  assert.equal(plan.updateKind, 'legacy-migration');
  assert.equal(plan.requiresApproval, true);
  assert.equal((await value.manager.update({ instanceId: value.id })).action, 'approval-required');
  assert.equal(value.state.prepareCalls, 0);

  await assert.rejects(
    () => value.manager.update({
      instanceId: value.id,
      approval: { minecraftVersionChange: true, planId: plan.planId },
    }),
    (error) => error.code === 'UPDATE_LEGACY_MIGRATION_UNAVAILABLE',
  );
  const unchanged = await value.store.get(value.id);
  assert.equal(unchanged.provisioningStatus, 'legacy-update-required');
  assert.equal(unchanged.updateState, 'minecraft-update-approval-required');
  assert.deepEqual(unchanged.migration, { kind: 'legacy-v1', sourceTreeSha256: 'c'.repeat(64), importedAt: '2026-08-12T00:00:00.000Z' });
  assert.equal(value.state.prepareCalls, 0);
  assert.equal(await fs.readFile(path.join(value.instanceDirectory, 'mods', legacyFabric), 'utf8'), 'legacy-versioned-fabric-api');
  assert.equal(await fs.readFile(path.join(value.instanceDirectory, 'mods', customMod), 'utf8'), 'custom-mod-must-survive');
  assert.deepEqual(await fs.readFile(path.join(value.instanceDirectory, 'mods', 'fabric-api.jar')), OLD_ARTIFACT);
  assert.deepEqual(
    await fs.readdir(path.join(value.managedRoot, 'state', 'update-transactions')).catch(() => []),
    [],
  );
});

test('purges only a verified retired-version backup and its exact obsolete Fabric game caches', async (t) => {
  const value = await fixture(t, { target: targetPlan({ minecraftVersion: '26.3', minecraftDirection: 'upgrade' }) });
  const result = await applyReadyVersionUpgrade(value);
  const cacheRoot = path.join(value.instanceDirectory, '.fabric', 'server');
  await fs.mkdir(cacheRoot, { recursive: true });
  const retiredCaches = [
    path.join(cacheRoot, '26.2-server.jar'),
    path.join(cacheRoot, 'fabric-loader-server-0.19.3-minecraft-26.2.jar'),
  ];
  const retainedCaches = [
    path.join(cacheRoot, '26.3-server.jar'),
    path.join(cacheRoot, 'fabric-loader-server-0.19.4-minecraft-26.3.jar'),
    path.join(cacheRoot, 'shared-library.jar'),
  ];
  for (const file of retiredCaches) await fs.writeFile(file, 'retired-cache');
  for (const file of retainedCaches) await fs.writeFile(file, 'must-remain');

  const lockCallsBeforeCleanup = value.state.lockCalls;
  const cleanup = await value.manager.purgeRetiredVersionWithinInstanceLock({ instanceId: value.id });
  assert.equal(value.state.lockCalls, lockCallsBeforeCleanup, 'the within-lock entry point must not reacquire the lifecycle lock');
  assert.deepEqual({
    action: cleanup.action,
    retiredMinecraftVersion: cleanup.retiredMinecraftVersion,
    currentMinecraftVersion: cleanup.currentMinecraftVersion,
    backupAvailable: cleanup.backupAvailable,
    cacheEntriesPurged: cleanup.cacheEntriesPurged,
  }, {
    action: 'retired-version-purged',
    retiredMinecraftVersion: '26.2',
    currentMinecraftVersion: '26.3',
    backupAvailable: false,
    cacheEntriesPurged: 2,
  });
  const backup = path.join(value.managedRoot, 'backups', value.id, result.transaction.transactionId, 'instance');
  assert.equal(await fileExists(backup), false);
  for (const file of retiredCaches) assert.equal(await fileExists(file), false);
  for (const file of retainedCaches) assert.equal(await fs.readFile(file, 'utf8'), 'must-remain');
  assert.equal(await fs.readFile(path.join(value.instanceDirectory, 'world', 'level.dat'), 'utf8'), 'irreplaceable-world-metadata');
  assert.equal(await fs.readFile(path.join(value.instanceDirectory, 'config', 'floodgate', 'key.pem'), 'utf8'), 'private-floodgate-key');
  assert.equal(await fs.readFile(path.join(value.instanceDirectory, 'ops.json'), 'utf8'), '[{"uuid":"family-admin"}]\n');
  const inventory = await value.store.get(value.id);
  assert.equal(inventory.updateStatus.state, 'verified');
  assert.equal(inventory.updateStatus.backupAvailable, false);
  assert.equal(inventory.updateStatus.retiredMinecraftVersion, '26.2');
  assert.equal(inventory.updateStatus.obsoleteCacheEntriesPurged, 2);
  const markerPath = path.join(value.managedRoot, 'state', 'update-transactions', value.id, `${result.transaction.transactionId}.json`);
  assert.equal(JSON.parse(await fs.readFile(markerPath, 'utf8')).retiredCleanup.state, 'purged');
});

test('refuses retired-version cleanup while readiness is pending or the current target identity changed', async (t) => {
  const pending = await fixture(t, { target: targetPlan({ minecraftVersion: '26.3', minecraftDirection: 'upgrade' }) });
  const plan = await pending.manager.check({ instanceId: pending.id });
  const update = await pending.manager.update({
    instanceId: pending.id,
    approval: { minecraftVersionChange: true, planId: plan.planId },
  });
  const pendingBackup = path.join(pending.managedRoot, 'backups', pending.id, update.transaction.transactionId, 'instance');
  await assert.rejects(() => pending.manager.purgeRetiredVersion({ instanceId: pending.id }), /pending-readiness|pending verification/);
  assert.equal(await fs.readFile(path.join(pendingBackup, 'world', 'level.dat'), 'utf8'), 'irreplaceable-world-metadata');

  const mismatch = await fixture(t, { target: targetPlan({ minecraftVersion: '26.3', minecraftDirection: 'upgrade' }) });
  const ready = await applyReadyVersionUpgrade(mismatch);
  await mismatch.store.update(mismatch.id, { minecraftVersion: '26.4' });
  const mismatchBackup = path.join(mismatch.managedRoot, 'backups', mismatch.id, ready.transaction.transactionId, 'instance');
  await assert.rejects(() => mismatch.manager.purgeRetiredVersion({ instanceId: mismatch.id }), /does not match the verified update target/);
  assert.equal(await fs.readFile(path.join(mismatchBackup, 'world', 'level.dat'), 'utf8'), 'irreplaceable-world-metadata');
  assert.equal((await mismatch.store.get(mismatch.id)).updateStatus.backupAvailable, true);
});

test('restores staged backup and caches when the atomic inventory commit fails', async (t) => {
  const value = await fixture(t, { target: targetPlan({ minecraftVersion: '26.3', minecraftDirection: 'upgrade' }) });
  const result = await applyReadyVersionUpgrade(value);
  const retiredCache = path.join(value.instanceDirectory, '.fabric', 'server', '26.2-server.jar');
  await fs.mkdir(path.dirname(retiredCache), { recursive: true });
  await fs.writeFile(retiredCache, 'retired-cache');
  value.store.failUpdates = 1;
  let purgeError;
  try { await value.manager.purgeRetiredVersion({ instanceId: value.id }); }
  catch (error) { purgeError = error; }
  assert.deepEqual(
    purgeError?.errors?.map((error) => error.message) ?? [purgeError?.message],
    ['simulated store commit failure'],
  );
  const backup = path.join(value.managedRoot, 'backups', value.id, result.transaction.transactionId, 'instance');
  assert.equal(await fs.readFile(path.join(backup, 'world', 'level.dat'), 'utf8'), 'irreplaceable-world-metadata');
  assert.equal(await fs.readFile(retiredCache, 'utf8'), 'retired-cache');
  assert.equal((await value.store.get(value.id)).updateStatus.backupAvailable, true);
  const markerPath = path.join(value.managedRoot, 'state', 'update-transactions', value.id, `${result.transaction.transactionId}.json`);
  assert.equal(JSON.parse(await fs.readFile(markerPath, 'utf8')).retiredCleanup, undefined);
});

test('startup finishes an interrupted retired-version purge after its inventory commit', async (t) => {
  const value = await fixture(t, { target: targetPlan({ minecraftVersion: '26.3', minecraftDirection: 'upgrade' }) });
  const result = await applyReadyVersionUpgrade(value);
  const transactionRoot = path.join(value.managedRoot, 'backups', value.id, result.transaction.transactionId);
  const backup = path.join(transactionRoot, 'instance');
  const cleanupRoot = path.join(transactionRoot, '.retired-version-cleanup');
  const cleanupCaches = path.join(cleanupRoot, 'caches');
  const retiredCache = path.join(value.instanceDirectory, '.fabric', 'server', '26.2-server.jar');
  await fs.mkdir(path.dirname(retiredCache), { recursive: true });
  await fs.writeFile(retiredCache, 'retired-cache');
  await fs.rename(backup, cleanupRoot);
  await fs.mkdir(cleanupCaches, { recursive: true });
  await fs.rename(retiredCache, path.join(cleanupCaches, 'cache-0.jar'));
  const markerPath = path.join(value.managedRoot, 'state', 'update-transactions', value.id, `${result.transaction.transactionId}.json`);
  const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
  marker.retiredCleanup = {
    schemaVersion: 1, state: 'staged', previousMinecraftVersion: '26.2', targetMinecraftVersion: '26.3',
    stagedCacheIndexes: [0], preparedAt: '2026-08-12T00:00:00.000Z', stagedAt: '2026-08-12T00:00:00.000Z',
  };
  await fs.writeFile(markerPath, `${JSON.stringify(signTestMarker(marker), null, 2)}\n`);
  const current = await value.store.get(value.id);
  await value.store.update(value.id, {
    updateStatus: { ...current.updateStatus, backupAvailable: false, backupPurgedAt: '2026-08-12T00:00:00.000Z' },
  });
  const cleanupTombstone = `${cleanupRoot}.update-delete`;
  await fs.rename(cleanupRoot, cleanupTombstone);

  const recoveryManager = new FamilyServerUpdateManager(value.managedRoot, value.store, {
    resolveTarget: async () => clone(value.target),
    prepareCandidate: async () => { throw new Error('cleanup recovery must not build a candidate'); },
    isInstanceActive: async () => false,
    assertQuiescentWithinInstanceLock: async () => true,
    withInstanceLock: async (_instanceId, operation) => operation(),
    assertStackUpdateAllowedWithinInstanceLock: async () => true,
    nativeFilesystemGuards: false,
    markerAuthenticationKey: UPDATE_MARKER_KEY,
  });
  const recovery = await recoveryManager.reconcileInterruptedTransactions();
  assert.equal(recovery[0].action, 'retired-version-purged');
  assert.equal(await fileExists(cleanupRoot), false);
  assert.equal(await fileExists(cleanupTombstone), false);
  assert.equal(await fileExists(backup), false);
  assert.equal(await fileExists(retiredCache), false);
  assert.equal(JSON.parse(await fs.readFile(markerPath, 'utf8')).retiredCleanup.state, 'purged');
  assert.equal((await value.store.get(value.id)).updateStatus.backupAvailable, false);
  assert.equal(await fs.readFile(path.join(value.instanceDirectory, 'world', 'level.dat'), 'utf8'), 'irreplaceable-world-metadata');
});

test('rejects caller fields and unsafe verified-backup path types before cleanup', async (t) => {
  const value = await fixture(t, { target: targetPlan({ minecraftVersion: '26.3', minecraftDirection: 'upgrade' }) });
  const result = await applyReadyVersionUpgrade(value);
  await assert.rejects(
    () => value.manager.purgeRetiredVersion({ instanceId: value.id, transactionId: result.transaction.transactionId }),
    /Unsupported retired-version cleanup field/,
  );
  const backup = path.join(value.managedRoot, 'backups', value.id, result.transaction.transactionId, 'instance');
  const parked = `${backup}-parked`;
  await fs.rename(backup, parked);
  await fs.writeFile(backup, 'not-a-managed-backup-directory');
  await assert.rejects(
    () => value.manager.purgeRetiredVersion({ instanceId: value.id }),
    /not a directory|unexpected transaction payload/,
  );
  assert.equal(await fs.readFile(path.join(parked, 'world', 'level.dat'), 'utf8'), 'irreplaceable-world-metadata');
  assert.equal(await fs.readFile(path.join(value.instanceDirectory, 'world', 'level.dat'), 'utf8'), 'irreplaceable-world-metadata');
  assert.equal((await value.store.get(value.id)).updateStatus.backupAvailable, true);
});

test('rolls the directory and store back when publishing succeeds but the store commit fails', async (t) => {
  const value = await fixture(t);
  const original = await value.store.get(value.id);
  value.store.failUpdates = 1;
  await assert.rejects(() => value.manager.update({ instanceId: value.id }), /simulated store commit failure/);

  const restored = await value.store.get(value.id);
  assert.equal(restored.minecraftVersion, original.minecraftVersion);
  assert.equal(restored.loaderVersion, original.loaderVersion);
  assert.equal(restored.stackFingerprint, undefined);
  assert.equal(restored.updateStatus, undefined);
  assert.deepEqual(await fs.readFile(path.join(value.instanceDirectory, 'fabric-server-launch.jar')), OLD_ARTIFACT);
  assert.equal(await fs.readFile(path.join(value.instanceDirectory, 'world', 'level.dat'), 'utf8'), 'irreplaceable-world-metadata');

  const markerFiles = await transactionFiles(value);
  assert.equal(markerFiles.length, 1);
  const marker = JSON.parse(await fs.readFile(markerFiles[0], 'utf8'));
  assert.equal(marker.phase, 'rolled-back');
  const failedCandidate = path.join(value.managedRoot, 'backups', value.id, marker.transactionId, 'failed-candidate');
  assert.equal(await fileExists(failedCandidate), false, 'verified rollback removes its generated failed candidate');
});

test('never blesses an untouched-path rollback when authenticated source content changed during staging', async (t) => {
  let value;
  value = await fixture(t, {
    prepareCandidate: async () => {
      await fs.writeFile(path.join(value.instanceDirectory, 'ops.json'), '[{"uuid":"raced-admin"}]\n');
      throw new Error('simulated preparation failure after source race');
    },
  });
  await assert.rejects(
    () => value.manager.update({ instanceId: value.id }),
    /manual recovery|rollback source|authenticated pre-update state/i,
  );
  const [markerPath] = await transactionFiles(value);
  assert.equal(JSON.parse(await fs.readFile(markerPath, 'utf8')).phase, 'rollback-failed');
  assert.equal(await fs.readFile(path.join(value.instanceDirectory, 'ops.json'), 'utf8'), '[{"uuid":"raced-admin"}]\n');
  assert.equal((await value.store.get(value.id)).updateStatus, undefined);
});

test('refuses to bless a rollback backup whose protected mutable state changed while retained', async (t) => {
  let value;
  value = await fixture(t, {
    onPhase: async ({ phase, transactionId }) => {
      if (phase !== 'candidate-published') return;
      const backup = path.join(value.managedRoot, 'backups', value.id, transactionId, 'instance');
      await fs.writeFile(path.join(backup, 'ops.json'), '[{"uuid":"tampered-retained-admin"}]\n');
    },
  });
  value.store.failUpdates = 1;
  await assert.rejects(
    () => value.manager.update({ instanceId: value.id }),
    /manual recovery|protected mutable server state/i,
  );
  const [markerPath] = await transactionFiles(value);
  const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
  assert.equal(marker.phase, 'rollback-failed');
  assert.equal(await fs.readFile(path.join(value.instanceDirectory, 'world', 'level.dat'), 'utf8'), 'irreplaceable-world-metadata');
  assert.equal(await fs.readFile(path.join(value.instanceDirectory, 'ops.json'), 'utf8'), '[{"uuid":"family-admin"}]\n');
  assert.deepEqual(await fs.readFile(path.join(value.instanceDirectory, 'fabric-server-launch.jar')), NEW_ARTIFACT);
  const retainedBackup = path.join(value.managedRoot, 'backups', value.id, marker.transactionId, 'instance');
  assert.equal(await fs.readFile(path.join(retainedBackup, 'ops.json'), 'utf8'), '[{"uuid":"tampered-retained-admin"}]\n');
  assert.equal((await value.store.get(value.id)).updateStatus, undefined);
  await assert.rejects(
    () => value.manager.assertSafeForLifecycle(value.id),
    /still rollback-failed|recovery/i,
  );
});

test('pre-verifies retained managed artifacts before displacing the working updated server', async (t) => {
  for (const tamper of ['managed-launcher', 'official-server']) {
    await t.test(tamper, async (child) => {
      let value;
      value = await fixture(child, {
        onPhase: async ({ phase, transactionId }) => {
          if (phase !== 'candidate-published') return;
          const backup = path.join(value.managedRoot, 'backups', value.id, transactionId, 'instance');
          const target = tamper === 'managed-launcher'
            ? path.join(backup, 'fabric-server-launch.jar')
            : path.join(backup, 'versions', '26.2', 'server-26.2.jar');
          await fs.writeFile(target, Buffer.from(`tampered-${tamper}`));
        },
      });
      if (tamper === 'official-server') {
        const serverJar = minecraftServerJar({ minecraftVersion: '26.2', worldDataVersion: 4903 });
        const serverPath = path.join(value.instanceDirectory, 'versions', '26.2', 'server-26.2.jar');
        await fs.mkdir(path.dirname(serverPath), { recursive: true });
        await fs.writeFile(serverPath, serverJar);
        await value.store.update(value.id, {
          worldDataVersion: 4903,
          minecraftServerArtifact: {
            ...value.target.minecraftServerArtifact,
            sha256: sha256(serverJar),
            worldDataVersion: 4903,
          },
        });
      }
      value.store.failUpdates = 1;
      await assert.rejects(
        () => value.manager.update({ instanceId: value.id }),
        /rollback source|managed update artifact|manual recovery/i,
      );
      const [markerPath] = await transactionFiles(value);
      const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
      assert.equal(marker.phase, 'rollback-failed');
      assert.deepEqual(await fs.readFile(path.join(value.instanceDirectory, 'fabric-server-launch.jar')), NEW_ARTIFACT);
      assert.equal((await value.store.get(value.id)).updateStatus, undefined);
      const retained = path.join(value.managedRoot, 'backups', value.id, marker.transactionId, 'instance');
      assert.equal(await fileExists(retained), true);
    });
  }
});

test('a retained backup substitution during held verification never displaces the working server', async (t) => {
  let value;
  let parked = null;
  let substituted = false;
  value = await fixture(t, {
    filesystemTreeVerifier: async (target) => {
      const resolved = path.resolve(target);
      const backupRoot = path.resolve(value?.managedRoot ?? '', 'backups', value?.id ?? '');
      if (!substituted && value && resolved.startsWith(`${backupRoot}${path.sep}`)
        && path.basename(resolved) === 'instance') {
        substituted = true;
        parked = `${resolved}-verified-object`;
        await fs.rename(resolved, parked);
        await fs.cp(parked, resolved, { recursive: true });
      }
      return { ok: true, checked: true };
    },
  });
  value.store.failUpdates = 1;
  await assert.rejects(
    () => value.manager.update({ instanceId: value.id }),
    /changed during held source verification|changed while it was being guarded|manual recovery/i,
  );
  assert.equal(substituted, true);
  assert.equal(await fileExists(parked), true);
  assert.deepEqual(await fs.readFile(path.join(value.instanceDirectory, 'fabric-server-launch.jar')), NEW_ARTIFACT);
  const [markerPath] = await transactionFiles(value);
  assert.match(JSON.parse(await fs.readFile(markerPath, 'utf8')).phase, /^rolling-back|rollback-failed$/);
  await assert.rejects(
    () => value.manager.assertSafeForLifecycle(value.id),
    (error) => error.code === 'UPDATE_RECOVERY_REQUIRED',
  );
});

test('detects any world or mutable-state mutation in the candidate before swapping', async (t) => {
  const value = await fixture(t, {
    prepareCandidate: async ({ candidateDirectory, target: preparedTarget }) => {
      const result = await writeCandidateArtifacts(candidateDirectory, NEW_ARTIFACT, preparedTarget);
      await fs.writeFile(path.join(candidateDirectory, 'world', 'level.dat'), 'tampered-world');
      return result;
    },
  });
  await assert.rejects(() => value.manager.update({ instanceId: value.id }), /changed the Minecraft world/);
  assert.equal(await fs.readFile(path.join(value.instanceDirectory, 'world', 'level.dat'), 'utf8'), 'irreplaceable-world-metadata');
  assert.deepEqual(await fs.readFile(path.join(value.instanceDirectory, 'fabric-server-launch.jar')), OLD_ARTIFACT);
  const marker = JSON.parse(await fs.readFile((await transactionFiles(value))[0], 'utf8'));
  assert.equal(marker.phase, 'rolled-back');
  const candidate = path.join(value.managedRoot, 'servers', `.${value.id}-candidate-${marker.transactionId}`);
  assert.equal(await fileExists(candidate), false, 'verified rollback removes its generated candidate');
});

test('rechecks the held live source after final candidate verification and fences late writes', async (t) => {
  const value = await fixture(t, { mutateSourceDuringFinalCandidateVerification: true });
  await assert.rejects(
    () => value.manager.update({ instanceId: value.id }),
    /manual recovery|changed during final update publication verification/,
  );
  assert.equal(value.state.sourceMutatedDuringPublication, true);
  assert.equal(await fs.readFile(path.join(value.instanceDirectory, 'ops.json'), 'utf8'), '[{"uuid":"late-family-admin"}]\n');
  assert.deepEqual(await fs.readFile(path.join(value.instanceDirectory, 'fabric-server-launch.jar')), OLD_ARTIFACT);
  const marker = JSON.parse(await fs.readFile((await transactionFiles(value))[0], 'utf8'));
  assert.equal(marker.phase, 'rollback-failed');
});

test('rejects a same-content canonical directory substitution before publication without deleting either tree', async (t) => {
  const value = await fixture(t, { replaceSourceDuringFinalCandidateVerification: true });
  await assert.rejects(
    () => value.manager.update({ instanceId: value.id }),
    /manual recovery|changed identity/i,
  );
  assert.equal(value.state.sourceReplacedDuringPublication, true);
  assert.equal(await fs.readFile(path.join(value.instanceDirectory, 'world', 'level.dat'), 'utf8'), 'irreplaceable-world-metadata');
  assert.equal(
    await fs.readFile(path.join(value.state.parkedSourceDirectory, 'world', 'level.dat'), 'utf8'),
    'irreplaceable-world-metadata',
  );
  const marker = JSON.parse(await fs.readFile((await transactionFiles(value))[0], 'utf8'));
  assert.equal(marker.phase, 'rollback-failed');
});

test('startup reconciliation restores an interrupted original-backed-up transaction without deleting the candidate', async (t) => {
  const value = await fixture(t);
  const result = await value.manager.update({ instanceId: value.id });
  const transactionId = result.transaction.transactionId;
  const markerPath = path.join(value.managedRoot, 'state', 'update-transactions', value.id, `${transactionId}.json`);
  const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
  const candidate = path.join(value.managedRoot, 'servers', `.${value.id}-candidate-${transactionId}`);

  // Recreate the exact on-disk state after source->backup but before candidate->canonical.
  await fs.rename(value.instanceDirectory, candidate);
  marker.phase = 'original-backed-up';
  await fs.writeFile(markerPath, `${JSON.stringify(signTestMarker(marker), null, 2)}\n`);
  value.store.records.set(value.id, clone(marker.originalRecord));

  const recovery = await value.manager.reconcileInterruptedTransactions();
  assert.deepEqual(recovery.map(({ action }) => action), ['rolled-back']);
  assert.deepEqual(await fs.readFile(path.join(value.instanceDirectory, 'fabric-server-launch.jar')), OLD_ARTIFACT);
  assert.equal(await fileExists(candidate), false, 'recovery removes the generated candidate after restoring the original');
  assert.equal((await value.store.get(value.id)).loaderVersion, '0.19.3');
  assert.equal(JSON.parse(await fs.readFile(markerPath, 'utf8')).phase, 'rolled-back');
});

test('startup reconciliation preserves a published candidate once its inventory commit is visible', async (t) => {
  const value = await fixture(t);
  const result = await value.manager.update({ instanceId: value.id });
  const transactionId = result.transaction.transactionId;
  const markerPath = path.join(value.managedRoot, 'state', 'update-transactions', value.id, `${transactionId}.json`);
  const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
  marker.phase = 'candidate-published';
  await fs.writeFile(markerPath, `${JSON.stringify(signTestMarker(marker), null, 2)}\n`);

  const recovery = await value.manager.reconcileInterruptedTransactions();
  assert.equal(recovery[0].action, 'awaiting-readiness');
  assert.deepEqual(await fs.readFile(path.join(value.instanceDirectory, 'fabric-server-launch.jar')), NEW_ARTIFACT);
  assert.equal(await fs.readFile(path.join(value.instanceDirectory, 'world', 'level.dat'), 'utf8'), 'irreplaceable-world-metadata');
  const backup = path.join(value.managedRoot, 'backups', value.id, transactionId, 'instance');
  assert.deepEqual(await fs.readFile(path.join(backup, 'fabric-server-launch.jar')), OLD_ARTIFACT);
  assert.equal((await value.store.get(value.id)).updateStatus.state, 'pending-unverified');
  assert.equal(JSON.parse(await fs.readFile(markerPath, 'utf8')).phase, 'pending-readiness');
});

test('startup reconciliation preserves a pending-unverified transaction and its rollback backup', async (t) => {
  const value = await fixture(t);
  const result = await value.manager.update({ instanceId: value.id });
  assert.equal(result.transaction.phase, 'pending-readiness');

  const recoveryManager = new FamilyServerUpdateManager(value.managedRoot, value.store, {
    resolveTarget: async () => clone(value.target),
    prepareCandidate: async () => { throw new Error('recovery must not build a new candidate'); },
    isInstanceActive: async () => false,
    assertQuiescentWithinInstanceLock: async () => true,
    withInstanceLock: async (_instanceId, operation) => operation(),
    assertStackUpdateAllowedWithinInstanceLock: async () => true,
    nativeFilesystemGuards: false,
    markerAuthenticationKey: UPDATE_MARKER_KEY,
  });
  const recovery = await recoveryManager.reconcileInterruptedTransactions();
  assert.equal(recovery[0].action, 'awaiting-readiness');
  assert.deepEqual(await fs.readFile(path.join(value.instanceDirectory, 'fabric-server-launch.jar')), NEW_ARTIFACT);
  assert.equal((await value.store.get(value.id)).updateStatus.state, 'pending-unverified');
  const backup = path.join(value.managedRoot, 'backups', value.id, result.transaction.transactionId, 'instance');
  assert.deepEqual(await fs.readFile(path.join(backup, 'fabric-server-launch.jar')), OLD_ARTIFACT);
});

test('readiness observation survives a crash before inventory verification and is finalized on startup', async (t) => {
  let failReadinessPhase = true;
  const value = await fixture(t, {
    onPhase: ({ phase }) => {
      if (phase === 'readiness-observed' && failReadinessPhase) {
        failReadinessPhase = false;
        throw new Error('simulated crash after readiness observation');
      }
    },
  });
  const result = await value.manager.update({ instanceId: value.id });
  await assert.rejects(() => value.manager.markReady({
    instanceId: value.id,
    transactionId: result.transaction.transactionId,
  }), /simulated crash/);
  assert.equal((await value.store.get(value.id)).updateStatus.state, 'pending-unverified');

  const recovery = await value.manager.reconcileInterruptedTransactions();
  assert.equal(recovery[0].action, 'readiness-finalized');
  assert.equal((await value.store.get(value.id)).updateStatus.state, 'verified');
  const markerPath = path.join(value.managedRoot, 'state', 'update-transactions', value.id, `${result.transaction.transactionId}.json`);
  assert.equal(JSON.parse(await fs.readFile(markerPath, 'utf8')).phase, 'ready');
  const backup = path.join(value.managedRoot, 'backups', value.id, result.transaction.transactionId, 'instance');
  assert.deepEqual(await fs.readFile(path.join(backup, 'fabric-server-launch.jar')), OLD_ARTIFACT);
});

test('startup rejects wrong-key, tampered, and noncanonical update recovery evidence', async (t) => {
  await t.test('wrong authentication key', async (child) => {
    const value = await fixture(child);
    await value.manager.update({ instanceId: value.id });
    const recovery = recoveryManager(value, { markerAuthenticationKey: Buffer.alloc(32, 0x33) });
    await assert.rejects(() => recovery.reconcileInterruptedTransactions(), /authentication failed/i);
    await assert.rejects(() => recovery.assertSafeForLifecycle(value.id, { allowPendingReadiness: true }),
      (error) => error.code === 'UPDATE_RECOVERY_REQUIRED');
  });

  await t.test('authenticated field tamper', async (child) => {
    const value = await fixture(child);
    await value.manager.update({ instanceId: value.id });
    const [markerPath] = await transactionFiles(value);
    const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
    marker.phase = 'ready';
    await fs.writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
    const recovery = recoveryManager(value);
    await assert.rejects(() => recovery.reconcileInterruptedTransactions(), /authentication failed/i);
    await assert.rejects(() => recovery.assertSafeForLifecycle(value.id),
      (error) => error.code === 'UPDATE_RECOVERY_REQUIRED');
  });

  await t.test('whitespace-padded signed marker', async (child) => {
    const value = await fixture(child);
    await value.manager.update({ instanceId: value.id });
    const [markerPath] = await transactionFiles(value);
    await fs.appendFile(markerPath, ' \r\n');
    const recovery = recoveryManager(value);
    await assert.rejects(() => recovery.reconcileInterruptedTransactions(), /canonical (?:JSON|serialized form)/i);
    await assert.rejects(() => recovery.assertSafeForLifecycle(value.id),
      (error) => error.code === 'UPDATE_RECOVERY_REQUIRED');
  });
});

test('startup rejects junk and aggregate-overquota update recovery namespaces', async (t) => {
  await t.test('unexpected root entry', async (child) => {
    const value = await fixture(child);
    const root = path.join(value.managedRoot, 'state', 'update-transactions');
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, '.update-state-crash.tmp'), 'untrusted');
    const recovery = recoveryManager(value);
    await assert.rejects(() => recovery.reconcileInterruptedTransactions(), /unexpected entry|unsafe filename/i);
    await assert.rejects(() => recovery.assertSafeForLifecycle(value.id),
      (error) => error.code === 'UPDATE_RECOVERY_REQUIRED');
  });

  await t.test('aggregate marker bytes', async (child) => {
    const value = await fixture(child);
    const directory = path.join(value.managedRoot, 'state', 'update-transactions', value.id);
    await fs.mkdir(directory, { recursive: true });
    for (let index = 0; index < 17; index += 1) {
      const transactionId = `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
      const handle = await fs.open(path.join(directory, `${transactionId}.json`), 'w', 0o600);
      try { await handle.writeFile('{}'); await handle.truncate(4 * 1024 * 1024); }
      finally { await handle.close(); }
    }
    const recovery = recoveryManager(value);
    await assert.rejects(() => recovery.reconcileInterruptedTransactions(), /safe quota/i);
    await assert.rejects(() => recovery.assertSafeForLifecycle(value.id),
      (error) => error.code === 'UPDATE_RECOVERY_REQUIRED');
  });
});

test('recovery authenticates the complete journal before any live mutation', async (t) => {
  await t.test('a later tampered marker prevents an earlier valid rollback', async (child) => {
    const value = await fixture(child);
    await value.manager.update({ instanceId: value.id });
    const [markerPath] = await transactionFiles(value);
    const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
    marker.phase = 'original-backed-up';
    await fs.writeFile(markerPath, `${JSON.stringify(signTestMarker(marker), null, 2)}\n`);
    const secondId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const tampered = signTestMarker({ ...marker, transactionId: secondId });
    tampered.phase = 'pending-readiness';
    await fs.writeFile(path.join(path.dirname(markerPath), `${secondId}.json`), `${JSON.stringify(tampered, null, 2)}\n`);
    const beforeStore = await value.store.get(value.id);
    const recovery = recoveryManager(value);
    await assert.rejects(() => recovery.reconcileInterruptedTransactions(), /authentication failed/i);
    assert.deepEqual(await fs.readFile(path.join(value.instanceDirectory, 'fabric-server-launch.jar')), NEW_ARTIFACT);
    assert.deepEqual(await value.store.get(value.id), beforeStore);
  });

  await t.test('multiple unfinished markers for one instance mutate nothing', async (child) => {
    const value = await fixture(child);
    await value.manager.update({ instanceId: value.id });
    const [markerPath] = await transactionFiles(value);
    const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
    marker.phase = 'original-backed-up';
    await fs.writeFile(markerPath, `${JSON.stringify(signTestMarker(marker), null, 2)}\n`);
    const secondId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const second = signTestMarker({ ...marker, transactionId: secondId, phase: 'pending-readiness' });
    await fs.writeFile(path.join(path.dirname(markerPath), `${secondId}.json`), `${JSON.stringify(second, null, 2)}\n`);
    const beforeStore = await value.store.get(value.id);
    const recovery = recoveryManager(value);
    await assert.rejects(() => recovery.reconcileInterruptedTransactions(), /multiple unfinished transactions/i);
    assert.deepEqual(await fs.readFile(path.join(value.instanceDirectory, 'fabric-server-launch.jar')), NEW_ARTIFACT);
    assert.deepEqual(await value.store.get(value.id), beforeStore);
  });
});

test('native recovery key validation rejects NTFS alternate streams', { skip: process.platform !== 'win32' }, async (t) => {
  const value = await fixture(t);
  const first = recoveryManager(value, { markerAuthenticationKey: null, nativeFilesystemGuards: true });
  await first.reconcileInterruptedTransactions();
  const keyPath = path.join(value.managedRoot, 'state', 'update-transactions.hmac.key');
  await fs.writeFile(`${keyPath}:untrusted`, 'tamper');
  await assert.rejects(
    () => first.update({ instanceId: value.id }),
    /alternate data stream|safe private file|integrity|unsafe Windows filesystem metadata/i,
  );
  assert.deepEqual(
    await fs.readdir(path.join(value.managedRoot, 'state', 'update-transactions', value.id)).catch(() => []),
    [],
  );
  const second = recoveryManager(value, { markerAuthenticationKey: null, nativeFilesystemGuards: true });
  await assert.rejects(() => second.reconcileInterruptedTransactions(), /alternate data stream|safe private file|integrity|unsafe Windows filesystem metadata/i);
  await assert.rejects(() => second.assertSafeForLifecycle(value.id),
    (error) => error.code === 'UPDATE_RECOVERY_REQUIRED');
});

test('same-process recovery key continuity rejects deletion or different bytes before marker publication', async (t) => {
  for (const mutation of ['delete', 'replace']) {
    await t.test(mutation, async (child) => {
      const value = await fixture(child);
      const manager = recoveryManager(value, { markerAuthenticationKey: null });
      await manager.reconcileInterruptedTransactions();
      const keyPath = path.join(value.managedRoot, 'state', 'update-transactions.hmac.key');
      if (mutation === 'delete') await fs.rm(keyPath);
      else await fs.writeFile(keyPath, Buffer.alloc(32, 0x44));
      await assert.rejects(
        () => manager.update({ instanceId: value.id }),
        /authentication evidence (?:disappeared|changed) after startup/,
      );
      assert.deepEqual(
        await fs.readdir(path.join(value.managedRoot, 'state', 'update-transactions', value.id)).catch(() => []),
        [],
      );
      const fresh = recoveryManager(value, { markerAuthenticationKey: null });
      assert.deepEqual(await fresh.reconcileInterruptedTransactions(), []);
    });
  }
});

test('marker admission and lifecycle return revalidate the external recovery key at their final boundary', async (t) => {
  await t.test('post-publication admission boundary', async (child) => {
    const value = await fixture(child);
    const manager = recoveryManager(value, {
      markerAuthenticationKey: null,
      prepareCandidate: ({ candidateDirectory, target }) => writeCandidateArtifacts(candidateDirectory, NEW_ARTIFACT, target),
    });
    await manager.reconcileInterruptedTransactions();
    const keyPath = path.join(value.managedRoot, 'state', 'update-transactions.hmac.key');
    const originalPreflight = manager.preflightRecoveryEvidence.bind(manager);
    let replaced = false;
    manager.preflightRecoveryEvidence = async () => {
      const evidence = await originalPreflight();
      if (!replaced && evidence.instances.length === 1) {
        replaced = true;
        await fs.writeFile(keyPath, Buffer.alloc(32, 0x31));
      }
      return evidence;
    };
    await assert.rejects(
      () => manager.update({ instanceId: value.id }),
      /authentication evidence changed after startup/,
    );
    assert.equal(replaced, true);
    assert.deepEqual(
      await fs.readdir(path.join(value.managedRoot, 'state', 'update-transactions', value.id)).catch(() => []),
      [],
    );
    assert.deepEqual(
      (await fs.readdir(path.join(value.managedRoot, 'servers')))
        .filter((name) => name.startsWith(`.${value.id}-candidate-`)),
      [],
    );
  });

  await t.test('lifecycle return boundary', async (child) => {
    const value = await fixture(child);
    const manager = recoveryManager(value, {
      markerAuthenticationKey: null,
      prepareCandidate: ({ candidateDirectory, target }) => writeCandidateArtifacts(candidateDirectory, NEW_ARTIFACT, target),
    });
    await manager.reconcileInterruptedTransactions();
    const pending = await manager.update({ instanceId: value.id });
    assert.equal(pending.transaction.phase, 'pending-readiness');
    const keyPath = path.join(value.managedRoot, 'state', 'update-transactions.hmac.key');
    const originalList = value.store.list.bind(value.store);
    let replaced = false;
    value.store.list = async () => {
      const records = await originalList();
      if (!replaced) {
        replaced = true;
        await fs.writeFile(keyPath, Buffer.alloc(32, 0x32));
      }
      return records;
    };
    await assert.rejects(
      () => manager.assertSafeForLifecycle(value.id, { allowPendingReadiness: true }),
      /authentication evidence changed after startup|could not be verified/,
    );
    assert.equal(replaced, true);
  });
});

test('authenticated mutation custody detects an external key swap during candidate preparation', async (t) => {
  const value = await fixture(t);
  const keyPath = path.join(value.managedRoot, 'state', 'update-transactions.hmac.key');
  let swapped = false;
  const manager = recoveryManager(value, {
    markerAuthenticationKey: null,
    prepareCandidate: async ({ candidateDirectory, target }) => {
      const result = await writeCandidateArtifacts(candidateDirectory, NEW_ARTIFACT, target);
      await fs.writeFile(keyPath, Buffer.alloc(32, 0x63));
      swapped = true;
      return result;
    },
  });
  await manager.reconcileInterruptedTransactions();
  await assert.rejects(
    () => manager.update({ instanceId: value.id }),
    /authentication evidence changed|manual recovery/i,
  );
  assert.equal(swapped, true);
  assert.deepEqual(await fs.readFile(path.join(value.instanceDirectory, 'fabric-server-launch.jar')), OLD_ARTIFACT);
  assert.equal((await value.store.get(value.id)).updateStatus, undefined);
  const [markerPath] = await transactionFiles(value);
  assert.equal(JSON.parse(await fs.readFile(markerPath, 'utf8')).phase, 'preparing');
  assert.equal(
    (await fs.readdir(path.join(value.managedRoot, 'servers')))
      .some((name) => name.startsWith(`.${value.id}-candidate-`)),
    true,
    'an unauthenticated generated candidate must remain fenced for recovery instead of being deleted',
  );
});

test('retained rollback payload explicitly blocks another update', async (t) => {
  const value = await fixture(t);
  const first = await value.manager.update({ instanceId: value.id });
  await value.manager.markReady({ instanceId: value.id, transactionId: first.transaction.transactionId });
  value.setTarget(targetPlan({ components: components('third') }));
  await assert.rejects(() => value.manager.update({ instanceId: value.id }),
    (error) => error.code === 'UPDATE_BACKUP_RETENTION_REQUIRED');
  assert.equal(await fileExists(path.join(value.managedRoot, 'backups', value.id, first.transaction.transactionId, 'instance')), true);
});

test('a missing retained rollback payload becomes a recovery fence, never free capacity', async (t) => {
  const value = await fixture(t);
  const first = await value.manager.update({ instanceId: value.id });
  await value.manager.markReady({ instanceId: value.id, transactionId: first.transaction.transactionId });
  await value.manager.reconcileInterruptedTransactions();
  const backup = path.join(value.managedRoot, 'backups', value.id, first.transaction.transactionId, 'instance');
  await fs.rm(backup, { recursive: true, force: true });
  const beforeStore = await value.store.get(value.id);
  const beforeMarkers = await transactionFiles(value);
  value.setTarget(targetPlan({ components: components('third') }));
  await assert.rejects(() => value.manager.update({ instanceId: value.id }),
    (error) => error.code === 'UPDATE_RECOVERY_REQUIRED');
  assert.deepEqual(await value.store.get(value.id), beforeStore);
  assert.deepEqual(await transactionFiles(value), beforeMarkers);
  await assert.rejects(() => value.manager.assertSafeForLifecycle(value.id),
    (error) => error.code === 'UPDATE_RECOVERY_REQUIRED');
});

test('cleanup presence checks fail closed on access errors', async (t) => {
  const value = await fixture(t);
  const first = await value.manager.update({ instanceId: value.id });
  await value.manager.markReady({ instanceId: value.id, transactionId: first.transaction.transactionId });
  const transactionRoot = path.join(value.managedRoot, 'backups', value.id, first.transaction.transactionId);
  const backup = path.join(transactionRoot, 'instance');
  const cleanupRoot = path.join(transactionRoot, '.retired-version-cleanup');
  const beforeStore = await value.store.get(value.id);
  const originalLstat = fs.lstat;
  t.after(() => { fs.lstat = originalLstat; });

  fs.lstat = async (target, ...args) => {
    if (path.resolve(target) === path.resolve(backup)) {
      throw Object.assign(new Error('simulated access denial'), { code: 'EACCES' });
    }
    return originalLstat(target, ...args);
  };
  value.setTarget(targetPlan({ components: components('third') }));
  await assert.rejects(() => value.manager.update({ instanceId: value.id }), (error) => error.code === 'EACCES');
  fs.lstat = originalLstat;
  assert.deepEqual(await value.store.get(value.id), beforeStore);

  fs.lstat = async (target, ...args) => {
    if (path.resolve(target) === path.resolve(cleanupRoot)) {
      throw Object.assign(new Error('simulated cleanup access denial'), { code: 'EACCES' });
    }
    return originalLstat(target, ...args);
  };
  await assert.rejects(() => value.manager.purgeRetiredVersion({ instanceId: value.id }), (error) => error.code === 'EACCES');
  fs.lstat = originalLstat;
  assert.deepEqual(await value.store.get(value.id), beforeStore);
});

test('recursive cleanup releases every rebound injected guard after nested and root deletion failures', async (t) => {
  for (const scenario of [
    {
      name: 'nested-child-parent',
      matches: (target) => target.endsWith(path.join('world', 'region', 'r.0.0.mca')),
    },
    {
      name: 'tombstone-root',
      matches: (target) => path.basename(target) === 'ops.json',
    },
  ]) {
    await t.test(scenario.name, async (child) => {
      const state = { activeGuards: 0, remainingFailures: 0 };
      const makeGuard = (kind, target) => {
        state.activeGuards += 1;
        let terminal = false;
        const finish = async (operation) => {
          if (terminal) return;
          terminal = true;
          try { await operation?.(); } finally { state.activeGuards -= 1; }
        };
        return {
          assertHeld() { if (terminal) throw new Error('injected cleanup guard used after terminal completion'); },
          release: () => finish(),
          delete: () => finish(async () => {
            if (kind === 'file' && state.remainingFailures > 0 && scenario.matches(target)) {
              state.remainingFailures -= 1;
              throw new Error('simulated guarded cleanup deletion failure');
            }
            if (kind === 'directory') await fs.rmdir(target);
            else await fs.unlink(target);
          }),
          rename: (destination) => finish(() => fs.rename(target, destination)),
          replace: (destination) => finish(async () => {
            await fs.rm(destination, { force: true });
            await fs.rename(target, destination);
          }),
        };
      };
      const directoryGuard = async (target) => makeGuard('directory', target);
      directoryGuard.batch = async (targets) => targets.map((target) => makeGuard('directory', target));
      const fileGuard = async (target) => makeGuard('file', target);
      fileGuard.batch = async (targets) => targets.map((target) => makeGuard('file', target));
      const value = await fixture(child, { directoryGuard, fileGuard });
      const update = await value.manager.update({ instanceId: value.id });
      await value.manager.markReady({ instanceId: value.id, transactionId: update.transaction.transactionId });
      assert.equal(state.activeGuards, 0);

      state.remainingFailures = 2;
      await assert.rejects(
        () => value.manager.purgeRetiredVersion({ instanceId: value.id }),
        /Retired-version cleanup requires startup reconciliation/,
      );
      assert.equal(state.remainingFailures, 0, 'both immediate cleanup attempts must reach the injected failure');
      assert.equal(state.activeGuards, 0, 'all original and rebound cleanup guards must be released after failure');
      const markerPath = path.join(
        value.managedRoot,
        'state',
        'update-transactions',
        value.id,
        `${update.transaction.transactionId}.json`,
      );
      const interrupted = JSON.parse(await fs.readFile(markerPath, 'utf8'));
      assert.equal(interrupted.retiredCleanup.state, 'inventory-committed');
      const cleanupRoot = path.join(
        value.managedRoot,
        'backups',
        value.id,
        update.transaction.transactionId,
        '.retired-version-cleanup',
      );
      assert.equal(await fileExists(`${cleanupRoot}.update-delete`), true);

      const recovery = await value.manager.reconcileInterruptedTransactions();
      assert.equal(recovery.some((entry) => entry.action === 'retired-version-purged'), true);
      assert.equal(JSON.parse(await fs.readFile(markerPath, 'utf8')).retiredCleanup.state, 'purged');
      assert.equal(await fileExists(`${cleanupRoot}.update-delete`), false);
      assert.equal(state.activeGuards, 0, 'successful recovery must also release every injected guard peer');
    });
  }
});

test('startup resumes a deterministic rolled-back candidate tombstone and rejects unknown tombstones', async (t) => {
  await t.test('known rolled-back payload tombstone', async (child) => {
    const value = await fixture(child);
    const result = await value.manager.update({ instanceId: value.id });
    const markerPath = path.join(value.managedRoot, 'state', 'update-transactions', value.id, `${result.transaction.transactionId}.json`);
    const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
    const candidate = path.join(value.managedRoot, 'servers', `.${value.id}-candidate-${marker.transactionId}`);
    const candidateTombstone = `${candidate}.update-delete`;
    await fs.rename(value.instanceDirectory, candidateTombstone);
    marker.phase = 'rolling-back';
    marker.rollbackOriginPhase = 'original-backed-up';
    await fs.writeFile(markerPath, `${JSON.stringify(signTestMarker(marker), null, 2)}\n`);

    const recovery = await value.manager.reconcileInterruptedTransactions();
    assert.equal(recovery[0].action, 'rolled-back');
    assert.equal(await fileExists(candidateTombstone), false);
    assert.equal(await fs.readFile(path.join(value.instanceDirectory, 'world', 'level.dat'), 'utf8'), 'irreplaceable-world-metadata');
    assert.equal(JSON.parse(await fs.readFile(markerPath, 'utf8')).phase, 'rolled-back');
  });

  await t.test('unknown cleanup tombstone', async (child) => {
    const value = await fixture(child);
    const victim = path.join(value.instanceDirectory, 'world', 'level.dat');
    const unknown = path.join(value.managedRoot, 'servers', '.unknown-update.update-delete');
    await fs.mkdir(unknown, { recursive: true });
    await fs.writeFile(path.join(unknown, 'payload.bin'), 'must-not-be-deleted');
    await assert.rejects(() => value.manager.preflightRecoveryEvidence(), /unknown tombstone/);
    await assert.rejects(() => value.manager.reconcileInterruptedTransactions(), /unknown tombstone/);
    assert.equal(await fs.readFile(victim, 'utf8'), 'irreplaceable-world-metadata');
    assert.equal(await fs.readFile(path.join(unknown, 'payload.bin'), 'utf8'), 'must-not-be-deleted');
  });
});

test('post-publication journal admission rejects a concurrent aggregate-quota insertion before candidate mutation', async (t) => {
  const value = await fixture(t);
  const transactionRoot = path.join(value.managedRoot, 'state', 'update-transactions');
  const otherInstanceRoot = path.join(transactionRoot, 'family-other');
  await fs.mkdir(otherInstanceRoot, { recursive: true });
  for (let index = 0; index < 15; index += 1) {
    const transactionId = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    const handle = await fs.open(path.join(otherInstanceRoot, `${transactionId}.json`), 'w');
    try { await handle.truncate(4 * 1024 * 1024); }
    finally { await handle.close(); }
  }

  const originalOpen = fs.open;
  let inserted = false;
  fs.open = async (target, ...args) => {
    const handle = await originalOpen(target, ...args);
    if (!inserted && path.basename(String(target)).startsWith('.update-state-')
      && path.dirname(String(target)).endsWith(path.join('update-transactions', value.id))) {
      inserted = true;
      const concurrent = path.join(otherInstanceRoot, '00000000-0000-4000-8000-999999999999.json');
      const concurrentHandle = await originalOpen(concurrent, 'w');
      try { await concurrentHandle.truncate(4 * 1024 * 1024); }
      finally { await concurrentHandle.close(); }
    }
    return handle;
  };
  t.after(() => { fs.open = originalOpen; });

  await assert.rejects(
    () => value.manager.update({ instanceId: value.id }),
    /journal exceeds its safe quota/,
  );
  fs.open = originalOpen;
  assert.equal(inserted, true);
  assert.equal(value.state.prepareCalls, 0);
  assert.equal((await fs.readdir(path.join(transactionRoot, value.id)).catch(() => [])).length, 0);
  const candidates = (await fs.readdir(path.join(value.managedRoot, 'servers')))
    .filter((name) => name.startsWith(`.${value.id}-candidate-`));
  assert.deepEqual(candidates, []);
});

test('marker admission authenticates the full global journal and admits no other unfinished transaction', async (t) => {
  await t.test('invalid marker for another instance', async (child) => {
    const value = await fixture(child);
    const otherDirectory = path.join(value.managedRoot, 'state', 'update-transactions', 'family-other');
    await fs.mkdir(otherDirectory, { recursive: true });
    const invalid = { schemaVersion: 1, mac: '0'.repeat(64) };
    await fs.writeFile(
      path.join(otherDirectory, '00000000-0000-4000-8000-000000000001.json'),
      `${JSON.stringify(invalid, null, 2)}\n`,
    );
    await assert.rejects(() => value.manager.update({ instanceId: value.id }), /authentication failed/i);
    assert.equal(value.state.prepareCalls, 0);
    assert.deepEqual(
      (await fs.readdir(path.join(value.managedRoot, 'servers')))
        .filter((name) => name.startsWith(`.${value.id}-candidate-`)),
      [],
    );
  });

  await t.test('authenticated unfinished transaction for another managed instance', async (child) => {
    const value = await fixture(child);
    const otherId = 'family-other';
    const otherDirectory = path.join(value.managedRoot, 'servers', otherId);
    await fs.cp(value.instanceDirectory, otherDirectory, { recursive: true });
    const source = await value.store.get(value.id);
    value.store.records.set(otherId, { ...source, id: otherId, directory: otherDirectory });
    await value.manager.update({ instanceId: otherId });
    const prepareCalls = value.state.prepareCalls;
    await assert.rejects(
      () => value.manager.update({ instanceId: value.id }),
      /Another update transaction requires recovery/,
    );
    assert.equal(value.state.prepareCalls, prepareCalls);
    assert.deepEqual(
      (await fs.readdir(path.join(value.managedRoot, 'state', 'update-transactions', value.id)).catch(() => [])),
      [],
    );
  });
});

test('preparing admission without a payload directory rolls back once and remains clean on the next preflight', async (t) => {
  const value = await fixture(t, {
    prepareCandidate: async () => { throw new Error('simulated pre-publication failure'); },
  });
  await assert.rejects(() => value.manager.update({ instanceId: value.id }), /simulated pre-publication failure/);
  const markerDirectory = path.join(value.managedRoot, 'state', 'update-transactions', value.id);
  const [markerName] = await fs.readdir(markerDirectory);
  const markerPath = path.join(markerDirectory, markerName);
  const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
  marker.phase = 'preparing';
  marker.updatedAt = marker.createdAt;
  delete marker.rollbackOriginPhase;
  delete marker.rollbackReason;
  delete marker.rolledBackAt;
  delete marker.rollbackError;
  await fs.writeFile(markerPath, `${JSON.stringify(signTestMarker(marker), null, 2)}\n`);
  const payloadDirectory = path.join(value.managedRoot, 'backups', value.id, marker.transactionId);
  await fs.rm(payloadDirectory, { recursive: true, force: true });

  const recovery = recoveryManager(value);
  assert.deepEqual(await recovery.preflightRecoveryEvidence(), {
    domain: 'update', instances: [{ instanceId: value.id, transactionRef: marker.transactionId }],
  });
  const result = await recovery.reconcileInterruptedTransactions();
  assert.equal(result[0].action, 'rolled-back');
  assert.equal(JSON.parse(await fs.readFile(markerPath, 'utf8')).phase, 'rolled-back');
  assert.equal(await fileExists(payloadDirectory), true);
  assert.deepEqual(await recovery.preflightRecoveryEvidence(), { domain: 'update', instances: [] });
});

test('preflight binds every update receipt to its exact authenticated marker', async (t) => {
  await t.test('missing marker and payload', async (child) => {
    const value = await fixture(child);
    const result = await value.manager.update({ instanceId: value.id });
    const transactionId = result.transaction.transactionId;
    await fs.rm(path.join(value.managedRoot, 'state', 'update-transactions', value.id), { recursive: true, force: true });
    await fs.rm(path.join(value.managedRoot, 'backups', value.id), { recursive: true, force: true });
    await assert.rejects(
      () => value.manager.preflightRecoveryEvidence(),
      /missing its authenticated transaction marker/,
    );
    assert.equal((await value.store.get(value.id)).updateStatus.transactionId, transactionId);
  });

  await t.test('contradictory same-transaction receipt', async (child) => {
    const value = await fixture(child);
    await value.manager.update({ instanceId: value.id });
    const current = await value.store.get(value.id);
    await value.store.update(value.id, { updateStatus: { ...current.updateStatus, planId: '0'.repeat(64) } });
    await assert.rejects(
      () => value.manager.preflightRecoveryEvidence(),
      /contradicts its authenticated transaction marker/,
    );
  });
});

test('explicit verified-payload purge permits a later component update', async (t) => {
  const value = await fixture(t);
  const first = await value.manager.update({ instanceId: value.id });
  await value.manager.markReady({ instanceId: value.id, transactionId: first.transaction.transactionId });
  const purge = await value.manager.purgeRetiredVersion({ instanceId: value.id });
  assert.equal(purge.action, 'retired-version-purged');
  assert.equal(purge.backupAvailable, false);
  assert.equal(purge.cacheEntriesPurged, 0);
  value.setTarget(targetPlan({ components: components('third') }));
  const second = await value.manager.update({ instanceId: value.id });
  assert.equal(second.action, 'updated');
  assert.equal(second.transaction.phase, 'pending-readiness');
});

test('startup accepts only an authenticated terminal legacy attestation for the pre-snapshot marker shape', async (t) => {
  const value = await fixture(t);
  const update = await value.manager.update({ instanceId: value.id });
  await value.manager.markReady({ instanceId: value.id, transactionId: update.transaction.transactionId });
  await value.manager.purgeRetiredVersion({ instanceId: value.id });

  const originalMarkerPath = path.join(
    value.managedRoot,
    'state',
    'update-transactions',
    value.id,
    `${update.transaction.transactionId}.json`,
  );
  const markerPath = path.join(path.dirname(originalMarkerPath), `${LEGACY_TERMINAL_TRANSACTION_ID}.json`);
  const marker = JSON.parse(await fs.readFile(originalMarkerPath, 'utf8'));
  marker.transactionId = LEGACY_TERMINAL_TRANSACTION_ID;
  delete marker.managedBefore;
  delete marker.sourceDirectoryIdentity;
  delete marker.target.minecraftServerArtifact;
  marker.updateKind = 'legacy-migration';
  marker.legacyTerminalAttestation = createLegacyUpdateTerminalAttestation({
    adoptedAt: '2026-08-14T23:55:00.000Z',
    originalMarkerSha256: LEGACY_TERMINAL_MARKER_SHA256,
    instanceStoreSha256: LEGACY_TERMINAL_INSTANCE_STORE_SHA256,
    instanceRecordSha256: LEGACY_TERMINAL_INSTANCE_RECORD_SHA256,
    keySha256: crypto.createHash('sha256').update(UPDATE_MARKER_KEY).digest('hex'),
  });
  await fs.writeFile(markerPath, `${JSON.stringify(signTestMarker(marker), null, 2)}\n`);
  await fs.unlink(originalMarkerPath);
  await fs.rename(
    path.join(value.managedRoot, 'backups', value.id, update.transaction.transactionId),
    path.join(value.managedRoot, 'backups', value.id, LEGACY_TERMINAL_TRANSACTION_ID),
  );
  const current = await value.store.get(value.id);
  await value.store.update(value.id, {
    updateStatus: {
      ...current.updateStatus,
      transactionId: LEGACY_TERMINAL_TRANSACTION_ID,
      kind: 'legacy-migration',
    },
  });

  const recovery = recoveryManager(value);
  assert.deepEqual(await recovery.preflightRecoveryEvidence(), { domain: 'update', instances: [] });
  const result = await recovery.reconcileInterruptedTransactions();
  assert.equal(result.some((item) => item.transactionId === LEGACY_TERMINAL_TRANSACTION_ID
    && item.phase === 'ready' && item.action === 'none'), true);
  assert.equal(await recovery.assertSafeForLifecycle(value.id), true);

  const wrongKeyBinding = JSON.parse(await fs.readFile(markerPath, 'utf8'));
  wrongKeyBinding.legacyTerminalAttestation.keySha256 = 'f'.repeat(64);
  await fs.writeFile(markerPath, `${JSON.stringify(signTestMarker(wrongKeyBinding), null, 2)}\n`);
  await assert.rejects(
    recoveryManager(value).preflightRecoveryEvidence(),
    /authentication failed/,
  );
});

test('startup verifies multiple retained ready receipts without hashing historical payloads', async (t) => {
  const value = await fixture(t);
  const first = await value.manager.update({ instanceId: value.id });
  await value.manager.markReady({ instanceId: value.id, transactionId: first.transaction.transactionId });
  const firstMarkerPath = path.join(value.managedRoot, 'state', 'update-transactions', value.id, `${first.transaction.transactionId}.json`);
  const firstMarker = JSON.parse(await fs.readFile(firstMarkerPath, 'utf8'));
  const secondId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const secondMarkerPath = path.join(path.dirname(firstMarkerPath), `${secondId}.json`);
  await fs.writeFile(secondMarkerPath, `${JSON.stringify(signTestMarker({ ...firstMarker, transactionId: secondId }), null, 2)}\n`);
  const firstBackup = path.join(value.managedRoot, 'backups', value.id, first.transaction.transactionId, 'instance');
  const secondBackup = path.join(value.managedRoot, 'backups', value.id, secondId, 'instance');
  await fs.mkdir(path.dirname(secondBackup), { recursive: true });
  await fs.cp(firstBackup, secondBackup, { recursive: true });
  const current = await value.store.get(value.id);
  await value.store.update(value.id, { updateStatus: { ...current.updateStatus, transactionId: secondId } });

  const scannedRoots = [];
  const recovery = recoveryManager(value, {
    filesystemTreeVerifier: async (target) => { scannedRoots.push(path.resolve(target)); return { ok: true, checked: true }; },
  });
  const results = await recovery.reconcileInterruptedTransactions();
  assert.equal(results.some((item) => item.transactionId === first.transaction.transactionId
    && item.action === 'historical-terminal-verified'), true);
  assert.equal(results.some((item) => item.transactionId === secondId
    && item.action === 'none'), true);
  assert.equal(results.some((item) => item.action === 'manual-recovery-required'), false);
  assert.equal(await recovery.assertSafeForLifecycle(value.id), true);
  assert.equal(scannedRoots.some((target) => target.startsWith(path.resolve(value.managedRoot, 'backups'))), false);
});

test('candidate publication rejects junction, hardlink, and ADS substitutions without displacing live state', async (t) => {
  await t.test('pinned server version junction', async (child) => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-update-outside-'));
    child.after(() => fs.rm(outside, { recursive: true, force: true }));
    let value;
    value = await fixture(child, {
      prepareCandidate: async ({ candidateDirectory, target: preparedTarget }) => {
        const result = await writeCandidateArtifacts(candidateDirectory, NEW_ARTIFACT, preparedTarget);
        const versionDirectory = path.join(candidateDirectory, 'versions', preparedTarget.minecraftVersion);
        const outsideVersion = path.join(outside, preparedTarget.minecraftVersion);
        await fs.mkdir(outsideVersion, { recursive: true });
        const serverName = `server-${preparedTarget.minecraftVersion}.jar`;
        await fs.copyFile(path.join(versionDirectory, serverName), path.join(outsideVersion, serverName));
        await fs.rm(versionDirectory, { recursive: true, force: true });
        await fs.symlink(outsideVersion, versionDirectory, 'junction');
        return result;
      },
    });
    await assert.rejects(() => value.manager.update({ instanceId: value.id }), /unsafe|symbolic|junction|regular directory|integrity|manual recovery/i);
    assert.deepEqual(await fs.readFile(path.join(value.instanceDirectory, 'fabric-server-launch.jar')), OLD_ARTIFACT);
  });

  await t.test('managed artifact hardlink', async (child) => {
    const outside = path.join(os.tmpdir(), `mastermind-update-hardlink-${crypto.randomUUID()}.jar`);
    child.after(() => fs.rm(outside, { force: true }));
    let value;
    value = await fixture(child, {
      prepareCandidate: async ({ candidateDirectory, target: preparedTarget }) => {
        const result = await writeCandidateArtifacts(candidateDirectory, NEW_ARTIFACT, preparedTarget);
        const target = path.join(candidateDirectory, 'mods', 'fabric-api.jar');
        await fs.writeFile(outside, NEW_ARTIFACT);
        await fs.rm(target);
        await fs.link(outside, target);
        return result;
      },
    });
    await assert.rejects(() => value.manager.update({ instanceId: value.id }), /regular file|unsafe|integrity|manual recovery/i);
    assert.deepEqual(await fs.readFile(path.join(value.instanceDirectory, 'fabric-server-launch.jar')), OLD_ARTIFACT);
    assert.deepEqual(await fs.readFile(outside), NEW_ARTIFACT);
  });

  await t.test('managed artifact alternate stream', { skip: process.platform !== 'win32' }, async (child) => {
    let value;
    value = await fixture(child, {
      nativeFilesystemGuards: true,
      prepareCandidate: async ({ candidateDirectory, target: preparedTarget }) => {
        const result = await writeCandidateArtifacts(candidateDirectory, NEW_ARTIFACT, preparedTarget);
        await fs.writeFile(`${path.join(candidateDirectory, 'mods', 'fabric-api.jar')}:untrusted`, 'tamper');
        return result;
      },
    });
    await assert.rejects(() => value.manager.update({ instanceId: value.id }), /unsafe Windows filesystem metadata|alternate data stream|integrity/i);
    assert.deepEqual(await fs.readFile(path.join(value.instanceDirectory, 'fabric-server-launch.jar')), OLD_ARTIFACT);
  });
});

test('injected persistent broker scopes every default-native updater filesystem operation', async (t) => {
  let instanceLockDepth = 0;
  const injected = injectedPortableFilesystemSafetyBroker(() => instanceLockDepth > 0);
  const value = await fixture(t, {
    nativeFilesystemGuards: true,
    filesystemSafetyBroker: injected.broker,
    withInstanceLock: async (_instanceId, operation) => {
      instanceLockDepth += 1;
      try { return await operation(); } finally { instanceLockDepth -= 1; }
    },
  });

  assert.deepEqual(await value.manager.preflightRecoveryEvidence(), { domain: 'update', instances: [] });
  assert.deepEqual(await value.manager.reconcileInterruptedTransactions(), []);
  assert.equal(await value.manager.assertSafeForLifecycle(value.id), true);

  injected.requireInstanceLock(true);
  const result = await value.manager.update({ instanceId: value.id });
  assert.equal(result.transaction.phase, 'pending-readiness');
  await value.manager.markReady({ instanceId: value.id, transactionId: result.transaction.transactionId });
  const purged = await value.manager.purgeRetiredVersion({ instanceId: value.id });
  injected.requireInstanceLock(false);

  assert.equal(purged.backupAvailable, false);
  assert.equal(injected.state.scopeDepth, 0);
  assert.equal(injected.state.proxyOutsideScope, 0);
  assert.equal(injected.state.lockOrderViolations, 0);
  assert.equal(injected.state.scopeStarts, 7);
  assert.equal(injected.state.guardCalls > 0, true);
  assert.equal(injected.state.verifierCalls > 0, true);
  assert.equal(injected.state.verifierOptions.some((options) => (
    options.maxEntries === 1 && options.maxDepth === 0 && options.recursive === false
  )), true);
});

test('native Windows guards complete update publication, rollback, and retained-payload cleanup', {
  skip: process.platform !== 'win32',
}, async (t) => {
  await t.test('publish and purge', async (child) => {
    const value = await fixture(child, {
      nativeFilesystemGuards: true,
    });
    const result = await value.manager.update({ instanceId: value.id });
    assert.equal(result.transaction.phase, 'pending-readiness');
    assert.deepEqual(await fs.readFile(path.join(value.instanceDirectory, 'fabric-server-launch.jar')), NEW_ARTIFACT);
    await value.manager.markReady({ instanceId: value.id, transactionId: result.transaction.transactionId });
    const purged = await value.manager.purgeRetiredVersion({ instanceId: value.id });
    assert.equal(purged.backupAvailable, false);
    assert.equal(await fileExists(path.join(
      value.managedRoot,
      'backups',
      value.id,
      result.transaction.transactionId,
      'instance',
    )), false);
  });

  await t.test('publish failure rolls back', async (child) => {
    const value = await fixture(child, {
      nativeFilesystemGuards: true,
    });
    value.store.failUpdates = 1;
    await assert.rejects(() => value.manager.update({ instanceId: value.id }), /simulated store commit failure/);
    assert.deepEqual(await fs.readFile(path.join(value.instanceDirectory, 'fabric-server-launch.jar')), OLD_ARTIFACT);
    assert.equal((await value.store.get(value.id)).minecraftVersion, '26.2');
  });
});

test('manual update recovery remains a lifecycle fence', async (t) => {
  let value;
  value = await fixture(t, {
    onPhase: async ({ phase, transactionId }) => {
      if (phase !== 'candidate-published') return;
      await fs.rm(path.join(value.managedRoot, 'backups', value.id, transactionId, 'instance'), { recursive: true, force: true });
      await fs.writeFile(path.join(value.instanceDirectory, 'world', 'level.dat'), 'unrecoverable-world');
      throw new Error('simulated crash after an unrecoverable publication');
    },
  });
  await assert.rejects(() => value.manager.update({ instanceId: value.id }), /manual recovery|simulated crash/i);
  const recovery = await value.manager.reconcileInterruptedTransactions();
  assert.equal(recovery[0].action, 'manual-recovery-required');
  await assert.rejects(() => value.manager.assertSafeForLifecycle(value.id, { allowPendingReadiness: true }),
    (error) => error.code === 'UPDATE_RECOVERY_REQUIRED');
});

test('rejects caller-controlled paths, URLs, executables, and malformed approval objects', async (t) => {
  const value = await fixture(t);
  await assert.rejects(() => value.manager.update({ instanceId: value.id, directory: 'C:\\evil' }), /Unsupported update field/);
  await assert.rejects(() => value.manager.update({ instanceId: value.id, url: 'https:\/\/evil.invalid' }), /Unsupported update field/);
  await assert.rejects(() => value.manager.update({ instanceId: value.id, executable: 'powershell.exe' }), /Unsupported update field/);
  await assert.rejects(() => value.manager.update({ instanceId: value.id, approval: { minecraftVersionChange: true, planId: 'bad', path: 'x' } }), /Unsupported approval field/);
});

async function transactionFiles(value) {
  const directory = path.join(value.managedRoot, 'state', 'update-transactions', value.id);
  return (await fs.readdir(directory)).filter((name) => name.endsWith('.json')).map((name) => path.join(directory, name));
}

async function fileExists(target) {
  try { await fs.access(target); return true; }
  catch { return false; }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function signTestMarker(value) {
  const unsigned = clone(value);
  delete unsigned.mac;
  return {
    ...unsigned,
    mac: crypto.createHmac('sha256', UPDATE_MARKER_KEY).update(canonicalTestJson(unsigned), 'utf8').digest('hex'),
  };
}

function recoveryManager(value, overrides = {}) {
  return new FamilyServerUpdateManager(value.managedRoot, value.store, {
    resolveTarget: async () => clone(value.target),
    prepareCandidate: overrides.prepareCandidate
      ?? (async () => { throw new Error('recovery must not build a candidate'); }),
    isInstanceActive: async () => false,
    assertQuiescentWithinInstanceLock: async () => true,
    withInstanceLock: overrides.withInstanceLock ?? (async (_instanceId, operation) => operation()),
    assertStackUpdateAllowedWithinInstanceLock: async () => true,
    nativeFilesystemGuards: overrides.nativeFilesystemGuards ?? false,
    ...(overrides.filesystemTreeVerifier ? { filesystemTreeVerifier: overrides.filesystemTreeVerifier } : {}),
    ...(overrides.filesystemEntryVerifier ? { filesystemEntryVerifier: overrides.filesystemEntryVerifier } : {}),
    ...(Object.hasOwn(overrides, 'markerAuthenticationKey')
      ? (overrides.markerAuthenticationKey ? { markerAuthenticationKey: overrides.markerAuthenticationKey } : {})
      : { markerAuthenticationKey: UPDATE_MARKER_KEY }),
  });
}

function canonicalTestJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalTestJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalTestJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function injectedPortableFilesystemSafetyBroker(isInstanceLockHeld) {
  const state = {
    scopeDepth: 0,
    scopeStarts: 0,
    guardCalls: 0,
    verifierCalls: 0,
    proxyOutsideScope: 0,
    lockOrderViolations: 0,
    verifierOptions: [],
  };
  let lockRequired = false;
  let broker;
  const assertScope = () => {
    if (state.scopeDepth > 0) return;
    state.proxyOutsideScope += 1;
    throw new Error('Injected filesystem proxy escaped its operation scope');
  };
  const directoryGuard = async (target) => {
    assertScope();
    state.guardCalls += 1;
    const before = await fs.lstat(target);
    if (!before.isDirectory() || before.isSymbolicLink()) throw new Error('Unsafe injected directory guard target');
    return {
      assertHeld: assertScope,
      async release() { assertScope(); },
      async rename(destination) { assertScope(); await fs.rename(target, destination); },
      async delete() { assertScope(); await fs.rmdir(target); },
    };
  };
  directoryGuard.batch = async (targets) => Promise.all(targets.map(directoryGuard));
  const fileGuard = async (target) => {
    assertScope();
    state.guardCalls += 1;
    const before = await fs.lstat(target);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
      throw new Error('Unsafe injected file guard target');
    }
    return {
      assertHeld: assertScope,
      async release() { assertScope(); },
      async delete() { assertScope(); await fs.unlink(target); },
      async rename(destination) { assertScope(); await fs.rename(target, destination); },
      async replace(destination) {
        assertScope();
        if (process.platform === 'win32') await fs.rm(destination, { force: true });
        await fs.rename(target, destination);
      },
    };
  };
  fileGuard.batch = async (targets) => Promise.all(targets.map(fileGuard));
  const filesystemTreeVerifier = async (target, options = {}) => {
    assertScope();
    state.verifierCalls += 1;
    state.verifierOptions.push({ ...options });
    const before = await fs.lstat(target);
    if (before.isSymbolicLink()) throw new Error('Unsafe injected filesystem verifier target');
    return { ok: true, checked: true, entries: 0 };
  };
  const runOperation = async (operation) => {
    if (state.scopeDepth > 0) return operation(broker);
    state.scopeStarts += 1;
    if (lockRequired && !isInstanceLockHeld()) {
      state.lockOrderViolations += 1;
      throw new Error('Filesystem scope started before the instance lock');
    }
    state.scopeDepth = 1;
    try { return await operation(broker); } finally { state.scopeDepth = 0; }
  };
  broker = Object.freeze({ runOperation, directoryGuard, fileGuard, filesystemTreeVerifier });
  return {
    broker,
    state,
    requireInstanceLock(value) { lockRequired = value; },
  };
}
