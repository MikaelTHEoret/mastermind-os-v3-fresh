import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import {
  createLegacyUpdateTerminalAttestation,
  isAttestedLegacyUpdateTerminalMarker,
  LEGACY_TERMINAL_INSTANCE_ID,
  LEGACY_TERMINAL_INSTANCE_RECORD_SHA256,
  LEGACY_TERMINAL_INSTANCE_STORE_SHA256,
  LEGACY_TERMINAL_MARKER_SHA256,
  LEGACY_TERMINAL_TRANSACTION_ID,
  validLegacyUpdateTerminalAttestation,
} from '../../services/minecraft-control-plane/src/legacy-update-terminal-attestation.mjs';
import {
  publishAtomicManagedUpdateFile,
  removeExactManagedUpdateFile,
  validateUpdateRecoveryMarker,
} from '../../services/minecraft-control-plane/src/update-manager.mjs';
import {
  acquireWindowsDirectoryGuard,
  acquireWindowsFileGuard,
  assertWindowsFilesystemEntry,
} from '../../services/minecraft-control-plane/src/windows-filesystem-safety.mjs';

const HEX64 = /^[a-f0-9]{64}$/;

export const FAMILY_INSTANCE_ID = LEGACY_TERMINAL_INSTANCE_ID;
export const LEGACY_TRANSACTION_ID = LEGACY_TERMINAL_TRANSACTION_ID;
export const LEGACY_MARKER_SHA256 = LEGACY_TERMINAL_MARKER_SHA256;
export const LEGACY_INSTANCE_STORE_SHA256 = LEGACY_TERMINAL_INSTANCE_STORE_SHA256;

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

function signedMarker(marker, key) {
  const unsigned = structuredClone(marker);
  delete unsigned.mac;
  const mac = crypto.createHmac('sha256', key).update(canonicalJson(unsigned), 'utf8').digest('hex');
  return { ...unsigned, mac };
}

function authenticateMarker(marker, key) {
  if (!marker || typeof marker !== 'object' || Array.isArray(marker) || !HEX64.test(marker.mac ?? '')) return false;
  const unsigned = structuredClone(marker);
  delete unsigned.mac;
  const expected = crypto.createHmac('sha256', key).update(canonicalJson(unsigned), 'utf8').digest();
  const observed = Buffer.from(marker.mac, 'hex');
  return observed.length === expected.length && crypto.timingSafeEqual(observed, expected);
}

async function exists(target) {
  try { await fs.lstat(target); return true; }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

async function assertDirectory(target, label) {
  const stat = await fs.lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} is not a safe directory`);
  return stat;
}

async function readRegularFile(target, maximumBytes, label) {
  const namedBefore = await fs.lstat(target);
  if (!namedBefore.isFile() || namedBefore.isSymbolicLink() || namedBefore.nlink !== 1
    || namedBefore.size < 2 || namedBefore.size > maximumBytes) {
    throw new Error(`${label} is not a bounded private file`);
  }
  const handle = await fs.open(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const openedBefore = await handle.stat();
    const bytes = await handle.readFile();
    const openedAfter = await handle.stat();
    const namedAfter = await fs.lstat(target);
    if (bytes.length !== namedBefore.size || namedBefore.dev !== openedBefore.dev || namedBefore.ino !== openedBefore.ino
      || openedBefore.dev !== openedAfter.dev || openedBefore.ino !== openedAfter.ino
      || openedAfter.dev !== namedAfter.dev || openedAfter.ino !== namedAfter.ino) {
      throw new Error(`${label} changed while it was read`);
    }
    return bytes;
  } finally { await handle.close(); }
}

async function readGuardedRegularFile(target, maximumBytes, label, fileGuard) {
  const guard = await fileGuard(target);
  try {
    guard.assertHeld?.();
    const bytes = await readRegularFile(target, maximumBytes, label);
    guard.assertHeld?.();
    return bytes;
  } finally {
    await guard.release?.();
  }
}

async function readGuardedGeneratedFile(target, maximumBytes, fileGuard) {
  const guard = await fileGuard(target);
  try {
    guard.assertHeld?.();
    const namedBefore = await fs.lstat(target);
    if (!namedBefore.isFile() || namedBefore.isSymbolicLink() || namedBefore.nlink !== 1
      || namedBefore.size > maximumBytes) {
      throw new Error('A generated adoption temp path is not a bounded private file');
    }
    const handle = await fs.open(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
      const openedBefore = await handle.stat();
      const bytes = await handle.readFile();
      const openedAfter = await handle.stat();
      const namedAfter = await fs.lstat(target);
      if (bytes.length !== namedBefore.size || namedBefore.dev !== openedBefore.dev
        || namedBefore.ino !== openedBefore.ino || openedBefore.dev !== openedAfter.dev
        || openedBefore.ino !== openedAfter.ino || openedAfter.dev !== namedAfter.dev
        || openedAfter.ino !== namedAfter.ino) {
        throw new Error('A generated adoption temp file changed while it was read');
      }
      guard.assertHeld?.();
      return bytes;
    } finally { await handle.close(); }
  } finally { await guard.release?.(); }
}

function parseCanonicalJson(bytes, label) {
  let text;
  let value;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    value = JSON.parse(text);
  } catch { throw new Error(`${label} is not valid UTF-8 JSON`); }
  if (text !== `${JSON.stringify(value, null, 2)}\n`) throw new Error(`${label} is not canonical JSON`);
  return value;
}

async function exactDirectoryEntries(target, expected, label) {
  await assertDirectory(target, label);
  const entries = await fs.readdir(target, { withFileTypes: true });
  const names = entries.map((entry) => entry.name).sort((a, b) => a.localeCompare(b, 'en'));
  const wanted = [...expected].sort((a, b) => a.localeCompare(b, 'en'));
  if (canonicalJson(names) !== canonicalJson(wanted)) throw new Error(`${label} contains unexpected entries`);
  return entries;
}

async function assertAbsent(target, label) {
  if (await exists(target)) throw new Error(`${label} must be absent`);
}

function pathKey(target) {
  const resolved = path.resolve(target);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isStrictChild(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function exactAdoptionRoots(managedRoot, auditRoot, instanceId, transactionId) {
  const managed = path.resolve(managedRoot);
  if (instanceId !== FAMILY_INSTANCE_ID || transactionId !== LEGACY_TRANSACTION_ID
    || path.basename(managed) !== FAMILY_INSTANCE_ID || path.basename(path.dirname(managed)) !== 'projects') {
    throw new TypeError('This repair is restricted to the exact Family Server terminal transaction');
  }
  const dataRoot = path.dirname(path.dirname(managed));
  const audit = path.resolve(auditRoot);
  const expectedAudit = path.join(dataRoot, 'recovery-audit', `legacy-update-terminal-${transactionId}`);
  if (pathKey(audit) !== pathKey(expectedAudit) || isStrictChild(managed, audit) || isStrictChild(audit, managed)) {
    throw new TypeError('The legacy adoption audit root must be the exact external recovery-audit path');
  }
  return { managedRoot: managed, dataRoot, auditRoot: audit };
}

async function releaseGuardChain(guards) {
  let firstError = null;
  for (const guard of guards) {
    try { await guard?.release?.(); } catch (error) { firstError ??= error; }
  }
  if (firstError) throw firstError;
}

function sameDirectoryIdentity(left, right) {
  return left?.isDirectory?.() && right?.isDirectory?.()
    && left.dev === right.dev && left.ino === right.ino;
}

async function ensureAuditDirectoryChain(dataRoot, auditRoot, dependencies) {
  const recoveryRoot = path.dirname(auditRoot);
  if (pathKey(path.dirname(recoveryRoot)) !== pathKey(dataRoot)
    || pathKey(path.dirname(auditRoot)) !== pathKey(recoveryRoot)) {
    throw new Error('The recovery audit directory chain is not exact');
  }
  const guards = [];
  try {
    for (const [target, label] of [
      [dataRoot, 'Mastermind Minecraft data root'],
      [recoveryRoot, 'Recovery audit root'],
      [auditRoot, 'Legacy adoption audit root'],
    ]) {
      guards.at(-1)?.assertHeld?.();
      if (target !== dataRoot) {
        try { await fs.mkdir(target, { recursive: false, mode: 0o700 }); }
        catch (error) { if (error?.code !== 'EEXIST') throw error; }
      }
      await dependencies.filesystemEntryVerifier(target);
      const before = await assertDirectory(target, label);
      const guard = await dependencies.directoryGuard(target);
      guard.assertHeld?.();
      await dependencies.filesystemEntryVerifier(target);
      const after = await assertDirectory(target, label);
      if (!sameDirectoryIdentity(before, after)) throw new Error(`${label} changed while it was guarded`);
      guards.push(guard);
    }
    const [realDataRoot, realRecoveryRoot, realAuditRoot] = await Promise.all([
      fs.realpath(dataRoot), fs.realpath(recoveryRoot), fs.realpath(auditRoot),
    ]);
    if (!isStrictChild(realDataRoot, realRecoveryRoot) || !isStrictChild(realDataRoot, realAuditRoot)) {
      throw new Error('The recovery audit directory escaped the Mastermind data root');
    }
    for (const guard of guards) guard.assertHeld?.();
  } finally {
    await releaseGuardChain(guards.reverse());
  }
}

async function removeGeneratedTemporary(target, boundary, dependencies) {
  if (!await exists(target)) return;
  const observed = await readGuardedGeneratedFile(target, 1024 * 1024, dependencies.fileGuard);
  const removed = await removeExactManagedUpdateFile({
    file: target,
    expectedContent: observed,
    managedRoot: boundary,
    ...dependencies,
  });
  if (!removed) throw new Error('A generated adoption temp file changed before guarded removal');
}

async function preserveExactManagedFile(target, bytes, boundary, dependencies) {
  const temporary = `${target}.pending`;
  if (await exists(target)) {
    const observed = await readRegularFile(target, bytes.length, 'Preserved recovery evidence');
    if (!observed.equals(bytes)) throw new Error('Preserved recovery evidence conflicts with this adoption');
    await removeGeneratedTemporary(temporary, boundary, dependencies);
    return;
  }
  if (await exists(temporary)) {
    let reusable = false;
    try {
      const observed = await readRegularFile(temporary, bytes.length, 'Pending recovery evidence');
      reusable = observed.equals(bytes);
    } catch { /* A partial generated temp is safely discarded below. */ }
    if (!reusable) await removeGeneratedTemporary(temporary, boundary, dependencies);
  }
  await publishAtomicManagedUpdateFile({
    file: target,
    content: bytes,
    managedRoot: boundary,
    temporaryFile: temporary,
    replaceExisting: false,
    requireDestinationAbsent: true,
    allowExistingTemporary: true,
    preserveTemporaryOnError: true,
    ...dependencies,
  });
}

async function portIsOccupied(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = (occupied) => { socket.destroy(); resolve(occupied); };
    socket.setTimeout(750, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

export async function assertLocalControlStopped() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const occupied = await Promise.all([3000, 43100].map(portIsOccupied));
    if (occupied.some(Boolean)) throw new Error('LOCAL_CONTROL_RUNNING');
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function validateLegacyEvidence(marker, store, instanceId, transactionId) {
  if (!marker || marker.schemaVersion !== 1 || marker.instanceId !== instanceId
    || marker.transactionId !== transactionId || marker.phase !== 'ready'
    || marker.updateKind !== 'legacy-migration' || marker.retiredCleanup?.state !== 'purged'
    || marker.mac !== undefined || marker.legacyTerminalAttestation !== undefined
    || marker.managedBefore !== undefined || marker.sourceDirectoryIdentity !== undefined) {
    throw new Error('The legacy update marker is outside the exact terminal adoption scope');
  }
  if (!store || store.schemaVersion !== 1 || !Array.isArray(store.instances) || store.instances.length !== 1) {
    throw new Error('The Family Server inventory is outside the exact terminal adoption scope');
  }
  const instance = store.instances[0];
  if (instance?.id !== instanceId || instance.projectId !== 'family-server' || instance.kind !== 'server'
    || instance.status !== 'stopped' || instance.pid !== null || instance.managedProcess !== null) {
    throw new Error('The Family Server is not in the exact stopped inventory state');
  }
  const status = instance.updateStatus;
  const cleanup = marker.retiredCleanup;
  if (!status || status.state !== 'verified' || status.transactionId !== transactionId
    || status.planId !== marker.planId || status.kind !== marker.updateKind
    || status.previousMinecraftVersion !== marker.originalRecord?.minecraftVersion
    || status.targetMinecraftVersion !== marker.target?.minecraftVersion
    || status.backupAvailable !== false || status.backupPurgedAt !== cleanup.purgedAt
    || status.retiredMinecraftVersion !== cleanup.previousMinecraftVersion
    || status.obsoleteCacheEntriesPurged !== cleanup.stagedCacheIndexes?.length) {
    throw new Error('The verified update receipt does not match the terminal marker');
  }
  const targetFromInstance = Object.fromEntries(Object.keys(marker.target).map((key) => [key, instance[key]]));
  if (canonicalJson(targetFromInstance) !== canonicalJson(marker.target)) {
    throw new Error('The live Family Server target does not match the terminal marker');
  }
  if (cleanup.targetMinecraftVersion !== marker.target.minecraftVersion
    || cleanup.previousMinecraftVersion !== marker.originalRecord.minecraftVersion) {
    throw new Error('The purged cleanup receipt does not match the update versions');
  }
  return instance;
}

function layout(managedRoot, instanceId, transactionId) {
  const serverRoot = path.join(managedRoot, 'servers');
  const backupRoot = path.join(managedRoot, 'backups');
  const stateRoot = path.join(managedRoot, 'state');
  const transactionRoot = path.join(stateRoot, 'update-transactions');
  const markerInstanceRoot = path.join(transactionRoot, instanceId);
  const markerFile = path.join(markerInstanceRoot, `${transactionId}.json`);
  const keyFile = path.join(stateRoot, 'update-transactions.hmac.key');
  const backupInstanceRoot = path.join(backupRoot, instanceId);
  const payloadRoot = path.join(backupInstanceRoot, transactionId);
  return {
    serverRoot,
    serverInstance: path.join(serverRoot, instanceId),
    backupRoot,
    backupInstanceRoot,
    payloadRoot,
    stateRoot,
    instanceStore: path.join(stateRoot, 'instances.json'),
    transactionRoot,
    markerInstanceRoot,
    markerFile,
    keyFile,
    temporaryKey: path.join(stateRoot, `.legacy-update-terminal-key-${transactionId}.tmp`),
    temporaryMarker: path.join(markerInstanceRoot, `.${transactionId}.legacy-terminal-adoption.tmp`),
    candidate: path.join(serverRoot, `.${instanceId}-candidate-${transactionId}`),
  };
}

async function verifyNamespace(paths, transactionId, { allowTemporaryMarker = false } = {}) {
  await exactDirectoryEntries(paths.transactionRoot, [FAMILY_INSTANCE_ID], 'Update transaction root');
  await exactDirectoryEntries(paths.markerInstanceRoot, [
    `${transactionId}.json`,
    ...(allowTemporaryMarker ? [path.basename(paths.temporaryMarker)] : []),
  ], 'Update marker instance root');
  await exactDirectoryEntries(paths.backupRoot, [FAMILY_INSTANCE_ID], 'Update backup root');
  await exactDirectoryEntries(paths.backupInstanceRoot, [transactionId], 'Update backup instance root');
  await exactDirectoryEntries(paths.payloadRoot, [], 'Legacy update payload root');
  await assertDirectory(paths.serverRoot, 'Family Server root');
  await assertDirectory(paths.serverInstance, 'Canonical Family Server directory');
  const deleteSuffix = '.update-delete';
  for (const [target, label] of [
    [paths.candidate, 'Legacy update candidate'],
    [`${paths.candidate}${deleteSuffix}`, 'Legacy update candidate tombstone'],
    [path.join(paths.payloadRoot, 'instance'), 'Legacy rollback payload'],
    [path.join(paths.payloadRoot, `instance${deleteSuffix}`), 'Legacy rollback payload tombstone'],
    [path.join(paths.payloadRoot, 'failed-candidate'), 'Legacy failed candidate'],
    [path.join(paths.payloadRoot, `failed-candidate${deleteSuffix}`), 'Legacy failed candidate tombstone'],
    [path.join(paths.payloadRoot, '.retired-version-cleanup'), 'Legacy cleanup staging'],
    [path.join(paths.payloadRoot, `.retired-version-cleanup${deleteSuffix}`), 'Legacy cleanup tombstone'],
  ]) await assertAbsent(target, label);
}

function adoptionReceipt({ transactionId, adoption, signedMarkerSha256 }) {
  return {
    schemaVersion: 1,
    action: 'legacy-update-terminal-adopted',
    transactionId,
    adoptedAt: adoption.adoptedAt,
    originalMarkerSha256: adoption.originalMarkerSha256,
    instanceStoreSha256: adoption.instanceStoreSha256,
    instanceRecordSha256: adoption.instanceRecordSha256,
    keySha256: adoption.keySha256,
    signedMarkerSha256,
  };
}

export async function adoptLegacyUpdateTerminalEvidence({
  managedRoot,
  auditRoot,
  expectedMarkerSha256 = LEGACY_MARKER_SHA256,
  expectedInstanceStoreSha256 = LEGACY_INSTANCE_STORE_SHA256,
  instanceId = FAMILY_INSTANCE_ID,
  transactionId = LEGACY_TRANSACTION_ID,
  now = () => new Date().toISOString(),
  randomBytes = crypto.randomBytes,
  assertStopped = assertLocalControlStopped,
  directoryGuard = acquireWindowsDirectoryGuard,
  fileGuard = acquireWindowsFileGuard,
  filesystemEntryVerifier = assertWindowsFilesystemEntry,
  testOnlyAllowUnpinnedEvidence = false,
} = {}) {
  if (typeof managedRoot !== 'string' || !path.isAbsolute(managedRoot)
    || typeof auditRoot !== 'string' || !path.isAbsolute(auditRoot)
    || !HEX64.test(expectedMarkerSha256) || !HEX64.test(expectedInstanceStoreSha256)) {
    throw new TypeError('Exact legacy update adoption paths and hashes are required');
  }
  const unpinnedTestEvidence = testOnlyAllowUnpinnedEvidence === true
    && typeof process.env.NODE_TEST_CONTEXT === 'string';
  if (testOnlyAllowUnpinnedEvidence !== false && !unpinnedTestEvidence) {
    throw new TypeError('Unpinned legacy evidence is available only inside node:test');
  }
  if (!unpinnedTestEvidence && (expectedMarkerSha256 !== LEGACY_MARKER_SHA256
    || expectedInstanceStoreSha256 !== LEGACY_INSTANCE_STORE_SHA256)) {
    throw new TypeError('This repair accepts only the pinned live terminal evidence');
  }
  const roots = exactAdoptionRoots(managedRoot, auditRoot, instanceId, transactionId);
  const dependencies = { directoryGuard, fileGuard, filesystemEntryVerifier };
  const acceptsAttestedMarker = (value) => {
    if (!unpinnedTestEvidence) return isAttestedLegacyUpdateTerminalMarker(value);
    return value && value.instanceId === instanceId && value.transactionId === transactionId
      && value.phase === 'ready' && value.updateKind === 'legacy-migration'
      && value.retiredCleanup?.state === 'purged' && value.managedBefore === undefined
      && value.sourceDirectoryIdentity === undefined
      && validLegacyUpdateTerminalAttestation(value.legacyTerminalAttestation)
      && value.legacyTerminalAttestation.originalMarkerSha256 === expectedMarkerSha256
      && value.legacyTerminalAttestation.instanceStoreSha256 === expectedInstanceStoreSha256;
  };
  const validateAdoptedMarker = (value) => {
    if (!acceptsAttestedMarker(value)) throw new Error('Adopted terminal marker is outside the exact repair scope');
    if (!unpinnedTestEvidence) validateUpdateRecoveryMarker(value, instanceId, transactionId);
  };

  await assertStopped();
  const paths = layout(roots.managedRoot, instanceId, transactionId);
  await assertDirectory(roots.managedRoot, 'Managed Family project root');
  const temporaryExistsAtStart = await exists(paths.temporaryMarker);
  await verifyNamespace(paths, transactionId, { allowTemporaryMarker: temporaryExistsAtStart });

  const storeBytes = await readGuardedRegularFile(
    paths.instanceStore, 1024 * 1024, 'Family Server inventory', fileGuard,
  );
  if (sha256(storeBytes) !== expectedInstanceStoreSha256) throw new Error('INSTANCE_STORE_CHANGED');
  const store = parseCanonicalJson(storeBytes, 'Family Server inventory');
  const markerBytes = await readGuardedRegularFile(paths.markerFile, 64 * 1024, 'Legacy update marker', fileGuard);
  const marker = parseCanonicalJson(markerBytes, 'Legacy update marker');

  let key = null;
  const keyExistedAtStart = await exists(paths.keyFile);
  if (keyExistedAtStart) {
    key = await readGuardedRegularFile(paths.keyFile, 32, 'Update authentication key', fileGuard);
    if (key.length !== 32) throw new Error('Update authentication key has an invalid size');
  }

  const pendingKeyFile = path.join(roots.auditRoot, 'pending-key.bin');
  const preservedMarkerFile = path.join(roots.auditRoot, 'unsigned-marker.json');
  const preservedStoreFile = path.join(roots.auditRoot, 'instances.json');
  const planFile = path.join(roots.auditRoot, 'adoption-plan.json');
  const receiptFile = path.join(roots.auditRoot, 'receipt.json');

  if (acceptsAttestedMarker(marker)) {
    if (!key || !authenticateMarker(marker, key)) throw new Error('Adopted terminal marker authentication failed');
    validateAdoptedMarker(marker);
    if (marker.legacyTerminalAttestation.originalMarkerSha256 !== expectedMarkerSha256
      || marker.legacyTerminalAttestation.instanceStoreSha256 !== expectedInstanceStoreSha256
      || marker.legacyTerminalAttestation.keySha256 !== sha256(key)) {
      throw new Error('Adopted terminal marker is bound to different evidence');
    }
    if (temporaryExistsAtStart) throw new Error('Adopted terminal marker retains an unexpected temporary file');
    await verifyNamespace(paths, transactionId);
    await ensureAuditDirectoryChain(roots.dataRoot, roots.auditRoot, dependencies);
    const preservedMarker = await readRegularFile(preservedMarkerFile, 64 * 1024, 'Preserved unsigned marker');
    const preservedStore = await readRegularFile(preservedStoreFile, 1024 * 1024, 'Preserved instance inventory');
    const pendingKey = await readRegularFile(pendingKeyFile, 32, 'Preserved pending authentication key');
    const preservedPlan = parseCanonicalJson(
      await readRegularFile(planFile, 16 * 1024, 'Preserved adoption plan'),
      'Preserved adoption plan',
    );
    if (sha256(preservedMarker) !== expectedMarkerSha256 || sha256(preservedStore) !== expectedInstanceStoreSha256
      || !pendingKey.equals(key)
      || canonicalJson(preservedPlan) !== canonicalJson(marker.legacyTerminalAttestation)) {
      throw new Error('Adopted terminal marker lost its preserved evidence');
    }
    const signedMarkerSha256 = sha256(markerBytes);
    const receiptBytes = Buffer.from(`${JSON.stringify(adoptionReceipt({
      transactionId,
      adoption: marker.legacyTerminalAttestation,
      signedMarkerSha256,
    }), null, 2)}\n`, 'utf8');
    await preserveExactManagedFile(receiptFile, receiptBytes, roots.dataRoot, dependencies);
    return { status: 'already-adopted', transactionId, signedMarkerSha256 };
  }

  if (sha256(markerBytes) !== expectedMarkerSha256) throw new Error('LEGACY_MARKER_CHANGED');
  const instance = validateLegacyEvidence(marker, store, instanceId, transactionId);
  const instanceRecordSha256 = sha256(Buffer.from(canonicalJson(instance), 'utf8'));
  if (!unpinnedTestEvidence && instanceRecordSha256 !== LEGACY_TERMINAL_INSTANCE_RECORD_SHA256) {
    throw new Error('INSTANCE_RECORD_CHANGED');
  }

  if ((keyExistedAtStart || temporaryExistsAtStart)
    && (!await exists(preservedMarkerFile) || !await exists(preservedStoreFile)
      || !await exists(planFile) || !await exists(pendingKeyFile))) {
    throw new Error('Existing update authentication state is not tied to an interrupted adoption');
  }
  await ensureAuditDirectoryChain(roots.dataRoot, roots.auditRoot, dependencies);
  await preserveExactManagedFile(preservedMarkerFile, markerBytes, roots.dataRoot, dependencies);
  await preserveExactManagedFile(preservedStoreFile, storeBytes, roots.dataRoot, dependencies);

  let pendingKey;
  if (await exists(pendingKeyFile)) {
    pendingKey = await readRegularFile(pendingKeyFile, 32, 'Preserved pending authentication key');
    if (pendingKey.length !== 32) throw new Error('Preserved pending authentication key has an invalid size');
  } else if (await exists(`${pendingKeyFile}.pending`)) {
    try {
      const observed = await readRegularFile(`${pendingKeyFile}.pending`, 32, 'Pending authentication key');
      if (observed.length === 32) pendingKey = observed;
      else await removeGeneratedTemporary(`${pendingKeyFile}.pending`, roots.dataRoot, dependencies);
    }
    catch {
      await removeGeneratedTemporary(`${pendingKeyFile}.pending`, roots.dataRoot, dependencies);
    }
  }
  if (!pendingKey) {
    pendingKey = randomBytes(32);
    if (!Buffer.isBuffer(pendingKey) || pendingKey.length !== 32) throw new Error('Invalid update authentication key material');
  }
  if (!Buffer.isBuffer(pendingKey) || pendingKey.length !== 32) {
    throw new Error('Pending update authentication key has an invalid size');
  }
  await preserveExactManagedFile(pendingKeyFile, pendingKey, roots.dataRoot, dependencies);
  if (key && !key.equals(pendingKey)) throw new Error('Existing update authentication key conflicts with its adoption plan');
  const keySha256 = sha256(pendingKey);

  let adoption;
  if (await exists(planFile)) {
    adoption = parseCanonicalJson(await readRegularFile(planFile, 16 * 1024, 'Legacy adoption plan'), 'Legacy adoption plan');
    if (adoption.originalMarkerSha256 !== expectedMarkerSha256
      || adoption.instanceStoreSha256 !== expectedInstanceStoreSha256
      || adoption.instanceRecordSha256 !== instanceRecordSha256
      || adoption.keySha256 !== keySha256) {
      throw new Error('Legacy adoption plan conflicts with current evidence');
    }
  } else {
    adoption = createLegacyUpdateTerminalAttestation({
      adoptedAt: now(),
      originalMarkerSha256: expectedMarkerSha256,
      instanceStoreSha256: expectedInstanceStoreSha256,
      instanceRecordSha256,
      keySha256,
    });
    await preserveExactManagedFile(
      planFile,
      Buffer.from(`${JSON.stringify(adoption, null, 2)}\n`, 'utf8'),
      roots.dataRoot,
      dependencies,
    );
  }
  if (!validLegacyUpdateTerminalAttestation(adoption)) throw new Error('Legacy adoption plan is invalid');

  await assertStopped();
  if (!key) {
    if (await exists(paths.temporaryKey)) {
      let reusable = false;
      try {
        reusable = (await readRegularFile(paths.temporaryKey, 32, 'Pending update authentication key')).equals(pendingKey);
      } catch { /* A partial generated key temp is safely discarded below. */ }
      if (!reusable) await removeGeneratedTemporary(paths.temporaryKey, roots.managedRoot, dependencies);
    }
    await publishAtomicManagedUpdateFile({
      file: paths.keyFile,
      content: pendingKey,
      managedRoot: roots.managedRoot,
      temporaryFile: paths.temporaryKey,
      replaceExisting: false,
      requireDestinationAbsent: true,
      allowExistingTemporary: true,
      preserveTemporaryOnError: true,
      ...dependencies,
    });
    key = await readGuardedRegularFile(paths.keyFile, 32, 'Published update authentication key', fileGuard);
  }
  if (!key.equals(pendingKey) || sha256(key) !== adoption.keySha256) {
    throw new Error('Published update authentication key does not match its adoption plan');
  }

  const unsigned = { ...structuredClone(marker), legacyTerminalAttestation: adoption };
  const adoptedMarker = signedMarker(unsigned, key);
  validateAdoptedMarker(adoptedMarker);
  const adoptedBytes = Buffer.from(`${JSON.stringify(adoptedMarker, null, 2)}\n`, 'utf8');
  if (await exists(paths.temporaryMarker)) {
    let reusable = false;
    try {
      reusable = (await readRegularFile(paths.temporaryMarker, 64 * 1024, 'Legacy adoption temporary marker'))
        .equals(adoptedBytes);
    } catch { /* A partial generated marker temp is safely discarded below. */ }
    if (!reusable) await removeGeneratedTemporary(paths.temporaryMarker, roots.managedRoot, dependencies);
  }

  const storeBeforeCommit = await readGuardedRegularFile(
    paths.instanceStore, 1024 * 1024, 'Family Server inventory', fileGuard,
  );
  const markerBeforeCommit = await readGuardedRegularFile(
    paths.markerFile, 64 * 1024, 'Legacy update marker', fileGuard,
  );
  if (sha256(storeBeforeCommit) !== expectedInstanceStoreSha256 || sha256(markerBeforeCommit) !== expectedMarkerSha256) {
    throw new Error('Legacy adoption evidence changed before publication');
  }
  await assertStopped();
  await verifyNamespace(paths, transactionId, { allowTemporaryMarker: await exists(paths.temporaryMarker) });
  await publishAtomicManagedUpdateFile({
    file: paths.markerFile,
    content: adoptedBytes,
    managedRoot: roots.managedRoot,
    temporaryFile: paths.temporaryMarker,
    replaceExisting: true,
    requireDestinationPresent: true,
    allowExistingTemporary: true,
    preserveTemporaryOnError: true,
    expectedDestinationContent: markerBytes,
    ...dependencies,
  });

  const publishedBytes = await readGuardedRegularFile(
    paths.markerFile, 64 * 1024, 'Adopted update marker', fileGuard,
  );
  const published = parseCanonicalJson(publishedBytes, 'Adopted update marker');
  if (!authenticateMarker(published, key) || !acceptsAttestedMarker(published)) {
    throw new Error('Adopted update marker verification failed');
  }
  validateAdoptedMarker(published);
  if (sha256(await readGuardedRegularFile(
    paths.instanceStore, 1024 * 1024, 'Family Server inventory', fileGuard,
  ))
    !== expectedInstanceStoreSha256) throw new Error('Family Server inventory changed during adoption');
  await verifyNamespace(paths, transactionId);

  const receipt = adoptionReceipt({ transactionId, adoption, signedMarkerSha256: sha256(publishedBytes) });
  await preserveExactManagedFile(
    receiptFile,
    Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, 'utf8'),
    roots.dataRoot,
    dependencies,
  );
  return { status: 'adopted', transactionId, signedMarkerSha256: receipt.signedMarkerSha256 };
}
