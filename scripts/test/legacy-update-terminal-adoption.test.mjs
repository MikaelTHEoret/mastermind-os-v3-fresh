import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createLegacyUpdateTerminalAttestation,
  LEGACY_TERMINAL_INSTANCE_RECORD_SHA256,
  LEGACY_TERMINAL_INSTANCE_STORE_SHA256,
  LEGACY_TERMINAL_MARKER_SHA256,
} from '../../services/minecraft-control-plane/src/legacy-update-terminal-attestation.mjs';
import { validateUpdateRecoveryMarker } from '../../services/minecraft-control-plane/src/update-manager.mjs';
import { adoptLegacyUpdateTerminalEvidence } from '../lib/legacy-update-terminal-adoption.mjs';

const INSTANCE_ID = 'family-server';
const TRANSACTION_ID = '852e987b-c451-43d9-8bd2-e2e6ddb570c5';
const NOW = '2026-08-14T23:55:00.000Z';

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function portableFilesystemDependencies() {
  const directoryGuard = async (target) => {
    const stat = await fs.lstat(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe portable directory');
    let held = true;
    return {
      assertHeld() { if (!held) throw new Error('portable directory guard released'); },
      async release() { held = false; },
    };
  };
  const fileGuard = async (target) => {
    const stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('unsafe portable file');
    let held = true;
    const terminal = async (operation) => {
      if (!held) throw new Error('portable file guard released');
      held = false;
      await operation();
    };
    return {
      assertHeld() { if (!held) throw new Error('portable file guard released'); },
      async release() { held = false; },
      delete: () => terminal(() => fs.unlink(target)),
      rename: (destination) => terminal(() => fs.rename(target, destination)),
      replace: (destination) => terminal(async () => {
        if (process.platform === 'win32') await fs.rm(destination, { force: true });
        await fs.rename(target, destination);
      }),
    };
  };
  const filesystemEntryVerifier = async (target) => {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink()) throw new Error('unsafe portable entry');
    return { ok: true, checked: true };
  };
  return { directoryGuard, fileGuard, filesystemEntryVerifier };
}

function fixtureMarker() {
  const tree = { algorithm: 'sha256', digest: 'a'.repeat(64), files: 0, bytes: 0 };
  return {
    schemaVersion: 1,
    transactionId: TRANSACTION_ID,
    instanceId: INSTANCE_ID,
    phase: 'ready',
    updateKind: 'legacy-migration',
    planId: 'b'.repeat(64),
    createdAt: '2026-08-13T04:01:51.469Z',
    updatedAt: '2026-08-13T06:01:48.440Z',
    originalRecord: { minecraftVersion: '1.21.4' },
    target: {
      projectId: 'family-server',
      updateChannel: 'latest-compatible',
      minecraftVersion: '26.2',
    },
    levelName: 'world',
    worldBefore: tree,
    mutableBefore: tree,
    retiredCleanup: {
      schemaVersion: 1,
      state: 'purged',
      previousMinecraftVersion: '1.21.4',
      targetMinecraftVersion: '26.2',
      stagedCacheIndexes: [0, 1],
      preparedAt: '2026-08-13T06:01:48.235Z',
      stagedAt: '2026-08-13T06:01:48.243Z',
      inventoryCommittedAt: '2026-08-13T06:01:48.246Z',
      purgedAt: '2026-08-13T06:01:48.246Z',
    },
  };
}

function fixtureStore(marker) {
  return {
    schemaVersion: 1,
    instances: [{
      id: INSTANCE_ID,
      projectId: 'family-server',
      kind: 'server',
      status: 'stopped',
      pid: null,
      managedProcess: null,
      projectIdForNoise: undefined,
      updateChannel: marker.target.updateChannel,
      minecraftVersion: marker.target.minecraftVersion,
      updateStatus: {
        state: 'verified',
        transactionId: TRANSACTION_ID,
        planId: marker.planId,
        kind: marker.updateKind,
        previousMinecraftVersion: marker.originalRecord.minecraftVersion,
        targetMinecraftVersion: marker.target.minecraftVersion,
        backupAvailable: false,
        backupPurgedAt: marker.retiredCleanup.purgedAt,
        retiredMinecraftVersion: marker.retiredCleanup.previousMinecraftVersion,
        obsoleteCacheEntriesPurged: marker.retiredCleanup.stagedCacheIndexes.length,
      },
    }],
  };
}

async function setupFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-legacy-update-adoption-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const managedRoot = path.join(root, 'projects', 'family-server');
  const auditRoot = path.join(root, 'recovery-audit', `legacy-update-terminal-${TRANSACTION_ID}`);
  const markerRoot = path.join(managedRoot, 'state', 'update-transactions', INSTANCE_ID);
  const payloadRoot = path.join(managedRoot, 'backups', INSTANCE_ID, TRANSACTION_ID);
  const serverRoot = path.join(managedRoot, 'servers', INSTANCE_ID);
  await fs.mkdir(markerRoot, { recursive: true });
  await fs.mkdir(payloadRoot, { recursive: true });
  await fs.mkdir(serverRoot, { recursive: true });
  const marker = fixtureMarker();
  const store = fixtureStore(marker);
  const markerBytes = jsonBytes(marker);
  const storeBytes = jsonBytes(store);
  const markerFile = path.join(markerRoot, `${TRANSACTION_ID}.json`);
  const storeFile = path.join(managedRoot, 'state', 'instances.json');
  await fs.writeFile(markerFile, markerBytes);
  await fs.writeFile(storeFile, storeBytes);
  await fs.writeFile(path.join(serverRoot, 'world-sentinel.txt'), 'do-not-change\n');
  return {
    root,
    managedRoot,
    auditRoot,
    marker,
    store,
    markerBytes,
    storeBytes,
    markerFile,
    storeFile,
    payloadRoot,
    serverRoot,
    keyFile: path.join(managedRoot, 'state', 'update-transactions.hmac.key'),
    expectedMarkerSha256: sha256(markerBytes),
    expectedInstanceStoreSha256: sha256(storeBytes),
  };
}

function adoptionOptions(value, overrides = {}) {
  return {
    managedRoot: value.managedRoot,
    auditRoot: value.auditRoot,
    expectedMarkerSha256: value.expectedMarkerSha256,
    expectedInstanceStoreSha256: value.expectedInstanceStoreSha256,
    instanceId: INSTANCE_ID,
    transactionId: TRANSACTION_ID,
    now: () => NOW,
    randomBytes: (length) => Buffer.alloc(length, 7),
    assertStopped: async () => undefined,
    testOnlyAllowUnpinnedEvidence: true,
    ...portableFilesystemDependencies(),
    ...overrides,
  };
}

test('adopts one exact terminal legacy marker, preserves evidence, and is idempotent', async (t) => {
  const value = await setupFixture(t);
  const result = await adoptLegacyUpdateTerminalEvidence(adoptionOptions(value));
  assert.equal(result.status, 'adopted');
  assert.deepEqual(await fs.readFile(value.keyFile), Buffer.alloc(32, 7));
  const published = JSON.parse(await fs.readFile(value.markerFile, 'utf8'));
  assert.equal(published.legacyTerminalAttestation.originalMarkerSha256, value.expectedMarkerSha256);
  assert.equal(published.legacyTerminalAttestation.instanceStoreSha256, value.expectedInstanceStoreSha256);
  assert.equal(published.legacyTerminalAttestation.keySha256, sha256(Buffer.alloc(32, 7)));
  const unsigned = structuredClone(published); delete unsigned.mac;
  const expectedMac = crypto.createHmac('sha256', Buffer.alloc(32, 7)).update(canonicalJson(unsigned)).digest('hex');
  assert.equal(published.mac, expectedMac);
  assert.deepEqual(await fs.readFile(path.join(value.auditRoot, 'unsigned-marker.json')), value.markerBytes);
  assert.deepEqual(await fs.readFile(path.join(value.auditRoot, 'instances.json')), value.storeBytes);
  assert.equal(await fs.readFile(path.join(value.serverRoot, 'world-sentinel.txt'), 'utf8'), 'do-not-change\n');
  assert.deepEqual(await fs.readFile(value.storeFile), value.storeBytes);

  const replay = await adoptLegacyUpdateTerminalEvidence(adoptionOptions(value));
  assert.equal(replay.status, 'already-adopted');
  assert.equal(replay.signedMarkerSha256, result.signedMarkerSha256);
});

test('refuses before writing when local control is still running', async (t) => {
  const value = await setupFixture(t);
  await assert.rejects(
    adoptLegacyUpdateTerminalEvidence(adoptionOptions(value, {
      assertStopped: async () => { throw new Error('LOCAL_CONTROL_RUNNING'); },
    })),
    /LOCAL_CONTROL_RUNNING/,
  );
  await assert.rejects(fs.lstat(value.keyFile), { code: 'ENOENT' });
  await assert.rejects(fs.lstat(value.auditRoot), { code: 'ENOENT' });
});

test('refuses changed receipts and nonempty payloads without creating authentication state', async (t) => {
  const changed = await setupFixture(t);
  await assert.rejects(
    adoptLegacyUpdateTerminalEvidence(adoptionOptions(changed, { expectedInstanceStoreSha256: 'c'.repeat(64) })),
    /INSTANCE_STORE_CHANGED/,
  );
  await assert.rejects(fs.lstat(changed.keyFile), { code: 'ENOENT' });

  const payload = await setupFixture(t);
  await fs.writeFile(path.join(payload.payloadRoot, 'unexpected.bin'), 'x');
  await assert.rejects(
    adoptLegacyUpdateTerminalEvidence(adoptionOptions(payload)),
    /contains unexpected entries/,
  );
  await assert.rejects(fs.lstat(payload.keyFile), { code: 'ENOENT' });
});

test('an existing key is accepted only as a resumable, evidence-bound adoption', async (t) => {
  const value = await setupFixture(t);
  await fs.writeFile(value.keyFile, Buffer.alloc(32, 9));
  await assert.rejects(
    adoptLegacyUpdateTerminalEvidence(adoptionOptions(value)),
    /not tied to an interrupted adoption/,
  );
  assert.deepEqual(await fs.readFile(value.markerFile), value.markerBytes);
});

test('rejects every audit path except the exact external recovery-audit directory', async (t) => {
  const value = await setupFixture(t);
  const payloadAudit = path.join(value.payloadRoot, 'repair-audit');
  await assert.rejects(
    adoptLegacyUpdateTerminalEvidence(adoptionOptions(value, { auditRoot: payloadAudit })),
    /exact external recovery-audit path/,
  );
  assert.equal(await fs.readdir(value.payloadRoot).then((entries) => entries.length), 0);
  await assert.rejects(fs.lstat(value.keyFile), { code: 'ENOENT' });
});

test('rejects a redirected recovery-audit directory before creating repair evidence', async (t) => {
  const value = await setupFixture(t);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'mastermind-legacy-adoption-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.symlink(
    outside,
    path.join(value.root, 'recovery-audit'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(
    adoptLegacyUpdateTerminalEvidence(adoptionOptions(value)),
    /unsafe|escaped/,
  );
  assert.deepEqual(await fs.readdir(outside), []);
  await assert.rejects(fs.lstat(value.keyFile), { code: 'ENOENT' });
});

test('recovers a complete pending key and replaces a partial generated active-key temp', async (t) => {
  const value = await setupFixture(t);
  await fs.mkdir(value.auditRoot, { recursive: true });
  await fs.writeFile(path.join(value.auditRoot, 'pending-key.bin.pending'), Buffer.alloc(32, 7));
  const activeKeyTemp = path.join(
    value.managedRoot,
    'state',
    `.legacy-update-terminal-key-${TRANSACTION_ID}.tmp`,
  );
  await fs.writeFile(activeKeyTemp, Buffer.from([7]));
  const result = await adoptLegacyUpdateTerminalEvidence(adoptionOptions(value));
  assert.equal(result.status, 'adopted');
  assert.deepEqual(await fs.readFile(value.keyFile), Buffer.alloc(32, 7));
  await assert.rejects(fs.lstat(activeKeyTemp), { code: 'ENOENT' });
});

test('discards a partial generated pending-key temp before publishing a full key', async (t) => {
  const value = await setupFixture(t);
  await fs.mkdir(value.auditRoot, { recursive: true });
  await fs.writeFile(path.join(value.auditRoot, 'pending-key.bin.pending'), Buffer.alloc(7, 3));
  const result = await adoptLegacyUpdateTerminalEvidence(adoptionOptions(value));
  assert.equal(result.status, 'adopted');
  assert.deepEqual(await fs.readFile(value.keyFile), Buffer.alloc(32, 7));
  assert.deepEqual(await fs.readFile(path.join(value.auditRoot, 'pending-key.bin')), Buffer.alloc(32, 7));
});

test('marker validation accepts only the exact attested terminal legacy subtype', () => {
  const marker = fixtureMarker();
  marker.legacyTerminalAttestation = createLegacyUpdateTerminalAttestation({
    adoptedAt: NOW,
    originalMarkerSha256: LEGACY_TERMINAL_MARKER_SHA256,
    instanceStoreSha256: LEGACY_TERMINAL_INSTANCE_STORE_SHA256,
    instanceRecordSha256: LEGACY_TERMINAL_INSTANCE_RECORD_SHA256,
    keySha256: '4'.repeat(64),
  });
  assert.equal(validateUpdateRecoveryMarker(marker, INSTANCE_ID, TRANSACTION_ID), true);
  assert.throws(() => validateUpdateRecoveryMarker({ ...marker, phase: 'pending-readiness' }, INSTANCE_ID, TRANSACTION_ID));
  assert.throws(() => validateUpdateRecoveryMarker({ ...marker, legacyTerminalAttestation: undefined }, INSTANCE_ID, TRANSACTION_ID));
  assert.throws(() => validateUpdateRecoveryMarker({ ...marker, managedBefore: {} }, INSTANCE_ID, TRANSACTION_ID));
});
